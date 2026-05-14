/**
 * Fixture: passing.ts
 *
 * db.select() is inside a function (queryRecords) that is called directly
 * from within a withOrgTx(...) callback. The analyser's single-level caller
 * walk detects this and should NOT flag it as a violation.
 */

// Minimal db stub for fixture purposes (does not import real DB).
const db = {
  select: () => ({ from: () => Promise.resolve([]) }),
};

const records = { tableName: 'records' };

// queryRecords calls db.select() directly. The analyser flags every db.<method>
// call and then checks whether the enclosing function is reached via withOrgTx.
// This fixture's whole point is the success case — the enclosing function IS
// called via withOrgTx, so the violation should be suppressed.
async function queryRecords(): Promise<unknown[]> {
  return db.select().from(records);
}

// withOrgTx stub — in production this sets the org-scoped RLS session var.
async function withOrgTx<T>(orgId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return fn(db);
}

// Caller: queryRecords is called inside a withOrgTx callback → passes gate.
export async function getRecordsForOrg(orgId: string): Promise<unknown[]> {
  return withOrgTx(orgId, async () => queryRecords());
}
