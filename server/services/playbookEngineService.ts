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
} from '../db/schema/index.js';
import type {
  PlaybookRun,
  PlaybookStepRun,
} from '../db/schema/index.js';
import type { PlaybookDefinition, PlaybookStep, RunContext } from '../lib/playbook/types.js';
import { hashValue } from '../lib/playbook/hash.js';
import { logger } from '../lib/logger.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';

const TICK_QUEUE = 'playbook-run-tick';
const WATCHDOG_QUEUE = 'playbook-watchdog';

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
      }
      return;
    }

    const def = await loadDefinitionForRun(run);
    if (!def) {
      logger.error('playbook_definition_missing', { runId });
      return;
    }

    const stepRunRows = await db
      .select()
      .from(playbookStepRuns)
      .where(eq(playbookStepRuns.runId, runId));

    // Group by liveness — invalidated/failed are audit-only.
    const liveStepRuns = stepRunRows.filter(
      (s) => s.status !== 'invalidated' && s.status !== 'failed'
    );

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

      case 'agent_call':
      case 'prompt': {
        // Phase 1 stub — the agent_run integration ships in step 6.
        // For now we mark the step as 'running' so the route layer can
        // observe state and the eventual integration can pick up from here.
        await db
          .update(playbookStepRuns)
          .set({
            status: 'running',
            inputJson: resolvedInputs as unknown as Record<string, unknown> | null,
            inputHash,
            startedAt: new Date(),
            version: sr.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(playbookStepRuns.id, sr.id));
        logger.warn('playbook_agent_call_dispatch_stub', {
          event: 'step.dispatched',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
          note: 'agent_call/prompt dispatch deferred to step 6 wiring',
        });
        return;
      }
    }
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
    await this.enqueueTick(sr.runId);
  },

  /**
   * Hook called by the agent run completion path. Looks up the playbook
   * step run linked to the agent run and routes to completeStepRun /
   * failStepRun. Wired into agentRunService in step 6.
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
    if (result.ok && result.output !== undefined) {
      await this.completeStepRun(sr.id, { output: result.output, via: 'agent_run' });
    } else {
      await this.failStepRun(sr.id, result.error ?? 'agent_run_failed');
    }
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
