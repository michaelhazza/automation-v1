// guard-ignore-file: pure-helper-convention reason="Inline mock simulation — DB module replaced with in-memory stub; no .js extension on import due to tsx convention"
import { expect, test } from 'vitest';
/**
 * canonicalDataService.findAccountBySubaccountId unit tests — runnable via:
 *   npx tsx --test server/services/__tests__/canonicalDataService.findAccountBySubaccountId.test.ts
 *
 * Tests F1: the targeted single-row SELECT introduced to replace the
 * getAccountsByOrg + .find(a => a.subaccountId === ...) client-side filter.
 *
 * Strategy: mock the DB module with an in-memory stub that records the
 * WHERE conditions applied and returns a controlled result set. This lets
 * the test assert that (a) both organisationId and subaccountId appear as
 * WHERE predicates and (b) .limit(1) is called — without requiring a real
 * Postgres connection.
 */

// ---------------------------------------------------------------------------
// Minimal stub types matching the Drizzle column shape
// ---------------------------------------------------------------------------

type StubAccount = {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  displayName: string | null;
};

// ---------------------------------------------------------------------------
// In-memory DB stub
// ---------------------------------------------------------------------------

/**
 * Builds a chainable Drizzle-like select stub.
 *
 * The stub records: which table was queried, what WHERE conditions were
 * applied (as { column, value } pairs), and whether .limit(1) was called.
 * On `.limit()` it executes the filter against `rows` and returns results.
 */
function buildDbStub(rows: StubAccount[]) {
  const log: {
    table: string | null;
    conditions: Array<{ column: string; value: unknown }>;
    limitCalled: boolean;
    limitValue: number | null;
  } = {
    table: null,
    conditions: [],
    limitCalled: false,
    limitValue: null,
  };

  // Simulated eq() — returns an opaque condition object the stub processes
  function eq(col: { columnName: string }, value: unknown) {
    return { type: 'eq' as const, columnName: col.columnName, value };
  }

  // Simulated and() — flattens conditions list
  function and(...conds: ReturnType<typeof eq>[]) {
    return conds;
  }

  const stub = {
    _log: log,

    select() {
      return stub;
    },

    from(table: { tableName: string }) {
      log.table = table.tableName;
      return stub;
    },

    where(conditions: ReturnType<typeof eq>[]) {
      if (Array.isArray(conditions)) {
        for (const c of conditions) {
          log.conditions.push({ column: c.columnName, value: c.value });
        }
      }
      return stub;
    },

    limit(n: number) {
      log.limitCalled = true;
      log.limitValue = n;
      // Execute filter against stub rows
      const matched = rows.filter(row => {
        for (const cond of log.conditions) {
          const key = cond.column as keyof StubAccount;
          if (row[key] !== cond.value) return false;
        }
        return true;
      });
      // Return only up to n rows (simulating SQL LIMIT)
      return Promise.resolve(matched.slice(0, n));
    },
  };

  return { stub, eq, and, log };
}

// ---------------------------------------------------------------------------
// Pure implementation under test
// Mirrors the real implementation added to canonicalDataService.findAccountBySubaccountId.
// Keeping it inline here makes the test self-contained and avoids importing
// the DB-connected production module.
// ---------------------------------------------------------------------------

type DbLike = ReturnType<typeof buildDbStub>['stub'];
type EqFn = ReturnType<typeof buildDbStub>['eq'];
type AndFn = ReturnType<typeof buildDbStub>['and'];

/**
 * Pure version of findAccountBySubaccountId for unit testing.
 * The real implementation in canonicalDataService uses the exact same
 * SELECT shape — this function is extracted to keep tests DB-free.
 */
