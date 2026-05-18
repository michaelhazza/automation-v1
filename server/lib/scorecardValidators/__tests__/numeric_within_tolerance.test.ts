import { describe, test, expect } from 'vitest';
import { validator } from '../numeric_within_tolerance.js';
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

describe('numeric_within_tolerance validator', () => {
  test('passing case: value within bounds', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ score: 0.85 }), { fieldName: 'score', min: 0.0, max: 1.0 }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('failing case: value below min', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ score: -0.5 }), { fieldName: 'score', min: 0.0, max: 1.0 }),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
    const ev = result.evidence as Record<string, unknown>;
    expect(ev['field']).toBe('score');
    expect(ev['actual']).toBe(-0.5);
  });

  test('failing case: value above max', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ confidence: 1.5 }), { fieldName: 'confidence', min: 0.0, max: 1.0 }),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
  });

  test('edge case: exact boundary values are inclusive', async () => {
    const lower = await validator.evaluate(
      makeCtx(JSON.stringify({ v: 0 }), { fieldName: 'v', min: 0, max: 10 }),
    );
    expect(lower.passed).toBe(true);

    const upper = await validator.evaluate(
      makeCtx(JSON.stringify({ v: 10 }), { fieldName: 'v', min: 0, max: 10 }),
    );
    expect(upper.passed).toBe(true);
  });

  test('failing case: field not present in JSON', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ other: 5 }), { fieldName: 'score', min: 0, max: 10 }),
    );
    expect(result.passed).toBe(false);
    expect(result.reasoning).toMatch(/not found/i);
  });

  test('failing case: field value is non-numeric', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ score: 'high' }), { fieldName: 'score', min: 0, max: 10 }),
    );
    expect(result.passed).toBe(false);
    expect(result.reasoning).toMatch(/not numeric/i);
  });

  test('failing case: output is not JSON', async () => {
    const result = await validator.evaluate(
      makeCtx('plain text', { fieldName: 'score', min: 0, max: 10 }),
    );
    expect(result.passed).toBe(false);
    expect(result.reasoning).toMatch(/not valid JSON/i);
  });

  test('metadata: slug, version, kind', () => {
    expect(validator.slug).toBe('numeric_within_tolerance');
    expect(validator.version).toBe('1.0.0');
    expect(validator.kind).toBe('deterministic');
  });
});
