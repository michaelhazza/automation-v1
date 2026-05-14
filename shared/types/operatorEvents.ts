// New event variant types for personal-assistant-v2-operator.
//
// These are AgentExecutionEvent variants (logged in agentExecutionLog.ts),
// NOT operator-session lifecycle events (which live in operatorBackendEvents.ts).

export type OperatorFileEventType = 'file.created' | 'file.modified';
export type CrossOwnerSubstepEventType =
  | 'cross_owner_substep.awaiting_initiator_decision'
  | 'cross_owner_substep.completed';

export type PersonalAssistantV2EventType = OperatorFileEventType | CrossOwnerSubstepEventType;

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

export interface FileCreatedPayload {
  eventType: 'file.created';
  agentRunId: string;
  path: string;
  version: 1;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  storageKey: string;
  emittedBy: 'tool_call' | 'watcher';
  /** Executor's owner; null for subaccount-owned agents. Spec §9.4. */
  ownerUserId: string | null;
}

export interface FileModifiedPayload {
  eventType: 'file.modified';
  agentRunId: string;
  path: string;
  /** Always > 1 for a modification. */
  version: number;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  storageKey: string;
  emittedBy: 'tool_call' | 'watcher';
  /** Executor's owner; null for subaccount-owned agents. Spec §9.4. */
  ownerUserId: string | null;
}

export interface CrossOwnerSubstepAwaitingPayload {
  eventType: 'cross_owner_substep.awaiting_initiator_decision';
  /** Run that owns the cross-owner delegation. */
  parent_run_id: string;
  /** delegation_outcomes.id for this sub-step. */
  substep_id: string;
  initiatorUserId: string;
  reason: 'cross_owner_approval_timeout';
}

export interface CrossOwnerSubstepCompletedPayload {
  eventType: 'cross_owner_substep.completed';
  /** Run that owns the cross-owner delegation. */
  parent_run_id: string;
  /** delegation_outcomes.id for this sub-step. */
  substep_id: string;
  status: 'success' | 'partial' | 'failed';
  /** Optional typed reason for non-success outcomes. */
  reason?: string;
}
