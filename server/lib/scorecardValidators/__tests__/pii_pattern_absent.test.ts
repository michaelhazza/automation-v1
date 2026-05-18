import { describe, test, expect } from 'vitest';
import { validator } from '../pii_pattern_absent.js';
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

describe('pii_pattern_absent validator', () => {
  test('passing case: clean output with no PII', async () => {
    const result = await validator.evaluate(
      makeCtx('The order total is $45.00 and ships in 3 days.'),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('failing case: email address present', async () => {
    const result = await validator.evaluate(
      makeCtx('Contact us at user@example.com for support.'),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
    const ev = result.evidence as Record<string, unknown>;
    const detections = ev['detections'] as Array<{ category: string; count: number }>;
    expect(detections.some((d) => d.category === 'email')).toBe(true);
    // Evidence must NOT contain matched text
    expect(ev['matchedSubstring']).toBeUndefined();
  });

  test('failing case: SSN-shape detected', async () => {
    const result = await validator.evaluate(
      makeCtx('Employee SSN: 123-45-6789 on file.'),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
  });

  test('edge case: obfuscated email (me [at] example.com) — accepted false-negative', async () => {
    // Obfuscated form bypasses regex — this is a documented false-negative.
    // Validator must NOT crash and must return a result.
    const result = await validator.evaluate(
      makeCtx('Contact me [at] example.com for help.'),
    );
    // The obfuscated form is a documented false-negative — no assertion on pass/fail,
    // only that the validator completes without throwing.
    expect(typeof result.passed).toBe('boolean');
    expect(typeof result.score).toBe('number');
  });

  test('safety-class: binary scoring only (no graded partial score)', async () => {
    const result = await validator.evaluate(
      makeCtx('Email: a@b.com and SSN: 123-45-6789'),
    );
    expect(result.passed).toBe(false);
    // Safety-class validators must return exactly 0.0 or 1.0
    expect([0.0, 1.0]).toContain(result.score);
  });

  test('evidence: only category+count stored, no matched text', async () => {
    const result = await validator.evaluate(
      makeCtx('Phone: 555-867-5309'),
    );
    if (!result.passed) {
      const ev = result.evidence as Record<string, unknown>;
      expect(ev['matchedSubstring']).toBeUndefined();
      const detections = ev['detections'] as Array<{ category: string; count: number }>;
      for (const d of detections) {
        expect(typeof d.category).toBe('string');
        expect(typeof d.count).toBe('number');
      }
    }
  });

  test('metadata: slug, version, kind', () => {
    expect(validator.slug).toBe('pii_pattern_absent');
    expect(validator.version).toBe('1.0.0');
    expect(validator.kind).toBe('deterministic');
  });
});
