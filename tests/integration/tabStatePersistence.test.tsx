import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionPluginTabs } from '@/components/ActionPluginTabs';
import { ActionRegistry } from '@/components/actions/ActionRegistry';
import { ChatPlugin } from '@/components/actions/ChatPlugin';
import { llm } from '@/services/llm/llmClient';
import { createFullContextSelection } from '@/types/parser';
import type { ActionPlugin } from '@/types/actions';
import type { CourseData } from '@/types/brightspace';

const course: CourseData = {
  orgUnitId: '1',
  courseName: 'Test Course',
  fetchedAt: Date.now(),
  overview: { title: 'O', htmlContent: '', textDescription: 'overview text' },
  toc: [],
};
const Other: ActionPlugin = {
  id: 'other',
  name: 'Other tool',
  title: 'Other',
  icon: 'Sparkles',
  status: 'active',
  description: 'second tool for the test',
  order: 5,
  component: () => <div>other tool body</div>,
};

beforeEach(() => {
  ActionRegistry.reset();
  ActionRegistry.register(ChatPlugin);
});
afterEach(() => {
  vi.restoreAllMocks();
  ActionRegistry.reset();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

describe('tool state survives tab switches', () => {
  it('with a single tool there is no tab bar (the chat fills the space)', () => {
    const { queryByRole, getByPlaceholderText } = render(
      <ActionPluginTabs courseData={course} selection={createFullContextSelection(course)} currentMode="gemini" />
    );
    expect(queryByRole('button', { name: /^Chat$/ })).toBeNull();
    expect(getByPlaceholderText(/Ask a follow-up question/i)).toBeDefined();
  });

  it('keeps the chat history and the unsent draft when switching to another tool and back', async () => {
    ActionRegistry.register(Other);
    vi.spyOn(llm, 'rawChat').mockResolvedValue({ text: 'Answer from the chat', contextMarkdown: '', requestBody: {} });
    const { getByRole, getAllByPlaceholderText, getByText, queryByText } = render(
      <ActionPluginTabs courseData={course} selection={createFullContextSelection(course)} currentMode="gemini" />
    );
    const box = () => getAllByPlaceholderText(/Ask a follow-up question/i)[0] as HTMLTextAreaElement;

    fireEvent.change(box(), { target: { value: 'my first question' } });
    await act(async () => { fireEvent.keyDown(box(), { key: 'Enter' }); });
    await flush();
    expect(getByText('my first question')).toBeDefined();
    expect(getByText('Answer from the chat')).toBeDefined();
    fireEvent.change(box(), { target: { value: 'half typed' } });

    fireEvent.click(getByRole('button', { name: /Other tool/i }));
    await flush();
    expect(document.querySelector('[data-plugin-id="chat"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(getByText('other tool body')).toBeDefined();

    fireEvent.click(getByRole('button', { name: /^Chat$/i }));
    await flush();
    expect(getByText('my first question')).toBeDefined();
    expect(getByText('Answer from the chat')).toBeDefined();
    expect(box().value).toBe('half typed');
    expect(queryByText('No active plugin selected.')).toBeNull();
  });
});
