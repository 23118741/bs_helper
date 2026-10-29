/**
 * server/src/config.ts
 * All configuration comes from environment variables. Defaults are the invite-beta values;
 * the server refuses to start on an unsafe production config.
 */

export type ProviderName = 'gemini' | 'anthropic' | 'mistral' | 'fake';

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  /** Behind Caddy/Cloudflare: take the client IP from X-Forwarded-For. */
  trustProxy: boolean;
  dbPath: string;
  /** Public base URL of the API (used by the auth library). */
  publicUrl: string;
  authSecret: string;
  smtpUrl?: string;
  mailFrom: string;
  /** Time zone that defines "day" and "month" for limits. */
  timeZone: string;
  /** Lowest extension version that may call the API. */
  minClientVersion: string;

  provider: ProviderName;
  model: string;
  apiKey: string;
  /** Optional override of the provider base URL (e.g. https://api.eu.mistral.ai). */
  providerBaseUrl?: string;
  /** Optional Gemini thinking budget in tokens (0 disables thinking). */
  geminiThinkingBudget?: number;
  /** Price override, USD per 1M tokens (required for models missing from the price table). */
  priceInUsdPerM?: number;
  priceOutUsdPerM?: number;
  usdToEur: number;
  providerTimeoutMs: number;

  limits: {
    maxBodyBytes: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    userRequestsPerMinute: number;
    userConcurrency: number;
    userDailyEur: number;
    globalDailyEur: number;
    ipRequestsPerMinute: number;
    authStartPerIpPerMinute: number;
    authStartPerEmailPerIpPerHour: number;
    authStartPerEmailPerHour: number;
    authVerifyPerIpPerMinute: number;
    loginFailuresPer15Min: number;
  };
}

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number (got "${raw}")`);
  return n;
}

function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes'].includes(raw.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = (env.NODE_ENV as Config['env']) || 'development';
  const provider = (env.PROVIDER as ProviderName) || (nodeEnv === 'production' ? 'gemini' : 'fake');
  if (!['gemini', 'anthropic', 'mistral', 'fake'].includes(provider)) {
    throw new Error(`PROVIDER must be gemini, anthropic, mistral or fake (got "${provider}")`);
  }

  const defaultModel: Record<ProviderName, string> = {
    gemini: 'gemini-3.1-flash-lite',
    anthropic: 'claude-haiku-5-5',
    mistral: 'mistral-small-latest',
    fake: 'fake-model',
  };

  const config: Config = {
    env: nodeEnv,
    port: num(env, 'PORT', 3000),
    host: env.HOST || '0.0.0.0',
    trustProxy: bool(env, 'TRUST_PROXY', nodeEnv === 'production'),
    dbPath: env.DB_PATH || './data/app.db',
    publicUrl: env.PUBLIC_URL || `http://localhost:${num(env, 'PORT', 3000)}`,
    authSecret: env.AUTH_SECRET || '',
    smtpUrl: env.SMTP_URL || undefined,
    mailFrom: env.MAIL_FROM || 'BS Helper <no-reply@localhost>',
    timeZone: env.APP_TIME_ZONE || 'Europe/Amsterdam',
    minClientVersion: env.MIN_CLIENT_VERSION || '0.0.0',

    provider,
    model: env.MODEL || defaultModel[provider],
    apiKey: env.PROVIDER_API_KEY || '',
    providerBaseUrl: env.PROVIDER_BASE_URL || undefined,
    geminiThinkingBudget: env.GEMINI_THINKING_BUDGET ? num(env, 'GEMINI_THINKING_BUDGET', 0) : undefined,
    priceInUsdPerM: env.PRICE_IN_USD_PER_M ? num(env, 'PRICE_IN_USD_PER_M', 0) : undefined,
    priceOutUsdPerM: env.PRICE_OUT_USD_PER_M ? num(env, 'PRICE_OUT_USD_PER_M', 0) : undefined,
    usdToEur: num(env, 'USD_TO_EUR', 0.92),
    providerTimeoutMs: num(env, 'PROVIDER_TIMEOUT_MS', 120_000),

    limits: {
      maxBodyBytes: num(env, 'MAX_BODY_BYTES', 600 * 1024),
      maxInputTokens: num(env, 'MAX_INPUT_TOKENS', 120_000),
      maxOutputTokens: num(env, 'MAX_OUTPUT_TOKENS', 8192),
      userRequestsPerMinute: num(env, 'USER_RPM', 10),
      userConcurrency: num(env, 'USER_CONCURRENCY', 2),
      // Daily budget of an approved email address. Everyone else has 0.
      userDailyEur: num(env, 'USER_DAILY_EUR', 0.25),
      globalDailyEur: num(env, 'GLOBAL_DAILY_EUR', 15),
      ipRequestsPerMinute: num(env, 'IP_RPM', 120),
      authStartPerIpPerMinute: num(env, 'AUTH_START_IP_RPM', 5),
      authStartPerEmailPerIpPerHour: num(env, 'AUTH_START_EMAIL_IP_PER_HOUR', 3),
      authStartPerEmailPerHour: num(env, 'AUTH_START_EMAIL_PER_HOUR', 15),
      authVerifyPerIpPerMinute: num(env, 'AUTH_VERIFY_IP_RPM', 10),
      loginFailuresPer15Min: num(env, 'LOGIN_FAILURES_PER_15_MIN', 8),
    },
  };

  if (nodeEnv === 'production') {
    const problems: string[] = [];
    if (config.authSecret.length < 32) problems.push('AUTH_SECRET must be at least 32 characters');
    if (config.provider === 'fake') problems.push('PROVIDER=fake is not allowed in production');
    if (config.provider !== 'fake' && !config.apiKey) problems.push('PROVIDER_API_KEY is required');
    if (!config.smtpUrl) problems.push('SMTP_URL is required to send sign-up codes');
    if (!config.publicUrl.startsWith('https://')) problems.push('PUBLIC_URL must be an https:// URL');
    if (problems.length > 0) throw new Error(`Unsafe production configuration:\n- ${problems.join('\n- ')}`);
  } else if (!config.authSecret) {
    config.authSecret = 'dev-only-secret-dev-only-secret-dev-only-secret';
  }

  return config;
}
