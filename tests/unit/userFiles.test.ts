import { beforeEach, describe, expect, it } from 'vitest';
import { storage } from '@/services/brightspace/storage';
import { buildContextBundle, serializeToMarkdown } from '@/services/context/contextSerializer';
import { selectRelevantDocuments } from '@/services/context/relevance';
import {
  MAX_USER_FILE_CHARS,
  MAX_USER_FILES,
  UserFileError,
  isUserDoc,
  parseUserFile,
  withPinnedDocuments,
} from '@/services/context/userFiles';
import {
  addUserFiles,
  adoptUserDoc,
  enabledUserDocs,
  loadUserFiles,
  removeUserFile,
  setUserFileEnabled,
  userFilesStore,
} from '@/services/context/userFilesStore';
import { createFullContextSelection } from '@/types/parser';
import type { CourseData } from '@/types/brightspace';

const file = (content: string | Uint8Array, name: string, type = 'text/plain') => new File([content as BlobPart], name, { type });
const COURSE = 'user-files-course';
const course: CourseData = { orgUnitId: COURSE, courseName: 'C', fetchedAt: 1, toc: [] };

beforeEach(async () => {
  userFilesStore.reset();
  await storage.clearAllData();
});

describe('parseUserFile', () => {
  it.each([
    ['notes.txt', 'plain notes about Raft'],
    ['readme.md', '# Title\n\nSome *markdown* text'],
    ['data.csv', 'a,b\n1,2'],
    ['data.json', '{"hello":"world"}'],
  ])('parses %s', async (name, content) => {
    const doc = await parseUserFile(file(content, name));
    expect(doc.filename).toBe(name);
    expect(doc.topicId.startsWith('user:')).toBe(true);
    expect(isUserDoc(doc)).toBe(true);
    expect(doc.extractedText.length).toBeGreaterThan(0);
    expect(doc.metadata.tokenEstimate).toBeGreaterThan(0);
  });

  it('parses HTML into text', async () => {
    const doc = await parseUserFile(file('<html><body><h1>Heading</h1><p>Body text</p></body></html>', 'page.html', 'text/html'));
    expect(doc.extractedText).toContain('Heading');
    expect(doc.extractedText).toContain('Body text');
  });

  it('rejects unsupported, legacy, empty and oversized files with readable messages', async () => {
    const msg = async (f: File) => (await parseUserFile(f).catch((e) => e)) as UserFileError;
    expect((await msg(file('x', 'photo.png', 'image/png'))).message).toMatch(/Unsupported file type/);
    expect((await msg(file('x', 'old.doc'))).message).toMatch(/Old Office formats/);
    expect((await msg(file('x', 'old.ppt'))).message).toMatch(/\.pptx/);
    expect((await msg(file('x', 'sheet.xlsx'))).message).toMatch(/csv/i);
    expect((await msg(file('', 'empty.txt'))).message).toMatch(/empty/i);
    const big = file('x', 'big.txt');
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    expect((await msg(big)).message).toMatch(/too large/i);
    expect((await msg(file('   \n  ', 'blank.txt'))).message).toMatch(/No text could be extracted/);
    expect(await msg(file('x', 'a.txt'))).not.toBeInstanceOf(UserFileError);
  });

  it('truncates very long files and warns', async () => {
    const doc = await parseUserFile(file('word '.repeat(100_000), 'long.txt'));
    expect(doc.extractedText.length).toBeLessThanOrEqual(MAX_USER_FILE_CHARS + 200);
    expect(doc.extractedText).toContain('[Truncated');
    expect(doc.metadata.warnings?.[0]).toMatch(/Truncated/);
  });
});

