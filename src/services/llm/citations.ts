/**
 * src/services/llm/citations.ts
 * Citations in an answer. The model cites with the IDs the context headings carry ("[[D123 Slide 14]]", see
 * sourceRegistry). This module reads those citations, turns an older free-text citation ("[Lecture 3 Slide 14]")
 * into an ID when it is unambiguous, and finds the statements that have no source at all.
 */

import { citationBase, norm } from '@/services/brightspace/sourceLinks';
import { SECTION_ID, type SourceEntry, type SourceRegistry } from '@/services/context/sourceRegistry';

/** "[[D123 Slide 14]]" or "[[D1 p. 2; D2]]": the inside of the double brackets. */
export const CITATION_TOKEN = /\[\[([^\[\]\n]{1,200})\]\]/g;

export interface CitationPart {
  id: string;
  /** "Slide 14", "p. 2" or empty. */
  locator: string;
}

/** Splits the inside of one citation into its sources; null when it does not look like an ID at all. */
export function parseCitation(inner: string): CitationPart[] | null {
  const parts: CitationPart[] = [];
  for (const raw of inner.split(/\s*;\s*/)) {
    const m = raw.trim().match(/^([A-Z][A-Za-z0-9]{0,15})(?:\s+(.{1,60}))?$/);
    if (!m) return null;
    parts.push({ id: m[1], locator: (m[2] ?? '').trim() });
  }
  return parts.length > 0 ? parts : null;
}

/** What to show for one cited source. An ID that is not in the registry is "unknown": the model made it up or it was not sent. */
export interface ResolvedCitation {
  known: boolean;
  text: string;
  url?: string;
  reason?: string;
}

export function resolveCitation(part: CitationPart, registry: SourceRegistry | undefined): ResolvedCitation {
  const entry: SourceEntry | undefined = registry?.[part.id];
  if (!entry) return { known: false, text: '?', reason: 'This source is not in your course materials' };
  const text = part.locator ? `${entry.label} · ${part.locator}` : entry.label;
  return { known: true, text, url: entry.url, reason: entry.url ? undefined : entry.reason ?? 'There is no page for this in Brightspace' };
}

// ---------------------------------------------------------------------------
// Older, free-text citations

const LOCATOR = /[,;(]?\s*\b((?:slides?|dia'?s?|pages?|pagina'?s?|pp?\.?|sheet)\s*\d[\d\s,–-]*)\)?\s*$/i;

/** Keywords for whole sections, when a model writes "[Grades]" instead of "[[GRADES]]". */
const SECTION_WORDS: Array<[string[], string]> = [
  [['grades', 'grade', 'cijfers', 'cijfer'], SECTION_ID.grades],
  [['calendar', 'kalender'], SECTION_ID.calendar],
  [['announcements', 'announcement', 'news', 'nieuws'], SECTION_ID.news],
  [['course overview', 'overview', 'cursusoverzicht'], SECTION_ID.overview],
  [['discussions', 'discussion', 'forum'], SECTION_ID.discussions],
  [['course structure', 'structure'], SECTION_ID.outline],
];

function legacyToPart(text: string, registry: SourceRegistry): CitationPart | null {
  const stripped = text.replace(/^\s*(?:source|bron)\s*:\s*/i, '').trim();
  const locator = (stripped.match(LOCATOR)?.[1] ?? '').trim();
  const cite = norm(stripped);
  const base = citationBase(`[${text}]`);
  if (!base) return null;
  const entries = Object.values(registry).filter((e) => norm(e.label).length >= 3);

  const contained = entries.filter((e) => cite.includes(norm(e.label)));
  if (contained.length > 0) {
    const longest = Math.max(...contained.map((e) => norm(e.label).length));
    const best = contained.filter((e) => norm(e.label).length === longest);
    return best.length === 1 ? { id: best[0].id, locator } : null;
  }
  if (base.length >= 4) {
    const starts = entries.filter((e) => norm(e.label) === base || norm(e.label).startsWith(`${base} `));
    if (starts.length === 1) return { id: starts[0].id, locator };
  }
  for (const [words, id] of SECTION_WORDS) {
    if (registry[id] && words.some((w) => base === w || base.startsWith(`${w} `))) return { id, locator };
  }
  return null;
}

/**
 * Rewrites older free-text citations that clearly point at one source of the registry to the ID form, so every
 * citation is shown and linked the same way. Anything that does not resolve is left as the model wrote it.
 */
export function normalizeCitations(text: string, registry: SourceRegistry | undefined): string {
  if (!text || !registry || Object.keys(registry).length === 0) return text;
  return text.replace(/(?<!\[)\[([^\[\]\n]{2,120})\](?![\]\(])/g, (whole, inner: string) => {
    const parts = inner.split(/\s*;\s*/).map((p) => legacyToPart(p, registry));
    if (parts.some((p) => p === null)) return whole;
    return (parts as CitationPart[]).map((p) => `[[${p.id}${p.locator ? ` ${p.locator}` : ''}]]`).join(' ');
  });
}

/** The registry entries an answer actually cites (what is kept on the message). */
export function pickCited(text: string, registry: SourceRegistry | undefined): SourceRegistry {
  const out: SourceRegistry = {};
  if (!registry) return out;
  for (const m of text.matchAll(CITATION_TOKEN)) {
    for (const part of parseCitation(m[1]) ?? []) if (registry[part.id]) out[part.id] = registry[part.id];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Statements without a source

/** Older citation styles that may still be in a message: [Slide 4], [Source: ...], [Syllabus]. */
const LEGACY_CITATION = /\[(?:(?:Source|Bron|Slide|Page|Pagina|Chapter|Hoofdstuk|Lecture|College|Assignment|Opdracht)(?::|\s)\s*[^\]]+|Source|Bron|Syllabus)\]/i;

export function hasCitation(text: string): boolean {
  CITATION_TOKEN.lastIndex = 0;
  return /\[\[[^\[\]\n]{1,200}\]\]/.test(text) || LEGACY_CITATION.test(text);
}

const ABSENCE = /^not specified in the selected brightspace materials\.?$/i;

/**
 * True for a statement that should carry a source: some substance, not a heading-like lead-in, a question or the
 * standard "not specified" answer.
 */
export function needsSource(text: string, minWords = 4): boolean {
  const plain = text
    .replace(CITATION_TOKEN, ' ')
    .replace(/[*_`#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain || ABSENCE.test(plain)) return false;
  if (/[?:]$/.test(plain)) return false; // a question or a lead-in to a list
  return plain.split(' ').length >= minWords;
}

/** A statement that should carry a source and has none. */
export const isUncited = (text: string, minWords = 4): boolean => needsSource(text, minWords) && !hasCitation(text);
