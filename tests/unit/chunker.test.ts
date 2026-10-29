import { describe, expect, it } from 'vitest';
import { chunkDocument, describeChunks, totalLabel } from '@/services/context/chunker';

const doc = (content: string, title = 'x.txt') => ({ title, type: 'txt', content, topicId: title, modulePath: 'P' });

describe('chunkDocument', () => {
  it('splits a presentation per slide and keeps the marker so citations survive', () => {
    const content = '[Slide 1]\nIntro to Raft\nwelcome\n\n[Slide 2]\nLeader election\nterms\n\n[Slide 3]\nLog replication';
    const chunks = chunkDocument(doc(content, 'deck.pptx'));
    expect(chunks.map((c) => c.label)).toEqual(['Slide 1', 'Slide 2', 'Slide 3']);
    expect(chunks.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(chunks[1].heading).toBe('Leader election');
    expect(chunks[1].text.startsWith('[Slide 2]')).toBe(true);
    expect(chunks.every((c) => c.unit === 'slide' && c.tokens > 0)).toBe(true);
  });

  it('splits a PDF per page', () => {
    const chunks = chunkDocument(doc('[Page 1]\n\nFirst page text\n\n[Page 2]\n\nSecond page text', 'paper.pdf'));
    expect(chunks.map((c) => c.label)).toEqual(['Page 1', 'Page 2']);
  });

  it('splits plain text by headings, and long sections into parts', () => {
    const para = 'Lorem ipsum dolor sit amet. '.repeat(40);
    const chunks = chunkDocument(doc(`# Intro\n${para}\n\n## Grading\n${para}\n\n${para}\n\n${para}`, 'notes.md'));
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].label).toBe('Section: Intro');
    expect(chunks.some((c) => c.label.startsWith('Section: Grading'))).toBe(true);
    expect(chunks.every((c) => c.text.length <= 1900)).toBe(true);
  });

  it('keeps a short document as one chunk', () => {
    const chunks = chunkDocument(doc('Just a short note about the exam.'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].label).toBe('Part 1');
  });

  it('is cached per document content', () => {
    const d = doc('[Slide 1]\nA\n\n[Slide 2]\nB');
    expect(chunkDocument(d)).toBe(chunkDocument({ ...d }));
  });
});

describe('describing chunks', () => {
  const slides = chunkDocument(doc(Array.from({ length: 12 }, (_, i) => `[Slide ${i + 1}]\nTitle ${i + 1}`).join('\n\n'), 'big.pptx'));
  it('compresses ranges', () => {
    expect(describeChunks([slides[3], slides[4], slides[5], slides[11]])).toBe('slides 4–6, 12');
    expect(describeChunks([slides[0]])).toBe('slide 1');
    expect(totalLabel(slides)).toBe('12 slides');
  });
  it('counts sections for text documents', () => {
    const para = 'word '.repeat(500);
    const parts = chunkDocument(doc(`# A\n${para}\n\n# B\n${para}`, 't.md'));
    expect(describeChunks(parts)).toBe(`${parts.length} sections`);
  });
});
