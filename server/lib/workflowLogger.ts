/**
 * workflowLogger — typed wrapper around the structured logger for workflow-engine,
 * gate-service, event-service, and orchestrator log lines.
 *
 * Enforces the round-2 structured-log shape (spec docs/workflows-dev-spec.md §18.1).
 * Optional fields are omitted when not applicable; never null.
 *
 * Usage:
 *   import { workflowLog } from '../lib/workflowLogger.js';
 *   workflowLog.info({ runId, organisationId, eventType: 'run.started' }, 'workflow_run_started');
 *
 * Backwards-compatible: callers that use the raw logger still work.
 * New workflow-engine code MUST use this helper.
 */

import { logger } from './logger.js';
import type { EventOrigin } from '../../shared/types/workflowStepGate.js';

// ---------------------------------------------------------------------------
// Structured log payload — enforces the round-2 shape
// ---------------------------------------------------------------------------

export interface WorkflowLogPayload {
  /** Always required — tenant key for log aggregation. */
  organisationId: string;
  /** Workflow run ID when in the context of a run. */
  runId?: string;
  /** Task ID when in the context of a workflow task. */
  taskId?: string;
  /** Step ID within the workflow definition. */
  stepId?: string;
  /** Gate ID when logging gate activity. */
  gateId?: string;
  /** Discriminated event type (e.g. 'run.started', 'gate.opened'). */
  eventType?: string;
  /** Current state of the entity (status string). */
  state?: string;
  /** Monotonic task-level sequence number. */
  taskSequence?: number;
  /** Sub-sequence within a task sequence (for multi-event bursts). */
  eventSubsequence?: number;
  /** Emission origin — which subsystem emitted the event. */
  eventOrigin?: EventOrigin;
}

// ---------------------------------------------------------------------------
// Typed logger wrapper
// ---------------------------------------------------------------------------

function buildData(payload: WorkflowLogPayload): Record<string, unknown> {
  const data: Record<string, unknown> = {
    organisationId: payload.organisationId,
  };
  if (payload.runId !== undefined) data.runId = payload.runId;
  if (payload.taskId !== undefined) data.taskId = payload.taskId;
  if (payload.stepId !== undefined) data.stepId = payload.stepId;
  if (payload.gateId !== undefined) data.gateId = payload.gateId;
  if (payload.eventType !== undefined) data.eventType = payload.eventType;
  if (payload.state !== undefined) data.state = payload.state;
  if (payload.taskSequence !== undefined) data.taskSequence = payload.taskSequence;
  if (payload.eventSubsequence !== undefined) data.eventSubsequence = payload.eventSubsequence;
  if (payload.eventOrigin !== undefined) data.eventOrigin = payload.eventOrigin;
  return data;
}

export const workflowLog = {
  debug(payload: WorkflowLogPayload, msg: string): void {
    logger.debug(msg, buildData(payload));
  },

  info(payload: WorkflowLogPayload, msg: string): void {
    logger.info(msg, buildData(payload));
  },

  warn(payload: WorkflowLogPayload, msg: string): void {
    logger.warn(msg, buildData(payload));
  },

  error(payload: WorkflowLogPayload, msg: string): void {
    logger.error(msg, buildData(payload));
  },
};
