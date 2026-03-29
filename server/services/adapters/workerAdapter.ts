import type { Action } from '../../db/schema/actions.js';

// ---------------------------------------------------------------------------
// Worker Adapter — executes internal board operations (create_task, move_task, etc.)
// Wraps existing skillExecutor logic for auto-gated internal actions.
// ---------------------------------------------------------------------------

export interface ExecutionResult {
  success: boolean;
  resultStatus: 'success' | 'partial' | 'failed';
  result?: unknown;
  error?: string;
  errorCode?: string;
}

export interface ExecutionAdapter {
  execute(action: Action, connection?: unknown): Promise<ExecutionResult>;
}

/**
 * Worker adapter — delegates to a callback that runs the original skill logic.
 * The actual skill implementation is injected at registration time so we don't
 * create a circular dependency with skillExecutor.
 */
export function createWorkerAdapter(
  skillHandler: (actionType: string, payload: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>
): ExecutionAdapter {
  return {
    async execute(action: Action): Promise<ExecutionResult> {
      try {
        const payload = action.payloadJson as Record<string, unknown>;
        const context = {
          organisationId: action.organisationId,
          subaccountId: action.subaccountId,
          agentId: action.agentId,
          actionId: action.id,
        };

        const result = await skillHandler(action.actionType, payload, context);

        return {
          success: true,
          resultStatus: 'success',
          result,
        };
      } catch (err) {
        return {
          success: false,
          resultStatus: 'failed',
          error: err instanceof Error ? err.message : String(err),
          errorCode: 'worker_error',
        };
      }
    },
  };
}
