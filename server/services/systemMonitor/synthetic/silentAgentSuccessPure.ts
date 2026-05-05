// Pure helpers for the silent-agent-success synthetic check — no DB, no framework.
//
// Extracted so `*Pure.test.ts` can import the predicate / parsing logic without
// transitively pulling in `db`, satisfying the §7 / verify-pure-helper-convention
// gate. The IO module (`silentAgentSuccess.ts`) re-imports these helpers.

export const SILENT_AGENT_SUCCESS_LOOKBACK_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_RATIO_THRESHOLD = 0.30;
const DEFAULT_MIN_SAMPLES = 5;

// Pure: predicate. true iff the silent-run ratio is at-or-above the threshold AND
// we have enough samples to draw a conclusion. Below `minSamples` we return false
// regardless of ratio (avoid firing on a single sample).
export function isSilentAgentRatioElevated(
  totalCompleted: number,
  silentCount: number,
  ratioThreshold: number,
  minSamples: number,
): boolean {
  if (totalCompleted < minSamples) return false;
  if (totalCompleted <= 0) return false;
  return silentCount / totalCompleted >= ratioThreshold;
}

// Pure: parse SYSTEM_MONITOR_SILENT_SUCCESS_RATIO_THRESHOLD with NaN / non-positive
// guards. Mirrors parseStaleAfterMinutesEnv to prevent a malformed env value from
// silently disabling the check.
export function parseRatioThresholdEnv(
  raw: string | undefined = process.env.SYSTEM_MONITOR_SILENT_SUCCESS_RATIO_THRESHOLD,
): number {
  if (raw === undefined || raw === '') return DEFAULT_RATIO_THRESHOLD;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RATIO_THRESHOLD;
  return parsed;
}

// Pure: parse SYSTEM_MONITOR_SILENT_SUCCESS_MIN_SAMPLES with NaN / non-positive guards.
export function parseMinSamplesEnv(
  raw: string | undefined = process.env.SYSTEM_MONITOR_SILENT_SUCCESS_MIN_SAMPLES,
): number {
  if (raw === undefined || raw === '') return DEFAULT_MIN_SAMPLES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MIN_SAMPLES;
  return parsed;
}
