import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitHistory, fitRelatedChats, HISTORY_BUDGET_CHARS } from '@/services/llm/conversationBudget';
import { executeGeminiMode } from '@/services/llm/geminiMode';

const turns = (n: number, size = 10) =>
  Array.from({ length: n }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'model') as 'user' | 'model', text: `${i}`.padEnd(size, '.') }));

describe('how much of the conversation goes along', () => {
  it('keeps the whole conversation when it fits', () => {
    expect(fitHistory(turns(20))).toHaveLength(20);
  });

  it('keeps the newest turns within the budget and starts with a student turn', () => {
    const kept = fitHistory(turns(40, 10_000));
    expect(kept.length).toBeLessThan(40);
    expect(kept.reduce((n, t) => n + t.text.length, 0)).toBeLessThanOrEqual(HISTORY_BUDGET_CHARS);
    expect(kept.at(-1)!.text.startsWith('39')).toBe(true);
    expect(kept[0].role).toBe('user');
  });

  it('shares one budget between the parallel chats', () => {
    const fitted = fitRelatedChats([
      { course: 'A', turns: turns(30, 5_000) },
      { course: 'B', turns: turns(2) },
      { course: 'C', turns: [] },
    ]);
    expect(fitted.map((c) => c.course)).toEqual(['A', 'B']);
    expect(fitted.flatMap((c) => c.turns).reduce((n, t) => n + t.text.length, 0)).toBeLessThanOrEqual(40_000);
  });
});

describe('own Gemini key: the conversation and the parallel chats are sent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends parallel chats, then the conversation, then the question', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await executeGeminiMode('Next?', 'Context + Next?', {
      mode: 'gemini',
      apiKey: 'AIza-own',
      history: [{ role: 'user', text: 'First?' }, { role: 'model', text: 'First answer.' }],
      relatedChats: [{ course: 'Statistics', turns: [{ role: 'user', text: 'Exam?' }, { role: 'model', text: 'Friday.' }] }],
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    const contents = body.contents.map((c: any) => [c.role, c.parts[0].text]);
    expect(contents[0][0]).toBe('user');
    expect(contents[0][1]).toContain('Chat about "Statistics"');
    expect(contents.slice(1)).toEqual([
      ['model', 'Understood.'],
      ['user', 'First?'],
      ['model', 'First answer.'],
      ['user', 'Context + Next?'],
    ]);
  });
});
