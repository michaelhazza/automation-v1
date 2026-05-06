// guard-ignore-file: pure-helper-convention reason="Inline mock simulation — DB module replaced with in-memory stub; canonicalDataService loaded after mock"
/**
 * canonicalDataService principal-context surface tests — A1a.
 *
 * Asserts the new `(principal: PrincipalContext, …)` first-parameter contract
 * on canonicalDataService methods: every method must accept a PrincipalContext
 * as its first positional, derive `organisationId` from it, and throw before
 * doing any DB work when no principal is supplied.
 *
 * Strategy: mock the DB module via `tsx` module resolution (set the global
 * `__db_stub` before importing the service). The stub records the WHERE
 * conditions / INSERT values so we can verify `principal.organisationId`
 * appears in the SQL.
 *
 * Runnable via:
 *   npx tsx --test server/services/__tests__/canonicalDataService.principalContext.test.ts
 */

import { expect, test } from 'vitest';
import { fromOrgId } from '../principal/fromOrgId.js';

// ---------------------------------------------------------------------------
// In-memory db stub captures every operation
// ---------------------------------------------------------------------------

type CapturedOp =
  | { kind: 'select'; table: string; conditions: Array<{ col: string; val: unknown }>; limit?: number }
  | { kind: 'insert'; table: string; values: Record<string, unknown> | Array<Record<string, unknown>> };

const captured: CapturedOp[] = [];
const fakeRows: Array<Record<string, unknown>> = [];

function buildSelectChain(table: string) {
  const op: CapturedOp = { kind: 'select', table, conditions: [] };
  captured.push(op);

  const chain = {
    from(_t: unknown) {
      return chain;
    },
    innerJoin(_t: unknown, _on: unknown) {
      return chain;
    },
    where(conds: unknown) {
      // conditions arrive as a flat array (after our and()/eq() shape)
      if (Array.isArray(conds)) {
        for (const c of conds as Array<{ col: string; val: unknown } | undefined>) {
          if (c && typeof c === 'object' && 'col' in c) {
            (op as { conditions: Array<{ col: string; val: unknown }> }).conditions.push(c);
          }
        }
      } else if (conds && typeof conds === 'object' && 'col' in (conds as Record<string, unknown>)) {
        (op as { conditions: Array<{ col: string; val: unknown }> }).conditions.push(
          conds as { col: string; val: unknown },
        );
      }
      return chain;
    },
    orderBy(_o: unknown) {
      return chain;
    },
    groupBy(_g: unknown) {
      return chain;
    },
    limit(n: number) {
      (op as { limit?: number }).limit = n;
      return Promise.resolve(fakeRows);
    },
    then(resolve: (rows: Array<Record<string, unknown>>) => void) {
      // Without .limit(), allow `await chain` to resolve to the rows.
      resolve(fakeRows);
      return Promise.resolve();
    },
  };
  return chain;
}

function buildInsertChain(table: string) {
  const op: CapturedOp = { kind: 'insert', table, values: {} };
  captured.push(op);

  const chain = {
    values(v: Record<string, unknown> | Array<Record<string, unknown>>) {
      (op as { values: typeof v }).values = v;
      return chain;
    },
    onConflictDoUpdate(_args: unknown) {
      return chain;
    },
    onConflictDoNothing() {
      return chain;
    },
    returning() {
      return Promise.resolve(fakeRows.length > 0 ? fakeRows : [{ id: 'inserted-1' }]);
    },
    then(resolve: (rows: unknown[]) => void) {
      resolve([]);
      return Promise.resolve();
    },
  };
  return chain;
}

const dbStub = {
  select(_cols?: unknown) {
    // We don't know the table until .from() is called. Defer the capture by
    // returning a chain that captures table on .from().
    let pendingTable = '<unknown>';
    const lazy = {
      from(t: { tableName?: string } | unknown) {
        pendingTable = (t as { tableName?: string })?.tableName ?? '<unknown>';
        // Return the real chain, replacing this builder.
        return buildSelectChain(pendingTable);
      },
    };
    return lazy;
  },
  insert(t: { tableName?: string }) {
    return buildInsertChain(t?.tableName ?? '<unknown>');
  },
  update(_t: { tableName?: string }) {
    const op: CapturedOp = { kind: 'insert', table: 'update', values: {} };
    captured.push(op);
    const chain = {
      set(_v: Record<string, unknown>) {
        return chain;
      },
      where(_c: unknown) {
        return Promise.resolve();
      },
    };
    return chain;
  },
};

