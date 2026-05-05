// FIXTURE: clean heuristic with only read-style patterns — should NOT be caught.
import { db } from '../../../server/db/index.js';
import { agentRuns } from '../../../server/db/schema/index.js';

export async function evaluate(): Promise<{ fired: boolean }> {
  const rows = await db.select().from(agentRuns).limit(1);
  return { fired: rows.length > 0 };
}
