import { eq, and } from 'drizzle-orm';
import { db, type Transaction } from '../db/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { subaccountAgents, agents } from '../db/schema/index.js';
import { isActive } from '../lib/queryHelpers.js';
import {
  loadIntegrationReference,
  type IntegrationReferenceSnapshot,
} from './integrationReferenceService.js';
import type { RoutingContextV2 } from '../../shared/types/routingContext.js';

// ---------------------------------------------------------------------------
// Capability Map Service
//
// Derives and caches the capability map for each subaccount agent link. See
// docs/orchestrator-capability-routing-spec.md §4.3.
//
// The capability map is computed from the agent's active skill set crossed
// with the Integration Reference. When a skill is listed in an integration's
// `skills_enabled`, that integration's capabilities flow into the agent's
// map. Skills that do not appear in the Integration Reference contribute
// only themselves to the map's `skills` list.
//
// Invalidation / recomputation triggers:
//   1. Synchronous — called by subaccountAgentService on skill-link changes
//      (addSkill / removeSkill / setSkills / setAllowedSkillSlugs)
//   2. Async — called by the background reconciliation job when the
//      Integration Reference is updated or the in-memory cache TTL expires
//
// NULL capability_map = not yet computed; check_capability_gap treats as
// zero-capability so Path A cannot fire against stale/missing maps.
// ---------------------------------------------------------------------------

export interface CapabilityMap {
  computedAt: string;
  /**
   * The Integration Reference's `schema_meta.last_updated` value at the
   * moment this map was computed. check_capability_gap compares this
   * against the current reference's last_updated to detect stale maps
   * deterministically — avoiding timestamp parsing of computedAt on every
   * gap check. May be missing on pre-0158 maps; absence is treated as
   * 'potentially stale' and falls back to the computedAt comparison.
   */
  referenceLastUpdated?: string;
  integrations: string[];
  read_capabilities: string[];
  write_capabilities: string[];
  skills: string[];
  primitives: string[];
  /** Set when this capability map belongs to a user-owned agent (V2, spec §5.1). */
  owner_user_id?: string;
}

/**
 * Strict match between a skill slug and an integration slug for the
 * fuzzy-fallback path (when skills_enabled is empty). Uses word-boundary
 * matching to avoid false positives like "slackoff" matching "slack", or
 * "notifysync" matching "notion". The skill slug must start with, end
 * with, or contain the integration slug surrounded by underscores.
 *
 * Example matches for integration 'slack': 'send_slack', 'slack_notify',
 * 'post_to_slack_channel'. Example non-matches: 'slackoff', 'unslacked'.
 */
function skillMatchesIntegrationFuzzy(skillSlug: string, integrationSlug: string): boolean {
  const normalised = integrationSlug.replace(/-/g, '_');
  const pattern = new RegExp(`(^|_)${normalised.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_|$)`);
  return pattern.test(skillSlug);
}

/**
 * Pure computation: derive the capability map from a skill slug list and the
 * Integration Reference snapshot. Exposed for unit testing; no IO.
 */
export function computeCapabilityMapPure(
  skillSlugs: string[],
  snapshot: IntegrationReferenceSnapshot,
  options: { scheduleEnabled: boolean; heartbeatEnabled: boolean } = { scheduleEnabled: false, heartbeatEnabled: false },
  agentRow?: { owner_user_id?: string | null },
): CapabilityMap {
  const integrations = new Set<string>();
  const reads = new Set<string>();
  const writes = new Set<string>();
  const skills = new Set<string>(skillSlugs);
  const primitives = new Set<string>();

  // Every agent implicitly has access to the task_board primitive
  primitives.add('task_board');

  // Scheduling primitives only flow in when the agent is actually scheduled
  if (options.scheduleEnabled || options.heartbeatEnabled) {
    primitives.add('scheduled_run');
  }

  for (const integration of snapshot.integrations) {
    // When skills_enabled is populated use exact slug membership. When it is
    // empty fall back to strict word-boundary fuzzy match so an integration
    // with incomplete reference data can still contribute capabilities for
    // Path B handoff decisions (never Path A — uncomputed maps block Path A).
    const hasMatchingSkill = integration.skills_enabled.length > 0
      ? integration.skills_enabled.some((slug) => skillSlugs.includes(slug))
      : skillSlugs.some((s) => skillMatchesIntegrationFuzzy(s, integration.slug));
    if (!hasMatchingSkill) continue;

    integrations.add(integration.slug);
    for (const r of integration.read_capabilities) reads.add(r);
    for (const w of integration.write_capabilities) writes.add(w);
    for (const p of integration.primitives_required) primitives.add(p);
  }

  const result: CapabilityMap = {
    computedAt: new Date().toISOString(),
    referenceLastUpdated: snapshot.schema_meta.last_updated || undefined,
    integrations: Array.from(integrations).sort(),
    read_capabilities: Array.from(reads).sort(),
    write_capabilities: Array.from(writes).sort(),
    skills: Array.from(skills).sort(),
    primitives: Array.from(primitives).sort(),
  };

  if (agentRow?.owner_user_id != null) {
    result.owner_user_id = agentRow.owner_user_id;
  }

  return result;
}

