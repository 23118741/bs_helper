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
  toc: [],
};
const props = { courseData: course, selection: createFullContextSelection(course), currentMode: 'gemini' as const };
afterEach(() => vi.restoreAllMocks());

describe('Chat tool layout', () => {
  it('has one chat tool: shell, composer, the four presets, no connection banner', () => {
    const view = render(<ChatPlugin.component {...props} />);
    expect(view.getByPlaceholderText('Ask a follow-up question about the course materials...').tagName).toBe('TEXTAREA');
    expect(view.getByTestId('chat-shell')).toBeDefined();
    expect(view.queryByText(/connected/i)).toBeNull();
    expect(view.queryByText(/Configure Key/i)).toBeNull();
    for (const name of ['Quick Course Guide', 'Study & Lecture Notes', 'Assignments & Deadlines', 'Grades & Feedback']) {
      expect(view.getByText(name)).toBeDefined();
    }
  });

  it('renders model answers as formatted Markdown with the quiet footer and a clear action', async () => {
    vi.spyOn(llm, 'rawChat').mockResolvedValue({
      text: '## Documents\n\n- **Syllabus** is visible\n- Slides are visible',
      promptTokens: 100,
      candidateTokens: 20,
      totalTokens: 120,
      finishReason: 'STOP',
      contextMarkdown: 'ctx',
      contextStats: { totalDocuments: 3, includedDocuments: 1, includedTokens: 50, matched: true, includedTopicIds: ['a'] },
      requestBody: {},
    });
    const { container, getByPlaceholderText, getByTitle, queryByText, getByText } = render(<ChatPlugin.component {...props} />);
    fireEvent.change(getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'what can you see?' } });
    await act(async () => {
      fireEvent.click(getByTitle('Send question'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // formatted, not raw markdown
    expect(queryByText(/^## Documents/)).toBeNull();
    expect(container.querySelector('h1, h2, h3, h4')?.textContent).toContain('Documents');
    expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
    expect(within(container).getByText('Syllabus').tagName).toBe('STRONG');

    // bubble structure and quiet footer
    expect(container.querySelector('.items-end .rounded-br-none')).not.toBeNull();
    expect(getByText(/Mode: raw/)).toBeDefined();
    expect(getByText('~120 tokens (in 100 · out 20)')).toBeDefined();
    expect(getByText('1/3 docs')).toBeDefined();
    expect(getByTitle('Clear conversation')).toBeDefined();

    fireEvent.click(getByTitle('Clear conversation'));
    expect(queryByText('Mode: raw')).toBeNull();
  });
});
