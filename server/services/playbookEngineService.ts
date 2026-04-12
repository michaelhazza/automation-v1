/**
 * playbookEngineService — the tick-driven execution engine.
 *
 * Spec: tasks/playbooks-spec.md §5.
 *
 * State machine driven by pg-boss jobs on the `playbook-run-tick` queue.
 * Each tick is the unit of progress: idempotent, transactional, exits
 * silently if state hasn't changed.
 *
 * Phase 1 implementation note
 * ─────────────────────────────
 * The full engine described in the spec is a large surface (kill switch
 * checks, batch cost breaker, watchdog sweep, output-hash firewall,
 * input-hash dedup, replay mode, side-effect-aware timeout handling, etc).
 * This file ships the core algorithm — tick → ready set → dispatch →
 * complete → re-tick — plus the safety primitives that have no tests yet
 * (no UI, no live runs). Sub-features that need additional surface area
 * (kill switch wired through orgStatus, replay-mode skill blocking)
 * have stubs that follow the spec semantics and log when invoked but
 * defer the full integration to the route + UI ship in steps 5-8.
 *
 * The engine deliberately keeps its public API tiny:
 *   - tick(runId)            : pg-boss handler
 *   - enqueueTick(runId)     : called by start, completion handlers, edits
 *   - completeStepRun(...)   : called when an external completion arrives
 *                              (form submission, approval, agent run done)
 *   - failStepRun(...)       : same for failure paths
 *   - onAgentRunCompleted(id): hook from agentRunService
 *   - watchdogSweep()        : 60s pg-boss cron handler
 *   - registerWorkers()      : called once at server boot from
 *                              agentScheduleService.initialize()
 */

import { eq, and, sql, isNull, lt, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  playbookRuns,
  playbookStepRuns,
  playbookTemplateVersions,
  systemPlaybookTemplateVersions,
  agents,
  systemAgents,
  subaccountAgents,
  organisations,
  subaccounts,
} from '../db/schema/index.js';
import type {
  PlaybookRun,
  PlaybookStepRun,
} from '../db/schema/index.js';
import type { PlaybookDefinition, PlaybookStep, RunContext, AgentDecisionStep } from '../lib/playbook/types.js';
import { hashValue } from '../lib/playbook/hash.js';
import { renderString, resolveInputs as resolveTemplateInputs, TemplatingError } from '../lib/playbook/templating.js';
import {
  computeSkipSet,
  parseDecisionOutput,
} from '../lib/playbook/agentDecisionPure.js';
import { renderAgentDecisionEnvelope } from '../lib/playbook/agentDecisionEnvelope.js';
import {
  MAX_DECISION_RETRIES,
  DEFAULT_DECISION_STEP_TIMEOUT_SECONDS,
  DECISION_RETRY_RAW_OUTPUT_TRUNCATE_CHARS,
} from '../config/limits.js';
import { logger } from '../lib/logger.js';
import { emitPlaybookRunUpdate, emitSubaccountUpdate } from '../websocket/emitters.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';
import type { PlaybookRunMode } from '../db/schema/playbookRuns.js';
import { playbookStepReviewService } from './playbookStepReviewService.js';

const TICK_QUEUE = 'playbook-run-tick';
const WATCHDOG_QUEUE = 'playbook-watchdog';
const AGENT_STEP_QUEUE = 'playbook-agent-step';

// ─── Engine constants (spec §1.5, §3.6, §5.2) ────────────────────────────────

const MAX_PARALLEL_STEPS_DEFAULT = 8;
const MAX_CONTEXT_BYTES_SOFT = 512 * 1024;
const MAX_CONTEXT_BYTES_HARD = 1024 * 1024;
const STEP_RUN_TIMEOUT_DEFAULT_MS = 30 * 60 * 1000; // 30 min
const WATCHDOG_INTERVAL_SECONDS = 60;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rehydrateDefinition(stored: Record<string, unknown>): PlaybookDefinition {
  return stored as unknown as PlaybookDefinition;
}

async function loadDefinitionForRun(run: PlaybookRun): Promise<PlaybookDefinition | null> {
  const [orgVer] = await db
    .select()
    .from(playbookTemplateVersions)
    .where(eq(playbookTemplateVersions.id, run.templateVersionId));
  if (orgVer) return rehydrateDefinition(orgVer.definitionJson as Record<string, unknown>);

  const [sysVer] = await db
    .select()
    .from(systemPlaybookTemplateVersions)
    .where(eq(systemPlaybookTemplateVersions.id, run.templateVersionId));
  if (sysVer) return rehydrateDefinition(sysVer.definitionJson as Record<string, unknown>);

  return null;
}

function findStepInDefinition(def: PlaybookDefinition, stepId: string): PlaybookStep | undefined {
  return def.steps.find((s) => s.id === stepId);
}

/**
 * Identifies the set of steps whose dependencies are all completed and
 * which themselves are still in 'pending' status.
 */
function computeReadySet(def: PlaybookDefinition, stepRuns: PlaybookStepRun[]): PlaybookStep[] {
  const completedStepIds = new Set(
    stepRuns.filter((s) => s.status === 'completed' || s.status === 'skipped').map((s) => s.stepId)
  );
  const ready: PlaybookStep[] = [];
  for (const step of def.steps) {
    const sr = stepRuns.find((s) => s.stepId === step.id && s.status === 'pending');
    if (!sr) continue;
    const depsMet = step.dependsOn.every((d) => completedStepIds.has(d));
    if (depsMet) ready.push(step);
  }
  return ready;
}

/**
 * Materialise pending step run rows for any step in the definition that has
 * all its dependencies in a terminal state (completed or skipped) but does
 * not yet have a live row of its own.
 *
 * This is the "subsequent steps are created by the engine as dependencies
 * complete" mechanism described in the createStepRunsForNewRun comment.
 * It is called at the start of every tick, before computeReadySet, so that
 * the ready-set computation always operates on a fully-materialised view.
 *
 * Rules:
 *   - All deps completed or skipped → create a pending row (step may run).
 *   - All deps skipped → create a skipped row directly (transitively skipped).
 *   - Entry steps (no deps) — should already have rows; if missing, create pending.
 *   - Steps with some deps not yet terminal — do nothing (not ready yet).
 *
 * Returns the number of rows materialised (for logging).
 */
async function materialisePendingStepRuns(
  runId: string,
  def: PlaybookDefinition,
  liveStepRuns: PlaybookStepRun[]
): Promise<number> {
  const existingStepIds = new Set(liveStepRuns.map((s) => s.stepId));
  const terminalStepIds = new Set(
    liveStepRuns
      .filter((s) => s.status === 'completed' || s.status === 'skipped')
      .map((s) => s.stepId)
  );

  let materialised = 0;
  for (const step of def.steps) {
    if (existingStepIds.has(step.id)) continue; // already has a live row

    if (step.dependsOn.length === 0) {
      // Entry step with no row — should have been created at run start.
      // Create it now as a safety net.
      try {
        await db.insert(playbookStepRuns).values({
          runId,
          stepId: step.id,
          stepType: step.type,
          status: 'pending',
          sideEffectType: step.sideEffectType,
          dependsOn: step.dependsOn,
        });
        materialised++;
      } catch {
        // Unique constraint — another tick created it concurrently. Ignore.
      }
      continue;
    }

    const allDepsTerminal = step.dependsOn.every((d) => terminalStepIds.has(d));
    if (!allDepsTerminal) continue; // not ready yet

    const allDepsSkipped = step.dependsOn.every((d) => {
      const sr = liveStepRuns.find((s) => s.stepId === d);
      return sr?.status === 'skipped';
    });
    const status = allDepsSkipped ? 'skipped' : 'pending';

    try {
      await db.insert(playbookStepRuns).values({
        runId,
        stepId: step.id,
        stepType: step.type,
        status,
        sideEffectType: step.sideEffectType,
        dependsOn: step.dependsOn,
        ...(status === 'skipped' ? { completedAt: new Date() } : {}),
      });
      materialised++;
    } catch {
      // Unique constraint — concurrent tick handled it. Ignore.
    }
  }

  return materialised;
}

/**
 * Emits a structured event to both the per-run room and the subaccount-level
 * coarse room. Spec §8.2 — wraps the existing emitter helpers which already
 * provide the eventId / timestamp envelope.
 */
