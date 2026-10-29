import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { dayKey, monthKey, secondsUntilNextDay } from '../src/period.js';
import { Pricing } from '../src/pricing.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import { MistralProvider } from '../src/providers/mistral.js';
import { ProviderError, type FetchLike, type ProviderRequest } from '../src/providers/types.js';

const req: ProviderRequest = {
  system: 'SYS',
  turns: [
    { role: 'user', text: 'ctx' },
    { role: 'model', text: 'Understood.' },
    { role: 'user', text: 'question' },
  ],
  maxOutputTokens: 100,
  temperature: 0.15,
};

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  };
  return { impl, calls };
}

describe('Gemini adapter', () => {
  it('sends system prompt, turns and key header; counts thinking tokens as output', async () => {
    const m = mockFetch(200, {
      candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'world' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 200, totalTokenCount: 1250 },
    });
    const p = new GeminiProvider({ apiKey: 'KEY', model: 'gemini-3.1-flash-lite', fetchImpl: m.impl, thinkingBudget: 0 });
    const out = await p.generate(req);
    expect(out).toEqual({ text: 'Hello world', inputTokens: 1000, outputTokens: 250 });
    const call = m.calls[0];
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent');
    expect((call.init.headers as any)['x-goog-api-key']).toBe('KEY');
    expect(call.url).not.toContain('KEY'); // key never in the URL
    const body = JSON.parse(call.init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe('SYS');
    expect(body.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.generationConfig).toMatchObject({ maxOutputTokens: 100, thinkingConfig: { thinkingBudget: 0 } });
  });

  it('maps 429 to RATE_LIMITED with retry-after and 500 to UPSTREAM_ERROR', async () => {
    const p429 = new GeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: mockFetch(429, 'slow', { 'retry-after': '7' }).impl });
    await expect(p429.generate(req)).rejects.toMatchObject({ kind: 'RATE_LIMITED', retryAfterSeconds: 7 });
    const p500 = new GeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: mockFetch(500, 'oops').impl });
    await expect(p500.generate(req)).rejects.toMatchObject({ kind: 'UPSTREAM_ERROR', status: 500 });
  });

  it('treats blocked or empty answers as errors', async () => {
    const blocked = new GeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: mockFetch(200, { promptFeedback: { blockReason: 'SAFETY' } }).impl });
    await expect(blocked.generate(req)).rejects.toBeInstanceOf(ProviderError);
    const empty = new GeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: mockFetch(200, { candidates: [{ finishReason: 'MAX_TOKENS' }] }).impl });
    await expect(empty.generate(req)).rejects.toThrow(/Empty response/);
  });

  it('turns network failures into UPSTREAM_ERROR', async () => {
    const p = new GeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    await expect(p.generate(req)).rejects.toMatchObject({ kind: 'UPSTREAM_ERROR' });
  });
});

describe('Anthropic adapter', () => {
  it('uses the messages API shape and sums cached input tokens', async () => {
    const m = mockFetch(200, {
      content: [{ type: 'text', text: 'Answer' }],
      usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 30 },
    });
    const out = await new AnthropicProvider({ apiKey: 'KEY', model: 'claude-haiku-5-5', fetchImpl: m.impl }).generate(req);
    expect(out).toEqual({ text: 'Answer', inputTokens: 1000, outputTokens: 30 });
    expect(m.calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    const headers = m.calls[0].init.headers as any;
    expect(headers['x-api-key']).toBe('KEY');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(m.calls[0].init.body as string);
    expect(body.system).toBe('SYS');
    expect(body.messages.map((x: any) => x.role)).toEqual(['user', 'assistant', 'user']);
  });
});

describe('Mistral adapter', () => {
  it('uses chat completions with the system prompt first and the EU base URL when set', async () => {
    const m = mockFetch(200, { choices: [{ message: { content: 'Réponse' } }], usage: { prompt_tokens: 500, completion_tokens: 20 } });
    const out = await new MistralProvider({ apiKey: 'KEY', model: 'mistral-small-latest', baseUrl: 'https://api.eu.mistral.ai', fetchImpl: m.impl }).generate(req);
    expect(out).toEqual({ text: 'Réponse', inputTokens: 500, outputTokens: 20 });
    expect(m.calls[0].url).toBe('https://api.eu.mistral.ai/v1/chat/completions');
    const body = JSON.parse(m.calls[0].init.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(body.messages.map((x: any) => x.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });
});

describe('pricing', () => {
  const cfg = (model: string, extra: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', MODEL: model, ...extra } as NodeJS.ProcessEnv);

  it('computes integer micro-EUR from USD per 1M tokens', () => {
    const p = new Pricing(cfg('gemini-3.1-flash-lite', { USD_TO_EUR: '1' }));
    // 1M input tokens at $0.25 = 0.25 EUR = 250,000 micro-EUR; 1M output at $1.50
    expect(p.costMicroEur(1_000_000, 0)).toBe(250_000);
    expect(p.costMicroEur(0, 1_000_000)).toBe(1_500_000);
    expect(Number.isInteger(p.costMicroEur(12345, 678))).toBe(true);
  });

  it('applies the long-prompt tier of Claude Haiku above 100k tokens', () => {
    const p = new Pricing(cfg('claude-haiku-5-5', { USD_TO_EUR: '1' }));
    expect(p.costMicroEur(100_000, 0)).toBe(10_000);
    expect(p.costMicroEur(100_001, 0)).toBe(Math.ceil(100_001 * 0.5));
  });

  it('refuses to run with an unpriced model unless prices are given', () => {
    expect(() => new Pricing(cfg('some-new-model'))).toThrow(/No price known/);
    expect(new Pricing(cfg('some-new-model', { PRICE_IN_USD_PER_M: '1', PRICE_OUT_USD_PER_M: '2', USD_TO_EUR: '1' })).costMicroEur(1_000_000, 0)).toBe(1_000_000);
  });
});

describe('time zone periods', () => {
  it('uses Amsterdam midnight, not UTC', () => {
    // 2026-11-02 23:30 UTC is already 2026-11-03 00:30 in Amsterdam (CET, UTC+1)
    const ts = Date.parse('2026-11-02T23:30:00Z');
    expect(dayKey(ts, 'Europe/Amsterdam')).toBe('2026-11-03');
    expect(dayKey(ts, 'UTC')).toBe('2026-11-02');
    expect(monthKey(Date.parse('2026-11-30T23:30:00Z'), 'Europe/Amsterdam')).toBe('2026-12');
  });

  it('computes seconds until the next local midnight', () => {
    const ts = Date.parse('2026-11-02T22:00:00Z'); // 23:00 Amsterdam
    expect(secondsUntilNextDay(ts, 'Europe/Amsterdam')).toBe(3600);
  });
});

describe('config safety', () => {
  it('refuses unsafe production configuration', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/Unsafe production configuration/);
    const ok = loadConfig({
      NODE_ENV: 'production',
      AUTH_SECRET: 'x'.repeat(40),
      PROVIDER: 'gemini',
      PROVIDER_API_KEY: 'k',
      SMTP_URL: 'smtp://u:p@mail.example.com:587',
      PUBLIC_URL: 'https://api.example.com',
    } as NodeJS.ProcessEnv);
    expect(ok.provider).toBe('gemini');
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(40), PROVIDER: 'fake', SMTP_URL: 's', PUBLIC_URL: 'https://a.b' } as NodeJS.ProcessEnv)).toThrow(/fake/);
  });
});
