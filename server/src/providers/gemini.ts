import { postJson } from './http.js';
import { ProviderError, type FetchLike, type Provider, type ProviderRequest, type ProviderResponse } from './types.js';

export interface GeminiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  thinkingBudget?: number;
  fetchImpl?: FetchLike;
}

export class GeminiProvider implements Provider {
  readonly name = 'gemini';
  readonly model: string;

  constructor(private readonly opts: GeminiOptions) {
    this.model = opts.model;
  }

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const base = this.opts.baseUrl ?? 'https://generativelanguage.googleapis.com';
    const url = `${base}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const generationConfig: Record<string, unknown> = {
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
    };
    if (this.opts.thinkingBudget !== undefined) {
      generationConfig.thinkingConfig = { thinkingBudget: this.opts.thinkingBudget };
    }

    const data = await postJson(
      this.opts.fetchImpl ?? fetch,
      url,
      { 'x-goog-api-key': this.opts.apiKey },
      {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: req.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        generationConfig,
        safetySettings: [
          'HARM_CATEGORY_HARASSMENT',
          'HARM_CATEGORY_HATE_SPEECH',
          'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          'HARM_CATEGORY_DANGEROUS_CONTENT',
        ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
      },
      req.signal
    );

    if (data?.promptFeedback?.blockReason) {
      throw new ProviderError(`Blocked by provider: ${data.promptFeedback.blockReason}`, 'UPSTREAM_ERROR', 200);
    }
    const candidate = data?.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('').trim();
    if (!text) {
      throw new ProviderError(`Empty response (finish reason: ${candidate?.finishReason ?? 'none'})`, 'UPSTREAM_ERROR', 200);
    }

    const usage = data?.usageMetadata ?? {};
    const inputTokens = Number(usage.promptTokenCount) || 0;
    // total − prompt also covers "thinking" tokens, which are billed as output.
    const outputTokens =
      usage.totalTokenCount !== undefined
        ? Math.max(0, Number(usage.totalTokenCount) - inputTokens)
        : Number(usage.candidatesTokenCount) || 0;
    return { text, inputTokens, outputTokens };
  }
}
