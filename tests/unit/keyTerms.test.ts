import { describe, expect, it } from 'vitest';
import {
  buildKeyTermsPrompt,
  buildSyllabusBundle,
  findSyllabusDocs,
  formatKeyTerms,
  parseKeyTerms,
  quoteInContext,
  runKeyTerms,
  verifyKeyTerms,
} from '@/services/actions/keyTerms';
import type { CourseContextBundle } from '@/types/parser';

const CONTEXT = '## Lecture 3\n\nThe **terms of trade** deteriorate: primary-export prices fall relative to manufactures — Prebisch’s thesis.';

describe('key terms', () => {
  it('the prompt asks for the four fields and forbids outside knowledge', () => {
    const p = buildKeyTermsPrompt('Latin America');
    for (const f of ['term', 'definition', 'source', 'evidence_quote']) expect(p).toContain(f);
    expect(p).toContain('Latin America');
    expect(p).toMatch(/VERBATIM/);
  });

  it('parses plain JSON, fenced JSON and JSON with surrounding text; drops items without term or definition', () => {
    const json = '[{"term":"A","definition":"d","source":"s","evidence_quote":"q"},{"term":"","definition":"x"},5]';
    expect(parseKeyTerms(json)).toEqual([{ term: 'A', definition: 'd', source: 's', evidence_quote: 'q' }]);
    expect(parseKeyTerms('```json\n' + json + '\n```')).toHaveLength(1);
    expect(parseKeyTerms('Here you go: ' + json)).toHaveLength(1);
    expect(parseKeyTerms('not json')).toBeNull();
    expect(parseKeyTerms('[broken')).toBeNull();
  });

  it('matches quotes despite markdown, quote style, dashes and whitespace', () => {
    expect(quoteInContext('terms of trade deteriorate', CONTEXT)).toBe(true);
    expect(quoteInContext("Prebisch's thesis", CONTEXT)).toBe(true);
    expect(quoteInContext('manufactures - Prebisch', CONTEXT)).toBe(true);
  });

  it('allows an ellipsis between fragments but rejects invented text and empty quotes', () => {
    expect(quoteInContext('terms of trade … Prebisch', CONTEXT)).toBe(true);
    expect(quoteInContext('terms of trade ... something else', CONTEXT)).toBe(false);
    expect(quoteInContext('the long-run decline of commodity prices', CONTEXT)).toBe(false);
    expect(quoteInContext('', CONTEXT)).toBe(false);
    expect(quoteInContext('terms of trade', '')).toBe(false);
  });

  it('flags unsupported definitions in the output and escapes pipes', () => {
    const terms = verifyKeyTerms(
      [
        { term: 'Terms of trade', definition: 'a | b', source: 'Lecture 3', evidence_quote: 'terms of trade deteriorate' },
        { term: 'Divergence', definition: 'general', source: '', evidence_quote: 'made up' },
      ],
      CONTEXT
    );
    expect(terms.map((t) => t.verified)).toEqual([true, false]);
    const md = formatKeyTerms(terms);
    expect(md).toContain('| Term | Definition | Source | Evidence |');
    expect(md).toContain('a \\| b');
    expect(md).toContain('⚠ quote not found');
    expect(md).toContain('1 of 2 definitions');
  });

  it('an empty list gives the standard absence sentence', () => {
    expect(formatKeyTerms([])).toBe('Not specified in the selected Brightspace materials.');
  });
});

const doc = (title: string, content: string, modulePath?: string) => ({ title, type: 'pdf', content, modulePath });
const bundleOf = (documents: CourseContextBundle['documents'], overview?: string): CourseContextBundle =>
  ({ courseInfo: { name: 'LatAm' }, documents, overview }) as unknown as CourseContextBundle;

describe('syllabus first', () => {
  it('recognises the syllabus by title or module path, in Dutch and English', () => {
    const b = bundleOf([
      doc('Syllabus 2025', 'x'),
      doc('Studiegids', 'x'),
      doc('Lecture 1', 'x', 'Content > Cursusgids'),
      doc('Lecture 2', 'x'),
    ]);
    expect(findSyllabusDocs(b).map((d) => d.title)).toEqual(['Syllabus 2025', 'Studiegids', 'Lecture 1']);
  });

  it('the syllabus bundle holds only the syllabus; without syllabus (or definitions in the overview) it is null', () => {
    const b = bundleOf([doc('Syllabus', 's'), doc('Lecture 2', 'l')]);
    expect(buildSyllabusBundle(b)?.documents.map((d) => d.title)).toEqual(['Syllabus']);
    expect(buildSyllabusBundle(bundleOf([doc('Lecture 2', 'l')]))).toBeNull();
    expect(buildSyllabusBundle(bundleOf([], 'Kernbegrippen: divergentie ...'))?.overview).toContain('Kernbegrippen');
  });

  const term = (t: string, q: string) => JSON.stringify([{ term: t, definition: 'd', source: 's', evidence_quote: q }]);

  it('asks the syllabus first, then the course for the other terms; syllabus wins on duplicates, quotes are checked per step', async () => {
    const calls: Array<{ prompt: string; titles: string[] }> = [];
    const generate = async (prompt: string, options: any) => {
      const titles = options.contextBundle.documents.map((d: any) => d.title);
      calls.push({ prompt, titles });
      const syllabusStep = titles.length === 1 && titles[0] === 'Syllabus';
      return {
        text: syllabusStep
          ? term('Divergence', 'divergence means falling behind')
          : JSON.stringify([
              { term: 'Divergence', definition: 'other', source: 'L1', evidence_quote: 'general' },
              { term: 'ISI', definition: 'd', source: 'L3', evidence_quote: 'import substitution' },
            ]),
        serializedContext: syllabusStep ? 'Divergence means falling behind' : 'Import substitution industrialisation',
        tokenEstimate: 10,
      } as any;
    };
    const b = bundleOf([doc('Syllabus', 's'), doc('Lecture 3', 'l')]);
    const res = await runKeyTerms({ generate, bundle: b, courseName: 'LatAm', options: { mode: 'backend' } });

    expect(calls).toHaveLength(2);
    expect(calls[0].titles).toEqual(['Syllabus']);
    expect(calls[0].prompt).toMatch(/Only the syllabus/);
    expect(calls[1].titles).toEqual(['Syllabus', 'Lecture 3']);
    expect(calls[1].prompt).toContain('already defined by the syllabus');
    expect(calls[1].prompt).toContain('Divergence');
    expect(res.tokenEstimate).toBe(20);
    expect(res.text.match(/Divergence/g)).toHaveLength(1); // the syllabus definition only
    expect(res.text.indexOf('Divergence')).toBeLessThan(res.text.indexOf('ISI'));
    expect(res.text).not.toContain('⚠');
  });

  it('without a syllabus only the course is searched (one request)', async () => {
    let n = 0;
    const generate = async () => {
      n++;
      return { text: '[]', serializedContext: '', tokenEstimate: 1 } as any;
    };
    const res = await runKeyTerms({ generate, bundle: bundleOf([doc('Lecture 3', 'l')]), options: {} });
    expect(n).toBe(1);
    expect(res.text).toBe('Not specified in the selected Brightspace materials.');
  });

  it('when the answer is not a term list the raw text is kept', async () => {
    const generate = async () => ({ text: 'Sorry, no.', serializedContext: '' }) as any;
    const res = await runKeyTerms({ generate, bundle: bundleOf([doc('Lecture 3', 'l')]), options: {} });
    expect(res.text).toBe('Sorry, no.');
  });
});
