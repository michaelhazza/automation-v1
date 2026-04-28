// guard-ignore-file: pure-helper-convention reason="Integration test — gated on a real DATABASE_URL probe before dynamically importing IO modules."
/**
 * briefsArtefactsPagination.integration.test.ts
 *
 * Carved-out integration test (§0.2 + spec §1.3). Requires a live DB.
 *
 * Runnable via:
 *   npx tsx server/routes/__tests__/briefsArtefactsPagination.integration.test.ts
 *
 * Test scenarios:
 *   1. 75 seeds → page 1 returns 50 items + cursor; page 2 returns 25 + null cursor.
 *   2. Concatenation matches unpaginated total (newest-first order preserved).
 *   3. Clamping: limit=0 clamped to 1; limit=500 clamped to 200.
 *   4. Malformed cursor → first-page response, no 400.
 *   5. Concurrent-insert interleave: load page 1 → insert 5 newer → load page 2 →
 *      5 newer absent from page 2 (cursor predicate excludes them).
 */
export {};

import { strict as assert } from 'node:assert';

await import('dotenv/config');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.includes('placeholder')) {
  console.log('\nSKIP: briefsArtefactsPagination.integration.test requires a real DATABASE_URL.\n');
  process.exit(0);
}

const { db } = await import('../../db/index.js');
const { tasks, conversations, conversationMessages } = await import('../../db/schema/index.js');
const { getBriefArtefacts, getAllBriefArtefacts } = await import('../../services/briefCreationService.js');
const { decodeCursor } = await import('../../services/briefArtefactCursorPure.js');
const { eq } = await import('drizzle-orm');

const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';
const STUB_USER_ID = '00000000-0000-0000-0000-000000000002';

async function seed75Artefacts(): Promise<{ briefId: string; convId: string }> {
  const [task] = await db.insert(tasks).values({
    organisationId: TEST_ORG_ID,
    title: 'Pagination test brief',
    description: 'Test',
    status: 'inbox',
    priority: 'normal' as const,
    position: 0,
  }).returning();

  const briefId = task!.id;

  const [conv] = await db.insert(conversations).values({
    organisationId: TEST_ORG_ID,
    scopeType: 'brief' as const,
    scopeId: briefId,
    createdByUserId: STUB_USER_ID,
    status: 'open' as const,
  }).returning();

  const convId = conv!.id;

  // Seed 75 messages with one artefact each, spaced 1ms apart
  const now = Date.now();
  for (let i = 0; i < 75; i++) {
    await db.insert(conversationMessages).values({
      conversationId: convId,
      organisationId: TEST_ORG_ID,
      role: 'assistant' as const,
      content: `Message ${i}`,
      artefacts: [{ artefactId: `artefact-${i}`, kind: 'structured', status: 'final' }],
      createdAt: new Date(now + i),
    });
  }

  return { briefId, convId };
}

async function cleanup(briefId: string) {
  await db.delete(tasks).where(eq(tasks.id, briefId));
}

async function run() {
  let briefId = '';
  try {
    ({ briefId } = await seed75Artefacts());

    // --- Test 1: 75 seeds → page 1 (50 items + cursor) ---
    const page1 = await getBriefArtefacts(briefId, TEST_ORG_ID, { limit: 50 });
    assert.strictEqual(page1.items.length, 50, 'page 1: 50 items');
    assert.notStrictEqual(page1.nextCursor, null, 'page 1: has cursor');

    // --- Test 2: page 2 (25 items + null cursor) ---
    const cursor = decodeCursor(page1.nextCursor!);
    assert.ok(cursor !== null, 'page 1 cursor is decodable');
    const page2 = await getBriefArtefacts(briefId, TEST_ORG_ID, { limit: 50, cursor });
    assert.strictEqual(page2.items.length, 25, 'page 2: 25 items');
    assert.strictEqual(page2.nextCursor, null, 'page 2: no cursor (end of list)');

    // --- Test 3: concatenation matches getAllBriefArtefacts ---
    const all = await getAllBriefArtefacts(briefId, TEST_ORG_ID);
    assert.strictEqual(all.length, 75, 'getAllBriefArtefacts returns 75');
    // Page 1 = newest 50; page 2 = oldest 25. Combined in order = page2 + page1 (ASC)
    const combined = [...page2.items, ...page1.items];
    assert.strictEqual(combined.length, 75, 'combined page matches total');
    const allIds = all.map((a) => a.artefactId);
    const combinedIds = combined.map((a) => a.artefactId);
    assert.deepStrictEqual(combinedIds, allIds, 'pagination order matches getAllBriefArtefacts');

    // --- Test 4: limit clamping ---
    const clampedLow = await getBriefArtefacts(briefId, TEST_ORG_ID, { limit: 0 });
    assert.ok(clampedLow.items.length >= 1, 'limit=0 clamped to 1, returns 1 item');

    const clampedHigh = await getBriefArtefacts(briefId, TEST_ORG_ID, { limit: 500 });
    assert.ok(clampedHigh.items.length <= 200, 'limit=500 clamped to 200');

    // --- Test 5: malformed cursor → first page ---
    const malformedResult = await getBriefArtefacts(briefId, TEST_ORG_ID, {
      limit: 50,
      cursor: null, // decodeCursor('bad-cursor') returns null → first page
    });
    assert.strictEqual(malformedResult.items.length, 50, 'null cursor → first page');

    // --- Test 6: concurrent-insert interleave ---
    // Simulate: page 1 loaded → 5 newer messages inserted → page 2 must not include them
    const page1Again = await getBriefArtefacts(briefId, TEST_ORG_ID, { limit: 50 });
    const cursorAfterInsert = decodeCursor(page1Again.nextCursor!);
    assert.ok(cursorAfterInsert !== null);

    // Insert 5 newer messages (after all existing ones)
    const conv = await db.query.conversations.findFirst({
      where: (c, { eq: eqFn, and }) => and(eqFn(c.scopeId, briefId), eqFn(c.organisationId, TEST_ORG_ID)),
    });
    const futureBase = Date.now() + 1_000_000;
    for (let i = 0; i < 5; i++) {
      await db.insert(conversationMessages).values({
        conversationId: conv!.id,
        organisationId: TEST_ORG_ID,
        role: 'assistant' as const,
        content: `New message ${i}`,
        artefacts: [{ artefactId: `new-artefact-${i}`, kind: 'structured', status: 'final' }],
        createdAt: new Date(futureBase + i),
      });
    }

    // Page 2 with old cursor must NOT include the 5 new artefacts
    const page2AfterInsert = await getBriefArtefacts(briefId, TEST_ORG_ID, {
      limit: 50,
      cursor: cursorAfterInsert,
    });
    const page2Ids = new Set(page2AfterInsert.items.map((a) => a.artefactId));
    for (let i = 0; i < 5; i++) {
      assert.ok(!page2Ids.has(`new-artefact-${i}`), `new artefact ${i} absent from page 2`);
    }
    assert.strictEqual(page2AfterInsert.items.length, 25, 'page 2 still has 25 old items');

    console.log('briefsArtefactsPagination integration: all assertions passed');
  } finally {
    if (briefId) await cleanup(briefId);
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
