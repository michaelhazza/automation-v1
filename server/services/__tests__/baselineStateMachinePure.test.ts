/**
 * baselineStateMachinePure.test.ts
 *
 * Pure-function tests confirming the state machine transition rules match
 * spec §5.1. Run via:
 *   npx vitest run server/services/__tests__/baselineStateMachinePure.test.ts
 */

import { test, expect } from 'vitest';
import {
  canTransition,
  isTerminal,
  isRunnable,
} from '../baselineStateMachinePure.js';

// ── canTransition ─────────────────────────────────────────────────────────────

test('canTransition: pending → capturing is allowed', () => {
  expect(canTransition('pending', 'capturing')).toBe(true);
});

test('canTransition: captured → pending is not allowed', () => {
  expect(canTransition('captured', 'pending')).toBe(false);
});

test('canTransition: reset → pending is not allowed (reset is truly terminal)', () => {
  expect(canTransition('reset', 'pending')).toBe(false);
});

test('canTransition: failed → manual is allowed (manual recovery)', () => {
  expect(canTransition('failed', 'manual')).toBe(true);
});

test('canTransition: capturing → ready is allowed (retryable failure path)', () => {
  expect(canTransition('capturing', 'ready')).toBe(true);
});

test('canTransition: capturing → failed is allowed', () => {
  expect(canTransition('capturing', 'failed')).toBe(true);
});

// ── isTerminal ────────────────────────────────────────────────────────────────

test('isTerminal: captured is terminal', () => {
  expect(isTerminal('captured')).toBe(true);
});

test('isTerminal: manual is not terminal (manual can still be reset)', () => {
  expect(isTerminal('manual')).toBe(false);
});

// ── isRunnable ────────────────────────────────────────────────────────────────

test('isRunnable: pending is runnable', () => {
  expect(isRunnable('pending')).toBe(true);
});

test('isRunnable: ready is runnable', () => {
  expect(isRunnable('ready')).toBe(true);
});

test('isRunnable: capturing is not runnable', () => {
  expect(isRunnable('capturing')).toBe(false);
});

// ── canTransition additional coverage (S3) ────────────────────────────────────

test('canTransition: capturing → captured is allowed (success path)', () => {
  expect(canTransition('capturing', 'captured')).toBe(true);
});

test('canTransition: captured → reset is allowed (admin reset)', () => {
  expect(canTransition('captured', 'reset')).toBe(true);
});

test('canTransition: manual → reset is allowed', () => {
  expect(canTransition('manual', 'reset')).toBe(true);
});

test('canTransition: pending → ready is not allowed (no direct writer)', () => {
  expect(canTransition('pending', 'ready')).toBe(false);
});

test('canTransition: capturing → reset is not allowed (do not reset mid-capture)', () => {
  expect(canTransition('capturing', 'reset')).toBe(false);
});

// ── isTerminal additional coverage (S3) ──────────────────────────────────────

test('isTerminal: failed is terminal', () => {
  expect(isTerminal('failed')).toBe(true);
});

test('isTerminal: reset is terminal', () => {
  expect(isTerminal('reset')).toBe(true);
});

test('isTerminal: pending is not terminal', () => {
  expect(isTerminal('pending')).toBe(false);
});

test('isTerminal: ready is not terminal', () => {
  expect(isTerminal('ready')).toBe(false);
});

test('isTerminal: capturing is not terminal', () => {
  expect(isTerminal('capturing')).toBe(false);
});

// ── isRunnable additional coverage (S3) ──────────────────────────────────────

test('isRunnable: captured is not runnable', () => {
  expect(isRunnable('captured')).toBe(false);
});

test('isRunnable: failed is not runnable', () => {
  expect(isRunnable('failed')).toBe(false);
});

test('isRunnable: reset is not runnable', () => {
  expect(isRunnable('reset')).toBe(false);
});

test('isRunnable: manual is not runnable', () => {
  expect(isRunnable('manual')).toBe(false);
});
