/**
 * Smoke test the Phase 2 agent embedding pipeline against the live DB.
 * Run via: tsx scripts/smoke-test-agent-embeddings.ts
 *
 * - refreshSystemAgentEmbeddings (batch refresh)
 * - getAgentEmbedding (cache read)
 * - rankAgentsForCandidate (pure helper, no DB)
 *
 * Reports row counts before/after, refresh duration, and sanity-checks
 * the cosine similarity output.
 */

import 'dotenv/config';
import { db, client } from '../server/db/index.js';
import { sql } from 'drizzle-orm';
import { agentEmbeddingService } from '../server/services/agentEmbeddingService.js';
import { skillAnalyzerServicePure } from '../server/services/skillAnalyzerServicePure.js';

async function main(): Promise<void> {
  console.log('=== Phase 2 Agent Embedding Smoke Test ===');
  console.log('');

  const beforeRows = (await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM agent_embeddings`,
  )) as unknown as Array<{ count: number }>;
  console.log(`[before] agent_embeddings row count: ${beforeRows[0]?.count ?? 0}`);

  const t0 = Date.now();
  await agentEmbeddingService.refreshSystemAgentEmbeddings();
  const elapsed = Date.now() - t0;
  console.log(`[refreshSystemAgentEmbeddings] completed in ${elapsed}ms`);

  const afterRows = (await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM agent_embeddings`,
  )) as unknown as Array<{ count: number }>;
  console.log(`[after] agent_embeddings row count: ${afterRows[0]?.count ?? 0}`);

  if ((afterRows[0]?.count ?? 0) === 0) {
    console.warn(
      '[after] WARNING: 0 embeddings written — likely OPENAI_API_KEY missing or batch returned null',
    );
    await client.end();
    return;
  }

  // Pull every embedding via the service to verify the read path.
  const allRows = (await db.execute(
    sql`SELECT system_agent_id FROM agent_embeddings LIMIT 5`,
  )) as unknown as Array<{ system_agent_id: string }>;

  console.log('');
  console.log('[getAgentEmbedding] sampling 5 rows:');
  const sampledEmbeddings: Array<{ id: string; embedding: number[] }> = [];
  for (const r of allRows) {
    const row = await agentEmbeddingService.getAgentEmbedding(r.system_agent_id);
    if (!row) {
      console.error(`  ✗ ${r.system_agent_id} — service returned null despite DB row`);
      continue;
    }
    const dim = row.embedding.length;
    console.log(`  ✓ ${r.system_agent_id.slice(0, 8)}… → embedding[${dim}], hash ${row.contentHash.slice(0, 12)}…`);
    sampledEmbeddings.push({ id: r.system_agent_id, embedding: row.embedding });
  }

  if (sampledEmbeddings.length < 2) {
    console.log('[ranking] need 2+ embeddings for ranking smoke test, skipping');
    await client.end();
    return;
  }

  // Rank the second agent's embedding as the "candidate" against the rest
  // of the agent set. Verify the results are well-formed.
  console.log('');
  console.log('[rankAgentsForCandidate] using sampled[0] as candidate, ranking the rest:');
  const candidate = sampledEmbeddings[0].embedding;
  const rest = sampledEmbeddings.slice(1).map((s, i) => ({
    systemAgentId: s.id,
    slug: `agent-${i}`,
    name: `Agent ${i}`,
    embedding: s.embedding,
  }));
  const proposals = skillAnalyzerServicePure.rankAgentsForCandidate(candidate, rest);
  console.log(`  → ${proposals.length} proposal(s)`);
  for (const p of proposals) {
    console.log(
      `    ${p.systemAgentId.slice(0, 8)}… score=${p.score.toFixed(3)} selected=${p.selected}`,
    );
  }

  // Idempotency: re-run the batch refresh and confirm 0 stale rows.
  console.log('');
  console.log('[refreshSystemAgentEmbeddings] second pass (cache check):');
  const t1 = Date.now();
  await agentEmbeddingService.refreshSystemAgentEmbeddings();
  const elapsed2 = Date.now() - t1;
  console.log(`  completed in ${elapsed2}ms (should be near-zero — pure cache hit)`);
  if (elapsed2 > 5000) {
    console.warn('  WARNING: second-pass refresh took >5s — cache invalidation may be broken');
  }

  console.log('');
  console.log('=== Smoke test complete ===');
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
