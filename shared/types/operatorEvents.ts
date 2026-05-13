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
}

export interface CrossOwnerSubstepAwaitingPayload {
  eventType: 'cross_owner_substep.awaiting_initiator_decision';
  delegationOutcomeId: string;
  initiatorUserId: string;
  reason: 'cross_owner_approval_timeout';
}

export interface CrossOwnerSubstepCompletedPayload {
  eventType: 'cross_owner_substep.completed';
  delegationOutcomeId: string;
  status: 'failed' | 'partial';
  reason: 'cross_owner_approval_timeout' | 'cross_owner_approval_timed_out_optional';
}
