/**
 * src/services/actions/studyNotes.ts
 * The "Study & Lecture Notes" preset: an extensive summary of every lecture, one request per lecture.
 *
 * One request for the whole course has to squeeze every lecture into a single answer, which makes each
 * one shallow. Here every lecture (a document, or a few small consecutive ones) gets its own request with
 * the full output room, two at a time. Finished lectures are shown right away, in course order.
 */

import type { LLMOptions, LLMResponse } from '@/types/llm';
import type { BundledDocument, CourseContextBundle } from '@/types/parser';
import type { SourceRegistry } from '@/services/context/sourceRegistry';
import { estimateTokenCount, sumUsage } from '@/services/llm/llmUtils';
import { CITATION_INSTRUCTION } from '../../../shared/prompts';
import { findSyllabusDocs } from './keyTerms';

/** Small consecutive documents are summarized together up to this size; a bigger one goes alone. */
export const LECTURE_BATCH_TOKENS = 12_000;
/** Most a single request may carry (a long lecture is cut to this by the relevance filter). */
export const LECTURE_MAX_TOKENS = 60_000;
/** Requests at the same time (the server allows two per user). */
const CONCURRENCY = 2;
/** Longest wait for a "too many requests" before trying a lecture again. */
const MAX_RETRY_WAIT_S = 60;

/**
 * The lectures in course order: every document except the syllabus (which is not a lecture), with small
 * consecutive documents of the same module grouped. A course with only a syllabus summarizes that.
 */
