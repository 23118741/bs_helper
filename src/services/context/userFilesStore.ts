/**
 * src/services/context/userFilesStore.ts
 * Store of the files the student added to the context ("My files"). They belong to the student, not
 * to a course: they stay when the student switches course and come back after a reload. Persisted in
 * IndexedDB (same table as parsed course documents, ids start with "user:") and shared by the context
 * panel and the chat tools through a small external store.
 */

import { useSyncExternalStore } from 'react';
import { storage } from '@/services/brightspace/storage';
import type { ParsedDocument } from '@/types/parser';
import { MAX_ADD_TOTAL_BYTES, MAX_USER_FILES, USER_FILES_SCOPE, UserFileError, isUserDoc, parseUserFile } from './userFiles';
import type { CollectedFile, FolderScan } from './folderIngest';

export interface UserFilesState {
  docs: ParsedDocument[];
}

let state: UserFilesState = { docs: [] };
const listeners = new Set<() => void>();

function set(next: Partial<UserFilesState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const userFilesStore = {
  get: (): UserFilesState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  reset(): void {
    state = { docs: [] };
    listeners.forEach((l) => l());
  },
};

export function useUserFiles(): UserFilesState {
  return useSyncExternalStore(userFilesStore.subscribe, userFilesStore.get, userFilesStore.get);
}

/** Documents that are switched on (these are the ones that reach the context). */
export const enabledUserDocs = (docs: ParsedDocument[]): ParsedDocument[] =>
  docs.filter((d) => !d.metadata?.userDisabled);

/**
 * Loads the student's files once (they are the same in every course).
 * `legacyCourseId`: files an earlier version stored under a course are picked up as well.
 */
export async function loadUserFiles(legacyCourseId?: string): Promise<void> {
  try {
    const own = await storage.getParsedDocumentsForCourse(USER_FILES_SCOPE);
    const legacy = legacyCourseId ? (await storage.getParsedDocumentsForCourse(legacyCourseId)).filter(isUserDoc) : [];
    const byId = new Map<string, ParsedDocument>();
    for (const d of [...own, ...legacy]) byId.set(d.topicId, d);
    set({ docs: [...byId.values()].sort((a, b) => (a.metadata?.extractedAt ?? 0) - (b.metadata?.extractedAt ?? 0)) });
  } catch {
    // storage unavailable: keep what we have in memory
  }
}

export interface AddResult {
  added: ParsedDocument[];
  errors: Array<{ name: string; message: string }>;
  /** Folder walks: files skipped without reading (unsupported types, hidden/system files). */
  skipped: { count: number; byExtension: Record<string, number> };
  /** Identical files (same folder, name and content) that were already in My files. */
  duplicates: number;
  /** Names of the top-level folders that were added. */
  folders: string[];
  /** The folder walk or the size limit stopped early. */
  truncated: boolean;
}

export interface AddOptions {
  onProgress?: (done: number, total: number) => void;
}

const PARALLEL = 3;

const emptyResult = (): AddResult => ({
  added: [],
  errors: [],
  skipped: { count: 0, byExtension: {} },
  duplicates: 0,
  folders: [],
  truncated: false,
});

/** Parses and saves collected files (with their folder paths). Errors are reported per file, never thrown. */
async function addItems(items: CollectedFile[], result: AddResult, options: AddOptions): Promise<AddResult> {
  let bytes = 0;
  let done = 0;
  const isSame = (d: ParsedDocument, path: string, name: string, text: string) =>
    (d.metadata?.userPath ?? '') === path && d.filename === name && d.extractedText === text;

  for (let i = 0; i < items.length; i += PARALLEL) {
    const batch = items.slice(i, i + PARALLEL);
    const outcomes = await Promise.all(
      batch.map(async ({ file, path }) => {
        try {
          return { file, path, doc: await parseUserFile(file, path) as ParsedDocument | null, error: null as string | null };
        } catch (err: any) {
          return {
            file,
            path,
            doc: null,
            error: err instanceof UserFileError ? err.message : `Could not add this file: ${err?.message || 'unknown error'}`,
          };
        }
      })
    );

    for (const o of outcomes) {
      done++;
      const label = o.path ? `${o.path}/${o.file.name}` : o.file.name;
      if (o.error || !o.doc) {
        result.errors.push({ name: label, message: o.error ?? 'Could not add this file.' });
        continue;
      }
      if (state.docs.length >= MAX_USER_FILES) {
        result.errors.push({ name: label, message: `Limit reached (${MAX_USER_FILES} files).` });
        continue;
      }
      if (bytes + o.file.size > MAX_ADD_TOTAL_BYTES) {
        result.truncated = true;
        result.errors.push({ name: label, message: 'Skipped: the total size of this add action is too large.' });
        continue;
      }
      if (state.docs.some((d) => isSame(d, o.path, o.doc!.filename, o.doc!.extractedText))) {
        result.duplicates++;
        continue;
      }
      bytes += o.file.size;
      await storage.saveParsedDocument(o.doc, USER_FILES_SCOPE, o.file.size).catch(() => undefined);
      result.added.push(o.doc);
      set({ docs: [...state.docs, o.doc] });
    }
    options.onProgress?.(done, items.length);
  }
  return result;
}

/** Adds loose files (no folder). */
export async function addUserFiles(files: File[], options: AddOptions = {}): Promise<AddResult> {
  return addItems(files.map((file) => ({ file, path: '', fromFolder: false })), emptyResult(), options);
}

/** Adds the result of reading a folder (or a mix of folders and files) with its folder structure. */
export async function addScannedFiles(scan: FolderScan, options: AddOptions = {}): Promise<AddResult> {
  const result = emptyResult();
  result.skipped = scan.skipped;
  result.folders = scan.folders;
  result.truncated = scan.truncated;
  return addItems(scan.files, result, options);
}

export interface AdoptResult {
  /** The document as stored in My files (an existing identical file is reused, not duplicated). */
  doc: ParsedDocument;
  added: boolean;
  reason?: string;
}

/** Adds an already parsed document (e.g. a chat attachment) to My files. */
export async function adoptUserDoc(doc: ParsedDocument): Promise<AdoptResult> {
  const same = state.docs.find(
    (d) =>
      d.topicId === doc.topicId ||
      (d.filename === doc.filename && d.extractedText === doc.extractedText && (d.metadata?.userPath ?? '') === (doc.metadata?.userPath ?? ''))
  );
  if (same) return { doc: same, added: false };
  if (state.docs.length >= MAX_USER_FILES) {
    return { doc, added: false, reason: `My files is full (${MAX_USER_FILES} files).` };
  }
  await storage.saveParsedDocument(doc, USER_FILES_SCOPE, doc.extractedText.length).catch(() => undefined);
  set({ docs: [...state.docs, doc] });
  return { doc, added: true };
}

export async function removeUserFile(topicId: string): Promise<void> {
  set({ docs: state.docs.filter((d) => d.topicId !== topicId) });
  await storage.deleteParsedDocument(topicId).catch(() => undefined);
}

export async function setUserFileEnabled(topicId: string, enabled: boolean): Promise<void> {
  const doc = state.docs.find((d) => d.topicId === topicId);
  if (!doc) return;
  const updated: ParsedDocument = { ...doc, metadata: { ...doc.metadata, userDisabled: enabled ? undefined : true } };
  set({ docs: state.docs.map((d) => (d.topicId === topicId ? updated : d)) });
  await storage.saveParsedDocument(updated, USER_FILES_SCOPE, updated.extractedText.length).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

/** Is the file inside this folder (or one of its sub-folders)? */
export const inFolder = (doc: ParsedDocument, folder: string): boolean => {
  const p = doc.metadata?.userPath ?? '';
  return p === folder || p.startsWith(`${folder}/`);
};

/** Switches every file in a folder (and its sub-folders) on or off. */
export async function setUserFolderEnabled(folder: string, enabled: boolean): Promise<void> {
  const changed: ParsedDocument[] = [];
  const docs = state.docs.map((d) => {
    if (!inFolder(d, folder) || Boolean(d.metadata?.userDisabled) === !enabled) return d;
    const updated: ParsedDocument = { ...d, metadata: { ...d.metadata, userDisabled: enabled ? undefined : true } };
    changed.push(updated);
    return updated;
  });
  set({ docs });
  await Promise.all(
    changed.map((d) => storage.saveParsedDocument(d, USER_FILES_SCOPE, d.extractedText.length).catch(() => undefined))
  );
}

/** Removes a folder with everything in it from My files (the files on the student's disk are untouched). */
export async function removeUserFolder(folder: string): Promise<void> {
  const gone = state.docs.filter((d) => inFolder(d, folder));
  set({ docs: state.docs.filter((d) => !inFolder(d, folder)) });
  await Promise.all(gone.map((d) => storage.deleteParsedDocument(d.topicId).catch(() => undefined)));
}
