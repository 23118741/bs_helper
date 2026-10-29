/**
 * src/components/chat/ChatShell.tsx
 * Shared layout for every chat-style tool (the Chat and future tools):
 *   [ top: banners, presets, errors ]   fixed
 *   [ messages                      ]   fills the space and scrolls on its own
 *   [ composer                      ]   always pinned to the bottom of the chat
 * The shell has a stable height (full height in the full-screen workspace, a fixed height in the
 * side panel) so the input box never jumps around as messages come and go.
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Check, FileText, Loader2, Paperclip, Send, StopCircle, Trash2, X } from 'lucide-react';
import { ACCEPT_ATTR } from '@/services/context/userFiles';
import { useFileDrag } from './useFileDrag';
import type { FolderScan } from '@/services/context/folderIngest';
import type { ChatAttachment } from './useChatAttachments';
import { useDrawerLayout } from '@/components/LayoutContext';

export interface ChatShellProps {
  top?: React.ReactNode;
  messages: React.ReactNode;
  composer: React.ReactNode;
  /** Changes whenever the message list changes; scrolls the list to the bottom. */
  scrollKey: unknown;
  className?: string;
  /** Files dropped anywhere on the chat are attached to the next question. */
  onFilesDropped?: (files: File[]) => void;
  /** A folder was dropped: the structure is added to My files. */
  onFoldersDropped?: (scan: Promise<FolderScan>) => void;
}

export const ChatShell: React.FC<ChatShellProps> = ({ top, messages, composer, scrollKey, className = '', onFilesDropped, onFoldersDropped }) => {
  const { expanded } = useDrawerLayout();
  const { dragging, handlers: dragHandlers } = useFileDrag(onFilesDropped, onFoldersDropped);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll only the message list (never the drawer or the Brightspace page).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollKey]);

  // A tab that was hidden (display: none) loses its scroll offset; jump to the newest message
  // when it becomes visible again.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let wasHidden = el.clientHeight === 0;
    const observer = new ResizeObserver(() => {
      const hidden = el.clientHeight === 0;
      if (wasHidden && !hidden) el.scrollTop = el.scrollHeight;
      wasHidden = hidden;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      data-testid="chat-shell"
      className={`relative flex flex-col min-h-0 h-full bg-slate-50/60 ${className}`}
      {...dragHandlers}
    >
      {dragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-blue-400 bg-blue-50/80 text-sm font-medium text-blue-700 pointer-events-none">
          Drop files to attach them to your question, or a folder to add it to My files
        </div>
      )}
      {top && <div className="shrink-0">{top}</div>}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className={`px-3 py-3 space-y-3 min-h-full flex flex-col ${expanded ? 'max-w-3xl mx-auto w-full px-4' : ''}`}>
          {messages}
        </div>
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white">
        <div className={`px-3 py-2 ${expanded ? 'max-w-3xl mx-auto w-full px-4' : ''}`}>{composer}</div>
      </div>
    </div>
  );
};

export interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** True while an answer is being generated: input is locked and Send becomes Stop. */
  busy: boolean;
  onStop: () => void;
  /** Shows a small trash icon in the input row that clears the conversation. */
  onClear?: () => void;
  /** Attach files to this question (paperclip, drag & drop and paste). */
  attachments?: {
    items: ChatAttachment[];
    onAdd: (files: File[]) => void;
    onRemove: (id: string) => void;
  };
}

/** Growing text area with the send/stop button inside the box. Enter sends, Shift+Enter adds a line. */
export const ChatComposer: React.FC<ChatComposerProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  busy,
  onStop,
  onClear,
  attachments,
}) => {
  const { expanded } = useDrawerLayout();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const attachParsing = attachments?.items.some((i) => i.status === 'parsing') ?? false;
  const canSend = value.trim().length > 0 && !busy && !attachParsing;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      <div className="rounded-xl border border-slate-300 bg-white px-2 py-1 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition">
        {attachments && attachments.items.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 pb-1.5" data-testid="attachment-chips">
            {attachments.items.map((a) => (
              <li
                key={a.id}
                title={a.error ?? a.name}
                className={`inline-flex items-center gap-1 max-w-full rounded-full border px-2 py-0.5 text-[11px] ${
                  a.status === 'error'
                    ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                {a.status === 'parsing' ? (
                  <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                ) : (
                  <FileText className="h-3 w-3 text-slate-400" />
                )}
                <span className="truncate max-w-[10rem]">{a.folder ? `📁 ${a.name}` : a.name}</span>
                {a.note && a.status !== 'error' && <span className="text-[10px] text-slate-400">· {a.note}</span>}
                {a.status === 'error' && <span className="text-[10px]">· {a.error}</span>}
                {a.status === 'ready' && !a.folder && (
                  <span
                    className={`inline-flex items-center ${a.kept ? 'text-emerald-600' : 'text-amber-600'}`}
                    title={a.kept ? 'Also added to My files in the context panel' : a.keepNote ?? 'Not added to My files'}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => attachments.onRemove(a.id)}
                  aria-label={`Remove ${a.name}`}
                  className="text-slate-400 hover:text-rose-600"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-1.5">
        {attachments && (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40"
              title="Attach files to your question"
              aria-label="Attach files"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="hidden"
              aria-label="Choose files to attach"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                if (files.length > 0) attachments.onAdd(files);
                e.target.value = '';
              }}
            />
          </>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const files = e.clipboardData?.files;
            if (attachments && files && files.length > 0) {
              e.preventDefault();
              attachments.onAdd(Array.from(files));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSubmit();
            }
          }}
          disabled={busy}
          placeholder={placeholder}
          title="Enter to send · Shift+Enter for a new line"
          aria-keyshortcuts="Enter"
          className={`flex-1 min-w-0 resize-none bg-transparent outline-none placeholder:text-slate-400 disabled:opacity-50 ${
            expanded ? 'text-sm leading-5 py-1' : 'text-xs leading-4 py-1.5'
          }`}
        />
        {onClear && !busy && (
          <button
            type="button"
            onClick={onClear}
            title="Clear conversation"
            aria-label="Clear conversation"
            className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg border border-rose-200 transition-colors"
            title="Stop generating"
          >
            <StopCircle className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-30 transition-colors"
            title="Send question"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
        </div>
      </div>
    </form>
  );
};

/** Centered placeholder for an empty conversation. */
export const ChatEmptyState: React.FC<{ icon: React.ReactNode; title: string; children?: React.ReactNode }> = ({
  icon,
  title,
  children,
}) => (
  <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400">
    {icon}
    <h4 className="text-sm font-medium text-slate-600 mt-2">{title}</h4>
    {children && <p className="text-xs text-slate-400 max-w-xs mt-1">{children}</p>}
  </div>
);
