/**
 * src/services/llm/llmClient.ts
 * Strict Single LLM Client Gateway for the BS Helper extension.
 *
 * ARCHITECTURAL INVARIANT:
 * All LLM interactions across the entire extension MUST pass through this module
 * via `llm.generate(prompt, options)`. Direct provider calls (e.g. Gemini, OpenAI)
 * outside this module are strictly forbidden.
 */

import { GENERAL_ANSWER_MARKER, GENERAL_SYSTEM_INSTRUCTION, NOT_FOUND_MARKER } from '../../../shared/prompts';
import { prepareContext } from '@/services/context/prepareContext';
import { AnswerRoute, MIXED_TOKEN_BUDGET, answerDepthHint, isFollowUp, routeQuestion } from '@/services/context/queryRouter';
import type { RelevanceStats } from '@/types/parser';
import type { SourceRegistry } from '@/services/context/sourceRegistry';
import { normalizeCitations } from './citations';
import {
  DEFAULT_LLM_SETTINGS,
  LLMError,
  LLMOptions,
  LLMResponse,
  LLMSettings,
  RelevanceOption,
  ZERO_FLUFF_SYSTEM_INSTRUCTION,
} from '@/types/llm';

export { DEFAULT_LLM_SETTINGS, ZERO_FLUFF_SYSTEM_INSTRUCTION };
export type { LLMSettings };
import { DEV_DIRECT_GEMINI } from '@/services/backend/env';
import { executeBackendMode } from './backendMode';
import { executeGeminiMode } from './geminiMode';
import { estimateTokenCount, generateContextSummary } from './llmUtils';
import { executeProxyMode } from './proxyMode';
import { rawChat } from './rawChat';
import {
  clearLLMSettings,
  getGeminiApiKey,
  getLLMMode,
  getLLMSettings,
  getProxyConfig,
  hasValidCredentials,
  resetLLMSettings,
  saveLLMSettings,
  setGeminiApiKey,
  setLLMMode,
  setProxyConfig,
} from './llmStorage';

/**
 * Re-export storage helpers for convenient consumer access.
 */
export {
  getLLMSettings,
  saveLLMSettings,
  clearLLMSettings,
  resetLLMSettings,
  getLLMMode,
  setLLMMode,
  getGeminiApiKey,
  setGeminiApiKey,
  getProxyConfig,
  setProxyConfig,
  hasValidCredentials,
};

/**
 * Formats user prompt together with serialized course context into an assembled prompt.
 */
export function assemblePromptWithContext(
  prompt: string,
  serializedContext?: string,
  systemInstruction?: string
): string {
  const hasSystem = Boolean(systemInstruction && systemInstruction.trim().length > 0);
  const hasContext = Boolean(serializedContext && serializedContext.trim().length > 0);

  if (!hasSystem && !hasContext) {
    return (prompt || '').trim();
  }

  const sections: string[] = [];
  if (hasSystem) {
    sections.push(`## Instructions & Persona\n\n${systemInstruction!.trim()}`);
  }
  if (hasContext) {
    sections.push(`# Course Materials Context\n\n${serializedContext!.trim()}`);
  }
  sections.push(`# User Instructions / Query\n\n${(prompt || '').trim()}`);
  return sections.join('\n\n---\n\n');
}

/**
 * Detects whether a string is a raw JSON payload (object, array, or pure fenced json block).
 */
