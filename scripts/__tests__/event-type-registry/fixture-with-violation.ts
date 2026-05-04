// FIXTURE: service file using an unregistered event type — should be caught.
// Do not add suppression annotations (per DEVELOPMENT_GUIDELINES.md §5.4).
import { db } from '../../../server/db/index.js';
import { systemIncidentEvents } from '../../../server/db/schema/index.js';

export async function emitUnknownEvent(incidentId: string): Promise<void> {
  await db.insert(systemIncidentEvents).values({
    incidentId,
    eventType: 'totally_unknown_event_xyz',  // VIOLATION: not in canonical registry
    actorKind: 'agent',
    payload: {},
    occurredAt: new Date(),
  });
}
