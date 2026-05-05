// Schema context service — builds + caches schema context per subaccount (spec §11.11)
// v1: uses static top-N ranked fields; no per-subaccount GHL schema introspection.
// The version key is static (VERSION=1) until a real schema-change detection event
// triggers a bump (deferred to v2 per spec §9.2 / Deferred Items).

import { buildSchemaContextText } from './schemaContextPure.js';
import type { NormalisedIntent } from '../../../shared/types/crmQueryPlanner.js';

// ── Cache ─────────────────────────────────────────────────────────────────────
// Keyed on `${subaccountId}:${tokenBudget}:${intentHash}` — light in-process
// cache so repeated Stage 3 invocations for the same intent don't rebuild the
// schema text. TTL matches the plan cache's high-confidence TTL (60s).

const SCHEMA_CACHE_TTL_MS = 60_000;
const SCHEMA_CACHE_MAX = 200;

interface SchemaCacheEntry {
  text: string;
  cachedAt: number;
}

const schemaCache = new Map<string, SchemaCacheEntry>();

function pruneExpired(): void {
  if (schemaCache.size < SCHEMA_CACHE_MAX) return;
  const now = Date.now();
  for (const [key, entry] of schemaCache) {
    if (now - entry.cachedAt > SCHEMA_CACHE_TTL_MS) schemaCache.delete(key);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface SchemaContextOptions {
  subaccountId: string;
  intent: NormalisedIntent;
  tokenBudget: number;
}

/**
 * Returns the compressed schema-context text for the given intent and token
 * budget. Results are cached per (subaccountId, tokenBudget, intentHash) with
 * a 60s TTL.
 *
 * In v1, schema is static per entity type (top-N ranked fields). In v2, this
 * service will introspect the subaccount's GHL custom-field definitions and
 * merge them with the static base fields.
 */
export function getSchemaContextText(options: SchemaContextOptions): string {
  const { subaccountId, intent, tokenBudget } = options;
  const cacheKey = `${subaccountId}:${tokenBudget}:${intent.hash}`;
  const now = Date.now();

  const cached = schemaCache.get(cacheKey);
  if (cached && now - cached.cachedAt < SCHEMA_CACHE_TTL_MS) {
    return cached.text;
  }

  pruneExpired();
  const text = buildSchemaContextText(intent, tokenBudget);
  schemaCache.set(cacheKey, { text, cachedAt: now });
  return text;
}

// Visible for testing — clear the schema cache between test runs.
export function clearSchemaCache(): void {
  schemaCache.clear();
}
