/**
 * src/components/actions/ChatPlugin.tsx
 * The chat tool. One bar holds the summary presets and the context controls (context size,
 * relevance filter, copy context).
 *
 * - Presets always go through the gateway (llm.generate, kind "preset"). The chat shows a one-sentence version
 *   of the preset's question; they have their own context rules (PRESET_CONTEXT): the briefing and the study notes
 *   get all documents, the deadlines and grades presets search for their own keywords.
 * - Every request carries the conversation so far, and the student's chats about other courses (the other tabs),
 *   so a question can refer to them.
 * - Free questions: in a build that talks to Gemini directly (development) they go straight to the
 *   API without system prompt or output filtering (llm.rawChat); in backend mode they go through the
 *   gateway like everything else, so the server applies its own prompt and limits.
 * Conversation state lives per course for the whole session (see chatSessions).
 */

import React from 'react';
import { Award, BookOpen, Calendar, ListChecks, MessageSquare, Sparkles } from 'lucide-react';
import { ActionPlugin, ActionPluginProps, SUMMARY_PRESETS, SummaryPresetConfig } from '@/types/actions';
import type { LLMOptions, RelevanceOption } from '@/types/llm';
import { llm } from '@/services/llm/llmClient';
import type { RawChatTurn } from '@/services/llm/rawChat';
import { pickCited } from '@/services/llm/citations';
import type { SourceRegistry } from '@/services/context/sourceRegistry';
import { runKeyTerms } from '@/services/actions/keyTerms';
import { runStudyNotes } from '@/services/actions/studyNotes';
import { buildRelevanceQuery } from '@/services/context/relevance';
import { describeStats } from '@/services/context/describeStats';
import { withPinnedDocuments } from '@/services/context/userFiles';
import { otherConversations, useSessionRef, useSessionState } from '@/services/chat/chatSessions';
import { SourceLinksProvider } from '@/components/StructuredMarkdown';
import { buildSourceResolver } from '@/services/brightspace/sourceLinks';
import { getBrightspaceOrigin } from '@/services/brightspace/courseDetector';
import { ChatComposer, ChatEmptyState, ChatShell } from '@/components/chat/ChatShell';
import { ChatBubble, ChatErrorToast, ChatLoading, chipClass } from '@/components/chat/ChatParts';
import { ContextToolbar, useContextControls } from '@/components/chat/ContextControls';
import { useChatAttachments } from '@/components/chat/useChatAttachments';

/** How much document content each preset needs: everything, or only what matches these keywords. */
const PRESET_CONTEXT: Record<string, { mode: 'all' } | { mode: 'auto'; query: string }> = {
  'complete-briefing': { mode: 'all' },
  'study-notes': { mode: 'all' },
  'key-terms': { mode: 'all' },
  'assignments-deadlines': {
    mode: 'auto',
    query: 'syllabus assignment opdracht deadline rubric grading beoordeling exam tentamen schedule planning',
  },
  'grades-feedback': {
    mode: 'auto',
    query: 'syllabus grading beoordeling feedback cijfer grade rubric weging',
  },
};

/** What to send again for "Search all materials". */
interface Rerun {
  kind: 'preset' | 'chat';
  prompt: string;
  presetId?: string;
}

/** A turn plus the quiet metadata shown under model answers. */
interface Turn extends RawChatTurn {
  tokens?: number;
  tokensIn?: number;
  tokensOut?: number;
  contextInfo?: string;
  contextTitle?: string;
  attachments?: string[];
  mode?: string;
  widenable?: boolean;
  /** Answered from general knowledge, not the course materials. */
  general?: boolean;
  rerun?: Rerun;
  /** Set on a preset's answer. */
  presetTitle?: string;
  /** The question bubble of a preset (its one-sentence version). */
  preset?: boolean;
  /** The sources the answer cites, by id: they keep their label and link for as long as the message exists. */
  sources?: SourceRegistry;
  /** Lecture notes that are still being written (the lectures done so far). */
  partial?: boolean;
}

