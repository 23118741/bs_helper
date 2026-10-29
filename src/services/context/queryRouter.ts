/**
 * src/services/context/queryRouter.ts
 * Decides, before any tokens are spent, how a chat question is answered:
 *  - 'course':  the question is about this course; send the matching materials.
 *  - 'mixed':   weak match; send a small amount of material and let the model fall back to general knowledge.
 *  - 'general': nothing points at the course; send no course material at all (a plain chat, cheap).
 * Deterministic, based on the retrieval score that selectContext already computed.
 */

import type { RelevanceStats } from '@/types/parser';
import { SIGNAL_SCORE } from './retrieval';
import { analyzeQuery } from './queryAnalysis';

export type AnswerRoute = 'course' | 'mixed' | 'general';

/** Words that say the question is about this particular course or its administration. */
const COURSE_CUES =
  /\b(?:course|cursus|vak|syllabus|studiegids|study guide|docent|teacher|professor|lecturer|instructor|slides?|sheets?|dia'?s?|lecture|college|hoorcollege|werkcollege|hc\s*\d+|wc\s*\d+|tutorial|practicum|assignment|opdracht|inleveren|inlevering|submission|submit|deadline|exam|tentamen|toets|midterm|quiz|grade|grades|cijfers?|beoordeling|rubric|weging|module|brightspace|dropbox|announcement|announcements|aankondiging|mededeling|mededelingen|forum|ects|herkansing|resit|week\s*\d+|hoofdstuk|chapter|paragraaf|spreekuur|office hours?)(?:s|en|n)?\b/i;

/** Mixed-mode context budget (document tokens): enough to catch a related slide, not a whole lecture. */
export const MIXED_TOKEN_BUDGET = 6_000;

/** A best hit this strong means the question names a document or point in the course. */
const NAMED_SCORE = 12;

/** A short reply that only makes sense with the previous answer: "can you elaborate", "waarom?", "ga verder". */
const FOLLOW_UP =
  /\b(?:elaborate|expand(?: on)?|go deeper|more (?:detail|details|depth|info)|in more detail|tell me more|explain (?:that|this|it|further|more)|what do you mean|uitgebreider|meer (?:uitleg|details?|info)|ga (?:door|verder)|leg (?:dat|het|dit) (?:verder |beter |meer )?uit|wat bedoel je)\b/i;
/** A one-word reply ("why?", "waarom?") is a follow-up too; "why is the sky blue" is a new question. */
const ONE_WORD_FOLLOW_UP = /^\s*(?:why|waarom|hoezo|how so|continue|go on|verder|en verder)\s*[?.!]*\s*$/i;

export function isFollowUp(prompt: string): boolean {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  return ONE_WORD_FOLLOW_UP.test(prompt) || (words.length > 0 && words.length <= 8 && FOLLOW_UP.test(prompt));
}

/** The student explicitly asks for depth. */
const DEPTH_WORDS = /\b(?:in detail|detailed|in depth|in-depth|extensive(?:ly)?|comprehensive(?:ly)?|thorough(?:ly)?|uitgebreid|uitgebreide|gedetailleerd|grondig|volledig)\b/i;

/**
 * An instruction added to the question when the student wants more than a short answer: a summary, an
 * explicit request for depth, or "elaborate" on the previous answer. Empty for ordinary questions.
 */
export function answerDepthHint(prompt: string, followUp: boolean): string {
  if (followUp) {
    return (
      'Answer depth: the student asks you to elaborate on your previous answer. Explain that same topic in much more depth: ' +
      'every point it mentioned, with full explanations, examples and details from the materials, structured with headings and bullets. ' +
      'Do not ask which topic is meant: it is the topic of your previous answer.'
    );
  }
  const kind = analyzeQuery(prompt).kind;
  if (kind === 'summary-doc' || kind === 'broad' || DEPTH_WORDS.test(prompt)) {
    return (
      'Answer depth: the student asks for a comprehensive answer. Cover every topic the relevant material treats, in its order, ' +
      'each with a full explanation, examples and the key terms, structured with headings and bullets: a summary a student can study from, ' +
      'never a one-paragraph overview.'
    );
  }
  return '';
}

export function routeQuestion(prompt: string, stats: RelevanceStats | undefined, opts: { followUp?: boolean } = {}): AnswerRoute {
  if (!stats) return 'general';
  if (stats.hasPinned || stats.pointsAtPart) return 'course';
  // "elaborate" on a course answer stays with the course (the retrieval query already includes the earlier questions)
  if (opts.followUp && stats.totalDocuments > 0) return 'course';
  if (COURSE_CUES.test(prompt)) return 'course';

  const best = stats.bestScore ?? 0;
  const matched = stats.bestMatchedTerms ?? 0;
  const terms = stats.queryTermCount ?? 0;
  if (best >= NAMED_SCORE) return 'course';
  // one stray word matching somewhere is noise; several of the question's words in one slide is a hit
  if (best >= SIGNAL_SCORE && (matched >= 2 || (terms > 0 && matched / terms >= 0.5))) return 'course';
  if (best >= SIGNAL_SCORE || matched >= 2) return 'mixed';
  return 'general';
}
