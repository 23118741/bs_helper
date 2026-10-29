/**
 * src/services/context/relevance.ts
 * Picks which parsed documents are sent along with a question, so the prompt carries the
 * relevant slides/PDFs instead of the whole course (cheaper, faster, within rate limits).
 * Everything that is not a document (outline, assignments, grades, ...) is always kept.
 */

import { BundledDocument, CourseContextBundle, RelevanceStats } from '@/types/parser';
import { estimateTokenCount } from '@/services/llm/llmUtils';

export const DEFAULT_DOC_TOKEN_BUDGET = 60_000;
// Keep document context + the other sections under the server's 120k-token limit per request.
export const ALL_DOCS_TOKEN_BUDGET = 90_000;

const STOPWORDS = new Set(
  (
    'the and for with that this from what which who whom how when where why are was were been have has had does did ' +
    'can could should would will about into over under your you our their them they its not but all any some please tell give show ' +
    'explain summarize summary describe list what\'s ' +
    'een het van voor met dat dit die dus zijn was waren heeft hebben hadden doet deed kan kun kunt zou zouden wordt worden ' +
    'over onder jouw jij mijn ons hun hen niet maar alle alles geen wat welke wie hoe wanneer waar waarom ' +
    'graag vertel geef laat zie uitleg samenvatting samenvatten beschrijf lijst ook nog dan als bij naar uit op in te de en of is er'
  ).split(/\s+/)
);

export interface RelevanceOptions {
  /** Max estimated tokens of document content to include. */
  tokenBudget?: number;
  /** 'auto' scores documents against the query; 'all' includes everything that fits the budget. */
  mode?: 'auto' | 'all';
}

export type { RelevanceStats };

export interface RelevanceResult {
  bundle: CourseContextBundle;
  stats: RelevanceStats;
}

export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function stem(token: string): string {
  if (token.length > 5 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.length > 5 && token.endsWith('en')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

export function tokenizeQuery(text: string): string[] {
  const out = new Set<string>();
  for (const raw of normalizeText(text).split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    const isNumber = /^\d+$/.test(raw);
    if (!isNumber && (raw.length < 3 || STOPWORDS.has(raw))) continue;
    out.add(isNumber ? raw : stem(raw));
  }
  return [...out];
}

export const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[a-z0-9]/.test(ch);

/** Occurrences of `needle` that START a word ("slide" matches "slides", but "work" does not match "networking"). */
export function countWordStarts(haystack: string, needle: string, cap = 50): number {
  let count = 0;
  let from = 0;
  while (count < cap) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    if (!isWordChar(haystack[idx - 1])) count++;
    from = idx + needle.length;
  }
  return count;
}

export const hasWordStart = (haystack: string, needle: string): boolean => countWordStarts(haystack, needle, 1) > 0;

function scoreDocuments(docs: BundledDocument[], query: string): number[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return docs.map(() => 0);

  const normQuery = normalizeText(query);
  const normalized = docs.map((d) => ({
    title: normalizeText(d.title),
    path: normalizeText(d.modulePath ?? ''),
    content: normalizeText(d.content),
  }));

  // document frequency per token (content only) for an idf weight
  const wordTokens = tokens.filter((t) => !/^\d+$/.test(t));
  const df = new Map<string, number>();
  for (const t of wordTokens) {
    df.set(t, normalized.filter((n) => hasWordStart(n.content, t)).length);
  }

  return normalized.map((n) => {
    let score = 0;
    const titleStem = n.title.replace(/\.[a-z0-9]{2,5}$/, '').trim();
    if (titleStem.length >= 4 && normQuery.includes(titleStem)) score += 30;
    for (const t of tokens) {
      if (/^\d+$/.test(t)) {
        // numbers ("week 3", "slide 12") must match as whole numbers and are strong signals
        const whole = new RegExp(`(^|[^0-9])${t}([^0-9]|$)`);
        if (whole.test(n.title)) score += 8;
        if (whole.test(n.path)) score += 8;
        continue;
      }
      if (hasWordStart(n.title, t)) score += 6;
      if (hasWordStart(n.path, t)) score += 3;
    }
    for (const t of wordTokens) {
      const tf = countWordStarts(n.content, t);
      if (tf === 0) continue;
      const idf = Math.log(1 + docs.length / (1 + (df.get(t) ?? 0)));
      score += Math.log(1 + tf) * idf;
    }
    return score;
  });
}

/**
 * Returns a copy of the bundle whose documents are limited to the most relevant ones for `query`.
 * Documents that were left out are listed in `omittedDocuments` so the model can tell the user.
 */
export function selectRelevantDocuments(
  bundle: CourseContextBundle,
  query: string,
  options: RelevanceOptions = {}
): RelevanceResult {
  const docs = bundle.documents ?? [];
  const mode = options.mode ?? 'auto';
  const budget =
    options.tokenBudget ?? (mode === 'all' ? ALL_DOCS_TOKEN_BUDGET : DEFAULT_DOC_TOKEN_BUDGET);

  const tokens = docs.map((d) => estimateTokenCount(d.content));
  const scores = mode === 'all' ? docs.map(() => 0) : scoreDocuments(docs, query);
  const matched = scores.some((s) => s > 0);

  // Ranking: relevant first by score; with no match (or 'all'), keep course order.
  const order = docs.map((_, i) => i);
  if (matched) order.sort((a, b) => scores[b] - scores[a] || a - b);

  // drop weak matches (e.g. docs that only share a generic word like "week") relative to the best hit
  const cutoff = matched ? Math.max(...scores) * 0.4 : 0;

  const keep = new Set<number>();
  let used = 0;
  // Pinned documents (explicit attachments) are always sent and use up budget first.
  docs.forEach((d, i) => {
    if (d.pinned) {
      keep.add(i);
      used += tokens[i];
    }
  });
  for (const i of order) {
    if (keep.has(i)) continue;
    if (matched && scores[i] < cutoff) break;
    // the best match is always included, even when larger than the budget
    if (used + tokens[i] > budget && keep.size > 0) continue;
    keep.add(i);
    used += tokens[i];
  }

  const included = docs.filter((_, i) => keep.has(i));
  const omitted = docs
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => !keep.has(i))
    .map(({ d, i }) => ({ title: d.title, modulePath: d.modulePath, tokens: tokens[i] }));

  return {
    bundle: {
      ...bundle,
      documents: included,
      omittedDocuments: omitted.length > 0 ? omitted : undefined,
    },
    stats: {
      totalDocuments: docs.length,
      includedDocuments: included.length,
      includedTokens: used,
      matched,
      includedTopicIds: included.map((d) => d.topicId ?? d.title),
    },
  };
}

/** Builds the relevance query from the latest user messages (follow-ups rarely repeat the topic). */
export function buildRelevanceQuery(currentQuestion: string, previousUserMessages: string[]): string {
  return [currentQuestion, ...previousUserMessages.slice(-2)].join('\n');
}
