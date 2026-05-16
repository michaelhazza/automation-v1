/**
 * _ieeShared — internal helper consumed by `ieeBrowserBackend.ts` and
 * `ieeDevBackend.ts`.
 *
 * The two IEE adapters share storage (`iee_runs`), share an event queue
 * (`iee-run-completed`), and share most of their lifecycle plumbing —
 * dispatch, terminal-state load, finalisation, reconcile, cancel. The only
 * per-adapter delta is the discriminator (`'browser'` vs `'dev'`) used to:
 *   - validate the inbound `ieeTask.type` at `dispatch()` entry,
 *   - scope `reconcile()` so each adapter processes a disjoint slice of
 *     `iee_runs` rows (no double-processing — spec § 9.2 / § 4.5).
 *
 * The plan (Chunk 3 module shape) sets a 30-line threshold for inlining
 * vs extracting; the duplicated body (dispatch + finalise + reconcile) is
 * well above that threshold so the helper is justified.
 *
 * Cycle prevention — same rule as `executionBackends/types.ts`: this file
 * MUST NOT import from `agentExecutionService.ts`. It imports pure helpers
 * from `agentRunFinalizationServicePure.ts` and `updateMeaningfulRunTracking`
 * from `agentRunFinalizationService.ts`. No cycle exists: the orchestrator
 * (`agentRunFinalizationService.ts`) imports the registry which imports only
 * `types.ts` — there is no path back to `_ieeShared.ts`.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 4.5,
 *       § 9.2, § 13.1.1.
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { eq, sql, and, isNull, inArray } from 'drizzle-orm';

import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { withAdminConnection } from '../../lib/adminDbConnection.js';
import { agentRuns } from '../../db/schema/agentRuns.js';
import { ieeRuns } from '../../db/schema/ieeRuns.js';
import { llmRequests } from '../../db/schema/llmRequests.js';
import { subaccountIeeBrowserSettings } from '../../db/schema/subaccountIeeBrowserSettings.js';
import { ieeBrowserProfileManager } from '../sandbox/ieeBrowserProfileManager.js';
import { browserWarmPool } from '../sandbox/browserWarmPool.js';
import { runTask as sandboxRunTask } from '../sandboxExecutionService.js';
import { emitAgentRunUpdate, emitOrgUpdate, emitSubaccountUpdate } from '../../websocket/emitters.js';
import { logger } from '../../lib/logger.js';
import { assertValidTransition } from '../../../shared/stateMachineGuards.js';
import { TERMINAL_RUN_STATUSES } from '../../../shared/runStatus.js';
import {
  mapIeeStatusToAgentRunStatus,
  buildSummaryFromIeeRun,
} from '../agentRunFinalizationServicePure.js';
import { updateMeaningfulRunTracking } from '../agentRunFinalizationService.js';
import { computeRunResultStatus } from '../agentExecutionServicePure.js';
import { FailureError, failure } from '../../../shared/iee/failure.js';
import { IEE_BROWSER_EVENT_WARM_POOL_MISS } from '../sandbox/ieeBrowserCostAlarmEvaluatorPure.js';

import type { Transaction } from '../../db/index.js';
import type {
  BackendDispatchInput,
  BackendDispatchResult,
  BackendFinalisationInput,
  BackendFinalisationResult,
  BackendTerminalState,
} from './types.js';
import {
  BackendOptionsMismatch,
  ParentRunNotDispatchable,
} from './types.js';
import type { LoopResult } from '../agentExecutionTypes.js';
import type { SandboxPolicy } from '../../../shared/types/sandbox.js';

type IeeRunRow = typeof ieeRuns.$inferSelect;
type IeeType = 'browser' | 'dev';

// ---------------------------------------------------------------------------
// Terminal event payload — single source of truth.
//
// Mirrors the shallow shape the worker emits onto `iee-run-completed`. The
// existing handler-side `validatePayload` body in `ieeRunCompletedHandler.ts`
// derives from this schema so adapter and handler never drift.
//
// ---------------------------------------------------------------------------

export const SUPPORTED_IEE_EVENT_VERSION = 1 as const;

export const ieeRunCompletedPayloadSchema = z.object({
  // Pre-versioning (no `version` field) events are treated as v1 for
  // backwards compatibility with any in-flight pg-boss jobs at deploy
  // time. Future bumps must NOT accept a missing version — make this a
  // required `z.literal(SUPPORTED_IEE_EVENT_VERSION)` once the v0 deploy
  // window has fully drained.
  version: z.number().optional(),
  eventKey: z.string(),
  ieeRunId: z.string().min(1),
  status: z.enum(['completed', 'failed', 'cancelled']),
  failureReason: z.string().nullable().optional(),
  totalCostCents: z.number().optional(),
  stepCount: z.number().optional(),
});

export type IeeRunCompletedPayload = z.infer<typeof ieeRunCompletedPayloadSchema>;

// ---------------------------------------------------------------------------
// Shared identity slots.
// ---------------------------------------------------------------------------

export const IEE_COMPLETED_QUEUE = 'iee-run-completed' as const;
export const IEE_TERMINAL_STATE_TABLE = 'iee_runs' as const;

// ---------------------------------------------------------------------------
// Browser-dispatch pure helpers (exported for unit testing).
// ---------------------------------------------------------------------------

type BrowserSettingsRow = {
  status: string;
  rolloutApproved: boolean;
  perTaskCostCeilingCents: number;
};

type WarmCheckoutResult = { warmSessionId: string; sandboxId: string } | null;

export type BrowserDispatchDecision =
  | { kind: 'launch_disabled' }
  | { kind: 'warm_leased'; warmSessionId: string; sandboxId: string }
  | { kind: 'cold_start' };

/**
 * Pure: resolve the browser dispatch decision given settings + warm checkout result.
 * Exported for unit testing only; callers use ieeDispatchBrowser.
 */
