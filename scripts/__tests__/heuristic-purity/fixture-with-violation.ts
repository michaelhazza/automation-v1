// FIXTURE: heuristic with a DB mutation call — should be caught by the gate.
// This is a deliberate violation. Do not add guard-ignore-next-line or
// suppression annotations here (per DEVELOPMENT_GUIDELINES.md §5.4 fixture rule).
import { db } from '../../../server/db/index.js';
import { systemMonitorHeuristicFires } from '../../../server/db/schema/index.js';

export async function evaluate(): Promise<void> {
  // VIOLATION: heuristic writing directly to the DB — forbidden by spec §6.2
  await db.insert(systemMonitorHeuristicFires).values({});
}