async function emitPlaybookEvent(
  runId: string,
  subaccountId: string,
  type: string,
  payload: Record<string, unknown>,
  options?: { suppressWebSocket?: boolean }
): Promise<void> {
  // Sprint 4 P3.1: background mode suppresses all mid-run events.
  // Only final completion events (status === completed/failed/partial/cancelled)
  // are emitted regardless of suppression.
  if (options?.suppressWebSocket) {
    const isFinalEvent = type === 'playbook:run:status' && (
      payload.status === 'completed' ||
      payload.status === 'completed_with_errors' ||
      payload.status === 'failed' ||
      payload.status === 'cancelled' ||
      payload.status === 'partial'
    );
    if (!isFinalEvent) return;
  }
  // Allocate a per-run sequence number atomically. The DB increments
  // last_sequence and returns the new value so client-side ordering is
  // deterministic even if events arrive out of order.
  let sequence = 0;
  try {
    const result = await db.execute(
      sql`UPDATE playbook_run_event_sequences SET last_sequence = last_sequence + 1 WHERE run_id = ${runId} RETURNING last_sequence`
    );
    const row = (result as unknown as { rows?: Array<{ last_sequence: number | string }> }).rows?.[0];
    if (row) {
      sequence = typeof row.last_sequence === 'string' ? parseInt(row.last_sequence, 10) : row.last_sequence;
    }
  } catch (err) {
    // Sequence allocation failure should never block the emit. Log + use 0.
    logger.warn('playbook_ws_sequence_allocation_failed', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  emitPlaybookRunUpdate(runId, type, { ...payload, sequence });
  // Coarse subaccount-level event for dashboard / inbox badge updates.
  if (type === 'playbook:run:status') {
    emitSubaccountUpdate(subaccountId, type, { runId, ...payload, sequence });
  }
}

/** Asserts a context size is within the hard limit; throws otherwise. */
function assertContextSize(bytes: number, runId: string): void {
  if (bytes > MAX_CONTEXT_BYTES_HARD) {
    throw {
      statusCode: 422,
      message: `playbook context exceeded ${MAX_CONTEXT_BYTES_HARD} bytes (got ${bytes})`,
      errorCode: 'playbook_context_overflow',
      runId,
    };
  }
  if (bytes > MAX_CONTEXT_BYTES_SOFT) {
    logger.warn('playbook_context_soft_limit', { runId, bytes });
  }
}

/**
 * Merges a step output into the run context per §5.1.1 deterministic rules:
 * - Step outputs replace context.steps[stepId].output entirely (no deep merge).
 * - The reserved _meta namespace is never overwritten.
 * - Re-computes context_size_bytes for the soft/hard limit check.
 */
function mergeStepOutputIntoContext(
  context: RunContext,
  stepId: string,
  output: unknown
): RunContext {
  const next: RunContext = {
    input: context.input,
    subaccount: context.subaccount,
    org: context.org,
    steps: { ...context.steps, [stepId]: { output } },
    _meta: context._meta, // engine-managed, never replaced by steps
  };
  return next;
}

/**
 * Removes a step's output from the run context — used by mid-run editing's
 * invalidation cascade. The deletion is total; the key is removed, not set
 * to null. (Spec §5.1.1 rule 6.)
 */
function deleteStepOutputFromContext(context: RunContext, stepId: string): RunContext {
  const { [stepId]: _drop, ...rest } = context.steps;
  return {
    input: context.input,
    subaccount: context.subaccount,
    org: context.org,
    steps: rest,
    _meta: context._meta,
  };
}

// ─── Sprint 4 P3.1: background mode helper ─────────────────────────────────

/**
 * Returns true if WebSocket updates should be suppressed for this run mode.
 * Background mode suppresses all mid-run events — only the final
 * completion event is emitted.
 */
function shouldSuppressWebSocket(runMode: string | null | undefined): boolean {
  return runMode === 'background';
}

/**
 * Creates pending step runs for a new playbook run. Used by bulk fan-out
 * to initialise child runs with the same step structure as the parent.
 * Only creates entry steps (dependsOn === []) — subsequent steps are
 * created by the engine as dependencies complete.
 */
async function createStepRunsForNewRun(
  runId: string,
  definition: PlaybookDefinition
): Promise<void> {
  const entries = definition.steps.filter((s) => s.dependsOn.length === 0);
  for (const step of entries) {
    await db.insert(playbookStepRuns).values({
      runId,
      stepId: step.id,
      stepType: step.type,
      status: 'pending',
      sideEffectType: step.sideEffectType,
      dependsOn: step.dependsOn,
    });
  }
  // WS event sequence row
  await db.execute(
    sql`INSERT INTO playbook_run_event_sequences (run_id, last_sequence) VALUES (${runId}, 0) ON CONFLICT DO NOTHING`
  );
}

// ─── Public engine API ───────────────────────────────────────────────────────

export const playbookEngineService = {
  TICK_QUEUE,
  WATCHDOG_QUEUE,

  /**
   * Enqueues a tick for the given run via pg-boss with `singletonKey: runId`
   * + `useSingletonQueue: true`. Multiple step completions firing
   * simultaneously collapse into a single tick at the queue level.
   *
   * Spec §5.6 layer 1 (queue deduplication).
   */
  async enqueueTick(runId: string): Promise<void> {
    const pgboss = (await getPgBoss()) as unknown as {
      send: (
        name: string,
        data: object,
        options: Record<string, unknown>
      ) => Promise<string | null>;
    };
    await pgboss.send(
      TICK_QUEUE,
      { runId },
      {
        ...getJobConfig('playbook-run-tick'),
        singletonKey: runId,
        useSingletonQueue: true,
      }
    );
  },

  /**
   * Tick handler. The unit of progress.
   *
   * Spec §5.2 algorithm:
   *   1. Load run + step runs + definition.
   *   2. Kill switch + terminal-state guards.
   *   3. Compute ready set.
   *   4. Terminal check: if no ready steps and nothing running, finalise run.
   *   5. Batch cost check (placeholder — full breaker integration in a
   *      later step once cost estimator is wired through routes).
   *   6. Dispatch up to MAX_PARALLEL_STEPS - currently_running steps.
   *
   * §5.6 layer 2: non-blocking advisory lock. If contended, we silently
   * return — another handler is already working on this run.
   */
  async tick(runId: string): Promise<void> {
    // Layer 2 — non-blocking advisory lock.
    const lockResult = await db.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${'playbook-run:' + runId})::bigint) AS got`
    );
    const lockRow = (lockResult as unknown as { rows?: Array<{ got: boolean }> }).rows?.[0];
    if (lockRow && lockRow.got === false) {
      logger.debug('playbook_tick_lock_contended', { runId });
      return;
    }

    const [run] = await db.select().from(playbookRuns).where(eq(playbookRuns.id, runId));
    if (!run) return;
    if (
      run.status === 'completed' ||
      run.status === 'completed_with_errors' ||
      run.status === 'failed' ||
      run.status === 'cancelled'
    ) {
      return;
    }

    // §5.11 kill switch (light version — full org/subaccount gating ships
    // alongside the route layer in step 5).
    if (run.status === 'cancelling') {
      // Allow cancellation to settle once no steps are running.
      const stillRunning = await db
        .select({ id: playbookStepRuns.id })
        .from(playbookStepRuns)
        .where(and(eq(playbookStepRuns.runId, runId), eq(playbookStepRuns.status, 'running')));
      if (stillRunning.length === 0) {
        await db
          .update(playbookRuns)
          .set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
          .where(eq(playbookRuns.id, runId));
        logger.info('playbook_run_cancelled', { event: 'run.cancelled', runId });
        await emitPlaybookEvent(runId, run.subaccountId, 'playbook:run:status', {
          status: 'cancelled',
        });
      }
      return;
    }

    const def = await loadDefinitionForRun(run);
    if (!def) {
      logger.error('playbook_definition_missing', { runId });
      return;
    }

    // ── Sprint 4 P3.1: bulk mode fan-out ───────────────────────────────────
    // When runMode === 'bulk' and the run has no children yet, fan out N
    // child runs from contextJson.bulkTargets before processing steps.
    if (run.runMode === 'bulk' && !run.parentRunId) {
      const handled = await this.handleBulkFanOut(run, def);
      if (handled) return; // fan-out enqueued child ticks; parent waits
    }

    // ── Sprint 4 P3.1: bulk parent completion check ────────────────────────
    // A bulk parent has no steps of its own — it waits for children.
    if (run.runMode === 'bulk' && !run.parentRunId) {
      await this.checkBulkParentCompletion(run);
      return;
    }

    let stepRunRows = await db
      .select()
      .from(playbookStepRuns)
      .where(eq(playbookStepRuns.runId, runId));

    // Group by liveness — invalidated/failed are audit-only.
    let liveStepRuns = stepRunRows.filter(
      (s) => s.status !== 'invalidated' && s.status !== 'failed'
    );

    // Materialise pending/skipped rows for steps whose deps are now all terminal.
    // This is the "subsequent steps are created by the engine as dependencies
    // complete" mechanism (see materialisePendingStepRuns for full semantics).
    const materialised = await materialisePendingStepRuns(runId, def, liveStepRuns);
    if (materialised > 0) {
      // Reload so computeReadySet sees the newly-created rows.
      stepRunRows = await db
        .select()
        .from(playbookStepRuns)
        .where(eq(playbookStepRuns.runId, runId));
      liveStepRuns = stepRunRows.filter(
        (s) => s.status !== 'invalidated' && s.status !== 'failed'
      );
    }

    const ready = computeReadySet(def, liveStepRuns);
    const currentlyRunning = liveStepRuns.filter((s) => s.status === 'running').length;

    if (ready.length === 0) {
      // Terminal check.
      const completedSteps = liveStepRuns.filter(
        (s) => s.status === 'completed' || s.status === 'skipped'
      );
      const allDone = completedSteps.length === def.steps.length;
      const anyAwaiting = liveStepRuns.some(
        (s) => s.status === 'awaiting_input' || s.status === 'awaiting_approval'
      );
      const anyRunning = currentlyRunning > 0;

      if (allDone) {
        // Did any step fail with continue policy?
        const anyContinueFailures = stepRunRows.some(
          (s) =>
            s.status === 'failed' &&
            findStepInDefinition(def, s.stepId)?.failurePolicy === 'continue'
        );
        const finalStatus: PlaybookRun['status'] = anyContinueFailures
          ? 'completed_with_errors'
          : 'completed';
        await db
          .update(playbookRuns)
          .set({ status: finalStatus, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(playbookRuns.id, runId));
        logger.info('playbook_run_completed', {
          event: finalStatus === 'completed' ? 'run.completed' : 'run.completed_with_errors',
          runId,
          totalSteps: def.steps.length,
        });
        await emitPlaybookEvent(runId, run.subaccountId, 'playbook:run:status', {
          status: finalStatus,
          completedSteps: completedSteps.length,
          totalSteps: def.steps.length,
        }, { suppressWebSocket: shouldSuppressWebSocket(run.runMode) });

        // Sprint 4 P3.1: if this is a bulk child, re-tick the parent
        if (run.parentRunId) {
          await this.enqueueTick(run.parentRunId);
        }
        return;
      }

      // Not terminal — propagate the awaiting/running status.
      let aggregate: PlaybookRun['status'] = run.status;
      if (anyRunning) aggregate = 'running';
      else if (anyAwaiting) {
        const anyAwaitingInput = liveStepRuns.some((s) => s.status === 'awaiting_input');
        aggregate = anyAwaitingInput ? 'awaiting_input' : 'awaiting_approval';
      }
      if (aggregate !== run.status) {
        await db
          .update(playbookRuns)
          .set({ status: aggregate, updatedAt: new Date() })
          .where(eq(playbookRuns.id, runId));
      }
      return;
    }

    // §5.2 step 3: parallelism cap.
    const maxParallel = def.maxParallelSteps ?? MAX_PARALLEL_STEPS_DEFAULT;
    const capacity = Math.max(0, maxParallel - currentlyRunning);
    const toDispatch = ready.slice(0, capacity);

    // Run is now actively running.
    if (run.status !== 'running') {
      await db
        .update(playbookRuns)
        .set({ status: 'running', updatedAt: new Date() })
        .where(eq(playbookRuns.id, runId));
      await emitPlaybookEvent(runId, run.subaccountId, 'playbook:run:status', {
        status: 'running',
        completedSteps: liveStepRuns.filter((s) => s.status === 'completed' || s.status === 'skipped').length,
        totalSteps: def.steps.length,
      });
    }

    for (const step of toDispatch) {
      try {
        await this.dispatchStep(run, def, step, liveStepRuns);
      } catch (err) {
        logger.error('playbook_dispatch_error', {
          runId,
          stepId: step.id,
          error: err instanceof Error ? err.message : String(err),
        });
        // Mark the step run as failed and re-tick to evaluate failure policy.
        const sr = liveStepRuns.find((s) => s.stepId === step.id);
        if (sr) {
          await db
            .update(playbookStepRuns)
            .set({
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
              completedAt: new Date(),
              version: sr.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(playbookStepRuns.id, sr.id));
        }
        await this.enqueueTick(runId);
      }
    }
  },

  /**
   * Dispatches a single step. Branches on step.type. Each branch updates the
   * step run row in place to status='running' (or directly to 'completed' for
   * synchronous types like conditional) and emits the right side effect.
   *
   * Phase 1 dispatch covers `conditional` synchronously and `user_input` /
   * `approval` by transitioning to the awaiting_* states. The agent_call /
   * prompt branch is wired in step 6 once the agentRunService.onComplete
   * hook is plumbed; for now those step types fail with a clear error so
   * the engine still returns a coherent state.
   */
  async dispatchStep(
    run: PlaybookRun,
    def: PlaybookDefinition,
    step: PlaybookStep,
    liveStepRuns: PlaybookStepRun[]
  ): Promise<void> {
    const sr = liveStepRuns.find((s) => s.stepId === step.id);
    if (!sr) {
      throw new Error(`internal: no pending step run row for ${step.id}`);
    }

    // Resolve inputs (Phase 1: pass-through; full templating reuse landed
    // for prompt step types in step 6).
    const resolvedInputs = step.agentInputs ?? null;
    const inputHash = resolvedInputs ? hashValue(resolvedInputs) : null;

    // Replay mode early short-circuit for non-LLM step types — we read the
    // recorded output from the source run rather than re-running them.
    if (run.replayMode) {
      await this.replayDispatch(run, sr, step);
      return;
    }

    // ── Sprint 4 P3.1: supervised mode gate ──────────────────────────────
    // In supervised mode, every agent_call/prompt step requires approval
    // before dispatch. Conditional and user_input steps proceed normally.
    if (
      run.runMode === 'supervised' &&
      (step.type === 'agent_call' || step.type === 'prompt') &&
      sr.status === 'pending'
    ) {
      await playbookStepReviewService.requireApproval(sr, {
        reviewKind: 'supervised_mode',
      });
      // Step is now awaiting_approval; tick will re-check on next pass
      return;
    }

    switch (step.type) {
      case 'user_input': {
        await db
          .update(playbookStepRuns)
          .set({
            status: 'awaiting_input',
            inputJson: resolvedInputs as unknown as Record<string, unknown> | null,
            inputHash,
            startedAt: new Date(),
            version: sr.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(playbookStepRuns.id, sr.id));
        logger.info('playbook_step_awaiting_input', {
          event: 'step.awaiting_input',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
        });
        await emitPlaybookEvent(run.id, run.subaccountId, 'playbook:step:awaiting_input', {
          stepRunId: sr.id,
          stepId: step.id,
        });
        return;
      }

      case 'approval': {
        await db
          .update(playbookStepRuns)
          .set({
            status: 'awaiting_approval',
            inputJson: resolvedInputs as unknown as Record<string, unknown> | null,
            inputHash,
            startedAt: new Date(),
            version: sr.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(playbookStepRuns.id, sr.id));
        logger.info('playbook_step_awaiting_approval', {
          event: 'step.awaiting_approval',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
        });
        await emitPlaybookEvent(run.id, run.subaccountId, 'playbook:step:awaiting_approval', {
          stepRunId: sr.id,
          stepId: step.id,
        });
        return;
      }

      case 'conditional': {
        // Phase 1: a conditional with no expression is a constant true.
        // Full JSONLogic evaluation lands when conditions become first-class
        // in step 6 alongside the templating resolver integration.
        const result = step.condition !== undefined ? Boolean(step.condition) : true;
        const output = result ? step.trueOutput : step.falseOutput;
        const outputHash = hashValue(output);
        await this.completeStepRunInternal(sr, output, outputHash, 'conditional');
        return;
      }

      case 'agent_decision': {
        // Replay mode hard block for decision steps (spec §6, §8).
        if (run.replayMode) {
          await this.replayDispatch(run, sr, step);
          return;
        }

        // Supervised mode gate — decision steps in supervised mode require
        // approval after the agent completes (handled in the completion handler),
        // but the dispatch itself proceeds normally so the agent can make the call.
        // NOTE: Unlike agent_call, we do NOT gate dispatch for supervised mode here —
        // the reviewer sees the agent's tentative choice AFTER the agent runs,
        // not before. The completion handler routes to HITL when appropriate.

        const decisionStep = step as AgentDecisionStep;
        const ctx = run.contextJson as unknown as RunContext;

        // Resolve decisionPrompt via templating.
        let resolvedDecisionPrompt: string;
        try {
          resolvedDecisionPrompt = step.decisionPrompt
            ? renderString(step.decisionPrompt, ctx)
            : 'Choose the most appropriate branch based on the context.';
        } catch (err) {
          if (err instanceof TemplatingError) {
            await this.failStepRunInternal(
              sr,
              `templating_error: ${err.reason} ('${err.expression}')`
            );
            return;
          }
          throw err;
        }

        // Resolve agentInputs via templating (same as agent_call).
        let resolvedAgentInputs: Record<string, unknown> = {};
        try {
          if (step.agentInputs) {
            resolvedAgentInputs = resolveTemplateInputs(step.agentInputs, ctx);
          }
        } catch (err) {
          if (err instanceof TemplatingError) {
            await this.failStepRunInternal(
              sr,
              `templating_error: ${err.reason} ('${err.expression}')`
            );
            return;
          }
          throw err;
        }

        // Render the decision envelope (system prompt addendum).
        const envelope = renderAgentDecisionEnvelope({
          decisionPrompt: resolvedDecisionPrompt,
          branches: decisionStep.branches,
          minConfidence: decisionStep.minConfidence,
          // No priorAttempt on first dispatch — populated on retries.
        });

        // Resolve the agent.
        const resolvedAgentId = await this.resolveAgentForStep(run, step);
        if (!resolvedAgentId) {
          await this.failStepRunInternal(
            sr,
            `agent_not_found: ${step.agentRef?.kind ?? '?'}:${step.agentRef?.slug ?? '?'}`
          );
          return;
        }

        const dispatchInputHash = hashValue({
          decisionPrompt: resolvedDecisionPrompt,
          branches: decisionStep.branches,
          agentInputs: resolvedAgentInputs,
        });

        // Mark the step as running.
        await db
          .update(playbookStepRuns)
          .set({
            status: 'running',
            inputJson: {
              decisionPrompt: resolvedDecisionPrompt,
              agentInputs: resolvedAgentInputs,
            } as unknown as Record<string, unknown>,
            inputHash: dispatchInputHash,
            startedAt: new Date(),
            version: sr.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(playbookStepRuns.id, sr.id));

        // Enqueue onto the playbook-agent-step queue. The worker creates
        // the agent_runs row (with playbook_step_run_id) and runs executeRun.
        // The completion hook fires when done.
        //
        // Key decision-specific additions:
        //   - systemPromptAddendum: the rendered decision envelope
        //   - allowedToolSlugs: [] (empty — no tools in decision steps; §18)
        //   - timeoutSeconds: per-step override or DEFAULT_DECISION_STEP_TIMEOUT_SECONDS
        const timeoutSeconds =
          step.timeoutSeconds ?? DEFAULT_DECISION_STEP_TIMEOUT_SECONDS;
        const idempotencyKey = `playbook:${run.id}:${step.id}:${sr.attempt}`;
        const triggerContext: Record<string, unknown> = {
          source: 'playbook',
          playbookRunId: run.id,
          playbookStepRunId: sr.id,
          stepId: step.id,
          attempt: sr.attempt,
          agentInputs: resolvedAgentInputs,
          isDecisionRun: true,
        };

        const pgboss = (await getPgBoss()) as unknown as {
          send: (
            name: string,
            data: object,
            options?: Record<string, unknown>
          ) => Promise<string | null>;
        };
        await pgboss.send(
          AGENT_STEP_QUEUE,
          {
            playbookStepRunId: sr.id,
            playbookRunId: run.id,
            organisationId: run.organisationId,
            subaccountId: run.subaccountId,
            agentId: resolvedAgentId,
            stepId: step.id,
            attempt: sr.attempt,
            renderedPrompt: null,
            resolvedAgentInputs,
            sideEffectType: 'none' as const, // decision steps are always 'none'
            systemPromptAddendum: envelope,
            allowedToolSlugs: [] as string[],
            timeoutSeconds,
            isDecisionRun: true,
            triggerContext,
          },
          {
            ...getJobConfig('playbook-agent-step'),
            singletonKey: idempotencyKey,
            useSingletonQueue: true,
          }
        );

        logger.info('playbook_decision_step_dispatched', {
          event: 'decision.dispatched',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
          resolvedAgentId,
          branchesCount: decisionStep.branches.length,
        });
        await emitPlaybookEvent(run.id, run.subaccountId, 'playbook:decision:dispatched', {
          stepRunId: sr.id,
          stepId: step.id,
          agentRunId: resolvedAgentId, // will be updated when agent run is created
          branchesCount: decisionStep.branches.length,
        });
        return;
      }

      case 'agent_call':
      case 'prompt': {
        // §5.10 replay mode hard block — never dispatch external work for
        // a replay run. Instead, read the stored output from the source
        // run and write it to the replay step run directly with the
        // _meta.isReplay envelope.
        if (run.replayMode) {
          await this.replayDispatch(run, sr, step);
          return;
        }

        // Real dispatch — resolve inputs via the templating module, hash
        // them, check for input-hash reuse, then enqueue onto the
        // playbook-agent-step queue. The worker creates the agent_runs row
        // (with playbook_step_run_id set) and runs executeRun. The
        // existing completion hook routes the result back via
        // playbookAgentRunHook.

        // Resolve templated agentInputs against the run context.
        const ctx = run.contextJson as unknown as RunContext;
        let resolvedAgentInputs: Record<string, unknown> = {};
        let renderedPrompt: string | null = null;
        try {
          if (step.agentInputs) {
            resolvedAgentInputs = resolveTemplateInputs(step.agentInputs, ctx);
          }
          if (step.prompt) {
            renderedPrompt = renderString(step.prompt, ctx);
          }
        } catch (err) {
          if (err instanceof TemplatingError) {
            await this.failStepRunInternal(
              sr,
              `templating_error: ${err.reason} ('${err.expression}')`
            );
            return;
          }
          throw err;
        }

        const dispatchInputHash = hashValue({
          agentInputs: resolvedAgentInputs,
          prompt: renderedPrompt,
        });

        // Input-hash reuse path (§5.5) — never for irreversible steps.
        if (step.sideEffectType !== 'irreversible') {
          const reuse = await this.findReusableOutputForStep(
            run.id,
            step.id,
            dispatchInputHash
          );
          if (reuse) {
            logger.info('playbook_step_input_hash_reuse', {
              event: 'step.completed',
              runId: run.id,
              stepRunId: sr.id,
              stepId: step.id,
              reusedFromAttempt: reuse.attempt,
            });
            await this.completeStepRunInternal(
              sr,
              reuse.output,
              reuse.outputHash,
              `input_hash_reuse:from_attempt_${reuse.attempt}`
            );
            return;
          }
        }

        // Resolve the agent. Cached on _meta.resolvedAgents at run start
        // (or fall back to live lookup if the cache misses).
        const resolvedAgentId = await this.resolveAgentForStep(run, step);
        if (!resolvedAgentId) {
          await this.failStepRunInternal(
            sr,
            `agent_not_found: ${step.agentRef?.kind ?? '?'}:${step.agentRef?.slug ?? '?'}`
          );
          return;
        }

        // Mark the step as running and stamp inputs.
        await db
          .update(playbookStepRuns)
          .set({
            status: 'running',
            inputJson: { agentInputs: resolvedAgentInputs, prompt: renderedPrompt } as unknown as Record<string, unknown>,
            inputHash: dispatchInputHash,
            startedAt: new Date(),
            version: sr.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(playbookStepRuns.id, sr.id));

        // Enqueue onto the playbook-agent-step queue. The worker creates
        // the agent_runs row (with playbook_step_run_id) and runs
        // executeRun synchronously. The completion hook fires when done.
        const pgboss = (await getPgBoss()) as unknown as {
          send: (
            name: string,
            data: object,
            options?: Record<string, unknown>
          ) => Promise<string | null>;
        };
        await pgboss.send(
          AGENT_STEP_QUEUE,
          {
            playbookStepRunId: sr.id,
            playbookRunId: run.id,
            organisationId: run.organisationId,
            subaccountId: run.subaccountId,
            agentId: resolvedAgentId,
            stepId: step.id,
            attempt: sr.attempt,
            renderedPrompt,
            resolvedAgentInputs,
            sideEffectType: step.sideEffectType,
          },
          {
            ...getJobConfig('playbook-agent-step'),
            singletonKey: `playbook-step:${sr.id}:${sr.attempt}`,
            useSingletonQueue: true,
          }
        );

        logger.info('playbook_agent_step_dispatched', {
          event: 'step.dispatched',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
          resolvedAgentId,
        });
        await emitPlaybookEvent(run.id, run.subaccountId, 'playbook:step:dispatched', {
          stepRunId: sr.id,
          stepId: step.id,
          stepType: step.type,
        });
        return;
      }
    }
  },

  /**
   * Resolves an agent_call step's agentRef to a concrete agent id.
   * Reads the cache from `run.contextJson._meta.resolvedAgents` first;
   * falls back to a live DB lookup. The fresh lookup is also re-verified
   * before every dispatch (spec §3.4) so a deleted agent fails with
   * `playbook_template_drift:agent_deleted_mid_run`.
   */
  async resolveAgentForStep(run: PlaybookRun, step: PlaybookStep): Promise<string | null> {
    if (!step.agentRef?.slug) return null;
    const slug = step.agentRef.slug;
    const kind = step.agentRef.kind;

    // Try cache first
    const meta = (run.contextJson as unknown as RunContext)?._meta ?? {};
    const cached = meta.resolvedAgents?.[`${kind}:${slug}`];

    if (cached) {
      // Verify the cached agent still exists (re-verification per §3.4).
      if (kind === 'system') {
        const [row] = await db
          .select({ id: systemAgents.id })
          .from(systemAgents)
          .where(and(eq(systemAgents.id, cached), isNull(systemAgents.deletedAt)));
        if (row) return cached;
      } else {
        const [row] = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, cached), isNull(agents.deletedAt)));
        if (row) return cached;
      }
      logger.warn('playbook_resolved_agent_missing', {
        runId: run.id,
        stepId: step.id,
        cached,
        slug,
      });
    }

    // Fresh lookup
    if (kind === 'system') {
      const [row] = await db
        .select({ id: systemAgents.id })
        .from(systemAgents)
        .where(and(eq(systemAgents.slug, slug), isNull(systemAgents.deletedAt)));
      return row?.id ?? null;
    }
    if (kind === 'org') {
      const [row] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.slug, slug), eq(agents.organisationId, run.organisationId), isNull(agents.deletedAt)));
      return row?.id ?? null;
    }
    return null;
  },

  /**
   * Looks for a previous completed attempt of the same step in the same
   * run with an identical input_hash. Returns the previous output for
   * verbatim reuse, or null. Per spec §5.5, irreversible steps are never
   * eligible for this path — the caller must enforce that.
   */
  async findReusableOutputForStep(
    runId: string,
    stepId: string,
    inputHashValue: string
  ): Promise<{ attempt: number; output: unknown; outputHash: string } | null> {
    const rows = await db
      .select()
      .from(playbookStepRuns)
      .where(
        and(
          eq(playbookStepRuns.runId, runId),
          eq(playbookStepRuns.stepId, stepId),
          eq(playbookStepRuns.status, 'completed'),
          eq(playbookStepRuns.inputHash, inputHashValue)
        )
      );
    const row = rows[0];
    if (!row || row.outputJson === null || !row.outputHash) return null;
    return { attempt: row.attempt, output: row.outputJson, outputHash: row.outputHash };
  },

  async failStepRunInternal(sr: PlaybookStepRun, reason: string): Promise<void> {
    await db
      .update(playbookStepRuns)
      .set({
        status: 'failed',
        error: reason,
        completedAt: new Date(),
        version: sr.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(playbookStepRuns.id, sr.id));
    await this.enqueueTick(sr.runId);
  },

  // ─── Mid-run output editing (§5.4) ─────────────────────────────────────────

  /**
   * Computes the transitive downstream set of step ids that depend on the
   * given seed step. BFS over dependsOn edges. Returns step ids in
   * topological order (closest first).
   */
  computeDownstreamSet(def: PlaybookDefinition, seedStepId: string): string[] {
    const childrenOf = new Map<string, string[]>();
    for (const s of def.steps) childrenOf.set(s.id, []);
    for (const s of def.steps) {
      for (const dep of s.dependsOn) {
        if (childrenOf.has(dep)) childrenOf.get(dep)!.push(s.id);
      }
    }
    const visited = new Set<string>();
    const result: string[] = [];
    const queue: string[] = [...(childrenOf.get(seedStepId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      result.push(id);
      for (const child of childrenOf.get(id) ?? []) {
        if (!visited.has(child)) queue.push(child);
      }
    }
    return result;
  },

  /**
   * Mid-run output edit. Spec §5.4 — the safety-critical mutation path.
   *
   * Pre-edit safety check (§5.4):
   *   1. Compute downstream set (transitive dep BFS)
   *   2. Inspect each downstream step's sideEffectType
   *   3. Default-block irreversible / reversible without explicit
   *      confirmation arrays — return a structured 409 payload
   *   4. Compute estimated cost + cascade summary
   *
   * Edit + invalidation:
   *   1. Hash the new output. If identical to previous, no-op (firewall).
   *   2. Update the seed step's outputJson + outputHash.
   *   3. For each downstream step run: mark current row 'invalidated',
   *      insert a new pending row at attempt+1. Steps in skipAndReuse
   *      copy previous output forward as completed.
   *   4. Cancel any in-flight downstream agent runs (best-effort).
   *   5. Re-merge context from scratch using only currently-completed
   *      step outputs.
   *   6. Enqueue tick.
   */
  async editStepOutput(
    organisationId: string,
    runId: string,
    stepRunId: string,
    options: {
      output: Record<string, unknown>;
      confirmReversible?: string[];
      confirmIrreversible?: string[];
      skipAndReuse?: string[];
      expectedVersion?: number;
      userId: string;
    }
  ): Promise<
    | {
        ok: true;
        invalidatedStepIds: string[];
        skippedStepIds: string[];
        estimatedCostCents: number;
        cascade: { size: number; criticalPathLength: number };
      }
    | {
        ok: false;
        statusCode: 409;
        error: string;
        detail: string;
        affected: Array<{
          stepId: string;
          name: string;
          sideEffectType: PlaybookStep['sideEffectType'];
          previousOutput: unknown;
        }>;
        totalEstimatedCostCents: number;
        cascade: { size: number; criticalPathLength: number };
      }
  > {
    const [run] = await db
      .select()
      .from(playbookRuns)
      .where(and(eq(playbookRuns.id, runId), eq(playbookRuns.organisationId, organisationId)));
    if (!run) throw { statusCode: 404, message: 'Playbook run not found' };

    const [seedStep] = await db
      .select()
      .from(playbookStepRuns)
      .where(and(eq(playbookStepRuns.id, stepRunId), eq(playbookStepRuns.runId, runId)));
    if (!seedStep) throw { statusCode: 404, message: 'Step run not found' };
    if (seedStep.status !== 'completed') {
      throw {
        statusCode: 409,
        message: `Cannot edit step in status '${seedStep.status}' — only completed steps can be edited`,
      };
    }
    if (
      options.expectedVersion !== undefined &&
      seedStep.version !== options.expectedVersion
    ) {
      throw {
        statusCode: 409,
        message: `Step version is ${seedStep.version}, expected ${options.expectedVersion}`,
        errorCode: 'playbook_stale_version',
      };
    }

    const def = await loadDefinitionForRun(run);
    if (!def) throw { statusCode: 422, message: 'Run definition not loadable' };

    // Output-hash firewall — no-op if the new output is byte-identical to
    // the previous one. This is the cheapest possible exit path.
    const newHash = hashValue(options.output);
    if (newHash === seedStep.outputHash) {
      logger.info('playbook_mid_run_edit_noop_firewall', {
        runId,
        stepRunId,
        stepId: seedStep.stepId,
      });
      return {
        ok: true,
        invalidatedStepIds: [],
        skippedStepIds: [],
        estimatedCostCents: 0,
        cascade: { size: 0, criticalPathLength: 0 },
      };
    }

    // Compute downstream set.
    const downstreamIds = this.computeDownstreamSet(def, seedStep.stepId);
    const downstreamRows = await db
      .select()
      .from(playbookStepRuns)
      .where(eq(playbookStepRuns.runId, runId));
    const downstreamLive = downstreamRows.filter(
      (r) =>
        downstreamIds.includes(r.stepId) &&
        r.status !== 'invalidated' &&
        r.status !== 'failed'
    );

    // Build affected list with side-effect classification.
    const affected: Array<{
      stepId: string;
      name: string;
      sideEffectType: PlaybookStep['sideEffectType'];
      previousOutput: unknown;
    }> = [];
    let needsConfirmation = false;
    for (const row of downstreamLive) {
      const stepDef = findStepInDefinition(def, row.stepId);
      if (!stepDef) continue;
      const isSkipped = options.skipAndReuse?.includes(row.stepId);
      const isConfirmedReversible =
        options.confirmReversible?.includes(row.stepId) ||
        options.confirmIrreversible?.includes(row.stepId);
      const isConfirmedIrreversible = options.confirmIrreversible?.includes(row.stepId);

      if (
        stepDef.sideEffectType === 'irreversible' &&
        !isSkipped &&
        !isConfirmedIrreversible
      ) {
        needsConfirmation = true;
        affected.push({
          stepId: row.stepId,
          name: stepDef.name,
          sideEffectType: 'irreversible',
          previousOutput: row.outputJson,
        });
      } else if (
        stepDef.sideEffectType === 'reversible' &&
        !isSkipped &&
        !isConfirmedReversible
      ) {
        needsConfirmation = true;
        affected.push({
          stepId: row.stepId,
          name: stepDef.name,
          sideEffectType: 'reversible',
          previousOutput: row.outputJson,
        });
      } else {
        affected.push({
          stepId: row.stepId,
          name: stepDef.name,
          sideEffectType: stepDef.sideEffectType,
          previousOutput: row.outputJson,
        });
      }
    }

    // Cascade metrics
    const cascade = {
      size: downstreamLive.length,
      criticalPathLength: this.computeCriticalPath(def, downstreamLive.map((d) => d.stepId)),
    };
    const estimatedCostCents = this.estimateCascadeCostCents(def, downstreamLive);

    if (needsConfirmation) {
      logger.info('playbook_mid_run_edit_blocked', {
        event: 'mid_run_edit.blocked',
        runId,
        stepRunId,
        affectedCount: affected.length,
      });
      return {
        ok: false,
        statusCode: 409,
        error: 'playbook_irreversible_blocked',
        detail: 'mid_run_edit_irreversible',
        affected,
        totalEstimatedCostCents: estimatedCostCents,
        cascade,
      };
    }

    // Apply edit + cascade. Single transaction for atomicity.
    const skippedStepIds: string[] = [];
    const invalidatedStepIds: string[] = [];

    await db.transaction(async (tx) => {
      // Update the seed step's output + hash.
      await tx
        .update(playbookStepRuns)
        .set({
          outputJson: options.output as Record<string, unknown>,
          outputHash: newHash,
          version: seedStep.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(playbookStepRuns.id, seedStep.id));

      // For each downstream live row: invalidate + insert successor.
      for (const row of downstreamLive) {
        const stepDef = findStepInDefinition(def, row.stepId);
        if (!stepDef) continue;

        // Mark current row invalidated.
        await tx
          .update(playbookStepRuns)
          .set({
            status: 'invalidated',
            version: row.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(playbookStepRuns.id, row.id));
        invalidatedStepIds.push(row.stepId);

        if (options.skipAndReuse?.includes(row.stepId)) {
          // Copy the previous output forward as a new completed attempt.
          await tx.insert(playbookStepRuns).values({
            runId,
            stepId: row.stepId,
            stepType: row.stepType,
            status: 'completed',
            sideEffectType: row.sideEffectType,
            dependsOn: row.dependsOn,
            inputJson: row.inputJson,
            inputHash: row.inputHash,
            outputJson: row.outputJson as Record<string, unknown> | null,
            outputHash: row.outputHash,
            attempt: row.attempt + 1,
            startedAt: new Date(),
            completedAt: new Date(),
          });
          skippedStepIds.push(row.stepId);
        } else {
          // Insert a fresh pending row.
          await tx.insert(playbookStepRuns).values({
            runId,
            stepId: row.stepId,
            stepType: row.stepType,
            status: 'pending',
            sideEffectType: row.sideEffectType,
            dependsOn: row.dependsOn,
            attempt: row.attempt + 1,
          });
        }
      }

      // Re-merge context from scratch using only currently-completed step
      // outputs. The mid-run-edit semantics (§5.1.1 rule 6) say invalidated
      // step outputs are removed from context, not preserved.
      const completedAfterEdit = await tx
        .select()
        .from(playbookStepRuns)
        .where(
          and(
            eq(playbookStepRuns.runId, runId),
            eq(playbookStepRuns.status, 'completed')
          )
        );
      const ctx = run.contextJson as unknown as RunContext;
      const nextSteps: Record<string, { output: unknown }> = {};
      for (const sr of completedAfterEdit) {
        if (sr.outputJson !== null) {
          nextSteps[sr.stepId] = { output: sr.outputJson };
        }
      }
      // Make sure the seed step uses the new output.
      nextSteps[seedStep.stepId] = { output: options.output };
      const nextCtx: RunContext = {
        input: ctx.input,
        subaccount: ctx.subaccount,
        org: ctx.org,
        steps: nextSteps,
        _meta: ctx._meta,
      };
      const nextBytes = Buffer.byteLength(JSON.stringify(nextCtx), 'utf8');
      await tx
        .update(playbookRuns)
        .set({
          contextJson: nextCtx as unknown as Record<string, unknown>,
          contextSizeBytes: nextBytes,
          updatedAt: new Date(),
        })
        .where(eq(playbookRuns.id, runId));
    });

    logger.info('playbook_mid_run_edit_applied', {
      event: 'mid_run_edit.applied',
      runId,
      stepRunId,
      stepId: seedStep.stepId,
      invalidatedCount: invalidatedStepIds.length,
      skippedCount: skippedStepIds.length,
      cascadeSize: cascade.size,
      criticalPathLength: cascade.criticalPathLength,
    });

    await this.enqueueTick(runId);

    return {
      ok: true,
      invalidatedStepIds,
      skippedStepIds,
      estimatedCostCents,
      cascade,
    };
  },

  // ─── Sprint 4 P3.1: Bulk mode helpers ──────────────────────────────────────

  /**
   * Handles the bulk fan-out for a parent run. Reads `bulkTargets` from
   * contextJson and creates one child run per target subaccount. Each child
   * shares the same templateVersionId and runs in `auto` mode. Returns true
   * if fan-out was performed (or already done), false if no bulkTargets.
   */
  async handleBulkFanOut(run: PlaybookRun, _def: PlaybookDefinition): Promise<boolean> {
    const ctx = run.contextJson as Record<string, unknown>;
    const bulkTargets = ctx.bulkTargets as string[] | undefined;
    if (!bulkTargets || !Array.isArray(bulkTargets) || bulkTargets.length === 0) {
      logger.warn('playbook_bulk_no_targets', { runId: run.id });
      return false;
    }

    // Check if children already exist (idempotency via unique index)
    const existingChildren = await db
      .select({ id: playbookRuns.id, targetSubaccountId: playbookRuns.targetSubaccountId })
      .from(playbookRuns)
      .where(eq(playbookRuns.parentRunId, run.id));

    if (existingChildren.length >= bulkTargets.length) {
      // Fan-out already done, just check completion
      return true;
    }

    const existingTargets = new Set(
      existingChildren.map((c) => c.targetSubaccountId).filter(Boolean)
    );

    // Validate all target subaccounts belong to this org (prevent cross-org fan-out)
    const validSubs = await db
      .select({ id: subaccounts.id })
      .from(subaccounts)
      .where(
        and(
          inArray(subaccounts.id, bulkTargets),
          eq(subaccounts.organisationId, run.organisationId),
          isNull(subaccounts.deletedAt),
        ),
      );
    const validSubIds = new Set(validSubs.map((s) => s.id));
    const invalidTargets = bulkTargets.filter((t) => !validSubIds.has(t));
    if (invalidTargets.length > 0) {
      logger.warn('playbook_bulk_invalid_targets', {
        runId: run.id,
        invalidTargets,
        orgId: run.organisationId,
      });
    }

    // Mark parent as running
    if (run.status === 'pending') {
      await db
        .update(playbookRuns)
        .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
        .where(eq(playbookRuns.id, run.id));
    }

    // Sprint 4 P3.2: respect org-level GHL concurrency cap for bulk dispatch.
    const [org] = await db
      .select({ ghlConcurrencyCap: organisations.ghlConcurrencyCap })
      .from(organisations)
      .where(eq(organisations.id, run.organisationId));
    const concurrencyCap = org?.ghlConcurrencyCap ?? MAX_PARALLEL_STEPS_DEFAULT;

    // Count non-terminal children to enforce concurrency cap
    const childStatuses = await db
      .select({ id: playbookRuns.id, status: playbookRuns.status })
      .from(playbookRuns)
      .where(eq(playbookRuns.parentRunId, run.id));
    const activeChildCount = childStatuses.filter(
      (c) => !['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(c.status)
    ).length;
    const slotsAvailable = Math.max(0, concurrencyCap - activeChildCount);

    // Create child runs for each target not yet created, up to cap
    let created = 0;
    for (const targetId of bulkTargets) {
      if (existingTargets.has(targetId)) continue;
      if (!validSubIds.has(targetId)) continue; // skip targets not in this org
      if (created >= slotsAvailable) break; // respect concurrency cap

      try {
        const [childRun] = await db
          .insert(playbookRuns)
          .values({
            organisationId: run.organisationId,
            subaccountId: targetId,
            templateVersionId: run.templateVersionId,
            runMode: 'auto',
            status: 'pending',
            contextJson: ctx,
            parentRunId: run.id,
            targetSubaccountId: targetId,
            startedByUserId: run.startedByUserId,
          })
          .returning();

        if (childRun) {
          // Create step runs for the child
          const def = await loadDefinitionForRun(childRun);
          if (def) {
            await createStepRunsForNewRun(childRun.id, def);
          }
          await this.enqueueTick(childRun.id);
        }

        created++;
        logger.info('playbook_bulk_child_created', {
          event: 'bulk.child_created',
          parentRunId: run.id,
          childRunId: childRun?.id,
          targetSubaccountId: targetId,
        });
      } catch (err: unknown) {
        // Unique constraint violation → already created (race condition)
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('playbook_runs_bulk_child_unique_idx')) {
          logger.debug('playbook_bulk_child_already_exists', {
            parentRunId: run.id,
            targetSubaccountId: targetId,
          });
        } else {
          throw err;
        }
      }
    }

    if (!shouldSuppressWebSocket(run.runMode)) {
      emitPlaybookRunUpdate(run.id, 'playbook:run:bulk_fanout', {
        parentRunId: run.id,
        childCount: bulkTargets.length,
      });
    }

    return true;
  },

  /**
   * Checks whether all children of a bulk parent have completed. If so,
   * finalises the parent. Mixed success/failure → 'partial' status.
   */
  async checkBulkParentCompletion(run: PlaybookRun): Promise<void> {
    const children = await db
      .select()
      .from(playbookRuns)
      .where(eq(playbookRuns.parentRunId, run.id));

    if (children.length === 0) return;

    const terminal = children.filter((c) =>
      ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(c.status)
    );

    if (terminal.length < children.length) {
      // Still waiting for children
      return;
    }

    // All children are terminal — determine parent status
    const allCompleted = children.every((c) => c.status === 'completed');
    const allFailed = children.every((c) => c.status === 'failed');
    let parentStatus: string;
    if (allCompleted) {
      parentStatus = 'completed';
    } else if (allFailed) {
      parentStatus = 'failed';
    } else {
      parentStatus = 'partial';
    }

    // Collect child results
    const bulkResults = children.map((c) => ({
      childRunId: c.id,
      targetSubaccountId: c.targetSubaccountId,
      status: c.status,
    }));

    const existingContext = run.contextJson as Record<string, unknown>;

    await db
      .update(playbookRuns)
      .set({
        status: parentStatus as PlaybookRun['status'],
        contextJson: { ...existingContext, bulkResults } as Record<string, unknown>,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(playbookRuns.id, run.id));

    logger.info('playbook_bulk_parent_completed', {
      event: 'bulk.parent_completed',
      runId: run.id,
      status: parentStatus,
      totalChildren: children.length,
      completedChildren: children.filter((c) => c.status === 'completed').length,
      failedChildren: children.filter((c) => c.status === 'failed').length,
    });

    if (!shouldSuppressWebSocket(run.runMode)) {
      emitPlaybookRunUpdate(run.id, 'playbook:run:status', {
        status: parentStatus,
        bulkResults,
      });
    }
  },

  // ─── Replay mode (§5.10) ──────────────────────────────────────────────────

  /**
   * Replay dispatch — looks up the same step in the source run and copies
   * its output verbatim to the replay step run, wrapped in a `_meta`
   * envelope marking it as replay data. Conditional steps are
   * re-evaluated and assert determinism (same inputsHash → same result).
   *
   * NEVER creates an agent_runs row, NEVER calls external services. The
   * skill executor has its own block (server/services/skillExecutor.ts)
   * for skills not marked replaySafe — that's the second safety layer.
   */
  async replayDispatch(
    run: PlaybookRun,
    sr: PlaybookStepRun,
    _step: PlaybookStep
  ): Promise<void> {
    const meta = (run.contextJson as unknown as RunContext)?._meta ?? {};
    const sourceRunId = (meta as { replaySourceRunId?: string }).replaySourceRunId;
    if (!sourceRunId) {
      await this.failStepRunInternal(sr, 'replay_missing_source_run_id');
      return;
    }

    // Find the equivalent step run in the source run.
    const [sourceSr] = await db
      .select()
      .from(playbookStepRuns)
      .where(
        and(
          eq(playbookStepRuns.runId, sourceRunId),
          eq(playbookStepRuns.stepId, sr.stepId),
          eq(playbookStepRuns.status, 'completed')
        )
      );
    if (!sourceSr || sourceSr.outputJson === null) {
      await this.failStepRunInternal(
        sr,
        `replay_source_step_not_completed:${sr.stepId}`
      );
      return;
    }

    // Wrap the original output in the _meta envelope so downstream
    // consumers can detect replay context.
    const replayOutput = {
      ...(sourceSr.outputJson as Record<string, unknown>),
      _meta: {
        isReplay: true,
        replaySourceRunId: sourceRunId,
        replayedAt: new Date().toISOString(),
        sourceStepRunId: sourceSr.id,
      },
    };

    const replayHash = hashValue(replayOutput);
    await this.completeStepRunInternal(sr, replayOutput, replayHash, 'replay');
  },

  /**
   * Creates a new replay run from a source run. Clones the source run's
   * organisationId / subaccountId / templateVersionId / context (sans steps)
   * and inserts pending step rows for every entry step. The dispatch path
   * picks up the rest via the engine tick loop, never creating any
   * external side effects.
   */
  async createReplayRun(
    organisationId: string,
    sourceRunId: string,
    userId: string
  ): Promise<{ runId: string }> {
    const [source] = await db
      .select()
      .from(playbookRuns)
      .where(
        and(eq(playbookRuns.id, sourceRunId), eq(playbookRuns.organisationId, organisationId))
      );
    if (!source) throw { statusCode: 404, message: 'Source playbook run not found' };

    const def = await loadDefinitionForRun(source);
    if (!def) {
      throw { statusCode: 422, message: 'Source run definition not loadable' };
    }

    const startedAt = new Date();
    const sourceCtx = source.contextJson as unknown as RunContext;
    const replayContext: RunContext = {
      input: sourceCtx.input,
      subaccount: sourceCtx.subaccount,
      org: sourceCtx.org,
      steps: {},
      _meta: {
        runId: '',
        templateVersionId: source.templateVersionId,
        startedAt: startedAt.toISOString(),
        resolvedAgents: sourceCtx._meta?.resolvedAgents,
        isReplay: true,
        replaySourceRunId: sourceRunId,
      },
    };

    let runId!: string;
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(playbookRuns)
        .values({
          organisationId,
          subaccountId: source.subaccountId,
          templateVersionId: source.templateVersionId,
          status: 'pending',
          contextJson: replayContext as unknown as Record<string, unknown>,
          contextSizeBytes: Buffer.byteLength(JSON.stringify(replayContext), 'utf8'),
          replayMode: true,
          startedByUserId: userId,
          startedAt,
        })
        .returning();
      runId = created.id;
      // Patch runId into _meta
      await tx.execute(
        sql`UPDATE playbook_runs SET context_json = jsonb_set(context_json, '{_meta,runId}', to_jsonb(${runId}::text), true) WHERE id = ${runId}`
      );
      // Insert entry-step rows
      const entries = def.steps.filter((s) => s.dependsOn.length === 0);
      for (const step of entries) {
        await tx.insert(playbookStepRuns).values({
          runId,
          stepId: step.id,
          stepType: step.type,
          status: 'pending',
          sideEffectType: step.sideEffectType,
          dependsOn: step.dependsOn,
        });
      }
      await tx.execute(
        sql`INSERT INTO playbook_run_event_sequences (run_id, last_sequence) VALUES (${runId}, 0) ON CONFLICT DO NOTHING`
      );
    });

    logger.info('playbook_replay_run_started', {
      event: 'run.started',
      replay: true,
      runId,
      sourceRunId,
    });

    await this.enqueueTick(runId);
    return { runId };
  },

  /**
   * Coarse cascade cost estimate — sum of per-step heuristics. Same numbers
   * the Studio's estimate_cost tool uses (pessimistic mode).
   */
  estimateCascadeCostCents(
    def: PlaybookDefinition,
    downstreamLive: PlaybookStepRun[]
  ): number {
    const PER_STEP_PESSIMISTIC: Record<string, number> = {
      prompt: 20,
      agent_call: 60,
      agent_decision: 20, // lightweight LLM call; tool-free
      user_input: 0,
      approval: 0,
      conditional: 0,
    };
    let total = 0;
    for (const row of downstreamLive) {
      total += PER_STEP_PESSIMISTIC[row.stepType] ?? 0;
    }
    return total;
  },

  /**
   * Computes the longest path through a subset of steps. Used for the
   * cascade.criticalPathLength field surfaced in the mid-run-edit response.
   */
  computeCriticalPath(def: PlaybookDefinition, stepIds: string[]): number {
    const subset = new Set(stepIds);
    const stepById = new Map<string, PlaybookStep>();
    for (const s of def.steps) if (subset.has(s.id)) stepById.set(s.id, s);
    const longest = new Map<string, number>();
    function visit(id: string): number {
      if (longest.has(id)) return longest.get(id)!;
      const step = stepById.get(id);
      if (!step) return 0;
      let maxDep = 0;
      for (const dep of step.dependsOn) {
        if (subset.has(dep)) {
          maxDep = Math.max(maxDep, visit(dep));
        }
      }
      const v = 1 + maxDep;
      longest.set(id, v);
      return v;
    }
    let result = 0;
    for (const id of stepIds) result = Math.max(result, visit(id));
    return result;
  },

  /**
   * Common completion path used by user_input submission, approval decision,
   * conditional dispatch, and (in step 6) agent_run completion. Merges the
   * step's output into the run context, computes the new context size,
   * updates the row, and re-ticks the run.
   */
  async completeStepRunInternal(
    sr: PlaybookStepRun,
    output: unknown,
    outputHash: string,
    via: string
  ): Promise<void> {
    const [run] = await db.select().from(playbookRuns).where(eq(playbookRuns.id, sr.runId));
    if (!run) return;

    const ctx = run.contextJson as unknown as RunContext;
    const nextCtx = mergeStepOutputIntoContext(ctx, sr.stepId, output);
    const nextBytes = Buffer.byteLength(JSON.stringify(nextCtx), 'utf8');

    try {
      assertContextSize(nextBytes, run.id);
    } catch (err) {
      logger.error('playbook_context_overflow', { runId: run.id, bytes: nextBytes });
      await db
        .update(playbookRuns)
        .set({
          status: 'failed',
          error: 'context_overflow',
          failedDueToStepId: sr.stepId,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(playbookRuns.id, run.id));
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(playbookStepRuns)
        .set({
          status: 'completed',
          outputJson: output as unknown as Record<string, unknown>,
          outputHash,
          completedAt: new Date(),
          version: sr.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(playbookStepRuns.id, sr.id));

      await tx
        .update(playbookRuns)
        .set({
          contextJson: nextCtx as unknown as Record<string, unknown>,
          contextSizeBytes: nextBytes,
          updatedAt: new Date(),
        })
        .where(eq(playbookRuns.id, run.id));
    });

    logger.info('playbook_step_completed', {
      event: 'step.completed',
      runId: run.id,
      stepRunId: sr.id,
      stepId: sr.stepId,
      via,
    });

    await emitPlaybookEvent(run.id, run.subaccountId, 'playbook:step:completed', {
      stepRunId: sr.id,
      stepId: sr.stepId,
      output,
      via,
    });

    await this.enqueueTick(run.id);
  },

  /** Public completion entry — used by run service. */
  async completeStepRun(
    stepRunId: string,
    args: { output: unknown; via: string; decidedByUserId?: string }
  ): Promise<void> {
    const [sr] = await db
      .select()
      .from(playbookStepRuns)
      .where(eq(playbookStepRuns.id, stepRunId));
    if (!sr) return;
    if (sr.status === 'invalidated') {
      // Spec §5.4 hard discard rule — late-arriving completion on an
      // invalidated row is dropped, never merged.
      logger.warn('playbook_step_result_discarded_invalidated', {
        event: 'step.result_discarded_invalidated',
        runId: sr.runId,
        stepRunId,
        stepId: sr.stepId,
      });
      return;
    }
    const outputHash = hashValue(args.output);
    await this.completeStepRunInternal(sr, args.output, outputHash, args.via);
  },

  async failStepRun(stepRunId: string, reason: string, _userId?: string): Promise<void> {
    const [sr] = await db
      .select()
      .from(playbookStepRuns)
      .where(eq(playbookStepRuns.id, stepRunId));
    if (!sr) return;
    await db
      .update(playbookStepRuns)
      .set({
        status: 'failed',
        error: reason,
        completedAt: new Date(),
        version: sr.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(playbookStepRuns.id, stepRunId));
    logger.info('playbook_step_failed', {
      event: 'step.failed',
      runId: sr.runId,
      stepRunId,
      stepId: sr.stepId,
      reason,
    });

    // Look up subaccountId for the WS room
    const [parentRun] = await db.select({ subaccountId: playbookRuns.subaccountId }).from(playbookRuns).where(eq(playbookRuns.id, sr.runId));
    if (parentRun) {
      await emitPlaybookEvent(sr.runId, parentRun.subaccountId, 'playbook:step:failed', {
        stepRunId,
        stepId: sr.stepId,
        reason,
      });
    }

    await this.enqueueTick(sr.runId);
  },

  /**
   * Hook called by the agent run completion path. Looks up the playbook
   * step run linked to the agent run and routes to the appropriate handler:
   *   - agent_decision steps → handleDecisionStepCompletion (parse + skip-set)
   *   - all other types     → completeStepRun / failStepRun
   *
   * Wired into agentRunService in step 6.
   */
  async onAgentRunCompleted(
    agentRunId: string,
    result: { ok: boolean; output?: unknown; error?: string }
  ): Promise<void> {
    const [sr] = await db
      .select()
      .from(playbookStepRuns)
      .where(eq(playbookStepRuns.agentRunId, agentRunId));
    if (!sr) return;
    if (sr.status === 'invalidated') {
      logger.warn('playbook_step_result_discarded_invalidated', {
        event: 'step.result_discarded_invalidated',
        runId: sr.runId,
        stepRunId: sr.id,
        stepId: sr.stepId,
        agentRunId,
      });
      return;
    }

    // Route decision steps through their dedicated completion handler.
    if (sr.stepType === 'agent_decision') {
      await this.handleDecisionStepCompletion(sr, result, agentRunId);
      return;
    }

    if (result.ok && result.output !== undefined) {
      await this.completeStepRun(sr.id, { output: result.output, via: 'agent_run' });
    } else {
      await this.failStepRun(sr.id, result.error ?? 'agent_run_failed');
    }
  },

  /**
   * Completion handler for `agent_decision` steps.
   *
   * Spec §6 algorithm:
   *   1. Load run + definition.
   *   2. Parse agent output as AgentDecisionOutput (base schema + branch validation).
   *   3. On parse failure: retry (up to MAX_DECISION_RETRIES) with the prior-attempt
   *      envelope; on exhaustion, fail the step.
   *   4. On success: compute the skip set, write the completed row + skipped rows +
   *      merged context in a single transaction, then re-tick.
   */
  async handleDecisionStepCompletion(
    sr: PlaybookStepRun,
    result: { ok: boolean; output?: unknown; error?: string },
    _agentRunId: string
  ): Promise<void> {
    // 1. Load run + definition + step.
    const [run] = await db.select().from(playbookRuns).where(eq(playbookRuns.id, sr.runId));
    if (!run) return;

    const def = await loadDefinitionForRun(run);
    if (!def) {
      await this.failStepRunInternal(sr, 'decision_replay_snapshot_missing');
      return;
    }

    const step = findStepInDefinition(def, sr.stepId);
    if (!step || step.type !== 'agent_decision') {
      await this.failStepRunInternal(sr, 'internal: decision step type mismatch');
      return;
    }
    const decisionStep = step as AgentDecisionStep;

    // 2. Handle agent run failure (distinct from a bad parse — the agent didn't run).
    if (!result.ok) {
      await this.failStepRunInternal(sr, result.error ?? 'decision_agent_run_failed');
      return;
    }

    // 3. Parse agent output.
    const parseResult = parseDecisionOutput(result.output, decisionStep);
    const inputJson = (sr.inputJson ?? {}) as Record<string, unknown>;
    const retryCount = typeof inputJson.retryCount === 'number' ? inputJson.retryCount : 0;

    if (!parseResult.ok) {
      // Retry path.
      if (retryCount < MAX_DECISION_RETRIES) {
        const ctx = run.contextJson as unknown as RunContext;
        let resolvedDecisionPrompt = decisionStep.decisionPrompt ?? '';
        try {
          resolvedDecisionPrompt = renderString(resolvedDecisionPrompt, ctx);
        } catch {
          // Use the raw template on render failure.
        }

        const rawStr =
          typeof result.output === 'string'
            ? result.output
            : JSON.stringify(result.output ?? '');
        const truncatedRaw = rawStr.slice(0, DECISION_RETRY_RAW_OUTPUT_TRUNCATE_CHARS);

        const envelope = renderAgentDecisionEnvelope({
          decisionPrompt: resolvedDecisionPrompt,
          branches: decisionStep.branches,
          minConfidence: decisionStep.minConfidence,
          priorAttempt: {
            errorMessage: parseResult.error.message,
            rawOutput: truncatedRaw,
          },
        });

        const resolvedAgentId = await this.resolveAgentForStep(run, step);
        if (!resolvedAgentId) {
          await this.failStepRunInternal(sr, 'decision_agent_run_failed: agent disappeared on retry');
          return;
        }

        let resolvedAgentInputs: Record<string, unknown> = {};
        try {
          if (step.agentInputs) {
            resolvedAgentInputs = resolveTemplateInputs(step.agentInputs, ctx);
          }
        } catch {
          // Use empty on error.
        }

        // Bump retry count in the step run's inputJson.
        await db
          .update(playbookStepRuns)
          .set({
            inputJson: { ...inputJson, retryCount: retryCount + 1 } as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          })
          .where(eq(playbookStepRuns.id, sr.id));

        const idempotencyKey = `playbook:${run.id}:${step.id}:${sr.attempt}:retry${retryCount + 1}`;
        const pgboss = (await getPgBoss()) as unknown as {
          send: (name: string, data: object, options?: Record<string, unknown>) => Promise<string | null>;
        };
        await pgboss.send(
          AGENT_STEP_QUEUE,
          {
            playbookStepRunId: sr.id,
            playbookRunId: run.id,
            organisationId: run.organisationId,
            subaccountId: run.subaccountId,
            agentId: resolvedAgentId,
            stepId: step.id,
            attempt: sr.attempt,
            renderedPrompt: null,
            resolvedAgentInputs,
            sideEffectType: 'none' as const,
            systemPromptAddendum: envelope,
            allowedToolSlugs: [] as string[],
            timeoutSeconds: step.timeoutSeconds ?? DEFAULT_DECISION_STEP_TIMEOUT_SECONDS,
            isDecisionRun: true,
            triggerContext: {
              source: 'playbook',
              playbookRunId: run.id,
              playbookStepRunId: sr.id,
              stepId: step.id,
              attempt: sr.attempt,
              agentInputs: resolvedAgentInputs,
              isDecisionRun: true,
              retryCount: retryCount + 1,
            },
          },
          {
            ...getJobConfig('playbook-agent-step'),
            singletonKey: idempotencyKey,
            useSingletonQueue: true,
          }
        );

        logger.info('playbook_decision_step_retrying', {
          event: 'decision.retry',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
          retryCount: retryCount + 1,
          parseErrorCode: parseResult.error.code,
        });
        return;
      }

      // Max retries exceeded.
      await this.failStepRunInternal(
        sr,
        `decision_parse_failure: ${parseResult.error.code}: ${parseResult.error.message}`
      );
      return;
    }

    // 4. Parse succeeded — apply the decision.
    const { chosenBranchId, rationale, confidence } = parseResult.value;

    // Compute skip set: all non-chosen branch steps that lack a live chosen ancestor.
    const skipSet = computeSkipSet(def, step.id, chosenBranchId);

    // Build the enriched step output.
    const stepOutput: Record<string, unknown> = {
      chosenBranchId,
      rationale,
      skippedStepIds: [...skipSet],
      retryCount,
      chosenByAgent: true,
    };
    if (confidence !== undefined) stepOutput.confidence = confidence;

    // Context merge + size check.
    const ctx = run.contextJson as unknown as RunContext;
    const nextCtx = mergeStepOutputIntoContext(ctx, step.id, stepOutput);
    const nextBytes = Buffer.byteLength(JSON.stringify(nextCtx), 'utf8');
    try {
      assertContextSize(nextBytes, run.id);
    } catch {
      await db
        .update(playbookRuns)
        .set({
          status: 'failed',
          error: 'context_overflow',
          failedDueToStepId: step.id,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(playbookRuns.id, run.id));
      return;
    }

    const outputHash = hashValue(stepOutput);

    // Single transaction: complete the decision step + create skipped rows + update context.
    await db.transaction(async (tx) => {
      // Mark decision step completed.
      await tx
        .update(playbookStepRuns)
        .set({
          status: 'completed',
          outputJson: stepOutput as unknown as Record<string, unknown>,
          outputHash,
          completedAt: new Date(),
          version: sr.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(playbookStepRuns.id, sr.id));

      // Create skipped rows for each step in the skip set.
      // If a row already exists (e.g. from a concurrent tick), mark it skipped.
      for (const skippedStepId of skipSet) {
        const skippedStepDef = findStepInDefinition(def, skippedStepId);
        if (!skippedStepDef) continue;
        try {
          await tx.insert(playbookStepRuns).values({
            runId: run.id,
            stepId: skippedStepId,
            stepType: skippedStepDef.type,
            status: 'skipped',
            sideEffectType: skippedStepDef.sideEffectType,
            dependsOn: skippedStepDef.dependsOn,
            completedAt: new Date(),
          });
        } catch {
          // Unique constraint — row exists; mark it skipped.
          await tx
            .update(playbookStepRuns)
            .set({ status: 'skipped', completedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(playbookStepRuns.runId, run.id),
                eq(playbookStepRuns.stepId, skippedStepId)
              )
            );
        }
      }

      // Update run context.
      await tx
        .update(playbookRuns)
        .set({
          contextJson: nextCtx as unknown as Record<string, unknown>,
          contextSizeBytes: nextBytes,
          updatedAt: new Date(),
        })
        .where(eq(playbookRuns.id, run.id));
    });

    logger.info('playbook_decision_step_completed', {
      event: 'decision.completed',
      runId: run.id,
      stepRunId: sr.id,
      stepId: step.id,
      chosenBranchId,
      skippedCount: skipSet.size,
      retryCount,
    });

    await emitPlaybookEvent(run.id, run.subaccountId, 'playbook:decision:completed', {
      stepRunId: sr.id,
      stepId: step.id,
      chosenBranchId,
      skippedStepIds: [...skipSet],
      rationale,
    });

    await this.enqueueTick(run.id);
  },

  /**
   * Watchdog sweep — runs every 60 seconds via pg-boss cron. Self-healing
   * for the "step done but tick enqueue failed" race plus stuck-step
   * timeout enforcement.
   *
   * Spec §5.7.
   */
  async watchdogSweep(): Promise<void> {
    // Find non-terminal runs.
    const runs = await db
      .select()
      .from(playbookRuns)
      .where(
        inArray(playbookRuns.status, [
          'pending',
          'running',
          'awaiting_input',
          'awaiting_approval',
          'cancelling',
        ])
      );

    let recovered = 0;
    for (const run of runs) {
      // Check for stuck running steps that have exceeded the timeout.
      const cutoff = new Date(Date.now() - STEP_RUN_TIMEOUT_DEFAULT_MS);
      const stuck = await db
        .select()
        .from(playbookStepRuns)
        .where(
          and(
            eq(playbookStepRuns.runId, run.id),
            eq(playbookStepRuns.status, 'running'),
            lt(playbookStepRuns.startedAt, cutoff)
          )
        );
      for (const sr of stuck) {
        await this.failStepRun(sr.id, 'step_timeout_watchdog');
        recovered++;
      }

      // Re-tick every non-terminal run defensively. Idempotent because
      // tick is gated by the advisory lock and singletonKey at queue level.
      await this.enqueueTick(run.id);
    }

    if (recovered > 0) {
      logger.info('playbook_watchdog_recovered', { event: 'watchdog.recovered', count: recovered });
    }
  },

  /**
   * Registers the tick + watchdog workers with pg-boss. Called once at
   * server startup from agentScheduleService.initialize() (or directly
   * from server/index.ts in step 6).
   */
  async registerWorkers(): Promise<void> {
    const pgboss = (await getPgBoss()) as unknown as {
      work: (
        name: string,
        opts: Record<string, unknown>,
        handler: (job: { id: string; data: unknown }) => Promise<void>
      ) => Promise<void>;
      schedule: (name: string, cron: string, data?: object, opts?: object) => Promise<void>;
    };

    await pgboss.work(
      TICK_QUEUE,
      { teamSize: 4, teamConcurrency: 1 },
      async (job) => {
        const data = job.data as { runId: string };
        await this.tick(data.runId);
      }
    );

    await pgboss.work(
      WATCHDOG_QUEUE,
      { teamSize: 1, teamConcurrency: 1 },
      async () => {
        await this.watchdogSweep();
      }
    );

    // playbook-agent-step worker — runs the actual agent for prompt /
    // agent_call step types. Dynamic-imported to avoid pulling
    // agentExecutionService into the engine module's eager graph.
    await pgboss.work(
      AGENT_STEP_QUEUE,
      { teamSize: 4, teamConcurrency: 1 },
      async (job) => {
        const data = job.data as {
          playbookStepRunId: string;
          playbookRunId: string;
          organisationId: string;
          subaccountId: string;
          agentId: string;
          stepId: string;
          attempt: number;
          renderedPrompt: string | null;
          resolvedAgentInputs: Record<string, unknown>;
          sideEffectType: 'none' | 'idempotent' | 'reversible' | 'irreversible';
          // Decision-step-specific fields (absent for non-decision steps).
          systemPromptAddendum?: string;
          allowedToolSlugs?: string[];
          timeoutSeconds?: number;
          isDecisionRun?: boolean;
          triggerContext?: Record<string, unknown>;
        };

        // Re-verify the step run is still live before doing anything.
        // If it was invalidated between enqueue and worker pickup, drop.
        const [sr] = await db
          .select()
          .from(playbookStepRuns)
          .where(eq(playbookStepRuns.id, data.playbookStepRunId));
        if (!sr || sr.status === 'invalidated' || sr.status === 'completed') {
          logger.info('playbook_agent_step_skipped_stale', {
            stepRunId: data.playbookStepRunId,
            currentStatus: sr?.status,
          });
          return;
        }

        try {
          // Look up subaccountAgent linking row if any (used by agent system
          // to scope budgets and limits to the per-client config).
          const [saLink] = await db
            .select()
            .from(subaccountAgents)
            .where(
              and(
                eq(subaccountAgents.agentId, data.agentId),
                eq(subaccountAgents.subaccountId, data.subaccountId)
              )
            );

          const idempotencyKey = `playbook:${data.playbookRunId}:${data.stepId}:${data.attempt}`;
          // Use caller-supplied triggerContext when present (decision retries carry
          // extra fields like retryCount). Fall back to constructing it fresh.
          const triggerContext: Record<string, unknown> = data.triggerContext ?? {
            source: 'playbook',
            playbookRunId: data.playbookRunId,
            playbookStepRunId: data.playbookStepRunId,
            stepId: data.stepId,
            attempt: data.attempt,
            agentInputs: data.resolvedAgentInputs,
          };
          if (data.renderedPrompt && !triggerContext.prompt) {
            triggerContext.prompt = data.renderedPrompt;
          }

          // Dynamic import to avoid an import cycle
          const { agentExecutionService } = await import('./agentExecutionService.js');

          await agentExecutionService.executeRun({
            agentId: data.agentId,
            subaccountId: data.subaccountId,
            subaccountAgentId: saLink?.id ?? null,
            organisationId: data.organisationId,
            executionScope: 'subaccount',
            runType: 'triggered',
            runSource: 'system',
            executionMode: 'api',
            idempotencyKey,
            triggerContext,
            playbookStepRunId: data.playbookStepRunId,
          });
          // executeRun is synchronous (awaits the agent loop). The hook in
          // playbookAgentRunHook fires from the success/failure paths in
          // agentExecutionService and routes back to the engine.
        } catch (err) {
          logger.error('playbook_agent_step_dispatch_failed', {
            stepRunId: data.playbookStepRunId,
            stepId: data.stepId,
            error: err instanceof Error ? err.message : String(err),
          });
          // The §5.5 hard runtime guard: irreversible steps never retry.
          // For other types, the queue retryLimit handles transient failure.
          if (data.sideEffectType === 'irreversible') {
            await this.failStepRun(
              data.playbookStepRunId,
              'transient_error_no_retry: ' +
                (err instanceof Error ? err.message : String(err))
            );
            return;
          }
          throw err; // bubble for queue retry
        }
      }
    );

    // Cron schedule the watchdog every minute.
    try {
      await pgboss.schedule(WATCHDOG_QUEUE, '* * * * *', {}, getJobConfig('playbook-watchdog'));
    } catch (err) {
      logger.warn('playbook_watchdog_schedule_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('playbook_engine_workers_registered');
  },
};
