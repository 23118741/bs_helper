/**
 * tests/stress/gatewayMilestone1Stress.test.tsx
 * Empirical Challenger 2 Test Harness: Milestone 1 Gateway Execution & Defaults
 *
 * Verifies:
 * Vector 1: Manual Mode un-stripped prompt and context bundle integrity
 * Vector 2: Gemini Mode 0.15 temperature default, explicit overrides, and prose post-processing
 * Vector 3: Proxy Mode 0.15 temperature default, auth headers, and prose post-processing across schemas
 * Vector 4: SettingsModal default temperature (0.15 UI state, reset to default, persistence)
 * Vector 5: Adversarial Boundary Stress (false-positive immunity, edge cases, concurrency)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import {
  llm,
  DEFAULT_LLM_SETTINGS,
  stripConversationalBoilerplate,
  isRawJsonResponse,
} from '@/services/llm/llmClient';
import { SettingsModal } from '@/components/SettingsModal';
import { LLMError } from '@/types/llm';
import { getLLMSettings, resetLLMSettings } from '@/services/llm/llmStorage';

describe('Empirical Challenger 2: Milestone 1 Gateway Execution & Defaults Harness', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Vector 1: Manual Mode returns complete un-stripped prompt & context bundle
  // =========================================================================


  // =========================================================================
  // Vector 2: Gemini Mode 0.15 temperature default & prose post-processing
  // =========================================================================
  describe('Vector 2: Gemini Mode Temperature Defaults & Post-Processing', () => {
    it('2.1 passes 0.15 temperature to Gemini REST API when unspecified in options', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text: 'Lab 2 due Nov 1 at 23:59 [Syllabus p. 4].' }] },
              finishReason: 'STOP',
            },
          ],
        }),
      });

      const res = await llm.generate('When is Lab 2 due?', {
        mode: 'gemini',
        apiKey: 'AIzaSyTestKey_12345',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('generativelanguage.googleapis.com');
      expect(url).toContain('key=AIzaSyTestKey_12345');

      const body = JSON.parse(init.body);
      expect(body.generationConfig).toBeDefined();
      expect(body.generationConfig.temperature).toBe(0.15);
      expect(body.generationConfig.maxOutputTokens).toBe(8192);
      expect(res.text).toBe('Lab 2 due Nov 1 at 23:59 [Syllabus p. 4].');
    });

    it('2.2 respects explicit temperature 0.0 (boundary check: does not fall back to 0.15)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Deterministic output.' }] } }],
        }),
      });

      await llm.generate('Query', {
        mode: 'gemini',
        apiKey: 'test-key',
        temperature: 0,
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.generationConfig.temperature).toBe(0);
    });

    it('2.3 post-processes prose to strip leading preambles and trailing pleasantries', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text:
                      'Certainly! Based on the provided syllabus, here is the answer: The midterm exam is on October 25 in Room 101 [Syllabus p. 2]. Hope this helps! Please let me know if you need more details!',
                  },
                ],
              },
            },
          ],
        }),
      });

      const res = await llm.generate('When and where is the midterm?', {
        mode: 'gemini',
        apiKey: 'test-key',
      });

      expect(res.text).toBe('The midterm exam is on October 25 in Room 101 [Syllabus p. 2].');
    });

    it('2.4 post-processes prose preceding Markdown tables while keeping table formatting intact', async () => {
      const rawModelOutput = `Sure thing! Here is the grading breakdown according to the syllabus:\n\n| Assessment | Weight | Due |\n|---|---|---|\n| Midterm | 30% | Oct 25 |\n| Final | 50% | Dec 15 |\n| Labs | 20% | Weekly |\n\nBest of luck with your studies!`;

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: rawModelOutput }] } }],
        }),
      });

      const res = await llm.generate('Grading breakdown', {
        mode: 'gemini',
        apiKey: 'test-key',
      });

      expect(res.text).toContain('| Assessment | Weight | Due |');
      expect(res.text).toContain('| Midterm | 30% | Oct 25 |');
      expect(res.text).not.toContain('Sure thing!');
      expect(res.text).not.toContain('Best of luck');
    });

    it('2.5 preserves raw JSON responses from Gemini completely untouched', async () => {
      const jsonResponse = JSON.stringify([
        { id: 't-1', title: 'Read Chapter 4', priority: 'high' },
        { id: 't-2', title: 'Complete Lab 2', priority: 'urgent' },
      ]);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: jsonResponse }] } }],
        }),
      });

      const res = await llm.generate('Generate action tasks', {
        mode: 'gemini',
        apiKey: 'test-key',
      });

      expect(res.text).toBe(jsonResponse);
      expect(isRawJsonResponse(res.text)).toBe(true);
    });

    it('2.6 never returns the bare absence string: it asks again as a plain chat and tags the answer', async () => {
      const reply = (text: string) => ({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
      });
      fetchMock
        .mockResolvedValueOnce(reply('Not specified in the selected Brightspace materials.'))
        .mockResolvedValueOnce(reply('[[GENERAL]] The campus bookstore is usually near the main entrance.'));

      const res = await llm.generate('Where is the campus bookstore?', {
        mode: 'gemini',
        apiKey: 'test-key',
      });

      expect(res.text).toBe('The campus bookstore is usually near the main entrance.');
      expect(res.general).toBe(true);
    });
  });

  // =========================================================================
  // Vector 3: Proxy Mode 0.15 temperature default & prose post-processing
  // =========================================================================
  describe('Vector 3: Proxy Mode Temperature Defaults & Post-Processing', () => {
    it('3.1 passes 0.15 temperature and Authorization header to custom proxy when unspecified', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          text: 'Project 2 deadline is November 1, 23:59 [Syllabus p. 5].',
        }),
      });

      const res = await llm.generate('When is Project 2 due?', {
        mode: 'proxy',
        proxyUrl: 'https://proxy.university.edu/api/generate',
        proxyToken: 'sec-auth-token-xyz',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://proxy.university.edu/api/generate');
      expect(init.headers['Authorization']).toBe('Bearer sec-auth-token-xyz');

      const body = JSON.parse(init.body);
      expect(body.options).toBeDefined();
      expect(body.options.temperature).toBe(0.15);
      expect(body.options.model).toBe('gemini-3.8-flash');
      expect(res.text).toBe('Project 2 deadline is November 1, 23:59 [Syllabus p. 5].');
    });

    it('3.2 preserves explicit temperature 0.0 in proxy mode options payload', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ text: 'Deterministic proxy response.' }),
      });

      await llm.generate('Query', {
        mode: 'proxy',
        proxyUrl: 'https://proxy.university.edu/api/generate',
        temperature: 0,
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.options.temperature).toBe(0);
    });

    it('3.3 post-processes prose across diverse proxy response schemas', async () => {
      // Schema A: direct "text"
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          text: 'Sure! The professor is Dr. Turing [Overview]. Hope this helps!',
        }),
      });
      let res = await llm.generate('Who is professor?', {
        mode: 'proxy',
        proxyUrl: 'https://proxy.test/gen',
      });
      expect(res.text).toBe('The professor is Dr. Turing [Overview].');

      // Schema B: OpenAI choices
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  'Certainly! Office hours are Wednesdays 2-4 PM [Syllabus]. Feel free to ask if you have more questions.',
              },
            },
          ],
        }),
      });
      res = await llm.generate('Office hours?', {
        mode: 'proxy',
        proxyUrl: 'https://proxy.test/gen',
      });
      expect(res.text).toBe('Office hours are Wednesdays 2-4 PM [Syllabus].');
    });

    it('3.4 preserves raw JSON responses returned by proxy without corruption', async () => {
      const rawJson = '{"deck":[{"front":"Paxos","back":"Consensus protocol"}]}';
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ content: rawJson }),
      });

      const res = await llm.generate('Generate flashcards', {
        mode: 'proxy',
        proxyUrl: 'https://proxy.test/gen',
      });

      expect(res.text).toBe(rawJson);
      expect(isRawJsonResponse(res.text)).toBe(true);
    });
  });

  // =========================================================================
  // Vector 4: SettingsModal default temperature is 0.15
  // =========================================================================
  describe('Vector 4: SettingsModal Default Temperature (0.15)', () => {
    beforeEach(async () => {
      await resetLLMSettings();
    });

    it('4.1 initial render in fresh environment displays 0.15 temperature slider and text', async () => {
      expect(DEFAULT_LLM_SETTINGS.temperature).toBe(0.15);
      const { getByText, container } = render(
        <SettingsModal isOpen={true} onClose={vi.fn()} />
      );

      // Verify displayed text "0.15"
      await waitFor(() => {
        expect(getByText('0.15')).toBeInTheDocument();
      });

      // Verify range input slider has value="0.15"
      const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
      expect(slider).toBeInTheDocument();
      expect(parseFloat(slider.value)).toBe(0.15);
    });

    it('4.2 "Standaard herstellen" resets altered temperature back to 0.15', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { getByText, container } = render(
        <SettingsModal isOpen={true} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(getByText('0.15')).toBeInTheDocument();
      });

      const slider = container.querySelector('input[type="range"]') as HTMLInputElement;

      // User alters temperature to 0.65
      fireEvent.change(slider, { target: { value: '0.65' } });
      expect(getByText('0.65')).toBeInTheDocument();

      // Click "Standaard herstellen"
      const resetButton = getByText('Standaard herstellen');
      fireEvent.click(resetButton);

      await waitFor(() => {
        expect(getByText('0.15')).toBeInTheDocument();
      });
      expect(parseFloat(slider.value)).toBe(0.15);
    });

    it('4.3 saving modal persists temperature 0.15 to storage and triggers callback', async () => {
      const onSavedMock = vi.fn();
      const onCloseMock = vi.fn();

      const { getByRole, container } = render(
        <SettingsModal
          isOpen={true}
          onClose={onCloseMock}
          onSettingsSaved={onSavedMock}
        />
      );

      const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
      expect(parseFloat(slider.value)).toBe(0.15);

      const saveButton = getByRole('button', { name: /opslaan/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(onSavedMock).toHaveBeenCalled();
      });

      const savedSettings = onSavedMock.mock.calls[0][0];
      expect(savedSettings.temperature).toBe(0.15);

      const stored = await getLLMSettings();
      expect(stored.temperature).toBe(0.15);
    });
  });

  // =========================================================================
  // Vector 5: Adversarial Boundary Stress & Edge Cases
  // =========================================================================
  describe('Vector 5: Adversarial Boundary Stress & False-Positive Immunity', () => {
    it('5.1 immune to false positives in domain phrases and similar starting words', () => {
      // "Surely" should not be stripped to "ly"
      const p1 = 'Surely the hypothesis holds under Byzantine conditions [Lecture 7].';
      expect(stripConversationalBoilerplate(p1)).toBe(p1);

      // "History" should not be stripped of "Hi"
      const p2 = 'History of operating systems began in the 1960s [Textbook p. 1].';
      expect(stripConversationalBoilerplate(p2)).toBe(p2);

      // "High-performance" should not be stripped of "Hi"
      const p3 = 'High-performance computing requires parallel execution [Slide 12].';
      expect(stripConversationalBoilerplate(p3)).toBe(p3);

      // Mathematical formulas containing absolute values
      const p4 = '| x - y | <= | x | + | y | [Proof Lemma 1].';
      expect(stripConversationalBoilerplate(p4)).toBe(p4);
    });



    it('5.3 handles missing credentials and invalid arguments with descriptive LLMErrors', async () => {
      // Empty prompt
      await expect(llm.generate('')).rejects.toThrow(LLMError);
      await expect(llm.generate('   ')).rejects.toThrow('Prompt cannot be empty.');

      // Gemini missing API key
      await expect(
        llm.generate('Prompt', { mode: 'gemini', apiKey: '' })
      ).rejects.toThrow('Gemini API key is missing');

      // Proxy missing URL
      await expect(
        llm.generate('Prompt', { mode: 'proxy', proxyUrl: '' })
      ).rejects.toThrow('Proxy URL is missing');

      // Proxy invalid protocol
      await expect(
        llm.generate('Prompt', { mode: 'proxy', proxyUrl: 'ftp://bad-url' })
      ).rejects.toThrow('Invalid proxy URL protocol');
    });
  });
});
