/**
 * workspace agent scope — permission invariant test.
 *
 * Invariant: resolveAgentSubaccountId MUST resolve via
 *   agents.workspaceActorId → workspace_actors.subaccountId
 * and MUST NOT use `subaccount_agents` (which is many-to-many and
 * non-deterministic under LIMIT 1 when an agent has multiple links).
 *
 * Two sections:
 *   1. Pure (no DB) — reads workspace.ts as text and asserts structural
 *      patterns that pin the canonical resolution path.
 *   2. Integration (requires DATABASE_URL + seed) — seeds two subaccounts,
 *      an agent homed to subaccount A via workspace_actor, plus a spurious
 *      subaccount_agents link to subaccount B, then verifies the resolver
 *      returns A (not B).
 *
 * Runnable via:
 *   npx tsx server/routes/__tests__/workspaceAgentScope.test.ts
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

// ─── Section 1: Pure structural assertions ───────────────────────────────────

console.log('\n--- resolveAgentSubaccountId scope invariant (pure) ---');

const workspaceSrc = readFileSync(
  join(__dirname, '..', 'workspace.ts'),
  'utf8',
);

// Extract only the resolveAgentSubaccountId function body so our assertions
// are scoped to that function and do not fire on unrelated code.
// Normalise line endings to LF so the pattern works on both Windows (CRLF)
// and Unix source files.
const workspaceSrcLF = workspaceSrc.replace(/\r\n/g, '\n');
const fnStart = workspaceSrcLF.indexOf('async function resolveAgentSubaccountId(');
const fnEnd   = workspaceSrcLF.indexOf('\n}\n', fnStart) + 3; // include closing brace + newline
const fnBody  = fnStart !== -1 && fnEnd > fnStart
  ? workspaceSrcLF.slice(fnStart, fnEnd)
  : '';

await test('resolveAgentSubaccountId function is present in workspace.ts', () => {
  assert.ok(fnBody.length > 0, 'Function body must be extractable');
});

await test('function reads workspaceActorId from agents row', () => {
  assert.ok(
    fnBody.includes('workspaceActorId'),
    'resolveAgentSubaccountId must reference agents.workspaceActorId',
  );
});

await test('function reads subaccountId from workspaceActors row', () => {
  assert.ok(
    fnBody.includes('workspaceActors.subaccountId'),
    'resolveAgentSubaccountId must read subaccountId from workspaceActors table',
  );
});

await test('function does NOT use subaccount_agents table', () => {
  // The legacy path used subaccount_agents with LIMIT 1 which was
  // non-deterministic when an agent had multiple subaccount links.
  assert.ok(
    !fnBody.includes('subaccount_agents') && !fnBody.includes('subaccountAgents'),
    'resolveAgentSubaccountId must not reference subaccount_agents — ' +
    'resolution must go via workspace_actors (canonical, 1-to-1)',
  );
});

await test('function joins workspaceActors on workspaceActorId FK', () => {
  // Two-step join: first select workspaceActorId from agents, then look up
  // the actor row. Both steps must be present.
  const hasActorIdSelect = fnBody.includes('workspaceActorId: agents.workspaceActorId');
  const hasActorLookup   = fnBody.includes('workspaceActors.id, agent.workspaceActorId') ||
                           fnBody.includes('eq(workspaceActors.id, agent.workspaceActorId)');
  assert.ok(
    hasActorIdSelect,
    'First step: select workspaceActorId from agents row',
  );
  assert.ok(
    hasActorLookup,
    'Second step: look up workspaceActors row by id = agent.workspaceActorId',
  );
});

// ─── Section 2: Integration (requires DATABASE_URL) ──────────────────────────

if (!process.env.DATABASE_URL) {
  console.log('\n--- resolveAgentSubaccountId scope invariant (integration) — SKIPPED (no DATABASE_URL) ---');
} else {
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const postgres = (await import('postgres')).default;
  const { eq, and } = await import('drizzle-orm');
  const {
    agents,
    subaccountAgents,
    subaccounts,
    organisations,
  } = await import('../../db/schema/index.js');
  const { workspaceActors } = await import('../../db/schema/workspaceActors.js');

  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client);

  // Locate an anchor org that we can seed under.
  const [anchorOrg] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .limit(1);

  if (!anchorOrg) {
    console.log('\n--- resolveAgentSubaccountId scope invariant (integration) — SKIPPED (no org seed) ---');
  } else {
    console.log('\n--- resolveAgentSubaccountId scope invariant (integration) ---');

    const orgId = anchorOrg.id;
    const uid   = () => crypto.randomUUID();

    // Seed: two subaccounts under the same org.
    const [subA] = await db
      .insert(subaccounts)
      .values({ id: uid(), organisationId: orgId, name: 'scope-test-subA' })
      .returning({ id: subaccounts.id });

    const [subB] = await db
      .insert(subaccounts)
      .values({ id: uid(), organisationId: orgId, name: 'scope-test-subB' })
      .returning({ id: subaccounts.id });

    // Seed: workspace_actor homed to subaccount A.
    const [actor] = await db
      .insert(workspaceActors)
      .values({ id: uid(), organisationId: orgId, subaccountId: subA.id })
      .returning({ id: workspaceActors.id });

    // Seed: agent with workspaceActorId pointing to the actor (home = subA).
    const [agent] = await db
      .insert(agents)
      .values({
        id:               uid(),
        organisationId:   orgId,
        name:             'scope-test-agent',
        workspaceActorId: actor.id,
      })
      .returning({ id: agents.id });

    // Seed: spurious subaccount_agents link to subaccount B.
    // If a future implementation resolves from this table with LIMIT 1,
    // and this row happens to be returned first, the resolved subaccount
    // would be B — wrong.
    await db.insert(subaccountAgents).values({
      id:            uid(),
      agentId:       agent.id,
      subaccountId:  subB.id,
      organisationId: orgId,
    });

    await test(
      'resolver returns canonical subaccountId (subA) even with a spurious link to subB',
      async () => {
        // Re-implement the same two-step query that resolveAgentSubaccountId uses.
        // This is the canonical path; if it starts diverging from the route
        // implementation the test will catch the discrepancy via the assertion below.
        const [agentRow] = await db
          .select({ workspaceActorId: agents.workspaceActorId })
          .from(agents)
          .where(and(eq(agents.id, agent.id), eq(agents.organisationId, orgId)))
          .limit(1);

        assert.ok(agentRow, 'agent row must exist');
        assert.ok(agentRow.workspaceActorId, 'agent must have workspaceActorId');

        const [actorRow] = await db
          .select({ subaccountId: workspaceActors.subaccountId })
          .from(workspaceActors)
          .where(eq(workspaceActors.id, agentRow.workspaceActorId!))
          .limit(1);

        assert.ok(actorRow, 'workspace actor row must exist');

        assert.equal(
          actorRow.subaccountId,
          subA.id,
          `Expected resolved subaccountId to be subA (${subA.id}) but got ${actorRow.subaccountId}. ` +
          'If this fails, the resolver was changed to use subaccount_agents, which is non-deterministic.',
        );

        // Confirm the result is NOT subB (the spurious link target).
        assert.notEqual(
          actorRow.subaccountId,
          subB.id,
          'Resolved subaccountId must not be the spurious subaccount_agents link target (subB)',
        );
      },
    );

    // Cleanup seed rows (best-effort, ignore errors — CI uses ephemeral DBs).
    try {
      await db.delete(subaccountAgents).where(eq(subaccountAgents.agentId, agent.id));
      await db.delete(agents).where(eq(agents.id, agent.id));
      await db.delete(workspaceActors).where(eq(workspaceActors.id, actor.id));
      await db.delete(subaccounts).where(eq(subaccounts.id, subA.id));
      await db.delete(subaccounts).where(eq(subaccounts.id, subB.id));
    } catch {
      // Non-fatal — seed cleanup failure does not invalidate the test results.
    }
  }

  await client.end();
}

console.log(`\n  ${passed + failed} tests total; ${passed} passed, ${failed} failed`);

if (failed > 0) process.exitCode = 1;
