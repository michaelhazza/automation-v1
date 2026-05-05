import { and, eq, desc } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { systemIncidents } from '../../../db/schema/systemIncidents.js';
import { systemIncidentEvents } from '../../../db/schema/systemIncidentEvents.js';
import type { SkillExecutionContext } from '../../skillExecutor.js';

const MAX_EVENTS = 20;

// @rls-allowlist-bypass: system_incidents executeReadIncident [ref: spec §3.3.1]
export async function executeReadIncident(
  input: Record<string, unknown>,
  _context: SkillExecutionContext,
): Promise<unknown> {
  const incidentId = input.incidentId as string | undefined;
  if (!incidentId) return { success: false, error: 'incidentId is required' };

  try {
    const incidents = await db
      .select()
      .from(systemIncidents)
      .where(eq(systemIncidents.id, incidentId))
      .limit(1);

    if (incidents.length === 0) return { success: false, error: `Incident ${incidentId} not found` };

    const events = await db
      .select()
      .from(systemIncidentEvents)
      .where(eq(systemIncidentEvents.incidentId, incidentId))
      .orderBy(desc(systemIncidentEvents.occurredAt))
      .limit(MAX_EVENTS);

    return { success: true, incident: incidents[0], events: events.reverse() };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export const READ_INCIDENT_DEFINITION = {
  name: 'read_incident',
  description: 'Read a system incident row and its last 20 events for diagnosis context.',
  input_schema: {
    type: 'object' as const,
    properties: {
      incidentId: { type: 'string', description: 'UUID of the system_incidents row to read.' },
    },
    required: ['incidentId'],
  },
};
