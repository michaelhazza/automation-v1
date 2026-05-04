import { expect, test } from 'vitest';
import {
  resolveApprovalDispatchAction,
} from '../resolveApprovalDispatchActionPure.js';
import type { ApprovalDispatchAction } from '../resolveApprovalDispatchActionPure.js';

// ─── decision='rejected' × all step types → always complete_with_existing_output ───

test('rejected × invoke_automation → complete_with_existing_output', () => {
  const result: ApprovalDispatchAction = resolveApprovalDispatchAction(
    { stepType: 'invoke_automation' },
    'rejected',
  );
  expect(result).toBe('complete_with_existing_output');
});

test('rejected × agent_call → complete_with_existing_output', () => {
  const result: ApprovalDispatchAction = resolveApprovalDispatchAction(
    { stepType: 'agent_call' },
    'rejected',
  );
  expect(result).toBe('complete_with_existing_output');
});

test('rejected × prompt → complete_with_existing_output', () => {
  const result: ApprovalDispatchAction = resolveApprovalDispatchAction(
    { stepType: 'prompt' },
    'rejected',
  );
  expect(result).toBe('complete_with_existing_output');
});

test('rejected × action_call → complete_with_existing_output', () => {
  const result: ApprovalDispatchAction = resolveApprovalDispatchAction(
    { stepType: 'action_call' },
    'rejected',
  );
  expect(result).toBe('complete_with_existing_output');
});

// ─── decision='approved' × invoke_automation → redispatch ────────────────────

test('approved × invoke_automation → redispatch', () => {
  const result: ApprovalDispatchAction = resolveApprovalDispatchAction(
    { stepType: 'invoke_automation' },
    'approved',
  );
  expect(result).toBe('redispatch');
});

// ─── decision='approved' × non-invoke_automation → complete_with_existing_output ─

test('approved × agent_call → complete_with_existing_output', () => {
  const result: ApprovalDispatchAction = resolveApprovalDispatchAction(
    { stepType: 'agent_call' },
    'approved',
  );
  expect(result).toBe('complete_with_existing_output');
});

test('approved × prompt → complete_with_existing_output', () => {
  const result: ApprovalDispatchAction = resolveApprovalDispatchAction(
    { stepType: 'prompt' },
    'approved',
  );
  expect(result).toBe('complete_with_existing_output');
});

test('approved × action_call → complete_with_existing_output', () => {
  const result: ApprovalDispatchAction = resolveApprovalDispatchAction(
    { stepType: 'action_call' },
    'approved',
  );
  expect(result).toBe('complete_with_existing_output');
});

// ─── decision='edited' × invoke_automation → complete_with_existing_output ───
// edited is NOT a redispatch — the operator has supplied a final output directly.

test('edited × invoke_automation → complete_with_existing_output', () => {
  const result: ApprovalDispatchAction = resolveApprovalDispatchAction(
    { stepType: 'invoke_automation' },
    'edited',
  );
  expect(result).toBe('complete_with_existing_output');
});
