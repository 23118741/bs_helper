/**
 * src/components/DocumentLoadStatus.tsx
 * Quiet status for the background document loading: nothing when everything was read, a small
 * "Loading documents… 4/12" while it runs, and a single clickable line when something could not be
 * read, which expands to the file names and reasons.
 */

import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { DocumentLoadProgress } from '@/services/brightspace/documentLoader';

export const DocumentLoadStatus: React.FC<{ progress: DocumentLoadProgress | null }> = ({ progress }) => {
  const [open, setOpen] = useState(false);
  if (!progress || progress.total === 0) return null;

  const loading = progress.done < progress.total;
  const failed = progress.failed;
  if (!loading && failed.length === 0) return null; // all documents were read: nothing to show

  return (
    <div className="space-y-1 text-xs" data-testid="document-load-status">
      {loading && (
        <div className="flex items-center gap-1.5 px-1 text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>
            Loading documents… {progress.done}/{progress.total}
          </span>
        </div>
      )}

      {failed.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50/60 px-2 py-1 text-amber-800 hover:bg-amber-50 transition-colors"
          >
            <AlertTriangle className="h-3 w-3 text-amber-600" />
            <span>
              {failed.length === 1 ? '1 document could not be read' : `${failed.length} documents could not be read`}
            </span>
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>

          {open && (
            <ul className="rounded-md border border-slate-200 bg-white divide-y divide-slate-100 text-[11px]">
              {failed.map((f, i) => (
                <li key={i} className="px-2.5 py-1.5">
                  <span className="font-medium text-slate-700 break-words">{f.title}</span>
                  <span className="text-slate-500"> — {f.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
