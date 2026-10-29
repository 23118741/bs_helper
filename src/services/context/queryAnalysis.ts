/**
 * src/services/context/queryAnalysis.ts
 * Understands what a question is about, without calling an AI: which course sections it concerns
 * (deadlines → calendar/assignments, "my feedback" → assignments/grades, ...), what kind of question
 * it is (a fact, an explanation, a summary of one document, a broad overview) and which slide/page
 * numbers it mentions. Dutch and English. Recall comes first: when in doubt, more is included.
 */

import { normalizeText, tokenizeQuery } from './relevance';

export type SectionId =
  | 'announcements'
  | 'assignments'
  | 'quizzes'
  | 'calendar'
  | 'grades'
  | 'discussions'
  | 'instructors'
  | 'overview';

export type QueryKind = 'fact' | 'explain' | 'summary-doc' | 'broad';

export interface QueryAnalysis {
  /** Normalized query tokens (stopwords removed, light stemming). */
  tokens: string[];
  /** Extra tokens from synonyms/translations with a lower weight. */
  expanded: Map<string, number>;
  /** Sections the wording points at. Empty = no signal. */
  sections: Set<SectionId>;
  kind: QueryKind;
  wantsSummary: boolean;
  slideRefs: number[];
  pageRefs: number[];
  /** Course parts the question names: "week 3", "lecture 4", "hoorcollege 2", "chapter 5", "the third lecture". */
  unitRefs: UnitRef[];
  /** The query lower-cased without accents. */
  normalized: string;
}

export type UnitKind = 'week' | 'lecture' | 'tutorial' | 'chapter' | 'module';

export interface UnitRef {
  kind: UnitKind;
  n: number;
}

/**
 * The words a course uses for its parts, per kind (normalized). Used for the question AND for document titles and
 * module names, so "lecture 3" finds "Hoorcollege 3", "HC03" or "College 3 - Regressie.pdf".
 */
export const UNIT_WORDS: Record<UnitKind, string[]> = {
  week: ['week', 'wk', 'weken'],
  lecture: ['lecture', 'lec', 'hoorcollege', 'college', 'hc', 'les', 'lesson', 'session', 'sessie', 'class', 'bijeenkomst', 'meeting'],
  tutorial: ['tutorial', 'werkcollege', 'wc', 'practicum', 'lab', 'workshop', 'seminar', 'werkgroep', 'exercise', 'oefening'],
  chapter: ['chapter', 'ch', 'hoofdstuk', 'hfst', 'hfdst'],
  module: ['module', 'unit', 'topic', 'thema', 'blok', 'part', 'deel', 'onderdeel'],
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12,
};
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  eerste: 1, tweede: 2, derde: 3, vierde: 4, vijfde: 5, zesde: 6, zevende: 7, achtste: 8, negende: 9, tiende: 10, elfde: 11, twaalfde: 12,
};

const allUnitWords = (Object.entries(UNIT_WORDS) as Array<[UnitKind, string[]]>).flatMap(([kind, words]) => words.map((w) => ({ kind, w })));
// longest first, so "hoorcollege" wins over "college"
allUnitWords.sort((a, b) => b.w.length - a.w.length);
const UNIT_ALT = allUnitWords.map((u) => u.w).join('|');
const kindOf = (word: string): UnitKind => allUnitWords.find((u) => u.w === word)!.kind;
const numberOf = (raw: string): number | undefined => {
  const digits = raw.match(/^0*(\d{1,3})(?:st|nd|rd|th|e|de|ste)?$/);
  if (digits) return Number(digits[1]);
  return NUMBER_WORDS[raw] ?? ORDINAL_WORDS[raw];
};

/** "week 3", "lecture three", "HC03", "hoofdstuk 5", "the third lecture", "derde college". */
export function findUnitRefs(normalized: string): UnitRef[] {
  const refs: UnitRef[] = [];
  const add = (kind: UnitKind, n: number | undefined) => {
    if (n === undefined || n < 1 || n > 200) return;
    if (!refs.some((r) => r.kind === kind && r.n === n)) refs.push({ kind, n });
  };
  const after = new RegExp(`(?:^|[^a-z0-9])(${UNIT_ALT})\\s*[-_.:#]?\\s*(?:nr\\.?|no\\.?|nummer|number)?\\s*([0-9]{1,3}(?:st|nd|rd|th|e|de|ste)?|[a-z]+)(?![a-z0-9])`, 'g');
  for (const m of normalized.matchAll(after)) add(kindOf(m[1]), numberOf(m[2]));
  const before = new RegExp(`(?:^|[^a-z0-9])([a-z]+|[0-9]{1,3}(?:st|nd|rd|th|e|de|ste))\\s+(${UNIT_ALT})(?![a-z0-9])`, 'g');
  for (const m of normalized.matchAll(before)) {
    const n = ORDINAL_WORDS[m[1]] ?? (/^\d/.test(m[1]) ? numberOf(m[1]) : undefined);
    add(kindOf(m[2]), n);
  }
  return refs;
}

