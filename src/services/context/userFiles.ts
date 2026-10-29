/**
 * src/services/context/userFiles.ts
 * Files the student adds themselves (Context → My files, or attached to a chat message): parsed in
 * the browser with the same parsers as course documents, never uploaded anywhere except as context
 * with a question.
 */

import { detectFileType, parseDocument } from '@/services/parsers/documentParser';
import type { BundledDocument, CourseContextBundle, ParsedDocument } from '@/types/parser';

export const USER_DOC_PREFIX = 'user:';
/** The student's own files belong to the student, not to a course: one storage scope for all courses. */
export const USER_FILES_SCOPE = '__user_files__';
export const MAX_USER_FILE_BYTES = 25 * 1024 * 1024;
/** ~75k tokens: longer files are cut so one file cannot blow up a request. */
export const MAX_USER_FILE_CHARS = 300_000;
/** A folder can hold a lot of notes: generous, but bounded. */
export const MAX_USER_FILES = 300;
/** Total size of the files of one add action (a whole folder). */
export const MAX_ADD_TOTAL_BYTES = 400 * 1024 * 1024;
/** Stop walking a folder after this many entries (guards against huge or looping structures). */
export const MAX_FOLDER_ENTRIES = 3000;
export const MAX_FOLDER_DEPTH = 12;
/** Total size of files attached to one chat message (≈ tokens × 4). */
export const MAX_ATTACHMENT_CHARS = 320_000;

export const ACCEPTED_EXTENSIONS = ['.pdf', '.pptx', '.docx', '.html', '.htm', '.txt', '.md', '.csv', '.json'];
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');

export const isUserDoc = (d: { topicId?: string }): boolean => !!d.topicId?.startsWith(USER_DOC_PREFIX);

export class UserFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFileError';
  }
}

function newId(): string {
  const c = (globalThis as any).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof (file as any).arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsArrayBuffer(file);
  });
}

export function describeFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Validates, parses and (if needed) truncates one file. Throws UserFileError with a readable message. */
export async function parseUserFile(file: File, path = ''): Promise<ParsedDocument> {
  const name = file.name || 'file';
  const lower = name.toLowerCase();

  if (lower.endsWith('.doc') || lower.endsWith('.ppt') || lower.endsWith('.xls') || lower.endsWith('.xlsx')) {
    throw new UserFileError(
      lower.endsWith('.doc') || lower.endsWith('.ppt')
        ? 'Old Office formats are not supported. Save it as .docx or .pptx first.'
        : 'Spreadsheets are not supported yet. Export it as .csv first.'
    );
  }
  if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext)) || detectFileType(name, undefined) === 'unknown') {
    throw new UserFileError('Unsupported file type. Use PDF, PPTX, DOCX, HTML, TXT, MD, CSV or JSON.');
  }
  if (file.size > MAX_USER_FILE_BYTES) {
    throw new UserFileError(`File is too large (${describeFileSize(file.size)}, maximum ${describeFileSize(MAX_USER_FILE_BYTES)}).`);
  }
  if (file.size === 0) throw new UserFileError('The file is empty.');

  const topicId = `${USER_DOC_PREFIX}${newId()}`;
  let parsed;
  try {
    parsed = await parseDocument(await readBuffer(file), name, { topicId });
  } catch (err: any) {
    throw new UserFileError(`Could not read this file: ${err?.message || 'unknown error'}`);
  }

  let text = (parsed.extractedText || '').trim();
  if (!text || /^\[(Scanned image or empty page|Error)/.test(text)) {
    throw new UserFileError('No text could be extracted. It may be a scan or image-only file.');
  }

  const warnings = [...(parsed.metadata?.warnings ?? [])];
  if (text.length > MAX_USER_FILE_CHARS) {
    text = `${text.slice(0, MAX_USER_FILE_CHARS)}\n\n[Truncated: the file is longer than ${MAX_USER_FILE_CHARS.toLocaleString()} characters]`;
    warnings.push(`Truncated to the first ${MAX_USER_FILE_CHARS.toLocaleString()} characters.`);
  }

  return {
    topicId,
    filename: name,
    fileType: parsed.fileType,
    extractedText: text,
    metadata: {
      ...parsed.metadata,
      extractedAt: Date.now(),
      tokenEstimate: Math.ceil(text.length / 4),
      warnings: warnings.length > 0 ? warnings : undefined,
      userPath: path || undefined,
    },
  };
}

/** "Thesis/Notes" → "My files > Thesis > Notes" (the module path shown to the AI and in the inspector). */
export function userModulePath(path: string | undefined): string {
  return path ? `My files > ${path.split('/').join(' > ')}` : 'My files';
}

/** Adds explicitly attached documents to a bundle; they are always sent (never dropped by the relevance filter). */
export function withPinnedDocuments(bundle: CourseContextBundle, pinned: BundledDocument[]): CourseContextBundle {
  if (pinned.length === 0) return bundle;
  const ids = new Set(pinned.map((p) => p.topicId));
  return {
    ...bundle,
    documents: [...bundle.documents.filter((d) => !d.topicId || !ids.has(d.topicId)), ...pinned.map((p) => ({ ...p, pinned: true }))],
  };
}
