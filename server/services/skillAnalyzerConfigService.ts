import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { skillAnalyzerConfig } from '../db/schema/index.js';
import type { SkillAnalyzerConfig, WarningTierMap } from '../db/schema/skillAnalyzerConfig.js';
import {
  DEFAULT_WARNING_TIER_MAP,
  type MergeWarningCode,
  type WarningTier,
} from './skillAnalyzerServicePure.js';

// ---------------------------------------------------------------------------
// skillAnalyzerConfigService — singleton reader + updater for the
// skill_analyzer_config row (key='default').
//
// Pipeline reads a JOB-LEVEL snapshot (jobs.config_snapshot) — not this live
// table — so mid-job config changes never apply to in-flight jobs.
//
// Reads are cached for CACHE_TTL_MS; PATCH invalidates the cache atomically.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000;
let cached: { row: SkillAnalyzerConfig; expiresAt: number } | null = null;

const DEFAULT_KEY = 'default';

/** Zero-arg reader: returns the current default config, consulting cache first.
 *  Creates the row if missing (migration 0155 should seed it, but defensive). */
async function loadDefault(): Promise<SkillAnalyzerConfig> {
  if (cached && cached.expiresAt > Date.now()) return cached.row;

  const rows = await db
    .select()
    .from(skillAnalyzerConfig)
    .where(eq(skillAnalyzerConfig.key, DEFAULT_KEY))
    .limit(1);

  let row = rows[0];
  if (!row) {
    const [inserted] = await db
      .insert(skillAnalyzerConfig)
      .values({ key: DEFAULT_KEY, warningTierMap: DEFAULT_WARNING_TIER_MAP as WarningTierMap })
      .onConflictDoNothing()
      .returning();
    if (inserted) row = inserted;
    else {
      const refetch = await db
        .select()
        .from(skillAnalyzerConfig)
        .where(eq(skillAnalyzerConfig.key, DEFAULT_KEY))
        .limit(1);
      row = refetch[0];
    }
  }
  if (!row) {
    throw { statusCode: 500, message: 'skillAnalyzerConfigService: default row missing after upsert' };
  }
  cached = { row, expiresAt: Date.now() + CACHE_TTL_MS };
  return row;
}

/** Invalidate the process-local cache (called after PATCH /config). */
function invalidateCache(): void {
  cached = null;
}

/** Read the config. Safe for every request; cached within the process. */
export async function getConfig(): Promise<SkillAnalyzerConfig> {
  return await loadDefault();
}

/** Snapshot the config for persistence on jobs.config_snapshot.
 *  Returns a plain JSON object suitable for JSONB storage. */
export async function snapshotForJob(): Promise<SkillAnalyzerConfig> {
  const row = await loadDefault();
  // Return a cloned object so downstream mutation can't affect the cache.
  return JSON.parse(JSON.stringify(row));
}

/** Return the effective tier map, preferring the explicit map on the config
 *  (populated from the snapshot) and falling back to the compiled default. */
export function effectiveTierMap(
  configOrSnapshot: Pick<SkillAnalyzerConfig, 'warningTierMap'> | null | undefined,
): Record<string, WarningTier> {
  const map = configOrSnapshot?.warningTierMap ?? {};
  // Ensure every known code has a tier entry; fall back to DEFAULT_WARNING_TIER_MAP.
  const merged: Record<string, WarningTier> = { ...DEFAULT_WARNING_TIER_MAP };
  for (const [code, tier] of Object.entries(map)) {
    if (typeof tier === 'string') merged[code as MergeWarningCode] = tier as WarningTier;
  }
  return merged;
}

/** Fields that an admin may update via PATCH /config. */
export interface ConfigPatch {
  classifierFallbackConfidenceScore?: number;
  scopeExpansionStandardThreshold?: number;
  scopeExpansionCriticalThreshold?: number;
  collisionDetectionThreshold?: number;
  collisionMaxCandidates?: number;
  maxTableGrowthRatio?: number;
  executionLockStaleSeconds?: number;
  executionAutoUnlockEnabled?: boolean;
  criticalWarningConfirmationPhrase?: string;
  warningTierMap?: WarningTierMap;
}

