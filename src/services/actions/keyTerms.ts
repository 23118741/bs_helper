/**
 * src/services/actions/keyTerms.ts
 * The "Key Terms" preset: course terms defined the way the course materials define them.
 *
 * The model answers with JSON ({term, definition, source, evidence_quote}); every evidence quote is
 * checked against the context that was actually sent, so a definition that the materials do not
 * support is flagged instead of passing as the teacher's.
 */

import type { LLMOptions, LLMResponse } from '@/types/llm';
import type { BundledDocument, CourseContextBundle } from '@/types/parser';
import { docSourceId, type SourceRegistry } from '@/services/context/sourceRegistry';
import { parseCitation } from '@/services/llm/citations';
import { sumUsage } from '@/services/llm/llmUtils';

export interface KeyTerm {
  term: string;
  definition: string;
  source: string;
  evidence_quote: string;
  /** False when the quote does not occur in the context that was sent. */
  verified: boolean;
}

export interface KeyTermsPromptOptions {
  /** 'syllabus': only the syllabus is provided, take its core definitions. 'course': everything else. */
  scope?: 'syllabus' | 'course';
  /** Terms that are already defined by the syllabus: do not list them again. */
  skipTerms?: string[];
}

export function buildKeyTermsPrompt(courseName = 'this course', opts: KeyTermsPromptOptions = {}): string {
  const scope =
    opts.scope === 'syllabus'
      ? `Only the syllabus / course guide is provided. List the terms it defines itself (key concepts, "begrippen", glossary, learning goals that define a term) and define each one exactly as the syllabus does.\n`
      : `List the key terms of "${courseName}" and define each one exactly as the provided course materials define it.\n`;
  const skip =
    opts.skipTerms && opts.skipTerms.length > 0
      ? `6. These terms are already defined by the syllabus, do not list them again: ${opts.skipTerms.join('; ')}.\n`
      : '';
  return (
    scope +
    `Output ONLY a JSON array (no prose, no code fence). Each item has exactly these fields:\n` +
    `{"term": string, "definition": string, "source": string, "evidence_quote": string}\n` +
    `Rules:\n` +
    `1. "definition": use the wording and framing of the course materials (the teacher's slides, readings, syllabus), in the language of the materials. Never use general or textbook knowledge that is not in the materials. Keep the teacher's emphasis (what the course says matters about the term, e.g. for the exam). Give the full definition the materials give, without filler.\n` +
    `2. "evidence_quote": a short passage (maximum 40 words) copied VERBATIM from the materials that supports the definition. Do not paraphrase, translate or correct it.\n` +
    `3. "source": the ID of the document as shown in double brackets in the context heading, plus the slide or page where the quote is, e.g. "D123 Slide 14". One source only; copy the ID exactly, never invent one.\n` +
    `4. Include a term only if the materials explain it. If the materials only name a term without explaining it, leave it out. Never fill the gap yourself.\n` +
    `5. Cover terms from all sessions/modules, in course order. If no term is explained in the materials, output [].\n` +
    skip
  ).trimEnd();
}

/** Parses the model's answer; tolerates a code fence or text around the array. Returns null when it is not a term list. */
export function parseKeyTerms(text: string): Omit<KeyTerm, 'verified'>[] | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start < 0 || end < start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const items: Omit<KeyTerm, 'verified'>[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const term = typeof o.term === 'string' ? o.term.trim() : '';
    const definition = typeof o.definition === 'string' ? o.definition.trim() : '';
    if (!term || !definition) continue;
    items.push({
      term,
      definition,
      source: typeof o.source === 'string' ? o.source.trim() : '',
      evidence_quote: typeof o.evidence_quote === 'string' ? o.evidence_quote.trim() : '',
    });
  }
  return items;
}

/** Lower case, no markdown decoration, one kind of quote/dash, single spaces: quotes survive formatting differences. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`#>|]/g, ' ')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the quote occurs in the context. "…" or "..." in the quote may skip text between fragments. */
export function quoteInContext(quote: string, context: string): boolean {
  if (!quote.trim() || !context) return false;
  const haystack = normalize(context);
  const fragments = quote
    .split(/…|\.{3}/)
    .map(normalize)
    .filter((f) => f.length > 0);
  return fragments.length > 0 && fragments.every((f) => haystack.includes(f));
}

/**
 * A quote is verified when it occurs in the context that was sent and, when the cited source is a document we can read,
 * in that document itself (a quote taken from another document than the one cited is not verified).
 */
export function verifyKeyTerms(
  items: Omit<KeyTerm, 'verified'>[],
  context: string | undefined,
  docContent?: (sourceId: string) => string | undefined
): KeyTerm[] {
  return items.map((it) => {
    const id = toCitation(it.source)?.id;
    const own = id ? docContent?.(id) : undefined;
    const verified = quoteInContext(it.evidence_quote, context ?? '') && (own === undefined || quoteInContext(it.evidence_quote, own));
    return { ...it, verified };
  });
}

/**
 * The model's "source" field as a citation we can link: "D123 Slide 14" as it should be, but also "[[D123 Slide 14]]",
 * "D123, Slide 14" or "Syllabus (D123 p. 2)". With a registry, the first word in it is taken as the source id.
 */
