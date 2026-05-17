import { eq, and, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agents, subaccountAgents, subaccounts, systemAgents } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

export interface SupportAgentInstallService {
  install(input: {
    subaccountId: string;
    organisationId: string;
    actorUserId: string;
  }): Promise<{ subaccountAgentId: string }>;
}

export const supportAgentInstallService: SupportAgentInstallService = {
  async install({ subaccountId, organisationId, actorUserId }) {
    const installScopedDb = getOrgScopedDb('supportAgentInstallService.install');
    // 1. Look up the support-agent system_agents row
    const [systemAgent] = await installScopedDb
      .select({ id: systemAgents.id, slug: systemAgents.slug, defaultSystemSkillSlugs: systemAgents.defaultSystemSkillSlugs })
      .from(systemAgents)
      .where(eq(systemAgents.slug, 'support-agent'))
      .limit(1);

    if (!systemAgent) {
      throw { statusCode: 500, errorCode: 'system_agent_missing', message: 'Support Agent system agent is not seeded' };
    }

    // 2. Verify the subaccount belongs to this org
    const [subaccount] = await installScopedDb
      .select({ id: subaccounts.id })
      .from(subaccounts)
      .where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, organisationId)))
      .limit(1);

    if (!subaccount) {
      throw { statusCode: 404, errorCode: 'subaccount_not_found', message: 'Subaccount not found in this organisation' };
    }

    // 3. Open a DB transaction; acquire advisory lock inside it
    try {
      const result = await installScopedDb.transaction(async (tx) => {
        // 4. Advisory lock — transaction-scoped, prevents concurrent installs for same (subaccount, systemAgent)
        const lockKey = `${subaccountId}:${systemAgent.id}`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

        // 5. Check if already installed
        const [existing] = await tx
          .select({ id: subaccountAgents.id })
          .from(subaccountAgents)
          .where(
            and(
              eq(subaccountAgents.subaccountId, subaccountId),
              eq(subaccountAgents.organisationId, organisationId),
              eq(subaccountAgents.appliedTemplateSlug, 'support-agent'),
              eq(subaccountAgents.isActive, true),
            ),
          )
          .limit(1);

        // 6. Already installed — throw 409
        if (existing) {
          throw { statusCode: 409, errorCode: 'already_installed', message: 'Support Agent already installed for this subaccount' };
        }

        // 7. Create the agents row for this org's instance of the support agent
        const agentSlug = `support-agent-${subaccountId.slice(0, 8)}`;

        const [agentRow] = await tx
          .insert(agents)
          .values({
            organisationId,
            systemAgentId: systemAgent.id,
            isSystemManaged: true,
            name: 'Support Agent',
            slug: agentSlug,
            description: 'AI-powered support agent that classifies tickets, drafts replies, and routes to humans when needed.',
            masterPrompt: '',
            additionalPrompt: '',
            defaultSkillSlugs: systemAgent.defaultSystemSkillSlugs ?? [],
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({ id: agents.id });

        // Insert the subaccount_agents link with applied_template_slug
        const [link] = await tx
          .insert(subaccountAgents)
          .values({
            organisationId,
            subaccountId,
            agentId: agentRow.id,
            isActive: true,
            appliedTemplateSlug: 'support-agent',
            skillSlugs: systemAgent.defaultSystemSkillSlugs ?? [],
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({ id: subaccountAgents.id });

        return { subaccountAgentId: link.id };
      });

      logger.info('support_agent_installed', {
        subaccountId,
        organisationId,
        actorUserId,
        subaccountAgentId: result.subaccountAgentId,
      });

      return result;
    } catch (err: unknown) {
      // 8. Catch unique index violation from partial index (23505) → 409
      const e = err as { code?: string; statusCode?: number };
      if (e.code === '23505') {
        throw { statusCode: 409, errorCode: 'already_installed', message: 'Support Agent already installed for this subaccount' };
      }
      throw err;
    }
  },
};
