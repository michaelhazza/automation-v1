/**
 * rlsBoundaryGuard.test.ts
 *
 * Spec: docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md §A2 Phase 3
 *
 * Six cases:
 *
 *   1. getOrgScopedDb-style write to a registered table       -> succeeds
 *   2. getOrgScopedDb-style write to an unregistered table    -> RlsBoundaryUnregistered
 *   3. getOrgScopedDb-style write to an allowlisted table     -> succeeds
 *   4. admin write to a registered table, allowRlsBypass=false -> RlsBoundaryAdminWriteToProtectedTable
 *   5. admin write to a registered table, allowRlsBypass=true  -> succeeds
 *   6. Proxy preserves return shape: chained .insert(t).values(r).returning() returns
 *      the same shape as the unwrapped handle.
 *
 * Plus production-mode no-op coverage to confirm the guard never throws under
 * NODE_ENV=production (the policy itself is the ground truth in prod).
 *
 * Run via:
 *   npx tsx server/lib/__tests__/rlsBoundaryGuard.test.ts
 */

import {
  RlsBoundaryUnregistered,
  RlsBoundaryAdminWriteToProtectedTable,
  RlsBoundaryUnresolvableTable,
  assertRlsAwareWrite,
  withOrgScopedBoundary,
  wrapWithBoundary,
  __resetAllowlistForTests,
} from '../rlsBoundaryGuard.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

// Lenient ctor type — we only care about `instanceof` checks and the `name` property.
type ErrorCtor = abstract new (...args: never[]) => Error;

function assertThrows(fn: () => unknown, ctor: ErrorCtor, msg: string): void {
  try {
    fn();
  } catch (err) {
    if (err instanceof ctor) return;
    throw new Error(`${msg}: expected ${ctor.name}, got ${err instanceof Error ? err.constructor.name : typeof err}`);
  }
  throw new Error(`${msg}: expected ${ctor.name}, but no error was thrown`);
}

