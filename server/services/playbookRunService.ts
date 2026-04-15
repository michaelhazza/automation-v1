/**
 * playbookRunService — run lifecycle: start, query, cancel, submit input,
 * edit output, decide approval.
 *
 * Spec: tasks/playbooks-spec.md §5.0 (start-of-run flow) and §6.2.
 *
 * Public API of the run lifecycle. The actual tick/dispatch loop lives in
 * playbookEngineService — this service is the front door for routes and
 * external callers, and delegates to the engine for any state advance.
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  playbookRuns,
  playbookStepRuns,
  playbookTemplateVersions,
  playbookTemplates,
  systemPlaybookTemplates,
  systemPlaybookTemplateVersions,
  organisations,
  subaccounts,
  agents,
  systemAgents,
} from '../db/schema/index.js';
import type {
  PlaybookRun,
  PlaybookStepRun,
  PlaybookRunStatus,
} from '../db/schema/index.js';
import type { PlaybookDefinition, PlaybookStep, RunContext } from '../lib/playbook/types.js';
import { logger } from '../lib/logger.js';
import { playbookEngineService } from './playbookEngineService.js';
import { playbookTemplateService } from './playbookTemplateService.js';
import { upsertSubaccountOnboardingState } from '../lib/playbook/onboardingStateHelpers.js';

// ─── Definition rehydration ──────────────────────────────────────────────────

/**
 * Loads a stored definition_json back into a PlaybookDefinition shape.
 * The stored shape comes from playbookTemplateService.serialiseDefinition()
 * and intentionally drops the Zod schemas (Phase 1 limitation — see note
 * in that file). The engine treats outputSchema as a presence-only check
 * here; full Zod validation runs against the in-process import for system
 * templates that the seeder has loaded.
 */
