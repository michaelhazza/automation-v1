/**
 * policyEngineServicePure.test.ts — Chunk 7 pure tests
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/policyEngineServicePure.test.ts
 *
 * Tests `evaluateSpendPolicy` — the pure spend-policy gate helper.
 * No DB, no Drizzle, no fetch.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateSpendPolicy,
  type SpendPolicyRules,
  type SpendPolicyRequest,
} from '../policyEngineServicePure.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_POLICY: SpendPolicyRules = {
  mode: 'live',
  perTxnLimitMinor: 10_000, // $100.00
  dailyLimitMinor: 100_000, // $1,000.00
  monthlyLimitMinor: 500_000, // $5,000.00
  approvalThresholdMinor: 5_000, // $50.00
  merchantAllowlist: [
    { id: 'pm_allowed', descriptor: 'ACME CORP', source: 'stripe_id' },
    { id: null, descriptor: 'TRUSTED VENDOR', source: 'descriptor' },
  ],
};

const BASE_REQUEST: SpendPolicyRequest = {
  amountMinor: 1_000, // $10.00 — below threshold
  currency: 'USD',
  merchant: { id: 'pm_allowed', descriptor: 'ACME CORP' },
  mode: 'live',
  killSwitchActive: false,
  budgetDisabledAt: null,
};

// ---------------------------------------------------------------------------
// Gate 1: Kill switch / budget disabled
// ---------------------------------------------------------------------------

describe('Gate 1 — kill switch', () => {
  it('blocks when killSwitchActive is true', () => {
    const result = evaluateSpendPolicy(BASE_POLICY, {
      ...BASE_REQUEST,
      killSwitchActive: true,
    });
    expect(result.evaluated).toBe(true);
    expect(result.outcome).toBe('block');
    expect(result.reason).toBe('spend_block:kill_switch');
  });

  it('blocks when budgetDisabledAt is set', () => {
    const result = evaluateSpendPolicy(BASE_POLICY, {
      ...BASE_REQUEST,
      budgetDisabledAt: new Date('2024-01-01'),
    });
    expect(result.evaluated).toBe(true);
    expect(result.outcome).toBe('block');
    expect(result.reason).toBe('spend_block:kill_switch');
  });

  it('does not block when both flags are clear', () => {
    const result = evaluateSpendPolicy(BASE_POLICY, BASE_REQUEST);
    expect(result.outcome).not.toBe('block');
  });
});

// ---------------------------------------------------------------------------
// Gate 2: Merchant allowlist
// ---------------------------------------------------------------------------

describe('Gate 2 — merchant allowlist', () => {
  it('blocks when allowlist is empty', () => {
    const policy: SpendPolicyRules = { ...BASE_POLICY, merchantAllowlist: [] };
    const result = evaluateSpendPolicy(policy, BASE_REQUEST);
    expect(result.evaluated).toBe(true);
    expect(result.outcome).toBe('block');
    expect(result.reason).toBe('spend_block:allowlist');
  });

  it('blocks when merchant is not on allowlist', () => {
    const result = evaluateSpendPolicy(BASE_POLICY, {
      ...BASE_REQUEST,
      merchant: { id: 'pm_unknown', descriptor: 'UNKNOWN VENDOR' },
    });
    expect(result.evaluated).toBe(true);
    expect(result.outcome).toBe('block');
    expect(result.reason).toBe('spend_block:allowlist');
  });

  it('allows when merchant matches by stripe_id', () => {
    const result = evaluateSpendPolicy(BASE_POLICY, {
      ...BASE_REQUEST,
      merchant: { id: 'pm_allowed', descriptor: 'ACME CORP' },
    });
    expect(result.outcome).not.toBe('block');
  });

  it('allows when merchant matches by descriptor (case-insensitive)', () => {
    const result = evaluateSpendPolicy(BASE_POLICY, {
      ...BASE_REQUEST,
      merchant: { id: null, descriptor: 'trusted vendor' },
    });
    expect(result.outcome).not.toBe('block');
  });

  it('stripe_id match does not use descriptor when id is provided', () => {
    const policy: SpendPolicyRules = {
      ...BASE_POLICY,
      merchantAllowlist: [
        { id: 'pm_specific', descriptor: 'ACME CORP', source: 'stripe_id' },
      ],
    };
    // Wrong stripe_id — should block even if descriptor would match
    const result = evaluateSpendPolicy(policy, {
      ...BASE_REQUEST,
      merchant: { id: 'pm_wrong', descriptor: 'ACME CORP' },
    });
    expect(result.outcome).toBe('block');
    expect(result.reason).toBe('spend_block:allowlist');
  });
});

// ---------------------------------------------------------------------------
// Gate 3: Per-transaction limit
// ---------------------------------------------------------------------------

describe('Gate 3 — per-transaction limit', () => {
  it('blocks when amount exceeds perTxnLimitMinor', () => {
    const result = evaluateSpendPolicy(BASE_POLICY, {
      ...BASE_REQUEST,
      amountMinor: 10_001, // just over $100.00
    });
    expect(result.evaluated).toBe(true);
    expect(result.outcome).toBe('block');
    expect(result.reason).toBe('spend_block:per_txn_exceeded');
  });

  it('allows when amount equals perTxnLimitMinor', () => {
    const result = evaluateSpendPolicy(BASE_POLICY, {
      ...BASE_REQUEST,
      amountMinor: 10_000, // exactly $100.00
    });
    expect(result.outcome).not.toBe('block');
  });

  it('allows when perTxnLimitMinor is 0 (unset)', () => {
    const policy: SpendPolicyRules = { ...BASE_POLICY, perTxnLimitMinor: 0 };
    const result = evaluateSpendPolicy(policy, {
      ...BASE_REQUEST,
      amountMinor: 999_999,
    });
    // Should not block on per-txn, may route to review via threshold
    expect(result.reason).not.toBe('spend_block:per_txn_exceeded');
  });
});

// ---------------------------------------------------------------------------
// Gate 4: Approval threshold
// ---------------------------------------------------------------------------

describe('Gate 4 — approval threshold', () => {
  it('routes to review when amount exceeds approvalThresholdMinor', () => {
    const result = evaluateSpendPolicy(BASE_POLICY, {
      ...BASE_REQUEST,
      amountMinor: 5_001, // just above $50.00 threshold
    });
    expect(result.evaluated).toBe(true);
    expect(result.outcome).toBe('review');
    expect(result.reason).toBe('spend_review:threshold');
  });

  it('auto-approves when amount is at or below threshold', () => {
    const result = evaluateSpendPolicy(BASE_POLICY, {
      ...BASE_REQUEST,
      amountMinor: 5_000, // exactly at threshold
    });
    expect(result.evaluated).toBe(true);
    expect(result.outcome).toBe('auto');
    expect(result.reason).toBeNull();
  });

  it('auto-approves a small amount well below threshold', () => {
    const result = evaluateSpendPolicy(BASE_POLICY, {
      ...BASE_REQUEST,
      amountMinor: 100, // $1.00
    });
    expect(result.outcome).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// All-pass: valid request within all limits
// ---------------------------------------------------------------------------

describe('all_pass — valid request within all limits', () => {
  it('returns auto when every gate passes', () => {
    const result = evaluateSpendPolicy(BASE_POLICY, BASE_REQUEST);
    expect(result.evaluated).toBe(true);
    expect(result.outcome).toBe('auto');
    expect(result.reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Outcome priority: block > review > auto
// ---------------------------------------------------------------------------

describe('outcome priority', () => {
  it('kill switch (block) overrides anything else', () => {
    // Even with an amount above threshold (which would be review), kill switch wins
    const result = evaluateSpendPolicy(BASE_POLICY, {
      ...BASE_REQUEST,
      amountMinor: 9_000, // above threshold
      killSwitchActive: true,
    });
    expect(result.outcome).toBe('block');
    expect(result.reason).toBe('spend_block:kill_switch');
  });

  it('per_txn block overrides threshold review', () => {
    // Amount above both per-txn limit and threshold — block wins
    const result = evaluateSpendPolicy(BASE_POLICY, {
      ...BASE_REQUEST,
      amountMinor: 15_000, // above perTxnLimit AND threshold
    });
    expect(result.outcome).toBe('block');
    expect(result.reason).toBe('spend_block:per_txn_exceeded');
  });
});

// ---------------------------------------------------------------------------
// Malformed policy → throws
// ---------------------------------------------------------------------------

describe('malformed policy', () => {
  it('throws when policyRules is null', () => {
    expect(() =>
      evaluateSpendPolicy(null as unknown as SpendPolicyRules, BASE_REQUEST),
    ).toThrow('[policyEngineServicePure]');
  });

  it('throws when policyRules is an array', () => {
    expect(() =>
      evaluateSpendPolicy([] as unknown as SpendPolicyRules, BASE_REQUEST),
    ).toThrow('[policyEngineServicePure]');
  });

  it('throws when policyRules is a string', () => {
    expect(() =>
      evaluateSpendPolicy('bad' as unknown as SpendPolicyRules, BASE_REQUEST),
    ).toThrow('[policyEngineServicePure]');
  });
});
