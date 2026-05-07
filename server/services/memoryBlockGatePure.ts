export interface AutoExtractGateInput {
  autoUpdateDisabled: boolean;
  /** True if the freshly-extracted content equals the live body (no change). */
  contentUnchanged: boolean;
}

export interface AutoExtractGateResult {
  skipUpdate: boolean;
  skipVersionInsert: boolean;
  reason: 'override_locked' | 'no_change' | 'allowed';
}

/**
 * Returns the skip decision for the auto-extraction pipeline.
 * Override-locked rows always skip both writes.
 * Unchanged content also skips both (existing semantics preserved).
 */
export function evaluateAutoExtractGate(
  input: AutoExtractGateInput,
): AutoExtractGateResult {
  if (input.autoUpdateDisabled) {
    return { skipUpdate: true, skipVersionInsert: true, reason: 'override_locked' };
  }
  if (input.contentUnchanged) {
    return { skipUpdate: true, skipVersionInsert: true, reason: 'no_change' };
  }
  return { skipUpdate: false, skipVersionInsert: false, reason: 'allowed' };
}
