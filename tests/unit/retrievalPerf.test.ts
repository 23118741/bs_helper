import { describe, expect, it } from 'vitest';
import { selectContext } from '@/services/context/retrieval';
import type { CourseContextBundle } from '@/types/parser';

/** 60 documents x 60 slides = 3600 chunks of ~1 KB: a heavy course. */
function heavyCourse(): CourseContextBundle {
  const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '.repeat(14);
  return {
    courseInfo: { orgUnitId: '1', courseName: 'Heavy', exportedAt: '' },
    documents: Array.from({ length: 60 }, (_, d) => ({
      title: `Lecture ${d + 1}.pptx`,
      type: 'pptx',
      modulePath: `Course > Week ${(d % 12) + 1}`,
      topicId: `d${d}`,
      content: Array.from({ length: 60 }, (_, s) => `[Slide ${s + 1}]\nTopic ${d}-${s}\n${filler} keyword${d}x${s}`).join('\n\n'),
    })),
  };
}

describe('retrieval stays fast on a heavy course', () => {
  it('first question (chunking included) and follow-up questions (cached chunks)', () => {
    const bundle = heavyCourse();
    const t0 = performance.now();
    const first = selectContext(bundle, 'Where is keyword17x42 explained?');
    const firstMs = performance.now() - t0;
    expect(first.stats.totalChunks).toBe(3600);
    expect(first.bundle.documents.some((d) => d.title === 'Lecture 18.pptx')).toBe(true);

    const t1 = performance.now();
    for (let i = 0; i < 5; i++) selectContext(bundle, `Explain topic ${i} in week 3 about lorem ipsum`);
    const eachMs = (performance.now() - t1) / 5;
    // generous limits (CI machines vary); typical is far lower
    expect(firstMs).toBeLessThan(2500);
    expect(eachMs).toBeLessThan(800);
  });
});
