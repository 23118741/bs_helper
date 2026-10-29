import { describe, expect, it } from 'vitest';
import { analyzeQuery } from '@/services/context/queryAnalysis';
import { routeQuestion } from '@/services/context/queryRouter';
import { selectContext } from '@/services/context/retrieval';
import type { BundledDocument, CourseContextBundle } from '@/types/parser';

/** ~45 slides per deck, every slide mentions "week" (as real slides do in footers and schedules). */
function deck(title: string, modulePath: string, topic: string, n = 45): BundledDocument {
  const content = Array.from(
    { length: n },
    (_, i) => `[Slide ${i + 1}]\n${topic} part ${i + 1}\n${topic} details ${i + 1}. See the week schedule. ${'lorem ipsum dolor sit amet '.repeat(20)}`
  ).join('\n\n');
  return { title, type: 'pptx', content, topicId: title, modulePath };
}

function course(docs: BundledDocument[]): CourseContextBundle {
  return { courseInfo: { orgUnitId: '1', courseName: 'Statistics', exportedAt: '' }, documents: docs };
}

const weeks = course(
  Array.from({ length: 8 }, (_, w) => [
    deck(`Hoorcollege ${w + 1} - topic${w + 1}.pptx`, `Statistiek > Week ${w + 1}`, `topic${w + 1}`),
    deck(`Werkcollege ${w + 1} opgaven.pdf`, `Statistiek > Week ${w + 1}`, `exercise${w + 1}`),
  ]).flat()
);
const sent = (bundle: CourseContextBundle) => (bundle.documents ?? []).map((d) => ({ title: d.title, whole: !d.partial }));

describe('a question about one week or lecture gets that whole week or lecture', () => {
  it('"samenvatting van week 3": both documents of week 3, whole', () => {
    const r = selectContext(weeks, 'Kun je een samenvatting geven van week 3?');
    const docs = sent(r.bundle);
    expect(docs).toContainEqual({ title: 'Hoorcollege 3 - topic3.pptx', whole: true });
    expect(docs).toContainEqual({ title: 'Werkcollege 3 opgaven.pdf', whole: true });
    expect(routeQuestion('Kun je een samenvatting geven van week 3?', r.stats)).toBe('course');
  });

  it('"summarize lecture 5" finds "Hoorcollege 5" (lecture = hoorcollege), not week 5\'s tutorial first', () => {
    const r = selectContext(weeks, 'summarize lecture 5');
    expect(r.bundle.documents![0].title).toBe('Hoorcollege 5 - topic5.pptx');
    expect(r.bundle.documents![0].partial).toBeUndefined();
  });

  it('"wat werd er behandeld in het derde college" is about the content: the whole lecture', () => {
    const q = 'wat werd er behandeld in het derde college';
    expect(analyzeQuery(q).kind).not.toBe('fact');
    const docs = sent(selectContext(weeks, q).bundle);
    expect(docs).toContainEqual({ title: 'Hoorcollege 3 - topic3.pptx', whole: true });
  });

  it('a course that only names weeks: "lecture 2" falls back to week 2', () => {
    const plain = course(Array.from({ length: 6 }, (_, w) => deck(`slides-${w + 1}.pptx`, `Course > Week ${w + 1}`, `subject${w + 1}`)));
    const docs = sent(selectContext(plain, 'Give me a summary of lecture 2').bundle);
    expect(docs).toContainEqual({ title: 'slides-2.pptx', whole: true });
  });

  it('file names like "HC03" and "W4" count', () => {
    const named = course([
      deck('HC03_regressie.pptx', 'Course > Slides', 'regression'),
      deck('W4 anova.pdf', 'Course > Slides', 'anova'),
      deck('HC13_extra.pptx', 'Course > Slides', 'extra'),
    ]);
    expect(sent(selectContext(named, 'samenvatting hoorcollege 3').bundle)[0]).toEqual({ title: 'HC03_regressie.pptx', whole: true });
    expect(sent(selectContext(named, 'summary week 4').bundle)[0]).toEqual({ title: 'W4 anova.pdf', whole: true });
  });

  it('a summary without a number takes the best matching documents whole, not a few loose slides', () => {
    const docs = sent(selectContext(weeks, 'summarize the topic6 lecture').bundle);
    expect(docs).toContainEqual({ title: 'Hoorcollege 6 - topic6.pptx', whole: true });
  });

  it('a date question about a week still only needs the matching slides', () => {
    const r = selectContext(weeks, 'when is the deadline in week 3?');
    expect(r.stats.queryKind).toBe('fact');
    expect(r.stats.includedTokens).toBeLessThan(20_000);
  });
});

describe('the ways students actually ask about a week or lecture', () => {
  for (const q of ['geef een overzicht van week 3', 'wat moet ik weten van hoorcollege 3', 'what was covered in week 3', 'wat is er besproken in week 3']) {
    it(`"${q}": the whole lecture, not a few slides`, () => {
      const r = selectContext(weeks, q);
      expect(r.stats.queryKind).not.toBe('fact');
      expect(sent(r.bundle)).toContainEqual({ title: 'Hoorcollege 3 - topic3.pptx', whole: true });
    });
  }

  it('a file without a number in its name is found by its title slide ("Lecture 3 - ...")', () => {
    const decks = course(
      [1, 2, 3, 4].map((n) => {
        const d = deck(`slides-${'abcd'[n - 1]}.pdf`, 'Course > Slides', `subject${n}`);
        return { ...d, content: d.content.replace('[Slide 1]\n', `[Slide 1]\nLecture ${n} - Subject ${n}\n`) };
      })
    );
    expect(sent(selectContext(decks, 'samenvatting van lecture 3').bundle)[0]).toEqual({ title: 'slides-c.pdf', whole: true });
  });
});

it('"wat zit er in college 2" (no summary word) is about content, not a single fact', () => {
  expect(analyzeQuery('wat zit er in college 2').kind).toBe('explain');
});