/** Word-start matches in the normalized query (so "deadlines" matches "deadline"). */
const SECTION_WORDS: Record<SectionId, string[]> = {
  announcements: ['announce', 'news', 'nieuws', 'mededeling', 'bericht', 'bulletin', 'posted'],
  assignments: [
    'assign', 'opdracht', 'submit', 'submission', 'inlever', 'hand in', 'rubric', 'feedback', 'essay', 'paper',
    'project', 'homework', 'huiswerk', 'report', 'verslag', 'thesis', 'scriptie', 'criteri', 'beoordelingsformulier',
  ],
  quizzes: ['quiz', 'toets', 'exam', 'tentamen', 'examen', 'midterm', 'attempt', 'poging', 'resit', 'herkans', 'retake', 'multiple choice'],
  calendar: [
    'deadline', 'due', 'when', 'wanneer', 'date', 'datum', 'schedule', 'rooster', 'planning', 'agenda', 'calendar',
    'kalender', 'event', 'today', 'tomorrow', 'vandaag', 'morgen', 'next week', 'volgende week', 'this week',
    'deze week', 'hoe laat', 'what time', 'inleverdatum',
  ],
  grades: [
    'grade', 'cijfer', 'score', 'points', 'punten', 'weight', 'weging', 'gewicht', 'mark', 'result', 'resultaat', 'pass',
    'voldoende', 'average', 'gemiddelde', 'gpa', 'eindcijfer', 'final grade', 'passed', 'gehaald', 'behaald',
  ],
  discussions: ['discuss', 'forum', 'thread', 'post', 'reply', 'replies', 'reactie', 'classmate', 'medestudent'],
  instructors: [
    'teacher', 'instructor', 'docent', 'lecturer', 'professor', 'prof ', 'contact', 'email', 'e-mail', 'mail', 'office hour',
    'spreekuur', 'assistant', 'assistent', 'coordinator', 'who teaches', 'wie geeft', 'wie is',
  ],
  overview: [
    'syllabus', 'overview', 'studiegids', 'cursusgids', 'course info', 'learning goal', 'learning objective', 'leerdoel',
    'about the course', 'over de cursus', 'course description', 'prerequisite', 'voorkennis', 'ects', 'study load',
    'studiebelasting', 'literature', 'literatuur', 'reading list', 'required reading', 'attendance', 'aanwezigheid',
  ],
};

/** What else a section question usually needs: a deadline is in the calendar AND in the assignment. */
const IMPLIES: Partial<Record<SectionId, SectionId[]>> = {
  calendar: ['assignments', 'quizzes'],
  grades: ['assignments'],
  quizzes: ['calendar'],
};

/** Words that mean the same in Dutch and English (or nearly): a hit on one finds the other. */
const SYNONYM_GROUPS: string[][] = [
  ['exam', 'tentamen', 'examen', 'toets', 'test', 'midterm', 'final'],
  ['deadline', 'inleverdatum', 'due', 'inlevermoment'],
  ['assignment', 'opdracht', 'homework', 'huiswerk', 'taak', 'task'],
  ['submit', 'inleveren', 'hand', 'upload', 'submission'],
  ['grade', 'cijfer', 'score', 'punten', 'points', 'mark', 'beoordeling'],
  ['weight', 'weging', 'gewicht', 'weighting', 'percentage'],
  ['lecture', 'college', 'hoorcollege', 'class'],
  ['slide', 'dia', 'sheet', 'presentation', 'presentatie'],
  ['syllabus', 'studiegids', 'cursusgids', 'handbook', 'handleiding'],
  ['teacher', 'docent', 'lecturer', 'instructor', 'professor'],
  ['schedule', 'rooster', 'planning', 'agenda', 'calendar', 'kalender'],
  ['resit', 'herkansing', 'retake', 'reexam'],
  ['literature', 'literatuur', 'reading', 'leesmateriaal', 'article', 'artikel'],
  ['requirement', 'eis', 'vereiste', 'criteria', 'criterium', 'rubric'],
  ['goal', 'doel', 'objective', 'leerdoel', 'outcome'],
  ['summary', 'samenvatting', 'recap', 'overview', 'overzicht'],
  ['mandatory', 'verplicht', 'required', 'compulsory'],
  ['attendance', 'aanwezigheid', 'present', 'aanwezig'],
  ['group', 'groep', 'team', 'groepswerk'],
  ['feedback', 'terugkoppeling', 'commentaar', 'comment', 'beoordeling'],
  ['week', 'weken', 'weekly', 'wekelijks'],
  ['presentation', 'presentatie', 'pitch'],
  ['paper', 'essay', 'verslag', 'report', 'scriptie', 'thesis'],
  ['question', 'vraag', 'questions', 'vragen'],
  ['answer', 'antwoord', 'solution', 'oplossing', 'uitwerking'],
];

