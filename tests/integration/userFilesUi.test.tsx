import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPlugin } from '@/components/actions/ChatPlugin';
import { ContextSelectorTree } from '@/components/ContextSelectorTree';
import { storage } from '@/services/brightspace/storage';
import { USER_FILES_SCOPE } from '@/services/context/userFiles';
import { enabledUserDocs, loadUserFiles, useUserFiles, userFilesStore } from '@/services/context/userFilesStore';
import { llm } from '@/services/llm/llmClient';
import { ContextSelection, createFullContextSelection } from '@/types/parser';
import type { CourseData } from '@/types/brightspace';

const COURSE = 'ui-files-course';
const course: CourseData = {
  orgUnitId: COURSE,
  courseName: 'Test Course',
  fetchedAt: Date.now(),
  overview: { title: 'O', htmlContent: '', textDescription: 'overview text' },
  toc: [],
};
const mk = (content: string, name: string, type = 'text/plain') => new File([content], name, { type });
/** The context panel is collapsed by default in the side panel; open it to reach My files. */
const expand = (root: HTMLElement) => {
  const toggle = within(root).getByRole('button', { name: /Context Scope/i });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 25)); });

beforeEach(async () => {
  userFilesStore.reset();
  await storage.clearAllData();
  await loadUserFiles();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Tree + a probe that shows which user docs reach the tools. */
function Harness() {
  const [selection, setSelection] = useState<ContextSelection>(() => createFullContextSelection(course));
  const { docs } = useUserFiles();
  return (
    <>
      <ContextSelectorTree courseData={course} selection={selection} onSelectionChange={setSelection} parsedDocs={enabledUserDocs(docs)} />
      <div data-testid="probe">{enabledUserDocs(docs).map((d) => d.filename).join(',')}</div>
      <div data-testid="include">{String(selection.includeUserFiles)}</div>
    </>
  );
}

describe('Context → My files section', () => {
  it('adds files via the picker, lists them, toggles and removes them', async () => {
    const { getByTestId, getByLabelText, container } = render(<Harness />);
    expand(container);
    const section = within(getByTestId('user-files-section'));
    expect(section.getByText(/Drop files or a whole folder here/)).toBeDefined();

    const input = getByLabelText('Choose files to add to the context') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [mk('my lecture notes', 'notes.txt'), mk('x', 'photo.png', 'image/png')] } });
    });
    await flush();

    expect(section.getByText('notes.txt')).toBeDefined();
    expect(getByTestId('probe').textContent).toBe('notes.txt');
    // the rejected file is explained, the good one still added
    expect(within(getByTestId('user-files-section')).getByRole('alert').textContent).toMatch(/photo\.png.*Unsupported file type/);

    // switch the file off: stays listed, leaves the context
    fireEvent.click(getByLabelText('Use notes.txt'));
    await flush();
    expect(section.getByText('notes.txt')).toBeDefined();
    expect(getByTestId('probe').textContent).toBe('');
    fireEvent.click(getByLabelText('Use notes.txt'));
    await flush();
    expect(getByTestId('probe').textContent).toBe('notes.txt');

    // master switch
    fireEvent.click(getByLabelText('Include my files in the context'));
    expect(getByTestId('include').textContent).toBe('false');

    // remove
    await act(async () => { fireEvent.click(getByLabelText('Remove notes.txt')); });
    await flush();
    expect(section.queryByText('notes.txt')).toBeNull();
    expect((await storage.getParsedDocumentsForCourse(USER_FILES_SCOPE)).length).toBe(0);
  });

  it('accepts files dropped on the section, and adding a file switches the section back on', async () => {
    const { getByTestId, container } = render(<Harness />);
    expand(container);
    fireEvent.click(within(getByTestId('user-files-section')).getByLabelText('Include my files in the context'));
    expect(getByTestId('include').textContent).toBe('false');

    await act(async () => {
      fireEvent.drop(getByTestId('user-files-section'), { dataTransfer: { files: [mk('dropped text', 'dropped.md')], types: ['Files'] } });
    });
    await flush();
    expect(getByTestId('probe').textContent).toBe('dropped.md');
    expect(getByTestId('include').textContent).toBe('true');
  });

  it('stored files come back after a reload', async () => {
    const first = render(<Harness />);
    expand(first.container);
    await act(async () => {
      fireEvent.change(first.getByLabelText('Choose files to add to the context'), { target: { files: [mk('persist me', 'keep.txt')] } });
    });
    await flush();
    first.unmount();

    userFilesStore.reset();
    await loadUserFiles();
    const second = render(<Harness />);
    expand(second.container);
    expect(within(second.getByTestId('user-files-section')).getByText('keep.txt')).toBeDefined();
  });
});

