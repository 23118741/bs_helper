import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseContextBundle } from '@/types/parser';

const bundle: CourseContextBundle = {
  courseInfo: { orgUnitId: '1', courseName: 'C', exportedAt: '' },
  documents: [{ title: 'Syllabus', type: 'pdf', topicId: 's', modulePath: 'W0', content: '[Page 1]\n\nThe exam is on Friday.' }],
};
const geminiReply = (text: string) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: new Headers(),
  json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }),
});

/** Loads the app modules as a production build (no development direct-Gemini mode). */
async function loadProd() {
  vi.stubEnv('VITE_DEV_DIRECT_GEMINI', '');
  vi.resetModules();
  const llmClient = await import('@/services/llm/llmClient');
  const client = await import('@/services/backend/client');
  const session = await import('@/services/backend/session');
  const ownKey = await import('@/services/llm/ownKey');
  session.sessionStore.reset();
  ownKey.resetOwnKeyForTests();
  const backendCalls: string[] = [];
  client.setTransport(async (msg) => {
    backendCalls.push(msg.op);
    if (msg.op === 'session') {
      // signed in, but not approved by the owner: no shared budget
      return { ok: true, status: 200, data: { signedIn: true, user: { id: 'u1', email: 'jan@student.nl' }, limits: { approved: false, day_cost_cap_eur: 0, day_cost_remaining_eur: 0 } } };
    }
    return { ok: true, status: 200, data: { request_id: 'r', text: 'From the shared service', usage: { input_tokens: 1, output_tokens: 1 }, limits: { approved: true, day_cost_cap_eur: 0.25, day_cost_remaining_eur: 0.2 } } };
  });
  return { llmClient, backendCalls, ownKey, session };
}

describe('production build: answering with your own Gemini key', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => geminiReply('Friday [[D1 Page 1]].'));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('without a chosen own key, questions go to the shared backend', async () => {
    const { llmClient, backendCalls } = await loadProd();
    await llmClient.saveLLMSettings({ geminiApiKey: 'AIza-own', useOwnKey: false });
    const res = await llmClient.llm.generate('When is the exam?', { contextBundle: bundle, kind: 'chat' });
    expect(res.mode).toBe('backend');
    expect(backendCalls).toContain('generate');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with the own key switched on, questions go straight to Google and never to the backend', async () => {
    const { llmClient, backendCalls } = await loadProd();
    await llmClient.saveLLMSettings({ geminiApiKey: 'AIza-own', model: 'gemini-3.8-flash', useOwnKey: true });
    const res = await llmClient.llm.generate('When is the exam according to the syllabus?', { contextBundle: bundle, kind: 'chat' });

    expect(res.mode).toBe('gemini');
    expect(res.text).toContain('Friday');
    expect(backendCalls).not.toContain('generate');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String((fetchMock.mock.calls[0] as any)[0]);
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('key=AIza-own');
    // the same prompts as the shared service
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.systemInstruction.parts[0].text).toContain('BLUF');
  });

  it('a general question with the own key is a plain chat without course material', async () => {
    const { llmClient } = await loadProd();
    await llmClient.saveLLMSettings({ geminiApiKey: 'AIza-own', useOwnKey: true });
    fetchMock.mockResolvedValueOnce(geminiReply('TCP is reliable; UDP is not.'));
    const res = await llmClient.llm.generate('What is the difference between TCP and UDP?', { contextBundle: bundle, kind: 'chat' });
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.contents[0].parts[0].text).not.toContain('The exam is on Friday');
    expect(body.systemInstruction.parts[0].text).toContain('without access to the student');
    expect(res.general).toBe(true);
  });

  it('switched on but without a key falls back to the shared backend', async () => {
    const { llmClient, backendCalls } = await loadProd();
    await llmClient.saveLLMSettings({ geminiApiKey: '   ', useOwnKey: true });
    const res = await llmClient.llm.generate('When is the exam?', { contextBundle: bundle, kind: 'chat' });
    expect(res.mode).toBe('backend');
    expect(backendCalls).toContain('generate');
  });

  it('Settings: saving the key switches the account bar to "Using your own API key"', async () => {
    const { llmClient } = await loadProd();
    const { OwnKeyForm } = await import('@/components/OwnKeyForm');
    const { AccountBar } = await import('@/components/AccountBar');
    const { refreshSession } = await import('@/services/backend/session');
    await refreshSession();
    await llmClient.saveLLMSettings({ geminiApiKey: '', useOwnKey: false });

    render(<><OwnKeyForm /><AccountBar /></>);
    expect(screen.getByTestId('awaiting-approval')).toBeDefined(); // before: no budget at all
    await waitFor(() => expect((screen.getByLabelText('Google Gemini API key') as HTMLInputElement).disabled).toBe(false)); // saved values loaded
    // nothing to switch on without a key
    expect((screen.getByLabelText(/Use my own Google Gemini key/i) as HTMLInputElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Google Gemini API key'), { target: { value: 'AIza-own' } });
    await act(async () => { fireEvent.click(screen.getByLabelText(/Use my own Google Gemini key/i)); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Save$/ })); });

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/your own API key/i));
    const saved = await llmClient.getLLMSettings();
    expect(saved).toMatchObject({ geminiApiKey: 'AIza-own', useOwnKey: true });
    expect(screen.getByTestId('own-key-active')).toBeDefined();
    expect(screen.queryByTestId('awaiting-approval')).toBeNull(); // the approval does not apply to your own key
  });

  it('Settings: the key saved inside the Settings window is still there after closing and reopening it', async () => {
    const { llmClient } = await loadProd();
    const { SettingsModal } = await import('@/components/SettingsModal');
    const { refreshSession } = await import('@/services/backend/session');
    await refreshSession();
    await llmClient.saveLLMSettings({ geminiApiKey: '', useOwnKey: false });

    const onClose = vi.fn();
    const view = render(<SettingsModal isOpen={true} onClose={onClose} />);
    await waitFor(() => expect((screen.getByLabelText('Google Gemini API key') as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Google Gemini API key'), { target: { value: 'AIza-own' } });
    await act(async () => { fireEvent.click(screen.getByLabelText(/Use my own Google Gemini key/i)); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Save$/ })); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/your own API key/i));
    await act(async () => { await new Promise((r) => setTimeout(r, 800)); }); // the old outer save closed after 700 ms

    expect(await llmClient.getLLMSettings()).toMatchObject({ geminiApiKey: 'AIza-own', useOwnKey: true });
    expect(onClose).not.toHaveBeenCalled();

    view.rerender(<SettingsModal isOpen={false} onClose={onClose} />);
    view.rerender(<SettingsModal isOpen={true} onClose={onClose} />);
    await waitFor(() => expect((screen.getByLabelText('Google Gemini API key') as HTMLInputElement).value).toBe('AIza-own'));
    expect((screen.getByLabelText(/Use my own Google Gemini key/i) as HTMLInputElement).checked).toBe(true);
  });
});
