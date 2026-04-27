import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { systemIncidentEvents } from '../../../db/schema/systemIncidentEvents.js';
import type { SystemIncidentEventType } from '../../../db/schema/systemIncidentEvents.js';
import type { SkillExecutionContext } from '../../skillExecutor.js';

// Allowed event types the system-monitor agent may write.
// Narrower than the full SystemIncidentEventType union — does not allow lifecycle
// transitions (status_change, ack, resolve) which are human-initiated only.
const ALLOWED_TYPES = new Set<SystemIncidentEventType>([
  'diagnosis',
  'note',
  'escalation_blocked',
]);

export async function executeWriteEvent(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const incidentId = input.incidentId as string | undefined;
  const eventType = input.eventType as string | undefined;
  const agentRunId = input.agentRunId as string | undefined;
  const payload = input.payload as Record<string, unknown> | undefined;

  if (!incidentId) return { success: false, error: 'incidentId is required' };
  if (!eventType) return { success: false, error: 'eventType is required' };
  if (!ALLOWED_TYPES.has(eventType as SystemIncidentEventType)) {
    return { success: false, error: `eventType '${eventType}' is not allowed. Allowed: ${[...ALLOWED_TYPES].join(', ')}` };
  }

  try {
    // Idempotency: skip if an event with the same (incidentId, eventType, actorAgentRunId) exists.
    if (agentRunId) {
      const existing = await db
        .select({ id: systemIncidentEvents.id })
        .from(systemIncidentEvents)
        .where(
          and(
            eq(systemIncidentEvents.incidentId, incidentId),
            eq(systemIncidentEvents.eventType, eventType as SystemIncidentEventType),
            eq(systemIncidentEvents.actorAgentRunId, agentRunId),
          ),
        )
        .limit(1);

      if (existing.length > 0) return { success: true, skipped: true };
    }

    await db.insert(systemIncidentEvents).values({
      incidentId,
      eventType: eventType as SystemIncidentEventType,
      actorKind: 'agent',
      actorAgentRunId: agentRunId ?? null,
      payload: payload ?? null,
      correlationId: context.runId,
      occurredAt: new Date(),
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export const WRITE_EVENT_DEFINITION = {
  name: 'write_event',
  description: "Append a system incident event of an allowed type ('diagnosis', 'note', 'escalation_blocked'). Idempotent on (incidentId, eventType, agentRunId).",
  input_schema: {
    type: 'object' as const,
    properties: {
      incidentId: { type: 'string', description: 'UUID of the incident to append an event to.' },
      eventType: { type: 'string', description: "Event type to write. Allowed: 'diagnosis', 'note', 'escalation_blocked'.", enum: ['diagnosis', 'note', 'escalation_blocked'] },
      agentRunId: { type: 'string', description: 'UUID of the agent run writing this event (used for idempotency).' },
      payload: { type: 'object', description: 'Optional structured payload for the event.' },
    },
    required: ['incidentId', 'eventType'],
  },
};
