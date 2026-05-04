/**
 * spendingBudgetServicePure.test.ts — Pure function tests for spending budget service.
 *
 * Covers:
 *   - validateMerchantAllowlist: boundary cases (0, 250, 251 entries; duplicates; whitespace-only)
 *   - incrementPolicyVersion: basic increment math
 *   - resolvePromotionTransition: shadow → live, already live
 *   - computeDefaultGrantScope: org-scoped vs subaccount-scoped
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/spendingBudgetServicePure.test.ts
 */

import { expect, test, describe } from 'vitest';
import {
  validateMerchantAllowlist,
  incrementPolicyVersion,
  resolvePromotionTransition,
  computeDefaultGrantScope,
} from '../spendingBudgetServicePure.js';
import type { MerchantAllowlistEntry } from '../../db/schema/spendingPolicies.js';

// ---------------------------------------------------------------------------
// validateMerchantAllowlist
// ---------------------------------------------------------------------------

function makeEntry(descriptor: string, i: number): MerchantAllowlistEntry {
  return { id: null, descriptor, source: 'descriptor' };
}

describe('validateMerchantAllowlist', () => {
  test('empty allowlist is valid', () => {
    const result = validateMerchantAllowlist([]);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.normalised).toHaveLength(0);
  });

  test('250 unique entries are valid', () => {
    const entries = Array.from({ length: 250 }, (_, i) => makeEntry(`Merchant ${i}`, i));
    const result = validateMerchantAllowlist(entries);
    expect(result.valid).toBe(true);
  });

  test('251 unique entries are rejected as allowlist_too_large', () => {
    const entries = Array.from({ length: 251 }, (_, i) => makeEntry(`Merchant ${i}`, i));
    const result = validateMerchantAllowlist(entries);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('allowlist_too_large');
  });

  test('duplicate entries are deduplicated (same normalised descriptor)', () => {
    // These should normalise to the same string
    const entries: MerchantAllowlistEntry[] = [
      { id: null, descriptor: 'AMAZON', source: 'descriptor' },
      { id: null, descriptor: 'amazon', source: 'descriptor' },
      { id: null, descriptor: '  Amazon  ', source: 'descriptor' },
    ];
    const result = validateMerchantAllowlist(entries);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.normalised).toHaveLength(1);
  });

  test('whitespace-only entry is rejected', () => {
    const entries: MerchantAllowlistEntry[] = [
      { id: null, descriptor: '   ', source: 'descriptor' },
    ];
    const result = validateMerchantAllowlist(entries);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('whitespace_only_entry');
  });

  test('valid entries are returned with normalised descriptors', () => {
    const entries: MerchantAllowlistEntry[] = [
      { id: null, descriptor: 'stripe inc.', source: 'descriptor' },
    ];
    const result = validateMerchantAllowlist(entries);
    expect(result.valid).toBe(true);
    if (result.valid) {
      // normaliseMerchantDescriptor uppercases and strips punctuation
      expect(result.normalised[0].descriptor).toBe('STRIPE INC');
    }
  });

  test('250 entries after dedup is valid (dedup occurs before cap check)', () => {
    // 251 entries but 1 is a duplicate of another → 250 unique → valid
    const entries: MerchantAllowlistEntry[] = [
      ...Array.from({ length: 250 }, (_, i) => makeEntry(`Merchant ${i}`, i)),
      // Duplicate of index 0
      makeEntry('Merchant 0', 999),
    ];
    const result = validateMerchantAllowlist(entries);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// incrementPolicyVersion
// ---------------------------------------------------------------------------

describe('incrementPolicyVersion', () => {
  test('increments from 1 to 2', () => {
    expect(incrementPolicyVersion(1)).toBe(2);
  });

  test('increments from 99 to 100', () => {
    expect(incrementPolicyVersion(99)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// resolvePromotionTransition — state machine
// ---------------------------------------------------------------------------

describe('resolvePromotionTransition', () => {
  test('shadow → live is valid', () => {
    const result = resolvePromotionTransition('shadow');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.newMode).toBe('live');
  });

  test('live → live is rejected as already_live', () => {
    const result = resolvePromotionTransition('live');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('already_live');
  });
});

// ---------------------------------------------------------------------------
// computeDefaultGrantScope
// ---------------------------------------------------------------------------

describe('computeDefaultGrantScope', () => {
  test('org-scoped budget (no subaccountId) → org grant scope', () => {
    const scope = computeDefaultGrantScope('org-001', null);
    expect(scope.type).toBe('org');
    expect(scope.organisationId).toBe('org-001');
  });

  test('subaccount-scoped budget → subaccount grant scope', () => {
    const scope = computeDefaultGrantScope('org-001', 'sub-001');
    expect(scope.type).toBe('subaccount');
    if (scope.type === 'subaccount') {
      expect(scope.subaccountId).toBe('sub-001');
    }
  });
});
