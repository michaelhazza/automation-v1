export const AMENDMENT_KINDS = ['instruction_extension', 'example', 'guardrail', 'context_fact', 'exception'] as const;
export type AmendmentKind = typeof AMENDMENT_KINDS[number];

export const AMENDMENT_STATUSES = ['draft', 'pending_review', 'accepted', 'rejected', 'retired'] as const;
export type AmendmentStatus = typeof AMENDMENT_STATUSES[number];

export const AMENDMENT_SOURCES = ['agent_proposed_from_failure', 'operator_manual'] as const;
export type AmendmentSource = typeof AMENDMENT_SOURCES[number];

export const RETIREMENT_REASONS = ['graceful', 'rollback', 'stale', 'superseded', 'baseline_reset'] as const;
export type RetirementReason = typeof RETIREMENT_REASONS[number];

export const REJECT_REASONS = ['incorrect_root_cause', 'redundant', 'unsafe', 'other'] as const;
export type RejectReason = typeof REJECT_REASONS[number];

export const BLAST_RADII = ['low', 'medium', 'high'] as const;
export type BlastRadius = typeof BLAST_RADII[number];

export const FREEZE_SCOPES = ['org', 'subaccount', 'skill'] as const;
export type FreezeScope = typeof FREEZE_SCOPES[number];

export const FREEZE_TYPES = ['proposal_generation', 'amendment_activation', 'review_required'] as const;
export type FreezeType = typeof FREEZE_TYPES[number];

export const INCIDENT_SEVERITIES = ['sev1', 'sev2'] as const;
export type IncidentSeverity = typeof INCIDENT_SEVERITIES[number];

// ─── API response types ───────────────────────────────────────────────────────

export interface AmendmentListItem {
  id: string;
  kind: AmendmentKind;
  status: AmendmentStatus;
  skillSlug: string;
  blastRadiusEstimate: BlastRadius;
  incidentSeverity: IncidentSeverity | null;
  occurrenceCount: number;
  failureMode: string | null;
  proposedRemedyKind: AmendmentKind | null;
  createdAt: string;
}

export interface AmendmentDetail extends AmendmentListItem {
  body: string;
  source: AmendmentSource;
  confidence: number | null;
  peerReviewerVerdict: boolean | null;
  peerReviewerReasoning: string | null;
  rcaJson: Record<string, unknown> | null;
  lineageRootId: string | null;
  versionNumber: number;
  subaccountId: string;
}

export interface StackHealthMetrics {
  amendmentDensity: number;
  conflictRate: number;
  rollbackRate: number;
  staleRatio: number;
  editFrequency: number;
  compositionSizeTrend: number;
}

export interface AmendmentSkillDetail {
  id: string;
  kind: AmendmentKind;
  status: AmendmentStatus;
  body: string;
  source: AmendmentSource;
  blastRadiusEstimate: BlastRadius;
  confidence: number | null;
  versionNumber: number;
  lineageRootId: string | null;
  activatedAt: string | null;
  retiredAt: string | null;
  retirementReason: RetirementReason | null;
  rejectedAt: string | null;
  rejectReason: RejectReason | null;
  createdAt: string;
}
