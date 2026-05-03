/**
 * workflowConfidenceCopyMap — plain-language copy for each confidence heuristic key.
 *
 * Spec: docs/workflows-dev-spec.md §6.2.
 *
 * No engineering jargon. No em-dashes. Operator-readable strings only.
 */

export type ConfidenceKey =
  | 'many_similar_past_runs'
  | 'is_critical_next_step'
  | 'irreversible_side_effect'
  | 'cascade_from_low_confidence'
  | 'first_use_in_subaccount'
  | 'few_past_runs_mixed_history';

export const CONFIDENCE_COPY_MAP: Record<
  ConfidenceKey,
  { value: 'high' | 'medium' | 'low'; reason: string }
> = {
  many_similar_past_runs: {
    value: 'high',
    reason: 'matches recent successful runs',
  },
  is_critical_next_step: {
    value: 'medium',
    reason: "the next step can't be undone, worth a careful look",
  },
  irreversible_side_effect: {
    value: 'medium',
    reason: "this can't be undone once it runs",
  },
  cascade_from_low_confidence: {
    value: 'low',
    reason: "the agent isn't sure about this one",
  },
  first_use_in_subaccount: {
    value: 'low',
    reason: 'first time running this here',
  },
  few_past_runs_mixed_history: {
    value: 'medium',
    reason: "still learning what's normal here",
  },
};
