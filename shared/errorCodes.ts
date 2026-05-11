export const APP_ERROR_CODES = [
  // Phase 3 new codes
  'CROSS_TENANT_TOKEN_REFRESH',
  'MISSING_PRINCIPAL_CONTEXT',
  // Seed from existing throw-sites (closed for Phase 3)
  'BASELINE_SKIP_PRECONDITION_FAILED',
  'RESUME_TOKEN_EXPIRED',
  'RUN_NOT_FOUND',
  'OPTIMISTIC_LOCK_FAILED',
  'IEE_TASK_REQUIRED',
  'IEE_TASK_TYPE_MISMATCH',
  'OPTIMISER_SCHEDULE_AGENT_MISSING',
  'SUBACCOUNT_NOT_FOUND',
  'MISSING_SUBACCOUNT_ID',
  'MISSING_SUBACCOUNT_AGENT_ID',
  'SUBACCOUNT_AGENT_NOT_FOUND',
  // Project service codes
  'PROJECT_NOT_FOUND',
  'INVALID_LINKED_AGENT',
  'INVALID_BUDGET',
  'INVALID_NAME',
  // Integration connection codes
  'connection.status_invalid',
  // Webhook codes
  'webhook.signature_required',
  // Reference document codes
  'referenceDocument.scope_cross_org',
  // Support draft codes
  'support.draft.override_collision_human_only',
  'support.draft.scope_mismatch',
  'support.draft.preflight.ticket_status_ineligible',
  'support.draft.preflight.human_collision_blocked',
  'support.draft.preflight.customer_match_required',
  'support.draft.preflight.superseded_by_newer_draft',
  // Generic legacy adapter code emitted by asyncHandler when normalising duck-shape errors
  'LEGACY_ERROR',
] as const;
export type AppErrorCode = typeof APP_ERROR_CODES[number];
