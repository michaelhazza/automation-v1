// ---------------------------------------------------------------------------
// chargeRouterServicePure — comprehensive Vitest unit suite
//
// Spec: tasks/builds/agentic-commerce/spec.md
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 4
// Target: ≥55 test cases
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { canonicaliseJson } from '../../lib/canonicalJsonPure.js';
import {
  CHARGE_KEY_VERSION,
  ISO_4217_MINOR_UNIT_EXPONENT,
  MERCHANT_ALLOWLIST_MAX_ENTRIES,
  EXECUTION_TIMEOUT_MINUTES,
} from '../../config/spendConstants.js';
import {
  evaluatePolicy,
  buildChargeIdempotencyKey,
  normaliseMerchantDescriptor,
  previewSpendForPlan,
  validateAmountForCurrency,
  classifyStripeError,
  deriveWindowKey,
  type EvaluatePolicyInput,
  type SpendingPolicy,
  type ChargeRouterRequest,
  type ParsedPlan,
} from '../chargeRouterServicePure.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePolicy(overrides: Partial<SpendingPolicy> = {}): SpendingPolicy {
  return {
    id: 'policy-1',
    spendingBudgetId: 'budget-1',
    mode: 'live',
    perTxnLimitMinor: 0,
    dailyLimitMinor: 0,
    monthlyLimitMinor: 0,
    approvalThresholdMinor: 10_000, // $100.00
    merchantAllowlist: [
      { id: null, descriptor: 'STRIPE', source: 'descriptor' },
    ],
    approvalExpiresHours: 24,
    version: 1,
    velocityConfig: null,
    confidenceGateConfig: null,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ChargeRouterRequest> = {}): ChargeRouterRequest {
  return {
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    agentId: 'agent-1',
    skillRunId: '11111111-1111-1111-1111-111111111111',
    toolCallId: 'tc-1',
    intent: 'buy_domain_example.com',
    amountMinor: 999,
    currency: 'USD',
    merchant: { id: null, descriptor: 'STRIPE' },
    chargeType: 'purchase',
    args: { domain: 'example.com' },
    parentChargeId: null,
    ...overrides,
  };
}

