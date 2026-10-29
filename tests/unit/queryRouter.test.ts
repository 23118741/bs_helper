import { describe, expect, it } from 'vitest';
import { prepareContext } from '@/services/context/prepareContext';
import { routeQuestion, type AnswerRoute } from '@/services/context/queryRouter';
import type { CourseContextBundle } from '@/types/parser';

const bundle: CourseContextBundle = {
  courseInfo: { orgUnitId: '1', courseName: 'Distributed Systems', exportedAt: '' },
  documents: [
    {
      title: 'Lecture 3 Consensus',
      type: 'pdf',
      topicId: 'l3',
      modulePath: 'Week 3',
      content: '[Slide 1]\n\nRaft consensus algorithm\n\n[Slide 2]\n\nRaft elects a leader with a randomized election timeout between 150 and 300 ms.\n\n[Slide 3]\n\nLog replication: the leader appends entries to followers.',
    },
    {
      title: 'Syllabus',
      type: 'pdf',
      topicId: 's1',
      modulePath: 'Week 0',
      content: '[Page 1]\n\nGrading: homework 30 percent, midterm 30 percent, final 40 percent.\n\n[Page 2]\n\nThe course covers consensus, replication and fault tolerance.',
    },
  ],
  assignments: [{ id: 'a1', name: 'Assignment 1', instructions: 'Implement a key-value store.', dueDate: '2026-11-01' }],
};

const route = (question: string, history?: Array<{ role: 'user' | 'model'; text: string }>): AnswerRoute => {
  const { stats } = prepareContext({ bundle, prompt: question, history });
  return routeQuestion(question, stats);
};

describe('routeQuestion', () => {
  it.each([
    'How does Raft elect a leader?',
    'What is the election timeout in Raft?',
    'Wat is de election timeout van Raft?',
    'When is assignment 1 due?',
    'Wanneer is de deadline van opdracht 1?',
    'How is the course graded?',
    'Wat is de weging van het tentamen?',
    'Explain slide 2',
    'What does the syllabus say about fault tolerance?',
    'Analyze deadlines',
    'Welke opdrachten en tentamens zijn er?',
    'Summarize the lectures',
  ])('course: %s', (q) => {
    expect(route(q)).toBe('course');
  });

  it.each([
    'What is the difference between TCP and UDP?',
    'Explain how a hash table works',
    'Wat is de hoofdstad van Frankrijk?',
    'How do I write a good cover letter?',
  ])('general: %s', (q) => {
    expect(route(q)).toBe('general');
  });

  it('a follow-up that only makes sense with the previous question stays on the course', () => {
    expect(route('and how long is that?', [{ role: 'user', text: 'What is the election timeout in Raft?' }, { role: 'model', text: '150-300 ms [[D1 Slide 2]]' }])).toBe('course');
  });

  it('a follow-up after a general question does not become a full course question', () => {
    expect(route('can you give an example?', [{ role: 'user', text: 'What is the capital of France?' }, { role: 'model', text: 'Paris.' }])).not.toBe('course');
  });

  it('attached documents make it a course question', () => {
    const pinned: CourseContextBundle = { ...bundle, documents: [...(bundle.documents ?? []), { title: 'My notes.txt', type: 'txt', topicId: 'user:1', content: 'hello', pinned: true } as any] };
    const { stats } = prepareContext({ bundle: pinned, prompt: 'Summarize this please' });
    expect(routeQuestion('Summarize this please', stats)).toBe('course');
  });

  it('without statistics it is a plain chat', () => {
    expect(routeQuestion('anything', undefined)).toBe('general');
  });
});

describe('follow-ups and depth', () => {
  it.each(['can you elaborate', 'Can you elaborate?', 'tell me more', 'waarom?', 'kun je dat uitgebreider uitleggen', 'ga verder'])(
    '"%s" is a follow-up',
    async (q) => {
      const { isFollowUp } = await import('@/services/context/queryRouter');
      expect(isFollowUp(q)).toBe(true);
    }
  );

  it.each(['why is the sky blue', 'What is TCP?', 'When is assignment 1 due?'])('"%s" is a new question', async (q) => {
    const { isFollowUp } = await import('@/services/context/queryRouter');
    expect(isFollowUp(q)).toBe(false);
  });

  it('a follow-up stays with the course', () => {
    const { stats } = prepareContext({ bundle, prompt: 'can you elaborate' });
    expect(routeQuestion('can you elaborate', stats, { followUp: true })).toBe('course');
  });

  it('"hc 1" points at a lecture', () => {
    expect(route('summarize hc 1 for me')).toBe('course');
  });

  it.each(['summarize hc 1 for me', 'vat hoorcollege 2 samen', 'explain Raft in detail'])('"%s" asks for depth', async (q) => {
    const { answerDepthHint } = await import('@/services/context/queryRouter');
    expect(answerDepthHint(q, false)).toMatch(/comprehensive/);
  });

  it('a short factual question asks for no depth', async () => {
    const { answerDepthHint } = await import('@/services/context/queryRouter');
    expect(answerDepthHint('When is assignment 1 due?', false)).toBe('');
  });
});
