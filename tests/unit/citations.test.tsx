import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { hasCitation, isUncited, needsSource, normalizeCitations, parseCitation, pickCited, resolveCitation } from '@/services/llm/citations';
import { AnswerSourcesProvider, StructuredMarkdown } from '@/components/StructuredMarkdown';
import type { SourceRegistry } from '@/services/context/sourceRegistry';

const reg: SourceRegistry = {
  D77: { id: 'D77', label: 'Lecture 3 - Dependency', kind: 'document', url: 'https://x/77' },
  D10: { id: 'D10', label: 'Syllabus 2025', kind: 'document', url: 'https://x/10' },
  U1: { id: 'U1', label: 'my-notes.md', kind: 'user-file', reason: 'Your own file: it is not in Brightspace' },
  GRADES: { id: 'GRADES', label: 'Grades', kind: 'section', url: 'https://x/grades' },
};

describe('citation parsing', () => {
  it('reads ids with a locator, several sources, and rejects anything that is not an id', () => {
    expect(parseCitation('D77 Slide 14')).toEqual([{ id: 'D77', locator: 'Slide 14' }]);
    expect(parseCitation('GRADES')).toEqual([{ id: 'GRADES', locator: '' }]);
    expect(parseCitation('D77 p. 2; D10')).toEqual([{ id: 'D77', locator: 'p. 2' }, { id: 'D10', locator: '' }]);
    expect(parseCitation('lecture notes')).toBeNull();
  });

  it('shows the label from the registry; an unknown id is "?" and says so', () => {
    expect(resolveCitation({ id: 'D77', locator: 'Slide 14' }, reg)).toMatchObject({ known: true, text: 'Lecture 3 - Dependency · Slide 14', url: 'https://x/77' });
    expect(resolveCitation({ id: 'U1', locator: '' }, reg)).toMatchObject({ known: true, url: undefined, reason: 'Your own file: it is not in Brightspace' });
    expect(resolveCitation({ id: 'D999', locator: '' }, reg)).toMatchObject({ known: false, text: '?' });
  });

  it('turns an older free-text citation into an id when it clearly names one source; leaves the rest', () => {
    expect(normalizeCitations('Due Friday [Syllabus 2025 p. 2].', reg)).toBe('Due Friday [[D10 p. 2]].');
    expect(normalizeCitations('See [Lecture 3 Slide 4] and [Grades].', reg)).toBe('See [[D77 Slide 4]] and [[GRADES]].');
    expect(normalizeCitations('Both [Syllabus 2025 p. 2; Lecture 3 - Dependency Slide 1]', reg)).toBe('Both [[D10 p. 2]] [[D77 Slide 1]]');
    expect(normalizeCitations('Unknown [Slide 4] and [x]', reg)).toBe('Unknown [Slide 4] and [x]');
    expect(normalizeCitations('Already [[D77 Slide 2]] and a [link](http://a)', reg)).toBe('Already [[D77 Slide 2]] and a [link](http://a)');
    expect(normalizeCitations('text [Grades]', undefined)).toBe('text [Grades]');
  });

  it('keeps only the sources an answer cites', () => {
    expect(Object.keys(pickCited('a [[D77 Slide 1]] b [[GRADES]] c [[D404]]', reg)).sort()).toEqual(['D77', 'GRADES']);
  });
});

describe('statements without a source', () => {
  it('needs a source: substance; not: headings-like lead-ins, questions, short lines, the standard absence answer', () => {
    expect(needsSource('The midterm counts for thirty percent of the grade.')).toBe(true);
    expect(needsSource('Overview of the assessments:')).toBe(false);
    expect(needsSource('Which part is unclear?')).toBe(false);
    expect(needsSource('Due Friday')).toBe(false);
    expect(needsSource('Not specified in the selected Brightspace materials.')).toBe(false);
    expect(needsSource('Homework 30%', 2)).toBe(true);
  });

  it('is uncited when it needs a source and has none of any style', () => {
    expect(isUncited('The midterm counts for thirty percent [[D10 p. 2]].')).toBe(false);
    expect(isUncited('The midterm counts for thirty percent [Slide 4].')).toBe(false);
    expect(isUncited('The midterm counts for thirty percent.')).toBe(true);
    expect(hasCitation('x [[D1]]')).toBe(true);
  });
});

describe('how an answer is shown', () => {
  const md = [
    'Dependency is explained in the lecture [[D77 Slide 14]] and the notes [[U1]] and the grading [[GRADES]].',
    '',
    'Something invented [[D404]] by the model about the course.',
    '',
    'This statement has no source at all.',
    '',
    '- **Pass at 55%** according to the syllabus [[D10 p. 2]]',
    '- Bullet that mentions the exam without any source here',
    '',
    '| Part | Weight | Source |',
    '|---|---|---|',
    '| Homework | 30% | [[D10 p. 2]] |',
    '| Midterm exam | 30% | |',
  ].join('\n');

  it('uses one look per kind of source and marks only what has no source', () => {
    const { container } = render(
      <AnswerSourcesProvider value={reg}>
        <StructuredMarkdown content={md} />
      </AnswerSourcesProvider>
    );
    const cites = Array.from(container.querySelectorAll('[data-citation]'));
    const byText = (t: string) => cites.find((c) => c.textContent === t) as HTMLElement;

    const link = byText('Lecture 3 - Dependency · Slide 14') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://x/77');
    expect(link.className).toContain('text-blue-600');

    const own = byText('my-notes.md');
    expect(own.tagName).toBe('SPAN');
    expect(own.className).toContain('bg-slate-100');
    expect(own.getAttribute('title')).toBe('Your own file: it is not in Brightspace');

    const unknown = byText('?');
    expect(unknown.tagName).toBe('SPAN');
    expect(unknown.getAttribute('title')).toMatch(/not in your course materials/);

    // the answer's own text is never shown as a source, and a source in bold stays a link
    expect(container.querySelectorAll('strong').length).toBe(1);
    expect(container.querySelectorAll('[data-uncited]')).toHaveLength(3); // paragraph, bullet, table row
  });

  it('without a registry (old messages, raw chat) nothing is marked', () => {
    const { container } = render(<StructuredMarkdown content={'This statement has no source at all.'} />);
    expect(container.querySelectorAll('[data-uncited]')).toHaveLength(0);
  });
});
