/**
 * src/services/llm/geminiMode.ts
 * "Gemini 2.5 Flash" mode:
 * - Directly invokes Google Generative Language REST API (gemini-2.5-flash) via native browser fetch.
 * - Zero external npm dependencies or SDKs, ensuring lightweight MV3 bundle.
 * - Formats contents, systemInstruction, generationConfig, and permissive safetySettings.
 * - Comprehensive error handling: missing API key, 400, 401/403, 429, 500, network drop, timeout, safety blocks.
 * - Extracts token usage and generation metadata.
 */

import { alternate, fitHistory, fitRelatedChats, type ChatTurn } from './conversationBudget';
import { formatRelatedChats } from '../../../shared/prompts';
import {
  LLMError,
  LLMOptions,
  LLMResponse,
  LLMUsage,
} from '@/types/llm';
import { estimateTokenCount, generateContextSummary } from './llmUtils';

/** The parallel chats as a leading exchange, the same way the server sends them. */
function relatedTurns(chats: LLMOptions['relatedChats']): ChatTurn[] {
  const text = formatRelatedChats(fitRelatedChats(chats));
  return text ? [{ role: 'user', text }, { role: 'model', text: 'Understood.' }] : [];
}

export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

export interface GeminiContent {
  role?: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiSafetySetting {
  category:
    | 'HARM_CATEGORY_HARASSMENT'
    | 'HARM_CATEGORY_HATE_SPEECH'
    | 'HARM_CATEGORY_SEXUALLY_EXPLICIT'
    | 'HARM_CATEGORY_DANGEROUS_CONTENT';
  threshold:
    | 'BLOCK_NONE'
    | 'BLOCK_ONLY_HIGH'
    | 'BLOCK_MEDIUM_AND_ABOVE'
    | 'BLOCK_LOW_AND_ABOVE';
}

export interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
}

export interface GeminiRequestBody {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: GeminiPart[];
  };
  generationConfig?: GeminiGenerationConfig;
  safetySettings?: GeminiSafetySetting[];
}

