// server/services/__tests__/rcaPromptBuilderPure.test.ts
// Pure unit tests for rcaPromptBuilder.
// Closed-Loop Skill Improvement spec §9.1 steps 5–6 (Chunk 3).

import { describe, it, expect } from 'vitest';
import { validateRcaProposerOutput, buildRcaPrompt } from '../rcaPromptBuilder.js';
import type { RcaContextBundle } from '../rcaPromptBuilder.js';

// ── validateRcaProposerOutput ─────────────────────────────────────────────────

describe('validateRcaProposerOutput', () => {
  const validBase = {
    recordId: 'test-record-id',
    failureMode: 'Agent did not check the entity status',
    contributingFactors: ['Missing guard clause', 'Incomplete instructions'],
    proposedRemedyKind: 'instruction_extension',
    proposedRemedyBody: 'Always check entity.status before proceeding.',
    confidence: 0.8,
  };

  it('accepts a fully valid object', () => {
    const result = validateRcaProposerOutput(validBase);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.recordId).toBe('test-record-id');
      expect(result.value.confidence).toBe(0.8);
    }
  });

  it('accepts no_remedy_proposed without proposedRemedyBody', () => {
    const input = {
      ...validBase,
      proposedRemedyKind: 'no_remedy_proposed',
      proposedRemedyBody: undefined,
    };
    const result = validateRcaProposerOutput(input);
    expect(result.ok).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(validateRcaProposerOutput(null).ok).toBe(false);
    expect(validateRcaProposerOutput('string').ok).toBe(false);
    expect(validateRcaProposerOutput([]).ok).toBe(false);
  });

  it('rejects missing recordId', () => {
    const input = { ...validBase, recordId: '' };
    const result = validateRcaProposerOutput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('recordId'))).toBe(true);
    }
  });

  it('rejects missing failureMode', () => {
    const { failureMode: _, ...rest } = validBase;
    const result = validateRcaProposerOutput(rest);
    expect(result.ok).toBe(false);
  });

  it('rejects proposedRemedyBody present with no_remedy_proposed', () => {
    const input = {
      ...validBase,
      proposedRemedyKind: 'no_remedy_proposed',
      proposedRemedyBody: 'should not be here',
    };
    const result = validateRcaProposerOutput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('absent'))).toBe(true);
    }
  });

  it('rejects missing proposedRemedyBody when kind is real', () => {
    const { proposedRemedyBody: _, ...rest } = validBase;
    const result = validateRcaProposerOutput(rest);
    expect(result.ok).toBe(false);
  });

  it('rejects confidence below 0', () => {
    const input = { ...validBase, confidence: -0.1 };
    const result = validateRcaProposerOutput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('confidence'))).toBe(true);
    }
  });

  it('rejects confidence above 1', () => {
    const input = { ...validBase, confidence: 1.1 };
    const result = validateRcaProposerOutput(input);
    expect(result.ok).toBe(false);
  });

  it('accepts confidence at boundary values 0 and 1', () => {
    expect(validateRcaProposerOutput({ ...validBase, confidence: 0 }).ok).toBe(true);
    expect(validateRcaProposerOutput({ ...validBase, confidence: 1 }).ok).toBe(true);
  });

  it('rejects contributingFactors with 0 elements', () => {
    const input = { ...validBase, contributingFactors: [] };
    const result = validateRcaProposerOutput(input);
    expect(result.ok).toBe(false);
  });

  it('rejects contributingFactors with more than 5 elements', () => {
    const input = {
      ...validBase,
      contributingFactors: ['a', 'b', 'c', 'd', 'e', 'f'],
    };
    const result = validateRcaProposerOutput(input);
    expect(result.ok).toBe(false);
  });

  it('accepts contributingFactors with exactly 5 elements', () => {
    const input = {
      ...validBase,
      contributingFactors: ['a', 'b', 'c', 'd', 'e'],
    };
    expect(validateRcaProposerOutput(input).ok).toBe(true);
  });

  it('rejects an unknown proposedRemedyKind', () => {
    const input = { ...validBase, proposedRemedyKind: 'unknown_kind' };
    const result = validateRcaProposerOutput(input);
    expect(result.ok).toBe(false);
  });
});

// ── buildRcaPrompt — determinism ──────────────────────────────────────────────

describe('buildRcaPrompt', () => {
  const bundle: RcaContextBundle = {
    runTranscript: 'The agent ran successfully.',
    rubricSnapshot: {
      name: 'Quality Scorecard',
      checkName: 'Entity Status Check',
      checkDesc: 'Verifies the agent checks entity status.',
    },
    failedCheckReasoning: 'Agent did not verify entity status before proceeding.',
    entityRecord: {
      entityType: 'subaccount',
      entityId: 'sub-001',
      snapshot: { status: 'active' },
    },
    recentOperatorCorrections: [
      { at: new Date('2026-05-01T10:00:00Z'), summary: 'Corrected entity check' },
    ],
    amendmentStack: {
      included: ['amend-1'],
      excluded: [],
      resolverVersion: '1.0.0',
      amendmentVersionSetHash: 'hashxyz',
    },
  };

  it('produces the same output on two identical calls', () => {
    const first = buildRcaPrompt(bundle);
    const second = buildRcaPrompt(bundle);
    expect(first.system).toBe(second.system);
    expect(first.user).toBe(second.user);
  });

  it('system prompt contains the task description', () => {
    const { system } = buildRcaPrompt(bundle);
    expect(system).toContain('root cause analyst');
    expect(system).toContain('JSON object');
  });

  it('user prompt contains rubric name and check name', () => {
    const { user } = buildRcaPrompt(bundle);
    expect(user).toContain('Quality Scorecard');
    expect(user).toContain('Entity Status Check');
  });

  it('user prompt includes transcript', () => {
    const { user } = buildRcaPrompt(bundle);
    expect(user).toContain('The agent ran successfully.');
  });

  it('user prompt renders operator corrections', () => {
    const { user } = buildRcaPrompt(bundle);
    expect(user).toContain('Corrected entity check');
  });

  it('user prompt shows no-amendment message when stack is empty', () => {
    const emptyStackBundle: RcaContextBundle = {
      ...bundle,
      amendmentStack: {
        included: [],
        excluded: [],
        resolverVersion: '1.0.0',
        amendmentVersionSetHash: 'empty',
      },
    };
    const { user } = buildRcaPrompt(emptyStackBundle);
    expect(user).toContain('no amendments active');
  });
});
