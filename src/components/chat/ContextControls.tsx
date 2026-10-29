/**
 * src/components/chat/ContextControls.tsx
 * Shared context tooling for every chat tool: how much course context is available / was sent with
 * the last question, a switch for the relevance filter, a "copy context" button and an inspector
 * that lists which documents were sent. Use the hook for the state and the toolbar for the UI:
 *
 *   const ctl = useContextControls(courseData, selection, parsedDocs, 'mytool');
 *   llm.generate(prompt, { contextBundle: ctl.bundle, relevance: ctl.relevanceOverride ?? {...} });
 *   ctl.recordSent(response.serializedContext, response.contextStats);
 *   <ContextToolbar controls={ctl} />
 */

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Filter } from 'lucide-react';
import { buildContextBundle } from '@/services/context/contextSerializer';
import { inspectContext } from '@/services/context/contextInspector';
import { prepareContext } from '@/services/context/prepareContext';
import type { RelevanceOption } from '@/types/llm';
import type { ContextSelection, CourseContextBundle, ParsedDocument, RelevanceStats } from '@/types/parser';
import type { CourseData } from '@/types/brightspace';
import { chipClass } from './ChatParts';
import { useDrawerLayout } from '@/components/LayoutContext';
import { describeStats } from '@/services/context/describeStats';
import { useSessionState } from '@/services/chat/chatSessions';

interface LastSent {
  markdown: string;
  stats?: RelevanceStats;
}

export interface ContextControls {
  /** The whole selected context; pass it to the gateway as `contextBundle`. */
  bundle: CourseContextBundle;
  filterRelevance: boolean;
  setFilterRelevance: (on: boolean) => void;
  /** 'off' when the user switched the filter off, otherwise undefined (= default filtering). */
  relevanceOverride: RelevanceOption | undefined;
  recordSent: (markdown: string | undefined, stats: RelevanceStats | undefined) => void;
  clearSent: () => void;
  /** Internal data for the toolbar. */
  _view: {
    rows: ReturnType<typeof inspectContext>;
    lastSent: LastSent | null;
    fullContext: string;
  };
}

export function useContextControls(
  courseData: CourseData,
  selection: ContextSelection,
  parsedDocs: ParsedDocument[] | Record<string, ParsedDocument> | Map<string, ParsedDocument> | undefined,
  /** Which tool uses the controls: every tool in every course keeps its own filter switch and "last sent". */
  toolId: string
): ContextControls {
  const [filterRelevance, setFilterRelevance] = useSessionState(courseData.orgUnitId, `${toolId}.filter`, true);
  const [lastSent, setLastSent] = useSessionState<LastSent | null>(courseData.orgUnitId, `${toolId}.lastSent`, null);

  const bundle = useMemo(
    () => buildContextBundle(courseData, selection, parsedDocs),
    [courseData, selection, parsedDocs]
  );
  // The whole selection, before any filtering: what the filter chooses from.
  const fullContext = useMemo(
    () => prepareContext({ bundle, prompt: '', relevance: 'off' }).serialized ?? '',
    [bundle]
  );
  const rows = useMemo(
    () => inspectContext(courseData, selection, parsedDocs),
    [courseData, selection, parsedDocs]
  );

  return {
    bundle,
    filterRelevance,
    setFilterRelevance,
    relevanceOverride: filterRelevance ? undefined : 'off',
    recordSent: (markdown, stats) => setLastSent({ markdown: markdown ?? '', stats }),
    clearSent: () => setLastSent(null),
    _view: { rows, lastSent, fullContext },
  };
}

const kTokens = (chars: number) => {
  const t = Math.ceil(chars / 4);
  return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t);
};

