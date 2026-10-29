import type { RelatedChat } from '../../shared/prompts';
/**
 * src/types/llm.ts
 * Type definitions and contracts for the Strict Single LLM Client Gateway,
 * execution modes ('backend' | 'gemini' | 'proxy'), configuration options,
 * settings, errors, and standardized response formats.
 */

import { CourseContextBundle, RelevanceStats } from './parser';
import type { SourceRegistry } from '../services/context/sourceRegistry';
import { DEV_DIRECT_GEMINI } from '../services/backend/env';

/**
 * Supported execution modes for the single LLM gateway:
 * - 'backend': Authenticated call to our own API server (production; no API key in the extension).
 * - 'gemini': Direct HTTPS call to Google Gemini 2.5 Flash using the user's API key.
 * - 'proxy': Configurable HTTPS proxy forwarder with optional authorization token.
 */
export type LLMMode = 'backend' | 'gemini' | 'proxy';

/**
 * Controls which course documents are sent along with a request. The gateway applies the
 * relevance filter to EVERY request that carries a `contextBundle`, so a tool gets it by default:
 * - undefined: score documents against the prompt (and `history`) and send the most relevant ones
 * - { query }: score against this text instead (pass the user's raw question when `prompt` is a
 *   wrapped template, so template words do not influence the selection)
 * - { mode: 'all' }: send every document that fits the token budget (broad summaries)
 * - 'off': send the whole bundle unfiltered (debugging only)
 */
export type RelevanceOption =
  | 'off'
  | {
      query?: string;
      mode?: 'auto' | 'all';
      tokenBudget?: number;
      /** 'all' sends every section (news, assignments, grades, ...) instead of only the relevant ones. */
      sections?: 'auto' | 'all';
      /** Extra slides/pages/sections around each hit (default 1). */
      neighbors?: number;
      /** Hits below this share of the best hit are dropped (default 0.25; lower = wider search). */
      minScoreRatio?: number;
    };

/**
 * Options passed to llm.generate(prompt, options)
 */
export interface LLMOptions {
  /** Execution mode override. Defaults to user's saved mode setting or 'gemini'. */
  mode?: LLMMode;
  /** Target AI model name (default: 'gemini-2.5-flash'). */
  model?: string;
  /** Gemini API key (defaults to key saved in chrome.storage.local). */
  apiKey?: string;
  /** Proxy endpoint URL for proxy mode (e.g. 'https://my-proxy.internal/generate'). */
  proxyUrl?: string;
  /** Optional Bearer token for the proxy endpoint. */
  proxyToken?: string;
  /** Optional system instruction guiding model behavior. */
  systemInstruction?: string;
  /** Generation temperature between 0.0 and 2.0 (default: 0.15). */
  temperature?: number;
  /** Maximum number of output tokens to generate (default: 8192). */
  maxOutputTokens?: number;
  /** Max output tokens alias. */
  maxTokens?: number;
  /** Course context bundle containing course metadata, announcements, assignments, docs, etc. */
  contextBundle?: CourseContextBundle;
  /** Pre-serialized context string (e.g., Markdown table/sections) if already computed. */
  serializedContext?: string;
  /** AbortSignal for user cancellation or request timeouts. */
  signal?: AbortSignal;
  /** Request timeout in milliseconds (default: 30000ms). */
  timeoutMs?: number;
  /** Document selection for this request; the relevance filter is on by default. */
  relevance?: RelevanceOption;
  /**
   * When the answer is "not specified" but material was left out, the gateway automatically asks again
   * with a wider selection (once). Set false to turn that off.
   */
  escalate?: boolean;
  /** Progress messages for the UI (e.g. "Searching more of your materials..."). */
  onStatus?: (status: string) => void;
  /** Backend mode: 'preset' for the summary buttons, 'chat' for free questions. */
  kind?: 'chat' | 'preset';
  /** Earlier turns of the conversation; the newest go along within a budget (conversationBudget.ts). */
  history?: Array<{ role: 'user' | 'model'; text: string }>;
  /** The student's chats about other courses in this session, so this chat can refer to them. */
  relatedChats?: RelatedChat[];
  /** Serialization format of the course context ('markdown' or 'json'). */
  exportFormat?: 'markdown' | 'json';
  /** Set by the gateway: 'general' = plain chat without course material, 'course' = answer from the materials. */
  answerMode?: 'course' | 'general';
}

/**
 * Token usage accounting for LLM generations.
 */
export interface LLMUsage {
  promptTokens?: number;
  candidateTokens?: number;
  totalTokens?: number;
}

/**
 * Unified response contract returned by llm.generate().
 */
