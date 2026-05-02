/**
 * Tests for workflowSeenPayloadServicePure — pure SeenPayload builder.
 * Run: npx tsx server/services/__tests__/workflowSeenPayloadServicePure.test.ts
 */

import { buildSeenPayload } from '../workflowSeenPayloadServicePure.js';

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

// --- full fields ---

{
  const r = buildSeenPayload({
    stepId: 'step-abc',
    stepType: 'agent',
    stepName: 'Send Email',
    renderedInputs: { to: 'user@example.com', subject: 'Hello' },
    renderedPreview: 'Sending email to user@example.com',
    agentReasoning: 'The user wants to send a welcome email.',
    branchDecision: { field: 'approved', resolved_value: true, target_step: 'step-next' },
  });
  assert('step_id', r.step_id === 'step-abc');
  assert('step_type', r.step_type === 'agent');
  assert('step_name', r.step_name === 'Send Email');
  assert('rendered_inputs', JSON.stringify(r.rendered_inputs) === JSON.stringify({ to: 'user@example.com', subject: 'Hello' }));
  assert('rendered_preview', r.rendered_preview === 'Sending email to user@example.com');
  assert('agent_reasoning', r.agent_reasoning === 'The user wants to send a welcome email.');
  assert('branch_decision field', r.branch_decision?.field === 'approved');
  assert('branch_decision resolved_value', r.branch_decision?.resolved_value === true);
}

// --- null optionals ---

{
  const r = buildSeenPayload({ stepId: 'step-1', stepType: 'action', stepName: 'Create', agentReasoning: null, branchDecision: null });
  assert('null agentReasoning', r.agent_reasoning === null);
  assert('null branchDecision', r.branch_decision === null);
  assert('default renderedInputs', JSON.stringify(r.rendered_inputs) === '{}');
  assert('default renderedPreview', r.rendered_preview === null);
}

// --- omitted optionals default ---

{
  const r = buildSeenPayload({ stepId: 'step-2', stepType: 'approval', stepName: 'Manager Approval' });
  assert('omitted renderedInputs defaults to {}', JSON.stringify(r.rendered_inputs) === '{}');
  assert('omitted renderedPreview defaults to null', r.rendered_preview === null);
  assert('omitted agentReasoning defaults to null', r.agent_reasoning === null);
  assert('omitted branchDecision defaults to null', r.branch_decision === null);
}

// --- output shape has exactly SeenPayload keys ---

{
  const r = buildSeenPayload({ stepId: 'x', stepType: 'agent', stepName: 'X' });
  const keys = Object.keys(r).sort();
  const expected = ['agent_reasoning', 'branch_decision', 'rendered_inputs', 'rendered_preview', 'step_id', 'step_name', 'step_type'];
  assert('exact SeenPayload keys', JSON.stringify(keys) === JSON.stringify(expected));
}

// --- step_type values ---

{
  assert('agent preserved', buildSeenPayload({ stepId: 'x', stepType: 'agent', stepName: 'X' }).step_type === 'agent');
  assert('action preserved', buildSeenPayload({ stepId: 'x', stepType: 'action', stepName: 'X' }).step_type === 'action');
  assert('approval preserved', buildSeenPayload({ stepId: 'x', stepType: 'approval', stepName: 'X' }).step_type === 'approval');
}

// --- summary ---

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
