// Typed wrapper enforcing the round-2 workflow structured-log shape.
// All workflow engine, gate-service, event-service, and orchestrator log lines
// MUST use this wrapper. Optional fields omitted when not applicable — never null.

import { logger } from './logger.js';

export interface WorkflowLogPayload {
  organisationId: string; // always required
  runId?: string;
  taskId?: string;
  stepId?: string;
  gateId?: string;
  eventType?: string;
  state?: string;
  taskSequence?: number;
  eventSubsequence?: number;
  eventOrigin?: 'engine' | 'gate' | 'user' | 'orchestrator';
}

function strip(payload: WorkflowLogPayload): Record<string, unknown> {
  // Remove undefined fields so logs don't have null placeholders
  return Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined)
  );
}

export const workflowLog = {
  info: (payload: WorkflowLogPayload, msg: string) =>
    logger.info(msg, strip(payload)),
  warn: (payload: WorkflowLogPayload, msg: string) =>
    logger.warn(msg, strip(payload)),
  error: (payload: WorkflowLogPayload, msg: string) =>
    logger.error(msg, strip(payload)),
  debug: (payload: WorkflowLogPayload, msg: string) =>
    logger.debug(msg, strip(payload)),
};