export function toCitation(source: string, registry?: SourceRegistry): { id: string; locator: string } | null {
  const text = source.replace(/[\[\]()|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const strict = parseCitation(text);
  if (strict && (!registry || registry[strict[0].id])) return strict[0];
  if (!registry) return null;
  const words = text.split(' ');
  const at = words.findIndex((w) => registry[w.replace(/[,;:.]+$/, '')]);
  if (at < 0) return null;
  const id = words[at].replace(/[,;:.]+$/, '');
  const locator = words.slice(at + 1).join(' ').replace(/^[\s,;:–-]+/, '').slice(0, 60).trim();
  return { id, locator };
}

/** "D123 Slide 14" becomes the citation [[D123 Slide 14]], which the chat shows and links like every other source. */
const sourceCell = (source: string, registry?: SourceRegistry): string => {
  if (!source) return '-';
  const c = toCitation(source, registry);
  return c ? `[[${c.id}${c.locator ? ` ${c.locator}` : ''}]]` : cell(source);
};

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** Markdown for the chat bubble: verified terms first-class, unsupported ones marked. */
export function formatKeyTerms(terms: KeyTerm[], registry?: SourceRegistry): string {
  if (terms.length === 0) return 'Not specified in the selected Brightspace materials.';
  const rows = terms.map(
    (t) =>
      `| ${cell(t.term)} | ${cell(t.definition)} | ${sourceCell(t.source, registry)} | ` +
      `${t.verified ? `"${cell(t.evidence_quote)}"` : '⚠ quote not found in the materials'} |`
  );
  const unverified = terms.filter((t) => !t.verified).length;
  const note =
    unverified > 0
      ? `\n\n⚠ ${unverified} of ${terms.length} definitions have no quote that can be found in the materials; check them against your slides.`
      : '';
  return `| Term | Definition | Source | Evidence |\n|---|---|---|---|\n${rows.join('\n')}${note}`;
}

// ---------------------------------------------------------------------------
// Syllabus first

const SYLLABUS_TITLE = /syllabus|studiegids|cursusgids|study guide|course guide|course outline|course manual|course description|cursusbeschrijving|cursusinformatie|course information/i;
const DEFINITION_WORDS = /definition|definitie|begrippen|kernbegrippen|key terms|key concepts|glossary|woordenlijst|terminology/i;

/** Documents that look like the syllabus / course guide, by title or location. */
export function findSyllabusDocs(bundle: CourseContextBundle): BundledDocument[] {
  return (bundle.documents ?? []).filter((d) => SYLLABUS_TITLE.test(d.title) || SYLLABUS_TITLE.test(d.modulePath ?? ''));
}

/**
 * The bundle with only the syllabus in it (its documents, plus the course overview text when that talks
 * about definitions), or null when there is nothing that could hold core definitions.
 */
export function buildSyllabusBundle(bundle: CourseContextBundle): CourseContextBundle | null {
  const docs = findSyllabusDocs(bundle);
  const overview = bundle.overview && DEFINITION_WORDS.test(bundle.overview) ? bundle.overview : undefined;
  if (docs.length === 0 && !overview) return null;
  return { courseInfo: bundle.courseInfo, overview, documents: docs };
}

const termKey = (t: string): string => normalize(t).replace(/\s*\(.*?\)\s*/g, ' ').trim();

export interface RunKeyTermsInput {
  generate: (prompt: string, options?: Partial<LLMOptions>) => Promise<LLMResponse>;
  bundle: CourseContextBundle;
  courseName?: string;
  /** Options of the request (mode, signal, kind, ...); the context and relevance are set here. */
  options: Partial<LLMOptions>;
  onStatus?: (message: string) => void;
}

/**
 * Key terms in two steps: first the syllabus (when there is one) for its core definitions, then the rest of
 * the course for terms the syllabus does not define. Every quote is verified against the context of its own
 * step. Syllabus terms come first and win when both define the same term.
 */
export async function runKeyTerms(input: RunKeyTermsInput): Promise<LLMResponse> {
  const { generate, bundle, courseName, options, onStatus } = input;
  const base: Partial<LLMOptions> = { ...options, kind: 'preset', escalate: false, relevance: { mode: 'all' } };

  const docs = new Map((bundle.documents ?? []).map((d) => [docSourceId(d), d.content]));
  const docContent = (id: string) => docs.get(id);
  let sources: SourceRegistry = {};
  let syllabusTerms: KeyTerm[] = [];
  let tokens = 0;
  let syllabusRes: LLMResponse | undefined;
  const syllabusBundle = buildSyllabusBundle(bundle);
  if (syllabusBundle) {
    onStatus?.('Checking the syllabus for core definitions…');
    const res = await generate(buildKeyTermsPrompt(courseName, { scope: 'syllabus' }), { ...base, contextBundle: syllabusBundle });
    syllabusRes = res;
    tokens += res.tokenEstimate ?? 0;
    const parsed = parseKeyTerms(res.text);
    sources = { ...sources, ...res.sources };
    if (parsed) syllabusTerms = verifyKeyTerms(parsed, res.serializedContext, docContent);
  }

  onStatus?.(syllabusTerms.length > 0 ? 'Searching the course materials for further terms…' : 'Searching the course materials…');
  const skipTerms = syllabusTerms.map((t) => t.term);
  const res = await generate(buildKeyTermsPrompt(courseName, { scope: 'course', skipTerms }), { ...base, contextBundle: bundle });
  tokens += res.tokenEstimate ?? 0;
  sources = { ...sources, ...res.sources };
  const parsed = parseKeyTerms(res.text);
  const usage = sumUsage([syllabusRes, res]) ?? res.usage;

  // Neither step gave a term list: show what the model said instead of hiding it
  if (!parsed && syllabusTerms.length === 0) return { ...res, sources, usage, tokenEstimate: tokens || res.tokenEstimate };

  const seen = new Set(syllabusTerms.map((t) => termKey(t.term)));
  const courseTerms = verifyKeyTerms(parsed ?? [], res.serializedContext, docContent).filter((t) => !seen.has(termKey(t.term)));
  return { ...res, sources, text: formatKeyTerms([...syllabusTerms, ...courseTerms], sources), usage, tokenEstimate: tokens || res.tokenEstimate };
}
