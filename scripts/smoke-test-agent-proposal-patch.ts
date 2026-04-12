/**
 * Smoke test the Phase 4 PATCH /agents endpoint against the live DB.
 * Run via: tsx scripts/smoke-test-agent-proposal-patch.ts
 *
 * Creates a synthetic DISTINCT result row pre-populated with agentProposals,
 * exercises the three modes (toggle, remove, addIfMissing), and verifies
 * the row state at each step. Tests classification gating (409 on
 * non-DISTINCT) and exclusivity validation (400 on multi-mode body).
 */

import 'dotenv/config';
import { db, client } from '../server/db/index.js';
import { sql, eq } from 'drizzle-orm';
import { skillAnalyzerJobs, skillAnalyzerResults, systemAgents } from '../server/db/schema/index.js';
import { updateAgentProposal } from '../server/services/skillAnalyzerService.js';

async function main(): Promise<void> {
  console.log('=== Phase 4 PATCH /agents Smoke Test ===');
  console.log('');

  const userRows = (await db.execute(
    sql`SELECT id::text AS id, organisation_id::text AS org FROM users LIMIT 1`,
  )) as unknown as Array<{ id: string; org: string }>;
  const user = userRows[0];

  // Pick three real system agents for the test fixtures.
  const agents = await db
    .select({ id: systemAgents.id, slug: systemAgents.slug, name: systemAgents.name })
    .from(systemAgents)
    .limit(3);
  if (agents.length < 3) {
    console.error('[setup] need ≥3 system agents for the test, found', agents.length);
    await client.end();
    process.exit(1);
  }
  const [agent1, agent2, agent3] = agents;
  console.log(`[setup] using agents: ${agent1.slug}, ${agent2.slug}, ${agent3.slug}`);

  // Pick a real content hash from skill_embeddings so the addIfMissing
  // path can look up a real candidate embedding. The hash must already
  // exist in skill_embeddings for the manual-add cosine similarity to work.
  const embedRows = (await db.execute(
    sql`SELECT content_hash FROM skill_embeddings LIMIT 1`,
  )) as unknown as Array<{ content_hash: string }>;
  if (!embedRows[0]) {
    console.error('[setup] skill_embeddings is empty — run an analysis first or run the agent embedding smoke test');
    await client.end();
    process.exit(1);
  }
  const realCandidateHash = embedRows[0].content_hash;
  console.log(`[setup] using candidate hash: ${realCandidateHash.slice(0, 12)}…`);

  // 1. Create a parent job
  const insertedJobs = await db
    .insert(skillAnalyzerJobs)
    .values({
      organisationId: user.org,
      createdBy: user.id,
      sourceType: 'paste',
      sourceMetadata: { source: 'smoke-test-patch-agents' },
      parsedCandidates: [],
      status: 'completed',
      progressPct: 100,
    })
    .returning({ id: skillAnalyzerJobs.id });
  const jobId = insertedJobs[0].id;

  // 2. Create a synthetic DISTINCT result with two pre-existing proposals
  const initialProposals = [
    {
      systemAgentId: agent1.id,
      slugSnapshot: agent1.slug,
      nameSnapshot: agent1.name,
      score: 0.8,
      selected: true,
    },
    {
      systemAgentId: agent2.id,
      slugSnapshot: agent2.slug,
      nameSnapshot: agent2.name,
      score: 0.4,
      selected: false,
    },
  ];

  const insertedResults = await db
    .insert(skillAnalyzerResults)
    .values({
      jobId,
      candidateIndex: 0,
      candidateName: 'test_skill',
      candidateSlug: 'test_skill_smoke_patch_agents',
      candidateContentHash: realCandidateHash,
      classification: 'DISTINCT',
      confidence: 0.9,
      similarityScore: 0.3,
      classificationReasoning: 'smoke test',
      agentProposals: initialProposals,
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

  type ProposalRow = {
    systemAgentId: string;
    slugSnapshot: string;
    nameSnapshot: string;
    score: number;
    selected: boolean;
  };

  // 3. TOGGLE — flip agent1 from selected → unselected
  console.log('[toggle] flipping agent1 selected: true → false...');
  const afterToggle = await updateAgentProposal({
    resultId,
    jobId,
    organisationId: user.org,
    systemAgentId: agent1.id,
    selected: false,
  });
  const toggled = (afterToggle.agentProposals as ProposalRow[]).find(
    (p) => p.systemAgentId === agent1.id,
  );
  assert(toggled?.selected === false, 'agent1 selected flipped to false');
  assert((afterToggle.agentProposals as ProposalRow[]).length === 2, 'still 2 proposals after toggle');

  // 4. TOGGLE non-existent — should 404
  console.log('');
  console.log('[toggle] non-existent proposal returns 404...');
  let threw404 = false;
  try {
    await updateAgentProposal({
      resultId,
      jobId,
      organisationId: user.org,
      systemAgentId: '00000000-0000-0000-0000-000000000000',
      selected: true,
    });
  } catch (err) {
    threw404 = true;
    const e = err as { statusCode?: number };
    assert(e.statusCode === 404, `non-existent proposal toggle returned 404 (got ${e.statusCode})`);
  }
  assert(threw404, 'non-existent toggle threw');

  // 5. addIfMissing — append agent3
  console.log('');
  console.log('[addIfMissing] appending agent3...');
  const afterAdd = await updateAgentProposal({
    resultId,
    jobId,
    organisationId: user.org,
    systemAgentId: agent3.id,
    addIfMissing: true,
  });
  const addedProposals = afterAdd.agentProposals as ProposalRow[];
  assert(addedProposals.length === 3, `now 3 proposals (got ${addedProposals.length})`);
  const newAgent = addedProposals.find((p) => p.systemAgentId === agent3.id);
  assert(!!newAgent, 'agent3 present in proposals after addIfMissing');
  assert(newAgent?.selected === true, 'manually-added proposal is selected');
  assert(typeof newAgent?.score === 'number' && newAgent.score >= 0 && newAgent.score <= 1, 'manually-added score is in [0,1]');

  // 6. addIfMissing on already-present agent — no-op
  console.log('');
  console.log('[addIfMissing] no-op when agent already present...');
  const afterNoop = await updateAgentProposal({
    resultId,
    jobId,
    organisationId: user.org,
    systemAgentId: agent3.id,
    addIfMissing: true,
  });
  const noopProposals = afterNoop.agentProposals as ProposalRow[];
  assert(noopProposals.length === 3, 'still 3 proposals after no-op addIfMissing');

  // 7. REMOVE — drop agent2
  console.log('');
  console.log('[remove] removing agent2...');
  const afterRemove = await updateAgentProposal({
    resultId,
    jobId,
    organisationId: user.org,
    systemAgentId: agent2.id,
    remove: true,
  });
  const removed = (afterRemove.agentProposals as ProposalRow[]).find(
    (p) => p.systemAgentId === agent2.id,
  );
  assert(!removed, 'agent2 absent after remove');
  assert((afterRemove.agentProposals as ProposalRow[]).length === 2, '2 proposals after remove');

  // 8. EXCLUSIVITY — body with two modes returns 400
  console.log('');
  console.log('[validation] multi-mode body returns 400...');
  let threw400 = false;
  try {
    await updateAgentProposal({
      resultId,
      jobId,
      organisationId: user.org,
      systemAgentId: agent1.id,
      selected: true,
      remove: true,
    });
  } catch (err) {
    threw400 = true;
    const e = err as { statusCode?: number };
    assert(e.statusCode === 400, `multi-mode body returned 400 (got ${e.statusCode})`);
  }
  assert(threw400, 'multi-mode body threw');

  // 9. CLASSIFICATION GATE — non-DISTINCT row returns 409
  console.log('');
  console.log('[classification gate] non-DISTINCT row returns 409...');
  await db
    .update(skillAnalyzerResults)
    .set({ classification: 'PARTIAL_OVERLAP' })
    .where(eq(skillAnalyzerResults.id, resultId));
  let threw409 = false;
  try {
    await updateAgentProposal({
      resultId,
      jobId,
      organisationId: user.org,
      systemAgentId: agent1.id,
      selected: true,
    });
  } catch (err) {
    threw409 = true;
    const e = err as { statusCode?: number };
    assert(e.statusCode === 409, `non-DISTINCT toggle returned 409 (got ${e.statusCode})`);
  }
  assert(threw409, 'non-DISTINCT toggle threw');

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
  console.log('=== Phase 4 PATCH /agents smoke test passed ===');
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
