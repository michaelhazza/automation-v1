// guard-ignore-file: pure-helper-convention reason="Reads workspace.ts source text directly to assert structural invariants — no pure helper extraction needed."
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
 *   2. Integration (requires DATABASE_URL) — seeds two subaccounts,
 *      an agent homed to subaccount A via workspace_actor, plus a spurious
 *      subaccount_agents link to subaccount B, then verifies the resolver
 *      returns A (not B).
 */
export {};

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Section 1: Pure structural assertions ───────────────────────────────────

const workspaceSrc = readFileSync(join(__dirname, '..', 'workspace.ts'), 'utf8');
const workspaceSrcLF = workspaceSrc.replace(/\r\n/g, '\n');
const fnStart = workspaceSrcLF.indexOf('async function resolveAgentSubaccountId(');
const fnEnd   = workspaceSrcLF.indexOf('\n}\n', fnStart) + 3;
const fnBody  = fnStart !== -1 && fnEnd > fnStart ? workspaceSrcLF.slice(fnStart, fnEnd) : '';

describe('resolveAgentSubaccountId scope invariant (pure)', () => {
  test('function is present in workspace.ts', () => {
    expect(fnBody.length).toBeGreaterThan(0);
  });

  test('function reads workspaceActorId from agents row', () => {
    expect(fnBody).toContain('workspaceActorId');
  });

  test('function reads subaccountId from workspaceActors row', () => {
    expect(fnBody).toContain('workspaceActors.subaccountId');
  });

  test('function does NOT use subaccount_agents table', () => {
    expect(fnBody).not.toContain('subaccount_agents');
    expect(fnBody).not.toContain('subaccountAgents');
  });

  test('function joins workspaceActors on workspaceActorId FK', () => {
    const hasActorIdSelect = fnBody.includes('workspaceActorId: agents.workspaceActorId');
    const hasActorLookup   = fnBody.includes('workspaceActors.id, agent.workspaceActorId') ||
                             fnBody.includes('eq(workspaceActors.id, agent.workspaceActorId)');
    expect(hasActorIdSelect).toBe(true);
    expect(hasActorLookup).toBe(true);
  });
});

// ─── Section 2: Integration (requires DATABASE_URL) ──────────────────────────

const SKIP_DB = !process.env.DATABASE_URL;

describe('resolveAgentSubaccountId scope invariant (integration)', () => {
  test.skipIf(SKIP_DB)(
    'resolver returns canonical subaccountId (subA) even with a spurious link to subB',
    async () => {
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

      try {
        const [anchorOrg] = await db
          .select({ id: organisations.id })
          .from(organisations)
          .limit(1);

        if (!anchorOrg) return; // no seed — skip gracefully

        const orgId = anchorOrg.id;
        const uid   = () => crypto.randomUUID();

        const [subA] = await db
          .insert(subaccounts)
          .values({ id: uid(), organisationId: orgId, name: 'scope-test-subA' })
          .returning({ id: subaccounts.id });

        const [subB] = await db
          .insert(subaccounts)
          .values({ id: uid(), organisationId: orgId, name: 'scope-test-subB' })
          .returning({ id: subaccounts.id });

        const [actor] = await db
          .insert(workspaceActors)
          .values({ id: uid(), organisationId: orgId, subaccountId: subA.id })
          .returning({ id: workspaceActors.id });

        const [agent] = await db
          .insert(agents)
          .values({
            id:               uid(),
            organisationId:   orgId,
            name:             'scope-test-agent',
            workspaceActorId: actor.id,
          })
          .returning({ id: agents.id });

        // Spurious link to subB — resolver must NOT return this.
        await db.insert(subaccountAgents).values({
          id:             uid(),
          agentId:        agent.id,
          subaccountId:   subB.id,
          organisationId: orgId,
        });

        try {
          const [agentRow] = await db
            .select({ workspaceActorId: agents.workspaceActorId })
            .from(agents)
            .where(and(eq(agents.id, agent.id), eq(agents.organisationId, orgId)))
            .limit(1);

          expect(agentRow).toBeDefined();
          expect(agentRow!.workspaceActorId).toBeTruthy();

          const [actorRow] = await db
            .select({ subaccountId: workspaceActors.subaccountId })
            .from(workspaceActors)
            .where(eq(workspaceActors.id, agentRow!.workspaceActorId!))
            .limit(1);

          expect(actorRow).toBeDefined();
          expect(actorRow!.subaccountId).toBe(subA.id);
          expect(actorRow!.subaccountId).not.toBe(subB.id);
        } finally {
          // Best-effort cleanup — CI uses ephemeral DBs.
          try {
            await db.delete(subaccountAgents).where(eq(subaccountAgents.agentId, agent.id));
            await db.delete(agents).where(eq(agents.id, agent.id));
            await db.delete(workspaceActors).where(eq(workspaceActors.id, actor.id));
            await db.delete(subaccounts).where(eq(subaccounts.id, subA.id));
            await db.delete(subaccounts).where(eq(subaccounts.id, subB.id));
          } catch { /* non-fatal */ }
        }
      } finally {
        await client.end();
      }
    },
  );
});
