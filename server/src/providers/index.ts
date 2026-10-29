import type { Config } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { FakeProvider } from './fake.js';
import { GeminiProvider } from './gemini.js';
import { MistralProvider } from './mistral.js';
import type { Provider } from './types.js';

export function createProvider(config: Config): Provider {
  switch (config.provider) {
    case 'gemini':
      return new GeminiProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.providerBaseUrl,
        thinkingBudget: config.geminiThinkingBudget,
      });
    case 'anthropic':
      return new AnthropicProvider({ apiKey: config.apiKey, model: config.model, baseUrl: config.providerBaseUrl });
    case 'mistral':
      return new MistralProvider({ apiKey: config.apiKey, model: config.model, baseUrl: config.providerBaseUrl });
    case 'fake':
      return new FakeProvider({ delayMs: Number(process.env.FAKE_DELAY_MS) || 0 });
  }
}

export * from './types.js';