export function buildLectureBatches(bundle: CourseContextBundle, batchTokens = LECTURE_BATCH_TOKENS): BundledDocument[][] {
  const all = (bundle.documents ?? []).filter((d) => d.content.trim().length > 0);
  const syllabus = new Set(findSyllabusDocs(bundle));
  const lectures = all.filter((d) => !syllabus.has(d));
  const docs = lectures.length > 0 ? lectures : all;

  const batches: BundledDocument[][] = [];
  let current: BundledDocument[] = [];
  let tokens = 0;
  for (const doc of docs) {
    const t = estimateTokenCount(doc.content);
    const sameModule = current.length === 0 || current[0].modulePath === doc.modulePath;
    if (current.length > 0 && (!sameModule || tokens + t > batchTokens)) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(doc);
    tokens += t;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function buildLectureNotesPrompt(courseName = 'this course', titles: string[] = []): string {
  const which =
    titles.length === 1
      ? `the lecture "${titles[0]}"`
      : titles.length > 1
        ? `the lectures/documents provided (${titles.map((t) => `"${t}"`).join(', ')}), each under its own "## <title>" heading in this order`
        : `every lecture in the provided materials, each under its own "## <lecture title>" heading in course order`;
  return (
    `Write extensive study notes of ${which} from "${courseName}", based strictly on the provided materials.\n` +
    `This is a study summary, not a quick answer: the length limits for short answers do NOT apply. Go through the material slide by slide / page by page ` +
    `and keep every concept, argument, example, figure description, formula and number it contains, so a student can study from these notes instead of the slides.\n` +
    `Structure (Markdown, start directly with the first heading, no introduction):\n` +
    `### Overview\n2-4 sentences: what this lecture is about and how it fits the course.\n` +
    `### Content\nThe lecture's topics in the order the material treats them, each as a "####" subheading with full explanations in bullets: ` +
    `definitions, how and why things work, steps of procedures, worked examples, comparisons (use a table when the material compares things).\n` +
    `### Key Terms\nCompact Markdown table: Term | Definition (in the material's own wording) | Source.\n` +
    `### Formulas & Procedures\nExact formulas, code or step lists from the material, with what each symbol or step means. Leave this heading out when there are none.\n` +
    `### Exam Focus\nWhat the material itself marks as important, likely exam content or a common mistake. Leave this heading out when the material says nothing about it.\n` +
    `Write in the language of the material. Do not add review questions, study tips or knowledge that is not in the material.` +
    `\n${CITATION_INSTRUCTION}`
  );
}

export interface RunStudyNotesInput {
  generate: (prompt: string, options?: Partial<LLMOptions>) => Promise<LLMResponse>;
  bundle: CourseContextBundle;
  courseName?: string;
  /** Options of the request (mode, signal, kind, ...); the context and relevance are set here. */
  options: Partial<LLMOptions>;
  onStatus?: (message: string) => void;
  /** The notes so far (all lectures that are done, in course order), each time a lecture finishes. */
  onProgress?: (markdown: string, sources: SourceRegistry) => void;
  /** Wait between retries; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isAbort = (err: any) => err?.name === 'AbortError' || err?.code === 'ABORTED';

/** Lecture notes, one request per lecture. Throws only when nothing at all could be summarized. */
export async function runStudyNotes(input: RunStudyNotesInput): Promise<LLMResponse> {
  const { generate, bundle, courseName, options, onStatus, onProgress, sleep = defaultSleep } = input;
  const batches = buildLectureBatches(bundle);
  // no documents: the plain one-request preset (it answers from what there is)
  if (batches.length === 0) return generate(buildLectureNotesPrompt(courseName), { ...options, kind: 'preset', escalate: false, contextBundle: bundle });

  const results: Array<{ text: string; failed?: boolean } | undefined> = new Array(batches.length);
  let sources: SourceRegistry = {};
  let tokens = 0;
  let sentDocs = 0;
  let sentTokens = 0;
  let done = 0;
  let last: LLMResponse | undefined;
  const answered: LLMResponse[] = [];
  let firstError: unknown;

  const heading = (batch: BundledDocument[]) => batch.map((d) => d.title).join(' · ');
  const notes = () =>
    results
      .map((r, i) => (r ? (batches[i].length > 1 ? r.text : `## ${heading(batches[i])}\n\n${r.text}`) : undefined))
      .filter((s): s is string => s !== undefined)
      .join('\n\n---\n\n');
  const status = () => onStatus?.(`Summarizing lecture ${Math.min(done + 1, batches.length)} of ${batches.length}…`);

  const summarize = async (i: number) => {
    const batch = batches[i];
    const tokensIn = batch.reduce((n, d) => n + estimateTokenCount(d.content), 0);
    const request: Partial<LLMOptions> = {
      ...options,
      kind: 'preset',
      escalate: false,
      onStatus: undefined,
      contextBundle: { courseInfo: bundle.courseInfo, documents: batch },
      relevance: { mode: 'all', tokenBudget: Math.min(Math.max(tokensIn, LECTURE_BATCH_TOKENS), LECTURE_MAX_TOKENS) },
    };
    const prompt = buildLectureNotesPrompt(courseName, batch.map((d) => d.title));
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await generate(prompt, request);
        tokens += res.tokenEstimate ?? 0;
        sentDocs += res.contextStats?.includedDocuments ?? batch.length;
        sentTokens += res.contextStats?.includedTokens ?? 0;
        sources = { ...sources, ...res.sources };
        last = res;
        answered.push(res);
        return { text: res.text.trim() };
      } catch (err: any) {
        if (isAbort(err) || options.signal?.aborted) throw err;
        const wait = Number(err?.retryAfter) || 5;
        if (err?.code === 'RATE_LIMIT' && attempt < 3 && wait <= MAX_RETRY_WAIT_S) {
          onStatus?.(`Waiting ${wait}s for the service before the next lecture…`);
          await sleep(wait * 1000);
          continue;
        }
        // a budget or account problem fails every lecture the same way: stop instead of showing it N times
        if (['DAILY_LIMIT', 'NOT_APPROVED', 'AUTH_REQUIRED', 'PAYMENT_REQUIRED', 'INVALID_API_KEY', 'MISSING_API_KEY'].includes(err?.code)) throw err;
        firstError ??= err;
        return { text: `⚠ This lecture could not be summarized (${err?.message || 'unknown error'}). Try the preset again later.`, failed: true };
      }
    }
  };

  status();
  let next = 0;
  let fatal: unknown;
  const worker = async () => {
    while (next < batches.length && fatal === undefined) {
      const i = next++;
      try {
        results[i] = await summarize(i);
      } catch (err) {
        fatal ??= err;
        return;
      }
      done++;
      onProgress?.(notes(), sources);
      if (done < batches.length) status();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

  const anyOk = results.some((r) => r && !r.failed);
  if (fatal !== undefined && (!anyOk || isAbort(fatal))) throw fatal;
  if (!anyOk) throw firstError ?? fatal;

  const text = notes() + (fatal !== undefined ? `\n\n⚠ Stopped early: ${(fatal as any)?.message || 'the service refused further requests.'}` : '');
  const contextStats = last?.contextStats && {
    ...last.contextStats,
    totalDocuments: bundle.documents.length,
    includedDocuments: sentDocs,
    includedTokens: sentTokens,
    widenable: false,
  };
  return { ...(last as LLMResponse), text, sources, contextStats, usage: sumUsage(answered) ?? last?.usage, tokenEstimate: tokens || last?.tokenEstimate };
}
