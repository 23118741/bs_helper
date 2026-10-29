/**
 * src/services/context/retrieval.ts
 * Chooses what of the course goes to the AI for ONE question:
 *   - documents are cut into slides/pages/sections; the matching ones go along with their
 *     neighbours and an outline of the rest, instead of the whole file;
 *   - course sections (news, assignments, grades, ...) are only sent when the question is about
 *     them; otherwise the AI gets a one-line summary so it knows they exist;
 *   - the budget follows the kind of question (a fact needs little, a summary of one document needs
 *     the whole document);
 *   - everything that is left out is listed, so the AI can say so instead of acting as if it
 *     does not exist. If it then answers "not specified", the gateway searches again, wider.
 * Recall comes before saving: when the signal is weak, more is included.
 */

import type { BundledDocument, CourseContextBundle, RelevanceStats } from '@/types/parser';
import { Chunk, chunkDocument, describeChunks, totalLabel } from './chunker';
import { serializeToMarkdown } from './contextSerializer';
import { KIND_BUDGETS, QueryAnalysis, QueryKind, SectionId, UNIT_WORDS, UnitKind, UnitRef, analyzeQuery } from './queryAnalysis';
import { hasWordStart, normalizeText } from './relevance';

export interface SelectContextOptions {
  mode?: 'auto' | 'all';
  /** Overrides the document budget that follows from the kind of question. */
  tokenBudget?: number;
  sections?: 'auto' | 'all';
  /** Slides/pages/sections added around each hit (default 1). */
  neighbors?: number;
  /** Hits scoring below this share of the best hit are dropped (default 0.25; widened searches use less). */
  minScoreRatio?: number;
}

export interface SelectContextResult {
  bundle: CourseContextBundle;
  stats: RelevanceStats;
  analysis: QueryAnalysis;
}

const TINY_SECTION_TOKENS = 600;
const UNCERTAIN_SECTION_TOKENS = 4_000;
const SMALL_DOC_TOKENS = 1_200;
const WHOLE_DOC_CAP_TOKENS = 60_000;
export const SIGNAL_SCORE = 4;
const TOP_HITS_WITH_NEIGHBORS = 4;
/** A document whose title or module names the part the question asks about ("week 3", "lecture 4"). */
const UNIT_DOC_BOOST = 20;
/** A slide/page whose heading names that part ("Lecture 4: Regression"). */
const UNIT_CHUNK_BOOST = 10;
/** A summary takes every document whose best slide/page scores at least this share of the best hit, whole. */
const SUMMARY_DOC_RATIO = 0.6;

/** Extra spellings that only show up in file and module names ("W3 slides.pdf"). */
const TITLE_ONLY_WORDS: Partial<Record<UnitKind, string[]>> = { week: ['w'], lecture: ['l'] };

const unitPattern = (kinds: UnitKind[], n: number): RegExp => {
  const words = kinds
    .flatMap((k) => [...UNIT_WORDS[k], ...(TITLE_ONLY_WORDS[k] ?? [])])
    .sort((a, b) => b.length - a.length)
    .join('|');
  return new RegExp(`(?:^|[^a-z0-9])(?:${words})\\s*[-_.:#]?\\s*0*${n}(?![0-9])`);
};

/**
 * Documents that belong to the parts the question names, by title, module name or title slide. "lecture 3" first looks for
 * lecture words; when the course names its parts differently ("Week 3"), any part word with that number counts.
 */
function unitDocuments(docs: BundledDocument[], perDoc: Chunk[][], refs: UnitRef[]): { docs: Set<number>; patterns: RegExp[] } {
  const found = new Set<number>();
  const patterns: RegExp[] = [];
  if (refs.length === 0) return { docs: found, patterns };
  // module, file name and the title slide/first page ("slides.pdf" whose first slide says "Lecture 3 - Regression")
  const names = docs.map(
    (d, i) => `${normalizeText(d.modulePath ?? '')} / ${normalizeText(d.title)} / ${(perDoc[i][0]?.norm ?? '').slice(0, 200)}`
  );
  for (const ref of refs) {
    let pattern = unitPattern([ref.kind], ref.n);
    let hits = names.map((n, i) => (pattern.test(n) ? i : -1)).filter((i) => i >= 0);
    if (hits.length === 0) {
      pattern = unitPattern(Object.keys(UNIT_WORDS) as UnitKind[], ref.n);
      hits = names.map((n, i) => (pattern.test(n) ? i : -1)).filter((i) => i >= 0);
    }
    patterns.push(pattern);
    for (const i of hits) found.add(i);
  }
  return { docs: found, patterns };
}

