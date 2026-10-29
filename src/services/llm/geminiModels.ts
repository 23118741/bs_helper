/**
 * src/services/llm/geminiModels.ts
 * Gemini models offered in Settings (own API key, and the development build).
 */

export const GEMINI_MODEL_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Aanbevolen — Nieuwste Stable Flash)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (Snel & hoog volume)' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
  { id: 'gemini-flash-latest', label: 'Gemini Flash Latest (Automatisch nieuwste Flash)' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Uitgebreide redenering)' },
];
