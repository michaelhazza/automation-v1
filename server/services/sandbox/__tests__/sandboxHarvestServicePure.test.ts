/**
 * sandboxHarvestServicePure.test.ts — Pure tests for the harvest pipeline helpers.
 *
 * Spec B §8.4 steps 3-7, §11.3, §13.1, §24.5, §25.1. Covers:
 *   - composeRedactionPatternSet: empty aliases, single alias, multiple aliases
 *     (sorted), duplicate-alias handling, deduplication against default bundle.
 *   - classifyHarvestOutcome: every step-failure → expected terminal state,
 *     all-green → completed, step 1 relay semantics.
 *   - validateOutputAgainstSchema: missing input, schema_failed, valid parse.
 *
 * No DB, no network, no real provider SDKs.
 *
 * Runnable via:
 *   npx vitest run server/services/sandbox/__tests__/sandboxHarvestServicePure.test.ts
 */

import { describe, test, expect } from 'vitest';
import { z } from 'zod';
import {
  composeRedactionPatternSet,
  classifyHarvestOutcome,
  validateOutputAgainstSchema,
  DEFAULT_REDACTION_PATTERNS,
  type ExecutionAlias,
  type HarvestStepResult,
} from '../../sandboxHarvestServicePure.js';
import type { RedactionPattern } from '../../../lib/redaction.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a 12-element step-result array where all steps pass. */
function allGreen(): HarvestStepResult[] {
  return Array.from({ length: 12 }, () => ({ ok: true as const }));
}

/** Build a 12-element array where step N (1-indexed) fails with the given reason. */
function failAtStep(
  stepNumber: number,
  reason: import('../../../../shared/types/sandbox.js').SandboxTerminalState,
): HarvestStepResult[] {
  const results = allGreen();
  results[stepNumber - 1] = { ok: false, reason };
  return results;
}

// ─── composeRedactionPatternSet ───────────────────────────────────────────────

describe('composeRedactionPatternSet', () => {
  test('empty aliases — returns only the default bundle', () => {
    const result = composeRedactionPatternSet(DEFAULT_REDACTION_PATTERNS, []);
    expect(result).toHaveLength(DEFAULT_REDACTION_PATTERNS.length);
    expect(result.map((p) => p.name)).toEqual(
      DEFAULT_REDACTION_PATTERNS.map((p) => p.name),
    );
  });

  test('single alias — appends two alias patterns after defaults', () => {
    const aliases: ExecutionAlias[] = [{ alias: 'openai_api', connectionId: 'conn-1' }];
    const result = composeRedactionPatternSet(DEFAULT_REDACTION_PATTERNS, aliases);
    expect(result).toHaveLength(DEFAULT_REDACTION_PATTERNS.length + 2);
    const names = result.map((p) => p.name);
    expect(names).toContain('alias_literal_openai_api');
    expect(names).toContain('alias_token_openai_api');
  });

  test('multiple aliases — patterns are sorted by alias name (deterministic)', () => {
    const aliases: ExecutionAlias[] = [
      { alias: 'github_org', connectionId: 'conn-2' },
      { alias: 'aws_s3', connectionId: 'conn-3' },
      { alias: 'openai_api', connectionId: 'conn-1' },
    ];
    const result = composeRedactionPatternSet(DEFAULT_REDACTION_PATTERNS, aliases);
    const aliasNames = result
      .map((p) => p.name)
      .filter((n) => n.startsWith('alias_literal_'));
    // Sorted: aws_s3, github_org, openai_api
    expect(aliasNames).toEqual([
      'alias_literal_aws_s3',
      'alias_literal_github_org',
      'alias_literal_openai_api',
    ]);
  });

  test('duplicate aliases (same name) — deduplication by regex source removes second', () => {
    const aliases: ExecutionAlias[] = [
      { alias: 'mytoken', connectionId: 'conn-a' },
      { alias: 'mytoken', connectionId: 'conn-b' },
    ];
    const result = composeRedactionPatternSet(DEFAULT_REDACTION_PATTERNS, aliases);
    const literalCount = result.filter((p) => p.name === 'alias_literal_mytoken').length;
    const tokenCount = result.filter((p) => p.name === 'alias_token_mytoken').length;
    // Deduplicated: only one literal + one token pattern for "mytoken".
    expect(literalCount).toBe(1);
    expect(tokenCount).toBe(1);
  });

  test('alias literal pattern matches the alias substring in a string', () => {
    const aliases: ExecutionAlias[] = [{ alias: 'openai_api', connectionId: 'conn-1' }];
    const patterns = composeRedactionPatternSet([], aliases);
    const literal = patterns.find((p) => p.name === 'alias_literal_openai_api');
    expect(literal).toBeDefined();
    const match = 'I used openai_api to call the service.'.match(literal!.regex);
    expect(match).not.toBeNull();
  });

  test('alias token pattern matches "alias=<8+charvalue>" shape', () => {
    const aliases: ExecutionAlias[] = [{ alias: 'github_org', connectionId: 'conn-2' }];
    const patterns = composeRedactionPatternSet([], aliases);
    const tokenPat = patterns.find((p) => p.name === 'alias_token_github_org');
    expect(tokenPat).toBeDefined();
    const match = 'github_org=ghp_AABBCCDDEE1122334455'.match(tokenPat!.regex);
    expect(match).not.toBeNull();
  });

  test('default bundle is always first — alias patterns come after', () => {
    const minimalDefault: RedactionPattern[] = [
      { name: 'bearer_token', regex: /Bearer\s+\w+/g, replacement: '[REDACTED]' },
    ];
    const aliases: ExecutionAlias[] = [{ alias: 'testkey', connectionId: 'conn-x' }];
    const result = composeRedactionPatternSet(minimalDefault, aliases);
    expect(result[0].name).toBe('bearer_token');
    expect(result[1].name).toBe('alias_literal_testkey');
    expect(result[2].name).toBe('alias_token_testkey');
  });

  test('deduplication against default bundle — if alias adds same regex source, drops alias copy', () => {
    // Construct a default that already has a regex source identical to what the alias produces.
    const aliasName = 'duplicate_key';
    const aliasEscaped = 'duplicate_key'; // no special chars
    const conflictingDefault: RedactionPattern[] = [
      {
        name: 'pre_existing',
        regex: new RegExp(aliasEscaped, 'gi'),
        replacement: '[PRE_EXISTING]',
      },
    ];
    const aliases: ExecutionAlias[] = [{ alias: aliasName, connectionId: 'conn-dup' }];
    const result = composeRedactionPatternSet(conflictingDefault, aliases);
    // The literal alias pattern has the same source → deduplicated.
    const preExistingCount = result.filter((p) => p.name === 'pre_existing').length;
    const literalCount = result.filter((p) => p.name === 'alias_literal_duplicate_key').length;
    expect(preExistingCount).toBe(1);
    expect(literalCount).toBe(0);
  });
});