describe('attaching files straight to a chat message', () => {
  const setup = (Plugin = ChatPlugin, mode: 'backend' | 'gemini' = 'backend') => {
    const gen = vi.spyOn(llm, 'generate').mockResolvedValue({ text: 'Answer', mode: 'gemini', usage: { totalTokens: 5 } });
    const raw = vi.spyOn(llm, 'rawChat').mockResolvedValue({ text: 'Raw answer', contextMarkdown: '', requestBody: {} });
    const view = render(<Plugin.component courseData={course} selection={createFullContextSelection(course)} currentMode={mode} />);
    return { gen, raw, ...view };
  };
  const send = async (view: ReturnType<typeof setup>, text: string) => {
    fireEvent.change(view.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: text } });
    await act(async () => { fireEvent.click(view.getByTitle('Send question')); });
    await flush();
  };

  it('attach → chip → pinned into that request → shown on the message → chips cleared', async () => {
    const view = setup();
    await act(async () => {
      fireEvent.change(view.getByLabelText('Choose files to attach'), { target: { files: [mk('my draft about gardening', 'draft.txt')] } });
    });
    await flush();
    expect(within(view.getByTestId('attachment-chips')).getByText('draft.txt')).toBeDefined();

    await send(view, 'Give feedback on my draft');
    const options = view.gen.mock.calls[0][1] as any;
    const pinned = options.contextBundle.documents.find((d: any) => d.title === 'draft.txt');
    expect(pinned).toMatchObject({ pinned: true, content: expect.stringContaining('gardening'), modulePath: 'Attached to this question' });

    // shown under the user's message, chips cleared for the next question
    expect(view.getByText('draft.txt', { selector: 'span.truncate' })).toBeDefined();
    expect(view.queryByTestId('attachment-chips')).toBeNull();
    await send(view, 'And another question');
    expect((view.gen.mock.calls[1][1] as any).contextBundle.documents.some((d: any) => d.title === 'draft.txt')).toBe(false);
  });

  it('removing a chip keeps it out of the request; a failed file shows its reason', async () => {
    const view = setup();
    await act(async () => {
      fireEvent.change(view.getByLabelText('Choose files to attach'), { target: { files: [mk('keep', 'keep.txt'), mk('x', 'pic.png', 'image/png')] } });
    });
    await flush();
    expect(view.getByText(/Unsupported file type/)).toBeDefined();
    fireEvent.click(view.getByLabelText('Remove keep.txt'));
    await send(view, 'question');
    expect((view.gen.mock.calls[0][1] as any).contextBundle.documents.some((d: any) => d.title === 'keep.txt')).toBe(false);
  });

  it('an attached file is ALSO added to My files automatically and stays for the rest of the session', async () => {
    const view = setup();
    await act(async () => {
      fireEvent.change(view.getByLabelText('Choose files to attach'), { target: { files: [mk('keep this one', 'kept.txt')] } });
    });
    await flush();
    // in the context panel store right away, chip shows the quiet "also added" marker
    expect(userFilesStore.get().docs.map((d) => d.filename)).toEqual(['kept.txt']);
    expect(within(view.getByTestId('attachment-chips')).getByTitle('Also added to My files in the context panel')).toBeDefined();
    expect((await storage.getParsedDocumentsForCourse(USER_FILES_SCOPE)).map((d) => d.filename)).toEqual(['kept.txt']);

    // question 1 pins it, question 2 (chips cleared) still gets it through My files
    await send(view, 'first question');
    view.unmount();
    const gen = vi.spyOn(llm, 'generate').mockResolvedValue({ text: 'A', mode: 'gemini', usage: { totalTokens: 1 } });
    const again = render(
      <ChatPlugin.component courseData={course} selection={createFullContextSelection(course)} currentMode="backend" parsedDocs={enabledUserDocs(userFilesStore.get().docs)} />
    );
    fireEvent.change(again.getByPlaceholderText(/Ask a follow-up question/i), { target: { value: 'summarize kept.txt' } });
    await act(async () => { fireEvent.click(again.getByTitle('Send question')); });
    await flush();
    const docs = (gen.mock.calls[0][1] as any).contextBundle.documents.filter((d: any) => d.title === 'kept.txt');
    expect(docs).toHaveLength(1);
    expect(docs[0].modulePath).toBe('My files');
  });

  it('attaching the same file twice does not create a second entry in My files', async () => {
    const view = setup();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        fireEvent.change(view.getByLabelText('Choose files to attach'), { target: { files: [mk('same content', 'same.txt')] } });
      });
      await flush();
    }
    expect(userFilesStore.get().docs).toHaveLength(1);
  });

  it('files shown in My files stay when the student switches course', async () => {
    const other: CourseData = { ...course, orgUnitId: 'other-course', courseName: 'Other' };
    const first = render(<Harness />);
    expand(first.container);
    await act(async () => {
      fireEvent.change(first.getByLabelText('Choose files to add to the context'), { target: { files: [mk('shared notes', 'shared.txt')] } });
    });
    await flush();
    first.unmount();

    // switching course: the context panel of the new course lists the same files, still switched on
    await loadUserFiles(other.orgUnitId);
    const second = render(
      <ContextSelectorTree courseData={other} selection={createFullContextSelection(other)} onSelectionChange={() => {}} parsedDocs={enabledUserDocs(userFilesStore.get().docs)} />
    );
    expand(second.container);
    const section = within(second.getByTestId('user-files-section'));
    expect(section.getByText('shared.txt')).toBeDefined();
    expect((section.getByLabelText('Use shared.txt') as HTMLInputElement).checked).toBe(true);
    expect(section.getByText(/in every course/)).toBeDefined();
  });

  it('accepts files dropped on the chat and pasted into the input', async () => {
    const view = setup();
    await act(async () => {
      fireEvent.drop(view.getByTestId('chat-shell'), { dataTransfer: { files: [mk('dropped content', 'dropped.txt')], types: ['Files'] } });
    });
    await flush();
    expect(within(view.getByTestId('attachment-chips')).getByText('dropped.txt')).toBeDefined();

    await act(async () => {
      fireEvent.paste(view.getByPlaceholderText(/Ask a follow-up question/i), { clipboardData: { files: [mk('pasted content', 'pasted.txt')] } });
    });
    await flush();
    expect(within(view.getByTestId('attachment-chips')).getByText('pasted.txt')).toBeDefined();
  });

  it('works the same in Raw Chat', async () => {
    const view = setup(ChatPlugin, 'gemini');
    await act(async () => {
      fireEvent.change(view.getByLabelText('Choose files to attach'), { target: { files: [mk('raw attached text', 'raw.txt')] } });
    });
    await flush();
    await send(view, 'what is in my file?');
    const bundle = (view.raw.mock.calls[0][1] as any).contextBundle;
    expect(bundle.documents.find((d: any) => d.title === 'raw.txt')).toMatchObject({ pinned: true });
    await waitFor(() => expect(view.getByText('raw.txt', { selector: 'span.truncate' })).toBeDefined());
  });
});
