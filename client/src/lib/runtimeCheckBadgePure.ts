/**
 * client/src/lib/runtimeCheckBadgePure.ts
 *
 * Pure (no React, no network) helpers for runtime-check badge rendering.
 * Mirror of server-side collapseToOperatorBadge in runtimeCheckServicePure.ts.
 * Spec: tasks/builds/trust-verification-layer/spec.md §6.2, §14.
 *
 * F6 invariant: collapseToOperatorBadge is the ONLY render-time projection
 * from internal RuntimeCheckState to operator-visible badge.
 * Do NOT use this for analytics — always use the raw state from the schema.
 * @analytics-internal-state
 */

import type { RuntimeCheckState, RuntimeCheckResult, RuntimeCheckOperatorBadge } from '../../../shared/types/runtimeCheck';

/**
 * Maps the five internal runtime-check states to the three operator-visible
 * badge values. Mirror of server-side runtimeCheckServicePure.collapseToOperatorBadge.
 *
 *   pass            → pass
 *   fail            → fail
 *   inconclusive    → pending
 *   pending         → pending
 *   not_applicable  → pending
 */
export function collapseToOperatorBadge(state: RuntimeCheckState): RuntimeCheckOperatorBadge {
  switch (state) {
    case 'pass':
      return 'pass';
    case 'fail':
      return 'fail';
    case 'inconclusive':
    case 'pending':
    case 'not_applicable':
      return 'pending';
  }
}

/**
 * Format a tooltip description for a runtime-check badge.
 * State 'pass'  → 'Check passed'
 * State 'fail'  → reasonText + optional suggested fix
 * Otherwise     → reasonText or 'Check pending'
 */
export function formatBadgeTooltip(
  result: Pick<RuntimeCheckResult, 'state' | 'reasonText' | 'suggestedFix'>,
): string {
  if (result.state === 'pass') {
    return 'Check passed';
  }
  if (result.state === 'fail') {
    const base = result.reasonText;
    return result.suggestedFix ? `${base}\nSuggested fix: ${result.suggestedFix}` : base;
  }
  return result.reasonText || 'Check pending';
}