const SECTION_KEYS: Record<SectionId, keyof CourseContextBundle> = {
  announcements: 'announcements',
  assignments: 'assignments',
  quizzes: 'quizzes',
  calendar: 'calendar',
  grades: 'grades',
  discussions: 'discussions',
  instructors: 'instructors',
  overview: 'overview',
};

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

interface DocSelection {
  documents: BundledDocument[];
  omitted: Array<{ title: string; modulePath?: string; tokens: number }>;
  totalChunks: number;
  includedChunks: number;
  best: number;
  /** How many of the question's words occur in the best matching slide/page, and how many words there are. */
  bestMatchedTerms: number;
  termCount: number;
  usedTokens: number;
  /** Documents that belong to the part of the course the question names. */
  unitDocs: number;
}

const docTokens = (chunks: Chunk[]) => chunks.reduce((s, c) => s + c.tokens, 0);

function titleStem(title: string): string {
  return normalizeText(title).replace(/\.[a-z0-9]{2,5}$/, '').trim();
}

function outlineOf(chunks: Chunk[]): string | undefined {
  if (chunks.length <= 3) return undefined;
  const parts: string[] = [];
  let len = 0;
  for (const c of chunks) {
    const entry = `${c.number ?? c.index + 1} ${c.heading.slice(0, 40)}`.trim();
    if (len + entry.length > 700) {
      parts.push('…');
      break;
    }
    parts.push(entry);
    len += entry.length + 3;
  }
  return parts.join(' · ');
}

function renderDocument(doc: BundledDocument, chunks: Chunk[], picked: Set<number>): BundledDocument {
  if (picked.size === chunks.length) return doc;
  const pieces: string[] = [];
  let prev = -1;
  const gap = (from: number, to: number) => {
    const skipped = chunks.slice(from, to);
    if (skipped.length > 0) pieces.push(`[… ${describeChunks(skipped)} omitted …]`);
  };
  for (const i of [...picked].sort((a, b) => a - b)) {
    gap(prev + 1, i);
    pieces.push(chunks[i].text);
    prev = i;
  }
  gap(prev + 1, chunks.length);
  return {
    ...doc,
    content: pieces.join('\n\n'),
    partial: {
      sent: describeChunks([...picked].sort((a, b) => a - b).map((i) => chunks[i])),
      total: totalLabel(chunks),
      outline: outlineOf(chunks),
    },
  };
}

