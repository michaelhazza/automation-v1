/**
 * Sub-account onboarding service — Phase F (spec §10).
 *
 * Computes the "owed onboarding Workflows" for a sub-account as the union of
 * `modules.onboardingWorkflowSlugs` across every module active on the
 * sub-account's org, then joins that union to the latest matching
 * `workflowRuns` row (filtered by `isOnboardingRun = true`).
 *
 * Consumers:
 *   - §9.3 admin Onboarding tab (AdminSubaccountDetailPage) — lists owed
 *     Workflows, renders progress per slug, and offers "Start now" for any
 *     slug that has no active run.
 *   - §10.5 auto-start hook — iterates owed slugs and enqueues the ones
 *     whose template declares `autoStartOnOnboarding = true`.
 */

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ARTEFACT_FORM_SCHEMAS } from '../../shared/schemas/baselineArtefactsForms.js';
import {
  modules,
  orgSubscriptions,
  workflowRuns,
  workflowTemplates,
  subaccounts,
  subscriptions,
  systemWorkflowTemplates,
  workspaceMemoryEntries,
  memoryBlocks,
  subaccountBaselines,
} from '../db/schema/index.js';
import type { WorkflowRunStatus } from '../db/schema/workflowRuns.js';
import { WorkflowRunService } from './workflowRunService.js';
import { taskService } from './taskService.js';
import { upsertSubaccountOnboardingState } from '../lib/workflow/onboardingStateHelpers.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  isBaselineSlug,
  tierFor,
  WORKSPACE_MEMORY_DOMAIN,
  WORKSPACE_MEMORY_TOPIC_BY_SLUG,
} from '../../shared/constants/baselineArtefacts.js';
import type { BaselineSlug } from '../../shared/constants/baselineArtefacts.js';
import { assertVersionGate } from '../../shared/schemas/subaccount.js';
import { createEvent } from '../lib/tracing.js';

export interface OwedOnboardingWorkflow {
  slug: string;
  /** Which enabled modules contributed this slug to the owed list. */
  moduleIds: string[];
  /** Latest onboarding run for this subaccount+slug, or null if never run. */
  latestRun: {
    id: string;
    status: WorkflowRunStatus;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
}

class SubaccountOnboardingService {
  /**
   * Resolve the union of `onboardingWorkflowSlugs` for the sub-account's org,
   * tagged with the modules that contributed each slug. Returns an empty map
   * when the org has no active subscription.
   */
  private async resolveOwedSlugsForOrg(
    organisationId: string,
  ): Promise<Map<string, string[]>> {
    const tx = getOrgScopedDb('subaccountOnboardingService.resolveOwedSlugsForOrg');
    const [orgSub] = await tx
      .select()
      .from(orgSubscriptions)
      .where(
        and(
          eq(orgSubscriptions.organisationId, organisationId),
          inArray(orgSubscriptions.status, ['trialing', 'active', 'past_due']),
        ),
      );
    if (!orgSub) return new Map();

    const [sub] = await tx
      .select()
      .from(subscriptions)
      .where(
        and(eq(subscriptions.id, orgSub.subscriptionId), isNull(subscriptions.deletedAt)),
      );
    if (!sub || !sub.moduleIds || sub.moduleIds.length === 0) return new Map();

    const activeModules = await tx
      .select({
        id: modules.id,
        onboardingWorkflowSlugs: modules.onboardingWorkflowSlugs,
      })
      .from(modules)
      .where(and(inArray(modules.id, sub.moduleIds), isNull(modules.deletedAt)));

    // slug -> ordered list of module ids that advertised it
    const slugToModules = new Map<string, string[]>();
    for (const m of activeModules) {
      for (const slug of m.onboardingWorkflowSlugs ?? []) {
        const existing = slugToModules.get(slug);
        if (existing) {
          if (!existing.includes(m.id)) existing.push(m.id);
        } else {
          slugToModules.set(slug, [m.id]);
        }
      }
    }
    return slugToModules;
  }

