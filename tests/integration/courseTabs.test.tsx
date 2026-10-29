import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourseTabs } from '@/components/CourseTabs';
import { ChatPlugin } from '@/components/actions/ChatPlugin';
import { closeChatTab, registerActiveCourse, resetChatSessions, useSessionRef, useSessionState } from '@/services/chat/chatSessions';
import { llm } from '@/services/llm/llmClient';
import { createFullContextSelection } from '@/types/parser';
import type { CourseData } from '@/types/brightspace';

const mkCourse = (id: string, name: string): CourseData => ({ orgUnitId: id, courseName: name, fetchedAt: 1, overview: { title: 'O', htmlContent: '', textDescription: 'overview' }, toc: [] });
const COURSES = { A: mkCourse('A', 'Oral History'), B: mkCourse('B', 'Statistics'), C: mkCourse('C', 'Ethics') };
afterEach(cleanup);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 15)); });

/** Mimics the app: header tabs + the active course's tool; switching course remounts the tool. */
function App({ mode = 'backend' }: { mode?: 'backend' | 'gemini' }) {
  const tool = ChatPlugin;
  const [active, setActive] = useState<keyof typeof COURSES>('A');
  const course = COURSES[active];
  return (
    <div>
      <CourseTabs activeCourseId={course.orgUnitId} activeCourseName={course.courseName} onSelectCourse={(id) => setActive(id as keyof typeof COURSES)} />
      {(Object.keys(COURSES) as Array<keyof typeof COURSES>).map((id) => (
        <button key={id} onClick={() => setActive(id)}>{`go ${id}`}</button>
      ))}
      <tool.component key={course.orgUnitId} courseData={course} selection={createFullContextSelection(course)} currentMode={mode} />
    </div>
  );
}

const ask = async (view: ReturnType<typeof render>, text: string) => {
  fireEvent.change(view.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: text } });
  await act(async () => { fireEvent.click(view.getByTitle('Send question')); });
  await flush();
};

