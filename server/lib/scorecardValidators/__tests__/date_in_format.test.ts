import { describe, test, expect } from 'vitest';
import { validator } from '../date_in_format.js';
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

describe('date_in_format validator', () => {
  test('passing case: ISO 8601 date-time with Z suffix', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ createdAt: '2024-03-15T09:30:00Z' }), { fieldName: 'createdAt' }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('passing case: date-only ISO 8601 (YYYY-MM-DD)', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ dueDate: '2024-12-31' }), { fieldName: 'dueDate' }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('passing case: ISO 8601 with timezone offset', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ ts: '2024-06-01T14:00:00+10:00' }), { fieldName: 'ts' }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('failing case: non-ISO date format (US format MM/DD/YYYY)', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ date: '03/15/2024' }), { fieldName: 'date' }),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
    const ev = result.evidence as Record<string, unknown>;
    expect(ev['field']).toBe('date');
    // Redaction policy §6.6: raw field value is NOT stored in evidence.
    expect(ev['actual']).toBeUndefined();
  });

  test('failing case: plain text output (not JSON)', async () => {
    const result = await validator.evaluate(
      makeCtx('The date is 2024-03-15', { fieldName: 'date' }),
    );
    expect(result.passed).toBe(false);
    expect(result.reasoning).toMatch(/not valid JSON/i);
  });

  test('failing case: field not present', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ other: 'value' }), { fieldName: 'date' }),
    );
    expect(result.passed).toBe(false);
    expect(result.reasoning).toMatch(/not found/i);
  });

  test('edge case: gaming attempt — valid structure but invalid calendar date (month 13)', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ date: '2024-13-01' }), { fieldName: 'date' }),
    );
    // Month 13 must fail the regex
    expect(result.passed).toBe(false);
  });

  test('edge case: date-time without Z or offset (not RFC 3339 compliant)', async () => {
    const result = await validator.evaluate(
      makeCtx(JSON.stringify({ ts: '2024-03-15T09:30:00' }), { fieldName: 'ts' }),
    );
    // No timezone info — should fail as it is not RFC 3339 compliant
    expect(result.passed).toBe(false);
  });

  test('metadata: slug, version, kind', () => {
    expect(validator.slug).toBe('date_in_format');
    expect(validator.version).toBe('1.0.0');
    expect(validator.kind).toBe('deterministic');
  });
});
