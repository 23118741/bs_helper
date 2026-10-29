import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApiMessage, type ProxyDeps } from '@/services/backend/apiProxy';
import { BackendError, callApi, setTransport } from '@/services/backend/client';
import { API_MESSAGE_TYPE, type ApiOp, type ApiRequestMessage } from '@/services/backend/messages';

const msg = (op: ApiOp, body?: unknown): ApiRequestMessage => ({ type: API_MESSAGE_TYPE, op, body });

function makeDeps(responses: Array<{ status: number; body?: unknown } | Error>, token: string | null = null) {
  const store = { token };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue = [...responses];
  const deps: ProxyDeps = {
    baseUrl: 'https://api.test',
    clientVersion: '1.2.3',
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error('unexpected fetch');
      if (next instanceof Error) throw next;
      return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
    }) as unknown as typeof fetch,
    storage: {
      getToken: async () => store.token,
      setToken: async (t) => void (store.token = t),
      clearToken: async () => void (store.token = null),
    },
  };
  return { deps, store, calls };
}

describe('service worker API proxy', () => {
  it('stores the token on sign-up and never returns it to the page', async () => {
    const { deps, store, calls } = makeDeps([{ status: 200, body: { token: 'SECRET', user: { id: 'u1', email: 'a@b.nl' } } }]);
    const res = await handleApiMessage(msg('auth.signup', { email: 'a@b.nl', code: '123456', password: 'long-enough-1' }), deps);
    expect(res).toEqual({ ok: true, status: 200, data: { user: { id: 'u1', email: 'a@b.nl' } } });
    expect(JSON.stringify(res)).not.toContain('SECRET');
    expect(store.token).toBe('SECRET');
    expect(calls[0].url).toBe('https://api.test/v1/auth/signup');
    expect((calls[0].init.headers as any)['x-client-version']).toBe('1.2.3');
  });

  it('stores the token after a password reset and never returns it to the page', async () => {
    const { deps, store, calls } = makeDeps([{ status: 200, body: { token: 'SECRET3', user: { id: 'u1', email: 'a@b.nl' } } }]);
    const res = await handleApiMessage(msg('auth.reset', { email: 'a@b.nl', code: '123456', password: 'long-enough-1' }), deps);
    expect(res).toEqual({ ok: true, status: 200, data: { user: { id: 'u1', email: 'a@b.nl' } } });
    expect(store.token).toBe('SECRET3');
    expect(calls[0].url).toBe('https://api.test/v1/auth/reset');
  });

  it('stores the token on password login and never returns it to the page', async () => {
    const { deps, store, calls } = makeDeps([{ status: 200, body: { token: 'SECRET2', user: { id: 'u1', email: 'a@b.nl' } } }]);
    const res = await handleApiMessage(msg('auth.login', { email: 'a@b.nl', password: 'correct-horse-9' }), deps);
    expect(res).toEqual({ ok: true, status: 200, data: { user: { id: 'u1', email: 'a@b.nl' } } });
    expect(JSON.stringify(res)).not.toContain('SECRET2');
    expect(store.token).toBe('SECRET2');
    expect(calls[0].url).toBe('https://api.test/v1/auth/login');
  });

  it('sends the bearer token on authenticated calls and refuses without one (no network)', async () => {
    const none = makeDeps([]);
    const r = await handleApiMessage(msg('generate', { q: 1 }), none.deps);
    expect(r).toMatchObject({ ok: false, status: 401, error: { code: 'AUTH_REQUIRED' } });
    expect(none.calls).toHaveLength(0);

    const { deps, calls } = makeDeps([{ status: 200, body: { text: 'hi' } }], 'TOK');
    const ok = await handleApiMessage(msg('generate', { q: 1 }), deps);
    expect(ok).toEqual({ ok: true, status: 200, data: { text: 'hi' } });
    expect((calls[0].init.headers as any).authorization).toBe('Bearer TOK');
    expect(calls[0].init.method).toBe('POST');
  });

  it('clears the token when the server answers 401', async () => {
    const { deps, store } = makeDeps([{ status: 401, body: { code: 'AUTH_REQUIRED', message: 'expired' } }], 'OLD');
    const r = await handleApiMessage(msg('generate', {}), deps);
    expect(r).toMatchObject({ ok: false, status: 401, error: { code: 'AUTH_REQUIRED' } });
    expect(store.token).toBeNull();
  });

  it('passes API errors (with retry_after) through unchanged', async () => {
    const { deps } = makeDeps([{ status: 429, body: { code: 'DAILY_LIMIT', message: 'x', retry_after: 3600 } }], 'T');
    const r = await handleApiMessage(msg('generate', {}), deps);
    expect(r.error).toMatchObject({ code: 'DAILY_LIMIT', retry_after: 3600 });
  });

  it('session: signedOut without token, signedIn with /me data, signedOut after 401', async () => {
    expect((await handleApiMessage(msg('session'), makeDeps([]).deps)).data).toEqual({ signedIn: false });

    const me = { user: { id: 'u', email: 'a@b.nl' }, limits: { day_cost_cap_eur: 0.5 } };
    const a = makeDeps([{ status: 200, body: me }], 'T');
    expect((await handleApiMessage(msg('session'), a.deps)).data).toMatchObject({ signedIn: true, user: me.user });

    const b = makeDeps([{ status: 401, body: { code: 'AUTH_REQUIRED', message: '' } }], 'T');
    expect((await handleApiMessage(msg('session'), b.deps)).data).toEqual({ signedIn: false });
    expect(b.store.token).toBeNull();
  });

  it('logout and account deletion clear the local token even when the server says 401', async () => {
    for (const op of ['auth.logout', 'account.delete'] as const) {
      const { deps, store } = makeDeps([{ status: 401, body: { code: 'AUTH_REQUIRED', message: '' } }], 'T');
      const r = await handleApiMessage(msg(op), deps);
      expect(r.ok).toBe(true);
      expect(store.token).toBeNull();
    }
  });

  it('maps network failures, timeouts and aborts to NETWORK errors', async () => {
    const down = makeDeps([new TypeError('Failed to fetch')], 'T');
    expect(await handleApiMessage(msg('generate', {}), down.deps)).toMatchObject({ ok: false, error: { code: 'NETWORK' } });

    const controller = new AbortController();
    controller.abort();
    const aborted = makeDeps([Object.assign(new Error('x'), { name: 'AbortError' })], 'T');
    expect(await handleApiMessage(msg('generate', {}), aborted.deps, controller.signal)).toMatchObject({ error: { message: 'Cancelled.' } });
  });

  it('rejects unknown operations', async () => {
    const r = await handleApiMessage(msg('delete.everything' as ApiOp), makeDeps([]).deps);
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });
});

describe('content-script client', () => {
  beforeEach(() => setTransport(null));

  it('throws BackendError with code, status and retry-after', async () => {
    setTransport(async () => ({ ok: false, status: 429, error: { code: 'RATE_LIMITED', message: 'slow', retry_after: 12 } }));
    await expect(callApi('generate', {})).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfter: 12 });
  });

  it('returns data on success and forwards the abort signal', async () => {
    const seen = vi.fn();
    setTransport(async (_m, signal) => {
      seen(signal);
      return { ok: true, status: 200, data: { hello: 'world' } };
    });
    const ctl = new AbortController();
    await expect(callApi('generate', {}, ctl.signal)).resolves.toEqual({ hello: 'world' });
    expect(seen).toHaveBeenCalledWith(ctl.signal);
  });

  it('outside the extension (no chrome.runtime) it fails clearly instead of calling the network', async () => {
    await expect(callApi('session')).rejects.toBeInstanceOf(BackendError);
  });
});