function assertEqual(a: unknown, b: unknown, msg: string): void {
  if (a !== b) {
    throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function assertDeepEqual(a: unknown, b: unknown, msg: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── Force NODE_ENV != 'production' for the dev-mode test cases ─────────────

const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';

// Pin a known allowlist set for deterministic tests. `tasks` and other
// rlsProtectedTables entries come from the actual registry import — the
// guard reads `RLS_PROTECTED_TABLE_NAMES` at module load.
__resetAllowlistForTests(new Set(['legacy_audit_replica']));

// ── Mock Drizzle table objects ─────────────────────────────────────────────

function makeTable(name: string): { _: { name: string } } {
  return { _: { name } };
}

// `tasks` is a known registered table from rlsProtectedTables.ts.
const tasksTable = makeTable('tasks');
// Random unregistered name guaranteed not to be in the registry.
const unregisteredTable = makeTable('definitely_not_a_real_table_xyz');
// Allowlisted table (per the __resetAllowlistForTests stub above).
const allowlistedTable = makeTable('legacy_audit_replica');

// ── Mock Drizzle handle ────────────────────────────────────────────────────
//
// Stub handle that records calls + supports the chained-builder shape:
//   handle.insert(table).values(row).returning() -> Promise<[row]>
//
// Anything beyond .insert / .update / .delete / .select / .transaction is
// untouched — the guard must forward those verbatim.

interface CallRecord { method: 'insert' | 'update' | 'delete'; tableName: string }

function makeStubHandle(): {
  handle: {
    insert: (t: { _: { name: string } }) => { values: (row: unknown) => { returning: () => Promise<unknown[]> } };
    update: (t: { _: { name: string } }) => { set: (row: unknown) => { returning: () => Promise<unknown[]> } };
    delete: (t: { _: { name: string } }) => { where: () => { returning: () => Promise<unknown[]> } };
    select: () => string;
    other: number;
  };
  calls: CallRecord[];
} {
  const calls: CallRecord[] = [];
  const handle = {
    insert(t: { _: { name: string } }) {
      calls.push({ method: 'insert', tableName: t._.name });
      return {
        values(_row: unknown) {
          return {
            async returning() { return [{ id: 'row-1', _table: t._.name }]; },
          };
        },
      };
    },
    update(t: { _: { name: string } }) {
      calls.push({ method: 'update', tableName: t._.name });
      return {
        set(_row: unknown) {
          return { async returning() { return [{ id: 'row-1', _table: t._.name }]; } };
        },
      };
    },
    delete(t: { _: { name: string } }) {
      calls.push({ method: 'delete', tableName: t._.name });
      return {
        where() { return { async returning() { return [{ id: 'row-1', _table: t._.name }]; } }; },
      };
    },
    // Non-write methods must pass through untouched.
    select(): string { return 'select-passthrough'; },
    other: 42,
  };
  return { handle, calls };
}

// Helper: wrap a stub handle. Both `wrapWithBoundary` and `withOrgScopedBoundary`
// expect Drizzle-shaped types in their public signatures; the stub mirrors the
// handful of methods the Proxy intercepts. Cast through `unknown` to keep the
// stub-shape post-wrap so test code can still call .insert / .update / etc.
type StubHandle = ReturnType<typeof makeStubHandle>['handle'];

function wrapStubOrgScoped(handle: StubHandle, source: string): StubHandle {
  return withOrgScopedBoundary(handle as unknown as never, source) as unknown as StubHandle;
}

function wrapStubAdmin(handle: StubHandle, source: string, allowRlsBypass: boolean): StubHandle {
  return wrapWithBoundary(handle as unknown as never, {
    source,
    allowRlsBypass,
    mode: 'admin',
  }) as unknown as StubHandle;
}

// ── Case 1: getOrgScopedDb-style write to a registered table succeeds ──────

test('case 1: org-scoped write to registered table succeeds', () => {
  const { handle, calls } = makeStubHandle();
  const guarded = wrapStubOrgScoped(handle, 'test-case-1');
  // Should not throw.
  guarded.insert(tasksTable);
  assertEqual(calls.length, 1, 'insert was forwarded');
  assertEqual(calls[0].tableName, 'tasks', 'tableName forwarded unchanged');
});

// ── Case 2: getOrgScopedDb-style write to unregistered table throws ────────

test('case 2: org-scoped write to unregistered, non-allowlisted table throws RlsBoundaryUnregistered', () => {
  const { handle } = makeStubHandle();
  const guarded = wrapStubOrgScoped(handle, 'test-case-2');
  assertThrows(
    () => guarded.insert(unregisteredTable),
    RlsBoundaryUnregistered,
    'expected RlsBoundaryUnregistered',
  );
});

// ── Case 3: org-scoped write to allowlisted table succeeds ────────────────

test('case 3: org-scoped write to allowlisted table succeeds', () => {
  const { handle, calls } = makeStubHandle();
  const guarded = wrapStubOrgScoped(handle, 'test-case-3');
  guarded.insert(allowlistedTable);
  assertEqual(calls.length, 1, 'insert was forwarded');
  assertEqual(calls[0].tableName, 'legacy_audit_replica', 'allowlisted table name forwarded');
});

// ── Case 4: admin write to registered table, allowRlsBypass=false throws ───

test('case 4: admin write to registered table with allowRlsBypass=false throws RlsBoundaryAdminWriteToProtectedTable', () => {
  const { handle } = makeStubHandle();
  const guarded = wrapStubAdmin(handle, 'test-case-4', false);
  assertThrows(
    () => guarded.insert(tasksTable),
    RlsBoundaryAdminWriteToProtectedTable,
    'expected RlsBoundaryAdminWriteToProtectedTable',
  );
});

// ── Case 5: admin write to registered table, allowRlsBypass=true succeeds ──

test('case 5: admin write to registered table with allowRlsBypass=true succeeds', () => {
  const { handle, calls } = makeStubHandle();
  const guarded = wrapStubAdmin(handle, 'test-case-5', true);
  guarded.insert(tasksTable);
  assertEqual(calls.length, 1, 'insert was forwarded');
  assertEqual(calls[0].tableName, 'tasks', 'tableName forwarded under admin bypass');
});

// ── Case 6: Proxy preserves chained-builder return shape ───────────────────

test('case 6: Proxy preserves return shape — chained .insert(t).values(r).returning()', async () => {
  const { handle } = makeStubHandle();
  const raw = handle;
  const guarded = wrapStubOrgScoped(handle, 'test-case-6');

  // Same chain, same shape.
  const rawResult = await raw.insert(tasksTable).values({ a: 1 }).returning();
  const guardedResult = await guarded.insert(tasksTable).values({ a: 1 }).returning();

  assertDeepEqual(rawResult, guardedResult, 'chained .returning() result shape matches raw handle');

  // Non-write methods pass through untouched.
  assertEqual(guarded.select(), 'select-passthrough', 'select untouched');
  assertEqual(guarded.other, 42, 'arbitrary props untouched');
});

// ── Case 7: Y5 — unresolvable table name throws in dev/test ───────────────

test('case 7: write with unresolvable table name throws RlsBoundaryUnresolvableTable in dev/test', () => {
  const { handle } = makeStubHandle();
  const guarded = wrapStubOrgScoped(handle, 'test-case-7');
  // Pass an object with no `_.name`, no `name`, and no `TableName` symbol —
  // simulating a Drizzle internal-shape change that breaks extractTableName.
  const opaqueTable = { mystery: 'shape' } as unknown as { _: { name: string } };
  assertThrows(
    () => guarded.insert(opaqueTable),
    RlsBoundaryUnresolvableTable,
    'expected RlsBoundaryUnresolvableTable on insert with opaque table',
  );
  assertThrows(
    () => guarded.update(opaqueTable),
    RlsBoundaryUnresolvableTable,
    'expected RlsBoundaryUnresolvableTable on update with opaque table',
  );
  assertThrows(
    () => guarded.delete(opaqueTable),
    RlsBoundaryUnresolvableTable,
    'expected RlsBoundaryUnresolvableTable on delete with opaque table',
  );
});

// ── Production-mode no-op (extra confidence) ───────────────────────────────

test('production mode: assertRlsAwareWrite never throws on an unregistered table', () => {
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    // No throw, even though the table is unregistered + not allowlisted.
    assertRlsAwareWrite('this_table_does_not_exist_anywhere', 'prod-case');
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
});

test('production mode: wrapWithBoundary returns the handle unchanged (no proxy overhead)', () => {
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const { handle } = makeStubHandle();
    const guarded = wrapStubAdmin(handle, 'prod-no-proxy', false);
    // Identity equality — same reference, no Proxy wrapper.
    assertEqual(guarded, handle, 'handle returned unchanged in production');
    // And admin write to a protected table does NOT throw.
    guarded.insert(tasksTable);
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
});

test('production mode: wrapWithBoundary bypasses the hardened branch (returns raw handle, no proxy intercept)', () => {
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const { handle } = makeStubHandle();
    const guarded = wrapStubOrgScoped(handle, 'prod-unresolvable-bypass');
    // Identity equality is the meaningful invariant — production returns the
    // raw handle, so the guard's hardened "throw on unresolvable table" branch
    // is unreachable in prod. RLS policy itself is the prod ground truth; the
    // dev-time hardening (case 7 above) is what surfaces the gap before it
    // ships. Anything beyond identity here is a function of the underlying
    // handle's behaviour, not the guard's.
    assertEqual(guarded, handle, 'handle returned unchanged in production');
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
});

// ── assertRlsAwareWrite direct API ─────────────────────────────────────────

test('assertRlsAwareWrite: registered table passes', () => {
  // Should not throw.
  assertRlsAwareWrite('tasks', 'direct-assert');
});

test('assertRlsAwareWrite: allowlisted table passes', () => {
  assertRlsAwareWrite('legacy_audit_replica', 'direct-assert');
});

test('assertRlsAwareWrite: unregistered table throws', () => {
  assertThrows(
    () => assertRlsAwareWrite('definitely_not_a_real_table_xyz', 'direct-assert'),
    RlsBoundaryUnregistered,
    'expected RlsBoundaryUnregistered',
  );
});

// ── Restore env ────────────────────────────────────────────────────────────

process.env.NODE_ENV = originalNodeEnv;

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
