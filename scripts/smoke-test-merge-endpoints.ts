/**
 * Smoke test the Phase 5 merge PATCH + Reset endpoints against the live DB.
 * Run via: tsx scripts/smoke-test-merge-endpoints.ts
 *
 * Creates a synthetic skill_analyzer_results row with a known
 * proposedMergedContent, calls patchMergeFields and resetMergeToOriginal
 * via the service layer, verifies the row state at each step.
 */

import 'dotenv/config';
import { db, client } from '../server/db/index.js';
import { sql, eq } from 'drizzle-orm';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../server/db/schema/index.js';
import { patchMergeFields, resetMergeToOriginal } from '../server/services/skillAnalyzerService.js';

async function main(): Promise<void> {
  console.log('=== Phase 5 Merge Endpoints Smoke Test ===');
  console.log('');

  const userRows = (await db.execute(
    sql`SELECT id::text AS id, organisation_id::text AS org FROM users LIMIT 1`,
  )) as unknown as Array<{ id: string; org: string }>;
  const user = userRows[0];

  const realSkill = (await db.execute(
    sql`SELECT id::text AS id, slug FROM system_skills LIMIT 1`,
  )) as unknown as Array<{ id: string; slug: string }>;

  // 1. Create a parent job
  const insertedJobs = await db
    .insert(skillAnalyzerJobs)
    .values({
      organisationId: user.org,
      createdBy: user.id,
      sourceType: 'paste',
      sourceMetadata: { source: 'smoke-test-merge' },
      parsedCandidates: [],
      status: 'completed',
      progressPct: 100,
    })
    .returning({ id: skillAnalyzerJobs.id });
  const jobId = insertedJobs[0].id;

  // 2. Create a synthetic PARTIAL_OVERLAP result with a fully-formed merge
  const original = {
    name: 'Original AI Suggestion',
    description: 'The LLM said this',
    definition: {
      name: 'test_skill',
      description: 'tool',
      input_schema: { type: 'object' as const, properties: {}, required: [] },
    },
    instructions: 'Original instructions text.',
  };

  const insertedResults = await db
    .insert(skillAnalyzerResults)
    .values({
      jobId,
      candidateIndex: 0,
      candidateName: 'test_skill',
      candidateSlug: 'test_skill_smoke_test',
      candidateContentHash: 'a'.repeat(64),
      matchedSkillId: realSkill[0].id,
      classification: 'PARTIAL_OVERLAP',
      confidence: 0.7,
      similarityScore: 0.75,
      classificationReasoning: 'smoke test',
      proposedMergedContent: original,
      originalProposedMerge: original,
      userEditedMerge: false,
    })
    .returning({ id: skillAnalyzerResults.id });
  const resultId = insertedResults[0].id;

  let failures = 0;
  function assert(cond: boolean, msg: string) {
    if (!cond) {
      console.error(`  ✗ ${msg}`);
      failures++;
    } else {
      console.log(`  ✓ ${msg}`);
    }
  }

  /** Order-insensitive deep equality. Postgres jsonb does NOT preserve
   *  insertion order for object keys — re-reading a row shuffles them.
   *  This is correct behaviour; the smoke test just needs to compare on
   *  semantic equality, not byte-equal stringification. */
  function deepEq(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return false;
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => deepEq(v, b[i]));
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEq(ao[k], bo[k]));
  }

  // 3. PATCH a single field
  console.log('[patch] editing the description field...');
  const afterPatch = await patchMergeFields({
    resultId,
    jobId,
    organisationId: user.org,
    patch: { description: 'User-edited description' },
  });

  const merge = afterPatch.proposedMergedContent as typeof original | null;
  assert(merge?.description === 'User-edited description', 'description was patched');
  assert(merge?.name === original.name, 'name was preserved');
  assert(afterPatch.userEditedMerge === true, 'userEditedMerge flipped to true');

  // 4. PATCH the definition to a new shape
  console.log('');
  console.log('[patch] editing the definition field...');
  const newDefinition = {
    name: 'test_skill_v2',
    description: 'updated tool',
    input_schema: { type: 'object' as const, properties: { foo: { type: 'string' } }, required: ['foo'] },
  };
  const afterDefPatch = await patchMergeFields({
    resultId,
    jobId,
    organisationId: user.org,
    patch: { definition: newDefinition },
  });
  const merge2 = afterDefPatch.proposedMergedContent as typeof original | null;
  assert(deepEq(merge2?.definition, newDefinition), 'definition was patched');

  // 5. PATCH a bad definition shape — should throw 400
  console.log('');
  console.log('[patch] rejecting bad definition shape...');
  let threw = false;
  try {
    await patchMergeFields({
      resultId,
      jobId,
      organisationId: user.org,
      patch: { definition: { not: 'a tool definition' } },
    });
  } catch (err) {
    threw = true;
    const e = err as { statusCode?: number; message?: string };
    assert(e.statusCode === 400, `bad definition rejected with 400 (got ${e.statusCode})`);
  }
  assert(threw, 'bad definition threw');

  // 6. Reset to original
  console.log('');
  console.log('[reset] resetting to AI suggestion...');
  const afterReset = await resetMergeToOriginal({
    resultId,
    jobId,
    organisationId: user.org,
  });
  const merge3 = afterReset.proposedMergedContent as typeof original | null;
  assert(merge3?.description === original.description, 'description reset to original');
  assert(merge3?.name === original.name, 'name preserved as original');
  assert(deepEq(merge3?.definition, original.definition), 'definition reset to original');
  assert(afterReset.userEditedMerge === false, 'userEditedMerge cleared');

  // 7. PATCH the wrong classification — should 409
  console.log('');
  console.log('[patch] rejecting patch on DUPLICATE classification...');
  await db
    .update(skillAnalyzerResults)
    .set({ classification: 'DUPLICATE' })
    .where(eq(skillAnalyzerResults.id, resultId));
  let threw409 = false;
  try {
    await patchMergeFields({
      resultId,
      jobId,
      organisationId: user.org,
      patch: { name: 'should not work' },
    });
  } catch (err) {
    threw409 = true;
    const e = err as { statusCode?: number };
    assert(e.statusCode === 409, `DUPLICATE patch rejected with 409 (got ${e.statusCode})`);
  }
  assert(threw409, 'DUPLICATE patch threw');

  // cleanup
  console.log('');
  console.log('[cleanup] deleting synthetic job + results');
  await db.delete(skillAnalyzerResults).where(eq(skillAnalyzerResults.jobId, jobId));
  await db.delete(skillAnalyzerJobs).where(eq(skillAnalyzerJobs.id, jobId));

  console.log('');
  if (failures > 0) {
    console.error(`=== FAILED: ${failures} assertion(s) failed ===`);
    await client.end();
    process.exit(1);
  }
  console.log('=== Phase 5 merge endpoints smoke test passed ===');
  await client.end();
}

main().catch(async (err) => {
  console.error('[smoke-test] fatal:', err);
  try {
    await client.end();
  } catch {
    // best-effort
  }
  process.exit(1);
});
