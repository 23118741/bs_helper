import { describe, expect, it, vi } from 'vitest';
import type { CourseContextBundle, BundledDocument } from '@/types/parser';
import type { LLMOptions, LLMResponse } from '@/types/llm';
import { LLMError } from '@/types/llm';
import { buildLectureBatches, buildLectureNotesPrompt, runStudyNotes } from '@/services/actions/studyNotes';

const doc = (title: string, tokens: number, modulePath = 'Week 1'): BundledDocument => ({
  title,
  type: 'pdf',
  content: 'x'.repeat(tokens * 4),
  topicId: title.replace(/\W/g, ''),
  modulePath,
});

const bundle = (documents: BundledDocument[]): CourseContextBundle => ({
  courseInfo: { orgUnitId: '1', courseName: 'Networks', exportedAt: '' },
  documents,
});

const answer = (text: string): LLMResponse => ({ text, mode: 'backend', tokenEstimate: 10 });
const titlesOf = (opts?: Partial<LLMOptions>) => opts?.contextBundle?.documents.map((d) => d.title) ?? [];

describe('buildLectureBatches', () => {
  it('gives every large lecture its own request and leaves the syllabus out', () => {
    const b = buildLectureBatches(bundle([doc('Syllabus', 3000, ''), doc('Lecture 1', 9000), doc('Lecture 2', 9000)]));
    expect(b.map((x) => x.map((d) => d.title))).toEqual([['Lecture 1'], ['Lecture 2']]);
  });

  it('groups small consecutive documents of one module, but never across modules', () => {
    const b = buildLectureBatches(
      bundle([doc('Slides A', 1000, 'Week 1'), doc('Notes A', 1000, 'Week 1'), doc('Slides B', 1000, 'Week 2')])
    );
    expect(b.map((x) => x.map((d) => d.title))).toEqual([['Slides A', 'Notes A'], ['Slides B']]);
  });

  it('summarizes the syllabus when it is the only document', () => {
    expect(buildLectureBatches(bundle([doc('Syllabus', 100, '')])).flat().map((d) => d.title)).toEqual(['Syllabus']);
  });
});

describe('buildLectureNotesPrompt', () => {
  it('asks for an extensive summary and lifts the short-answer limits', () => {
    const p = buildLectureNotesPrompt('Networks', ['Lecture 1']);
    expect(p).toContain('"Lecture 1"');
    expect(p).toMatch(/length limits for short answers do NOT apply/);
    expect(p).toContain('[[D123 Slide 14]]');
  });
});

describe('runStudyNotes', () => {
  const lectures = bundle([doc('Lecture 1', 9000), doc('Lecture 2', 9000), doc('Lecture 3', 9000)]);

  it('sends one request per lecture and joins the notes in course order', async () => {
    const generate = vi.fn(async (_p: string, o?: Partial<LLMOptions>) => {
      const [title] = titlesOf(o);
      // the first lecture finishes last
      if (title === 'Lecture 1') await new Promise((r) => setTimeout(r, 20));
      return answer(`notes of ${title}`);
    });
    const progress: string[] = [];
    const res = await runStudyNotes({ generate, bundle: lectures, options: {}, onProgress: (t) => progress.push(t) });

    expect(generate).toHaveBeenCalledTimes(3);
    for (const [, o] of generate.mock.calls) {
      expect(o?.kind).toBe('preset');
      expect(o?.contextBundle?.documents).toHaveLength(1);
    }
    expect(res.text.indexOf('## Lecture 1')).toBeLessThan(res.text.indexOf('## Lecture 2'));
    expect(res.text.indexOf('## Lecture 2')).toBeLessThan(res.text.indexOf('## Lecture 3'));
    expect(res.text).toContain('notes of Lecture 3');
    expect(progress).toHaveLength(3);
    expect(progress[0]).not.toContain('Lecture 1'); // shown before the slow first lecture was done
    expect(res.tokenEstimate).toBe(30);
  });

  it('waits and tries again when the service says "too many requests"', async () => {
    let calls = 0;
    const generate = vi.fn(async (_p: string, o?: Partial<LLMOptions>) => {
      if (++calls === 1) throw Object.assign(new LLMError('slow down', 'RATE_LIMIT', 429), { retryAfter: 3 });
      return answer(`notes of ${titlesOf(o)[0]}`);
    });
    const sleep = vi.fn(async () => {});
    const res = await runStudyNotes({ generate, bundle: lectures, options: {}, sleep });
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(res.text).not.toContain('⚠');
    expect(generate).toHaveBeenCalledTimes(4);
  });

  it('keeps the other lectures when one fails', async () => {
    const generate = vi.fn(async (_p: string, o?: Partial<LLMOptions>) => {
      const [title] = titlesOf(o);
      if (title === 'Lecture 2') throw new LLMError('upstream broke', 'SERVER_ERROR', 502);
      return answer(`notes of ${title}`);
    });
    const res = await runStudyNotes({ generate, bundle: lectures, options: {} });
    expect(res.text).toContain('notes of Lecture 1');
    expect(res.text).toContain('notes of Lecture 3');
    expect(res.text).toMatch(/## Lecture 2\n\n⚠ This lecture could not be summarized \(upstream broke\)/);
  });

  it('stops at the daily limit instead of failing every lecture', async () => {
    const generate = vi.fn(async () => {
      throw new LLMError('daily limit', 'DAILY_LIMIT', 429);
    });
    await expect(runStudyNotes({ generate, bundle: lectures, options: {} })).rejects.toThrow('daily limit');
    expect(generate.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
