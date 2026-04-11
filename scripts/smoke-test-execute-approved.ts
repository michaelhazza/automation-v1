/**
 * Smoke test the Phase 1+2 executeApproved DISTINCT path against the live DB.
 * Run via: tsx scripts/smoke-test-execute-approved.ts
 *
 * Creates a synthetic DISTINCT result targeting a candidate slug that
 * resolves to a registered handler ('web_search' is one we know is in
 * SKILL_HANDLERS) and that does NOT already exist in system_skills (we use
 * a uniquely-namespaced slug for the test). Picks a real system agent,
 * pre-populates a selected agent proposal for it, then runs executeApproved
 * and verifies:
 *
 * - the new system_skills row was created
 * - the agent's defaultSystemSkillSlugs gained the new slug
 * - the result row reads executionResult: 'created'
 *
 * Then cleans up: deletes the test row from system_skills, removes the new
 * slug from the agent's defaultSystemSkillSlugs, deletes the synthetic job.
 *
 * IMPORTANT: this test reaches into a production-shape code path. The
 * cleanup step is critical. If you Ctrl+C mid-run or it crashes, manually
 * delete the test row + revert the agent's slug array.
 */

import 'dotenv/config';
import { db, client } from '../server/db/index.js';
import { sql, eq } from 'drizzle-orm';
import {
  skillAnalyzerJobs,
  skillAnalyzerResults,
  systemAgents,
  systemSkills,
} from '../server/db/schema/index.js';
import { executeApproved } from '../server/services/skillAnalyzerService.js';
import { SKILL_HANDLERS } from '../server/services/skillExecutor.js';

// Use a slug that:
// - has a registered handler in SKILL_HANDLERS (we register a one-off entry below)
// - is unique enough that it can't collide with an existing system skill
// - is easy to clean up afterwards
const TEST_SLUG = 'smoke_test_execute_approved_temp';

