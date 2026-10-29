/**
 * src/components/UserFilesSection.tsx
 * "My files" section of the context panel: the student adds their own files (notes, extra
 * readings, a draft) or whole folders with their structure to the context. Files are parsed in the
 * browser, stored for the student (not per course) and can be switched on/off per file or per
 * folder, or removed. They go through the relevance filter like course documents, and the folder
 * names help the search ("my thesis folder").
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileUp,
  Folder,
  FolderPlus,
  X,
} from "lucide-react";
import {
  addScannedFiles,
  addUserFiles,
  removeUserFile,
  removeUserFolder,
  setUserFileEnabled,
  setUserFolderEnabled,
  useUserFiles,
  type AddResult,
} from "@/services/context/userFilesStore";
import { ACCEPT_ATTR, MAX_USER_FILES } from "@/services/context/userFiles";
import { scanFileList, type FolderScan } from "@/services/context/folderIngest";
import type { ContextSelection, ParsedDocument } from "@/types/parser";
import { useFileDrag } from "./chat/useFileDrag";

const kTokens = (chars: number) => {
  const t = Math.ceil(chars / 4);
  return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t);
};

interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  files: ParsedDocument[];
  fileCount: number;
  enabledCount: number;
  chars: number;
}

/** Builds the folder tree from the flat list of files (each remembers its folder path). */
export function buildFileTree(docs: ParsedDocument[]): FolderNode {
  const root: FolderNode = {
    name: "",
    path: "",
    folders: [],
    files: [],
    fileCount: 0,
    enabledCount: 0,
    chars: 0,
  };
  const nodes = new Map<string, FolderNode>([["", root]]);
  const ensure = (path: string): FolderNode => {
    const hit = nodes.get(path);
    if (hit) return hit;
    const parts = path.split("/");
    const parent = ensure(parts.slice(0, -1).join("/"));
    const node: FolderNode = {
      name: parts[parts.length - 1],
      path,
      folders: [],
      files: [],
      fileCount: 0,
      enabledCount: 0,
      chars: 0,
    };
    parent.folders.push(node);
    nodes.set(path, node);
    return node;
  };
  for (const d of docs) {
    const node = ensure(d.metadata?.userPath ?? "");
    node.files.push(d);
    for (
      let n: FolderNode | undefined = node;
      n;
      n =
        n === root
          ? undefined
          : nodes.get(n.path.split("/").slice(0, -1).join("/"))
    ) {
      n.fileCount++;
      n.chars += d.extractedText.length;
      if (!d.metadata?.userDisabled) n.enabledCount++;
    }
  }
  const sort = (n: FolderNode) => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.files.sort((a, b) => a.filename.localeCompare(b.filename));
    n.folders.forEach(sort);
  };
  sort(root);
  return root;
}

function describeAdd(r: AddResult): string {
  const parts: string[] = [];
  const from =
    r.folders.length > 0
      ? ` from ${r.folders.map((f) => `"${f}"`).join(", ")}`
      : "";
  parts.push(
    `Added ${r.added.length} file${r.added.length === 1 ? "" : "s"}${from}`,
  );
  if (r.skipped.count > 0) {
    const by = Object.entries(r.skipped.byExtension)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([ext, n]) => `${ext.replace(/^\./, "")} ×${n}`)
      .join(", ");
    parts.push(`skipped ${r.skipped.count} unsupported${by ? ` (${by})` : ""}`);
  }
  if (r.duplicates > 0) parts.push(`${r.duplicates} already there`);
  if (r.errors.length > 0) parts.push(`${r.errors.length} could not be read`);
  if (r.truncated) parts.push("stopped early (folder too large)");
  return parts.join(" · ");
}

const TriCheckbox: React.FC<{
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
}> = ({ checked, indeterminate, onChange, label }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
    />
  );
};

/** Remove buttons stay out of the way until the row is hovered or focused. */
const ROW_REMOVE =
  "flex-shrink-0 text-slate-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity";

export interface UserFilesSectionProps {
  selection: ContextSelection;
  onSelectionChange: (selection: ContextSelection) => void;
}

