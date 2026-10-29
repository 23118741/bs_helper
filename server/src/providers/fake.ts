import { estimateTokens } from './prompt.js';
import type { Provider, ProviderRequest, ProviderResponse } from './types.js';

/** Deterministic stand-in for tests and load tests: echoes the question, fixed latency. */
export class FakeProvider implements Provider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  calls = 0;

  constructor(private readonly opts: { delayMs?: number; failWith?: Error } = {}) {}

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    this.calls++;
    if (this.opts.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.opts.delayMs);
        req.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        });
      });
    }
    if (this.opts.failWith) throw this.opts.failWith;
    const last = req.turns[req.turns.length - 1]?.text ?? '';
    const text = `FAKE ANSWER: ${last.slice(0, 80)}`;
    const inputTokens = estimateTokens(req.system + req.turns.map((t) => t.text).join(''));
    return { text, inputTokens, outputTokens: estimateTokens(text) };
  }
}
