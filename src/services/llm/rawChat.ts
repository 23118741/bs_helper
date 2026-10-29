/**
 * src/services/llm/rawChat.ts
 * Unguarded multi-turn chat straight to the Gemini API, for debugging what the model can see.
 * No system instruction, no prompt wrapper, no boilerplate stripping, BLOCK_NONE safety.
 * The serialized Brightspace context is sent verbatim as the first user turn. Like every other
 * tool it goes through prepareContext(), so the relevance filter is on by default
 * (pass `relevance: 'off'` to send the whole selection).
 */

import { alternate, fitHistory, fitRelatedChats, type ChatTurn } from './conversationBudget';
import { formatRelatedChats, type RelatedChat } from '../../../shared/prompts';
import { prepareContext } from '@/services/context/prepareContext';
import { LLMError, RelevanceOption } from '@/types/llm';
import { CourseContextBundle, RelevanceStats } from '@/types/parser';
import { GEMINI_API_BASE_URL, DEFAULT_GEMINI_MODEL, GeminiContent } from './geminiMode';
import { getLLMSettings } from './llmStorage';

export interface RawChatTurn {
  role: 'user' | 'model';
  text: string;
}

export interface RawChatOptions {
  contextBundle?: CourseContextBundle;
  /** Pre-serialized context; bypasses the relevance filter. */
  serializedContext?: string;
  relevance?: RelevanceOption;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  temperature?: number;
  /** The student's chats about other courses in this session. */
  relatedChats?: RelatedChat[];
}

export interface RawChatResult {
  text: string;
  finishReason?: string;
  promptTokens?: number;
  candidateTokens?: number;
  totalTokens?: number;
  /** The exact context text that was sent as the first turn. */
  contextMarkdown: string;
  /** What the relevance filter sent along (undefined when a pre-serialized context was used). */
  contextStats?: RelevanceStats;
  /** Exact JSON body that was POSTed (API key is in the URL, so it is not included). */
  requestBody: unknown;
}

export async function rawChat(history: RawChatTurn[], options: RawChatOptions = {}): Promise<RawChatResult> {
  const settings = await getLLMSettings();
  const apiKey = (settings.geminiApiKey || settings.apiKey || '').trim();
  if (!apiKey) {
    throw new LLMError(
      'Gemini API key is missing. Please configure your API key in Settings.',
      'MISSING_API_KEY',
      400,
      'gemini'
    );
  }
  const model = (settings.model || settings.geminiModel || DEFAULT_GEMINI_MODEL).trim();

  // The newest user turn is the question; earlier user turns help follow-ups find the same documents.
  const lastUserIndex = history.map((t) => t.role).lastIndexOf('user');
  const question = lastUserIndex >= 0 ? history[lastUserIndex].text : '';
  let contextMarkdown = options.serializedContext ?? '';
  let contextStats: RelevanceStats | undefined;
  if (!options.serializedContext && options.contextBundle) {
    const prepared = prepareContext({
      bundle: options.contextBundle,
      prompt: question,
      history: history.slice(0, Math.max(0, lastUserIndex)),
      relevance: options.relevance,
    });
    contextMarkdown = prepared.serialized ?? '';
    contextStats = prepared.stats;
  }

  const contents: GeminiContent[] = [];
  if (contextMarkdown.trim()) {
    contents.push({
      role: 'user',
      parts: [{ text: `Course context from Brightspace:\n\n${contextMarkdown}` }],
    });
    contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
  }
  const related = formatRelatedChats(fitRelatedChats(options.relatedChats));
  const turns: ChatTurn[] = related ? [{ role: 'user', text: related }, { role: 'model', text: 'Understood.' }] : [];
  for (const turn of alternate([...turns, ...fitHistory(history)])) {
    contents.push({ role: turn.role, parts: [{ text: turn.text }] });
  }

  const requestBody = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 1,
      maxOutputTokens: options.maxOutputTokens ?? 8192,
    },
    safetySettings: [
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ].map((category) => ({ category, threshold: 'BLOCK_NONE' })),
  };

  const url = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new LLMError('Request was cancelled by user.', 'ABORTED', undefined, 'gemini');
    }
    throw new LLMError(`Network error: ${err?.message || err}`, 'NETWORK_ERROR', undefined, 'gemini');
  }

  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new LLMError(
      `Gemini HTTP ${response.status}: ${data?.error?.message || response.statusText}`,
      'HTTP_ERROR',
      response.status,
      'gemini'
    );
  }

  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p: any) => p.text || '').join('');
  if (!text && data?.promptFeedback?.blockReason) {
    throw new LLMError(`Blocked: ${data.promptFeedback.blockReason}`, 'SAFETY_BLOCKED', 200, 'gemini');
  }

  return {
    text,
    finishReason: candidate?.finishReason,
    promptTokens: data?.usageMetadata?.promptTokenCount,
    candidateTokens: data?.usageMetadata?.candidatesTokenCount,
    totalTokens: data?.usageMetadata?.totalTokenCount,
    contextMarkdown,
    contextStats,
    requestBody,
  };
}
