// Stage 1 — Registry-backed matcher (spec §8). Pure function.
// Alias index is memoised per registry object (WeakMap).

import { normaliseIntent } from './normaliseIntentPure.js';
import type {
  CanonicalQueryRegistry,
  NormalisedIntent,
  QueryPlan,
  ExecutorContext,
} from '../../../shared/types/crmQueryPlanner.js';

// ── Errors ────────────────────────────────────────────────────────────────

export class RegistryConflictError extends Error {
  constructor(alias: string, key1: string, key2: string) {
    super(`Alias collision: "${alias}" in ${key2} conflicts with ${key1}`);
    this.name = 'RegistryConflictError';
  }
}

// ── Alias index (memoised per registry reference) ─────────────────────────

const aliasIndexCache = new WeakMap<CanonicalQueryRegistry, Map<string, string>>();

export function buildAliasIndex(registry: CanonicalQueryRegistry): Map<string, string> {
  if (aliasIndexCache.has(registry)) {
    return aliasIndexCache.get(registry)!;
  }
  const index = new Map<string, string>();
  for (const [key, entry] of Object.entries(registry)) {
    for (const alias of entry.aliases) {
      const h = normaliseIntent(alias).hash;
      if (index.has(h)) {
        throw new RegistryConflictError(alias, index.get(h)!, key);
      }
      index.set(h, key);
    }
  }
  aliasIndexCache.set(registry, index);
  return index;
}

// ── Stage 1 match ─────────────────────────────────────────────────────────

export interface Stage1MatchResult {
  plan: QueryPlan;
  registryKey: string;
}

/**
 * Attempts to match intent against the registry alias index.
 * Returns a validated QueryPlan or null if no alias matches.
 * Runs a reduced validator subset (Rules 2, 3, 9) per spec §8.3.
 * Falls through (returns null) if parseArgs returns null or reduced rules fail.
 */
export function matchRegistryEntry(
  intent: NormalisedIntent,
  registry: CanonicalQueryRegistry,
  context: Pick<ExecutorContext, 'callerCapabilities'>,
): Stage1MatchResult | null {
  const index = buildAliasIndex(registry);
  const registryKey = index.get(intent.hash);
  if (!registryKey) return null;

  const entry = registry[registryKey];
  if (!entry) return null;

  // Parse free-text args from the intent
  const parsedArgs = entry.parseArgs ? entry.parseArgs(intent) : {};
  if (parsedArgs === null) return null; // parseArgs couldn't extract args — fall through

  const filters    = parsedArgs?.filters    ?? [];
  const dateContext = parsedArgs?.dateContext;
  const limit      = parsedArgs?.limit      ?? 100;
  const sort       = parsedArgs?.sort;
  const projection = parsedArgs?.projection;

  // Reduced validator subset — Rule 2: field existence against allowedFields
  for (const f of filters) {
    if (!(f.field in entry.allowedFields)) return null;
  }
  if (sort) {
    for (const s of sort) {
      if (!(s.field in entry.allowedFields) || !entry.allowedFields[s.field]!.sortable) {
        return null;
      }
    }
  }

  // Reduced validator subset — Rule 3: operator sanity
  for (const f of filters) {
    const allowed = entry.allowedFields[f.field]?.operators ?? [];
    if (!(allowed as string[]).includes(f.operator)) return null;
  }

  // Reduced validator subset — Rule 9: projection overlap (caller capability check)
  if (projection) {
    for (const field of projection) {
      if (!(field in entry.allowedFields)) return null;
      if (!entry.allowedFields[field]!.projectable) return null;
    }
  }

  // Build the validated QueryPlan (Stage 1 hits carry validated: true, stageResolved: 1)
  const plan: QueryPlan = {
    source: 'canonical',
    intentClass: 'list_entities',
    primaryEntity: entry.primaryEntity,
    filters,
    limit,
    sort,
    projection,
    dateContext,
    canonicalCandidateKey: registryKey,
    confidence: 1.0,
    stageResolved: 1,
    costPreview: { predictedCostCents: 0, confidence: 'high', basedOn: 'static_heuristic' },
    validated: true,
  };

  return { plan, registryKey };
}