export function resolveBrowserDispatch(
  settings: BrowserSettingsRow | null,
  warmCheckout: WarmCheckoutResult,
): BrowserDispatchDecision {
  if (!settings || settings.status !== 'on' || !settings.rolloutApproved) {
    return { kind: 'launch_disabled' };
  }
  if (warmCheckout) {
    return { kind: 'warm_leased', warmSessionId: warmCheckout.warmSessionId, sandboxId: warmCheckout.sandboxId };
  }
  return { kind: 'cold_start' };
}

/**
 * Pure: derive the browser profile session key from the task payload.
 * Uses skillId if available; falls back to 'default' (spec §14 path (b)).
 */
export function deriveSessionKey(taskPayload: { skillId?: string }): string {
  const raw = taskPayload.skillId ?? 'default';
  const sanitised = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  return sanitised.length > 0 ? sanitised : 'default';
}

// ---------------------------------------------------------------------------
// ieeDispatchBrowser — inline sandbox dispatch for browser tasks.
// ---------------------------------------------------------------------------

async function ieeDispatchBrowser(args: IeeDispatchArgs): Promise<BackendDispatchResult> {
  const { input } = args;
  const { subaccountId, organisationId, runId, agentId } = input;

  if (!subaccountId) {
    throw new FailureError(failure('iee_browser_launch_disabled', 'Browser tasks require a subaccount context'));
  }

  // 1. Read launch flag and check FIRST — throw before touching warm pool
  const scopedDb = getOrgScopedDb('ieeDispatchBrowser.readSettings');
  const [settings] = await scopedDb.select().from(subaccountIeeBrowserSettings)
    .where(eq(subaccountIeeBrowserSettings.subaccountId, subaccountId));

  // Step 1: Check launch flag FIRST — throw before touching warm pool
  const launchOnlyDecision = resolveBrowserDispatch(settings ?? null, null);
  if (launchOnlyDecision.kind === 'launch_disabled') {
    throw new FailureError(failure('iee_browser_launch_disabled', 'IEE browser feature is disabled for this subaccount'));
  }

  // Step 2: Now attempt warm checkout. Pass the same settings snapshot we
  // validated in Step 1 — do NOT re-read here (avoids split-brain if another
  // admin changes settings mid-dispatch). resolveBrowserDispatch handles null
  // explicitly so we use `settings ?? null` rather than the non-null assertion.
  const warmCheckout = await browserWarmPool.checkout({ organisationId, subaccountId });
  const decision = resolveBrowserDispatch(settings ?? null, warmCheckout);
  if (decision.kind === 'launch_disabled') {
    // Settings became invalid between Step 1 and Step 2 (race with admin toggle).
    // Return any warm session we just leased before throwing.
    if (warmCheckout) {
      await browserWarmPool.terminate({ warmSessionId: warmCheckout.warmSessionId, reason: 'post_lease', organisationId, subaccountId }).catch(() => {});
    }
    throw new FailureError(failure('iee_browser_launch_disabled', 'IEE browser feature became disabled mid-dispatch'));
  }
  // (decision will be warm_leased or cold_start — race-handler above caught launch_disabled)

  // From this point onward a warm session may be leased. Every exit path
  // (including failures in profile resolve/mount, policy build, runTask, etc.)
  // must terminate that lease — otherwise the warm_sessions row is stuck in
  // 'leased' forever and cost attribution never closes. We hold the
  // mounted-profile handle in a closure-scoped var so the finally block can
  // unmount it iff resolve+mount succeeded; null means setup failed before
  // mount, so there is nothing to unmount.
  let mounted: import('../sandbox/ieeBrowserProfileManager.js').MountedProfile | null = null;
  let sandboxOutput;
  try {
    if (decision.kind === 'cold_start') {
      logger.info(IEE_BROWSER_EVENT_WARM_POOL_MISS, {
        subaccountId,
        reason: 'no_warm_session_available',
      });
    }

    // 2. Derive session key and resolve profile
    const opts = input.backendOptions;
    const ieeTask = (opts as { ieeTask?: { skillId?: string } }).ieeTask;
    const sessionKey = deriveSessionKey(ieeTask ?? {});

    const profile = await ieeBrowserProfileManager.resolve({ organisationId, subaccountId, sessionKey });
    mounted = await ieeBrowserProfileManager.mount(profile, { organisationId, subaccountId });

    // 3. Build policy (V1: deny-all network, standard ceilings)
    // TODO IEE-DEF-7: network.mode='none' makes Playwright browser tasks
    // unable to navigate. This is the V1 stub posture — production network
    // policy (allowlist per skill, allowlist per subaccount, or open) must be
    // wired before any subaccount sets rolloutApproved=true. The
    // assertNotLatestTemplateVersion guard and the SDK-not-installed factory
    // prevent dispatch from reaching this code path in production today.
    // Tracked in tasks/todo.md IEE-DEF-7.
    const costCents = settings?.perTaskCostCeilingCents ?? 100;
    const policy: SandboxPolicy = {
      network: { mode: 'none' },
      filesystem: { writableRoot: '/workspace' },
      ceilings: {
        wallClockMs: 300_000, // 5 min default for browser tasks
        costCents,
        monitorIntervalMs: 5_000,
      },
      artefactLimits: { perArtefactBytes: 10_485_760, totalBytes: 104_857_600 },
      allowRuntimeInstall: false,
      inputLimits: { maxBytes: 26_214_400, allowedMimes: [] },
      providerThresholds: { startTimeoutMs: 30_000 },
    };

    const sandboxExecutionId = randomUUID();
    const warmSessionCheckoutId = decision.kind === 'warm_leased' ? decision.warmSessionId : null;
    // When warm-leased, hand the existing provider sandbox id to e2bSandbox so
    // it adopts the pre-warmed sandbox instead of calling createSandbox().
    // Cold-start dispatches leave this undefined and the provider creates a
    // fresh sandbox. This is the whole point of the warm-pool lease.
    const leasedProviderSandboxId = decision.kind === 'warm_leased' ? decision.sandboxId : undefined;

    sandboxOutput = await sandboxRunTask({
      sandboxExecutionId,
      organisationId,
      subaccountId,
      runId,
      agentId,
      taskId: runId, // browser tasks use runId as taskId
      templateName: 'iee-browser',
      templateVersion: 'local-dev-v1.0.0', // resolved from CURRENT_VERSION at runtime by provider
      policy,
      inputBytes: 0,
      inputFiles: [],
      credentialIssuanceContext: { aliases: [] },
      outputSchemaRef: 'generic',
      profileMount: mounted,
      warmSessionCheckoutId,
      // Thread the browser task envelope through to the in-sandbox harness.
      // e2bSandbox writes this to /workspace/input.json as `taskPayload`.
      browserTaskPayload: ieeTask ?? null,
      leasedProviderSandboxId,
    });
  } finally {
    // Warm-pool teardown — runs whether runTask succeeds, throws, or rejects,
    // AND covers earlier failures (profile resolve/mount, policy build).
    // Cost attribution is owned by browserWarmPool.terminate (chunk 10).
    if (decision.kind === 'warm_leased') {
      await browserWarmPool.terminate({ warmSessionId: decision.warmSessionId, reason: 'post_lease', organisationId, subaccountId }).catch((err) => {
        logger.error('iee_browser.dispatch.warm_terminate_failed', {
          warmSessionId: decision.warmSessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    if (mounted) {
      await ieeBrowserProfileManager.unmount(mounted, { organisationId, subaccountId }).catch((err) => {
        logger.warn('iee_browser.dispatch.profile_unmount_failed', {
          profileId: mounted!.sessionProfileId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  const loopResult: LoopResult = {
    summary: `IEE browser task completed via e2b sandbox (${sandboxOutput?.terminalState ?? 'unknown'})`,
    toolCallsLog: [],
    totalToolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    deliverablesCreated: 0,
    finalStatus: sandboxOutput?.terminalState === 'completed' ? 'completed' : 'failed',
  };

  return {
    lifecycle: 'in_process',
    backendTaskId: null,
    loopResult,
    deduplicated: false,
  };
}

// ---------------------------------------------------------------------------
// dispatch() — orphan-cleanup-aware delegated dispatch (§ 13.1.1).
// ---------------------------------------------------------------------------

interface IeeDispatchArgs {
  type: IeeType;
  /** The adapter's own id, used for the typed mismatch error and parent-row backendId write. */
  adapterId: 'iee_browser' | 'iee_dev';
  input: BackendDispatchInput;
}

/**
 * Shared dispatch body. Lifts the IEE branch of
 * `agentExecutionService.ts:1413–1473` into the adapter contract.
 *
 * Sequence (per § 13.1.1):
 *   1. enqueueIEETask — backend task created/dedup-resolved against
 *      `iee_runs.idempotency_key` UNIQUE.
 *   2. Parent UPDATE — gated on `status IN ('pending', 'running')`.
 *   3. On 0-rows Step 2: write `iee_runs.status = 'cancelled',
 *      failure_reason = 'parent_orphaned'` and throw
 *      `ParentRunNotDispatchable`.
 */
export async function ieeDispatch(args: IeeDispatchArgs): Promise<BackendDispatchResult> {
  const { type, adapterId, input } = args;
  const opts = input.backendOptions;

  // Mismatch check — every adapter's dispatch() FIRST statement, before the
  // type branch (Execution Backend Adapter Contract spec § 16 #13). Pinning
  // the discriminator first means a misrouted browser→dev or dev→browser
  // backendId surfaces BackendOptionsMismatch (the typed contract error),
  // not a downstream feature-flag error from inside the type branch.
  if (opts.backendId !== adapterId) {
    throw new BackendOptionsMismatch(adapterId, opts.backendId);
  }

  if (type === 'browser') {
    return ieeDispatchBrowser(args);
  }

  // Required-task guard. The dispatch-site no longer pre-validates this
  // (Chunk 5 acceptance criterion § 16 #1 requires zero `if (effectiveMode
  // === 'iee_*')` blocks in `agentExecutionService.ts`), so the
  // typecheck-narrowed but value-undefined case is handled here.
  const ieeTask = opts.ieeTask;
  if (!ieeTask) {
    throw Object.assign(new Error(`adapter '${adapterId}' requires ieeTask but received undefined`), {
      statusCode: 400,
      errorCode: 'IEE_TASK_REQUIRED',
    });
  }
  if (ieeTask.type !== type) {
    throw Object.assign(new Error(`adapter '${adapterId}' requires ieeTask.type='${type}', got '${ieeTask.type}'`), {
      statusCode: 400,
      errorCode: 'IEE_TASK_TYPE_MISMATCH',
    });
  }

  // Step 1 — backend task enqueue. Late-imported to avoid the
  // `executionBackends` -> `ieeExecutionService` -> ... import cycle.
  const { enqueueIEETask } = await import('../ieeExecutionService.js');
  const enqueueResult = await enqueueIEETask({
    task: ieeTask as Parameters<typeof enqueueIEETask>[0]['task'],
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    agentId: input.agentId,
    agentRunId: input.runId,
    correlationId: input.runId,
  });

  // Step 2 — parent UPDATE. Gated on non-terminal status set so a parent
  // that has raced past the delegation window (cancellation, etc.) does
  // NOT receive a stale `status='delegated'` write. `ieeRunId` dual-write
  // preserves the existing denormalised cache (migration 0176) until
  // Chunk 5 retires it.
  const dispatchScopedDb = getOrgScopedDb('ieeDispatch.parentUpdate');
  const updated = await dispatchScopedDb.update(agentRuns)
    .set({
      status: 'delegated',
      backendId: adapterId,
      backendTaskId: enqueueResult.ieeRunId,
      ieeRunId: enqueueResult.ieeRunId,
      summary: `Delegated to IEE ${type} (ieeRunId=${enqueueResult.ieeRunId}${enqueueResult.deduplicated ? ', deduplicated' : ''})`,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(agentRuns.id, input.runId),
      eq(agentRuns.organisationId, input.organisationId),
      inArray(agentRuns.status, ['pending', 'running'] as const),
    ))
    .returning({ id: agentRuns.id });

  if (updated.length === 0) {
    // Step 3 — orphan cleanup. The backend task was created in Step 1 but
    // the parent has already moved past the delegation window. Mark the
    // backend row as orphaned and throw the typed diagnostic so the
    // dispatch-site caller can log + return rather than 5xx.
    await dispatchScopedDb.update(ieeRuns)
      .set({
        status: 'cancelled',
        failureReason: 'parent_orphaned',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(ieeRuns.id, enqueueResult.ieeRunId),
        eq(ieeRuns.organisationId, input.organisationId),
        inArray(ieeRuns.status, ['pending', 'running'] as const),
      ));

    logger.warn('iee.dispatch.parent_orphaned', {
      adapterId,
      runId: input.runId,
      ieeRunId: enqueueResult.ieeRunId,
    });

    throw new ParentRunNotDispatchable(input.runId, 'already_terminal');
  }

  emitAgentRunUpdate(input.runId, 'agent:run:delegated', {
    ieeRunId: enqueueResult.ieeRunId,
    mode: adapterId,
    deduplicated: enqueueResult.deduplicated,
  });

  return {
    lifecycle: 'delegated',
    backendTaskId: enqueueResult.ieeRunId,
    loopResult: null,
    deduplicated: enqueueResult.deduplicated,
  };
}

// ---------------------------------------------------------------------------
// loadTerminalState — common across the two IEE adapters.
// ---------------------------------------------------------------------------

export async function ieeLoadTerminalState(
  tx: Transaction,
  backendTaskId: string,
): Promise<BackendTerminalState | null> {
  const [row] = await tx
    .select()
    .from(ieeRuns)
    .where(eq(ieeRuns.id, backendTaskId))
    .for('update')
    .limit(1);

  if (!row) return null;

  return {
    agentRunId: row.agentRunId ?? '',
    backendTaskId: row.id,
    status: row.status,
    failureReason: row.failureReason ?? null,
    completedAt: row.completedAt ?? null,
    eventEmittedAt: row.eventEmittedAt ?? null,
    resultSummary: row.resultSummary,
    raw: row,
  };
}

// ---------------------------------------------------------------------------
// finalise — lift of the legacy IEE finaliser body that previously
// lived in agentRunFinalizationService.ts, minus row-loading.
// ---------------------------------------------------------------------------

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  llmCallCount: number;
}

async function aggregateTokensForIeeRun(tx: Transaction, ieeRunId: string): Promise<TokenTotals> {
  const [row] = await tx
    .select({
      inputTokens: sql<number>`COALESCE(SUM(${llmRequests.tokensIn}), 0)::int`,
      outputTokens: sql<number>`COALESCE(SUM(${llmRequests.tokensOut}), 0)::int`,
      totalTokens: sql<number>`COALESCE(SUM(${llmRequests.tokensIn} + ${llmRequests.tokensOut}), 0)::int`,
      llmCallCount: sql<number>`COUNT(*)::int`,
    })
    .from(llmRequests)
    .where(eq(llmRequests.ieeRunId, ieeRunId));
  return {
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    llmCallCount: Number(row?.llmCallCount ?? 0),
  };
}

const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_RUN_STATUSES);

export async function ieeFinalise(
  finalisationInput: BackendFinalisationInput,
): Promise<BackendFinalisationResult> {
  const { tx, terminalState, parentRun } = finalisationInput;
  const ieeRun = terminalState.raw as IeeRunRow;

  // Defensive guard. The pure mapping table only handles terminal IEE
  // statuses; a non-terminal `loadTerminalState` row should never reach
  // here because the worker emits the event after the terminal write,
  // but keeping the guard makes the function self-contained.
  if (ieeRun.status !== 'completed' && ieeRun.status !== 'failed' && ieeRun.status !== 'cancelled') {
    logger.warn('agentRunFinalization.non_terminal_iee_run', {
      ieeRunId: ieeRun.id,
      ieeStatus: ieeRun.status,
    });
    return { finalised: false, parentTerminalStatus: parentRun?.status ?? '' };
  }

  // No parent run available — either standalone backend task
  // (`!ieeRun.agentRunId`) or parent row was deleted between dispatch and
  // finalisation (`parentRun === null`). In both cases the orchestrator
  // has nothing to transition; we still stamp `eventEmittedAt` so the
  // worker's retry sweep stops re-firing the terminal event.
  if (!ieeRun.agentRunId || parentRun === null) {
    if (!ieeRun.eventEmittedAt) {
      await tx
        .update(ieeRuns)
        .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(ieeRuns.id, ieeRun.id),
          eq(ieeRuns.organisationId, ieeRun.organisationId),
        ));
    }
    return { finalised: false, parentTerminalStatus: parentRun?.status ?? '' };
  }

  const parentAlreadyTerminal = TERMINAL_SET.has(parentRun.status);

  // Idempotent race-loser: parent already terminal AND the iee event has
  // already been marked emitted. Both writes have happened — exit without
  // another touch.
  if (parentAlreadyTerminal && terminalState.eventEmittedAt) {
    return { finalised: false, parentTerminalStatus: parentRun.status };
  }

  const terminalStatus = mapIeeStatusToAgentRunStatus(ieeRun.status, ieeRun.failureReason);

  // Reconciliation observability — if the parent was already in
  // 'cancelling' but the IEE run resolved to something other than
  // 'cancelled', the run completed before the worker observed the cancel.
  if (parentRun.status === 'cancelling' && terminalStatus !== 'cancelled') {
    logger.warn('agentRunFinalization.cancel_intent_divergence', {
      ieeRunId: ieeRun.id,
      agentRunId: parentRun.id,
      parentStatusAtFinalization: parentRun.status,
      finalStatus: terminalStatus,
    });
  }

  const summary = buildSummaryFromIeeRun(ieeRun);
  const parentSubaccountId = (parentRun.subaccountId ?? null) as string | null;
  const parentIsSubAgent = (parentRun.isSubAgent ?? false) as boolean;
  const parentAgentId = (parentRun.agentId ?? null) as string | null;
  const parentOrganisationId = (parentRun.organisationId ?? null) as string | null;
  const parentStartedAt = (parentRun.startedAt ?? null) as Date | null;
  const parentCreatedAt = (parentRun.createdAt ?? new Date()) as Date;
  const startedAt = parentStartedAt ?? ieeRun.startedAt ?? parentCreatedAt;
  const completedAt = ieeRun.completedAt ?? new Date();
  const durationMs = completedAt.getTime() - new Date(startedAt).getTime();

  const isFailureStatus = terminalStatus === 'failed'
    || terminalStatus === 'timeout'
    || terminalStatus === 'loop_detected'
    || terminalStatus === 'budget_exceeded';
  const errorMessage = isFailureStatus
    ? `IEE run ${ieeRun.failureReason ?? 'failed'}`
    : null;
  const errorDetail = isFailureStatus
    ? {
        failureReason: ieeRun.failureReason,
        ieeRunId: ieeRun.id,
        resultSummary: ieeRun.resultSummary,
      }
    : null;

  let performedTransition = false;

  if (!parentAlreadyTerminal) {
    assertValidTransition({
      kind: 'agent_run',
      recordId: parentRun.id,
      from: parentRun.status,
      to: terminalStatus,
    });

    const tokens = await aggregateTokensForIeeRun(tx, ieeRun.id);

    const ieeDerivedRunResultStatus = computeRunResultStatus(
      terminalStatus,
      /* hasError */ isFailureStatus,
      /* hadUncertainty */ false,
    );

    const updated = await tx
      .update(agentRuns)
      .set({
        status: terminalStatus,
        runResultStatus: ieeDerivedRunResultStatus,
        summary,
        errorMessage,
        errorDetail,
        completedAt,
        durationMs,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        totalTokens: tokens.totalTokens,
        totalToolCalls: tokens.llmCallCount,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(agentRuns.id, parentRun.id),
        eq(agentRuns.organisationId, parentRun.organisationId as string),
        inArray(agentRuns.status, ['pending', 'running', 'delegated', 'cancelling'] as const),
        isNull(agentRuns.completedAt),
        isNull(agentRuns.runResultStatus),
      ))
      .returning({ id: agentRuns.id });
    performedTransition = updated.length > 0;
    if (!performedTransition) {
      logger.warn('runResultStatus.write_skipped', {
        runId: parentRun.id,
        ieeRunId: ieeRun.id,
        attemptedStatus: ieeDerivedRunResultStatus,
        writeSite: 'ieeFinalise',
      });
    }
  }

  if (!ieeRun.eventEmittedAt) {
    await tx
      .update(ieeRuns)
      .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(ieeRuns.id, ieeRun.id),
        eq(ieeRuns.organisationId, ieeRun.organisationId),
      ));
  }

  // Build the post-commit emit closure ONLY when the transition fired.
  // The orchestrator awaits it after `db.transaction()` resolves so a
  // tx rollback does not produce ghost websocket events.
  const postCommit = performedTransition
    ? async () => {
        emitAgentRunUpdate(ieeRun.agentRunId!, 'agent:run:completed', {
          ieeRunId: ieeRun.id,
          finalStatus: terminalStatus,
          failureReason: ieeRun.failureReason ?? null,
        });

        if (!parentIsSubAgent && parentOrganisationId) {
          emitOrgUpdate(parentOrganisationId, 'dashboard.activity.updated', {
            source: 'agent_run',
            runId: ieeRun.agentRunId,
            finalStatus: terminalStatus,
          });
        }

        if (parentSubaccountId && !parentIsSubAgent) {
          emitSubaccountUpdate(parentSubaccountId, 'live:agent_completed', {
            runId: ieeRun.agentRunId,
            agentId: parentAgentId,
            ieeRunId: ieeRun.id,
            finalStatus: terminalStatus,
          });
        }

        logger.info('agentRunFinalization.transitioned', {
          ieeRunId: ieeRun.id,
          agentRunId: ieeRun.agentRunId,
          fromStatus: 'delegated',
          toStatus: terminalStatus,
          failureReason: ieeRun.failureReason ?? null,
        });

        if (terminalStatus === 'completed') {
          await updateMeaningfulRunTracking(ieeRun.agentRunId!, terminalStatus).catch((err) => {
            logger.warn('agentRunFinalization.meaningful_hook_failed', {
              agentRunId: ieeRun.agentRunId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }
    : undefined;

  return {
    finalised: performedTransition,
    parentTerminalStatus: performedTransition ? terminalStatus : parentRun.status,
    postCommit,
  };
}

// ---------------------------------------------------------------------------
// reconcile — scoped by `iee_runs.type` so the two adapters process
// disjoint slices of the shared table (spec § 4.5 / § 9.2).
// ---------------------------------------------------------------------------

export async function ieeReconcile(args: {
  type: IeeType;
  /** The orchestrator entrypoint. Imported lazily to avoid a registry import. */
  finaliseAgentRunFromBackend: (a: { backendId: string; backendTaskId: string }) => Promise<boolean>;
  /** Adapter id passed back into the orchestrator. */
  adapterId: 'iee_browser' | 'iee_dev';
}): Promise<number> {
  const { type, finaliseAgentRunFromBackend, adapterId } = args;

  const stuck = await withAdminConnection(
    { source: 'ieeReconcile.scanStuck', reason: 'cross-tenant reconciliation sweep — reads delegated runs across all orgs' },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      return tx
        .select({
          agentRunId: agentRuns.id,
          ieeRunId: ieeRuns.id,
        })
        .from(agentRuns)
        .innerJoin(ieeRuns, eq(ieeRuns.agentRunId, agentRuns.id))
        .where(
          and(
            inArray(agentRuns.status, ['delegated', 'cancelling'] as const),
            sql`${ieeRuns.status} IN ('completed', 'failed', 'cancelled')`,
            isNull(ieeRuns.deletedAt),
            eq(ieeRuns.type, type),
            sql`${agentRuns.updatedAt} < now() - interval '120 seconds'`,
          ),
        )
        .limit(100);
    },
  );

  let transitioned = 0;
  for (const { ieeRunId } of stuck) {
    try {
      const did = await finaliseAgentRunFromBackend({
        backendId: adapterId,
        backendTaskId: ieeRunId,
      });
      if (did) transitioned += 1;
    } catch (err) {
      logger.error('agentRunFinalization.reconciliation_failed', {
        ieeRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (transitioned > 0) {
    logger.warn('agentRunFinalization.reconciled_stuck_delegated', {
      adapterId,
      type,
      count: transitioned,
      candidates: stuck.length,
    });
  }

  return transitioned;
}

// ---------------------------------------------------------------------------
// cancel — thin pass-through to the existing cancelIeeRun.
// ---------------------------------------------------------------------------

export async function ieeCancel(input: {
  runId: string;
  backendTaskId: string | null;
}): Promise<void> {
  if (!input.backendTaskId) return;
  // Late import to avoid the executionBackends -> agentRunCancelService cycle
  // (cancelService imports the IEE schemas which depend on shared types).
  const { agentRunCancelService } = await import('../agentRunCancelService.js');
  await agentRunCancelService.cancelIeeRun(input.backendTaskId);
}
