/**
 * operatorManagedBackend — delegated operator-session adapter.
 *
 * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md
 *   §3.1 (adapter id), §3.2 (capabilities), §3.6 (credential injection),
 *   §3.7 (fallback), §3.10 (cancel), §4.1 (adapter object),
 *   §7 (execution model), §10 (concurrency/idempotency invariants)
 *
 * Registers as 'operator_managed' — the first concrete autonomous-operator
 * execution backend. Composes:
 *   - Chunk 3 pure helpers (decideChainResumeOutcome, classifyChainLinkFailure,
 *     deriveCredentialStartMode, derivePredecessorAllowList)
 *   - Chunk 5 services (operatorChainSchedulerService, operatorCostWriter,
 *     subaccountOperatorSettingsService, operatorChainResumeService,
 *     operatorTaskProfileService, notifyOperatorSessionSuspended,
 *     credentialBrokerService)
 *   - Chunk 4 sandbox primitive (adoptOrStart)
 *
 * is_resumable_now field: deferred-verification — the vendor operator runtime
 * checkpoint step-state payload field assumed to be `is_resumable_now` per spec
 * §3.14 D7. This matches the spec literal. If the vendor runtime uses a
 * different field name, update the `_extractIsResumableNow` helper and
 * `operatorChainResumeServicePure.ts` at integration time.
 */

import { z } from 'zod';
import { eq, and, lt, or, sql, isNull, desc } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { operatorRuns, agentRuns } from '../../db/schema/index.js';
import type { OperatorRun } from '../../db/schema/operatorRuns.js';
import { logger } from '../../lib/logger.js';
import { setOrgAndSubaccountGUC, setOrgGUC } from '../../lib/orgScoping.js';
import { withAdminConnectionGuarded } from '../../lib/rlsBoundaryGuard.js';
import { recordIncident } from '../incidentIngestor.js';
import { emitAgentRunUpdate } from '../../websocket/emitters.js';
import { adoptOrStart } from '../sandboxExecutionService.js';
import { credentialBrokerService } from '../credentialBrokerService.js';
import { operatorChainSchedulerService } from '../operatorChainSchedulerService.js';
import { operatorCostWriter } from '../operatorCostWriter.js';
import { subaccountOperatorSettingsService } from '../subaccountOperatorSettingsService.js';
import { notifyOperatorSessionSuspended } from '../operatorSessionSuspensionNotifier.js';
import { OperatorSessionLimitExceededError } from '../operatorBackendErrors.js';
import {
  AUTO_EXTEND_GRACE_MINUTES,
  MAX_CHAIN_LENGTH,
  MAX_WALL_CLOCK_PER_TASK_DAYS,
} from '../operatorBackend/operatorSettingsDefaults.js';
import {
  decideChainResumeOutcome,
} from './operatorManagedBackendPure.js';
import type {
  ExecutionBackend,
  BackendDispatchInput,
  BackendDispatchResult,
  BackendTerminalState,
  BackendFinalisationInput,
  BackendFinalisationResult,
} from './types.js';
import type { SandboxPolicy } from '../../../shared/types/sandbox.js';
import {
  OPERATOR_SESSION_DISPATCHED,
  OPERATOR_SESSION_CHAIN_LINK_COMPLETED,
  OPERATOR_SESSION_CHAIN_LINK_FAILED,
  OPERATOR_SESSION_CHAIN_LINK_CANCELLED,
  OPERATOR_SESSION_TASK_CANCELLED,
} from '../../../shared/types/operatorBackendEvents.js';

// ---------------------------------------------------------------------------
// Operator-session sandbox policy
// Network mode 'open' — the vendor runtime needs outbound internet access.
// Wall-clock ceiling is derived at dispatch time from session_soft_cap_minutes.
// ---------------------------------------------------------------------------

function _buildOperatorSessionPolicy(wallClockMs: number): SandboxPolicy {
  return {
    network: { mode: 'allowlist', allowlist: [] },
    filesystem: { writableRoot: '/workspace' },
    ceilings: { wallClockMs, costCents: 500 },
    artefactLimits: { perArtefactBytes: 10_485_760, totalBytes: 104_857_600 },
    allowRuntimeInstall: false,
    inputLimits: { maxBytes: 0, allowedMimes: [] },
    providerThresholds: { startTimeoutMs: 60_000 },
  };
}

// ---------------------------------------------------------------------------
// Completed event payload schema (Zod)
// ---------------------------------------------------------------------------

export const operatorSessionCompletedPayloadSchema = z.object({
  operatorRunId: z.string().uuid(),
  agentRunId: z.string().uuid(),
  organisationId: z.string().uuid(),
  subaccountId: z.string().uuid(),
});

