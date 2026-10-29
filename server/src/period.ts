/** Day/month keys in the configured time zone, so limits reset at local midnight. */
export function dayKey(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
}

export function monthKey(ts: number, timeZone: string): string {
  return dayKey(ts, timeZone).slice(0, 7);
}

/** Seconds until the next local midnight (rounded up, at least 1). */
export function secondsUntilNextDay(ts: number, timeZone: string): number {
  const today = dayKey(ts, timeZone);
  let lo = ts;
  let hi = ts + 36 * 3600 * 1000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKey(mid, timeZone) === today) lo = mid;
    else hi = mid;
  }
  return Math.max(1, Math.ceil((hi - ts) / 1000));
}

/** Seconds until the first moment of the next local month (rounded up, at least 1). */
