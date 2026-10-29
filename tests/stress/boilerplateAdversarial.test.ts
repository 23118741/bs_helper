/**
 * tests/stress/boilerplateAdversarial.test.ts
 * Challenger 1 Adversarial Stress Test Suite for Milestone 1 (Requirement R1: Boilerplate Stripper & JSON detection)
 */

import { describe, it, expect } from 'vitest';
import {
  stripConversationalBoilerplate,
  isRawJsonResponse,
} from '@/services/llm/llmClient';

describe('Adversarial Stress Suite: Boilerplate Stripper & JSON Detection', () => {
  // ==========================================
  // Section 1: Complex Conversational Intros
  // ==========================================
  describe('1. Complex Conversational Intros', () => {
    it('1.1 strips standard single-line conversational preamble', () => {
      const input = 'Sure thing! Based on the syllabus, the exam is on Friday [p. 3].';
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe('The exam is on Friday [p. 3].');
    });

    it('1.2 strips "Hello! Here is the answer:" style preamble', () => {
      const input = 'Hello! Here is the answer: The assignment is due at 23:59 on Sunday [Dropbox].';
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe('The assignment is due at 23:59 on Sunday [Dropbox].');
    });

    it('1.3 strips stacked multi-step affirmative phrases', () => {
      const input = 'Certainly! Absolutely! I would be happy to help with that. The grading scale is A = 90% [Syllabus].';
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe('The grading scale is A = 90% [Syllabus].');
    });

    it('1.4 strips academic tutor persona preamble', () => {
      const input = 'As an AI academic tutor, below is the breakdown: Chapter 4 covers graph algorithms [Slide 12].';
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe('Chapter 4 covers graph algorithms [Slide 12].');
    });

    it('1.5 strips "In response to your question:" preamble', () => {
      const input = 'In response to your question, the quiz deadline is extended to Monday [News].';
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe('The quiz deadline is extended to Monday [News].');
    });

    it('1.6 handles multi-line preamble where greeting is on separate line from substantive text', () => {
      const input = [
        'Hello!',
        'Sure thing!',
        'Based on the syllabus:',
        'The final project counts for 40% of your grade [Syllabus p. 4].',
      ].join('\n');
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe('The final project counts for 40% of your grade [Syllabus p. 4].');
    });

    it('1.7 CRITICAL CHALLENGE: Greeting with substantive content on the first line of multi-line response', () => {
      // If the LLM generates a greeting on line 1 followed immediately by factual content,
      // the stripper MUST NOT drop the entire first line and lose the fact!
      const input = 'Hello! The exam is on Friday [Syllabus p. 2].\nIt will cover Chapters 1 through 5.';
      const output = stripConversationalBoilerplate(input);
      expect(output).toContain('The exam is on Friday [Syllabus p. 2].');
      expect(output).toContain('It will cover Chapters 1 through 5.');
    });

    it('1.8 CRITICAL CHALLENGE: "Hi!" followed by factual content on the first line of multi-line response', () => {
      const input = 'Hi! Midterm weight is 30% [Syllabus].\nFinal exam weight is 50% [Syllabus].';
      const output = stripConversationalBoilerplate(input);
      expect(output).toContain('Midterm weight is 30% [Syllabus].');
      expect(output).toContain('Final exam weight is 50% [Syllabus].');
    });

    it('1.9 CRITICAL CHALLENGE: "Good morning!" followed by factual content on the first line', () => {
      const input = 'Good morning! Office hours are Wednesdays 2-4 PM [Overview].\nLocation is Room 302.';
      const output = stripConversationalBoilerplate(input);
      expect(output).toContain('Office hours are Wednesdays 2-4 PM [Overview].');
      expect(output).toContain('Location is Room 302.');
    });

    it('1.10 CRITICAL CHALLENGE: "Based on..." with fact and NO colon on line 1 of multi-line response', () => {
      // Greedy regex [^:\n]*:?$ matches to end of line when colon is missing, deleting line 1
      const input = 'Based on the course syllabus, the passing grade is 55% [Syllabus p. 3].\nAssignments are worth 40% [Syllabus p. 4].';
      const output = stripConversationalBoilerplate(input);
      expect(output).toContain('The passing grade is 55% [Syllabus p. 3].');
      expect(output).toContain('Assignments are worth 40% [Syllabus p. 4].');
    });

    it('1.11 CRITICAL CHALLENGE: "According to..." with fact and NO colon on line 1 of multi-line response', () => {
      const input = 'According to the lecture slides, dynamic programming requires optimal substructure [Slide 10].\nIt also requires overlapping subproblems [Slide 11].';
      const output = stripConversationalBoilerplate(input);
      expect(output).toContain('dynamic programming requires optimal substructure [Slide 10].');
      expect(output).toContain('It also requires overlapping subproblems [Slide 11].');
    });
  });

  // ==========================================
  // Section 2: Multi-line Preambles Preceding Markdown Tables and Lists
  // ==========================================
  describe('2. Multi-line Preambles Preceding Tables & Lists', () => {
    it('2.1 strips multi-line preambles before Markdown tables cleanly', () => {
      const input = [
        'Certainly! Below is the grading breakdown according to the course syllabus:',
        '',
        '| Assessment | Weight | Due Date |',
        '| --- | --- | --- |',
        '| Midterm Exam | 30% | Week 6 |',
        '| Final Project | 40% | Week 12 |',
        '| Quizzes | 30% | Weekly |',
      ].join('\n');
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe([
        '| Assessment | Weight | Due Date |',
        '| --- | --- | --- |',
        '| Midterm Exam | 30% | Week 6 |',
        '| Final Project | 40% | Week 12 |',
        '| Quizzes | 30% | Weekly |',
      ].join('\n'));
    });

    it('2.2 strips multi-line preambles directly adjacent to Markdown tables (no blank line)', () => {
      const input = [
        'Here is the information from Brightspace:',
        '| Module | Topic |',
        '| --- | --- |',
        '| 1 | Intro |',
      ].join('\n');
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe([
        '| Module | Topic |',
        '| --- | --- |',
        '| 1 | Intro |',
      ].join('\n'));
    });

    it('2.3 strips preambles before numbered lists while preserving list numbering and items', () => {
      const input = [
        'Sure! Here are the steps outlined in the assignment instructions:',
        '1. Clone the starter repository [Lab 1].',
        '2. Run `npm install` to setup dependencies.',
        '3. Submit your zip file to Dropbox before Friday 17:00.',
      ].join('\n');
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe([
        '1. Clone the starter repository [Lab 1].',
        '2. Run `npm install` to setup dependencies.',
        '3. Submit your zip file to Dropbox before Friday 17:00.',
      ].join('\n'));
    });

    it('2.4 strips preambles before bullet lists with various bullet markers', () => {
      const input = [
        'Based on the lecture slides, here is the summary:',
        '- First key takeaway [Slide 3]',
        '* Second key takeaway [Slide 7]',
        '+ Third key takeaway [Slide 10]',
      ].join('\n');
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe([
        '- First key takeaway [Slide 3]',
        '* Second key takeaway [Slide 7]',
        '+ Third key takeaway [Slide 10]',
      ].join('\n'));
    });

    it('2.5 strips preambles before code blocks', () => {
      const input = [
        'Certainly! Here is the python implementation from Lecture 3:',
        '```python',
        'def binary_search(arr, target):',
        '    return bisect.bisect_left(arr, target)',
        '```',
      ].join('\n');
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe([
        '```python',
        'def binary_search(arr, target):',
        '    return bisect.bisect_left(arr, target)',
        '```',
      ].join('\n'));
    });
  });

  // ==========================================
  // Section 3: Trailing Courtesies and Polite Sign-offs
  // ==========================================
  describe('3. Trailing Courtesies & Sign-offs', () => {
    it('3.1 strips single-line trailing courtesies ("Hope this helps! Let me know...")', () => {
      const input = 'The final exam covers chapters 1-8 [Syllabus]. Hope this helps! Let me know if you have any questions!';
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe('The final exam covers chapters 1-8 [Syllabus].');
    });

    it('3.2 strips "Happy studying!" and "Best of luck!"', () => {
      const input = 'Passing score is 55% [Syllabus]. Happy studying!';
      expect(stripConversationalBoilerplate(input)).toBe('Passing score is 55% [Syllabus].');

      const input2 = 'Submission deadline is Sunday [Dropbox]. Best of luck!';
      expect(stripConversationalBoilerplate(input2)).toBe('Submission deadline is Sunday [Dropbox].');
    });

    it('3.3 strips multi-line stacked trailing sign-offs', () => {
      const input = [
        'The midterm is scheduled for October 25 [Syllabus p. 2].',
        '',
        'Hope this was helpful!',
        'Please let me know if you need any further assistance!',
        'Good luck with your studies!',
      ].join('\n');
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe('The midterm is scheduled for October 25 [Syllabus p. 2].');
    });

    it('3.4 strips "Feel free to ask..." and "Don\'t hesitate to reach out..."', () => {
      const input = 'Lab sessions are held in Room B12 [Overview]. Feel free to ask if you have more questions.';
      expect(stripConversationalBoilerplate(input)).toBe('Lab sessions are held in Room B12 [Overview].');

      const input2 = 'The TA email is ta@university.edu [Syllabus]. Don’t hesitate to reach out if you have questions!';
      expect(stripConversationalBoilerplate(input2)).toBe('The TA email is ta@university.edu [Syllabus].');
    });
  });

  // ==========================================
  // Section 4: Raw JSON Detection & 100% Byte-for-Byte Preservation
  // ==========================================
  describe('4. Raw JSON Detection & Byte Preservation', () => {
    it('4.1 isRawJsonResponse detects valid JSON objects and arrays', () => {
      expect(isRawJsonResponse('{"key": "value"}')).toBe(true);
      expect(isRawJsonResponse('[\n  {"id": 1},\n  {"id": 2}\n]')).toBe(true);
      expect(isRawJsonResponse('   { "nested": { "a": [1, 2, 3] } }   ')).toBe(true);
    });

    it('4.2 isRawJsonResponse detects fenced ```json blocks', () => {
      const fenced = '```json\n[\n  {"front": "Q", "back": "A"}\n]\n```';
      expect(isRawJsonResponse(fenced)).toBe(true);

      const fencedWithoutTag = '```\n{"course": "CS101"}\n```';
      expect(isRawJsonResponse(fencedWithoutTag)).toBe(true);

      const fencedUppercase = '```JSON\n{"course": "CS101"}\n```';
      expect(isRawJsonResponse(fencedUppercase)).toBe(true);
    });

    it('4.3 isRawJsonResponse returns false for normal prose or malformed JSON', () => {
      expect(isRawJsonResponse('The answer is {"a": 1}')).toBe(false);
      expect(isRawJsonResponse('{"incomplete":')).toBe(false);
      expect(isRawJsonResponse('[1, 2, 3')).toBe(false);
      expect(isRawJsonResponse('```json\n{unquoted_key: 1}\n```')).toBe(false);
      expect(isRawJsonResponse('')).toBe(false);
      expect(isRawJsonResponse('   ')).toBe(false);
    });

    it('4.4 stripConversationalBoilerplate preserves JSON payloads with internal conversational phrases intact', () => {
      const jsonPayload = JSON.stringify({
        question: 'What is the syllabus policy?',
        answer: 'Sure! Based on the syllabus, attendance is mandatory. Hope this helps!',
        signOff: 'Happy studying!',
      }, null, 2);

      const output = stripConversationalBoilerplate(jsonPayload);
      expect(output).toBe(jsonPayload);
      expect(JSON.parse(output)).toEqual(JSON.parse(jsonPayload));
    });

    it('4.5 stripConversationalBoilerplate preserves fenced ```json payloads 100% byte-for-byte', () => {
      const fenced = '```json\n[\n  {\n    "front": "Hello! What is recursion?",\n    "back": "Based on slides: A function calling itself. Hope this helps!"\n  }\n]\n```';
      const output = stripConversationalBoilerplate(fenced);
      expect(output).toBe(fenced);
    });
  });

  // ==========================================
  // Section 5: Strict Absence Fallback
  // ==========================================
  describe('5. Strict Absence Fallback', () => {
    it('5.1 preserves exact absence fallback string byte-for-byte', () => {
      const fallback = 'Not specified in the selected Brightspace materials.';
      expect(stripConversationalBoilerplate(fallback)).toBe(fallback);
    });

    it('5.2 strips accidental conversational wrapping around absence fallback', () => {
      const wrapped = 'Certainly! Based on the provided materials: Not specified in the selected Brightspace materials. Hope this helps!';
      const output = stripConversationalBoilerplate(wrapped);
      expect(output).toBe('Not specified in the selected Brightspace materials.');
    });
  });

  // ==========================================
  // Section 6: Domain Phrases & False Positive Avoidance
  // ==========================================
  describe('6. Domain Phrases & False Positives', () => {
    it('6.1 preserves scientific & pedagogical phrases without false truncation', () => {
      const p1 = "According to Bloom's taxonomy, evaluation and synthesis are higher-order cognitive skills [Lecture 1].";
      expect(stripConversationalBoilerplate(p1)).toBe(p1);

      const p2 = "Based on Bayes' theorem, P(A|B) = P(B|A) * P(A) / P(B) [Lecture 4].";
      expect(stripConversationalBoilerplate(p2)).toBe(p2);

      const p3 = "From Newton's second law, force equals mass times acceleration (F = ma) [Physics Ch. 2].";
      expect(stripConversationalBoilerplate(p3)).toBe(p3);
    });

    it('6.2 preserves legitimate domain headings starting with conversational words', () => {
      const text = 'Hello World is traditionally the first program written in introductory computer science courses [Lab 1].';
      expect(stripConversationalBoilerplate(text)).toBe(text);
    });

    it('6.3 preserves bullet points containing domain words', () => {
      const text = [
        '* Understood concepts: pointers, dynamic memory allocation [Lecture 2]',
        '* Great questions to consider: time vs space complexity [Lecture 3]',
        '* Best practices: write modular functions with descriptive names [Style Guide]',
      ].join('\n');
      expect(stripConversationalBoilerplate(text)).toBe(text);
    });
  });

  // ==========================================
  // Section 7: Edge Cases & Resiliency
  // ==========================================
  describe('7. Edge Cases & Resiliency', () => {
    it('7.1 handles empty string, null-like, and whitespace-only inputs', () => {
      expect(stripConversationalBoilerplate('')).toBe('');
      expect(stripConversationalBoilerplate('   \n\t  ')).toBe('');
      expect(stripConversationalBoilerplate(null as any)).toBe('');
      expect(stripConversationalBoilerplate(undefined as any)).toBe('');
    });

    it('7.2 handles unicode and multilingual text', () => {
      const input = 'Sure! Het tentamen vindt plaats op 25 oktober om 09:00 uur [Syllabus]. Veel succes!';
      const output = stripConversationalBoilerplate(input);
      expect(output).toContain('Het tentamen vindt plaats op 25 oktober om 09:00 uur [Syllabus].');
    });

    it('7.3 handles output that is ONLY conversational boilerplate without content', () => {
      const input = 'Sure thing! Hope this helps!';
      const output = stripConversationalBoilerplate(input);
      expect(output).toBe('');
    });

    it('7.4 handles extremely long prose input (50 KB) with boilerplate cleanly', () => {
      const longBody = 'Fact: The course covers distributed algorithms.\n'.repeat(1000);
      const input = `Certainly! Here is the overview:\n\n${longBody}\n\nHope this helps! Good luck!`;
      const output = stripConversationalBoilerplate(input);
      expect(output.startsWith('Fact: The course covers distributed algorithms.')).toBe(true);
      expect(output.endsWith('Fact: The course covers distributed algorithms.')).toBe(true);
      expect(output).not.toContain('Certainly!');
      expect(output).not.toContain('Hope this helps!');
    });
  });
});
