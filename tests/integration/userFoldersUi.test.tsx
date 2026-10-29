import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextSelectorTree } from '@/components/ContextSelectorTree';
import { buildFileTree } from '@/components/UserFilesSection';
import { storage } from '@/services/brightspace/storage';
import { enabledUserDocs, loadUserFiles, useUserFiles, userFilesStore } from '@/services/context/userFilesStore';
import { ContextSelection, createFullContextSelection } from '@/types/parser';
import type { CourseData } from '@/types/brightspace';

const course: CourseData = { orgUnitId: 'folder-ui', courseName: 'C', fetchedAt: 1, toc: [] };
const rel = (path: string, content = path) => {
  const f = new File([content], path.split('/').pop()!, { type: 'text/plain' });
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

function Harness() {
  const [selection, setSelection] = useState<ContextSelection>(() => createFullContextSelection(course));
  const { docs } = useUserFiles();
  return (
    <>
      <ContextSelectorTree courseData={course} selection={selection} onSelectionChange={setSelection} parsedDocs={enabledUserDocs(docs)} />
      <div data-testid="probe">{enabledUserDocs(docs).map((d) => d.filename).sort().join(',')}</div>
    </>
  );
}

beforeEach(async () => {
  userFilesStore.reset();
  await storage.clearAllData();
  await loadUserFiles();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('My files: folders', () => {
  it('adds a folder via the folder picker, shows the tree, toggles and removes a folder', async () => {
    const { getByTestId, getByLabelText, queryByText, container } = render(<Harness />);
    const toggle = within(container).getByRole('button', { name: /Context Scope/i });
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
    const section = within(getByTestId('user-files-section'));

    const input = getByLabelText('Choose a folder to add to the context') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [rel('Thesis/ch1.txt'), rel('Thesis/Notes/w1.md'), rel('Thesis/Notes/w2.md'), rel('Thesis/pic.png')] } });
    });
    await flush();

    expect(section.getByText('Thesis')).toBeDefined();
    expect(section.getByText('Notes')).toBeDefined();
    expect(section.getByText('w1.md')).toBeDefined();
    expect(getByTestId('add-summary').textContent).toMatch(/3/);
    expect(getByTestId('probe').textContent).toBe('ch1.txt,w1.md,w2.md');

    // collapse the sub-folder
    fireEvent.click(getByLabelText('Collapse folder Notes'));
    expect(queryByText('w1.md')).toBeNull();
    fireEvent.click(getByLabelText('Expand folder Notes'));
    expect(section.getByText('w1.md')).toBeDefined();

    // folder switch affects the whole sub-tree
    fireEvent.click(getByLabelText('Use folder Notes'));
    await flush();
    expect(getByTestId('probe').textContent).toBe('ch1.txt');
    fireEvent.click(getByLabelText('Use folder Notes'));
    await flush();
    expect(getByTestId('probe').textContent).toBe('ch1.txt,w1.md,w2.md');

    // remove the top folder
    await act(async () => { fireEvent.click(getByLabelText('Remove folder Thesis')); });
    await flush();
    expect(getByTestId('probe').textContent).toBe('');
    expect(queryByText('Thesis')).toBeNull();
  });
});

describe('buildFileTree', () => {
  it('groups by path, counts nested files and sorts folders before files', async () => {
    const { addScannedFiles } = await import('@/services/context/userFilesStore');
    const { scanFileList } = await import('@/services/context/folderIngest');
    await addScannedFiles(scanFileList([rel('A/b/c.txt'), rel('A/z.txt'), rel('A/a.txt'), rel('top.txt')]));
    const root = buildFileTree(userFilesStore.get().docs);
    expect(root.files.map((f) => f.filename)).toEqual(['top.txt']);
    const a = root.folders[0];
    expect([a.name, a.fileCount, a.enabledCount]).toEqual(['A', 3, 3]);
    expect(a.files.map((f) => f.filename)).toEqual(['a.txt', 'z.txt']);
    expect(a.folders[0].path).toBe('A/b');
  });
});
