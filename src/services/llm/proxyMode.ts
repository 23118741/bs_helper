/**
 * src/services/llm/proxyMode.ts
 * "Future Proxy" mode:
 * - Forwards prompt and options to a configurable proxy URL (e.g. university rate-limited gateway).
 * - Attaches optional Authorization: Bearer ${token} header.
 * - Supports multiple response schemas (text, content, response, result, Gemini candidates, OpenAI choices).
 * - Error handling for auth failures, server errors, and offline proxy.
 */

import { LLMError, LLMOptions, LLMResponse, LLMUsage } from '@/types/llm';
import { estimateTokenCount, generateContextSummary } from './llmUtils';

/**
 * Extracts generated text from diverse proxy response schemas.
 */
export function extractProxyResponseText(data: any): string | null {
  if (!data) return null;

  if (typeof data === 'string') {
    return data.trim();
  }

  // 1. Direct text property
  if (typeof data.text === 'string') {
    return data.text.trim();
  }

  // 2. Direct content property
  if (typeof data.content === 'string') {
    return data.content.trim();
  }

  // 3. Direct response, output, result, or message properties
  if (typeof data.response === 'string') {
    return data.response.trim();
  }
  if (typeof data.output === 'string') {
    return data.output.trim();
  }
  if (typeof data.result === 'string') {
    return data.result.trim();
  }
  if (typeof data.message === 'string') {
    return data.message.trim();
  }

  // 4. Gemini-compatible response schema
  if (Array.isArray(data.candidates) && data.candidates.length > 0) {
    const candidate = data.candidates[0];
    if (candidate && candidate.finishReason === 'SAFETY') {
      throw new LLMError(
        'Proxy upstream model generation was blocked by safety filters.',
        'SAFETY_BLOCKED',
        200,
        'proxy'
      );
    }
    const parts = candidate?.content?.parts;
    if (Array.isArray(parts)) {
      const text = parts
        .map((p: any) => (p && typeof p.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('')
        .trim();
      if (text.length > 0) return text;
    }
  }

  // 5. OpenAI / vLLM compatible response schema
  if (Array.isArray(data.choices) && data.choices.length > 0) {
    const choice = data.choices[0];
    if (choice && typeof choice.message?.content === 'string') {
      return choice.message.content.trim();
    }
    if (choice && typeof choice.text === 'string') {
      return choice.text.trim();
    }
  }

  return null;
}

/**
 * Extracts or estimates token usage metrics from proxy response.
 */
export function extractProxyUsage(
  data: any,
  prompt: string,
  context: string | undefined,
  outputText: string
): LLMUsage {
  if (data?.usage) {
    const u = data.usage;
    return {
      promptTokens: u.promptTokens ?? u.prompt_tokens,
      candidateTokens: u.candidateTokens ?? u.completion_tokens,
      totalTokens: u.totalTokens ?? u.total_tokens,
    };
  }

  if (data?.usageMetadata) {
    const um = data.usageMetadata;
    return {
      promptTokens: um.promptTokenCount,
      candidateTokens: um.candidatesTokenCount,
      totalTokens: um.totalTokenCount,
    };
  }

  const promptTokens = estimateTokenCount((prompt || '') + ' ' + (context || ''));
  const candidateTokens = estimateTokenCount(outputText || '');
  return {
    promptTokens,
    candidateTokens,
    totalTokens: promptTokens + candidateTokens,
  };
}

/**
 * Executes Proxy mode by forwarding request to configured proxy endpoint.
 */
export async function executeProxyMode(
  userPrompt: string,
  fullPromptOrOptions?: string | LLMOptions,
  maybeOptions?: LLMOptions
): Promise<LLMResponse> {
  let fullPrompt: string;
  let options: LLMOptions;

  if (typeof fullPromptOrOptions === 'string') {
    fullPrompt = fullPromptOrOptions;
    options = maybeOptions || { mode: 'proxy' };
  } else {
    options = fullPromptOrOptions || { mode: 'proxy' };
    fullPrompt = userPrompt;
  }

  const proxyUrl = options.proxyUrl?.trim();
  if (!proxyUrl) {
    throw new LLMError(
      'Proxy URL is missing. Please configure your custom proxy endpoint in Settings.',
      'MISSING_PROXY_URL',
      400,
      'proxy'
    );
  }

  if (!proxyUrl.startsWith('http://') && !proxyUrl.startsWith('https://')) {
    throw new LLMError(
      `Invalid proxy URL protocol: "${proxyUrl}". Proxy URL must start with http:// or https://.`,
      'INVALID_OPTIONS',
      400,
      'proxy'
    );
  }

  // Headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const proxyToken = options.proxyToken?.trim();
  if (proxyToken && proxyToken.length > 0) {
    headers['Authorization'] = `Bearer ${proxyToken}`;
  }

  // Standard payload
  const requestBody = {
    prompt: userPrompt,
    rawPrompt: fullPrompt,
    userPrompt,
    serializedContext: options.serializedContext,
    options: {
      mode: 'proxy',
      model: options.model || 'gemini-3.8-flash',
      temperature: options.temperature ?? 0.15,
      maxTokens: options.maxOutputTokens ?? options.maxTokens ?? 4096,
      maxOutputTokens: options.maxOutputTokens ?? options.maxTokens ?? 4096,
      context: options.serializedContext,
      contextBundle: options.contextBundle,
      systemInstruction: options.systemInstruction,
    },
  };

  // Setup abort controller and timeout
  const timeoutMs = options.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Proxy request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  if (options.signal?.aborted) {
    controller.abort();
  } else if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
  }

  let response: Response;
  try {
    response = await fetch(proxyUrl, {
      method: 'POST',
      headers,
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
          'proxy'
        );
      }
      throw new LLMError(
        `Proxy request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        'TIMEOUT',
        408,
        'proxy'
      );
    }
    throw new LLMError(
      `Network error communicating with proxy at ${proxyUrl}: ${err?.message || 'Check connection.'}`,
      'NETWORK_ERROR',
      undefined,
      'proxy'
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle HTTP error statuses
  if (!response.ok) {
    let errorDetail = '';
    let parsedErr: any = null;
    try {
      parsedErr = await response.json();
      errorDetail = parsedErr?.error?.message || parsedErr?.error || parsedErr?.message || response.statusText;
    } catch {
      errorDetail = response.statusText || `HTTP ${response.status}`;
    }

    if (response.status === 401 || response.status === 403) {
      throw new LLMError(
        `Proxy request failed with HTTP ${response.status}: Unauthorized. Check your proxy token. ${errorDetail}`,
        'PROXY_AUTH_FAILED',
        response.status,
        parsedErr
      );
    }

    if (response.status === 404) {
      throw new LLMError(
        `Proxy endpoint not found (HTTP 404) at ${proxyUrl}. Please verify the proxy URL.`,
        'INVALID_RESPONSE',
        404,
        parsedErr
      );
    }

    if (response.status === 429) {
      throw new LLMError(
        `Proxy rate limit exceeded (HTTP 429): ${errorDetail}`,
        'RATE_LIMIT',
        429,
        parsedErr
      );
    }

    if (response.status >= 500) {
      throw new LLMError(
        `Proxy request failed with HTTP ${response.status}: Bad Gateway or server error. ${errorDetail}`,
        'SERVER_ERROR',
        response.status,
        parsedErr
      );
    }

    throw new LLMError(
      `Proxy request failed with status ${response.status}: ${errorDetail}`,
      'HTTP_ERROR',
      response.status,
      parsedErr
    );
  }

  // Parse JSON response
  let data: any;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch (err: any) {
      throw new LLMError(
        `Failed to parse JSON response from proxy server: ${err.message}`,
        'INVALID_RESPONSE',
        response.status,
        'proxy'
      );
    }
  } else {
    data = await response.text();
  }

  const outputText = extractProxyResponseText(data);
  if (outputText === null) {
    throw new LLMError(
      'Proxy returned an unparseable response structure. Expected text, content, response, candidates, or choices.',
      'INVALID_RESPONSE',
      response.status,
      'proxy'
    );
  }

  const usage = extractProxyUsage(data, userPrompt, options.serializedContext, outputText);
  const contextSummary = generateContextSummary(options.contextBundle);

  return {
    text: outputText,
    mode: 'proxy',
    modeUsed: 'proxy',
    rawPrompt: userPrompt,
    serializedContext: options.serializedContext,
    contextSummary,
    tokenEstimate: usage.totalTokens,
    usage,
    metadata: {
      proxyUrl,
      ...(typeof data === 'object' && data !== null && data.metadata ? data.metadata : {}),
    },
  };
}
