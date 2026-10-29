/**
 * src/components/chat/useChatAttachments.ts
 * Files attached to the next chat message. They are parsed in the browser, sent along with that
 * question (always, the relevance filter never drops them) and ALSO added to My files in the
 * context panel, so they stay available for the rest of the session and in every course.
 */

import { useCallback, useMemo } from 'react';
import { useSessionState } from '@/services/chat/chatSessions';
import { addScannedFiles, adoptUserDoc } from '@/services/context/userFilesStore';
import type { FolderScan } from '@/services/context/folderIngest';
import { MAX_ATTACHMENT_CHARS, UserFileError, parseUserFile } from '@/services/context/userFiles';
import type { BundledDocument, ParsedDocument } from '@/types/parser';

export interface ChatAttachment {
  id: string;
  name: string;
  status: 'parsing' | 'ready' | 'error';
  doc?: ParsedDocument;
  error?: string;
  /** Also listed in My files (the context panel). */
  kept?: boolean;
  /** Why it could not be added to My files (the file is still attached to the question). */
  keepNote?: string;
  /** A dropped folder: its files were added to My files, nothing is attached to the question. */
  folder?: boolean;
  /** Short status text shown next to the name (progress, result). */
  note?: string;
}

let counter = 0;

export interface ChatAttachments {
  items: ChatAttachment[];
  parsing: boolean;
  add: (files: File[]) => Promise<void>;
  /** A folder that was dropped on the chat: add its structure to My files. */
  addFolder: (scan: Promise<FolderScan>) => Promise<void>;
  remove: (id: string) => void;
  clear: () => void;
  /** Ready attachments as documents to pin into the request. */
  pinnedDocs: BundledDocument[];
  names: string[];
}

/** Kept per course for the session, so a file that is still being added survives switching course (and gives the course a tab). */
export function useChatAttachments(scope: string): ChatAttachments {
  const [items, setItems] = useSessionState<ChatAttachment[]>(scope, 'chat.attachments', []);

  const patch = useCallback((id: string, p: Partial<ChatAttachment>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }, [setItems]);

  const add = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const id = `att-${Date.now()}-${counter++}`;
        setItems((prev) => [...prev, { id, name: file.name, status: 'parsing' }]);
        try {
          const parsed = await parseUserFile(file);
          // Also show it in My files (an identical file that is already there is reused, not duplicated)
          const adopted = await adoptUserDoc(parsed);
          const doc = adopted.doc;
          setItems((prev) => {
            const used = prev
              .filter((i) => i.id !== id && i.status === 'ready' && i.doc)
              .reduce((sum, i) => sum + i.doc!.extractedText.length, 0);
            if (used + doc.extractedText.length > MAX_ATTACHMENT_CHARS) {
              return prev.map((i) =>
                i.id === id
                  ? { ...i, status: 'error' as const, error: 'Too much text attached to one question (about 80k tokens maximum).' }
                  : i
              );
            }
            return prev.map((i) =>
              i.id === id ? { ...i, status: 'ready' as const, doc, kept: adopted.added || !adopted.reason, keepNote: adopted.reason } : i
            );
          });
        } catch (err: any) {
          patch(id, {
            status: 'error',
            error: err instanceof UserFileError ? err.message : `Could not read this file: ${err?.message || 'unknown error'}`,
          });
        }
      }
    },
    [patch, setItems]
  );

  const addFolder = useCallback(
    async (scanPromise: Promise<FolderScan>) => {
      const id = `fold-${Date.now()}-${counter++}`;
      setItems((prev) => [...prev, { id, name: 'Folder', status: 'parsing', folder: true, note: 'reading…' }]);
      try {
        const scan = await scanPromise;
        const label = scan.folders.length > 0 ? scan.folders.join(', ') : 'Files';
        patch(id, { name: label, note: `adding 0/${scan.files.length}…` });
        const result = await addScannedFiles(scan, {
          onProgress: (done, total) => patch(id, { note: `adding ${done}/${total}…` }),
        });
        const parts = [`${result.added.length} file${result.added.length === 1 ? '' : 's'} added to My files`];
        if (result.skipped.count > 0) parts.push(`${result.skipped.count} skipped`);
        if (result.duplicates > 0) parts.push(`${result.duplicates} already there`);
        if (result.errors.length > 0) parts.push(`${result.errors.length} failed`);
        patch(id, { status: 'ready', note: parts.join(' · ') });
      } catch (err: any) {
        patch(id, { status: 'error', error: `Could not read the folder: ${err?.message || 'unknown error'}` });
      }
    },
    [patch, setItems]
  );

  const remove = useCallback((id: string) => setItems((prev) => prev.filter((i) => i.id !== id)), [setItems]);
  const clear = useCallback(() => setItems([]), [setItems]);

  const pinnedDocs = useMemo<BundledDocument[]>(
    () =>
      items
        .filter((i) => i.status === 'ready' && i.doc && !i.folder)
        .map((i) => ({
          title: i.doc!.filename,
          type: String(i.doc!.fileType),
          content: i.doc!.extractedText,
          topicId: i.doc!.topicId,
          modulePath: 'Attached to this question',
          pinned: true,
        })),
    [items]
  );

  return {
    items,
    parsing: items.some((i) => i.status === 'parsing'),
    add,
    addFolder,
    remove,
    clear,
    pinnedDocs,
    names: items.filter((i) => i.status === 'ready' && !i.folder).map((i) => i.name),
  };
}
