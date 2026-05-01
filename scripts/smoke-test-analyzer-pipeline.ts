/**
 * End-to-end smoke test for the skill-analyzer pipeline against the live DB.
 * Run via: tsx scripts/smoke-test-analyzer-pipeline.ts
 *
 * Creates a synthetic analyzer job with two candidates designed to exercise
 * both the DUPLICATE path (one is an exact copy of an existing system skill)
 * and the DISTINCT path (one is a novel skill). Runs the pg-boss handler
 * directly (no enqueue), then inspects the resulting rows for shape +
 * agentProposals + candidateContentHash.
 *
 * IMPORTANT: skips the LLM call by picking candidates that hit the
 * unambiguous bands (exact-duplicate via hash, low-similarity DISTINCT).
 * That way the test runs deterministically and surfaces wiring bugs in
 * Phase 1, Phase 2, and the Write stage without depending on Anthropic
 * being reachable.
 */

import 'dotenv/config';
import { db, client } from '../server/db/index.js';
import { sql, eq } from 'drizzle-orm';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../server/db/schema/index.js';
import { processSkillAnalyzerJob } from '../server/jobs/skillAnalyzerJob.js';

async function main(): Promise<void> {
  console.log('=== Skill Analyzer Pipeline Smoke Test ===');
  console.log('');

  // Pick a real user + org so the FK constraint is satisfied.
  const userRows = (await db.execute(
    sql`SELECT id::text AS id, organisation_id::text AS org FROM users LIMIT 1`,
  )) as unknown as Array<{ id: string; org: string }>;
  const user = userRows[0];
  if (!user) {
    console.error('[setup] No users in DB — cannot create a job');
    await client.end();
    process.exit(1);
  }
  console.log(`[setup] using user=${user.id.slice(0, 8)}… org=${user.org.slice(0, 8)}…`);

  // Pull one real system skill to copy verbatim (DUPLICATE path) and craft
  // a fake distinct one. This guarantees deterministic classification —
  // the duplicate hits the hash-match short-circuit, the distinct hits the
  // low-similarity band.
  const realSkill = (await db.execute(
    sql`SELECT slug, name, description, definition::text AS definition_json, instructions FROM system_skills LIMIT 1`,
  )) as unknown as Array<{
    slug: string;
    name: string;
    description: string;
    definition_json: string;
    instructions: string | null;
  }>;
  const real = realSkill[0];
  if (!real) {
    console.error('[setup] system_skills is empty — run the backfill first');
    await client.end();
    process.exit(1);
  }
  console.log(`[setup] using real skill: ${real.slug}`);

  // The duplicate must match the analyzer's hash function exactly. The
  // pipeline reads system skills via systemSkillService.listSkills() and
  // computes hashes via skillParserServicePure.normalizeForHash. The
  // safest reproduction is to mirror the *parsed* shape — not the .md
  // file — because that's what the pipeline compares against.
  let definition: object;
  try {
    definition = JSON.parse(real.definition_json) as object;
  } catch {
    definition = {};
  }

  const duplicateCandidate = {
    name: real.name,
    slug: real.slug,
    description: real.description,
    definition,
    instructions: real.instructions,
    rawSource: '',
  };

  const distinctCandidate = {
    name: 'Synthetic Smoke Test Skill',
    slug: 'synthetic_smoke_test_skill',
    description:
      'A wholly novel skill for verifying the analyzer pipeline ships clean rows. Should never collide with anything in the library.',
    definition: {
      name: 'synthetic_smoke_test_skill',
      description: 'Smoke-test only — does nothing real.',
      input_schema: { type: 'object', properties: { input: { type: 'string' } }, required: [] },
    },
    instructions: 'This skill exists only to verify the analyzer pipeline. Do not invoke it.',
    rawSource: '',
  };

  // Create a paste-source job with both candidates pre-parsed.
  const insertedJobs = await db
    .insert(skillAnalyzerJobs)
    .values({
      organisationId: user.org,
      createdBy: user.id,
      sourceType: 'paste',
      sourceMetadata: { source: 'smoke-test' },
      parsedCandidates: [duplicateCandidate, distinctCandidate],
      status: 'pending',
      progressPct: 0,
    })
    .returning({ id: skillAnalyzerJobs.id });
  const jobId = insertedJobs[0].id;
  console.log(`[setup] created job ${jobId}`);

  // Run the pipeline directly — bypasses pg-boss so we can await it.
  console.log('');
  console.log('[pipeline] running processSkillAnalyzerJob...');
  const t0 = Date.now();
  try {
    await processSkillAnalyzerJob(jobId);
  } catch (err) {
    console.error('[pipeline] FAILED:', err);
    await client.end();
    process.exit(1);
  }
  console.log(`[pipeline] completed in ${Date.now() - t0}ms`);

  // Inspect the resulting rows.
  const finalJob = await db
    .select()
    .from(skillAnalyzerJobs)
    .where(eq(skillAnalyzerJobs.id, jobId))
    .limit(1);
  console.log(`[job] status=${finalJob[0]?.status} progress=${finalJob[0]?.progressPct}%`);
  if (finalJob[0]?.errorMessage) {
    console.error(`[job] error: ${finalJob[0].errorMessage}`);
  }

  const results = await db
    .select()
    .from(skillAnalyzerResults)
    .where(eq(skillAnalyzerResults.jobId, jobId))
    .orderBy(skillAnalyzerResults.candidateIndex);

  console.log('');
  console.log(`[results] count: ${results.length}`);
  for (const r of results) {
    const proposals = (r.agentProposals as unknown as Array<{ score: number; selected: boolean }>) ?? [];
    console.log(`  - idx=${r.candidateIndex} slug=${r.candidateSlug}`);
    console.log(`      classification: ${r.classification}`);
    console.log(`      similarity: ${r.similarityScore?.toFixed(3) ?? 'null'}`);
    console.log(`      candidateContentHash: ${r.candidateContentHash?.slice(0, 12) ?? 'NULL'}…`);
    console.log(`      matchedSkillId: ${r.matchedSkillId ?? 'null'}`);
    console.log(`      agentProposals: ${proposals.length} entries`);
    if (proposals.length > 0) {
      for (const p of proposals.slice(0, 3)) {
        console.log(`        ${(p as { nameSnapshot?: string }).nameSnapshot ?? '?'} score=${p.score.toFixed(3)} selected=${p.selected}`);
      }
    }
  }

  // Sanity assertions
  let failures = 0;
  function assert(cond: boolean, msg: string) {
    if (!cond) {
      console.error(`  ✗ ${msg}`);
      failures++;
    } else {
      console.log(`  ✓ ${msg}`);
    }
  }

  console.log('');
  console.log('[assertions]');
  assert(finalJob[0]?.status === 'completed', 'job status === completed');
  assert(results.length === 2, 'two result rows produced');
  const dup = results.find((r) => r.candidateSlug === real.slug);
  const dist = results.find((r) => r.candidateSlug === 'synthetic_smoke_test_skill');
  assert(!!dup, 'duplicate result row exists');
  assert(!!dist, 'distinct result row exists');
  if (dup) {
    assert(dup.classification === 'DUPLICATE', `duplicate classified as DUPLICATE (got ${dup.classification})`);
    assert(!!dup.candidateContentHash && dup.candidateContentHash.length === 64, 'duplicate has 64-char SHA-256 candidate_content_hash');
  }
  if (dist) {
    assert(
      dist.classification === 'DISTINCT' || dist.classification === 'PARTIAL_OVERLAP',
      `distinct classified as DISTINCT or PARTIAL_OVERLAP (got ${dist.classification})`,
    );
    assert(!!dist.candidateContentHash && dist.candidateContentHash.length === 64, 'distinct has 64-char SHA-256 candidate_content_hash');
    const proposals = (dist.agentProposals as unknown as Array<unknown>) ?? [];
    assert(Array.isArray(proposals), 'distinct agent_proposals is an array');
    if (dist.classification === 'DISTINCT') {
      assert(proposals.length > 0, `distinct agent_proposals populated (got ${proposals.length})`);
    }
  }

  // Cleanup: delete the synthetic job + its result rows so we don't leave
  // smoke-test pollution behind.
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
  console.log('=== Smoke test passed ===');
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
