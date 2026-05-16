import { eq, and, isNull, inArray } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  modules,
  subscriptions,
  orgSubscriptions,
  workflowTemplates,
  systemWorkflowTemplates,
} from '../db/schema/index.js';
import type { Module, NewModule } from '../db/schema/index.js';

class ModuleService {
  // ---------------------------------------------------------------------------
  // Resolution helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve which agent slugs the org is allowed to use based on its active
   * subscription → modules chain.  Returns 'all' when any linked module has
   * allow_all_agents = true, otherwise returns the union of allowed_agent_slugs.
   */
  async getAllowedAgentSlugs(orgId: string): Promise<Set<string> | 'all'> {
    // 1. Active org subscription
    const getAllowedScopedDb = getOrgScopedDb('moduleService.getAllowedAgentSlugs');
    const [orgSub] = await getAllowedScopedDb
      .select()
      .from(orgSubscriptions)
      .where(
        and(
          eq(orgSubscriptions.organisationId, orgId),
          inArray(orgSubscriptions.status, ['trialing', 'active', 'past_due']),
        ),
      );

    if (!orgSub) return new Set<string>();

    // 2. Load subscription to get module_ids
    const [sub] = await getAllowedScopedDb
      .select()
      .from(subscriptions)
      .where(
        and(eq(subscriptions.id, orgSub.subscriptionId), isNull(subscriptions.deletedAt)),
      );

    if (!sub || !sub.moduleIds || sub.moduleIds.length === 0) return new Set<string>();

    // 3. Load modules
    const linkedModules = await getAllowedScopedDb
      .select()
      .from(modules)
      .where(and(inArray(modules.id, sub.moduleIds), isNull(modules.deletedAt)));

    // 4. Check for allow_all_agents
    if (linkedModules.some((m) => m.allowAllAgents)) return 'all';

    // 5. Union all allowed_agent_slugs
    const result = new Set<string>();
    for (const m of linkedModules) {
      if (Array.isArray(m.allowedAgentSlugs)) {
        for (const slug of m.allowedAgentSlugs) result.add(slug);
      }
    }
    return result;
  }

  /**
   * Check whether a single agent slug is permitted for an org.
   */
  async isAgentAllowedForOrg(agentSlug: string, orgId: string): Promise<boolean> {
    const allowed = await this.getAllowedAgentSlugs(orgId);
    if (allowed === 'all') return true;
    return allowed.has(agentSlug);
  }

  /**
   * Collect sidebar_config arrays from all active modules linked to the org's
   * subscription.  Flatten and deduplicate preserving first-occurrence order.
   */
  async getSidebarConfig(orgId: string): Promise<string[]> {
    // 1. Active org subscription
    const getSidebarScopedDb = getOrgScopedDb('moduleService.getSidebarConfig');
    const [orgSub] = await getSidebarScopedDb
      .select()
      .from(orgSubscriptions)
      .where(
        and(
          eq(orgSubscriptions.organisationId, orgId),
          inArray(orgSubscriptions.status, ['trialing', 'active', 'past_due']),
        ),
      );

    if (!orgSub) return [];

    // 2. Load subscription → module_ids
    const [sub] = await getSidebarScopedDb
      .select()
      .from(subscriptions)
      .where(
        and(eq(subscriptions.id, orgSub.subscriptionId), isNull(subscriptions.deletedAt)),
      );

    if (!sub || !sub.moduleIds || sub.moduleIds.length === 0) return [];

    // 3. Load modules
    const linkedModules = await getSidebarScopedDb
      .select()
      .from(modules)
      .where(and(inArray(modules.id, sub.moduleIds), isNull(modules.deletedAt)));

    // 4. Flatten + deduplicate (preserve first-occurrence order)
    const seen = new Set<string>();
    const result: string[] = [];
    for (const m of linkedModules) {
      if (Array.isArray(m.sidebarConfig)) {
        for (const item of m.sidebarConfig) {
          if (!seen.has(item)) {
            seen.add(item);
            result.push(item);
          }
        }
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // CRUD (system admin)
  // ---------------------------------------------------------------------------

  async listModules(): Promise<Module[]> {
    return getOrgScopedDb('moduleService.listModules').select().from(modules).where(isNull(modules.deletedAt));
  }

  async getModule(id: string): Promise<Module> {
    const [row] = await getOrgScopedDb('moduleService.getModule')
      .select()
      .from(modules)
      .where(and(eq(modules.id, id), isNull(modules.deletedAt)));

    if (!row) {
      throw { statusCode: 404, message: 'Module not found' };
    }
    return row;
  }

  async createModule(data: Omit<NewModule, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Module> {
    if (Array.isArray(data.onboardingWorkflowSlugs) && data.onboardingWorkflowSlugs.length > 0) {
      await this.validateOnboardingWorkflowSlugs(data.onboardingWorkflowSlugs);
    }
    const now = new Date();
    const [row] = await getOrgScopedDb('moduleService.createModule')
      .insert(modules)
      .values({ ...data, createdAt: now, updatedAt: now })
      .returning();
    return row;
  }

  async updateModule(
    id: string,
    data: Partial<Omit<NewModule, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
  ): Promise<Module> {
    const updateModuleScopedDb = getOrgScopedDb('moduleService.updateModule');
    const [existing] = await updateModuleScopedDb
      .select()
      .from(modules)
      .where(and(eq(modules.id, id), isNull(modules.deletedAt)));

    if (!existing) {
      throw { statusCode: 404, message: 'Module not found' };
    }

    // Phase F — §10.3: validate every slug in `onboardingWorkflowSlugs`
    // resolves to a published system or org template before writing.
    if (Array.isArray(data.onboardingWorkflowSlugs) && data.onboardingWorkflowSlugs.length > 0) {
      await this.validateOnboardingWorkflowSlugs(data.onboardingWorkflowSlugs);
    }

    const [updated] = await updateModuleScopedDb
      .update(modules)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(modules.id, id), isNull(modules.deletedAt)))
      .returning();

    return updated;
  }

  /**
   * §10.3 — validate onboarding playbook slugs resolve to at least one
   * published template (system or any org). Throws `invalid_slug: <slug>`
   * on the first unresolved slug so the admin sees the exact problem.
   */
  private async validateOnboardingWorkflowSlugs(slugs: string[]): Promise<void> {
    const deduped = Array.from(new Set(slugs));
    if (deduped.length === 0) return;

    // Collect slugs that resolve to a system template with a published version.
    const validateScopedDb = getOrgScopedDb('moduleService.validateOnboardingWorkflowSlugs');
    const sysRows = await validateScopedDb
      .select({ slug: systemWorkflowTemplates.slug })
      .from(systemWorkflowTemplates)
      .where(
        and(
          inArray(systemWorkflowTemplates.slug, deduped),
          isNull(systemWorkflowTemplates.deletedAt),
        ),
      );
    const sysResolved = new Set(sysRows.map((r) => r.slug));

    // Collect slugs that resolve to at least one org template with a published version.
    const orgRows = await validateScopedDb
      .select({ slug: workflowTemplates.slug })
      .from(workflowTemplates)
      .where(
        and(
          inArray(workflowTemplates.slug, deduped),
          isNull(workflowTemplates.deletedAt),
        ),
      );
    const orgResolved = new Set(orgRows.map((r) => r.slug));

    for (const slug of deduped) {
      if (!sysResolved.has(slug) && !orgResolved.has(slug)) {
        throw {
          statusCode: 422,
          message: `invalid_slug: ${slug}`,
          errorCode: 'invalid_slug',
        };
      }
    }
  }
}

export const moduleService = new ModuleService();
