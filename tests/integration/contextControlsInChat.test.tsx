import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPlugin } from '@/components/actions/ChatPlugin';
import { llm } from '@/services/llm/llmClient';
import { createFullContextSelection } from '@/types/parser';
import type { CourseData } from '@/types/brightspace';

const course: CourseData = {
  orgUnitId: '1',
  courseName: 'Test Course',
  fetchedAt: Date.now(),
  overview: { title: 'O', htmlContent: '', textDescription: 'overview text' },
  toc: [
    {
      moduleId: 'm1',
      title: 'Week 1',
      subModules: [],
      topics: [
        { topicId: 't1', title: 'Lecture.pdf', type: 'file', fileExtension: 'pdf', parsedContent: 'Raft consensus text. '.repeat(40) },
        { topicId: 't2', title: 'Networking.pdf', type: 'file', fileExtension: 'pdf', parsedContent: 'TCP and UDP text. '.repeat(40) },
        { topicId: 't3', title: 'Scan.pdf', type: 'file', fileExtension: 'pdf' },
      ],
    },
  ],
};
const props = { courseData: course, selection: createFullContextSelection(course), currentMode: 'backend' as const };
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
afterEach(() => vi.restoreAllMocks());

const stats = { totalDocuments: 2, includedDocuments: 1, includedTokens: 200, matched: true, includedTopicIds: ['t1'] };

describe('context controls and presets share one bar in the Chat', () => {
  it('shows the four presets, the context size, the relevance switch and a copy button in ONE bar', () => {
    const { getByTestId, getByText, getByTitle } = render(<ChatPlugin.component {...props} />);
    const bar = within(getByTestId('context-toolbar'));
    for (const title of ['Quick Course Guide', 'Study & Lecture Notes', 'Assignments & Deadlines', 'Grades & Feedback']) {
      expect(bar.getByRole('button', { name: new RegExp(title.replace(/[&]/g, '\\&'), 'i') })).toBeDefined();
    }
    expect(bar.getByText(/Context · 2\/3 topics · ~\d/)).toBeDefined();
    expect(bar.getByText('Relevance filter on')).toBeDefined();
    expect(getByText('Copy context')).toBeDefined();
    expect(getByTitle(/Copy the full selected context/)).toBeDefined();
  });

  it('after an answer it reports the documents sent and copies exactly that context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.spyOn(llm, 'generate').mockResolvedValue({
      text: 'Answer',
      mode: 'gemini',
      usage: { totalTokens: 10 },
      contextStats: stats,
      serializedContext: 'EXACT CONTEXT THAT WAS SENT',
    });
    const { getByPlaceholderText, getByTitle, getByTestId, getAllByText } = render(<ChatPlugin.component {...props} />);
    fireEvent.change(getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'What is Raft?' } });
    await act(async () => { fireEvent.click(getByTitle('Send question')); });
    await flush();

    expect(within(getByTestId('context-toolbar')).getByText(/Context · 1\/2 docs sent/)).toBeDefined();
    fireEvent.click(getByTitle(/Copy the context that was sent/));
    expect(writeText).toHaveBeenCalledWith('EXACT CONTEXT THAT WAS SENT');

    // inspector marks what was (not) sent
    fireEvent.click(within(getByTestId('context-toolbar')).getByRole('button', { name: /Context/ }));
    expect(getAllByText('not relevant to last question')).toHaveLength(1);
    expect(getAllByText('no text available')).toHaveLength(1);
  });

  it('switching the filter off makes every request (also presets) send the whole selection', async () => {
    const gen = vi.spyOn(llm, 'generate').mockResolvedValue({ text: 'ok', mode: 'gemini', usage: { totalTokens: 1 } });
    const { getByText, getByPlaceholderText, getByTitle, getByRole } = render(<ChatPlugin.component {...props} />);

    fireEvent.change(getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'question one' } });
    await act(async () => { fireEvent.click(getByTitle('Send question')); });
    await flush();
    expect((gen.mock.calls[0][1] as any).relevance).toMatchObject({ query: expect.any(String) });

    fireEvent.click(getByText('Relevance filter on'));
    expect(getByText('Relevance filter off')).toBeDefined();
    await act(async () => { fireEvent.click(getByRole('button', { name: /Quick Course Guide/i })); });
    await flush();
    expect((gen.mock.calls[1][1] as any).relevance).toBe('off');

    fireEvent.change(getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'question two' } });
    await act(async () => { fireEvent.click(getByTitle('Send question')); });
    await flush();
    expect((gen.mock.calls[2][1] as any).relevance).toBe('off');
  });

  it('clearing the conversation resets the "sent" report', async () => {
    vi.spyOn(llm, 'generate').mockResolvedValue({ text: 'A', mode: 'gemini', usage: { totalTokens: 1 }, contextStats: stats, serializedContext: 'ctx' });
    const { getByPlaceholderText, getByTitle, getByTestId } = render(<ChatPlugin.component {...props} />);
    fireEvent.change(getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'q' } });
    await act(async () => { fireEvent.click(getByTitle('Send question')); });
    await flush();
    expect(within(getByTestId('context-toolbar')).getByText(/docs sent/)).toBeDefined();
    fireEvent.click(getByTitle('Clear conversation'));
    expect(within(getByTestId('context-toolbar')).getByText(/topics/)).toBeDefined();
  });
});
