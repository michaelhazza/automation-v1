import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountAgents, agents } from '../db/schema/index.js';
import {
  loadIntegrationReference,
  type IntegrationReferenceSnapshot,
} from './integrationReferenceService.js';

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
  integrations: string[];
  read_capabilities: string[];
  write_capabilities: string[];
  skills: string[];
  primitives: string[];
}

/**
 * Pure computation: derive the capability map from a skill slug list and the
 * Integration Reference snapshot. Exposed for unit testing; no IO.
 */
export function computeCapabilityMapPure(
  skillSlugs: string[],
  snapshot: IntegrationReferenceSnapshot,
  options: { scheduleEnabled: boolean; heartbeatEnabled: boolean } = { scheduleEnabled: false, heartbeatEnabled: false },
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
    // If the agent has any skill that this integration enables, the
    // integration's capabilities flow in. Also match when skills_enabled is
    // empty but the agent has a skill whose slug contains the integration
    // slug (e.g. "send_to_slack" matches integration slug "slack"). This
    // handles integrations whose skills_enabled hasn't been populated yet.
    const hasMatchingSkill = integration.skills_enabled.length > 0
      ? integration.skills_enabled.some((slug) => skillSlugs.includes(slug))
      : skillSlugs.some((s) => s.includes(integration.slug.replace(/-/g, '_')) || s.includes(integration.slug));
    if (!hasMatchingSkill) continue;

    integrations.add(integration.slug);
    for (const r of integration.read_capabilities) reads.add(r);
    for (const w of integration.write_capabilities) writes.add(w);
    for (const p of integration.primitives_required) primitives.add(p);
  }

  return {
    computedAt: new Date().toISOString(),
    integrations: Array.from(integrations).sort(),
    read_capabilities: Array.from(reads).sort(),
    write_capabilities: Array.from(writes).sort(),
    skills: Array.from(skills).sort(),
    primitives: Array.from(primitives).sort(),
  };
}

/**
 * Recompute the capability map for a single subaccount_agent row and persist
 * it. Called synchronously from skill-link mutation paths (§4.3 of the spec).
 */
export async function recomputeCapabilityMap(subaccountAgentId: string): Promise<CapabilityMap | null> {
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
  const rows = await db
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
    // Exclude soft-deleted agents — a soft-deleted agent can still have an
    // active subaccount_agents row, and we must not route tasks to it.
    isNull(agents.deletedAt),
  ];
  if (subaccountId !== null) {
    conditions.push(eq(subaccountAgents.subaccountId, subaccountId));
  }

  const rows = await db
    .select({
      subaccountAgentId: subaccountAgents.id,
      agentId: agents.id,
      agentName: agents.name,
      capabilityMap: subaccountAgents.capabilityMap,
    })
    .from(subaccountAgents)
    .innerJoin(agents, eq(subaccountAgents.agentId, agents.id))
    .where(and(...conditions));

  return rows.map((r) => ({
    subaccountAgentId: r.subaccountAgentId,
    agentId: r.agentId,
    agentName: r.agentName,
    capabilityMap: r.capabilityMap,
  }));
}
