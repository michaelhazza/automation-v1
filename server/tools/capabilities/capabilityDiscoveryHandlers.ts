import { and, eq, or, isNull } from 'drizzle-orm';
import type { SkillExecutionContext } from '../../services/skillExecutor.js';
import { db } from '../../db/index.js';
import { integrationConnections } from '../../db/schema/index.js';
import {
  loadIntegrationReference,
  normalizeCapabilitySlugs,
  type CapabilityKind,
  type IntegrationEntry,
  type CapabilityTaxonomy,
  type ReferenceState,
  type SchemaMeta,
} from '../../services/integrationReferenceService.js';
import { listAgentCapabilityMaps } from '../../services/capabilityMapService.js';
import { systemSettingsService, SETTING_KEYS } from '../../services/systemSettingsService.js';
import { logger } from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Per-run budget enforcement for capability-discovery skills
// (spec §6.4.3). Default budget is read from systemSettings; defaults to 8.
// When the counter is exhausted, calls return a budget_exhausted error
// structure so the Orchestrator prompt can stop looping. Callers propagate
// the counter via SkillExecutionContext.capabilityQueryCallCount.
// ---------------------------------------------------------------------------

let cachedBudget: number | null = null;
let cachedBudgetAt = 0;
const BUDGET_CACHE_TTL_MS = 60_000;

async function getCapabilityQueryBudget(): Promise<number> {
  if (cachedBudget !== null && Date.now() - cachedBudgetAt < BUDGET_CACHE_TTL_MS) {
    return cachedBudget;
  }
  const raw = await systemSettingsService.get(SETTING_KEYS.ORCHESTRATOR_CAPABILITY_QUERY_BUDGET);
  const parsed = parseInt(raw, 10);
  cachedBudget = Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
  cachedBudgetAt = Date.now();
  return cachedBudget;
}

interface BudgetCheck {
  exhausted: boolean;
  used: number;
  budget: number;
}

async function incrementBudget(context: SkillExecutionContext, skillName: string): Promise<BudgetCheck> {
  const budget = await getCapabilityQueryBudget();
  const prior = context.capabilityQueryCallCount ?? 0;
  const used = prior + 1;
  context.capabilityQueryCallCount = used;
  if (used > budget) {
    logger.warn('capability_query.budget_exhausted', {
      skillName,
      runId: context.runId,
      agentId: context.agentId,
      used,
      budget,
    });
    return { exhausted: true, used, budget };
  }
  return { exhausted: false, used, budget };
}

function budgetExhaustedResponse(skillName: string, budget: number, used: number) {
  return {
    success: false as const,
    error: 'capability_query_budget_exhausted',
    detail: `Skill '${skillName}' exceeded the per-run budget (${used}/${budget}). Halt the decomposition loop and classify with what you have.`,
    budget,
    used,
  };
}

// ---------------------------------------------------------------------------
// Capability discovery skill handlers
//
// See docs/orchestrator-capability-routing-spec.md §4.
//
// These handlers are thin wrappers over integrationReferenceService and
// integrationConnectionService. They do not perform their own IO beyond
// calling those services.
// ---------------------------------------------------------------------------

export interface ListPlatformCapabilitiesInput {
  filter?: {
    provider_type?: string;
    status?: string;
    slug?: string;
  };
  include_schema_meta?: boolean;
}

export interface ListPlatformCapabilitiesOutput {
  success: true;
  integrations: IntegrationEntry[];
  capability_taxonomy: CapabilityTaxonomy;
  reference_state: ReferenceState;
  schema_meta?: SchemaMeta;
  parse_errors: string[];
}

export interface ListPlatformCapabilitiesError {
  success: false;
  error: string;
  integrations: [];
  capability_taxonomy: CapabilityTaxonomy;
  reference_state: 'unavailable';
  parse_errors: string[];
}

/**
 * list_platform_capabilities — returns the full integration reference
 * catalogue as structured data. See spec §4.2.
 */
