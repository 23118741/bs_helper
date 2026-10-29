/**
 * src/components/chat/ChatParts.tsx
 * Building blocks shared by every chat tool (the Chat and future tools), so that all
 * chats look and behave the same: message bubbles with a quiet footer, loading row, error toast,
 * "clear conversation" action and the quick-action chips row.
 */

import React, { useState } from 'react';
import { AlertCircle, Check, Copy, FileText, Paperclip, RefreshCw, Sparkles, StopCircle } from 'lucide-react';
import { AnswerSourcesProvider, StructuredMarkdown } from '@/components/StructuredMarkdown';
import type { SourceRegistry } from '@/services/context/sourceRegistry';
import { useDrawerLayout } from '@/components/LayoutContext';

export const MessageCopyButton: React.FC<{ content: string }> = ({ content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Ignore clipboard write failure
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Kopieer bericht"
      className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-800 transition-colors py-0.5 px-1.5 rounded hover:bg-slate-100 font-sans"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-600" />
          <span className="text-emerald-700 font-medium">Gekopieerd!</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>Kopieer</span>
        </>
      )}
    </button>
  );
};

export interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  /** Quiet metadata under an assistant answer. */
  mode?: string;
  tokens?: number;
  /** Input (prompt) and output (answer) tokens, when the provider reported them. */
  tokensIn?: number;
  tokensOut?: number;
  contextInfo?: string;
  /** File names attached to a user message. */
  attachments?: string[];
  /** Longer description of what was searched (tooltip of the context chip). */
  contextTitle?: string;
  /** Shows a quiet "Search all materials" action under the answer. */
  onSearchAll?: () => void;
  /** The sources this answer cites (by id). When set, statements without a source are marked. */
  sources?: SourceRegistry;
  /** The answer comes from the AI's general knowledge, not from the course materials. */
  general?: boolean;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ role, content, mode, tokens, tokensIn, tokensOut, contextInfo, attachments, contextTitle, onSearchAll, sources, general }) => {
  const { expanded } = useDrawerLayout();
  const isUser = role === 'user';
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`rounded-xl px-3.5 py-2.5 leading-relaxed ${expanded ? 'text-sm' : 'text-xs'} ${
          isUser
            ? 'max-w-[85%] bg-blue-600 text-white rounded-br-none'
            : 'max-w-full w-full bg-white border border-slate-200 text-slate-800 shadow-sm rounded-bl-none'
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap font-sans">
            {content}
            {attachments && attachments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {attachments.map((n, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px]">
                    <Paperclip className="h-3 w-3" />
                    <span className="truncate max-w-[12rem]">{n}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
          {general && (
            <div
              className="mb-1.5 inline-flex items-center gap-1 text-[10px] text-slate-400"
              title="The course materials do not cover this question, so this answer comes from the AI's general knowledge."
              data-testid="general-answer-tag"
            >
              <Sparkles className="h-3 w-3" />
              <span>Not from your course materials · AI answer</span>
            </div>
          )}
          <AnswerSourcesProvider value={sources}>
            <StructuredMarkdown content={content} />
          </AnswerSourcesProvider>
          </>
        )}

        {!isUser && (
          <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-100 text-[10px] text-slate-400 font-mono">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
              {mode && <span>Mode: {mode}</span>}
              {tokens !== undefined && (
                <span data-testid="token-usage">
                  ~{tokens.toLocaleString()} tokens
                  {tokensIn !== undefined && tokensOut !== undefined && (
                    <> (in {tokensIn.toLocaleString()} · out {tokensOut.toLocaleString()})</>
                  )}
                </span>
              )}
              {contextInfo && (
                <span
                  className="inline-flex items-center gap-1 text-slate-400"
                  title={contextTitle ?? `Course documents sent with this question: ${contextInfo}`}
                >
                  <FileText className="h-3 w-3" />
                  {contextInfo}
                </span>
              )}
              {onSearchAll && (
                <button
                  type="button"
                  onClick={onSearchAll}
                  className="font-sans text-blue-600 hover:underline"
                  title="Ask this again with all of your course material"
                >
                  Search all materials
                </button>
              )}
            </div>
            <MessageCopyButton content={content} />
          </div>
        )}
      </div>
    </div>
  );
};

export const ChatLoading: React.FC<{ onStop: () => void; label?: string }> = ({
  onStop,
  label = 'Analyzing course materials & generating response...',
}) => (
  <div className="flex items-center gap-2 px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-600 shadow-sm w-fit">
    <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
    <span>{label}</span>
    <button
      type="button"
      onClick={onStop}
      className="ml-2 inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded border border-rose-200 transition-colors"
    >
      <StopCircle className="h-3 w-3" />
      Stop
    </button>
  </div>
);

export const ChatErrorToast: React.FC<{ message: string; onOpenSettings?: () => void }> = ({ message, onOpenSettings }) => (
  <div role="alert" className="m-3 p-2.5 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-xs text-rose-800">
    <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
    <div className="flex-1">
      <p className="font-medium">Error executing request</p>
      <p className="text-rose-700">{message}</p>
    </div>
    {onOpenSettings && message.includes('API key') && (
      <button type="button" onClick={onOpenSettings} className="text-xs font-semibold text-rose-800 underline shrink-0">
        Settings
      </button>
    )}
  </div>
);

/** Row of small rounded chips under the header: presets and context controls. */
export const CHIP_ROW_CLASS = 'px-3 py-1.5 bg-white border-b border-slate-200 flex flex-wrap items-center gap-1.5';

export const chipClass = (active = false, disabled = false) =>
  `inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] font-medium leading-none transition-colors whitespace-nowrap ${
    active
      ? 'border-blue-500 bg-blue-50 text-blue-800 ring-1 ring-blue-500/20'
      : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-slate-50'
  } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`;
