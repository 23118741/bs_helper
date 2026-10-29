/**
 * src/services/backend/session.ts
 * Small external store with the login state and the remaining budget, shared by the UI and the
 * LLM gateway (which refreshes the budget after every answer).
 */

import { useSyncExternalStore } from 'react';
import type { AuthUser, LimitsInfo } from '../../../shared/contract';
import { BackendError, callApi } from './client';
import type { SessionData, VerifyData } from './messages';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  limits: LimitsInfo | null;
}

let state: SessionState = { status: 'loading', user: null, limits: null };
const listeners = new Set<() => void>();

function set(next: Partial<SessionState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const sessionStore = {
  get: (): SessionState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Used after each answer: the server reports the remaining budget. */
  setLimits(limits: LimitsInfo): void {
    set({ limits });
  },
  /** Called when any call reports AUTH_REQUIRED. */
  markSignedOut(): void {
    set({ status: 'signedOut', user: null, limits: null });
  },
  reset(): void {
    state = { status: 'loading', user: null, limits: null };
    listeners.forEach((l) => l());
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
}

export async function refreshSession(): Promise<void> {
  try {
    const s = await callApi<SessionData>('session');
    if (s.signedIn) set({ status: 'signedIn', user: s.user, limits: s.limits });
    else sessionStore.markSignedOut();
  } catch (err) {
    // Server unreachable: keep the UI usable for sign-in attempts and show the error there.
    if (err instanceof BackendError && err.code === 'NETWORK') sessionStore.markSignedOut();
    else throw err;
  }
}

/** Sign-up step 1: the server emails a sign-up code. */
export async function startSignup(email: string): Promise<void> {
  await callApi('auth.signupStart', { email });
}

/** Sign-up step 2: the code proves the address, the password is for every later sign-in. */
export async function completeSignup(email: string, code: string, password: string): Promise<void> {
  const v = await callApi<VerifyData>('auth.signup', { email, code, password });
  set({ status: 'signedIn', user: v.user });
  await refreshSession().catch(() => undefined); // fetch the budget
}

/** Forgot password, step 1: the server emails a reset code (only when the address has an account). */
export async function startPasswordReset(email: string): Promise<void> {
  await callApi('auth.resetStart', { email });
}

/** Forgot password, step 2: sets the new password and signs in (every other device is signed out). */
export async function completePasswordReset(email: string, code: string, password: string): Promise<void> {
  const v = await callApi<VerifyData>('auth.reset', { email, code, password });
  set({ status: 'signedIn', user: v.user });
  await refreshSession().catch(() => undefined);
}

export async function passwordLogin(email: string, password: string): Promise<void> {
  const v = await callApi<VerifyData>('auth.login', { email, password });
  set({ status: 'signedIn', user: v.user });
  await refreshSession().catch(() => undefined);
}

export async function logout(): Promise<void> {
  await callApi('auth.logout').catch(() => undefined);
  sessionStore.markSignedOut();
}

export async function deleteAccount(): Promise<void> {
  await callApi('account.delete');
  sessionStore.markSignedOut();
}
