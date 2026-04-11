/**
 * Smoke test the getJob() response shape against the live DB.
 * Run via: tsx scripts/smoke-test-getjob-shape.ts
 *
 * Creates a job, runs the pipeline, calls getJob, asserts the response
 * shape matches what the client expects (matchedSkillContent on results,
 * unregisteredHandlerSlugs + availableSystemAgents on the job). Cleans up
 * the synthetic job afterwards.
 */

import 'dotenv/config';
import { db, client } from '../server/db/index.js';
import { sql, eq } from 'drizzle-orm';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../server/db/schema/index.js';
import { processSkillAnalyzerJob } from '../server/jobs/skillAnalyzerJob.js';
import { getJob } from '../server/services/skillAnalyzerService.js';

async function main(): Promise<void> {
  console.log('=== getJob() Response Shape Smoke Test ===');
  console.log('');

  const userRows = (await db.execute(
    sql`SELECT id::text AS id, organisation_id::text AS org FROM users LIMIT 1`,
  )) as unknown as Array<{ id: string; org: string }>;
  const user = userRows[0];
  if (!user) {
    console.error('[setup] no users in DB');
    await client.end();
    process.exit(1);
  }

  // Pick a real skill to mirror as a duplicate so getJob has a non-null
  // matchedSkillId to dereference into matchedSkillContent.
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
  const definition = (() => {
    try {
      return JSON.parse(real.definition_json);
    } catch {
      return {};
    }
  })();

  const candidate = {
    name: real.name,
    slug: real.slug,
    description: real.description,
    definition,
    instructions: real.instructions,
    rawSource: '',
  };

  const inserted = await db
    .insert(skillAnalyzerJobs)
    .values({
      organisationId: user.org,
      createdBy: user.id,
      sourceType: 'paste',
      sourceMetadata: { source: 'smoke-test-getjob' },
      parsedCandidates: [candidate],
      status: 'pending',
      progressPct: 0,
    })
    .returning({ id: skillAnalyzerJobs.id });
  const jobId = inserted[0].id;

  await processSkillAnalyzerJob(jobId);

  // Now call getJob and verify shape
  const response = await getJob(jobId, user.org);

  let failures = 0;
  function assert(cond: boolean, msg: string) {
    if (!cond) {
      console.error(`  ✗ ${msg}`);
      failures++;
    } else {
      console.log(`  ✓ ${msg}`);
    }
  }

  console.log('[shape assertions]');
  assert(typeof response === 'object', 'response is an object');
  assert('job' in response, 'response.job present');
  assert('results' in response, 'response.results present');
  assert('unregisteredHandlerSlugs' in response, 'response.unregisteredHandlerSlugs present');
  assert('availableSystemAgents' in response, 'response.availableSystemAgents present');

  assert(Array.isArray(response.unregisteredHandlerSlugs), 'unregisteredHandlerSlugs is an array');
  assert(
    response.unregisteredHandlerSlugs.length === 0,
    `unregisteredHandlerSlugs is empty for an in-library duplicate (got ${response.unregisteredHandlerSlugs.length})`,
  );

  assert(Array.isArray(response.availableSystemAgents), 'availableSystemAgents is an array');
  assert(
    response.availableSystemAgents.length > 0,
    `availableSystemAgents populated (got ${response.availableSystemAgents.length})`,
  );
  if (response.availableSystemAgents.length > 0) {
    const sample = response.availableSystemAgents[0];
    assert(typeof sample.systemAgentId === 'string', 'availableSystemAgents[0].systemAgentId is a string');
    assert(typeof sample.slug === 'string', 'availableSystemAgents[0].slug is a string');
    assert(typeof sample.name === 'string', 'availableSystemAgents[0].name is a string');
  }

  assert(response.results.length === 1, 'one result row returned');
  const result = response.results[0];
  if (result) {
    assert(result.classification === 'DUPLICATE', `classification === DUPLICATE (got ${result.classification})`);
    assert(!!result.matchedSkillId, 'matchedSkillId set');
    assert(!!result.matchedSkillContent, 'matchedSkillContent attached');
    if (result.matchedSkillContent) {
      assert(typeof result.matchedSkillContent.id === 'string', 'matchedSkillContent.id is a string');
      assert(typeof result.matchedSkillContent.slug === 'string', 'matchedSkillContent.slug is a string');
      assert(typeof result.matchedSkillContent.name === 'string', 'matchedSkillContent.name is a string');
      assert(typeof result.matchedSkillContent.description === 'string', 'matchedSkillContent.description is a string');
      assert(typeof result.matchedSkillContent.definition === 'object', 'matchedSkillContent.definition is an object');
      // instructions can be string OR null
    }
    assert(!!result.candidateContentHash && result.candidateContentHash.length === 64, 'candidateContentHash is 64-char hex');
  }

  // cleanup
  await db.delete(skillAnalyzerResults).where(eq(skillAnalyzerResults.jobId, jobId));
  await db.delete(skillAnalyzerJobs).where(eq(skillAnalyzerJobs.id, jobId));

  console.log('');
  if (failures > 0) {
    console.error(`=== FAILED: ${failures} assertion(s) failed ===`);
    await client.end();
    process.exit(1);
  }
  console.log('=== getJob shape smoke test passed ===');
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
