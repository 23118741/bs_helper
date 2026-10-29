/**
 * src/services/llm/llmUtils.ts
 * Small provider-independent helpers shared by the LLM mode runners.
 */

import { CourseContextBundle } from '@/types/parser';
import type { LLMResponse, LLMUsage } from '@/types/llm';

/**
 * Summarizes the contents of the context bundle for quick inspection.
 */
export function generateContextSummary(bundle?: CourseContextBundle): string {
  if (!bundle) return 'No course context attached';
  const parts: string[] = [];
  if (bundle.courseInfo?.courseName) {
    parts.push(`Course: "${bundle.courseInfo.courseName}"`);
  }
  if (bundle.documents && bundle.documents.length > 0) {
    parts.push(`${bundle.documents.length} document(s)`);
  }
  if (bundle.announcements && bundle.announcements.length > 0) {
    parts.push(`${bundle.announcements.length} announcement(s)`);
  }
  if (bundle.assignments && bundle.assignments.length > 0) {
    parts.push(`${bundle.assignments.length} assignment(s)`);
  }
  if (bundle.quizzes && bundle.quizzes.length > 0) {
    parts.push(`${bundle.quizzes.length} quiz(zes)`);
  }
  if (bundle.calendar && bundle.calendar.length > 0) {
    parts.push(`${bundle.calendar.length} calendar event(s)`);
  }
  if (bundle.grades && bundle.grades.length > 0) {
    parts.push(`${bundle.grades.length} grade item(s)`);
  }
  return parts.length > 0 ? parts.join(', ') : 'Empty course bundle';
}

/**
 * Fast token estimation heuristic: ~4 characters per token
 */
export function estimateTokenCount(text: string): number {
  if (typeof text !== 'string' || !text) return 0;
  return Math.ceil(text.length / 4);
}

/** Input and output tokens of several requests added up (undefined when none of them reported usage). */
export function sumUsage(responses: Array<Pick<LLMResponse, 'usage'> | undefined>): LLMUsage | undefined {
  const reported = responses.filter((r) => r?.usage?.promptTokens !== undefined || r?.usage?.candidateTokens !== undefined);
  if (reported.length === 0) return undefined;
  const promptTokens = reported.reduce((n, r) => n + (r!.usage!.promptTokens ?? 0), 0);
  const candidateTokens = reported.reduce((n, r) => n + (r!.usage!.candidateTokens ?? 0), 0);
  return { promptTokens, candidateTokens, totalTokens: promptTokens + candidateTokens };
}