// ─── classifyHarvestOutcome ───────────────────────────────────────────────────

describe('classifyHarvestOutcome', () => {
  test('all steps green → completed', () => {
    expect(classifyHarvestOutcome(allGreen())).toBe('completed');
  });

  // Step 1 — terminal classification: relay producer's terminal state.
  test('step 1 fail with provider_unavailable → provider_unavailable', () => {
    expect(classifyHarvestOutcome(failAtStep(1, 'provider_unavailable'))).toBe(
      'provider_unavailable',
    );
  });

  test('step 1 fail with timed_out → timed_out (relay)', () => {
    expect(classifyHarvestOutcome(failAtStep(1, 'timed_out'))).toBe('timed_out');
  });

  test('step 1 fail with crashed → crashed (relay)', () => {
    expect(classifyHarvestOutcome(failAtStep(1, 'crashed'))).toBe('crashed');
  });

  // Steps 2-5 — output read / validate / redact / log read → output_validation_failed.
  test('step 2 fail → output_validation_failed', () => {
    expect(classifyHarvestOutcome(failAtStep(2, 'output_validation_failed'))).toBe(
      'output_validation_failed',
    );
  });

  test('step 3 fail → output_validation_failed', () => {
    expect(classifyHarvestOutcome(failAtStep(3, 'output_validation_failed'))).toBe(
      'output_validation_failed',
    );
  });

  test('step 4 fail → output_validation_failed', () => {
    expect(classifyHarvestOutcome(failAtStep(4, 'output_validation_failed'))).toBe(
      'output_validation_failed',
    );
  });

  test('step 5 fail (log_overflow path) → output_validation_failed', () => {
    expect(classifyHarvestOutcome(failAtStep(5, 'output_validation_failed'))).toBe(
      'output_validation_failed',
    );
  });

  // Steps 6-8 — artefact enumeration / metadata redact / upload → artefact_upload_failed.
  test('step 6 fail → artefact_upload_failed', () => {
    expect(classifyHarvestOutcome(failAtStep(6, 'artefact_upload_failed'))).toBe(
      'artefact_upload_failed',
    );
  });

  test('step 7 fail → artefact_upload_failed', () => {
    expect(classifyHarvestOutcome(failAtStep(7, 'artefact_upload_failed'))).toBe(
      'artefact_upload_failed',
    );
  });

  test('step 8 fail → artefact_upload_failed', () => {
    expect(classifyHarvestOutcome(failAtStep(8, 'artefact_upload_failed'))).toBe(
      'artefact_upload_failed',
    );
  });

  // Steps 9-12 — persistence / cost / telemetry / executions update → harvest_failed.
  test('step 9 fail → harvest_failed', () => {
    expect(classifyHarvestOutcome(failAtStep(9, 'harvest_failed'))).toBe('harvest_failed');
  });

  test('step 10 fail → harvest_failed', () => {
    expect(classifyHarvestOutcome(failAtStep(10, 'harvest_failed'))).toBe('harvest_failed');
  });

  test('step 11 fail → harvest_failed', () => {
    expect(classifyHarvestOutcome(failAtStep(11, 'harvest_failed'))).toBe('harvest_failed');
  });

  test('step 12 fail → harvest_failed', () => {
    expect(classifyHarvestOutcome(failAtStep(12, 'harvest_failed'))).toBe('harvest_failed');
  });

  // First-failed-step semantics: only the first failure determines the terminal.
  test('first-fail wins — step 2 fails AND step 9 fails → output_validation_failed', () => {
    const results = allGreen();
    results[1] = { ok: false, reason: 'output_validation_failed' }; // step 2
    results[8] = { ok: false, reason: 'harvest_failed' };             // step 9
    expect(classifyHarvestOutcome(results)).toBe('output_validation_failed');
  });

  test('first-fail wins — step 6 fails AND step 10 fails → artefact_upload_failed', () => {
    const results = allGreen();
    results[5] = { ok: false, reason: 'artefact_upload_failed' }; // step 6
    results[9] = { ok: false, reason: 'harvest_failed' };          // step 10
    expect(classifyHarvestOutcome(results)).toBe('artefact_upload_failed');
  });

  // All 8 terminal states are reachable.
  test('all 8 terminal states are reachable', () => {
    const reachable = new Set<string>();
    reachable.add(classifyHarvestOutcome(allGreen())); // completed
    reachable.add(classifyHarvestOutcome(failAtStep(1, 'provider_unavailable')));
    reachable.add(classifyHarvestOutcome(failAtStep(1, 'timed_out')));
    reachable.add(classifyHarvestOutcome(failAtStep(1, 'cost_ceiling_hit')));
    reachable.add(classifyHarvestOutcome(failAtStep(1, 'crashed')));
    reachable.add(classifyHarvestOutcome(failAtStep(2, 'output_validation_failed')));
    reachable.add(classifyHarvestOutcome(failAtStep(6, 'artefact_upload_failed')));
    reachable.add(classifyHarvestOutcome(failAtStep(9, 'harvest_failed')));

    const expected = new Set([
      'completed',
      'provider_unavailable',
      'timed_out',
      'cost_ceiling_hit',
      'crashed',
      'output_validation_failed',
      'artefact_upload_failed',
      'harvest_failed',
    ]);
    expect(reachable).toEqual(expected);
  });
});

