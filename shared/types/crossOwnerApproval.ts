// CrossOwnerApprovalTimeoutPolicy — personal-assistant-v2-operator spec §5.6

export type CrossOwnerApprovalTimeoutPolicy =
  | 'fail_parent'
  | 'continue_without_substep'
  | 'ask_initiator';

export const DEFAULT_CROSS_OWNER_APPROVAL_TIMEOUT_POLICY: CrossOwnerApprovalTimeoutPolicy =
  'fail_parent';

// Pause-reason constants (spec §5.6)
export const PAUSE_REASON_AWAITING_CROSS_OWNER_APPROVAL = 'awaiting_cross_owner_approval';
export const PAUSE_REASON_AWAITING_INITIATOR_DECISION =
  'awaiting_initiator_decision_after_cross_owner_timeout';
