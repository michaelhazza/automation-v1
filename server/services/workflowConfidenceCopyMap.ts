/**
 * workflowConfidenceCopyMap — static copy for confidence chip labels and reasons.
 *
 * Pure constant — no imports, no side effects.
 */

export type ConfidenceKey =
  | 'many_past_runs_no_clamps'
  | 'next_step_critical'
  | 'irreversible_side_effect'
  | 'upstream_low_confidence'
  | 'first_use_in_subaccount'
  | 'few_past_runs_mixed';

export const CONFIDENCE_COPY: Record<ConfidenceKey, { chip: 'High' | 'Medium' | 'Low'; reason: string }> = {
  many_past_runs_no_clamps:  { chip: 'High',   reason: 'matches recent successful runs' },
  next_step_critical:        { chip: 'Medium', reason: "the next step can't be undone, worth a careful look" },
  irreversible_side_effect:  { chip: 'Medium', reason: "this can't be undone once it runs" },
  upstream_low_confidence:   { chip: 'Low',    reason: "the agent isn't sure about this one" },
  first_use_in_subaccount:   { chip: 'Low',    reason: 'first time running this here' },
  few_past_runs_mixed:       { chip: 'Medium', reason: "still learning what's normal here" },
};
