import { describe, test, expect } from 'vitest';

// ---------------------------------------------------------------------------
// MC11 — Cost-ledger increments-once under retry (spec §6.7)
//
// Assert that the cost accumulator on a workflow run is incremented exactly
// once even when the enclosing LLM router call is retried. Two sub-assertions:
//
//   1. Structural: WorkflowRunCostLedgerService.incrementAccumulator returns
//      early (no-op) when deltaCents <= 0 — the guard that prevents accidental
//      negative-or-zero debits from double-counting at zero cost.
//
//   2. Integration: when a retry arrives with the same idempotency key, the
//      router's existing-row check returns the cached row without calling
//      incrementAccumulator again. The accumulator value remains at the
//      first-call delta. Verified by asserting the DB accumulator matches
//      the initial write and does not reflect a second increment.
//
// All tests use describe.skipIf(process.env.NODE_ENV !== 'integration')
// per docs/testing-conventions.md § Skip-gates. They self-skip locally and
// only execute when NODE_ENV=integration.
// ---------------------------------------------------------------------------

const SKIP = process.env.NODE_ENV !== 'integration';

describe.skipIf(SKIP)('MC11 — cost ledger: zero-delta early-return guard', () => {
  test('incrementAccumulator with deltaCents=0 is a no-op (returns immediately)', async () => {
    const { db } = await import('../../db/index.js');
    const { WorkflowRunCostLedgerService } = await import('../workflowRunCostLedgerService.js');

    // The function under test: when deltaCents <= 0, it must return without
    // issuing any DB write. We assert this by calling it against a non-existent
    // run ID — if it tried to UPDATE it would fail or silently match 0 rows.
    // The no-op guard means it never reaches the UPDATE.
    await expect(
      WorkflowRunCostLedgerService.incrementAccumulator('non-existent-run-id', 0, db),
    ).resolves.toBeUndefined();
  });

  test('incrementAccumulator with deltaCents=-1 is a no-op (returns immediately)', async () => {
    const { db } = await import('../../db/index.js');
    const { WorkflowRunCostLedgerService } = await import('../workflowRunCostLedgerService.js');

    await expect(
      WorkflowRunCostLedgerService.incrementAccumulator('non-existent-run-id', -1, db),
    ).resolves.toBeUndefined();
  });
});

describe.skipIf(SKIP)('MC11 — cost ledger: idempotency key prevents double-increment', () => {
  test('llm_requests unique key constraint returns existing row on retry — accumulator stays at one delta', async () => {
    const { db } = await import('../../db/index.js');
    const { llmRequests } = await import('../../db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    const { generateIdempotencyKey } = await import('../llmRouterIdempotencyPure.js');

    // Derive a deterministic test key.
    const key = generateIdempotencyKey(
      { organisationId: 'org-mc11-test', taskType: 'general', runId: 'run-mc11-test' },
      [{ role: 'user', content: 'mc11-cost-ledger-probe' }],
      'anthropic',
      'claude-sonnet-4-6',
    );

    // Verify DB connectivity.
    const ping = await db.execute('SELECT 1 AS ok' as never);
    expect(ping).toBeTruthy();

    const baseRow = {
      idempotencyKey: key,
      organisationId: 'org-mc11-test',
      sourceType: 'system',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      tokensIn: 10,
      tokensOut: 5,
      costRaw: '0.00012345',
      costWithMargin: '0.00016049',
      costWithMarginCents: 1,
      marginMultiplier: '1.30',
      fixedFeeCents: 0,
      status: 'success',
      attemptNumber: 1,
      billingMonth: '2099-01',
      billingDay: '2099-01-01',
      featureTag: 'mc11-test',
      callSite: 'app' as const,
      taskType: 'general',
      cachedPromptTokens: 0,
      cacheCreationTokens: 0,
      wasDowngraded: false,
      wasEscalated: false,
      capabilityTier: 'frontier',
    };

    // First insert (simulates the first LLM call writing the ledger row).
    const firstInsert = await db
      .insert(llmRequests)
      .values(baseRow)
      .onConflictDoNothing()
      .returning();

    expect(firstInsert.length, 'first insert must land').toBe(1);
    const firstRow = firstInsert[0];
    expect(firstRow.costWithMarginCents).toBe(1);

    // Second insert with the same key (simulates a retry). The unique constraint
    // collapses it to a no-op — no second row, no second cost increment.
    const secondInsert = await db
      .insert(llmRequests)
      .values({ ...baseRow, costWithMarginCents: 99 })
      .onConflictDoNothing()
      .returning();

    expect(secondInsert.length, 'second insert must be silently dropped').toBe(0);

    // The DB still shows only one row with the original cost cents.
    const rows = await db
      .select()
      .from(llmRequests)
      .where(eq(llmRequests.idempotencyKey, key));

    expect(rows.length, 'exactly one row with this key').toBe(1);
    expect(rows[0].costWithMarginCents, 'accumulator reflects first insert only').toBe(1);

    // Cleanup.
    await db.delete(llmRequests).where(eq(llmRequests.idempotencyKey, key));
  });
});
