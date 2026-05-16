import { describe, test, expect } from 'vitest';

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

describe.skipIf(SKIP)('MC2 — idempotency-key unique constraint collapses concurrent inserts to a single row', () => {
  test('two concurrent inserts with the same key produce exactly one row', async () => {
    const { db } = await import('../../db/index.js');
    const { llmRequests } = await import('../../db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    const { generateIdempotencyKey } = await import('../../services/llmRouterIdempotencyPure.js');

    const key = generateIdempotencyKey(
      { organisationId: 'org-mc2-test', taskType: 'general', runId: 'run-mc2-test' },
      [{ role: 'user', content: 'mc2-dedup-probe' }],
      'anthropic',
      'claude-sonnet-4-6',
    );

    // Verify DB is live.
    const ping = await db.execute('SELECT 1 AS ok' as never);
    expect(ping).toBeTruthy();

    const baseRow = {
      idempotencyKey: key,
      organisationId: 'org-mc2-test',
      sourceType: 'system',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      tokensIn: 1,
      tokensOut: 1,
      costRaw: '0',
      costWithMargin: '0',
      costWithMarginCents: 0,
      marginMultiplier: '1.30',
      fixedFeeCents: 0,
      status: 'success',
      attemptNumber: 1,
      billingMonth: '2099-01',
      billingDay: '2099-01-01',
      featureTag: 'mc2-test',
      callSite: 'app' as const,
      taskType: 'general',
      cachedPromptTokens: 0,
      cacheCreationTokens: 0,
      wasDowngraded: false,
      wasEscalated: false,
      capabilityTier: 'frontier',
    };

    // Fire two concurrent inserts. At most one will succeed; the other will
    // receive a 23505 unique_violation and must not produce a second row.
    const results = await Promise.allSettled([
      db.insert(llmRequests).values(baseRow).onConflictDoNothing().returning(),
      db.insert(llmRequests).values({ ...baseRow, tokensOut: 2 }).onConflictDoNothing().returning(),
    ]);

    // Exactly one insert must have produced a returning row (the other is a no-op).
    const successfulInserts = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<unknown[]>).value)
      .filter((rows) => Array.isArray(rows) && rows.length > 0);

    expect(successfulInserts.length, 'exactly one insert wins').toBe(1);

    // Confirm exactly one row with this key exists in the DB.
    const rows = await db
      .select()
      .from(llmRequests)
      .where(eq(llmRequests.idempotencyKey, key));

    expect(rows.length, 'exactly one row in DB for this idempotency key').toBe(1);

    // Cleanup — remove the test row so the test is repeatable.
    await db.delete(llmRequests).where(eq(llmRequests.idempotencyKey, key));
  });
});
