import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrightspaceAIHelperApp } from '@/content/index';
import { createShadowRootContainer, removeShadowRootContainer, SHADOW_HOST_ID } from '@/content/shadowRoot';
import { llm } from '@/services/llm/llmClient';
import { hotkeyLabel, matchesHotkey, resetHotkeyForTests, setHotkey } from '@/services/ui/preferences';
import type { CourseData } from '@/types/brightspace';

const course: CourseData = {
  orgUnitId: '1',
  courseName: 'Test Course',
  fetchedAt: Date.now(),
  schemaVersion: 2,
  overview: { title: 'O', htmlContent: '', textDescription: 'overview' },
  toc: [],
};
const key = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })));
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 15)); });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  removeShadowRootContainer();
  document.getElementById(SHADOW_HOST_ID)?.remove();
  resetHotkeyForTests();
});
afterEach(() => {
  cleanup();
  removeShadowRootContainer();
  vi.restoreAllMocks();
});

describe('Enter sends the message from inside the real drawer', () => {
  it('Enter in the chat box submits (regression: the drawer used to swallow key events)', async () => {
    const gen = vi.spyOn(llm, 'rawChat').mockResolvedValue({ text: 'The answer', contextMarkdown: '', requestBody: {} });
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="gemini" initialCourseData={course} />, { container: appContainer });
    await flush();

    const box = within(appContainer).getByPlaceholderText(/Ask a follow-up question/i);
    fireEvent.change(box, { target: { value: 'When is the exam?' } });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    await flush();

    expect(gen).toHaveBeenCalledTimes(1);
    expect(within(appContainer).getByText('The answer')).toBeDefined();

    // Shift+Enter is a new line, not a send
    fireEvent.change(box, { target: { value: 'line one' } });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter', shiftKey: true }); });
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it('keystrokes typed in the drawer still do not reach the Brightspace page', async () => {
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="gemini" initialCourseData={course} />, { container: appContainer });
    await flush();
    const pageListener = vi.fn();
    document.addEventListener('keydown', pageListener);
    const box = within(appContainer).getByPlaceholderText(/Ask a follow-up question/i);
    fireEvent.keyDown(box, { key: 'j' });
    document.removeEventListener('keydown', pageListener);
    expect(pageListener).not.toHaveBeenCalled();
  });
});

describe('the bottom bar is gone and the shortcut lives in Settings', () => {
  it('no "Alt+B openen/sluiten" lane at the bottom of the drawer', async () => {
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen={true} initialMode="gemini" initialCourseData={course} />, { container: appContainer });
    await flush();
    expect(within(appContainer).queryByText(/openen\/sluiten/i)).toBeNull();
    expect(within(appContainer).queryByText('v1.0.0')).toBeNull();
  });

  it('choosing another shortcut in Settings applies immediately and is remembered', async () => {
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialMode="gemini" initialCourseData={course} />, { container: appContainer });
    await flush();
    const drawer = () => within(appContainer).getByRole('dialog', { name: /BS Helper Workspace/i });

    key({ key: 'b', code: 'KeyB', altKey: true });
    expect(drawer().classList.contains('translate-x-0')).toBe(true);

    fireEvent.click(within(appContainer).getByTitle(/Instellingen openen/i));
    const select = within(appContainer).getByLabelText('Keyboard shortcut') as HTMLSelectElement;
    expect(select.value).toBe('Alt+B');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['Alt+B', 'Alt+Shift+B', 'Alt+J', 'Alt+K', 'off']);
    await act(async () => { fireEvent.change(select, { target: { value: 'Alt+J' } }); });
    await flush();
    key({ key: 'Escape' }); // closes the settings modal first
    key({ key: 'b', code: 'KeyB', altKey: true }); // old shortcut no longer works
    expect(drawer().classList.contains('translate-x-0')).toBe(true);
    key({ key: 'j', code: 'KeyJ', altKey: true }); // new shortcut closes
    expect(drawer().classList.contains('translate-x-0')).toBe(false);

    // the floating button tooltip follows the choice
    expect(within(appContainer).getByTitle('BS Helper (Alt+J)')).toBeDefined();
  });

  it("'Disabled' turns the shortcut off", async () => {
    await setHotkey('off');
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialMode="gemini" initialCourseData={course} />, { container: appContainer });
    await flush();
    key({ key: 'b', code: 'KeyB', altKey: true });
    expect(within(appContainer).getByRole('dialog', { name: /BS Helper Workspace/i }).classList.contains('translate-x-0')).toBe(false);
    expect(within(appContainer).getByTitle('BS Helper')).toBeDefined();
  });
});

describe('matchesHotkey', () => {
  const ev = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
  it('matches exactly the chosen combination', () => {
    expect(matchesHotkey(ev({ altKey: true, code: 'KeyB', key: 'b' }), 'Alt+B')).toBe(true);
    expect(matchesHotkey(ev({ altKey: true, code: 'KeyB', key: 'b' }), 'Alt+J')).toBe(false);
    expect(matchesHotkey(ev({ altKey: true, shiftKey: true, code: 'KeyB', key: 'B' }), 'Alt+B')).toBe(false);
    expect(matchesHotkey(ev({ altKey: true, shiftKey: true, code: 'KeyB', key: 'B' }), 'Alt+Shift+B')).toBe(true);
    expect(matchesHotkey(ev({ code: 'KeyB', key: 'b' }), 'Alt+B')).toBe(false);
    expect(matchesHotkey(ev({ altKey: true, ctrlKey: true, code: 'KeyB' }), 'Alt+B')).toBe(false);
    expect(matchesHotkey(ev({ altKey: true, code: 'KeyB', key: 'b' }), 'off')).toBe(false);
  });
  it('works with Alt-produced characters (macOS) via event.code, and falls back to key', () => {
    expect(matchesHotkey(ev({ altKey: true, code: 'KeyB', key: '∫' }), 'Alt+B')).toBe(true);
    expect(matchesHotkey(ev({ altKey: true, key: 'b' }), 'Alt+B')).toBe(true);
  });
  it('labels', () => {
    expect(hotkeyLabel('Alt+Shift+B')).toBe('Alt + Shift + B');
    expect(hotkeyLabel('off')).toBe('');
  });
});
