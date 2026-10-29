/**
 * src/services/brightspace/documentLoader.ts
 * Downloads every file topic (PDF, PPTX, DOCX, ...) of a course from Brightspace,
 * parses it in-browser and caches the result in IndexedDB so it reaches the LLM context.
 */

import { CourseData, FileRef, TocModule, TocTopic } from '@/types/brightspace';
import { ParsedDocument } from '@/types/parser';
import { parseDocument, detectFileType } from '@/services/parsers/documentParser';
import { storage } from './storage';
import { ValenceClient } from './valenceClient';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const CONCURRENCY = 3;

export interface DocumentLoadProgress {
  total: number;
  done: number;
  failed: Array<{ title: string; reason: string }>;
}

export interface LoadDocumentsOptions {
  signal?: AbortSignal;
  client?: Pick<ValenceClient, 'getBinary'>;
  /** Called after each document is parsed (cached ones are reported first). */
  onDocument?: (doc: ParsedDocument) => void;
  onProgress?: (p: DocumentLoadProgress) => void;
}

export function collectFileTopics(courseData: CourseData): TocTopic[] {
  const out: TocTopic[] = [];
  const seen = new Set<string>();
  const walk = (mods: TocModule[]) => {
    for (const m of mods) {
      for (const t of m.topics) {
        if ((t.type === 'file' || t.type === 'html') && t.downloadUrl && t.topicId && !seen.has(t.topicId)) {
          seen.add(t.topicId);
          out.push(t);
        }
      }
      if (m.subModules?.length) walk(m.subModules);
    }
  };
  if (courseData.toc) walk(courseData.toc);
  return out;
}

function attachmentTopic(kind: string, ownerId: string, f: FileRef): TocTopic {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(f.fileName)?.[1]?.toLowerCase();
  return {
    topicId: `att:${kind}:${ownerId}:${f.fileId}`,
    title: f.fileName,
    type: 'file',
    fileExtension: ext,
    downloadUrl: f.downloadUrl,
  };
}

/** Assignment attachments, instructor feedback files and announcement attachments. */
export function collectAttachmentTopics(courseData: CourseData): TocTopic[] {
  const out: TocTopic[] = [];
  for (const a of courseData.assignments ?? []) {
    for (const f of a.attachments ?? []) out.push(attachmentTopic('assignment', a.id, f));
    for (const f of a.feedback?.files ?? []) out.push(attachmentTopic('feedback', a.id, f));
  }
  for (const n of courseData.announcements ?? []) {
    for (const f of n.attachments ?? []) out.push(attachmentTopic('news', n.id, f));
  }
  return out;
}

function fileNameFor(topic: TocTopic, headerName?: string): string {
  if (headerName && /\.[a-z0-9]{2,5}$/i.test(headerName)) return headerName;
  if (/\.[a-z0-9]{2,5}$/i.test(topic.title)) return topic.title;
  return topic.fileExtension ? `${topic.title}.${topic.fileExtension}` : topic.title;
}

export async function loadCourseDocuments(
  courseData: CourseData,
  options: LoadDocumentsOptions = {}
): Promise<ParsedDocument[]> {
  const topics = [...collectFileTopics(courseData), ...collectAttachmentTopics(courseData)];
  const progress: DocumentLoadProgress = { total: topics.length, done: 0, failed: [] };
  const results: ParsedDocument[] = [];
  options.onProgress?.({ ...progress });
  if (topics.length === 0) return results;

  const client = options.client ?? new ValenceClient();

  const cached = new Map<string, ParsedDocument>();
  try {
    for (const d of await storage.getParsedDocumentsForCourse(courseData.orgUnitId)) {
      cached.set(d.topicId, d);
    }
  } catch {
    // cache unreadable: download everything
  }

  const queue = [...topics];
  const worker = async () => {
    while (queue.length > 0 && !options.signal?.aborted) {
      const topic = queue.shift()!;
      try {
        let doc = cached.get(topic.topicId);
        if (!doc) {
          const file = await client.getBinary(topic.downloadUrl!, options.signal, true);
          if (file.data.byteLength > MAX_FILE_BYTES) {
            throw new Error(`file too large (${Math.round(file.data.byteLength / 1048576)} MB)`);
          }
          const filename = fileNameFor(topic, file.filename);
          if (detectFileType(filename, file.contentType) === 'unknown') {
            throw new Error(`unsupported file type (${file.contentType || filename})`);
          }
          const parsed = await parseDocument(file.data, filename, {
            topicId: topic.topicId,
            mimeType: file.contentType,
          });
          doc = {
            topicId: topic.topicId,
            filename: parsed.filename,
            fileType: parsed.fileType,
            extractedText: parsed.extractedText,
            metadata: parsed.metadata,
          };
          if (!doc.extractedText.trim()) throw new Error('no text could be extracted');
          await storage.saveParsedDocument(doc, courseData.orgUnitId, file.data.byteLength).catch(() => {});
        }
        results.push(doc);
        options.onDocument?.(doc);
      } catch (err: any) {
        if (options.signal?.aborted) return;
        progress.failed.push({ title: topic.title, reason: err?.message || String(err) });
        console.warn(`[BS Helper] Could not load "${topic.title}":`, err);
      }
      progress.done++;
      options.onProgress?.({ ...progress, failed: [...progress.failed] });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, topics.length) }, worker));
  return results;
}