/**
 * Recompute the capability map for a single subaccount_agent row and persist
 * it. Called synchronously from skill-link mutation paths (§4.3 of the spec).
 */
export async function recomputeCapabilityMap(subaccountAgentId: string): Promise<CapabilityMap | null> {
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="called within withOrgTx context from route handler — orgId in ALS"
  const [row] = await db
    .select({
      id: subaccountAgents.id,
      skillSlugs: subaccountAgents.skillSlugs,
      allowedSkillSlugs: subaccountAgents.allowedSkillSlugs,
      scheduleEnabled: subaccountAgents.scheduleEnabled,
      heartbeatEnabled: subaccountAgents.heartbeatEnabled,
    })
    .from(subaccountAgents)
    .where(eq(subaccountAgents.id, subaccountAgentId));

  if (!row) return null;

  // Active skill set: the intersection of skillSlugs and allowedSkillSlugs
  // when allowedSkillSlugs is non-null (restricts), otherwise skillSlugs alone.
  const base = Array.isArray(row.skillSlugs) ? row.skillSlugs : [];
  const allowed = Array.isArray(row.allowedSkillSlugs) ? row.allowedSkillSlugs : null;
  const effective = allowed ? base.filter((slug) => allowed.includes(slug)) : base;

  const snapshot = await loadIntegrationReference();
  const map = computeCapabilityMapPure(effective, snapshot, {
    scheduleEnabled: row.scheduleEnabled,
    heartbeatEnabled: row.heartbeatEnabled,
  });

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="called within withOrgTx context from route handler — orgId in ALS"
  await db
    .update(subaccountAgents)
    .set({ capabilityMap: map, updatedAt: new Date() })
    .where(eq(subaccountAgents.id, subaccountAgentId));

  return map;
}

/**
 * Recompute maps for every subaccount_agent in the given org. Called by the
 * background reconciliation job after the Integration Reference changes.
 */
