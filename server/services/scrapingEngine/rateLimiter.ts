// Per-domain rate limiter — best-effort, single-instance only.
// In a multi-process deployment, limits apply per-process, not globally.
// A shared backing store (Redis or Postgres) is deferred to a future phase
// when horizontal scaling is needed.

const MAX_REQUESTS_PER_MINUTE = 10;
const MAX_REQUESTS_PER_HOUR = 100;
const MINUTE_WINDOW_MS = 60_000;
const HOUR_WINDOW_MS = 3_600_000;

interface DomainBucket {
  minuteCount: number;
  minuteWindowStart: number;
  hourCount: number;
  hourWindowStart: number;
}

const buckets = new Map<string, DomainBucket>();

export function checkRateLimit(domain: string, orgId: string): { allowed: boolean; retryAfterMs?: number } {
  const key = `${orgId}:${domain}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket) {
    buckets.set(key, {
      minuteCount: 1,
      minuteWindowStart: now,
      hourCount: 1,
      hourWindowStart: now,
    });
    return { allowed: true };
  }

  // Reset expired windows
  if (now - bucket.minuteWindowStart > MINUTE_WINDOW_MS) {
    bucket.minuteCount = 0;
    bucket.minuteWindowStart = now;
  }
  if (now - bucket.hourWindowStart > HOUR_WINDOW_MS) {
    bucket.hourCount = 0;
    bucket.hourWindowStart = now;
  }

  if (bucket.minuteCount >= MAX_REQUESTS_PER_MINUTE) {
    const retryAfterMs = MINUTE_WINDOW_MS - (now - bucket.minuteWindowStart);
    return { allowed: false, retryAfterMs };
  }

  if (bucket.hourCount >= MAX_REQUESTS_PER_HOUR) {
    const retryAfterMs = HOUR_WINDOW_MS - (now - bucket.hourWindowStart);
    return { allowed: false, retryAfterMs };
  }

  bucket.minuteCount++;
  bucket.hourCount++;
  return { allowed: true };
}
