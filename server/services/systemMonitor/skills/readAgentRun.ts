import { eq, asc } from 'drizzle-orm';
import { withAdminConnectionGuarded } from '../../../lib/rlsBoundaryGuard.js';
import { agentRuns } from '../../../db/schema/agentRuns.js';
import { agentRunMessages } from '../../../db/schema/agentRunMessages.js';
import type { SkillExecutionContext } from '../../skillExecutor.js';

const MAX_MESSAGES = 50;
const MAX_BYTES = 100_000;

export async function executeReadAgentRun(
  input: Record<string, unknown>,
  _context: SkillExecutionContext,
): Promise<unknown> {
  const agentRunId = input.agentRunId as string | undefined;
  if (!agentRunId) return { success: false, error: 'agentRunId is required' };

  try {
    return await withAdminConnectionGuarded(
      {
        source: 'system_monitor_skill_read_agent_run',
        reason: 'cross-tenant read for system-monitor diagnosis',
        allowRlsBypass: true, // allowRlsBypass: cross-tenant agent run read for system monitor diagnosis
      },
      async (tx) => {
        const runs = await tx
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.id, agentRunId))
          .limit(1);

        if (runs.length === 0) return { success: false, error: `Agent run ${agentRunId} not found` };

        const messages = await tx
          .select()
          .from(agentRunMessages)
          .where(eq(agentRunMessages.runId, agentRunId))
          .orderBy(asc(agentRunMessages.sequenceNumber))
          .limit(MAX_MESSAGES);

        // Enforce 100 KB cap on message payload.
        let totalBytes = 0;
        const cappedMessages = [];
        for (const msg of messages) {
          const msgBytes = JSON.stringify(msg).length;
          if (totalBytes + msgBytes > MAX_BYTES) break;
          cappedMessages.push(msg);
          totalBytes += msgBytes;
        }

        const truncated = cappedMessages.length < messages.length;
        return { success: true, run: runs[0], messages: cappedMessages, truncated };
      },
    );
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export const READ_AGENT_RUN_DEFINITION = {
  name: 'read_agent_run',
  description: 'Read an agent run and its message history for diagnosis. Capped at 50 messages or 100 KB.',
  input_schema: {
    type: 'object' as const,
    properties: {
      agentRunId: { type: 'string', description: 'UUID of the agent_runs row to read.' },
    },
    required: ['agentRunId'],
  },
};
