/**
 * workflowSeenPayloadServicePure.test.ts — Pure payload builder tests.
 *
 * Spec: docs/workflows-dev-spec.md §6.3.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/workflowSeenPayloadServicePure.test.ts
 */

import { expect, test, describe } from 'vitest';
import {
  buildSeenPayload,
  type SeenPayloadInput,
} from '../workflowSeenPayloadServicePure.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<SeenPayloadInput> = {}): SeenPayloadInput {
  return {
    stepDefinition: {
      id: 'step-1',
      type: 'agent',
      name: 'My Agent Step',
      params: { prompt: 'hello' },
    },
    ...overrides,
  };
}

// ── Basic shape correctness ────────────────────────────────────────────────

describe('basic shape', () => {
  test('returns all required fields', () => {
    const payload = buildSeenPayload(makeInput());
    expect(payload.step_id).toBe('step-1');
    expect(payload.step_type).toBe('agent');
    expect(payload.step_name).toBe('My Agent Step');
    expect(payload.rendered_inputs).toEqual({ prompt: 'hello' });
    expect(payload.rendered_preview).toBeNull();
    expect(payload.agent_reasoning).toBeNull();
    expect(payload.branch_decision).toBeNull();
  });

  test('uses step id as step_name when name is omitted', () => {
    const payload = buildSeenPayload(
      makeInput({ stepDefinition: { id: 'step-2', type: 'action' } }),
    );
    expect(payload.step_name).toBe('step-2');
  });

  test('rendered_inputs defaults to {} when params omitted', () => {
    const payload = buildSeenPayload(
      makeInput({ stepDefinition: { id: 'step-3', type: 'agent' } }),
    );
    expect(payload.rendered_inputs).toEqual({});
  });
});

// ── step_type mapping ──────────────────────────────────────────────────────

describe('step_type mapping', () => {
  const cases: Array<[string, 'agent' | 'action' | 'approval']> = [
    ['agent', 'agent'],
    ['agent_call', 'agent'],
    ['prompt', 'agent'],
    ['action', 'action'],
    ['action_call', 'action'],
    ['invoke_automation', 'action'],
    ['approval', 'approval'],
    ['unknown_type', 'agent'], // safe default
  ];

  for (const [rawType, expectedType] of cases) {
    test(`'${rawType}' maps to '${expectedType}'`, () => {
      const payload = buildSeenPayload(
        makeInput({ stepDefinition: { id: 'x', type: rawType } }),
      );
      expect(payload.step_type).toBe(expectedType);
    });
  }
});

// ── agent_reasoning ────────────────────────────────────────────────────────

describe('agent_reasoning', () => {
  test('is null when not provided', () => {
    const payload = buildSeenPayload(makeInput());
    expect(payload.agent_reasoning).toBeNull();
  });

  test('is null when explicitly passed as null', () => {
    const payload = buildSeenPayload(makeInput({ agentReasoning: null }));
    expect(payload.agent_reasoning).toBeNull();
  });

  test('is populated when provided', () => {
    const payload = buildSeenPayload(makeInput({ agentReasoning: 'Because X' }));
    expect(payload.agent_reasoning).toBe('Because X');
  });
});

// ── branch_decision ────────────────────────────────────────────────────────

describe('branch_decision', () => {
  test('is null when not provided', () => {
    const payload = buildSeenPayload(makeInput());
    expect(payload.branch_decision).toBeNull();
  });

  test('is null when explicitly passed as null', () => {
    const payload = buildSeenPayload(makeInput({ branchDecision: null }));
    expect(payload.branch_decision).toBeNull();
  });

  test('maps correctly when provided', () => {
    const payload = buildSeenPayload(
      makeInput({
        branchDecision: {
          field: 'status',
          resolvedValue: 'active',
          targetStep: 'step-next',
        },
      }),
    );
    expect(payload.branch_decision).toEqual({
      field: 'status',
      resolved_value: 'active',
      target_step: 'step-next',
    });
  });
});

// ── rendered_preview is always null in V1 ─────────────────────────────────

describe('rendered_preview', () => {
  test('is always null in V1', () => {
    const payload = buildSeenPayload(makeInput());
    expect(payload.rendered_preview).toBeNull();
  });
});