export function isRawJsonResponse(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      JSON.parse(fenceMatch[1].trim());
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Deterministically strips conversational boilerplate (leading greetings, affirmative preambles,
 * question-echoing intros, and trailing polite sign-offs) from LLM prose responses.
 * Leaves Markdown tables, bullet lists, JSON arrays/objects, code fences, and fallback strings intact.
 */
export function stripConversationalBoilerplate(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  // Preserve raw JSON payloads intact
  if (isRawJsonResponse(trimmed)) {
    return trimmed;
  }

  // Iteratively strip leading lines matching conversational preamble patterns
  const leadingLineRegex =
    /^(?:(?:hello|hi|hey|greetings|good\s+(?:morning|afternoon|evening))(?:(?:\s+(?:there|everyone|all|class|students))?[!.,:]*)?|(?:sure(?:\s+thing)?|certainly|of\s+course|absolutely|gladly|glad\s+to\s+help|no\s+problem|i(?:'|’)?d\s+be\s+happy\s+to\s+help(?:\s+with\s+that)?|i\s+would\s+be\s+happy\s+to\s+help(?:\s+with\s+that)?|great\s+question|understood|alright)[!.,:]?|(?:(?:sure(?:\s+thing)?|certainly|of\s+course|hello|hi)[!.,]?\s*)?(?:(?:based\s+on|according\s+to|from)\s+(?:the\s+)?(?:provided|selected)?\s*(?:brightspace\s*)?(?:course|lecture|class|syllabus)?\s*(?:materials|documents|context|syllabus|slides|information|content|notes)[^:\n]*:)|(?:(?:sure(?:\s+thing)?|certainly|of\s+course|hello|hi)[!.,]?\s*)?(?:(?:here|below)\s+(?:is|are)\s+[^:\n]*:)|(?:as\s+(?:an?\s+)?(?:ai\s+)?(?:academic\s+)?(?:assistant|tutor|helper)[^:\n]*:)|(?:in\s+response\s+to\s+your\s+question[^:\n]*:))$/i;

  const trailingLineRegex =
    /^(?:(?:(?:i\s+)?hope\s+(?:this|that)\s+(?:helps|was\s+helpful)[^\n]*)|(?:(?:please\s+)?let\s+me\s+know\s+if\s+you\s+(?:have|need)[^\n]*)|(?:feel\s+free\s+to\s+ask[^\n]*)|(?:(?:please\s+)?don(?:'|’)?t\s+hesitate\s+to\s+(?:ask|reach\s+out)[^\n]*)|(?:good\s+luck\s+with\s+(?:your\s+)?(?:studies|course|exam|midterm|assignments)?[^\n]*)|(?:best\s+of\s+luck[^\n]*)|(?:happy\s+studying[^\n]*)|(?:if\s+you\s+(?:have|need)\s+(?:any\s+)?(?:more|further|other)\s+questions[^\n]*))$/i;

  let lines = trimmed.split('\n');

  while (lines.length > 0) {
    const first = lines[0].trim();
    if (!first) {
      lines.shift();
      continue;
    }
    if (leadingLineRegex.test(first) && lines.length > 1) {
      lines.shift();
    } else {
      break;
    }
  }

  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (!last) {
      lines.pop();
      continue;
    }
    if (trailingLineRegex.test(last)) {
      lines.pop();
    } else {
      break;
    }
  }

  let result = lines.join('\n').trim();
  if (!result) return '';

  // Inline leading prefix patterns
  const inlineLeading = [
    /^(?:(?:hello(?!\s+world\b)|hi|hey|greetings|good\s+(?:morning|afternoon|evening))(?:[!.,:]|\s+(?:there|everyone|all|class|students)[!.,:]?)\s+)+/i,
    /^(?:sure(?:\s+thing)?|certainly|of\s+course|absolutely|gladly)[!.,]?\s+/i,
    /^(?:(?:i\s+would|i(?:'|’)?d)\s+be\s+happy\s+to\s+help(?:\s+with\s+that)?[!.,]?\s+)/i,
    /^(?:great\s+question[!.,]?\s+)/i,
    /^(?:as\s+(?:an?\s+)?(?:ai\s+)?(?:academic\s+)?(?:assistant|tutor|helper)[^,:\n]*[,:]\s*)/i,
    /^(?:based\s+on\s+(?:the\s+)?(?:provided|selected)?\s*(?:brightspace\s*)?(?:course|lecture|class|syllabus)?\s*(?:materials|documents|context|syllabus|slides|information)[^,:\n]*[,:]\s*(?:(?:here\s+is|below\s+is)[^,:\n]*[,:]\s*)?)/i,
    /^(?:(?:according\s+to|from)\s+(?:the\s+)?(?:provided|selected)?\s*(?:brightspace\s*)?(?:course|lecture|class|syllabus)?\s*(?:materials|documents|context|syllabus|slides|information)[^:\n]*:\s*(?:(?:here\s+is|below\s+is)[^,:\n]*[,:]\s*)?)/i,
    /^(?:(?:here|below)\s+(?:is|are)\s+[^:,\n]+[:,-]\s*)/i,
    /^(?:in\s+response\s+to\s+your\s+question[,:]\s*)/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pat of inlineLeading) {
      if (pat.test(result)) {
        result = result.replace(pat, '').trim();
        changed = true;
      }
    }
  }

  // Inline trailing suffix patterns
  const inlineTrailing = [
    /\s*(?:(?:i\s+)?hope\s+(?:this|that)\s+(?:helps|was\s+helpful)[^.\n]*[.!]*)+$/i,
    /\s*(?:(?:please\s+)?let\s+me\s+know\s+if\s+you\s+(?:have|need)[^.\n]*[.!]*)+$/i,
    /\s*(?:feel\s+free\s+to\s+ask[^.\n]*[.!]*)+$/i,
    /\s*(?:(?:please\s+)?don(?:'|’)?t\s+hesitate\s+to\s+(?:ask|reach\s+out)[^.\n]*[.!]*)+$/i,
    /\s*(?:(?:if\s+you\s+(?:have|need)\s+(?:any\s+)?(?:more|further|other)\s+questions)[^.\n]*[.!]*)+$/i,
    /\s*(?:good\s+luck\s+with\s+[^.\n]*[.!]*)+$/i,
    /\s*(?:best\s+of\s+luck[!.]*)+$/i,
    /\s*(?:happy\s+studying[!.]*)+$/i,
  ];

  changed = true;
  while (changed) {
    changed = false;
    for (const pat of inlineTrailing) {
      if (pat.test(result)) {
        result = result.replace(pat, '').trim();
        changed = true;
      }
    }
  }

  // If first character is lowercase after stripping, capitalize it
  if (result.length > 0 && /^[a-z]/.test(result)) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  return result;
}

const GENERAL_MARKER_RE = new RegExp(`^\\s*${GENERAL_ANSWER_MARKER.replace(/[[\]]/g, '\\$&')}\\s*`, 'i');
/** Older prompts (and the preset prompts) use this sentence instead of the marker. */
const NOT_FOUND_SENTENCE = 'Not specified in the selected Brightspace materials.';
const NOT_FOUND_SENTENCE_RE = /^\s*not specified in the selected brightspace materials\.?\s*$/i;

/** One wider search at most; after that the question is answered as a plain chat. */
const MAX_ESCALATIONS = 1;

interface MarkerResult {
  text: string;
  /** The model says the answer may be in material that was left out. */
  notFound: boolean;
  /** The model answered from general knowledge. */
  general: boolean;
}

/** Reads and removes the markers the system prompt uses; the student never sees them. */
export function readMarkers(raw: string | undefined, kind: LLMOptions['kind']): MarkerResult {
  let text = raw ?? '';
  let general = false;
  const marked = GENERAL_MARKER_RE.exec(text);
  if (marked) {
    general = true;
    text = text.slice(marked[0].length);
  }
  const hasMarker = text.includes(NOT_FOUND_MARKER);
  const notFound = hasMarker || (kind !== 'preset' && NOT_FOUND_SENTENCE_RE.test(text));
  if (hasMarker) text = text.split(NOT_FOUND_MARKER).join('').trim();
  return { text, notFound, general };
}

/** One answer from the model, and whether it reported the answer may be in material that was left out. */
interface Sent {
  response: LLMResponse;
  notFound: boolean;
}

/** Room for complete answers: there is no length limit in the prompts, only this safety cap. */
const ANSWER_MAX_OUTPUT_TOKENS = 8192;

/** Level 1: more slides/pages around each hit, weaker hits, all sections. */
function widenedRelevance(prev: RelevanceOption | undefined): RelevanceOption {
  const base = typeof prev === 'object' ? prev : {};
  return { ...base, mode: 'auto', tokenBudget: Math.max(base.tokenBudget ?? 0, 75_000), sections: 'all', neighbors: 2, minScoreRatio: 0.05 };
}

/**
 * Single Gateway Entry Point:
 * Executes an LLM generation task under the active mode ('backend', or 'gemini'/'proxy' in development builds).
 *
 * A chat question is first routed (queryRouter.ts):
 *  - general: no course material at all, answered like a plain chat (one cheap call);
 *  - mixed:   a small amount of material, the model may fall back to general knowledge;
 *  - course:  the matching material; when the model reports the answer may be in material that was left out,
 *             search once more widely, then answer as a plain chat. The student never gets a bare "not found".
 *
 * @param prompt - The core user query, summarization command, or prompt template.
 * @param options - Optional overrides for execution mode, API keys, context bundles, temperature, etc.
 * @returns Standardized LLMResponse.
 */
export async function generate(
  prompt: string,
  options?: Partial<LLMOptions>
): Promise<LLMResponse> {
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new LLMError('Prompt cannot be empty.', 'INVALID_OPTIONS');
  }

  // Load user settings to supply defaults
  const settings = await getLLMSettings();

  // Resolve effective execution mode
  // Production builds use the shared backend, or the user's own Gemini key when they chose that in Settings
  // (straight to Google, nothing passes our server). The other direct modes exist for development.
  const requestedMode = options?.mode || settings.mode || (DEV_DIRECT_GEMINI ? 'gemini' : 'backend');
  const usesOwnKey = !DEV_DIRECT_GEMINI && settings.useOwnKey === true && (settings.geminiApiKey ?? '').trim().length > 0;
  const mode = DEV_DIRECT_GEMINI ? requestedMode : usesOwnKey ? 'gemini' : 'backend';
  if (mode !== 'backend' && mode !== 'gemini' && mode !== 'proxy') {
    throw new LLMError(`Unsupported LLM mode: ${mode}`, 'INVALID_OPTIONS');
  }

  const kind = options?.kind;
  const isChat = kind !== 'preset';
  const followUp = isChat && (options?.history?.length ?? 0) > 0 && isFollowUp(prompt);
  // a summary, "in detail" or "elaborate" gets a full answer instead of the short default
  const depthHint = isChat ? answerDepthHint(prompt, followUp) : '';
  const asked = depthHint ? `${prompt.trim()}\n\n(${depthHint})` : prompt;

  /** Sends one request and reads its markers. `context` is what goes along; none for a plain chat. */
  const send = async (
    route: 'course' | 'general',
    context: { serialized?: string; stats?: RelevanceStats; sources?: SourceRegistry }
  ): Promise<Sent> => {
    const serializedContext = route === 'general' ? undefined : context.serialized;
    const effectiveOptions: LLMOptions = {
      mode,
      model: options?.model || settings.model || settings.geminiModel || 'gemini-3.8-flash',
      apiKey: options?.apiKey ?? settings.geminiApiKey ?? settings.apiKey ?? '',
      proxyUrl: options?.proxyUrl ?? settings.proxyUrl ?? '',
      proxyToken: options?.proxyToken ?? settings.proxyToken ?? '',
      systemInstruction: options?.systemInstruction || (route === 'general' ? GENERAL_SYSTEM_INSTRUCTION : settings.systemInstruction),
      temperature: options?.temperature ?? settings.temperature ?? 0.15,
      maxOutputTokens:
        options?.maxOutputTokens ??
        options?.maxTokens ??
        // development builds follow the setting; production always has the full room
        (DEV_DIRECT_GEMINI ? settings.maxOutputTokens : undefined) ??
        ANSWER_MAX_OUTPUT_TOKENS,
      contextBundle: options?.contextBundle,
      serializedContext,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs ?? 120000,
      exportFormat: options?.exportFormat || 'markdown',
      kind,
      history: options?.history,
      relatedChats: options?.relatedChats,
      answerMode: route,
    };

    // Only the direct modes send one flattened prompt; the backend gets the context separately.
    const fullPrompt = () =>
      assemblePromptWithContext(asked, serializedContext, effectiveOptions.systemInstruction);

    let response: LLMResponse;
    switch (mode) {
      case 'backend':
        response = await executeBackendMode(asked, effectiveOptions);
        break;
      case 'gemini':
        response = await executeGeminiMode(asked, fullPrompt(), effectiveOptions);
        break;
      case 'proxy':
        response = await executeProxyMode(asked, fullPrompt(), effectiveOptions);
        break;
      default:
        throw new LLMError(`Unsupported LLM mode: ${mode}`, 'INVALID_OPTIONS');
    }

    const marked = readMarkers(response.text, kind);
    response.text = marked.text;
    if (route === 'general' || marked.general) response.general = true;

    // Deterministic clean-up of prose answers (not for a plain chat answer, and never for JSON)
    if (route !== 'general' && response.text && !isRawJsonResponse(response.text)) {
      response.text = stripConversationalBoilerplate(response.text);
    }
    // Citations: older free-text ones that clearly point at one source become ids, so all are shown and linked alike
    if (route !== 'general' && context.sources) {
      response.sources = context.sources;
      if (response.text && !isRawJsonResponse(response.text)) response.text = normalizeCitations(response.text, context.sources);
    }
    if (context.stats) response.contextStats = context.stats;
    if (serializedContext && !response.serializedContext) response.serializedContext = serializedContext;
    return { response, notFound: marked.notFound };
  };

  const prepare = (relevance: RelevanceOption | undefined) =>
    options?.contextBundle && !options?.serializedContext
      ? prepareContext({
          bundle: options.contextBundle,
          prompt,
          history: options.history,
          relevance,
          format: options.exportFormat === 'json' ? 'json' : 'markdown',
        })
      : { serialized: options?.serializedContext, stats: undefined, sources: undefined };

  // ---- route: decided locally, before any tokens are spent ----
  let prepared = prepare(options?.relevance);
  let route: AnswerRoute = 'course';
  const widest = typeof options?.relevance === 'object' && options.relevance.mode === 'all';
  if (isChat && !widest && options?.contextBundle && !options?.serializedContext && options?.relevance !== 'off') {
    route = routeQuestion(prompt, prepared.stats, { followUp });
    if (route === 'mixed') {
      const base = typeof options?.relevance === 'object' ? options.relevance : {};
      prepared = prepare({ ...base, tokenBudget: MIXED_TOKEN_BUDGET });
    }
  }

  const usage = { prompt: 0, candidate: 0, calls: 0 };
  const track = (r: LLMResponse) => {
    usage.prompt += r.usage?.promptTokens ?? 0;
    usage.candidate += r.usage?.candidateTokens ?? 0;
    usage.calls++;
  };

  const plainChat = async (): Promise<Sent> => {
    options?.onStatus?.('Answering from general knowledge…');
    const sent = await send('general', {});
    track(sent.response);
    return sent;
  };

  let sent: Sent;
  let finalRoute: AnswerRoute = route;
  let level = 0;
  if (route === 'general') {
    sent = await plainChat();
    // the student can still force a search of the course materials
    if (prepared.stats && prepared.stats.totalDocuments > 0) sent.response.searchAllAvailable = true;
  } else {
    sent = await send('course', prepared);
    track(sent.response);

    // The answer may be in material that was left out: search wider once (course route only)
    while (
      isChat &&
      route === 'course' &&
      sent.notFound &&
      options?.escalate !== false &&
      !options?.serializedContext &&
      options?.relevance !== 'off' &&
      prepared.stats?.widenable &&
      level < MAX_ESCALATIONS
    ) {
      level++;
      options?.onStatus?.('Searching more of your materials…');
      prepared = prepare(widenedRelevance(options?.relevance));
      sent = await send('course', prepared);
      track(sent.response);
    }

    // Still nothing: never leave the student with a bare "not found", answer as a plain chat (tagged)
    if (sent.notFound) {
      if (isChat) {
        const searched = sent.response;
        sent = await plainChat();
        finalRoute = 'general';
        // keep what was searched, so the student sees it and can still search everything
        Object.assign(sent.response, {
          contextStats: searched.contextStats,
          serializedContext: searched.serializedContext,
          contextSummary: searched.contextSummary,
        });
      }
      // presets keep their strict sentence; a plain chat that still gave up falls back to it too
      sent.response.text = sent.response.text || NOT_FOUND_SENTENCE;
    }
  }

  const finalResponse = sent.response;
  finalResponse.route = finalRoute;
  finalResponse.escalationLevel = level;
  if (usage.calls > 1 && finalResponse.usage) {
    // the student paid for every call: report the total
    finalResponse.usage = {
      ...finalResponse.usage,
      promptTokens: usage.prompt,
      candidateTokens: usage.candidate,
      totalTokens: usage.prompt + usage.candidate,
    };
    finalResponse.tokenEstimate = usage.prompt + usage.candidate;
  }
  return finalResponse;
}

/**
 * Exported unified LLM gateway object
 */
export const llm = {
  generate,
  getSettings: getLLMSettings,
  saveSettings: saveLLMSettings,
  clearSettings: clearLLMSettings,
  resetSettings: resetLLMSettings,
  hasValidCredentials,
  estimateTokens: estimateTokenCount,
  summarizeContext: generateContextSummary,
  assemblePrompt: assemblePromptWithContext,
  rawChat,
};

export { generate as generateLLM };
export default llm;
