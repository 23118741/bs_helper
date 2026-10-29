import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTransport } from '@/services/backend/client';
import { sessionStore } from '@/services/backend/session';
import { executeBackendMode, describeBackendError } from '@/services/llm/backendMode';
import { BackendError } from '@/services/backend/client';
import { LLMError } from '@/types/llm';

const limits = { approved: true, day_cost_cap_eur: 0.5, day_cost_remaining_eur: 0.4 };

describe('backend LLM mode', () => {
  beforeEach(() => {
    setTransport(null);
    sessionStore.reset();
  });

  it('sends question, context and kind to the server and maps the answer', async () => {
    const transport = vi.fn(async () => ({
      ok: true,
      status: 200,
      data: { request_id: 'r1', text: 'Antwoord', usage: { input_tokens: 1000, output_tokens: 50 }, limits },
    }));
    setTransport(transport);
    const res = await executeBackendMode('Wat is de deadline?', {
      mode: 'backend',
      serializedContext: '## Context\nDeadline: 1 december',
      kind: 'chat',
    });
    expect(res).toMatchObject({ text: 'Antwoord', mode: 'backend', usage: { promptTokens: 1000, candidateTokens: 50, totalTokens: 1050 } });
    const sent = (transport.mock.calls[0] as any)[0];
    expect(sent.op).toBe('generate');
    expect(sent.body).toMatchObject({ kind: 'chat', question: 'Wat is de deadline?', context_markdown: '## Context\nDeadline: 1 december' });
    expect(sent.body.client.version).toBeDefined();
    // no system prompt or model is chosen by the client
    expect(Object.keys(sent.body)).not.toContain('system');
    expect(Object.keys(sent.body)).not.toContain('model');
    expect(sessionStore.get().limits).toEqual(limits);
  });

  it('turns API errors into LLMErrors with friendly Dutch messages', async () => {
    setTransport(async () => ({ ok: false, status: 429, error: { code: 'DAILY_LIMIT', message: 'Daily limit reached.', retry_after: 7200 } }));
    const err = (await executeBackendMode('Q', { mode: 'backend' }).catch((e) => e)) as LLMError;
    expect(err).toBeInstanceOf(LLMError);
    expect(err.code).toBe('DAILY_LIMIT');
    expect(err.message).toContain('daily limit');
    expect(err.message).toContain('in 2 hours');
  });

  it('marks the session as signed out on AUTH_REQUIRED', async () => {
    sessionStore.markSignedOut();
    sessionStore.reset();
    setTransport(async () => ({ ok: false, status: 401, error: { code: 'AUTH_REQUIRED', message: 'x' } }));
    const err = (await executeBackendMode('Q', { mode: 'backend' }).catch((e) => e)) as LLMError;
    expect(err.code).toBe('AUTH_REQUIRED');
    expect(sessionStore.get().status).toBe('signedOut');
  });

  it('maps a cancelled request to ABORTED', async () => {
    setTransport(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    const err = (await executeBackendMode('Q', { mode: 'backend' }).catch((e) => e)) as LLMError;
    expect(err.code).toBe('ABORTED');
  });

  it('describes limits in natural language', () => {
    expect(describeBackendError(new BackendError('RATE_LIMITED', '', 429, 20))).toContain('in 20 seconds');
    expect(describeBackendError(new BackendError('PAYLOAD_TOO_LARGE', '', 413))).toContain('too large');
    expect(describeBackendError(new BackendError('NOT_APPROVED', '', 403))).toContain('not approved');
    expect(describeBackendError(new BackendError('UPGRADE_REQUIRED', '', 426))).toContain('update');
    expect(describeBackendError(new BackendError('NETWORK', 'No connection to the server.'))).toBe('No connection to the server.');
  });
});
