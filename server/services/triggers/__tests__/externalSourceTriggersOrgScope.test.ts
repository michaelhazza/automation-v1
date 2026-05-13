// guard-ignore-file: pure-helper-convention reason="Integration-style cross-org-isolation test for externalSourceTriggers.dispatch — exercises the SQL-builder where-clause assembly via mocked drizzle helpers; no pure sibling module applies"
/**
 * externalSourceTriggersOrgScope.test.ts
 *
 * Cross-org isolation tests for `externalSourceTriggers.dispatch` (covering
 * the post-merge adversarial sweep, 2026-05-13):
 *
 *   1. Connection lookup MUST filter by `organisationId` so a user who
 *      exists in two orgs cannot have an event in org A resolve to a
 *      connection in org B (`server/services/triggers/externalSourceTriggers.ts`
 *      lines 38–53 pre-fix).
 *   2. Rate-cap COUNT MUST scope by `(organisation_id, owner_user_id)` so
 *      cross-org noise cannot starve a victim org's per-owner rate-cap
 *      budget (same file, lines 87–97 pre-fix).
 *
 * The test mocks drizzle's helpers + the db handle so the where-clauses are
 * inspectable plain objects. We don't exercise a live Postgres — the bug is
 * a missing equality predicate, and asserting that predicate's presence in
 * the captured where-clause is sufficient.
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

export {};

import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';
process.env.TOKEN_ENCRYPTION_KEY ??= 'a'.repeat(64);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_A = '00000000-0000-0000-0000-0000000000a1';
const ORG_B = '00000000-0000-0000-0000-0000000000b1';
const OWNER_USER_ID = '00000000-0000-0000-0000-000000000010';
const SUBACCOUNT_A = '00000000-0000-0000-0000-0000000000a2';

const SLACK_EVENT = {
  eventType: 'slack_mention' as const,
  ownerUserId: OWNER_USER_ID,
  slackUserId: 'U123ABC',
  channelId: 'C456DEF',
  messageTs: '1715515200.000100',
  text: 'hey <@U999>',
  dedupKey: 'C456DEF@1715515200.000100',
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Inspectable drizzle helpers — each returns a plain object describing the call.
type EqMarker = { _eq: { col: unknown; val: unknown } };
type AndMarker = { _and: unknown[] };

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _eq: { col, val } })),
  gte: vi.fn((col: unknown, val: unknown) => ({ _gte: { col, val } })),
  sql: vi.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ _sql: { strings, values } }),
  ),
}));

// Schema columns — distinct truthy objects so `eq(col, val)` captures column
// identity in `_eq.col`. We assert against these references below.
const integrationConnectionsCols = {
  id: { __col: 'integration_connections.id' },
  ownerUserId: { __col: 'integration_connections.owner_user_id' },
  subaccountId: { __col: 'integration_connections.subaccount_id' },
  organisationId: { __col: 'integration_connections.organisation_id' },
  providerType: { __col: 'integration_connections.provider_type' },
  connectionStatus: { __col: 'integration_connections.connection_status' },
};
const externalTriggerDedupCols = {
  provider: { __col: 'external_trigger_dedup.provider' },
  dedupKey: { __col: 'external_trigger_dedup.dedup_key' },
  ownerUserId: { __col: 'external_trigger_dedup.owner_user_id' },
  organisationId: { __col: 'external_trigger_dedup.organisation_id' },
  subaccountId: { __col: 'external_trigger_dedup.subaccount_id' },
  firedAt: { __col: 'external_trigger_dedup.fired_at' },
};

vi.mock('../../../db/schema/index.js', () => ({
  integrationConnections: integrationConnectionsCols,
}));

vi.mock('../../../db/schema/externalTriggerDedup.js', () => ({
  externalTriggerDedup: externalTriggerDedupCols,
}));

// db handle — only `select` is hit on the primary path (the rate-cap +
// dedup-insert paths run through withAdminConnection's tx instead).
const dbSelectMock = vi.fn();
vi.mock('../../../db/index.js', () => ({
  db: { select: dbSelectMock },
}));

// Capture where-clauses passed inside withAdminConnection's `fn` so we can
// assert the rate-cap query is scoped by organisationId.
type CapturedAdminCall = {
  rateCapWhere?: unknown;
  insertValues?: unknown;
};
const capturedAdminCalls: CapturedAdminCall[] = [];

vi.mock('../../../lib/adminDbConnection.js', () => ({
  withAdminConnection: vi.fn(async (_opts: unknown, fn: (tx: unknown) => unknown) => {
    const captured: CapturedAdminCall = {};
    capturedAdminCalls.push(captured);
    const tx = {
      execute: vi.fn(async () => undefined),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((w: unknown) => {
            captured.rateCapWhere = w;
            // Default: zero rows (under rate-cap)
            return Promise.resolve([{ total: 0 }]);
          }),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((v: unknown) => {
          captured.insertValues = v;
          return {
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn(() => Promise.resolve([{ provider: 'slack' }])),
            })),
          };
        }),
      })),
    };
    return fn(tx);
  }),
}));

// triggerService.checkAndFire — stub so we don't traverse the trigger system.
const checkAndFireMock = vi.fn(async () => undefined);
vi.mock('../../triggerService.js', () => ({
  triggerService: { checkAndFire: checkAndFireMock },
}));

vi.mock('../../../config/limits.js', () => ({
  MAX_EXTERNAL_TRIGGERED_RUNS_PER_MINUTE_PER_OWNER: 10,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConnectionSelectChain(rows: unknown[]) {
  const whereCapture: { where?: unknown } = {};
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn((w: unknown) => {
      whereCapture.where = w;
      return chain;
    }),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return { chain, whereCapture };
}

function findEqOnColumn(where: unknown, col: unknown): EqMarker | undefined {
  if (!where || typeof where !== 'object') return undefined;
  const w = where as { _and?: unknown[]; _eq?: { col: unknown; val: unknown } };
  if (w._eq && w._eq.col === col) return w as EqMarker;
  if (Array.isArray(w._and)) {
    for (const c of w._and) {
      const hit = findEqOnColumn(c, col);
      if (hit) return hit;
    }
  }
  return undefined;
}

// ── Dynamic import after mocks ────────────────────────────────────────────────

const { dispatch } = await import('../externalSourceTriggers.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  capturedAdminCalls.length = 0;
});

describe('externalSourceTriggers.dispatch — cross-org isolation', () => {
  test('connection lookup includes organisationId predicate', async () => {
    const { chain, whereCapture } = makeConnectionSelectChain([]);
    dbSelectMock.mockReturnValue(chain);

    await dispatch(SLACK_EVENT, { organisationId: ORG_A });

    const orgEq = findEqOnColumn(whereCapture.where, integrationConnectionsCols.organisationId);
    expect(orgEq, 'connection lookup must include eq(integrationConnections.organisationId, ctx.organisationId)').toBeDefined();
    expect(orgEq?._eq.val).toBe(ORG_A);
  });

  test('cross-org event resolves to owner_unresolved (no row in caller org)', async () => {
    // DB returns no rows because the user's connection lives in ORG_B but we
    // dispatched in ORG_A.
    const { chain } = makeConnectionSelectChain([]);
    dbSelectMock.mockReturnValue(chain);

    const result = await dispatch(SLACK_EVENT, { organisationId: ORG_A });

    expect(result.outcome).toBe('owner_unresolved');
    expect(checkAndFireMock).not.toHaveBeenCalled();
  });

  test('rate-cap COUNT scopes by (organisation_id, owner_user_id)', async () => {
    const { chain } = makeConnectionSelectChain([
      {
        id: 'conn-a',
        ownerUserId: OWNER_USER_ID,
        subaccountId: SUBACCOUNT_A,
      },
    ]);
    dbSelectMock.mockReturnValue(chain);

    await dispatch(SLACK_EVENT, { organisationId: ORG_A });

    // First admin-conn call = rate-cap COUNT. Inspect its where clause.
    const rateCapWhere = capturedAdminCalls[0]?.rateCapWhere;
    const orgEq = findEqOnColumn(rateCapWhere, externalTriggerDedupCols.organisationId);
    const ownerEq = findEqOnColumn(rateCapWhere, externalTriggerDedupCols.ownerUserId);
    expect(orgEq, 'rate-cap COUNT must filter by external_trigger_dedup.organisation_id').toBeDefined();
    expect(orgEq?._eq.val).toBe(ORG_A);
    expect(ownerEq, 'rate-cap COUNT must filter by external_trigger_dedup.owner_user_id').toBeDefined();
    expect(ownerEq?._eq.val).toBe(OWNER_USER_ID);
  });
});

// Silence unused-type lints — these markers are documentation for readers.
type _Markers = EqMarker | AndMarker;
