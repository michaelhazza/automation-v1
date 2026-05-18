import { describe, test, expect } from 'vitest';
import { validator } from '../output_length_within_bounds.js';
import type { ValidatorContext } from '../types.js';

function makeCtx(runOutput: string, parameters: Record<string, unknown> = {}): ValidatorContext {
  return {
    runOutput,
    runMetadata: {
      skillSlug: 'test-skill',
      agentId: 'agent-1',
      subaccountId: 'sub-1',
      runId: 'run-1',
      invokedSkillSlugs: [],
    },
    parameters,
  };
}

describe('output_length_within_bounds validator', () => {
  test('passing case: char count within bounds', async () => {
    const result = await validator.evaluate(
      makeCtx('hello', { min: 1, max: 100 }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('failing case: char count exceeds max', async () => {
    const result = await validator.evaluate(
      makeCtx('hello world', { min: 1, max: 5 }),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
    expect(result.evidence).toBeDefined();
  });

  test('failing case: char count below min', async () => {
    const result = await validator.evaluate(
      makeCtx('hi', { min: 10, max: 100 }),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
  });

  test('passing case: token count within bounds (unit=tokens)', async () => {
    // 'hello world' = 11 chars → ceil(11/4) = 3 tokens
    const result = await validator.evaluate(
      makeCtx('hello world', { min: 1, max: 5, unit: 'tokens' }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('edge case: exact boundary values (inclusive)', async () => {
    // 5 chars, bounds [5, 5] — both min and max at boundary
    const result = await validator.evaluate(
      makeCtx('hello', { min: 5, max: 5 }),
    );
    expect(result.passed).toBe(true);
  });

  test('edge case: empty output with min=0 passes', async () => {
    const result = await validator.evaluate(
      makeCtx('', { min: 0, max: 100 }),
    );
    expect(result.passed).toBe(true);
  });

  test('metadata: slug, version, kind', () => {
    expect(validator.slug).toBe('output_length_within_bounds');
    expect(validator.version).toBe('1.0.0');
    expect(validator.kind).toBe('deterministic');
  });
});
