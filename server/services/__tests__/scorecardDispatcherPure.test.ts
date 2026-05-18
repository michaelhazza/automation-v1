import { describe, it, expect } from 'vitest';
import { planDispatch } from '../scorecardDispatcherPure.js';
import type { QualityCheck } from '../../db/schema/scorecards.js';
import type { Validator } from '../../lib/scorecardValidators/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeValidator(overrides: Partial<Validator> = {}): Validator {
  return {
    slug: 'output_non_empty',
    version: '1.0.0',
    kind: 'deterministic',
    parameterSchema: [],
    evaluate: async () => ({ passed: true, score: 1.0, reasoning: 'non-empty' }),
    ...overrides,
  };
}

function makeQc(overrides: Partial<QualityCheck> = {}): QualityCheck {
  return {
    slug: 'check_1',
    name: 'Check 1',
    ...overrides,
  };
}

const noopGetValidator = (_slug: string) => undefined;

// ---------------------------------------------------------------------------
// planDispatch — DispatchPlan kind coverage
// ---------------------------------------------------------------------------

describe('planDispatch', () => {
  it('returns semantic when kind is absent (undefined defaults to semantic)', () => {
    const plan = planDispatch(makeQc(), noopGetValidator);
    expect(plan.kind).toBe('semantic');
  });

  it('returns semantic when kind is explicitly "semantic"', () => {
    const plan = planDispatch(makeQc({ kind: 'semantic' }), noopGetValidator);
    expect(plan.kind).toBe('semantic');
  });

  it('returns deterministic when kind is "deterministic" and validator is registered', () => {
    const validator = makeValidator({ kind: 'deterministic' });
    const getValidator = (slug: string) => (slug === 'output_non_empty' ? validator : undefined);
    const plan = planDispatch(
      makeQc({ kind: 'deterministic', validatorSlug: 'output_non_empty' }),
      getValidator,
    );
    expect(plan.kind).toBe('deterministic');
    if (plan.kind === 'deterministic') {
      expect(plan.validator.slug).toBe('output_non_empty');
    }
  });

  it('returns deterministic_external when validator has kind "deterministic_external"', () => {
    const validator = makeValidator({ slug: 'cited_entity', kind: 'deterministic_external' });
    const getValidator = (slug: string) => (slug === 'cited_entity' ? validator : undefined);
    const plan = planDispatch(
      makeQc({ kind: 'deterministic', validatorSlug: 'cited_entity' }),
      getValidator,
    );
    expect(plan.kind).toBe('deterministic_external');
  });

  it('returns hybrid when kind is "hybrid" and preconditions resolve', () => {
    const pre1 = makeValidator({ slug: 'pre1', kind: 'deterministic' });
    const pre2 = makeValidator({ slug: 'pre2', kind: 'deterministic' });
    const getValidator = (slug: string) => {
      if (slug === 'pre1') return pre1;
      if (slug === 'pre2') return pre2;
      return undefined;
    };
    const plan = planDispatch(
      makeQc({ kind: 'hybrid', preconditionSlugs: ['pre1', 'pre2'] }),
      getValidator,
    );
    expect(plan.kind).toBe('hybrid');
    if (plan.kind === 'hybrid') {
      expect(plan.preconditions).toHaveLength(2);
      expect(plan.preconditions[0].slug).toBe('pre1');
      expect(plan.preconditions[1].slug).toBe('pre2');
    }
  });

  it('hybrid with empty preconditionSlugs degenerates to semantic', () => {
    const plan = planDispatch(makeQc({ kind: 'hybrid', preconditionSlugs: [] }), noopGetValidator);
    expect(plan.kind).toBe('semantic');
  });

  it('hybrid with no preconditionSlugs field degenerates to semantic', () => {
    const plan = planDispatch(makeQc({ kind: 'hybrid' }), noopGetValidator);
    expect(plan.kind).toBe('semantic');
  });

  // ── Invariant #1: catalogue miss → inconclusive, never semantic fallback ──

  it('catalogue miss on deterministic → inconclusive with reason catalogue_miss', () => {
    const plan = planDispatch(
      makeQc({ kind: 'deterministic', validatorSlug: 'unknown_slug' }),
      noopGetValidator,
    );
    expect(plan.kind).toBe('inconclusive');
    if (plan.kind === 'inconclusive') {
      expect(plan.reason).toBe('catalogue_miss');
      expect(plan.detail).toContain('unknown_slug');
    }
  });

  it('missing validatorSlug on deterministic → inconclusive with reason catalogue_miss', () => {
    const plan = planDispatch(
      makeQc({ kind: 'deterministic' }),
      noopGetValidator,
    );
    expect(plan.kind).toBe('inconclusive');
    if (plan.kind === 'inconclusive') {
      expect(plan.reason).toBe('catalogue_miss');
    }
  });

  it('catalogue miss on hybrid precondition → inconclusive', () => {
    const plan = planDispatch(
      makeQc({ kind: 'hybrid', preconditionSlugs: ['missing_slug'] }),
      noopGetValidator,
    );
    expect(plan.kind).toBe('inconclusive');
    if (plan.kind === 'inconclusive') {
      expect(plan.reason).toBe('catalogue_miss');
      expect(plan.detail).toContain('missing_slug');
    }
  });

  // ── Parameter mismatch → inconclusive ───────────────────────────────────

  it('missing required parameter → inconclusive with reason parameter_mismatch', () => {
    const validator = makeValidator({
      parameterSchema: [{ name: 'schema', type: 'object', required: true, description: 'JSON Schema' }],
    });
    const getValidator = (slug: string) => (slug === 'output_schema_valid' ? validator : undefined);
    const plan = planDispatch(
      makeQc({ kind: 'deterministic', validatorSlug: 'output_schema_valid' }),
      getValidator,
    );
    expect(plan.kind).toBe('inconclusive');
    if (plan.kind === 'inconclusive') {
      expect(plan.reason).toBe('parameter_mismatch');
      expect(plan.detail).toContain('"schema"');
    }
  });

  it('all required parameters present → resolves to deterministic', () => {
    const validator = makeValidator({
      parameterSchema: [{ name: 'schema', type: 'object', required: true, description: 'JSON Schema' }],
    });
    const getValidator = (slug: string) => (slug === 'output_schema_valid' ? validator : undefined);
    const plan = planDispatch(
      makeQc({
        kind: 'deterministic',
        validatorSlug: 'output_schema_valid',
        validatorParameters: { schema: { type: 'object' } },
      }),
      getValidator,
    );
    expect(plan.kind).toBe('deterministic');
  });

  // ── Composition cycle prevention ─────────────────────────────────────────

  it('hybrid_precondition validator used as top-level deterministic → inconclusive', () => {
    const validator = makeValidator({ slug: 'hybrid_impl', kind: 'hybrid_precondition' });
    const getValidator = (slug: string) => (slug === 'hybrid_impl' ? validator : undefined);
    const plan = planDispatch(
      makeQc({ kind: 'deterministic', validatorSlug: 'hybrid_impl' }),
      getValidator,
    );
    expect(plan.kind).toBe('inconclusive');
    if (plan.kind === 'inconclusive') {
      expect(plan.reason).toBe('catalogue_miss');
    }
  });

  it('hybrid_precondition validator used as precondition → inconclusive (cycle prevention)', () => {
    const validator = makeValidator({ slug: 'hybrid_impl', kind: 'hybrid_precondition' });
    const getValidator = (slug: string) => (slug === 'hybrid_impl' ? validator : undefined);
    const plan = planDispatch(
      makeQc({ kind: 'hybrid', preconditionSlugs: ['hybrid_impl'] }),
      getValidator,
    );
    expect(plan.kind).toBe('inconclusive');
    if (plan.kind === 'inconclusive') {
      expect(plan.reason).toBe('catalogue_miss');
      expect(plan.detail).toContain('composition cycle');
    }
  });

  // ── Hybrid precondition parameter validation ─────────────────────────────

  it('hybrid precondition missing required parameter → inconclusive parameter_mismatch', () => {
    const pre = makeValidator({
      slug: 'bounded',
      parameterSchema: [{ name: 'min', type: 'number', required: true, description: 'Min length' }],
    });
    const getValidator = (slug: string) => (slug === 'bounded' ? pre : undefined);
    const plan = planDispatch(
      makeQc({ kind: 'hybrid', preconditionSlugs: ['bounded'], preconditionParameters: [{}] }),
      getValidator,
    );
    expect(plan.kind).toBe('inconclusive');
    if (plan.kind === 'inconclusive') {
      expect(plan.reason).toBe('parameter_mismatch');
    }
  });

  it('hybrid precondition params are passed through to preconditionParams[]', () => {
    const pre = makeValidator({ slug: 'check', kind: 'deterministic', parameterSchema: [] });
    const getValidator = (slug: string) => (slug === 'check' ? pre : undefined);
    const customParams = { threshold: 0.5 };
    const plan = planDispatch(
      makeQc({
        kind: 'hybrid',
        preconditionSlugs: ['check'],
        preconditionParameters: [customParams],
      }),
      getValidator,
    );
    expect(plan.kind).toBe('hybrid');
    if (plan.kind === 'hybrid') {
      expect(plan.preconditionParams[0]).toEqual(customParams);
    }
  });
});
