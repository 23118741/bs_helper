import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storage } from '@/services/brightspace/storage';
import { buildContextBundle, serializeToMarkdown } from '@/services/context/contextSerializer';
import { inspectContext } from '@/services/context/contextInspector';
import { scanFileList } from '@/services/context/folderIngest';
import { selectContext } from '@/services/context/retrieval';
import { MAX_USER_FILES, USER_FILES_SCOPE, userModulePath } from '@/services/context/userFiles';
import {
  addScannedFiles,
  addUserFiles,
  enabledUserDocs,
  inFolder,
  loadUserFiles,
  removeUserFolder,
  setUserFolderEnabled,
  userFilesStore,
} from '@/services/context/userFilesStore';
import { createFullContextSelection } from '@/types/parser';
import type { CourseData } from '@/types/brightspace';

const rel = (path: string, content = path) => {
  const f = new File([content], path.split('/').pop()!, { type: 'text/plain' });
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
};
const course: CourseData = { orgUnitId: 'fc', courseName: 'C', fetchedAt: 1, toc: [] };

beforeEach(async () => {
  userFilesStore.reset();
  await storage.clearAllData();
  await loadUserFiles();
});

const names = () => userFilesStore.get().docs.map((d) => `${d.metadata.userPath ?? ''}|${d.filename}`).sort();

describe('adding a folder keeps its structure', () => {
  it('stores every file with its folder path, persisted and restored after a reload', async () => {
    const res = await addScannedFiles(scanFileList([rel('Thesis/ch1.txt'), rel('Thesis/Notes/w1.md'), rel('Thesis/Notes/w2.md'), rel('Thesis/img.png'), rel('Loose/readme.txt')]));
    expect(res.added).toHaveLength(4);
    expect(res.folders.sort()).toEqual(['Loose', 'Thesis']);
    expect(res.skipped).toEqual({ count: 1, byExtension: { '.png': 1 } });
    expect(res.errors).toEqual([]);
    expect(names()).toEqual(['Loose|readme.txt', 'Thesis/Notes|w1.md', 'Thesis/Notes|w2.md', 'Thesis|ch1.txt']);

    userFilesStore.reset();
    await loadUserFiles();
    expect(names()).toEqual(['Loose|readme.txt', 'Thesis/Notes|w1.md', 'Thesis/Notes|w2.md', 'Thesis|ch1.txt']);
    expect((await storage.getParsedDocumentsForCourse(USER_FILES_SCOPE)).length).toBe(4);
  });

  it('the same file name in different folders are different files; the same folder added twice is not doubled', async () => {
    await addScannedFiles(scanFileList([rel('A/notes.txt', 'one'), rel('B/notes.txt', 'one')]));
    expect(names()).toEqual(['A|notes.txt', 'B|notes.txt']);
    const again = await addScannedFiles(scanFileList([rel('A/notes.txt', 'one'), rel('B/notes.txt', 'one'), rel('B/new.txt', 'fresh')]));
    expect(again.duplicates).toBe(2);
    expect(again.added.map((d) => d.filename)).toEqual(['new.txt']);
    expect(userFilesStore.get().docs).toHaveLength(3);
  });

  it('reports files that cannot be read with their path, and adds the rest', async () => {
    const res = await addScannedFiles(scanFileList([rel('D/good.txt'), rel('D/blank.txt', '   ')]));
    expect(res.added).toHaveLength(1);
    expect(res.errors).toEqual([{ name: 'D/blank.txt', message: expect.stringMatching(/No text could be extracted/) }]);
  });

  it('reports progress while adding', async () => {
    const seen: Array<[number, number]> = [];
    await addScannedFiles(scanFileList(Array.from({ length: 7 }, (_, i) => rel(`P/f${i}.txt`))), { onProgress: (d, t) => seen.push([d, t]) });
    expect(seen[seen.length - 1]).toEqual([7, 7]);
    expect(seen.map((s) => s[0])).toEqual([...seen.map((s) => s[0])].sort((a, b) => a - b));
  });

  it('stops at the file limit and at the total size, without failing', async () => {
    const many = Array.from({ length: MAX_USER_FILES + 3 }, (_, i) => rel(`Big/f${i}.txt`, `content ${i}`));
    const res = await addScannedFiles(scanFileList(many));
    expect(res.added).toHaveLength(MAX_USER_FILES);
    expect(res.errors).toHaveLength(3);
    expect(res.errors[0].message).toMatch(/Limit reached/);

    userFilesStore.reset();
    await storage.clearAllData();
    await loadUserFiles();
    const big = Array.from({ length: 20 }, (_, i) => {
      const f = rel(`Huge/f${i}.txt`, `body ${i}`);
      Object.defineProperty(f, 'size', { value: 24 * 1024 * 1024 });
      return f;
    });
    const sized = await addScannedFiles(scanFileList(big));
    expect(sized.added).toHaveLength(16);
    expect(sized.truncated).toBe(true);
    expect(sized.errors[0].message).toMatch(/total size/);
  });

  it('loose files still work next to folders', async () => {
    await addUserFiles([new File(['top'], 'top.txt')]);
    await addScannedFiles(scanFileList([rel('F/in.txt')]));
    expect(names()).toEqual(['F|in.txt', '|top.txt']);
  });
});

