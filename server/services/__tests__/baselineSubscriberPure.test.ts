/**
 * baselineSubscriberPure.test.ts
 *
 * Pure-function tests for the enqueue predicate in baselineSubscriberService.
 *
 * Strategy: drive `shouldEnqueueCapture` directly — no DB connection, no mocking.
 * The function is a decision table: (ready, row.status) → boolean.
 *
 * Run via:
 *   npx vitest run server/services/__tests__/baselineSubscriberPure.test.ts
 */

import { describe, it, expect } from 'vitest';
import { shouldEnqueueCapture } from '../baselineSubscriberPure.js';

describe('shouldEnqueueCapture', () => {
  it('readiness=false → not enqueued regardless of status', () => {
    expect(shouldEnqueueCapture(false, { status: 'pending' })).toBe(false);
    expect(shouldEnqueueCapture(false, { status: 'ready' })).toBe(false);
    expect(shouldEnqueueCapture(false, null)).toBe(false);
  });

  it('readiness=true, row does not exist → not enqueued', () => {
    expect(shouldEnqueueCapture(true, null)).toBe(false);
  });

  it('readiness=true, status=pending → enqueued', () => {
    expect(shouldEnqueueCapture(true, { status: 'pending' })).toBe(true);
  });

  it('readiness=true, status=ready → enqueued', () => {
    expect(shouldEnqueueCapture(true, { status: 'ready' })).toBe(true);
  });

  it('readiness=true, status=captured → not enqueued', () => {
    expect(shouldEnqueueCapture(true, { status: 'captured' })).toBe(false);
  });

  it('readiness=true, status=failed → not enqueued', () => {
    expect(shouldEnqueueCapture(true, { status: 'failed' })).toBe(false);
  });

  it('readiness=true, status=reset → not enqueued', () => {
    expect(shouldEnqueueCapture(true, { status: 'reset' })).toBe(false);
  });
});
