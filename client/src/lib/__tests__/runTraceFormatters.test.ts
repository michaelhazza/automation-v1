// client/src/lib/__tests__/runTraceFormatters.test.ts
// Pure-function tests for runTraceFormatters (spec §7.2, chunk 8).

import { expect, test, describe } from 'vitest';
import {
  formatDuration,
  formatCost,
  formatControllerLabel,
  formatApprovalStatus,
} from '../runTraceFormatters.js';

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  test('0 ms → "0 seconds"', () => expect(formatDuration(0)).toBe('0 seconds'));
  test('999 ms → "0 seconds"', () => expect(formatDuration(999)).toBe('0 seconds'));
  test('1000 ms → "1 second"', () => expect(formatDuration(1000)).toBe('1 second'));
  test('2000 ms → "2 seconds"', () => expect(formatDuration(2000)).toBe('2 seconds'));
  test('45000 ms → "45 seconds"', () => expect(formatDuration(45000)).toBe('45 seconds'));
  test('59999 ms → "59 seconds"', () => expect(formatDuration(59999)).toBe('59 seconds'));
  test('60000 ms → "1 min"', () => expect(formatDuration(60000)).toBe('1 min'));
  test('120000 ms → "2 min"', () => expect(formatDuration(120000)).toBe('2 min'));
  test('134000 ms → "2 min 14 sec"', () => expect(formatDuration(134000)).toBe('2 min 14 sec'));
  test('3599999 ms → "59 min 59 sec"', () => expect(formatDuration(3599999)).toBe('59 min 59 sec'));
  test('3600000 ms → "1 hr"', () => expect(formatDuration(3600000)).toBe('1 hr'));
  test('7200000 ms → "2 hr"', () => expect(formatDuration(7200000)).toBe('2 hr'));
  test('3780000 ms → "1 hr 3 min"', () => expect(formatDuration(3780000)).toBe('1 hr 3 min'));
  test('7320000 ms → "2 hr 2 min"', () => expect(formatDuration(7320000)).toBe('2 hr 2 min'));
});

// ---------------------------------------------------------------------------
// formatCost
// ---------------------------------------------------------------------------

describe('formatCost', () => {
  test('0 cents → "$0.00"', () => expect(formatCost(0)).toBe('$0.00'));
  test('8 cents → "$0.08"', () => expect(formatCost(8)).toBe('$0.08'));
  test('123 cents → "$1.23"', () => expect(formatCost(123)).toBe('$1.23'));
  test('100 cents → "$1.00"', () => expect(formatCost(100)).toBe('$1.00'));
  test('1234 cents → "$12.34"', () => expect(formatCost(1234)).toBe('$12.34'));
  test('negative cents → "$0.00"', () => expect(formatCost(-1)).toBe('$0.00'));
  test('NaN → "$0.00"', () => expect(formatCost(NaN)).toBe('$0.00'));
  test('Infinity → "$0.00"', () => expect(formatCost(Infinity)).toBe('$0.00'));
});

// ---------------------------------------------------------------------------
// formatControllerLabel
// ---------------------------------------------------------------------------

describe('formatControllerLabel', () => {
  test('native → "Native run"', () => expect(formatControllerLabel('native')).toBe('Native run'));
  test('operator → "Operator run"', () => expect(formatControllerLabel('operator')).toBe('Operator run'));
});

// ---------------------------------------------------------------------------
// formatApprovalStatus
// ---------------------------------------------------------------------------

describe('formatApprovalStatus', () => {
  // Silent native-run case: succeeded, no approvedBy, has events
  test('silent native-run (succeeded, no approvedBy) → null', () =>
    expect(formatApprovalStatus({
      finalStatus: 'succeeded',
      hasEvents: true,
      approvedBy: null,
    })).toBe(null));

  test('silent native-run (completed, no approvedBy) → null', () =>
    expect(formatApprovalStatus({
      finalStatus: 'completed',
      hasEvents: true,
      approvedBy: null,
    })).toBe(null));

  // Auto-approved
  test('auto-approved (succeeded, approvedBy=auto) → "auto-approved"', () =>
    expect(formatApprovalStatus({
      finalStatus: 'succeeded',
      hasEvents: true,
      approvedBy: 'auto',
    })).toBe('auto-approved'));

  // Manually approved
  test('manually approved → "approved by Alice"', () =>
    expect(formatApprovalStatus({
      finalStatus: 'succeeded',
      hasEvents: true,
      approvedBy: 'Alice',
    })).toBe('approved by Alice'));

  test('manually approved completed → "approved by Bob Smith"', () =>
    expect(formatApprovalStatus({
      finalStatus: 'completed',
      hasEvents: true,
      approvedBy: 'Bob Smith',
    })).toBe('approved by Bob Smith'));

  // Awaiting approval
  test('pending → "awaiting approval"', () =>
    expect(formatApprovalStatus({
      finalStatus: 'pending',
      hasEvents: false,
      approvedBy: null,
    })).toBe('awaiting approval'));

  test('awaiting_approval → "awaiting approval"', () =>
    expect(formatApprovalStatus({
      finalStatus: 'awaiting_approval',
      hasEvents: true,
      approvedBy: null,
    })).toBe('awaiting approval'));

  // Blocked by policy
  test('blocked finalStatus → "blocked by policy"', () =>
    expect(formatApprovalStatus({
      finalStatus: 'blocked',
      hasEvents: true,
      approvedBy: null,
    })).toBe('blocked by policy'));

  test('failed with policy_blocked reason → "blocked by policy"', () =>
    expect(formatApprovalStatus({
      finalStatus: 'failed',
      failureReason: 'policy_blocked',
      hasEvents: true,
      approvedBy: null,
    })).toBe('blocked by policy'));

  // Failed before execution — all three conditions required
  test('failed before execution (all 3 conditions met) → "failed before execution"', () =>
    expect(formatApprovalStatus({
      finalStatus: 'failed',
      failureReason: 'policy_envelope_resolution_failed',
      hasEvents: false,
      approvedBy: null,
    })).toBe('failed before execution'));

  // Missing any one condition → falls back to "failed"
  test('failed + envelope_resolution_failed but hasEvents=true → "failed"', () =>
    expect(formatApprovalStatus({
      finalStatus: 'failed',
      failureReason: 'policy_envelope_resolution_failed',
      hasEvents: true,
      approvedBy: null,
    })).toBe('failed'));

  test('failed + hasEvents=false but different failureReason → "failed"', () =>
    expect(formatApprovalStatus({
      finalStatus: 'failed',
      failureReason: 'some_other_reason',
      hasEvents: false,
      approvedBy: null,
    })).toBe('failed'));

  test('failed + no failureReason + hasEvents=false → "failed"', () =>
    expect(formatApprovalStatus({
      finalStatus: 'failed',
      hasEvents: false,
      approvedBy: null,
    })).toBe('failed'));

  // Generic failed
  test('generic failed → "failed"', () =>
    expect(formatApprovalStatus({
      finalStatus: 'failed',
      hasEvents: true,
      approvedBy: null,
    })).toBe('failed'));

  // Cancelled
  test('cancelled → null', () =>
    expect(formatApprovalStatus({
      finalStatus: 'cancelled',
      hasEvents: false,
      approvedBy: null,
    })).toBe(null));
});
