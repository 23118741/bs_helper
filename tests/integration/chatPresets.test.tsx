import { act, cleanup, fireEvent, render, renderHook, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPlugin } from '@/components/actions/ChatPlugin';
import { DrawerLayoutContext } from '@/components/LayoutContext';
import { llm } from '@/services/llm/llmClient';
import { registerActiveCourse, resetChatSessions, useSessionState } from '@/services/chat/chatSessions';
import { SUMMARY_PRESETS } from '@/types/actions';
import { createFullContextSelection } from '@/types/parser';
import type { CourseData } from '@/types/brightspace';

const course: CourseData = {
  orgUnitId: 'cp',
  courseName: 'Machine Learning',
  fetchedAt: 1,
  overview: { title: 'O', htmlContent: '', textDescription: 'overview text' },
  toc: [],
};
const mount = (mode: 'backend' | 'gemini') =>
  render(<ChatPlugin.component courseData={course} selection={createFullContextSelection(course)} currentMode={mode} />);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const reply = (text: string, over: Record<string, unknown> = {}) => ({ text, mode: 'gemini' as const, usage: { totalTokens: 7 }, ...over });

describe('the presets keep working exactly as they did, now in the Chat bar', () => {
  it('they look the same: rounded chips with an icon and the same titles, tooltips and order', () => {
    const view = mount('gemini');
    const bar = within(view.getByTestId('context-toolbar'));
    const chips = bar.getAllByRole('button').slice(0, SUMMARY_PRESETS.length);
    expect(chips.map((c) => c.textContent)).toEqual(SUMMARY_PRESETS.map((p) => p.title));
    chips.forEach((chip, i) => {
      expect(chip.getAttribute('title')).toBe(`${SUMMARY_PRESETS[i].subtitle}: ${SUMMARY_PRESETS[i].description}`);
      expect(chip.className).toContain('rounded-full');
      expect(chip.querySelector('svg')).not.toBeNull();
    });
    // the context controls follow in the same bar
    expect(bar.getByText(/Context ·/)).toBeDefined();
    expect(bar.getByText(/Relevance filter/)).toBeDefined();
    expect(bar.getByText('Copy context')).toBeDefined();
  });

  for (const mode of ['gemini', 'backend'] as const) {
    it(`a preset goes through the gateway with its own prompt, kind "preset", and shows its one-sentence question (${mode} build)`, async () => {
      const gen = vi.spyOn(llm, 'generate').mockResolvedValue(reply('Briefing text'));
      const raw = vi.spyOn(llm, 'rawChat');
      const view = mount(mode);
      await act(async () => { fireEvent.click(view.getByRole('button', { name: /Quick Course Guide/i })); });
      await flush();

      expect(raw).not.toHaveBeenCalled();
      const [prompt, options] = gen.mock.calls[0] as [string, any];
      expect(prompt).toBe(SUMMARY_PRESETS[0].promptTemplate('Machine Learning'));
      expect(options.kind).toBe('preset');
      expect(options.mode).toBe(mode);
      expect(options.contextBundle).toBeDefined();
      expect(view.getByText('Briefing text')).toBeDefined();
      const bubbles = view.container.querySelectorAll('.items-end .rounded-br-none');
      expect(bubbles).toHaveLength(1); // the short question, not the long preset prompt
      expect(bubbles[0].textContent).toContain(SUMMARY_PRESETS[0].question);
    });
  }

  it('each preset keeps its own context rule: briefing and study notes get all documents, deadlines and grades search for their keywords', async () => {
    const gen = vi.spyOn(llm, 'generate').mockResolvedValue(reply('ok'));
    const view = mount('gemini');
    const click = async (name: RegExp) => {
      await act(async () => { fireEvent.click(view.getByRole('button', { name })); });
      await flush();
    };
    await click(/Quick Course Guide/i);
    await click(/Study & Lecture Notes/i);
    await click(/Assignments & Deadlines/i);
    await click(/Grades & Feedback/i);
    const rel = gen.mock.calls.map((c) => (c[1] as any).relevance);
    expect(rel[0]).toEqual({ mode: 'all' });
    expect(rel[1]).toEqual({ mode: 'all' });
    expect(rel[2]).toEqual({ query: expect.stringContaining('deadline') });
    expect(rel[3]).toEqual({ query: expect.stringContaining('cijfer') });
  });

  it('the relevance switch applies to presets too; "off" sends the whole selection', async () => {
    const gen = vi.spyOn(llm, 'generate').mockResolvedValue(reply('ok'));
    const view = mount('gemini');
    fireEvent.click(view.getByText('Relevance filter on'));
    await act(async () => { fireEvent.click(view.getByRole('button', { name: /Grades & Feedback/i })); });
    await flush();
    expect((gen.mock.calls[0][1] as any).relevance).toBe('off');
  });

  it('buttons are disabled while an answer is being generated, the active one is highlighted', async () => {
    let finish!: (v: any) => void;
    vi.spyOn(llm, 'generate').mockReturnValue(new Promise((r) => { finish = r; }) as any);
    const view = mount('backend');
    const briefing = view.getByRole('button', { name: /Quick Course Guide/i }) as HTMLButtonElement;
    const notes = view.getByRole('button', { name: /Study & Lecture Notes/i }) as HTMLButtonElement;
    await act(async () => { fireEvent.click(briefing); });
    expect(briefing.disabled).toBe(true);
    expect(notes.disabled).toBe(true);
    expect(briefing.className).toContain('border-blue-500');
    expect(view.getByText(/Analyzing course materials & generating response.../i)).toBeDefined();
    await act(async () => { finish(reply('Done')); });
    await flush();
    expect(briefing.disabled).toBe(false);
  });

  it('a preset answer can be repeated with all materials, like before', async () => {
    const stats = { totalDocuments: 3, includedDocuments: 1, includedTokens: 10, matched: true, includedTopicIds: ['a'], widenable: true };
    const gen = vi.spyOn(llm, 'generate')
      .mockResolvedValueOnce(reply('Deadlines (partial)', { contextStats: stats }))
      .mockResolvedValueOnce(reply('Deadlines (everything)', { contextStats: { ...stats, widenable: false } }));
    const view = mount('gemini');
    await act(async () => { fireEvent.click(view.getByRole('button', { name: /Assignments & Deadlines/i })); });
    await flush();
    await act(async () => { fireEvent.click(view.getByText('Search all materials')); });
    await flush();
    const options = gen.mock.calls[1][1] as any;
    expect(options.relevance).toEqual({ mode: 'all', sections: 'all' });
    expect(options.kind).toBe('preset');
    expect(options.escalate).toBe(false);
    expect(view.getByText('Deadlines (everything)')).toBeDefined();
  });
});

