/**
 * agentActivityServicePure — pure helpers extracted from agentActivityService.
 * No DB / env dependencies; importable in unit tests without DATABASE_URL.
 */

/**
 * Coerce a raw SQL count(*) aggregate to a non-negative integer.
 * count(*) returns null when no rows exist in Drizzle's typed result; this
 * helper guarantees eventCount is always a number (0 if null/undefined).
 */
export function coerceEventCount(raw: number | null | undefined): number {
  return raw ?? 0;
}
