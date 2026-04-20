import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { actions, integrationConnections } from '../db/schema/index.js';
import { actionService, computeValidationDigest } from './actionService.js';
import { getActionDefinition } from '../config/actionRegistry.js';
import { apiAdapter } from './adapters/apiAdapter.js';
import { devopsAdapter } from './adapters/devopsAdapter.js';
import type { ExecutionAdapter, ExecutionResult } from './adapters/workerAdapter.js';

// ---------------------------------------------------------------------------
// Execution Layer Service — dispatches approved actions to adapters.
// ClientPulse Session 2 §2.6 — precondition gate runs before adapter dispatch.
// ---------------------------------------------------------------------------

const adapterRegistry: Record<string, ExecutionAdapter> = {
  api: apiAdapter,
  devops: devopsAdapter,
  // worker adapter registered dynamically at startup to avoid circular imports.
};

export function registerAdapter(category: string, adapter: ExecutionAdapter): void {
  adapterRegistry[category] = adapter;
}

type PreconditionResult =
  | { ok: true }
  | {
      ok: false;
      blockedReason:
        | 'drift_detected'
        | 'concurrent_execute'
        | 'timeout_budget_exhausted'
        | 'validation_digest_missing';
      detail?: string;
    };

async function acquireSubaccountLock(params: {
  organisationId: string;
  subaccountId: string | null;
}): Promise<{ acquired: boolean; lockKey: string }> {
  // Advisory lock key = SHA-like hash over the org/subaccount pair. Using
  // Postgres' hashtextextended ensures the bigint fits pg_try_advisory_lock.
  const keySource = `${params.organisationId}:${params.subaccountId ?? '_org'}`;
  const result = await db.execute<{ acquired: boolean; key: string }>(sql`
    SELECT pg_try_advisory_lock(hashtextextended(${keySource}, 0)) AS acquired,
           ${keySource}::text AS key
  `);
  const row = (result as unknown as { rows?: Array<{ acquired: boolean }> }).rows?.[0];
  return { acquired: row?.acquired === true, lockKey: keySource };
}

async function releaseSubaccountLock(lockKey: string): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_unlock(hashtextextended(${lockKey}, 0))`);
}

function checkPreconditions(action: typeof actions.$inferSelect): PreconditionResult {
  const metadata = (action.metadataJson ?? {}) as Record<string, unknown>;
  const storedDigest = typeof metadata.validationDigest === 'string'
    ? (metadata.validationDigest as string)
    : null;

  // Precondition 2 — re-validate the payload digest if one was captured at propose-time.
  // Tolerant: if no digest was recorded (pre-Session-2 rows), we do NOT block — the
  // proposer is the primary validation and the adapter re-validates required fields.
  if (storedDigest !== null) {
    const currentDigest = computeValidationDigest(
      (action.payloadJson ?? {}) as Record<string, unknown>,
    );
    if (currentDigest !== storedDigest) {
      return {
        ok: false,
        blockedReason: 'drift_detected',
        detail: 'metadata.validationDigest does not match current payload',
      };
    }
  }

  // Precondition 4 — timeout budget remaining.
  if (typeof metadata.timeoutBudgetMs === 'number' && (metadata.timeoutBudgetMs as number) <= 0) {
    return {
      ok: false,
      blockedReason: 'timeout_budget_exhausted',
      detail: 'metadata.timeoutBudgetMs depleted before dispatch',
    };
  }

  return { ok: true };
}

export const executionLayerService = {
  /**
   * Execute an approved action. Runs the §2.6 precondition gate, then dispatches
   * through the registered adapter for the action's category.
   */
  async executeAction(actionId: string, organisationId: string): Promise<ExecutionResult> {
    // Precondition 1 — 'approved' status check + atomic lock → 'executing'.
    const locked = await actionService.lockForExecution(actionId, organisationId);
    if (!locked) {
      return {
        success: false,
        resultStatus: 'failed',
        error: 'Action is not in approved state or already executing',
        errorCode: 'invalid_state',
      };
    }

    const action = await actionService.getAction(actionId, organisationId);

    // Preconditions 2 + 4 — payload digest re-check + timeout budget.
    const preconditionResult = checkPreconditions(action);
    if (!preconditionResult.ok) {
      await actionService.markBlocked(
        actionId,
        organisationId,
        preconditionResult.blockedReason,
        preconditionResult.detail,
      );
      return {
        success: false,
        resultStatus: 'failed',
        error: preconditionResult.detail ?? preconditionResult.blockedReason,
        errorCode: preconditionResult.blockedReason,
      };
    }

    // Precondition 3 — per-subaccount advisory lock for serial execute.
    const lockHandle = await acquireSubaccountLock({
      organisationId,
      subaccountId: action.subaccountId,
    });
    if (!lockHandle.acquired) {
      await actionService.markBlocked(
        actionId,
        organisationId,
        'concurrent_execute',
        'pg_try_advisory_lock returned false',
      );
      return {
        success: false,
        resultStatus: 'failed',
        error: 'Another dispatch is holding the subaccount lock',
        errorCode: 'concurrent_execute',
      };
    }

    try {
      const definition = getActionDefinition(action.actionType);
      if (!definition) {
        await actionService.markFailed(actionId, organisationId, 'Unknown action type', 'unknown_type');
        return { success: false, resultStatus: 'failed', error: 'Unknown action type', errorCode: 'unknown_type' };
      }

      const adapter = adapterRegistry[definition.actionCategory];
      if (!adapter) {
        await actionService.markFailed(
          actionId,
          organisationId,
          `No adapter for category: ${definition.actionCategory}`,
          'no_adapter',
        );
        return {
          success: false,
          resultStatus: 'failed',
          error: `No adapter for category: ${definition.actionCategory}`,
          errorCode: 'no_adapter',
        };
      }

      // Load integration connection for external actions.
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
                eq(integrationConnections.subaccountId, action.subaccountId!),
                eq(
                  integrationConnections.providerType,
                  provider as typeof integrationConnections.providerType._.data,
                ),
                eq(integrationConnections.connectionStatus, 'active'),
              ),
            );
          connection = conn ?? null;
        }
      }

      try {
        const result = await adapter.execute(action, connection);

        if (result.success) {
          await actionService.markCompleted(actionId, organisationId, result.result, result.resultStatus);
        } else {
          // Retryable failures route through markFailed (which bumps retryCount and
          // emits retry_scheduled when retryCount < maxRetries). Terminal failures
          // follow the same path but will emit execution_failed once retries exhaust.
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
    } finally {
      await releaseSubaccountLock(lockHandle.lockKey);
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
