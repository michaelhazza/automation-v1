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
import { db } from '../db/index.js';
import {
  modules,
  orgSubscriptions,
  workflowRuns,
  workflowTemplates,
  subaccounts,
  subscriptions,
  systemWorkflowTemplates,
} from '../db/schema/index.js';
import type { WorkflowRunStatus } from '../db/schema/workflowRuns.js';
import { WorkflowRunService } from './workflowRunService.js';
import { taskService } from './taskService.js';
import { upsertSubaccountOnboardingState } from '../lib/workflow/onboardingStateHelpers.js';

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
    const [orgSub] = await db
      .select()
      .from(orgSubscriptions)
      .where(
        and(
          eq(orgSubscriptions.organisationId, organisationId),
          inArray(orgSubscriptions.status, ['trialing', 'active', 'past_due']),
        ),
      );
    if (!orgSub) return new Map();

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(
        and(eq(subscriptions.id, orgSub.subscriptionId), isNull(subscriptions.deletedAt)),
      );
    if (!sub || !sub.moduleIds || sub.moduleIds.length === 0) return new Map();

    const activeModules = await db
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
    // 1. Verify the subaccount belongs to the org.
    const [sub] = await db
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
    const latestRuns = await db
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
    startedByUserId: string;
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

    // Prefer an org-owned template with this slug, then fall back to system.
    const [orgTemplate] = await db
      .select({ id: workflowTemplates.id })
      .from(workflowTemplates)
      .where(
        and(
          eq(workflowTemplates.organisationId, params.organisationId),
          eq(workflowTemplates.slug, params.slug),
          isNull(workflowTemplates.deletedAt),
        ),
      );

    const onboardingTask = await taskService.createTask(params.organisationId, params.subaccountId, {
      title: `Workflow run`,
      status: 'inbox',
      brief: JSON.stringify(params.initialInput ?? {}),
    }, params.startedByUserId);

    let startInput: Parameters<typeof WorkflowRunService.startRun>[0];
    if (orgTemplate) {
      startInput = {
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        templateId: orgTemplate.id,
        initialInput: params.initialInput ?? {},
        startedByUserId: params.startedByUserId,
        taskId: onboardingTask.id,
        runMode: params.runMode ?? 'supervised',
        isOnboardingRun: true,
      };
    } else {
      const [sysTemplate] = await db
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
        startedByUserId: params.startedByUserId,
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
        const [existing] = await db
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
    startedByUserId: string;
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
    // Org-owned template.
    const orgRows = (await db.execute(sql`
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
    const sysRows = (await db.execute(sql`
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
}

export const subaccountOnboardingService = new SubaccountOnboardingService();
