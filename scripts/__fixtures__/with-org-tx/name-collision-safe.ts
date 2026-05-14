/**
 * Fixture: name-collision-safe.ts
 *
 * Companion to name-collision-unsafe.ts. Defines a function called `fetchAll`
 * that IS wrapped in withOrgTx. The analyser's old behaviour (cross-file
 * name match) would let this file's wrapper hide the violation in
 * name-collision-unsafe.ts.
 *
 * Post-F1 fix: caller-walk is constrained to the declaring file, so this file
 * cannot affect the verdict for name-collision-unsafe.ts.
 */

const db = {
  select: () => ({ from: () => Promise.resolve([]) }),
};

const records = { tableName: 'records' };

// Different declaration, same name as in name-collision-unsafe.ts.
async function fetchAll(): Promise<unknown[]> {
  return db.select().from(records);
}

async function withOrgTx<T>(orgId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return fn(db);
}

// This file's fetchAll IS safe — wrapped in withOrgTx.
export async function getAllForOrg(orgId: string): Promise<unknown[]> {
  return withOrgTx(orgId, async () => fetchAll());
}