function selectDocuments(
  docs: BundledDocument[],
  analysis: QueryAnalysis,
  kind: QueryKind,
  budget: number,
  neighbors: number,
  wholeDocs: boolean,
  minScoreRatio: number
): DocSelection {
  const perDoc = docs.map((d) => chunkDocument(d));
  const totalChunks = perDoc.reduce((s, c) => s + c.length, 0);
  const picked: Array<Set<number>> = docs.map(() => new Set<number>());
  let used = 0;
  const addAll = (d: number) => {
    for (const c of perDoc[d]) {
      if (!picked[d].has(c.index)) {
        picked[d].add(c.index);
        used += c.tokens;
      }
    }
  };
  const add = (d: number, i: number) => {
    if (!picked[d].has(i)) {
      picked[d].add(i);
      used += perDoc[d][i].tokens;
    }
  };

  // Explicit attachments are always sent in full.
  docs.forEach((d, i) => d.pinned && addAll(i));

  let best = 0;
  let bestMatchedTerms = 0;
  let termCount = 0;
  let unitDocs = 0;
  if (wholeDocs) {
    // broad requests: whole documents in course order while they fit
    docs.forEach((_d, i) => {
      if (picked[i].size > 0) return;
      const t = docTokens(perDoc[i]);
      if (used + t <= budget || used === 0) addAll(i);
    });
  } else {
    const wordTokens = analysis.tokens.filter((t) => !/^\d+$/.test(t));
    const weights = new Map<string, number>();
    for (const t of wordTokens) weights.set(t, 1);
    for (const [t, w] of analysis.expanded) if (!weights.has(t)) weights.set(t, w);

    const df = new Map<string, number>();
    for (const t of weights.keys()) {
      let n = 0;
      for (const chunks of perDoc) for (const c of chunks) if (hasWordStart(c.norm, t)) n++;
      df.set(t, n);
    }

    type Scored = { d: number; i: number; score: number };
    const scored: Scored[] = [];
    const mentioned = new Set<number>();
    const units = unitDocuments(docs, perDoc, analysis.unitRefs);
    unitDocs = units.docs.size;
    docs.forEach((doc, d) => {
      const title = normalizeText(doc.title);
      const path = normalizeText(doc.modulePath ?? '');
      let docScore = 0;
      for (const t of analysis.tokens) {
        if (/^\d+$/.test(t)) {
          const whole = new RegExp(`(^|[^0-9])${t}([^0-9]|$)`);
          if (whole.test(title)) docScore += 8;
          if (whole.test(path)) docScore += 8;
        } else {
          if (hasWordStart(title, t)) docScore += 6;
          if (hasWordStart(path, t)) docScore += 3;
        }
      }
      const stem = titleStem(doc.title);
      const isMentioned = stem.length >= 4 && analysis.normalized.includes(stem);
      if (isMentioned) mentioned.add(d);
      const boost = docScore * 0.3 + (isMentioned ? 25 : 0) + (units.docs.has(d) ? UNIT_DOC_BOOST : 0);

      for (const c of perDoc[d]) {
        let score = boost;
        if (units.patterns.some((p) => p.test(c.normHeading) || p.test(c.norm.slice(0, 300)))) score += UNIT_CHUNK_BOOST;
        for (const [t, w] of weights) {
          let tf = 0;
          let from = 0;
          while (tf < 8) {
            const idx = c.norm.indexOf(t, from);
            if (idx === -1) break;
            if (idx === 0 || !/[a-z0-9]/.test(c.norm[idx - 1])) tf++;
            from = idx + t.length;
          }
          if (tf > 0) {
            const idf = Math.log(1 + totalChunks / (1 + (df.get(t) ?? 0)));
            score += w * Math.log(1 + tf) * idf;
          }
          if (hasWordStart(c.normHeading, t)) score += w * 2.5;
        }
        // "slide 12" / "page 3": a strong pointer, strongest inside a document the question points at
        const pointsAtDoc = isMentioned || docScore > 0;
        if (c.unit === 'slide' && c.number !== undefined && analysis.slideRefs.includes(c.number)) score += pointsAtDoc ? 30 : 8;
        if (c.unit === 'page' && c.number !== undefined && analysis.pageRefs.includes(c.number)) score += pointsAtDoc ? 30 : 8;
        if (score > 0) scored.push({ d, i: c.index, score });
      }
    });

    scored.sort((a, b) => b.score - a.score || a.d - b.d || a.i - b.i);
    best = scored[0]?.score ?? 0;
    termCount = wordTokens.length;
    if (scored[0]) {
      const top = perDoc[scored[0].d][scored[0].i];
      bestMatchedTerms = wordTokens.filter((t) => hasWordStart(top.norm, t)).length;
    }

    if (best > 0) {
      const addWhole = (d: number, cap: number) => {
        if (used + docTokens(perDoc[d]) <= cap) addAll(d);
        else for (const c of perDoc[d]) if (used + c.tokens <= cap || used === 0) add(d, c.index);
      };
      const wholeCap = Math.max(budget, WHOLE_DOC_CAP_TOKENS);
      // a question about a named part of the course ("summarize week 3", "what was lecture 4 about"): its documents
      // whole, in course order; a single fact only needs the matching slides
      if (units.docs.size > 0 && kind !== 'fact') {
        for (const d of [...units.docs].sort((a, b) => a - b)) addWhole(d, wholeCap);
      }
      // summary of a named document: the whole document
      if (kind === 'summary-doc' && mentioned.size > 0) {
        for (const d of mentioned) addWhole(d, wholeCap);
      }
      // summary of something not named by title ("summarize the lecture on regression"): the documents that match
      // best, whole, instead of a few loose slides
      if (kind === 'summary-doc' && mentioned.size === 0 && units.docs.size === 0) {
        const bestPerDoc = new Map<number, number>();
        for (const x of scored) bestPerDoc.set(x.d, Math.max(bestPerDoc.get(x.d) ?? 0, x.score));
        const strong = [...bestPerDoc].filter(([, v]) => v >= best * SUMMARY_DOC_RATIO).sort((a, b) => b[1] - a[1]);
        for (const [d] of strong.slice(0, 3)) addWhole(d, wholeCap);
      }
      const cutoff = best * minScoreRatio;
      const chosen: Scored[] = [];
      for (const s of scored) {
        if (s.score < cutoff) break;
        if (picked[s.d].has(s.i)) continue;
        if (used + perDoc[s.d][s.i].tokens > budget && used > 0) continue;
        add(s.d, s.i);
        chosen.push(s);
      }
      // neighbours of the strongest hits: the answer often sits right before or after
      for (const s of chosen.slice(0, TOP_HITS_WITH_NEIGHBORS)) {
        for (let k = 1; k <= neighbors; k++) {
          for (const j of [s.i - k, s.i + k]) if (j >= 0 && j < perDoc[s.d].length) add(s.d, j);
        }
      }
      // small documents come whole once anything in them matched
      docs.forEach((_d, d) => {
        if (picked[d].size > 0 && picked[d].size < perDoc[d].length && docTokens(perDoc[d]) <= SMALL_DOC_TOKENS) addAll(d);
      });
    } else {
      // No signal at all: do not guess, send documents in course order while they fit.
      docs.forEach((_d, d) => {
        if (picked[d].size > 0) return;
        if (used + docTokens(perDoc[d]) <= budget || used === 0) addAll(d);
      });
    }
  }

  const documents: BundledDocument[] = [];
  const omitted: DocSelection['omitted'] = [];
  let includedChunks = 0;
  docs.forEach((doc, d) => {
    if (picked[d].size === 0) {
      omitted.push({ title: doc.title, modulePath: doc.modulePath, tokens: docTokens(perDoc[d]) });
      return;
    }
    includedChunks += picked[d].size;
    documents.push(renderDocument(doc, perDoc[d], picked[d]));
  });
  return { documents, omitted, totalChunks, includedChunks, best, bestMatchedTerms, termCount, usedTokens: used, unitDocs };
}

