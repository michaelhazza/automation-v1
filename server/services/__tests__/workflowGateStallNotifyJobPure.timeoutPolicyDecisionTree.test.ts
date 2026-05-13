import { expect, test } from 'vitest';
import { decideTimeoutPolicyAction } from '../actionServicePure.js';

// ---------------------------------------------------------------------------
// Timeout-policy decision tree — stall job integration surface
// ---------------------------------------------------------------------------

test('decideTimeoutPolicyAction — fail_parent produces fail_parent action with failed status', () => {
  const decision = decideTimeoutPolicyAction('fail_parent');
  expect(decision.action).toBe('fail_parent');
  if (decision.action === 'fail_parent') {
    expect(decision.eventStatus).toBe('failed');
    expect(decision.eventReason).toBe('cross_owner_approval_timeout');
  }
});

test('decideTimeoutPolicyAction — continue_without_substep produces partial status', () => {
  const decision = decideTimeoutPolicyAction('continue_without_substep');
  expect(decision.action).toBe('continue_without_substep');
  if (decision.action === 'continue_without_substep') {
    expect(decision.eventStatus).toBe('partial');
    expect(decision.eventReason).toBe('cross_owner_approval_timed_out_optional');
  }
});

test('decideTimeoutPolicyAction — ask_initiator has no eventStatus field', () => {
  const decision = decideTimeoutPolicyAction('ask_initiator');
  expect(decision.action).toBe('ask_initiator');
  expect('eventStatus' in decision).toBe(false);
});
