/**
 * src/services/context/chunker.ts
 * Splits a document into the units a question is actually about: slides, pages, or sections of a
 * text. Retrieval then sends the matching slides/pages (plus their neighbours) instead of the
 * whole file.
 */

import type { BundledDocument } from '@/types/parser';
import { normalizeText } from './relevance';

export interface Chunk {
  /** Position inside the document (0-based). */
  index: number;
  /** "Slide 12", "Page 3", "Section: Grading" or "Part 2". */
  label: string;
  /** 'slide' | 'page' | 'section' | 'part': decides how gaps are described. */
  unit: 'slide' | 'page' | 'section' | 'part';
  /** Number for slides/pages. */
  number?: number;
  /** First line of the chunk (slide title, heading). */
  heading: string;
  /** Text exactly as it is serialized (keeps the [Slide N] / [Page N] marker so citations keep working). */
  text: string;
  tokens: number;
  /** Lower-cased, accent-free text used for matching. */
  norm: string;
  normHeading: string;
}

const SLIDE = /(?:^|\n)(\[Slide\s+(\d+)\])([\s\S]*?)(?=(?:\n\[Slide\s+\d+\])|$)/g;
const PAGE = /(?:^|\n)(\[Page\s+(\d+)\])([\s\S]*?)(?=(?:\n\[Page\s+\d+\])|$)/g;
const TARGET_CHARS = 1200;
const MAX_CHARS = 1800;

const cache = new Map<string, Chunk[]>();

const firstLine = (text: string): string => {
  for (const line of text.split('\n')) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t) return t.slice(0, 90);
  }
  return '';
};

function make(index: number, label: string, unit: Chunk['unit'], text: string, number?: number): Chunk {
  const body = text.replace(/^\[(?:Slide|Page)\s+\d+\]\s*/, '');
  const heading = firstLine(body);
  return {
    index,
    label,
    unit,
    number,
    heading,
    text,
    tokens: Math.ceil(text.length / 4),
    norm: normalizeText(text),
    normHeading: normalizeText(heading),
  };
}

function splitPlain(content: string): Chunk[] {
  // sections by markdown heading
  const parts: Array<{ heading: string; text: string }> = [];
  let current: string[] = [];
  let heading = '';
  const flush = () => {
    const text = current.join('\n').trim();
    if (text) parts.push({ heading, text });
    current = [];
  };
  for (const line of content.split('\n')) {
    if (/^#{1,4}\s+\S/.test(line)) {
      flush();
      heading = line.replace(/^#+\s*/, '').trim().slice(0, 90);
    }
    current.push(line);
  }
  flush();

  // long sections: pack paragraphs into ~1200 character parts
  const chunks: Chunk[] = [];
  for (const part of parts.length > 0 ? parts : [{ heading: '', text: content.trim() }]) {
    if (part.text.length <= MAX_CHARS) {
      chunks.push(make(chunks.length, part.heading ? `Section: ${part.heading}` : `Part ${chunks.length + 1}`, part.heading ? 'section' : 'part', part.text));
      continue;
    }
    let buf = '';
    let n = 0;
    const emit = () => {
      if (!buf.trim()) return;
      n++;
      const label = part.heading ? `Section: ${part.heading}${n > 1 ? ` (${n})` : ''}` : `Part ${chunks.length + 1}`;
      chunks.push(make(chunks.length, label, part.heading ? 'section' : 'part', buf.trim()));
      buf = '';
    };
    for (const para of part.text.split(/\n{2,}/)) {
      if (buf.length + para.length > TARGET_CHARS && buf) emit();
      if (para.length > MAX_CHARS) {
        // one huge paragraph: cut on sentence ends
        for (const sentence of para.split(/(?<=[.!?])\s+/)) {
          if (buf.length + sentence.length > TARGET_CHARS && buf) emit();
          buf += (buf ? ' ' : '') + sentence;
        }
        continue;
      }
      buf += (buf ? '\n\n' : '') + para;
    }
    emit();
  }
  return chunks;
}

export function chunkDocument(doc: BundledDocument): Chunk[] {
  const key = `${doc.topicId ?? doc.title}:${doc.content.length}:${doc.content.slice(0, 40)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const content = doc.content;
  let chunks: Chunk[] = [];

  for (const [regex, unit, word] of [
    [SLIDE, 'slide', 'Slide'],
    [PAGE, 'page', 'Page'],
  ] as const) {
    const matches = Array.from(content.matchAll(new RegExp(regex.source, 'g')));
    if (matches.length === 0) continue;
    chunks = matches.map((m, i) => make(i, `${word} ${m[2]}`, unit, `${m[1]}${m[3]}`.trimEnd(), Number(m[2])));
    break;
  }
  if (chunks.length === 0) chunks = content.length <= MAX_CHARS ? [make(0, 'Part 1', 'part', content.trim())] : splitPlain(content);

  if (cache.size > 400) cache.clear();
  cache.set(key, chunks);
  return chunks;
}

/** "slides 4–9" / "pages 2, 5–6" / "3 sections", from the chunks of one document. */
export function describeChunks(chunks: Chunk[]): string {
  if (chunks.length === 0) return 'nothing';
  const unit = chunks[0].unit;
  if ((unit === 'slide' || unit === 'page') && chunks.every((c) => c.number !== undefined)) {
    const nums = chunks.map((c) => c.number!).sort((a, b) => a - b);
    const ranges: string[] = [];
    let start = nums[0];
    let prev = nums[0];
    for (const n of [...nums.slice(1), Infinity]) {
      if (n === prev + 1) {
        prev = n;
        continue;
      }
      ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = n;
      prev = n;
    }
    return `${unit}${nums.length > 1 ? 's' : ''} ${ranges.join(', ')}`;
  }
  return `${chunks.length} ${unit === 'part' ? 'part' : 'section'}${chunks.length > 1 ? 's' : ''}`;
}

export function totalLabel(chunks: Chunk[]): string {
  const unit = chunks[0]?.unit ?? 'part';
  const word = unit === 'part' ? 'section' : unit;
  return `${chunks.length} ${word}${chunks.length === 1 ? '' : 's'}`;
}

export function resetChunkCache(): void {
  cache.clear();
}
