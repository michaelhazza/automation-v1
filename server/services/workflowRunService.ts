/**
 * WorkflowRunService — run lifecycle: start, query, cancel, submit input,
 * edit output, decide approval.
 *
 * Spec: tasks/Workflows-spec.md §5.0 (start-of-run flow) and §6.2.
 *
 * Public API of the run lifecycle. The actual tick/dispatch loop lives in
 * WorkflowEngineService — this service is the front door for routes and
 * external callers, and delegates to the engine for any state advance.
 */

import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  workflowRuns,
  workflowStepRuns,
  workflowStepGates,
  workflowStepReviews,
  workflowTemplateVersions,
  workflowTemplates,
  systemWorkflowTemplates,
  systemWorkflowTemplateVersions,
  organisations,
  subaccounts,
  agents,
  systemAgents,
} from '../db/schema/index.js';
import type {
  WorkflowRun,
  WorkflowStepRun,
  WorkflowRunStatus,
} from '../db/schema/index.js';
import type { WorkflowDefinition, WorkflowStep, RunContext } from '../lib/workflow/types.js';
import { logger } from '../lib/logger.js';
import { WorkflowEngineService } from './workflowEngineService.js';
import { resolveApprovalDispatchAction, type ApprovalDecision } from './resolveApprovalDispatchActionPure.js';
import { WorkflowTemplateService } from './workflowTemplateService.js';
import { WorkflowScheduleDispatchService } from './workflowScheduleDispatchService.js';
import { upsertSubaccountOnboardingState } from '../lib/workflow/onboardingStateHelpers.js';
import { WorkflowApproverPoolService } from './workflowApproverPoolService.js';
import { WorkflowStepGateService } from './workflowStepGateService.js';
import { WorkflowRunPauseStopService } from './workflowRunPauseStopService.js';
import type { PauseReason } from './workflowRunPauseStopServicePure.js';
import { TaskAlreadyHasActiveRunError } from './errors/TaskAlreadyHasActiveRunError.js';

// ─── Definition rehydration ──────────────────────────────────────────────────

/**
 * Loads a stored definition_json back into a WorkflowDefinition shape.
 * The stored shape comes from WorkflowTemplateService.serialiseDefinition()
 * and intentionally drops the Zod schemas (Phase 1 limitation — see note
 * in that file). The engine treats outputSchema as a presence-only check
 * here; full Zod validation runs against the in-process import for system
 * templates that the seeder has loaded.
 */
