import { describe, expect, it } from 'vitest';
import { selectRelevantDocuments, tokenizeQuery } from '@/services/context/relevance';
import { serializeToMarkdown } from '@/services/context/contextSerializer';
import type { CourseContextBundle } from '@/types/parser';

const doc = (title: string, content: string, modulePath = 'Course > Week 1') => ({
  title,
  type: 'pdf',
  content,
  topicId: title,
  modulePath,
});

const bundle: CourseContextBundle = {
  courseInfo: { orgUnitId: '1', courseName: 'Distributed Systems', exportedAt: '' },
  overview: 'Overview text',
  documents: [
    doc('Raft_Paper.pdf', 'Raft is a consensus algorithm. Leader election uses randomized timeouts. '.repeat(20), 'Course > Week 2: Consensus'),
    doc('Intro_Slides.pptx', 'Welcome to the course. Logistics and grading overview. '.repeat(20), 'Course > Week 1'),
    doc('Networking.pdf', 'TCP, UDP, sockets and packets. '.repeat(20), 'Course > Week 3'),
  ],
};

describe('relevance filter', () => {
  it('tokenizes without stopwords (NL + EN) and keeps numbers', () => {
    expect(tokenizeQuery('Kun je de slides van week 3 samenvatten?')).toEqual(['slide', 'week', '3']);
  });

  it('selects the document named in the question and lists the rest as omitted', () => {
    const { bundle: out, stats } = selectRelevantDocuments(bundle, 'Summarize the Raft_Paper please');
    expect(out.documents.map((d) => d.title)).toEqual(['Raft_Paper.pdf']);
    expect(stats.matched).toBe(true);
    expect(out.omittedDocuments?.map((d) => d.title).sort()).toEqual(['Intro_Slides.pptx', 'Networking.pdf']);
    expect(out.overview).toBe('Overview text');
  });

  it('matches on content and module path (week numbers)', () => {
    expect(selectRelevantDocuments(bundle, 'how does leader election work').bundle.documents[0].title).toBe('Raft_Paper.pdf');
    expect(selectRelevantDocuments(bundle, 'what is in week 3').bundle.documents.map((d) => d.title)).toEqual(['Networking.pdf']);
  });

  it('falls back to course order within the budget when nothing matches', () => {
    const { bundle: out, stats } = selectRelevantDocuments(bundle, 'zzzz qqqq', { tokenBudget: 600 });
    expect(stats.matched).toBe(false);
    expect(out.documents.length).toBeGreaterThan(0);
    expect(out.documents.length).toBeLessThan(3);
    expect(out.omittedDocuments?.length).toBeGreaterThan(0);
  });

  it("'all' mode includes everything that fits", () => {
    const { bundle: out } = selectRelevantDocuments(bundle, 'x', { mode: 'all' });
    expect(out.documents).toHaveLength(3);
    expect(out.omittedDocuments).toBeUndefined();
  });

  it('always keeps the best match even if it exceeds the budget', () => {
    const { bundle: out } = selectRelevantDocuments(bundle, 'Raft_Paper', { tokenBudget: 10 });
    expect(out.documents.map((d) => d.title)).toEqual(['Raft_Paper.pdf']);
  });

  it('serializes an omitted-documents notice for the model', () => {
    const { bundle: out } = selectRelevantDocuments(bundle, 'Raft_Paper');
    const md = serializeToMarkdown(out);
    expect(md).toContain('Not Included In This Request');
    expect(md).toContain('Networking.pdf');
  });
});