function rehydrateDefinition(stored: Record<string, unknown>): PlaybookDefinition {
  // Use a permissive cast — the validator already ran at publish/seed time.
  return stored as unknown as PlaybookDefinition;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const playbookRunService = {
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
    definition: PlaybookDefinition;
    slug: string;
  }> {
    if (input.templateId) {
      // Org template path.
      const template = await playbookTemplateService.getOrgTemplate(
        input.organisationId,
        input.templateId
      );
      if (!template) {
        throw { statusCode: 404, message: 'Playbook template not found' };
      }
      const version = await playbookTemplateService.getOrgTemplateLatestVersion(template.id);
      if (!version) {
        throw {
          statusCode: 422,
          message: `Playbook template '${template.slug}' has no published version`,
        };
      }
      return {
        templateVersionId: version.id,
        definition: rehydrateDefinition(version.definitionJson as Record<string, unknown>),
        slug: template.slug,
      };
    }

    if (input.systemTemplateSlug) {
      const sys = await playbookTemplateService.getSystemTemplate(input.systemTemplateSlug);
      if (!sys) {
        throw { statusCode: 404, message: `System playbook '${input.systemTemplateSlug}' not found` };
      }
      const sysVer = await playbookTemplateService.getSystemTemplateLatestVersion(sys.id);
      if (!sysVer) {
        throw {
          statusCode: 422,
          message: `System playbook '${input.systemTemplateSlug}' has no published version`,
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
   * 3. Insert playbook_runs row with status='pending'.
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
  }): Promise<{ runId: string; status: PlaybookRunStatus }> {
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
        .insert(playbookRuns)
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
          playbookSlug: slug,
        })
        .returning();
      runId = run.id;

      // Patch the runId into context_json's _meta.
      await tx
        .update(playbookRuns)
        .set({
          contextJson: sql`jsonb_set(${playbookRuns.contextJson}, '{_meta,runId}', to_jsonb(${runId}::text), true)`,
        })
        .where(eq(playbookRuns.id, runId));

      // Insert step runs for every entry step.
      const entries = definition.steps.filter((s) => s.dependsOn.length === 0);
      if (entries.length === 0) {
        throw {
          statusCode: 422,
          message: `Playbook has no entry steps`,
          errorCode: 'playbook_dag_invalid',
        };
      }
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

      // Initialise the WS event sequence row.
      await tx.execute(
        sql`INSERT INTO playbook_run_event_sequences (run_id, last_sequence) VALUES (${runId}, 0) ON CONFLICT DO NOTHING`
      );
    });

    logger.info('playbook_run_started', {
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
        playbookSlug: slug,
        isOnboardingRun: true,
        runStatus: 'pending',
        startedAt,
        completedAt: null,
      });
    }

    // Enqueue the first tick.
    await playbookEngineService.enqueueTick(runId);

    return { runId, status: 'pending' };
  },

  /** Get a single run with all of its step runs. */
  async getRun(
    organisationId: string,
    runId: string
  ): Promise<{ run: PlaybookRun; stepRuns: PlaybookStepRun[]; definition: PlaybookDefinition | null }> {
    const [run] = await db
      .select()
      .from(playbookRuns)
      .where(and(eq(playbookRuns.id, runId), eq(playbookRuns.organisationId, organisationId)));
    if (!run) throw { statusCode: 404, message: 'Playbook run not found' };

    const stepRunRows = await db
      .select()
      .from(playbookStepRuns)
      .where(eq(playbookStepRuns.runId, runId))
      .orderBy(playbookStepRuns.createdAt);

    // Load the locked template version's definition (best-effort — UI can
    // render without it).
    const [version] = await db
      .select()
      .from(playbookTemplateVersions)
      .where(eq(playbookTemplateVersions.id, run.templateVersionId));

    let definition: PlaybookDefinition | null = null;
    if (version) {
      definition = rehydrateDefinition(version.definitionJson as Record<string, unknown>);
    } else {
      // System template version
      const [sysVer] = await db
        .select()
        .from(systemPlaybookTemplateVersions)
        .where(eq(systemPlaybookTemplateVersions.id, run.templateVersionId));
      if (sysVer) {
        definition = rehydrateDefinition(sysVer.definitionJson as Record<string, unknown>);
      }
    }

    return { run, stepRuns: stepRunRows, definition };
  },

  /**
   * Envelope endpoint payload for the run modal (spec §9.2). Single round-trip
   * that returns everything the PlaybookRunPage needs to render: run row,
   * ordered step-run rows, resolved template definition, resolved agent slugs
   * per step, and the (limited) per-step event list. Events are not persisted,
   * so `events` is always empty — the client fills it from the WS stream.
   */
  async getEnvelope(
    organisationId: string,
    subaccountId: string,
    runId: string
  ): Promise<{
    run: PlaybookRun;
    stepRuns: PlaybookStepRun[];
    definition: PlaybookDefinition | null;
    resolvedAgents: Record<string, string>;
    events: Array<unknown>;
  }> {
    const [run] = await db
      .select()
      .from(playbookRuns)
      .where(
        and(
          eq(playbookRuns.id, runId),
          eq(playbookRuns.organisationId, organisationId),
          eq(playbookRuns.subaccountId, subaccountId),
        ),
      );
    if (!run) throw { statusCode: 404, message: 'Playbook run not found' };

    const stepRunRows = await db
      .select()
      .from(playbookStepRuns)
      .where(eq(playbookStepRuns.runId, runId))
      .orderBy(playbookStepRuns.createdAt);

    let definition: PlaybookDefinition | null = null;
    const [version] = await db
      .select()
      .from(playbookTemplateVersions)
      .where(eq(playbookTemplateVersions.id, run.templateVersionId));
    if (version) {
      definition = rehydrateDefinition(version.definitionJson as Record<string, unknown>);
    } else {
      const [sysVer] = await db
        .select()
        .from(systemPlaybookTemplateVersions)
        .where(eq(systemPlaybookTemplateVersions.id, run.templateVersionId));
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
  ): Promise<PlaybookRun> {
    const [updated] = await db
      .update(playbookRuns)
      .set({ isPortalVisible, updatedAt: new Date() })
      .where(
        and(
          eq(playbookRuns.id, runId),
          eq(playbookRuns.organisationId, organisationId),
          eq(playbookRuns.subaccountId, subaccountId),
        ),
      )
      .returning();
    if (!updated) throw { statusCode: 404, message: 'Playbook run not found' };
    return updated;
  },

  /** List runs for a subaccount. */
  async listRunsForSubaccount(
    organisationId: string,
    subaccountId: string,
    filter?: { status?: PlaybookRunStatus }
  ): Promise<PlaybookRun[]> {
    const whereClauses = [
      eq(playbookRuns.organisationId, organisationId),
      eq(playbookRuns.subaccountId, subaccountId),
    ];
    if (filter?.status) {
      whereClauses.push(eq(playbookRuns.status, filter.status));
    }
    return db
      .select()
      .from(playbookRuns)
      .where(and(...whereClauses))
      .orderBy(desc(playbookRuns.createdAt));
  },

  /**
   * Cancel a run. Transitions to 'cancelling' first; the engine moves it to
   * 'cancelled' once in-flight steps settle.
   */
  async cancelRun(organisationId: string, runId: string, _userId: string): Promise<void> {
    const [run] = await db
      .select()
      .from(playbookRuns)
      .where(and(eq(playbookRuns.id, runId), eq(playbookRuns.organisationId, organisationId)));
    if (!run) throw { statusCode: 404, message: 'Playbook run not found' };
    if (
      run.status === 'completed' ||
      run.status === 'completed_with_errors' ||
      run.status === 'failed' ||
      run.status === 'cancelled'
    ) {
      return; // already terminal — idempotent
    }
    await db
      .update(playbookRuns)
      .set({ status: 'cancelling', updatedAt: new Date() })
      .where(eq(playbookRuns.id, runId));
    await playbookEngineService.enqueueTick(runId);
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
      .from(playbookRuns)
      .where(and(eq(playbookRuns.id, runId), eq(playbookRuns.organisationId, organisationId)));
    if (!run) throw { statusCode: 404, message: 'Playbook run not found' };

    const [stepRun] = await db
      .select()
      .from(playbookStepRuns)
      .where(and(eq(playbookStepRuns.id, stepRunId), eq(playbookStepRuns.runId, runId)));
    if (!stepRun) throw { statusCode: 404, message: 'Step run not found' };
    if (stepRun.status !== 'awaiting_input') {
      throw {
        statusCode: 409,
        message: `Step is in status '${stepRun.status}', not 'awaiting_input'`,
      };
    }
    if (expectedVersion !== undefined && stepRun.version !== expectedVersion) {
      throw {
        statusCode: 409,
        message: `Step version is ${stepRun.version}, expected ${expectedVersion}`,
        errorCode: 'playbook_stale_version',
      };
    }

    await playbookEngineService.completeStepRun(stepRunId, {
      output: formData,
      via: 'user_input',
    });
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
    return playbookEngineService.editStepOutput(
      organisationId,
      runId,
      stepRunId,
      options
    );
  },

  /**
   * Approve, reject, or edit-and-approve a step that is awaiting_approval.
   */
  async decideApproval(
    organisationId: string,
    runId: string,
    stepRunId: string,
    decision: 'approved' | 'rejected' | 'edited',
    editedOutput: Record<string, unknown> | undefined,
    userId: string,
    expectedVersion?: number
  ): Promise<{ stepRunStatus: 'completed' | 'failed'; newVersion: number }> {
    const [run] = await db
      .select()
      .from(playbookRuns)
      .where(and(eq(playbookRuns.id, runId), eq(playbookRuns.organisationId, organisationId)));
    if (!run) throw { statusCode: 404, message: 'Playbook run not found' };

    const [stepRun] = await db
      .select()
      .from(playbookStepRuns)
      .where(and(eq(playbookStepRuns.id, stepRunId), eq(playbookStepRuns.runId, runId)));
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
        errorCode: 'playbook_stale_version',
      };
    }

    if (decision === 'rejected') {
      await playbookEngineService.failStepRun(stepRunId, 'approval_rejected', userId);
      return { stepRunStatus: 'failed', newVersion: stepRun.version + 1 };
    }

    const finalOutput =
      decision === 'edited' && editedOutput
        ? editedOutput
        : (stepRun.outputJson as Record<string, unknown> | null) ?? {};

    await playbookEngineService.completeStepRun(stepRunId, {
      output: finalOutput,
      via: 'approval',
      decidedByUserId: userId,
    });
    return { stepRunStatus: 'completed', newVersion: stepRun.version + 1 };
  },
};
