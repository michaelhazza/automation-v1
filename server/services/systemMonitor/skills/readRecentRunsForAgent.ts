import { eq, desc, and } from 'drizzle-orm';
import { withAdminConnectionGuarded } from '../../../lib/rlsBoundaryGuard.js';
import { agentRuns } from '../../../db/schema/agentRuns.js';
import { agents } from '../../../db/schema/agents.js';
import type { SkillExecutionContext } from '../../skillExecutor.js';

const MAX_RUNS = 20;

export async function executeReadRecentRunsForAgent(
  input: Record<string, unknown>,
  _context: SkillExecutionContext,
): Promise<unknown> {
  const agentId = input.agentId as string | undefined;
  const agentSlug = input.agentSlug as string | undefined;

  if (!agentId && !agentSlug) return { success: false, error: 'agentId or agentSlug is required' };

  try {
    return await withAdminConnectionGuarded(
      {
        source: 'system_monitor_skill_read_recent_runs',
        reason: 'cross-tenant read for system-monitor agent run summary',
        allowRlsBypass: true, // allowRlsBypass: cross-tenant agent run summary for system monitor diagnosis
      },
      async (tx) => {
        let resolvedAgentId = agentId;

        if (!resolvedAgentId && agentSlug) {
          // Slug is unique per-org but not globally. For system-managed agents the slug
          // is de-facto unique — look up the is_system_managed row.
          const agentRows = await tx
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.slug, agentSlug), eq(agents.isSystemManaged, true)))
            .limit(1);
          if (agentRows.length === 0) return { success: false, error: `No system-managed agent found with slug '${agentSlug}'` };
          resolvedAgentId = agentRows[0]!.id;
        }

        const runs = await tx
          .select({
            id: agentRuns.id,
            organisationId: agentRuns.organisationId,
            status: agentRuns.status,
            runResultStatus: agentRuns.runResultStatus,
            runType: agentRuns.runType,
            createdAt: agentRuns.createdAt,
            updatedAt: agentRuns.updatedAt,
            errorMessage: agentRuns.errorMessage,
          })
          .from(agentRuns)
          .where(eq(agentRuns.agentId, resolvedAgentId!))
          .orderBy(desc(agentRuns.createdAt))
          .limit(MAX_RUNS);

        return { success: true, runs };
      },
    );
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export const READ_RECENT_RUNS_FOR_AGENT_DEFINITION = {
  name: 'read_recent_runs_for_agent',
  description: 'Read the last 20 runs for an agent (summary fields only, no messages).',
  input_schema: {
    type: 'object' as const,
    properties: {
      agentId: { type: 'string', description: 'UUID of the agent. Preferred over agentSlug.' },
      agentSlug: { type: 'string', description: 'Slug of a system-managed agent. Used if agentId is unavailable.' },
    },
    required: [],
  },
};
