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

  return {
    computedAt: new Date().toISOString(),
    referenceLastUpdated: snapshot.schema_meta.last_updated || undefined,
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
    // Exclude soft-deleted agents — a soft-deleted agent can still have an
    // active subaccount_agents row, and we must not route tasks to it.
    .innerJoin(agents, and(eq(subaccountAgents.agentId, agents.id), isNull(agents.deletedAt)))
    .where(and(...conditions));

  return rows.map((r) => ({
    subaccountAgentId: r.subaccountAgentId,
    agentId: r.agentId,
    agentName: r.agentName,
    capabilityMap: r.capabilityMap,
  }));
}
