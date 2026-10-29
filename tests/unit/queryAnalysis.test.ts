import { describe, expect, it } from 'vitest';
import { analyzeQuery, expandTokens } from '@/services/context/queryAnalysis';

const sections = (q: string) => [...analyzeQuery(q).sections].sort();

describe('which sections a question is about (Dutch and English)', () => {
  it('deadlines point at the calendar, assignments and quizzes', () => {
    expect(sections('When is the deadline for assignment 2?')).toEqual(expect.arrayContaining(['calendar', 'assignments', 'quizzes']));
    expect(sections('Wat is de inleverdatum van de opdracht?')).toEqual(expect.arrayContaining(['calendar', 'assignments']));
  });
  it('feedback and grades', () => {
    expect(sections('What feedback did I get on my essay?')).toContain('assignments');
    expect(sections('Wat is mijn cijfer voor het tentamen?')).toEqual(expect.arrayContaining(['grades', 'quizzes']));
    expect(sections('How much does the final exam weigh?')).toEqual(expect.arrayContaining(['quizzes']));
    expect(sections('Wat is de weging van de eindtoets?')).toEqual(expect.arrayContaining(['grades', 'quizzes']));
  });
  it('announcements, discussions, instructors, syllabus', () => {
    expect(sections('Did the teacher post any news about the exam?')).toEqual(expect.arrayContaining(['announcements', 'instructors', 'quizzes']));
    expect(sections('Wat staat er in het forum over groepjes?')).toContain('discussions');
    expect(sections('Wie is de docent en wat is zijn e-mailadres?')).toContain('instructors');
    expect(sections('Wat zijn de leerdoelen volgens de studiegids?')).toContain('overview');
  });
  it('a content question has no section signal', () => {
    expect(sections('Explain how Raft handles leader election')).toEqual([]);
    expect(sections('Hoe werkt een binaire zoekboom?')).toEqual([]);
  });
  it('matches the start of words only', () => {
    expect(sections('networking packets')).toEqual([]); // "work"/"net" do not trigger sections
  });
});

describe('kind of question', () => {
  const kind = (q: string) => analyzeQuery(q).kind;
  it('facts are short and ask for a specific thing', () => {
    expect(kind('When is the exam?')).toBe('fact');
    expect(kind('Hoeveel punten is opdracht 2 waard?')).toBe('fact');
    expect(kind('Wie geeft het vak?')).toBe('fact');
  });
  it('explanations', () => {
    expect(kind('Explain how consensus works in Raft')).toBe('explain');
    expect(kind('Wat is het verschil tussen TCP en UDP?')).toBe('explain');
    expect(kind('Why do leaders need a randomized timeout in the election phase of the protocol?')).toBe('explain');
  });
  it('summaries and broad requests', () => {
    expect(kind('Summarize the Raft paper')).toBe('summary-doc');
    expect(kind('Vat college 3 samen')).toBe('summary-doc');
    expect(kind('Give me a complete briefing of the course')).toBe('broad');
    expect(kind('study notes for the whole course')).toBe('broad');
  });
});

describe('slide and page references', () => {
  it('finds numbers next to slide/page words', () => {
    const a = analyzeQuery('What does slide 12 say, and page 3 of the reader?');
    expect(a.slideRefs).toEqual([12]);
    expect(a.pageRefs).toEqual([3]);
    expect(analyzeQuery('leg dia 7 uit, zie pagina 40').slideRefs).toEqual([7]);
    expect(analyzeQuery('leg dia 7 uit, zie pagina 40').pageRefs).toEqual([40]);
    expect(analyzeQuery('Section 5 and the 5 results').slideRefs).toEqual([]);
  });
});

describe('synonyms and translations', () => {
  it('expands to the other language with a lower weight', () => {
    const e = expandTokens(['tentamen']);
    expect(e.get('exam')).toBeLessThan(1);
    expect(e.has('exam')).toBe(true);
    expect(expandTokens(['weging']).has('weight')).toBe(true);
    expect(expandTokens(['deadline']).has('inleverdatum')).toBe(true);
  });
  it('does not expand words it does not know or already has', () => {
    expect(expandTokens(['raft']).size).toBe(0);
    expect(expandTokens(['exam', 'tentamen']).has('tentamen')).toBe(false);
  });
});
