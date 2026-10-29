import { describe, expect, it } from 'vitest';
import { dropHasFolder, isIgnoredName, scanDataTransfer, scanFileList } from '@/services/context/folderIngest';
import { MAX_FOLDER_ENTRIES } from '@/services/context/userFiles';

const rel = (path: string, content = 'text') => {
  const f = new File([content], path.split('/').pop()!, { type: 'text/plain' });
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
};

describe('scanFileList (the "choose folder" dialog)', () => {
  it('keeps the folder structure and skips what is not worth reading, counting it', () => {
    const scan = scanFileList([
      rel('Thesis/chapter1.txt'),
      rel('Thesis/Notes/week1.md'),
      rel('Thesis/Notes/week2.md'),
      rel('Thesis/Notes/Old/draft.docx'),
      rel('Thesis/figure1.png'),
      rel('Thesis/figure2.png'),
      rel('Thesis/archive.zip'),
      rel('Thesis/.DS_Store'),
      rel('Thesis/~$temp.docx'),
      rel('Thesis/node_modules/pkg/readme.md'),
      rel('Thesis/.git/config'),
    ]);
    expect(scan.files.map((f) => `${f.path}|${f.file.name}`)).toEqual([
      'Thesis|chapter1.txt',
      'Thesis/Notes|week1.md',
      'Thesis/Notes|week2.md',
      'Thesis/Notes/Old|draft.docx',
    ]);
    expect(scan.files.every((f) => f.fromFolder)).toBe(true);
    expect(scan.folders).toEqual(['Thesis']);
    expect(scan.skipped.count).toBe(7);
    expect(scan.skipped.byExtension).toEqual({ '.png': 2, '.zip': 1 });
    expect(scan.truncated).toBe(false);
  });

  it('a loose file (no relative path) stays at the top level and is not filtered silently', () => {
    const loose = new File(['x'], 'photo.png');
    const scan = scanFileList([loose]);
    expect(scan.files).toEqual([{ file: loose, path: '', fromFolder: false }]);
    expect(scan.skipped.count).toBe(0); // the add step reports it as an error instead
  });

  it('several top-level folders at once', () => {
    const scan = scanFileList([rel('A/x.txt'), rel('B/y.txt'), rel('B/sub/z.txt')]);
    expect(scan.folders.sort()).toEqual(['A', 'B']);
    expect(scan.files.map((f) => f.path)).toEqual(['A', 'B', 'B/sub']);
  });

  it('stops at the entry limit and says so', () => {
    const many = Array.from({ length: MAX_FOLDER_ENTRIES + 5 }, (_, i) => rel(`Big/f${i}.txt`));
    const scan = scanFileList(many);
    expect(scan.truncated).toBe(true);
    expect(scan.files.length).toBe(MAX_FOLDER_ENTRIES);
  });

  it('ignores hidden, system and temporary names', () => {
    for (const n of ['.hidden', '.DS_Store', 'Thumbs.db', 'desktop.ini', '~$lock.docx']) expect(isIgnoredName(n)).toBe(true);
    expect(isIgnoredName('notes.txt')).toBe(false);
  });
});

// ---- drag & drop: FileSystemEntry fakes ----
const fileEntry = (name: string, content = 'text') => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (ok: (f: File) => void) => ok(new File([content], name)),
});
const dirEntry = (name: string, children: any[], batch = 100) => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let i = 0;
    return {
      readEntries: (ok: (e: any[]) => void) => {
        const part = children.slice(i, i + batch);
        i += batch;
        ok(part);
      },
    };
  },
});
const transfer = (entries: any[], loose: File[] = []) =>
  ({
    items: [
      ...entries.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e, getAsFile: () => null })),
      ...loose.map((f) => ({ kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => f })),
    ],
    files: [],
    types: ['Files'],
  }) as unknown as DataTransfer;

describe('scanDataTransfer (dropping folders)', () => {
  it('walks nested folders and keeps their paths', async () => {
    const dt = transfer([
      dirEntry('Courses', [
        fileEntry('overview.md'),
        dirEntry('History', [fileEntry('lecture1.txt'), fileEntry('map.jpg'), dirEntry('Readings', [fileEntry('paper.html')])]),
        fileEntry('.hidden.txt'),
      ]),
    ]);
    expect(dropHasFolder(dt)).toBe(true);
    const scan = await scanDataTransfer(dt);
    expect(scan.files.map((f) => `${f.path}|${f.file.name}`).sort()).toEqual([
      'Courses/History/Readings|paper.html',
      'Courses/History|lecture1.txt',
      'Courses|overview.md',
    ]);
    expect(scan.folders).toEqual(['Courses']);
    expect(scan.skipped.byExtension).toEqual({ '.jpg': 1 });
    expect(scan.skipped.count).toBe(2); // the jpg and the hidden file
  });

  it('reads folders with more than 100 entries (readEntries returns them in batches)', async () => {
    const many = Array.from({ length: 250 }, (_, i) => fileEntry(`n${i}.txt`));
    const scan = await scanDataTransfer(transfer([dirEntry('Notes', many, 100)]));
    expect(scan.files).toHaveLength(250);
  });

  it('a mix of a folder, a loose entry file and a plain file', async () => {
    const dt = transfer([dirEntry('Dir', [fileEntry('a.txt')]), fileEntry('top.txt')], [new File(['x'], 'plain.md')]);
    const scan = await scanDataTransfer(dt);
    expect(scan.files.map((f) => `${f.path}|${f.file.name}|${f.fromFolder}`).sort()).toEqual([
      'Dir|a.txt|true',
      '|plain.md|false',
      '|top.txt|false',
    ]);
  });

  it('unreadable entries are skipped, not fatal; skips junk directories', async () => {
    const broken = { isFile: true, isDirectory: false, name: 'broken.txt', file: (_ok: unknown, fail: (e: unknown) => void) => fail(new Error('denied')) };
    const scan = await scanDataTransfer(transfer([dirEntry('D', [broken, fileEntry('ok.txt'), dirEntry('node_modules', [fileEntry('x.md')])])]));
    expect(scan.files.map((f) => f.file.name)).toEqual(['ok.txt']);
    expect(scan.skipped.count).toBe(2);
  });

  it('dropHasFolder is false for plain files', () => {
    expect(dropHasFolder(transfer([fileEntry('a.txt')]))).toBe(false);
    expect(dropHasFolder(null)).toBe(false);
  });
});
