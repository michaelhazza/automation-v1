// guard-ignore-file: pure-helper-convention reason="Integration test — gated on a real DATABASE_URL probe before dynamically importing IO modules."
/**
 * conversationsRouteFollowUp.integration.test.ts
 *
 * Carved-out integration test (§0.2 + spec §1.1). Requires a live DB.
 *
 * Runnable via:
 *   npx tsx server/routes/__tests__/conversationsRouteFollowUp.integration.test.ts
 *
 * What is tested:
 *   1. Non-Brief (task-scoped) POST: writeConversationMessage writes exactly
 *      one row; correct content persisted.
 *   2. Brief-scoped DB conversation: selectConversationFollowUpAction returns
 *      'brief_followup' when given an actual DB row (routing discriminator
 *      is DB-sourced scopeType, not caller-supplied).
 *   3. Task-scoped DB conversation: selectConversationFollowUpAction returns
 *      'noop'.
 *   4. writeConversationMessage has no built-in dedupe — the route's
 *      single-call contract is what prevents duplicate user messages. A
 *      second call produces a second row (confirms the load-bearing invariant).
 *
 * Note: the full Brief path (handleConversationFollowUp → LLM classify →
 * orchestrator enqueue) requires a live LLM + pg-boss and is covered by
 * manual smoke (plan step 4.9). The predicate matrix is in
 * conversationsRoutePure.test.ts (no DB required).
 *
 * Tests MUST NOT assert websocket events or timing of emits (spec §1.1 step 4.6).
 */
export {};

import { strict as assert } from 'node:assert';

await import('dotenv/config');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.includes('placeholder')) {
  console.log('\nSKIP: conversationsRouteFollowUp.integration.test requires a real DATABASE_URL.\n');
  process.exit(0);
}

const { db } = await import('../../db/index.js');
const { tasks, conversations, conversationMessages } = await import('../../db/schema/index.js');
const { writeConversationMessage } = await import('../../services/briefConversationWriter.js');
const { assertCanViewConversation } = await import('../../services/briefConversationService.js');
const { selectConversationFollowUpAction } = await import('../../services/conversationsRoutePure.js');
const { eq } = await import('drizzle-orm');

const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';
const STUB_USER_ID = '00000000-0000-0000-0000-000000000002';

async function seedConversation(scopeType: 'task' | 'brief'): Promise<{ scopeId: string; convId: string }> {
  const [task] = await db.insert(tasks).values({
    organisationId: TEST_ORG_ID,
    title: `DR2 test ${scopeType}`,
    description: 'Integration test — DR2',
    status: 'inbox',
    priority: 'normal' as const,
    position: 0,
  }).returning();

  const [conv] = await db.insert(conversations).values({
    organisationId: TEST_ORG_ID,
    scopeType,
    scopeId: task!.id,
    createdByUserId: STUB_USER_ID,
    status: 'open' as const,
  }).returning();

  return { scopeId: task!.id, convId: conv!.id };
}

async function cleanup(scopeId: string) {
  await db.delete(tasks).where(eq(tasks.id, scopeId));
}

async function run() {
  const seeded: string[] = [];
  try {
    // --- Test 1: noop path — task-scoped write produces exactly 1 row ---
    const t1 = await seedConversation('task');
    seeded.push(t1.scopeId);

    await writeConversationMessage({
      conversationId: t1.convId,
      briefId: t1.scopeId,
      organisationId: TEST_ORG_ID,
      role: 'user',
      content: 'Hello from noop test',
      senderUserId: STUB_USER_ID,
    });

    const rows1 = await db
      .select({ id: conversationMessages.id, content: conversationMessages.content })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, t1.convId));

    assert.strictEqual(rows1.length, 1, 'test 1: exactly 1 row written');
    assert.strictEqual(rows1[0]!.content, 'Hello from noop test', 'test 1: correct content');

    // --- Test 2: brief-scoped DB conversation → 'brief_followup' ---
    const t2 = await seedConversation('brief');
    seeded.push(t2.scopeId);

    const briefConv = await assertCanViewConversation(t2.convId, TEST_ORG_ID);
    assert.ok(briefConv !== null, 'test 2: brief conv fetched from DB');
    assert.strictEqual(briefConv!.scopeType, 'brief', 'test 2: scopeType is brief');
    assert.strictEqual(
      selectConversationFollowUpAction(briefConv),
      'brief_followup',
      'test 2: brief DB conv → brief_followup action',
    );

    // --- Test 3: task-scoped DB conversation → 'noop' ---
    const t3 = await seedConversation('task');
    seeded.push(t3.scopeId);

    const taskConv = await assertCanViewConversation(t3.convId, TEST_ORG_ID);
    assert.ok(taskConv !== null, 'test 3: task conv fetched from DB');
    assert.strictEqual(
      selectConversationFollowUpAction(taskConv),
      'noop',
      'test 3: task DB conv → noop action',
    );

    // --- Test 4: no built-in dedupe — route single-call contract is load-bearing ---
    // A second direct call to writeConversationMessage produces a second row.
    // The route handler must call it at most once per request (branch-before-write).
    await writeConversationMessage({
      conversationId: t1.convId,
      briefId: t1.scopeId,
      organisationId: TEST_ORG_ID,
      role: 'user',
      content: 'Second write — verifies no built-in dedupe',
      senderUserId: STUB_USER_ID,
    });

    const rows4 = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, t1.convId));

    assert.strictEqual(
      rows4.length,
      2,
      'test 4: writeConversationMessage has no built-in dedupe — route single-call invariant is load-bearing',
    );

    console.log('conversationsRouteFollowUp integration: all assertions passed');
  } finally {
    for (const id of seeded) await cleanup(id);
  }
}

void run().catch((err) => {
  // FK violation on the test org means the DB isn't seeded with test fixtures.
  if (err?.cause?.code === '23503' && String(err?.cause?.detail ?? '').includes('organisations')) {
    console.log('\nSKIP: test org not present in DB — seed 00000000-0000-0000-0000-000000000001 to run this test.\n');
    process.exit(0);
  }
  console.error('Integration test failed:', err);
  process.exit(1);
});
