// Truly side-effect-free routing decision. Extracted so unit tests can
// import it without pulling in the DB layer.

import type { FastPathDecision } from '../../shared/types/briefFastPath.js';

export type DispatchRoute =
  | 'simple_reply'
  | 'orchestrator'
  | 'frequency_capped'
  | 'concurrency_capped';

/**
 * Pure routing decision: given the LLM classification and cap state, which
 * dispatch path should be taken? Frequency cap takes precedence over concurrency
 * cap when both are exceeded (per spec §4.5.3 cap precedence rule).
 */
export function selectDispatchRoute(
  route: FastPathDecision['route'],
  capState: { frequencyCapHit: boolean; concurrencyCapHit: boolean },
): DispatchRoute {
  if (route === 'simple_reply' || route === 'cheap_answer') return 'simple_reply';
  if (capState.frequencyCapHit) return 'frequency_capped';
  if (capState.concurrencyCapHit) return 'concurrency_capped';
  return 'orchestrator';
}
