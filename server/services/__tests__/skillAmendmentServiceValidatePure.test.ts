// server/services/__tests__/skillAmendmentServiceValidatePure.test.ts
// Pure unit tests for validateAmendmentBody.
// Closed-Loop Skill Improvement spec §9.1 step 8 (Chunk 4).

import { describe, it, expect } from 'vitest';
import { validateAmendmentBody } from '../skillAmendmentService.js';
import type { AmendmentKind } from '../../../shared/types/skillAmendments.js';

// ── Per-kind ceiling tests ────────────────────────────────────────────────────

const KIND_CEILINGS: Record<AmendmentKind, number> = {
  instruction_extension: 800,
  example: 1500,
  guardrail: 400,
  context_fact: 300,
  exception: 600,
};

describe('validateAmendmentBody — per-kind ceilings', () => {
  for (const [kind, ceiling] of Object.entries(KIND_CEILINGS) as [AmendmentKind, number][]) {
    it(`accepts a body exactly at the ceiling for '${kind}' (${ceiling} chars)`, () => {
      const body = 'a'.repeat(ceiling);
      const result = validateAmendmentBody(kind, body);
      expect(result.valid).toBe(true);
    });

    it(`rejects a body one char over the ceiling for '${kind}' (${ceiling + 1} chars)`, () => {
      const body = 'a'.repeat(ceiling + 1);
      const result = validateAmendmentBody(kind, body);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes(`${ceiling}-character limit`))).toBe(true);
      }
    });
  }
});

// ── context_fact declarative-only tests ──────────────────────────────────────

describe('validateAmendmentBody — context_fact declarative-only rule', () => {
  const IMPERATIVE_CASES = ['must', 'should', 'never', 'always', 'do not', "don't", 'do'];

  for (const modal of IMPERATIVE_CASES) {
    it(`rejects context_fact body containing '${modal}'`, () => {
      const body = `This fact says you ${modal} follow this rule.`;
      const result = validateAmendmentBody('context_fact', body);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('declarative'))).toBe(true);
      }
    });
  }

  it('accepts a context_fact body with no imperative-modal words', () => {
    const body = 'The client prefers formal communication style.';
    expect(validateAmendmentBody('context_fact', body)).toEqual({ valid: true });
  });

  it('is case-insensitive for imperative-modal detection', () => {
    const result = validateAmendmentBody('context_fact', 'MUST be done correctly.');
    expect(result.valid).toBe(false);
  });
});

// ── Other kinds allow imperative-modal language ───────────────────────────────

describe('validateAmendmentBody — other kinds allow imperative language', () => {
  it('accepts a guardrail body containing "must"', () => {
    const body = 'You must always verify the client identity before proceeding.';
    expect(validateAmendmentBody('guardrail', body)).toEqual({ valid: true });
  });

  it('accepts an instruction_extension body containing "never"', () => {
    const body = 'Never skip the confirmation step when booking appointments.';
    expect(validateAmendmentBody('instruction_extension', body)).toEqual({ valid: true });
  });

  it('accepts an example body containing "should"', () => {
    const body = 'Example: The agent should reply "I understand" before continuing.';
    expect(validateAmendmentBody('example', body)).toEqual({ valid: true });
  });
});

// ── Evaluator-target anti-recursion tests ─────────────────────────────────────

describe('validateAmendmentBody — evaluator-target anti-recursion', () => {
  const EVALUATOR_TARGETS = ['scorecard_judge_prompt', 'rca_proposer_prompt', 'peer_review_prompt'];

  for (const target of EVALUATOR_TARGETS) {
    it(`rejects any kind body that references '${target}'`, () => {
      const body = `This amendment mentions ${target} in its text.`;
      for (const kind of Object.keys(KIND_CEILINGS) as AmendmentKind[]) {
        const result = validateAmendmentBody(kind, body);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors.some((e) => e.includes(target))).toBe(true);
        }
      }
    });
  }

  it('accumulates multiple errors when both ceiling and evaluator-target rules are violated', () => {
    const body = 'scorecard_judge_prompt ' + 'a'.repeat(400);
    const result = validateAmendmentBody('context_fact', body);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ── Valid bodies for each kind ────────────────────────────────────────────────

describe('validateAmendmentBody — valid bodies', () => {
  it('accepts a valid instruction_extension body', () => {
    const body = 'When the client asks about billing, always check the latest invoice first.';
    expect(validateAmendmentBody('instruction_extension', body)).toEqual({ valid: true });
  });

  it('accepts a valid example body', () => {
    const body = 'Example response: "I have reviewed your account and see that..."';
    expect(validateAmendmentBody('example', body)).toEqual({ valid: true });
  });

  it('accepts a valid guardrail body', () => {
    const body = 'Never share account passwords with anyone, including support staff.';
    expect(validateAmendmentBody('guardrail', body)).toEqual({ valid: true });
  });

  it('accepts a valid context_fact body', () => {
    const body = 'The client operates in Pacific Standard Time.';
    expect(validateAmendmentBody('context_fact', body)).toEqual({ valid: true });
  });

  it('accepts a valid exception body', () => {
    const body = 'For VIP clients, the standard 48-hour SLA extends to 72 hours.';
    expect(validateAmendmentBody('exception', body)).toEqual({ valid: true });
  });
});
