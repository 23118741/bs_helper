import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { llm, readMarkers, saveLLMSettings } from '@/services/llm/llmClient';
import type { CourseContextBundle } from '@/types/parser';

const NF = '[[NOT_FOUND]]';
const SENTENCE = 'Not specified in the selected Brightspace materials.';

const bundle = (withBigSection = true): CourseContextBundle => ({
  courseInfo: { orgUnitId: '1', courseName: 'C', exportedAt: '' },
  announcements: withBigSection
    ? Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, title: `News ${i}`, body: 'The library closes early on Fridays. '.repeat(40), postedDate: '2026-10-01' }))
    : undefined,
  documents: [{ title: 'Lecture.pdf', type: 'pdf', content: '[Page 1]\n\nRaft elects a leader.\n\n[Page 2]\n\nLogs are replicated.', topicId: 'l', modulePath: 'W1' }],
});

let fetchMock: ReturnType<typeof vi.fn>;
let bodies: string[];
let systems: string[];

function replies(...texts: string[]) {
  bodies = [];
  systems = [];
  let i = 0;
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    bodies.push(body.contents[body.contents.length - 1].parts[0].text as string);
    systems.push(body.systemInstruction?.parts?.[0]?.text ?? '');
    const text = texts[Math.min(i++, texts.length - 1)];
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 10, totalTokenCount: 1010 },
      }),
      headers: new Headers(),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(async () => {
  await saveLLMSettings({ mode: 'gemini', geminiApiKey: 'k' });
});
afterEach(() => vi.unstubAllGlobals());

// "according to the course" makes this a course question; the announcements are left out of the first try
const ask = (over: Record<string, unknown> = {}, b = bundle()) =>
  llm.generate('When does the library close according to the course?', { mode: 'gemini', contextBundle: b, kind: 'chat', ...over });

