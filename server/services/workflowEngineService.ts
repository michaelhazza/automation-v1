/**
 * WorkflowEngineService — the tick-driven execution engine.
 *
 * Spec: tasks/Workflows-spec.md §5.
 *
 * State machine driven by pg-boss jobs on the `Workflow-run-tick` queue.
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

import { eq, and, sql, isNull, lt, inArray, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  workflowRuns,
  workflowStepRuns,
  workflowTemplates,
  workflowTemplateVersions,
  systemWorkflowTemplates,
  systemWorkflowTemplateVersions,
  agents,
  systemAgents,
  subaccountAgents,
  organisations,
  subaccounts,
} from '../db/schema/index.js';
import type {
  WorkflowRun,
  WorkflowStepRun,
} from '../db/schema/index.js';
import type { WorkflowDefinition, WorkflowStep, RunContext, AgentDecisionStep } from '../lib/workflow/types.js';
import { hashValue } from '../lib/workflow/hash.js';
import { renderString, resolveInputs as resolveTemplateInputs, TemplatingError } from '../lib/workflow/templating.js';
import {
  computeSkipSet,
  parseDecisionOutput,
} from '../lib/workflow/agentDecisionPure.js';
import { renderAgentDecisionEnvelope } from '../lib/workflow/agentDecisionEnvelope.js';
import {
  MAX_DECISION_RETRIES,
  DEFAULT_DECISION_STEP_TIMEOUT_SECONDS,
  DECISION_RETRY_RAW_OUTPUT_TRUNCATE_CHARS,
} from '../config/limits.js';
import { logger } from '../lib/logger.js';
import { emitOrgUpdate, emitWorkflowRunUpdate, emitSubaccountUpdate } from '../websocket/emitters.js';
import { appendAndEmitTaskEvent } from './taskEventService.js';
import { insertRunRowWithUniqueGuard } from './workflowRunInsertHelper.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';
import { createWorker } from '../lib/createWorker.js';
import type { WorkflowRunMode } from '../db/schema/workflowRuns.js';
import { WorkflowStepReviewService } from './workflowStepReviewService.js';
import { WorkflowStepGateService } from './workflowStepGateService.js';
import {
  executeActionCall,
  resolveConfigurationAssistantAgentId,
  ActionTimeoutError,
} from './workflowActionCallExecutor.js';
import { SPEND_ACTION_ALLOWED_SLUGS } from '../config/actionRegistry.js';
import type { ActionCallStep, InvokeAutomationStep } from '../lib/workflow/types.js';
import { invokeAutomationStep } from './invokeAutomationStepService.js';
import { upsertFromWorkflow } from './memoryBlockService.js';
import { upsertSubaccountOnboardingState } from '../lib/workflow/onboardingStateHelpers.js';
import { taskService } from './taskService.js';
import { getByPath, serialiseForBlock } from './memoryBlockUpsertPure.js';
import { writeReferenceFromBinding } from './knowledgeService.js';
import {
  assertValidTransition,
  InvalidTransitionError,
} from '../../shared/stateMachineGuards.js';
import { WorkflowRunPauseStopService } from './workflowRunPauseStopService.js';
import { decideRunNextState } from './workflowRunPauseStopServicePure.js';
import { getStepCostEstimate } from '../lib/workflow/costEstimationDefaults.js';
import { WorkflowRunCostLedgerService } from './workflowRunCostLedgerService.js';

const TICK_QUEUE = 'workflow-run-tick';
const WATCHDOG_QUEUE = 'workflow-watchdog';
const AGENT_STEP_QUEUE = 'workflow-agent-step';

// ─── Engine constants (spec §1.5, §3.6, §5.2) ────────────────────────────────

const MAX_PARALLEL_STEPS_DEFAULT = 8;
const MAX_CONTEXT_BYTES_SOFT = 512 * 1024;
const MAX_CONTEXT_BYTES_HARD = 1024 * 1024;
const STEP_RUN_TIMEOUT_DEFAULT_MS = 30 * 60 * 1000; // 30 min
const WATCHDOG_INTERVAL_SECONDS = 60;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Narrow `run.subaccountId` to `string` for subaccount-scoped operations.
 *
 * Migration 0171 made `workflow_runs.subaccount_id` nullable so org-scope
 * runs can exist (§13.3). Code paths that only make sense for subaccount
 * runs call this helper to assert and narrow the type. The CHECK constraint
 * `workflow_runs_scope_subaccount_consistency_chk` means scope='subaccount'
 * always has a non-null subaccount_id at runtime, so this throw is purely
 * a defence against programming errors (e.g. a future handler accidentally
 * dispatching an org-scope run through a subaccount-only code path).
 */
function requireSubaccountId(run: WorkflowRun): string {
  if (run.subaccountId === null) {
    throw new Error(
      `Workflow run ${run.id} has scope='${run.scope}' with no subaccount_id; ` +
      `callsite expected a subaccount-scope run`,
    );
  }
  return run.subaccountId;
}

// C4b-INVAL-RACE: re-read step run after external I/O to discard late writes
// to invalidated steps. Returns the work result unchanged if the step is still
// live; returns { discarded: true, reason: 'invalidated' } if a concurrent
// edit invalidated the step while external I/O was in flight.
async function withInvalidationGuard<T>(
  stepRunId: string,
  externalWork: () => Promise<T>,
): Promise<T | { discarded: true; reason: 'invalidated' }> {
  const result = await externalWork();
  const [sr] = await db.select({ status: workflowStepRuns.status })
    .from(workflowStepRuns).where(eq(workflowStepRuns.id, stepRunId)).limit(1);
  if (sr?.status === 'invalidated') {
    return { discarded: true, reason: 'invalidated' };
  }
  return result;
}

function rehydrateDefinition(stored: Record<string, unknown>): WorkflowDefinition {
  return stored as unknown as WorkflowDefinition;
}

async function loadDefinitionForRun(run: WorkflowRun): Promise<WorkflowDefinition | null> {
  const [orgVer] = await db
    .select()
    .from(workflowTemplateVersions)
    .where(eq(workflowTemplateVersions.id, run.templateVersionId));
  if (orgVer) return rehydrateDefinition(orgVer.definitionJson as Record<string, unknown>);

  const [sysVer] = await db
    .select()
    .from(systemWorkflowTemplateVersions)
    .where(eq(systemWorkflowTemplateVersions.id, run.templateVersionId));
  if (sysVer) return rehydrateDefinition(sysVer.definitionJson as Record<string, unknown>);

  return null;
}

function findStepInDefinition(def: WorkflowDefinition, stepId: string): WorkflowStep | undefined {
  return def.steps.find((s) => s.id === stepId);
}

/**
 * Look up the Workflow slug for a run by joining through either the org
 * template-version lineage or the system template-version lineage. Returns
 * null if neither side resolves — this happens when the template was
 * hard-deleted out from under an in-flight run, which should be impossible
 * in practice but worth guarding.
 */
async function resolveWorkflowSlugForRun(run: WorkflowRun): Promise<string | null> {
  const [orgRow] = await db
    .select({ slug: workflowTemplates.slug })
    .from(workflowTemplateVersions)
    .innerJoin(workflowTemplates, eq(workflowTemplateVersions.templateId, workflowTemplates.id))
    .where(eq(workflowTemplateVersions.id, run.templateVersionId));
  if (orgRow?.slug) return orgRow.slug;

  const [sysRow] = await db
    .select({ slug: systemWorkflowTemplates.slug })
    .from(systemWorkflowTemplateVersions)
    .innerJoin(
      systemWorkflowTemplates,
      eq(systemWorkflowTemplateVersions.systemTemplateId, systemWorkflowTemplates.id),
    )
    .where(eq(systemWorkflowTemplateVersions.id, run.templateVersionId));
  return sysRow?.slug ?? null;
}

/**
 * True iff a prior successful (`completed` or `completed_with_errors`) run of
 * the same Workflow slug has already landed on this sub-account. Drives the
 * `firstRunOnly` gate on a `knowledgeBinding`.
 *
 * Implementation joins `workflow_runs → workflow_template_versions →
 * workflow_templates` on the org side and the matching system tables on the
 * system side, filtering by the resolved slug.
 */
async function hasPriorSuccessfulRunForSlug(
  subaccountId: string | null,
  slug: string,
  excludeRunId: string,
): Promise<boolean> {
  // Org-scope runs (migration 0171) have no subaccount — the "prior run for
  // this subaccount+slug" question has no meaning. Callers that are
  // subaccount-scoped either narrow the type or this guard makes the result
  // deterministic for org-scope paths.
  if (subaccountId === null) return false;
  const [orgHit] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .innerJoin(
      workflowTemplateVersions,
      eq(workflowRuns.templateVersionId, workflowTemplateVersions.id),
    )
    .innerJoin(workflowTemplates, eq(workflowTemplateVersions.templateId, workflowTemplates.id))
    .where(
      and(
        eq(workflowRuns.subaccountId, subaccountId),
        eq(workflowTemplates.slug, slug),
        inArray(workflowRuns.status, ['completed', 'completed_with_errors']),
        ne(workflowRuns.id, excludeRunId),
      ),
    )
    .limit(1);
  if (orgHit) return true;

  const [sysHit] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .innerJoin(
      systemWorkflowTemplateVersions,
      eq(workflowRuns.templateVersionId, systemWorkflowTemplateVersions.id),
    )
    .innerJoin(
      systemWorkflowTemplates,
      eq(systemWorkflowTemplateVersions.systemTemplateId, systemWorkflowTemplates.id),
    )
    .where(
      and(
        eq(workflowRuns.subaccountId, subaccountId),
        eq(systemWorkflowTemplates.slug, slug),
        inArray(workflowRuns.status, ['completed', 'completed_with_errors']),
        ne(workflowRuns.id, excludeRunId),
      ),
    )
    .limit(1);
  return !!sysHit;
}

/**
 * Apply the run's `knowledgeBindings[]` on terminal completion. For each
 * binding, the engine:
 *   1. Resolves the source step's output via `getByPath`.
 *   2. Serialises the resolved value for block storage.
 *   3. Skips the binding on `firstRunOnly` + prior-run-exists (§8.2).
 *   4. Delegates to `memoryBlockService.upsertFromWorkflow` which applies
 *      the merge strategy, rate limit, HITL carve-out and writes.
 *   5. Emits a structured event per outcome (missing_output, truncated,
 *      merge_fallback, rate_limited, hitl_required, created, updated).
 *
 * Failures on individual bindings never block run completion — the engine
 * logs and continues. All DB reads/writes happen against the main session
 * (no advisory lock needed; we are already inside the terminal branch).
 */
