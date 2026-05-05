// Pure helpers for the staleness sweep — no DB, no framework.
//
// Extracted so `*Pure.test.ts` can import the parsing/predicate logic without
// transitively pulling in `db`, satisfying the §7 / verify-pure-helper-convention
// gate. The IO module (`staleTriageSweep.ts`) re-imports these helpers.

// Pure: parse SYSTEM_MONITOR_TRIAGE_STALE_AFTER_MINUTES with explicit NaN /
// non-positive guards. `parseInt('', 10)` returns NaN, and `??` only catches
// null/undefined — so a malformed env value (e.g. `''`, `'abc'`, `'0'`, `'-5'`)
// would silently produce NaN minutes and disable the sweep. Always fall back
// to the default in that case.
export function parseStaleAfterMinutesEnv(
  raw: string | undefined = process.env.SYSTEM_MONITOR_TRIAGE_STALE_AFTER_MINUTES,
): number {
  const DEFAULT_MINUTES = 10;
  if (raw === undefined || raw === '') return DEFAULT_MINUTES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MINUTES;
  return parsed;
}

// Pure: cutoff = now - staleAfterMs. A row's lastTriageAttemptAt is "stale"
// iff it is strictly less than the cutoff. Equality is not stale.
export function staleCutoff(now: Date, staleAfterMs: number): Date {
  return new Date(now.getTime() - staleAfterMs);
}
