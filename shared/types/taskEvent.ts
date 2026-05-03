/**
 * taskEvent.ts — discriminated union for every task-scoped execution event.
 *
 * Source of truth for the event allow-list (DEVELOPMENT_GUIDELINES §8.13).
 * Adding a new kind requires updating BOTH the union here AND the validator
 * allow-list in taskEventValidator.ts in the same commit.
 *
 * Spec: docs/workflows-dev-spec.md §8.
 */

import type { SeenPayload, SeenConfidence } from './workflowStepGate.js';

// Re-export for callers that only need these shapes.
export type { SeenPayload, SeenConfidence };

// ─── Ask form schema ──────────────────────────────────────────────────────────

export interface AskFormField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'boolean' | 'number';
  required?: boolean;
  options?: string[]; // populated when type === 'select'
  placeholder?: string;
}

export interface AskFormSchema {
  fields: AskFormField[];
}

// ─── TaskEvent discriminated union ───────────────────────────────────────────

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
  | { kind: 'approval.queued'; payload: { gateId: string; stepId: string; approverPool: string[]; seenPayload: SeenPayload; seenConfidence: SeenConfidence } }
  | { kind: 'approval.decided'; payload: { gateId: string; decidedBy: string; decision: 'approved' | 'rejected'; decisionReason?: string } }
  | { kind: 'approval.pool_refreshed'; payload: { gateId: string; actorId: string; newPoolSize: number; stillBelowQuorum: boolean } }
  | { kind: 'ask.queued'; payload: { gateId: string; stepId: string; submitterPool: string[]; schema: AskFormSchema; prompt: string } }
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

// ─── Envelope ─────────────────────────────────────────────────────────────────

/**
 * Wire envelope for every task-scoped event.
 *
 * eventId format: `task:${taskId}:${taskSequence}:${eventSubsequence}:${kind}`
 * This gives the client a deterministic dedup key that survives replay.
 */
export interface TaskEventEnvelope {
  /** Deterministic dedup key. See format above. */
  eventId: string;
  type: 'task:execution-event';
  /** The taskId this event belongs to. */
  entityId: string;
  /** ISO 8601 */
  timestamp: string;
  /** Emission origin (Decision 11). */
  eventOrigin: 'engine' | 'gate' | 'user' | 'orchestrator';
  /** Per-task monotonic sequence. */
  taskSequence: number;
  /** Per-step-transition subsequence within the same taskSequence (Decision 11). */
  eventSubsequence: number;
  /** V1 = 1. Increment per-kind on shape changes. */
  eventSchemaVersion: number;
  /** The event itself. */
  payload: TaskEvent;
}
