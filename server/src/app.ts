/**
 * server/src/app.ts
 * HTTP API (v1). Every route funnels through the same error format ({code, message, ...}).
 * Order of checks for /v1/generate: auth → schema → client version → blocked institution →
 * size → per-user rate/concurrency → per-user day/month budget → global budget → provider.
 */

import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import {
  CLIENT_VERSION_HEADER,
  type ApiErrorBody,
  type AuthVerifyResponse,
  type GenerateResponse,
  type LimitsInfo,
  type MeResponse,
  type UsagePeriod,
} from '../../shared/contract.js';
import { findUserId, hasPassword, setUserPassword, type Auth } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { AppError } from './errors.js';
import { InflightGuard, Ledger, WindowCounter, type SpendTotals } from './ledger.js';
import type { Mailer } from './mailer.js';
import { secondsUntilNextDay } from './period.js';
import { microToEur, eurToMicro, type Pricing } from './pricing.js';
import { buildTurns, estimateInputTokens, systemPromptForRequest } from './providers/prompt.js';
import { ProviderError, type Provider } from './providers/types.js';
import { authLoginSchema, authResetSchema, authResetStartSchema, authSignupSchema, authSignupStartSchema, generateSchema } from './schemas.js';

export interface AppDeps {
  config: Config;
  db: Db;
  auth: Auth;
  mailer: Mailer;
  provider: Provider;
  pricing: Pricing;
  now?: () => number;
}

interface AuthedUser {
  id: string;
  email: string;
}

export const APP_VERSION = '0.1.0';

function parseVersion(v: string): number[] {
  return v
    .split('.')
    .slice(0, 3)
    .map((p) => parseInt(p, 10) || 0);
}