/** Chip row (size, filter switch, copy) plus the collapsible document inspector. */
export const ContextToolbar: React.FC<{ controls: ContextControls; /** Chips shown first in the same bar (e.g. the preset buttons). */ leading?: React.ReactNode }> = ({
  controls,
  leading,
}) => {
  const { expanded } = useDrawerLayout();
  const [showInspector, setShowInspector] = useState(false);
  const { rows, lastSent, fullContext } = controls._view;
  const withContent = rows.filter((r) => r.included).length;
  const sentIds = lastSent?.stats ? new Set(lastSent.stats.includedTopicIds) : null;
  const shown = lastSent?.markdown || fullContext;
  const fullLabel = `Context · ${
    lastSent?.stats
      ? `${lastSent.stats.includedDocuments}/${lastSent.stats.totalDocuments} docs sent`
      : `${withContent}/${rows.length} topics`
  } · ~${kTokens(shown.length)} tokens`;

  return (
    <>
      {/* Full screen: the tool's own chips (the presets) on the left, the context controls in their own
          piece at the right. Side panel (too narrow): the controls drop below the presets. Their full
          wording stays available to screen readers and tooltips. */}
      <div
        className={`px-3 py-1.5 bg-slate-50/70 border-b border-slate-200 flex gap-2 ${
          expanded ? 'items-start justify-between' : 'flex-col items-stretch gap-1.5'
        }`}
        data-testid="context-toolbar"
        data-layout={expanded ? 'row' : 'stacked'}
      >
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1" data-testid="toolbar-leading">
          {leading}
        </div>

        <div
          className={`flex items-center gap-1 flex-shrink-0 ${expanded ? 'pl-2 border-l border-slate-200' : 'flex-wrap'}`}
          data-testid="context-controls"
        >
          <button
            type="button"
            onClick={() => setShowInspector((v) => !v)}
            aria-expanded={showInspector}
            className={chipClass(showInspector)}
            title={`${fullLabel} — which course documents are available and which were sent with the last question`}
          >
            {showInspector ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span className="sr-only">{fullLabel}</span>
            <span aria-hidden="true">~{kTokens(shown.length)} tokens</span>
          </button>
          <button
            type="button"
            onClick={() => controls.setFilterRelevance(!controls.filterRelevance)}
            aria-pressed={controls.filterRelevance}
            className={chipClass(controls.filterRelevance)}
            title={`Relevance filter ${controls.filterRelevance ? 'on' : 'off'}: send only the documents relevant to your question`}
          >
            <Filter className={`h-3 w-3 ${controls.filterRelevance ? 'text-blue-600' : 'text-slate-400'}`} />
            <span className="sr-only">Relevance filter {controls.filterRelevance ? 'on' : 'off'}</span>
            <span aria-hidden="true" className="text-[10px]">
              {controls.filterRelevance ? 'on' : 'off'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(shown)}
            className={chipClass()}
            title={lastSent ? 'Copy the context that was sent with the last question' : 'Copy the full selected context'}
          >
            <Copy className="h-3 w-3 text-slate-500" />
            <span className="sr-only">Copy context</span>
          </button>
        </div>
      </div>

      {showInspector && lastSent?.stats && (
        <p className="px-3 py-1 border-b border-slate-100 bg-slate-50/70 text-[11px] text-slate-500" data-testid="context-summary">
          {describeStats(lastSent.stats)}
          {lastSent.stats.queryKind ? ` · seen as: ${lastSent.stats.queryKind}` : ''}
        </p>
      )}

      {showInspector && (
        <ul className="max-h-40 overflow-y-auto border-b border-slate-200 bg-slate-50/70 divide-y divide-slate-100 text-[11px]">
          {rows.length === 0 && <li className="px-3 py-1.5 text-slate-400">No topics selected.</li>}
          {rows.map((r, i) => {
            const state = !r.included ? 'empty' : sentIds && !sentIds.has(r.topicId) ? 'skipped' : 'sent';
            return (
              <li key={i} className="flex items-center gap-2 px-3 py-1" title={r.modulePath}>
                <span
                  className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                    state === 'sent' ? 'bg-emerald-400' : state === 'skipped' ? 'bg-slate-300' : 'border border-slate-300'
                  }`}
                />
                <span className={`truncate ${state === 'sent' ? 'text-slate-700' : 'text-slate-400'}`}>{r.title}</span>
                <span className="ml-auto flex-shrink-0 text-slate-400">
                  {state === 'empty'
                    ? 'no text available'
                    : state === 'skipped'
                      ? 'not relevant to last question'
                      : `${r.kind} · ~${kTokens(r.chars)}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};
