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
  // `tsc` does NOT copy non-.ts assets into `dist/`, so a single path that
  // assumes the meta file sits next to the compiled module fails on
  // `npm run build:server && npm start` with ENOENT and prevents the server
  // from starting (Codex review, 2026-05-19).
  //
  // We try a small ordered set of candidate locations:
  //   1. Adjacent to the loaded module (dev / tsx; also future-compatible if
  //      a build step ever copies the file into dist/).
  //   2. Source-tree path computed relative to the loaded module — when
  //      registry.js lives at <root>/dist/server/lib/scorecardValidators/,
  //      four `..` segments climb dist/server/lib/scorecardValidators back
  //      to <root>, then `server/lib/scorecardValidators/.registry-meta.json`
  //      lands at the source-tree copy. (5 `..` segments overshoots to the
  //      parent of <root> — Codex review iteration 2, 2026-05-19.)
  //   3. process.cwd() fallback for environments where the working directory
  //      is the repo root (e.g. `npm start`).
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, '.registry-meta.json'),
    path.resolve(moduleDir, '..', '..', '..', '..', 'server', 'lib', 'scorecardValidators', '.registry-meta.json'),
    path.join(process.cwd(), 'server', 'lib', 'scorecardValidators', '.registry-meta.json'),
  ];
  let lastErr: unknown;
  for (const metaPath of candidates) {
    try {
      const raw = readFileSync(metaPath, 'utf-8');
      return JSON.parse(raw) as RegistryMeta;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `[scorecardValidators] Could not load .registry-meta.json from any candidate location. ` +
      `This file is the CI-managed gate that flags which validators are tests-green and safe to enable; ` +
      `the registry refuses to boot without it (a stale or inlined fallback would silently mask a ` +
      `failing-tests signal in production). Searched: ${candidates.join(', ')}. ` +
      `Remediation: either deploy the source tree alongside dist/, set CWD to the repo root before ` +
      `starting the server, or copy server/lib/scorecardValidators/.registry-meta.json into ` +
      `dist/server/lib/scorecardValidators/ as part of the build pipeline. ` +
      `Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
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
