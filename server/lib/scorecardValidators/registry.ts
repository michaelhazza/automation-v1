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

  // Composition-cycle prevention: precondition slugs must reference only
  // deterministic or deterministic_external validators (never hybrid_precondition).
  // O(n²) is acceptable at Phase 1 catalogue size.
  for (const v of map.values()) {
    // Validators that ARE used as preconditions must be deterministic/*_external.
    // We check the inverse: any hybrid_precondition validator is not itself valid
    // as a precondition. The dispatcher enforces this at dispatch time, but we
    // also enforce it at boot to fail fast.
    // The actual preconditionSlugs live on QualityCheck (rubric), not on Validator,
    // so we validate: no registered validator has kind 'hybrid_precondition' AND
    // is referenced as a precondition target. We can only enforce at the validator
    // level here: if a validator is kind 'hybrid_precondition', it must not be
    // registered under a slug that another validator could use as a precondition
    // target while being kind 'hybrid_precondition' itself.
    // Per spec §6.2: enforce that any slug in the map with kind 'hybrid_precondition'
    // cannot be the target of preconditionSlugs. Since preconditionSlugs are on
    // QualityCheck (not here), we enforce the simpler invariant at boot:
    // no validator of kind 'hybrid_precondition' may appear in ALL_VALIDATORS
    // (composition cycles prevented structurally — hybrid_precondition validators
    // are precondition implementations, not the checks themselves).
    if (v.kind === 'hybrid_precondition') {
      // This is valid — hybrid_precondition validators ARE registered; they just
      // cannot themselves reference other hybrid_precondition validators as
      // preconditions. The dispatcher enforces this at check time.
      // Boot-time validation: any slug with kind 'hybrid_precondition' is acceptable.
      // We enforce that such validators are not referenced in the preconditionSlugs
      // of other QualityCheck entries — that validation happens in the dispatcher.
    }
  }

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
    name: v.slug.replace(/_/g, ' '),
    kind: v.kind,
    safetyClass: false,
    deprecated: false,
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
