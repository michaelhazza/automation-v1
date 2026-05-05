// FIXTURE: service file using a registered event type — should NOT be caught.
import { db } from '../../../server/db/index.js';
import { systemIncidentEvents } from '../../../server/db/schema/index.js';

export async function emitKnownEvent(incidentId: string): Promise<void> {
  await db.insert(systemIncidentEvents).values({
    incidentId,
    eventType: 'ack',  // registered in canonical file — OK
    actorKind: 'user',
    payload: {},
    occurredAt: new Date(),
  });
}
