/**
 * refreshBufferPure.test.ts
 *
 * Pure-function tests for getRefreshBufferMs.
 * Run via: npx vitest run server/services/__tests__/refreshBufferPure.test.ts
 */

import { describe, it, expect } from 'vitest';
import { getRefreshBufferMs } from '../connectionTokenServicePure.js';

describe('getRefreshBufferMs', () => {
  it('returns 300_000 (5 min) for unknown providers', () => {
    expect(getRefreshBufferMs('unknown_provider')).toBe(300_000);
  });

  it('returns 300_000 (5 min) for empty string', () => {
    expect(getRefreshBufferMs('')).toBe(300_000);
  });

  it('returns 600_000 (10 min) for stripe_agent', () => {
    expect(getRefreshBufferMs('stripe_agent')).toBe(600_000);
  });

  it('stripe_agent buffer is larger than the default buffer (regression guard)', () => {
    expect(getRefreshBufferMs('stripe_agent')).toBeGreaterThan(getRefreshBufferMs('unknown'));
  });

  // Regression guard: existing providers still return 300_000
  it('returns 300_000 for gmail (existing provider)', () => {
    expect(getRefreshBufferMs('gmail')).toBe(300_000);
  });

  it('returns 300_000 for hubspot (existing provider)', () => {
    expect(getRefreshBufferMs('hubspot')).toBe(300_000);
  });

  it('returns 300_000 for slack (existing provider)', () => {
    expect(getRefreshBufferMs('slack')).toBe(300_000);
  });

  it('returns 300_000 for ghl (existing provider)', () => {
    expect(getRefreshBufferMs('ghl')).toBe(300_000);
  });

  it('returns 300_000 for stripe (base stripe provider)', () => {
    expect(getRefreshBufferMs('stripe')).toBe(300_000);
  });
});
