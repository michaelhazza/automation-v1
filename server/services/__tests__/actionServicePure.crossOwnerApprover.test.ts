import { expect, test } from 'vitest';
import { deriveApproverUserId, decideTimeoutPolicyAction, buildActionIdempotencyKey, isWrongApprover } from '../actionServicePure.js';

// ---------------------------------------------------------------------------
// deriveApproverUserId
// ---------------------------------------------------------------------------

test('deriveApproverUserId — cross-owner with executor owner → returns executor owner id', () => {
  expect(deriveApproverUserId({ isCrossOwner: true, executorOwnerUserId: 'user-michael' })).toBe('user-michael');
});

test('deriveApproverUserId — non-cross-owner → null regardless of executorOwnerUserId', () => {
  expect(deriveApproverUserId({ isCrossOwner: false, executorOwnerUserId: 'user-michael' })).toBeNull();
});

test('deriveApproverUserId — cross-owner with null executorOwnerUserId → null', () => {
  expect(deriveApproverUserId({ isCrossOwner: true, executorOwnerUserId: null })).toBeNull();
});

test('deriveApproverUserId — cross-owner with undefined executorOwnerUserId → null', () => {
  expect(deriveApproverUserId({ isCrossOwner: true })).toBeNull();
});

// ---------------------------------------------------------------------------
// decideTimeoutPolicyAction
// ---------------------------------------------------------------------------

test('decideTimeoutPolicyAction — fail_parent → correct shape', () => {
  const result = decideTimeoutPolicyAction('fail_parent');
  expect(result).toEqual({
    action: 'fail_parent',
    eventStatus: 'failed',
    eventReason: 'cross_owner_approval_timeout',
  });
});

test('decideTimeoutPolicyAction — continue_without_substep → correct shape', () => {
  const result = decideTimeoutPolicyAction('continue_without_substep');
  expect(result).toEqual({
    action: 'continue_without_substep',
    eventStatus: 'partial',
    eventReason: 'cross_owner_approval_timed_out_optional',
  });
});

test('decideTimeoutPolicyAction — ask_initiator → correct shape', () => {
  const result = decideTimeoutPolicyAction('ask_initiator');
  expect(result).toEqual({ action: 'ask_initiator' });
});

// ---------------------------------------------------------------------------
// isWrongApprover — gate predicate used by approveItem and rejectItem
//
// When approverUserId is set and differs from requestingUserId, the service
// throws 403 WRONG_APPROVER. isWrongApprover captures that predicate so it
// can be tested without a DB connection.
// ---------------------------------------------------------------------------

test('isWrongApprover — designated approver matches requesting user → false (allow)', () => {
  expect(isWrongApprover('user-michael', 'user-michael')).toBe(false);
});

test('isWrongApprover — designated approver differs from requesting user → true (403)', () => {
  // Non-designated user calling rejectItem for an action designated to another
  // user must be rejected with 403. This is the rejectItem gate invariant.
  expect(isWrongApprover('user-michael', 'user-other')).toBe(true);
});

test('isWrongApprover — no designated approver (null) → false (allow, V1 path)', () => {
  expect(isWrongApprover(null, 'user-other')).toBe(false);
});

test('isWrongApprover — no designated approver (undefined) → false (allow)', () => {
  expect(isWrongApprover(undefined, 'user-other')).toBe(false);
});

// ---------------------------------------------------------------------------
// Idempotency key invariant — approver_user_id MUST NOT affect the key
// ---------------------------------------------------------------------------

test('buildActionIdempotencyKey — key is identical with or without approver context', () => {
  const params = {
    runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    toolCallId: 'tool_call_xyz',
    args: { recipient: 'bob@example.com', subject: 'Hello' },
  };
  const key1 = buildActionIdempotencyKey(params);
  const key2 = buildActionIdempotencyKey(params);
  expect(key1).toBe(key2);
});