/** Apply a partial update to the singleton config.
 *  Bumps config_version on every write; callers capture the new version via
 *  the returned row. */
export async function updateConfig(
  patch: ConfigPatch,
  updatedBy: string,
): Promise<SkillAnalyzerConfig> {
  // Ratio / probability fields must live in [0, 1]. Allowing >1 (e.g., the
  // previous [0, 10] range) lets an operator silently disable warnings —
  // e.g., setting scopeExpansionStandardThreshold to 5 means merged
  // instructions would need to be 500% longer than the source before the
  // warning fires, which is effectively never.
  const ratioFields: Array<keyof ConfigPatch> = [
    'classifierFallbackConfidenceScore',
    'scopeExpansionStandardThreshold',
    'scopeExpansionCriticalThreshold',
    'collisionDetectionThreshold',
  ];
  for (const key of ratioFields) {
    const v = patch[key];
    if (v !== undefined) {
      if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) {
        throw { statusCode: 400, message: `${String(key)} must be a number in [0, 1]` };
      }
    }
  }
  // Table growth ratio is multiplicative and only makes sense at >= 1 — any
  // value below that would abort every remediation including 0-row recovery.
  if (patch.maxTableGrowthRatio !== undefined) {
    if (
      typeof patch.maxTableGrowthRatio !== 'number'
      || Number.isNaN(patch.maxTableGrowthRatio)
      || patch.maxTableGrowthRatio < 1
      || patch.maxTableGrowthRatio > 10
    ) {
      throw { statusCode: 400, message: 'maxTableGrowthRatio must be a number in [1, 10]' };
    }
  }
  if (patch.collisionMaxCandidates !== undefined) {
    if (!Number.isInteger(patch.collisionMaxCandidates) || patch.collisionMaxCandidates < 1) {
      throw { statusCode: 400, message: 'collisionMaxCandidates must be a positive integer' };
    }
  }
  if (patch.executionLockStaleSeconds !== undefined) {
    if (!Number.isInteger(patch.executionLockStaleSeconds) || patch.executionLockStaleSeconds < 1) {
      throw { statusCode: 400, message: 'executionLockStaleSeconds must be a positive integer' };
    }
  }
  if (patch.criticalWarningConfirmationPhrase !== undefined) {
    if (typeof patch.criticalWarningConfirmationPhrase !== 'string'
      || patch.criticalWarningConfirmationPhrase.trim().length < 3) {
      throw { statusCode: 400, message: 'criticalWarningConfirmationPhrase must be ≥ 3 characters' };
    }
  }

  // Cross-field invariant: standard < critical. Reject a patch that would
  // invert them — validated against the effective value after the patch is
  // applied (so partial updates work).
  const current = await loadDefault();
  const effectiveStandard = patch.scopeExpansionStandardThreshold
    ?? current.scopeExpansionStandardThreshold;
  const effectiveCritical = patch.scopeExpansionCriticalThreshold
    ?? current.scopeExpansionCriticalThreshold;
  if (effectiveStandard >= effectiveCritical) {
    throw {
      statusCode: 400,
      message: 'scopeExpansionStandardThreshold must be strictly less than scopeExpansionCriticalThreshold',
    };
  }

  const updateValues: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy,
    configVersion: sql`${skillAnalyzerConfig.configVersion} + 1`,
  };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) updateValues[k] = v;
  }

  const [updated] = await db
    .update(skillAnalyzerConfig)
    .set(updateValues)
    .where(eq(skillAnalyzerConfig.key, DEFAULT_KEY))
    .returning();

  if (!updated) {
    throw { statusCode: 500, message: 'skillAnalyzerConfigService: update returned no rows' };
  }

  invalidateCache();
  return updated;
}
