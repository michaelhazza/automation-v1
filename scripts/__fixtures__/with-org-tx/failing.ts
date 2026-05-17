/**
 * Fixture: failing.ts
 *
 * db.select() is inside a function (queryRecords) that is NOT called via
 * withOrgTx or getOrgScopedDb. The analyser should flag this as a violation.
 */

// Minimal db stub for fixture purposes (does not import real DB).
const db = {
  select: () => ({ from: () => Promise.resolve([]) }),
};

const records = { tableName: 'records' };

async function fetchAllRecordsUnscoped(): Promise<unknown[]> {
  return db.select().from(records);
}

// Direct caller — NOT wrapped in withOrgTx → should be flagged.
export async function getRecordsDirectly(): Promise<unknown[]> {
  return fetchAllRecordsUnscoped();
}
