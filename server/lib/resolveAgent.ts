// guard-ignore: with-org-tx-or-scoped-db reason="lib helper — orgId resolved by caller; called within withOrgTx context"
import { db } from '../db/index.js';
import { agents } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';

/**
 * Validates that an agent exists and belongs to the given organisation.
 * Throws { statusCode: 404 } if not found or soft-deleted.
 */
export async function resolveAgent(agentId: string, organisationId: string) {
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));

  if (!agent) throw { statusCode: 404, message: 'Agent not found' };
  return agent;
}
