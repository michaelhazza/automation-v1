import { describe, test, expect } from 'vitest';
import { validator } from '../output_non_empty.js';
import type { ValidatorContext } from '../types.js';

function makeCtx(runOutput: string): ValidatorContext {
  return {
    runOutput,
    runMetadata: {
      skillSlug: 'test-skill',
      agentId: 'agent-1',
      subaccountId: 'sub-1',
      runId: 'run-1',
      invokedSkillSlugs: [],
    },
    parameters: {},
  };
}

describe('output_non_empty validator', () => {
  test('passing case: non-empty string', async () => {
    const result = await validator.evaluate(makeCtx('hello world'));
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('failing case: whitespace-only string', async () => {
    const result = await validator.evaluate(makeCtx('   \t\n  '));
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
    expect(result.evidence).toBeDefined();
  });

  test('edge case: empty string after trim', async () => {
    const result = await validator.evaluate(makeCtx(''));
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
    expect(result.evidence).toBeDefined();
  });

  test('metadata: slug, version, kind', () => {
    expect(validator.slug).toBe('output_non_empty');
    expect(validator.version).toBe('1.0.0');
    expect(validator.kind).toBe('deterministic');
    expect(validator.parameterSchema).toEqual([]);
  });
});
