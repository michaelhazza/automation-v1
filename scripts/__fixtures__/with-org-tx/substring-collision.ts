/**
 * Fixture: substring-collision.ts
 *
 * Regression case for the T5 fix (chatgpt-pr-review Round 2, PR #307):
 * the analyser must NOT treat substring matches (or identifier mentions
 * in comments / string literals) as evidence that a function is wrapped
 * in withOrgTx. Only AST identifier nodes count.
 *
 * Here `load()` makes an unsafe db.select() call. The withOrgTx wrapper
 * below calls `loadAll()` — a DIFFERENT function whose name happens to
 * contain `load` as a substring. The comment also mentions `load` as a
 * word. Pre-fix substring matching would mark `load()` as safe.
 */

const db = {
  select: () => ({ from: () => Promise.resolve([]) }),
};

const records = { tableName: 'records' };

// Unsafe: db.select() inside `load()` with no withOrgTx wrapper for `load`.
// Exported so eslint's no-unused-vars accepts it; the analyser still flags the
// inner db.select() because no withOrgTx(...) call in this file references `load`.
export async function load(): Promise<unknown[]> {
  return db.select().from(records);
}

async function loadAll(): Promise<unknown[]> {
  return db.select().from(records);
}

async function withOrgTx<T>(orgId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return fn(db);
}

// withOrgTx wraps `loadAll` and the comment references `load` — neither should
// mark the unrelated `load()` above as scoped.
export async function entry(orgId: string): Promise<unknown[]> {
  return withOrgTx(orgId, async () => {
    // Reminder: maybe also call load() in a follow-up.
    return loadAll();
  });
}
