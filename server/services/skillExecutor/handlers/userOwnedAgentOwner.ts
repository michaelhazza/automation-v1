import type { SkillExecutionContext } from '../context.js';

export async function resolveAgentOwner(context: SkillExecutionContext): Promise<string> {
  const { db: agentDb } = await import('../../../db/index.js');
  const { agents: agentsTable } = await import('../../../db/schema/agents.js');
  const { eq: eqOp } = await import('drizzle-orm');
  const [agent] = await agentDb
    .select({ ownerUserId: agentsTable.ownerUserId })
    .from(agentsTable)
    .where(eqOp(agentsTable.id, context.agentId))
    .limit(1);
  if (!agent?.ownerUserId) {
    throw Object.assign(
      new Error('Agent has no owner; this skill requires a user-owned agent'),
      { statusCode: 422, errorCode: 'AGENT_NO_OWNER' },
    );
  }
  return agent.ownerUserId;
}
