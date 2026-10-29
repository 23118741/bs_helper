/**
 * server/src/providers/prompt.ts
 * Turns a GenerateRequest into provider-neutral turns. The server (not the client) owns the
 * system prompt, so it can be changed without shipping a new extension version.
 */

import type { GenerateRequest } from '../../../shared/contract.js';
import { formatRelatedChats, systemPromptFor } from '../../../shared/prompts.js';
import type { ProviderTurn } from './types.js';

/** The whole conversation goes along (the extension already keeps it within a character budget). */
export const MAX_HISTORY_TURNS = 60;
export const MAX_HISTORY_TURN_CHARS = 20_000;

export const systemPromptForRequest = (req: GenerateRequest): string => systemPromptFor(req.answer_mode);

/** General mode never uses course context, whatever the client sent. */
const contextOf = (req: GenerateRequest): string | undefined => (req.answer_mode === 'general' ? undefined : req.context_markdown);

const recentHistory = (req: GenerateRequest) =>
  (req.history ?? []).slice(-MAX_HISTORY_TURNS).map((h) => ({ role: h.role, text: h.text.slice(0, MAX_HISTORY_TURN_CHARS) }));

/** Estimated tokens: ~4 characters per token (same heuristic as the extension). */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export function buildTurns(req: GenerateRequest): ProviderTurn[] {
  const turns: ProviderTurn[] = [];
  const push = (role: ProviderTurn['role'], text: string) => {
    const last = turns[turns.length - 1];
    // Providers require alternating roles: merge consecutive turns of the same role.
    if (last && last.role === role) last.text += `\n\n${text}`;
    else turns.push({ role, text });
  };

  const related = formatRelatedChats(req.related_chats);
  if (related) {
    push('user', related);
    push('model', 'Understood.');
  }
  const context = contextOf(req);
  if (context && context.trim()) {
    push('user', `Course context from Brightspace:\n\n${context}`);
    push('model', 'Understood.');
  }
  for (const h of recentHistory(req)) push(h.role, h.text);
  push('user', req.question);
  return turns;
}

export function estimateInputTokens(req: GenerateRequest): number {
  const chars =
    systemPromptForRequest(req).length +
    (contextOf(req)?.length ?? 0) +
    req.question.length +
    (formatRelatedChats(req.related_chats)?.length ?? 0) +
    recentHistory(req).reduce((sum, h) => sum + h.text.length, 0);
  return Math.ceil(chars / 4);
}