describe('course questions: the answer may be in material that was left out', () => {
  it('searches wider once and answers on the second try, with a status message and summed token usage', async () => {
    replies(NF, 'The library closes early on Fridays [News 0].');
    const onStatus = vi.fn();
    const res = await ask({ onStatus });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.text).toContain('closes early on Fridays');
    expect(res.escalationLevel).toBe(1);
    expect(res.route).toBe('course');
    expect(res.general).toBeUndefined();
    expect(onStatus).toHaveBeenCalledWith('Searching more of your materials…');
    expect(bodies[0]).not.toContain('The library closes early on Fridays');
    expect(bodies[1]).toContain('The library closes early on Fridays'); // the section that was left out is now there
    expect(bodies[1].length).toBeGreaterThan(bodies[0].length);
    expect(res.usage).toMatchObject({ promptTokens: 2000, candidateTokens: 20, totalTokens: 2020 });
    expect(res.text).not.toContain('NOT_FOUND');
  });

  it('after one wider try that still finds nothing, answers as a plain chat without course context, tagged', async () => {
    replies(NF, NF, 'Libraries usually close earlier on Fridays; check the library site.');
    const onStatus = vi.fn();
    const res = await ask({ onStatus });

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 try, 1 wider try, 1 plain chat
    expect(onStatus).toHaveBeenCalledWith('Answering from general knowledge…');
    expect(bodies[2]).not.toContain('Raft elects a leader');
    expect(systems[2]).toContain('without access to the student');
    expect(res.general).toBe(true);
    expect(res.route).toBe('general');
    expect(res.text).toBe('Libraries usually close earlier on Fridays; check the library site.');
    expect(res.escalationLevel).toBe(1);
    expect(res.usage?.totalTokens).toBe(3 * 1010);
    expect(res.contextStats).toBeDefined(); // what was searched stays visible
  });

  it('never shows the internal marker or a bare "not specified" sentence for a chat question', async () => {
    replies(NF, NF, SENTENCE);
    const res = await ask();
    expect(res.text).not.toContain('NOT_FOUND');
    expect(res.general).toBe(true);
  });

  it('answers from general knowledge, tagged, when the model marks its own answer', async () => {
    replies('[[GENERAL]] TCP is reliable and ordered; UDP is not.');
    const res = await ask({}, bundle(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.general).toBe(true);
    expect(res.text).toBe('TCP is reliable and ordered; UDP is not.');
  });

  it('does not search wider when nothing was left out, but goes to a plain chat', async () => {
    replies(NF, 'The materials do not say; ask the teacher.');
    const res = await ask({}, bundle(false));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies[1]).not.toContain('Raft elects a leader');
    expect(res.escalationLevel).toBe(0);
    expect(res.general).toBe(true);
  });

  it('treats the old English sentence like the marker', async () => {
    replies(SENTENCE, 'The library closes early on Fridays [News 0].');
    const res = await ask();
    expect(res.escalationLevel).toBe(1);
  });

  it('does nothing when the answer is a real answer', async () => {
    replies('Friday at 17:00.');
    const res = await ask();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.escalationLevel).toBe(0);
    expect(res.route).toBe('course');
  });

  it('a long answer that merely mentions the phrase is not treated as "not found"', async () => {
    replies(`${'The syllabus describes many topics. '.repeat(15)} (Not specified in the selected Brightspace materials: the room number.)`);
    await ask();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('presets keep their strict sentence and never search wider or switch to a plain chat', async () => {
    replies(SENTENCE);
    const res = await ask({ kind: 'preset' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.text).toBe(SENTENCE);
  });

  it('with escalate:false, relevance off or a pre-serialized context there is no wider search (a plain chat follows)', async () => {
    for (const over of [{ escalate: false }, { relevance: 'off' }]) {
      replies(NF, 'General answer.');
      const res = await ask(over);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(res.escalationLevel).toBe(0);
    }
    replies(NF, 'General answer.');
    await llm.generate('q', { mode: 'gemini', serializedContext: 'ctx' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('questions that match nothing in the course are a plain chat', () => {
  const general = (over: Record<string, unknown> = {}) =>
    llm.generate('What is the difference between TCP and UDP?', { mode: 'gemini', contextBundle: bundle(), kind: 'chat', ...over });

  it('sends no course material, uses the plain-chat prompt and needs one call', async () => {
    replies('TCP is reliable and ordered; UDP is not.');
    const onStatus = vi.fn();
    const res = await general({ onStatus });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodies[0]).not.toContain('Raft elects a leader');
    expect(bodies[0]).not.toContain('Course Context');
    expect(systems[0]).toContain('without access to the student');
    expect(res.route).toBe('general');
    expect(res.general).toBe(true);
    expect(res.contextStats).toBeUndefined();
    expect(res.searchAllAvailable).toBe(true);
    expect(onStatus).toHaveBeenCalledWith('Answering from general knowledge…');
  });

  it('"Search all materials" (relevance mode all) always uses the course', async () => {
    replies('Raft elects a leader [[D1 Page 1]].');
    const res = await general({ relevance: { mode: 'all', sections: 'all' }, escalate: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodies[0]).toContain('Raft elects a leader');
    expect(res.route).toBe('course');
  });
});

describe('readMarkers', () => {
  it('strips both markers and reports them', () => {
    expect(readMarkers('[[NOT_FOUND]]', 'chat')).toEqual({ text: '', notFound: true, general: false });
    expect(readMarkers('[[GENERAL]] Answer.', 'chat')).toEqual({ text: 'Answer.', notFound: false, general: true });
    expect(readMarkers('Plain answer [[D1 p. 2]].', 'chat')).toEqual({ text: 'Plain answer [[D1 p. 2]].', notFound: false, general: false });
  });

  it('the old English sentence only counts for chat questions, not for presets', () => {
    expect(readMarkers(SENTENCE, 'chat').notFound).toBe(true);
    expect(readMarkers(SENTENCE, 'preset').notFound).toBe(false);
    expect(readMarkers('Short answer that is not specified in the selected brightspace materials for the room.', 'chat').notFound).toBe(false);
  });
});

describe('summaries and follow-ups get a full answer from the course', () => {
  const lastBody = () => bodies[bodies.length - 1];

  it('a summary request goes to the course with a depth instruction', async () => {
    replies('## Raft\n\nRaft elects a leader.');
    await llm.generate('summarize the lecture for me', { mode: 'gemini', contextBundle: bundle(false), kind: 'chat' });
    expect(lastBody()).toContain('Course Materials Context');
    expect(lastBody()).toMatch(/Answer depth: the student asks for a comprehensive answer/);
  });

  it('"can you elaborate" after a course answer stays with the course and elaborates on that answer', async () => {
    replies('Raft elects a leader with a randomized timeout.');
    const history = [
      { role: 'user' as const, text: 'How does Raft elect a leader?' },
      { role: 'model' as const, text: 'Raft elects a leader [[Dl Page 1]].' },
    ];
    const res = await llm.generate('can you elaborate', { mode: 'gemini', contextBundle: bundle(false), kind: 'chat', history });
    expect(res.route).toBe('course');
    expect(res.general).toBeFalsy();
    expect(lastBody()).toContain('Course Materials Context');
    expect(lastBody()).toMatch(/elaborate on your previous answer/);
  });

  it('an ordinary question gets no depth instruction', async () => {
    replies('Raft elects a leader [[Dl Page 1]].');
    await ask();
    expect(lastBody()).not.toContain('Answer depth');
  });
});
