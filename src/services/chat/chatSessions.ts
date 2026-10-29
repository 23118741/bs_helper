/**
 * src/services/chat/chatSessions.ts
 * Chat state per course for the rest of the session (in memory). Tools keep their state here
 * instead of in component state, so switching course unmounts the tool but not the conversation:
 * the chat is still there when the student comes back, and a running answer keeps landing in the
 * right conversation. Courses that have a chat show up as closable tabs in the header.
 *
 * Usage in a tool:  const [messages, setMessages] = useSessionState(courseId, 'mytool.messages', []);
 * A course gets a tab as soon as it has a conversation (keys ending in ".messages" or ".turns"),
 * a running request (".busy", also shown as a dot on the tab) or an attached file (".attachments").
 *
 * Chats belong to the signed-in account: switching account (setChatUser) puts the current chats aside for that
 * account and brings back the chats of the new one, so nobody sees another account's conversations.
 */

import { useCallback, useSyncExternalStore } from 'react';

const values = new Map<string, unknown>();
const refs = new Map<string, { current: unknown }>();
const listeners = new Set<() => void>();
/** Goes up on every account switch: a setter from before the switch (e.g. a late answer) no longer writes. */
let generation = 0;

const key = (scope: string, name: string) => `${scope}::${name}`;
const isConversationKey = (k: string) => k.endsWith('.messages') || k.endsWith('.turns');
const isBusyKey = (k: string) => k.endsWith('.busy');
const isAttachmentKey = (k: string) => k.endsWith('.attachments');

export interface ChatTab {
  id: string;
  name: string;
  hasChat: boolean;
  busy: boolean;
}

let order: string[] = [];
const names = new Map<string, string>();
let tabsCache: ChatTab[] = [];

function scopeHasChat(scope: string): boolean {
  for (const [k, v] of values) {
    if (!k.startsWith(`${scope}::`)) continue;
    if ((isConversationKey(k) || isAttachmentKey(k)) && Array.isArray(v) && v.length > 0) return true;
    if (isBusyKey(k) && v === true) return true;
  }
  return false;
}

function scopeIsBusy(scope: string): boolean {
  for (const [k, v] of values) {
    if (k.startsWith(`${scope}::`) && isBusyKey(k) && v === true) return true;
  }
  return false;
}

function recomputeTabs(): void {
  const next = order.map((id) => ({
    id,
    name: names.get(id) ?? id,
    hasChat: scopeHasChat(id),
    busy: scopeIsBusy(id),
  }));
  const same =
    next.length === tabsCache.length &&
    next.every((t, i) => {
      const o = tabsCache[i];
      return o.id === t.id && o.name === t.name && o.hasChat === t.hasChat && o.busy === t.busy;
    });
  if (!same) tabsCache = next;
}

function emit(): void {
  recomputeTabs();
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function read<T>(k: string, initial: T): T {
  if (!values.has(k)) values.set(k, initial); // keeps the snapshot stable for useSyncExternalStore
  return values.get(k) as T;
}

/** Like useState, but the value lives per (scope, name) for the whole session and survives unmounting. */
export function useSessionState<T>(scope: string, name: string, initial: T): [T, (u: T | ((prev: T) => T)) => void] {
  const k = key(scope, name);
  const value = useSyncExternalStore(subscribe, () => read(k, initial), () => read(k, initial));
  const gen = generation;
  const set = useCallback(
    (u: T | ((prev: T) => T)) => {
      if (gen !== generation) return; // belongs to the account that was signed in before
      const prev = read(k, initial);
      const next = typeof u === 'function' ? (u as (p: T) => T)(prev) : u;
      if (Object.is(prev, next)) return;
      values.set(k, next);
      emit();
    },
    // `initial` only matters for the very first read
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k, gen]
  );
  return [value, set];
}

/** A mutable box per (scope, name), e.g. the AbortController of a running request. */
export function useSessionRef<T>(scope: string, name: string, initial: T): { current: T } {
  const k = key(scope, name);
  if (!refs.has(k)) refs.set(k, { current: initial });
  return refs.get(k) as { current: T };
}

/** Tabs: the active course plus every other course that has a conversation. */
let activeCourse: { id: string; name: string } | null = null;

