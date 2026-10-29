import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPlugin } from '@/components/actions/ChatPlugin';
import { llm } from '@/services/llm/llmClient';
import { createFullContextSelection } from '@/types/parser';
import type { CourseData } from '@/types/brightspace';

const course: CourseData = { orgUnitId: 'sa', courseName: 'C', fetchedAt: 1, overview: { title: 'O', htmlContent: '', textDescription: 'x' }, toc: [] };
const props = { courseData: course, selection: createFullContextSelection(course), currentMode: 'backend' as const };
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const stats = (widenable: boolean) => ({
  totalDocuments: 3,
  includedDocuments: 1,
  includedTokens: 100,
  matched: true,
  includedTopicIds: ['a'],
  totalChunks: 90,
  includedChunks: 4,
  sectionsOmitted: ['announcements', 'discussions'],
  queryKind: 'fact',
  widenable,
});

const ask = async (view: ReturnType<typeof render>, q: string) => {
  fireEvent.change(view.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: q } });
  await act(async () => { fireEvent.click(view.getByTitle('Send question')); });
  await flush();
};

describe('"Search all materials" and the searching status', () => {
  it('offers to search everything under an answer that left material out, and does it without a second question bubble', async () => {
    const gen = vi.spyOn(llm, 'generate')
      .mockResolvedValueOnce({ text: 'First answer', mode: 'gemini', usage: { totalTokens: 5 }, contextStats: stats(true) })
      .mockResolvedValueOnce({ text: 'Answer with everything', mode: 'gemini', usage: { totalTokens: 9 }, contextStats: stats(false) });
    const view = render(<ChatPlugin.component {...props} />);
    await ask(view, 'When is the deadline?');

    // the context chip says what was searched
    expect(view.getByTitle('Searched 1 of 3 documents · 4 of 90 slides/pages/sections · skipped: announcements, discussions')).toBeDefined();
    const button = view.getByText('Search all materials');

    await act(async () => { fireEvent.click(button); });
    await flush();

    expect(gen).toHaveBeenCalledTimes(2);
    const [prompt2, options2] = gen.mock.calls[1] as [string, any];
    expect(prompt2).toBe(gen.mock.calls[0][0]); // the same question again
    expect(options2.relevance).toEqual({ mode: 'all', sections: 'all' });
    expect(options2.escalate).toBe(false);
    expect(view.getAllByText('When is the deadline?')).toHaveLength(1); // no duplicated user bubble
    expect(view.getByText('Answer with everything')).toBeDefined();
    // answered with everything: nothing left to widen, so the first answer keeps its link but the new one has none
    expect(view.getAllByText('Search all materials')).toHaveLength(1);
  });

  it('shows no such action when nothing was left out', async () => {
    vi.spyOn(llm, 'generate').mockResolvedValue({ text: 'Complete answer', mode: 'gemini', usage: { totalTokens: 5 }, contextStats: stats(false) });
    const view = render(<ChatPlugin.component {...props} />);
    await ask(view, 'Question');
    expect(view.queryByText('Search all materials')).toBeNull();
  });

  it('shows the gateway status while it searches wider, and clears it afterwards', async () => {
    let finish!: (v: any) => void;
    vi.spyOn(llm, 'generate').mockImplementation((_p, o) => {
      o?.onStatus?.('Searching more of your materials…');
      return new Promise((r) => { finish = r; });
    });
    const view = render(<ChatPlugin.component {...props} />);
    fireEvent.change(view.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'Q' } });
    await act(async () => { fireEvent.click(view.getByTitle('Send question')); });
    await flush();
    expect(view.getByText('Searching more of your materials…')).toBeDefined();

    await act(async () => { finish({ text: 'Done', mode: 'gemini', usage: { totalTokens: 1 } }); });
    await flush();
    expect(view.queryByText('Searching more of your materials…')).toBeNull();
    expect(view.getByText('Done')).toBeDefined();
  });

  it('every question passes the question itself to the filter (not the wrapped template) and allows the safety net', async () => {
    const gen = vi.spyOn(llm, 'generate').mockResolvedValue({ text: 'A', mode: 'gemini', usage: { totalTokens: 1 } });
    const view = render(<ChatPlugin.component {...props} />);
    await ask(view, 'When is the exam?');
    const options = gen.mock.calls[0][1] as any;
    expect(options.relevance.query).toContain('When is the exam?');
    expect(options.escalate).toBe(true);
    expect(typeof options.onStatus).toBe('function');
  });
});
