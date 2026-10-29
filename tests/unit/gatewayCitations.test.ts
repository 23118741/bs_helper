import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { llm, saveLLMSettings } from '@/services/llm/llmClient';
import { runKeyTerms, verifyKeyTerms } from '@/services/actions/keyTerms';
import type { CourseContextBundle } from '@/types/parser';

const bundle: CourseContextBundle = {
  courseInfo: { orgUnitId: '1', courseName: 'C', exportedAt: '' },
  documents: [
    { title: 'Lecture 3', type: 'pdf', content: '[Page 1]\n\nRaft elects a leader.', topicId: '77', modulePath: 'W1' },
    { title: 'Syllabus', type: 'pdf', content: '[Page 1]\n\nDivergence means falling behind.', topicId: '10', modulePath: 'W0' },
  ],
};

function reply(text: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: {} }),
      headers: new Headers(),
    }))
  );
}

beforeEach(async () => {
  await saveLLMSettings({ mode: 'gemini', geminiApiKey: 'k' });
});
afterEach(() => vi.unstubAllGlobals());

describe('the gateway and citations', () => {
  it('sends the ids in the context and returns the registry with the answer', async () => {
    let sent = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        sent = JSON.parse(init.body as string).contents[0].parts[0].text;
        return {
          ok: true, status: 200, statusText: 'OK', headers: new Headers(),
          json: async () => ({ candidates: [{ content: { parts: [{ text: 'Raft elects a leader [[D77 Page 1]].' }] }, finishReason: 'STOP' }], usageMetadata: {} }),
        };
      })
    );
    const res = await llm.generate('Who is elected according to Lecture 3?', { mode: 'gemini', contextBundle: bundle, kind: 'chat' });
    expect(sent).toContain('[[D77]]');
    expect(res.sources?.D77.label).toBe('Lecture 3');
    expect(res.text).toBe('Raft elects a leader [[D77 Page 1]].');
  });

  it('turns an older free-text citation in the answer into an id', async () => {
    reply('Raft elects a leader [Lecture 3 Page 1].');
    const res = await llm.generate('Who is elected according to Lecture 3?', { mode: 'gemini', contextBundle: bundle, kind: 'chat' });
    expect(res.text).toBe('Raft elects a leader [[D77 Page 1]].');
  });

  it('leaves JSON answers alone', async () => {
    reply('[{"term":"A","definition":"d","source":"D77 Page 1","evidence_quote":"q"}]');
    const res = await llm.generate('List terms', { mode: 'gemini', contextBundle: bundle, kind: 'preset' });
    expect(res.text).toContain('"source":"D77 Page 1"');
  });
});

describe('key terms cite by id', () => {
  it('a quote must come from the document that is cited', () => {
    const docs: Record<string, string> = { D77: 'Raft elects a leader.', D10: 'Divergence means falling behind.' };
    const ctx = `${docs.D77}\n${docs.D10}`;
    const [ok, wrong, unknown] = verifyKeyTerms(
      [
        { term: 'Raft', definition: 'd', source: 'D77 Page 1', evidence_quote: 'Raft elects a leader' },
        { term: 'Divergence', definition: 'd', source: 'D77 Page 1', evidence_quote: 'Divergence means falling behind' }, // quote is in D10
        { term: 'X', definition: 'd', source: 'D404', evidence_quote: 'Raft elects a leader' },
      ],
      ctx,
      (id) => docs[id]
    );
    expect(ok.verified).toBe(true);
    expect(wrong.verified).toBe(false);
    expect(unknown.verified).toBe(true); // not a document we can read: the context check applies, the citation shows as "?"
  });

  it('the answer cites the ids and carries the registry of both steps', async () => {
    const generate = async (_p: string, options: any) => {
      const titles = options.contextBundle.documents.map((d: any) => d.title);
      const syllabus = titles.length === 1;
      return {
        text: JSON.stringify([
          syllabus
            ? { term: 'Divergence', definition: 'd', source: 'D10 Page 1', evidence_quote: 'Divergence means falling behind' }
            : { term: 'Raft', definition: 'd', source: 'D77 Page 1', evidence_quote: 'Raft elects a leader' },
        ]),
        serializedContext: syllabus ? 'Divergence means falling behind' : 'Raft elects a leader. Divergence means falling behind',
        sources: syllabus ? { D10: { id: 'D10', label: 'Syllabus', kind: 'document' } } : { D77: { id: 'D77', label: 'Lecture 3', kind: 'document' } },
      } as any;
    };
    const res = await runKeyTerms({ generate, bundle, options: {} });
    expect(res.text).toContain('[[D10 Page 1]]');
    expect(res.text).toContain('[[D77 Page 1]]');
    expect(Object.keys(res.sources ?? {}).sort()).toEqual(['D10', 'D77']);
  });
});