export async function recomputeOrgCapabilityMaps(organisationId: string): Promise<{ updated: number; errors: string[] }> {
  const scopedDb = getOrgScopedDb('capabilityMapService.recomputeOrgCapabilityMaps');
  const rows = await scopedDb
    .select({ id: subaccountAgents.id })
    .from(subaccountAgents)
    .where(eq(subaccountAgents.organisationId, organisationId));

  const errors: string[] = [];
  let updated = 0;
  for (const row of rows) {
    try {
      await recomputeCapabilityMap(row.id);
      updated++;
    } catch (err) {
      errors.push(`subaccount_agent ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { updated, errors };
}

/**
 * List linked agents for (org, subaccount) with their capability maps.
 * Used by check_capability_gap to compute Path A matches.
 */
export async function listAgentCapabilityMaps(
  organisationId: string,
  subaccountId: string | null,
): Promise<Array<{ subaccountAgentId: string; agentId: string; agentName: string; capabilityMap: CapabilityMap | null }>> {
  const conditions = [
    eq(subaccountAgents.organisationId, organisationId),
    eq(subaccountAgents.isActive, true),
  ];
  if (subaccountId !== null) {
    conditions.push(eq(subaccountAgents.subaccountId, subaccountId));
  }

  const scopedDb = getOrgScopedDb('capabilityMapService.listAgentCapabilityMaps');
  const rows = await scopedDb
    .select({
      subaccountAgentId: subaccountAgents.id,
      agentId: agents.id,
      agentName: agents.name,
      capabilityMap: subaccountAgents.capabilityMap,
    })
    .from(subaccountAgents)
    // Exclude soft-deleted agents — a soft-deleted agent can still have an
    // active subaccount_agents row, and we must not route tasks to it.
    .innerJoin(agents, and(eq(subaccountAgents.agentId, agents.id), isActive(agents)))
    .where(and(...conditions));

  return rows.map((r) => ({
    subaccountAgentId: r.subaccountAgentId,
    agentId: r.agentId,
    agentName: r.agentName,
    capabilityMap: r.capabilityMap,
  }));
}

export interface RoutingCandidate {
  subaccountAgentId: string;
  agentId: string;
  agentName: string;
  capabilityMap: CapabilityMap | null;
}

export interface MatchedCandidate {
  candidate: RoutingCandidate;
  /** Additive score boost from @address match. 0 when no address matched. */
  scoreBoost: number;
}

/**
 * Two-axis ownership filter + address score boost per spec §5.2–§5.3.
 *
 * Rule:
 *   if candidate.capabilityMap.owner_user_id is set:
 *     match iff owner_user_id == (target_owner_user_id ?? requester_user_id)
 *   else:
 *     pass through (subaccount-scoped; already filtered at DB layer)
 *
 * Score boost of 0.15 is applied when addressed_agent.id == candidate.agentId
 * AND the candidate passed the ownership check. A capability-failed candidate
 * (null map or ownership mismatch) cannot be promoted by the boost.
 *
 * Returns candidates that passed the ownership check, sorted by scoreBoost
 * descending (highest boost first so the caller's first-match loop favours
 * the addressed agent).
 */
export function matchCapability(
  routingContext: RoutingContextV2,
  candidates: RoutingCandidate[],
): MatchedCandidate[] {
  const results: MatchedCandidate[] = [];

  for (const c of candidates) {
    const map = c.capabilityMap;
    if (map == null) continue; // null map blocks routing per spec

    // Two-axis owner rule
    if (map.owner_user_id != null) {
      const targetOwner = routingContext.target_owner_user_id ?? routingContext.requester_user_id;
      if (map.owner_user_id !== targetOwner) continue;
    }
    // Else: no owner_user_id = subaccount-scoped agent; DB already filtered; pass through

    const scoreBoost =
      routingContext.addressed_agent?.id === c.agentId
        ? routingContext.addressed_agent.score_boost
        : 0;

    results.push({ candidate: c, scoreBoost });
  }

  return results.sort((a, b) => b.scoreBoost - a.scoreBoost);
}

/**
 * Recompute and persist the capability map for a single subaccount_agent row,
 * including the owning agent's owner_user_id in the output (spec §6.4 invariant).
 *
 * Pass `tx` to run inside the caller's Drizzle transaction — required when this
 * is called in the same transaction as an agents.owner_user_id update so that
 * capability_map.owner_user_id stays in sync atomically (spec §6.4).
 */
export async function recomputeCapabilityMapWithOwner(
  subaccountAgentId: string,
  tx?: Transaction,
): Promise<CapabilityMap | null> {
  const client = tx ?? db;

  const [row] = await client
    .select({
      id: subaccountAgents.id,
      skillSlugs: subaccountAgents.skillSlugs,
      allowedSkillSlugs: subaccountAgents.allowedSkillSlugs,
      scheduleEnabled: subaccountAgents.scheduleEnabled,
      heartbeatEnabled: subaccountAgents.heartbeatEnabled,
      ownerUserId: agents.ownerUserId,
    })
    .from(subaccountAgents)
    .innerJoin(agents, eq(subaccountAgents.agentId, agents.id))
    .where(eq(subaccountAgents.id, subaccountAgentId));

  if (!row) return null;

  const base = Array.isArray(row.skillSlugs) ? row.skillSlugs : [];
  const allowed = Array.isArray(row.allowedSkillSlugs) ? row.allowedSkillSlugs : null;
  const effective = allowed ? base.filter((slug) => allowed.includes(slug)) : base;

  const snapshot = await loadIntegrationReference();
  const map = computeCapabilityMapPure(
    effective,
    snapshot,
    { scheduleEnabled: row.scheduleEnabled, heartbeatEnabled: row.heartbeatEnabled },
    { owner_user_id: row.ownerUserId },
  );

  await client
    .update(subaccountAgents)
    .set({ capabilityMap: map, updatedAt: new Date() })
    .where(eq(subaccountAgents.id, subaccountAgentId));

  return map;
}
