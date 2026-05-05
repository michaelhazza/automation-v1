// ---------------------------------------------------------------------------
// hierarchyRouteResolverService.ts
//
// Impure wrapper: resolves DB rows, then delegates pure decision logic to
// resolveRootForScopePure. Replaces the inline orchestrator-link resolution
// that previously lived inside orchestratorFromTaskJob.processOrchestratorFromTask.
//
// Uses `db` directly (not RLS-scoped) — runs inside job handlers, an operator
// context. Safe same as the pattern in orchestratorFromTaskJob.
//
// Spec §6.6.
// ---------------------------------------------------------------------------

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountAgents, systemAgents, agents } from '../db/schema/index.js';
import {
  resolveRootForScopePure,
  type OrgLevelLink,
  type SubaccountRootRow,
  type ResolveRootResult,
} from './hierarchyRouteResolverServicePure.js';

export type { ResolveRootResult };

const ORCHESTRATOR_AGENT_SLUG = 'orchestrator';

// ---------------------------------------------------------------------------
// Internal: resolve the org-level Orchestrator link (sentinel subaccount).
// Mirrors the logic in orchestratorFromTaskJob steps 3–6 so both callers
// share the same resolution strategy. Returns null when the org has not yet
// enabled the Orchestrator.
// ---------------------------------------------------------------------------

async function resolveOrgLevelLink(organisationId: string): Promise<OrgLevelLink | null> {
  const [systemAgent] = await db
    .select({ id: systemAgents.id })
    .from(systemAgents)
    .where(eq(systemAgents.slug, ORCHESTRATOR_AGENT_SLUG))
    .limit(1);

  if (!systemAgent) return null;

  const baseConditions = [
    eq(subaccountAgents.organisationId, organisationId),
    eq(agents.systemAgentId, systemAgent.id),
    eq(subaccountAgents.isActive, true),
  ];

  // Deterministic: pick oldest active Orchestrator link for this org.
  const [any] = await db
    .select({
      subaccountAgentId: subaccountAgents.id,
      agentId: subaccountAgents.agentId,
      subaccountId: subaccountAgents.subaccountId,
    })
    .from(subaccountAgents)
    .innerJoin(agents, and(eq(subaccountAgents.agentId, agents.id), isNull(agents.deletedAt)))
    .where(and(...baseConditions))
    .orderBy(subaccountAgents.createdAt, subaccountAgents.id)
    .limit(1);

  return any ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the root subaccount-agent for the given scope.
 *
 * - 'subaccount': queries `subaccount_agents` for root rows on the given
 *   subaccount, then delegates to pure decision logic (may fall back to the
 *   org-level Orchestrator link).
 * - 'org': resolves the org-level Orchestrator link directly.
 * - 'system': returns null (no routable target exists today).
 */
export async function resolveRootForScope(input: {
  organisationId: string;
  subaccountId: string | null | undefined;
  scope: 'subaccount' | 'org' | 'system';
}): Promise<ResolveRootResult | null> {
  const { organisationId, scope } = input;
  const subaccountId = input.subaccountId ?? null;

  if (scope === 'system') {
    // Pure function short-circuits immediately; no DB queries needed.
    return resolveRootForScopePure({ scope, subaccountId, subaccountRoots: [], orgLevelLink: null });
  }

  if (scope === 'org') {
    const orgLevelLink = await resolveOrgLevelLink(organisationId);
    return resolveRootForScopePure({ scope, subaccountId, subaccountRoots: [], orgLevelLink });
  }

  // scope === 'subaccount'
  let subaccountRoots: SubaccountRootRow[] = [];

  if (subaccountId !== null) {
    const rows = await db
      .select({
        subaccountAgentId: subaccountAgents.id,
        agentId: subaccountAgents.agentId,
        subaccountId: subaccountAgents.subaccountId,
        createdAt: subaccountAgents.createdAt,
      })
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.subaccountId, subaccountId),
          isNull(subaccountAgents.parentSubaccountAgentId),
          eq(subaccountAgents.isActive, true),
        ),
      );
    subaccountRoots = rows;
  }

  // Only fetch the org-level fallback when we might actually need it.
  // If the subaccount has a configured root, the pure function returns
  // immediately and the org link is never read — avoid the extra DB round-trip.
  const needsOrgFallback = subaccountId === null || subaccountRoots.length === 0;
  const orgLevelLink = needsOrgFallback ? await resolveOrgLevelLink(organisationId) : null;

  return resolveRootForScopePure({ scope, subaccountId, subaccountRoots, orgLevelLink });
}
