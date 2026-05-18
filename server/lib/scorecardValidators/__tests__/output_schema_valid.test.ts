import { describe, test, expect } from 'vitest';
import { validator } from '../output_schema_valid.js';
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

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'number' },
  },
  required: ['name'],
};

describe('output_schema_valid validator', () => {
  test('passing case: valid JSON matching schema', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ name: 'Alice', age: 30 }), { schema }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('failing case: valid JSON but fails schema (missing required field)', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ age: 30 }), { schema }),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
    expect(result.evidence).toBeDefined();
    const ev = result.evidence as Record<string, unknown>;
    expect(Array.isArray(ev['schemaErrors'])).toBe(true);
  });

  test('failing case: output is not valid JSON', async () => {
    const result = await validator.evaluate(makeCtx('not json at all', { schema }));
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
    expect(result.reasoning).toMatch(/not valid JSON/i);
  });

  test('edge case: deeply-nested JSON does not crash validator', async () => {
    // Build a deeply nested object (200 levels)
    let nested: unknown = { leaf: true };
    for (let i = 0; i < 200; i++) {
      nested = { child: nested };
    }
    const deepSchema = { type: 'object' };
    const result = await validator.evaluate(
      makeCtx(JSON.stringify(nested), { schema: deepSchema }),
    );
    // Should resolve without throwing
    expect(typeof result.passed).toBe('boolean');
  });

  test('metadata: slug, version, kind', () => {
    expect(validator.slug).toBe('output_schema_valid');
    expect(validator.version).toBe('1.0.0');
    expect(validator.kind).toBe('deterministic');
  });
});
