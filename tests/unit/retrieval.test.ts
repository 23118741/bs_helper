import { describe, expect, it } from 'vitest';
import { serializeToMarkdown } from '@/services/context/contextSerializer';
import { prepareContext } from '@/services/context/prepareContext';
import { selectContext } from '@/services/context/retrieval';
import { estimateTokenCount } from '@/services/llm/llmUtils';
import type { BundledDocument, CourseContextBundle } from '@/types/parser';

const tok = (s: string | undefined) => estimateTokenCount(s ?? '');

/** A deck with 40 slides about one topic, each ~120 words. */
function deck(title: string, week: number, slides: Array<[string, string]>, filler = 'lorem ipsum dolor sit amet consectetur '.repeat(18)): BundledDocument {
  const content = slides.map(([head, body], i) => `[Slide ${i + 1}]\n${head}\n${body} ${filler}`).join('\n\n');
  return { title, type: 'pptx', content, topicId: title, modulePath: `Course > Week ${week}` };
}

function topicDeck(title: string, week: number, topic: string, n = 40): BundledDocument {
  return deck(title, week, Array.from({ length: n }, (_, i) => [`${topic} part ${i + 1}`, `${topic} details number ${i + 1}`] as [string, string]));
}

const raftDeck = deck('Lecture 4 Consensus.pptx', 4, [
  ['Consensus overview', 'Why agreement between servers is hard'],
  ['Raft basics', 'Raft splits consensus into leader election and log replication'],
  ['Leader election', 'A follower becomes a candidate after a randomized election timeout of 150 to 300 ms'],
  ['Voting rules', 'Each server votes once per term, first come first served'],
  ['Log replication', 'The leader appends entries and followers confirm'],
  ['Safety', 'Committed entries are never lost'],
  ['Exam tips', 'Know the election timeout range'],
]);

function course(extra: Partial<CourseContextBundle> = {}): CourseContextBundle {
  const docs = [
    topicDeck('Lecture 1 Intro.pptx', 1, 'introduction'),
    topicDeck('Lecture 2 Networking.pptx', 2, 'networking'),
    topicDeck('Lecture 3 Clocks.pptx', 3, 'clocks'),
    raftDeck,
    topicDeck('Lecture 5 Storage.pptx', 5, 'storage'),
    topicDeck('Lecture 6 Security.pptx', 6, 'security'),
    { title: 'Reader.pdf', type: 'pdf', modulePath: 'Course > Reader', topicId: 'r', content: Array.from({ length: 60 }, (_, i) => `[Page ${i + 1}]\n\n${i === 41 ? 'The retake exam fee is 50 euro. ' : ''}general reading text ${'blah '.repeat(150)}`).join('\n\n') },
  ];
  return {
    courseInfo: { orgUnitId: '1', courseName: 'Distributed Systems', exportedAt: '' },
    overview: 'Distributed Systems syllabus. Learn how servers cooperate.',
    announcements: Array.from({ length: 15 }, (_, i) => ({ id: `a${i}`, title: `News ${i}`, body: 'Announcement body text. '.repeat(60), postedDate: '2026-10-01' })),
    assignments: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, name: `Assignment ${i + 1}`, instructions: 'Do the work. '.repeat(80), dueDate: `2026-11-0${i + 1}`, feedback: { score: 7, feedbackText: 'Good work. '.repeat(40) } })),
    quizzes: [{ id: 'q1', title: 'Midterm exam', dueDate: '2026-11-20' }],
    calendar: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, title: `Event ${i}`, startDate: '2026-11-01', description: 'Details. '.repeat(30) })),
    grades: Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, name: `Grade ${i}`, pointsNumerator: 7, pointsDenominator: 10, comments: 'Nice. '.repeat(120) })),
    discussions: Array.from({ length: 8 }, (_, i) => ({ forum: 'General', topic: `Topic ${i}`, posts: Array.from({ length: 20 }, () => ({ body: 'A discussion post with some words. '.repeat(30) })) })),
    documents: docs,
    ...extra,
  };
}

const full = () => tok(serializeToMarkdown(course()));
const asked = (q: string, opts = {}) => selectContext(course(), q, opts);
const sent = (q: string, opts = {}) => serializeToMarkdown(asked(q, opts).bundle);

