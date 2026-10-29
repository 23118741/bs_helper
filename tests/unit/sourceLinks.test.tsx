import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { buildSourceResolver } from '@/services/brightspace/sourceLinks';
import { AnswerSourcesProvider, SourceLinksProvider, StructuredMarkdown } from '@/components/StructuredMarkdown';
import { formatKeyTerms } from '@/services/actions/keyTerms';
import type { CourseData } from '@/types/brightspace';

const course = {
  orgUnitId: '123',
  courseName: 'LatAm',
  fetchedAt: 0,
  toc: [
    {
      moduleId: 'm1',
      title: 'Week 1',
      subModules: [{ moduleId: 'm2', title: 'Sub', subModules: [], topics: [{ topicId: '77', title: 'Lecture 3 - Dependency.pptx', type: 'file' }] }],
      topics: [
        { topicId: '10', title: 'Syllabus 2025.pdf', type: 'file' },
        { topicId: '11', title: 'Lecture 1', type: 'file' },
        { topicId: '12', title: 'Lecture 1 Extra', type: 'file' },
      ],
    },
  ],
  assignments: [{ id: '9', name: 'Assignment 1', instructions: '' }],
} as unknown as CourseData;

const base = 'https://school.brightspace.com';
const resolve = buildSourceResolver(course, base);
const view = (id: string) => `${base}/d2l/le/content/123/viewContent/${id}/View`;

describe('source links', () => {
  it('links a citation to the topic whose title it contains, ignoring slide/page numbers and file extensions', () => {
    expect(resolve('[Syllabus 2025 p. 2]')).toBe(view('10'));
    expect(resolve('[Source: Syllabus 2025.pdf, p. 3]')).toBe(view('10'));
    expect(resolve('[Lecture 3 - Dependency Slide 14]')).toBe(view('77')); // topic in a sub module
  });

  it('accepts a shortened title only when it is unambiguous; the longest full title wins', () => {
    expect(resolve('[Lecture 3 Slide 14]')).toBe(view('77'));
    expect(resolve('[Lecture 1 Extra Slide 2]')).toBe(view('12')); // not "Lecture 1"
    expect(resolve('[Lecture 1]')).toBe(view('11'));
    expect(resolve('[Syllabus p. 2]')).toBe(view('10'));
  });

  it('does not guess: unknown or too generic citations are not linked', () => {
    expect(resolve('[Slide 4]')).toBeUndefined();
    expect(resolve('[Source]')).toBeUndefined();
    expect(resolve('[Lecture 9 Slide 2]')).toBeUndefined();
  });

  it('links assignments to their dropbox folder', () => {
    expect(resolve('[Assignment 1]')).toContain('/d2l/lms/dropbox/user/folder_submit_files.d2l?db=9');
  });

  it('renders a found citation as a blue link that opens Brightspace, an unknown citation as blue text, other brackets untouched', () => {
    const { container } = render(
      <SourceLinksProvider value={resolve}>
        <StructuredMarkdown content="Due Friday [Syllabus 2025 p. 2] and see [Slide 4]. Array [1, 2] and [x]." />
      </SourceLinksProvider>
    );
    const cites = container.querySelectorAll('[data-citation]');
    expect(cites).toHaveLength(2);
    const link = cites[0] as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe(view('10'));
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.className).toContain('text-blue-600');
    expect(link.className).toContain('underline');
    expect(cites[1].tagName).toBe('SPAN');
    // three looks that cannot be confused: link = blue + underline, no link = grey box, body text = neither
    expect(cites[1].className).toContain('text-slate-500');
    expect(cites[1].className).toContain('bg-slate-100');
    expect(cites[1].className).not.toContain('text-blue-600');
    expect(cites[1].className.split(' ')).not.toContain('underline');
    expect(cites[1].getAttribute('title')).toBe('Source (no link available)');
    expect(link.className).not.toContain('bg-slate-100');
    expect(container.textContent).toContain('Array [1, 2] and [x].');
  });

  it('a key terms table cites by id: grey "?" without registry, a link with it', () => {
    const md = formatKeyTerms([{ term: 'ISI', definition: 'd', source: 'D77 Slide 14', evidence_quote: 'q', verified: true }]);
    const plain = render(<StructuredMarkdown content={md} />);
    expect(plain.container.querySelectorAll('a')).toHaveLength(0);
    expect(plain.container.querySelector('[data-citation]')?.textContent).toBe('?');
    const linked = render(
      <AnswerSourcesProvider value={{ D77: { id: 'D77', label: 'Lecture 3', kind: 'document', url: view('77') } }}>
        <StructuredMarkdown content={md} />
      </AnswerSourcesProvider>
    );
    const a = linked.container.querySelector('a[data-citation]');
    expect(a?.getAttribute('href')).toBe(view('77'));
    expect(a?.textContent).toBe('Lecture 3 · Slide 14');
  });
});

describe('more sources are linked', () => {
  const full = {
    ...course,
    assignments: [{ id: '9', name: 'Assignment 1', instructions: '', attachments: [{ fileId: 'f', fileName: 'brief.pdf', downloadUrl: '' }] }],
    quizzes: [{ id: '5', title: 'Midterm Quiz' }],
    announcements: [{ id: 'n1', title: 'Room change', body: '', postedDate: '' }],
  } as unknown as CourseData;
  const r = buildSourceResolver(full, base);

  it('links assignment files, quizzes, announcements and whole sections', () => {
    expect(r('[brief.pdf p. 1]')).toContain('folder_submit_files.d2l?db=9');
    expect(r('[Midterm Quiz]')).toContain('quiz_summary.d2l?qi=5');
    expect(r('[Room change]')).toContain('/d2l/lms/news/main.d2l?ou=123');
    expect(r('[Grades]')).toBe(`${base}/d2l/lms/grades/my_grades/main.d2l?ou=123`);
    expect(r('[Grades & Feedback]')).toContain('/grades/');
    expect(r('[Calendar events]')).toBe(`${base}/d2l/le/calendar/123`);
    expect(r('[Course Overview]')).toBe(`${base}/d2l/home/123`);
    expect(r('[Something else]')).toBeUndefined();
  });

  it('renders citations inside bold and italic text, and several sources in one bracket as separate links', () => {
    const { container } = render(
      <SourceLinksProvider value={r}>
        <StructuredMarkdown content="**Pass at 55% [Syllabus 2025 p. 2]** and *[Grades]* and [Syllabus 2025 p. 3; Lecture 3 - Dependency Slide 2]." />
      </SourceLinksProvider>
    );
    const links = Array.from(container.querySelectorAll('a[data-citation]')).map((a) => a.getAttribute('href'));
    expect(links).toEqual([view('10'), `${base}/d2l/lms/grades/my_grades/main.d2l?ou=123`, view('10'), view('77')]);
    expect(container.querySelector('strong a[data-citation]')).not.toBeNull();
  });
});
