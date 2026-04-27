import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { systemMonitorBaselines } from '../../../db/schema/systemMonitorBaselines.js';
import type { SkillExecutionContext } from '../../skillExecutor.js';

export async function executeReadBaseline(
  input: Record<string, unknown>,
  _context: SkillExecutionContext,
): Promise<unknown> {
  const entityKind = input.entityKind as string | undefined;
  const entityId = input.entityId as string | undefined;
  const metric = input.metric as string | undefined;

  if (!entityKind || !entityId || !metric) {
    return { success: false, error: 'entityKind, entityId, and metric are required' };
  }

  try {
    const rows = await db
      .select()
      .from(systemMonitorBaselines)
      .where(
        and(
          eq(systemMonitorBaselines.entityKind, entityKind),
          eq(systemMonitorBaselines.entityId, entityId),
          eq(systemMonitorBaselines.metricName, metric),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return { success: true, baseline: null, message: 'No baseline found for this entity/metric combination.' };
    }

    return { success: true, baseline: rows[0] };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export const READ_BASELINE_DEFINITION = {
  name: 'read_baseline',
  description: 'Read the current baseline metrics (p50, p95, p99, mean, stddev) for an entity/metric pair.',
  input_schema: {
    type: 'object' as const,
    properties: {
      entityKind: { type: 'string', description: "Entity kind: 'agent', 'skill', 'connector', 'job_queue', or 'llm_router'.", enum: ['agent', 'skill', 'connector', 'job_queue', 'llm_router'] },
      entityId: { type: 'string', description: 'Entity identifier (e.g. agent slug, skill slug, connector ID).' },
      metric: { type: 'string', description: "Metric name (e.g. 'runtime_ms', 'output_length_chars', 'success_rate')." },
    },
    required: ['entityKind', 'entityId', 'metric'],
  },
};
