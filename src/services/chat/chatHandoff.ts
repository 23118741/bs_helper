/**
 * src/services/chat/chatHandoff.ts
 * Opening a source from an answer.
 *
 * - A plain click opens the document in the current tab. The page reloads, so the conversation is saved first and
 *   the helper comes back open as a side panel (not full screen) with the same chat.
 * - Ctrl/Cmd/Shift/middle click opens a new tab (the browser default); that tab starts with the helper closed.
 */

import { exportChatSessions, getChatUser, importChatSessions } from './chatSessions';

export const DRAWER_OPEN_KEY = 'brightspace-ai-drawer-open';
export const DRAWER_EXPANDED_KEY = 'brightspace-ai-drawer-expanded';
const HANDOFF_KEY = 'brightspace-ai-chat-handoff';
const NEW_TAB_KEY = 'brightspace-ai-new-tab-closed';
/** A hand-off older than this belongs to some other page load and is ignored. */
const TTL_MS = 20_000;

/** Saves the conversation and the layout for the page that is about to load in this tab. */
export function saveHandoff(): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ ts: Date.now(), owner: getChatUser() ?? null, sessions: exportChatSessions() }));
  } catch {
    // too large or blocked: the document still opens, the chat just starts empty
  }
  try {
    localStorage.setItem(DRAWER_EXPANDED_KEY, '0'); // side panel, so the document stays visible
    localStorage.setItem(DRAWER_OPEN_KEY, '1');
  } catch {
    // ignore
  }
}

/** The tab that is about to open (ctrl/middle click) starts with the helper closed. */
export function markNewTabClosed(): void {
  try {
    localStorage.setItem(NEW_TAB_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

const fresh = (raw: string | null): boolean => {
  const ts = Number(raw);
  return Number.isFinite(ts) && ts > 0 && Date.now() - ts < TTL_MS;
};

let consumed: { open?: boolean } | null = null;

/** Read once per page load: restores a saved conversation, or tells that this page was opened as a new tab. */
export function consumeHandoff(): { open?: boolean } {
  if (consumed) return consumed;
  consumed = {};
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (raw) {
      sessionStorage.removeItem(HANDOFF_KEY);
      const parsed = JSON.parse(raw) as { ts?: number; owner?: string | null; sessions?: Record<string, unknown> };
      if (fresh(String(parsed.ts))) {
        importChatSessions(parsed.sessions ?? {}, parsed.owner); // shown only once that account is signed in
        consumed = { open: true };
        return consumed;
      }
    }
  } catch {
    // unreadable hand-off: ignore
  }
  try {
    const flag = localStorage.getItem(NEW_TAB_KEY);
    if (flag) {
      localStorage.removeItem(NEW_TAB_KEY);
      if (fresh(flag)) consumed = { open: false };
    }
  } catch {
    // ignore
  }
  return consumed;
}

/** Test helper. */
export function resetHandoff(): void {
  consumed = null;
}

/** onClick/onAuxClick handler for a link to a source document. */
export function openSourceLink(e: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: () => void }, url: string): void {
  const plain = e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
  if (!plain) {
    markNewTabClosed(); // the browser opens the new tab
    return;
  }
  e.preventDefault();
  saveHandoff();
  window.location.assign(url);
}