async function main(): Promise<void> {
  console.log('=== executeApproved DISTINCT Smoke Test ===');
  console.log('');

  const userRows = (await db.execute(
    sql`SELECT id::text AS id, organisation_id::text AS org FROM users LIMIT 1`,
  )) as unknown as Array<{ id: string; org: string }>;
  const user = userRows[0];

  // Pre-flight: register a temporary handler so the gate passes. The
  // SKILL_HANDLERS object is mutable at runtime — we install + uninstall
  // around the test.
  const handlersRecord = SKILL_HANDLERS as unknown as Record<string, unknown>;
  if (TEST_SLUG in handlersRecord) {
    console.warn(`[setup] WARNING: ${TEST_SLUG} already in SKILL_HANDLERS — leaving it`);
  } else {
    handlersRecord[TEST_SLUG] = async () => ({ ok: true });
    console.log(`[setup] registered temporary handler for ${TEST_SLUG}`);
  }

  // Pre-flight: confirm no existing row with the test slug.
  const existing = await db.select().from(systemSkills).where(eq(systemSkills.slug, TEST_SLUG)).limit(1);
  if (existing[0]) {
    console.error(
      `[setup] system_skills already has a row for ${TEST_SLUG}. Aborting — clean it up manually first.`,
    );
    delete handlersRecord[TEST_SLUG];
    await client.end();
    process.exit(1);
  }

  // Pick a real system agent + record its starting slug list so we can
  // restore it during cleanup.
  const agentRow = await db.select().from(systemAgents).limit(1);
  const targetAgent = agentRow[0];
  if (!targetAgent) {
    console.error('[setup] no system agents in DB');
    delete handlersRecord[TEST_SLUG];
    await client.end();
    process.exit(1);
  }
  const startingSlugs: string[] = Array.isArray(targetAgent.defaultSystemSkillSlugs)
    ? (targetAgent.defaultSystemSkillSlugs as string[])
    : [];
  console.log(`[setup] target agent: ${targetAgent.slug} (currently has ${startingSlugs.length} skills)`);

  // 1. Create a parent job with the candidate stashed in parsedCandidates
  const candidate = {
    name: 'Smoke Test Skill',
    slug: TEST_SLUG,
    description: 'Synthetic skill for the executeApproved smoke test. Will be deleted at end of run.',
    definition: {
      name: TEST_SLUG,
      description: 'Smoke test only',
      input_schema: { type: 'object', properties: { input: { type: 'string' } }, required: [] },
    },
    instructions: 'Smoke test — does not run.',
    rawSource: '',
  };

  const jobs = await db
    .insert(skillAnalyzerJobs)
    .values({
      organisationId: user.org,
      createdBy: user.id,
      sourceType: 'paste',
      sourceMetadata: { source: 'smoke-test-execute' },
      parsedCandidates: [candidate],
      status: 'completed',
      progressPct: 100,
    })
    .returning({ id: skillAnalyzerJobs.id });
  const jobId = jobs[0].id;

  // 2. Create the DISTINCT result row pre-approved with one selected proposal
  const proposals = [
    {
      systemAgentId: targetAgent.id,
      slugSnapshot: targetAgent.slug,
      nameSnapshot: targetAgent.name,
      score: 0.85,
      selected: true,
    },
  ];

  await db.insert(skillAnalyzerResults).values({
    jobId,
    candidateIndex: 0,
    candidateName: candidate.name,
    candidateSlug: candidate.slug,
    candidateContentHash: 'c'.repeat(64),
    classification: 'DISTINCT',
    confidence: 0.9,
    similarityScore: 0.2,
    classificationReasoning: 'smoke test',
    actionTaken: 'approved',
    actionTakenAt: new Date(),
    actionTakenBy: user.id,
    agentProposals: proposals,
  });

  let failures = 0;
  let createdSkillId: string | null = null;
  function assert(cond: boolean, msg: string) {
    if (!cond) {
      console.error(`  ✗ ${msg}`);
      failures++;
    } else {
      console.log(`  ✓ ${msg}`);
    }
  }

  try {
    // 3. Run executeApproved
    console.log('');
    console.log('[execute] running executeApproved...');
    const summary = await executeApproved({
      jobId,
      organisationId: user.org,
      userId: user.id,
    });
    console.log(`  → created=${summary.created} updated=${summary.updated} failed=${summary.failed}`);
    if (summary.errors.length > 0) {
      console.error(`  errors:`, summary.errors);
    }
    assert(summary.created === 1, 'one skill created');
    assert(summary.failed === 0, 'zero failures');

    // 4. Verify system_skills row exists with the right shape
    const skillRows = await db
      .select()
      .from(systemSkills)
      .where(eq(systemSkills.slug, TEST_SLUG))
      .limit(1);
    assert(skillRows.length === 1, 'system_skills row created');
    if (skillRows[0]) {
      createdSkillId = skillRows[0].id;
      assert(skillRows[0].handlerKey === TEST_SLUG, `handlerKey === slug (got ${skillRows[0].handlerKey})`);
      assert(skillRows[0].isActive === true, 'isActive defaults to true');
    }

    // 5. Verify the agent gained the new slug in its defaultSystemSkillSlugs
    const updatedAgent = await db
      .select()
      .from(systemAgents)
      .where(eq(systemAgents.id, targetAgent.id))
      .limit(1);
    const newSlugs = (updatedAgent[0]?.defaultSystemSkillSlugs as string[]) ?? [];
    console.log(
      `  agent slugs: ${startingSlugs.length} → ${newSlugs.length}`,
    );
    assert(
      newSlugs.includes(TEST_SLUG),
      `agent.defaultSystemSkillSlugs gained ${TEST_SLUG}`,
    );
    assert(
      newSlugs.length === startingSlugs.length + 1,
      `agent slug count incremented by 1 (was ${startingSlugs.length}, now ${newSlugs.length})`,
    );

    // 6. Verify the result row reads executionResult: 'created'
    const finalResults = await db
      .select()
      .from(skillAnalyzerResults)
      .where(eq(skillAnalyzerResults.jobId, jobId))
      .limit(1);
    assert(
      finalResults[0]?.executionResult === 'created',
      `result.executionResult === 'created' (got ${finalResults[0]?.executionResult})`,
    );
  } finally {
    // Cleanup. Best-effort — we want to leave the DB clean even on failure.
    console.log('');
    console.log('[cleanup] reverting agent slug list, deleting test skill, deleting job...');
    try {
      await db
        .update(systemAgents)
        .set({ defaultSystemSkillSlugs: startingSlugs, updatedAt: new Date() })
        .where(eq(systemAgents.id, targetAgent.id));
    } catch (err) {
      console.error('  ✗ failed to revert agent slugs:', err);
    }
    if (createdSkillId) {
      try {
        await db.delete(systemSkills).where(eq(systemSkills.id, createdSkillId));
      } catch (err) {
        console.error('  ✗ failed to delete system_skills row:', err);
      }
    } else {
      // Belt-and-suspenders: delete by slug in case createdSkillId capture failed
      try {
        await db.delete(systemSkills).where(eq(systemSkills.slug, TEST_SLUG));
      } catch {
        // best-effort
      }
    }
    try {
      await db.delete(skillAnalyzerResults).where(eq(skillAnalyzerResults.jobId, jobId));
      await db.delete(skillAnalyzerJobs).where(eq(skillAnalyzerJobs.id, jobId));
    } catch (err) {
      console.error('  ✗ failed to delete job rows:', err);
    }
    delete handlersRecord[TEST_SLUG];
  }

  console.log('');
  if (failures > 0) {
    console.error(`=== FAILED: ${failures} assertion(s) failed ===`);
    await client.end();
    process.exit(1);
  }
  console.log('=== executeApproved smoke test passed ===');
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
