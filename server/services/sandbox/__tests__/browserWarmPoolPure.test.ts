/**
 * browserWarmPoolPure.test.ts — Unit tests for pure warm-pool helpers.
 *
 * Covers:
 *   - isStaleSession: >30min available → stale; <30min available → not stale; leased → not stale
 *   - isRefillEligible: on+approved → eligible; off → not eligible; null → not eligible; on+!approved → not eligible
 *   - computeIdleCostCents: zero duration → 0; sub-second → 0 after rounding; known rate gives expected integer; negative → 0
 *
 * No DB, no network.
 *
 * Runnable via:
 *   npx vitest run server/services/sandbox/__tests__/browserWarmPoolPure.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isStaleSession,
  isRefillEligible,
  computeIdleCostCents,
  shouldDestroyOnReturn,
} from '../browserWarmPoolPure.js';

// ---------------------------------------------------------------------------
// isStaleSession
// ---------------------------------------------------------------------------

describe('isStaleSession', () => {
  const nowMs = Date.now();

  it('returns true for an available session older than 30 minutes', () => {
    const createdAt = new Date(nowMs - 31 * 60 * 1000);
    expect(isStaleSession({ createdAt, status: 'available' }, nowMs)).toBe(true);
  });

  it('returns false for an available session younger than 30 minutes', () => {
    const createdAt = new Date(nowMs - 10 * 60 * 1000);
    expect(isStaleSession({ createdAt, status: 'available' }, nowMs)).toBe(false);
  });

  it('returns false for a leased session even if older than 30 minutes', () => {
    const createdAt = new Date(nowMs - 60 * 60 * 1000);
    expect(isStaleSession({ createdAt, status: 'leased' }, nowMs)).toBe(false);
  });

  it('returns false for a terminated session even if older than 30 minutes', () => {
    const createdAt = new Date(nowMs - 60 * 60 * 1000);
    expect(isStaleSession({ createdAt, status: 'terminated' }, nowMs)).toBe(false);
  });

  it('respects a custom maxAgeMinutes override', () => {
    const createdAt = new Date(nowMs - 11 * 60 * 1000);
    // 11 minutes old, custom maxAge of 10 minutes → stale
    expect(isStaleSession({ createdAt, status: 'available' }, nowMs, 10)).toBe(true);
    // Same session with custom maxAge of 15 minutes → not stale
    expect(isStaleSession({ createdAt, status: 'available' }, nowMs, 15)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isRefillEligible
// ---------------------------------------------------------------------------

describe('isRefillEligible', () => {
  it('returns true when status=on and rolloutApproved=true', () => {
    expect(isRefillEligible({ status: 'on', rolloutApproved: true })).toBe(true);
  });

  it('returns false when status=off', () => {
    expect(isRefillEligible({ status: 'off', rolloutApproved: true })).toBe(false);
  });

  it('returns false when null settings are supplied', () => {
    expect(isRefillEligible(null)).toBe(false);
  });

  it('returns false when status=on but rolloutApproved=false', () => {
    expect(isRefillEligible({ status: 'on', rolloutApproved: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeIdleCostCents
// ---------------------------------------------------------------------------

describe('computeIdleCostCents', () => {
  it('returns 0 for zero duration', () => {
    expect(computeIdleCostCents(1000, 1000, 0.05)).toBe(0);
  });

  it('returns 0 for negative duration', () => {
    expect(computeIdleCostCents(2000, 1000, 0.05)).toBe(0);
  });

  it('returns 0 for sub-second duration that rounds to 0', () => {
    // 100ms at 0.001 cents/sec = 0.0001 cents → rounds to 0
    expect(computeIdleCostCents(0, 100, 0.001)).toBe(0);
  });

  it('computes the expected integer for a known rate', () => {
    // 10 seconds at 2 cents/sec = 20 cents
    expect(computeIdleCostCents(0, 10_000, 2)).toBe(20);
  });

  it('rounds fractional cents correctly', () => {
    // 1500ms at 1 cent/sec = 1.5 cents → rounds to 2
    expect(computeIdleCostCents(0, 1500, 1)).toBe(2);
  });

  it('handles a typical warm-pool scenario', () => {
    // 30 minutes at 0.001 cents/sec = 1.8 cents → rounds to 2
    const thirtyMinMs = 30 * 60 * 1000;
    expect(computeIdleCostCents(0, thirtyMinMs, 0.001)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// shouldDestroyOnReturn
// ---------------------------------------------------------------------------

describe('shouldDestroyOnReturn', () => {
  it('returns destroy for a proxy-aligned session', () => {
    expect(shouldDestroyOnReturn(true)).toBe('destroy');
  });

  it('returns return_to_pool for a standard (non-proxy) session', () => {
    expect(shouldDestroyOnReturn(false)).toBe('return_to_pool');
  });
});