describe('chats per course with browser-style tabs', () => {
  it('no tab bar while there is only one course', () => {
    const view = render(<App />);
    expect(view.queryByTestId('course-tabs')).toBeNull();
  });

  it('keeps the chat (and the unsent draft) when switching course and shows it as a tab', async () => {
    vi.spyOn(llm, 'generate').mockResolvedValue({ text: 'Answer about oral history', mode: 'gemini', usage: { totalTokens: 5 } });
    const view = render(<App />);
    await ask(view, 'What is oral history?');
    fireEvent.change(view.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'half typed' } });

    fireEvent.click(view.getByText('go B'));
    await flush();
    // a fresh chat in the new course, Oral History stays as a tab
    expect(view.queryByText('Answer about oral history')).toBeNull();
    const tabs = within(view.getByTestId('course-tabs')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Oral History', 'Statistics']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    // back via the tab: everything as it was
    fireEvent.click(within(view.getByTestId('course-tabs')).getByTitle('Oral History'));
    await flush();
    expect(view.getByText('What is oral history?')).toBeDefined();
    expect(view.getByText('Answer about oral history')).toBeDefined();
    expect((view.getByPlaceholderText(/Ask a follow-up question/i) as HTMLTextAreaElement).value).toBe('half typed');
  });

  it('courses you only looked at do not pile up as tabs', async () => {
    vi.spyOn(llm, 'generate').mockResolvedValue({ text: 'A1', mode: 'gemini', usage: { totalTokens: 1 } });
    const view = render(<App />);
    await ask(view, 'question in A');
    fireEvent.click(view.getByText('go B'));
    await flush();
    fireEvent.click(view.getByText('go C')); // B had no chat → its tab disappears
    await flush();
    const names = within(view.getByTestId('course-tabs')).getAllByRole('tab').map((t) => t.textContent);
    expect(names).toEqual(['Oral History', 'Ethics']);
  });

  it('closing a tab discards that chat; closing the active tab moves to a neighbour', async () => {
    vi.spyOn(llm, 'generate').mockResolvedValue({ text: 'Answer A', mode: 'gemini', usage: { totalTokens: 1 } });
    const view = render(<App />);
    await ask(view, 'question A');
    fireEvent.click(view.getByText('go B'));
    await flush();

    // close the background tab (Oral History): its chat is gone and the tab bar disappears (one tab left)
    fireEvent.click(view.getByLabelText('Close chat for Oral History'));
    await flush();
    expect(view.queryByTestId('course-tabs')).toBeNull();
    fireEvent.click(view.getByText('go A'));
    await flush();
    expect(view.queryByText('question A')).toBeNull();

    // active tab closed → switches to the other course
    await ask(view, 'new question A');
    fireEvent.click(view.getByText('go B'));
    await flush();
    await ask(view, 'question B');
    fireEvent.click(within(view.getByTestId('course-tabs')).getByLabelText('Close chat for Statistics'));
    await flush();
    expect(view.queryByText('question B')).toBeNull();
    expect(view.getByText('new question A')).toBeDefined(); // landed on Oral History with its chat intact
  });

  it('an answer that arrives after switching course lands in its own course; the tab shows it is working', async () => {
    let resolve!: (v: any) => void;
    vi.spyOn(llm, 'generate').mockImplementation(() => new Promise((r) => { resolve = r; }));
    const view = render(<App />);
    fireEvent.change(view.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'slow question' } });
    await act(async () => { fireEvent.click(view.getByTitle('Send question')); });

    fireEvent.click(view.getByText('go B'));
    await flush();
    expect(within(view.getByTestId('course-tabs')).getByTitle('Generating an answer')).toBeDefined();
    expect(view.queryByText('Late answer')).toBeNull();

    await act(async () => { resolve({ text: 'Late answer', mode: 'gemini', usage: { totalTokens: 1 } }); });
    await flush();
    expect(within(view.getByTestId('course-tabs')).queryByTitle('Generating an answer')).toBeNull();
    expect(view.queryByText('Late answer')).toBeNull(); // not in Statistics

    fireEvent.click(within(view.getByTestId('course-tabs')).getByTitle('Oral History'));
    await flush();
    expect(view.getByText('slow question')).toBeDefined();
    expect(view.getByText('Late answer')).toBeDefined();
  });

  it('closing a tab stops a request that is still running there', async () => {
    let aborted = false;
    vi.spyOn(llm, 'generate').mockImplementation((_p, o) => new Promise((_r, reject) => {
      o?.signal?.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('x'), { name: 'AbortError' })); });
    }));
    const view = render(<App />);
    fireEvent.change(view.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'q' } });
    await act(async () => { fireEvent.click(view.getByTitle('Send question')); });
    fireEvent.click(view.getByText('go B'));
    await flush();
    fireEvent.click(view.getByLabelText('Close chat for Oral History'));
    await flush();
    expect(aborted).toBe(true);
  });

  it('a direct (raw) conversation is kept per course too', async () => {
    vi.spyOn(llm, 'rawChat').mockResolvedValue({ text: 'Raw answer', contextMarkdown: '', requestBody: {} });
    const view = render(<App mode="gemini" />);
    await ask(view, 'raw question');
    expect(view.getByText('Raw answer')).toBeDefined();
    fireEvent.click(view.getByText('go B'));
    await flush();
    expect(view.queryByText('Raw answer')).toBeNull();
    fireEvent.click(within(view.getByTestId('course-tabs')).getByTitle('Oral History'));
    await flush();
    expect(view.getByText('raw question')).toBeDefined();
    expect(view.getByText('Raw answer')).toBeDefined();
  });
});

describe('chat session store', () => {
  it('useSessionState survives unmounting and is separate per course and name', () => {
    function Probe({ scope }: { scope: string }) {
      const [n, setN] = useSessionState(scope, 'probe.value', 0);
      return <button onClick={() => setN((v) => v + 1)}>{`count ${scope} ${n}`}</button>;
    }
    const a = render(<Probe scope="X" />);
    fireEvent.click(a.getByText('count X 0'));
    fireEvent.click(a.getByText('count X 1'));
    a.unmount();
    const again = render(<Probe scope="X" />);
    expect(again.getByText('count X 2')).toBeDefined();
    again.unmount();
    expect(render(<Probe scope="Y" />).getByText('count Y 0')).toBeDefined();
  });

  it('closeChatTab aborts controllers and forgets the state', () => {
    registerActiveCourse('Z', 'Zed');
    const abort = vi.fn();
    function Probe() {
      const ref = useSessionRef<{ abort: () => void } | null>('Z', 'tool.abort', null);
      const [m] = useSessionState<string[]>('Z', 'tool.messages', ['hi']);
      ref.current = { abort };
      return <span>{m.length}</span>;
    }
    const view = render(<Probe />);
    expect(view.getByText('1')).toBeDefined();
    closeChatTab('Z');
    expect(abort).toHaveBeenCalledTimes(1);
    resetChatSessions();
  });
});
