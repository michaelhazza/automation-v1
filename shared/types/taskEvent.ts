export type TaskEvent =
  | { kind: 'task.created'; payload: { requesterId: string; initialPrompt: string } }
  | { kind: 'task.routed'; payload: { targetAgentId?: string; targetWorkflowTemplateId?: string } }
  | { kind: 'agent.delegation.opened'; payload: { parentAgentId: string; childAgentId: string; scope: string } }
  | { kind: 'agent.delegation.closed'; payload: { childAgentId: string; summary: string } }
  | { kind: 'step.queued'; payload: { stepId: string; stepType: string; params: Record<string, unknown> } }
  | { kind: 'step.started'; payload: { stepId: string } }
  | { kind: 'step.completed'; payload: { stepId: string; outputs: unknown; fileRefs: string[] } }
  | { kind: 'step.failed'; payload: { stepId: string; errorClass: string; errorMessage: string } }
  | { kind: 'step.branch_decided'; payload: { stepId: string; field: string; resolvedValue: unknown; targetStep: string } }
  | { kind: 'step.awaiting_approval'; payload: { stepId: string; reviewKind: 'spend_approval' | 'action_call_approval'; actionId: string } }
  | { kind: 'step.approval_resolved'; payload: { stepId: string; reviewKind: 'spend_approval' | 'action_call_approval'; actionId: string; decision: 'approved' | 'rejected' } }
  | { kind: 'approval.queued'; payload: { gateId: string; stepId: string; poolSize: number; poolFingerprint: string; seenPayload: unknown; seenConfidence: unknown } }
  | { kind: 'approval.decided'; payload: { gateId: string; decidedBy: string; decision: 'approved' | 'rejected'; decisionReason?: string } }
  | { kind: 'approval.pool_refreshed'; payload: { gateId: string; actorId: string; newPoolSize: number; newPoolFingerprint: string; stillBelowQuorum: boolean } }
  | { kind: 'ask.queued'; payload: { gateId: string; stepId: string; poolSize: number; poolFingerprint: string; schema: unknown; prompt: string } }
  | { kind: 'ask.submitted'; payload: { gateId: string; submittedBy: string; values: Record<string, unknown> } }
  | { kind: 'ask.skipped'; payload: { gateId: string; submittedBy: string; stepId: string } }
  | { kind: 'file.created'; payload: { fileId: string; version: number; producerAgentId: string } }
  | { kind: 'file.edited'; payload: { fileId: string; priorVersion: number; newVersion: number; editRequest: string } }
  | { kind: 'chat.message'; payload: { authorKind: 'user' | 'agent'; authorId: string; body: string; attachments?: unknown[] } }
  | { kind: 'agent.milestone'; payload: { agentId: string; summary: string; linkRef?: { kind: string; id: string; label: string } } }
  | { kind: 'thinking.changed'; payload: { newText: string } }
  | { kind: 'run.paused.cost_ceiling'; payload: { capValue: number; currentCost: number } }
  | { kind: 'run.paused.wall_clock'; payload: { capValue: number; currentElapsed: number } }
  | { kind: 'run.paused.by_user'; payload: { actorId: string } }
  | { kind: 'run.resumed'; payload: { actorId: string; extensionCostCents?: number; extensionSeconds?: number } }
  | { kind: 'run.stopped.by_user'; payload: { actorId: string } }
  | { kind: 'task.degraded'; payload: { reason: 'consumer_gap_detected' | 'replay_cursor_expired'; gapRange?: [number, number]; degradationReason: string } };

export type TaskEventKind = TaskEvent['kind'];

export const TASK_EVENT_KINDS: ReadonlyArray<TaskEventKind> = [
  'task.created', 'task.routed', 'agent.delegation.opened', 'agent.delegation.closed',
  'step.queued', 'step.started', 'step.completed', 'step.failed', 'step.branch_decided',
  'step.awaiting_approval', 'step.approval_resolved',
  'approval.queued', 'approval.decided', 'approval.pool_refreshed',
  'ask.queued', 'ask.submitted', 'ask.skipped',
  'file.created', 'file.edited',
  'chat.message', 'agent.milestone', 'thinking.changed',
  'run.paused.cost_ceiling', 'run.paused.wall_clock', 'run.paused.by_user',
  'run.resumed', 'run.stopped.by_user', 'task.degraded',
];

export interface TaskEventEnvelope {
  eventId: string;  // `task:${taskId}:${taskSequence}:${eventSubsequence}:${kind}`
  type: 'task:execution-event';
  entityId: string; // taskId
  timestamp: string; // ISO8601
  eventOrigin: 'engine' | 'gate' | 'user' | 'orchestrator';
  taskSequence: number;
  eventSubsequence: number;
  eventSchemaVersion: number; // 1 for all V1 events
  payload: TaskEvent;
}
