import type { RuleCaptureRequest, RuleConflictReport } from '../../shared/types/briefRules.js';

/**
 * Phase 5 stub — always returns an empty conflict report.
 * Phase 6 replaces this implementation with an LLM-backed overlap detector.
 * The call site in ruleCaptureService does not change between phases.
 */
export async function check(
  _request: RuleCaptureRequest,
): Promise<RuleConflictReport> {
  return {
    conflicts: [],
    checkedAt: new Date().toISOString(),
  };
}
