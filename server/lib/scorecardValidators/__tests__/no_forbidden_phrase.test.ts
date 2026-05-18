import { describe, test, expect } from 'vitest';
import { validator } from '../no_forbidden_phrase.js';
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

describe('no_forbidden_phrase validator', () => {
  test('passing case: none of the phrases present', async () => {
    const result = await validator.evaluate(
      makeCtx('This is a perfectly safe output.', { phrases: ['badword', 'offensive'] }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('failing case: one phrase present → partial score', async () => {
    const result = await validator.evaluate(
      makeCtx('This contains badword in it.', { phrases: ['badword', 'offensive'] }),
    );
    expect(result.passed).toBe(false);
    // 1 violation out of 2 phrases: score = 1/2 = 0.5
    expect(result.score).toBeCloseTo(0.5);
    expect(result.evidence).toBeDefined();
  });

  test('failing case: all phrases present → score 0', async () => {
    const result = await validator.evaluate(
      makeCtx('Contains badword and offensive content.', { phrases: ['badword', 'offensive'] }),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
  });

  test('edge case: regex pattern matching (gaming attempt with case variation)', async () => {
    // Regex phrase object — should catch case-insensitive variation
    const result = await validator.evaluate(
      makeCtx('This has BaDwOrD in it.', {
        phrases: [{ regex: 'badword', flags: 'i' }],
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
  });

  test('edge case: plain string match is case-insensitive', async () => {
    const result = await validator.evaluate(
      makeCtx('Output has OFFENSIVE text.', { phrases: ['offensive'] }),
    );
    expect(result.passed).toBe(false);
  });

  test('passing case: empty phrases array is trivially passing', async () => {
    const result = await validator.evaluate(
      makeCtx('anything', { phrases: [] }),
    );
    expect(result.passed).toBe(true);
  });

  test('evidence: violating patterns stored as category/pattern, not matched text', async () => {
    const result = await validator.evaluate(
      makeCtx('Contains badword.', { phrases: ['badword'] }),
    );
    expect(result.passed).toBe(false);
    const ev = result.evidence as Record<string, unknown>;
    // Pattern label stored, NOT the matched substring from output
    const patterns = ev['violatingPatterns'] as string[];
    expect(patterns).toContain('badword');
    // No matchedSubstring field in evidence
    expect(ev['matchedSubstring']).toBeUndefined();
  });

  test('metadata: slug, version, kind', () => {
    expect(validator.slug).toBe('no_forbidden_phrase');
    expect(validator.version).toBe('1.0.0');
    expect(validator.kind).toBe('deterministic');
  });
});