const SUMMARY_WORDS = [
  'summar', 'samenvat', 'recap', 'main point', 'key point', 'belangrijkste', 'vat samen', 'tl;dr', 'tldr', 'in short', 'kort samen',
  'overview', 'overzicht', 'covered', 'behandeld', 'besproken', 'what did we', 'wat hebben we', 'takeaway', 'what do i need to know',
  'wat moet ik weten', 'go through', 'doorlopen', 'walk me through', 'bespreek', 'what was in', 'wat zat er in', 'wat stond er in',
];
const BROAD_PHRASES = [
  'complete briefing', 'whole course', 'entire course', 'everything about', 'hele cursus', 'hele vak', 'alles over de cursus',
  'study notes', 'briefing', 'overview of the course', 'overzicht van de cursus', 'overzicht van het vak',
];
const EXPLAIN_WORDS = ['explain', 'why', 'how does', 'how do', 'how can', 'uitleg', 'leg uit', 'waarom', 'hoe werkt', 'hoe werken', 'difference', 'verschil', 'compare', 'vergelijk', 'describe', 'beschrijf', 'what is', 'wat is', 'what are', 'wat zijn', 'meaning', 'betekent'];
const FACT_STARTS = ['when', 'where', 'who', 'which', 'how many', 'how much', 'how long', 'wanneer', 'waar', 'wie', 'welke', 'welk', 'hoeveel', 'hoe laat', 'hoe lang', 'is ', 'are ', 'zijn ', 'does ', 'heeft ', 'mag ', 'kan ', 'can '];

const hasWordStart = (text: string, needle: string): boolean => {
  let from = 0;
  while (true) {
    const idx = text.indexOf(needle, from);
    if (idx === -1) return false;
    if (idx === 0 || !/[a-z0-9]/.test(text[idx - 1])) return true;
    from = idx + needle.length;
  }
};

/** Dutch glues words together ("eindtoets", "tentamenweek"): longer roots also match inside a word. */
const matchesSectionWord = (text: string, word: string): boolean =>
  word.length >= 5 ? text.includes(word) : hasWordStart(text, word);

const startsWithAny = (text: string, list: string[]) => list.some((p) => text.startsWith(p));

export function expandTokens(tokens: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tokens) {
    for (const group of SYNONYM_GROUPS) {
      if (!group.some((g) => g === t || (t.length >= 4 && (g.startsWith(t) || t.startsWith(g))))) continue;
      for (const g of group) if (g !== t && !tokens.includes(g)) out.set(g, 0.6);
    }
  }
  return out;
}

export function analyzeQuery(query: string): QueryAnalysis {
  const normalized = normalizeText(query).replace(/\s+/g, ' ').trim();
  const tokens = tokenizeQuery(query);

  const sections = new Set<SectionId>();
  for (const [section, words] of Object.entries(SECTION_WORDS) as Array<[SectionId, string[]]>) {
    if (words.some((w) => matchesSectionWord(normalized, w))) sections.add(section);
  }
  for (const s of [...sections]) for (const extra of IMPLIES[s] ?? []) sections.add(extra);

  const slideRefs: number[] = [];
  const pageRefs: number[] = [];
  for (const m of normalized.matchAll(/\b(?:slides?|sheets?|dia'?s?|diapositief)\s*(?:nr\.?|no\.?|number|nummer)?\s*(\d{1,3})\b/g)) slideRefs.push(Number(m[1]));
  for (const m of normalized.matchAll(/\b(?:pages?|pagina'?s?|pag|p|bladzijde|blz)\.?\s*(\d{1,4})\b/g)) pageRefs.push(Number(m[1]));

  const wantsSummary = SUMMARY_WORDS.some((w) => normalized.includes(w)) || /\bvat\b.*\bsamen\b/.test(normalized);
  const broad = BROAD_PHRASES.some((p) => normalized.includes(p));
  let kind: QueryKind;
  if (broad) kind = 'broad';
  else if (wantsSummary) kind = 'summary-doc';
  else if (EXPLAIN_WORDS.some((w) => normalized.includes(w))) kind = 'explain';
  else if (tokens.length <= 9 && (startsWithAny(normalized, FACT_STARTS) || /\d/.test(normalized) || sections.size > 0)) kind = 'fact';
  else kind = 'explain';

  const unitRefs = findUnitRefs(normalized);
  // "wat zit er in college 2" is about the lecture's content; "how many slides does lecture 4 have" or a date or
  // grade question stays a fact
  if (kind === 'fact' && unitRefs.length > 0 && sections.size === 0 && !startsWithAny(normalized, FACT_STARTS)) kind = 'explain';
  return { tokens, expanded: expandTokens(tokens), sections, kind, wantsSummary, slideRefs, pageRefs, unitRefs, normalized };
}

/** Token budget (documents) per kind of question. */
export const KIND_BUDGETS: Record<QueryKind, number> = {
  fact: 10_000,
  explain: 25_000,
  'summary-doc': 60_000,
  broad: 90_000,
};
