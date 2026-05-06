// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness"
/**
 * approvalExpiryJobPure.test.ts
 *
 * Pure-function tests for approvalExpiryJob.
 * Tests cutoff math and decision logic — no Postgres required.
 *
 * Run via: npx tsx server/jobs/__tests__/approvalExpiryJobPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  deriveApprovalCutoff,
  decideApprovalExpiry,
  type ExpiredPendingApprovalRow,
} from '../approvalExpiryJobPure.js';

export {};

console.log('\napprovalExpiryJobPure — pure-function tests\n');

// ---------------------------------------------------------------------------
// deriveApprovalCutoff
// ---------------------------------------------------------------------------

test('deriveApprovalCutoff returns the job run time itself', () => {
  const jobRunAt = new Date('2026-05-03T10:00:00.000Z');
  const cutoff = deriveApprovalCutoff(jobRunAt);
  expect(cutoff.getTime()).toBe(jobRunAt.getTime());
});

test('deriveApprovalCutoff does not mutate the input date', () => {
  const jobRunAt = new Date('2026-05-03T10:00:00.000Z');
  const original = jobRunAt.getTime();
  deriveApprovalCutoff(jobRunAt);
  expect(jobRunAt.getTime()).toBe(original);
});

// ---------------------------------------------------------------------------
// decideApprovalExpiry — pending_approval rows
// ---------------------------------------------------------------------------

test('pending_approval row with past approval_expires_at → shouldExpire=true', () => {
  const now = new Date('2026-05-04T12:00:00.000Z');
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-1',
    status: 'pending_approval',
    approvalExpiresAt: new Date('2026-05-03T12:00:00.000Z'), // 24h ago
  };
  const decision = decideApprovalExpiry(row, now);
  expect(decision.shouldExpire).toBe(true);
  expect(decision.reason).toBe('approval_expired');
  expect(decision.chargeId).toBe('charge-1');
});

test('pending_approval row with approval_expires_at exactly equal to now → NOT expired', () => {
  const now = new Date('2026-05-04T12:00:00.000Z');
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-2',
    status: 'pending_approval',
    approvalExpiresAt: new Date(now.getTime()),
  };
  const decision = decideApprovalExpiry(row, now);
  expect(decision.shouldExpire).toBe(false);
  expect(decision.reason).toBe('not_expired');
});

test('pending_approval row with approval_expires_at in the future → NOT expired', () => {
  const now = new Date('2026-05-04T12:00:00.000Z');
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-3',
    status: 'pending_approval',
    approvalExpiresAt: new Date('2026-05-05T12:00:00.000Z'), // 24h from now
  };
  const decision = decideApprovalExpiry(row, now);
  expect(decision.shouldExpire).toBe(false);
  expect(decision.reason).toBe('not_expired');
});

test('pending_approval row with null approval_expires_at → NOT expired', () => {
  const now = new Date('2026-05-04T12:00:00.000Z');
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-4',
    status: 'pending_approval',
    approvalExpiresAt: null,
  };
  const decision = decideApprovalExpiry(row, now);
  expect(decision.shouldExpire).toBe(false);
  expect(decision.reason).toBe('not_expired');
});

// ---------------------------------------------------------------------------
// decideApprovalExpiry — invariant 12: scoped to pending_approval ONLY
// ---------------------------------------------------------------------------

test('approved row is not expired by approval-expiry job', () => {
  const now = new Date('2026-05-04T12:00:00.000Z');
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-5',
    status: 'approved',
    approvalExpiresAt: new Date('2026-05-03T12:00:00.000Z'), // in the past
  };
  const decision = decideApprovalExpiry(row, now);
  expect(decision.shouldExpire).toBe(false);
  expect(decision.reason).toBe('already_resolved');
});

test('denied row is not re-expired', () => {
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-6',
    status: 'denied',
    approvalExpiresAt: new Date('2026-05-03T12:00:00.000Z'),
  };
  const decision = decideApprovalExpiry(row, new Date('2026-05-04T12:00:00.000Z'));
  expect(decision.shouldExpire).toBe(false);
  expect(decision.reason).toBe('already_resolved');
});

test('executed row is not expired by approval-expiry job', () => {
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-7',
    status: 'executed',
    approvalExpiresAt: new Date('2026-05-03T12:00:00.000Z'),
  };
  const decision = decideApprovalExpiry(row, new Date('2026-05-04T12:00:00.000Z'));
  expect(decision.shouldExpire).toBe(false);
  expect(decision.reason).toBe('already_resolved');
});

test('succeeded row is not expired by approval-expiry job', () => {
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-8',
    status: 'succeeded',
    approvalExpiresAt: new Date('2026-05-03T12:00:00.000Z'),
  };
  const decision = decideApprovalExpiry(row, new Date('2026-05-04T12:00:00.000Z'));
  expect(decision.shouldExpire).toBe(false);
  expect(decision.reason).toBe('already_resolved');
});

test('blocked row is not expired by approval-expiry job', () => {
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-9',
    status: 'blocked',
    approvalExpiresAt: new Date('2026-05-03T12:00:00.000Z'),
  };
  const decision = decideApprovalExpiry(row, new Date('2026-05-04T12:00:00.000Z'));
  expect(decision.shouldExpire).toBe(false);
  expect(decision.reason).toBe('already_resolved');
});

test('failed row is not expired by approval-expiry job', () => {
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-10',
    status: 'failed',
    approvalExpiresAt: new Date('2026-05-03T12:00:00.000Z'),
  };
  const decision = decideApprovalExpiry(row, new Date('2026-05-04T12:00:00.000Z'));
  expect(decision.shouldExpire).toBe(false);
  expect(decision.reason).toBe('already_resolved');
});

test('proposed row is not expired by approval-expiry job', () => {
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-11',
    status: 'proposed',
    approvalExpiresAt: new Date('2026-05-03T12:00:00.000Z'),
  };
  const decision = decideApprovalExpiry(row, new Date('2026-05-04T12:00:00.000Z'));
  expect(decision.shouldExpire).toBe(false);
  expect(decision.reason).toBe('already_resolved');
});

// ---------------------------------------------------------------------------
// Boundary cases
// ---------------------------------------------------------------------------

test('approval_expires_at 1ms before now → expired', () => {
  const now = new Date('2026-05-04T12:00:00.000Z');
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-12',
    status: 'pending_approval',
    approvalExpiresAt: new Date(now.getTime() - 1),
  };
  const decision = decideApprovalExpiry(row, now);
  expect(decision.shouldExpire).toBe(true);
});

test('approval_expires_at 1ms after now → NOT expired', () => {
  const now = new Date('2026-05-04T12:00:00.000Z');
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-13',
    status: 'pending_approval',
    approvalExpiresAt: new Date(now.getTime() + 1),
  };
  const decision = decideApprovalExpiry(row, now);
  expect(decision.shouldExpire).toBe(false);
});

// ---------------------------------------------------------------------------
// Default 24-hour window math (policy.approvalExpiresHours = 24)
// ---------------------------------------------------------------------------

test('24-hour approval window: row submitted just within window is not expired', () => {
  const submitted = new Date('2026-05-03T12:00:00.000Z');
  const approvalExpiresAt = new Date(submitted.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date(approvalExpiresAt.getTime() - 1); // 1ms before expiry
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-14',
    status: 'pending_approval',
    approvalExpiresAt,
  };
  const decision = decideApprovalExpiry(row, now);
  expect(decision.shouldExpire).toBe(false);
});

test('24-hour approval window: row submitted just past window is expired', () => {
  const submitted = new Date('2026-05-03T12:00:00.000Z');
  const approvalExpiresAt = new Date(submitted.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date(approvalExpiresAt.getTime() + 1); // 1ms after expiry
  const row: ExpiredPendingApprovalRow = {
    id: 'charge-15',
    status: 'pending_approval',
    approvalExpiresAt,
  };
  const decision = decideApprovalExpiry(row, now);
  expect(decision.shouldExpire).toBe(true);
});
