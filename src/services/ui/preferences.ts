/**
 * src/services/ui/preferences.ts
 * Small UI preferences kept in chrome.storage.local (localStorage as fallback): currently the
 * keyboard shortcut that opens and closes the assistant.
 */

import { useSyncExternalStore } from 'react';

export const HOTKEY_OPTIONS = [
  { id: 'Alt+B', label: 'Alt + B (default)' },
  { id: 'Alt+Shift+B', label: 'Alt + Shift + B' },
  { id: 'Alt+J', label: 'Alt + J' },
  { id: 'Alt+K', label: 'Alt + K' },
  { id: 'off', label: 'Disabled' },
] as const;

export type HotkeyId = (typeof HOTKEY_OPTIONS)[number]['id'];

export const DEFAULT_HOTKEY: HotkeyId = 'Alt+B';
const STORAGE_KEY = 'brightspace_ai_hotkey';

let current: HotkeyId = DEFAULT_HOTKEY;
const listeners = new Set<() => void>();

const isHotkeyId = (v: unknown): v is HotkeyId => HOTKEY_OPTIONS.some((o) => o.id === v);

function publish(next: HotkeyId): void {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

export const getHotkey = (): HotkeyId => current;

export function hotkeyLabel(id: HotkeyId = current): string {
  return id === 'off' ? '' : id.split('+').join(' + ');
}

export async function loadHotkey(): Promise<HotkeyId> {
  try {
    let stored: unknown;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    } else {
      stored = localStorage.getItem(STORAGE_KEY);
    }
    if (isHotkeyId(stored)) publish(stored);
  } catch {
    // keep the default
  }
  return current;
}

export async function setHotkey(id: HotkeyId): Promise<void> {
  publish(id);
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: id });
    } else {
      localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    // preference only lasts for this page then
  }
}

/** Test helper. */
export function resetHotkeyForTests(): void {
  current = DEFAULT_HOTKEY;
  listeners.forEach((l) => l());
}

export function useHotkey(): HotkeyId {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getHotkey,
    getHotkey
  );
}

/** True when the keyboard event is exactly the chosen shortcut (Alt/Shift/Ctrl must match). */
export function matchesHotkey(e: KeyboardEvent, id: HotkeyId = current): boolean {
  if (id === 'off') return false;
  const parts = id.split('+');
  const letter = parts[parts.length - 1];
  const wantAlt = parts.includes('Alt');
  const wantShift = parts.includes('Shift');
  const wantCtrl = parts.includes('Ctrl');
  if (e.altKey !== wantAlt || e.shiftKey !== wantShift || e.ctrlKey !== wantCtrl || e.metaKey) return false;
  // `code` is layout-independent and survives Alt-produced characters (macOS); `key` is the fallback.
  return e.code === `Key${letter}` || (e.key ?? '').toLowerCase() === letter.toLowerCase();
}
