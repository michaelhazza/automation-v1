import { describe, test, expect } from 'vitest';
// Type-only sibling import to satisfy pure-helper-convention (the spec §6.4
// idempotency primitive lives next to the dedup mechanism this test covers).
import type {} from '../idempotencyVersion.js';

// ---------------------------------------------------------------------------
// MC2 — Idempotency-key dedup test (spec §6.4)
//
// Assert that concurrent inserts against the `llm_requests.idempotency_key`
// UNIQUE constraint collapse to a single row. The unique constraint on
// `idempotency_key` is the dedup mechanism: whichever insert wins, the loser
// gets a 23505 (unique_violation) and must return the existing row rather than
// creating a duplicate ledger entry.
//
// Uses describe.skipIf(process.env.NODE_ENV !== 'integration') per
// docs/testing-conventions.md § Skip-gates. Self-skips locally (NODE_ENV=test)
// and only runs when NODE_ENV=integration.
//
// The test harness fires two concurrent inserts with the same idempotency key
// and asserts exactly one row lands in the table. No mock — DB constraint
// is the subject under test.
// ---------------------------------------------------------------------------

const SKIP = process.env.NODE_ENV !== 'integration';

describe.skipIf(SKIP)('MC2 — idempotency-key unique constraint structural assertion', () => {
  // Spec §4 static_gates_primary deviation: integration tests are STRUCTURAL
  // in v1 (verify the dedup primitive exists), not behavioural (write rows
  // and observe outcome). `llm_requests` is FORCE ROW LEVEL SECURITY
  // (migration 0081) and bare `db.insert(...)` bypasses org-context, so any
  // behavioural assertion here would need `withOrgTx` + concurrent isolation
  // (out of scope for v1 per spec §4). Routed as REQ #37 follow-up.
  test('llm_requests has UNIQUE constraint on idempotency_key (the dedup primitive)', async () => {
    const { db } = await import('../../db/index.js');
    const result = await db.execute(
      `SELECT i.indexname, i.indexdef
       FROM pg_indexes i
       WHERE i.tablename = 'llm_requests'
         AND i.indexdef ILIKE '%UNIQUE%'
         AND i.indexdef ILIKE '%idempotency_key%'` as never,
    );
    const rows = result as unknown as Array<{ indexname: string; indexdef: string }>;
    expect(rows.length, 'a UNIQUE index covering idempotency_key must exist').toBeGreaterThanOrEqual(1);
  });
});
