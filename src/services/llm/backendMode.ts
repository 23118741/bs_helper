/**
 * src/services/llm/backendMode.ts
 * "Backend" mode: the question and the chosen course context go to our own API server, which
 * adds the system prompt, enforces the limits and calls the AI provider. No API key is needed
 * (or present) in the extension.
 */

import { fitHistory, fitRelatedChats } from './conversationBudget';
import { BackendError, callApi } from '@/services/backend/client';
import type { GenerateBody, GenerateData } from '@/services/backend/messages';
import { sessionStore } from '@/services/backend/session';
import { LLMError, LLMErrorCode, LLMOptions, LLMResponse } from '@/types/llm';
import { generateContextSummary, estimateTokenCount } from './llmUtils';

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function waitText(seconds?: number): string {
  if (!seconds) return 'later';
  if (seconds < 90) return `in ${plural(seconds, 'second')}`;
  if (seconds < 3600) return `in ${plural(Math.ceil(seconds / 60), 'minute')}`;
  if (seconds < 86_400) return `in ${plural(Math.ceil(seconds / 3600), 'hour')}`;
  return `in ${plural(Math.ceil(seconds / 86_400), 'day')}`;
}

const CODE_MAP: Partial<Record<string, LLMErrorCode>> = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_CODE: 'AUTH_REQUIRED',
  DAILY_LIMIT: 'DAILY_LIMIT',
  NOT_APPROVED: 'NOT_APPROVED',
  RATE_LIMITED: 'RATE_LIMIT',
  CAPACITY: 'CAPACITY',
  UPGRADE_REQUIRED: 'UPGRADE_REQUIRED',
  INSTITUTION_BLOCKED: 'INSTITUTION_BLOCKED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  UPSTREAM_ERROR: 'SERVER_ERROR',
  NETWORK: 'NETWORK_ERROR',
  INVALID_REQUEST: 'INVALID_OPTIONS',
};

export function describeBackendError(err: BackendError): string {
  switch (err.code) {
    case 'AUTH_REQUIRED':
      return 'Your session has expired. Please sign in again.';
    case 'DAILY_LIMIT':
      return `You have reached your daily limit. You can ask questions again ${waitText(err.retryAfter)}.`;
    case 'NOT_APPROVED':
      return 'Your account is not approved for AI answers yet. Ask the owner to approve your email address.';
    case 'RATE_LIMITED':
      return `You are asking questions too quickly. Try again ${waitText(err.retryAfter)}.`;
    case 'CAPACITY':
      return 'The service is busy right now. Please try again later.';
    case 'UPGRADE_REQUIRED':
      return 'This version of the extension is out of date. Please update it.';
    case 'INSTITUTION_BLOCKED':
      return 'This service is not available for your institution.';
    case 'PAYLOAD_TOO_LARGE':
      return 'The selected course content is too large for one question. Select fewer documents or ask a more specific question.';
    case 'UPSTREAM_ERROR':
      return 'The AI service returned an error. Please try again.';
    default:
      return err.message;
  }
}

const clientVersion = (): string => {
  try {
    return (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.().version) || '0.0.0';
  } catch {
    return '0.0.0';
  }
};


export async function executeBackendMode(
  userPrompt: string,
  options: LLMOptions
): Promise<LLMResponse> {
  const body: GenerateBody = {
    kind: options.kind ?? 'chat',
    question: userPrompt,
    history: fitHistory(options.history),
    related_chats: fitRelatedChats(options.relatedChats),
    context_markdown: options.answerMode === 'general' ? undefined : options.serializedContext || undefined,
    answer_mode: options.answerMode,
    max_output_tokens: options.maxOutputTokens,
    client: {
      version: clientVersion(),
      locale: typeof navigator !== 'undefined' ? navigator.language : undefined,
      brightspace_host: typeof location !== 'undefined' ? location.hostname : undefined,
    },
  };

  let data: GenerateData;
  try {
    data = await callApi<GenerateData>('generate', body, options.signal);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new LLMError('Request was cancelled by user.', 'ABORTED', undefined, 'backend');
    }
    if (err instanceof BackendError) {
      if (err.code === 'AUTH_REQUIRED') sessionStore.markSignedOut();
      const e = new LLMError(describeBackendError(err), CODE_MAP[err.code] ?? 'UNKNOWN_ERROR', err.status || undefined, 'backend');
      (e as any).retryAfter = err.retryAfter;
      throw e;
    }
    throw err;
  }

  sessionStore.setLimits(data.limits);
  const promptTokens = data.usage.input_tokens;
  const candidateTokens = data.usage.output_tokens;
  return {
    text: data.text,
    mode: 'backend',
    modeUsed: 'backend',
    rawPrompt: userPrompt,
    serializedContext: options.serializedContext,
    contextSummary: generateContextSummary(options.contextBundle),
    tokenEstimate: promptTokens + candidateTokens || estimateTokenCount(data.text),
    usage: { promptTokens, candidateTokens, totalTokens: promptTokens + candidateTokens },
    metadata: { requestId: data.request_id, limits: data.limits },
  };
}
