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

import { expect, test } from 'vitest';
await import('dotenv/config');

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP = !DATABASE_URL || DATABASE_URL.includes('placeholder') || process.env.NODE_ENV !== 'integration';

test.skipIf(SKIP)('conversationsRouteFollowUp integration', async () => {
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

    expect(rows1.length).toBe(1);
    expect(rows1[0]!.content).toBe('Hello from noop test');

    // --- Test 2: brief-scoped DB conversation → 'brief_followup' ---
    const t2 = await seedConversation('brief');
    seeded.push(t2.scopeId);

    const briefConv = await assertCanViewConversation(t2.convId, TEST_ORG_ID);
    expect(briefConv !== null).toBeTruthy();
    expect(briefConv!.scopeType).toBe('brief');
    expect(selectConversationFollowUpAction(briefConv)).toBe('brief_followup');

    // --- Test 3: task-scoped DB conversation → 'noop' ---
    const t3 = await seedConversation('task');
    seeded.push(t3.scopeId);

    const taskConv = await assertCanViewConversation(t3.convId, TEST_ORG_ID);
    expect(taskConv !== null).toBeTruthy();
    expect(selectConversationFollowUpAction(taskConv)).toBe('noop');

    // --- Test 4: no built-in dedupe — route single-call contract is load-bearing ---
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

    expect(rows4.length).toBe(2);
  } finally {
    for (const id of seeded) await cleanup(id);
  }
});
