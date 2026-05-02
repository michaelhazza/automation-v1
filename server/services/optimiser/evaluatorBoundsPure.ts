/**
 * server/services/optimiser/evaluatorBoundsPure.ts
 *
 * Pure helper: validates that a percentage/ratio value is in the expected [0, 1]
 * range before an evaluator module generates a recommendation candidate.
 *
 * Out-of-bounds values indicate upstream data corruption (e.g. cost-aggregate
 * overflow producing negative percentages, or a query bug returning values > 1).
 * Rather than crashing the run, we drop the row and emit a structured log line
 * so the issue is observable.
 *
 * Only percent/ratio fields (0..1 range) are bounds-checked here. Cents and
 * counts have no natural upper bound and are NOT validated by this helper.
 *
 * Spec: docs/sub-account-optimiser-spec.md §9 Phase 2 evaluatorBoundsPure contract.
 */

import { logger } from '../../lib/logger.js';

/**
 * Returns true when value is finite and within [0, 1].
 * Returns false (and emits a recommendations.evaluator_bounds_violation log line)
 * when value is out of bounds, NaN, or Infinity.
 *
 * @param value       The numeric value to check.
 * @param fieldName   The field name in the evidence shape (for log context).
 * @param category    The recommendation category (for log context).
 * @param source_query The query module source name (for log context).
 */
export function assertPercentInBounds(
  value: number,
  fieldName: string,
  category: string,
  source_query: string,
): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    logger.warn('recommendations.evaluator_bounds_violation', {
      category,
      field: fieldName,
      value,
      source_query,
    });
    return false;
  }
  return true;
}
