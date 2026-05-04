import { eq, asc } from 'drizzle-orm';
import { withAdminConnectionGuarded } from '../../../lib/rlsBoundaryGuard.js';
import { agentRunMessages } from '../../../db/schema/agentRunMessages.js';
import type { SkillExecutionContext } from '../../skillExecutor.js';

// Skill executions are stored as tool_use/tool_result pairs in agent_run_messages.
// We identify them by toolCallId (the stable identifier per tool call).

export async function executeReadSkillExecution(
  input: Record<string, unknown>,
  _context: SkillExecutionContext,
): Promise<unknown> {
  const toolCallId = input.toolCallId as string | undefined;
  if (!toolCallId) return { success: false, error: 'toolCallId is required' };

  try {
    return await withAdminConnectionGuarded(
      {
        source: 'system_monitor_skill_read_skill_execution',
        reason: 'cross-tenant read for system-monitor skill execution diagnosis',
        allowRlsBypass: true, // allowRlsBypass: cross-tenant skill execution read for system monitor diagnosis
      },
      async (tx) => {
        const messages = await tx
          .select()
          .from(agentRunMessages)
          .where(eq(agentRunMessages.toolCallId, toolCallId))
          .orderBy(asc(agentRunMessages.sequenceNumber))
          .limit(2); // tool_use + tool_result pair

        if (messages.length === 0) {
          return { success: false, error: `No messages found for toolCallId ${toolCallId}` };
        }

        return { success: true, messages };
      },
    );
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export const READ_SKILL_EXECUTION_DEFINITION = {
  name: 'read_skill_execution',
  description: 'Read the tool_use/tool_result message pair for a skill execution by tool call ID.',
  input_schema: {
    type: 'object' as const,
    properties: {
      toolCallId: { type: 'string', description: 'The tool call ID identifying the skill execution.' },
    },
    required: ['toolCallId'],
  },
};
