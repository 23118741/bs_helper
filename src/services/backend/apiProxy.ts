/**
 * src/services/backend/apiProxy.ts
 * Runs inside the service worker: performs the whitelisted API calls, owns the session token
 * (service-worker IndexedDB) and strips it from every reply, so page-side code never sees it.
 */

import { openDB } from 'idb';
import { CLIENT_VERSION_HEADER, type ApiErrorBody, type AuthVerifyResponse, type MeResponse } from '../../../shared/contract';
import type { ApiOp, ApiRequestMessage, ApiResponseMessage, SessionData } from './messages';

export const SESSION_STORAGE_KEY = 'brightspace_ai_session';

export interface ProxyDeps {
  baseUrl: string;
  clientVersion: string;
  fetchImpl: typeof fetch;
  storage: {
    getToken(): Promise<string | null>;
    setToken(token: string): Promise<void>;
    clearToken(): Promise<void>;
  };
  /** Per-request time limit in ms. */
  timeoutMs?: number;
}

interface Route {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  auth: boolean;
}

const ROUTES: Record<Exclude<ApiOp, 'session'>, Route> = {
  'auth.signupStart': { method: 'POST', path: '/v1/auth/signup/start', auth: false },
  'auth.signup': { method: 'POST', path: '/v1/auth/signup', auth: false },
  'auth.resetStart': { method: 'POST', path: '/v1/auth/reset/start', auth: false },
  'auth.reset': { method: 'POST', path: '/v1/auth/reset', auth: false },
  'auth.login': { method: 'POST', path: '/v1/auth/login', auth: false },
  'auth.logout': { method: 'POST', path: '/v1/auth/logout', auth: true },
  'account.delete': { method: 'DELETE', path: '/v1/me', auth: true },
  generate: { method: 'POST', path: '/v1/generate', auth: true },
};

const fail = (status: number, code: ApiErrorBody['code'], message: string): ApiResponseMessage => ({
  ok: false,
  status,
  error: { code, message },
});

/**
 * The token lives in IndexedDB of the service worker (extension origin), which page-side content
 * scripts cannot reach. chrome.storage.local is deliberately NOT used: restricting it to trusted
 * contexts would also lock out the content script, which keeps its settings there.
 */
export function createChromeTokenStorage(): ProxyDeps['storage'] {
  let opened: ReturnType<typeof openDB> | null = null;
  const db = () =>
    (opened ??= openDB('brightspace_ai_session_db', 1, {
      upgrade(d) {
        d.createObjectStore('kv');
      },
    }));
  return {
    async getToken() {
      const v = await (await db()).get('kv', SESSION_STORAGE_KEY);
      return typeof v === 'string' ? v : null;
    },
    async setToken(token) {
      await (await db()).put('kv', token, SESSION_STORAGE_KEY);
    },
    async clearToken() {
      await (await db()).delete('kv', SESSION_STORAGE_KEY);
      // drop any token left in chrome.storage.local by earlier versions
      try {
        await chrome.storage?.local?.remove(SESSION_STORAGE_KEY);
      } catch {
        // ignore
      }
    },
  };
}

export async function handleApiMessage(
  msg: ApiRequestMessage,
  deps: ProxyDeps,
  signal?: AbortSignal
): Promise<ApiResponseMessage> {
  const call = async (method: string, path: string, token: string | null, body?: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 130_000);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const headers: Record<string, string> = { [CLIENT_VERSION_HEADER]: deps.clientVersion };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await deps.fetchImpl(`${deps.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      let data: any = undefined;
      const text = await res.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = undefined;
        }
      }
      return { status: res.status, ok: res.ok, data };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };

  const toResponse = (r: { status: number; ok: boolean; data: any }): ApiResponseMessage =>
    r.ok
      ? { ok: true, status: r.status, data: r.data }
      : {
          ok: false,
          status: r.status,
          error: r.data && typeof r.data.code === 'string' ? (r.data as ApiErrorBody) : { code: 'INTERNAL', message: `Server error (${r.status}).` },
        };

  try {
    if (msg.op === 'session') {
      const token = await deps.storage.getToken();
      if (!token) return { ok: true, status: 200, data: { signedIn: false } satisfies SessionData };
      const r = await call('GET', '/v1/me', token);
      if (r.status === 401) {
        await deps.storage.clearToken();
        return { ok: true, status: 200, data: { signedIn: false } satisfies SessionData };
      }
      if (!r.ok) return toResponse(r);
      return { ok: true, status: 200, data: { signedIn: true, ...(r.data as MeResponse) } satisfies SessionData };
    }

    const route = ROUTES[msg.op];
    if (!route) return fail(400, 'INVALID_REQUEST', 'Unknown operation.');

    let token: string | null = null;
    if (route.auth) {
      token = await deps.storage.getToken();
      if (!token) return fail(401, 'AUTH_REQUIRED', 'You are not signed in.');
    }

    const r = await call(route.method, route.path, token, msg.body);

    // Signing out / deleting succeeds locally even if the server no longer knows the session.
    if ((msg.op === 'auth.logout' || msg.op === 'account.delete') && (r.ok || r.status === 401)) {
      await deps.storage.clearToken();
      return { ok: true, status: 204 };
    }
    if (route.auth && r.status === 401) {
      await deps.storage.clearToken();
      return toResponse(r);
    }
    if ((msg.op === 'auth.signup' || msg.op === 'auth.reset' || msg.op === 'auth.login') && r.ok) {
      const v = r.data as AuthVerifyResponse;
      await deps.storage.setToken(v.token);
      return { ok: true, status: 200, data: { user: v.user } };
    }
    return toResponse(r);
  } catch (err: any) {
    if (signal?.aborted) return fail(0, 'NETWORK', 'Cancelled.');
    if (err?.name === 'AbortError') return fail(0, 'NETWORK', 'The server did not respond in time.');
    return fail(0, 'NETWORK', 'No connection to the server.');
  }
}
