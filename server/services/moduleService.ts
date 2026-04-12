import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { modules, subscriptions, orgSubscriptions } from '../db/schema/index.js';
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
    const [orgSub] = await db
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
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(
        and(eq(subscriptions.id, orgSub.subscriptionId), isNull(subscriptions.deletedAt)),
      );

    if (!sub || !sub.moduleIds || sub.moduleIds.length === 0) return new Set<string>();

    // 3. Load modules
    const linkedModules = await db
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
    const [orgSub] = await db
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
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(
        and(eq(subscriptions.id, orgSub.subscriptionId), isNull(subscriptions.deletedAt)),
      );

    if (!sub || !sub.moduleIds || sub.moduleIds.length === 0) return [];

    // 3. Load modules
    const linkedModules = await db
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
    return db.select().from(modules).where(isNull(modules.deletedAt));
  }

  async getModule(id: string): Promise<Module> {
    const [row] = await db
      .select()
      .from(modules)
      .where(and(eq(modules.id, id), isNull(modules.deletedAt)));

    if (!row) {
      throw { statusCode: 404, message: 'Module not found' };
    }
    return row;
  }

  async createModule(data: Omit<NewModule, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Module> {
    const now = new Date();
    const [row] = await db
      .insert(modules)
      .values({ ...data, createdAt: now, updatedAt: now })
      .returning();
    return row;
  }

  async updateModule(
    id: string,
    data: Partial<Omit<NewModule, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
  ): Promise<Module> {
    const [existing] = await db
      .select()
      .from(modules)
      .where(and(eq(modules.id, id), isNull(modules.deletedAt)));

    if (!existing) {
      throw { statusCode: 404, message: 'Module not found' };
    }

    const [updated] = await db
      .update(modules)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(modules.id, id), isNull(modules.deletedAt)))
      .returning();

    return updated;
  }
}

export const moduleService = new ModuleService();
