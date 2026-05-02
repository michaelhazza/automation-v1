/**
 * Tests for workflowStepGateServicePure — pure gate snapshot builder.
 * Run: npx tsx server/services/__tests__/workflowStepGateServicePure.test.ts
 */

import { buildGateSnapshot } from '../workflowStepGateServicePure.js';
import type { ConfidenceInputs } from '../workflowConfidenceServicePure.js';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

const baseConfidenceInputs: ConfidenceInputs = {
  templateVersionId: 'tpl-v1',
  stepId: 'step-1',
  isCritical: false,
  sideEffectClass: null,
  pastReviewsCount: { approved: 3, rejected: 1 },
  subaccountFirstUseFlag: false,
  upstreamConfidence: null,
};

// --- basic construction (approval step) ---

{
  const { seenPayload, seenConfidence } = buildGateSnapshot(
    { id: 'step-1', type: 'approval', name: 'Approve Contract' },
    baseConfidenceInputs,
  );
  assert('seenPayload is not null for approval step', seenPayload !== null);
  assert('step_id populated', seenPayload?.step_id === 'step-1');
  assert('step_type populated', seenPayload?.step_type === 'approval');
  assert('step_name populated', seenPayload?.step_name === 'Approve Contract');
  assert('rendered_inputs is empty object', JSON.stringify(seenPayload?.rendered_inputs) === '{}');
  assert('rendered_preview is null', seenPayload?.rendered_preview === null);
  assert('agent_reasoning is null', seenPayload?.agent_reasoning === null);
  assert('branch_decision is null', seenPayload?.branch_decision === null);
  assert('seenConfidence is not null', seenConfidence !== null);
  assert('seenConfidence.value is a valid value', ['high', 'medium', 'low'].includes(seenConfidence.value));
}

// --- agent step type mapping ---

{
  const { seenPayload } = buildGateSnapshot(
    { id: 'step-2', type: 'agent', name: 'Run Agent' },
    { ...baseConfidenceInputs, stepId: 'step-2' },
  );
  assert('agent step_type', seenPayload?.step_type === 'agent');
  assert('agent step_id', seenPayload?.step_id === 'step-2');
}

// --- agent_call maps to agent ---

{
  const { seenPayload } = buildGateSnapshot(
    { id: 'step-3', type: 'agent_call', name: 'Call Agent' },
    { ...baseConfidenceInputs, stepId: 'step-3' },
  );
  assert('agent_call maps to agent', seenPayload?.step_type === 'agent');
}

// --- action step type mapping ---

{
  const { seenPayload } = buildGateSnapshot(
    { id: 'step-4', type: 'action', name: 'Send Email' },
    { ...baseConfidenceInputs, stepId: 'step-4' },
  );
  assert('action step_type', seenPayload?.step_type === 'action');
}

// --- invoke_automation maps to action ---

{
  const { seenPayload } = buildGateSnapshot(
    { id: 'step-5', type: 'invoke_automation', name: 'Invoke' },
    { ...baseConfidenceInputs, stepId: 'step-5' },
  );
  assert('invoke_automation maps to action', seenPayload?.step_type === 'action');
}

// --- unknown step type returns null seenPayload ---

{
  const { seenPayload, seenConfidence } = buildGateSnapshot(
    { id: 'step-x', type: 'ask', name: 'Ask Something' },
    { ...baseConfidenceInputs, stepId: 'step-x' },
  );
  assert('unknown step type returns null seenPayload', seenPayload === null);
  assert('seenConfidence still computed for unknown type', seenConfidence !== null);
}

// --- agentReasoning and branchDecision passed through ---

{
  const { seenPayload } = buildGateSnapshot(
    { id: 'step-6', type: 'approval', name: 'Approval' },
    { ...baseConfidenceInputs, stepId: 'step-6' },
    'agent thinks this is good',
    { field: 'approved', resolved_value: true, target_step: 'step-7' },
  );
  assert('agentReasoning populated', seenPayload?.agent_reasoning === 'agent thinks this is good');
  assert('branchDecision populated', seenPayload?.branch_decision?.field === 'approved');
}

// --- params passed as renderedInputs ---

{
  const { seenPayload } = buildGateSnapshot(
    { id: 'step-7', type: 'approval', name: 'Gate', params: { amount: 100, currency: 'USD' } },
    { ...baseConfidenceInputs, stepId: 'step-7' },
  );
  assert('params as renderedInputs', (seenPayload?.rendered_inputs as Record<string, unknown>)['amount'] === 100);
}

// --- seenConfidence uses confidence inputs ---

{
  const { seenConfidence } = buildGateSnapshot(
    { id: 'step-8', type: 'approval', name: 'Critical Gate' },
    { ...baseConfidenceInputs, stepId: 'step-8', isCritical: true },
  );
  assert('isCritical maps to medium confidence', seenConfidence.value === 'medium');
}

{
  const { seenConfidence } = buildGateSnapshot(
    { id: 'step-9', type: 'approval', name: 'Upstream Low' },
    { ...baseConfidenceInputs, stepId: 'step-9', upstreamConfidence: 'low' },
  );
  assert('upstream low confidence propagates', seenConfidence.value === 'low');
}

// --- summary ---

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
