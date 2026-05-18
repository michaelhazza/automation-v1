// Pure predicate — stale-retire cutoff check.
// An amendment is stale if it was created more than 14 days before `now`.
// The 14-day boundary is spec §10 (evaluation harness).

const STALE_DAYS = 14;
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

export function isStale(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > STALE_MS;
}
