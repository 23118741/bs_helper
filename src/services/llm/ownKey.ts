/**
 * src/services/llm/ownKey.ts
 * Whether the signed-in user answers with their own Gemini key. A tiny store so the account bar
 * follows the Settings form without a reload.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { DEV_DIRECT_GEMINI } from '@/services/backend/env';
import { getLLMSettings } from './llmStorage';

let active = false;
const listeners = new Set<() => void>();

function publish(next: boolean): void {
  if (next === active) return;
  active = next;
  listeners.forEach((l) => l());
}

/** Reads the saved settings and updates every subscriber. */
export async function refreshOwnKey(): Promise<void> {
  try {
    const s = await getLLMSettings();
    publish(!DEV_DIRECT_GEMINI && s.useOwnKey === true && (s.geminiApiKey ?? '').trim().length > 0);
  } catch {
    // keep the last known value
  }
}

export function useOwnKeyActive(): boolean {
  useEffect(() => {
    void refreshOwnKey();
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => active,
    () => active
  );
}

/** Test helper. */
export function resetOwnKeyForTests(): void {
  publish(false);
}
