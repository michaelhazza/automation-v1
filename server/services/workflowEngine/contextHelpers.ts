import { eq } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { workflowStepRuns } from '../../db/schema/index.js';
import { shouldDiscardWriteForInvalidation } from '../workflowEngineServicePure.js';
import { logger } from '../../lib/logger.js';
import type { RunContext } from './types.js';
import { MAX_CONTEXT_BYTES_SOFT, MAX_CONTEXT_BYTES_HARD } from './constants.js';

// C4b-INVAL-RACE: re-read step run after external I/O to discard late writes
// to invalidated or cancelled steps.
export async function withInvalidationGuard<T>(
  stepRunId: string,
  externalWork: () => Promise<T>,
): Promise<T | { discarded: true; reason: 'invalidated' }> {
  const result = await externalWork();
  const scopedDb = getOrgScopedDb('workflowEngineService.withInvalidationGuard');
  const [sr] = await scopedDb.select({ status: workflowStepRuns.status })
    .from(workflowStepRuns).where(eq(workflowStepRuns.id, stepRunId)).limit(1);
  if (shouldDiscardWriteForInvalidation(sr?.status ?? '')) {
    return { discarded: true, reason: 'invalidated' };
  }
  return result;
}

export function assertContextSize(bytes: number, runId: string): void {
  if (bytes > MAX_CONTEXT_BYTES_HARD) {
    throw {
      statusCode: 422,
      message: `Workflow context exceeded ${MAX_CONTEXT_BYTES_HARD} bytes (got ${bytes})`,
      errorCode: 'workflow_context_overflow',
      runId,
    };
  }
  if (bytes > MAX_CONTEXT_BYTES_SOFT) {
    logger.warn('workflow_context_soft_limit', { runId, bytes });
  }
}

/**
 * Merges a step output into the run context per §5.1.1 deterministic rules.
 * Step outputs replace context.steps[stepId].output entirely (no deep merge).
 */
export function mergeStepOutputIntoContext(
  context: RunContext,
  stepId: string,
  output: unknown,
): RunContext {
  const next: RunContext = {
    input: context.input,
    subaccount: context.subaccount,
    org: context.org,
    steps: { ...context.steps, [stepId]: { output } },
    _meta: context._meta,
  };
  return next;
}

/**
 * Removes a step's output from the run context — used by mid-run editing's
 * invalidation cascade. (Spec §5.1.1 rule 6.)
 */
export function deleteStepOutputFromContext(context: RunContext, stepId: string): RunContext {
  const { [stepId]: _drop, ...rest } = context.steps;
  return {
    input: context.input,
    subaccount: context.subaccount,
    org: context.org,
    steps: rest,
    _meta: context._meta,
  };
}

/** Returns true if WebSocket updates should be suppressed for this run mode. */
export function shouldSuppressWebSocket(runMode: string | null | undefined): boolean {
  return runMode === 'background';
}
