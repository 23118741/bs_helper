/**
 * src/components/chat/useFileDrag.ts
 * Drag & drop of files onto an area, with an overlay that ALWAYS goes away again. Browsers do not
 * tell a page when a drag is cancelled (Esc, dropped elsewhere, mouse left the window), so besides
 * the normal leave/drop events this also hides the overlay when no dragover arrives for a moment
 * (dragover fires continuously while the pointer is over the area).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { dropHasFolder, scanDataTransfer, type FolderScan } from '@/services/context/folderIngest';

/** Hide the overlay when no dragover event was seen for this long. */
export const DRAG_IDLE_MS = 600;

const hasFiles = (e: React.DragEvent): boolean => Boolean(e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files'));

export function useFileDrag(
  onFiles?: (files: File[]) => void,
  /** Called instead of onFiles when the drop contains a folder; gets the (still running) scan of everything dropped. */
  onFolders?: (scan: Promise<FolderScan>) => void
) {
  const [dragging, setDragging] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = useCallback(() => {
    clearTimeout(timer.current);
    setDragging(false);
  }, []);

  // While the overlay is up, any of these ends it.
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
    };
    window.addEventListener('dragend', stop, true);
    window.addEventListener('drop', stop, true);
    window.addEventListener('blur', stop);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('dragend', stop, true);
      window.removeEventListener('drop', stop, true);
      window.removeEventListener('blur', stop);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [dragging, stop]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const handlers = onFiles
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDragging(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(stop, DRAG_IDLE_MS); // drag cancelled or left without a leave event
        },
        onDragLeave: (e: React.DragEvent) => {
          // moving between children of the area is not leaving it
          if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) stop();
        },
        onDrop: (e: React.DragEvent) => {
          // folders must be read synchronously inside the event (the DataTransfer is gone afterwards)
          if (onFolders && dropHasFolder(e.dataTransfer)) {
            e.preventDefault();
            stop();
            onFolders(scanDataTransfer(e.dataTransfer));
            return;
          }
          if (!e.dataTransfer?.files?.length) {
            stop();
            return;
          }
          e.preventDefault();
          stop();
          onFiles(Array.from(e.dataTransfer.files));
        },
      }
    : {};

  return { dragging, handlers };
}
