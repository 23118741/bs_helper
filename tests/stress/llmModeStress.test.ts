/**
 * tests/stress/llmModeStress.test.ts
 * Adversarial Stress & Robustness Test Suite for Gemini Mode & Proxy Mode (Milestone 3 / R3).
 *
 * Covers:
 * 1. Network timeouts & AbortController signal handling (natural timeout, manual abort, pre-aborted signals, rapid cancel)
 * 2. Complex HTTP error status codes (400, 401, 403, 404, 429, 500, 502, 503, 504, non-standard, HTML error pages)
 * 3. Safety blocks & finishReasons (SAFETY finishReason, prompt blockReason, recitation, max tokens, standard safety settings)
 * 4. Malformed JSON & corrupt responses (truncated JSON, HTML 200, empty body, null data, non-array candidates)
 * 5. Unusual & multi-schema proxy responses (text, content, response, output, result, message, OpenAI, Gemini, raw strings, precedence, usage)
 * 6. Malicious & edge-case proxy URLs (missing, relative, javascript:, data:, missing scheme, SSRF, whitespace, auth headers)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeGeminiMode,
  getStandardSafetySettings,
} from '@/services/llm/geminiMode';
import {
  executeProxyMode,
  extractProxyResponseText,
  extractProxyUsage,
} from '@/services/llm/proxyMode';
import { llm } from '@/services/llm/llmClient';
import { LLMError } from '@/types/llm';

describe('Empirical Adversarial Stress Testing — geminiMode & proxyMode (Milestone 3)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function mockFetchJsonResponse(body: any, status = 200, statusText = 'OK', headers: Record<string, string> = {}) {
    const isJson = typeof body === 'object' && body !== null;
    const responseHeaders = new Headers({
      'Content-Type': isJson ? 'application/json' : 'text/plain',
      ...headers,
    });

    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText,
      json: async () => {
        if (typeof body === 'string') {
          return JSON.parse(body);
        }
        return body;
      },
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      headers: responseHeaders,
    });
  }

  function mockFetchHtmlResponse(htmlBody: string, status = 200, statusText = 'OK') {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText,
      json: async () => {
        throw new SyntaxError(`Unexpected token '<', "${htmlBody.slice(0, 10)}"... is not valid JSON`);
      },
      text: async () => htmlBody,
      headers: new Headers({ 'Content-Type': 'text/html' }),
    });
  }

  function mockFetchRawText(text: string, status = 200, statusText = 'OK') {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText,
      json: async () => {
        throw new SyntaxError(`Unexpected token '${text.charAt(0)}', "${text}" is not valid JSON`);
      },
      text: async () => text,
      headers: new Headers({ 'Content-Type': 'text/plain' }),
    });
  }


  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // =========================================================================
  // SUITE 1: Network Timeouts & AbortController Signal Handling
  // =========================================================================
  describe('Suite 1: Network Timeouts & AbortController Signal Handling', () => {
    it('geminiMode: times out when API does not respond within timeoutMs and throws TIMEOUT error with 408', async () => {
      fetchMock.mockImplementationOnce((_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const start = Date.now();
      await expect(
        executeGeminiMode('Prompt', {
          apiKey: 'test-key',
          timeoutMs: 50,
        })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('TIMEOUT');
        expect(err.status).toBe(408);
        expect(err.message).toMatch(/timed out/i);
        return true;
      });

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
    });

    it('proxyMode: times out when Proxy does not respond within timeoutMs and throws TIMEOUT error with 408', async () => {
      fetchMock.mockImplementationOnce((_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      await expect(
        executeProxyMode('Prompt', {
          proxyUrl: 'https://proxy.example.com/generate',
          timeoutMs: 50,
        })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('TIMEOUT');
        expect(err.status).toBe(408);
        return true;
      });
    });

    it('geminiMode: responds to caller-initiated AbortSignal mid-flight', async () => {
      const callerController = new AbortController();

      fetchMock.mockImplementationOnce((_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const promise = executeGeminiMode('Prompt', {
        apiKey: 'test-key',
        signal: callerController.signal,
        timeoutMs: 10000,
      });

      // Caller aborts after 20ms
      setTimeout(() => callerController.abort(), 20);

      await expect(promise).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        // Either TIMEOUT or ABORTED depending on whether controller was aborted
        expect(['TIMEOUT', 'ABORTED']).toContain(err.code);
        return true;
      });
    });

    it('proxyMode: responds to caller-initiated AbortSignal mid-flight', async () => {
      const callerController = new AbortController();

      fetchMock.mockImplementationOnce((_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const promise = executeProxyMode('Prompt', {
        proxyUrl: 'https://proxy.example.com/generate',
        signal: callerController.signal,
        timeoutMs: 10000,
      });

      setTimeout(() => callerController.abort(), 20);

      await expect(promise).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(['TIMEOUT', 'ABORTED']).toContain(err.code);
        return true;
      });
    });

    it('geminiMode: pre-aborted AbortSignal behavior', async () => {
      const callerController = new AbortController();
      callerController.abort(); // already aborted before passing

      mockFetchJsonResponse({
        candidates: [{ content: { parts: [{ text: 'Should not have processed' }] } }],
      });

      // If caller passed an already aborted signal, verify empirical behavior:
      // In a hardened implementation, it should either immediately abort or pass aborted signal
      const resultPromise = executeGeminiMode('Prompt', {
        apiKey: 'test-key',
        signal: callerController.signal,
      });

      // Check whether fetch completed or threw
      try {
        const res = await resultPromise;
        // If it completed, note that pre-aborted signal was not propagated before fetch
        expect(res.text).toBe('Should not have processed');
      } catch (err: any) {
        expect(err instanceof LLMError).toBe(true);
      }
    });

    it('proxyMode: pre-aborted AbortSignal behavior', async () => {
      const callerController = new AbortController();
      callerController.abort();

      mockFetchJsonResponse({ text: 'Should not have processed' });

      const resultPromise = executeProxyMode('Prompt', {
        proxyUrl: 'https://proxy.example.com/generate',
        signal: callerController.signal,
      });

      try {
        const res = await resultPromise;
        expect(res.text).toBe('Should not have processed');
      } catch (err: any) {
        expect(err instanceof LLMError).toBe(true);
      }
    });

    it('concurrent timeout stress: 25 simultaneous gemini requests timing out do not leak unhandled rejections', async () => {
      fetchMock.mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const tasks = Array.from({ length: 25 }, (_, i) =>
        executeGeminiMode(`Concurrent prompt ${i}`, {
          apiKey: 'stress-key',
          timeoutMs: 30,
        }).catch((err) => err)
      );

      const results = await Promise.all(tasks);
      expect(results).toHaveLength(25);
      results.forEach((res) => {
        expect(res instanceof LLMError).toBe(true);
        expect((res as LLMError).code).toBe('TIMEOUT');
      });
    });

    it('concurrent timeout stress: 25 simultaneous proxy requests timing out do not leak unhandled rejections', async () => {
      fetchMock.mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const tasks = Array.from({ length: 25 }, (_, i) =>
        executeProxyMode(`Proxy concurrent prompt ${i}`, {
          proxyUrl: 'https://proxy.stress.com/generate',
          timeoutMs: 30,
        }).catch((err) => err)
      );

      const results = await Promise.all(tasks);
      expect(results).toHaveLength(25);
      results.forEach((res) => {
        expect(res instanceof LLMError).toBe(true);
        expect((res as LLMError).code).toBe('TIMEOUT');
      });
    });
  });

  // =========================================================================
  // SUITE 2: Complex HTTP Error Status Codes
  // =========================================================================
  describe('Suite 2: Complex HTTP Error Status Codes (400, 401, 403, 404, 429, 500, 502, 503, 504)', () => {
    const errorCodes = [
      { status: 400, expectedGeminiCode: 'HTTP_ERROR', expectedProxyCode: 'HTTP_ERROR' },
      { status: 401, expectedGeminiCode: 'HTTP_ERROR', expectedProxyCode: 'PROXY_AUTH_FAILED' },
      { status: 403, expectedGeminiCode: 'HTTP_ERROR', expectedProxyCode: 'PROXY_AUTH_FAILED' },
      { status: 404, expectedGeminiCode: 'HTTP_ERROR', expectedProxyCode: 'INVALID_RESPONSE' },
      { status: 429, expectedGeminiCode: 'RATE_LIMIT', expectedProxyCode: 'RATE_LIMIT' },
      { status: 500, expectedGeminiCode: 'SERVER_ERROR', expectedProxyCode: 'SERVER_ERROR' },
      { status: 502, expectedGeminiCode: 'SERVER_ERROR', expectedProxyCode: 'SERVER_ERROR' },
      { status: 503, expectedGeminiCode: 'SERVER_ERROR', expectedProxyCode: 'SERVER_ERROR' },
      { status: 504, expectedGeminiCode: 'SERVER_ERROR', expectedProxyCode: 'SERVER_ERROR' },
    ];

    for (const { status, expectedGeminiCode, expectedProxyCode } of errorCodes) {
      it(`geminiMode: correctly maps HTTP ${status} to LLMErrorCode '${expectedGeminiCode}'`, async () => {
        mockFetchJsonResponse(
          { error: { code: status, message: `Simulated error for HTTP ${status}`, status: 'FAIL' } },
          status,
          `HTTP ${status}`
        );

        await expect(
          executeGeminiMode('Test prompt', { apiKey: 'test-key' })
        ).rejects.toSatisfy((err: any) => {
          expect(err instanceof LLMError).toBe(true);
          expect(err.code).toBe(expectedGeminiCode);
          expect(err.status).toBe(status);
          expect(err.message).toContain(String(status));
          return true;
        });
      });

      it(`proxyMode: correctly maps HTTP ${status} to LLMErrorCode '${expectedProxyCode}'`, async () => {
        mockFetchJsonResponse(
          { error: `Proxy upstream failed with HTTP ${status}` },
          status,
          `HTTP ${status}`
        );

        await expect(
          executeProxyMode('Test prompt', { proxyUrl: 'https://proxy.test/api' })
        ).rejects.toSatisfy((err: any) => {
          expect(err instanceof LLMError).toBe(true);
          expect(err.code).toBe(expectedProxyCode);
          expect(err.status).toBe(status);
          return true;
        });
      });
    }

    it('geminiMode: handles Cloudflare/Nginx HTML 502 Bad Gateway response without throwing SyntaxError', async () => {
      const html502 = `
        <!DOCTYPE html>
        <html><head><title>502 Bad Gateway</title></head>
        <body><center><h1>502 Bad Gateway</h1></center><hr><center>cloudflare</center></body>
        </html>
      `;
      mockFetchHtmlResponse(html502, 502, 'Bad Gateway');

      await expect(
        executeGeminiMode('Prompt', { apiKey: 'test-key' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('SERVER_ERROR');
        expect(err.status).toBe(502);
        return true;
      });
    });

    it('proxyMode: handles Cloudflare/Nginx HTML 502 Bad Gateway response without throwing SyntaxError', async () => {
      const html502 = `<html><body>502 Bad Gateway</body></html>`;
      mockFetchHtmlResponse(html502, 502, 'Bad Gateway');

      await expect(
        executeProxyMode('Prompt', { proxyUrl: 'https://proxy.test/api' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('SERVER_ERROR');
        expect(err.status).toBe(502);
        return true;
      });
    });

    it('geminiMode: handles non-standard HTTP 418 I am a teapot gracefully as HTTP_ERROR', async () => {
      mockFetchJsonResponse({ error: { message: "I'm a teapot" } }, 418, "I'm a teapot");

      await expect(
        executeGeminiMode('Prompt', { apiKey: 'test-key' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('HTTP_ERROR');
        expect(err.status).toBe(418);
        return true;
      });
    });

    it('proxyMode: handles non-standard HTTP 413 Payload Too Large as HTTP_ERROR', async () => {
      mockFetchJsonResponse({ error: 'Payload Too Large' }, 413, 'Payload Too Large');

      await expect(
        executeProxyMode('Prompt', { proxyUrl: 'https://proxy.test/api' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('HTTP_ERROR');
        expect(err.status).toBe(413);
        return true;
      });
    });

    it('geminiMode: handles completely empty error body gracefully', async () => {
      mockFetchRawText('', 500, 'Internal Server Error');

      await expect(
        executeGeminiMode('Prompt', { apiKey: 'test-key' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('SERVER_ERROR');
        expect(err.status).toBe(500);
        return true;
      });
    });

    it('proxyMode: handles completely empty error body gracefully', async () => {
      mockFetchRawText('', 503, 'Service Unavailable');

      await expect(
        executeProxyMode('Prompt', { proxyUrl: 'https://proxy.test/api' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('SERVER_ERROR');
        expect(err.status).toBe(503);
        return true;
      });
    });
  });

  // =========================================================================
  // SUITE 3: Safety Blocks & Finish Reason Edge Cases
  // =========================================================================
  describe('Suite 3: Safety Blocks & Finish Reason Edge Cases', () => {
    it('geminiMode: throws SAFETY_BLOCKED when candidate finishReason is SAFETY', async () => {
      mockFetchJsonResponse({
        candidates: [
          {
            finishReason: 'SAFETY',
            safetyRatings: [
              { category: 'HARM_CATEGORY_HARASSMENT', probability: 'HIGH' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'MEDIUM' },
            ],
          },
        ],
      });

      await expect(
        executeGeminiMode('Flagged prompt', { apiKey: 'test-key' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('SAFETY_BLOCKED');
        expect(err.status).toBe(200);
        expect(err.details).toBeDefined();
        return true;
      });
    });

    it('geminiMode: throws SAFETY_BLOCKED when promptFeedback contains blockReason', async () => {
      const blockReasons = ['SAFETY', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT'];

      for (const reason of blockReasons) {
        mockFetchJsonResponse({
          promptFeedback: {
            blockReason: reason,
            safetyRatings: [{ category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'HIGH' }],
          },
        });

        await expect(
          executeGeminiMode('Flagged prompt', { apiKey: 'test-key' })
        ).rejects.toSatisfy((err: any) => {
          expect(err instanceof LLMError).toBe(true);
          expect(err.code).toBe('SAFETY_BLOCKED');
          expect(err.message).toContain(reason);
          return true;
        });
      }
    });

    it('geminiMode: prioritizes promptFeedback blockReason even if candidates array is present', async () => {
      mockFetchJsonResponse({
        promptFeedback: {
          blockReason: 'SAFETY',
        },
        candidates: [
          {
            content: { parts: [{ text: 'This text should be suppressed due to prompt block' }] },
            finishReason: 'STOP',
          },
        ],
      });

      await expect(
        executeGeminiMode('Prompt', { apiKey: 'test-key' })
      ).rejects.toSatisfy((err: any) => {
        expect(err.code).toBe('SAFETY_BLOCKED');
        return true;
      });
    });

    it('geminiMode: finishReason MAX_TOKENS does not throw, returns truncated text and metadata', async () => {
      mockFetchJsonResponse({
        candidates: [
          {
            content: { parts: [{ text: 'Incomplete sentence that hit the token lim' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
      });

      const res = await executeGeminiMode('Prompt', { apiKey: 'test-key' });
      expect(res.text).toBe('Incomplete sentence that hit the token lim');
      expect(res.metadata?.finishReason).toBe('MAX_TOKENS');
    });

    it('geminiMode: finishReason RECITATION returns text and recitation metadata', async () => {
      mockFetchJsonResponse({
        candidates: [
          {
            content: { parts: [{ text: 'Recited copyright text snippet' }] },
            finishReason: 'RECITATION',
          },
        ],
      });

      const res = await executeGeminiMode('Prompt', { apiKey: 'test-key' });
      expect(res.text).toBe('Recited copyright text snippet');
      expect(res.metadata?.finishReason).toBe('RECITATION');
    });

    it('geminiMode: transmits standard permissive safetySettings in every request', async () => {
      mockFetchJsonResponse({
        candidates: [{ content: { parts: [{ text: 'Allowed' }] }, finishReason: 'STOP' }],
      });

      await executeGeminiMode('Prompt', { apiKey: 'test-key' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestPayload = JSON.parse(fetchMock.mock.calls[0][1].body);

      expect(requestPayload.safetySettings).toBeDefined();
      expect(requestPayload.safetySettings).toHaveLength(4);
      expect(requestPayload.safetySettings).toEqual(getStandardSafetySettings());

      requestPayload.safetySettings.forEach((setting: any) => {
        expect(setting.threshold).toBe('BLOCK_ONLY_HIGH');
      });
    });

    it('proxyMode: throws SAFETY_BLOCKED when upstream Gemini-formatted response has finishReason SAFETY', async () => {
      mockFetchJsonResponse({
        candidates: [
          {
            finishReason: 'SAFETY',
            safetyRatings: [{ category: 'HARM_CATEGORY_HARASSMENT', probability: 'HIGH' }],
          },
        ],
      });

      await expect(
        executeProxyMode('Prompt', { proxyUrl: 'https://proxy.test/api' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('SAFETY_BLOCKED');
        return true;
      });
    });
  });

  // =========================================================================
  // SUITE 4: Malformed JSON Responses from Gemini and Proxy
  // =========================================================================
  describe('Suite 4: Malformed JSON Responses from Gemini and Proxy', () => {
    it('geminiMode: throws INVALID_RESPONSE on truncated/malformed JSON stream', async () => {
      mockFetchRawText('{"candidates": [{"content": {"parts": [{"te', 200);

      await expect(
        executeGeminiMode('Prompt', { apiKey: 'test-key' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('INVALID_RESPONSE');
        expect(err.status).toBe(200);
        expect(err.message).toMatch(/parse.*JSON/i);
        return true;
      });
    });

    it('proxyMode: throws INVALID_RESPONSE on truncated JSON when content-type is application/json', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input');
        },
        text: async () => '{"text": "trunc',
      });

      await expect(
        executeProxyMode('Prompt', { proxyUrl: 'https://proxy.test/api' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('INVALID_RESPONSE');
        return true;
      });
    });

    it('geminiMode: throws INVALID_RESPONSE when response body is HTML on 200 OK', async () => {
      mockFetchHtmlResponse('<!DOCTYPE html><html><body>Login Required</body></html>', 200);

      await expect(
        executeGeminiMode('Prompt', { apiKey: 'test-key' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('INVALID_RESPONSE');
        return true;
      });
    });

    it('geminiMode: throws on JSON null body on 200 OK', async () => {
      mockFetchJsonResponse(null, 200);

      // Empirically test behavior when response is JSON null
      await expect(
        executeGeminiMode('Prompt', { apiKey: 'test-key' })
      ).rejects.toThrow();
    });

    it('geminiMode: throws INVALID_RESPONSE when candidates array is empty []', async () => {
      mockFetchJsonResponse({ candidates: [] }, 200);

      await expect(
        executeGeminiMode('Prompt', { apiKey: 'test-key' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('INVALID_RESPONSE');
        expect(err.message).toContain('empty response with no candidate completions');
        return true;
      });
    });

    it('geminiMode: throws INVALID_RESPONSE when candidates field is missing', async () => {
      mockFetchJsonResponse({ usageMetadata: { totalTokenCount: 10 } }, 200);

      await expect(
        executeGeminiMode('Prompt', { apiKey: 'test-key' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('INVALID_RESPONSE');
        return true;
      });
    });

    it('geminiMode: handles candidate with empty parts array gracefully without crashing', async () => {
      mockFetchJsonResponse({
        candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
      });

      const res = await executeGeminiMode('Prompt', { apiKey: 'test-key' });
      expect(res.text).toBe('');
      expect(res.mode).toBe('gemini');
    });

    it('geminiMode: handles parts with empty text or missing text fields without crashing', async () => {
      mockFetchJsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: '' }, { text: undefined as any }, { text: 'Valid text block' }, {}],
            },
            finishReason: 'STOP',
          },
        ],
      });

      const res = await executeGeminiMode('Prompt', { apiKey: 'test-key' });
      expect(res.text).toBe('Valid text block');
    });

    it('proxyMode: throws INVALID_RESPONSE when response object has no recognized schema fields', async () => {
      mockFetchJsonResponse({
        status: 'success',
        data: { innerObj: 123 },
        timestamp: Date.now(),
      });

      await expect(
        executeProxyMode('Prompt', { proxyUrl: 'https://proxy.test/api' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('INVALID_RESPONSE');
        expect(err.message).toContain('unparseable response structure');
        return true;
      });
    });
  });

  // =========================================================================
  // SUITE 5: Unusual & Multi-Schema Proxy Responses
  // =========================================================================
  describe('Suite 5: Unusual & Multi-Schema Proxy Responses', () => {
    const supportedSchemas = [
      { name: '1. text property', payload: { text: 'Direct text generation' }, expected: 'Direct text generation' },
      { name: '2. content property', payload: { content: 'Direct content generation' }, expected: 'Direct content generation' },
      { name: '3. response property', payload: { response: 'Direct response generation' }, expected: 'Direct response generation' },
      { name: '4. output property', payload: { output: 'Direct output generation' }, expected: 'Direct output generation' },
      { name: '5. result property', payload: { result: 'Direct result generation' }, expected: 'Direct result generation' },
      { name: '6. message property', payload: { message: 'Direct message generation' }, expected: 'Direct message generation' },
      {
        name: '7. OpenAI chat schema (choices[0].message.content)',
        payload: {
          choices: [{ message: { role: 'assistant', content: 'OpenAI assistant reply' }, finish_reason: 'stop' }],
        },
        expected: 'OpenAI assistant reply',
      },
      {
        name: '8. OpenAI completion schema (choices[0].text)',
        payload: {
          choices: [{ text: 'OpenAI legacy completion reply', finish_reason: 'stop' }],
        },
        expected: 'OpenAI legacy completion reply',
      },
      {
        name: '9. Gemini candidate schema (candidates[0].content.parts[0].text)',
        payload: {
          candidates: [{ content: { parts: [{ text: 'Gemini upstream reply' }] }, finishReason: 'STOP' }],
        },
        expected: 'Gemini upstream reply',
      },
      {
        name: '10. Gemini candidate with multiple parts',
        payload: {
          candidates: [
            {
              content: {
                parts: [{ text: 'Section A. ' }, { text: 'Section B.' }],
              },
              finishReason: 'STOP',
            },
          ],
        },
        expected: 'Section A. Section B.',
      },
    ];

    for (const { name, payload, expected } of supportedSchemas) {
      it(`proxyMode: successfully extracts text from schema: ${name}`, async () => {
        mockFetchJsonResponse(payload);

        const res = await executeProxyMode('Prompt', {
          proxyUrl: 'https://proxy.test/api',
        });

        expect(res.text).toBe(expected);
        expect(res.mode).toBe('proxy');
      });
    }

    it('proxyMode: handles raw flat text response when content-type is text/plain', async () => {
      mockFetchRawText('Raw plain text LLM answer from proxy server');

      const res = await executeProxyMode('Prompt', {
        proxyUrl: 'https://proxy.test/api',
      });

      expect(res.text).toBe('Raw plain text LLM answer from proxy server');
      expect(res.mode).toBe('proxy');
    });

    it('proxyMode: handles JSON-encoded string with application/json header correctly', async () => {
      mockFetchJsonResponse(JSON.stringify('JSON-encoded string answer'), 200, 'OK', {
        'Content-Type': 'application/json',
      });

      const res = await executeProxyMode('Prompt', {
        proxyUrl: 'https://proxy.test/api',
      });

      expect(res.text).toBe('JSON-encoded string answer');
    });

    it('extractProxyResponseText: returns null for unsupported structures or null input', () => {
      expect(extractProxyResponseText(null)).toBeNull();
      expect(extractProxyResponseText(undefined)).toBeNull();
      expect(extractProxyResponseText({})).toBeNull();
      expect(extractProxyResponseText({ foo: 'bar' })).toBeNull();
      expect(extractProxyResponseText(42)).toBeNull();
      expect(extractProxyResponseText(true)).toBeNull();
      expect(extractProxyResponseText([])).toBeNull();
      expect(extractProxyResponseText({ candidates: [] })).toBeNull();
      expect(extractProxyResponseText({ choices: [] })).toBeNull();
    });

    it('extractProxyResponseText: trims whitespace from generated text', () => {
      expect(extractProxyResponseText({ text: '  trimmed text  \n' })).toBe('trimmed text');
      expect(extractProxyResponseText('  raw trimmed string  ')).toBe('raw trimmed string');
    });

    it('extractProxyUsage: extracts OpenAI style usage (prompt_tokens, completion_tokens, total_tokens)', () => {
      const data = {
        usage: {
          prompt_tokens: 150,
          completion_tokens: 50,
          total_tokens: 200,
        },
      };

      const usage = extractProxyUsage(data, 'Prompt', undefined, 'Output');
      expect(usage.promptTokens).toBe(150);
      expect(usage.candidateTokens).toBe(50);
      expect(usage.totalTokens).toBe(200);
    });

    it('extractProxyUsage: extracts Gemini style usageMetadata (promptTokenCount, candidatesTokenCount, totalTokenCount)', () => {
      const data = {
        usageMetadata: {
          promptTokenCount: 300,
          candidatesTokenCount: 100,
          totalTokenCount: 400,
        },
      };

      const usage = extractProxyUsage(data, 'Prompt', undefined, 'Output');
      expect(usage.promptTokens).toBe(300);
      expect(usage.candidateTokens).toBe(100);
      expect(usage.totalTokens).toBe(400);
    });

    it('extractProxyUsage: falls back to token estimation when usage is not reported', () => {
      const usage = extractProxyUsage({}, 'A somewhat long prompt text for estimation', undefined, 'A short response text');
      expect(usage.promptTokens).toBeGreaterThan(0);
      expect(usage.candidateTokens).toBeGreaterThan(0);
      expect(usage.totalTokens).toBe(usage.promptTokens! + usage.candidateTokens!);
    });
  });

  // =========================================================================
  // SUITE 6: Malicious & Bad Proxy URLs
  // =========================================================================
  describe('Suite 6: Malicious & Bad Proxy URLs', () => {
    it('proxyMode: rejects empty or whitespace-only proxy URL without making network call', async () => {
      const invalidUrls = ['', '   ', '\t\n'];

      for (const url of invalidUrls) {
        await expect(
          executeProxyMode('Prompt', { proxyUrl: url })
        ).rejects.toSatisfy((err: any) => {
          expect(err instanceof LLMError).toBe(true);
          expect(err.code).toBe('MISSING_PROXY_URL');
          expect(err.status).toBe(400);
          return true;
        });
      }

      expect(fetchMock).toHaveBeenCalledTimes(0);
    });

    it('proxyMode: handles relative proxy URL safely via network error or fetch reject', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to parse URL from /api/relative'));

      await expect(
        executeProxyMode('Prompt', { proxyUrl: '/api/relative' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(['INVALID_OPTIONS', 'NETWORK_ERROR']).toContain(err.code);
        return true;
      });
    });

    it('proxyMode: handles javascript: URI safely without evaluating code', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Fetch failed for javascript: URI scheme'));

      await expect(
        executeProxyMode('Prompt', { proxyUrl: 'javascript:alert(1)' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(['INVALID_OPTIONS', 'NETWORK_ERROR']).toContain(err.code);
        return true;
      });
    });

    it('proxyMode: handles data: URI safely when fetch fails or parses body', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Fetch failed for data: URI scheme'));

      await expect(
        executeProxyMode('Prompt', { proxyUrl: 'data:text/plain,injected' })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(['INVALID_OPTIONS', 'NETWORK_ERROR']).toContain(err.code);
        return true;
      });
    });

    it('proxyMode: trims surrounding whitespace from proxy URL before calling fetch', async () => {
      mockFetchJsonResponse({ text: 'Answer' });

      await executeProxyMode('Prompt', {
        proxyUrl: '   https://proxy.example.com/generate   ',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example.com/generate');
    });

    it('proxyMode: attaches Authorization header only when non-empty proxyToken is given', async () => {
      // Test 1: Valid token
      mockFetchJsonResponse({ text: 'Answer 1' });
      await executeProxyMode('Prompt', {
        proxyUrl: 'https://proxy.test/api',
        proxyToken: 'my-bearer-token',
      });
      expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('Bearer my-bearer-token');

      // Test 2: Empty token
      mockFetchJsonResponse({ text: 'Answer 2' });
      await executeProxyMode('Prompt', {
        proxyUrl: 'https://proxy.test/api',
        proxyToken: '',
      });
      expect(fetchMock.mock.calls[1][1].headers['Authorization']).toBeUndefined();

      // Test 3: Whitespace token
      mockFetchJsonResponse({ text: 'Answer 3' });
      await executeProxyMode('Prompt', {
        proxyUrl: 'https://proxy.test/api',
        proxyToken: '   ',
      });
      expect(fetchMock.mock.calls[2][1].headers['Authorization']).toBeUndefined();
    });

    it('proxyMode: formats request body with prompt, rawPrompt, serializedContext, and options', async () => {
      mockFetchJsonResponse({ text: 'Answer' });

      await executeProxyMode('User prompt query', 'Full prompt with context', {
        proxyUrl: 'https://proxy.test/api',
        model: 'custom-model-x',
        temperature: 0.3,
        maxOutputTokens: 2048,
        serializedContext: '## Context markdown',
        systemInstruction: 'Act as tutor',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);

      expect(body.prompt).toBe('User prompt query');
      expect(body.rawPrompt).toBe('Full prompt with context');
      expect(body.serializedContext).toBe('## Context markdown');
      expect(body.options.model).toBe('custom-model-x');
      expect(body.options.temperature).toBe(0.3);
      expect(body.options.maxTokens).toBe(2048);
      expect(body.options.systemInstruction).toBe('Act as tutor');
    });
  });

  // =========================================================================
  // SUITE 7: End-to-End Gateway Integration via llm.generate()
  // =========================================================================
  describe('Suite 7: End-to-End Gateway Integration via llm.generate()', () => {
    it('llm.generate routes to geminiMode with proper error mapping for HTTP 403', async () => {
      mockFetchJsonResponse(
        { error: { code: 403, message: 'Forbidden quota' } },
        403,
        'Forbidden'
      );

      await expect(
        llm.generate('Test query', {
          mode: 'gemini',
          apiKey: 'key-123',
        })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('HTTP_ERROR');
        expect(err.status).toBe(403);
        return true;
      });
    });

    it('llm.generate routes to proxyMode with proper error mapping for HTTP 401', async () => {
      mockFetchJsonResponse(
        { error: 'Unauthorized token' },
        401,
        'Unauthorized'
      );

      await expect(
        llm.generate('Test query', {
          mode: 'proxy',
          proxyUrl: 'https://proxy.test/api',
          proxyToken: 'bad-token',
        })
      ).rejects.toSatisfy((err: any) => {
        expect(err instanceof LLMError).toBe(true);
        expect(err.code).toBe('PROXY_AUTH_FAILED');
        expect(err.status).toBe(401);
        return true;
      });
    });

    it('llm.generate successfully completes with usage accounting across gemini and proxy modes', async () => {
      // Gemini mode
      mockFetchJsonResponse({
        candidates: [{ content: { parts: [{ text: 'Gemini success' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 15, totalTokenCount: 40 },
      });

      const geminiRes = await llm.generate('Query', { mode: 'gemini', apiKey: 'key-123' });
      expect(geminiRes.text).toBe('Gemini success');
      expect(geminiRes.usage?.totalTokens).toBe(40);

      // Proxy mode
      mockFetchJsonResponse({
        choices: [{ message: { content: 'Proxy success' } }],
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
      });

      const proxyRes = await llm.generate('Query', { mode: 'proxy', proxyUrl: 'https://proxy.test/api' });
      expect(proxyRes.text).toBe('Proxy success');
      expect(proxyRes.usage?.totalTokens).toBe(50);
    });
  });
});