export type OperatorSessionCompletedPayload = z.infer<typeof operatorSessionCompletedPayloadSchema>;

export const OPERATOR_SESSION_COMPLETED_QUEUE = 'operator-session-completed';
export const OPERATOR_TERMINAL_STATE_TABLE = 'operator_runs';

// ---------------------------------------------------------------------------
// Adapter image tag (pinned at boot; forward-compat for Dockerfile)
// ---------------------------------------------------------------------------

const OPERATOR_SESSION_IMAGE_TAG = process.env.OPERATOR_SESSION_IMAGE_TAG ?? 'latest';

// ---------------------------------------------------------------------------
// Stale progress threshold for reconciler
// ---------------------------------------------------------------------------

const HEARTBEAT_STALE_MINUTES = 5;

// ---------------------------------------------------------------------------
// Internal: map operator_run.status to parent terminal status
// ---------------------------------------------------------------------------

function _mapChainLinkStatusToParentStatus(
  chainLinkStatus: string,
  chainResumeAction: string,
): string {
  switch (chainResumeAction) {
    case 'task_terminal_completed':
      return 'completed';
    case 'task_terminal_failed':
      return 'failed';
    case 'task_terminal_cancelled':
      return 'cancelled';
    case 'task_paused_budget_exceeded':
      return 'paused_budget_exceeded';
    case 'task_paused_wall_clock_exceeded':
      return 'paused_wall_clock_exceeded';
    case 'task_paused_chain_failure':
      return 'paused_chain_failure';
    case 'dispatch_next_chain_link':
      return 'paused_for_chain_continuation';
    default:
      return chainLinkStatus === 'completed' ? 'completed' : 'failed';
  }
}

// ---------------------------------------------------------------------------
// Internal: extract is_resumable_now from vendor checkpoint payload
// Field name: `is_resumable_now` (assumed per spec §3.14 D7; deferred-verification)
// ---------------------------------------------------------------------------

function _extractIsResumableNow(checkpointPayload: unknown): boolean {
  if (checkpointPayload === null || typeof checkpointPayload !== 'object') return false;
  const cp = checkpointPayload as Record<string, unknown>;
  return cp['is_resumable_now'] === true;
}

// ---------------------------------------------------------------------------
// Internal: emit chain_link_start_failed incident (spec §3.17)
// ---------------------------------------------------------------------------

async function _emitChainLinkStartFailedIncident(params: {
  agentRunId: string;
  organisationId: string;
  subaccountId: string;
  attemptNumber: number;
  chainSeq: number;
  retryAttempt: number;
  failureReason: string;
  operatorRunId?: string;
}): Promise<void> {
  await recordIncident({
    source: 'agent',
    severity: 'medium',
    summary: `Operator chain link start failed: ${params.failureReason}`,
    errorCode: 'OPERATOR_CHAIN_LINK_START_FAILED',
    organisationId: params.organisationId,
    subaccountId: params.subaccountId,
    affectedResourceKind: 'agent_run',
    affectedResourceId: params.agentRunId,
    idempotencyKey: `operator.chain_link_start_failed:${params.agentRunId}:${params.attemptNumber}:${params.chainSeq}:${params.retryAttempt}`,
    errorDetail: {
      event: 'operator.chain_link_start_failed',
      agent_run_id: params.agentRunId,
      operator_run_id: params.operatorRunId ?? null,
      attempt_number: params.attemptNumber,
      chain_seq: params.chainSeq,
      retry_attempt: params.retryAttempt,
      failure_reason: params.failureReason,
    },
  });
}

// ---------------------------------------------------------------------------
// operatorManagedBackend adapter
// ---------------------------------------------------------------------------

