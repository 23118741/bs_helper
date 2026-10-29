import { postJson } from './http.js';
import { ProviderError, type FetchLike, type Provider, type ProviderRequest, type ProviderResponse } from './types.js';

export interface MistralOptions {
  apiKey: string;
  model: string;
  /** Use https://api.eu.mistral.ai for EU-only processing (billed at 1.1x). */
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export class MistralProvider implements Provider {
  readonly name = 'mistral';
  readonly model: string;

  constructor(private readonly opts: MistralOptions) {
    this.model = opts.model;
  }

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const base = this.opts.baseUrl ?? 'https://api.mistral.ai';
    const data = await postJson(
      this.opts.fetchImpl ?? fetch,
      `${base}/v1/chat/completions`,
      { authorization: `Bearer ${this.opts.apiKey}` },
      {
        model: this.model,
        max_tokens: req.maxOutputTokens,
        temperature: req.temperature,
        messages: [
          { role: 'system', content: req.system },
          ...req.turns.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
        ],
      },
      req.signal
    );

    const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new ProviderError(`Empty response (finish reason: ${data?.choices?.[0]?.finish_reason ?? 'none'})`, 'UPSTREAM_ERROR', 200);
    return {
      text,
      inputTokens: Number(data?.usage?.prompt_tokens) || 0,
      outputTokens: Number(data?.usage?.completion_tokens) || 0,
    };
  }
}
