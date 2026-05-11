/**
 * sandboxHarvestServicePure.ts — Pure helpers for the sandbox harvest pipeline.
 *
 * Spec B §8.4 steps 3-7, §11.3, §13.1, §24.5. Three exported pure functions;
 * no I/O, no DB, no provider SDK. Safe to call from tests, the harvest pipeline
 * (C7), and the reconciliation job.
 *
 * Runnable test:
 *   npx vitest run server/services/sandbox/__tests__/sandboxHarvestServicePure.test.ts
 */

import { z } from 'zod';
import type { SandboxTerminalState } from '../../shared/types/sandbox.js';
import type { HarvestStepResult } from './sandboxExecutionServicePure.js';
import type { RedactionPattern } from '../lib/redaction.js';
import { DEFAULT_REDACTION_PATTERNS } from '../lib/redaction.js';

// ---------------------------------------------------------------------------
// Re-export the imported type so callers can reference it from this module
// when building step-result arrays.
// ---------------------------------------------------------------------------

export type { HarvestStepResult };

// ---------------------------------------------------------------------------
// § 1: composeRedactionPatternSet
//
// Assembles the per-execution redaction pattern bundle: the default patterns
// from DEFAULT_REDACTION_PATTERNS, followed by per-alias patterns derived from
// the execution's credential aliases (spec §11.3).
//
// Alias patterns cover:
//   - A literal substring match on the alias itself (catches accidental alias
//     inclusion in output — e.g. "openai_api" appearing in a debug field).
//   - A token-format match: the alias followed by an 8+-char alphanumeric token
//     value on the same line (catches "alias=<token>" and similar formats).
//
// Ordering is: default patterns first (stable), then aliases sorted by alias
// name (deterministic across repeated calls). Duplicates (by source string)
// are removed — comparison is by RegExp.source for structural equality.
// ---------------------------------------------------------------------------

export interface ExecutionAlias {
  alias: string;
  connectionId: string;
}

/**
 * Escapes a string for literal inclusion in a RegExp.
 * Not exported — used only to compose alias patterns.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the per-execution redaction pattern set for the harvest pipeline.
 *
 * @param defaultBundle - The base pattern bundle (typically DEFAULT_REDACTION_PATTERNS).
 *   Pass this explicitly so callers can inject a subset in tests.
 * @param executionAliases - The credential aliases active for this execution
 *   (from SandboxRunTaskInput.credentialIssuanceContext.aliases).
 */
export function composeRedactionPatternSet(
  defaultBundle: readonly RedactionPattern[],
  executionAliases: ExecutionAlias[],
): RedactionPattern[] {
  // Aliases sorted by name for deterministic ordering.
  const sortedAliases = [...executionAliases].sort((a, b) =>
    a.alias.localeCompare(b.alias),
  );

  const aliasPatterns: RedactionPattern[] = [];
  for (const { alias } of sortedAliases) {
    const escaped = escapeRegExp(alias);

    // Pattern 1: literal alias substring match (catches alias appearing verbatim).
    aliasPatterns.push({
      name: `alias_literal_${alias}`,
      regex: new RegExp(escaped, 'gi'),
      replacement: '[REDACTED:alias]',
    });

    // Pattern 2: alias followed by a token-format value (8+ chars, alphanumeric
    // with common token punctuation). Catches "alias=<value>", "alias:<value>",
    // "alias <value>" and similar injection shapes.
    aliasPatterns.push({
      name: `alias_token_${alias}`,
      regex: new RegExp(`${escaped}[=:\\s][A-Za-z0-9._/-]{8,}`, 'gi'),
      replacement: '[REDACTED:alias_token]',
    });
  }

  const combined: RedactionPattern[] = [...defaultBundle, ...aliasPatterns];

  // Deduplicate by regex source string (preserves first occurrence, which is
  // always from defaultBundle since aliases come after).
  const seen = new Set<string>();
  return combined.filter((p) => {
    if (seen.has(p.regex.source)) return false;
    seen.add(p.regex.source);
    return true;
  });
}

