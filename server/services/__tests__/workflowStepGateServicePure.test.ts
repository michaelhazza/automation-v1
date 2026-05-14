/**
 * workflowStepGateServicePure.test.ts — Pure function tests for buildGateSnapshot.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/workflowStepGateServicePure.test.ts
 */

import { describe, it, expect } from 'vitest';
import { buildGateSnapshot } from '../workflowStepGateServicePure.js';

describe('buildGateSnapshot', () => {
  it('returns the correct step_id from stepDefinition', () => {
    const snap = buildGateSnapshot({ id: 'step-abc', type: 'approval' });
    expect(snap.seenPayload.step_id).toBe('step-abc');
  });

  it('returns the correct step_type from stepDefinition', () => {
    const snap = buildGateSnapshot({ id: 'step-1', type: 'action' });
    expect(snap.seenPayload.step_type).toBe('action');
  });

  it('returns step_name from stepDefinition.name when provided', () => {
    const snap = buildGateSnapshot({ id: 'step-1', type: 'agent', name: 'My Step' });
    expect(snap.seenPayload.step_name).toBe('My Step');
  });

  it('falls back step_name to step_id when name is undefined', () => {
    const snap = buildGateSnapshot({ id: 'step-fallback', type: 'approval' });
    expect(snap.seenPayload.step_name).toBe('step-fallback');
  });

  it('uses stepDefinition.params as rendered_inputs', () => {
    const params = { field1: 'val1', count: 42 };
    const snap = buildGateSnapshot({ id: 's', type: 'action', params });
    expect(snap.seenPayload.rendered_inputs).toEqual(params);
  });

  it('defaults rendered_inputs to {} when params is missing', () => {
    const snap = buildGateSnapshot({ id: 's', type: 'agent' });
    expect(snap.seenPayload.rendered_inputs).toEqual({});
  });

  it('does not return seenConfidence (computed separately by impure caller)', () => {
    const snap = buildGateSnapshot({ id: 's', type: 'approval' });
    // Chunk 6: seenConfidence is computed by WorkflowConfidenceService.computeForGate
    // in the impure wrapper (workflowStepGateService.ts). buildGateSnapshot only
    // returns seenPayload.
    expect('seenConfidence' in snap).toBe(false);
  });

  it('sets rendered_preview, agent_reasoning, and branch_decision to null', () => {
    const snap = buildGateSnapshot({ id: 's', type: 'agent' });
    expect(snap.seenPayload.rendered_preview).toBeNull();
    expect(snap.seenPayload.agent_reasoning).toBeNull();
    expect(snap.seenPayload.branch_decision).toBeNull();
  });
});
