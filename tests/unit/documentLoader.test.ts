import { describe, expect, it } from 'vitest';
import { loadCourseDocuments, collectFileTopics } from '@/services/brightspace/documentLoader';
import { buildContextBundle } from '@/services/context/contextSerializer';
import { createFullContextSelection } from '@/types/parser';
import type { CourseData } from '@/types/brightspace';

const course: CourseData = {
  orgUnitId: 'loader-test-1',
  courseName: 'T',
  fetchedAt: Date.now(),
  toc: [
    {
      moduleId: 'm1',
      title: 'Week 1',
      subModules: [],
      topics: [
        { topicId: 't1', title: 'notes.txt', type: 'file', fileExtension: 'txt', downloadUrl: '/f/1' },
        { topicId: 't2', title: 'broken.pdf', type: 'file', fileExtension: 'pdf', downloadUrl: '/f/2' },
        { topicId: 't3', title: 'link', type: 'link' },
      ],
    },
  ],
};

describe('loadCourseDocuments', () => {
  it('downloads, parses, reports failures, and reaches the context bundle', async () => {
    expect(collectFileTopics(course)).toHaveLength(2);
    const client = {
      async getBinary(path: string) {
        if (path === '/f/2') throw new Error('Forbidden');
        return { data: new TextEncoder().encode('hello slides').buffer, contentType: 'text/plain' };
      },
    };
    let last: any;
    const docs = await loadCourseDocuments(course, { client, onProgress: (p) => (last = p) });
    expect(docs).toHaveLength(1);
    expect(last.failed).toHaveLength(1);
    const bundle = buildContextBundle(course, createFullContextSelection(course), docs);
    expect(bundle.documents[0].content).toContain('hello slides');
  });
});

describe('html topics', () => {
  it('loads and converts HTML course pages', async () => {
    const html: CourseData = {
      ...course,
      orgUnitId: 'loader-test-2',
      toc: [
        {
          moduleId: 'm1',
          title: 'W1',
          subModules: [],
          topics: [
            { topicId: 'h1', title: 'Intro', type: 'html', fileExtension: 'html', downloadUrl: '/content/intro.html' },
          ],
        },
      ],
    };
    const client = {
      async getBinary() {
        return {
          data: new TextEncoder().encode('<html><body><h1>Welcome</h1><p>Exam on <b>Friday</b></p></body></html>').buffer,
          contentType: 'text/html; charset=utf-8',
        };
      },
    };
    const docs = await loadCourseDocuments(html, { client });
    expect(docs).toHaveLength(1);
    expect(docs[0].extractedText).toContain('Welcome');
    expect(docs[0].extractedText).toContain('Friday');
  });
});
