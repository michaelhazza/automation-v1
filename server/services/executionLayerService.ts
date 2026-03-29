import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { actions, integrationConnections } from '../db/schema/index.js';
import { actionService } from './actionService.js';
import { getActionDefinition } from '../config/actionRegistry.js';
import { apiAdapter } from './adapters/apiAdapter.js';
import type { ExecutionAdapter, ExecutionResult } from './adapters/workerAdapter.js';

// ---------------------------------------------------------------------------
// Execution Layer Service — dispatches approved actions to adapters
// ---------------------------------------------------------------------------

// Adapter registry — maps action_category to adapter
const adapterRegistry: Record<string, ExecutionAdapter> = {
  api: apiAdapter,
  // worker adapter is set dynamically to avoid circular imports
  // browser: stub — Phase 2
  // devops: stub — Phase 2
};

/**
 * Register an adapter for an action category.
 * Used by the worker adapter to register itself at startup.
 */
export function registerAdapter(category: string, adapter: ExecutionAdapter): void {
  adapterRegistry[category] = adapter;
}

export const executionLayerService = {
  /**
   * Execute an approved action. This is the main entry point.
   * Re-checks all state in DB before proceeding (never trusts the caller).
   */
  async executeAction(actionId: string, organisationId: string): Promise<ExecutionResult> {
    // 1. Atomically lock for execution
    const locked = await actionService.lockForExecution(actionId, organisationId);
    if (!locked) {
      return {
        success: false,
        resultStatus: 'failed',
        error: 'Action is not in approved state or already executing',
        errorCode: 'invalid_state',
      };
    }

    // 2. Load the full action
    const action = await actionService.getAction(actionId, organisationId);

    // 3. Resolve adapter
    const definition = getActionDefinition(action.actionType);
    if (!definition) {
      await actionService.markFailed(actionId, organisationId, 'Unknown action type', 'unknown_type');
      return { success: false, resultStatus: 'failed', error: 'Unknown action type', errorCode: 'unknown_type' };
    }

    const adapter = adapterRegistry[definition.actionCategory];
    if (!adapter) {
      await actionService.markFailed(actionId, organisationId, `No adapter for category: ${definition.actionCategory}`, 'no_adapter');
      return { success: false, resultStatus: 'failed', error: `No adapter for category: ${definition.actionCategory}`, errorCode: 'no_adapter' };
    }

    // 4. Load integration connection if external
    let connection = null;
    if (definition.isExternal) {
      const payload = action.payloadJson as Record<string, unknown>;
      const provider = payload.provider as string | undefined;
      if (provider) {
        const [conn] = await db
          .select()
          .from(integrationConnections)
          .where(
            and(
              eq(integrationConnections.subaccountId, action.subaccountId),
              eq(integrationConnections.providerType, provider),
              eq(integrationConnections.connectionStatus, 'active')
            )
          );
        connection = conn ?? null;
      }
    }

    // 5. Execute via adapter
    try {
      const result = await adapter.execute(action, connection);

      if (result.success) {
        await actionService.markCompleted(actionId, organisationId, result.result, result.resultStatus);
      } else {
        await actionService.markFailed(actionId, organisationId, result.error, result.errorCode);
      }

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await actionService.markFailed(actionId, organisationId, errorMessage, 'adapter_error');
      return {
        success: false,
        resultStatus: 'failed',
        error: errorMessage,
        errorCode: 'adapter_error',
      };
    }
  },

  /**
   * Execute an auto-gated action synchronously. Used by skillExecutor for
   * internal operations that should create an audit trail but not block.
   */
  async executeAutoAction(actionId: string, organisationId: string): Promise<ExecutionResult> {
    return this.executeAction(actionId, organisationId);
  },
};
