import type { NewHarnessRunHistory } from '../../db/schema/harnessRunHistory.js';

/**
 * Closed outcome enum for a harness run (spec §6.3).
 * Exactly 5 values; adding a 6th requires a spec amendment.
 */
export type HarnessOutcome =
  | 'pass'
  | 'fail'
  | 'baseline_established'
  | 'site_unavailable'
  | 'parse_error';

/**
 * Closed mode enum matching the harness_run_history.mode CHECK constraint.
 */
export type HarnessMode = 'blocking' | 'nightly' | 'advisory' | 'disabled';

/**
 * Input shape for a completed harness run (spec §6.3).
 * `baselineScore` and `baselineTolerance` are nullable for all outcomes.
 */
export interface HarnessRunResult {
  siteSlug: string;
  mode: HarnessMode;
  score: number | null;
  baselineScore: number | null;
  baselineTolerance: number | null;
  outcome: HarnessOutcome;
  browserVersion: string;
  playwrightVersion: string;
  templateDigest: string;
}

const REQUIRED_FIELDS: Array<keyof HarnessRunResult> = [
  'siteSlug',
  'mode',
  'outcome',
  'browserVersion',
  'playwrightVersion',
  'templateDigest',
];

/**
 * Converts a `HarnessRunResult` to the Drizzle insert shape for
 * `harness_run_history`. Throws if any required field is missing or empty.
 */
export function toRow(result: HarnessRunResult): NewHarnessRunHistory {
  const missingFields = REQUIRED_FIELDS.filter(
    (field) => result[field] === undefined || result[field] === null || result[field] === '',
  );
  if (missingFields.length > 0) {
    throw new Error(
      'harnessHistoryWriterPure: invalid result shape: ' + JSON.stringify(missingFields),
    );
  }

  return {
    siteSlug:          result.siteSlug,
    mode:              result.mode,
    score:             result.score !== null ? String(result.score) : null,
    baselineScore:     result.baselineScore !== null ? String(result.baselineScore) : null,
    baselineTolerance: result.baselineTolerance !== null ? String(result.baselineTolerance) : null,
    outcome:           result.outcome,
    browserVersion:    result.browserVersion,
    playwrightVersion: result.playwrightVersion,
    templateDigest:    result.templateDigest,
  };
}