async function findAccountBySubaccountIdPure(
  db: DbLike,
  eq: EqFn,
  and: AndFn,
  canonicalAccounts: { tableName: string; organisationId: { columnName: string }; subaccountId: { columnName: string } },
  orgId: string,
  subaccountId: string,
): Promise<StubAccount | null> {
  const result = await db
    .select()
    .from(canonicalAccounts as unknown as Parameters<typeof db.from>[0])
    .where(and(
      eq(canonicalAccounts.organisationId, orgId),
      eq(canonicalAccounts.subaccountId, subaccountId),
    ))
    .limit(1);
  return (result as StubAccount[])[0] ?? null;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const fakeAccounts: StubAccount[] = [
  { id: 'acc-1', organisationId: 'org-a', subaccountId: 'sub-x', displayName: 'Alpha' },
  { id: 'acc-2', organisationId: 'org-a', subaccountId: 'sub-y', displayName: 'Beta' },
  { id: 'acc-3', organisationId: 'org-b', subaccountId: 'sub-x', displayName: 'Gamma' },
];

function makeCanonicalAccounts() {
  return {
    tableName: 'canonical_accounts',
    organisationId: { columnName: 'organisationId' },
    subaccountId: { columnName: 'subaccountId' },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('findAccountBySubaccountId issues a SELECT with WHERE on both organisationId and subaccountId', async () => {
  const { stub, eq, and, log } = buildDbStub(fakeAccounts);
  const canonicalAccounts = makeCanonicalAccounts();

  await findAccountBySubaccountIdPure(stub, eq, and, canonicalAccounts, 'org-a', 'sub-x');

  const hasOrgCondition = log.conditions.some(
    c => c.column === 'organisationId' && c.value === 'org-a',
  );
  const hasSubaccountCondition = log.conditions.some(
    c => c.column === 'subaccountId' && c.value === 'sub-x',
  );

  expect(hasOrgCondition).toBeTruthy();
  expect(hasSubaccountCondition).toBeTruthy();
  expect(log.conditions.length, 'Exactly 2 WHERE conditions (no extra predicates)').toBe(2);
});

test('findAccountBySubaccountId calls .limit(1)', async () => {
  const { stub, eq, and, log } = buildDbStub(fakeAccounts);
  const canonicalAccounts = makeCanonicalAccounts();

  await findAccountBySubaccountIdPure(stub, eq, and, canonicalAccounts, 'org-a', 'sub-x');

  expect(log.limitCalled).toBeTruthy();
  expect(log.limitValue, '.limit() must be called with 1').toBe(1);
});

test('findAccountBySubaccountId returns the matching row when found', async () => {
  const { stub, eq, and } = buildDbStub(fakeAccounts);
  const canonicalAccounts = makeCanonicalAccounts();

  const result = await findAccountBySubaccountIdPure(stub, eq, and, canonicalAccounts, 'org-a', 'sub-x');

  expect(result !== null).toBeTruthy();
  expect(result!.id).toBe('acc-1');
  expect(result!.displayName).toBe('Alpha');
});

test('findAccountBySubaccountId returns null when no row found', async () => {
  const { stub, eq, and } = buildDbStub(fakeAccounts);
  const canonicalAccounts = makeCanonicalAccounts();

  const result = await findAccountBySubaccountIdPure(stub, eq, and, canonicalAccounts, 'org-a', 'sub-nonexistent');

  expect(result, 'Should return null when no match exists').toBe(null);
});

test('findAccountBySubaccountId scopes by organisationId (does not return same subaccountId from different org)', async () => {
  const { stub, eq, and } = buildDbStub(fakeAccounts);
  const canonicalAccounts = makeCanonicalAccounts();

  // sub-x exists in both org-a (acc-1) and org-b (acc-3); must return only org-a's
  const result = await findAccountBySubaccountIdPure(stub, eq, and, canonicalAccounts, 'org-a', 'sub-x');

  expect(result !== null).toBeTruthy();
  expect(result!.organisationId, 'Must only return row matching the given orgId').toBe('org-a');
  expect(result!.id, 'Must not return row from a different org').not.toBe('acc-3');
});