export const UserFilesSection: React.FC<UserFilesSectionProps> = ({
  selection,
  onSelectionChange,
}) => {
  const { docs } = useUserFiles();
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<AddResult | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(true);

  const busy = progress !== null;
  const include = selection.includeUserFiles !== false;
  const tree = useMemo(() => buildFileTree(docs), [docs]);

  const finish = (r: AddResult) => {
    setResult(r);
    setProgress(null);
    // adding something means the student wants it used
    if (r.added.length > 0 && !include)
      onSelectionChange({ ...selection, includeUserFiles: true });
  };

  const addFiles = async (list: FileList | File[] | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;
    setResult(null);
    setProgress({ done: 0, total: files.length });
    finish(
      await addUserFiles(files, {
        onProgress: (done, total) => setProgress({ done, total }),
      }),
    );
    if (filesInput.current) filesInput.current.value = "";
  };

  const addScan = async (scan: FolderScan | Promise<FolderScan>) => {
    setResult(null);
    setProgress({ done: 0, total: 0 });
    const s = await scan;
    setProgress({ done: 0, total: s.files.length });
    finish(
      await addScannedFiles(s, {
        onProgress: (done, total) => setProgress({ done, total }),
      }),
    );
    if (folderInput.current) folderInput.current.value = "";
  };

  const { dragging, handlers: dragHandlers } = useFileDrag(
    (files) => void addFiles(files),
    (scan) => void addScan(scan),
  );

  const toggleCollapsed = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderFile = (d: ParsedDocument, depth: number) => {
    const enabled = !d.metadata?.userDisabled;
    return (
      <li
        key={d.topicId}
        className="group flex items-center gap-1.5 rounded px-1 py-[3px] text-xs hover:bg-white"
        style={{ paddingLeft: 4 + depth * 12 + 18 }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={() => void setUserFileEnabled(d.topicId, !enabled)}
          aria-label={`Use ${d.filename}`}
          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        <span
          className={`flex-1 min-w-0 truncate ${enabled ? "text-slate-700" : "text-slate-400"}`}
          title={
            d.metadata?.userPath
              ? `${d.metadata.userPath}/${d.filename}`
              : d.filename
          }
        >
          {d.filename}
        </span>
        {d.metadata?.warnings && (
          <span title={d.metadata.warnings.join(" ")}>
            <AlertTriangle className="h-3 w-3 text-amber-500" />
          </span>
        )}
        <span
          className="text-[10px] tabular-nums text-slate-400 flex-shrink-0"
          title={String(d.fileType)}
        >
          ~{kTokens(d.extractedText.length)}
        </span>
        <button
          type="button"
          onClick={() => void removeUserFile(d.topicId)}
          aria-label={`Remove ${d.filename}`}
          title="Remove file"
          className={ROW_REMOVE}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </li>
    );
  };

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => {
    const isCollapsed = collapsed.has(node.path);
    const allOn = node.enabledCount === node.fileCount;
    return (
      <li key={`folder:${node.path}`} data-folder={node.path}>
        <div
          className="group flex items-center gap-1.5 rounded px-1 py-[3px] text-xs hover:bg-white"
          style={{ paddingLeft: 4 + depth * 12 }}
        >
          <button
            type="button"
            onClick={() => toggleCollapsed(node.path)}
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} folder ${node.name}`}
            className="text-slate-400 hover:text-slate-700 flex-shrink-0"
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          <TriCheckbox
            checked={allOn}
            indeterminate={node.enabledCount > 0 && !allOn}
            onChange={() => void setUserFolderEnabled(node.path, !allOn)}
            label={`Use folder ${node.name}`}
          />
          <Folder className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
          <span
            className={`flex-1 min-w-0 truncate font-medium ${node.enabledCount > 0 ? "text-slate-700" : "text-slate-400"}`}
            title={node.path}
          >
            {node.name}
          </span>
          <span className="text-[10px] tabular-nums text-slate-400 flex-shrink-0">
            {node.fileCount} · ~{kTokens(node.chars)}
          </span>
          <button
            type="button"
            onClick={() => void removeUserFolder(node.path)}
            aria-label={`Remove folder ${node.name}`}
            title="Remove this folder and everything in it from My files (your files on disk are not touched)"
            className={ROW_REMOVE}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {!isCollapsed && (
          <ul className="space-y-px">
            {node.folders.map((f) => renderFolder(f, depth + 1))}
            {node.files.map((d) => renderFile(d, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const button =
    "text-xs px-2 py-1 rounded-md border border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1 whitespace-nowrap";

  return (
    <div
      data-testid="user-files-section"
      className={`rounded-md border ${dragging ? "border-blue-400 bg-blue-50/50" : "border-slate-200 bg-slate-50/40"} p-2 space-y-1.5`}
      {...dragHandlers}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} My files`}
          className="text-slate-400 hover:text-slate-700 flex-shrink-0"
        >
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <input
          type="checkbox"
          checked={include}
          onChange={() =>
            onSelectionChange({ ...selection, includeUserFiles: !include })
          }
          aria-label="Include my files in the context"
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        <FileUp className="h-4 w-4 text-violet-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-medium text-slate-800">My files</span>
          <p className="text-[10px] text-slate-500">
            {docs.length === 0
              ? "Add your own notes, readings or whole folders"
              : `${docs.length} file${docs.length === 1 ? "" : "s"} · in every course`}
          </p>
        </div>
      </div>

      {open && (
        <>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => filesInput.current?.click()}
              disabled={busy}
              className={`${button} flex-1`}
            >
              <FileUp className="h-3.5 w-3.5" />
              {busy
                ? progress!.total > 0
                  ? `Adding ${progress!.done}/${progress!.total}…`
                  : "Reading…"
                : "Add files"}
            </button>
            <button
              type="button"
              onClick={() => folderInput.current?.click()}
              disabled={busy}
              className={`${button} flex-1`}
              title="Add a whole folder with its sub-folders"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              Add folder
            </button>
            <input
              ref={filesInput}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="hidden"
              aria-label="Choose files to add to the context"
              onChange={(e) => void addFiles(e.target.files)}
            />
            <input
              ref={folderInput}
              type="file"
              multiple
              className="hidden"
              aria-label="Choose a folder to add to the context"
              // not in the React typings, but supported by Chrome, Edge, Brave and Firefox
              {...({ webkitdirectory: "", directory: "" } as Record<
                string,
                string
              >)}
              onChange={(e) =>
                e.target.files && void addScan(scanFileList(e.target.files))
              }
            />
          </div>

          {docs.length === 0 && !busy && (
            <p className="rounded border border-dashed border-slate-300 px-2 py-3 text-center text-[11px] leading-snug text-slate-400">
              Drop files or a whole folder here, or use Add files / Add folder
              <br />
              PDF, PPTX, DOCX, HTML, TXT, MD, CSV, JSON · max {
                MAX_USER_FILES
              }{" "}
              files
            </p>
          )}

          {docs.length > 0 && (
            <ul
              className="space-y-px max-h-64 overflow-y-auto rounded border border-slate-200 bg-white/60 p-1"
              data-testid="user-files-tree"
            >
              {tree.folders.map((f) => renderFolder(f, 0))}
              {tree.files.map((d) => renderFile(d, 0))}
            </ul>
          )}

          {result && (
            <div className="space-y-1" data-testid="add-summary-box">
              <p
                className="flex items-start gap-1 text-[11px] text-slate-600"
                data-testid="add-summary"
              >
                <span className="flex-1">{describeAdd(result)}</span>
                <button
                  type="button"
                  onClick={() => setResult(null)}
                  aria-label="Dismiss"
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3 w-3" />
                </button>
              </p>
              {result.errors.length > 0 && (
                <ul
                  role="alert"
                  className="space-y-0.5 text-[11px] text-amber-800 bg-amber-50/70 border border-amber-200 rounded px-2 py-1"
                >
                  {result.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>
                      <span className="font-medium">{e.name}</span>: {e.message}
                    </li>
                  ))}
                  {result.errors.length > 5 && (
                    <li>… and {result.errors.length - 5} more</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