// ─── validateOutputAgainstSchema ──────────────────────────────────────────────

describe('validateOutputAgainstSchema', () => {
  const schema = z.object({ rows: z.array(z.number()), total: z.number() });

  test('null input → missing', () => {
    const result = validateOutputAgainstSchema(null, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.subReason).toBe('missing');
  });

  test('undefined input → missing', () => {
    const result = validateOutputAgainstSchema(undefined, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.subReason).toBe('missing');
  });

  test('schema mismatch → schema_failed', () => {
    const result = validateOutputAgainstSchema({ rows: 'not an array', total: 0 }, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.subReason).toBe('schema_failed');
  });

  test('schema mismatch — extra unexpected structure → schema_failed', () => {
    // strict schema would fail if we use .strict(); the default schema allows extra keys
    // Test with a completely wrong shape instead.
    const result = validateOutputAgainstSchema('just a string', schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.subReason).toBe('schema_failed');
  });

  test('valid input → ok with parsed data', () => {
    const input = { rows: [1, 2, 3], total: 6 };
    const result = validateOutputAgainstSchema(input, schema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validated).toEqual(input);
    }
  });

  test('Zod coercion — valid input after coercion → ok', () => {
    const coercingSchema = z.object({ count: z.coerce.number() });
    const result = validateOutputAgainstSchema({ count: '42' }, coercingSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.validated as { count: number }).count).toBe(42);
    }
  });

  test('works with z.unknown() schema — any non-null input passes', () => {
    const anySchema = z.unknown();
    const result = validateOutputAgainstSchema({ anything: true }, anySchema);
    expect(result.ok).toBe(true);
  });

  test('empty object passes a schema that requires no fields', () => {
    const emptySchema = z.object({});
    const result = validateOutputAgainstSchema({}, emptySchema);
    expect(result.ok).toBe(true);
  });
});