export async function executeListPlatformCapabilities(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<ListPlatformCapabilitiesOutput | ListPlatformCapabilitiesError | ReturnType<typeof budgetExhaustedResponse>> {
  const budgetCheck = await incrementBudget(context, 'list_platform_capabilities');
  if (budgetCheck.exhausted) return budgetExhaustedResponse('list_platform_capabilities', budgetCheck.budget, budgetCheck.used);

  const typed = input as ListPlatformCapabilitiesInput;
  const snapshot = await loadIntegrationReference();
  logger.info('capability_query.list_platform_capabilities', {
    runId: context.runId,
    reference_state: snapshot.reference_state,
    integration_count: snapshot.integrations.length,
    budget_used: budgetCheck.used,
    budget: budgetCheck.budget,
  });

  if (snapshot.reference_state === 'unavailable') {
    return {
      success: false,
      error: 'integration_reference_invalid',
      integrations: [],
      capability_taxonomy: snapshot.capability_taxonomy,
      reference_state: 'unavailable',
      parse_errors: snapshot.parse_errors,
    };
  }

  let integrations = snapshot.integrations;

  if (typed.filter) {
    const { provider_type, status, slug } = typed.filter;
    if (provider_type) integrations = integrations.filter((i) => i.provider_type === provider_type);
    if (status) integrations = integrations.filter((i) => i.status === status);
    if (slug) integrations = integrations.filter((i) => i.slug === slug);
  }

  const output: ListPlatformCapabilitiesOutput = {
    success: true,
    integrations,
    capability_taxonomy: snapshot.capability_taxonomy,
    reference_state: snapshot.reference_state,
    parse_errors: snapshot.parse_errors,
  };

  if (typed.include_schema_meta) {
    output.schema_meta = snapshot.schema_meta;
  }

  return output;
}

// ---------------------------------------------------------------------------
// list_connections
// ---------------------------------------------------------------------------

export interface ConnectionSummary {
  id: string;
  slug: string;               // matches Integration Reference slug (provider_type)
  provider_type: 'oauth' | 'mcp' | 'webhook' | 'native' | 'hybrid';
  status: 'active' | 'expired' | 'revoked' | 'error';
  connected_at: string;
  scopes_granted: string[];
  last_verified: string | null;
}

export interface ListConnectionsInput {
  scope: 'org' | 'subaccount';
  orgId: string;
  subaccountId?: string;
  include_inactive?: boolean;
}

export async function executeListConnections(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<{ success: true; connections: ConnectionSummary[]; scope_resolved: { orgId: string; subaccountId: string | null } } | { success: false; error: string } | ReturnType<typeof budgetExhaustedResponse>> {
  const budgetCheck = await incrementBudget(context, 'list_connections');
  if (budgetCheck.exhausted) return budgetExhaustedResponse('list_connections', budgetCheck.budget, budgetCheck.used);

  const typed = input as ListConnectionsInput;

  const orgId = typed.orgId ?? context.organisationId;
  if (!orgId) return { success: false, error: 'orgId is required (or must be resolvable from context)' };
  if (orgId !== context.organisationId) {
    return { success: false, error: 'Cannot list connections for an org other than the caller' };
  }

  let subaccountId: string | null = null;
  if (typed.scope === 'subaccount') {
    const requested = typed.subaccountId ?? context.subaccountId;
    if (!requested) {
      return { success: false, error: 'scope=subaccount requires subaccountId (or a subaccount-scoped run context)' };
    }
    if (context.allowedSubaccountIds && !context.allowedSubaccountIds.includes(requested)) {
      return { success: false, error: 'Caller is not scoped to this subaccount' };
    }
    subaccountId = requested;
  }

  // Query integration_connections for the resolved scope.
  try {
    const conditions = subaccountId
      ? and(
          eq(integrationConnections.organisationId, orgId),
          or(eq(integrationConnections.subaccountId, subaccountId), isNull(integrationConnections.subaccountId)),
        )
      : eq(integrationConnections.organisationId, orgId);
    const rawRows = await db.select().from(integrationConnections).where(conditions);

    // When scope=subaccount, dedup so subaccount-specific connections take
    // precedence over inherited org-level rows for the same provider slug.
    const rows = subaccountId
      ? (() => {
          const bySlug = new Map<string, typeof rawRows[number]>();
          for (const r of rawRows) {
            const existing = bySlug.get(r.providerType);
            // Prefer subaccount-scoped row over org-level (null subaccountId)
            if (!existing || (r.subaccountId && !existing.subaccountId)) {
              bySlug.set(r.providerType, r);
            }
          }
          return Array.from(bySlug.values());
        })()
      : rawRows;

    const connections: ConnectionSummary[] = rows
      .filter((r) => typed.include_inactive || r.connectionStatus === 'active')
      .map((r) => {
        const config = (r.configJson as Record<string, unknown> | null) ?? {};
        const scopes = Array.isArray(config.scopes) ? (config.scopes as string[]) : [];
        return {
          id: r.id,
          slug: r.providerType,
          provider_type: r.authType === 'github_app' ? 'oauth' : r.authType === 'oauth2' ? 'oauth' : 'native',
          status: (r.connectionStatus ?? 'error') as ConnectionSummary['status'],
          connected_at: r.createdAt.toISOString(),
          scopes_granted: scopes,
          last_verified: r.lastVerifiedAt ? r.lastVerifiedAt.toISOString() : null,
        };
      });

    logger.info('capability_query.list_connections', {
      runId: context.runId,
      scope: typed.scope,
      orgId,
      subaccountId,
      active_count: connections.filter((c) => c.status === 'active').length,
      total_count: connections.length,
      budget_used: budgetCheck.used,
      budget: budgetCheck.budget,
    });
    return {
      success: true,
      connections,
      scope_resolved: { orgId, subaccountId },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Service-unavailable fallback per spec §4.1
    return { success: false, error: `service_unavailable: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// check_capability_gap
// ---------------------------------------------------------------------------

export interface RawCapabilityInput {
  kind: CapabilityKind;
  slug: string;
}

export interface CheckCapabilityGapInput {
  orgId: string;
  subaccountId?: string;
  required_capabilities: RawCapabilityInput[];
}

export type Availability = 'configured' | 'configurable' | 'unsupported' | 'unknown';

export interface PerCapabilityAvailability {
  kind: CapabilityKind;
  slug: string;
  original_slug: string;
  availability: Availability;
  confidence: 'high' | 'stale' | 'unknown';
  source: 'integration_reference' | 'live_connection' | 'linked_agent' | 'system_skill' | 'not_found';
  detail: string;
}

export interface CandidateAgent {
  agent_id: string;
  agent_name: string;
  coverage: 'full' | 'partial';
  matched: string[];
  missing: string[];
  combined_coverage_possible: boolean;
}

export interface CheckCapabilityGapOutput {
  success: true;
  verdict: 'configured' | 'configurable' | 'unsupported' | 'unknown';
  per_capability: PerCapabilityAvailability[];
  candidate_agents: CandidateAgent[];
  missing_for_configurable: string[];
  missing_for_unsupported: string[];
  reference_state: ReferenceState;
}

export async function executeCheckCapabilityGap(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<CheckCapabilityGapOutput | { success: false; error: string } | ReturnType<typeof budgetExhaustedResponse>> {
  const budgetCheck = await incrementBudget(context, 'check_capability_gap');
  if (budgetCheck.exhausted) return budgetExhaustedResponse('check_capability_gap', budgetCheck.budget, budgetCheck.used);

  const typed = input as CheckCapabilityGapInput;
  if (!Array.isArray(typed.required_capabilities) || typed.required_capabilities.length === 0) {
    return { success: false, error: 'required_capabilities is required and must be non-empty' };
  }

  const orgId = typed.orgId ?? context.organisationId;
  if (orgId !== context.organisationId) {
    return { success: false, error: 'Cannot check capability gap for an org other than the caller' };
  }
  const subaccountId = typed.subaccountId ?? context.subaccountId ?? null;
  if (subaccountId !== null && context.allowedSubaccountIds && !context.allowedSubaccountIds.includes(subaccountId)) {
    return { success: false, error: 'Caller is not scoped to this subaccount' };
  }

  // 1. Load reference + normalise inputs
  const snapshot = await loadIntegrationReference();
  const normalised = normalizeCapabilitySlugs(typed.required_capabilities, snapshot);

  // 2. Load live state
  const connectionResult = await executeListConnections(
    { scope: subaccountId ? 'subaccount' : 'org', orgId, subaccountId },
    context,
  );
  const connections = 'connections' in connectionResult ? connectionResult.connections : [];

  const agentMaps = await listAgentCapabilityMaps(orgId, subaccountId);

  // 3. Evaluate per-capability availability
  const perCapability: PerCapabilityAvailability[] = [];
  for (const cap of normalised) {
    const slug = cap.canonical_slug;
    const original = cap.original_slug;

    // Check reference-level availability first (this gates 'configurable' vs 'unsupported')
    let referenceAvailable = false;
    let referenceConfidence: 'high' | 'stale' | 'unknown' = 'unknown';
    let referenceDetail = '';

    if (cap.kind === 'integration') {
      const entry = snapshot.integrations.find((i) => i.slug === slug);
      if (entry) {
        referenceAvailable = true;
        referenceConfidence = entry.confidence;
        referenceDetail = `Integration '${slug}' is declared in the reference with status '${entry.status}'.`;
      }
    } else {
      const entry = snapshot.integrations.find((i) => {
        if (cap.kind === 'read_capability') return i.read_capabilities.includes(slug);
        if (cap.kind === 'write_capability') return i.write_capabilities.includes(slug);
        if (cap.kind === 'skill') return i.skills_enabled.includes(slug);
        if (cap.kind === 'primitive') return i.primitives_required.includes(slug);
        return false;
      });
      if (entry) {
        referenceAvailable = true;
        referenceConfidence = entry.confidence;
        referenceDetail = `Capability '${slug}' (${cap.kind}) is provided by integration '${entry.slug}' (status '${entry.status}').`;
      }
    }

    // If normalisation was unresolved and reference doesn't know about it either, unknown.
    if (cap.normalisation_status === 'unresolved' && !referenceAvailable) {
      perCapability.push({
        kind: cap.kind,
        slug,
        original_slug: original,
        availability: 'unknown',
        confidence: 'unknown',
        source: 'not_found',
        detail: `Slug '${original}' did not resolve in the capability taxonomy and is not present in the Integration Reference.`,
      });
      continue;
    }

    // Configured? Requires agent capability map match AND active connection AND scope match.
    // Determined later in the candidate-agent pass; for now mark as configurable/unsupported/unknown
    // based on the reference.
    if (!referenceAvailable) {
      if (snapshot.reference_state === 'healthy') {
        perCapability.push({
          kind: cap.kind,
          slug,
          original_slug: original,
          availability: 'unsupported',
          confidence: 'high',
          source: 'not_found',
          detail: `Reference (state: healthy) does not declare '${slug}' (${cap.kind}) on any integration.`,
        });
      } else {
        perCapability.push({
          kind: cap.kind,
          slug,
          original_slug: original,
          availability: 'unknown',
          confidence: 'unknown',
          source: 'integration_reference',
          detail: `Reference is '${snapshot.reference_state}' — cannot confidently classify '${slug}' as unsupported.`,
        });
      }
      continue;
    }

    perCapability.push({
      kind: cap.kind,
      slug,
      original_slug: original,
      availability: 'configurable',
      confidence: referenceConfidence,
      source: 'integration_reference',
      detail: referenceDetail,
    });
  }

  // 4. Candidate-agent evaluation: for each agent with a capability map, check
  //    full-vs-partial subset match against the canonical slug list.
  const requiredSlugsByKind = {
    integration: normalised.filter((n) => n.kind === 'integration').map((n) => n.canonical_slug),
    read_capability: normalised.filter((n) => n.kind === 'read_capability').map((n) => n.canonical_slug),
    write_capability: normalised.filter((n) => n.kind === 'write_capability').map((n) => n.canonical_slug),
    skill: normalised.filter((n) => n.kind === 'skill').map((n) => n.canonical_slug),
    primitive: normalised.filter((n) => n.kind === 'primitive').map((n) => n.canonical_slug),
  };

  function matchedByAgent(map: NonNullable<(typeof agentMaps)[number]['capabilityMap']>): { matched: string[]; missing: string[] } {
    const matched: string[] = [];
    const missing: string[] = [];
    const check = (kind: CapabilityKind, required: string[], have: string[]) => {
      for (const slug of required) {
        const key = `${kind}:${slug}`;
        if (have.includes(slug)) matched.push(key);
        else missing.push(key);
      }
    };
    check('integration', requiredSlugsByKind.integration, map.integrations);
    check('read_capability', requiredSlugsByKind.read_capability, map.read_capabilities);
    check('write_capability', requiredSlugsByKind.write_capability, map.write_capabilities);
    check('skill', requiredSlugsByKind.skill, map.skills);
    check('primitive', requiredSlugsByKind.primitive, map.primitives);
    return { matched, missing };
  }

  function hasActiveConnectionsForIntegrations(integrationSlugs: string[]): boolean {
    for (const slug of integrationSlugs) {
      const hasActive = connections.some((c) => c.slug === slug && c.status === 'active');
      if (!hasActive) return false;
    }
    return true;
  }

  function hasScopesForCapability(kind: CapabilityKind, slug: string): boolean {
    // Scope matching is integration-level: find integrations whose
    // read/write_capabilities list contains this slug, then verify at least
    // ONE active connection satisfies every required_scope from the reference
    // entry. Shared slugs (exposed by multiple providers) only need one
    // satisfying integration, not all of them.
    const integrations = snapshot.integrations.filter((i) => {
      if (kind === 'read_capability') return i.read_capabilities.includes(slug);
      if (kind === 'write_capability') return i.write_capabilities.includes(slug);
      return false;
    });
    if (integrations.length === 0) return true; // skills/primitives bypass scope check
    for (const integration of integrations) {
      const connection = connections.find((c) => c.slug === integration.slug && c.status === 'active');
      if (!connection) continue; // try next integration
      const scopesSatisfied = integration.required_scopes.every((s) => connection.scopes_granted.includes(s));
      if (scopesSatisfied) return true; // at least one integration satisfies
    }
    return false;
  }

  const candidateAgents: CandidateAgent[] = [];

  for (const agent of agentMaps) {
    if (!agent.capabilityMap) continue;
    const { matched, missing } = matchedByAgent(agent.capabilityMap);
    candidateAgents.push({
      agent_id: agent.agentId,
      agent_name: agent.agentName,
      coverage: missing.length === 0 ? 'full' : 'partial',
      matched,
      missing,
      combined_coverage_possible: false, // filled in below
    });
  }

  // Combined coverage: compute across candidates; set true when no single
  // agent has full coverage but the union would.
  if (!candidateAgents.some((c) => c.coverage === 'full')) {
    const unionMatched = new Set<string>();
    for (const c of candidateAgents) for (const m of c.matched) unionMatched.add(m);
    const totalKeys = normalised.map((n) => `${n.kind}:${n.canonical_slug}`);
    const unionCoversAll = totalKeys.every((k) => unionMatched.has(k));
    if (unionCoversAll) {
      for (const c of candidateAgents) c.combined_coverage_possible = true;
    }
  }

  // Stale map guard: if the capability map was computed against an older
  // Integration Reference version, disqualify it from Path A. Prefers the
  // explicit `referenceLastUpdated` field written by computeCapabilityMapPure
  // (added in migration 0158) over timestamp parsing of computedAt; falls
  // back to computedAt for legacy maps. Maps that fail the check fall
  // through to Path B, which forces a fresh Config Assistant verification.
  const currentReferenceLastUpdated = snapshot.schema_meta.last_updated || '';
  const currentReferenceLastUpdatedAt = currentReferenceLastUpdated
    ? Date.parse(currentReferenceLastUpdated)
    : NaN;
  function isMapStaleVsReference(map: NonNullable<(typeof agentMaps)[number]['capabilityMap']>): boolean {
    // Preferred path: explicit reference-version comparison. Exact string
    // match — no timestamp parsing, no race window.
    if (map.referenceLastUpdated !== undefined) {
      return map.referenceLastUpdated !== currentReferenceLastUpdated;
    }
    // Legacy fallback: compare computedAt to the reference's last_updated.
    if (Number.isNaN(currentReferenceLastUpdatedAt)) return false; // can't decide; trust the map
    const computedAt = Date.parse(map.computedAt);
    if (Number.isNaN(computedAt)) return true; // malformed; treat as stale
    return computedAt < currentReferenceLastUpdatedAt;
  }

  // Atomic "configured" determination: a single agent with full coverage
  // AND active connections AND scope match for all integrations/capabilities
  // AND its capability map is not stale vs. the current Integration Reference.
  let configuredBy: CandidateAgent | null = null;
  for (const candidate of candidateAgents) {
    if (candidate.coverage !== 'full') continue;

    // Look up the source map for this candidate and reject if it's stale.
    const agentRow = agentMaps.find((a) => a.agentId === candidate.agent_id);
    if (!agentRow?.capabilityMap) continue;
    if (isMapStaleVsReference(agentRow.capabilityMap)) continue;
    // Derive integration list from the candidate's matched list (those with 'integration:' prefix)
    const integrationSlugs = candidate.matched
      .filter((k) => k.startsWith('integration:'))
      .map((k) => k.slice('integration:'.length));
    // Also include integrations reachable via read/write capabilities in the required set.
    // For shared slugs (same capability exposed by multiple integrations), only require
    // at least one active connection — but restrict to integrations the candidate agent
    // actually has in its capability map (prevents accepting a connection the agent
    // cannot use).
    const agentMapIntegrations = new Set(agentRow.capabilityMap.integrations ?? []);
    let integrationCheckPassed = true;
    for (const cap of normalised) {
      if (cap.kind === 'read_capability' || cap.kind === 'write_capability') {
        const providers = snapshot.integrations.filter((i) => {
          const list = cap.kind === 'read_capability' ? i.read_capabilities : i.write_capabilities;
          return list.includes(cap.canonical_slug) && agentMapIntegrations.has(i.slug);
        });
        if (providers.length > 0) {
          const anySatisfied = providers.some((p) =>
            connections.some((c) => c.slug === p.slug && c.status === 'active'),
          );
          if (!anySatisfied) { integrationCheckPassed = false; break; }
          // Add the first active provider to the slug list for downstream logging
          for (const p of providers) {
            if (connections.some((c) => c.slug === p.slug && c.status === 'active') && !integrationSlugs.includes(p.slug)) {
              integrationSlugs.push(p.slug);
              break;
            }
          }
        }
      }
    }
    if (!integrationCheckPassed) continue;
    if (!hasActiveConnectionsForIntegrations(integrationSlugs)) continue;

    let scopesOk = true;
    for (const cap of normalised) {
      if (!hasScopesForCapability(cap.kind, cap.canonical_slug)) {
        scopesOk = false;
        break;
      }
    }
    if (!scopesOk) continue;

    configuredBy = candidate;
    break;
  }

  // Upgrade per-capability availability based on agent + connection findings.
  if (configuredBy) {
    for (const cap of perCapability) {
      if (cap.availability === 'configurable') {
        cap.availability = 'configured';
        cap.source = 'linked_agent';
        cap.detail = `Satisfied by agent '${configuredBy.agent_name}' (${configuredBy.agent_id}) with active connection and granted scopes.`;
      }
    }
  }

  // Roll up verdict
  let verdict: CheckCapabilityGapOutput['verdict'];
  if (configuredBy) {
    verdict = 'configured';
  } else if (perCapability.some((c) => c.availability === 'unsupported')) {
    verdict = 'unsupported';
  } else if (perCapability.some((c) => c.availability === 'unknown')) {
    verdict = 'unknown';
  } else {
    verdict = 'configurable';
  }

  const missingForConfigurable = perCapability
    .filter((c) => c.availability === 'configurable')
    .map((c) => `${c.kind}:${c.slug}`);
  const missingForUnsupported = perCapability
    .filter((c) => c.availability === 'unsupported')
    .map((c) => `${c.kind}:${c.slug}`);

  // Structured observability emission (spec §9.5.1). One log per decision
  // with: verdict, reference_state, candidate coverage distribution, missing
  // capability slugs. Aggregated downstream as the Orchestrator decision
  // distribution dashboard.
  logger.info('capability_query.check_capability_gap', {
    runId: context.runId,
    orgId,
    subaccountId,
    verdict,
    reference_state: snapshot.reference_state,
    required_count: normalised.length,
    required_capabilities: normalised.map((n) => `${n.kind}:${n.canonical_slug}`),
    missing_for_configurable: missingForConfigurable,
    missing_for_unsupported: missingForUnsupported,
    candidate_agent_count: candidateAgents.length,
    full_coverage_agents: candidateAgents.filter((c) => c.coverage === 'full').map((c) => c.agent_id),
    partial_coverage_agents: candidateAgents.filter((c) => c.coverage === 'partial').length,
    combined_coverage_possible: candidateAgents.some((c) => c.combined_coverage_possible),
    configured_by_agent_id: configuredBy?.agent_id ?? null,
    budget_used: budgetCheck.used,
    budget: budgetCheck.budget,
  });

  return {
    success: true,
    verdict,
    per_capability: perCapability,
    candidate_agents: candidateAgents,
    missing_for_configurable: missingForConfigurable,
    missing_for_unsupported: missingForUnsupported,
    reference_state: snapshot.reference_state,
  };
}
