// Phase 5 / W2b — Pure data-transform helpers for ApprovalCard.

import type { BriefApprovalCard, BriefApprovalRiskLevel } from '../../../../shared/types/briefResultContract.js';

export const RISK_BORDER_STYLES: Record<BriefApprovalRiskLevel, string> = {
  low: 'border-blue-200 bg-blue-50',
  medium: 'border-yellow-200 bg-yellow-50',
  high: 'border-red-200 bg-red-50',
};

export const RISK_BADGE_STYLES: Record<BriefApprovalRiskLevel, string> = {
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
};

/**
 * Returns true when the approval action buttons should be suppressed.
 * Superseded cards and cards in a terminal/in-flight execution state are disabled.
 */
export function deriveIsDisabled(
  artefact: Pick<BriefApprovalCard, 'executionStatus'>,
  isSuperseded?: boolean,
): boolean {
  return (
    !!isSuperseded ||
    artefact.executionStatus === 'completed' ||
    artefact.executionStatus === 'running'
  );
}

/**
 * Returns the Tailwind border + background class string for the card container.
 */
export function deriveRiskContainerStyle(riskLevel: BriefApprovalRiskLevel): string {
  return RISK_BORDER_STYLES[riskLevel] ?? RISK_BORDER_STYLES.medium;
}

/**
 * Returns a human-readable affected-record count label, or null for zero records.
 */
export function deriveAffectedLabel(affectedCount: number): string | null {
  if (affectedCount === 0) return null;
  return `Affects ${affectedCount} record${affectedCount !== 1 ? 's' : ''}`;
}
