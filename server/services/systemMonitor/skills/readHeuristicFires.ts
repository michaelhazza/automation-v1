import { and, eq, desc } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { systemMonitorHeuristicFires } from '../../../db/schema/systemMonitorHeuristicFires.js';
import type { SkillExecutionContext } from '../../skillExecutor.js';

const MAX_FIRES = 20;

export async function executeReadHeuristicFires(
  input: Record<string, unknown>,
  _context: SkillExecutionContext,
): Promise<unknown> {
  const entityKind = input.entityKind as string | undefined;
  const entityId = input.entityId as string | undefined;
  const limit = Math.min(Number(input.limit ?? MAX_FIRES), MAX_FIRES);

  if (!entityKind || !entityId) {
    return { success: false, error: 'entityKind and entityId are required' };
  }

  try {
    const fires = await db
      .select()
      .from(systemMonitorHeuristicFires)
      .where(
        and(
          eq(systemMonitorHeuristicFires.entityKind, entityKind),
          eq(systemMonitorHeuristicFires.entityId, entityId),
        ),
      )
      .orderBy(desc(systemMonitorHeuristicFires.firedAt))
      .limit(limit);

    return { success: true, fires };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export const READ_HEURISTIC_FIRES_DEFINITION = {
  name: 'read_heuristic_fires',
  description: 'Read recent heuristic fire records for an entity. Capped at 20.',
  input_schema: {
    type: 'object' as const,
    properties: {
      entityKind: { type: 'string', description: "Entity kind: 'agent_run', 'job', 'skill_execution', 'connector_poll', or 'llm_call'." },
      entityId: { type: 'string', description: 'Entity identifier (e.g. agent run UUID).' },
      limit: { type: 'string', description: 'Max results to return (default 20, max 20).' },
    },
    required: ['entityKind', 'entityId'],
  },
};
