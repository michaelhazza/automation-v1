/**
 * scripts/seed-workspace-actors.ts — Workspace actor backfill
 *
 * Backfills workspace_actors rows for every existing agent (via subaccount_agents)
 * and user (via subaccount_user_assignments), then wires FK back-references.
 *
 * Runs as Phase 8 of seed.ts (via the exported seedWorkspaceActors function)
 * and can also be run standalone against an existing database.
 *
 * Backfill order (matches spec §6.6):
 *   1. workspace_actors for agents (one per active subaccount_agents row)
 *   2. workspace_actors for users  (one per subaccount_user_assignments row)
 *   3. Backfill agents.workspace_actor_id + users.workspace_actor_id
 *   4. Backfill workspace_actors.parent_actor_id from subaccount hierarchy
 *   5. Backfill agent_runs.actor_id from agents.workspace_actor_id
 *   6. Selective backfill of audit_events.workspace_actor_id (user + agent actors)
 *      — system actor_type left NULL (no identity anchor for system events)
 *
 * All operations are idempotent:
 *   - Agent/user workspace_actor inserts are guarded by IS NULL on the FK column.
 *   - parent_actor_id backfill checks IS NULL before updating.
 *   - agent_runs / audit_events backfills check IS NULL before updating.
 *
 * Usage (standalone):
 *   npx tsx scripts/seed-workspace-actors.ts
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, isNull, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { workspaceActors } from '../server/db/schema/workspaceActors.js';
import { agents } from '../server/db/schema/agents.js';
import { users } from '../server/db/schema/users.js';
import { subaccountAgents } from '../server/db/schema/subaccountAgents.js';
import { subaccountUserAssignments } from '../server/db/schema/subaccountUserAssignments.js';
import { subaccounts } from '../server/db/schema/subaccounts.js';

// ---------------------------------------------------------------------------
// Core export — called by seed.ts Phase 8 and usable standalone
// ---------------------------------------------------------------------------

export async function seedWorkspaceActors(
  db: NodePgDatabase,
  log: (msg: string) => void = console.log,
): Promise<void> {
  // ── Step 1: workspace_actors for agents ───────────────────────────────────
  // One workspace_actor per active subaccount_agents row where the linked
  // agent does not yet have a workspace_actor_id. Idempotent: the WHERE
  // isNull(agents.workspaceActorId) guard prevents re-creation on re-run.
  const agentCandidates = await db
    .select({
      organisationId: subaccountAgents.organisationId,
      subaccountId: subaccountAgents.subaccountId,
      agentId: subaccountAgents.agentId,
      displayName: agents.name,
      agentRole: subaccountAgents.agentRole,
      agentTitle: subaccountAgents.agentTitle,
    })
    .from(subaccountAgents)
    .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
    .where(and(eq(subaccountAgents.isActive, true), isNull(agents.workspaceActorId), isNull(agents.deletedAt)));

  let agentActorsCreated = 0;
  for (const row of agentCandidates) {
    const [actor] = await db
      .insert(workspaceActors)
      .values({
        organisationId: row.organisationId,
        subaccountId: row.subaccountId,
        actorKind: 'agent',
        displayName: row.displayName,
        agentRole: row.agentRole,
        agentTitle: row.agentTitle,
      })
      .returning({ id: workspaceActors.id });

    await db
      .update(agents)
      .set({ workspaceActorId: actor.id })
      .where(and(eq(agents.id, row.agentId), isNull(agents.workspaceActorId)));

    agentActorsCreated += 1;
  }
  log(`  [ok]   workspace_actors for agents:  ${agentActorsCreated} created`);

  // ── Step 2: workspace_actors for users ────────────────────────────────────
  // One workspace_actor per subaccount_user_assignments row where the linked
  // user does not yet have a workspace_actor_id.
  const userCandidates = await db
    .select({
      subaccountId: subaccountUserAssignments.subaccountId,
      userId: subaccountUserAssignments.userId,
      displayName: users.email,
      organisationId: subaccounts.organisationId,
    })
    .from(subaccountUserAssignments)
    .innerJoin(users, eq(users.id, subaccountUserAssignments.userId))
    .innerJoin(subaccounts, eq(subaccounts.id, subaccountUserAssignments.subaccountId))
    .where(and(isNull(users.workspaceActorId), isNull(users.deletedAt)));

  let userActorsCreated = 0;
  for (const row of userCandidates) {
    const [actor] = await db
      .insert(workspaceActors)
      .values({
        organisationId: row.organisationId,
        subaccountId: row.subaccountId,
        actorKind: 'human',
        displayName: row.displayName,
      })
      .returning({ id: workspaceActors.id });

    await db
      .update(users)
      .set({ workspaceActorId: actor.id })
      .where(and(eq(users.id, row.userId), isNull(users.workspaceActorId)));

    userActorsCreated += 1;
  }
  log(`  [ok]   workspace_actors for users:   ${userActorsCreated} created`);

  // ── Step 3: parent_actor_id from subaccount_agents hierarchy ─────────────
  // Walk the subaccount_agents parent chain: for each workspace_actor (agent)
  // whose parent is not yet wired, find the parent subaccount_agent → parent
  // agent → parent workspace_actor and set parent_actor_id.
  const parentResult = await (db as unknown as { execute: (q: unknown) => Promise<{ rowCount: number }> }).execute(sql`
    UPDATE workspace_actors wa
    SET    parent_actor_id = parent_wa.id,
           updated_at      = NOW()
    FROM   agents           child_agent
    JOIN   subaccount_agents sa
        ON sa.agent_id      = child_agent.id
       AND sa.subaccount_id = wa.subaccount_id
    JOIN   subaccount_agents parent_sa
        ON parent_sa.id     = sa.parent_subaccount_agent_id
    JOIN   agents            parent_agent
        ON parent_agent.id  = parent_sa.agent_id
    JOIN   workspace_actors  parent_wa
        ON parent_wa.id     = parent_agent.workspace_actor_id
    WHERE  wa.actor_kind               = 'agent'
      AND  wa.id                       = child_agent.workspace_actor_id
      AND  wa.parent_actor_id          IS NULL
      AND  parent_agent.workspace_actor_id IS NOT NULL
  `);
  log(`  [ok]   parent_actor_id hierarchy:    ${parentResult.rowCount ?? 0} wired`);

  // ── Step 4: agent_runs.actor_id ──────────────────────────────────────────
  const runsResult = await (db as unknown as { execute: (q: unknown) => Promise<{ rowCount: number }> }).execute(sql`
    UPDATE agent_runs ar
    SET    actor_id    = a.workspace_actor_id,
           updated_at  = NOW()
    FROM   agents a
    WHERE  ar.agent_id             = a.id
      AND  ar.actor_id             IS NULL
      AND  a.workspace_actor_id    IS NOT NULL
  `);
  log(`  [ok]   agent_runs.actor_id:          ${runsResult.rowCount ?? 0} backfilled`);

  // ── Step 5a: audit_events.workspace_actor_id for user actors ─────────────
  const auditUserResult = await (db as unknown as { execute: (q: unknown) => Promise<{ rowCount: number }> }).execute(sql`
    UPDATE audit_events ae
    SET    workspace_actor_id = u.workspace_actor_id
    FROM   users u
    WHERE  ae.actor_type             = 'user'
      AND  ae.actor_id               = u.id
      AND  ae.workspace_actor_id     IS NULL
      AND  u.workspace_actor_id      IS NOT NULL
  `);
  log(`  [ok]   audit_events (user actors):   ${auditUserResult.rowCount ?? 0} backfilled`);

  // ── Step 5b: audit_events.workspace_actor_id for agent actors ────────────
  const auditAgentResult = await (db as unknown as { execute: (q: unknown) => Promise<{ rowCount: number }> }).execute(sql`
    UPDATE audit_events ae
    SET    workspace_actor_id = a.workspace_actor_id
    FROM   agents a
    WHERE  ae.actor_type             = 'agent'
      AND  ae.actor_id               = a.id
      AND  ae.workspace_actor_id     IS NULL
      AND  a.workspace_actor_id      IS NOT NULL
  `);
  log(`  [ok]   audit_events (agent actors):  ${auditAgentResult.rowCount ?? 0} backfilled`);
  // system actor_type → workspace_actor_id intentionally left NULL
}

// ---------------------------------------------------------------------------
// Standalone runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log('\n▸ Workspace actor backfill');
  console.log('  ' + '─'.repeat(30));

  try {
    await seedWorkspaceActors(db, console.log);
    console.log('\n✓ Workspace actor backfill complete.\n');
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('seed-workspace-actors.ts') ||
    process.argv[1]?.endsWith('seed-workspace-actors.js')) {
  main().catch((err) => {
    console.error('\n✗ Backfill failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
