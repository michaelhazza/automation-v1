import { logger } from './logger.js';

export const MAX_WORKFLOW_RUN_DEPTH = 10;

export class RunDepthExceededError extends Error {
  readonly code = 'run_depth_exceeded';
  constructor(depth: number) {
    super(`Workflow run depth ${depth} exceeds max ${MAX_WORKFLOW_RUN_DEPTH}`);
    this.name = 'RunDepthExceededError';
  }
}

export function assertRunDepth(
  currentDepth: number,
  context?: { runId?: string; taskId?: string },
): void {
  if (currentDepth >= MAX_WORKFLOW_RUN_DEPTH) {
    // Log before throwing so the event appears in observability even if the
    // caller catches and swallows the error.
    logger.warn('run_depth_exceeded: refusing to start nested workflow run', {
      currentDepth,
      maxDepth: MAX_WORKFLOW_RUN_DEPTH,
      ...context,
    });
    throw new RunDepthExceededError(currentDepth);
  }
}
