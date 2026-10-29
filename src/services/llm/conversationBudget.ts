/**
 * src/services/llm/conversationBudget.ts
 * How much of the conversation goes along with a question. The whole conversation is sent, newest turns first,
 * within a character budget so a long chat cannot push the request over the server's size limits.
 */

import type { RelatedChat } from '../../../shared/prompts';

export type ChatTurn = { role: 'user' | 'model'; text: string };

/** The current conversation: ~30k tokens. */
export const HISTORY_BUDGET_CHARS = 120_000;
/** One turn (a long answer) at most. */
export const HISTORY_TURN_CHARS = 20_000;
/** The parallel chats together: ~10k tokens; enough to refer back to them. */
export const RELATED_BUDGET_CHARS = 40_000;
const RELATED_TURN_CHARS = 6_000;
/** The server accepts at most this many turns per conversation. */
const MAX_TURNS = 60;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The newest turns that fit the budget, starting with a student turn. */
export function fitHistory(turns: ChatTurn[] | undefined, budget = HISTORY_BUDGET_CHARS, turnChars = HISTORY_TURN_CHARS): ChatTurn[] {
  const out: ChatTurn[] = [];
  let used = 0;
  for (let i = (turns ?? []).length - 1; i >= 0 && out.length < MAX_TURNS; i--) {
    const t = turns![i];
    const text = clip(t.text, turnChars);
    if (used + text.length > budget) break;
    used += text.length;
    out.unshift({ role: t.role, text });
  }
  while (out.length > 0 && out[0].role === 'model') out.shift();
  return out;
}

/** The parallel chats within their shared budget, the newest turns of each chat first. */
export function fitRelatedChats(chats: RelatedChat[] | undefined): RelatedChat[] {
  const usable = (chats ?? []).filter((c) => c.turns.length > 0).slice(0, 10);
  if (usable.length === 0) return [];
  const each = Math.floor(RELATED_BUDGET_CHARS / usable.length);
  return usable
    .map((c) => ({ course: c.course.slice(0, 200), turns: fitHistory(c.turns, each, RELATED_TURN_CHARS) }))
    .filter((c) => c.turns.length > 0);
}

/** Merges consecutive turns of the same role (providers require alternating roles). */
export function alternate(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.text += `\n\n${t.text}`;
    else out.push({ ...t });
  }
  return out;
}