/** The turns without a trailing in-progress answer. */
const withoutPartial = (turns: Turn[]): Turn[] => (turns[turns.length - 1]?.partial ? turns.slice(0, -1) : turns);

const getPresetIcon = (iconName: string) => {
  switch (iconName) {
    case 'Sparkles':
      return <Sparkles className="h-3 w-3 text-blue-600" />;
    case 'BookOpen':
      return <BookOpen className="h-3 w-3 text-indigo-600" />;
    case 'ListChecks':
      return <ListChecks className="h-3 w-3 text-violet-600" />;
    case 'Calendar':
      return <Calendar className="h-3 w-3 text-emerald-600" />;
    case 'Award':
      return <Award className="h-3 w-3 text-amber-600" />;
    default:
      return <Sparkles className="h-3 w-3 text-blue-600" />;
  }
};

/**
 * Earlier turns as the model should see them: alternating user/model. A preset is its one-sentence question (the
 * long preset prompt itself is not repeated); answers from before presets had a question get a short note.
 */
function modelHistory(turns: Turn[]): RawChatTurn[] {
  const out: RawChatTurn[] = [];
  const push = (role: RawChatTurn['role'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.text += `\n\n${text}`;
    else out.push({ role, text });
  };
  for (const t of turns) {
    if (t.role === 'model' && t.presetTitle && out[out.length - 1]?.role !== 'user') push('user', `Preset: ${t.presetTitle}`);
    push(t.role, t.text);
  }
  while (out.length > 0 && out[0].role === 'model') out.shift(); // a conversation starts with the user
  return out;
}

const ChatView: React.FC<ActionPluginProps> = ({ courseData, selection, parsedDocs, currentMode, onOpenSettings }) => {
  // Per-course conversation state for the whole session (see chatSessions)
  const scope = courseData.orgUnitId;
  const [turns, setTurns] = useSessionState<Turn[]>(scope, 'chat.turns', []);
  const [input, setInput] = useSessionState(scope, 'chat.input', '');
  const [busy, setBusy] = useSessionState(scope, 'chat.busy', false);
  const [activePresetId, setActivePresetId] = useSessionState<string | null>(scope, 'chat.preset', null);
  const [error, setError] = useSessionState<string | null>(scope, 'chat.error', null);
  const [status, setStatus] = useSessionState<string | null>(scope, 'chat.status', null);
  const abortRef = useSessionRef<AbortController | null>(scope, 'chat.abort', null);
  const ctl = useContextControls(courseData, selection, parsedDocs, 'chat');
  const att = useChatAttachments(scope);

  // Citations in answers link to the document in Brightspace
  const resolveSource = React.useMemo(() => {
    const here = typeof window !== 'undefined' ? window.location : undefined;
    const origin = (here && getBrightspaceOrigin(here.href)) || here?.origin || '';
    return origin ? buildSourceResolver(courseData, origin) : undefined;
  }, [courseData]);

  // Free questions go straight to the API in a direct-Gemini build, through the gateway otherwise.
  const viaGateway = currentMode === 'backend';

  const stop = () => abortRef.current?.abort();

  /** The student's chats about other courses (the other tabs), so this chat can refer to them. */
  const relatedChats = () =>
    otherConversations<Turn>(scope, 'chat.turns').map((c) => ({ course: c.name, turns: modelHistory(c.turns) }));

  /** Shared start/finish of every request. */
  const run = async (work: (controller: AbortController) => Promise<void>) => {
    if (busy) stop();
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await work(controller);
    } catch (err: any) {
      if (err?.name === 'AbortError' || err?.code === 'ABORTED') return; // cancelled by the student
      setError(err?.message || 'Failed to generate response. Please check your settings.');
    } finally {
      setBusy(false);
      setActivePresetId(null);
      setStatus(null);
      abortRef.current = null;
    }
  };

  /** A preset or a free question through the gateway (llm.generate). */
  const runGateway = async (args: { kind: 'preset' | 'chat'; prompt: string; presetId?: string; again?: boolean }) => {
    const { kind, prompt, presetId, again } = args;
    const preset = presetId ? SUMMARY_PRESETS.find((p) => p.id === presetId) : undefined;
    if (presetId) setActivePresetId(presetId);

    // Files attached to this question travel with it, then the chips are cleared.
    const pinned = att.pinnedDocs;
    const attachedNames = att.names;
    att.clear();
    const previous = turns;
    if (!again) {
      // a preset shows its one-sentence question, so the chat reads like a conversation
      const text = kind === 'preset' && preset ? preset.question : prompt;
      setTurns((prev) => [
        ...prev,
        { role: 'user', text, preset: kind === 'preset' || undefined, attachments: attachedNames.length > 0 ? attachedNames : undefined },
      ]);
    }

    await run(async (controller) => {
      const presetScope = presetId ? PRESET_CONTEXT[presetId] : undefined;
      const previousQuestions = previous.filter((t) => t.role === 'user').map((t) => t.text);
      const relevance: RelevanceOption = again
        ? { mode: 'all', sections: 'all' }
        : ctl.relevanceOverride ??
          (presetScope?.mode === 'all'
            ? { mode: 'all' }
            : { query: presetScope?.mode === 'auto' ? presetScope.query : buildRelevanceQuery(prompt, previousQuestions) });

      const options: Partial<LLMOptions> = {
        mode: currentMode,
        contextBundle: withPinnedDocuments(ctl.bundle, pinned),
        relevance,
        signal: controller.signal,
        kind,
        escalate: !again,
        onStatus: setStatus,
        history: modelHistory(previous),
        relatedChats: relatedChats(),
      };

      // Key terms look in the syllabus first, then in the rest of the course (two requests);
      // lecture notes take one request per lecture and show each lecture as soon as it is done
      const response =
        presetId === 'study-notes' && options.contextBundle
          ? await runStudyNotes({
              generate: llm.generate,
              bundle: options.contextBundle,
              courseName: courseData.courseName,
              options,
              onStatus: setStatus,
              onProgress: (text, sources) =>
                setTurns((prev) => [
                  ...withoutPartial(prev),
                  { role: 'model', text, partial: true, presetTitle: preset?.title, sources: pickCited(text, sources) },
                ]),
            })
          : presetId === 'key-terms' && options.contextBundle
          ? await runKeyTerms({
              generate: llm.generate,
              bundle: options.contextBundle,
              courseName: courseData.courseName,
              options,
              onStatus: setStatus,
            })
          : await llm.generate(prompt, options);
      const stats = response.contextStats;
      ctl.recordSent(response.serializedContext, stats);
      setTurns((prev) => [
        ...withoutPartial(prev),
        {
          role: 'model',
          text: response.text,
          mode: response.mode,
          tokens: response.tokenEstimate || response.usage?.totalTokens,
          tokensIn: response.usage?.promptTokens,
          tokensOut: response.usage?.candidateTokens,
          contextInfo: stats && stats.totalDocuments > 0 ? `${stats.includedDocuments}/${stats.totalDocuments} docs` : undefined,
          contextTitle: describeStats(stats),
          widenable: !again && Boolean(stats?.widenable || response.searchAllAvailable),
          general: response.general || undefined,
          rerun: { kind, prompt, presetId },
          presetTitle: preset?.title,
          sources: response.sources ? pickCited(response.text, response.sources) : undefined,
        },
      ]);
    });
  };

  /** A free question straight to the API: no system prompt, no output filtering. */
  const runRaw = async (text: string) => {
    const pinned = att.pinnedDocs;
    const attachedNames = att.names;
    att.clear();
    const next: Turn[] = [...turns, { role: 'user', text, attachments: attachedNames.length > 0 ? attachedNames : undefined }];
    setTurns(next);

    await run(async (controller) => {
      const res = await llm.rawChat(modelHistory(next), {
        relatedChats: relatedChats(),
        contextBundle: withPinnedDocuments(ctl.bundle, pinned),
        relevance: ctl.relevanceOverride,
        signal: controller.signal,
      });
      const st = res.contextStats;
      setTurns((prev) => [
        ...prev,
        {
          role: 'model',
          text: res.text || '(empty response)',
          mode: 'raw',
          tokens: res.totalTokens ?? ((res.promptTokens ?? 0) + (res.candidateTokens ?? 0) || undefined),
          tokensIn: res.promptTokens,
          tokensOut: res.candidateTokens,
          contextInfo: st && st.totalDocuments > 0 ? `${st.includedDocuments}/${st.totalDocuments} docs` : undefined,
          contextTitle: describeStats(st),
        },
      ]);
      ctl.recordSent(res.contextMarkdown, st);
    });
  };

  const handlePresetClick = (preset: SummaryPresetConfig) => {
    void runGateway({ kind: 'preset', prompt: preset.promptTemplate(courseData.courseName), presetId: preset.id });
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    if (viaGateway) void runGateway({ kind: 'chat', prompt: text });
    else void runRaw(text);
  };

  // "Search all materials": ask the same thing again with everything
  const searchAll = (turn: Turn) => {
    if (!turn.rerun || busy) return;
    void runGateway({ ...turn.rerun, again: true });
  };

  const presetChips = (
    <>
      {SUMMARY_PRESETS.map((preset) => {
        const isActive = activePresetId === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            disabled={busy}
            onClick={() => handlePresetClick(preset)}
            title={`${preset.subtitle}: ${preset.description}`}
            className={chipClass(isActive, busy)}
          >
            {getPresetIcon(preset.icon)}
            <span>{preset.title}</span>
          </button>
        );
      })}
    </>
  );

  return (
    <SourceLinksProvider value={resolveSource}>
    <ChatShell
      onFilesDropped={(files) => void att.add(files)}
      onFoldersDropped={(scan) => void att.addFolder(scan)}
      scrollKey={`${turns.length}-${busy}-${error ?? ''}`}
      top={
        <>
          <ContextToolbar controls={ctl} leading={presetChips} />
          {error && <ChatErrorToast message={error} onOpenSettings={onOpenSettings} />}
        </>
      }
      messages={
        <>
          {turns.length === 0 && !busy && (
            <ChatEmptyState icon={<MessageSquare className="h-10 w-10 text-slate-300" />} title="Select a Preset or Ask a Question">
              Choose one of the course summary presets above, or type any specific question about your syllabus, slides,
              assignments, or grades.
            </ChatEmptyState>
          )}

          {turns.map((t, i) => (
            <ChatBubble
              key={i}
              role={t.role === 'user' ? 'user' : 'assistant'}
              content={t.text}
              mode={t.role === 'model' ? t.mode ?? (viaGateway ? currentMode : 'raw') : undefined}
              tokens={t.tokens}
              tokensIn={t.tokensIn}
              tokensOut={t.tokensOut}
              contextInfo={t.contextInfo}
              contextTitle={t.contextTitle}
              attachments={t.attachments}
              sources={t.sources}
              general={t.general}
              onSearchAll={t.widenable && t.rerun && !busy ? () => searchAll(t) : undefined}
            />
          ))}

          {busy && <ChatLoading onStop={stop} label={status ?? (viaGateway || activePresetId ? undefined : 'Waiting for the model...')} />}
        </>
      }
      composer={
        <ChatComposer
          value={input}
          onChange={setInput}
          onSubmit={send}
          placeholder="Ask a follow-up question about the course materials..."
          busy={busy}
          onStop={stop}
          attachments={{
            items: att.items,
            onAdd: (files) => void att.add(files),
            onRemove: att.remove,
          }}
          onClear={
            turns.length > 0
              ? () => {
                  setTurns([]);
                  ctl.clearSent();
                  setError(null);
                }
              : undefined
          }
        />
      }
    />
    </SourceLinksProvider>
  );
};

export const ChatPlugin: ActionPlugin = {
  id: 'chat',
  name: 'Chat',
  title: 'Chat',
  icon: 'Sparkles',
  status: 'active',
  description: 'Ask questions about your course, or use the summary presets.',
  order: 1,
  component: ChatView,
};