describe('layout of the bar', () => {
  const mountIn = (expanded: boolean) =>
    render(
      <DrawerLayoutContext.Provider value={{ expanded }}>
        <ChatPlugin.component courseData={course} selection={createFullContextSelection(course)} currentMode="gemini" />
      </DrawerLayoutContext.Provider>
    );

  const checkContents = (view: ReturnType<typeof render>) => {
    const left = within(view.getByTestId('toolbar-leading'));
    const right = within(view.getByTestId('context-controls'));
    expect(left.getAllByRole('button')).toHaveLength(SUMMARY_PRESETS.length); // presets only
    expect(right.getAllByRole('button')).toHaveLength(3); // context controls only
    expect(right.queryByRole('button', { name: /Quick Course Guide/i })).toBeNull();
    expect(left.queryByText('Copy context')).toBeNull();
    // compact but still fully labelled for tooltips and screen readers
    expect(right.getByRole('button', { name: /Context · \d+\/\d+ topics · ~\d/ })).toBeDefined();
    expect(right.getByRole('button', { name: /Relevance filter on/ }).getAttribute('title')).toMatch(/Relevance filter on/);
    expect(right.getByRole('button', { name: /Copy context/ })).toBeDefined();
  };

  it('full screen: presets on the left, the context controls in their own piece at the far right (top)', () => {
    const view = mountIn(true);
    checkContents(view);
    const toolbar = view.getByTestId('context-toolbar');
    const controls = view.getByTestId('context-controls');
    expect(toolbar.getAttribute('data-layout')).toBe('row');
    expect(toolbar.className).toContain('justify-between');
    expect(toolbar.className).toContain('items-start');
    expect(toolbar.lastElementChild).toBe(controls);
    expect(controls.className).toContain('flex-shrink-0');
    expect(controls.className).toContain('border-l'); // its own section
  });

  it('side panel: the context controls drop below the presets instead of sitting at the right', () => {
    const view = mountIn(false);
    checkContents(view);
    const toolbar = view.getByTestId('context-toolbar');
    const controls = view.getByTestId('context-controls');
    expect(toolbar.getAttribute('data-layout')).toBe('stacked');
    expect(toolbar.className).toContain('flex-col');
    expect(toolbar.className).not.toContain('justify-between');
    // two lines: the presets first, the controls below them
    expect(Array.from(toolbar.children)).toEqual([view.getByTestId('toolbar-leading'), controls]);
    expect(controls.className).not.toContain('border-l');
  });
});