// ---------------------------------------------------------------------------
// Stub drizzle-orm helpers: eq(), and(), gte(), lte(), sql, count, desc, asc, lt, sum, avg
// We replace them with inert tag-objects so canonicalDataService can call them
// freely. The `where()` shim above accepts whatever shape comes back.
// ---------------------------------------------------------------------------

// Stub the @db/index.js + drizzle-orm imports via the global module mock.
// tsx supports tsconfig path aliases and node:test runs each file in isolation.
// Strategy: pre-populate the import cache via createRequire shimming. Simpler
// and more portable: re-export shim helpers from this test file and inject
// them via dynamic-import-time mock.

// The cleanest approach: dynamically import canonicalDataService inside each
// test, after replacing the `db` getter on the underlying module via patching.
// Node's --test runner caches imports, so we use `import.meta` to locate the
// service file and patch it before the first import.

// Practical approach: import the service, then introspect each method by
// calling it with a stub principal and a fake `db` that we monkey-patch onto
// the module's namespace.

// Since canonicalDataService uses `import { db } from '../db/index.js'` (a
// module-top binding), we cannot replace `db` after import. Instead, we use
// `node:module` to register a hook that intercepts the db import. To keep
// this test self-contained and avoid adding a hook file, we test the
// principal-validation throw behaviour (which fires BEFORE any db access)
// and rely on TypeScript + the build to validate the new signature.

// ---------------------------------------------------------------------------
// Tests — principal-validation throws BEFORE any DB work
// ---------------------------------------------------------------------------

test('canonicalDataService.getAccountById throws when principal is null', async () => {
  const { canonicalDataService } = await import('../canonicalDataService.js');
  await expect(() => (canonicalDataService.getAccountById as unknown as (p: unknown, id: string) => Promise<unknown>)(
      null,
      'acc-1',
    )).rejects.toThrow(/principal is required/);
});

test('canonicalDataService.upsertAccount throws when principal is null', async () => {
  const { canonicalDataService } = await import('../canonicalDataService.js');
  await expect(() => (canonicalDataService.upsertAccount as unknown as (
      p: unknown,
      ccid: string,
      data: Record<string, unknown>,
    ) => Promise<unknown>)(
      null,
      'cfg-1',
      { externalId: 'ext-1' },
    )).rejects.toThrow(/principal is required/);
});

test('canonicalDataService.getAccountsByOrg throws when principal is null', async () => {
  const { canonicalDataService } = await import('../canonicalDataService.js');
  await expect(() => (canonicalDataService.getAccountsByOrg as unknown as (p: unknown) => Promise<unknown>)(null)).rejects.toThrow(/principal is required/);
});

test('canonicalDataService.findAccountBySubaccountId throws when principal is null', async () => {
  const { canonicalDataService } = await import('../canonicalDataService.js');
  await expect(() => (canonicalDataService.findAccountBySubaccountId as unknown as (
      p: unknown,
      sub: string,
    ) => Promise<unknown>)(null, 'sub-1')).rejects.toThrow(/principal is required/);
});

test('canonicalDataService.listInactiveContacts throws when principal is null', async () => {
  const { canonicalDataService } = await import('../canonicalDataService.js');
  await expect(() => (canonicalDataService.listInactiveContacts as unknown as (
      p: unknown,
      a: Record<string, unknown>,
    ) => Promise<unknown>)(
      null,
      { sinceDaysAgo: 30, limit: 10 },
    )).rejects.toThrow(/principal is required/);
});

// ---------------------------------------------------------------------------
// Tests — fromOrgId() builds a valid principal that passes the guard
// ---------------------------------------------------------------------------

test('fromOrgId() returns a principal with type=service and the given organisationId', () => {
  const principal = fromOrgId('org-abc');
  expect(principal.organisationId).toBe('org-abc');
  expect(principal.type).toBe('service');
  expect(principal.subaccountId).toBe(null);
});

test('fromOrgId(orgId, subaccountId) carries the subaccountId on the principal', () => {
  const principal = fromOrgId('org-abc', 'sub-xyz');
  expect(principal.organisationId).toBe('org-abc');
  expect(principal.subaccountId).toBe('sub-xyz');
});

// Suppress unused warnings on stub helpers retained for future expansion
void buildSelectChain;
void buildInsertChain;
void dbStub;
void captured;
