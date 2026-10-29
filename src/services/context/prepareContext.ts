/**
 * src/services/context/prepareContext.ts
 * The one place where a course context bundle becomes the text that is sent to an AI:
 * relevance filter first (on by default), then serialization. The LLM gateway and the raw chat
 * both go through here, so every tool that passes a `contextBundle` gets the filter.
 */

import type { RelevanceOption } from '@/types/llm';
import type { CourseContextBundle, RelevanceStats } from '@/types/parser';
import { getBrightspaceOrigin } from '@/services/brightspace/courseDetector';
import { serializeToJson, serializeToMarkdown } from './contextSerializer';
import { buildSourceRegistry, type SourceRegistry } from './sourceRegistry';
import { selectContext } from './retrieval';
import { buildRelevanceQuery } from './relevance';

export interface PrepareContextInput {
  bundle?: CourseContextBundle;
  /** The text of the request. Used as relevance query unless `relevance.query` is given. */
  prompt: string;
  /** Earlier turns; the last user turns help follow-up questions find the same documents. */
  history?: Array<{ role: 'user' | 'model'; text: string }>;
  relevance?: RelevanceOption;
  format?: 'markdown' | 'json';
}

export interface PreparedContext {
  serialized?: string;
  bundle?: CourseContextBundle;
  stats?: RelevanceStats;
  /** The citeable sources of what was sent (ids as shown in the context headings). */
  sources?: SourceRegistry;
}

function currentOrigin(): string | undefined {
  if (typeof window === 'undefined' || !window.location) return undefined;
  return getBrightspaceOrigin(window.location.href) || window.location.origin || undefined;
}

export function prepareContext(input: PrepareContextInput): PreparedContext {
  const { bundle, prompt, history, relevance, format } = input;
  if (!bundle) return {};

  let effective = bundle;
  let stats: RelevanceStats;

  if (relevance === 'off') {
    const docs = bundle.documents ?? [];
    stats = {
      totalDocuments: docs.length,
      includedDocuments: docs.length,
      includedTokens: docs.reduce((sum, d) => sum + Math.ceil(d.content.length / 4), 0),
      matched: false,
      includedTopicIds: docs.map((d) => d.topicId ?? d.title),
    };
  } else {
    const opts = relevance ?? {};
    const previousUser = (history ?? []).filter((h) => h.role === 'user').map((h) => h.text);
    const query = opts.query ?? buildRelevanceQuery(prompt, previousUser);
    const result = selectContext(bundle, query, {
      mode: opts.mode,
      tokenBudget: opts.tokenBudget,
      sections: opts.sections,
      neighbors: opts.neighbors,
      minScoreRatio: opts.minScoreRatio,
    });
    effective = result.bundle;
    stats = result.stats;
  }

  return {
    bundle: effective,
    stats,
    sources: buildSourceRegistry(effective, currentOrigin()),
    serialized: format === 'json' ? serializeToJson(effective) : serializeToMarkdown(effective),
  };
}
