import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponseMessage } from '@/services/backend/messages';
import type { CourseData } from '@/types/brightspace';

const course: CourseData = {
  orgUnitId: '1',
  courseName: 'Test Course',
  fetchedAt: Date.now(),
  schemaVersion: 2,
  overview: { title: 'O', htmlContent: '', textDescription: 'overview' },
  toc: [],
};
const limits = { approved: true, day_cost_cap_eur: 0.5, day_cost_remaining_eur: 0.25 };
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 15)); });

describe('production build: signing out from Settings', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('closes Settings and shows the login screen', async () => {
    vi.stubEnv('VITE_DEV_DIRECT_GEMINI', '');
    vi.resetModules();
    const { BrightspaceAIHelperApp } = await import('@/content/index');
    const shadow = await import('@/content/shadowRoot');
    const client = await import('@/services/backend/client');
    const session = await import('@/services/backend/session');
    localStorage.clear();
    session.sessionStore.reset();
    let signedIn = true;
    client.setTransport(async (msg): Promise<ApiResponseMessage> => {
      if (msg.op === 'session') {
        return signedIn
          ? { ok: true, status: 200, data: { signedIn: true, user: { id: 'u1', email: 'jan@student.nl' }, limits } }
          : { ok: true, status: 200, data: { signedIn: false } };
      }
      if (msg.op === 'auth.logout') signedIn = false;
      return { ok: true, status: 204 };
    });

    const { appContainer } = shadow.createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="backend" initialCourseData={course} />, { container: appContainer });
    await flush();
    await act(async () => { fireEvent.click(within(appContainer).getByTitle(/Instellingen openen/i)); });
    const account = within(appContainer).getByTestId('account-section');
    await act(async () => { fireEvent.click(within(account).getByRole('button', { name: /^Sign out$/ })); });
    await flush();

    expect(within(appContainer).getByTestId('login-view')).toBeDefined();
    expect(within(appContainer).queryByTestId('account-section')).toBeNull();
    shadow.removeShadowRootContainer();
    client.setTransport(null);
  });
});