// ---------------------------------------------------------------------------
// Course sections
// ---------------------------------------------------------------------------

function sectionTokens(bundle: CourseContextBundle, id: SectionId): number {
  const key = SECTION_KEYS[id];
  const base: CourseContextBundle = { courseInfo: bundle.courseInfo, documents: [] };
  const empty = serializeToMarkdown(base).length;
  const only: CourseContextBundle = { ...base, [key]: bundle[key] };
  if (id === 'grades') only.finalGrade = bundle.finalGrade;
  return Math.ceil(Math.max(0, serializeToMarkdown(only).length - empty) / 4);
}

const titleMentioned = (titles: string[], analysis: QueryAnalysis): boolean =>
  titles.some((t) => {
    const n = normalizeText(t).trim();
    if (n.length >= 4 && analysis.normalized.includes(n)) return true;
    const words = n.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    return words.length > 0 && words.filter((w) => analysis.tokens.includes(w)).length >= Math.min(2, words.length);
  });

function digestFor(bundle: CourseContextBundle, id: SectionId): string {
  const list = (items: string[], max = 6) => items.slice(0, max).join(', ') + (items.length > max ? `, +${items.length - max} more` : '');
  switch (id) {
    case 'announcements': {
      const a = bundle.announcements ?? [];
      const latest = a[0];
      return `${a.length} announcement${a.length === 1 ? '' : 's'}${latest ? `, latest: "${latest.title}"${latest.postedDate ? ` (${latest.postedDate.slice(0, 10)})` : ''}` : ''}`;
    }
    case 'assignments': {
      const a = bundle.assignments ?? [];
      const fb = a.filter((x) => x.feedback).length;
      return `${a.length} assignment${a.length === 1 ? '' : 's'}: ${list(a.map((x) => x.name))}${fb ? `; ${fb} with instructor feedback` : ''}`;
    }
    case 'quizzes': {
      const q = bundle.quizzes ?? [];
      return `${q.length} quiz${q.length === 1 ? '' : 'zes'}: ${list(q.map((x) => x.title))}`;
    }
    case 'calendar': {
      const c = bundle.calendar ?? [];
      return `${c.length} calendar event${c.length === 1 ? '' : 's'}${c[0] ? ` (e.g. "${c[0].title}")` : ''}`;
    }
    case 'grades': {
      const g = bundle.grades ?? [];
      return `${g.length} grade item${g.length === 1 ? '' : 's'}${bundle.finalGrade ? ', final grade available' : ''}`;
    }
    case 'discussions': {
      const d = bundle.discussions ?? [];
      return `${d.length} discussion thread${d.length === 1 ? '' : 's'}: ${list(d.map((x) => x.topic))}`;
    }
    case 'instructors':
      return `teaching staff: ${list((bundle.instructors ?? []).map((x) => x.name))}`;
    case 'overview':
      return 'course overview / syllabus text';
  }
}