export function registerActiveCourse(id: string, name: string): void {
  activeCourse = { id, name };
  names.set(id, name);
  if (!order.includes(id)) order.push(id);
  // courses that were only looked at (no conversation) do not stay as tabs
  order = order.filter((c) => c === id || scopeHasChat(c));
  for (const known of [...names.keys()]) if (!order.includes(known)) names.delete(known);
  emit();
}

/** The conversations of the other open tabs (parallel chats), with the course name, oldest tab first. */
export function otherConversations<T>(scope: string, name: string): Array<{ id: string; name: string; turns: T[] }> {
  const out: Array<{ id: string; name: string; turns: T[] }> = [];
  for (const id of order) {
    if (id === scope) continue;
    const turns = values.get(key(id, name));
    if (Array.isArray(turns) && turns.length > 0) out.push({ id, name: names.get(id) ?? id, turns: turns as T[] });
  }
  return out;
}

export function useChatTabs(): ChatTab[] {
  return useSyncExternalStore(subscribe, () => tabsCache, () => tabsCache);
}

/** Closes a course's chat: stops anything still running and forgets the conversation. */
export function closeChatTab(id: string): void {
  const prefix = `${id}::`;
  for (const [k, r] of refs) {
    if (!k.startsWith(prefix)) continue;
    const ctl = r.current as { abort?: () => void } | null;
    if (ctl && typeof ctl.abort === 'function') ctl.abort();
    refs.delete(k);
  }
  for (const k of [...values.keys()]) if (k.startsWith(prefix)) values.delete(k);
  order = order.filter((c) => c !== id);
  names.delete(id);
  emit();
}

/** What survives a page load: the conversations and their draft input (not running requests or errors). */
const isPersistentKey = (k: string) => /\.(turns|messages|input)$/.test(k);

// ---------------------------------------------------------------------------
// Chats per account

interface Stashed {
  values: Map<string, unknown>;
  order: string[];
  names: Map<string, string>;
}

/** undefined: not known yet (or a build without accounts); null: signed out. */
let currentUser: string | null | undefined = undefined;
const stash = new Map<string, Stashed>();

export const getChatUser = (): string | null | undefined => currentUser;

function abortRunning(): void {
  for (const r of refs.values()) {
    const ctl = r.current as { abort?: () => void } | null;
    if (ctl && typeof ctl.abort === 'function') ctl.abort();
  }
  refs.clear();
}

/**
 * Switches the chats to another account (null = signed out). The current account's conversations are put aside and
 * come back when it signs in again in this tab; requests that are still running are stopped.
 */
export function setChatUser(id: string | null): void {
  if (id === currentUser) return;
  generation++;
  abortRunning();
  if (currentUser) {
    const kept = new Map([...values].filter(([k]) => isPersistentKey(k)));
    stash.set(currentUser, { values: kept, order: [...order], names: new Map(names) });
  }
  values.clear();
  order = [];
  names.clear();
  const restored = id ? stash.get(id) : undefined;
  if (id && restored) {
    stash.delete(id);
    for (const [k, v] of restored.values) values.set(k, v);
    order = restored.order.filter((c) => scopeHasChat(c));
    for (const c of order) names.set(c, restored.names.get(c) ?? c);
  }
  currentUser = id;
  if (activeCourse) registerActiveCourse(activeCourse.id, activeCourse.name);
  else emit();
}

export function exportChatSessions(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of values) if (isPersistentKey(k)) out[k] = v;
  return out;
}

/**
 * Puts exported conversations back (after a page load); existing values are replaced. With an owner, they only show
 * once that account is signed in (setChatUser), never for another account.
 */
export function importChatSessions(snapshot: Record<string, unknown>, owner?: string | null): void {
  const entries = Object.entries(snapshot ?? {}).filter(([k]) => isPersistentKey(k));
  if (owner && owner !== currentUser) {
    const kept = stash.get(owner) ?? { values: new Map(), order: [], names: new Map() };
    for (const [k, v] of entries) kept.values.set(k, v);
    kept.order = [...new Set(entries.map(([k]) => k.split('::')[0]))];
    stash.set(owner, kept);
    return;
  }
  for (const [k, v] of entries) values.set(k, v);
  emit();
}

/** Test helper. */
export function resetChatSessions(): void {
  values.clear();
  refs.clear();
  order = [];
  names.clear();
  tabsCache = [];
  stash.clear();
  currentUser = undefined;
  activeCourse = null;
  listeners.forEach((l) => l());
}