export const operatorManagedBackend: ExecutionBackend = {
  // === Identity ===
  id: 'operator_managed',
  capabilities: ['delegated', 'code_execution', 'long_running', 'cancellation', 'session_identity'],
  costModel: 'subscription',
  sandboxRequirement: 'code_execution',

  // === Delegated-lifecycle slots ===
  completedEventQueue: OPERATOR_SESSION_COMPLETED_QUEUE,
  terminalStateTable: OPERATOR_TERMINAL_STATE_TABLE,
  completedEventPayload: operatorSessionCompletedPayloadSchema,

  // ---------------------------------------------------------------------------
  // dispatch — 10-step sequence (spec §7.3)
  // ---------------------------------------------------------------------------

  async dispatch(input: BackendDispatchInput): Promise<BackendDispatchResult> {
    const { runId, organisationId, subaccountId } = input;

    if (!subaccountId) {
      throw new Error('operatorManagedBackend.dispatch: subaccountId is required');
    }

    // Step 1: Read effective settings to get the snapshot for this chain link.
    const effectiveSettings = await subaccountOperatorSettingsService.getEffectiveSettings(
      organisationId,
      subaccountId,
    );

    // Step 2: Derive chain metadata (attempt number, chain seq, reason).
    // Read the parent agent_run row to determine current status and the
    // per-task budget extension accumulator (spec §3.17.4).
    // guard-ignore: with-org-tx-or-scoped-db reason="Tier 2 — admin/system/cross-tenant path; dispatch has runId+organisationId from input; org scoped via setOrgAndSubaccountGUC inside tx"
    const [agentRun] = await db
      .select({
        id: agentRuns.id,
        status: agentRuns.status,
        perTaskBudgetExtensionMinutes: agentRuns.perTaskBudgetExtensionMinutes,
      })
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
      .limit(1);

    if (!agentRun) {
      throw new Error(`operatorManagedBackend.dispatch: agent_run ${runId} not found`);
    }

    // Derive current attempt number from the latest operator_run for this task.
    // Reads must use a dual-GUC transaction so RLS on operator_runs (keyed on
    // both app.organisation_id AND app.subaccount_id) returns rows instead of
    // returning empty and defaulting chain_seq to 1 on every dispatch.
    const { currentAttemptNumber, chainSeqNext } = await db.transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, organisationId, subaccountId);

      const latestAttemptRow = await tx
        .select({ attemptNumber: operatorRuns.attemptNumber })
        .from(operatorRuns)
        .where(eq(operatorRuns.agentRunId, runId))
        .orderBy(desc(operatorRuns.attemptNumber))
        .limit(1);

      const currentAttempt = latestAttemptRow[0]?.attemptNumber ?? 1;

      const existingLinks = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(operatorRuns)
        .where(
          and(
            eq(operatorRuns.agentRunId, runId),
            eq(operatorRuns.attemptNumber, currentAttempt),
            isNull(operatorRuns.supersededByAttempt),
          ),
        );

      return {
        currentAttemptNumber: currentAttempt,
        chainSeqNext: ((existingLinks[0]?.count as number) ?? 0) + 1,
      };
    });
    const isFirstLink = chainSeqNext === 1;
    const reason = isFirstLink ? 'bootstrap' : 'continuation';

    // Step 3: Acquire concurrency slot (advisory lock + cap check).
    // Throws OperatorSessionLimitExceededError when at capacity.
    try {
      await operatorChainSchedulerService.tryAcquireSlotAndDispatch({
        orgId: organisationId,
        subaccountId,
        agentRunId: runId,
        attemptNumber: currentAttemptNumber,
        chainSeqNext,
        reason,
      });
    } catch (err) {
      if (err instanceof OperatorSessionLimitExceededError) {
        logger.warn('operator.dispatch.concurrency_cap_exceeded', {
          agentRunId: runId,
          cap: err.cap,
          current: err.current,
          subaccountId,
        });
        // Do not write an operator_run row; let the caller propagate the error.
        throw err;
      }
      throw err;
    }

    // Step 4: Request operator-session credential.
    const credentialResult = await credentialBrokerService.requestOperatorSessionCredential({
      organisationId,
      subaccountId,
      agentRunId: runId,
    });

    let credentialStartMode: 'operator_session' | 'api_key';

    if ('unavailable' in credentialResult) {
      // Fallback: try to resolve an API-key credential.
      const fallback = await credentialBrokerService.resolveFallback({
        organisationId,
        subaccountId,
        agentRunId: runId,
        originalCredentialId: '',
      });

      if (!fallback) {
        // No credential available — emit incident and fail.
        const chainSeq = chainSeqNext;
        await _emitChainLinkStartFailedIncident({
          agentRunId: runId,
          organisationId,
          subaccountId,
          attemptNumber: currentAttemptNumber,
          chainSeq,
          retryAttempt: 1,
          failureReason: 'OPERATOR_SESSION_UNAVAILABLE',
        });

        // Write a failed operator_run row for audit.
        const settingsSnapshot = {
          session_soft_cap_minutes: effectiveSettings.session_soft_cap_minutes,
          auto_extend_grace_minutes: AUTO_EXTEND_GRACE_MINUTES,
          max_chain_length: MAX_CHAIN_LENGTH,
          max_wall_clock_per_task_days: MAX_WALL_CLOCK_PER_TASK_DAYS,
          per_task_budget_cap_minutes:
            effectiveSettings.per_task_budget_cap_minutes +
            (agentRun.perTaskBudgetExtensionMinutes ?? 0),
          concurrent_operator_sessions_cap: effectiveSettings.concurrent_operator_sessions_cap,
        };

        await db.transaction(async (tx) => {
          await setOrgAndSubaccountGUC(tx, organisationId, subaccountId);
          await tx.insert(operatorRuns).values({
            agentRunId: runId,
            organisationId,
            subaccountId,
            chainSeq,
            attemptNumber: currentAttemptNumber,
            imageTag: OPERATOR_SESSION_IMAGE_TAG,
            credentialStartMode: 'operator_session',
            credentialMode: 'operator_session',
            status: 'failed',
            failureReason: 'OPERATOR_SESSION_UNAVAILABLE',
            completedAt: new Date(),
            settingsSnapshot,
          });
        });

        // Transition agent_run to 'failed' (credential-unavailable orphan path).
        // Must run inside a GUC transaction — FORCE RLS on agent_runs requires
        // app.organisation_id to be set on the connection. Spec §13.1.1.
        await db.transaction(async (tx) => {
          await setOrgGUC(tx, organisationId);
          await tx
            .update(agentRuns)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(
              and(
                eq(agentRuns.id, runId),
                eq(agentRuns.status, agentRun.status),
              ),
            );
        });

        return {
          lifecycle: 'delegated',
          backendTaskId: null,
          loopResult: null,
          deduplicated: false,
        };
      }

      credentialStartMode = fallback.mode;

      // Emit suspension notification (spec §3.13) on first OPERATOR_SESSION_UNAVAILABLE.
      await notifyOperatorSessionSuspended({
        organisationId,
        subaccountId,
        agentRunId: runId,
        connectionId: fallback.envelope.connectionId,
        credentialId: fallback.envelope.credentialId,
        usabilityState: 'no_usable_credential',
        failureReason: credentialResult.reason,
        consentRecordId: null,
        detectionTimestamp: new Date(),
      });
    } else {
      // operator_session credential available.
      credentialStartMode = 'operator_session';

      // Defence-in-depth: three-way subaccount match (spec §3.6).
      // Organisation match is enforced by the broker's WHERE predicate.
      if (credentialResult.subaccountId !== subaccountId) {
        throw new Error(
          `operatorManagedBackend.dispatch: subaccount mismatch: ` +
            `broker returned subaccountId=${credentialResult.subaccountId}, ` +
            `expected=${subaccountId}`,
        );
      }
    }

    // Step 5: Compute prior chain link summary for stickiness derivation.
    // For bootstrap (first link), there is no prior link; otherwise read the latest.
    // (Stickiness derivation is handled by the pure helper in continuation jobs,
    //  not at bootstrap dispatch — the credential is already determined above.)

    // Step 6: Write the operator_run row (status='pending').
    // Compose the effective per-task cap by adding the per-task extension
    // accumulator so budget extensions are task-scoped (spec §3.17.4).
    const settingsSnapshot = {
      session_soft_cap_minutes: effectiveSettings.session_soft_cap_minutes,
      auto_extend_grace_minutes: AUTO_EXTEND_GRACE_MINUTES,
      max_chain_length: MAX_CHAIN_LENGTH,
      max_wall_clock_per_task_days: MAX_WALL_CLOCK_PER_TASK_DAYS,
      per_task_budget_cap_minutes:
        effectiveSettings.per_task_budget_cap_minutes +
        (agentRun.perTaskBudgetExtensionMinutes ?? 0),
      concurrent_operator_sessions_cap: effectiveSettings.concurrent_operator_sessions_cap,
    };

    const [insertedRun] = await db.transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, organisationId, subaccountId);
      return tx.insert(operatorRuns).values({
        agentRunId: runId,
        organisationId,
        subaccountId,
        chainSeq: chainSeqNext,
        attemptNumber: currentAttemptNumber,
        imageTag: OPERATOR_SESSION_IMAGE_TAG,
        credentialStartMode,
        credentialMode: credentialStartMode,
        status: 'pending',
        settingsSnapshot,
      }).returning({ id: operatorRuns.id });
    });

    if (!insertedRun) {
      throw new Error('operatorManagedBackend.dispatch: failed to insert operator_run row');
    }

    const operatorRunId = insertedRun.id;

    // Step 7: Transition agent_run to 'delegated' (optimistic UPDATE — Rev 2 invariant 2).
    // Predicate: status IN ('pending','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded').
    // 'delegated', 'cancelled', 'paused_wall_clock_exceeded', terminal states are EXCLUDED.
    // Must run inside a GUC transaction — FORCE RLS on agent_runs requires
    // app.organisation_id to be set on the connection or the UPDATE returns 0 rows
    // and the dispatch path incorrectly interprets it as "race lost". Spec §7.3 step 7.
    const updateResult = await db.transaction(async (tx) => {
      await setOrgGUC(tx, organisationId);
      return tx
        .update(agentRuns)
        .set({
          status: 'delegated',
          operatorChainFailureCount: 0,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentRuns.id, runId),
            sql`${agentRuns.status} IN ('pending','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded')`,
          ),
        )
        .returning({ id: agentRuns.id });
    });

    if (updateResult.length === 0) {
      // Race lost: cancelled/terminal state won. Per spec §13.1.1, mark the
      // operator_run as orphaned.
      await db.transaction(async (tx) => {
        await setOrgAndSubaccountGUC(tx, organisationId, subaccountId);
        await tx
          .update(operatorRuns)
          .set({
            status: 'cancelled',
            failureReason: 'parent_orphaned',
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(operatorRuns.id, operatorRunId));
      });

      logger.warn('operator.dispatch.parent_not_dispatchable', {
        agentRunId: runId,
        operatorRunId,
        agentRunStatus: agentRun.status,
      });

      return {
        lifecycle: 'delegated',
        backendTaskId: operatorRunId,
        loopResult: null,
        deduplicated: false,
      };
    }

    // Step 8: Start the sandbox (adoptOrStart for crash-recovery idempotency).
    let vendorSessionId: string | null = null;
    try {
      const wallClockMs = effectiveSettings.session_soft_cap_minutes * 60 * 1000;
      const sandboxResult = await adoptOrStart({
        sandboxStartKey: operatorRunId,
        sandboxExecutionId: operatorRunId,
        runId,
        agentId: input.agentId,
        organisationId,
        subaccountId,
        taskId: runId,
        templateName: 'operator-session',
        templateVersion: OPERATOR_SESSION_IMAGE_TAG,
        policy: _buildOperatorSessionPolicy(wallClockMs),
        inputBytes: 0,
        inputFiles: [],
        credentialIssuanceContext: { aliases: [] },
        outputSchemaRef: 'operator-session',
      });

      vendorSessionId = sandboxResult.sandboxExecutionId ?? operatorRunId;

      // Update the operator_run row with the vendor_session_id and running status.
      await db.transaction(async (tx) => {
        await setOrgAndSubaccountGUC(tx, organisationId, subaccountId);
        await tx
          .update(operatorRuns)
          .set({
            status: 'running',
            vendorSessionId,
            startedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(operatorRuns.id, operatorRunId));
      });
    } catch (err) {
      logger.error('operator.dispatch.sandbox_start_failed', {
        agentRunId: runId,
        operatorRunId,
        error: err instanceof Error ? err.message : String(err),
      });

      // Mark the chain link failed.
      await db.transaction(async (tx) => {
        await setOrgAndSubaccountGUC(tx, organisationId, subaccountId);
        await tx
          .update(operatorRuns)
          .set({
            status: 'failed',
            failureReason: 'sandbox_start_unknown',
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(operatorRuns.id, operatorRunId));
      });

      await _emitChainLinkStartFailedIncident({
        agentRunId: runId,
        organisationId,
        subaccountId,
        attemptNumber: currentAttemptNumber,
        chainSeq: chainSeqNext,
        retryAttempt: 1,
        failureReason: 'sandbox_start_unknown',
        operatorRunId,
      });

      return {
        lifecycle: 'delegated',
        backendTaskId: operatorRunId,
        loopResult: null,
        deduplicated: false,
      };
    }

    // Step 9: Emit WebSocket update for UI feedback.
    emitAgentRunUpdate(runId, OPERATOR_SESSION_DISPATCHED, {
      operatorRunId,
      chainSeq: chainSeqNext,
      vendorSessionId,
      credentialMode: credentialStartMode,
    });

    logger.info('operator.dispatch.success', {
      agentRunId: runId,
      operatorRunId,
      chainSeq: chainSeqNext,
      vendorSessionId,
      credentialMode: credentialStartMode,
    });

    return {
      lifecycle: 'delegated',
      backendTaskId: operatorRunId,
      loopResult: null,
      deduplicated: false,
    };
  },

  // ---------------------------------------------------------------------------
  // loadTerminalState — reads operator_runs FOR UPDATE (spec §9.1 / Spec A)
  // ---------------------------------------------------------------------------

  async loadTerminalState(tx, backendTaskId): Promise<BackendTerminalState | null> {
    const [row] = await tx
      .select()
      .from(operatorRuns)
      .where(eq(operatorRuns.id, backendTaskId))
      .for('update')
      .limit(1);

    if (!row) return null;

    return {
      agentRunId: row.agentRunId,
      backendTaskId: row.id,
      status: row.status,
      failureReason: row.failureReason ?? null,
      completedAt: row.completedAt ?? null,
      eventEmittedAt: row.eventEmittedAt ?? null,
      resultSummary: null,
      raw: row,
    };
  },

  // ---------------------------------------------------------------------------
  // finalise — chain-resume decision + cost-writer + parent status update
  // ---------------------------------------------------------------------------

  async finalise(input: BackendFinalisationInput): Promise<BackendFinalisationResult> {
    const { tx, terminalState, parentRun } = input;
    const row = terminalState.raw as OperatorRun;

    // Idempotency: keyed on event_emitted_at IS NULL (NOT terminal status).
    // Redelivery with event_emitted_at IS NOT NULL is a no-op.
    if (terminalState.eventEmittedAt !== null) {
      return {
        finalised: false,
        parentTerminalStatus: parentRun?.status ?? 'unknown',
      };
    }

    // Missing parent: stamp event_emitted_at to stop retry sweep, return false.
    if (!parentRun) {
      await tx
        .update(operatorRuns)
        .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(operatorRuns.id, terminalState.backendTaskId),
            isNull(operatorRuns.eventEmittedAt),
          ),
        );
      return { finalised: false, parentTerminalStatus: 'unknown' };
    }

    // Already-terminal parent: stamp event_emitted_at to stop retry sweep and exit.
    // The `eventEmittedAt !== null` guard at L614 already handles the
    // "already processed" case, so reaching here with a terminal parent means
    // a concurrent finaliser (e.g. cancel beat us). Suppress post-commit side
    // effects — the winning finaliser already wrote cost rows and enqueued
    // continuations (if any). Do NOT drop the eventEmittedAt stamp — we must
    // still mark this operator_run as processed so the reconciler stops retrying.
    const terminalParentStatuses = new Set([
      'completed', 'failed', 'cancelled', 'timeout', 'budget_exceeded',
      'loop_detected', 'completed_with_uncertainty',
    ]);
    if (terminalParentStatuses.has(parentRun.status)) {
      await tx
        .update(operatorRuns)
        .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(operatorRuns.id, terminalState.backendTaskId),
            isNull(operatorRuns.eventEmittedAt),
          ),
        );
      return { finalised: false, parentTerminalStatus: parentRun.status };
    }

    // Read the chain link row (already loaded via loadTerminalState but re-read
    // from the row to get the settings snapshot and timing).
    const chainSeq = row.chainSeq;
    const settingsSnapshot = row.settingsSnapshot;

    // Compute consumed budget minutes and elapsed wall-clock days.
    // For V1, simplified: count chain links for this attempt × soft-cap.
    const completedLinks = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorRuns)
      .where(
        and(
          eq(operatorRuns.agentRunId, row.agentRunId),
          eq(operatorRuns.attemptNumber, row.attemptNumber),
          isNull(operatorRuns.supersededByAttempt),
          sql`${operatorRuns.status} IN ('completed','failed','cancelled')`,
        ),
      );

    const consumedBudgetMinutes =
      ((completedLinks[0]?.count as number) ?? 0) * settingsSnapshot.session_soft_cap_minutes;

    // Compute elapsed wall-clock from the first chain link's started_at.
    const firstLink = await tx
      .select({ startedAt: operatorRuns.startedAt })
      .from(operatorRuns)
      .where(
        and(
          eq(operatorRuns.agentRunId, row.agentRunId),
          eq(operatorRuns.attemptNumber, row.attemptNumber),
          eq(operatorRuns.chainSeq, 1),
        ),
      )
      .limit(1);

    const firstStartedAt = firstLink[0]?.startedAt ?? new Date();
    const elapsedWallClockDays =
      (Date.now() - firstStartedAt.getTime()) / (1000 * 60 * 60 * 24);

    // isTaskDone: read from checkpoint payload field is_resumable_now.
    // Per spec D7 deferred-verification note: assumed field name `is_resumable_now`.
    const isTaskDone = row.checkpointPayload === null ||
      !_extractIsResumableNow(row.checkpointPayload);

    // Chain-resume decision (pure helper from Chunk 3).
    const resumeDecision = decideChainResumeOutcome({
      chainLinkStatus: terminalState.status as 'completed' | 'failed' | 'cancelled',
      hasCheckpoint: row.checkpointPayload !== null,
      failedMidStep: row.failedMidStep,
      chainSeq,
      settingsSnapshot,
      consumedBudgetMinutes,
      elapsedWallClockDays,
      isTaskDone,
    });

    const parentTerminalStatus = _mapChainLinkStatusToParentStatus(
      terminalState.status,
      resumeDecision.action,
    );

    // Optimistic stamp: only winner writes cost rows.
    const stampResult = await tx
      .update(operatorRuns)
      .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(operatorRuns.id, terminalState.backendTaskId),
          isNull(operatorRuns.eventEmittedAt),
        ),
      )
      .returning({ id: operatorRuns.id });

    if (stampResult.length === 0) {
      // Race loser — another finalise won.
      return { finalised: false, parentTerminalStatus };
    }

    // Write parent agent_run status, guarded against terminal-parent race.
    // If a concurrent finaliser (cancel, timeout, reconciler) already wrote a
    // terminal status, the IN-clause predicate returns 0 rows and we suppress
    // the post-commit side effects to avoid double cost rows / continuations.
    const isParentTerminal =
      parentTerminalStatus !== 'paused_for_chain_continuation' &&
      parentTerminalStatus !== 'paused_chain_failure' &&
      parentTerminalStatus !== 'paused_budget_exceeded' &&
      parentTerminalStatus !== 'paused_wall_clock_exceeded';

    const parentUpdateResult = await tx
      .update(agentRuns)
      .set({
        status: sql`${parentTerminalStatus}`,
        updatedAt: new Date(),
        ...(isParentTerminal ? { completedAt: new Date() } : {}),
      })
      .where(
        and(
          eq(agentRuns.id, row.agentRunId),
          sql`${agentRuns.status} NOT IN ('completed','failed','cancelled','timeout','budget_exceeded','loop_detected','completed_with_uncertainty')`,
        ),
      )
      .returning({ id: agentRuns.id });

    if (parentUpdateResult.length === 0) {
      // Race lost — another writer (cancel/timeout/reconciler) already set a
      // terminal status. eventEmittedAt was already stamped above; suppress
      // cost-write and continuation enqueue to avoid double-counting.
      return { finalised: false, parentTerminalStatus: parentRun.status };
    }

    // Post-commit: write cost rows + emit WebSocket + enqueue continuation if needed.
    const agentRunId = row.agentRunId;
    const organisationId = row.organisationId;
    const subaccountId = row.subaccountId;
    const operatorRunId = row.id;
    const action = resumeDecision.action;

    const postCommit = async (): Promise<void> => {
      // Write cost rows (outside tx — cost writer opens its own tx).
      try {
        await operatorCostWriter.writeRowsForChainLink({
          orgId: organisationId,
          subaccountId,
          operatorRunId,
          sandboxComputeCents: 0, // V1: sandbox cost comes from harvest pipeline
          vcpuSeconds: 0,
          wallClockMs: row.completedAt && row.startedAt
            ? row.completedAt.getTime() - row.startedAt.getTime()
            : 0,
          peakMemoryBytes: 0,
        });
      } catch (err) {
        logger.error('operator.finalise.cost_write_failed', {
          operatorRunId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Emit WebSocket update — chain-link terminal event (name is status-specific).
      const chainLinkEventName =
        terminalState.status === 'cancelled'
          ? OPERATOR_SESSION_CHAIN_LINK_CANCELLED
          : terminalState.status === 'failed'
            ? OPERATOR_SESSION_CHAIN_LINK_FAILED
            : OPERATOR_SESSION_CHAIN_LINK_COMPLETED;
      emitAgentRunUpdate(agentRunId, chainLinkEventName, {
        operatorRunId,
        chainSeq,
        parentStatus: parentTerminalStatus,
        action,
      });

      // If chain resume is needed, enqueue the next chain-link dispatch job.
      if (action === 'dispatch_next_chain_link') {
        try {
          const { getPgBoss } = await import('../../lib/pgBossInstance.js');
          const boss = await getPgBoss();
          await boss.send(
            'operator-session-dispatch-next-chain-link',
            {
              agentRunId,
              organisationId,
              subaccountId,
              reason: 'continuation',
              parentChainLinkId: operatorRunId,
            },
            { singletonKey: `operator-continuation:${agentRunId}` },
          );
        } catch (err) {
          logger.error('operator.finalise.enqueue_continuation_failed', {
            agentRunId,
            operatorRunId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };

    return {
      finalised: true,
      parentTerminalStatus,
      postCommit,
    };
  },

  // ---------------------------------------------------------------------------
  // reconcile — scan stale running chain links (heartbeat backstop)
  // ---------------------------------------------------------------------------

  async reconcile(): Promise<number> {
    const staleThreshold = new Date(Date.now() - HEARTBEAT_STALE_MINUTES * 60 * 1000);

    // Cross-tenant scan: bypass RLS to find stale rows across all orgs.
    const staleRows = await withAdminConnectionGuarded(
      // allowRlsBypass: cross-tenant reconcile scan — rows are subsequently processed per-org via setOrgAndSubaccountGUC inside each row's tx.
      { source: 'operatorManagedBackend.reconcile', allowRlsBypass: true },
      async (tx) =>
        tx
          .select({
            id: operatorRuns.id,
            agentRunId: operatorRuns.agentRunId,
            organisationId: operatorRuns.organisationId,
            subaccountId: operatorRuns.subaccountId,
          })
          .from(operatorRuns)
          .where(
            and(
              eq(operatorRuns.status, 'running'),
              or(
                isNull(operatorRuns.lastProgressAt),
                lt(operatorRuns.lastProgressAt, staleThreshold),
              ),
            ),
          )
          .limit(100),
    );

    let count = 0;
    for (const row of staleRows) {
      try {
        await db.transaction(async (tx) => {
          await setOrgAndSubaccountGUC(tx, row.organisationId, row.subaccountId);

          const updated = await tx
            .update(operatorRuns)
            .set({
              status: 'failed',
              failureReason: 'heartbeat_stale',
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(operatorRuns.id, row.id),
                eq(operatorRuns.status, 'running'),
              ),
            )
            .returning({ id: operatorRuns.id });

          if (updated.length > 0) {
            count++;
          }
        });

        // Trigger finalisation for the stale row.
        const { finaliseAgentRunFromBackend } = await import('../agentRunFinalizationService.js');
        await finaliseAgentRunFromBackend({
          backendId: 'operator_managed',
          backendTaskId: row.id,
          organisationId: row.organisationId,
          subaccountId: row.subaccountId,
        });
      } catch (err) {
        logger.error('operator.reconcile.stale_row_failed', {
          operatorRunId: row.id,
          agentRunId: row.agentRunId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return count;
  },

  // ---------------------------------------------------------------------------
  // cancel — chain-aware task cancellation (spec §3.10)
  // ---------------------------------------------------------------------------

  async cancel({ runId, backendTaskId }): Promise<void> {
    logger.info('operator.cancel.requested', { agentRunId: runId, backendTaskId });

    // Step 1: Signal cancel intent on the active chain link.
    if (backendTaskId) {
      // guard-ignore: with-org-tx-or-scoped-db reason="cross-tenant/admin operation — cancel path looks up run by backendTaskId before org is known; org scoped via setOrgAndSubaccountGUC inside tx"
      const [run] = await db
        .select({
          id: operatorRuns.id,
          organisationId: operatorRuns.organisationId,
          subaccountId: operatorRuns.subaccountId,
          agentRunId: operatorRuns.agentRunId,
        })
        .from(operatorRuns)
        .where(eq(operatorRuns.id, backendTaskId))
        .limit(1);

      if (run) {
        await db.transaction(async (tx) => {
          await setOrgAndSubaccountGUC(tx, run.organisationId, run.subaccountId);
          await tx
            .update(operatorRuns)
            .set({
              cancelRequestedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(operatorRuns.id, backendTaskId),
                isNull(operatorRuns.cancelRequestedAt),
              ),
            );
        });
      }
    }

    // Step 2: Transition agent_run to 'cancelled'.
    // Closed predecessor set per spec §3.10 step 3 — terminal states are
    // excluded so a late cancel call cannot overwrite a completed/failed run.
    // guard-ignore: with-org-tx-or-scoped-db reason="Tier 2 — admin/system/cross-tenant path; cancel path looks up run by runId before org is known; org scoped via setOrgGUC inside tx"
    const [agentRun] = await db
      .select({ organisationId: agentRuns.organisationId })
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
      .limit(1);

    if (agentRun) {
      // guard-ignore: with-org-tx-or-scoped-db reason="Tier 2 — admin/system/cross-tenant path; transaction sets org GUC via setOrgGUC before DML"
      await db.transaction(async (tx) => {
        await setOrgGUC(tx, agentRun.organisationId);
        await tx
          .update(agentRuns)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(
            and(
              eq(agentRuns.id, runId),
              sql`${agentRuns.status} IN ('delegated','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded','paused_wall_clock_exceeded','pending')`,
            ),
          );
      });
    }

    // Step 3: The continuation dispatcher re-reads status and exits no-op
    // when status='cancelled' (cancel-vs-dispatch invariant; handled in the
    // dispatch-next-chain-link handler's predecessor allow-list check).

    emitAgentRunUpdate(runId, OPERATOR_SESSION_TASK_CANCELLED, { agentRunId: runId });
  },
};