describe('user files store (the student\'s files belong to the student, not to a course)', () => {
  it('adds, persists, toggles, removes; errors are reported per file', async () => {
    await loadUserFiles();
    const res = await addUserFiles([file('first file text', 'a.txt'), file('x', 'bad.png', 'image/png'), file('second file text', 'b.md')]);
    expect(res.added.map((d) => d.filename)).toEqual(['a.txt', 'b.md']);
    expect(res.errors).toEqual([{ name: 'bad.png', message: expect.stringMatching(/Unsupported/) }]);
    expect(userFilesStore.get().docs).toHaveLength(2);

    // survives a reload
    userFilesStore.reset();
    await loadUserFiles();
    expect(userFilesStore.get().docs.map((d) => d.filename).sort()).toEqual(['a.txt', 'b.md']);

    // the order after a reload is not fixed: pick the file by name
    const a = userFilesStore.get().docs.find((d) => d.filename === 'a.txt')!;
    await setUserFileEnabled(a.topicId, false);
    expect(enabledUserDocs(userFilesStore.get().docs).map((d) => d.filename)).toEqual(['b.md']);
    userFilesStore.reset();
    await loadUserFiles();
    expect(userFilesStore.get().docs.find((d) => d.filename === 'a.txt')?.metadata.userDisabled).toBe(true);

    await removeUserFile(a.topicId);
    expect(userFilesStore.get().docs.map((d) => d.filename)).toEqual(['b.md']);
  });

  it('files stay when the student switches course', async () => {
    await loadUserFiles();
    await addUserFiles([file('my notes', 'notes.txt')]);
    // switching course loads that course's data but never resets the student's files
    await loadUserFiles('some-other-course');
    expect(userFilesStore.get().docs.map((d) => d.filename)).toEqual(['notes.txt']);
    await storage.clearCourseCache('some-other-course');
    await storage.clearCourseCache(COURSE);
    userFilesStore.reset();
    await loadUserFiles(COURSE);
    expect(userFilesStore.get().docs.map((d) => d.filename)).toEqual(['notes.txt']);
  });

  it('picks up files an earlier version stored under a course', async () => {
    await storage.saveParsedDocument(
      { topicId: `user:${COURSE}:legacy`, filename: 'old.txt', fileType: 'txt', extractedText: 'legacy', metadata: { extractedAt: 1 } },
      COURSE
    );
    await loadUserFiles(COURSE);
    expect(userFilesStore.get().docs.map((d) => d.filename)).toEqual(['old.txt']);
  });

  it('adopts an attachment once: identical files are reused, not duplicated', async () => {
    await loadUserFiles();
    const doc = await parseUserFile(file('attached text', 'att.txt'));
    const first = await adoptUserDoc(doc);
    expect(first).toMatchObject({ added: true });
    const again = await parseUserFile(file('attached text', 'att.txt')); // same file, new parse
    const second = await adoptUserDoc(again);
    expect(second.added).toBe(false);
    expect(second.doc.topicId).toBe(first.doc.topicId);
    expect(userFilesStore.get().docs).toHaveLength(1);
  });

  it('stops at the file limit without failing', async () => {
    await loadUserFiles();
    const many = Array.from({ length: MAX_USER_FILES + 2 }, (_, i) => file(`content ${i}`, `f${i}.txt`));
    const res = await addUserFiles(many);
    expect(res.added).toHaveLength(MAX_USER_FILES);
    expect(res.errors).toHaveLength(2);
    const extra = await adoptUserDoc(await parseUserFile(file('one more', 'more.txt')));
    expect(extra).toMatchObject({ added: false, reason: expect.stringMatching(/full/) });
  });
});

describe('context bundle with user files', () => {
  const userDoc = (over: Record<string, unknown> = {}) => ({
    topicId: 'user:1',
    filename: 'my-notes.txt',
    fileType: 'txt',
    extractedText: 'My own notes about the exam',
    metadata: { extractedAt: 1, ...over },
  });

  it('puts user files under "My files" and serializes them', () => {
    const bundle = buildContextBundle(course, createFullContextSelection(course), [userDoc()]);
    expect(bundle.documents).toEqual([expect.objectContaining({ title: 'my-notes.txt', modulePath: 'My files' })]);
    expect(serializeToMarkdown(bundle)).toContain('My own notes about the exam');
  });

  it('leaves them out when switched off per file or for the whole section', () => {
    const sel = createFullContextSelection(course);
    expect(buildContextBundle(course, sel, [userDoc({ userDisabled: true })]).documents).toHaveLength(0);
    expect(buildContextBundle(course, { ...sel, includeUserFiles: false }, [userDoc()]).documents).toHaveLength(0);
    // undefined means on (older saved selections)
    const { includeUserFiles: _omit, ...legacy } = sel;
    expect(buildContextBundle(course, legacy as typeof sel, [userDoc()]).documents).toHaveLength(1);
  });
});

describe('pinned (attached) documents', () => {
  const base = {
    courseInfo: { orgUnitId: '1', courseName: 'C', exportedAt: '' },
    documents: [
      { title: 'Raft.pdf', type: 'pdf', content: 'Raft consensus leader election. '.repeat(30), topicId: 'a', modulePath: 'W1' },
      { title: 'Net.pdf', type: 'pdf', content: 'TCP UDP sockets. '.repeat(30), topicId: 'b', modulePath: 'W2' },
    ],
  };
  const attached = { title: 'draft.docx', type: 'docx', content: 'Completely unrelated attached text about gardening.', topicId: 'user:1:x', modulePath: 'Attached to this question' };

  it('are always sent, even when the question matches other documents, and are never listed as omitted', () => {
    const bundle = withPinnedDocuments(base, [attached]);
    const { bundle: out, stats } = selectRelevantDocuments(bundle, 'explain leader election');
    expect(out.documents.map((d) => d.title).sort()).toEqual(['Raft.pdf', 'draft.docx']);
    expect(stats.includedTopicIds).toContain('user:1:x');
    expect(out.omittedDocuments?.map((d) => d.title)).toEqual(['Net.pdf']);
  });

  it('replace a course copy of the same file instead of duplicating it', () => {
    const withCopy = { ...base, documents: [...base.documents, { ...attached, modulePath: 'My files', pinned: false }] };
    const bundle = withPinnedDocuments(withCopy, [attached]);
    expect(bundle.documents.filter((d) => d.topicId === 'user:1:x')).toHaveLength(1);
    expect(bundle.documents.find((d) => d.topicId === 'user:1:x')?.pinned).toBe(true);
  });

  it('count against the budget first', () => {
    const bundle = withPinnedDocuments(base, [{ ...attached, content: 'x'.repeat(4000) }]);
    const { bundle: out } = selectRelevantDocuments(bundle, 'explain leader election', { tokenBudget: 1100 });
    // 1000 tokens pinned leaves no room for the 2nd best match beyond the best one
    expect(out.documents.map((d) => d.title)).toContain('draft.docx');
  });
});