describe('folder actions', () => {
  const seed = () => addScannedFiles(scanFileList([rel('T/a.txt'), rel('T/Sub/b.txt'), rel('T/Sub/Deep/c.txt'), rel('Other/d.txt'), rel('Tx/e.txt')]));

  it('inFolder is exact: "T" contains T/Sub but not "Tx"', async () => {
    await seed();
    const docs = userFilesStore.get().docs;
    expect(docs.filter((d) => inFolder(d, 'T')).map((d) => d.filename).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(docs.filter((d) => inFolder(d, 'T/Sub')).map((d) => d.filename).sort()).toEqual(['b.txt', 'c.txt']);
  });

  it('switching a folder off/on affects everything inside it (also sub-folders) and persists', async () => {
    await seed();
    await setUserFolderEnabled('T/Sub', false);
    expect(enabledUserDocs(userFilesStore.get().docs).map((d) => d.filename).sort()).toEqual(['a.txt', 'd.txt', 'e.txt']);
    userFilesStore.reset();
    await loadUserFiles();
    expect(enabledUserDocs(userFilesStore.get().docs).map((d) => d.filename).sort()).toEqual(['a.txt', 'd.txt', 'e.txt']);
    await setUserFolderEnabled('T', true);
    expect(enabledUserDocs(userFilesStore.get().docs)).toHaveLength(5);
  });

  it('removing a folder removes its files and sub-folders from the store and from storage, nothing else', async () => {
    await seed();
    await removeUserFolder('T');
    expect(names()).toEqual(['Other|d.txt', 'Tx|e.txt']);
    expect((await storage.getParsedDocumentsForCourse(USER_FILES_SCOPE)).map((d) => d.filename).sort()).toEqual(['d.txt', 'e.txt']);
  });
});

describe('the AI sees the folder structure', () => {
  it('module path "My files > Thesis > Notes" in the context, the serialized text and the inspector', async () => {
    await addScannedFiles(scanFileList([rel('Thesis/Notes/week1.md', 'Interview with Anna about oral history'), rel('top.txt', 'a loose note')]));
    const docs = enabledUserDocs(userFilesStore.get().docs);
    const bundle = buildContextBundle(course, createFullContextSelection(course), docs);
    expect(bundle.documents.map((d) => d.modulePath).sort()).toEqual(['My files', 'My files > Thesis > Notes']);
    expect(serializeToMarkdown(bundle)).toContain('My files > Thesis > Notes > week1.md');
    expect(userModulePath('Thesis/Notes')).toBe('My files > Thesis > Notes');
    expect(userModulePath('')).toBe('My files');
    expect(inspectContext(course, createFullContextSelection(course), docs).map((r) => r.modulePath).sort()).toEqual(['My files', 'My files > Thesis > Notes']);
  });

  it('a question that names the folder finds the files in it (folder names count in the search)', async () => {
    const filler = 'general reading text about nothing in particular '.repeat(30);
    await addScannedFiles(scanFileList([rel('Thesis/Interviews/anna.txt', `${filler} schedule of the interview`), rel('Recipes/pasta.txt', `${filler} schedule of the dinner`)]));
    const docs = enabledUserDocs(userFilesStore.get().docs);
    const bundle = buildContextBundle(course, createFullContextSelection(course), docs);
    const r = selectContext(bundle, 'What is the schedule in my thesis interviews folder?');
    expect(r.bundle.documents[0].title).toBe('anna.txt');
  });
});

describe('docs are never mutated by the folder helpers', () => {
  it('keeps unrelated documents referentially stable when a folder is toggled', async () => {
    await addScannedFiles(scanFileList([rel('A/x.txt'), rel('B/y.txt')]));
    const before = userFilesStore.get().docs.find((d) => d.filename === 'y.txt');
    await setUserFolderEnabled('A', false);
    expect(userFilesStore.get().docs.find((d) => d.filename === 'y.txt')).toBe(before);
    vi.restoreAllMocks();
  });
});
