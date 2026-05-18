import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validator as outputNonEmpty } from './output_non_empty.js';
import { validator as outputSchemaValid } from './output_schema_valid.js';
import { validator as outputLengthWithinBounds } from './output_length_within_bounds.js';
import { validator as noForbiddenPhrase } from './no_forbidden_phrase.js';
import { validator as piiPatternAbsent } from './pii_pattern_absent.js';
import { validator as citedEntityExists } from './cited_entity_exists.js';
import { validator as actionSetWithinAllowlist } from './action_set_within_allowlist.js';
import { validator as numericWithinTolerance } from './numeric_within_tolerance.js';
import { validator as dateInFormat } from './date_in_format.js';
import type { Validator, ValidatorSummary } from './types.js';
import type { DB } from '../../db/index.js';

// ---------------------------------------------------------------------------
// Object-spread registry (mirrors SKILL_HANDLERS pattern in skillExecutor).
// Each validator file exports `export const validator: Validator = { ... }`.
// This module composes the lookup map from those exports.
// ---------------------------------------------------------------------------

// CHUNK_4_IMPORTS_SENTINEL — scaffold-validator appends import lines above this comment

const ALL_VALIDATORS: Validator[] = [
  outputNonEmpty,
  outputSchemaValid,
  outputLengthWithinBounds,
  noForbiddenPhrase,
  piiPatternAbsent,
  citedEntityExists,
  actionSetWithinAllowlist,
  numericWithinTolerance,
  dateInFormat,
  // CHUNK_4_VALIDATORS_SENTINEL — scaffold-validator appends validator refs above this comment
];

// ---------------------------------------------------------------------------
// Registry-meta gating
// ---------------------------------------------------------------------------

interface RegistryMeta {
  validators: Record<
    string,
    {
      testsGreen: boolean;
      skipEnforcement?: boolean;
      skipEnforcementExpiry?: string;
      reason?: string;
    }
  >;
  generatedAt: string;
  ciRunId: string;
}

function loadRegistryMeta(): RegistryMeta {
  const metaPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '.registry-meta.json',
  );
  const raw = readFileSync(metaPath, 'utf-8');
  return JSON.parse(raw) as RegistryMeta;
}

function isValidatorEnabled(slug: string, meta: RegistryMeta): boolean {
  const entry = meta.validators[slug];
  if (!entry) {
    // No entry in meta — treat as disabled (conservative: must be registered by CI).
    return false;
  }
  if (entry.testsGreen) {
    return true;
  }
  // testsGreen is false — check for a valid skipEnforcement bypass.
  if (!entry.skipEnforcement || !entry.skipEnforcementExpiry) {
    return false;
  }
  const expiry = new Date(entry.skipEnforcementExpiry);
  if (isNaN(expiry.getTime()) || expiry <= new Date()) {
    throw new Error(
      `[scorecardValidators] Registry boot failed: validator "${slug}" has an expired skipEnforcementExpiry (${entry.skipEnforcementExpiry}). Fix or remove the bypass.`,
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Build the runtime lookup map
// ---------------------------------------------------------------------------

function buildLookupMap(): Map<string, Validator> {
  const meta = loadRegistryMeta();
  const map = new Map<string, Validator>();

  for (const v of ALL_VALIDATORS) {
    if (!isValidatorEnabled(v.slug, meta)) {
      continue;
    }
    map.set(v.slug, v);
  }

  // Composition-cycle prevention is enforced at dispatch time in
  // scorecardDispatcherPure.ts — preconditionSlugs live on QualityCheck (rubric),
  // not on Validator, so per-validator boot-time validation has nothing to check.
  return map;
}

// Build once at module load.
const VALIDATOR_MAP: Map<string, Validator> = buildLookupMap();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getValidator(slug: string): Validator | undefined {
  return VALIDATOR_MAP.get(slug);
}

export function getAllValidatorSummaries(): ValidatorSummary[] {
  return Array.from(VALIDATOR_MAP.values()).map((v) => ({
    slug: v.slug,
    name: v.name ?? v.slug.replace(/_/g, ' '),
    kind: v.kind,
    safetyClass: v.safetyClass ?? false,
    deprecated: v.deprecated ?? false,
    parameterSchema: v.parameterSchema,
  }));
}

// ---------------------------------------------------------------------------
// Startup snapshot (invocation wired in Chunk 5)
// ---------------------------------------------------------------------------

export async function snapshotAllValidatorsToDb(getDb: () => DB): Promise<void> {
  const { validatorVersions } = await import('../../db/schema/validatorVersions.js');
  const db = getDb();
  const dir = path.dirname(fileURLToPath(import.meta.url));

  for (const v of VALIDATOR_MAP.values()) {
    const sourceFile = path.join(dir, `${v.slug}.ts`);
    let sourceText: string;
    try {
      sourceText = readFileSync(sourceFile, 'utf-8');
    } catch {
      // Source file not readable — skip this validator's snapshot.
      console.warn(`[scorecardValidators] snapshot skipped for "${v.slug}" — source file not readable`);
      continue;
    }
    const sourceHash = createHash('sha256').update(sourceText).digest('hex');
    await db
      .insert(validatorVersions)
      .values({
        slug: v.slug,
        version: v.version,
        sourceText,
        sourceHash,
        parameterSchemaJson: v.parameterSchema,
      })
      .onConflictDoNothing();
  }
}
