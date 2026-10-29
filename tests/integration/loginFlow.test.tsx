import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrightspaceAIHelperApp } from '@/content/index';
import { createShadowRootContainer, removeShadowRootContainer, SHADOW_HOST_ID } from '@/content/shadowRoot';
import { setTransport } from '@/services/backend/client';
import { sessionStore } from '@/services/backend/session';
import type { ApiRequestMessage, ApiResponseMessage } from '@/services/backend/messages';
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

describe('login gate (backend mode)', () => {
  let calls: ApiRequestMessage[];
  let signedIn: boolean;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    removeShadowRootContainer();
    document.getElementById(SHADOW_HOST_ID)?.remove();
    sessionStore.reset();
    calls = [];
    signedIn = false;
    setTransport(async (msg): Promise<ApiResponseMessage> => {
      calls.push(msg);
      switch (msg.op) {
        case 'session':
          return signedIn
            ? { ok: true, status: 200, data: { signedIn: true, user: { id: 'u1', email: 'jan@student.nl' }, limits } }
            : { ok: true, status: 200, data: { signedIn: false } };
        case 'auth.signupStart':
        case 'auth.resetStart':
          return { ok: true, status: 204 };
        case 'auth.reset': {
          const body = msg.body as { code: string };
          if (body.code !== '654321') return { ok: false, status: 401, error: { code: 'INVALID_CODE', message: 'bad' } };
          signedIn = true;
          return { ok: true, status: 200, data: { user: { id: 'u1', email: 'jan@student.nl' } } };
        }
        case 'auth.login': {
          const body = msg.body as { email: string; password: string };
          if (body.email !== 'jan@student.nl' || body.password !== 'correct-horse-9') {
            return { ok: false, status: 401, error: { code: 'INVALID_CODE', message: 'bad' } };
          }
          signedIn = true;
          return { ok: true, status: 200, data: { user: { id: 'u1', email: 'jan@student.nl' } } };
        }
        case 'auth.signup': {
          const body = msg.body as { email: string; code: string };
          if (body.email === 'taken@student.nl') return { ok: false, status: 409, error: { code: 'ACCOUNT_EXISTS', message: 'exists' } };
          if (body.code !== '123456') return { ok: false, status: 401, error: { code: 'INVALID_CODE', message: 'bad' } };
          signedIn = true;
          return { ok: true, status: 200, data: { user: { id: 'u1', email: 'jan@student.nl' } } };
        }
        case 'auth.logout':
          signedIn = false;
          return { ok: true, status: 204 };
        default:
          return { ok: false, status: 400, error: { code: 'INVALID_REQUEST', message: 'x' } };
      }
    });
  });

  afterEach(() => {
    cleanup();
    removeShadowRootContainer();
    setTransport(null);
    vi.restoreAllMocks();
  });

  it('signs in with email and password only, and a wrong password is explained', async () => {
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="backend" initialCourseData={course} />, { container: appContainer });
    await flush();

    // signed out: the sign-in form (email + password), no workspace and no email-code login
    const login = within(appContainer).getByTestId('login-view');
    expect(within(appContainer).queryByText('Quick Course Guide')).toBeNull();
    expect(within(login).queryByRole('button', { name: /Send code/i })).toBeNull();

    fireEvent.change(within(login).getByLabelText(/Email address/i), { target: { value: 'jan@student.nl' } });
    fireEvent.change(within(login).getByLabelText(/^Password/i), { target: { value: 'wrong-password' } });
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /^Sign in$/i })); });
    await flush();
    expect(within(login).getByRole('alert').textContent).toMatch(/email or password is incorrect/i);

    fireEvent.change(within(login).getByLabelText(/^Password/i), { target: { value: 'correct-horse-9' } });
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /^Sign in$/i })); });
    await flush();
    expect(within(appContainer).queryByTestId('login-view')).toBeNull();
    expect(within(appContainer).getByTestId('account-bar').textContent).toContain('jan@student.nl');
    expect(within(appContainer).getByTestId('account-bar').textContent).toContain('50% left today');
    expect(within(appContainer).getByText('Quick Course Guide')).toBeDefined();
  });

  it('a first-time user signs up with the emailed code and a password', async () => {
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="backend" initialCourseData={course} />, { container: appContainer });
    await flush();

    const login = within(appContainer).getByTestId('login-view');
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /Create an account/i })); });
    fireEvent.change(within(login).getByLabelText(/Email address/i), { target: { value: 'jan@student.nl' } });
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /Send sign-up code/i })); });
    await flush();
    expect(calls.find((c) => c.op === 'auth.signupStart')?.body).toEqual({ email: 'jan@student.nl' });
    expect(within(login).getByText(/6-digit sign-up code/i)).toBeDefined();

    // passwords that do not match never reach the server
    fireEvent.change(within(login).getByLabelText(/Sign-up code/i), { target: { value: '123456' } });
    fireEvent.change(within(login).getByLabelText(/Choose a password/i), { target: { value: 'my-password-1' } });
    fireEvent.change(within(login).getByLabelText(/Repeat password/i), { target: { value: 'my-password-2' } });
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /Create account/i })); });
    expect(within(login).getByRole('alert').textContent).toMatch(/do not match/i);
    expect(calls.some((c) => c.op === 'auth.signup')).toBe(false);

    // wrong code, then the right one
    fireEvent.change(within(login).getByLabelText(/Repeat password/i), { target: { value: 'my-password-1' } });
    fireEvent.change(within(login).getByLabelText(/Sign-up code/i), { target: { value: '000000' } });
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /Create account/i })); });
    await flush();
    expect(within(login).getByRole('alert').textContent).toMatch(/incorrect or has expired/i);

    fireEvent.change(within(login).getByLabelText(/Sign-up code/i), { target: { value: '123456' } });
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /Create account/i })); });
    await flush();
    expect(calls.filter((c) => c.op === 'auth.signup').at(-1)?.body).toEqual({ email: 'jan@student.nl', code: '123456', password: 'my-password-1' });
    expect(within(appContainer).queryByTestId('login-view')).toBeNull();
    expect(within(appContainer).getByTestId('account-bar').textContent).toContain('jan@student.nl');
  });

  it('forgot password: emails a reset code, sets the new password and signs in', async () => {
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="backend" initialCourseData={course} />, { container: appContainer });
    await flush();

    const login = within(appContainer).getByTestId('login-view');
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /Forgot password/i })); });
    expect(within(login).getByText(/Reset your password/i)).toBeDefined();
    fireEvent.change(within(login).getByLabelText(/Email address/i), { target: { value: 'jan@student.nl' } });
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /Send reset code/i })); });
    await flush();
    expect(calls.find((c) => c.op === 'auth.resetStart')?.body).toEqual({ email: 'jan@student.nl' });

    fireEvent.change(within(login).getByLabelText(/Reset code/i), { target: { value: '654321' } });
    fireEvent.change(within(login).getByLabelText(/New password/i), { target: { value: 'new-password-5' } });
    fireEvent.change(within(login).getByLabelText(/Repeat password/i), { target: { value: 'new-password-5' } });
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /Set new password/i })); });
    await flush();
    expect(calls.find((c) => c.op === 'auth.reset')?.body).toEqual({ email: 'jan@student.nl', code: '654321', password: 'new-password-5' });
    expect(within(appContainer).queryByTestId('login-view')).toBeNull();
    expect(within(appContainer).getByTestId('account-bar').textContent).toContain('jan@student.nl');
  });

  it('signing up with an address that already has an account sends the user to sign in', async () => {
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="backend" initialCourseData={course} />, { container: appContainer });
    await flush();

    const login = within(appContainer).getByTestId('login-view');
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /Create an account/i })); });
    fireEvent.change(within(login).getByLabelText(/Email address/i), { target: { value: 'taken@student.nl' } });
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /Send sign-up code/i })); });
    await flush();
    fireEvent.change(within(login).getByLabelText(/Sign-up code/i), { target: { value: '123456' } });
    fireEvent.change(within(login).getByLabelText(/Choose a password/i), { target: { value: 'my-password-1' } });
    fireEvent.change(within(login).getByLabelText(/Repeat password/i), { target: { value: 'my-password-1' } });
    await act(async () => { fireEvent.click(within(login).getByRole('button', { name: /Create account/i })); });
    await flush();

    expect(within(login).getByRole('alert').textContent).toMatch(/already have an account/i);
    expect(within(login).getByRole('button', { name: /^Sign in$/i })).toBeDefined();
    expect((within(login).getByLabelText(/Email address/i) as HTMLInputElement).value).toBe('taken@student.nl');
  });

  it('goes straight to the workspace when a session already exists, and logging out returns to login', async () => {
    signedIn = true;
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="backend" initialCourseData={course} />, { container: appContainer });
    await flush();
    expect(within(appContainer).queryByTestId('login-view')).toBeNull();
    expect(within(appContainer).getByText('Quick Course Guide')).toBeDefined();

    await act(async () => { fireEvent.click(within(appContainer).getByTitle('Sign out')); });
    await flush();
    expect(within(appContainer).getByTestId('login-view')).toBeDefined();
    expect(calls.some((c) => c.op === 'auth.logout')).toBe(true);
  });

  it('full screen: no course/sync strip, and the account bar takes its own room above the workspace', async () => {
    signedIn = true;
    localStorage.setItem('brightspace-ai-drawer-expanded', '1');
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="backend" initialCourseData={course} />, { container: appContainer });
    await flush();
    expect(within(appContainer).queryByText(/Gesynchroniseerd/)).toBeNull();
    const bar = within(appContainer).getByTestId('account-bar');
    expect(bar.className).toContain('flex-shrink-0');
    // the workspace fills what is left instead of a full height of its own (which pushed its bottom off screen)
    const workspace = bar.nextElementSibling as HTMLElement;
    expect(workspace.className).toContain('flex-1');
    expect(workspace.className).not.toContain('h-full');
  });

  it('shows "Waiting for approval" instead of a budget bar until the owner approves the address', async () => {
    const base = (await import('@/services/backend/client')) as any;
    base.setTransport(async (msg: ApiRequestMessage): Promise<ApiResponseMessage> =>
      msg.op === 'session'
        ? { ok: true, status: 200, data: { signedIn: true, user: { id: 'u1', email: 'new@student.nl' }, limits: { approved: false, day_cost_cap_eur: 0, day_cost_remaining_eur: 0 } } }
        : { ok: true, status: 204 }
    );
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="backend" initialCourseData={course} />, { container: appContainer });
    await flush();
    const bar = within(appContainer).getByTestId('account-bar');
    expect(within(bar).getByTestId('awaiting-approval').textContent).toMatch(/waiting for approval/i);
    expect(bar.textContent).not.toMatch(/% left today/);
  });

  it('never exposes the session token to the page-side code', async () => {
    signedIn = true;
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="backend" initialCourseData={course} />, { container: appContainer });
    await flush();
    expect(JSON.stringify(sessionStore.get())).not.toMatch(/token/i);
  });

  it('answers a preset through the backend, books the budget and shows an understandable limit error', async () => {
    signedIn = true;
    let remaining = 0.25;
    const base = (await import('@/services/backend/client')) as any;
    base.setTransport(async (msg: ApiRequestMessage): Promise<ApiResponseMessage> => {
      calls.push(msg);
      if (msg.op === 'session') return { ok: true, status: 200, data: { signedIn: true, user: { id: 'u1', email: 'jan@student.nl' }, limits } };
      if (msg.op === 'generate') {
        const body = msg.body as any;
        if (body.kind === 'chat') {
          return { ok: false, status: 429, error: { code: 'DAILY_LIMIT', message: 'x', retry_after: 3600 } };
        }
        remaining = 0.05;
        return {
          ok: true,
          status: 200,
          data: { request_id: 'r1', text: 'Briefing from the server', usage: { input_tokens: 900, output_tokens: 40 }, limits: { ...limits, day_cost_remaining_eur: remaining } },
        };
      }
      return { ok: true, status: 204 };
    });

    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="backend" initialCourseData={course} />, { container: appContainer });
    await flush();

    await act(async () => { fireEvent.click(within(appContainer).getByRole('button', { name: /Quick Course Guide/i })); });
    await flush();

    const gen = calls.find((c) => c.op === 'generate')!;
    expect((gen.body as any).kind).toBe('preset');
    expect((gen.body as any).question).toContain('complete, executive course briefing');
    expect(within(appContainer).getByText('Briefing from the server')).toBeDefined();
    expect(within(appContainer).getByTestId('account-bar').textContent).toContain('10% left today');

    const input = within(appContainer).getByPlaceholderText(/Ask a follow-up question/i);
    fireEvent.change(input, { target: { value: 'Wat is de deadline?' } });
    await act(async () => { fireEvent.click(within(appContainer).getByTitle(/Send question/i)); });
    await flush();
    expect(within(appContainer).getByText(/reached your daily limit/i).textContent).toContain('in 1 hour');
  });
});
