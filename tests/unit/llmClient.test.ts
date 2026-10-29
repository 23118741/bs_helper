/**
 * tests/unit/llmClient.test.ts
 * Comprehensive unit test suite for the Single LLM Client Gateway (llmClient.ts),
 * execution modes ('gemini', 'proxy'), and Chrome storage integration.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assemblePromptWithContext,
  clearLLMSettings,
  DEFAULT_LLM_SETTINGS,
  generateLLM,
  getGeminiApiKey,
  getLLMMode,
  getLLMSettings,
  getProxyConfig,
  hasValidCredentials,
  isRawJsonResponse,
  llm,
  resetLLMSettings,
  saveLLMSettings,
  setGeminiApiKey,
  setLLMMode,
  setProxyConfig,
  stripConversationalBoilerplate,
  ZERO_FLUFF_SYSTEM_INSTRUCTION,
} from '@/services/llm/llmClient';
import { LLM_STORAGE_KEYS } from '@/services/llm/llmStorage';
import { LLMError } from '@/types/llm';
import { CourseContextBundle } from '@/types/parser';

describe('Single LLM Client Gateway & Storage (Milestone 3 / R3)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const sampleContextBundle: CourseContextBundle = {
    courseInfo: {
      orgUnitId: '88421',
      courseName: 'CS101: Introduction to Computer Science',
      exportedAt: '2026-10-19T12:00:00Z',
    },
    overview: 'Welcome to CS101. Foundations of Algorithms.',
    announcements: [
      {
        id: 'ann-1',
        title: 'Midterm Announcement',
        body: 'Midterm will take place next Tuesday.',
        postedDate: '2026-10-15T09:00:00Z',
      },
    ],
    assignments: [
      {
        id: 'assign-1',
        name: 'Project 1: CLI Parser',
        instructions: 'Implement parser in TypeScript.',
        dueDate: '2026-10-25T23:59:00Z',
      },
    ],
    quizzes: [
      {
        id: 'quiz-1',
        title: 'Quiz 1: Syntax & Types',
        dueDate: '2026-10-20T23:59:00Z',
      },
    ],
    calendar: [
      {
        id: 'cal-1',
        title: 'Lecture 4: Recursion',
        startDate: '2026-10-21T10:00:00Z',
      },
    ],
    grades: [
      {
        id: 'grade-1',
        name: 'Assignment 0',
        pointsNumerator: 100,
        pointsDenominator: 100,
        gradeText: '100%',
        comments: 'Excellent work!',
      },
    ],
    documents: [
      {
        title: 'Lecture 1 Slides.pptx',
        type: 'pptx',
        content: '[Slide 1] Introduction to Big O notation.',
      },
    ],
  };

  function mockFetchJson(body: any, status = 200, statusText = 'OK') {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      headers: new Headers({ 'Content-Type': 'application/json' }),
    });
  }

  function mockFetchHttpError(status: number, statusText: string, errorBody?: any) {
    const defaultBody = errorBody ?? {
      error: { code: status, message: statusText, status: 'ERROR' },
    };
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status,
      statusText,
      json: async () => defaultBody,
      text: async () => JSON.stringify(defaultBody),
      headers: new Headers({ 'Content-Type': 'application/json' }),
    });
  }

  function mockFetchNetworkError(msg = 'Network connection failed') {
    fetchMock.mockRejectedValueOnce(new TypeError(msg));
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ==========================================
  // Suite 1: Manual Mode ("Zelf oppikken")
  // ==========================================


  // ==========================================
  // Suite 2: Gemini 2.5 Flash Mode
  // ==========================================
  describe('2. Gemini Mode ("Gemini 2.5 Flash")', () => {
    it('sends POST request to Generative Language API with correct model and apiKey', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Here is the comprehensive briefing.' }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 120,
          candidatesTokenCount: 40,
          totalTokenCount: 160,
        },
      };
      mockFetchJson(mockGeminiResponse);

      const result = await llm.generate('Summarize course', {
        mode: 'gemini',
        apiKey: 'test-gemini-key-xyz',
        contextBundle: sampleContextBundle,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchMock.mock.calls[0];

      expect(calledUrl).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
      expect(calledUrl).toContain('key=test-gemini-key-xyz');
      expect(calledInit.method).toBe('POST');
      expect(calledInit.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(calledInit.body);
      expect(body.contents).toBeDefined();
      expect(body.contents[0].parts[0].text).toContain('Summarize course');
      expect(body.contents[0].parts[0].text).toContain('CS101: Introduction to Computer Science');

      expect(result.text).toBe('Here is the comprehensive briefing.');
      expect(result.mode).toBe('gemini');
      expect(result.usage?.totalTokens).toBe(160);
      expect(result.metadata?.finishReason).toBe('STOP');
    });

    it('respects systemInstruction, temperature, and custom model options', async () => {
      mockFetchJson({
        candidates: [{ content: { parts: [{ text: 'Custom response' }] } }],
      });

      await llm.generate('Prompt', {
        mode: 'gemini',
        model: 'gemini-2.5-pro',
        apiKey: 'test-key',
        systemInstruction: 'You are an academic advisor.',
        temperature: 0.2,
        maxOutputTokens: 1024,
      });

      const [calledUrl, calledInit] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain('/models/gemini-2.5-pro:generateContent');

      const body = JSON.parse(calledInit.body);
      expect(body.systemInstruction?.parts?.[0]?.text).toBe('You are an academic advisor.');
      expect(body.generationConfig?.temperature).toBe(0.2);
      expect(body.generationConfig?.maxOutputTokens).toBe(1024);
    });

    it('throws a friendly error when API key is missing without calling fetch', async () => {
      await expect(
        llm.generate('Prompt', { mode: 'gemini', apiKey: '' })
      ).rejects.toThrow(/Gemini API key is missing/i);

      expect(fetchMock).toHaveBeenCalledTimes(0);
    });

    it('handles HTTP 400 Bad Request error', async () => {
      mockFetchHttpError(400, 'Bad Request', {
        error: { code: 400, message: 'Invalid payload argument' },
      });

      await expect(
        llm.generate('Prompt', { mode: 'gemini', apiKey: 'valid-key' })
      ).rejects.toThrow(/400/);
    });

    it('handles HTTP 401 / 403 Invalid API key or quota exceeded error', async () => {
      mockFetchHttpError(403, 'Forbidden', {
        error: { code: 403, message: 'API_KEY_INVALID' },
      });

      await expect(
        llm.generate('Prompt', { mode: 'gemini', apiKey: 'invalid-key' })
      ).rejects.toThrow(/API key|quota|403/i);
    });

    it('handles HTTP 429 Rate limit exceeded error', async () => {
      mockFetchHttpError(429, 'Too Many Requests', {
        error: { code: 429, message: 'RESOURCE_EXHAUSTED' },
      });

      await expect(
        llm.generate('Prompt', { mode: 'gemini', apiKey: 'valid-key' })
      ).rejects.toThrow(/rate limit|429|exhausted/i);
    });

    it('handles HTTP 500 Google server error', async () => {
      mockFetchHttpError(500, 'Internal Server Error');

      await expect(
        llm.generate('Prompt', { mode: 'gemini', apiKey: 'valid-key' })
      ).rejects.toThrow(/500|server error/i);
    });

    it('handles network failure (offline / fetch reject) cleanly', async () => {
      mockFetchNetworkError('TypeError: Failed to fetch');

      await expect(
        llm.generate('Prompt', { mode: 'gemini', apiKey: 'valid-key' })
      ).rejects.toThrow(/network|connection/i);
    });

    it('handles content blocked by safety filters', async () => {
      mockFetchJson({
        candidates: [
          {
            finishReason: 'SAFETY',
            safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'HIGH' }],
          },
        ],
      });

      try {
        await llm.generate('Flagged prompt', {
          mode: 'gemini',
          apiKey: 'valid-key',
        });
        expect.fail('Should have thrown on safety block');
      } catch (err: any) {
        expect(err instanceof LLMError).toBe(true);
        expect(err.name).toBe('LLMError');
        expect(err.code).toBe('SAFETY_BLOCKED');
      }
    });

    it('handles promptFeedback blockReason safety blocks', async () => {
      mockFetchJson({
        promptFeedback: {
          blockReason: 'PROHIBITED_CONTENT',
        },
      });

      try {
        await llm.generate('Prohibited prompt', {
          mode: 'gemini',
          apiKey: 'valid-key',
        });
        expect.fail('Should have thrown on prompt safety block');
      } catch (err: any) {
        expect(err.name).toBe('LLMError');
        expect(err.code).toBe('SAFETY_BLOCKED');
      }
    });
  });

  // ==========================================
  // Suite 3: Proxy Mode ("Future Proxy")
  // ==========================================
  describe('3. Proxy Mode ("Future Proxy")', () => {
    it('forwards prompt, options, and context to custom proxy URL with Bearer token', async () => {
      mockFetchJson({ text: 'Response from remote proxy' });

      const result = await llm.generate('Analyze deadlines', {
        mode: 'proxy',
        proxyUrl: 'https://proxy.brightspace-helper.internal/api/generate',
        proxyToken: 'secret-bearer-token-123',
        contextBundle: sampleContextBundle,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];

      expect(url).toBe('https://proxy.brightspace-helper.internal/api/generate');
      expect(init.method).toBe('POST');
      expect(init.headers['Authorization']).toBe('Bearer secret-bearer-token-123');
      expect(init.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(init.body);
      expect(body.prompt).toBe('Analyze deadlines');
      expect(body.options.context).toContain('CS101: Introduction to Computer Science');

      expect(result.text).toBe('Response from remote proxy');
      expect(result.mode).toBe('proxy');
    });

    it('omits Authorization header when proxyToken is not provided', async () => {
      mockFetchJson({ text: 'Unauthenticated proxy response' });

      await llm.generate('Analyze deadlines', {
        mode: 'proxy',
        proxyUrl: 'https://open-proxy.org/generate',
      });

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('decodes alternative proxy response formats (content field, OpenAI choices, Gemini candidates)', async () => {
      // Test format 1: { content: "..." }
      mockFetchJson({ content: 'Decoded content format' });
      let result = await llm.generate('Prompt', {
        mode: 'proxy',
        proxyUrl: 'https://proxy.test/generate',
      });
      expect(result.text).toBe('Decoded content format');

      // Test format 2: Gemini-compatible payload
      mockFetchJson({
        candidates: [{ content: { parts: [{ text: 'Decoded gemini schema' }] } }],
      });
      result = await llm.generate('Prompt', {
        mode: 'proxy',
        proxyUrl: 'https://proxy.test/generate',
      });
      expect(result.text).toBe('Decoded gemini schema');

      // Test format 3: OpenAI choices schema
      mockFetchJson({
        choices: [{ message: { content: 'Decoded openai schema' } }],
      });
      result = await llm.generate('Prompt', {
        mode: 'proxy',
        proxyUrl: 'https://proxy.test/generate',
      });
      expect(result.text).toBe('Decoded openai schema');
    });

    it('throws clear error when proxyUrl is missing without calling fetch', async () => {
      await expect(
        llm.generate('Prompt', { mode: 'proxy', proxyUrl: '' })
      ).rejects.toThrow(/proxy url is missing/i);

      expect(fetchMock).toHaveBeenCalledTimes(0);
    });

    it('handles proxy HTTP 401/403 unauthorized errors', async () => {
      mockFetchHttpError(401, 'Unauthorized', { error: 'Invalid proxy bearer token' });

      await expect(
        llm.generate('Prompt', {
          mode: 'proxy',
          proxyUrl: 'https://proxy.test/generate',
          proxyToken: 'bad-token',
        })
      ).rejects.toThrow(/401|unauthorized/i);
    });

    it('handles proxy HTTP 502 Bad Gateway / timeout errors', async () => {
      mockFetchHttpError(502, 'Bad Gateway');

      await expect(
        llm.generate('Prompt', {
          mode: 'proxy',
          proxyUrl: 'https://proxy.test/generate',
        })
      ).rejects.toThrow(/502|gateway/i);
    });
  });

  // ==========================================
  // Suite 4: Storage Integration & Fallback Defaults
  // ==========================================
  describe('4. Storage Integration & Fallback Defaults', () => {


    it('falls back to stored mode when options.mode is not specified', async () => {
      await saveLLMSettings({
        mode: 'gemini',
        geminiApiKey: 'stored-api-key',
      });

      mockFetchJson({
        candidates: [{ content: { parts: [{ text: 'Response via stored config' }] } }],
      });

      const result = await llm.generate('Prompt with stored config');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain('key=stored-api-key');
      expect(result.mode).toBe('gemini');
      expect(result.text).toBe('Response via stored config');
    });



    it('loads stored proxyUrl and proxyToken when mode is proxy', async () => {
      await saveLLMSettings({
        mode: 'proxy',
        proxyUrl: 'https://stored-proxy.internal/generate',
        proxyToken: 'stored-proxy-token',
      });

      mockFetchJson({ text: 'Stored proxy reply' });

      const result = await llm.generate('Proxy test');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://stored-proxy.internal/generate');
      expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('Bearer stored-proxy-token');
      expect(result.text).toBe('Stored proxy reply');
    });
  });

  // ==========================================
  // Suite 5: Storage Helpers Unit Tests (llmStorage.ts)
  // ==========================================
  describe('5. Storage Helpers (llmStorage.ts)', () => {
    it('returns DEFAULT_LLM_SETTINGS when storage is unpopulated', async () => {
      const settings = await getLLMSettings();
      expect(settings.mode).toBe(DEFAULT_LLM_SETTINGS.mode);
      expect(settings.geminiApiKey).toBe(DEFAULT_LLM_SETTINGS.geminiApiKey);
      expect(settings.proxyUrl).toBe(DEFAULT_LLM_SETTINGS.proxyUrl);
      expect(settings.proxyToken).toBe(DEFAULT_LLM_SETTINGS.proxyToken);
      expect(settings.model).toBe(DEFAULT_LLM_SETTINGS.model);
      expect(settings.geminiModel).toBe(DEFAULT_LLM_SETTINGS.geminiModel);
    });





    it('clearLLMSettings removes all LLM keys while leaving unrelated keys untouched', async () => {
      await chrome.storage.local.set({
        [LLM_STORAGE_KEYS.MODE]: 'gemini',
        [LLM_STORAGE_KEYS.GEMINI_KEY]: 'key-to-clear',
        unrelated_key: 'preserve_this_data',
      });

      await clearLLMSettings();

      const stored = await chrome.storage.local.get(null);
      expect(stored[LLM_STORAGE_KEYS.MODE]).toBeUndefined();
      expect(stored[LLM_STORAGE_KEYS.GEMINI_KEY]).toBeUndefined();
      expect(stored.unrelated_key).toBe('preserve_this_data');
    });



    it('setLLMMode, setGeminiApiKey, and setProxyConfig update specific fields', async () => {
      await setLLMMode('proxy');
      await setGeminiApiKey('new-key');
      await setProxyConfig({ proxyUrl: 'https://p.test', proxyToken: 'tok' });

      const settings = await getLLMSettings();
      expect(settings.mode).toBe('proxy');
      expect(settings.geminiApiKey).toBe('new-key');
      expect(settings.proxyUrl).toBe('https://p.test');
      expect(settings.proxyToken).toBe('tok');

      expect(await getLLMMode()).toBe('proxy');
      expect(await getGeminiApiKey()).toBe('new-key');
      const pConf = await getProxyConfig();
      expect(pConf.proxyUrl).toBe('https://p.test');
      expect(pConf.proxyToken).toBe('tok');
    });


  });

  // ==========================================
  // Suite 6: Prompt Assembly & Validation Edge Cases
  // ==========================================
  describe('6. Prompt Assembly & Input Validation', () => {
    it('returns raw prompt when no context is provided', () => {
      const prompt = 'Summarize this course';
      expect(assemblePromptWithContext(prompt)).toBe(prompt);
      expect(assemblePromptWithContext(prompt, '')).toBe(prompt);
      expect(assemblePromptWithContext(prompt, '   ')).toBe(prompt);
    });

    it('prepends serialized context in clean structured markdown', () => {
      const prompt = 'Create study questions';
      const context = '## Course Overview\nIntroduction to Computer Science';
      const result = assemblePromptWithContext(prompt, context);

      expect(result).toContain('# Course Materials Context');
      expect(result).toContain(context);
      expect(result).toContain('# User Instructions / Query');
      expect(result).toContain(prompt);
    });

    it('rejects empty or whitespace-only prompt', async () => {
      await expect(llm.generate('')).rejects.toThrow('Prompt cannot be empty.');
      await expect(llm.generate('   \n  ')).rejects.toThrow('Prompt cannot be empty.');
    });

    it('rejects unsupported mode', async () => {
      await expect(
        llm.generate('Valid prompt', { mode: 'non-existent-mode' as any })
      ).rejects.toThrow('Unsupported LLM mode');
    });


  });

  // ==========================================
  // Suite 7: Requirement R1: BLUF Zero-Fluff Persona, Low-Entropy Defaults & Boilerplate Stripper
  // ==========================================
  describe('7. Requirement R1: BLUF Zero-Fluff Persona, Low-Entropy Defaults & Boilerplate Stripper', () => {


    it('7.2 ZERO_FLUFF_SYSTEM_INSTRUCTION contains all required BLUF constraints and examples', () => {
      expect(ZERO_FLUFF_SYSTEM_INSTRUCTION).toContain('BLUF');
      expect(ZERO_FLUFF_SYSTEM_INSTRUCTION).toContain('CHARACTER 0');
      expect(ZERO_FLUFF_SYSTEM_INSTRUCTION).toContain('No greetings');
      expect(ZERO_FLUFF_SYSTEM_INSTRUCTION).toContain('[[NOT_FOUND]]');
      expect(ZERO_FLUFF_SYSTEM_INSTRUCTION).toContain('[[GENERAL]]');
      expect(ZERO_FLUFF_SYSTEM_INSTRUCTION).toContain('EXAMPLES');
      expect(ZERO_FLUFF_SYSTEM_INSTRUCTION).toContain('BAD:');
      expect(ZERO_FLUFF_SYSTEM_INSTRUCTION).toContain('GOOD:');
    });

    it('7.3 stripConversationalBoilerplate removes leading preambles and trailing sign-offs', () => {
      const raw =
        'Sure! Based on the provided course materials, here is the answer: The midterm exam is on October 25, 2026 [Syllabus p. 2]. Hope this helps! Let me know if you have any questions!';
      expect(stripConversationalBoilerplate(raw)).toBe(
        'The midterm exam is on October 25, 2026 [Syllabus p. 2].'
      );
    });

    it('7.4 stripConversationalBoilerplate removes multi-line preambles above Markdown tables', () => {
      const raw = `Certainly! Here is the grading breakdown according to the syllabus:\n\n| Component | Weight |\n|---|---|\n| Assignments | 40% |\n| Exam | 60% |\n\nHope this helps! Good luck with your studies!`;
      const clean = stripConversationalBoilerplate(raw);
      expect(clean).toContain('| Component | Weight |');
      expect(clean).not.toContain('Certainly!');
      expect(clean).not.toContain('Hope this helps!');
    });

    it('7.5 stripConversationalBoilerplate preserves bullet lists and numbers cleanly', () => {
      const raw = `Sure thing! Based on the lecture slides:\n* O(1) - Constant time [Slide 4]\n* O(n) - Linear time [Slide 8]\n\nFeel free to ask if you have more questions.`;
      const clean = stripConversationalBoilerplate(raw);
      expect(clean).toBe('* O(1) - Constant time [Slide 4]\n* O(n) - Linear time [Slide 8]');
    });

    it('7.6 stripConversationalBoilerplate preserves raw JSON payloads and code fences untouched', () => {
      const jsonStr = '[{"front": "Q", "back": "A"}]';
      expect(isRawJsonResponse(jsonStr)).toBe(true);
      expect(stripConversationalBoilerplate(jsonStr)).toBe(jsonStr);

      const fencedJson = '```json\n[{"front": "Q", "back": "A"}]\n```';
      expect(isRawJsonResponse(fencedJson)).toBe(true);
      expect(stripConversationalBoilerplate(fencedJson)).toBe(fencedJson);

      const prose = 'Here is the answer: 42';
      expect(isRawJsonResponse(prose)).toBe(false);
    });

    it('7.7 stripConversationalBoilerplate preserves strict absence fallback string', () => {
      const fallback = 'Not specified in the selected Brightspace materials.';
      expect(stripConversationalBoilerplate(fallback)).toBe(fallback);
    });

    it('7.8 stripConversationalBoilerplate does not mangle internal domain phrases', () => {
      const text = "According to Bloom's taxonomy, evaluation is a higher-order skill [Lecture 1].";
      expect(stripConversationalBoilerplate(text)).toBe(text);
    });

    it('7.9 llm.generate automatically applies boilerplate stripping in gemini and proxy modes', async () => {
      // Gemini mode test
      mockFetchJson({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'Sure! Here is the answer: Midterm is Friday [Syllabus p. 2]. Hope this helps!',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      });

      const geminiRes = await llm.generate('When is midterm?', {
        mode: 'gemini',
        apiKey: 'test-key',
      });
      expect(geminiRes.text).toBe('Midterm is Friday [Syllabus p. 2].');

      // Proxy mode test
      mockFetchJson({
        text: 'Certainly! Here is the information: Room 302 [Syllabus p. 1]. Let me know if you need anything else!',
      });

      const proxyRes = await llm.generate('Where is office?', {
        mode: 'proxy',
        proxyUrl: 'https://proxy.test/api',
      });
      expect(proxyRes.text).toBe('Room 302 [Syllabus p. 1].');
    });



    it('7.11 llm.generate uses 0.15 temperature default when options.temperature is omitted', async () => {
      mockFetchJson({
        candidates: [{ content: { parts: [{ text: 'Response' }] } }],
      });

      await llm.generate('Prompt', { mode: 'gemini', apiKey: 'test-key' });
      const init = fetchMock.mock.calls[0][1];
      const body = JSON.parse(init.body);
      expect(body.generationConfig?.temperature).toBe(0.15);
    });
  });

  // ==========================================
  // Suite 7: Settings, credentials & aliases (gemini / proxy only)
  // ==========================================
  describe('7. Settings, Credentials & Aliases', () => {
    const geminiReply = (text: string) => ({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });

    it('defaults to gemini mode and legacy "manual" values recover to it', async () => {
      expect((await getLLMSettings()).mode).toBe('gemini');
      await chrome.storage.local.set({ [LLM_STORAGE_KEYS.MODE]: 'manual' });
      expect((await getLLMSettings()).mode).toBe('gemini');
    });

    it('allows options to explicitly override the stored mode', async () => {
      await saveLLMSettings({ mode: 'gemini', geminiApiKey: 'k' });
      mockFetchJson({ text: 'proxied' });
      const result = await llm.generate('Override', {
        mode: 'proxy',
        proxyUrl: 'https://override-proxy.test/generate',
      });
      expect(fetchMock.mock.calls[0][0]).toBe('https://override-proxy.test/generate');
      expect(result.mode).toBe('proxy');
    });

    it('saves partial settings without wiping existing settings', async () => {
      await saveLLMSettings({ geminiApiKey: 'test-key-1' });
      let settings = await getLLMSettings();
      expect(settings.geminiApiKey).toBe('test-key-1');
      expect(settings.mode).toBe('gemini');

      await saveLLMSettings({ mode: 'proxy' });
      settings = await getLLMSettings();
      expect(settings.geminiApiKey).toBe('test-key-1');
      expect(settings.mode).toBe('proxy');
    });

    it('hasValidCredentials evaluates readiness for each mode', async () => {
      await saveLLMSettings({ geminiApiKey: '' });
      expect(await hasValidCredentials('gemini')).toBe(false);
      await saveLLMSettings({ geminiApiKey: '   ' });
      expect(await hasValidCredentials('gemini')).toBe(false);
      await saveLLMSettings({ geminiApiKey: 'valid-gemini-key' });
      expect(await hasValidCredentials('gemini')).toBe(true);

      await saveLLMSettings({ proxyUrl: '' });
      expect(await hasValidCredentials('proxy')).toBe(false);
      await saveLLMSettings({ proxyUrl: 'https://proxy.example.com' });
      expect(await hasValidCredentials('proxy')).toBe(true);
    });

    it('resetLLMSettings restores settings to initial defaults', async () => {
      await saveLLMSettings({ mode: 'proxy', geminiApiKey: 'key-to-reset', proxyUrl: 'https://old-proxy.com' });
      await resetLLMSettings();
      const settings = await getLLMSettings();
      expect(settings.mode).toBe('gemini');
      expect(settings.geminiApiKey).toBe('');
      expect(settings.proxyUrl).toBe('');
    });

    it('exports generateLLM as alias for llm.generate', async () => {
      await saveLLMSettings({ geminiApiKey: 'alias-key' });
      mockFetchJson(geminiReply('Hi there, this is the reply body'));
      const res = await generateLLM('Hello');
      expect(res.mode).toBe('gemini');
      expect(res.text).toContain('reply body');
    });
  });
});
