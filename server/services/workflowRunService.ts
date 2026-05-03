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
import type { OrgScopedTx } from '../db/index.js';
import { WorkflowRunPauseStopService } from './workflowRunPauseStopService.js';
import type { PauseResult, StopResult, ResumeOptions } from './workflowRunPauseStopService.js';
import {
  workflowRuns,
  workflowStepRuns,
  workflowStepReviews,
  workflowStepGates,
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
import type { WorkflowDefinition, RunContext } from '../lib/workflow/types.js';
import { hashValue } from '../lib/workflow/hash.js';
import { logger } from '../lib/logger.js';
import { WorkflowEngineService } from './workflowEngineService.js';
import { resolveApprovalDispatchAction, type ApprovalDecision } from './resolveApprovalDispatchActionPure.js';
import { WorkflowTemplateService } from './workflowTemplateService.js';
import { upsertSubaccountOnboardingState } from '../lib/workflow/onboardingStateHelpers.js';
import { WorkflowStepGateService } from './workflowStepGateService.js';
import { userInPool } from './workflowApproverPoolServicePure.js';

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
    startedByUserId: string;
    runMode?: 'auto' | 'supervised' | 'background' | 'bulk';
    bulkTargets?: string[];
    /** Mark the run as the onboarding instance for §9.3 Onboarding tab. */
    isOnboardingRun?: boolean;
    /** Mark the run as visible in the sub-account portal (§9.4). Defaults to
     *  `true` when the template declares a `portalPresentation`. */
    isPortalVisible?: boolean;
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

    const { templateVersionId, definition, slug } = await this.resolveTemplateForRun(input);

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

      const [run] = await tx
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
          startedAt,
          isOnboardingRun: input.isOnboardingRun ?? false,
          isPortalVisible,
          workflowSlug: slug,
        })
        .returning();
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
    await db.transaction(async (tx) => {
      // Orphaned-gate cascade: resolve all open gates before transitioning run
      const { resolved } = await WorkflowStepGateService.resolveOpenGatesForRun(
        runId,
        'run_terminated',
        organisationId,
        tx
      );
      if (resolved > 0) {
        logger.info('workflow_step_gates_cascade_resolved', {
          event: 'gates.cascade_resolved',
          runId,
          resolved,
          reason: 'run_terminated',
        });
      }
      await tx
        .update(workflowRuns)
        .set({ status: 'cancelling', updatedAt: new Date() })
        .where(eq(workflowRuns.id, runId));
    });
    await WorkflowEngineService.enqueueTick(runId);
  },

  /**
   * Submit a user_input form payload for a step run. Engine merges into
   * context and re-ticks.
   *
   * Wrapped in a single transaction: gate lookup, pool check, optimistic
   * status UPDATE with WHERE status='awaiting_input', and gate resolution
   * all occur atomically.
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

    if (expectedVersion !== undefined && stepRun.version !== expectedVersion) {
      throw {
        statusCode: 409,
        message: `Step version is ${stepRun.version}, expected ${expectedVersion}`,
        errorCode: 'workflow_stale_version',
      };
    }

    // Single transaction: gate lookup, pool check, optimistic step UPDATE,
    // and gate resolution.
    await db.transaction(async (tx) => {
      // Gate lookup inside the transaction.
      const [openGate] = await tx
        .select()
        .from(workflowStepGates)
        .where(
          and(
            eq(workflowStepGates.workflowRunId, runId),
            eq(workflowStepGates.stepId, stepRun.stepId),
            eq(workflowStepGates.organisationId, organisationId),
            isNull(workflowStepGates.resolvedAt)
          )
        );

      if (openGate && !userInPool(openGate.approverPoolSnapshot as string[] | null, _userId)) {
        throw {
          statusCode: 403,
          message: 'Not in approver pool',
          errorCode: 'not_in_approver_pool',
        };
      }

      // Optimistic UPDATE: only succeeds if status is still 'awaiting_input'.
      const updated = await tx
        .update(workflowStepRuns)
        .set({
          status: 'completed',
          outputJson: formData as unknown as Record<string, unknown>,
          completedAt: new Date(),
          version: stepRun.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowStepRuns.id, stepRunId),
            eq(workflowStepRuns.status, 'awaiting_input')
          )
        )
        .returning({ id: workflowStepRuns.id });

      if (updated.length === 0) {
        // Conflict: re-read the current status.
        const [current] = await tx
          .select({ status: workflowStepRuns.status, updatedAt: workflowStepRuns.updatedAt })
          .from(workflowStepRuns)
          .where(eq(workflowStepRuns.id, stepRunId));
        throw {
          statusCode: 409,
          message: 'Already submitted',
          errorCode: 'already_submitted',
          current_status: current?.status ?? 'unknown',
          // Use null rather than the current caller's id — the winning submitter
          // is not tracked on this row (no submittedByUserId column). Spec requires
          // the winning submitter's id here; null is preferable to wrong data.
          submittedBy: null,
          submittedAt: current?.updatedAt?.toISOString() ?? new Date().toISOString(),
        };
      }

      // Resolve the gate if one was open.
      if (openGate) {
        await WorkflowStepGateService.resolveGate(openGate.id, 'submitted', organisationId, tx);
      }
    });

    // Engine re-tick outside the transaction (consistent with other paths).
    await WorkflowEngineService.enqueueTick(runId);
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

  /** Pass-through to WorkflowRunPauseStopService.pauseRun. */
  async pauseRun(
    runId: string,
    organisationId: string,
    userId: string,
    reason: import('./workflowRunPauseStopServicePure.js').PauseReason | 'operator'
  ): Promise<PauseResult> {
    return WorkflowRunPauseStopService.pauseRun(runId, organisationId, userId, reason);
  },

  /** Pass-through to WorkflowRunPauseStopService.resumeRun. */
  async resumeRun(
    runId: string,
    organisationId: string,
    userId: string,
    opts: ResumeOptions
  ): Promise<{ resumed: boolean; reason?: 'not_paused'; extension_count?: number }> {
    return WorkflowRunPauseStopService.resumeRun(runId, organisationId, userId, opts);
  },

  /** Pass-through to WorkflowRunPauseStopService.stopRun. */
  async stopRun(
    runId: string,
    organisationId: string,
    userId: string
  ): Promise<StopResult> {
    return WorkflowRunPauseStopService.stopRun(runId, organisationId, userId);
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
    decisionReason?: string
  ): Promise<
    | { stepRunStatus: 'completed' | 'failed'; newVersion: number; idempotent_hit?: never }
    | { stepRunStatus: 'completed'; newVersion: number; idempotent_hit: true; existing_review_id: string | null }
  > {
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
        errorCode: 'step_already_resolved',
        current_status: stepRun.status,
      };
    }
    if (expectedVersion !== undefined && stepRun.version !== expectedVersion) {
      throw {
        statusCode: 409,
        message: `Step version is ${stepRun.version}, expected ${expectedVersion}`,
        errorCode: 'workflow_stale_version',
      };
    }

    // Pool-membership guard: if there is an open gate, check the user is in pool.
    // Pre-flight read outside the transaction — idiomatic (getOpenGate uses getOrgScopedDb).
    // 'awaiting_approval' is the codebase term; the spec uses 'review_required' interchangeably — always use 'awaiting_approval' here.
    const gate = await WorkflowStepGateService.getOpenGate(
      runId,
      stepRun.stepId,
      organisationId
    );
    if (gate && !userInPool(gate.approverPoolSnapshot as string[] | null, userId)) {
      throw {
        statusCode: 403,
        message: 'Not in approver pool',
        errorCode: 'not_in_approver_pool',
      };
    }

    const action = resolveApprovalDispatchAction(stepRun, decision);

    // ── Single causality transaction ─────────────────────────────────────────
    // review INSERT + gate resolve + step status UPDATE must be atomic.
    // For the `approved` path we also merge step output into run contextJson
    // inside the same transaction so downstream steps can template against it.
    // `resumeInvokeAutomationStep` (redispatch) opens its own transaction
    // internally, so it runs OUTSIDE this block.
    // enqueueTick always runs OUTSIDE the transaction.
    let idempotentHit = false;
    let existingReviewId: string | null = null;
    let finalStepStatus: 'completed' | 'failed' = 'completed';
    let shouldRedispatch = false;

    await db.transaction(async (tx: OrgScopedTx) => {
      // 1. Idempotency: INSERT review row (gate FK) with ON CONFLICT DO NOTHING.
      //    If gate is null (no gate exists for this step), skip the review INSERT.
      if (gate) {
        const insertResult = await tx.execute(
          sql`
            INSERT INTO workflow_step_reviews (step_run_id, gate_id, decided_by_user_id, decision, decision_reason, decided_at)
            VALUES (${stepRunId}, ${gate.id}, ${userId}, ${decision}, ${decisionReason ?? null}, NOW())
            ON CONFLICT (gate_id, decided_by_user_id) DO NOTHING
          `
        );
        const rowCount = (insertResult as { rowCount?: number }).rowCount ?? 0;
        if (rowCount === 0) {
          // Conflict — idempotent hit. Look up the existing review row inside tx.
          const [existingReview] = await tx
            .select({ id: workflowStepReviews.id })
            .from(workflowStepReviews)
            .where(
              and(
                eq(workflowStepReviews.gateId, gate.id),
                eq(workflowStepReviews.decidedByUserId, userId)
              )
            );
          idempotentHit = true;
          existingReviewId = existingReview?.id ?? null;
          return; // exit tx callback — no writes
        }
      }

      // 2. Resolve the gate (if one exists).
      if (gate) {
        const gateResolution = decision === 'rejected' ? 'rejected' : 'approved';
        await WorkflowStepGateService.resolveGate(gate.id, gateResolution, organisationId, tx);
      }

      // 3. Update step status directly — minimal columns only.
      //    This keeps the review INSERT + gate resolve + step transition atomic.
      if (decision === 'rejected') {
        finalStepStatus = 'failed';
        await tx
          .update(workflowStepRuns)
          .set({
            status: 'failed',
            error: 'approval_rejected',
            completedAt: new Date(),
            version: stepRun.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(workflowStepRuns.id, stepRunId));
      } else if (action === 'redispatch') {
        // Gate is resolved above; the actual step transition is handled by
        // resumeInvokeAutomationStep which opens its own transaction externally.
        finalStepStatus = 'completed'; // placeholder — overwritten below
        shouldRedispatch = true;
      } else {
        // approved / edited — complete the step and merge output into context.
        finalStepStatus = 'completed';
        const finalOutput =
          decision === 'edited' && editedOutput
            ? editedOutput
            : (stepRun.outputJson as Record<string, unknown> | null) ?? {};
        const outputHash = hashValue(finalOutput);

        await tx
          .update(workflowStepRuns)
          .set({
            status: 'completed',
            outputJson: finalOutput as unknown as Record<string, unknown>,
            outputHash,
            completedAt: new Date(),
            version: stepRun.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(workflowStepRuns.id, stepRunId));

        // Merge step output into run contextJson so templating in downstream
        // steps has access to the approved output on the next tick.
        // Fresh read inside the transaction to avoid a stale-read lost-update:
        // a parallel step completion between the outer SELECT and this write
        // would otherwise overwrite the concurrent update.
        const [freshRun] = await tx
          .select({ contextJson: workflowRuns.contextJson })
          .from(workflowRuns)
          .where(eq(workflowRuns.id, runId));
        const ctx = (freshRun?.contextJson ?? run.contextJson) as unknown as RunContext;
        const nextCtx: RunContext = {
          input: ctx.input,
          subaccount: ctx.subaccount,
          org: ctx.org,
          steps: { ...ctx.steps, [stepRun.stepId]: { output: finalOutput } },
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
      }
    });

    // ── Idempotent-hit early return ───────────────────────────────────────────
    if (idempotentHit) {
      return {
        stepRunStatus: 'completed',
        newVersion: stepRun.version,
        idempotent_hit: true,
        existing_review_id: existingReviewId,
      };
    }

    // ── Post-transaction side effects ────────────────────────────────────────
    if (shouldRedispatch) {
      const { stepOutcome } = await WorkflowEngineService.resumeInvokeAutomationStep(stepRunId);
      finalStepStatus = stepOutcome;
    }

    // Enqueue a tick so the engine advances the run (context merge already done
    // inside the transaction for approved paths; tick handles downstream dispatch).
    await WorkflowEngineService.enqueueTick(runId);

    return { stepRunStatus: finalStepStatus, newVersion: stepRun.version + 1 };
  },
};
