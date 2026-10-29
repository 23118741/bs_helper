/**
 * server/src/ledger.ts
 * Usage ledger (cost in integer micro-EUR) and the limit checks built on it. The ledger is
 * deliberately the single source of truth for spending, so a later credit balance can be
 * derived from it.
 */

import type { Config } from './config.js';
import type { Db } from './db.js';
import { dayKey, monthKey } from './period.js';

export interface SpendTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costMicro: number;
}

export interface UsageRecord {
  userId: string;
  requestId: string;
  kind?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicro: number;
  status: 'ok' | 'error';
}

export class Ledger {
  constructor(
    private readonly db: Db,
    private readonly config: Pick<Config, 'timeZone'>
  ) {}

  record(r: UsageRecord, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO usage_events (user_id, ts, day, month, request_id, kind, provider, model,
           input_tokens, output_tokens, cost_micro_eur, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        r.userId,
        now,
        dayKey(now, this.config.timeZone),
        monthKey(now, this.config.timeZone),
        r.requestId,
        r.kind ?? null,
        r.provider,
        r.model,
        r.inputTokens,
        r.outputTokens,
        r.costMicro,
        r.status
      );
  }

  private totals(where: string, ...params: unknown[]): SpendTotals {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS requests,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens,
                COALESCE(SUM(cost_micro_eur), 0) AS costMicro
         FROM usage_events WHERE ${where}`
      )
      .get(...params) as SpendTotals;
    return row;
  }

  userDay(userId: string, now = Date.now()): SpendTotals {
    return this.totals('user_id = ? AND day = ?', userId, dayKey(now, this.config.timeZone));
  }

  userMonth(userId: string, now = Date.now()): SpendTotals {
    return this.totals('user_id = ? AND month = ?', userId, monthKey(now, this.config.timeZone));
  }

  globalDay(now = Date.now()): SpendTotals {
    return this.totals('day = ?', dayKey(now, this.config.timeZone));
  }

  /** GDPR: keep cost accounting but drop the link to the person. */
  anonymizeUser(userId: string): void {
    this.db.prepare("UPDATE usage_events SET user_id = 'deleted' WHERE user_id = ?").run(userId);
  }
}

/**
 * In-memory guards for what changes within seconds: requests per minute, in-flight requests
 * and money reserved for requests that are still running. One process, so a Map is enough.
 */
export class InflightGuard {
  private readonly windows = new Map<string, number[]>();
  private readonly inflight = new Map<string, number>();
  private reservedGlobalMicro = 0;
  private readonly reservedUserMicro = new Map<string, number>();

  /** Registers a request in the per-minute window; returns seconds to wait if over the limit. */
  hitRate(userId: string, limitPerMinute: number, now = Date.now()): number | null {
    const windowStart = now - 60_000;
    if (this.windows.size > 1000) this.sweepWindows(windowStart);
    const hits = (this.windows.get(userId) ?? []).filter((t) => t > windowStart);
    if (hits.length >= limitPerMinute) {
      this.windows.set(userId, hits);
      return Math.max(1, Math.ceil((hits[0] + 60_000 - now) / 1000));
    }
    hits.push(now);
    this.windows.set(userId, hits);
    return null;
  }

  /** Drops users whose last hit is outside the window, so the map cannot grow without bound. */
  private sweepWindows(windowStart: number): void {
    for (const [id, hits] of this.windows) {
      if (hits.length === 0 || hits[hits.length - 1] <= windowStart) this.windows.delete(id);
    }
  }

  concurrent(userId: string): number {
    return this.inflight.get(userId) ?? 0;
  }

  reserved(userId: string): { user: number; global: number } {
    return { user: this.reservedUserMicro.get(userId) ?? 0, global: this.reservedGlobalMicro };
  }

  begin(userId: string, reserveMicro: number): void {
    this.inflight.set(userId, this.concurrent(userId) + 1);
    this.reservedGlobalMicro += reserveMicro;
    this.reservedUserMicro.set(userId, (this.reservedUserMicro.get(userId) ?? 0) + reserveMicro);
  }

  end(userId: string, reserveMicro: number): void {
    const n = this.concurrent(userId) - 1;
    if (n <= 0) this.inflight.delete(userId);
    else this.inflight.set(userId, n);
    this.reservedGlobalMicro = Math.max(0, this.reservedGlobalMicro - reserveMicro);
    const u = (this.reservedUserMicro.get(userId) ?? 0) - reserveMicro;
    if (u <= 0) this.reservedUserMicro.delete(userId);
    else this.reservedUserMicro.set(userId, u);
  }
}

/** Simple fixed-window counter keyed by string (used for per-email auth limits). */
export class WindowCounter {
  private readonly hits = new Map<string, number[]>();

  /** Forgets every hit of the key. */
  clear(key: string): void {
    this.hits.delete(key);
  }

  /** How many hits the key has in the window, without counting a new one. */
  count(key: string, windowMs: number, now = Date.now()): number {
    return (this.hits.get(key) ?? []).filter((t) => t > now - windowMs).length;
  }

  /** Returns true when the key is still allowed (and counts this attempt). */
  allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const start = now - windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > start);
    if (list.length >= limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    // bounded memory: drop keys that are completely stale
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.every((t) => t <= start)) this.hits.delete(k);
    }
    return true;
  }
}
