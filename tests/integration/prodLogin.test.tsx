import { act, cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe('production build (no direct Gemini): login is reachable without initialMode', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('shows the login view when signed out', async () => {
    vi.stubEnv('VITE_DEV_DIRECT_GEMINI', '');
    vi.resetModules();
    const { BrightspaceAIHelperApp } = await import('@/content/index');
    const { createShadowRootContainer } = await import('@/content/shadowRoot');
    const { setTransport } = await import('@/services/backend/client');
    const { sessionStore } = await import('@/services/backend/session');
    sessionStore.reset();
    setTransport(async (msg) =>
      msg.op === 'session' ? { ok: true, status: 200, data: { signedIn: false } } : { ok: false, status: 400, error: { code: 'INVALID_REQUEST', message: 'x' } }
    );
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} />, { container: appContainer });
    await flush();
    await flush();
    expect(within(appContainer).queryByTestId('login-view')).not.toBeNull();
  });
});