export interface LLMResponse {
  /** The generated markdown text . */
  text: string;
  /** The mode executed. */
  mode: LLMMode;
  /** Mode used alias for consumer convenience. */
  modeUsed?: LLMMode;
  /** The complete assembled prompt including context and instructions. */
  rawPrompt?: string;
  /** The serialized course context included in the prompt. */
  serializedContext?: string;
  /** Brief summary of included context items (doc count, orgUnitId, etc.). */
  contextSummary?: string;
  /** Estimated or actual token count. */
  tokenEstimate?: number;
  /** Token usage metadata if reported by provider. */
  usage?: LLMUsage;
  /** Provider-specific metadata (finishReason, model, safetyRatings, etc.). */
  metadata?: Record<string, unknown>;
  /** What the relevance filter sent along (undefined when no context bundle was given). */
  contextStats?: RelevanceStats;
  /** The citeable sources of what was sent, by id (see sourceRegistry); the answer cites these ids. */
  sources?: SourceRegistry;
  /** True when the answer comes from the model's general knowledge, not from the course materials. */
  general?: boolean;
  /** How the question was answered: with course material, a little of it, or as a plain chat. */
  route?: 'course' | 'mixed' | 'general';
  /** A plain-chat answer for a question that matched nothing in the course: the student may still search all materials. */
  searchAllAvailable?: boolean;
  /** How many times the gateway widened the search automatically (0 = answered at first try). */
  escalationLevel?: number;
  /** Error message if partial failure occurred. */
  error?: string;
}

/**
 * User settings persisted in chrome.storage.local.
 */
export interface LLMSettings {
  /** Default active mode selected in the UI header switch. */
  mode: LLMMode;
  /** User's Google Gemini API key. */
  geminiApiKey: string;
  /** User's Google Gemini API key alias. */
  apiKey?: string;
  /** Model identifier to query in Gemini mode. */
  geminiModel: string;
  /** Target model identifier. */
  model: string;
  /** Custom proxy server URL. */
  proxyUrl: string;
  /** Optional Bearer authentication token for custom proxy. */
  proxyToken: string;
  /** Default temperature. */
  temperature: number;
  /** Default max output tokens. */
  maxOutputTokens: number;
  /** Default system instruction for academic course analysis. */
  systemInstruction?: string;
  /**
   * Production builds: use the user's own Gemini API key (geminiApiKey) instead of the shared backend.
   * Questions then go straight from the browser to Google; the key never reaches our server.
   */
  useOwnKey: boolean;
}

import { GENERAL_SYSTEM_INSTRUCTION, ZERO_FLUFF_SYSTEM_INSTRUCTION } from '../../shared/prompts';
export { GENERAL_SYSTEM_INSTRUCTION, ZERO_FLUFF_SYSTEM_INSTRUCTION };

/**
 * Sensible default settings for the extension.
 */
export const DEFAULT_LLM_SETTINGS: LLMSettings = {
  mode: DEV_DIRECT_GEMINI ? 'gemini' : 'backend',
  geminiApiKey: '',
  apiKey: '',
  geminiModel: 'gemini-3.8-flash',
  model: 'gemini-3.8-flash',
  proxyUrl: '',
  proxyToken: '',
  temperature: 0.15,
  maxOutputTokens: 8192,
  systemInstruction: ZERO_FLUFF_SYSTEM_INSTRUCTION,
  useOwnKey: false,
};

/**
 * Chrome storage keys for LLM configuration.
 */
export const LLM_STORAGE_KEY = 'brightspace_ai_settings';

/**
 * Standard error codes for LLM failures.
 */
export type LLMErrorCode =
  | 'MISSING_API_KEY'
  | 'MISSING_PROXY_URL'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'RATE_LIMIT'
  | 'RATE_LIMITED'
  | 'SAFETY_BLOCKED'
  | 'INVALID_RESPONSE'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'INVALID_OPTIONS'
  | 'INVALID_API_KEY'
  | 'PROXY_AUTH_FAILED'
  | 'SERVER_ERROR'
  | 'AUTH_REQUIRED'
  | 'DAILY_LIMIT'
  | 'NOT_APPROVED'
  | 'CAPACITY'
  | 'UPGRADE_REQUIRED'
  | 'INSTITUTION_BLOCKED'
  | 'PAYLOAD_TOO_LARGE'
  | 'PAYMENT_REQUIRED'
  | 'UNKNOWN_ERROR';

/**
 * Custom error class for LLM gateway failures with structured codes.
 */
export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly status?: number;
  readonly mode?: LLMMode;
  readonly details?: unknown;

  constructor(
    message: string,
    code: LLMErrorCode,
    status?: number,
    detailsOrMode?: unknown
  ) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
    this.status = status;
    if (typeof detailsOrMode === 'string' && (detailsOrMode === 'backend' || detailsOrMode === 'gemini' || detailsOrMode === 'proxy')) {
      this.mode = detailsOrMode as LLMMode;
    } else {
      this.details = detailsOrMode;
    }
  }
}

/**
 * Single LLM gateway interface contract.
 */
export interface LLMClientInterface {
  generate(prompt: string, options?: Partial<LLMOptions>): Promise<LLMResponse>;
  getSettings(): Promise<LLMSettings>;
  saveSettings(settings: Partial<LLMSettings>): Promise<LLMSettings>;
}