describe('token efficiency: a fact question sends a small fraction of the course', () => {
  it('measure: the full course is big, a targeted question is small and contains the answer', () => {
    const fullTokens = full();
    const text = sent('What is the election timeout range in Raft?');
    expect(fullTokens).toBeGreaterThan(80_000);
    expect(tok(text)).toBeLessThan(fullTokens * 0.15);
    expect(tok(text)).toBeLessThan(15_000);
    expect(text).toContain('150 to 300 ms'); // the answer is there
    expect(text).toContain('[Slide 3]'); // with its citation marker
  });

  it('the best slide comes with its neighbours and an outline of the rest', () => {
    const r = asked('What is the election timeout range in Raft?');
    const d = r.bundle.documents.find((x) => x.title.startsWith('Lecture 4'))!;
    expect(d.partial?.sent).toMatch(/slides/);
    const text = serializeToMarkdown(r.bundle);
    expect(text).toContain('[Slide 2]'); // neighbour before
    expect(text).toContain('[Slide 4]'); // neighbour after
    expect(text).toContain('Outline of the whole document');
    expect(text).toContain('Log replication'); // an unsent slide still shows up in the outline
    expect(text).toMatch(/\[… slides? \d/); // a marked gap
  });

  it('other documents that do not match are listed, not sent', () => {
    const r = asked('What is the election timeout range in Raft?');
    const text = serializeToMarkdown(r.bundle);
    expect(r.bundle.documents.map((d) => d.title)).not.toContain('Lecture 2 Networking.pptx');
    expect(text).toContain('Not Included In This Request');
    expect(text).toContain('Lecture 2 Networking.pptx');
    expect(r.stats.widenable).toBe(true);
    expect(r.stats.includedChunks!).toBeLessThan(r.stats.totalChunks! / 5);
  });
});

describe('sections are only sent when the question is about them', () => {
  it('a content question skips news, assignments, calendar, grades and discussions but keeps one-line summaries', () => {
    const r = asked('What is the election timeout range in Raft?');
    expect(r.stats.sectionsOmitted).toEqual(expect.arrayContaining(['announcements', 'assignments', 'calendar', 'grades', 'discussions']));
    const text = serializeToMarkdown(r.bundle);
    expect(text).not.toContain('Announcement body text');
    expect(text).toMatch(/Section announcements: 15 announcements, latest: "News 0"/);
    expect(text).toMatch(/Section assignments: 6 assignments: Assignment 1, Assignment 2/);
    expect(text).toContain('with instructor feedback');
    expect(text).toMatch(/Section discussions: 8 discussion threads/);
  });

  it('"when is the deadline" sends the calendar, assignments and quizzes (not news or discussions)', () => {
    const r = asked('When is the deadline of assignment 3?');
    expect(r.stats.sectionsOmitted).not.toContain('assignments');
    expect(r.stats.sectionsOmitted).not.toContain('calendar');
    expect(r.stats.sectionsOmitted).not.toContain('quizzes');
    expect(r.stats.sectionsOmitted).toEqual(expect.arrayContaining(['announcements', 'discussions']));
    expect(tok(serializeToMarkdown(r.bundle))).toBeLessThan(full() * 0.4);
  });

  it('feedback and grades questions in Dutch work', () => {
    expect(asked('Wat was de feedback op mijn opdracht?').stats.sectionsOmitted).not.toContain('assignments');
    expect(asked('Wat is mijn cijfer en de weging van de eindtoets?').stats.sectionsOmitted).not.toContain('grades');
    expect(asked('Wat is mijn cijfer en de weging van de eindtoets?').stats.sectionsOmitted).not.toContain('quizzes');
  });

  it('naming an assignment or quiz includes that section even without keywords', () => {
    expect(asked('Tell me about Assignment 4').stats.sectionsOmitted).not.toContain('assignments');
    expect(asked('Midterm exam info').stats.sectionsOmitted).not.toContain('quizzes');
  });

  it('tiny sections are always sent (not worth hiding)', () => {
    const r = asked('What is the election timeout range in Raft?');
    expect(r.stats.sectionsOmitted).not.toContain('overview');
    expect(r.stats.sectionsOmitted).not.toContain('quizzes'); // one line only
    expect(serializeToMarkdown(r.bundle)).toContain('Distributed Systems syllabus');
  });

  it('with no signal at all, recall wins: smaller sections stay, the big ones are summarised', () => {
    const r = asked('zzz qqq');
    expect(r.stats.matched).toBe(false);
    expect(r.stats.sectionsOmitted!.length).toBeLessThan(5);
  });

  it("sections: 'all' and broad requests send every section", () => {
    expect(asked('What is the election timeout range in Raft?', { sections: 'all' }).stats.sectionsOmitted).toEqual([]);
    expect(asked('Give me a complete briefing of the course').stats.sectionsOmitted).toEqual([]);
    expect(asked('anything', { mode: 'all' }).stats.sectionsOmitted).toEqual([]);
  });
});

describe('finding the right slide or page', () => {
  it('"slide 5" in a named document goes straight to it', () => {
    const text = sent('Explain slide 5 of lecture 4');
    expect(text).toContain('[Slide 5]');
    expect(text).toContain('Log replication');
  });

  it('a page number in the reader', () => {
    const r = asked('What does page 42 of the reader say about the retake?');
    expect(serializeToMarkdown(r.bundle)).toContain('retake exam fee is 50 euro');
  });

  it('a question in Dutch finds English material (synonyms): "tentamen" finds exam/retake text', () => {
    const r = asked('Hoeveel kost de herkansing van het tentamen?');
    expect(serializeToMarkdown(r.bundle)).toContain('retake exam fee is 50 euro');
  });

  it('week numbers in the question point at that week', () => {
    const r = asked('What was discussed in week 6?');
    expect(r.bundle.documents[0].title).toBe('Lecture 6 Security.pptx');
  });
});

describe('budget follows the kind of question', () => {
  it('a fact gets less than an explanation, a summary of a named document gets the whole document', () => {
    const fact = asked('How many slides does lecture 4 have?');
    expect(fact.stats.queryKind).toBe('fact');
    expect(fact.stats.includedTokens).toBeLessThanOrEqual(10_000 + 2_000); // budget + neighbours of the best hits
    const explain = asked('Explain how Raft elects a leader and how voting rules work');
    expect(explain.stats.queryKind).toBe('explain');
    const summary = asked('Summarize Lecture 4 Consensus');
    expect(summary.stats.queryKind).toBe('summary-doc');
    const doc = summary.bundle.documents.find((d) => d.title.startsWith('Lecture 4'))!;
    expect(doc.partial).toBeUndefined(); // whole document
    expect(serializeToMarkdown(summary.bundle)).toContain('[Slide 7]');
    expect(explain.stats.includedTokens).toBeLessThanOrEqual(25_000 + 2_000);
  });

  it('a small document comes whole once anything in it matched', () => {
    const bundle = course();
    bundle.documents = [{ title: 'Note.txt', type: 'txt', content: 'Exam rules are on top. The resit costs 50 euro. Bring your student card.', topicId: 'n', modulePath: 'x' }];
    const r = selectContext(bundle, 'resit cost');
    expect(r.bundle.documents[0].partial).toBeUndefined();
    expect(r.bundle.documents[0].content).toContain('student card');
  });

  it('no match at all: documents in course order within the budget, nothing guessed', () => {
    const r = asked('zzz qqq', { tokenBudget: 3000 });
    expect(r.stats.matched).toBe(false);
    expect(r.bundle.documents.length).toBeGreaterThan(0);
    expect(r.bundle.documents[0].title).toBe('Lecture 1 Intro.pptx');
  });

  it('explicit attachments are always sent in full and never counted as omitted', () => {
    const bundle = course();
    bundle.documents = [...bundle.documents, { title: 'mine.docx', type: 'docx', content: 'Completely unrelated gardening text. '.repeat(100), topicId: 'user:1', modulePath: 'Attached', pinned: true }];
    const r = selectContext(bundle, 'What is the election timeout range in Raft?');
    const mine = r.bundle.documents.find((d) => d.title === 'mine.docx')!;
    expect(mine.partial).toBeUndefined();
    expect(mine.content.length).toBeGreaterThan(3000);
  });
});

describe('widening (what the safety net uses)', () => {
  it('a wider search includes more slides and sections than the first try', () => {
    const first = asked('What is the election timeout range in Raft?');
    const wide = asked('What is the election timeout range in Raft?', { tokenBudget: 75_000, sections: 'all', neighbors: 2, minScoreRatio: 0.05 });
    expect(wide.stats.includedChunks!).toBeGreaterThan(first.stats.includedChunks!);
    expect(wide.stats.sectionsOmitted).toEqual([]);
    expect(tok(serializeToMarkdown(wide.bundle))).toBeGreaterThan(tok(serializeToMarkdown(first.bundle)));
  });

  it('the not-included block tells the model to answer with the internal marker so the search can widen', () => {
    const text = sent('What is the election timeout range in Raft?');
    expect(text).toContain('[[NOT_FOUND]]');
    expect(text).toContain('Do not guess');
  });
});

describe('prepareContext uses it by default', () => {
  it('filters sections and slides for any tool, and "off" still sends everything', () => {
    const p = prepareContext({ bundle: course(), prompt: 'What is the election timeout range in Raft?' });
    expect(tok(p.serialized)).toBeLessThan(15_000);
    const off = prepareContext({ bundle: course(), prompt: 'x', relevance: 'off' });
    expect(tok(off.serialized)).toBeGreaterThan(80_000);
  });
});
