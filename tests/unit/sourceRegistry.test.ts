import { describe, expect, it } from 'vitest';
import { buildSourceRegistry, docSourceId } from '@/services/context/sourceRegistry';
import { serializeToMarkdown } from '@/services/context/contextSerializer';
import { prepareContext } from '@/services/context/prepareContext';
import type { CourseContextBundle } from '@/types/parser';

const base = 'https://school.brightspace.com';
const bundle = {
  courseInfo: { orgUnitId: '123', courseName: 'LatAm', exportedAt: 'now' },
  overview: 'Welcome to the course overview text.',
  grades: [{ name: 'Midterm', pointsNumerator: 8, pointsDenominator: 10 }],
  assignments: [{ id: '9', name: 'Assignment 1', instructions: 'Write' }],
  quizzes: [{ id: '5', title: 'Quiz 1' }],
  announcements: [{ id: 'n1', title: 'Room change', body: 'Room 2', postedDate: 'today' }],
  instructors: [{ name: 'Dr X', role: 'Teacher' }],
  documents: [
    { title: 'Lecture 3', type: 'pptx', content: '[Slide 1]\nDependency theory', topicId: '77', modulePath: 'Week 1' },
    { title: 'Reader.pdf', type: 'pdf', content: '[Page 1]\nText', topicId: 'att:assignment:9:f1', modulePath: 'Assignments > Assignment 1 > Attachment' },
    { title: 'my-notes.md', type: 'md', content: 'notes', topicId: 'user:abc', modulePath: 'My files' },
    { title: 'Loose doc', type: 'html', content: 'x', topicId: 'Loose doc.html', modulePath: 'Additional Course Materials' },
  ],
} as unknown as CourseContextBundle;

describe('source registry', () => {
  const reg = buildSourceRegistry(bundle, base);

  it('gives every source in the bundle a stable id, a label and where possible a link', () => {
    expect(reg.D77).toMatchObject({ label: 'Lecture 3', kind: 'document', url: `${base}/d2l/le/content/123/viewContent/77/View` });
    expect(reg.A9.url).toContain('folder_submit_files.d2l?db=9');
    expect(reg.Q5.url).toContain('quiz_summary.d2l?qi=5');
    expect(reg.Nn1.url).toContain('/news/main.d2l');
    expect(reg.GRADES.url).toContain('/grades/');
    expect(reg.OVERVIEW.url).toBe(`${base}/d2l/home/123`);
  });

  it('sources without a Brightspace page have no link and say why', () => {
    expect(reg.STAFF.url).toBeUndefined();
    expect(reg.STAFF.reason).toBeTruthy();
    const user = Object.values(reg).find((e) => e.kind === 'user-file')!;
    expect(user.url).toBeUndefined();
    expect(user.reason).toMatch(/own file/i);
    const loose = reg[docSourceId(bundle.documents[3])];
    expect(loose.url).toBeUndefined();
    expect(loose.reason).toBeTruthy();
  });

  it('an attachment opens on the page of its assignment', () => {
    const att = Object.values(reg).find((e) => e.kind === 'attachment')!;
    expect(att.url).toContain('folder_submit_files.d2l?db=9');
  });

  it('ids do not depend on order or on what else is in the request', () => {
    const only = buildSourceRegistry({ ...bundle, documents: [bundle.documents[0]], grades: undefined } as CourseContextBundle, base);
    expect(only.D77).toEqual(reg.D77);
    expect(docSourceId(bundle.documents[0])).toBe('D77');
  });

  it('without an origin nothing is linked', () => {
    const none = buildSourceRegistry(bundle);
    expect(none.D77.url).toBeUndefined();
    expect(none.D77.reason).toBeTruthy();
  });

  it('the serialized context shows the id at every source, and only ids that exist in the registry', () => {
    const md = serializeToMarkdown(bundle);
    for (const id of ['[[D77]]', '[[A9]]', '[[Q5]]', '[[Nn1]]', '[[GRADES]]', '[[OVERVIEW]]', '[[STAFF]]']) expect(md).toContain(id);
    expect(md).toContain('### Week 1 > Lecture 3 [Slide 1] [[D77]]');
    const shown = Array.from(md.matchAll(/\[\[([A-Za-z0-9]+)\]\]/g)).map((m) => m[1]);
    for (const id of shown) expect(reg[id], id).toBeDefined();
  });

  it('prepareContext returns the registry of what it sent', () => {
    const prepared = prepareContext({ bundle, prompt: 'dependency theory', relevance: { mode: 'all' } });
    expect(prepared.sources?.D77.label).toBe('Lecture 3');
    expect(prepared.serialized).toContain('[[D77]]');
  });
});