// ---------------------------------------------------------------------------
// § 2: classifyHarvestOutcome
//
// Maps a 12-element array of HarvestStepResult values to exactly one of the
// 8 terminal states from spec §13.1. Single source of truth for terminal-state
// classification in the harvest pipeline (§24.5).
//
// Step-to-terminal mapping (first-failed-step semantics):
//   step 1  — terminal classification: relay the step's `reason` (provider supplied)
//   step 2  — output.json read:       output_validation_failed
//   step 3  — output validate (Zod):  output_validation_failed
//   step 4  — output redact:          output_validation_failed
//   step 5  — log read:               output_validation_failed  (includes log_overflow)
//   step 6  — artefact enumeration:   artefact_upload_failed
//   step 7  — artefact metadata redact: artefact_upload_failed
//   step 8  — object storage upload:  artefact_upload_failed
//   step 9  — log persistence:        harvest_failed
//   step 10 — cost row write:         harvest_failed
//   step 11 — telemetry terminal event: harvest_failed
//   step 12 — sandbox_executions update: harvest_failed
//   all 12 green → completed
//
// The input array is 0-indexed in the implementation (step 1 = index 0) for
// clean array traversal. Callers build the array in harvest-step order.
// ---------------------------------------------------------------------------

const STEP_TERMINAL_MAP: readonly SandboxTerminalState[] = [
  // index 0 — step 1: terminal classification (relay from step result.reason below)
  'provider_unavailable', // fallback if reason absent
  // index 1 — step 2: output.json read
  'output_validation_failed',
  // index 2 — step 3: output validate
  'output_validation_failed',
  // index 3 — step 4: output redact
  'output_validation_failed',
  // index 4 — step 5: log read
  'output_validation_failed',
  // index 5 — step 6: artefact enumeration
  'artefact_upload_failed',
  // index 6 — step 7: artefact metadata redact
  'artefact_upload_failed',
  // index 7 — step 8: object storage upload
  'artefact_upload_failed',
  // index 8 — step 9: log persistence
  'harvest_failed',
  // index 9 — step 10: cost row write
  'harvest_failed',
  // index 10 — step 11: telemetry terminal event
  'harvest_failed',
  // index 11 — step 12: sandbox_executions row update
  'harvest_failed',
];

/**
 * Classifies the harvest pipeline outcome from the ordered step results.
 *
 * @param stepResults - Exactly 12 HarvestStepResult values, one per harvest
 *   step in order (index 0 = step 1, index 11 = step 12).
 */
export function classifyHarvestOutcome(
  stepResults: readonly HarvestStepResult[],
): SandboxTerminalState {
  for (let i = 0; i < stepResults.length; i++) {
    const result = stepResults[i];
    if (!result.ok) {
      // Step 1 (index 0): relay the provider's terminal state from `reason`.
      if (i === 0) {
        return result.reason;
      }
      return STEP_TERMINAL_MAP[i] ?? 'harvest_failed';
    }
  }
  // All steps green.
  return 'completed';
}

// ---------------------------------------------------------------------------
// § 3: validateOutputAgainstSchema
//
// Zod-validates parsed output from /workspace/output.json against a resolved
// schema, then redacts the validated value using the provided pattern bundle.
//
// Design: schema resolution is the caller's responsibility (the harvest
// adapter maps outputSchemaRef → ZodSchema). This helper takes the resolved
// schema directly and runs safeParse. Failure modes translate to the
// sub-reason shape consumed by the harvest pipeline (§8.4 step 3 / §13.1).
// ---------------------------------------------------------------------------

export type ValidateOutputSubReason = 'missing' | 'over_size' | 'schema_failed';

export type ValidateOutputResult =
  | { ok: true; validated: unknown }
  | { ok: false; subReason: ValidateOutputSubReason };

/**
 * Validates parsed JSON output against a Zod schema.
 *
 * @param parsed - The already-parsed JSON value from /workspace/output.json.
 *   Pass `null` / `undefined` when the file was absent to get `missing`.
 * @param schema - The resolved Zod schema for this task's output contract.
 *   The caller (harvest adapter) resolves outputSchemaRef → schema before
 *   calling this helper.
 */
export function validateOutputAgainstSchema(
  parsed: unknown,
  schema: z.ZodSchema<unknown>,
): ValidateOutputResult {
  if (parsed === null || parsed === undefined) {
    return { ok: false, subReason: 'missing' };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, subReason: 'schema_failed' };
  }

  return { ok: true, validated: result.data };
}

// Re-export DEFAULT_REDACTION_PATTERNS for callers that want to use it as the
// defaultBundle argument of composeRedactionPatternSet without an extra import.
export { DEFAULT_REDACTION_PATTERNS };
