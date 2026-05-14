/**
 * Fixture: name-collision-unsafe.ts
 *
 * Regression case for the F1 fix (chatgpt-pr-review Round 1, PR #307):
 * an unsafe db.select() in `fetchAll` should NOT be marked safe just because
 * an unrelated `fetchAll` (in name-collision-safe.ts) is called inside a
 * withOrgTx wrapper.
 *
 * The analyser MUST consider only same-file caller walks; otherwise two
 * files with same-named functions can mask each other's violations.
 */

const db = {
  select: () => ({ from: () => Promise.resolve([]) }),
};

const records = { tableName: 'records' };

// Same name as the wrapped function in name-collision-safe.ts, but UNSAFE:
// nothing in THIS file wraps fetchAll() in withOrgTx.
export async function fetchAll(): Promise<unknown[]> {
  return db.select().from(records);
}
