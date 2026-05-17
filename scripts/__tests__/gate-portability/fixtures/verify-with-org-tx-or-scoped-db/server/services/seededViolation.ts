import { db } from '../../db/index.js';
import { tasks } from '../../db/schema/index.js';

// Deliberately unscoped db call — fixture for gate-portability harness
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function seededViolation(_orgId: string) {
  return db.select().from(tasks);
}
