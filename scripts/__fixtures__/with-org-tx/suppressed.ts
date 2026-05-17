/**
 * Fixture: suppressed.ts
 *
 * Same pattern as failing.ts, but the db.select() call has a per-line
 * suppression comment. The analyser should NOT flag it as a violation.
 */

// Minimal db stub for fixture purposes (does not import real DB).
const db = {
  select: () => ({ from: () => Promise.resolve([]) }),
};

const records = { tableName: 'records' };

async function queryRecordsDirectly(): Promise<unknown[]> {
  return db.select().from(records); // guard-ignore: with-org-tx-or-scoped-db ADR-XX bootstrap-query runs before org context is resolved
}

export async function getBootstrapRecords(): Promise<unknown[]> {
  return queryRecordsDirectly();
}