function rehydrateDefinition(stored: Record<string, unknown>): WorkflowDefinition {
  // Use a permissive cast — the validator already ran at publish/seed time.
  return stored as unknown as WorkflowDefinition;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const WorkflowRunService = {
  /**
   * Resolve a template (system or org) by id, returning the latest published
   * version's definition. Used by startRun().
   */
  async resolveTemplateForRun(input: {
    organisationId: string;
    templateId?: string;
    systemTemplateSlug?: string;
  }): Promise<{
    templateVersionId: string;
    definition: WorkflowDefinition;
    slug: string;
  }> {
    if (input.templateId) {
      // Org template path.
      const template = await WorkflowTemplateService.getOrgTemplate(
        input.organisationId,
        input.templateId
      );
      if (!template) {
        throw { statusCode: 404, message: 'Workflow template not found' };
      }
      const version = await WorkflowTemplateService.getOrgTemplateLatestVersion(template.id);
      if (!version) {
        throw {
          statusCode: 422,
          message: `Workflow template '${template.slug}' has no published version`,
        };
      }
      return {
        templateVersionId: version.id,
        definition: rehydrateDefinition(version.definitionJson as Record<string, unknown>),
        slug: template.slug,
      };
    }

    if (input.systemTemplateSlug) {
      const sys = await WorkflowTemplateService.getSystemTemplate(input.systemTemplateSlug);
      if (!sys) {
        throw { statusCode: 404, message: `System Workflow '${input.systemTemplateSlug}' not found` };
      }
      const sysVer = await WorkflowTemplateService.getSystemTemplateLatestVersion(sys.id);
      if (!sysVer) {
        throw {
          statusCode: 422,
          message: `System Workflow '${input.systemTemplateSlug}' has no published version`,
        };
      }
      return {
        templateVersionId: sysVer.id,
        definition: rehydrateDefinition(sysVer.definitionJson as Record<string, unknown>),
        slug: sys.slug,
      };
    }

    throw { statusCode: 400, message: 'startRun requires templateId or systemTemplateSlug' };
  },

  /**
   * Start a new run. Spec §5.0.
   *
   * 1. Resolve template → latest published version.
   * 2. Validate initialInput against initialInputSchema (deferred — Phase 1
   *    skips Zod re-validation here since the schema lives in the in-process
   *    file. Routes can validate at the API boundary instead.)
   * 3. Insert workflow_runs row with status='pending'.
   * 4. Insert step run rows for every entry step (dependsOn = []).
   * 5. Enqueue first tick via the engine.
   */
  async startRun(input: {
    organisationId: string;
    subaccountId: string;
    templateId?: string;
    systemTemplateSlug?: string;
    initialInput: Record<string, unknown>;
    startedByUserId: string | undefined;
    runMode?: 'auto' | 'supervised' | 'background' | 'bulk';
    bulkTargets?: string[];
    taskId: string;
    /** Mark the run as the onboarding instance for §9.3 Onboarding tab. */
    isOnboardingRun?: boolean;
    /** Mark the run as visible in the sub-account portal (§9.4). Defaults to
     *  `true` when the template declares a `portalPresentation`. */
    isPortalVisible?: boolean;
    /**
     * Spec §5.4: when dispatching from a schedule with a pinned template
     * version, pass the version ID here. The pinned version overrides the
     * latest-published-version resolution. When the pinned version is not
     * found, startRun throws `pinned_version_unavailable` (422).
     */
    pinnedTemplateVersionId?: string | null;
    workflowRunDepth?: number;
  }): Promise<{ runId: string; status: WorkflowRunStatus }> {
    // Verify the subaccount belongs to the org.
    const [sub] = await db
      .select({ id: subaccounts.id, name: subaccounts.name, organisationId: subaccounts.organisationId })
      .from(subaccounts)
      // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT; org membership verified in application code on the following line"
      .where(eq(subaccounts.id, input.subaccountId));
    if (!sub || sub.organisationId !== input.organisationId) {
      throw { statusCode: 404, message: 'Subaccount not found' };
    }

    // Spec §5.4: when a pinned template version is specified (from a schedule),
    // use WorkflowScheduleDispatchService to honour the pin and load the exact
    // version. Otherwise fall through to resolveTemplateForRun (latest published).
    let templateVersionId: string;
    let definition: WorkflowDefinition;
    let slug: string;

    if (input.pinnedTemplateVersionId) {
      const picked = await WorkflowScheduleDispatchService.pickVersionForSchedule({
        organisationId: input.organisationId,
        pinnedTemplateVersionId: input.pinnedTemplateVersionId,
      });
      templateVersionId = picked.templateVersionId;
      definition = rehydrateDefinition(picked.definitionJson);
      slug = picked.slug;
    } else {
      const resolved = await this.resolveTemplateForRun(input);
      templateVersionId = resolved.templateVersionId;
      definition = resolved.definition;
      slug = resolved.slug;
    }

    // Build initial context.
    const startedAt = new Date();
    const [org] = await db
      .select({ id: organisations.id, name: organisations.name })
      .from(organisations)
      .where(eq(organisations.id, input.organisationId));

    // Pre-resolve every agent_call step's agentRef to a concrete id and
    // cache in _meta.resolvedAgents (spec §3.4). The engine re-verifies on
    // each dispatch but the cache short-circuits the lookup in the common case.
    const resolvedAgents: Record<string, string> = {};
    for (const step of definition.steps) {
      if (step.type !== 'agent_call' || !step.agentRef) continue;
      const key = `${step.agentRef.kind}:${step.agentRef.slug}`;
      if (resolvedAgents[key]) continue;
      if (step.agentRef.kind === 'system') {
        const [row] = await db
          .select({ id: systemAgents.id })
          .from(systemAgents)
          .where(eq(systemAgents.slug, step.agentRef.slug));
        if (row) resolvedAgents[key] = row.id;
      } else if (step.agentRef.kind === 'org') {
        const [row] = await db
          .select({ id: agents.id })
          .from(agents)
          .where(
            and(
              eq(agents.slug, step.agentRef.slug),
              eq(agents.organisationId, input.organisationId)
            )
          );
        if (row) resolvedAgents[key] = row.id;
      }
    }

    const initialContext: RunContext = {
      input: input.initialInput,
      subaccount: { id: sub.id, name: sub.name },
      org: { id: org?.id ?? input.organisationId, name: org?.name ?? '' },
      steps: {},
      _meta: {
        runId: '', // back-filled below
        templateVersionId,
        startedAt: startedAt.toISOString(),
        resolvedAgents,
        workflowRunDepth: input.workflowRunDepth,
      },
    };

    // Compute initial context size.
    const contextBytes = Buffer.byteLength(JSON.stringify(initialContext), 'utf8');

    let runId!: string;
    await db.transaction(async (tx) => {
      // Sprint 4 P3.1: merge bulkTargets into context for bulk mode
      const effectiveContext = input.bulkTargets
        ? { ...initialContext, _meta: { ...initialContext._meta }, bulkTargets: input.bulkTargets }
        : { ...initialContext, _meta: { ...initialContext._meta } };

      // Portal visibility defaults: true when the template declares a
      // portalPresentation and the caller didn't explicitly set the flag.
      const portalVisibleDefault = definition.portalPresentation !== undefined;
      const isPortalVisible = input.isPortalVisible ?? portalVisibleDefault;

      let run: typeof workflowRuns.$inferSelect;
      try {
        const [inserted] = await tx
          .insert(workflowRuns)
          .values({
            organisationId: input.organisationId,
            subaccountId: input.subaccountId,
            templateVersionId,
            runMode: input.runMode ?? 'auto',
            status: 'pending',
            contextJson: effectiveContext as unknown as Record<string, unknown>,
            contextSizeBytes: contextBytes,
            startedByUserId: input.startedByUserId,
            taskId: input.taskId,
            startedAt,
            isOnboardingRun: input.isOnboardingRun ?? false,
            isPortalVisible,
            workflowSlug: slug,
          })
          .returning();
        run = inserted;
      } catch (err: unknown) {
        // PostgreSQL SQLSTATE 23505 = unique_violation
        // The partial unique index workflow_runs_one_active_per_task_idx fires
        // when there's already an active run for this task.
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === '23505' &&
          'constraint' in err &&
          (err as { constraint: string }).constraint === 'workflow_runs_one_active_per_task_idx'
        ) {
          throw new TaskAlreadyHasActiveRunError(input.taskId);
        }
        throw err;
      }
      runId = run.id;

      // Patch the runId into context_json's _meta.
      await tx
        .update(workflowRuns)
        .set({
          contextJson: sql`jsonb_set(${workflowRuns.contextJson}, '{_meta,runId}', to_jsonb(${runId}::text), true)`,
        })
        .where(eq(workflowRuns.id, runId));

      // Insert step runs for every entry step.
      const entries = definition.steps.filter((s) => s.dependsOn.length === 0);
      if (entries.length === 0) {
        throw {
          statusCode: 422,
          message: `Workflow has no entry steps`,
          errorCode: 'workflow_dag_invalid',
        };
      }
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

      // Initialise the WS event sequence row.
      await tx.execute(
        sql`INSERT INTO workflow_run_event_sequences (run_id, last_sequence) VALUES (${runId}, 0) ON CONFLICT DO NOTHING`
      );
    });

    logger.info('workflow_run_started', {
      event: 'run.started',
      runId,
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      templateVersionId,
    });

    // §10.3 — mark onboarding runs in_progress the moment they're created.
    if (input.isOnboardingRun === true && slug) {
      await upsertSubaccountOnboardingState({
        runId,
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
        workflowSlug: slug,
        isOnboardingRun: true,
        runStatus: 'pending',
        startedAt,
        completedAt: null,
      });
    }

    // Enqueue the first tick.
    await WorkflowEngineService.enqueueTick(runId);

    return { runId, status: 'pending' };
  },

  /** Get a single run with all of its step runs. */
  async getRun(
    organisationId: string,
    runId: string
  ): Promise<{ run: WorkflowRun; stepRuns: WorkflowStepRun[]; definition: WorkflowDefinition | null }> {
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.organisationId, organisationId)));
    if (!run) throw { statusCode: 404, message: 'Workflow run not found' };

    const stepRunRows = await db
      .select()
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.runId, runId))
      .orderBy(workflowStepRuns.createdAt);

    // Load the locked template version's definition (best-effort — UI can
    // render without it).
    const [version] = await db
      .select()
      .from(workflowTemplateVersions)
      .where(eq(workflowTemplateVersions.id, run.templateVersionId));

    let definition: WorkflowDefinition | null = null;
    if (version) {
      definition = rehydrateDefinition(version.definitionJson as Record<string, unknown>);
    } else {
      // System template version
      const [sysVer] = await db
        .select()
        .from(systemWorkflowTemplateVersions)
        .where(eq(systemWorkflowTemplateVersions.id, run.templateVersionId));
      if (sysVer) {
        definition = rehydrateDefinition(sysVer.definitionJson as Record<string, unknown>);
      }
    }

    return { run, stepRuns: stepRunRows, definition };
  },

  /**
   * Envelope endpoint payload for the run modal (spec §9.2). Single round-trip
   * that returns everything the WorkflowRunPage needs to render: run row,
   * ordered step-run rows, resolved template definition, resolved agent slugs
   * per step, and the (limited) per-step event list. Events are not persisted,
   * so `events` is always empty — the client fills it from the WS stream.
   */
  async getEnvelope(
    organisationId: string,
    subaccountId: string,
    runId: string
  ): Promise<{
    run: WorkflowRun;
    stepRuns: WorkflowStepRun[];
    definition: WorkflowDefinition | null;
    resolvedAgents: Record<string, string>;
    events: Array<unknown>;
  }> {
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.id, runId),
          eq(workflowRuns.organisationId, organisationId),
          eq(workflowRuns.subaccountId, subaccountId),
        ),
      );
    if (!run) throw { statusCode: 404, message: 'Workflow run not found' };

    const stepRunRows = await db
      .select()
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.runId, runId))
      .orderBy(workflowStepRuns.createdAt);

    let definition: WorkflowDefinition | null = null;
    const [version] = await db
      .select()
      .from(workflowTemplateVersions)
      .where(eq(workflowTemplateVersions.id, run.templateVersionId));
    if (version) {
      definition = rehydrateDefinition(version.definitionJson as Record<string, unknown>);
    } else {
      const [sysVer] = await db
        .select()
        .from(systemWorkflowTemplateVersions)
        .where(eq(systemWorkflowTemplateVersions.id, run.templateVersionId));
      if (sysVer) {
        definition = rehydrateDefinition(sysVer.definitionJson as Record<string, unknown>);
      }
    }

    // The run-context `_meta.resolvedAgents` cache is populated at startRun.
    const ctx = run.contextJson as { _meta?: { resolvedAgents?: Record<string, string> } };
    const resolvedAgents = ctx._meta?.resolvedAgents ?? {};

    return { run, stepRuns: stepRunRows, definition, resolvedAgents, events: [] };
  },

  /**
   * Admin toggle for §9.4 portal visibility. Flips the `isPortalVisible`
   * column on the given run. Org + subaccount scoped; 404 on mismatch.
   */
  async setPortalVisibility(
    organisationId: string,
    subaccountId: string,
    runId: string,
    isPortalVisible: boolean,
  ): Promise<WorkflowRun> {
    const [updated] = await db
      .update(workflowRuns)
      .set({ isPortalVisible, updatedAt: new Date() })
      .where(
        and(
          eq(workflowRuns.id, runId),
          eq(workflowRuns.organisationId, organisationId),
          eq(workflowRuns.subaccountId, subaccountId),
        ),
      )
      .returning();
    if (!updated) throw { statusCode: 404, message: 'Workflow run not found' };
    return updated;
  },

  /** List runs for a subaccount. */
  async listRunsForSubaccount(
    organisationId: string,
    subaccountId: string,
    filter?: { status?: WorkflowRunStatus }
  ): Promise<WorkflowRun[]> {
    const whereClauses = [
      eq(workflowRuns.organisationId, organisationId),
      eq(workflowRuns.subaccountId, subaccountId),
    ];
    if (filter?.status) {
      whereClauses.push(eq(workflowRuns.status, filter.status));
    }
    return db
      .select()
      .from(workflowRuns)
      .where(and(...whereClauses))
      .orderBy(desc(workflowRuns.createdAt));
  },

  // ─── Pause / Resume / Stop (pass-throughs to WorkflowRunPauseStopService) ──

  async pauseRun(
    runId: string,
    organisationId: string,
    userId: string,
    reason: PauseReason,
  ): Promise<{ paused: boolean; reason?: string }> {
    return WorkflowRunPauseStopService.pauseRun(runId, organisationId, userId, reason);
  },

  async resumeRun(
    runId: string,
    organisationId: string,
    userId: string,
    opts?: { extendCostCents?: number; extendSeconds?: number },
  ): Promise<{ resumed: boolean; reason?: string; extensionCount?: number }> {
    return WorkflowRunPauseStopService.resumeRun(runId, organisationId, userId, opts);
  },

  async stopRun(
    runId: string,
    organisationId: string,
    userId: string,
  ): Promise<{ stopped: boolean; reason?: string; currentStatus?: string }> {
    return WorkflowRunPauseStopService.stopRun(runId, organisationId, userId);
  },

  /**
   * Cancel a run. Transitions to 'cancelling' first; the engine moves it to
   * 'cancelled' once in-flight steps settle.
   */
  async cancelRun(organisationId: string, runId: string, _userId: string): Promise<void> {
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.organisationId, organisationId)));
    if (!run) throw { statusCode: 404, message: 'Workflow run not found' };
    if (
      run.status === 'completed' ||
      run.status === 'completed_with_errors' ||
      run.status === 'failed' ||
      run.status === 'cancelled'
    ) {
      return; // already terminal — idempotent
    }

    // Orphaned-gate cascade and status update in a single transaction so that
    // a partial failure cannot leave gates resolved while the run retains its
    // old status (or vice-versa).
    await db.transaction(async (tx) => {
      const { resolved } = await WorkflowStepGateService.resolveOpenGatesForRun(runId, organisationId, tx);
      if (resolved > 0) {
        logger.info('workflow_run_gates_cascaded', { runId, resolved, trigger: 'cancelRun' });
      }
      await tx
        .update(workflowRuns)
        .set({ status: 'cancelling', updatedAt: new Date() })
        .where(eq(workflowRuns.id, runId));
    });
    await WorkflowEngineService.enqueueTick(runId);
  },

  /**
   * Mark a run as failed. Cascades orphaned gates before the status update.
   */
  async failRun(
    organisationId: string,
    runId: string,
    reason: string,
    stepId: string | null,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      // Orphaned-gate cascade BEFORE status update (invariant)
      const { resolved } = await WorkflowStepGateService.resolveOpenGatesForRun(runId, organisationId, tx);
      if (resolved > 0) {
        logger.info('workflow_run_gates_cascaded', { runId, resolved, trigger: 'failRun' });
      }
      await tx
        .update(workflowRuns)
        .set({
          status: 'failed',
          error: reason,
          failedDueToStepId: stepId,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.organisationId, organisationId)));
    });
  },

  /**
   * Submit a user_input form payload for a step run. Engine merges into
   * context and re-ticks.
   */
  async submitStepInput(
    organisationId: string,
    runId: string,
    stepRunId: string,
    formData: Record<string, unknown>,
    _userId: string,
    expectedVersion?: number
  ): Promise<void> {
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.organisationId, organisationId)));
    if (!run) throw { statusCode: 404, message: 'Workflow run not found' };

    const [stepRun] = await db
      .select()
      .from(workflowStepRuns)
      .where(and(eq(workflowStepRuns.id, stepRunId), eq(workflowStepRuns.runId, runId)));
    if (!stepRun) throw { statusCode: 404, message: 'Step run not found' };

    const gate = await WorkflowStepGateService.getOpenGate(runId, stepRun.stepId, organisationId);

    if (stepRun.status !== 'awaiting_input') {
      throw {
        statusCode: 409,
        message: `Step is in status '${stepRun.status}', not 'awaiting_input'`,
        errorCode: 'already_submitted',
      };
    }
    if (expectedVersion !== undefined && stepRun.version !== expectedVersion) {
      throw {
        statusCode: 409,
        message: `Step version is ${stepRun.version}, expected ${expectedVersion}`,
        errorCode: 'workflow_stale_version',
      };
    }

    await WorkflowEngineService.completeStepRun(stepRunId, {
      output: formData,
      via: 'user_input',
    });

    if (gate) {
      const resolutionReason = formData['skipped'] === true ? 'skipped' : 'submitted';
      // NOTE: The engine call above runs in its own transaction. A crash between
      // the engine call and this transaction leaves the step terminal with the
      // gate open. The gate will be cleaned up by any subsequent cancelRun/failRun
      // cascade. This is a known V1 atomicity gap that requires engine
      // tx-parameter support to close fully.
      await db.transaction(async (tx) => {
        await WorkflowStepGateService.resolveGate(gate.id, resolutionReason, organisationId, tx);
      });
    }
  },

  /**
   * Mid-run output edit. Pure delegation to the engine which holds the
   * cascade + side-effect safety logic. Spec §5.4 / §7.4 endpoint.
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
  ) {
    return WorkflowEngineService.editStepOutput(
      organisationId,
      runId,
      stepRunId,
      options
    );
  },

  /**
   * Pool-membership guard (spec §18.1 pre-existing violation #1 fix).
   *
   * Finds the open gate for the given (runId, stepId) and throws 403 if the
   * acting user is not in the approverPoolSnapshot. If no gate row exists yet
   * (Chunk 4 creates the write path), returns without throwing for backward
   * compatibility.
   *
   * This method uses `db` with an explicit `organisationId` filter so it is
   * safe in the absence of an active org-scoped transaction (e.g. when called
   * from a route before the service transaction is opened). The RLS context is
   * set by the auth middleware's `withOrgTx` block that wraps the entire
   * request; the `organisationId` filter is an additional application-layer
   * guard consistent with the rest of this service.
   */
  async assertCallerInApproverPool(
    orgId: string,
    runId: string,
    stepRunId: string,
    userId: string
  ): Promise<void> {
    const [stepRun] = await db
      .select({ runId: workflowStepRuns.runId, stepId: workflowStepRuns.stepId })
      .from(workflowStepRuns)
      .where(and(eq(workflowStepRuns.id, stepRunId), eq(workflowStepRuns.runId, runId)));

    if (!stepRun) return; // step run not found — let decideApproval handle the 404

    const [gate] = await db
      .select({
        approverPoolSnapshot: workflowStepGates.approverPoolSnapshot,
      })
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.workflowRunId, stepRun.runId),
          eq(workflowStepGates.stepId, stepRun.stepId),
          eq(workflowStepGates.organisationId, orgId),
          isNull(workflowStepGates.resolvedAt)
        )
      );

    if (!gate) return; // no gate row yet (Chunk 4 creates write path) — allow

    if (gate.approverPoolSnapshot !== null) {
      if (!WorkflowApproverPoolService.userInPool(gate.approverPoolSnapshot, userId)) {
        throw {
          statusCode: 403,
          message: 'You are not in the approver pool for this gate',
          errorCode: 'not_in_approver_pool',
        };
      }
    }
  },

  /**
   * Approve, reject, or edit-and-approve a step that is awaiting_approval.
   */
  async decideApproval(
    organisationId: string,
    runId: string,
    stepRunId: string,
    decision: ApprovalDecision,
    editedOutput: Record<string, unknown> | undefined,
    userId: string,
    expectedVersion?: number,
    decisionReason?: string,
  ): Promise<{ stepRunStatus: 'completed' | 'failed' | 'awaiting_approval'; newVersion: number }> {
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.organisationId, organisationId)));
    if (!run) throw { statusCode: 404, message: 'Workflow run not found' };

    const [stepRun] = await db
      .select()
      .from(workflowStepRuns)
      .where(and(eq(workflowStepRuns.id, stepRunId), eq(workflowStepRuns.runId, runId)));
    if (!stepRun) throw { statusCode: 404, message: 'Step run not found' };
    if (stepRun.status !== 'awaiting_approval') {
      throw {
        statusCode: 409,
        message: `Step is in status '${stepRun.status}', not 'awaiting_approval'`,
      };
    }
    if (expectedVersion !== undefined && stepRun.version !== expectedVersion) {
      throw {
        statusCode: 409,
        message: `Step version is ${stepRun.version}, expected ${expectedVersion}`,
        errorCode: 'workflow_stale_version',
      };
    }

    // Look up the open gate for pool enforcement and decision tracking.
    const gate = await WorkflowStepGateService.getOpenGate(runId, stepRun.stepId, organisationId);

    // Reinforce pool-membership check (route-level assertCallerInApproverPool
    // already ran, but this is a defence-in-depth guard within the service).
    if (gate && gate.approverPoolSnapshot !== null) {
      if (!WorkflowApproverPoolService.userInPool(gate.approverPoolSnapshot, userId)) {
        throw {
          statusCode: 403,
          message: 'You are not in the approver pool for this gate',
          errorCode: 'not_in_approver_pool',
        };
      }
    }

    if (decision === 'rejected') {
      // Synthesised-gate rejection: stall rather than fail. The step remains in
      // awaiting_approval and the stall-and-notify cadence (Chunk 8) handles escalation.
      if (gate?.isCriticalSynthesised) {
        logger.info('workflow_step_review_synthesised_gate_rejected_stalled', {
          stepRunId,
          gateId: gate.id,
        });
        return { stepRunStatus: 'awaiting_approval', newVersion: stepRun.version };
      }

      await WorkflowEngineService.failStepRun(stepRunId, 'approval_rejected', userId);

      if (gate) {
        // NOTE: The engine call above runs in its own transaction. A crash between
        // the engine call and this transaction leaves the step terminal with no
        // review row and the gate open. The gate will be cleaned up by any
        // subsequent cancelRun/failRun cascade. This is a known V1 atomicity gap
        // that requires engine tx-parameter support to close fully.
        await db.transaction(async (tx) => {
          try {
            await tx.insert(workflowStepReviews).values({
              stepRunId: stepRun.id,
              decision: 'rejected',
              decidedByUserId: userId,
              decidedAt: new Date(),
              gateId: gate.id,
              decisionReason: decisionReason ?? null,
            });
          } catch (err: unknown) {
            if ((err as { code?: string })?.code === '23505') {
              // Double-click / duplicate decision — idempotent hit.
              return;
            }
            throw err;
          }
          await WorkflowStepGateService.resolveGate(gate.id, 'rejected', organisationId, tx);
        });
      }

      return { stepRunStatus: 'failed', newVersion: stepRun.version + 1 };
    }

    // Double-click guard for approved/edited decisions: check for existing review row before engine call.
    if (gate) {
      const [existingReview] = await db
        .select({ id: workflowStepReviews.id })
        .from(workflowStepReviews)
        .where(eq(workflowStepReviews.gateId, gate.id));
      if (existingReview) {
        // Duplicate decision — re-load current step run status and return.
        const [latest] = await db
          .select({ status: workflowStepRuns.status, version: workflowStepRuns.version })
          .from(workflowStepRuns)
          .where(eq(workflowStepRuns.id, stepRunId));
        // Return the actual step status from the DB — don't assume completed
        const resolvedStatus = latest?.status ?? 'awaiting_approval';
        return {
          stepRunStatus: resolvedStatus as 'completed' | 'failed' | 'awaiting_approval',
          newVersion: latest?.version ?? stepRun.version,
        };
      }
    }

    const action = resolveApprovalDispatchAction(stepRun, decision);

    // invoke_automation steps must re-dispatch the webhook rather than completing
    // with stored output — route to the dedicated resume path (C4a-REVIEWED-DISP).
    if (action === 'redispatch') {
      const { stepOutcome } = await WorkflowEngineService.resumeInvokeAutomationStep(stepRunId);

      if (gate) {
        // NOTE: The engine call above runs in its own transaction. A crash between
        // the engine call and this transaction leaves the step terminal with no
        // review row and the gate open. The gate will be cleaned up by any
        // subsequent cancelRun/failRun cascade. This is a known V1 atomicity gap
        // that requires engine tx-parameter support to close fully.
        await db.transaction(async (tx) => {
          try {
            await tx.insert(workflowStepReviews).values({
              stepRunId: stepRun.id,
              decision: decision,
              decidedByUserId: userId,
              decidedAt: new Date(),
              gateId: gate.id,
              decisionReason: decisionReason ?? null,
            });
          } catch (err: unknown) {
            if ((err as { code?: string })?.code === '23505') {
              // Duplicate insert — gate already resolved, proceed.
              return;
            }
            throw err;
          }
          await WorkflowStepGateService.resolveGate(gate.id, 'approved', organisationId, tx);
        });
      }

      return { stepRunStatus: stepOutcome, newVersion: stepRun.version + 1 };
    }

    const finalOutput =
      decision === 'edited' && editedOutput
        ? editedOutput
        : (stepRun.outputJson as Record<string, unknown> | null) ?? {};

    await WorkflowEngineService.completeStepRun(stepRunId, {
      output: finalOutput,
      via: 'approval',
      decidedByUserId: userId,
    });

    if (gate) {
      // NOTE: The engine call above runs in its own transaction. A crash between
      // the engine call and this transaction leaves the step terminal with no
      // review row and the gate open. The gate will be cleaned up by any
      // subsequent cancelRun/failRun cascade. This is a known V1 atomicity gap
      // that requires engine tx-parameter support to close fully.
      await db.transaction(async (tx) => {
        try {
          await tx.insert(workflowStepReviews).values({
            stepRunId: stepRun.id,
            decision: decision,
            decidedByUserId: userId,
            decidedAt: new Date(),
            gateId: gate.id,
            decisionReason: decisionReason ?? null,
          });
        } catch (err: unknown) {
          if ((err as { code?: string })?.code === '23505') {
            // Duplicate insert — gate already resolved, proceed.
            return;
          }
          throw err;
        }
        await WorkflowStepGateService.resolveGate(gate.id, 'approved', organisationId, tx);
      });
    }

    return { stepRunStatus: 'completed', newVersion: stepRun.version + 1 };
  },
};