function sectionTitles(bundle: CourseContextBundle, id: SectionId): string[] {
  switch (id) {
    case 'announcements': return (bundle.announcements ?? []).map((a) => a.title);
    case 'assignments': return (bundle.assignments ?? []).map((a) => a.name);
    case 'quizzes': return (bundle.quizzes ?? []).map((q) => q.title);
    case 'calendar': return (bundle.calendar ?? []).map((c) => c.title);
    case 'discussions': return (bundle.discussions ?? []).flatMap((d) => [d.topic, d.forum]);
    default: return [];
  }
}

function routeSections(
  bundle: CourseContextBundle,
  analysis: QueryAnalysis,
  everything: boolean,
  docSignal: boolean
): { bundle: CourseContextBundle; omitted: NonNullable<CourseContextBundle['omittedSections']> } {
  const out: CourseContextBundle = { ...bundle };
  const omitted: NonNullable<CourseContextBundle['omittedSections']> = [];
  const uncertain = analysis.sections.size === 0 && !docSignal;

  for (const id of Object.keys(SECTION_KEYS) as SectionId[]) {
    const key = SECTION_KEYS[id];
    const value = bundle[key];
    const present = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (!present) continue;
    if (everything) continue;

    const tokens = sectionTokens(bundle, id);
    const include =
      tokens <= TINY_SECTION_TOKENS ||
      analysis.sections.has(id) ||
      titleMentioned(sectionTitles(bundle, id), analysis) ||
      (uncertain && tokens <= UNCERTAIN_SECTION_TOKENS);
    if (include) continue;

    omitted.push({ section: id, summary: digestFor(bundle, id), tokens });
    (out as unknown as Record<string, unknown>)[key] = undefined;
    if (id === 'grades') out.finalGrade = undefined;
  }
  return { bundle: out, omitted };
}

// ---------------------------------------------------------------------------

export function selectContext(
  bundle: CourseContextBundle,
  query: string,
  options: SelectContextOptions = {}
): SelectContextResult {
  const analysis = analyzeQuery(query);
  const kind: QueryKind = options.mode === 'all' ? 'broad' : analysis.kind;
  // a question about a named part of the course ("week 3") may need all of that part
  const partBudget = analysis.unitRefs.length > 0 && kind !== 'fact' ? KIND_BUDGETS['summary-doc'] : 0;
  const budget = options.tokenBudget ?? Math.max(KIND_BUDGETS[kind], partBudget);
  const neighbors = options.neighbors ?? 1;
  const wholeDocs = options.mode === 'all' || kind === 'broad';

  const docs = bundle.documents ?? [];
  const sel = selectDocuments(docs, analysis, kind, budget, neighbors, wholeDocs, options.minScoreRatio ?? 0.25);
  const docSignal = sel.best >= SIGNAL_SCORE;

  const routed = routeSections(bundle, analysis, wholeDocs || options.sections === 'all', docSignal);
  const partialDocs = sel.documents.filter((d) => d.partial).length;

  const result: CourseContextBundle = {
    ...routed.bundle,
    documents: sel.documents,
    omittedDocuments: sel.omitted.length > 0 ? sel.omitted : undefined,
    omittedSections: routed.omitted.length > 0 ? routed.omitted : undefined,
  };

  const stats: RelevanceStats = {
    totalDocuments: docs.length,
    includedDocuments: sel.documents.length,
    includedTokens: sel.usedTokens,
    matched: sel.best > 0,
    bestScore: sel.best,
    bestMatchedTerms: sel.bestMatchedTerms,
    queryTermCount: sel.termCount,
    pointsAtPart: analysis.slideRefs.length > 0 || analysis.pageRefs.length > 0 || sel.unitDocs > 0,
    hasPinned: docs.some((d) => d.pinned),
    includedTopicIds: sel.documents.map((d) => d.topicId ?? d.title),
    totalChunks: sel.totalChunks,
    includedChunks: sel.includedChunks,
    sectionsOmitted: routed.omitted.map((o) => o.section),
    queryKind: kind,
    widenable: sel.omitted.length > 0 || partialDocs > 0 || routed.omitted.length > 0,
  };
  return { bundle: result, stats, analysis };
}
