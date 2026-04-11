/**
 * Verifies the post-Phase-0/1 state of the skill-analyzer-v2 database.
 * Run via: tsx scripts/verify-skill-analyzer-v2-state.ts
 *
 * Reports:
 * - system_skills row count + handler_key population
 * - visibility distribution
 * - presence of new skill_analyzer_results columns
 * - presence of agent_embeddings table
 * - whether SKILL_HANDLERS keys cover every active system_skills.handler_key
 */

import 'dotenv/config';
import { db, client } from '../server/db/index.js';
import { sql } from 'drizzle-orm';
import { systemSkills } from '../server/db/schema/systemSkills.js';
import { SKILL_HANDLERS } from '../server/services/skillExecutor.js';
import { findMissingHandlers } from '../server/services/systemSkillHandlerValidatorPure.js';

async function main(): Promise<void> {
  console.log('=== Skill Analyzer v2 — Post-Migration State Verification ===');
  console.log('');

  // ---------------------------------------------------------------------------
  // 1. system_skills row count + handler_key state
  // ---------------------------------------------------------------------------
  const skills = await db.select().from(systemSkills);
  console.log(`[system_skills] total rows: ${skills.length}`);
  const withHandlerKey = skills.filter((s) => s.handlerKey && s.handlerKey.length > 0).length;
  console.log(`[system_skills] rows with non-empty handler_key: ${withHandlerKey}`);
  const handlerKeyEqualsSlug = skills.filter((s) => s.handlerKey === s.slug).length;
  console.log(`[system_skills] rows where handler_key === slug: ${handlerKeyEqualsSlug}`);

  if (handlerKeyEqualsSlug !== skills.length) {
    console.warn('[system_skills] WARNING: handler_key drifted from slug on some rows');
  }

  // ---------------------------------------------------------------------------
  // 2. visibility distribution
  // ---------------------------------------------------------------------------
  const visibilityCounts: Record<string, number> = {};
  for (const s of skills) {
    visibilityCounts[s.visibility] = (visibilityCounts[s.visibility] ?? 0) + 1;
  }
  console.log(`[system_skills] visibility distribution:`, visibilityCounts);

  const isActiveCount = skills.filter((s) => s.isActive).length;
  console.log(`[system_skills] active rows: ${isActiveCount} / ${skills.length}`);

  // ---------------------------------------------------------------------------
  // 3. SKILL_HANDLERS coverage check (parallels validateSystemSkillHandlers)
  // ---------------------------------------------------------------------------
  const activeHandlerKeys = skills.filter((s) => s.isActive).map((s) => s.handlerKey);
  const registeredKeys = Object.keys(SKILL_HANDLERS);
  console.log(`[skill_handlers] registered handler count: ${registeredKeys.length}`);
  const missing = findMissingHandlers(activeHandlerKeys, registeredKeys);
  if (missing.length > 0) {
    console.error(`[skill_handlers] MISSING HANDLERS for active rows:`, missing);
  } else {
    console.log(`[skill_handlers] all active rows resolve to a registered handler`);
  }

  const orphanedHandlers = registeredKeys.filter((k) => !activeHandlerKeys.includes(k));
  console.log(
    `[skill_handlers] handlers NOT mapped to any active row (meta tools): ${orphanedHandlers.length}`,
  );
  if (orphanedHandlers.length > 0 && orphanedHandlers.length < 20) {
    console.log(`  → ${orphanedHandlers.join(', ')}`);
  }

  // ---------------------------------------------------------------------------
  // 4. skill_analyzer_results new columns
  // ---------------------------------------------------------------------------
  // Drizzle's postgres-js execute returns the rows directly as the result
  // (no .rows wrapper). Use postgres-js iteration instead.
  const colRows = (await db.execute(
    sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'skill_analyzer_results' ORDER BY column_name`,
  )) as unknown as Array<{ column_name: string }>;
  const colNames = colRows.map((r) => r.column_name);
  console.log('');
  console.log('[skill_analyzer_results] columns:');
  for (const c of colNames) console.log(`  - ${c}`);

  const expectedNew = [
    'agent_proposals',
    'proposed_merged_content',
    'original_proposed_merge',
    'user_edited_merge',
    'candidate_content_hash',
  ];
  const expectedDropped = ['matched_system_skill_slug', 'matched_skill_name'];
  const missingNew = expectedNew.filter((c) => !colNames.includes(c));
  const lingeringDropped = expectedDropped.filter((c) => colNames.includes(c));
  if (missingNew.length === 0) {
    console.log('[skill_analyzer_results] all new columns present ✓');
  } else {
    console.error('[skill_analyzer_results] MISSING new columns:', missingNew);
  }
  if (lingeringDropped.length === 0) {
    console.log('[skill_analyzer_results] dropped columns confirmed gone ✓');
  } else {
    console.error('[skill_analyzer_results] dropped columns STILL PRESENT:', lingeringDropped);
  }

  // ---------------------------------------------------------------------------
  // 5. agent_embeddings table presence + row count
  // ---------------------------------------------------------------------------
  const tableRows = (await db.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'agent_embeddings'`,
  )) as unknown as Array<{ table_name: string }>;
  const tableExists = tableRows.length > 0;
  console.log('');
  console.log(`[agent_embeddings] table exists: ${tableExists ? '✓' : '✗'}`);
  if (tableExists) {
    const countRows = (await db.execute(
      sql`SELECT COUNT(*)::int AS count FROM agent_embeddings`,
    )) as unknown as Array<{ count: number }>;
    console.log(`[agent_embeddings] row count: ${countRows[0]?.count ?? 0}`);
  }

  // ---------------------------------------------------------------------------
  // 6. system_agents count (the embedding target)
  // ---------------------------------------------------------------------------
  const agentRows = (await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM system_agents WHERE deleted_at IS NULL`,
  )) as unknown as Array<{ count: number }>;
  console.log(`[system_agents] active rows: ${agentRows[0]?.count ?? 0}`);

  console.log('');
  console.log('=== Verification complete ===');
  await client.end();
}

main().catch(async (err) => {
  console.error('[verify] fatal:', err);
  try {
    await client.end();
  } catch {
    // best-effort
  }
  process.exit(1);
});
