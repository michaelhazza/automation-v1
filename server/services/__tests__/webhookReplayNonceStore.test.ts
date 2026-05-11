// guard-ignore-file: pure-helper-convention reason="env preamble + vi.mock must run before module-level imports; dynamic import used after setup"
/**
 * webhookReplayNonceStore.test.ts — unit tests for the durable replay-nonce store.
 *
 * All DB calls are mocked — the tests verify the INSERT ... ON CONFLICT DO NOTHING
 * behaviour via row-count interpretation, not real Postgres.
 *
 * Run via: npx vitest run server/lib/__tests__/webhookReplayNonceStore.test.ts
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

export {};

// ── Env preamble ─────────────────────────────────────────────────────────────
import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

// ── Module mocks ─────────────────────────────────────────────────────────────

// Track calls to the execute function and control its return value per test.
const mockExecute = vi.fn();

// Minimal db mock — only needs .transaction() for the nonce store.
vi.mock('../../db/index.js', () => ({
  db: {
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = { execute: mockExecute };
      return fn(fakeTx);
    }),
  },
}));

// withOrgTx just calls the fn — no ALS side-effects needed in unit tests.
vi.mock('../../instrumentation.js', () => ({
  withOrgTx: vi.fn().mockImplementation((_ctx: unknown, fn: () => Promise<unknown>) => fn()),
}));

// ── Import under test (dynamic, after mocks) ─────────────────────────────────

const { recordIfNew } = await import('../webhookReplayNonceStore.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const SOURCE = 'teamwork';
const NONCE_1 = 'delivery-id-1';
const NONCE_2 = 'delivery-id-2';

/** Make mockExecute return 1 row (first call = INSERT succeeded). */
function mockInserted() {
  mockExecute.mockResolvedValueOnce([{ inserted: 1 }]);
}

/** Make mockExecute return 0 rows (INSERT was a no-op — duplicate). */
function mockConflict() {
  mockExecute.mockResolvedValueOnce([]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('webhookReplayNonceStore.recordIfNew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('first call returns { inserted: true }', async () => {
    // First execute is SET set_config; second is the INSERT.
    mockExecute
      .mockResolvedValueOnce(undefined) // set_config GUC
      .mockResolvedValueOnce([{ inserted: 1 }]); // INSERT returned a row

    const result = await recordIfNew(ORG_A, SOURCE, NONCE_1);
    expect(result).toEqual({ inserted: true });
  });

  test('second call with same (org, source, nonce) returns { inserted: false }', async () => {
    // First INSERT succeeds; second INSERT is a no-op (ON CONFLICT DO NOTHING).
    mockExecute
      .mockResolvedValueOnce(undefined) // set_config for first call
      .mockResolvedValueOnce([{ inserted: 1 }]) // first INSERT
      .mockResolvedValueOnce(undefined) // set_config for second call
      .mockResolvedValueOnce([]); // second INSERT → no rows (conflict)

    const first = await recordIfNew(ORG_A, SOURCE, NONCE_1);
    const second = await recordIfNew(ORG_A, SOURCE, NONCE_1);

    expect(first).toEqual({ inserted: true });
    expect(second).toEqual({ inserted: false });
  });

  test('two distinct nonces under same (org, source) both insert', async () => {
    mockExecute
      .mockResolvedValueOnce(undefined) // set_config for first call
      .mockResolvedValueOnce([{ inserted: 1 }]) // INSERT nonce_1
      .mockResolvedValueOnce(undefined) // set_config for second call
      .mockResolvedValueOnce([{ inserted: 1 }]); // INSERT nonce_2

    const r1 = await recordIfNew(ORG_A, SOURCE, NONCE_1);
    const r2 = await recordIfNew(ORG_A, SOURCE, NONCE_2);

    expect(r1).toEqual({ inserted: true });
    expect(r2).toEqual({ inserted: true });
  });

  test('two distinct orgs with same nonce both insert (no cross-tenant collision)', async () => {
    mockExecute
      .mockResolvedValueOnce(undefined) // set_config for org A
      .mockResolvedValueOnce([{ inserted: 1 }]) // INSERT for org A
      .mockResolvedValueOnce(undefined) // set_config for org B
      .mockResolvedValueOnce([{ inserted: 1 }]); // INSERT for org B (different org — no conflict)

    const rA = await recordIfNew(ORG_A, SOURCE, NONCE_1);
    const rB = await recordIfNew(ORG_B, SOURCE, NONCE_1);

    expect(rA).toEqual({ inserted: true });
    expect(rB).toEqual({ inserted: true });
  });
});
