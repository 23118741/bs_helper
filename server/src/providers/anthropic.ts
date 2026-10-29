import { postJson } from './http.js';
import { ProviderError, type FetchLike, type Provider, type ProviderRequest, type ProviderResponse } from './types.js';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  readonly model: string;

  constructor(private readonly opts: AnthropicOptions) {
    this.model = opts.model;
  }

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const base = this.opts.baseUrl ?? 'https://api.anthropic.com';
    const data = await postJson(
      this.opts.fetchImpl ?? fetch,
      `${base}/v1/messages`,
      { 'x-api-key': this.opts.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.model,
        max_tokens: req.maxOutputTokens,
        temperature: req.temperature,
        system: req.system,
        messages: req.turns.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
      },
      req.signal
    );

    const text = (Array.isArray(data?.content) ? data.content : [])
      .map((b: any) => (b?.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    if (!text) throw new ProviderError(`Empty response (stop reason: ${data?.stop_reason ?? 'none'})`, 'UPSTREAM_ERROR', 200);

    const u = data?.usage ?? {};
    // cached tokens are billed at other rates; count them as input to stay on the safe (higher) side
    const inputTokens =
      (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0);
    return { text, inputTokens, outputTokens: Number(u.output_tokens) || 0 };
  }
}
