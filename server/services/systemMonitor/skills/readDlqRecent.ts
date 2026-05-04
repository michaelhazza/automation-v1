import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { SkillExecutionContext } from '../../skillExecutor.js';

const MAX_DLQ_ROWS = 20;

export async function executeReadDlqRecent(
  input: Record<string, unknown>,
  _context: SkillExecutionContext,
): Promise<unknown> {
  const queueName = input.queueName as string | undefined;
  const limit = Math.min(Number(input.limit ?? MAX_DLQ_ROWS), MAX_DLQ_ROWS);

  try {
    const rows = await db.execute<{
      name: string;
      id: string;
      state: string;
      createdon: string;
      completedon: string | null;
      data: unknown;
      output: unknown;
    }>(sql`
      SELECT
        name,
        id::text,
        state,
        createdon::text,
        completedon::text,
        data,
        output
      FROM pgboss.job
      WHERE name LIKE '%__dlq'
        ${queueName ? sql`AND name = ${queueName}` : sql``}
        AND state IN ('failed', 'completed')
      ORDER BY createdon DESC
      LIMIT ${limit}
    `);

    return { success: true, jobs: rows };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export const READ_DLQ_RECENT_DEFINITION = {
  name: 'read_dlq_recent',
  description: 'Read recent DLQ (dead-letter queue) jobs from pg-boss. Capped at 20 rows.',
  input_schema: {
    type: 'object' as const,
    properties: {
      queueName: { type: 'string', description: "Optional specific DLQ queue name (e.g. 'agent-scheduled-run__dlq'). Omit to query all DLQs." },
      limit: { type: 'string', description: 'Max results to return (default 20, max 20).' },
    },
    required: [],
  },
};
