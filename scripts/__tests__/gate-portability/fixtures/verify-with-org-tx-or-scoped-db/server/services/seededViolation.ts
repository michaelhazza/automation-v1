import { db } from '../../db/index.js';
import { tasks } from '../../db/schema/index.js';

// Deliberately unscoped db call — fixture for gate-portability harness
export async function seededViolation(orgId: string) {
  return db.select().from(tasks);
}
