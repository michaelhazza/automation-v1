/**
 * operatorSessionConsentServicePure.test.ts — Unit tests for pure helpers
 * in operatorSessionConsentServicePure.ts.
 *
 * operator-session-identity chunk 2.
 *
 * Test posture: targeted Vitest only — do NOT run umbrella suites locally.
 */

import { describe, it, expect } from 'vitest';
import { compareDisclosureVersion } from '../operatorSessionConsentServicePure.js';

describe('compareDisclosureVersion', () => {
  it('returns valid when recorded equals current (1, 1)', () => {
    expect(compareDisclosureVersion(1, 1)).toBe('valid');
  });

  it('returns needs_reaccept when recorded < current (2, 3)', () => {
    expect(compareDisclosureVersion(2, 3)).toBe('needs_reaccept');
  });

  it('returns valid when recorded > current (3, 2) — not typical but valid', () => {
    expect(compareDisclosureVersion(3, 2)).toBe('valid');
  });

  it('returns valid when both are equal (5, 5)', () => {
    expect(compareDisclosureVersion(5, 5)).toBe('valid');
  });

  it('returns needs_reaccept when recorded is 0 and current is 1', () => {
    expect(compareDisclosureVersion(0, 1)).toBe('needs_reaccept');
  });

  it('returns valid when both are 0', () => {
    expect(compareDisclosureVersion(0, 0)).toBe('valid');
  });
});