  /**
   * §10.3 — list the onboarding Workflows owed for a sub-account, each joined
   * to its latest matching `workflowRuns` row (filtered by
   * `isOnboardingRun = true`).
   */
  async listOwedOnboardingWorkflows(
    organisationId: string,
    subaccountId: string,
  ): Promise<OwedOnboardingWorkflow[]> {
    const tx = getOrgScopedDb('subaccountOnboardingService.listOwedOnboardingWorkflows');
    // 1. Verify the subaccount belongs to the org.
    const [sub] = await tx
      .select({
        id: subaccounts.id,
        organisationId: subaccounts.organisationId,
      })
      .from(subaccounts)
      .where(and(eq(subaccounts.id, subaccountId), isNull(subaccounts.deletedAt)));
    if (!sub || sub.organisationId !== organisationId) {
      throw { statusCode: 404, message: 'Subaccount not found' };
    }

    // 2. Resolve owed slugs from the org's active module set.
    const slugToModules = await this.resolveOwedSlugsForOrg(organisationId);
    if (slugToModules.size === 0) return [];

    const slugs = Array.from(slugToModules.keys());

    // 3. Load the latest onboarding run per slug for this subaccount.
    //    DISTINCT ON (workflow_slug) ordered by createdAt DESC.
    const latestRuns = await tx
      .select({
        id: workflowRuns.id,
        workflowSlug: workflowRuns.workflowSlug,
        status: workflowRuns.status,
        startedAt: workflowRuns.startedAt,
        completedAt: workflowRuns.completedAt,
        createdAt: workflowRuns.createdAt,
      })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.organisationId, organisationId),
          eq(workflowRuns.subaccountId, subaccountId),
          eq(workflowRuns.isOnboardingRun, true),
          inArray(workflowRuns.workflowSlug, slugs),
        ),
      )
      .orderBy(desc(workflowRuns.createdAt));

    // Collapse to the newest row per slug (the query already orders desc).
    const latestBySlug = new Map<string, (typeof latestRuns)[number]>();
    for (const row of latestRuns) {
      if (!row.workflowSlug) continue;
      if (!latestBySlug.has(row.workflowSlug)) {
        latestBySlug.set(row.workflowSlug, row);
      }
    }

    // 4. Stitch the owed list. Preserve slug insertion order for deterministic
    //    rendering (module iteration order).
    return slugs.map((slug) => {
      const latest = latestBySlug.get(slug);
      return {
        slug,
        moduleIds: slugToModules.get(slug) ?? [],
        latestRun: latest
          ? {
              id: latest.id,
              status: latest.status,
              startedAt: latest.startedAt ? latest.startedAt.toISOString() : null,
              completedAt: latest.completedAt ? latest.completedAt.toISOString() : null,
            }
          : null,
      };
    });
  }

  /**
   * §10.3 — start an owed onboarding Workflow. Resolves the slug to an org or
   * system template, then delegates to `WorkflowRunService.startRun()` with
   * `isOnboardingRun: true`. The DB-level partial unique index
   * (`workflow_runs_active_per_subaccount_slug`) guarantees at-most-one active
   * run per (subaccount, slug) — the duplicate-run guard is enforced at the
   * service layer by `WorkflowRunService.startRun()` (§10.5.1).
   */
  async startOwedOnboardingWorkflow(params: {
    organisationId: string;
    subaccountId: string;
    slug: string;
    /** UUID of the user who triggered the start, or null for system-initiated paths. */
    startedByUserId: string | null;
    runMode?: 'auto' | 'supervised';
    initialInput?: Record<string, unknown>;
  }): Promise<{ runId: string }> {
    // Verify the slug is actually owed for this sub-account.
    const slugToModules = await this.resolveOwedSlugsForOrg(params.organisationId);
    if (!slugToModules.has(params.slug)) {
      throw {
        statusCode: 400,
        message: `Slug '${params.slug}' is not an onboarding Workflow for this sub-account`,
        errorCode: 'onboarding_slug_not_owed',
      };
    }

    const tx = getOrgScopedDb('subaccountOnboardingService.startOwedOnboardingWorkflow');
    // Prefer an org-owned template with this slug, then fall back to system.
    const [orgTemplate] = await tx
      .select({ id: workflowTemplates.id })
      .from(workflowTemplates)
      .where(
        and(
          eq(workflowTemplates.organisationId, params.organisationId),
          eq(workflowTemplates.slug, params.slug),
          isNull(workflowTemplates.deletedAt),
        ),
      );

    const onboardingTask = await taskService.createTask(
      {
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        data: { title: `Workflow run`, status: 'inbox', brief: JSON.stringify(params.initialInput ?? {}) },
        userId: params.startedByUserId ?? undefined,
      },
      tx,
    );

    let startInput: Parameters<typeof WorkflowRunService.startRun>[0];
    if (orgTemplate) {
      startInput = {
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        templateId: orgTemplate.id,
        initialInput: params.initialInput ?? {},
        startedByUserId: params.startedByUserId ?? undefined,
        taskId: onboardingTask.id,
        runMode: params.runMode ?? 'supervised',
        isOnboardingRun: true,
      };
    } else {
      const [sysTemplate] = await tx
        .select({ id: systemWorkflowTemplates.id })
        .from(systemWorkflowTemplates)
        .where(eq(systemWorkflowTemplates.slug, params.slug));
      if (!sysTemplate) {
        throw {
          statusCode: 404,
          message: `No published template found for slug '${params.slug}'`,
          errorCode: 'onboarding_template_not_found',
        };
      }
      startInput = {
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        systemTemplateSlug: params.slug,
        initialInput: params.initialInput ?? {},
        startedByUserId: params.startedByUserId ?? undefined,
        taskId: onboardingTask.id,
        runMode: params.runMode ?? 'supervised',
        isOnboardingRun: true,
      };
    }

    try {
      const result = await WorkflowRunService.startRun(startInput);
      return { runId: result.runId };
    } catch (err) {
      // §10.5.1 duplicate-run guard: the partial unique index may raise
      // a 23505 unique_violation if an active run already exists for
      // (subaccountId, slug). Convert that into an existing-run lookup.
      const pgCode = (err as { code?: string } | null)?.code;
      if (pgCode === '23505') {
        const [existing] = await tx
          .select({ id: workflowRuns.id })
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.organisationId, params.organisationId),
              eq(workflowRuns.subaccountId, params.subaccountId),
              eq(workflowRuns.workflowSlug, params.slug),
              inArray(workflowRuns.status, [
                'pending',
                'running',
                'awaiting_input',
                'awaiting_approval',
              ]),
            ),
          )
          .orderBy(desc(workflowRuns.createdAt))
          .limit(1);
        if (existing) return { runId: existing.id };
      }
      throw err;
    }
  }

  /**
   * §10.5 auto-start hook. Intended to be called after sub-account creation
   * or module-enable. Iterates owed slugs and kicks off runs for templates
   * whose definition declares `autoStartOnOnboarding = true`.
   *
   * Failures are isolated per slug — a single failed enqueue does not block
   * the others, matching the §5.8 failure-isolation pattern.
   */
  async autoStartOwedOnboardingWorkflows(params: {
    organisationId: string;
    subaccountId: string;
    /** UUID of the user who triggered the auto-start, or null for system-initiated paths. */
    startedByUserId: string | null;
  }): Promise<{ startedRunIds: string[]; skippedSlugs: string[]; errors: Array<{ slug: string; error: string }> }> {
    const owed = await this.listOwedOnboardingWorkflows(
      params.organisationId,
      params.subaccountId,
    );
    const startedRunIds: string[] = [];
    const skippedSlugs: string[] = [];
    const errors: Array<{ slug: string; error: string }> = [];

    for (const row of owed) {
      // Skip if an active or completed onboarding run already exists for this
      // slug — the auto-start hook is idempotent.
      if (row.latestRun) {
        skippedSlugs.push(row.slug);
        continue;
      }

      // Inspect the latest published version for `autoStartOnOnboarding`.
      const shouldAutoStart = await this.templateAutoStartsOnOnboarding(
        params.organisationId,
        row.slug,
      );
      if (!shouldAutoStart) {
        skippedSlugs.push(row.slug);
        continue;
      }

      try {
        const { runId } = await this.startOwedOnboardingWorkflow({
          organisationId: params.organisationId,
          subaccountId: params.subaccountId,
          slug: row.slug,
          startedByUserId: params.startedByUserId,
          runMode: 'supervised',
        });
        startedRunIds.push(runId);
      } catch (err) {
        errors.push({
          slug: row.slug,
          error: (err as { message?: string })?.message ?? String(err),
        });
      }
    }

    return { startedRunIds, skippedSlugs, errors };
  }

  /**
   * Reads the latest published definition for the slug (org-owned first,
   * then system) and returns whether it declares `autoStartOnOnboarding: true`.
   */
  private async templateAutoStartsOnOnboarding(
    organisationId: string,
    slug: string,
  ): Promise<boolean> {
    const tx = getOrgScopedDb('subaccountOnboardingService.templateAutoStartsOnOnboarding');
    // Org-owned template.
    const orgRows = (await tx.execute(sql`
      SELECT ptv.definition_json AS definition
      FROM workflow_templates pt
      JOIN workflow_template_versions ptv
        ON ptv.template_id = pt.id AND ptv.version = pt.latest_version
      WHERE pt.organisation_id = ${organisationId}
        AND pt.slug = ${slug}
        AND pt.deleted_at IS NULL
        AND pt.latest_version > 0
      LIMIT 1
    `)) as unknown as Array<{ definition?: { autoStartOnOnboarding?: boolean } }>;
    const orgDef = orgRows[0]?.definition;
    if (orgDef) {
      return orgDef.autoStartOnOnboarding === true;
    }

    // System template fallback.
    const sysRows = (await tx.execute(sql`
      SELECT sptv.definition_json AS definition
      FROM system_workflow_templates spt
      JOIN system_workflow_template_versions sptv
        ON sptv.system_template_id = spt.id AND sptv.version = spt.latest_version
      WHERE spt.slug = ${slug}
        AND spt.latest_version > 0
      LIMIT 1
    `)) as unknown as Array<{ definition?: { autoStartOnOnboarding?: boolean } }>;
    const sysDef = sysRows[0]?.definition;
    return sysDef?.autoStartOnOnboarding === true;
  }

  /**
   * §10.3 — upsert the `subaccount_onboarding_state` row for an onboarding
   * run transition. Delegates to the helper module so internal services can
   * call the helper directly without creating a cycle with this service.
   */
  async recordRunTransition(params: {
    runId: string;
    organisationId: string;
    subaccountId: string;
    workflowSlug: string | null;
    isOnboardingRun: boolean;
    runStatus: WorkflowRunStatus;
    startedAt: Date | null;
    completedAt: Date | null;
  }): Promise<void> {
    return upsertSubaccountOnboardingState(params);
  }

  /**
   * F1 §3 — mark a baseline artefact as captured.
   *
   * Tier 1/2: records the memory block id in the JSONB status column.
   * Tier 3: inserts a workspace memory entry then records its id.
   *
   * Uses atomic jsonb_set SQL — never reads and re-writes in JS.
   * Calls assertVersionGate before any mutation.
   */
  async markArtefactCaptured(params: {
    organisationId: string;
    subaccountId: string;
    slug: string;
    userId: string;
    memoryBlockId?: string;
    tier3Payload?: Record<string, unknown>;
  }): Promise<void> {
    if (!isBaselineSlug(params.slug)) {
      throw { statusCode: 400, errorCode: 'INVALID_BASELINE_SLUG' };
    }
    const slug = params.slug as BaselineSlug;
    const tier = tierFor(slug);

    if (tier !== 3 && !params.memoryBlockId) {
      throw {
        statusCode: 500,
        errorCode: 'TIER12_MISSING_MEMORY_BLOCK_ID',
        message: 'Tier-1/2 capture requires a memoryBlockId',
      };
    }

    // Short key: 'baseline.brand_identity' → 'brand_identity'
    const shortKey = slug.split('.')[1];
    const tierKey = `tier${tier}` as 'tier1' | 'tier2' | 'tier3';

    const artefactScopedDb = getOrgScopedDb('subaccountOnboardingService.markArtefactCaptured');
    const [row] = await artefactScopedDb
      .select({ baselineArtefactsStatus: subaccounts.baselineArtefactsStatus })
      .from(subaccounts)
      .where(
        and(
          eq(subaccounts.id, params.subaccountId),
          eq(subaccounts.organisationId, params.organisationId),
          isNull(subaccounts.deletedAt),
        ),
      );
    if (!row) {
      throw { statusCode: 404, message: 'Subaccount not found' };
    }

    assertVersionGate(row.baselineArtefactsStatus, 1);

    let workspaceMemoryId: string | undefined;
    if (tier === 3) {
      const topic = WORKSPACE_MEMORY_TOPIC_BY_SLUG[slug];
      const [inserted] = await artefactScopedDb
        .insert(workspaceMemoryEntries)
        .values({
          organisationId: params.organisationId,
          subaccountId: params.subaccountId,
          content: JSON.stringify(params.tier3Payload ?? {}),
          entryType: 'observation',
          domain: WORKSPACE_MEMORY_DOMAIN,
          topic: topic ?? shortKey,
          provenanceSourceType: 'manual',
          provenanceConfidence: 1,
          isUnverified: false,
          qualityScore: 1,
          qualityScoreUpdater: 'initial_score',
        })
        .returning({ id: workspaceMemoryEntries.id });
      workspaceMemoryId = inserted.id;
    }

    const refId = tier === 3 ? workspaceMemoryId : params.memoryBlockId;
    const refField = tier === 3 ? 'workspace_memory_id' : 'memory_block_id';

    await artefactScopedDb.execute(sql`
      UPDATE subaccounts
      SET baseline_artefacts_status = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              baseline_artefacts_status,
              ${sql.raw(`'{${tierKey},${shortKey},status}'`)},
              '"completed"'
            ),
            ${sql.raw(`'{${tierKey},${shortKey},captured_at}'`)},
            to_jsonb(now())
          ),
          ${sql.raw(`'{${tierKey},${shortKey},${refField}}'`)},
          ${refId != null ? sql`to_jsonb(${refId}::text)` : sql`'null'::jsonb`}
        ),
        ${sql.raw(`'{${tierKey},${shortKey},captured_by_user_id}'`)},
        to_jsonb(${params.userId}::text)
      )
      WHERE id = ${params.subaccountId}
        AND organisation_id = ${params.organisationId}
    `);

    createEvent('artefact.capture.completed', {
      subaccount_id: params.subaccountId,
      tier,
      slug,
      user_id: params.userId,
      ...(tier === 3 ? { workspace_memory_id: workspaceMemoryId } : { memory_block_id: params.memoryBlockId }),
      version: 1,
    });
  }

  /**
   * F1 §3 — emit a started event for a baseline artefact capture (no DB write).
   * Called from the client-facing route when the user opens a capture step (Chunk 4A).
   */
  recordArtefactStarted(params: {
    subaccountId: string;
    organisationId: string;
    slug: string;
    userId: string;
  }): void {
    if (!isBaselineSlug(params.slug)) return;
    const slug = params.slug as BaselineSlug;
    createEvent('artefact.capture.started', {
      subaccount_id: params.subaccountId,
      tier: tierFor(slug),
      slug,
      user_id: params.userId,
    });
  }

  /**
   * F1 §3 — mark a Tier-3 baseline artefact as skipped.
   *
   * Tier-1 and Tier-2 artefacts cannot be skipped — throws BASELINE_SKIP_NOT_PERMITTED.
   * Uses atomic jsonb_set SQL.
   * Calls assertVersionGate before any mutation.
   */
  async markArtefactSkipped(params: {
    organisationId: string;
    subaccountId: string;
    slug: string;
    userId: string;
    reason: 'defer_for_later' | 'not_applicable';
  }): Promise<void> {
    if (!isBaselineSlug(params.slug)) {
      throw { statusCode: 400, errorCode: 'INVALID_BASELINE_SLUG' };
    }
    const slug = params.slug as BaselineSlug;
    const tier = tierFor(slug);

    if (tier !== 3) {
      throw { statusCode: 400, errorCode: 'BASELINE_SKIP_NOT_PERMITTED' };
    }

    const shortKey = slug.split('.')[1];

    const skipScopedDb = getOrgScopedDb('subaccountOnboardingService.markArtefactSkipped');
    const [row] = await skipScopedDb
      .select({ baselineArtefactsStatus: subaccounts.baselineArtefactsStatus })
      .from(subaccounts)
      .where(
        and(
          eq(subaccounts.id, params.subaccountId),
          eq(subaccounts.organisationId, params.organisationId),
          isNull(subaccounts.deletedAt),
        ),
      );
    if (!row) {
      throw { statusCode: 404, message: 'Subaccount not found' };
    }

    const status = assertVersionGate(row.baselineArtefactsStatus, 1);

    const tier3Section = status.tier3 as Record<string, { status: string }>;
    const currentEntry = tier3Section[shortKey];
    if (currentEntry?.status === 'completed') {
      throw { statusCode: 409, errorCode: 'ARTEFACT_ALREADY_COMPLETED' };
    }

    await skipScopedDb.execute(sql`
      UPDATE subaccounts
      SET baseline_artefacts_status = jsonb_set(
        jsonb_set(
          jsonb_set(
            baseline_artefacts_status,
            ${sql.raw(`'{tier3,${shortKey},status}'`)},
            '"skipped"'
          ),
          ${sql.raw(`'{tier3,${shortKey},skipped_at}'`)},
          to_jsonb(now())
        ),
        ${sql.raw(`'{tier3,${shortKey},captured_by_user_id}'`)},
        to_jsonb(${params.userId}::text)
      )
      WHERE id = ${params.subaccountId}
        AND organisation_id = ${params.organisationId}
    `);

    createEvent('artefact.capture.skipped', {
      subaccount_id: params.subaccountId,
      tier,
      slug,
      user_id: params.userId,
      reason: params.reason,
      version: 1,
    });
  }

  /**
   * F1 §4B — edit the content of a previously-captured baseline artefact.
   *
   * Only `completed` artefacts may be edited. Status stays `completed`; only
   * the underlying memory block or workspace memory entry content is updated.
   * No JSONB mutation needed.
   */
  async markArtefactEdited(params: {
    organisationId: string;
    subaccountId: string;
    slug: string;
    userId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    if (!isBaselineSlug(params.slug)) {
      throw { statusCode: 400, errorCode: 'INVALID_BASELINE_SLUG' };
    }
    const slug = params.slug as BaselineSlug;
    const tier = tierFor(slug);
    const shortKey = slug.split('.')[1];
    const tierKey = `tier${tier}` as 'tier1' | 'tier2' | 'tier3';

    const editScopedDb = getOrgScopedDb('subaccountOnboardingService.markArtefactEdited');
    const [row] = await editScopedDb
      .select({ baselineArtefactsStatus: subaccounts.baselineArtefactsStatus })
      .from(subaccounts)
      .where(
        and(
          eq(subaccounts.id, params.subaccountId),
          eq(subaccounts.organisationId, params.organisationId),
          isNull(subaccounts.deletedAt),
        ),
      );
    if (!row) {
      throw { statusCode: 404, message: 'Subaccount not found' };
    }

    const status = assertVersionGate(row.baselineArtefactsStatus, 1);

    const artefactEntry = (status[tierKey] as Record<string, { status: string }>)[shortKey];
    if (!artefactEntry || artefactEntry.status !== 'completed') {
      throw { statusCode: 400, errorCode: 'ARTEFACT_NOT_COMPLETED' };
    }

    const schema = ARTEFACT_FORM_SCHEMAS[slug];
    const parseResult = schema.safeParse(params.payload);
    if (!parseResult.success) {
      throw {
        statusCode: 400,
        errorCode: 'INVALID_ARTEFACT_PAYLOAD',
        message: 'Payload does not match the artefact schema',
        fieldErrors: parseResult.error.flatten().fieldErrors,
      };
    }

    if (tier === 1 || tier === 2) {
      const updated = await editScopedDb
        .update(memoryBlocks)
        .set({ content: JSON.stringify(parseResult.data) })
        .where(
          and(
            eq(memoryBlocks.name, slug),
            eq(memoryBlocks.subaccountId, params.subaccountId),
            eq(memoryBlocks.organisationId, params.organisationId),
            isNull(memoryBlocks.deletedAt),
          ),
        )
        .returning({ id: memoryBlocks.id });
      if (updated.length === 0) {
        throw {
          statusCode: 404,
          errorCode: 'ARTEFACT_TARGET_MISSING',
          message: `No active memory block found for slug=${slug}`,
        };
      }
    } else {
      const tier3Entry = (status.tier3 as Record<string, { workspace_memory_id: string | null }>)[shortKey];
      const workspaceMemoryId = tier3Entry?.workspace_memory_id;
      if (!workspaceMemoryId) {
        throw {
          statusCode: 500,
          errorCode: 'TIER3_WORKSPACE_MEMORY_MISSING',
          message: 'Tier-3 artefact is completed but has no workspace_memory_id',
        };
      }
      const updated = await editScopedDb
        .update(workspaceMemoryEntries)
        .set({ content: JSON.stringify(parseResult.data) })
        .where(
          and(
            eq(workspaceMemoryEntries.id, workspaceMemoryId),
            eq(workspaceMemoryEntries.organisationId, params.organisationId),
            eq(workspaceMemoryEntries.subaccountId, params.subaccountId),
            isNull(workspaceMemoryEntries.deletedAt),
          ),
        )
        .returning({ id: workspaceMemoryEntries.id });
      if (updated.length === 0) {
        throw {
          statusCode: 404,
          errorCode: 'ARTEFACT_TARGET_MISSING',
          message: `No active workspace memory entry found for slug=${slug}`,
        };
      }
    }

    createEvent('artefact.capture.edited', {
      subaccount_id: params.subaccountId,
      tier,
      slug,
      user_id: params.userId,
      prior_version: 'v1',
      new_version: 'v1',
    });
  }

  /**
   * F3 §4 — insert the initial `pending` baseline row at sub-account creation.
   * Idempotent: the partial UNIQUE index on (subaccount_id) WHERE status <> 'reset'
   * prevents a duplicate row if the hook fires twice.
   *
   * Single-writer rule: this is the ONLY surface that writes the initial `pending`
   * row. After this insert, captureBaselineService is the only writer.
   */
  async markBaselinePending(params: {
    organisationId: string;
    subaccountId: string;
  }): Promise<void> {
    try {
      const tx = getOrgScopedDb('subaccountOnboardingService.markBaselinePending');
      await tx.insert(subaccountBaselines).values({
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        baselineVersion: 1,
        status: 'pending',
      });
    } catch (err) {
      const pgErr = err as { code?: string };
      if (pgErr?.code === '23505') return;
      throw err;
    }
  }
}

export const subaccountOnboardingService = new SubaccountOnboardingService();