export interface GeminiCandidate {
  content?: {
    parts?: Array<{ text?: string }>;
    role?: string;
  };
  finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER' | string;
  safetyRatings?: Array<{
    category: string;
    probability: string;
  }>;
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface GeminiResponseBody {
  candidates?: GeminiCandidate[];
  promptFeedback?: {
    blockReason?: string;
    safetyRatings?: Array<{ category: string; probability: string }>;
  };
  usageMetadata?: GeminiUsageMetadata;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

/**
 * Builds standard permissive safety settings to prevent false-positive blocks on course materials.
 */
export function getStandardSafetySettings(): GeminiSafetySetting[] {
  return [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
  ];
}

/**
 * Executes Gemini 2.5 Flash mode via direct HTTPS POST request.
 */
export async function executeGeminiMode(
  userPrompt: string,
  fullPromptOrOptions?: string | LLMOptions,
  maybeOptions?: LLMOptions
): Promise<LLMResponse> {
  let fullPrompt: string;
  let options: LLMOptions;

  if (typeof fullPromptOrOptions === 'string') {
    fullPrompt = fullPromptOrOptions;
    options = maybeOptions || { mode: 'gemini' };
  } else {
    options = fullPromptOrOptions || { mode: 'gemini' };
    fullPrompt = userPrompt;
  }

  const apiKey = (options.apiKey ?? '').trim();
  if (!apiKey) {
    throw new LLMError(
      'Gemini API key is missing. Please configure your API key in Settings.',
      'MISSING_API_KEY',
      400,
      'gemini'
    );
  }

  const model = options.model?.trim() || DEFAULT_GEMINI_MODEL;
  const endpointUrl = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // Assemble request payload
  const requestBody: GeminiRequestBody = {
    // the parallel chats, then the conversation, then this question with its course context
    contents: alternate([
      ...relatedTurns(options.relatedChats),
      ...fitHistory(options.history),
      { role: 'user', text: fullPrompt },
    ]).map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    generationConfig: {
      temperature: options.temperature ?? 0.15,
      maxOutputTokens: options.maxOutputTokens ?? options.maxTokens ?? 8192,
    },
    safetySettings: getStandardSafetySettings(),
  };

  const instruction = options.systemInstruction?.trim();
  if (instruction) {
    requestBody.systemInstruction = {
      parts: [{ text: instruction }],
    };
  }

  // Setup abort controller and timeout
  const timeoutMs = options.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Gemini API request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  if (options.signal?.aborted) {
    controller.abort();
  } else if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
  }

  let response: Response;
  try {
    response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      if (options.signal?.aborted) {
        throw new LLMError(
          'Request was cancelled by user.',
          'ABORTED',
          undefined,
          'gemini'
        );
      }
      throw new LLMError(
        `Gemini API request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        'TIMEOUT',
        408,
        'gemini'
      );
    }
    throw new LLMError(
      `Network connection failed. Failed to connect to Gemini API: ${err?.message || 'Check your internet connection.'}`,
      'NETWORK_ERROR',
      undefined,
      'gemini'
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle HTTP error responses
  if (!response.ok) {
    let errorDetail = '';
    let parsedErr: any = null;
    try {
      parsedErr = await response.json();
      errorDetail = parsedErr?.error?.message || response.statusText;
    } catch {
      errorDetail = response.statusText || `HTTP ${response.status}`;
    }

    if (response.status === 400) {
      throw new LLMError(
        `Gemini API request error (400): ${errorDetail}`,
        'HTTP_ERROR',
        400,
        parsedErr
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new LLMError(
        `Gemini API authorization error or quota exceeded (HTTP ${response.status}): ${errorDetail}. Invalid API key or quota exhausted.`,
        'HTTP_ERROR',
        response.status,
        parsedErr
      );
    }

    if (response.status === 429) {
      throw new LLMError(
        `Gemini API rate limit exceeded (HTTP 429): ${errorDetail}. Quota exhausted. Please wait a moment and try again.`,
        'RATE_LIMIT',
        429,
        parsedErr
      );
    }

    if (response.status >= 500) {
      throw new LLMError(
        `Google Gemini service temporarily unavailable (HTTP ${response.status}): ${errorDetail}. Internal server error. Please retry later.`,
        'SERVER_ERROR',
        response.status,
        parsedErr
      );
    }

    throw new LLMError(
      `Gemini API call failed with HTTP ${response.status}: ${errorDetail}`,
      'HTTP_ERROR',
      response.status,
      parsedErr
    );
  }

  // Parse JSON response body
  let data: GeminiResponseBody;
  try {
    data = await response.json();
  } catch (err: any) {
    throw new LLMError(
      `Failed to parse Gemini response as JSON: ${err?.message}`,
      'INVALID_RESPONSE',
      response.status,
      'gemini'
    );
  }

  if (!data || typeof data !== 'object') {
    throw new LLMError(
      'Gemini returned an invalid non-object JSON response.',
      'INVALID_RESPONSE',
      response.status,
      'gemini'
    );
  }

  // Check safety block in promptFeedback
  if (data.promptFeedback?.blockReason) {
    throw new LLMError(
      `Gemini blocked this request due to safety restrictions (${data.promptFeedback.blockReason}).`,
      'SAFETY_BLOCKED',
      200,
      data.promptFeedback
    );
  }

  // Validate candidates
  if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
    throw new LLMError(
      'Gemini returned an empty response with no candidate completions.',
      'INVALID_RESPONSE',
      200,
      data
    );
  }

  const candidate = data.candidates[0];

  // Check safety finishReason
  if (candidate.finishReason === 'SAFETY') {
    throw new LLMError(
      'Gemini generation was blocked by content safety filters.',
      'SAFETY_BLOCKED',
      200,
      candidate.safetyRatings
    );
  }

  // Extract generated text
  const parts = candidate.content?.parts;
  const generatedText = Array.isArray(parts)
    ? parts
        .map((p) => p.text || '')
        .filter(Boolean)
        .join('')
        .trim()
    : '';

  // Extract token usage
  const usage: LLMUsage = {
    promptTokens: data.usageMetadata?.promptTokenCount,
    candidateTokens: data.usageMetadata?.candidatesTokenCount,
    totalTokens: data.usageMetadata?.totalTokenCount,
  };

  const contextSummary = generateContextSummary(options.contextBundle);
  const tokenEstimate =
    usage.totalTokens ??
    (estimateTokenCount(fullPrompt) + estimateTokenCount(generatedText));

  return {
    text: generatedText,
    mode: 'gemini',
    modeUsed: 'gemini',
    rawPrompt: userPrompt,
    serializedContext: options.serializedContext,
    contextSummary,
    tokenEstimate,
    usage,
    metadata: {
      model,
      finishReason: candidate.finishReason,
      safetyRatings: candidate.safetyRatings,
    },
  };
}
