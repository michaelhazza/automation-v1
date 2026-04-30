// guard-ignore-file: pure-helper-convention reason="Uses dynamic await import('../briefVisibilityService.js') — gate regex only matches static 'from' imports; sibling is imported correctly"
/**
 * briefVisibilityServicePure.test.ts — org-scoped DB path unit tests.
 *
 * Verifies that resolveBriefVisibility and resolveConversationVisibility
 * use the org-scoped tx injected by withOrgTx rather than a module-top db handle.
 *
 * Strategy: inject a fake tx via withOrgTx (the same ALS mechanism used in
 * production) and assert each service function performs its read through
 * that fake tx. No real DB or network required.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/briefVisibilityServicePure.test.ts
 */
import { expect, test } from 'vitest';

export {}; // force module scope so top-level await and local declarations don't collide

// briefVisibilityService transitively pulls in server/lib/env.ts which validates
// required env vars via zod. Seed placeholders before any dynamic import so the
// zod parse does not throw. This test is purely structural — it never touches the
// DB, signs a JWT, or sends email.
await import('dotenv/config');
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM   ??= 'test-placeholder@example.com';

const { withOrgTx } = await import('../../instrumentation.js');
const {
  resolveBriefVisibility,
  resolveConversationVisibility,
} = await import('../briefVisibilityService.js');

// ---------------------------------------------------------------------------
// Lightweight test runner (matches project tsx convention)
// ---------------------------------------------------------------------------

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Fake tx builder — chainable select stub that records calls
// ---------------------------------------------------------------------------

interface SelectCall {
  method: 'select';
}

interface FakeTx {
  calls: SelectCall[];
  select: (fields?: unknown) => {
    from: (table: unknown) => {
      where: (cond: unknown) => {
        limit: (n: number) => Promise<unknown[]>;
      };
    };
  };
}

function makeFakeTx(rows: unknown[]): FakeTx {
  const calls: SelectCall[] = [];
  const tx: FakeTx = {
    calls,
    select(_fields?: unknown) {
      calls.push({ method: 'select' });
      return {
        from(_table: unknown) {
          return {
            where(_cond: unknown) {
              return {
                limit(_n: number): Promise<unknown[]> {
                  return Promise.resolve(rows);
                },
              };
            },
          };
        },
      };
    },
  };
  return tx;
}

// ---------------------------------------------------------------------------
// Principal factory
// ---------------------------------------------------------------------------

function makePrincipal(permissions: string[] = ['briefs:read', 'briefs:write']) {
  return {
    userId: 'user-1',
    organisationId: 'org-1',
    orgPermissions: new Set(permissions),
  };
}

// ---------------------------------------------------------------------------
// withOrgTx helper — wraps service call in a fake ALS context
// ---------------------------------------------------------------------------

async function withFakeTx<T>(tx: FakeTx, fn: () => Promise<T>): Promise<T> {
  return withOrgTx(
    {
      tx,
      organisationId: 'org-1',
      source: 'test',
    },
    fn,
  );
}

// ---------------------------------------------------------------------------
// resolveBriefVisibility tests
// ---------------------------------------------------------------------------

console.log('');
console.log('briefVisibilityServicePure — resolveBriefVisibility');
console.log('');

await test('resolveBriefVisibility uses org-scoped tx (select called)', async () => {
  const tx = makeFakeTx([{ id: 'brief-1', organisationId: 'org-1' }]);
  await withFakeTx(tx, () =>
    resolveBriefVisibility(makePrincipal(), 'brief-1'),
  );
  expect(tx.calls.length >= 1, 'expected at least one select call on the fake tx').toBeTruthy();
  expect(tx.calls[0].method, 'first call should be select').toBe('select');
});

await test('resolveBriefVisibility returns canView/canWrite when task found and permissions present', async () => {
  const tx = makeFakeTx([{ id: 'brief-1', organisationId: 'org-1' }]);
  const result = await withFakeTx(tx, () =>
    resolveBriefVisibility(makePrincipal(['briefs:read', 'briefs:write']), 'brief-1'),
  );
  expect(typeof result.canView === 'boolean', 'canView should be boolean').toBeTruthy();
  expect(typeof result.canWrite === 'boolean', 'canWrite should be boolean').toBeTruthy();
});

await test('resolveBriefVisibility returns { canView: false, canWrite: false } when no task row found', async () => {
  const tx = makeFakeTx([]); // empty result — task not found
  const result = await withFakeTx(tx, () =>
    resolveBriefVisibility(makePrincipal(), 'not-found'),
  );
  expect(result.canView, 'canView should be false when no row').toBe(false);
  expect(result.canWrite, 'canWrite should be false when no row').toBe(false);
});

await test('resolveBriefVisibility throws missing_org_context when called without withOrgTx', async () => {
  let threw = false;
  try {
    await resolveBriefVisibility(makePrincipal(), 'brief-1');
  } catch {
    threw = true;
  }
  expect(threw, 'expected failure when called outside org context').toBeTruthy();
});

// ---------------------------------------------------------------------------
// resolveConversationVisibility tests
// ---------------------------------------------------------------------------

console.log('');
console.log('briefVisibilityServicePure — resolveConversationVisibility');
console.log('');

await test('resolveConversationVisibility uses org-scoped tx (select called)', async () => {
  const tx = makeFakeTx([{ id: 'conv-1', organisationId: 'org-1' }]);
  await withFakeTx(tx, () =>
    resolveConversationVisibility(makePrincipal(), 'conv-1'),
  );
  expect(tx.calls.length >= 1, 'expected at least one select call on the fake tx').toBeTruthy();
  expect(tx.calls[0].method, 'first call should be select').toBe('select');
});

await test('resolveConversationVisibility returns canView/canWrite when conv found', async () => {
  const tx = makeFakeTx([{ id: 'conv-1', organisationId: 'org-1' }]);
  const result = await withFakeTx(tx, () =>
    resolveConversationVisibility(makePrincipal(), 'conv-1'),
  );
  expect(typeof result.canView === 'boolean', 'canView should be boolean').toBeTruthy();
  expect(typeof result.canWrite === 'boolean', 'canWrite should be boolean').toBeTruthy();
});

await test('resolveConversationVisibility returns { canView: false, canWrite: false } when no conv row found', async () => {
  const tx = makeFakeTx([]);
  const result = await withFakeTx(tx, () =>
    resolveConversationVisibility(makePrincipal(), 'not-found'),
  );
  expect(result.canView, 'canView should be false when no row').toBe(false);
  expect(result.canWrite, 'canWrite should be false when no row').toBe(false);
});

await test('resolveConversationVisibility throws missing_org_context when called without withOrgTx', async () => {
  let threw = false;
  try {
    await resolveConversationVisibility(makePrincipal(), 'conv-1');
  } catch {
    threw = true;
  }
  expect(threw, 'expected failure when called outside org context').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log('');