async function finaliseRunKnowledgeBindings(
  run: WorkflowRun,
  def: WorkflowDefinition,
  liveStepRuns: WorkflowStepRun[],
): Promise<void> {
  const bindings = def.knowledgeBindings ?? [];
  if (bindings.length === 0) return;

  // Knowledge bindings are a subaccount-scoped concern (they bind to the
  // subaccount's knowledge graph). Org-scope runs (migration 0171) have no
  // subaccount and cannot produce subaccount-scoped bindings.
  if (run.subaccountId === null) return;
  const subaccountId: string = run.subaccountId;

  const slug = await resolveWorkflowSlugForRun(run);
  if (!slug) {
    logger.warn('workflow_knowledge_binding_slug_missing', { runId: run.id });
    return;
  }

  // Determine whether any `firstRunOnly` binding fires. We compute this
  // lazily — the slug lookup is the only query we save.
  let priorRunChecked = false;
  let priorRunExists = false;
  const ensurePriorRunChecked = async () => {
    if (priorRunChecked) return;
    priorRunExists = await hasPriorSuccessfulRunForSlug(run.subaccountId, slug, run.id);
    priorRunChecked = true;
  };

  // Configuration Assistant owns provenance writes so the Knowledge page can
  // show "last written by agent X" attribution. Falls back to null on
  // system installs without a CA wired up.
  const actorAgentId = await resolveConfigurationAssistantAgentId(run.organisationId);

  for (const binding of bindings) {
    // Re-look up the step run row each iteration — the caller already loaded
    // them, so we avoid a round-trip.
    const sr = liveStepRuns.find(
      (row) => row.stepId === binding.stepId && row.status === 'completed',
    );
    if (!sr) {
      await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:missing_output', {
        stepId: binding.stepId,
        blockLabel: binding.blockLabel,
        reason: 'step_not_completed',
      });
      continue;
    }

    const value = getByPath(sr.outputJson, binding.outputPath);
    if (value === undefined) {
      await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:missing_output', {
        stepId: binding.stepId,
        blockLabel: binding.blockLabel,
        outputPath: binding.outputPath,
        reason: 'output_path_unresolved',
      });
      continue;
    }

    if (binding.firstRunOnly) {
      await ensurePriorRunChecked();
      if (priorRunExists) {
        await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:first_run_only_skipped', {
          stepId: binding.stepId,
          blockLabel: binding.blockLabel,
        });
        continue;
      }
    }

    const serialised = serialiseForBlock(value);

    try {
      const result = await upsertFromWorkflow({
        organisationId: run.organisationId,
        subaccountId: requireSubaccountId(run),
        label: binding.blockLabel,
        content: serialised,
        mergeStrategy: binding.mergeStrategy ?? 'replace',
        sourceRunId: run.id,
        workflowSlug: slug,
        actorAgentId,
        confidence: binding.firstRunOnly ? 'low' : 'normal',
      });

      switch (result.kind) {
        case 'created':
          await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:created', {
            stepId: binding.stepId,
            blockLabel: binding.blockLabel,
            blockId: result.blockId,
            truncated: result.truncated,
          });
          if (result.truncated) {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:truncated', {
              stepId: binding.stepId,
              blockLabel: binding.blockLabel,
              blockId: result.blockId,
            });
          }
          break;
        case 'updated':
          await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:updated', {
            stepId: binding.stepId,
            blockLabel: binding.blockLabel,
            blockId: result.blockId,
            truncated: result.truncated,
            mergeFallback: result.mergeFallback,
          });
          if (result.truncated) {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:truncated', {
              stepId: binding.stepId,
              blockLabel: binding.blockLabel,
              blockId: result.blockId,
            });
          }
          if (result.mergeFallback) {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:merge_fallback', {
              stepId: binding.stepId,
              blockLabel: binding.blockLabel,
              blockId: result.blockId,
            });
          }
          break;
        case 'skipped':
          if (result.reason === 'hitl_overwrite') {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:hitl_required', {
              stepId: binding.stepId,
              blockLabel: binding.blockLabel,
              blockId: result.blockId,
              previewContent: result.previewContent,
            });
          } else if (result.reason === 'rate_limited') {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:rate_limited', {
              stepId: binding.stepId,
              blockLabel: binding.blockLabel,
            });
          } else if (result.reason === 'empty_output') {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:empty_output', {
              stepId: binding.stepId,
              blockLabel: binding.blockLabel,
            });
          }
          break;
      }
    } catch (err) {
      logger.error('workflow_knowledge_binding_error', {
        runId: run.id,
        stepId: binding.stepId,
        blockLabel: binding.blockLabel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Identifies the set of steps whose dependencies are all completed and
 * which themselves are still in 'pending' status.
 */
function computeReadySet(def: WorkflowDefinition, stepRuns: WorkflowStepRun[]): WorkflowStep[] {
  const completedStepIds = new Set(
    stepRuns.filter((s) => s.status === 'completed' || s.status === 'skipped').map((s) => s.stepId)
  );
  const ready: WorkflowStep[] = [];
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
  def: WorkflowDefinition,
  liveStepRuns: WorkflowStepRun[]
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
        await db.insert(workflowStepRuns).values({
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
      await db.insert(workflowStepRuns).values({
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
async function emitWorkflowEvent(
  runId: string,
  subaccountId: string | null,
  type: string,
  payload: Record<string, unknown>,
  options?: { suppressWebSocket?: boolean }
): Promise<void> {
  // Sprint 4 P3.1: background mode suppresses all mid-run events.
  // Only final completion events (status === completed/failed/partial/cancelled)
  // are emitted regardless of suppression.
  if (options?.suppressWebSocket) {
    const isFinalEvent = type === 'Workflow:run:status' && (
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
      sql`UPDATE workflow_run_event_sequences SET last_sequence = last_sequence + 1 WHERE run_id = ${runId} RETURNING last_sequence`
    );
    const row = (result as unknown as { rows?: Array<{ last_sequence: number | string }> }).rows?.[0];
    if (row) {
      sequence = typeof row.last_sequence === 'string' ? parseInt(row.last_sequence, 10) : row.last_sequence;
    }
  } catch (err) {
    // Sequence allocation failure should never block the emit. Log + use 0.
    logger.warn('workflow_ws_sequence_allocation_failed', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  emitWorkflowRunUpdate(runId, type, { ...payload, sequence });
  // Coarse subaccount-level event for dashboard / inbox badge updates.
  // Org-scope runs (migration 0171) have no subaccount room to emit into.
  if (type === 'Workflow:run:status' && subaccountId !== null) {
    emitSubaccountUpdate(subaccountId, type, { runId, ...payload, sequence });
  }
}

/** Asserts a context size is within the hard limit; throws otherwise. */
function assertContextSize(bytes: number, runId: string): void {
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
 * Creates pending step runs for a new Workflow run. Used by bulk fan-out
 * to initialise child runs with the same step structure as the parent.
 * Only creates entry steps (dependsOn === []) — subsequent steps are
 * created by the engine as dependencies complete.
 */
async function createStepRunsForNewRun(
  runId: string,
  definition: WorkflowDefinition
): Promise<void> {
  const entries = definition.steps.filter((s) => s.dependsOn.length === 0);
  for (const step of entries) {
    await db.insert(workflowStepRuns).values({
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
    sql`INSERT INTO workflow_run_event_sequences (run_id, last_sequence) VALUES (${runId}, 0) ON CONFLICT DO NOTHING`
  );
}

// ─── Public engine API ───────────────────────────────────────────────────────

export const WorkflowEngineService = {
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
        ...getJobConfig('workflow-run-tick'),
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
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${'workflow-run:' + runId})::bigint) AS got`
    );
    const lockRow = (lockResult as unknown as { rows?: Array<{ got: boolean }> }).rows?.[0];
    if (lockRow && lockRow.got === false) {
      logger.debug('workflow_tick_lock_contended', { runId });
      return;
    }

    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
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
        .select({ id: workflowStepRuns.id })
        .from(workflowStepRuns)
        .where(and(eq(workflowStepRuns.runId, runId), eq(workflowStepRuns.status, 'running')));
      if (stillRunning.length === 0) {
        const cancelledAt = new Date();
        await db
          .update(workflowRuns)
          .set({ status: 'cancelled', completedAt: cancelledAt, updatedAt: cancelledAt })
          .where(eq(workflowRuns.id, runId));
        // §10.3 — onboarding-state bookkeeping for the terminal cancel.
        await upsertSubaccountOnboardingState({
          runId,
          organisationId: run.organisationId,
          // Helper accepts string | null — onboarding state is skipped for
          // org-scope runs rather than throwing at the terminal path.
          subaccountId: run.subaccountId,
          workflowSlug: run.workflowSlug,
          isOnboardingRun: run.isOnboardingRun,
          runStatus: 'cancelled',
          startedAt: run.startedAt,
          completedAt: cancelledAt,
        });
        logger.info('workflow_run_cancelled', { event: 'run.cancelled', runId });
        await emitWorkflowEvent(runId, run.subaccountId, 'Workflow:run:status', {
          status: 'cancelled',
        });
        emitOrgUpdate(run.organisationId, 'dashboard.activity.updated', {
          source: 'workflow_run',
          runId,
          status: 'cancelled',
        });
      }
      return;
    }

    const def = await loadDefinitionForRun(run);
    if (!def) {
      logger.error('workflow_definition_missing', { runId });
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
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.runId, runId));

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
        .from(workflowStepRuns)
        .where(eq(workflowStepRuns.runId, runId));
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
        const finalStatus: WorkflowRun['status'] = anyContinueFailures
          ? 'completed_with_errors'
          : 'completed';

        // §8 — fire knowledgeBindings[] BEFORE the terminal status write so
        // any emitted events are ordered before the final run:status emit.
        // A binding failure never blocks the completion transaction.
        try {
          await finaliseRunKnowledgeBindings(run, def, liveStepRuns);
        } catch (err) {
          logger.error('workflow_knowledge_bindings_finalise_failed', {
            runId,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const completedAt = new Date();
        await db
          .update(workflowRuns)
          .set({ status: finalStatus, completedAt, updatedAt: completedAt })
          .where(eq(workflowRuns.id, runId));
        // §10.3 — onboarding-state bookkeeping (best-effort).
        await upsertSubaccountOnboardingState({
          runId,
          organisationId: run.organisationId,
          // Helper accepts string | null; skip onboarding state for org-scope.
          subaccountId: run.subaccountId,
          workflowSlug: run.workflowSlug,
          isOnboardingRun: run.isOnboardingRun,
          runStatus: finalStatus,
          startedAt: run.startedAt,
          completedAt,
        });
        logger.info('workflow_run_completed', {
          event: finalStatus === 'completed' ? 'run.completed' : 'run.completed_with_errors',
          runId,
          totalSteps: def.steps.length,
        });
        await emitWorkflowEvent(runId, run.subaccountId, 'Workflow:run:status', {
          status: finalStatus,
          completedSteps: completedSteps.length,
          totalSteps: def.steps.length,
        }, { suppressWebSocket: shouldSuppressWebSocket(run.runMode) });

        if (['completed', 'completed_with_errors'].includes(finalStatus)) {
          emitOrgUpdate(run.organisationId, 'dashboard.activity.updated', {
            source: 'workflow_run',
            runId,
            status: finalStatus,
          });
        }

        // Sprint 4 P3.1: if this is a bulk child, re-tick the parent
        if (run.parentRunId) {
          await this.enqueueTick(run.parentRunId);
        }
        return;
      }

      // Not terminal — propagate the awaiting/running status.
      // Log when the run cannot complete and no step is actively running or awaiting input.
      if (!anyRunning && !anyAwaiting) {
        const blockingStep = liveStepRuns.find(
          (s) => s.status !== 'completed' && s.status !== 'skipped'
        );
        if (blockingStep) {
          logger.info('run_completion_blocked_by_open_step', {
            runId,
            organisationId: run.organisationId,
            blockingStepId: blockingStep.stepId,
            blockingStepStatus: blockingStep.status,
          });
        }
      }
      let aggregate: WorkflowRun['status'] = run.status;
      if (anyRunning) aggregate = 'running';
      else if (anyAwaiting) {
        const anyAwaitingInput = liveStepRuns.some((s) => s.status === 'awaiting_input');
        aggregate = anyAwaitingInput ? 'awaiting_input' : 'awaiting_approval';
      }
      if (aggregate !== run.status) {
        await db
          .update(workflowRuns)
          .set({ status: aggregate, updatedAt: new Date() })
          .where(eq(workflowRuns.id, runId));
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
        .update(workflowRuns)
        .set({ status: 'running', updatedAt: new Date() })
        .where(eq(workflowRuns.id, runId));
      await emitWorkflowEvent(runId, run.subaccountId, 'Workflow:run:status', {
        status: 'running',
        completedSteps: liveStepRuns.filter((s) => s.status === 'completed' || s.status === 'skipped').length,
        totalSteps: def.steps.length,
      });
    }

    // §7 between-step runaway check — fires before dispatching any next step.
    // Reads DB-clock elapsed time to avoid drift from Node.js process clock.
    if (toDispatch.length > 0) {
      const capCheckResult = await db.execute(
        sql`SELECT cost_accumulator_cents,
                   EXTRACT(EPOCH FROM (now() - started_at))::integer AS elapsed_seconds
            FROM workflow_runs
            WHERE id = ${runId}`,
      );
      const capRow = (capCheckResult as unknown as { rows?: Array<{ cost_accumulator_cents: number; elapsed_seconds: number }> }).rows?.[0];
      if (capRow) {
        const capDecision = decideRunNextState({
          currentStatus: 'running',
          currentCostCents: capRow.cost_accumulator_cents,
          currentElapsedSeconds: capRow.elapsed_seconds,
          effectiveCostCeilingCents: run.effectiveCostCeilingCents,
          effectiveWallClockCapSeconds: run.effectiveWallClockCapSeconds,
        });
        if (capDecision.shouldPause) {
          // System-initiated pause — use 'system' as actor userId.
          await WorkflowRunPauseStopService.pauseRun(
            runId,
            run.organisationId,
            'system',
            capDecision.reason as 'cost_ceiling' | 'wall_clock',
          );
          logger.info('workflow_engine_between_step_pause', {
            runId,
            reason: capDecision.reason,
            costCents: capRow.cost_accumulator_cents,
            elapsedSeconds: capRow.elapsed_seconds,
          });
          return; // Do not dispatch next step.
        }
      }
    }

    for (const step of toDispatch) {
      // Pre-dispatch: re-read run status to catch external pause/cancel/fail.
      const [freshRun] = await db
        .select({ status: workflowRuns.status })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, runId));
      if (
        freshRun &&
        (freshRun.status === 'cancelled' ||
          freshRun.status === 'failed' ||
          freshRun.status === 'paused')
      ) {
        logger.info('workflow_engine_dispatch_aborted', {
          runId,
          stepId: step.id,
          status: freshRun.status,
        });
        return; // Abort dispatch; do not process remaining steps.
      }

      // Pre-step cost-cap check.
      if (run.effectiveCostCeilingCents !== null) {
        const costEstimate = (step.params?.estimatedCostCents as number | undefined) ?? getStepCostEstimate(step.type ?? '');
        const latestCostResult = await db.execute(
          sql`SELECT cost_accumulator_cents FROM workflow_runs WHERE id = ${runId}`,
        );
        const latestCostRow = (latestCostResult as unknown as { rows?: Array<{ cost_accumulator_cents: number }> }).rows?.[0];
        const latestCost = latestCostRow?.cost_accumulator_cents ?? 0;
        if (latestCost + costEstimate >= run.effectiveCostCeilingCents) {
          await WorkflowRunPauseStopService.pauseRun(
            runId,
            run.organisationId,
            'system',
            'cost_ceiling',
          );
          logger.info('workflow_engine_pre_step_pause', {
            runId,
            stepId: step.id,
            stepType: step.type,
            costEstimate,
            latestCost,
            ceiling: run.effectiveCostCeilingCents,
          });
          return; // Do not dispatch this or subsequent steps.
        }
      }

      try {
        await this.dispatchStep(run, def, step, liveStepRuns);
      } catch (err) {
        logger.error('workflow_dispatch_error', {
          runId,
          stepId: step.id,
          error: err instanceof Error ? err.message : String(err),
        });
        // Mark the step run as failed and re-tick to evaluate failure policy.
        const sr = liveStepRuns.find((s) => s.stepId === step.id);
        if (sr) {
          // Defence-in-depth: skip the failure write if the row is already
          // terminal. Logged + observable; we do not propagate the violation
          // because the outer block is itself an error handler — re-throwing
          // would brick the tick and prevent re-evaluation.
          try {
            assertValidTransition({
              kind: 'workflow_step_run',
              recordId: sr.id,
              from: sr.status,
              to: 'failed',
            });
            await db
              .update(workflowStepRuns)
              .set({
                status: 'failed',
                error: err instanceof Error ? err.message : String(err),
                completedAt: new Date(),
                version: sr.version + 1,
                updatedAt: new Date(),
              })
              .where(eq(workflowStepRuns.id, sr.id));
          } catch (assertErr) {
            if (assertErr instanceof InvalidTransitionError) {
              logger.warn('workflow_step_invalid_transition_skipped', {
                event: 'state_machine.invalid_transition',
                kind: assertErr.kind,
                recordId: assertErr.recordId,
                from: assertErr.from,
                to: assertErr.to,
                via: 'dispatch_error_path',
              });
            } else {
              throw assertErr;
            }
          }
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
    run: WorkflowRun,
    def: WorkflowDefinition,
    step: WorkflowStep,
    liveStepRuns: WorkflowStepRun[]
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
    // In supervised mode, every agent_call/prompt/action_call step requires
    // approval before dispatch. Conditional and user_input steps proceed
    // normally.
    if (
      run.runMode === 'supervised' &&
      (step.type === 'agent_call' || step.type === 'prompt' || step.type === 'action_call') &&
      sr.status === 'pending'
    ) {
      await WorkflowStepReviewService.requireApproval(sr, {
        reviewKind: 'supervised_mode',
        organisationId: run.organisationId,
        // B1 fix (spec §6.3): forward step + run context so the gate row
        // gets seen_payload + seen_confidence at open time.
        stepDefinition: {
          id: step.id,
          type: step.type,
          name: step.name,
          params: step.params as Record<string, unknown> | undefined,
          isCritical: step.params?.is_critical === true,
          sideEffectClass: typeof step.params?.side_effect_class === 'string'
            ? step.params.side_effect_class
            : undefined,
        },
        templateVersionId: run.templateVersionId,
        subaccountId: run.subaccountId,
      });
      // Step is now awaiting_approval; tick will re-check on next pass
      return;
    }

    // ── Workflows V1: isCritical synthesis gate ────────────────────────────
    // When a step declares `params.is_critical: true` and is one of the
    // side-effecting step types, synthesise an Approval gate before dispatch.
    // Guard: if a gate is already open for this step (re-entrant tick or race),
    // skip synthesis to avoid double-gating.
    const IS_CRITICAL_STEP_TYPES = [
      'agent_call', 'prompt', 'action_call', 'invoke_automation',
      'agent', 'action',
    ] as const;

    if (
      sr.status === 'pending' &&
      (step.params?.is_critical === true) &&
      (IS_CRITICAL_STEP_TYPES as readonly string[]).includes(step.type)
    ) {
      // Re-entrant guard: check if a gate is already open for this step.
      const existingGate = await WorkflowStepGateService.getOpenGate(
        sr.runId,
        sr.stepId,
        run.organisationId,
      );
      if (!existingGate) {
        // "No double-gate" rule: check if the immediately preceding step was
        // an Approval-type step. If so, skip synthesis.
        const prevStepIds = step.dependsOn ?? [];
        const prevIsApproval = prevStepIds.some((prevId) => {
          const prevDef = def.steps.find((s) => s.id === prevId);
          return prevDef?.type === 'approval';
        });

        if (!prevIsApproval) {
          await WorkflowStepReviewService.requireApproval(sr, {
            reviewKind: 'is_critical_synthesised',
            organisationId: run.organisationId,
            approverGroup: { kind: 'task_requester', quorum: 1 },
            isCriticalSynthesised: true,
            // B1 fix (spec §6.3): forward step + run context so the
            // synthesised gate row gets seen_payload + seen_confidence.
            stepDefinition: {
              id: step.id,
              type: step.type,
              name: step.name,
              params: step.params as Record<string, unknown> | undefined,
              isCritical: true,
              sideEffectClass: typeof step.params?.side_effect_class === 'string'
                ? step.params.side_effect_class
                : undefined,
            },
            templateVersionId: run.templateVersionId,
            subaccountId: run.subaccountId,
          });

          // Step is now awaiting_approval; tick will re-check on next pass
          return;
        }
      }
    }

    switch (step.type) {
      case 'user_input': {
        await db
          .update(workflowStepRuns)
          .set({
            status: 'awaiting_input',
            inputJson: resolvedInputs as unknown as Record<string, unknown> | null,
            inputHash,
            startedAt: new Date(),
            version: sr.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(workflowStepRuns.id, sr.id));
        logger.info('workflow_step_awaiting_input', {
          event: 'step.awaiting_input',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
        });
        await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:step:awaiting_input', {
          stepRunId: sr.id,
          stepId: step.id,
        });
        return;
      }

      case 'approval': {
        await db
          .update(workflowStepRuns)
          .set({
            status: 'awaiting_approval',
            inputJson: resolvedInputs as unknown as Record<string, unknown> | null,
            inputHash,
            startedAt: new Date(),
            version: sr.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(workflowStepRuns.id, sr.id));
        logger.info('workflow_step_awaiting_approval', {
          event: 'step.awaiting_approval',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
        });
        await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:step:awaiting_approval', {
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

        // Resolve decisionPrompt via templating. The validator requires decisionPrompt
        // to be set on every agent_decision step, so the fallback is unreachable in
        // well-validated definitions. It is kept as a safety net against stale data.
        let resolvedDecisionPrompt: string;
        try {
          resolvedDecisionPrompt = renderString(step.decisionPrompt ?? '', ctx);
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
          .update(workflowStepRuns)
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
          .where(eq(workflowStepRuns.id, sr.id));

        // Enqueue onto the Workflow-agent-step queue. The worker creates
        // the agent_runs row (with workflow_step_run_id) and runs executeRun.
        // The completion hook fires when done.
        //
        // Key decision-specific additions:
        //   - systemPromptAddendum: the rendered decision envelope
        //   - allowedToolSlugs: [] (empty — no tools in decision steps; §18)
        //   - timeoutSeconds: per-step override or DEFAULT_DECISION_STEP_TIMEOUT_SECONDS
        const timeoutSeconds =
          step.timeoutSeconds ?? DEFAULT_DECISION_STEP_TIMEOUT_SECONDS;
        const idempotencyKey = `Workflow:${run.id}:${step.id}:${sr.attempt}`;
        const triggerContext: Record<string, unknown> = {
          source: 'Workflow',
          WorkflowRunId: run.id,
          WorkflowStepRunId: sr.id,
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
            WorkflowStepRunId: sr.id,
            WorkflowRunId: run.id,
            organisationId: run.organisationId,
            subaccountId: requireSubaccountId(run),
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
            ...getJobConfig('workflow-agent-step'),
            singletonKey: idempotencyKey,
            useSingletonQueue: true,
          }
        );

        logger.info('workflow_decision_step_dispatched', {
          event: 'decision.dispatched',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
          resolvedAgentId,
          branchesCount: decisionStep.branches.length,
        });
        await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:decision:dispatched', {
          stepRunId: sr.id,
          stepId: step.id,
          agentId: resolvedAgentId, // the agent entity; agentRunId is populated by agentExecutionService
          branchesCount: decisionStep.branches.length,
        });
        return;
      }

      case 'action_call': {
        // Replay mode short-circuits to the recorded output.
        if (run.replayMode) {
          await this.replayDispatch(run, sr, step);
          return;
        }

        const actionStep = step as ActionCallStep;
        const ctx = run.contextJson as unknown as RunContext;

        // Resolve templated inputs against run context.
        let resolvedActionInputs: Record<string, unknown>;
        try {
          resolvedActionInputs = actionStep.actionInputs
            ? resolveTemplateInputs(actionStep.actionInputs, ctx)
            : {};
        } catch (err) {
          if (err instanceof TemplatingError) {
            await this.failStepRunInternal(
              sr,
              `templating_error: ${err.reason} ('${err.expression}')`,
            );
            return;
          }
          throw err;
        }

        const dispatchInputHash = hashValue({
          actionSlug: actionStep.actionSlug,
          actionInputs: resolvedActionInputs,
        });

        // Input-hash reuse path — never for irreversible steps.
        if (step.sideEffectType !== 'irreversible') {
          const reuse = await this.findReusableOutputForStep(
            run.id,
            step.id,
            dispatchInputHash,
          );
          if (reuse) {
            logger.info('workflow_action_call_input_hash_reuse', {
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
              `input_hash_reuse:from_attempt_${reuse.attempt}`,
            );
            return;
          }
        }

        // Resolve the Configuration Assistant agent id (cache → live).
        const meta = ctx?._meta ?? ({} as RunContext['_meta']);
        let configAgentId = meta.resolvedActionAgents?.configuration_assistant ?? null;
        if (!configAgentId) {
          configAgentId = await resolveConfigurationAssistantAgentId(run.organisationId);
        }
        if (!configAgentId) {
          await this.failStepRunInternal(sr, 'configuration_assistant_agent_not_found');
          return;
        }

        // Mark the step as running.
        await db
          .update(workflowStepRuns)
          .set({
            status: 'running',
            inputJson: {
              actionSlug: actionStep.actionSlug,
              actionInputs: resolvedActionInputs,
            } as unknown as Record<string, unknown>,
            inputHash: dispatchInputHash,
            startedAt: new Date(),
            version: sr.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(workflowStepRuns.id, sr.id));

        // Idempotency key — entity-scoped for singleton resources, run-scoped otherwise.
        const idempotencyKey =
          actionStep.idempotencyScope === 'entity' && actionStep.entityKey
            ? `entity:${actionStep.entityKey}`
            : `Workflow:${run.id}:${step.id}:${sr.attempt}`;

        logger.info('workflow_action_call_dispatched', {
          event: 'step.dispatched',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
          actionSlug: actionStep.actionSlug,
          idempotencyKey,
        });
        await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:step:dispatched', {
          stepRunId: sr.id,
          stepId: step.id,
          stepType: step.type,
          actionSlug: actionStep.actionSlug,
        });

        // Replay interaction with runNow — spec §5.9.
        // A replay must NOT enqueue a `runNow` immediate run, even if the
        // original run's action_call passed `runNow: true`. Strip the flag
        // before forwarding and emit a timeline event so the suppression
        // is visible on the replayed run.
        let dispatchedActionInputs: Record<string, unknown> = resolvedActionInputs;
        if (run.replayMode && 'runNow' in resolvedActionInputs) {
          const stripped = { ...resolvedActionInputs };
          delete stripped.runNow;
          dispatchedActionInputs = stripped;
          await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:step:run_now_skipped_replay', {
            stepRunId: sr.id,
            stepId: step.id,
          });
        }

        // Execute synchronously via the action pipeline.
        try {
          const guardedResult = await withInvalidationGuard(sr.id, () => executeActionCall({
            organisationId: run.organisationId,
            subaccountId: requireSubaccountId(run),
            agentId: configAgentId,
            WorkflowStepRunId: sr.id,
            WorkflowRunId: run.id,
            actionSlug: actionStep.actionSlug,
            actionInputs: dispatchedActionInputs,
            idempotencyKey,
            timeoutMs: step.timeoutSeconds ? step.timeoutSeconds * 1000 : undefined,
          }));
          if ('discarded' in guardedResult) {
            logger.info('workflow_step_action_call_invalidation_discarded', {
              event: 'step.dispatch.invalidation_discarded',
              runId: run.id, stepRunId: sr.id, stepId: step.id,
              status: 'success', discarded: true,
            });
            return;
          }
          const result = guardedResult;

          if (result.status === 'blocked') {
            await this.failStepRunInternal(
              sr,
              `blocked_by_policy${result.reason ? `: ${result.reason}` : ''}`,
            );
            return;
          }
          if (result.status === 'pending_approval') {
            const reviewKind = (SPEND_ACTION_ALLOWED_SLUGS as readonly string[]).includes(actionStep.actionSlug ?? '')
              ? 'spend_approval'
              : 'action_call_approval';
            await db
              .update(workflowStepRuns)
              .set({
                status: 'awaiting_approval',
                updatedAt: new Date(),
              })
              .where(eq(workflowStepRuns.id, sr.id));
            await emitWorkflowEvent(
              run.id,
              run.subaccountId,
              'Workflow:step:awaiting_approval',
              { stepRunId: sr.id, stepId: step.id, actionId: result.actionId, reviewKind },
            );
            // Chunk 9: also emit step.awaiting_approval to the task event stream.
            if (run.taskId) {
              void appendAndEmitTaskEvent(
                {
                  taskId: run.taskId,
                  organisationId: run.organisationId,
                  subaccountId: run.subaccountId,
                },
                'engine',
                { kind: 'step.awaiting_approval', payload: { stepId: step.id, reviewKind, actionId: result.actionId } },
              );
            }
            return;
          }
          if (result.status === 'failed') {
            await this.failStepRunInternal(sr, `action_failed: ${result.error}`);
            return;
          }
          // approved_and_executed
          await this.completeStepRunInternal(
            sr,
            result.output,
            hashValue(result.output),
            'action_call',
          );
        } catch (err) {
          const reason =
            err instanceof ActionTimeoutError
              ? 'action_timeout'
              : `action_call_error: ${err instanceof Error ? err.message : String(err)}`;
          await this.failStepRunInternal(sr, reason);
        }
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
        // Workflow-agent-step queue. The worker creates the agent_runs row
        // (with workflow_step_run_id set) and runs executeRun. The
        // existing completion hook routes the result back via
        // WorkflowAgentRunHook.

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
            logger.info('workflow_step_input_hash_reuse', {
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
          .update(workflowStepRuns)
          .set({
            status: 'running',
            inputJson: { agentInputs: resolvedAgentInputs, prompt: renderedPrompt } as unknown as Record<string, unknown>,
            inputHash: dispatchInputHash,
            startedAt: new Date(),
            version: sr.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(workflowStepRuns.id, sr.id));

        // Enqueue onto the Workflow-agent-step queue. The worker creates
        // the agent_runs row (with workflow_step_run_id) and runs
        // executeRun synchronously. The completion hook fires when done.
        const pgboss = (await getPgBoss()) as unknown as {
          send: (
            name: string,
            data: object,
            options?: Record<string, unknown>
          ) => Promise<string | null>;
        };
        const agentSendResult = await withInvalidationGuard(sr.id, () => pgboss.send(
          AGENT_STEP_QUEUE,
          {
            WorkflowStepRunId: sr.id,
            WorkflowRunId: run.id,
            organisationId: run.organisationId,
            subaccountId: requireSubaccountId(run),
            agentId: resolvedAgentId,
            stepId: step.id,
            attempt: sr.attempt,
            renderedPrompt,
            resolvedAgentInputs,
            sideEffectType: step.sideEffectType,
          },
          {
            ...getJobConfig('workflow-agent-step'),
            singletonKey: `Workflow-step:${sr.id}:${sr.attempt}`,
            useSingletonQueue: true,
          }
        ));
        if (typeof agentSendResult === 'object' && agentSendResult !== null && 'discarded' in agentSendResult) {
          logger.info('workflow_step_agent_dispatch_invalidation_discarded', {
            event: 'step.dispatch.invalidation_discarded',
            runId: run.id, stepRunId: sr.id, stepId: step.id,
            status: 'success', discarded: true,
          });
          return;
        }

        logger.info('workflow_agent_step_dispatched', {
          event: 'step.dispatched',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
          resolvedAgentId,
        });
        await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:step:dispatched', {
          stepRunId: sr.id,
          stepId: step.id,
          stepType: step.type,
        });
        return;
      }

      case 'invoke_automation': {
        const autoStep = step as InvokeAutomationStep;
        const ctx = run.contextJson as unknown as RunContext;

        // Mark step as running before dispatch.
        await db
          .update(workflowStepRuns)
          .set({ status: 'running', startedAt: new Date(), version: sr.version + 1, updatedAt: new Date() })
          .where(eq(workflowStepRuns.id, sr.id));

        const invokeGuardResult = await withInvalidationGuard(sr.id, () => invokeAutomationStep({
          step: autoStep,
          runId: run.id,
          stepRunId: sr.id,
          run: { organisationId: run.organisationId, subaccountId: run.subaccountId },
          templateCtx: ctx as unknown as Record<string, unknown>,
        }));
        if ('discarded' in invokeGuardResult) {
          logger.info('workflow_step_invoke_automation_invalidation_discarded', {
            event: 'step.dispatch.invalidation_discarded',
            runId: run.id, stepRunId: sr.id, stepId: step.id,
            status: 'success', discarded: true,
          });
          return;
        }
        const result = invokeGuardResult;

        if (result.status === 'ok') {
          const output = result.output ?? {};
          await this.completeStepRunInternal(sr, output, hashValue(output), 'invoke_automation');
          return;
        }

        if (result.status === 'review_required') {
          await WorkflowStepReviewService.requireApproval(sr, {
            reviewKind: 'invoke_automation_gate',
            organisationId: run.organisationId,
            // B1 fix (spec §6.3): forward step + run context.
            stepDefinition: {
              id: step.id,
              type: step.type,
              name: step.name,
              params: step.params as Record<string, unknown> | undefined,
              isCritical: step.params?.is_critical === true,
              sideEffectClass: typeof step.params?.side_effect_class === 'string'
                ? step.params.side_effect_class
                : undefined,
            },
            templateVersionId: run.templateVersionId,
            subaccountId: run.subaccountId,
          });
          return;
        }

        // error — respect failurePolicy: 'continue' so non-critical automations don't halt the run
        const errorReason = `invoke_automation_error: ${result.error?.code ?? 'unknown'}: ${result.error?.message ?? ''}`;
        if (autoStep.failurePolicy === 'continue') {
          await this.completeStepRunInternal(sr, { error: result.error }, hashValue(result.error), 'invoke_automation_continue');
        } else {
          await this.failStepRunInternal(sr, errorReason);
        }
        return;
      }

      default: {
        // Exhaustiveness guard — new step types must add a case above.
        const exhaustiveCheck: never = step.type as never;
        logger.error('workflow_dispatch_unknown_step_type', { stepType: exhaustiveCheck, runId: run.id, stepId: step.id });
        await this.failStepRunInternal(sr, `unknown_step_type:${step.type}`);
        return;
      }
    }
  },

  /**
   * Resolves an agent_call step's agentRef to a concrete agent id.
   * Reads the cache from `run.contextJson._meta.resolvedAgents` first;
   * falls back to a live DB lookup. The fresh lookup is also re-verified
   * before every dispatch (spec §3.4) so a deleted agent fails with
   * `workflow_template_drift:agent_deleted_mid_run`.
   */
  async resolveAgentForStep(run: WorkflowRun, step: WorkflowStep): Promise<string | null> {
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
      logger.warn('workflow_resolved_agent_missing', {
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
      .from(workflowStepRuns)
      .where(
        and(
          eq(workflowStepRuns.runId, runId),
          eq(workflowStepRuns.stepId, stepId),
          eq(workflowStepRuns.status, 'completed'),
          eq(workflowStepRuns.inputHash, inputHashValue)
        )
      );
    const row = rows[0];
    if (!row || row.outputJson === null || !row.outputHash) return null;
    return { attempt: row.attempt, output: row.outputJson, outputHash: row.outputHash };
  },

  // ─── C4a-REVIEWED-DISP: resume an invoke_automation step after user approval ─

  /**
   * Resumes an `invoke_automation` step that was held at `review_required`.
   * Guard: `UPDATE WHERE status = 'review_required' RETURNING *` — if zero
   * rows returned, a concurrent approval already won; return `alreadyResumed: true`.
   * Per pre-launch-hardening-spec §4.4 (Option A) and §4.5.2.
   */
  async resumeInvokeAutomationStep(
    stepRunId: string,
  ): Promise<{ alreadyResumed: boolean; stepOutcome: 'completed' | 'failed' }> {
    // Optimistic transition: awaiting_approval → running (the guard IS the lock)
    const [updated] = await db
      .update(workflowStepRuns)
      .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(workflowStepRuns.id, stepRunId),
        eq(workflowStepRuns.status, 'awaiting_approval'),
      ))
      .returning();

    if (!updated) {
      logger.info('step.resume.guard_blocked', {
        event: 'step.resume.guard_blocked',
        stepRunId,
        status: 'success',
        alreadyResumed: true,
      });
      // Another concurrent winner already owns this step; treat as completed from our perspective.
      return { alreadyResumed: true, stepOutcome: 'completed' };
    }

    const sr = updated;
    logger.info('step.resume.started', {
      event: 'step.resume.started',
      stepRunId,
      runId: sr.runId,
      automationId: sr.stepId,
      dispatch_source: 'approval_resume',
    });

    // Load the workflow run and its definition
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, sr.runId))
      .limit(1);
    if (!run) {
      await this.failStepRunInternal(sr, 'resume_run_not_found');
      return { alreadyResumed: false, stepOutcome: 'failed' };
    }

    const definition = await loadDefinitionForRun(run);
    if (!definition) {
      await this.failStepRunInternal(sr, 'resume_definition_not_found');
      return { alreadyResumed: false, stepOutcome: 'failed' };
    }

    const step = findStepInDefinition(definition, sr.stepId) as InvokeAutomationStep | undefined;
    if (!step || step.type !== 'invoke_automation') {
      await this.failStepRunInternal(sr, 'resume_step_not_invoke_automation');
      return { alreadyResumed: false, stepOutcome: 'failed' };
    }

    const startMs = Date.now();
    const ctx = run.contextJson as unknown as RunContext;

    const invokeGuardResult = await withInvalidationGuard(sr.id, () =>
      invokeAutomationStep({
        step,
        runId: run.id,
        stepRunId: sr.id,
        run: { organisationId: run.organisationId, subaccountId: run.subaccountId },
        templateCtx: ctx as unknown as Record<string, unknown>,
        // Approved upstream — bypass the gate so the resume path dispatches
        // instead of re-emitting review_required and falling through to error.
        bypassGate: true,
      }),
    );

    if ('discarded' in invokeGuardResult) {
      logger.info('step.resume.invalidation_discarded', {
        event: 'step.resume.invalidation_discarded',
        stepRunId,
        runId: run.id,
        status: 'success',
      });
      return { alreadyResumed: false, stepOutcome: 'completed' };
    }

    const result = invokeGuardResult;
    const latencyMs = Date.now() - startMs;

    if (result.status === 'ok') {
      const output = result.output ?? {};
      await this.completeStepRunInternal(sr, output, hashValue(output), 'invoke_automation');
      logger.info('step.resume.completed', {
        event: 'step.resume.completed',
        stepRunId,
        runId: run.id,
        executionStatus: 'completed',
        latencyMs,
        status: 'success',
      });
      return { alreadyResumed: false, stepOutcome: 'completed' };
    }

    // Defensive: review_required must never reach the resume path —
    // resumeInvokeAutomationStep passes bypassGate: true to invokeAutomationStep
    // exactly so this branch never fires. If it does, fail loudly so the bug
    // is observable rather than silently dispatching nothing.
    if (result.status === 'review_required') {
      const reason = 'resume_review_required_after_bypass: gate returned review despite bypass';
      logger.error('step.resume.review_required_unexpected', {
        event: 'step.resume.review_required_unexpected',
        stepRunId,
        runId: run.id,
        latencyMs,
        status: 'failed',
      });
      await this.failStepRunInternal(sr, reason);
      return { alreadyResumed: false, stepOutcome: 'failed' };
    }

    // error — respect failurePolicy: 'continue' as in the primary dispatch path
    const errorReason = `invoke_automation_error: ${result.error?.code ?? 'unknown'}: ${result.error?.message ?? ''}`;
    if (step.failurePolicy === 'continue') {
      await this.completeStepRunInternal(sr, { error: result.error }, hashValue(result.error), 'invoke_automation_continue');
      logger.error('step.resume.failed', {
        event: 'step.resume.failed',
        stepRunId,
        runId: run.id,
        error: errorReason,
        latencyMs,
        status: 'failed',
      });
      return { alreadyResumed: false, stepOutcome: 'completed' };
    } else {
      await this.failStepRunInternal(sr, errorReason);
      logger.error('step.resume.failed', {
        event: 'step.resume.failed',
        stepRunId,
        runId: run.id,
        error: errorReason,
        latencyMs,
        status: 'failed',
      });
      return { alreadyResumed: false, stepOutcome: 'failed' };
    }
  },

  async failStepRunInternal(sr: WorkflowStepRun, reason: string): Promise<void> {
    await db
      .update(workflowStepRuns)
      .set({
        status: 'failed',
        error: reason,
        completedAt: new Date(),
        version: sr.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(workflowStepRuns.id, sr.id));
    await this.enqueueTick(sr.runId);
  },

  // ─── Mid-run output editing (§5.4) ─────────────────────────────────────────

  /**
   * Computes the transitive downstream set of step ids that depend on the
   * given seed step. BFS over dependsOn edges. Returns step ids in
   * topological order (closest first).
   */
  computeDownstreamSet(def: WorkflowDefinition, seedStepId: string): string[] {
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
          sideEffectType: WorkflowStep['sideEffectType'];
          previousOutput: unknown;
        }>;
        totalEstimatedCostCents: number;
        cascade: { size: number; criticalPathLength: number };
      }
  > {
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.organisationId, organisationId)));
    if (!run) throw { statusCode: 404, message: 'Workflow run not found' };

    const [seedStep] = await db
      .select()
      .from(workflowStepRuns)
      .where(and(eq(workflowStepRuns.id, stepRunId), eq(workflowStepRuns.runId, runId)));
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
        errorCode: 'workflow_stale_version',
      };
    }

    const def = await loadDefinitionForRun(run);
    if (!def) throw { statusCode: 422, message: 'Run definition not loadable' };

    // Output-hash firewall — no-op if the new output is byte-identical to
    // the previous one. This is the cheapest possible exit path.
    const newHash = hashValue(options.output);
    if (newHash === seedStep.outputHash) {
      logger.info('workflow_mid_run_edit_noop_firewall', {
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
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.runId, runId));
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
      sideEffectType: WorkflowStep['sideEffectType'];
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
      logger.info('workflow_mid_run_edit_blocked', {
        event: 'mid_run_edit.blocked',
        runId,
        stepRunId,
        affectedCount: affected.length,
      });
      return {
        ok: false,
        statusCode: 409,
        error: 'workflow_irreversible_blocked',
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
        .update(workflowStepRuns)
        .set({
          outputJson: options.output as Record<string, unknown>,
          outputHash: newHash,
          version: seedStep.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, seedStep.id));

      // For each downstream live row: invalidate + insert successor.
      for (const row of downstreamLive) {
        const stepDef = findStepInDefinition(def, row.stepId);
        if (!stepDef) continue;

        // Mark current row invalidated.
        await tx
          .update(workflowStepRuns)
          .set({
            status: 'invalidated',
            version: row.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(workflowStepRuns.id, row.id));
        invalidatedStepIds.push(row.stepId);

        if (options.skipAndReuse?.includes(row.stepId)) {
          // Copy the previous output forward as a new completed attempt.
          await tx.insert(workflowStepRuns).values({
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
          await tx.insert(workflowStepRuns).values({
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
        .from(workflowStepRuns)
        .where(
          and(
            eq(workflowStepRuns.runId, runId),
            eq(workflowStepRuns.status, 'completed')
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
        .update(workflowRuns)
        .set({
          contextJson: nextCtx as unknown as Record<string, unknown>,
          contextSizeBytes: nextBytes,
          updatedAt: new Date(),
        })
        .where(eq(workflowRuns.id, runId));
    });

    logger.info('workflow_mid_run_edit_applied', {
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
  async handleBulkFanOut(run: WorkflowRun, _def: WorkflowDefinition): Promise<boolean> {
    const ctx = run.contextJson as Record<string, unknown>;
    const bulkTargets = ctx.bulkTargets as string[] | undefined;
    if (!bulkTargets || !Array.isArray(bulkTargets) || bulkTargets.length === 0) {
      logger.warn('workflow_bulk_no_targets', { runId: run.id });
      return false;
    }

    // Check if children already exist (idempotency via unique index)
    const existingChildren = await db
      .select({ id: workflowRuns.id, targetSubaccountId: workflowRuns.targetSubaccountId })
      .from(workflowRuns)
      .where(eq(workflowRuns.parentRunId, run.id));

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
      logger.warn('workflow_bulk_invalid_targets', {
        runId: run.id,
        invalidTargets,
        orgId: run.organisationId,
      });
    }

    // Mark parent as running
    if (run.status === 'pending') {
      await db
        .update(workflowRuns)
        .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
        .where(eq(workflowRuns.id, run.id));
    }

    // Sprint 4 P3.2: respect org-level GHL concurrency cap for bulk dispatch.
    const [org] = await db
      .select({ ghlConcurrencyCap: organisations.ghlConcurrencyCap })
      .from(organisations)
      .where(eq(organisations.id, run.organisationId));
    const concurrencyCap = org?.ghlConcurrencyCap ?? MAX_PARALLEL_STEPS_DEFAULT;

    // Count non-terminal children to enforce concurrency cap
    const childStatuses = await db
      .select({ id: workflowRuns.id, status: workflowRuns.status })
      .from(workflowRuns)
      .where(eq(workflowRuns.parentRunId, run.id));
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
        const childTask = await taskService.createTask(run.organisationId, targetId, {
          title: `Workflow run`,
          status: 'inbox',
        }, run.startedByUserId ?? undefined);
        const childRun = await insertRunRowWithUniqueGuard(
          db,
          {
            organisationId: run.organisationId,
            subaccountId: targetId,
            templateVersionId: run.templateVersionId,
            runMode: 'auto',
            status: 'pending',
            contextJson: ctx,
            parentRunId: run.id,
            targetSubaccountId: targetId,
            startedByUserId: run.startedByUserId,
            taskId: childTask.id,
          },
          childTask.id,
        );

        if (childRun) {
          // Create step runs for the child
          const def = await loadDefinitionForRun(childRun);
          if (def) {
            await createStepRunsForNewRun(childRun.id, def);
          }
          await this.enqueueTick(childRun.id);
        }

        created++;
        logger.info('workflow_bulk_child_created', {
          event: 'bulk.child_created',
          parentRunId: run.id,
          childRunId: childRun?.id,
          targetSubaccountId: targetId,
        });
      } catch (err: unknown) {
        // Unique constraint violation → already created (race condition)
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('workflow_runs_bulk_child_unique_idx')) {
          logger.debug('workflow_bulk_child_already_exists', {
            parentRunId: run.id,
            targetSubaccountId: targetId,
          });
        } else {
          throw err;
        }
      }
    }

    if (!shouldSuppressWebSocket(run.runMode)) {
      emitWorkflowRunUpdate(run.id, 'Workflow:run:bulk_fanout', {
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
  async checkBulkParentCompletion(run: WorkflowRun): Promise<void> {
    const children = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.parentRunId, run.id));

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
    const bulkCompletedAt = new Date();

    await db
      .update(workflowRuns)
      .set({
        status: parentStatus as WorkflowRun['status'],
        contextJson: { ...existingContext, bulkResults } as Record<string, unknown>,
        completedAt: bulkCompletedAt,
        updatedAt: bulkCompletedAt,
      })
      .where(eq(workflowRuns.id, run.id));

    // §10.3 — onboarding-state bookkeeping for the bulk-parent terminal.
    await upsertSubaccountOnboardingState({
      runId: run.id,
      organisationId: run.organisationId,
      // Helper accepts string | null; skip onboarding state for org-scope.
      subaccountId: run.subaccountId,
      workflowSlug: run.workflowSlug,
      isOnboardingRun: run.isOnboardingRun,
      runStatus: parentStatus as WorkflowRun['status'],
      startedAt: run.startedAt,
      completedAt: bulkCompletedAt,
    });

    logger.info('workflow_bulk_parent_completed', {
      event: 'bulk.parent_completed',
      runId: run.id,
      status: parentStatus,
      totalChildren: children.length,
      completedChildren: children.filter((c) => c.status === 'completed').length,
      failedChildren: children.filter((c) => c.status === 'failed').length,
    });

    if (!shouldSuppressWebSocket(run.runMode)) {
      emitWorkflowRunUpdate(run.id, 'Workflow:run:status', {
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
    run: WorkflowRun,
    sr: WorkflowStepRun,
    _step: WorkflowStep
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
      .from(workflowStepRuns)
      .where(
        and(
          eq(workflowStepRuns.runId, sourceRunId),
          eq(workflowStepRuns.stepId, sr.stepId),
          eq(workflowStepRuns.status, 'completed')
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
      .from(workflowRuns)
      .where(
        and(eq(workflowRuns.id, sourceRunId), eq(workflowRuns.organisationId, organisationId))
      );
    if (!source) throw { statusCode: 404, message: 'Source Workflow run not found' };

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

    // Replay creates a new task linked to the replayed run.
    const replayTask = await taskService.createTask(
      organisationId,
      source.subaccountId ?? organisationId,
      { title: `Workflow run`, status: 'inbox' },
      userId,
    );

    let runId!: string;
    await db.transaction(async (tx) => {
      const created = await insertRunRowWithUniqueGuard(
        tx as unknown as typeof db,
        {
          organisationId,
          subaccountId: source.subaccountId,
          // Carry forward the scope so org-scope replays don't violate the
          // workflow_runs_scope_subaccount_consistency_chk CHECK constraint
          // (migration 0171 — scope='org' requires subaccountId=null).
          scope: source.scope,
          templateVersionId: source.templateVersionId,
          status: 'pending',
          contextJson: replayContext as unknown as Record<string, unknown>,
          contextSizeBytes: Buffer.byteLength(JSON.stringify(replayContext), 'utf8'),
          replayMode: true,
          startedByUserId: userId,
          taskId: replayTask.id,
          startedAt,
        },
        replayTask.id,
      );
      runId = created.id;
      // Patch runId into _meta
      await tx.execute(
        sql`UPDATE workflow_runs SET context_json = jsonb_set(context_json, '{_meta,runId}', to_jsonb(${runId}::text), true) WHERE id = ${runId}`
      );
      // Insert entry-step rows
      const entries = def.steps.filter((s) => s.dependsOn.length === 0);
      for (const step of entries) {
        await tx.insert(workflowStepRuns).values({
          runId,
          stepId: step.id,
          stepType: step.type,
          status: 'pending',
          sideEffectType: step.sideEffectType,
          dependsOn: step.dependsOn,
        });
      }
      await tx.execute(
        sql`INSERT INTO workflow_run_event_sequences (run_id, last_sequence) VALUES (${runId}, 0) ON CONFLICT DO NOTHING`
      );
    });

    logger.info('workflow_replay_run_started', {
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
    def: WorkflowDefinition,
    downstreamLive: WorkflowStepRun[]
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
  computeCriticalPath(def: WorkflowDefinition, stepIds: string[]): number {
    const subset = new Set(stepIds);
    const stepById = new Map<string, WorkflowStep>();
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
    sr: WorkflowStepRun,
    output: unknown,
    outputHash: string,
    via: string
  ): Promise<void> {
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, sr.runId));
    if (!run) return;

    const ctx = run.contextJson as unknown as RunContext;
    const nextCtx = mergeStepOutputIntoContext(ctx, sr.stepId, output);
    const nextBytes = Buffer.byteLength(JSON.stringify(nextCtx), 'utf8');

    try {
      assertContextSize(nextBytes, run.id);
    } catch (err) {
      logger.error('workflow_context_overflow', { runId: run.id, bytes: nextBytes });
      const failedAt = new Date();
      assertValidTransition({
        kind: 'workflow_run',
        recordId: run.id,
        from: run.status,
        to: 'failed',
      });
      await db
        .update(workflowRuns)
        .set({
          status: 'failed',
          error: 'context_overflow',
          failedDueToStepId: sr.stepId,
          completedAt: failedAt,
          updatedAt: failedAt,
        })
        .where(eq(workflowRuns.id, run.id));
      // §10.3 — onboarding-state bookkeeping for the terminal fail.
      await upsertSubaccountOnboardingState({
        runId: run.id,
        organisationId: run.organisationId,
        // Helper accepts string | null; skip onboarding state for org-scope.
        subaccountId: run.subaccountId,
        workflowSlug: run.workflowSlug,
        isOnboardingRun: run.isOnboardingRun,
        runStatus: 'failed',
        startedAt: run.startedAt,
        completedAt: failedAt,
      });
      emitOrgUpdate(run.organisationId, 'dashboard.activity.updated', {
        source: 'workflow_run',
        runId: run.id,
        status: 'failed',
      });
      return;
    }

    assertValidTransition({
      kind: 'workflow_step_run',
      recordId: sr.id,
      from: sr.status,
      to: 'completed',
    });

    const costDelta = getStepCostEstimate(sr.stepType ?? '');

    await db.transaction(async (tx) => {
      await tx
        .update(workflowStepRuns)
        .set({
          status: 'completed',
          outputJson: output as unknown as Record<string, unknown>,
          outputHash,
          completedAt: new Date(),
          version: sr.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, sr.id));

      await tx
        .update(workflowRuns)
        .set({
          contextJson: nextCtx as unknown as Record<string, unknown>,
          contextSizeBytes: nextBytes,
          updatedAt: new Date(),
        })
        .where(eq(workflowRuns.id, run.id));

      await WorkflowRunCostLedgerService.incrementAccumulator(run.id, costDelta, tx);
    });

    logger.info('workflow_step_completed', {
      event: 'step.completed',
      runId: run.id,
      stepRunId: sr.id,
      stepId: sr.stepId,
      via,
    });

    await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:step:completed', {
      stepRunId: sr.id,
      stepId: sr.stepId,
      output,
      via,
    });

    // §G8 / §7.4 — `user_input` steps with a `referenceBinding` write the
    // bound form field to a Reference note on the sub-account. The binding
    // fires after the step is persisted but before the re-tick, so the
    // Knowledge tab reflects the new note as soon as the step turns green.
    try {
      const def = await loadDefinitionForRun(run);
      if (def) {
        const step = findStepInDefinition(def, sr.stepId);
        if (step?.type === 'user_input' && step.referenceBinding) {
          const outputObj = (output ?? {}) as Record<string, unknown>;
          const fieldValue = outputObj[step.referenceBinding.field];
          if (fieldValue !== undefined && fieldValue !== null && `${fieldValue}`.trim().length > 0) {
            const created = await writeReferenceFromBinding({
              subaccountId: requireSubaccountId(run),
              organisationId: run.organisationId,
              name: step.referenceBinding.name,
              value: String(fieldValue),
            });
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:reference_binding:created', {
              stepRunId: sr.id,
              stepId: sr.stepId,
              referenceId: created.id,
              name: step.referenceBinding.name,
            });
          } else {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:reference_binding:missing_field', {
              stepRunId: sr.id,
              stepId: sr.stepId,
              field: step.referenceBinding.field,
              name: step.referenceBinding.name,
            });
          }
        }
      }
    } catch (err) {
      // Reference binding failures never block step completion.
      logger.error('workflow_reference_binding_error', {
        runId: run.id,
        stepRunId: sr.id,
        stepId: sr.stepId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await this.enqueueTick(run.id);
  },

  /**
   * Completion entry used by the HITL resumption path (§4.7). Accepts the
   * already-loaded step run row to avoid a redundant SELECT at the callsite.
   * Reuses the `invalidated` hard-discard rule from `completeStepRun`.
   */
  async completeStepRunFromReview(
    sr: WorkflowStepRun,
    output: unknown,
    via: string,
    _decidedByUserId?: string,
  ): Promise<void> {
    if (sr.status === 'invalidated') {
      logger.warn('workflow_step_result_discarded_invalidated', {
        event: 'step.result_discarded_invalidated',
        runId: sr.runId,
        stepRunId: sr.id,
        stepId: sr.stepId,
      });
      return;
    }
    const outputHash = hashValue(output);
    await this.completeStepRunInternal(sr, output, outputHash, via);
  },

  /** Public completion entry — used by run service. */
  async completeStepRun(
    stepRunId: string,
    args: { output: unknown; via: string; decidedByUserId?: string }
  ): Promise<void> {
    const [sr] = await db
      .select()
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.id, stepRunId));
    if (!sr) return;
    if (sr.status === 'invalidated') {
      // Spec §5.4 hard discard rule — late-arriving completion on an
      // invalidated row is dropped, never merged.
      logger.warn('workflow_step_result_discarded_invalidated', {
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
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.id, stepRunId));
    if (!sr) return;
    assertValidTransition({
      kind: 'workflow_step_run',
      recordId: sr.id,
      from: sr.status,
      to: 'failed',
    });
    await db
      .update(workflowStepRuns)
      .set({
        status: 'failed',
        error: reason,
        completedAt: new Date(),
        version: sr.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(workflowStepRuns.id, stepRunId));
    logger.info('workflow_step_failed', {
      event: 'step.failed',
      runId: sr.runId,
      stepRunId,
      stepId: sr.stepId,
      reason,
    });

    // Look up subaccountId for the WS room
    const [parentRun] = await db.select({ subaccountId: workflowRuns.subaccountId }).from(workflowRuns).where(eq(workflowRuns.id, sr.runId));
    if (parentRun) {
      await emitWorkflowEvent(sr.runId, parentRun.subaccountId, 'Workflow:step:failed', {
        stepRunId,
        stepId: sr.stepId,
        reason,
      });
    }

    await this.enqueueTick(sr.runId);
  },

  /**
   * Hook called by the agent run completion path. The caller (WorkflowAgentRunHook)
   * passes the `stepRunId` from `agentRuns.WorkflowStepRunId` directly — this avoids
   * the broken reverse-lookup pattern (workflowStepRuns.agentRunId is never written).
   *
   * Routes:
   *   - agent_decision steps → handleDecisionStepCompletion (parse + skip-set)
   *   - all other types     → completeStepRun / failStepRun
   */
  async onAgentRunCompleted(
    stepRunId: string,
    result: { ok: boolean; output?: unknown; error?: string },
    agentRunId: string
  ): Promise<void> {
    const [sr] = await db
      .select()
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.id, stepRunId));
    if (!sr) return;
    if (sr.status === 'invalidated') {
      logger.warn('workflow_step_result_discarded_invalidated', {
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
    sr: WorkflowStepRun,
    result: { ok: boolean; output?: unknown; error?: string },
    agentRunId: string
  ): Promise<void> {
    // 1. Load run + definition + step.
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, sr.runId));
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

    // 3. Parse agent output. Coerce to string — agent run output may be an
    //    already-parsed object depending on how the completion hook serialises it.
    const rawOutput =
      typeof result.output === 'string'
        ? result.output
        : JSON.stringify(result.output ?? '');
    const parseResult = parseDecisionOutput(rawOutput, decisionStep);
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

        // rawOutput was already coerced to string at parse time — reuse it.
        const truncatedRaw = rawOutput.slice(0, DECISION_RETRY_RAW_OUTPUT_TRUNCATE_CHARS);

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
          .update(workflowStepRuns)
          .set({
            inputJson: { ...inputJson, retryCount: retryCount + 1 } as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          })
          .where(eq(workflowStepRuns.id, sr.id));

        const idempotencyKey = `Workflow:${run.id}:${step.id}:${sr.attempt}:retry${retryCount + 1}`;
        const pgboss = (await getPgBoss()) as unknown as {
          send: (name: string, data: object, options?: Record<string, unknown>) => Promise<string | null>;
        };
        await pgboss.send(
          AGENT_STEP_QUEUE,
          {
            WorkflowStepRunId: sr.id,
            WorkflowRunId: run.id,
            organisationId: run.organisationId,
            subaccountId: requireSubaccountId(run),
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
              source: 'Workflow',
              WorkflowRunId: run.id,
              WorkflowStepRunId: sr.id,
              stepId: step.id,
              attempt: sr.attempt,
              agentInputs: resolvedAgentInputs,
              isDecisionRun: true,
              retryCount: retryCount + 1,
            },
          },
          {
            ...getJobConfig('workflow-agent-step'),
            singletonKey: idempotencyKey,
            useSingletonQueue: true,
          }
        );

        logger.info('workflow_decision_step_retrying', {
          event: 'decision.retry',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
          retryCount: retryCount + 1,
          parseErrorCode: parseResult.error.code,
        });
        return;
      }

      // Max retries exceeded — fall back to defaultBranchId if set, else fail.
      if (decisionStep.defaultBranchId) {
        logger.info('workflow_decision_step_default_branch_fallback', {
          event: 'decision.default_branch_fallback',
          runId: run.id,
          stepRunId: sr.id,
          stepId: step.id,
          defaultBranchId: decisionStep.defaultBranchId,
          retryCount,
          parseErrorCode: parseResult.error.code,
        });

        const ctx = run.contextJson as unknown as RunContext;
        const skipSet = computeSkipSet(def, step.id, decisionStep.defaultBranchId);
        const stepOutput: Record<string, unknown> = {
          chosenBranchId: decisionStep.defaultBranchId,
          rationale: `default_branch_fallback: parse failed after ${retryCount} retries`,
          skippedStepIds: [...skipSet],
          retryCount,
          chosenByAgent: false,
        };
        const nextCtx = mergeStepOutputIntoContext(ctx, step.id, stepOutput);
        const nextBytes = Buffer.byteLength(JSON.stringify(nextCtx), 'utf8');
        try {
          assertContextSize(nextBytes, run.id);
        } catch {
          const failedAt = new Date();
          await db
            .update(workflowRuns)
            .set({
              status: 'failed',
              error: 'context_overflow',
              failedDueToStepId: step.id,
              completedAt: failedAt,
              updatedAt: failedAt,
            })
            .where(eq(workflowRuns.id, run.id));
          // §10.3 — onboarding-state bookkeeping for the terminal fail.
          await upsertSubaccountOnboardingState({
            runId: run.id,
            organisationId: run.organisationId,
            // Helper accepts string | null; skip onboarding state for org-scope.
            subaccountId: run.subaccountId,
            workflowSlug: run.workflowSlug,
            isOnboardingRun: run.isOnboardingRun,
            runStatus: 'failed',
            startedAt: run.startedAt,
            completedAt: failedAt,
          });
          emitOrgUpdate(run.organisationId, 'dashboard.activity.updated', {
            source: 'workflow_run',
            runId: run.id,
            status: 'failed',
          });
          return;
        }
        const outputHash = hashValue(stepOutput);
        await db.transaction(async (tx) => {
          await tx
            .update(workflowStepRuns)
            .set({
              status: 'completed',
              outputJson: stepOutput as unknown as Record<string, unknown>,
              outputHash,
              completedAt: new Date(),
              version: sr.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(workflowStepRuns.id, sr.id));
          for (const skippedStepId of skipSet) {
            const skippedStepDef = findStepInDefinition(def, skippedStepId);
            if (!skippedStepDef) continue;
            try {
              await tx.insert(workflowStepRuns).values({
                runId: run.id,
                stepId: skippedStepId,
                stepType: skippedStepDef.type,
                status: 'skipped',
                sideEffectType: skippedStepDef.sideEffectType,
                dependsOn: skippedStepDef.dependsOn,
                completedAt: new Date(),
              });
            } catch {
              await tx
                .update(workflowStepRuns)
                .set({ status: 'skipped', completedAt: new Date(), updatedAt: new Date() })
                .where(
                  and(
                    eq(workflowStepRuns.runId, run.id),
                    eq(workflowStepRuns.stepId, skippedStepId)
                  )
                );
            }
          }
          await tx
            .update(workflowRuns)
            .set({
              contextJson: nextCtx as unknown as Record<string, unknown>,
              contextSizeBytes: nextBytes,
              updatedAt: new Date(),
            })
            .where(eq(workflowRuns.id, run.id));
        });

        await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:decision:default_branch_applied', {
          stepRunId: sr.id,
          stepId: step.id,
          chosenBranchId: decisionStep.defaultBranchId,
          skippedStepIds: [...skipSet],
        });

        await this.enqueueTick(run.id);
        return;
      }

      await this.failStepRunInternal(
        sr,
        `decision_parse_failure: ${parseResult.error.code}: ${parseResult.error.message}`
      );
      return;
    }

    // 4. Parse succeeded — apply the decision.
    const { chosenBranchId, rationale, confidence } = parseResult.output;

    // 4a. minConfidence HITL escalation (spec §7).
    // When the agent reports a confidence value below the step's threshold,
    // escalate to a human reviewer instead of applying the skip set automatically.
    if (
      decisionStep.minConfidence !== undefined &&
      confidence !== undefined &&
      confidence < decisionStep.minConfidence
    ) {
      // Store the tentative decision in the step run's inputJson so the reviewer
      // can inspect it. The step stays in awaiting_approval; when approved the
      // caller will re-invoke with the same output or an override.
      await db
        .update(workflowStepRuns)
        .set({
          inputJson: {
            ...(inputJson ?? {}),
            tentativeDecision: { chosenBranchId, rationale, confidence },
          } as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, sr.id));

      await WorkflowStepReviewService.requireApproval(sr, {
        reviewKind: 'decision_confidence_escalation',
        organisationId: run.organisationId,
        // B1 fix (spec §6.3): forward step + run context.
        stepDefinition: {
          id: step.id,
          type: step.type,
          name: step.name,
          params: step.params as Record<string, unknown> | undefined,
          isCritical: step.params?.is_critical === true,
          sideEffectClass: typeof step.params?.side_effect_class === 'string'
            ? step.params.side_effect_class
            : undefined,
        },
        templateVersionId: run.templateVersionId,
        subaccountId: run.subaccountId,
        // Decision-step rationale supplied as agentReasoning so it lands
        // in seen_payload at gate-open.
        agentReasoning: typeof rationale === 'string' ? rationale : null,
        upstreamConfidence: typeof confidence === 'number'
          ? (confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low')
          : null,
      });

      logger.info('workflow_decision_low_confidence_escalated', {
        event: 'decision.low_confidence_escalation',
        runId: run.id,
        stepRunId: sr.id,
        stepId: step.id,
        chosenBranchId,
        confidence,
        minConfidence: decisionStep.minConfidence,
        agentRunId,
      });

      await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:decision:low_confidence', {
        stepRunId: sr.id,
        stepId: step.id,
        chosenBranchId,
        confidence,
        minConfidence: decisionStep.minConfidence,
      });
      return;
    }

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
      const failedAt = new Date();
      await db
        .update(workflowRuns)
        .set({
          status: 'failed',
          error: 'context_overflow',
          failedDueToStepId: step.id,
          completedAt: failedAt,
          updatedAt: failedAt,
        })
        .where(eq(workflowRuns.id, run.id));
      // §10.3 — onboarding-state bookkeeping for the terminal fail.
      await upsertSubaccountOnboardingState({
        runId: run.id,
        organisationId: run.organisationId,
        // Helper accepts string | null; skip onboarding state for org-scope.
        subaccountId: run.subaccountId,
        workflowSlug: run.workflowSlug,
        isOnboardingRun: run.isOnboardingRun,
        runStatus: 'failed',
        startedAt: run.startedAt,
        completedAt: failedAt,
      });
      emitOrgUpdate(run.organisationId, 'dashboard.activity.updated', {
        source: 'workflow_run',
        runId: run.id,
        status: 'failed',
      });
      return;
    }

    const outputHash = hashValue(stepOutput);

    // Single transaction: complete the decision step + create skipped rows + update context.
    await db.transaction(async (tx) => {
      // Mark decision step completed.
      await tx
        .update(workflowStepRuns)
        .set({
          status: 'completed',
          outputJson: stepOutput as unknown as Record<string, unknown>,
          outputHash,
          completedAt: new Date(),
          version: sr.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, sr.id));

      // Create skipped rows for each step in the skip set.
      // If a row already exists (e.g. from a concurrent tick), mark it skipped.
      for (const skippedStepId of skipSet) {
        const skippedStepDef = findStepInDefinition(def, skippedStepId);
        if (!skippedStepDef) continue;
        try {
          await tx.insert(workflowStepRuns).values({
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
            .update(workflowStepRuns)
            .set({ status: 'skipped', completedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(workflowStepRuns.runId, run.id),
                eq(workflowStepRuns.stepId, skippedStepId)
              )
            );
        }
      }

      // Update run context.
      await tx
        .update(workflowRuns)
        .set({
          contextJson: nextCtx as unknown as Record<string, unknown>,
          contextSizeBytes: nextBytes,
          updatedAt: new Date(),
        })
        .where(eq(workflowRuns.id, run.id));
    });

    logger.info('workflow_decision_step_completed', {
      event: 'decision.completed',
      runId: run.id,
      stepRunId: sr.id,
      stepId: step.id,
      chosenBranchId,
      skippedCount: skipSet.size,
      retryCount,
    });

    await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:decision:completed', {
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
      .from(workflowRuns)
      .where(
        inArray(workflowRuns.status, [
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
        .from(workflowStepRuns)
        .where(
          and(
            eq(workflowStepRuns.runId, run.id),
            eq(workflowStepRuns.status, 'running'),
            lt(workflowStepRuns.startedAt, cutoff)
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
      logger.info('workflow_watchdog_recovered', { event: 'watchdog.recovered', count: recovered });
    }
  },

  /**
   * Registers the tick + watchdog workers with pg-boss. Called once at
   * server startup from agentScheduleService.initialize() (or directly
   * from server/index.ts in step 6).
   */
  async registerWorkers(): Promise<void> {
    const pgboss = await getPgBoss();

    await createWorker<{ runId: string }>({
      queue: TICK_QUEUE,
      boss: pgboss,
      concurrency: 4,
      resolveOrgContext: () => null,  // tick reads org from workflow_runs row
      handler: async (job) => {
        const data = job.data as { runId: string };
        await this.tick(data.runId);
      },
    });

    await createWorker<Record<string, never>>({
      queue: WATCHDOG_QUEUE,
      boss: pgboss,
      concurrency: 1,
      resolveOrgContext: () => null,  // cross-org sweep, no single tenant
      handler: async () => {
        await this.watchdogSweep();
      },
    });

    // Workflow-agent-step worker — runs the actual agent for prompt /
    // agent_call step types. Dynamic-imported to avoid pulling
    // agentExecutionService into the engine module's eager graph.
    await createWorker<{
      WorkflowStepRunId: string;
      WorkflowRunId: string;
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
    }>({
      queue: AGENT_STEP_QUEUE,
      boss: pgboss,
      concurrency: 4,
      // payload carries organisationId — default resolver applies
      handler: async (job) => {
        const data = job.data;

        // Re-verify the step run is still live before doing anything.
        // If it was invalidated between enqueue and worker pickup, drop.
        const [sr] = await db
          .select()
          .from(workflowStepRuns)
          .where(eq(workflowStepRuns.id, data.WorkflowStepRunId));
        if (!sr || sr.status === 'invalidated' || sr.status === 'completed') {
          logger.info('workflow_agent_step_skipped_stale', {
            stepRunId: data.WorkflowStepRunId,
            currentStatus: sr?.status,
          });
          return;
        }

        try {
          // Look up subaccountAgent linking row — required post-migration 0106.
          // All runs must have a subaccountAgentId; if the agent is not linked,
          // fail the step immediately rather than letting executeRun throw before
          // creating a run record (which would break the Workflow completion hook).
          const [saLink] = await db
            .select()
            .from(subaccountAgents)
            .where(
              and(
                eq(subaccountAgents.agentId, data.agentId),
                eq(subaccountAgents.subaccountId, data.subaccountId)
              )
            );

          if (!saLink) {
            logger.error('workflow_agent_step_agent_not_linked', {
              stepRunId: data.WorkflowStepRunId,
              stepId: data.stepId,
              agentId: data.agentId,
              subaccountId: data.subaccountId,
            });
            await this.failStepRun(
              data.WorkflowStepRunId,
              `agent_not_linked_to_subaccount: agentId=${data.agentId} subaccountId=${data.subaccountId}`,
            );
            return;
          }

          // Include retryCount in the idempotency key so decision retries get a
          // fresh agent run rather than deduplicating against the failed original.
          const retryCountForKey = (data.triggerContext?.retryCount as number) ?? 0;
          const idempotencyKey =
            retryCountForKey > 0
              ? `Workflow:${data.WorkflowRunId}:${data.stepId}:${data.attempt}:retry${retryCountForKey}`
              : `Workflow:${data.WorkflowRunId}:${data.stepId}:${data.attempt}`;
          // Use caller-supplied triggerContext when present (decision retries carry
          // extra fields like retryCount). Fall back to constructing it fresh.
          const triggerContext: Record<string, unknown> = data.triggerContext ?? {
            source: 'Workflow',
            WorkflowRunId: data.WorkflowRunId,
            WorkflowStepRunId: data.WorkflowStepRunId,
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
            subaccountAgentId: saLink.id,
            organisationId: data.organisationId,
            executionScope: 'subaccount',
            runType: 'triggered',
            runSource: 'system',
            executionMode: 'api',
            idempotencyKey,
            triggerContext,
            workflowStepRunId: data.WorkflowStepRunId,
            // Decision-step constraints: pass through when present so the
            // execution service enforces the envelope + tool restriction.
            ...(data.systemPromptAddendum !== undefined && {
              systemPromptAddendum: data.systemPromptAddendum,
            }),
            ...(data.allowedToolSlugs !== undefined && {
              allowedToolSlugs: data.allowedToolSlugs,
            }),
          });
          // executeRun is synchronous (awaits the agent loop). The hook in
          // WorkflowAgentRunHook fires from the success/failure paths in
          // agentExecutionService and routes back to the engine.
          //
          // IEE Phase 0 caveat: if the step is ever routed through an IEE
          // execution mode (iee_browser / iee_dev), executeRun returns
          // immediately with status='delegated' and the hook does NOT fire
          // — the finalisation service intentionally skips Workflow
          // notification for delegated runs. Current Workflow dispatches
          // always use mode='api', so this is not live; update this path
          // alongside the step config if IEE modes are ever enabled here.
        } catch (err) {
          logger.error('workflow_agent_step_dispatch_failed', {
            stepRunId: data.WorkflowStepRunId,
            stepId: data.stepId,
            error: err instanceof Error ? err.message : String(err),
          });
          // The §5.5 hard runtime guard: irreversible steps never retry.
          // For other types, the queue retryLimit handles transient failure.
          if (data.sideEffectType === 'irreversible') {
            await this.failStepRun(
              data.WorkflowStepRunId,
              'transient_error_no_retry: ' +
                (err instanceof Error ? err.message : String(err))
            );
            return;
          }
          throw err; // bubble for queue retry
        }
      },
    });

    // Cron schedule the watchdog every minute.
    try {
      await pgboss.schedule(WATCHDOG_QUEUE, '* * * * *', {}, getJobConfig('workflow-watchdog'));
    } catch (err) {
      logger.warn('workflow_watchdog_schedule_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('workflow_engine_workers_registered');
  },
};
