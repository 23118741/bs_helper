import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareContext } from '@/services/context/prepareContext';
import { llm, saveLLMSettings } from '@/services/llm/llmClient';
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
    doc('Raft_Paper.pdf', 'Raft is a consensus algorithm. Leader election uses randomized timeouts. '.repeat(20), 'Course > Week 2'),
    doc('Intro_Slides.pptx', 'Welcome to the course. Logistics and grading overview. '.repeat(20)),
    doc('Networking.pdf', 'TCP, UDP, sockets and packets. '.repeat(20), 'Course > Week 3'),
  ],
};

describe('prepareContext: the relevance filter is the default', () => {
  it('filters by the prompt without any option', () => {
    const p = prepareContext({ bundle, prompt: 'how does leader election work' });
    expect(p.bundle!.documents.map((d) => d.title)).toEqual(['Raft_Paper.pdf']);
    expect(p.stats).toMatchObject({ totalDocuments: 3, includedDocuments: 1, matched: true, includedTopicIds: ['Raft_Paper.pdf'] });
    expect(p.serialized).toContain('Leader election');
    expect(p.serialized).toContain('Not Included In This Request');
    expect(p.serialized).not.toContain('TCP, UDP');
  });

  it('uses relevance.query instead of the (wrapped) prompt', () => {
    const wrapped = 'Answer the following student question using ONLY the provided course materials. Question: "x"';
    const p = prepareContext({ bundle, prompt: wrapped, relevance: { query: 'sockets and packets' } });
    expect(p.bundle!.documents.map((d) => d.title)).toEqual(['Networking.pdf']);
  });

  it('uses earlier user turns for follow-up questions', () => {
    const p = prepareContext({
      bundle,
      prompt: 'and what about the next part?',
      history: [
        { role: 'user', text: 'explain the Raft_Paper' },
        { role: 'model', text: 'sure' },
      ],
    });
    expect(p.bundle!.documents.map((d) => d.title)).toContain('Raft_Paper.pdf');
  });

  it("'all' sends everything that fits, 'off' sends the whole bundle unfiltered", () => {
    expect(prepareContext({ bundle, prompt: 'x', relevance: { mode: 'all' } }).bundle!.documents).toHaveLength(3);
    const off = prepareContext({ bundle, prompt: 'leader', relevance: 'off' });
    expect(off.bundle!.documents).toHaveLength(3);
    expect(off.serialized).not.toContain('Not Included');
    expect(off.stats).toMatchObject({ totalDocuments: 3, includedDocuments: 3 });
  });

  it('returns nothing without a bundle and supports JSON output', () => {
    expect(prepareContext({ prompt: 'x' })).toEqual({});
    const json = prepareContext({ bundle, prompt: 'leader election', format: 'json' }).serialized!;
    expect(JSON.parse(json).documents).toHaveLength(1);
  });
});

describe('llm.generate applies the filter to every context bundle (any tool, any mode)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
      }),
      headers: new Headers(),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await saveLLMSettings({ mode: 'gemini', geminiApiKey: 'k' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sentText = () => JSON.parse(fetchMock.mock.calls[0][1].body).contents[0].parts[0].text as string;

  it('sends only relevant documents by default and reports what it sent', async () => {
    const res = await llm.generate('Explain leader election', { mode: 'gemini', contextBundle: bundle });
    expect(sentText()).toContain('Raft is a consensus algorithm');
    expect(sentText()).not.toContain('TCP, UDP');
    expect(sentText()).not.toContain('Logistics and grading');
    expect(res.contextStats).toMatchObject({ totalDocuments: 3, includedDocuments: 1 });
  });

  it('honours an explicit query, mode all and off', async () => {
    await llm.generate('Wrapped template text', { mode: 'gemini', contextBundle: bundle, relevance: { query: 'sockets packets' } });
    expect(sentText()).toContain('TCP, UDP');
    expect(sentText()).not.toContain('Raft is a consensus');

    fetchMock.mockClear();
    await llm.generate('x', { mode: 'gemini', contextBundle: bundle, relevance: { mode: 'all' } });
    expect(sentText()).toContain('Raft is a consensus');
    expect(sentText()).toContain('TCP, UDP');

    fetchMock.mockClear();
    const off = await llm.generate('leader election', { mode: 'gemini', contextBundle: bundle, relevance: 'off' });
    expect(sentText()).toContain('TCP, UDP');
    expect(off.contextStats?.includedDocuments).toBe(3);
  });

  it('a pre-serialized context is sent as is (explicit escape hatch)', async () => {
    const res = await llm.generate('q', { mode: 'gemini', serializedContext: 'MY OWN CONTEXT' });
    expect(sentText()).toContain('MY OWN CONTEXT');
    expect(res.contextStats).toBeUndefined();
  });
});

describe('llm.rawChat uses the same filter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ candidates: [{ content: { parts: [{ text: '**bold** answer' }] }, finishReason: 'STOP' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await saveLLMSettings({ geminiApiKey: 'k' });
  });
  afterEach(() => vi.unstubAllGlobals());

  const firstTurn = () => JSON.parse(fetchMock.mock.calls[0][1].body).contents[0].parts[0].text as string;

  it('filters by default, unfiltered with relevance off', async () => {
    const res = await llm.rawChat([{ role: 'user', text: 'explain leader election' }], { contextBundle: bundle });
    expect(firstTurn()).toContain('Raft is a consensus');
    expect(firstTurn()).not.toContain('TCP, UDP');
    expect(res.contextStats).toMatchObject({ includedDocuments: 1, totalDocuments: 3 });
    expect(res.contextMarkdown).toBe(firstTurn().replace('Course context from Brightspace:\n\n', ''));

    fetchMock.mockClear();
    await llm.rawChat([{ role: 'user', text: 'explain leader election' }], { contextBundle: bundle, relevance: 'off' });
    expect(firstTurn()).toContain('TCP, UDP');
  });

  it('uses earlier user turns for follow-ups', async () => {
    await llm.rawChat(
      [
        { role: 'user', text: 'tell me about the Raft_Paper' },
        { role: 'model', text: 'ok' },
        { role: 'user', text: 'and the next part?' },
      ],
      { contextBundle: bundle }
    );
    expect(firstTurn()).toContain('Raft is a consensus');
  });
});
