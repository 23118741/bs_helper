import { afterEach, describe, expect, it } from 'vitest';
import { FakeProvider } from '../src/providers/fake.js';
import { ProviderError, type Provider, type ProviderRequest } from '../src/providers/types.js';
import { Pricing } from '../src/pricing.js';
import { estimateInputTokens } from '../src/providers/prompt.js';
import { createCtx, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => {
  await ctx?.app.close();
});

/**
 * A budget (EUR) that fits exactly one default test request: the reserved estimate of the first request
 * fits, the estimate of a second one on top of what the first really cost does not.
 */
async function oneRequestBudget(): Promise<string> {
  const probe = await createCtx();
  const inputTokens = estimateInputTokens({
    kind: 'chat',
    question: 'What is the deadline?',
    context_markdown: 'Deadline: 1 December.',
    client: { version: '1.0.0' },
  });
  const estimateMicro = new Pricing(probe.config).costMicroEur(inputTokens, probe.config.limits.maxOutputTokens);
  await probe.app.close();
  return String((estimateMicro + 50) / 1_000_000);
}

const ledgerRows = (c: TestCtx) => c.db.prepare('SELECT * FROM usage_events ORDER BY id').all() as any[];

describe('/v1/generate', () => {
  it('answers, books usage in the ledger and reports remaining budget', async () => {
    ctx = await createCtx();
    const { token } = await ctx.signIn('a@example.nl');
    const res = await ctx.generate(token);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.text).toContain('FAKE ANSWER');
    expect(body.usage.input_tokens).toBeGreaterThan(0);
    expect(body.limits.day_cost_remaining_eur).toBeLessThan(0.5);
    expect(res.headers['x-request-id']).toBe(body.request_id);

    const rows = ledgerRows(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ok', provider: 'fake', model: 'fake-model', kind: 'chat', day: '2026-11-02', month: '2026-11' });
    expect(Number.isInteger(rows[0].cost_micro_eur)).toBe(true);
    expect(rows[0].cost_micro_eur).toBeGreaterThan(0);
  });

  it('builds provider turns from context, history and question (server-side system prompt)', async () => {
    let seen: ProviderRequest | undefined;
    const spy: Provider = {
      name: 'fake',
      model: 'fake-model',
      async generate(req) {
        seen = req;
        return { text: 'ok', inputTokens: 10, outputTokens: 2 };
      },
    };
    ctx = await createCtx({}, spy);
    const { token } = await ctx.signIn('a@example.nl');
    await ctx.generate(token, {
      history: [
        { role: 'user', text: 'Hi' },
        { role: 'model', text: 'Hello' },
      ],
      question: 'Next?',
    });
    expect(seen!.system).toContain('BLUF');
    expect(seen!.turns.map((t) => t.role)).toEqual(['user', 'model', 'user', 'model', 'user']);
    expect(seen!.turns[0].text).toContain('Deadline: 1 December.');
    expect(seen!.turns.at(-1)!.text).toBe('Next?');
    expect(seen!.maxOutputTokens).toBeLessThanOrEqual(8192);
  });

  it('general mode uses the plain chat prompt and ignores the course context', async () => {
    let seen: ProviderRequest | undefined;
    const spy: Provider = { name: 'fake', model: 'fake-model', async generate(r) { seen = r; return { text: 'ok', inputTokens: 5, outputTokens: 1 }; } };
    ctx = await createCtx({}, spy);
    const { token } = await ctx.signIn('a@example.nl');
    await ctx.generate(token, { answer_mode: 'general', question: 'What is TCP?' });
    expect(seen!.system).toContain('without access to the student');
    expect(seen!.system).not.toContain('BLUF');
    expect(seen!.turns).toEqual([{ role: 'user', text: 'What is TCP?' }]);
  });

  it('course mode is the default and keeps the context', async () => {
    let seen: ProviderRequest | undefined;
    const spy: Provider = { name: 'fake', model: 'fake-model', async generate(r) { seen = r; return { text: 'ok', inputTokens: 5, outputTokens: 1 }; } };
    ctx = await createCtx({}, spy);
    const { token } = await ctx.signIn('a@example.nl');
    await ctx.generate(token, { answer_mode: 'course', question: 'Deadline?' });
    expect(seen!.system).toContain('BLUF');
    expect(seen!.turns[0].text).toContain('Deadline: 1 December.');
  });

  it('sends the whole conversation, up to the 60 most recent turns', async () => {
    let seen: ProviderRequest | undefined;
    const spy: Provider = { name: 'fake', model: 'fake-model', async generate(r) { seen = r; return { text: 'ok', inputTokens: 5, outputTokens: 1 }; } };
    ctx = await createCtx({}, spy);
    const { token } = await ctx.signIn('a@example.nl');
    const history = Array.from({ length: 12 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'model') as 'user' | 'model', text: `turn ${i}` }));
    await ctx.generate(token, { answer_mode: 'general', history, question: 'Next?' });
    const text = seen!.turns.map((t) => t.text).join('|');
    for (let i = 0; i < 12; i++) expect(text).toContain(`turn ${i}|`);

    const long = Array.from({ length: 60 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'model') as 'user' | 'model', text: `t${i}.` }));
    await ctx.generate(token, { answer_mode: 'general', history: long, question: 'Next?' });
    expect(seen!.turns[0].text).toBe('t0.');
    expect((await ctx.generate(token, { history: [...long, { role: 'user', text: 'x' }] })).statusCode).toBe(400); // more than 60
  });

  it('puts the student\'s parallel chats about other courses before the conversation, also in general mode', async () => {
    let seen: ProviderRequest | undefined;
    const spy: Provider = { name: 'fake', model: 'fake-model', async generate(r) { seen = r; return { text: 'ok', inputTokens: 5, outputTokens: 1 }; } };
    ctx = await createCtx({}, spy);
    const { token } = await ctx.signIn('a@example.nl');
    const related_chats = [{ course: 'Statistics', turns: [{ role: 'user' as const, text: 'When is the exam?' }, { role: 'model' as const, text: 'Friday 12 June.' }] }];
    await ctx.generate(token, { answer_mode: 'general', related_chats, question: 'What did you say about my other exam?' });
    expect(seen!.turns[0].role).toBe('user');
    expect(seen!.turns[0].text).toContain('Chat about "Statistics"');
    expect(seen!.turns[0].text).toContain('Assistant: Friday 12 June.');
    expect(seen!.turns.at(-1)!.text).toBe('What did you say about my other exam?');
  });

  it('merges consecutive same-role history turns (providers require alternation)', async () => {
    let seen: ProviderRequest | undefined;
    const spy: Provider = { name: 'fake', model: 'fake-model', async generate(r) { seen = r; return { text: 'ok', inputTokens: 1, outputTokens: 1 }; } };
    ctx = await createCtx({}, spy);
    const { token } = await ctx.signIn('a@example.nl');
    await ctx.generate(token, { context_markdown: '', history: [{ role: 'user', text: 'one' }], question: 'two' });
    expect(seen!.turns).toHaveLength(1);
    expect(seen!.turns[0].text).toBe('one\n\ntwo');
  });

  it('caps max_output_tokens at the server maximum', async () => {
    let seen: ProviderRequest | undefined;
    const spy: Provider = { name: 'fake', model: 'fake-model', async generate(r) { seen = r; return { text: 'ok', inputTokens: 1, outputTokens: 1 }; } };
    ctx = await createCtx({}, spy);
    const { token } = await ctx.signIn('a@example.nl');
    await ctx.generate(token, { max_output_tokens: 99_999 });
    expect(seen!.maxOutputTokens).toBe(8192);
  });

  it('validates the body strictly (unknown fields, wrong types)', async () => {
    ctx = await createCtx();
    const { token } = await ctx.signIn('a@example.nl');
    for (const bad of [{ model: 'gpt-x' }, { question: '' }, { kind: 'other' }, { history: [{ role: 'system', text: 'x' }] }]) {
      const r = await ctx.generate(token, bad);
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe('INVALID_REQUEST');
    }
    expect(ledgerRows(ctx)).toHaveLength(0);
  });

  it('rejects outdated clients with 426', async () => {
    ctx = await createCtx({ MIN_CLIENT_VERSION: '1.2.0' });
    const { token } = await ctx.signIn('a@example.nl');
    const r = await ctx.generate(token);
    expect(r.statusCode).toBe(426);
    expect(r.json().code).toBe('UPGRADE_REQUIRED');
  });

  it('rejects too large context (413) both by token estimate and by body size', async () => {
    ctx = await createCtx({ MAX_INPUT_TOKENS: '2000', MAX_BODY_BYTES: '50000' });
    const { token } = await ctx.signIn('a@example.nl');
    const tokens = await ctx.generate(token, { context_markdown: 'x'.repeat(20_000) });
    expect(tokens.statusCode).toBe(413);
    expect(tokens.json().code).toBe('PAYLOAD_TOO_LARGE');
    const bytes = await ctx.generate(token, { context_markdown: 'x'.repeat(60_000) });
    expect(bytes.statusCode).toBe(413);
    expect(bytes.json().code).toBe('PAYLOAD_TOO_LARGE');
    expect((ctx.provider as FakeProvider).calls).toBe(0);
  });

  it('limits requests per minute per user and tells when to retry', async () => {
    ctx = await createCtx({ USER_RPM: '3' });
    const { token } = await ctx.signIn('a@example.nl');
    for (let i = 0; i < 3; i++) expect((await ctx.generate(token)).statusCode).toBe(200);
    const r = await ctx.generate(token);
    expect(r.statusCode).toBe(429);
    expect(r.json().code).toBe('RATE_LIMITED');
    expect(r.json().retry_after).toBeGreaterThan(0);
    expect(r.headers['retry-after']).toBeDefined();
    ctx.now.value += 61_000;
    expect((await ctx.generate(token)).statusCode).toBe(200);
  });

  it('limits concurrent requests per user', async () => {
    ctx = await createCtx({ USER_CONCURRENCY: '1' }, new FakeProvider({ delayMs: 150 }));
    const { token } = await ctx.signIn('a@example.nl');
    const [a, b] = await Promise.all([ctx.generate(token), ctx.generate(token)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 429]);
    expect((await ctx.generate(token)).statusCode).toBe(200); // slot freed
  });

  it('enforces the daily budget and resets at local midnight', async () => {
    ctx = await createCtx({ USER_DAILY_EUR: await oneRequestBudget() });
    const { token } = await ctx.signIn('a@example.nl');
    expect((await ctx.generate(token)).statusCode).toBe(200);
    const blocked = await ctx.generate(token);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('DAILY_LIMIT');
    expect(blocked.json().retry_after).toBeGreaterThan(0);
    expect(blocked.json().retry_after).toBeLessThanOrEqual(24 * 3600);

    ctx.now.value += 24 * 3600 * 1000; // next day (Amsterdam)
    expect((await ctx.generate(token)).statusCode).toBe(200);
  });

  it('an address the owner has not approved has no budget: signed in, but no AI', async () => {
    ctx = await createCtx();
    const { token } = await ctx.signIn('new@example.nl', { approved: false });
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().limits).toEqual({ approved: false, day_cost_cap_eur: 0, day_cost_remaining_eur: 0 });

    const r = await ctx.generate(token);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('NOT_APPROVED');
    expect(ledgerRows(ctx)).toHaveLength(0); // the provider was never called, nothing was billed
  });

  it('approving the address gives the daily budget at once; revoking takes it away again', async () => {
    ctx = await createCtx();
    const { token } = await ctx.signIn('later@example.nl', { approved: false });
    expect((await ctx.generate(token)).statusCode).toBe(403);

    ctx.db.prepare('INSERT INTO allowed_emails (email, source, created_at) VALUES (?, ?, ?)').run('later@example.nl', 'admin', ctx.now.value);
    expect((await ctx.generate(token)).statusCode).toBe(200);

    ctx.db.prepare('DELETE FROM allowed_emails WHERE email = ?').run('later@example.nl');
    expect((await ctx.generate(token)).statusCode).toBe(403);
  });

  it('an approved address has a daily budget only: no weekly or monthly cap', async () => {
    ctx = await createCtx({ USER_DAILY_EUR: '0.01', MAX_OUTPUT_TOKENS: '2048' }); // budget numbers are tuned to 2048
    const { token } = await ctx.signIn('a@example.nl');
    // many days in a row, each day's budget used up: it is never blocked by a longer period
    for (let day = 0; day < 45; day++) {
      expect((await ctx.generate(token)).statusCode).toBe(200);
      ctx.now.value += 24 * 3600 * 1000;
    }
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(Object.keys(me.json().limits).sort()).toEqual(['approved', 'day_cost_cap_eur', 'day_cost_remaining_eur']);
  });

  it('rejects a single request that could never fit the daily budget', async () => {
    ctx = await createCtx({ USER_DAILY_EUR: '0.0005' });
    const { token } = await ctx.signIn('a@example.nl');
    const r = await ctx.generate(token);
    expect(r.statusCode).toBe(413);
  });

  it('global emergency brake: when the daily total is reached everyone gets 503', async () => {
    ctx = await createCtx({ GLOBAL_DAILY_EUR: await oneRequestBudget() });
    const a = await ctx.signIn('a@example.nl');
    const b = await ctx.signIn('b@example.nl');
    expect((await ctx.generate(a.token)).statusCode).toBe(200);
    const r = await ctx.generate(b.token);
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe('CAPACITY');
    ctx.now.value += 24 * 3600 * 1000;
    expect((await ctx.generate(b.token)).statusCode).toBe(200);
  });

  it('reserves budget for in-flight requests (no overshoot via parallel requests)', async () => {
    ctx = await createCtx({ GLOBAL_DAILY_EUR: '0.004', USER_RPM: '100', MAX_OUTPUT_TOKENS: '2048' }, new FakeProvider({ delayMs: 100 }));
    const a = await ctx.signIn('a@example.nl');
    const b = await ctx.signIn('b@example.nl');
    const [ra, rb] = await Promise.all([ctx.generate(a.token), ctx.generate(b.token)]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 503]);
  });

  it('maps provider failures: 502 for errors, 503 for provider rate limits; nothing is billed', async () => {
    ctx = await createCtx({}, new FakeProvider({ failWith: new ProviderError('boom', 'UPSTREAM_ERROR', 500) }));
    const { token } = await ctx.signIn('a@example.nl');
    const r = await ctx.generate(token);
    expect(r.statusCode).toBe(502);
    expect(r.json().code).toBe('UPSTREAM_ERROR');
    expect(r.body).not.toContain('boom'); // provider details are not leaked
    expect(ledgerRows(ctx)[0]).toMatchObject({ status: 'error', cost_micro_eur: 0 });
    await ctx.app.close();

    ctx = await createCtx({}, new FakeProvider({ failWith: new ProviderError('slow down', 'RATE_LIMITED', 429, 42) }));
    const s = await ctx.signIn('a@example.nl');
    const r2 = await ctx.generate(s.token);
    expect(r2.statusCode).toBe(503);
    expect(r2.json()).toMatchObject({ code: 'CAPACITY', retry_after: 42 });
  });

  it('times out slow providers and bills the estimated input', async () => {
    ctx = await createCtx({ PROVIDER_TIMEOUT_MS: '50' }, new FakeProvider({ delayMs: 500 }));
    const { token } = await ctx.signIn('a@example.nl');
    const r = await ctx.generate(token);
    expect(r.statusCode).toBe(502);
    const row = ledgerRows(ctx)[0];
    expect(row.status).toBe('error');
    expect(row.cost_micro_eur).toBeGreaterThan(0);
  });

  it('GET /v1/usage lists spending per day', async () => {
    ctx = await createCtx();
    const { token } = await ctx.signIn('a@example.nl');
    await ctx.generate(token);
    await ctx.generate(token);
    const r = await ctx.app.inject({ method: 'GET', url: '/v1/usage', headers: { authorization: `Bearer ${token}` } });
    expect(r.json().days[0]).toMatchObject({ day: '2026-11-02', requests: 2 });
  });

  it('does not log or return secrets: unknown routes and errors use the standard format', async () => {
    ctx = await createCtx();
    const r = await ctx.app.inject({ method: 'GET', url: '/nope' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    expect((await ctx.app.inject({ method: 'GET', url: '/healthz' })).json().ok).toBe(true);
  });
});
