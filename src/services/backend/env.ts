/**
 * src/services/backend/env.ts
 * Build-time switches. A production build talks to the backend only; the direct-Gemini mode
 * (own API key, unguarded direct questions) exists for local development behind VITE_DEV_DIRECT_GEMINI=1.
 */

const env = import.meta.env;

/** Base URL of the API server (no trailing slash). */
export const API_BASE_URL: string = String(env.VITE_API_URL || 'http://localhost:3000').replace(/\/+$/, '');

/** True in development builds that may use an own Gemini key and unguarded direct questions in the Chat. */
export const DEV_DIRECT_GEMINI: boolean = String(env.VITE_DEV_DIRECT_GEMINI || '') === '1';

/** Name shown in the UI; change in one place when the product gets its final name. */
export const PRODUCT_NAME = 'BS Helper';