function versionLessThan(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  return h === p || h.endsWith(`.${p}`);
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, db, auth, mailer, provider, pricing } = deps;
  const now = deps.now ?? Date.now;
  const ledger = new Ledger(db, config);
  const guard = new InflightGuard();
  const emailLimiter = new WindowCounter();
  const loginFailures = new WindowCounter();

  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: config.limits.maxBodyBytes,
    genReqId: () => randomUUID(),
    logger:
      config.env === 'test'
        ? false
        : {
            level: process.env.LOG_LEVEL || 'info',
            // never log credentials; request bodies are not logged by default either
            redact: ['req.headers.authorization'],
          },
  });

  // ---------- plumbing ----------

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    if (req.url.startsWith('/v1/')) reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err: any, req, reply) => {
    let body: ApiErrorBody;
    let status: number;
    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, retry_after: err.retryAfter, request_id: req.id };
    } else if (err?.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      status = 413;
      body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.', request_id: req.id };
    } else if (err?.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      status = err.statusCode === 429 ? 429 : 400;
      body =
        err.statusCode === 429
          ? { code: 'RATE_LIMITED', message: 'Too many requests.', request_id: req.id }
          : { code: 'INVALID_REQUEST', message: String(err.message || 'Invalid request.'), request_id: req.id };
    } else {
      req.log.error({ err }, 'unhandled error');
      status = 500;
      body = { code: 'INTERNAL', message: 'Internal server error.', request_id: req.id };
    }
    if (body.retry_after !== undefined) reply.header('retry-after', String(body.retry_after));
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ code: 'INVALID_REQUEST', message: 'Not found.', request_id: req.id } satisfies ApiErrorBody)
  );

  void app.register(rateLimit, {
    global: true,
    max: config.limits.ipRequestsPerMinute,
    timeWindow: '1 minute',
    allowList: (req) => req.url === '/healthz',
    errorResponseBuilder: (_req, ctx) =>
      new AppError('RATE_LIMITED', 'Too many requests from this address.', Math.ceil(ctx.ttl / 1000)),
  });

  const parse = <T>(schema: ZodType<T>, data: unknown): T => {
    const result = schema.safeParse(data);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new AppError('INVALID_REQUEST', `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`);
    }
    return result.data;
  };

  const requireUser = async (req: FastifyRequest): Promise<AuthedUser> => {
    const header = req.headers.authorization;
    if (!header || !/^bearer\s+\S+/i.test(header)) throw new AppError('AUTH_REQUIRED', 'Sign in required.');
    let session: Awaited<ReturnType<Auth['api']['getSession']>>;
    try {
      session = await auth.api.getSession({ headers: new Headers({ authorization: header }) });
    } catch {
      session = null;
    }
    if (!session?.user) throw new AppError('AUTH_REQUIRED', 'Session expired. Please sign in again.');
    return { id: session.user.id, email: session.user.email };
  };

  const blockedPatterns = (): string[] =>
    (db.prepare('SELECT pattern FROM blocked_hosts').all() as Array<{ pattern: string }>).map((r) => r.pattern);

  const assertNotBlocked = (host: string | undefined, what: string): void => {
    if (!host) return;
    if (blockedPatterns().some((p) => hostMatches(host, p))) {
      throw new AppError('INSTITUTION_BLOCKED', `Access from ${what} is not available.`);
    }
  };

  /** Only email addresses the owner approved (admin CLI: email:allow) may use the AI. */
  const isApproved = (email: string): boolean =>
    db.prepare('SELECT 1 FROM allowed_emails WHERE email = ?').get(email.toLowerCase()) !== undefined;

  // An approved address gets the daily budget and nothing else: no weekly or monthly cap. Everyone else has 0.
  const limitsInfo = (user: AuthedUser): LimitsInfo => {
    const approved = isApproved(user.email);
    const day = ledger.userDay(user.id, now()).costMicro;
    const dayCap = approved ? eurToMicro(config.limits.userDailyEur) : 0;
    return {
      approved,
      day_cost_cap_eur: microToEur(dayCap),
      day_cost_remaining_eur: microToEur(Math.max(0, dayCap - day)),
    };
  };

  const period = (s: SpendTotals): UsagePeriod => ({
    requests: s.requests,
    input_tokens: s.inputTokens,
    output_tokens: s.outputTokens,
    cost_eur: microToEur(s.costMicro),
  });

  // ---------- routes ----------
  // Registered in a child plugin so they load after the rate-limit plugin; routes defined directly on
  // the root instance were added before its onRoute hook existed and were never rate limited.
  void app.register(async (app) => {

  app.get('/healthz', async () => {
    db.prepare('SELECT 1').get();
    return { ok: true, version: APP_VERSION, provider: provider.name, model: provider.model };
  });

  /**
   * Limits for every mail an address can trigger. Two counters: one per (address, IP) so a single attacker only uses
   * up their own quota, and a wider one per address as a ceiling against many IPs. The owner can still get a mail.
   */
  const allowMail = (purpose: 'signup' | 'reset', email: string, ip: string): void => {
    const hour = 3_600_000;
    if (
      !emailLimiter.allow(`${purpose}|${email}|${ip}`, config.limits.authStartPerEmailPerIpPerHour, hour, now()) ||
      !emailLimiter.allow(`${purpose}|${email}`, config.limits.authStartPerEmailPerHour, hour, now())
    ) {
      throw new AppError('RATE_LIMITED', 'Too many codes requested for this address.', 3600);
    }
  };

  /** The user id of an address that has a finished account (one with a password). */
  const accountWithPassword = (email: string): string | undefined => {
    const id = findUserId(db, email);
    return id && hasPassword(db, id) ? id : undefined;
  };

  app.post(
    '/v1/auth/signup/start',
    { config: { rateLimit: { max: config.limits.authStartPerIpPerMinute, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email } = parse(authSignupStartSchema, req.body);
      allowMail('signup', email, req.ip);
      assertNotBlocked(email.split('@')[1], 'this email domain');

      // Always 204: the answer does not reveal which addresses exist. The mailbox owner learns it from the mail.
      if (accountWithPassword(email)) await mailer.sendAccountExists(email);
      else await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
      return reply.status(204).send();
    }
  );

  app.post(
    '/v1/auth/signup',
    { config: { rateLimit: { max: config.limits.authVerifyPerIpPerMinute, timeWindow: '1 minute' } } },
    async (req): Promise<AuthVerifyResponse> => {
      const body = parse(authSignupSchema, req.body); // a bad password is rejected before the code is used up
      assertNotBlocked(body.email.split('@')[1], 'this email domain');
      let res: Awaited<ReturnType<Auth['api']['signInEmailOTP']>>;
      try {
        res = await auth.api.signInEmailOTP({ body: { email: body.email, otp: body.code } });
      } catch (err) {
        req.log.info({ err }, 'sign-up code rejected');
        throw new AppError('INVALID_CODE', 'This code is invalid or expired.');
      }
      // Only someone who received the code learns that the account exists; the password is not replaced
      if (hasPassword(db, res.user.id)) {
        db.prepare('DELETE FROM session WHERE token = ?').run(res.token);
        throw new AppError('ACCOUNT_EXISTS', 'An account with this email address already exists. Sign in instead.');
      }
      await setUserPassword(auth, db, res.user.id, body.password);
      return { token: res.token, user: { id: res.user.id, email: res.user.email } };
    }
  );

  app.post(
    '/v1/auth/reset/start',
    { config: { rateLimit: { max: config.limits.authStartPerIpPerMinute, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email } = parse(authResetStartSchema, req.body);
      allowMail('reset', email, req.ip);
      assertNotBlocked(email.split('@')[1], 'this email domain');
      // Always 204; a code is only sent when there is a password to reset
      if (accountWithPassword(email)) await auth.api.requestPasswordResetEmailOTP({ body: { email } });
      return reply.status(204).send();
    }
  );

  app.post(
    '/v1/auth/reset',
    { config: { rateLimit: { max: config.limits.authVerifyPerIpPerMinute, timeWindow: '1 minute' } } },
    async (req): Promise<AuthVerifyResponse> => {
      const body = parse(authResetSchema, req.body); // a bad password is rejected before the code is used up
      assertNotBlocked(body.email.split('@')[1], 'this email domain');
      const userId = accountWithPassword(body.email);
      try {
        if (!userId) throw new Error('no account with a password');
        await auth.api.resetPasswordEmailOTP({ body: { email: body.email, otp: body.code, password: body.password } });
      } catch (err) {
        req.log.info({ err }, 'reset code rejected');
        throw new AppError('INVALID_CODE', 'This code is invalid or expired.');
      }
      // Every other device is signed out (someone else may have had the password); a lock from wrong guesses ends
      db.prepare('DELETE FROM session WHERE userId = ?').run(userId);
      loginFailures.clear(body.email);
      const res = await auth.api.signInEmail({ body: { email: body.email, password: body.password } });
      return { token: res.token, user: { id: res.user.id, email: res.user.email } };
    }
  );

  app.post(
    '/v1/auth/login',
    { config: { rateLimit: { max: config.limits.authVerifyPerIpPerMinute, timeWindow: '1 minute' } } },
    async (req): Promise<AuthVerifyResponse> => {
      const body = parse(authLoginSchema, req.body);
      assertNotBlocked(body.email.split('@')[1], 'this email domain');
      // Per account, whatever the IP: only wrong passwords count, so the lock lasts at most 15 minutes after the last
      // wrong guess.
      const failuresMax = config.limits.loginFailuresPer15Min;
      const failuresWindowMs = 900_000;
      if (loginFailures.count(body.email, failuresWindowMs, now()) >= failuresMax) {
        throw new AppError('RATE_LIMITED', 'Too many failed attempts. Try again in 15 minutes.', 900);
      }
      try {
        const res = await auth.api.signInEmail({ body: { email: body.email, password: body.password } });
        return { token: res.token, user: { id: res.user.id, email: res.user.email } };
      } catch (err) {
        loginFailures.allow(body.email, Number.MAX_SAFE_INTEGER, failuresWindowMs, now());
        req.log.info({ err }, 'password rejected');
        throw new AppError('INVALID_CODE', 'Email or password is incorrect.');
      }
    }
  );

  app.post('/v1/auth/logout', async (req, reply) => {
    await requireUser(req);
    try {
      await auth.api.signOut({ headers: new Headers({ authorization: req.headers.authorization! }) });
    } catch {
      // already signed out
    }
    return reply.status(204).send();
  });

  app.get('/v1/me', async (req): Promise<MeResponse> => {
    const user = await requireUser(req);
    return {
      user,
      limits: limitsInfo(user),
      usage_today: period(ledger.userDay(user.id, now())),
      usage_month: period(ledger.userMonth(user.id, now())),
    };
  });

  app.get('/v1/usage', async (req) => {
    const user = await requireUser(req);
    const rows = db
      .prepare(
        `SELECT day, COUNT(*) AS requests, SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens, SUM(cost_micro_eur) AS cost
         FROM usage_events WHERE user_id = ? GROUP BY day ORDER BY day DESC LIMIT 31`
      )
      .all(user.id) as Array<{ day: string; requests: number; input_tokens: number; output_tokens: number; cost: number }>;
    return {
      days: rows.map((r) => ({
        day: r.day,
        requests: r.requests,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        cost_eur: microToEur(r.cost),
      })),
    };
  });

  app.delete('/v1/me', async (req, reply) => {
    const user = await requireUser(req);
    db.transaction(() => {
      db.prepare('DELETE FROM session WHERE userId = ?').run(user.id);
      db.prepare('DELETE FROM account WHERE userId = ?').run(user.id);
      // instr(): a plain substring match (LIKE would treat '_' and '%' in an address as wildcards)
      db.prepare('DELETE FROM verification WHERE instr(identifier, ?) > 0').run(user.email);
      db.prepare('DELETE FROM user WHERE id = ?').run(user.id);
      db.prepare('DELETE FROM allowed_emails WHERE email = ?').run(user.email);
      ledger.anonymizeUser(user.id);
    })();
    return reply.status(204).send();
  });

  app.post('/v1/generate', async (req: FastifyRequest, reply: FastifyReply): Promise<GenerateResponse> => {
    const user = await requireUser(req);
    if (!isApproved(user.email)) {
      throw new AppError('NOT_APPROVED', 'Your account is not approved for AI answers yet. Ask the owner to approve your email address.');
    }
    const body = parse(generateSchema, req.body);
    const t0 = now();

    const clientVersion = String(req.headers[CLIENT_VERSION_HEADER] ?? body.client.version ?? '0.0.0');
    if (versionLessThan(clientVersion, config.minClientVersion)) {
      throw new AppError('UPGRADE_REQUIRED', `Please update the extension (minimum version ${config.minClientVersion}).`);
    }
    assertNotBlocked(body.client.brightspace_host, 'this institution');
    assertNotBlocked(user.email.split('@')[1], 'this email domain');

    const inputEstimate = estimateInputTokens(body);
    if (inputEstimate > config.limits.maxInputTokens) {
      throw new AppError(
        'PAYLOAD_TOO_LARGE',
        `Context is too large (~${inputEstimate} tokens, maximum ${config.limits.maxInputTokens}).`
      );
    }
    const maxOut = Math.min(body.max_output_tokens ?? config.limits.maxOutputTokens, config.limits.maxOutputTokens);
    const estimateMicro = pricing.costMicroEur(inputEstimate, maxOut);

    const dayCap = eurToMicro(config.limits.userDailyEur); // approved: checked at the top
    const globalCap = eurToMicro(config.limits.globalDailyEur);
    if (estimateMicro > dayCap) {
      throw new AppError('PAYLOAD_TOO_LARGE', 'This request is too large for your daily budget. Select fewer documents.');
    }

    const wait = guard.hitRate(user.id, config.limits.userRequestsPerMinute, t0);
    if (wait !== null) throw new AppError('RATE_LIMITED', 'Too many questions in a short time.', wait);
    if (guard.concurrent(user.id) >= config.limits.userConcurrency) {
      throw new AppError('RATE_LIMITED', 'Finish your running question first.', 5);
    }

    const reserved = guard.reserved(user.id);
    const dayUsed = ledger.userDay(user.id, t0).costMicro;
    if (dayUsed + reserved.user + estimateMicro > dayCap) {
      throw new AppError('DAILY_LIMIT', 'Daily limit reached.', secondsUntilNextDay(t0, config.timeZone));
    }
    const globalUsed = ledger.globalDay(t0).costMicro;
    if (globalUsed + reserved.global + estimateMicro > globalCap) {
      req.log.warn({ globalUsed, globalCap }, 'global daily budget reached');
      throw new AppError('CAPACITY', 'The service is at capacity. Try again later.', Math.min(3600, secondsUntilNextDay(t0, config.timeZone)));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.providerTimeoutMs);
    let clientGone = false;
    const onClose = () => {
      if (!reply.sent) {
        clientGone = true;
        controller.abort();
      }
    };
    req.raw.once('close', onClose);

    guard.begin(user.id, estimateMicro);
    try {
      const out = await provider.generate({
        system: systemPromptForRequest(body),
        turns: buildTurns(body),
        maxOutputTokens: maxOut,
        temperature: 0.15,
        signal: controller.signal,
      });
      const inputTokens = out.inputTokens || inputEstimate;
      const outputTokens = out.outputTokens || Math.ceil(out.text.length / 4);
      ledger.record(
        {
          userId: user.id,
          requestId: req.id,
          kind: body.kind,
          provider: provider.name,
          model: provider.model,
          inputTokens,
          outputTokens,
          costMicro: pricing.costMicroEur(inputTokens, outputTokens),
          status: 'ok',
        },
        now()
      );
      return {
        request_id: req.id,
        text: out.text,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        limits: limitsInfo(user),
      };
    } catch (err: any) {
      // A cancelled/timed-out call may still have been billed for its input: count that.
      const aborted = controller.signal.aborted;
      ledger.record(
        {
          userId: user.id,
          requestId: req.id,
          kind: body.kind,
          provider: provider.name,
          model: provider.model,
          inputTokens: aborted ? inputEstimate : 0,
          outputTokens: 0,
          costMicro: aborted ? pricing.costMicroEur(inputEstimate, 0) : 0,
          status: 'error',
        },
        now()
      );
      if (clientGone) throw new AppError('UPSTREAM_ERROR', 'Request cancelled.');
      if (err instanceof ProviderError) {
        req.log.warn({ kind: err.kind, status: err.status }, 'provider failure');
        if (err.kind === 'RATE_LIMITED') {
          throw new AppError('CAPACITY', 'The AI service is busy. Try again shortly.', err.retryAfterSeconds ?? 30);
        }
        throw new AppError('UPSTREAM_ERROR', 'The AI service returned an error. Try again.');
      }
      if (aborted) throw new AppError('UPSTREAM_ERROR', 'The AI service took too long to respond.');
      throw err;
    } finally {
      clearTimeout(timeout);
      req.raw.off('close', onClose);
      guard.end(user.id, estimateMicro);
    }
  });

  });

  return app;
}

