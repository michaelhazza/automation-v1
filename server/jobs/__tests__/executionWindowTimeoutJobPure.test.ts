// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness"
/**
 * executionWindowTimeoutJobPure.test.ts
 *
 * Pure-function tests for executionWindowTimeoutJob.
 * Tests cutoff math and decision logic — no Postgres required.
 *
 * Run via: npx tsx server/jobs/__tests__/executionWindowTimeoutJobPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  deriveCutoff,
  decideTimeout,
  type ExpiredApprovedRow,
} from '../executionWindowTimeoutJobPure.js';

export {};

console.log('\nexecutionWindowTimeoutJobPure — pure-function tests\n');

// ---------------------------------------------------------------------------
// deriveCutoff
// ---------------------------------------------------------------------------

test('deriveCutoff returns the job run time itself', () => {
  const jobRunAt = new Date('2026-05-03T10:00:00.000Z');
  const cutoff = deriveCutoff(jobRunAt);
  expect(cutoff.getTime()).toBe(jobRunAt.getTime());
});

test('deriveCutoff does not mutate the input date', () => {
  const jobRunAt = new Date('2026-05-03T10:00:00.000Z');
  const original = jobRunAt.getTime();
  deriveCutoff(jobRunAt);
  expect(jobRunAt.getTime()).toBe(original);
});

// ---------------------------------------------------------------------------
// decideTimeout — approved rows
// ---------------------------------------------------------------------------

test('approved row with past expires_at → shouldTimeout=true', () => {
  const now = new Date('2026-05-03T10:05:00.000Z');
  const row: ExpiredApprovedRow = {
    id: 'charge-1',
    status: 'approved',
    expiresAt: new Date('2026-05-03T09:35:00.000Z'), // 30 min ago
  };
  const decision = decideTimeout(row, now);
  expect(decision.shouldTimeout).toBe(true);
  expect(decision.reason).toBe('execution_timeout');
  expect(decision.chargeId).toBe('charge-1');
});

test('approved row with expires_at exactly equal to now → NOT timed out (boundary: inclusive now)', () => {
  const now = new Date('2026-05-03T10:05:00.000Z');
  const row: ExpiredApprovedRow = {
    id: 'charge-2',
    status: 'approved',
    expiresAt: new Date(now.getTime()), // exactly now
  };
  const decision = decideTimeout(row, now);
  // expiresAt >= now → not expired
  expect(decision.shouldTimeout).toBe(false);
  expect(decision.reason).toBe('not_expired');
});

test('approved row with expires_at in the future → NOT timed out', () => {
  const now = new Date('2026-05-03T10:05:00.000Z');
  const row: ExpiredApprovedRow = {
    id: 'charge-3',
    status: 'approved',
    expiresAt: new Date('2026-05-03T10:35:00.000Z'), // 30 min from now
  };
  const decision = decideTimeout(row, now);
  expect(decision.shouldTimeout).toBe(false);
  expect(decision.reason).toBe('not_expired');
});

test('approved row with null expires_at → NOT timed out', () => {
  const now = new Date('2026-05-03T10:05:00.000Z');
  const row: ExpiredApprovedRow = {
    id: 'charge-4',
    status: 'approved',
    expiresAt: null,
  };
  const decision = decideTimeout(row, now);
  expect(decision.shouldTimeout).toBe(false);
  expect(decision.reason).toBe('not_expired');
});

// ---------------------------------------------------------------------------
// decideTimeout — invariant 11: MUST NOT touch executed rows
// ---------------------------------------------------------------------------

test('executed row is never timed out regardless of expires_at', () => {
  const now = new Date('2026-05-03T10:05:00.000Z');
  const row: ExpiredApprovedRow = {
    id: 'charge-5',
    status: 'executed',
    expiresAt: new Date('2026-05-03T08:00:00.000Z'), // clearly in the past
  };
  const decision = decideTimeout(row, now);
  expect(decision.shouldTimeout).toBe(false);
  expect(decision.reason).toBe('already_terminal');
});

test('succeeded row is never timed out', () => {
  const now = new Date('2026-05-03T10:05:00.000Z');
  const row: ExpiredApprovedRow = {
    id: 'charge-6',
    status: 'succeeded',
    expiresAt: new Date('2026-05-03T08:00:00.000Z'),
  };
  const decision = decideTimeout(row, now);
  expect(decision.shouldTimeout).toBe(false);
  expect(decision.reason).toBe('already_terminal');
});

test('failed row is never timed out', () => {
  const row: ExpiredApprovedRow = {
    id: 'charge-7',
    status: 'failed',
    expiresAt: new Date('2026-05-03T08:00:00.000Z'),
  };
  const decision = decideTimeout(row, new Date('2026-05-03T10:05:00.000Z'));
  expect(decision.shouldTimeout).toBe(false);
  expect(decision.reason).toBe('already_terminal');
});

test('blocked row is never timed out', () => {
  const row: ExpiredApprovedRow = {
    id: 'charge-8',
    status: 'blocked',
    expiresAt: new Date('2026-05-03T08:00:00.000Z'),
  };
  const decision = decideTimeout(row, new Date('2026-05-03T10:05:00.000Z'));
  expect(decision.shouldTimeout).toBe(false);
  expect(decision.reason).toBe('already_terminal');
});

test('denied row is never timed out', () => {
  const row: ExpiredApprovedRow = {
    id: 'charge-9',
    status: 'denied',
    expiresAt: new Date('2026-05-03T08:00:00.000Z'),
  };
  const decision = decideTimeout(row, new Date('2026-05-03T10:05:00.000Z'));
  expect(decision.shouldTimeout).toBe(false);
  expect(decision.reason).toBe('already_terminal');
});

test('pending_approval row is never timed out by the timeout job', () => {
  const row: ExpiredApprovedRow = {
    id: 'charge-10',
    status: 'pending_approval',
    expiresAt: new Date('2026-05-03T08:00:00.000Z'),
  };
  const decision = decideTimeout(row, new Date('2026-05-03T10:05:00.000Z'));
  expect(decision.shouldTimeout).toBe(false);
  expect(decision.reason).toBe('already_terminal');
});

// ---------------------------------------------------------------------------
// decideTimeout — proposed row (should also not be timed out by this job)
// ---------------------------------------------------------------------------

test('proposed row is not timed out by execution-window job', () => {
  const row: ExpiredApprovedRow = {
    id: 'charge-11',
    status: 'proposed',
    expiresAt: new Date('2026-05-03T08:00:00.000Z'),
  };
  const decision = decideTimeout(row, new Date('2026-05-03T10:05:00.000Z'));
  expect(decision.shouldTimeout).toBe(false);
  expect(decision.reason).toBe('already_terminal');
});

// ---------------------------------------------------------------------------
// Boundary: 1ms before expiry vs 1ms after
// ---------------------------------------------------------------------------

test('expires_at 1ms before now → timed out', () => {
  const now = new Date('2026-05-03T10:05:00.000Z');
  const row: ExpiredApprovedRow = {
    id: 'charge-12',
    status: 'approved',
    expiresAt: new Date(now.getTime() - 1),
  };
  const decision = decideTimeout(row, now);
  expect(decision.shouldTimeout).toBe(true);
});

test('expires_at 1ms after now → NOT timed out', () => {
  const now = new Date('2026-05-03T10:05:00.000Z');
  const row: ExpiredApprovedRow = {
    id: 'charge-13',
    status: 'approved',
    expiresAt: new Date(now.getTime() + 1),
  };
  const decision = decideTimeout(row, now);
  expect(decision.shouldTimeout).toBe(false);
});
