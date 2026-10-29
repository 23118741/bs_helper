/**
 * src/services/context/folderIngest.ts
 * Reads a whole folder (with its sub-folders) into a flat list of files that remember their folder
 * path: from the "choose folder" dialog (webkitRelativePath) or from a drag & drop of folders
 * (FileSystemEntry). Hidden files, system files and unsupported types are skipped and counted.
 */

import {
  ACCEPTED_EXTENSIONS,
  MAX_FOLDER_DEPTH,
  MAX_FOLDER_ENTRIES,
} from './userFiles';

export interface CollectedFile {
  file: File;
  /** Folder path without the file name, '/'-separated; '' for a file that was added loose. */
  path: string;
  /** From a folder walk: unsupported types are skipped quietly instead of reported one by one. */
  fromFolder: boolean;
}

export interface FolderScan {
  files: CollectedFile[];
  /** Skipped without looking: unsupported types by extension, hidden/system files. */
  skipped: { count: number; byExtension: Record<string, number> };
  /** True when the walk stopped early (too many entries). */
  truncated: boolean;
  /** Name of the top-level folder(s) that were added. */
  folders: string[];
}

const SKIP_DIRS = new Set(['node_modules', '.git', '__macosx', '.svn', '.idea', '.vscode']);
const SKIP_FILES = /^(thumbs\.db|desktop\.ini|\.ds_store)$/i;

export const extensionOf = (name: string): string => {
  const m = /\.([a-z0-9]{1,6})$/i.exec(name);
  return m ? `.${m[1].toLowerCase()}` : '';
};

/** Hidden, system and temporary files that are never worth reading. */
export function isIgnoredName(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$') || SKIP_FILES.test(name);
}

const emptyScan = (): FolderScan => ({ files: [], skipped: { count: 0, byExtension: {} }, truncated: false, folders: [] });

function skip(scan: FolderScan, name: string): void {
  scan.skipped.count++;
  const ext = extensionOf(name) || '(no extension)';
  scan.skipped.byExtension[ext] = (scan.skipped.byExtension[ext] ?? 0) + 1;
}

function accept(scan: FolderScan, file: File, path: string, fromFolder: boolean): void {
  if (fromFolder) {
    if (isIgnoredName(file.name)) {
      scan.skipped.count++;
      return;
    }
    if (!ACCEPTED_EXTENSIONS.includes(extensionOf(file.name))) {
      skip(scan, file.name);
      return;
    }
  }
  scan.files.push({ file, path, fromFolder });
}

/** Files from the "choose folder" dialog (<input webkitdirectory>): the folders are in webkitRelativePath. */
export function scanFileList(list: FileList | File[]): FolderScan {
  const scan = emptyScan();
  const roots = new Set<string>();
  for (const file of Array.from(list)) {
    if (scan.files.length + scan.skipped.count >= MAX_FOLDER_ENTRIES) {
      scan.truncated = true;
      break;
    }
    const rel: string = (file as any).webkitRelativePath || '';
    const parts = rel.split('/').filter(Boolean);
    if (parts.length <= 1) {
      accept(scan, file, '', false); // not from a folder: a loose file
      continue;
    }
    const dirs = parts.slice(0, -1);
    if (dirs.length > MAX_FOLDER_DEPTH || dirs.some((d) => SKIP_DIRS.has(d.toLowerCase()) || d.startsWith('.'))) {
      scan.skipped.count++;
      continue;
    }
    roots.add(dirs[0]);
    accept(scan, file, dirs.join('/'), true);
  }
  scan.folders = [...roots];
  return scan;
}

// ---------------------------------------------------------------------------
// Drag & drop of folders
// ---------------------------------------------------------------------------

interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: EntryLike[]) => void, fail: (e: unknown) => void) => void };
}

/** True when the drop contains at least one folder. Must be called synchronously inside the drop event. */
export function dropHasFolder(dt: DataTransfer | null | undefined): boolean {
  if (!dt?.items) return false;
  return Array.from(dt.items).some((i) => (i as any).webkitGetAsEntry?.()?.isDirectory);
}

const readAllEntries = (dir: EntryLike): Promise<EntryLike[]> =>
  new Promise((resolve, reject) => {
    const reader = dir.createReader?.();
    if (!reader) return resolve([]);
    const all: EntryLike[] = [];
    // readEntries returns at most ~100 entries per call: keep reading until it returns none
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });

const fileOf = (entry: EntryLike): Promise<File> =>
  new Promise((resolve, reject) => (entry.file ? entry.file(resolve, reject) : reject(new Error('not a file'))));

/**
 * Walks everything that was dropped (files and folders). The DataTransfer is only valid during the
 * drop event, so the entries are taken out first, synchronously; the walk itself is asynchronous.
 */
export function scanDataTransfer(dt: DataTransfer): Promise<FolderScan> {
  const entries: EntryLike[] = [];
  const loose: File[] = [];
  const items = dt.items ? Array.from(dt.items) : [];
  for (const item of items) {
    const entry = (item as any).webkitGetAsEntry?.() as EntryLike | null | undefined;
    if (entry) entries.push(entry);
    else if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) loose.push(f);
    }
  }
  if (items.length === 0) loose.push(...Array.from(dt.files ?? []));

  return (async () => {
    const scan = emptyScan();
    let seen = 0;
    const walk = async (entry: EntryLike, path: string, depth: number, isRoot: boolean): Promise<void> => {
      if (seen >= MAX_FOLDER_ENTRIES) {
        scan.truncated = true;
        return;
      }
      seen++;
      if (entry.isFile) {
        try {
          accept(scan, await fileOf(entry), path, !isRoot);
        } catch {
          skip(scan, entry.name);
        }
        return;
      }
      if (!entry.isDirectory) return;
      if (depth > MAX_FOLDER_DEPTH || SKIP_DIRS.has(entry.name.toLowerCase()) || entry.name.startsWith('.')) {
        scan.skipped.count++;
        return;
      }
      const here = path ? `${path}/${entry.name}` : entry.name;
      if (depth === 0) scan.folders.push(entry.name);
      for (const child of await readAllEntries(entry)) await walk(child, here, depth + 1, false);
    };
    for (const entry of entries) await walk(entry, '', 0, entry.isFile);
    for (const f of loose) accept(scan, f, '', false);
    return scan;
  })();
}
