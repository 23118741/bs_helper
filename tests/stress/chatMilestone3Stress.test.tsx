/**
 * tests/stress/chatMilestone3Stress.test.tsx
 * Empirical Challenger 2 Test Harness: Chat: presets, messages and stress suite
 *
 * Verifies Milestone 3 Feature F25:
 * Vector 1: Gemini Mode Q&A Query Wrapping & Chat Message Decoupling
 *           - Query sent to llm.generate is wrapped with buildDirectAnswerPrompt(query, courseName)
 *           - Chat message bubble strictly renders the raw query, NOT the wrapped prompt!
 *           - Multi-turn conversations and edge-case queries (unicode, math, missing course name)
 * Vector 2: Proxy Mode Q&A Query Wrapping & Chat Message Decoupling
 *           - Same wrapping behavior in proxy mode
 *           - Raw query in chat bubble; options.mode === 'proxy' sent to gateway
 * Vector 3: Manual Mode ("Zelf oppikken") Raw Query Pass-Through & Context Bundling
 *           - Raw query passed directly to llm.generate without wrapping
 *           - 1-Click Copy All, Download .md, and Download .json export workflows
 * Vector 4: Summary Presets Execution & Zero User Chat Bubble
 *           - Presets (complete-briefing, study-notes, assignments-deadlines, grades-feedback)
 *           - Send respective preset prompt templates directly (not buildDirectAnswerPrompt)
 *           - Appends one user chat bubble with the preset's one-sentence question
 * Vector 5: Per-Message Copy Button & Clipboard Feedback
 *           - Copy button present on assistant messages, absent on user messages
 *           - Calls navigator.clipboard.writeText with exact message content
 *           - Temporarily updates button text to "Gekopieerd!" with Check icon and reverts
 *           - Multiple assistant messages retain independent copy states
 *           - Clipboard error resilience and undefined navigator handling
 * Vector 6: Assistant Message Rendering via StructuredMarkdown
 *           - Markdown tables (| ... |) rendered with table, thead, tbody, th, td and alignment
 *           - Citation badges ([Source: ...], [Slide N], [Page N]) rendered with badge styling
 *           - Code blocks with language header and copy button
 *           - User message strictly renders plain text (whitespace-pre-wrap), not StructuredMarkdown
 * Vector 7: Adversarial Edge Cases & Stress Scenarios
 *           - AbortController cancellation via Stop button
 *           - LLM rejection error containment and recovery
 *           - Blank/whitespace query validation
 *           - Conversation clear action
 *           - HTML/XSS injection safety
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, within, act } from '@testing-library/react';
import { ChatPlugin } from '@/components/actions/ChatPlugin';
import { llm } from '@/services/llm/llmClient';
import { SUMMARY_PRESETS } from '@/types/actions';
import { CourseData } from '@/types/brightspace';
import { createFullContextSelection } from '@/types/parser';

describe('Empirical Challenger 2: Chat: presets, messages and stress suite', () => {
  const sampleCourseData: CourseData = {
    orgUnitId: '65432',
    courseName: 'CS 450: Machine Learning & Intelligent Systems',
    fetchedAt: 1729500000000,
    overview: {
      title: 'Course Overview & Syllabus',
      htmlContent: '<p>Welcome to CS 450. The passing grade threshold is 55% across all coursework.</p>',
      textDescription: 'Welcome to CS 450. The passing grade threshold is 55% across all coursework.',
    },
    toc: [
      {
        moduleId: 'mod-1',
        title: 'Module 1: Supervised Learning',
        subModules: [],
        topics: [
          {
            topicId: 'top-1',
            title: 'Lecture 1: Linear Regression.pdf',
            type: 'file',
            fileExtension: 'pdf',
          },
        ],
      },
    ],
    announcements: [
      {
        id: 'ann-1',
        title: 'Midterm Exam Schedule',
        body: 'Midterm takes place on November 12 in Hall B.',
        postedDate: '2026-10-15T09:00:00Z',
      },
    ],
    assignments: [
      {
        id: 'asg-1',
        name: 'Project 1: Gradient Descent',
        instructions: '<p>Implement batch and stochastic gradient descent.</p>',
        dueDate: '2026-11-01T23:59:00Z',
      },
    ],
    quizzes: [
      {
        id: 'qz-1',
        title: 'Quiz 1: Math Foundations',
        dueDate: '2026-10-25T17:00:00Z',
      },
    ],
    calendar: [
      {
        id: 'cal-1',
        title: 'Midterm Review Session',
        startDate: '2026-11-10T14:00:00Z',
      },
    ],
    grades: [
      {
        id: 'grd-1',
        name: 'Quiz 1',
        pointsNumerator: 18,
        pointsDenominator: 20,
        gradeText: '90%',
      },
    ],
  };

  const sampleSelection = createFullContextSelection(sampleCourseData);

  beforeEach(() => {
    vi.restoreAllMocks();

    if (!URL.createObjectURL) {
      URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    } else {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    }

    if (!URL.revokeObjectURL) {
      URL.revokeObjectURL = vi.fn();
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    }

    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: vi.fn().mockResolvedValue(undefined),
          readText: vi.fn().mockResolvedValue(''),
        },
        writable: true,
        configurable: true,
      });
    } else {
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Vectors 1-3 (wrapped Q&A prompts, proxy/manual modes) were specific to the removed Summarizer.

  describe('Vector 4: Summary Presets Execution & One-Sentence Question Bubble', () => {
    SUMMARY_PRESETS.forEach((preset) => {
      it(`4.1 preset '${preset.id}' (${preset.title}) sends preset prompt and shows its one-sentence question`, async () => {
        const expectedPrompt = preset.promptTemplate(sampleCourseData.courseName);
        const presetMockResponse = `Executive summary for ${preset.title}: Everything is on track.`;

        const generateSpy = vi.spyOn(llm, 'generate').mockResolvedValueOnce({
          text: presetMockResponse,
          mode: 'gemini',
          usage: { totalTokens: 120 },
        });

        const { getByRole, getByText, queryByText, container } = render(
          <ChatPlugin.component
            courseData={sampleCourseData}
            selection={sampleSelection}
            currentMode="backend"
          />
        );

        const presetBtn = getByRole('button', { name: new RegExp(preset.title, 'i') });

        await act(async () => {
          fireEvent.click(presetBtn);
        });

        // 1. Verify llm.generate called with preset's prompt template
        expect(generateSpy).toHaveBeenCalledTimes(1);
        const [sentPrompt, sentOptions] = generateSpy.mock.calls[0];
        expect(sentPrompt).toBe(expectedPrompt);
        expect(sentOptions?.mode).toBe('backend');

        // 2. One user bubble with the short question (user bubbles have rounded-br-none inside .items-end)
        const userBubbles = container.querySelectorAll('.items-end .rounded-br-none');
        expect(userBubbles.length).toBe(1);
        expect(userBubbles[0].textContent).toContain(preset.question);
        expect(userBubbles[0].textContent).not.toContain(expectedPrompt.slice(0, 40));

        // 3. Verify assistant message rendered
        expect(getByText(presetMockResponse)).toBeDefined();
        expect(queryByText(/BLUF/i)).toBeNull();
      });
    });

    it('4.2 preset buttons are disabled while generation is active and re-enabled upon completion', async () => {
      let resolvePromise!: (val: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      vi.spyOn(llm, 'generate').mockReturnValueOnce(pendingPromise as any);

      const { getByRole, getByText } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const briefingBtn = getByRole('button', { name: /Quick Course Guide/i }) as HTMLButtonElement;
      const notesBtn = getByRole('button', { name: /Study & Lecture Notes/i }) as HTMLButtonElement;

      expect(briefingBtn.disabled).toBe(false);
      expect(notesBtn.disabled).toBe(false);

      await act(async () => {
        fireEvent.click(briefingBtn);
      });

      // While generating: buttons should be disabled
      expect(briefingBtn.disabled).toBe(true);
      expect(notesBtn.disabled).toBe(true);
      expect(getByText(/Analyzing course materials & generating response.../i)).toBeDefined();

      // Resolve generation
      await act(async () => {
        resolvePromise({
          text: 'Course briefing completed.',
          mode: 'gemini',
        });
      });

      // After generation finishes: buttons re-enabled
      expect(briefingBtn.disabled).toBe(false);
      expect(notesBtn.disabled).toBe(false);
    });

    it('4.3 interleaving preset execution followed by Q&A maintains correct chat sequence (Preset question -> Assistant preset -> User Q1 -> Assistant A1)', async () => {
      const preset = SUMMARY_PRESETS[0];
      const presetPrompt = preset.promptTemplate(sampleCourseData.courseName);
      const question = 'Can you clarify the grading rubric?';

      const generateSpy = vi
        .spyOn(llm, 'generate')
        .mockResolvedValueOnce({
          text: 'Complete briefing text.',
          mode: 'gemini',
        })
        .mockResolvedValueOnce({
          text: 'Projects are 40%, exams are 60%.',
          mode: 'gemini',
        });

      const { getByRole, getByPlaceholderText, getByTitle, getByText, container } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      // Step 1: Click Preset
      const presetBtn = getByRole('button', { name: new RegExp(preset.title, 'i') });
      await act(async () => {
        fireEvent.click(presetBtn);
      });

      expect(generateSpy).toHaveBeenCalledTimes(1);
      expect(generateSpy.mock.calls[0][0]).toBe(presetPrompt);
      expect(getByText('Complete briefing text.')).toBeDefined();

      // Step 2: Follow-up Q&A
      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      fireEvent.change(input, { target: { value: question } });

      await act(async () => {
        fireEvent.click(getByTitle('Send question'));
      });

      expect(generateSpy).toHaveBeenCalledTimes(2);
      expect(generateSpy.mock.calls[1][0]).toBe(question); // the question as typed (the server owns the system prompt)

      // Message thread now contains: [Preset question, Assistant preset, User question, Assistant answer]
      const userBubbles = container.querySelectorAll('.items-end .rounded-br-none');
      expect(userBubbles.length).toBe(2);
      expect(within(userBubbles[1] as HTMLElement).getByText(question)).toBeDefined();
      expect(getByText('Projects are 40%, exams are 60%.')).toBeDefined();
    });
  });

  // =========================================================================
  // Vector 5: Per-Message Copy Button & Clipboard Feedback
  // =========================================================================
  describe('Vector 5: Per-Message Copy Button & Clipboard Feedback', () => {
    it('5.1 assistant messages provide a copy button in footer; user messages do NOT', async () => {
      vi.spyOn(llm, 'generate').mockResolvedValueOnce({
        text: 'This is the assistant response.',
        mode: 'gemini',
      });

      const { getByPlaceholderText, getByTitle, getByRole, container } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      fireEvent.change(input, { target: { value: 'User question' } });

      await act(async () => {
        fireEvent.click(getByTitle('Send question'));
      });

      // User bubble should NOT contain any button with title "Kopieer bericht"
      const userBubble = container.querySelector('.bg-blue-600.text-white');
      expect(userBubble).toBeDefined();
      const userCopyBtn = userBubble?.querySelector('button[title="Kopieer bericht"]');
      expect(userCopyBtn).toBeNull();

      // Assistant bubble MUST contain copy button
      const copyBtn = getByRole('button', { name: /Kopieer/i });
      expect(copyBtn).toBeDefined();
      expect(copyBtn.getAttribute('title')).toBe('Kopieer bericht');
    });

    it('5.2 clicking assistant copy button writes content to clipboard and shows temporary feedback', async () => {
      vi.useFakeTimers();

      const assistantText = 'Here is the precise factual answer.';
      vi.spyOn(llm, 'generate').mockResolvedValueOnce({
        text: assistantText,
        mode: 'gemini',
      });

      const { getByPlaceholderText, getByTitle, getByRole, getByText } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      fireEvent.change(input, { target: { value: 'Question?' } });

      await act(async () => {
        fireEvent.click(getByTitle('Send question'));
      });

      const copyBtn = getByRole('button', { name: /Kopieer/i });
      expect(copyBtn).toBeDefined();

      // Click copy button
      await act(async () => {
        fireEvent.click(copyBtn);
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(assistantText);
      expect(getByText('Gekopieerd!')).toBeDefined();

      // Fast-forward 2000ms
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Reverts back to Kopieer
      expect(getByText('Kopieer')).toBeDefined();
    });

    it('5.3 multiple assistant messages maintain independent copy button states', async () => {
      const resp1 = 'First answer.';
      const resp2 = 'Second answer.';

      vi.spyOn(llm, 'generate')
        .mockResolvedValueOnce({ text: resp1, mode: 'gemini' })
        .mockResolvedValueOnce({ text: resp2, mode: 'gemini' });

      const { getByPlaceholderText, getByTitle, getAllByRole, getByText, queryAllByText } =
        render(
          <ChatPlugin.component
            courseData={sampleCourseData}
            selection={sampleSelection}
            currentMode="backend"
          />
        );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      const sendBtn = getByTitle('Send question');

      fireEvent.change(input, { target: { value: 'Q1' } });
      await act(async () => {
        fireEvent.click(sendBtn);
      });

      fireEvent.change(input, { target: { value: 'Q2' } });
      await act(async () => {
        fireEvent.click(sendBtn);
      });

      const copyButtons = getAllByRole('button', { name: /Kopieer/i });
      expect(copyButtons.length).toBe(2);

      // Click copy on message 1 only
      await act(async () => {
        fireEvent.click(copyButtons[0]);
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(resp1);
      expect(getByText('Gekopieerd!')).toBeDefined();

      // Second button still says "Kopieer"
      const remainingKopieer = queryAllByText('Kopieer');
      expect(remainingKopieer.length).toBe(1);
    });

    it('5.4 handles clipboard write rejection gracefully without crashing', async () => {
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
        new Error('Clipboard permission denied')
      );

      vi.spyOn(llm, 'generate').mockResolvedValueOnce({
        text: 'Sample text',
        mode: 'gemini',
      });

      const { getByPlaceholderText, getByTitle, getByRole } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      fireEvent.change(input, { target: { value: 'Test' } });

      await act(async () => {
        fireEvent.click(getByTitle('Send question'));
      });

      const copyBtn = getByRole('button', { name: /Kopieer/i });

      // Click copy with failing clipboard
      await act(async () => {
        fireEvent.click(copyBtn);
      });

      // Component did not crash
      expect(copyBtn).toBeDefined();
    });
  });

  // =========================================================================
  // Vector 6: Scannable StructuredMarkdown Assistant Message Rendering
  // =========================================================================
  describe('Vector 6: Scannable StructuredMarkdown Assistant Message Rendering', () => {
    it('6.1 renders Markdown tables with alignment classes in assistant messages', async () => {
      const tableResponse = `
| Deliverable | Weight | Due Date |
| :--- | :---: | ---: |
| Project 1 | 20% | 2026-11-01 |
| Project 2 | 25% | 2026-11-20 |
      `.trim();

      vi.spyOn(llm, 'generate').mockResolvedValueOnce({
        text: tableResponse,
        mode: 'gemini',
      });

      const { getByPlaceholderText, getByTitle, container } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      fireEvent.change(input, { target: { value: 'Show deliverables table' } });

      await act(async () => {
        fireEvent.click(getByTitle('Send question'));
      });

      // Verify table elements in assistant bubble
      const table = container.querySelector('table');
      expect(table).not.toBeNull();
      const ths = container.querySelectorAll('th');
      expect(ths.length).toBe(3);
      expect(ths[0].textContent).toBe('Deliverable');
      expect(ths[1].textContent).toBe('Weight');
      expect(ths[2].textContent).toBe('Due Date');

      // Verify alignment classes
      expect(ths[0].className).toContain('text-left');
      expect(ths[1].className).toContain('text-center');
      expect(ths[2].className).toContain('text-right');

      const tds = container.querySelectorAll('td');
      expect(tds.length).toBe(6);
      expect(tds[0].textContent).toBe('Project 1');
      expect(tds[1].textContent).toBe('20%');
      expect(tds[2].textContent).toBe('2026-11-01');
    });

    it('6.2 renders inline citation badges with styling in assistant messages', async () => {
      const citationResponse =
        'Passing grade is 55% [Source: Syllabus p. 4] and final exam is closed book [Slide 12].';

      vi.spyOn(llm, 'generate').mockResolvedValueOnce({
        text: citationResponse,
        mode: 'gemini',
      });

      const { getByPlaceholderText, getByTitle, container } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      fireEvent.change(input, { target: { value: 'Grade info' } });

      await act(async () => {
        fireEvent.click(getByTitle('Send question'));
      });

      // Check badge elements
      const badges = container.querySelectorAll('[data-citation]');
      expect(badges.length).toBe(2);
      expect(badges[0].textContent).toBe('[Source: Syllabus p. 4]');
      expect(badges[1].textContent).toBe('[Slide 12]');
    });

    it('6.3 renders fenced code blocks with language tag and copy button', async () => {
      const codeResponse = '```python\ndef gradient_descent(x, y, lr=0.01):\n    return x - lr * y\n```';

      vi.spyOn(llm, 'generate').mockResolvedValueOnce({
        text: codeResponse,
        mode: 'gemini',
      });

      const { getByPlaceholderText, getByTitle, container } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      fireEvent.change(input, { target: { value: 'Code sample' } });

      await act(async () => {
        fireEvent.click(getByTitle('Send question'));
      });

      const pre = container.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toContain('gradient_descent');

      const langHeader = container.querySelector('.bg-slate-950\\/80');
      expect(langHeader?.textContent?.toLowerCase()).toContain('python');
      expect(langHeader?.querySelector('.uppercase')).not.toBeNull();
    });

    it('6.4 user message strictly renders as plain pre-wrapped text, not StructuredMarkdown', async () => {
      const markdownLikeQuery = '# Heading in Query | not a table | [Slide 1]';

      vi.spyOn(llm, 'generate').mockResolvedValueOnce({
        text: 'Clean answer.',
        mode: 'gemini',
      });

      const { getByPlaceholderText, getByTitle, container } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      fireEvent.change(input, { target: { value: markdownLikeQuery } });

      await act(async () => {
        fireEvent.click(getByTitle('Send question'));
      });

      const userBubble = container.querySelector('.bg-blue-600.text-white');
      expect(userBubble).not.toBeNull();

      // Must NOT contain h1 or table inside user bubble
      expect(userBubble?.querySelector('h1')).toBeNull();
      expect(userBubble?.querySelector('table')).toBeNull();
      expect(userBubble?.querySelector('[data-citation]')).toBeNull();

      // Content rendered as plain text in whitespace-pre-wrap div
      expect(userBubble?.textContent).toContain(markdownLikeQuery);
    });
  });

  // =========================================================================
  // Vector 7: Adversarial Edge Cases & Stress Scenarios
  // =========================================================================
  describe('Vector 7: Adversarial Edge Cases & Stress Scenarios', () => {
    it('7.1 clicking Stop cancels active generation via AbortController and resets UI', async () => {
      let aborted = false;
      vi.spyOn(llm, 'generate').mockImplementationOnce(async (_prompt, opts) => {
        return new Promise<never>((_, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            aborted = true;
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const { getByPlaceholderText, getByTitle, getByText, queryByText } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      fireEvent.change(input, { target: { value: 'Long running query' } });

      // Start generation
      await act(async () => {
        fireEvent.click(getByTitle('Send question'));
      });

      expect(getByText(/Analyzing course materials/i)).toBeDefined();

      // Click Stop button
      const stopBtn = getByTitle('Stop generating');
      await act(async () => {
        fireEvent.click(stopBtn);
      });

      expect(aborted).toBe(true);
      expect(queryByText(/Analyzing course materials/i)).toBeNull();
    });

    it('7.2 LLM rejection displays error toast and re-enables UI for subsequent query', async () => {
      const generateSpy = vi
        .spyOn(llm, 'generate')
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({
          text: 'Successful retry response.',
          mode: 'gemini',
        });

      const { getByPlaceholderText, getByTitle, getByText, queryByText } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      const sendBtn = getByTitle('Send question');

      // Attempt 1: Fails
      fireEvent.change(input, { target: { value: 'Attempt 1' } });
      await act(async () => {
        fireEvent.click(sendBtn);
      });

      expect(getByText(/Error executing request/i)).toBeDefined();
      expect(getByText(/Rate limit exceeded/i)).toBeDefined();

      // Attempt 2: Recovers
      fireEvent.change(input, { target: { value: 'Attempt 2' } });
      await act(async () => {
        fireEvent.click(sendBtn);
      });

      expect(queryByText(/Rate limit exceeded/i)).toBeNull();
      expect(getByText(/Successful retry response./i)).toBeDefined();
      expect(generateSpy).toHaveBeenCalledTimes(2);
    });

    it('7.3 empty or whitespace-only input cannot be submitted', async () => {
      const generateSpy = vi.spyOn(llm, 'generate');

      const { getByPlaceholderText, getByTitle } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      const sendBtn = getByTitle('Send question') as HTMLButtonElement;

      // Empty input
      expect(sendBtn.disabled).toBe(true);
      await act(async () => {
        fireEvent.click(sendBtn);
      });
      expect(generateSpy).not.toHaveBeenCalled();

      // Whitespace input
      fireEvent.change(input, { target: { value: '     ' } });
      expect(sendBtn.disabled).toBe(true);
      await act(async () => {
        fireEvent.click(sendBtn);
      });
      expect(generateSpy).not.toHaveBeenCalled();
    });

    it('7.4 clear conversation button removes all messages and restores empty placeholder', async () => {
      vi.spyOn(llm, 'generate').mockResolvedValueOnce({
        text: 'Answer to be cleared.',
        mode: 'gemini',
      });

      const { getByPlaceholderText, getByTitle, getByText, queryByText } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      fireEvent.change(input, { target: { value: 'To clear' } });

      await act(async () => {
        fireEvent.click(getByTitle('Send question'));
      });

      expect(getByText('To clear')).toBeDefined();
      expect(getByText('Answer to be cleared.')).toBeDefined();

      // Click trash / clear button
      const trashBtn = getByTitle('Clear conversation');
      await act(async () => {
        fireEvent.click(trashBtn);
      });

      // Messages cleared; empty placeholder restored
      expect(queryByText('To clear')).toBeNull();
      expect(queryByText('Answer to be cleared.')).toBeNull();
      expect(getByText(/Select a Preset or Ask a Question/i)).toBeDefined();
    });

    it('7.5 HTML and script injection in assistant response is strictly escaped and rendered as text', async () => {
      const maliciousPayload = '<script>window.__hacked = true;</script><img src="x" onerror="window.__xss = true;" /><b>Harmless text</b>';

      vi.spyOn(llm, 'generate').mockResolvedValueOnce({
        text: maliciousPayload,
        mode: 'gemini',
      });

      const { getByPlaceholderText, getByTitle, getByText, container } = render(
        <ChatPlugin.component
          courseData={sampleCourseData}
          selection={sampleSelection}
          currentMode="backend"
        />
      );

      const input = getByPlaceholderText('Ask a follow-up question about the course materials...');
      fireEvent.change(input, { target: { value: 'XSS test' } });

      await act(async () => {
        fireEvent.click(getByTitle('Send question'));
      });

      // Verify no <script> or <img> tag was created in DOM
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('img[onerror]')).toBeNull();
      expect((window as any).__hacked).toBeUndefined();
      expect((window as any).__xss).toBeUndefined();

      // Content is rendered safely as text
      expect(getByText(/<script>window\.__hacked = true;<\/script>/i)).toBeDefined();
    });
  });
});