describe('free questions after a preset', () => {
  it('direct build: the question goes straight to the API; the preset is part of the conversation as its one-sentence question, not the long prompt', async () => {
    vi.spyOn(llm, 'generate').mockResolvedValue(reply('Briefing text'));
    const raw = vi.spyOn(llm, 'rawChat').mockResolvedValue({ text: 'Raw reply', contextMarkdown: '', requestBody: {} });
    const view = mount('gemini');
    await act(async () => { fireEvent.click(view.getByRole('button', { name: /Quick Course Guide/i })); });
    await flush();
    fireEvent.change(view.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'And the exam?' } });
    await act(async () => { fireEvent.click(view.getByTitle('Send question')); });
    await flush();

    const history = raw.mock.calls[0][0] as Array<{ role: string; text: string }>;
    expect(history.map((h) => h.role)).toEqual(['user', 'model', 'user']); // alternates, starts with the user
    expect(history[0].text).toBe(SUMMARY_PRESETS[0].question);
    expect(history[1].text).toBe('Briefing text');
    expect(history[2].text).toBe('And the exam?');
    expect(view.getByText('Raw reply')).toBeDefined();
    expect(view.getByText(/Mode: raw/)).toBeDefined();
  });

  it('backend build: the question goes through the gateway as typed, with the conversation as history', async () => {
    const gen = vi.spyOn(llm, 'generate').mockResolvedValue(reply('Answer'));
    const view = mount('backend');
    fireEvent.change(view.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'First question' } });
    await act(async () => { fireEvent.click(view.getByTitle('Send question')); });
    await flush();
    fireEvent.change(view.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'Second question' } });
    await act(async () => { fireEvent.click(view.getByTitle('Send question')); });
    await flush();

    const [prompt, options] = gen.mock.calls[1] as [string, any];
    expect(prompt).toBe('Second question');
    expect(options.kind).toBe('chat');
    expect(options.history).toEqual([
      { role: 'user', text: 'First question' },
      { role: 'model', text: 'Answer' },
    ]);
    expect(options.relevance.query).toContain('Second question');
  });
});

describe('the conversation and the parallel chats go along', () => {
  afterEach(() => resetChatSessions());

  it('a preset also sends the conversation so far', async () => {
    const gen = vi.spyOn(llm, 'generate').mockResolvedValue(reply('Answer'));
    const view = mount('backend');
    fireEvent.change(view.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'What is overfitting?' } });
    await act(async () => { fireEvent.click(view.getByTitle('Send question')); });
    await flush();
    await act(async () => { fireEvent.click(view.getByRole('button', { name: /Quick Course Guide/i })); });
    await flush();

    const [, options] = gen.mock.calls[1] as [string, any];
    expect(options.kind).toBe('preset');
    expect(options.history).toEqual([
      { role: 'user', text: 'What is overfitting?' },
      { role: 'model', text: 'Answer' },
    ]);
  });

  it('a question can use the chats about other courses (the other tabs)', async () => {
    // a conversation in another course, as the Chat tool keeps it
    registerActiveCourse('other', 'Statistics');
    const other = renderHook(() => useSessionState<any[]>('other', 'chat.turns', []));
    act(() => other.result.current[1]([{ role: 'user', text: 'When is the exam?' }, { role: 'model', text: 'Friday 12 June.' }]));
    registerActiveCourse('cp', 'Machine Learning');

    const gen = vi.spyOn(llm, 'generate').mockResolvedValue(reply('Answer'));
    const view = mount('backend');
    fireEvent.change(view.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'And what did you say about my statistics exam?' } });
    await act(async () => { fireEvent.click(view.getByTitle('Send question')); });
    await flush();

    const [, options] = gen.mock.calls[0] as [string, any];
    expect(options.relatedChats).toEqual([
      { course: 'Statistics', turns: [{ role: 'user', text: 'When is the exam?' }, { role: 'model', text: 'Friday 12 June.' }] },
    ]);
  });
});
