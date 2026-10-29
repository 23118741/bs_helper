/**
 * src/services/llm/llmStorage.ts
 * Manages LLM configuration, modes, and credentials in chrome.storage.local
 * with defensive memory fallback for isolated environments.
 */

import { DEV_DIRECT_GEMINI } from '@/services/backend/env';
import {
  DEFAULT_LLM_SETTINGS,
  LLMMode,
  LLMSettings,
  LLM_STORAGE_KEY,
} from '@/types/llm';

/**
 * Standard Chrome Storage Local keys for BS Helper configuration.
 */
export const LLM_STORAGE_KEYS = {
  MODE: 'brightspace_ai_mode',
  GEMINI_KEY: 'brightspace_ai_gemini_key',
  PROXY_URL: 'brightspace_ai_proxy_url',
  PROXY_TOKEN: 'brightspace_ai_proxy_token',
  MODEL: 'brightspace_ai_model',
  USE_OWN_KEY: 'brightspace_ai_use_own_key',
} as const;

export { DEFAULT_LLM_SETTINGS, LLM_STORAGE_KEY };
export type { LLMSettings };

/**
 * In-memory fallback store when chrome.storage.local is unavailable.
 */
const memoryStore: Record<string, any> = {};

function isChromeStorageAvailable(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

function sanitizeMode(rawMode: any): LLMMode {
  // Production builds only talk to the backend, whatever was stored before.
  if (!DEV_DIRECT_GEMINI) return 'backend';
  // A persisted legacy 'manual' mode falls through to the default.
  if (rawMode === 'backend' || rawMode === 'gemini' || rawMode === 'proxy') {
    return rawMode;
  }
  return DEFAULT_LLM_SETTINGS.mode;
}

function getMemorySettings(): LLMSettings {
  const rawMode = memoryStore[LLM_STORAGE_KEYS.MODE];
  const geminiKey =
    memoryStore[LLM_STORAGE_KEYS.GEMINI_KEY] ?? DEFAULT_LLM_SETTINGS.geminiApiKey;
  const proxyUrl =
    memoryStore[LLM_STORAGE_KEYS.PROXY_URL] ?? DEFAULT_LLM_SETTINGS.proxyUrl;
  const proxyToken =
    memoryStore[LLM_STORAGE_KEYS.PROXY_TOKEN] ?? DEFAULT_LLM_SETTINGS.proxyToken;
  const model =
    memoryStore[LLM_STORAGE_KEYS.MODEL] ?? DEFAULT_LLM_SETTINGS.model;
  const legacyObj = memoryStore[LLM_STORAGE_KEY] || {};

  return {
    mode: sanitizeMode(rawMode ?? legacyObj.mode),
    geminiApiKey: geminiKey,
    apiKey: geminiKey,
    proxyUrl,
    proxyToken,
    model,
    geminiModel: model,
    temperature: legacyObj.temperature ?? DEFAULT_LLM_SETTINGS.temperature,
    maxOutputTokens:
      legacyObj.maxOutputTokens ?? DEFAULT_LLM_SETTINGS.maxOutputTokens,
    systemInstruction:
      legacyObj.systemInstruction ?? DEFAULT_LLM_SETTINGS.systemInstruction,
    useOwnKey: memoryStore[LLM_STORAGE_KEYS.USE_OWN_KEY] === true,
  };
}

/**
 * Loads current LLM settings from chrome.storage.local (or memory fallback),
 * populating default values for any unconfigured keys.
 */
export async function getLLMSettings(): Promise<LLMSettings> {
  if (!isChromeStorageAvailable()) return getMemorySettings();
  try {
    return await readStoredSettings();
  } catch {
    // e.g. "Access to storage is not allowed from this context": settings must never block a request
    return getMemorySettings();
  }
}

async function readStoredSettings(): Promise<LLMSettings> {
  const keys = [
    LLM_STORAGE_KEYS.MODE,
    LLM_STORAGE_KEYS.GEMINI_KEY,
    LLM_STORAGE_KEYS.PROXY_URL,
    LLM_STORAGE_KEYS.PROXY_TOKEN,
    LLM_STORAGE_KEYS.MODEL,
    LLM_STORAGE_KEYS.USE_OWN_KEY,
    LLM_STORAGE_KEY,
  ];

  const result = await chrome.storage.local.get(keys);
  const legacyObj = (result && result[LLM_STORAGE_KEY]) || {};

  const rawMode = result[LLM_STORAGE_KEYS.MODE] ?? legacyObj.mode;
  const geminiKey =
    typeof result[LLM_STORAGE_KEYS.GEMINI_KEY] === 'string'
      ? result[LLM_STORAGE_KEYS.GEMINI_KEY]
      : typeof legacyObj.geminiApiKey === 'string'
      ? legacyObj.geminiApiKey
      : DEFAULT_LLM_SETTINGS.geminiApiKey;

  const proxyUrl =
    typeof result[LLM_STORAGE_KEYS.PROXY_URL] === 'string'
      ? result[LLM_STORAGE_KEYS.PROXY_URL]
      : typeof legacyObj.proxyUrl === 'string'
      ? legacyObj.proxyUrl
      : DEFAULT_LLM_SETTINGS.proxyUrl;

  const proxyToken =
    typeof result[LLM_STORAGE_KEYS.PROXY_TOKEN] === 'string'
      ? result[LLM_STORAGE_KEYS.PROXY_TOKEN]
      : typeof legacyObj.proxyToken === 'string'
      ? legacyObj.proxyToken
      : DEFAULT_LLM_SETTINGS.proxyToken;

  const rawStoredModel =
    typeof result[LLM_STORAGE_KEYS.MODEL] === 'string' &&
    result[LLM_STORAGE_KEYS.MODEL].length > 0
      ? result[LLM_STORAGE_KEYS.MODEL]
      : typeof legacyObj.model === 'string' && legacyObj.model.length > 0
      ? legacyObj.model
      : typeof legacyObj.geminiModel === 'string' && legacyObj.geminiModel.length > 0
      ? legacyObj.geminiModel
      : DEFAULT_LLM_SETTINGS.model;

  const model =
    rawStoredModel === 'gemini-2.5-flash' ||
    rawStoredModel === 'gemini-1.5-flash' ||
    rawStoredModel === 'gemini-1.5-pro'
      ? DEFAULT_LLM_SETTINGS.model
      : rawStoredModel;

  return {
    mode: sanitizeMode(rawMode),
    geminiApiKey: geminiKey,
    apiKey: geminiKey,
    proxyUrl,
    proxyToken,
    model,
    geminiModel: model,
    temperature:
      typeof legacyObj.temperature === 'number'
        ? legacyObj.temperature
        : DEFAULT_LLM_SETTINGS.temperature,
    maxOutputTokens:
      typeof legacyObj.maxOutputTokens === 'number'
        ? legacyObj.maxOutputTokens
        : DEFAULT_LLM_SETTINGS.maxOutputTokens,
    systemInstruction:
      typeof legacyObj.systemInstruction === 'string'
        ? legacyObj.systemInstruction
        : DEFAULT_LLM_SETTINGS.systemInstruction,
    useOwnKey: result[LLM_STORAGE_KEYS.USE_OWN_KEY] === true,
  };
}

/**
 * Saves partial or complete LLM settings to chrome.storage.local without
 * overwriting untouched keys.
 */
export async function saveLLMSettings(
  settings: Partial<LLMSettings>
): Promise<LLMSettings> {
  const current = await getLLMSettings();
  const updated: LLMSettings = {
    ...current,
    ...settings,
  };

  const itemsToStore: Record<string, any> = {};

  if (settings.mode !== undefined) {
    itemsToStore[LLM_STORAGE_KEYS.MODE] = sanitizeMode(settings.mode);
  }
  if (settings.geminiApiKey !== undefined || settings.apiKey !== undefined) {
    const key = (settings.geminiApiKey ?? settings.apiKey ?? '').trim();
    itemsToStore[LLM_STORAGE_KEYS.GEMINI_KEY] = key;
    updated.geminiApiKey = key;
    updated.apiKey = key;
  }
  if (settings.proxyUrl !== undefined) {
    itemsToStore[LLM_STORAGE_KEYS.PROXY_URL] = settings.proxyUrl.trim();
  }
  if (settings.proxyToken !== undefined) {
    itemsToStore[LLM_STORAGE_KEYS.PROXY_TOKEN] = settings.proxyToken.trim();
  }
  if (settings.model !== undefined || settings.geminiModel !== undefined) {
    const mod = (settings.model ?? settings.geminiModel ?? '').trim();
    itemsToStore[LLM_STORAGE_KEYS.MODEL] = mod;
    updated.model = mod;
    updated.geminiModel = mod;
  }

  if (settings.useOwnKey !== undefined) {
    itemsToStore[LLM_STORAGE_KEYS.USE_OWN_KEY] = settings.useOwnKey === true;
  }

  // Also maintain the consolidated bundle object for settings modal convenience
  itemsToStore[LLM_STORAGE_KEY] = updated;

  if (!isChromeStorageAvailable()) {
    Object.assign(memoryStore, itemsToStore);
    return updated;
  }

  try {
    await chrome.storage.local.set(itemsToStore);
  } catch {
    Object.assign(memoryStore, itemsToStore);
  }
  return updated;
}

/**
 * Clears all LLM-related configuration and credentials from storage
 * while strictly preserving other extension keys.
 */
export async function clearLLMSettings(): Promise<void> {
  const keys = [
    LLM_STORAGE_KEYS.MODE,
    LLM_STORAGE_KEYS.GEMINI_KEY,
    LLM_STORAGE_KEYS.PROXY_URL,
    LLM_STORAGE_KEYS.PROXY_TOKEN,
    LLM_STORAGE_KEYS.MODEL,
    LLM_STORAGE_KEYS.USE_OWN_KEY,
    LLM_STORAGE_KEY,
  ];

  if (!isChromeStorageAvailable()) {
    for (const k of keys) delete memoryStore[k];
    return;
  }

  try {
    await chrome.storage.local.remove(keys);
  } catch {
    for (const k of keys) delete memoryStore[k];
  }
}

/**
 * Resets LLM configuration back to initial defaults.
 */
export async function resetLLMSettings(): Promise<void> {
  await saveLLMSettings(DEFAULT_LLM_SETTINGS);
}

/**
 * Returns current active LLM execution mode ('backend' | 'gemini' | 'proxy').
 */
export async function getLLMMode(): Promise<LLMMode> {
  const settings = await getLLMSettings();
  return settings.mode;
}

/**
 * Sets active LLM execution mode.
 */
export async function setLLMMode(mode: LLMMode): Promise<void> {
  await saveLLMSettings({ mode });
}

/**
 * Returns configured Gemini API key.
 */
export async function getGeminiApiKey(): Promise<string> {
  const settings = await getLLMSettings();
  return settings.geminiApiKey;
}

/**
 * Updates configured Gemini API key.
 */
export async function setGeminiApiKey(apiKey: string): Promise<void> {
  await saveLLMSettings({ geminiApiKey: apiKey, apiKey });
}

/**
 * Returns proxy configuration.
 */
export async function getProxyConfig(): Promise<{ proxyUrl: string; proxyToken: string }> {
  const settings = await getLLMSettings();
  return {
    proxyUrl: settings.proxyUrl,
    proxyToken: settings.proxyToken,
  };
}

/**
 * Updates proxy configuration.
 */
export async function setProxyConfig(config: {
  proxyUrl?: string;
  proxyToken?: string;
}): Promise<void> {
  await saveLLMSettings({
    proxyUrl: config.proxyUrl,
    proxyToken: config.proxyToken,
  });
}

/**
 * Verifies if required credentials exist for the specified mode.
 * - 'gemini': True if non-empty geminiApiKey exists.
 * - 'proxy': True if non-empty proxyUrl exists.
 */
export async function hasValidCredentials(mode: LLMMode): Promise<boolean> {
  if (mode === 'backend') return true; // authentication is handled by the login session
  const settings = await getLLMSettings();
  if (mode === 'gemini') {
    return Boolean(settings.geminiApiKey && settings.geminiApiKey.trim().length > 0);
  }
  if (mode === 'proxy') {
    return Boolean(settings.proxyUrl && settings.proxyUrl.trim().length > 0);
  }
  return false;
}
