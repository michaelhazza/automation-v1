import { describe, test, expect } from 'vitest';
import { validator } from '../action_set_within_allowlist.js';
import type { ValidatorContext } from '../types.js';

function makeCtx(invokedSkillSlugs: string[], allowlist: string[]): ValidatorContext {
  return {
    runOutput: '',
    runMetadata: {
      skillSlug: 'test-skill',
      agentId: 'agent-1',
      subaccountId: 'sub-1',
      runId: 'run-1',
      invokedSkillSlugs,
    },
    parameters: { allowlist },
  };
}

describe('action_set_within_allowlist validator', () => {
  test('passing case: all invoked slugs in allowlist', async () => {
    const result = await validator.evaluate(
      makeCtx(['send-email', 'read-crm'], ['send-email', 'read-crm', 'log-event']),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('passing case: no slugs invoked (empty set is subset of any set)', async () => {
    const result = await validator.evaluate(
      makeCtx([], ['send-email']),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('failing case: one slug outside allowlist', async () => {
    const result = await validator.evaluate(
      makeCtx(['send-email', 'delete-data'], ['send-email']),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
    const ev = result.evidence as Record<string, unknown>;
    expect(Array.isArray(ev['unauthorisedSlugs'])).toBe(true);
    expect((ev['unauthorisedSlugs'] as string[])).toContain('delete-data');
  });

  test('safety-class: binary scoring — no partial score', async () => {
    // Even with 1/2 slugs unauthorised, score must be exactly 0.0 (not 0.5)
    const result = await validator.evaluate(
      makeCtx(['allowed-skill', 'forbidden-skill'], ['allowed-skill']),
    );
    expect(result.passed).toBe(false);
    expect([0.0, 1.0]).toContain(result.score);
    expect(result.score).toBe(0.0);
  });

  test('edge case: gaming attempt — slug name collision via substring match', async () => {
    // Exact-match comparison: 'send-email-admin' must NOT match allowlist entry 'send-email'
    const result = await validator.evaluate(
      makeCtx(['send-email-admin'], ['send-email']),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
  });

  test('edge case: allowlist parameter missing — fails safely', async () => {
    const ctx: ValidatorContext = {
      runOutput: '',
      runMetadata: {
        skillSlug: 'test-skill',
        agentId: 'agent-1',
        subaccountId: 'sub-1',
        runId: 'run-1',
        invokedSkillSlugs: ['some-skill'],
      },
      parameters: {},
    };
    const result = await validator.evaluate(ctx);
    expect(result.passed).toBe(false);
    expect(result.reasoning).toMatch(/required/i);
  });

  test('metadata: slug, version, kind', () => {
    expect(validator.slug).toBe('action_set_within_allowlist');
    expect(validator.version).toBe('1.0.0');
    expect(validator.kind).toBe('deterministic');
  });
});