function makeInput(overrides: Partial<EvaluatePolicyInput> = {}): EvaluatePolicyInput {
  return {
    policy: makePolicy(),
    budget: { currency: 'USD', disabledAt: null },
    request: makeRequest(),
    killSwitchActive: false,
    sptStatus: 'active',
    reservedCapacity: { dailyMinor: 0, monthlyMinor: 0 },
    settledNet: { dailyMinor: 0, monthlyMinor: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// spendConstants — smoke tests
// ---------------------------------------------------------------------------

describe('spendConstants', () => {
  it('CHARGE_KEY_VERSION matches /^v\\d+$/', () => {
    expect(/^v\d+$/.test(CHARGE_KEY_VERSION)).toBe(true);
  });

  it('CHARGE_KEY_VERSION is v1', () => {
    expect(CHARGE_KEY_VERSION).toBe('v1');
  });

  it('EXECUTION_TIMEOUT_MINUTES is 30', () => {
    expect(EXECUTION_TIMEOUT_MINUTES).toBe(30);
  });

  it('MERCHANT_ALLOWLIST_MAX_ENTRIES is 250', () => {
    expect(MERCHANT_ALLOWLIST_MAX_ENTRIES).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// validateAmountForCurrency — ISO 4217 exponent table coverage
// ---------------------------------------------------------------------------

describe('validateAmountForCurrency', () => {
  it('USD (exponent=2) — valid integer', () => {
    expect(validateAmountForCurrency(100, 'USD')).toEqual({ valid: true });
  });

  it('EUR (exponent=2) — valid integer', () => {
    expect(validateAmountForCurrency(5000, 'EUR')).toEqual({ valid: true });
  });

  it('GBP (exponent=2) — valid integer', () => {
    expect(validateAmountForCurrency(250, 'GBP')).toEqual({ valid: true });
  });

  it('JPY (exponent=0) — valid integer (whole units)', () => {
    expect(validateAmountForCurrency(1000, 'JPY')).toEqual({ valid: true });
  });

  it('KRW (exponent=0) — valid integer', () => {
    expect(validateAmountForCurrency(10000, 'KRW')).toEqual({ valid: true });
  });

  it('VND (exponent=0) — valid integer', () => {
    expect(validateAmountForCurrency(500000, 'VND')).toEqual({ valid: true });
  });

  it('BHD (exponent=3) — valid integer (fils)', () => {
    expect(validateAmountForCurrency(1000, 'BHD')).toEqual({ valid: true });
  });

  it('KWD (exponent=3) — valid integer (fils)', () => {
    expect(validateAmountForCurrency(500, 'KWD')).toEqual({ valid: true });
  });

  it('unknown currency returns unknown_currency', () => {
    expect(validateAmountForCurrency(100, 'XYZ')).toEqual({
      valid: false,
      reason: 'unknown_currency',
    });
  });

  it('fractional minor unit (0.5) returns fractional_minor_unit', () => {
    expect(validateAmountForCurrency(0.5, 'USD')).toEqual({
      valid: false,
      reason: 'fractional_minor_unit',
    });
  });

  it('fractional minor unit on zero-decimal currency returns fractional_minor_unit', () => {
    expect(validateAmountForCurrency(0.5, 'JPY')).toEqual({
      valid: false,
      reason: 'fractional_minor_unit',
    });
  });

  it('negative integer returns fractional_minor_unit', () => {
    // Negative amounts are a programming error — treated as fractional_minor_unit.
    expect(validateAmountForCurrency(-100, 'USD')).toEqual({
      valid: false,
      reason: 'fractional_minor_unit',
    });
  });

  it('zero amount returns valid (0 is a non-negative integer)', () => {
    // validateAmountForCurrency is a shape validator; positivity is enforced
    // by evaluatePolicy's amountMinor > 0 guard.
    expect(validateAmountForCurrency(0, 'USD')).toEqual({ valid: true });
  });

  it('ISO_4217_MINOR_UNIT_EXPONENT table is accessible and covers all 8 required currencies', () => {
    const required = ['USD', 'EUR', 'GBP', 'JPY', 'KRW', 'VND', 'BHD', 'KWD'];
    for (const c of required) {
      expect(c in ISO_4217_MINOR_UNIT_EXPONENT).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// normaliseMerchantDescriptor — §16.12 algorithm coverage
// ---------------------------------------------------------------------------

describe('normaliseMerchantDescriptor', () => {
  it('step 1: NFKC normalises full-width Latin to ASCII', () => {
    // U+FF33 FULLWIDTH LATIN CAPITAL LETTER S → S
    const input = 'ＳTRIPE';
    expect(normaliseMerchantDescriptor(input)).toBe('STRIPE');
  });

  it('step 2: trims leading and trailing whitespace', () => {
    expect(normaliseMerchantDescriptor('  STRIPE  ')).toBe('STRIPE');
  });

  it('step 2: trims Unicode whitespace (non-breaking space)', () => {
    expect(normaliseMerchantDescriptor(' STRIPE ')).toBe('STRIPE');
  });

  it('step 3: collapses internal whitespace runs to single space', () => {
    expect(normaliseMerchantDescriptor('STRIPE   INC')).toBe('STRIPE INC');
  });

  it('step 4: uppercases en-US locale', () => {
    expect(normaliseMerchantDescriptor('stripe')).toBe('STRIPE');
  });

  it('step 4: mixed case becomes uppercase', () => {
    expect(normaliseMerchantDescriptor('Stripe Inc')).toBe('STRIPE INC');
  });

  it('step 5: strips punctuation (period, comma, colon)', () => {
    expect(normaliseMerchantDescriptor('STRIPE, INC.')).toBe('STRIPE INC');
  });

  it('step 5: strips hyphen', () => {
    expect(normaliseMerchantDescriptor('NAME-CHEAP')).toBe('NAMECHEAP');
  });

  it('step 5: strips underscore', () => {
    expect(normaliseMerchantDescriptor('NAME_CHEAP')).toBe('NAMECHEAP');
  });

  it('step 5: strips parentheses', () => {
    expect(normaliseMerchantDescriptor('STRIPE (INC)')).toBe('STRIPE INC');
  });

  it('step 5: preserves & — AT&T case pinned', () => {
    expect(normaliseMerchantDescriptor('AT&T')).toBe('AT&T');
  });

  it('step 5: preserves & in lowercase input', () => {
    expect(normaliseMerchantDescriptor('at&t')).toBe('AT&T');
  });

  it('idempotent — normalising twice yields the same result', () => {
    const once = normaliseMerchantDescriptor('  Stripe, Inc.  ');
    const twice = normaliseMerchantDescriptor(once);
    expect(once).toBe(twice);
  });

  it('empty string returns empty string', () => {
    expect(normaliseMerchantDescriptor('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildChargeIdempotencyKey — shape and merchant-normalisation contract
// ---------------------------------------------------------------------------

describe('buildChargeIdempotencyKey', () => {
  it('key is prefixed with CHARGE_KEY_VERSION', () => {
    const key = buildChargeIdempotencyKey({
      skillRunId: '11111111-1111-1111-1111-111111111111',
      toolCallId: 'tc-1',
      intent: 'buy_domain',
      args: { domain: 'example.com' },
      mode: 'live',
    });
    expect(key.startsWith(`${CHARGE_KEY_VERSION}:`)).toBe(true);
  });

  it('key structure: v1:skillRunId:toolCallId:charge:mode:intent:hash', () => {
    const skillRunId = '11111111-1111-1111-1111-111111111111';
    const toolCallId = 'tc-abc';
    const intent = 'buy_domain';
    const args = { domain: 'example.com' };
    const mode = 'live' as const;

    const argsHash = createHash('sha256').update(canonicaliseJson(args)).digest('hex');
    const expected = `v1:${skillRunId}:${toolCallId}:charge:${mode}:${intent}:${argsHash}`;
    const actual = buildChargeIdempotencyKey({ skillRunId, toolCallId, intent, args, mode });
    expect(actual).toBe(expected);
  });

  it('shadow mode produces different key from live mode (same intent)', () => {
    const base = {
      skillRunId: '22222222-2222-2222-2222-222222222222',
      toolCallId: 'tc-1',
      intent: 'buy_domain',
      args: { domain: 'example.com' },
    };
    const shadowKey = buildChargeIdempotencyKey({ ...base, mode: 'shadow' });
    const liveKey = buildChargeIdempotencyKey({ ...base, mode: 'live' });
    expect(shadowKey).not.toBe(liveKey);
  });

  it('same args different key order → same key (canonicaliseJson)', () => {
    const base = {
      skillRunId: '33333333-3333-3333-3333-333333333333',
      toolCallId: 'tc-1',
      intent: 'buy_domain',
      mode: 'live' as const,
    };
    const a = buildChargeIdempotencyKey({ ...base, args: { b: 2, a: 1 } });
    const b = buildChargeIdempotencyKey({ ...base, args: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });

  it('merchant normalisation contract: same merchant different casing → same key when pre-normalised', () => {
    const base = {
      skillRunId: '44444444-4444-4444-4444-444444444444',
      toolCallId: 'tc-1',
      intent: 'buy',
      mode: 'live' as const,
    };
    // Simulate caller normalising merchant descriptor before placing on args.
    const merchantA = normaliseMerchantDescriptor('Stripe Inc.');   // → 'STRIPE INC'
    const merchantB = normaliseMerchantDescriptor('STRIPE INC');    // → 'STRIPE INC'
    const keyA = buildChargeIdempotencyKey({ ...base, args: { merchant: merchantA } });
    const keyB = buildChargeIdempotencyKey({ ...base, args: { merchant: merchantB } });
    expect(keyA).toBe(keyB);
  });

  it('negative contract: un-normalised descriptors produce DIFFERENT keys (pinning the bug)', () => {
    // When callers forget to normalise, casing differences break idempotency.
    const base = {
      skillRunId: '55555555-5555-5555-5555-555555555555',
      toolCallId: 'tc-1',
      intent: 'buy',
      mode: 'live' as const,
    };
    const keyA = buildChargeIdempotencyKey({ ...base, args: { merchant: 'Stripe Inc.' } });
    const keyB = buildChargeIdempotencyKey({ ...base, args: { merchant: 'STRIPE INC' } });
    expect(keyA).not.toBe(keyB); // Bug surfaces here — different keys despite same logical merchant.
  });

  it('reuses canonicaliseJson (verified: different field order in nested args produces same hash)', () => {
    const base = {
      skillRunId: '66666666-6666-6666-6666-666666666666',
      toolCallId: 'tc-1',
      intent: 'buy',
      mode: 'live' as const,
    };
    const a = buildChargeIdempotencyKey({ ...base, args: { payment: { currency: 'USD', amount: 100 } } });
    const b = buildChargeIdempotencyKey({ ...base, args: { payment: { amount: 100, currency: 'USD' } } });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// deriveWindowKey — half-open [start, end) boundary tests (invariant 42)
// ---------------------------------------------------------------------------

describe('deriveWindowKey', () => {
  it('daily: 2026-05-04T00:00:00.000Z → "2026-05-04"', () => {
    expect(deriveWindowKey(new Date('2026-05-04T00:00:00.000Z'), 'daily', 'UTC')).toBe('2026-05-04');
  });

  it('daily: 2026-05-03T23:59:59.999Z → "2026-05-03"', () => {
    expect(deriveWindowKey(new Date('2026-05-03T23:59:59.999Z'), 'daily', 'UTC')).toBe('2026-05-03');
  });

  it('daily: boundary millisecond before midnight belongs to the earlier day', () => {
    expect(deriveWindowKey(new Date('2026-12-31T23:59:59.999Z'), 'daily', 'UTC')).toBe('2026-12-31');
  });

  it('daily: midnight-exactly belongs to the new day', () => {
    expect(deriveWindowKey(new Date('2027-01-01T00:00:00.000Z'), 'daily', 'UTC')).toBe('2027-01-01');
  });

  it('monthly: 2026-06-01T00:00:00.000Z → "2026-06"', () => {
    expect(deriveWindowKey(new Date('2026-06-01T00:00:00.000Z'), 'monthly', 'UTC')).toBe('2026-06');
  });

  it('monthly: 2026-05-31T23:59:59.999Z → "2026-05"', () => {
    expect(deriveWindowKey(new Date('2026-05-31T23:59:59.999Z'), 'monthly', 'UTC')).toBe('2026-05');
  });

  it('monthly: start of year', () => {
    expect(deriveWindowKey(new Date('2026-01-01T00:00:00.000Z'), 'monthly', 'UTC')).toBe('2026-01');
  });

  it('monthly: end of year', () => {
    expect(deriveWindowKey(new Date('2026-12-31T23:59:59.999Z'), 'monthly', 'UTC')).toBe('2026-12');
  });

  it('daily key format is always YYYY-MM-DD (single digit months/days zero-padded)', () => {
    // Jan 5 — month=01, day=05
    const key = deriveWindowKey(new Date('2026-01-05T12:00:00.000Z'), 'daily', 'UTC');
    expect(key).toBe('2026-01-05');
  });

  it('monthly key format is always YYYY-MM (single digit months zero-padded)', () => {
    const key = deriveWindowKey(new Date('2026-09-15T12:00:00.000Z'), 'monthly', 'UTC');
    expect(key).toBe('2026-09');
  });
});

// ---------------------------------------------------------------------------
// classifyStripeError — invariant 26 retry table coverage
// ---------------------------------------------------------------------------

describe('classifyStripeError', () => {
  it('HTTP 401 → auth_refresh_retry', () => {
    expect(classifyStripeError({ statusCode: 401 })).toBe('auth_refresh_retry');
  });

  it('HTTP 402 → fail_402', () => {
    expect(classifyStripeError({ statusCode: 402 })).toBe('fail_402');
  });

  it('HTTP 409 → idempotency_conflict', () => {
    expect(classifyStripeError({ statusCode: 409 })).toBe('idempotency_conflict');
  });

  it('HTTP 429 → rate_limited_retry', () => {
    expect(classifyStripeError({ statusCode: 429 })).toBe('rate_limited_retry');
  });

  it('HTTP 500 → server_retry', () => {
    expect(classifyStripeError({ statusCode: 500 })).toBe('server_retry');
  });

  it('HTTP 502 → server_retry', () => {
    expect(classifyStripeError({ statusCode: 502 })).toBe('server_retry');
  });

  it('HTTP 503 → server_retry', () => {
    expect(classifyStripeError({ statusCode: 503 })).toBe('server_retry');
  });

  it('HTTP 400 → fail_other_4xx', () => {
    expect(classifyStripeError({ statusCode: 400 })).toBe('fail_other_4xx');
  });

  it('HTTP 404 → fail_other_4xx', () => {
    expect(classifyStripeError({ statusCode: 404 })).toBe('fail_other_4xx');
  });

  it('HTTP 422 → fail_other_4xx', () => {
    expect(classifyStripeError({ statusCode: 422 })).toBe('fail_other_4xx');
  });

  it('stripe-node v3 .status field is also handled', () => {
    expect(classifyStripeError({ status: 402 })).toBe('fail_402');
  });

  it('non-HTTP error (string) → server_retry', () => {
    expect(classifyStripeError('network failure')).toBe('server_retry');
  });

  it('null → server_retry', () => {
    expect(classifyStripeError(null)).toBe('server_retry');
  });

  it('error without statusCode → server_retry', () => {
    expect(classifyStripeError(new Error('unknown'))).toBe('server_retry');
  });
});

// ---------------------------------------------------------------------------
// evaluatePolicy — every (gate, outcome) cell
// ---------------------------------------------------------------------------

describe('evaluatePolicy', () => {
  // ── All gates pass ─────────────────────────────────────────────────────────
  it('all gates pass — outcome: approved', () => {
    const result = evaluatePolicy(makeInput());
    expect(result.outcome).toBe('approved');
    expect(result.failureReason).toBeNull();
    expect(result.decisionPath.killSwitch).toBe('pass');
    expect(result.decisionPath.spt).toBe('pass');
    expect(result.decisionPath.currency).toBe('pass');
    expect(result.decisionPath.allowlist).toBe('pass');
    expect(result.decisionPath.threshold).toBe('auto');
  });

  it('all gates pass — reservedMinor equals amountMinor', () => {
    const result = evaluatePolicy(makeInput({ request: makeRequest({ amountMinor: 500 }) }));
    expect(result.reservedMinor).toBe(500);
  });

  // ── Gate 1: Kill Switch ────────────────────────────────────────────────────
  it('kill switch active → blocked / kill_switch', () => {
    const result = evaluatePolicy(makeInput({ killSwitchActive: true }));
    expect(result.outcome).toBe('blocked');
    expect(result.failureReason).toBe('kill_switch');
    expect(result.decisionPath.killSwitch).toBe('fail');
    expect(result.reservedMinor).toBe(0);
  });

  it('budget.disabledAt set → blocked / kill_switch', () => {
    const result = evaluatePolicy(makeInput({
      budget: { currency: 'USD', disabledAt: new Date() },
    }));
    expect(result.outcome).toBe('blocked');
    expect(result.failureReason).toBe('kill_switch');
    expect(result.decisionPath.killSwitch).toBe('fail');
  });

  // ── Gate 1 (SPT): SPT validity ─────────────────────────────────────────────
  it('sptStatus=expired → blocked / spt_expired', () => {
    const result = evaluatePolicy(makeInput({ sptStatus: 'expired' }));
    expect(result.outcome).toBe('blocked');
    expect(result.failureReason).toBe('spt_expired');
    expect(result.decisionPath.spt).toBe('fail');
  });

  it('sptStatus=revoked → blocked / spt_revoked', () => {
    const result = evaluatePolicy(makeInput({ sptStatus: 'revoked' }));
    expect(result.outcome).toBe('blocked');
    expect(result.failureReason).toBe('spt_revoked');
  });

  it('sptStatus=unavailable → blocked / spt_unavailable', () => {
    const result = evaluatePolicy(makeInput({ sptStatus: 'unavailable' }));
    expect(result.outcome).toBe('blocked');
    expect(result.failureReason).toBe('spt_unavailable');
  });

  // ── Gate 1.5: Currency mismatch (invariant 18) ────────────────────────────
  it('currency mismatch → blocked / currency_mismatch', () => {
    const result = evaluatePolicy(makeInput({
      budget: { currency: 'EUR', disabledAt: null },
      request: makeRequest({ currency: 'USD' }),
    }));
    expect(result.outcome).toBe('blocked');
    expect(result.failureReason).toBe('currency_mismatch');
    expect(result.decisionPath.currency).toBe('fail');
  });

  it('currency match — currency gate passes', () => {
    const result = evaluatePolicy(makeInput({
      budget: { currency: 'USD', disabledAt: null },
      request: makeRequest({ currency: 'USD' }),
    }));
    expect(result.decisionPath.currency).toBe('pass');
  });

  // ── Gate 2: Merchant Allowlist ────────────────────────────────────────────
  it('merchant not in allowlist → blocked / allowlist_miss', () => {
    const result = evaluatePolicy(makeInput({
      request: makeRequest({ merchant: { id: null, descriptor: 'UNKNOWN VENDOR' } }),
    }));
    expect(result.outcome).toBe('blocked');
    expect(result.failureReason).toBe('allowlist_miss');
    expect(result.decisionPath.allowlist).toBe('fail');
  });

  it('empty allowlist → blocked / allowlist_miss', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ merchantAllowlist: [] }),
    }));
    expect(result.outcome).toBe('blocked');
    expect(result.failureReason).toBe('allowlist_miss');
  });

  it('merchant matched by stripe_id', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({
        merchantAllowlist: [{ id: 'acct_stripe123', descriptor: 'STRIPE', source: 'stripe_id' }],
      }),
      request: makeRequest({ merchant: { id: 'acct_stripe123', descriptor: 'STRIPE' } }),
    }));
    expect(result.outcome).not.toBe('blocked');
    expect(result.decisionPath.allowlist).toBe('pass');
  });

  it('allowlist match normalises incoming descriptor before comparing', () => {
    // Allowlist has 'STRIPE' (already normalised). Incoming has 'Stripe, Inc.' (unnormalised).
    // The evaluatePolicy path normalises the incoming descriptor via matchMerchantAllowlist.
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({
        merchantAllowlist: [{ id: null, descriptor: 'STRIPE INC', source: 'descriptor' }],
      }),
      request: makeRequest({ merchant: { id: null, descriptor: 'Stripe, Inc.' } }),
    }));
    expect(result.decisionPath.allowlist).toBe('pass');
  });

  // ── Gate 3: Per-transaction limit ─────────────────────────────────────────
  it('per-txn cap exceeded → blocked / per_txn_limit_exceeded', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ perTxnLimitMinor: 500 }),
      request: makeRequest({ amountMinor: 501 }),
    }));
    expect(result.outcome).toBe('blocked');
    expect(result.failureReason).toBe('per_txn_limit_exceeded');
    expect(result.decisionPath.perTxnLimit).toBe('fail');
  });

  it('per-txn cap exactly met → passes', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ perTxnLimitMinor: 500 }),
      request: makeRequest({ amountMinor: 500 }),
    }));
    expect(result.decisionPath.perTxnLimit).toBe('pass');
    expect(result.outcome).not.toBe('blocked');
  });

  it('per-txn limit = 0 → unset (no cap)', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ perTxnLimitMinor: 0 }),
      request: makeRequest({ amountMinor: 1_000_000 }),
    }));
    expect(result.decisionPath.perTxnLimit).toBe('unset');
  });

  // ── Gate 3: Daily limit ───────────────────────────────────────────────────
  it('daily cap exceeded → blocked / daily_limit_exceeded', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ dailyLimitMinor: 10_000 }),
      request: makeRequest({ amountMinor: 1 }),
      settledNet: { dailyMinor: 9_999, monthlyMinor: 0 },
      reservedCapacity: { dailyMinor: 1, monthlyMinor: 0 },
    }));
    // settled(9999) + reserved(1) + request(1) = 10001 > 10000
    expect(result.outcome).toBe('blocked');
    expect(result.failureReason).toBe('daily_limit_exceeded');
    expect(result.decisionPath.dailyLimit).toBe('fail');
  });

  it('daily cap exactly met → passes', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ dailyLimitMinor: 10_000 }),
      request: makeRequest({ amountMinor: 5_000 }),
      settledNet: { dailyMinor: 5_000, monthlyMinor: 0 },
      reservedCapacity: { dailyMinor: 0, monthlyMinor: 0 },
    }));
    expect(result.decisionPath.dailyLimit).toBe('pass');
  });

  it('daily limit = 0 → unset (no cap)', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ dailyLimitMinor: 0 }),
      request: makeRequest({ amountMinor: 999_999 }),
    }));
    expect(result.decisionPath.dailyLimit).toBe('unset');
  });

  // ── Gate 3: Monthly limit ─────────────────────────────────────────────────
  it('monthly cap exceeded → blocked / monthly_limit_exceeded', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ monthlyLimitMinor: 50_000 }),
      request: makeRequest({ amountMinor: 100 }),
      settledNet: { dailyMinor: 0, monthlyMinor: 49_950 },
      reservedCapacity: { dailyMinor: 0, monthlyMinor: 100 },
    }));
    // settled(49950) + reserved(100) + request(100) = 50150 > 50000
    expect(result.outcome).toBe('blocked');
    expect(result.failureReason).toBe('monthly_limit_exceeded');
    expect(result.decisionPath.monthlyLimit).toBe('fail');
  });

  it('monthly limit = 0 → unset (no cap)', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ monthlyLimitMinor: 0 }),
      request: makeRequest({ amountMinor: 999_999 }),
    }));
    expect(result.decisionPath.monthlyLimit).toBe('unset');
  });

  // ── Gate 4: Approval threshold ────────────────────────────────────────────
  it('amount > threshold → pending_approval', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ approvalThresholdMinor: 1_000 }),
      request: makeRequest({ amountMinor: 1_001 }),
    }));
    expect(result.outcome).toBe('pending_approval');
    expect(result.failureReason).toBeNull();
    expect(result.decisionPath.threshold).toBe('review');
    expect(result.reservedMinor).toBe(1_001);
  });

  it('amount = threshold → approved (not over threshold)', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ approvalThresholdMinor: 1_000 }),
      request: makeRequest({ amountMinor: 1_000 }),
    }));
    expect(result.outcome).toBe('approved');
    expect(result.decisionPath.threshold).toBe('auto');
  });

  it('threshold = 0 → every positive charge routes to HITL', () => {
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ approvalThresholdMinor: 0 }),
      request: makeRequest({ amountMinor: 1 }),
    }));
    expect(result.outcome).toBe('pending_approval');
    expect(result.decisionPath.threshold).toBe('review');
  });

  // ── Reserved capacity counts against limits (§16.2) ──────────────────────
  it('§16.2: charge fits against settled-only but fails when reservedCapacity is added', () => {
    // settled = 4000, limit = 5000, request = 1500 → fits without reserved: 4000+1500=5500 > 5000 nope
    // Let me use: settled=3000, reserved=1500, limit=5000, request=1501 → 3000+1500+1501=6001 > 5000
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ dailyLimitMinor: 5_000 }),
      request: makeRequest({ amountMinor: 1_501 }),
      settledNet: { dailyMinor: 3_000, monthlyMinor: 0 },
      reservedCapacity: { dailyMinor: 1_500, monthlyMinor: 0 },
    }));
    expect(result.outcome).toBe('blocked');
    expect(result.failureReason).toBe('daily_limit_exceeded');
  });

  it('§16.2: same charge fits when reservedCapacity is zero', () => {
    // Without reserved: settled(3000) + request(1501) = 4501 ≤ 5000 → passes
    const result = evaluatePolicy(makeInput({
      policy: makePolicy({ dailyLimitMinor: 5_000 }),
      request: makeRequest({ amountMinor: 1_501 }),
      settledNet: { dailyMinor: 3_000, monthlyMinor: 0 },
      reservedCapacity: { dailyMinor: 0, monthlyMinor: 0 },
    }));
    expect(result.outcome).not.toBe('blocked');
  });

  // ── Programming error guards ──────────────────────────────────────────────
  it('amountMinor ≤ 0 throws (programming error)', () => {
    expect(() =>
      evaluatePolicy(makeInput({ request: makeRequest({ amountMinor: 0 }) }))
    ).toThrow();
  });

  it('amountMinor negative throws (programming error)', () => {
    expect(() =>
      evaluatePolicy(makeInput({ request: makeRequest({ amountMinor: -1 }) }))
    ).toThrow();
  });

  it('unknown currency throws (programming error)', () => {
    expect(() =>
      evaluatePolicy(makeInput({ request: makeRequest({ currency: 'XYZ' }) }))
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// previewSpendForPlan — 4-step plan with mixed verdicts
// ---------------------------------------------------------------------------

describe('previewSpendForPlan', () => {
  it('4-step plan with mixed verdicts', () => {
    const policy = makePolicy({
      perTxnLimitMinor: 10_000,
      dailyLimitMinor: 20_000,
      approvalThresholdMinor: 5_000,
      merchantAllowlist: [
        { id: null, descriptor: 'STRIPE', source: 'descriptor' },
        { id: null, descriptor: 'OPENAI', source: 'descriptor' },
      ],
    });

    const plan: ParsedPlan = {
      steps: [
        // Step 0: $20 (2000 minor) — under threshold, on allowlist → would_auto
        { amountMinor: 2_000, currency: 'USD', merchant: { id: null, descriptor: 'STRIPE' }, intent: 'buy_a' },
        // Step 1: $80 (8000 minor) — over threshold, on allowlist → would_review
        { amountMinor: 8_000, currency: 'USD', merchant: { id: null, descriptor: 'STRIPE' }, intent: 'buy_b' },
        // Step 2: merchant NOT in allowlist → would_block
        { amountMinor: 1_000, currency: 'USD', merchant: { id: null, descriptor: 'UNKNOWN' }, intent: 'buy_c' },
        // Step 3: $15000 — exceeds per-txn limit (10000) → would_block
        { amountMinor: 15_000, currency: 'USD', merchant: { id: null, descriptor: 'OPENAI' }, intent: 'buy_d' },
      ],
    };

    const previews = previewSpendForPlan(plan, policy);
    expect(previews).toHaveLength(4);
    expect(previews[0]).toEqual({ stepIndex: 0, verdict: 'would_auto' });
    expect(previews[1]).toEqual({ stepIndex: 1, verdict: 'would_review' });
    expect(previews[2]).toEqual({ stepIndex: 2, verdict: 'would_block' });
    expect(previews[3]).toEqual({ stepIndex: 3, verdict: 'would_block' });
  });

  it('over_budget verdict fires when accumulated spend exceeds daily limit', () => {
    const policy = makePolicy({
      dailyLimitMinor: 10_000,
      approvalThresholdMinor: 50_000, // high threshold so auto applies
      merchantAllowlist: [{ id: null, descriptor: 'STRIPE', source: 'descriptor' }],
    });

    const plan: ParsedPlan = {
      steps: [
        { amountMinor: 6_000, currency: 'USD', merchant: { id: null, descriptor: 'STRIPE' }, intent: 'a' },
        { amountMinor: 5_000, currency: 'USD', merchant: { id: null, descriptor: 'STRIPE' }, intent: 'b' },
      ],
    };

    const previews = previewSpendForPlan(plan, policy);
    expect(previews[0].verdict).toBe('would_auto');
    expect(previews[1].verdict).toBe('over_budget');
  });

  it('empty plan returns empty array', () => {
    const result = previewSpendForPlan({ steps: [] }, makePolicy());
    expect(result).toHaveLength(0);
  });
});
