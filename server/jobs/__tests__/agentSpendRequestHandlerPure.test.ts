// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness"
/**
 * agentSpendRequestHandlerPure.test.ts
 *
 * Pure-function tests for agentSpendRequestHandler.
 * Tests payload validation, idempotency-key recompute, and drift rejection.
 * No database or pg-boss required.
 *
 * Run via: npx vitest run server/jobs/__tests__/agentSpendRequestHandlerPure.test.ts
 */

import { expect, test, describe } from 'vitest';
import {
  checkIdempotencyKeyDrift,
  computeSptExpiresAt,
} from '../agentSpendRequestHandler.js';
import {
  buildChargeIdempotencyKey,
  normaliseMerchantDescriptor,
} from '../../services/chargeRouterServicePure.js';
import { SPT_WORKER_HANDOFF_MARGIN_MS } from '../../config/spendConstants.js';
import type { SpendRequestPayload } from '../../../shared/iee/actionSchema.js';

export {};

console.log('\nagentSpendRequestHandlerPure — pure-function tests\n');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayload(overrides: Partial<SpendRequestPayload> = {}): SpendRequestPayload {
  const args: Record<string, unknown> = {
    merchant: {
      id: null,
      descriptor: 'ACME CORP',
    },
    productName: 'Cloud Storage Plan',
  };

  return {
    ieeRunId: '11111111-1111-1111-1111-111111111111',
    skillRunId: '22222222-2222-2222-2222-222222222222',
    organisationId: '33333333-3333-3333-3333-333333333333',
    subaccountId: '44444444-4444-4444-4444-444444444444',
    agentId: '55555555-5555-5555-5555-555555555555',
    toolCallId: '66666666-6666-6666-6666-666666666666',
    intent: 'purchase_cloud_storage',
    amountMinor: 1000,
    currency: 'USD',
    merchant: { id: null, descriptor: 'ACME CORP' },
    chargeType: 'purchase',
    args,
    idempotencyKey: buildChargeIdempotencyKey({
      skillRunId: '22222222-2222-2222-2222-222222222222',
      toolCallId: '66666666-6666-6666-6666-666666666666',
      intent: 'purchase_cloud_storage',
      args,
      mode: 'live',
    }),
    correlationId: '77777777-7777-7777-7777-777777777777',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkIdempotencyKeyDrift — matching keys
// ---------------------------------------------------------------------------

describe('checkIdempotencyKeyDrift', () => {
  test('returns drifted=false when key matches for live mode', () => {
    const args: Record<string, unknown> = {
      merchant: { id: null, descriptor: 'ACME CORP' },
    };
    const key = buildChargeIdempotencyKey({
      skillRunId: 'sk1',
      toolCallId: 'tc1',
      intent: 'buy_thing',
      args,
      mode: 'live',
    });
    const payload = makePayload({ skillRunId: 'sk1', toolCallId: 'tc1', intent: 'buy_thing', args, idempotencyKey: key });
    const result = checkIdempotencyKeyDrift(payload, 'live');
    expect(result.drifted).toBe(false);
  });

  test('returns drifted=false when key matches for shadow mode', () => {
    const args: Record<string, unknown> = {
      merchant: { id: null, descriptor: 'ACME CORP' },
    };
    const key = buildChargeIdempotencyKey({
      skillRunId: 'sk1',
      toolCallId: 'tc1',
      intent: 'buy_thing',
      args,
      mode: 'shadow',
    });
    const payload = makePayload({ skillRunId: 'sk1', toolCallId: 'tc1', intent: 'buy_thing', args, idempotencyKey: key });
    const result = checkIdempotencyKeyDrift(payload, 'shadow');
    expect(result.drifted).toBe(false);
  });

  test('returns drifted=true when key was built with different args', () => {
    const args: Record<string, unknown> = { merchant: { id: null, descriptor: 'ACME' } };
    const differentArgs: Record<string, unknown> = { merchant: { id: null, descriptor: 'DIFFERENT' } };
    const key = buildChargeIdempotencyKey({
      skillRunId: 'sk1',
      toolCallId: 'tc1',
      intent: 'buy_thing',
      args: differentArgs,
      mode: 'live',
    });
    const payload = makePayload({ skillRunId: 'sk1', toolCallId: 'tc1', intent: 'buy_thing', args, idempotencyKey: key });
    const result = checkIdempotencyKeyDrift(payload, 'live');
    expect(result.drifted).toBe(true);
  });

  test('returns drifted=true when key was built with different mode', () => {
    const args: Record<string, unknown> = { merchant: { id: null, descriptor: 'ACME CORP' } };
    const shadowKey = buildChargeIdempotencyKey({
      skillRunId: 'sk1',
      toolCallId: 'tc1',
      intent: 'buy_thing',
      args,
      mode: 'shadow',
    });
    // Supply shadow key but check with live mode
    const payload = makePayload({ skillRunId: 'sk1', toolCallId: 'tc1', intent: 'buy_thing', args, idempotencyKey: shadowKey });
    const result = checkIdempotencyKeyDrift(payload, 'live');
    expect(result.drifted).toBe(true);
  });

  test('returns drifted=true when key was built with different skillRunId', () => {
    const args: Record<string, unknown> = { merchant: { id: null, descriptor: 'ACME CORP' } };
    const key = buildChargeIdempotencyKey({
      skillRunId: 'different-skill-run',
      toolCallId: 'tc1',
      intent: 'buy_thing',
      args,
      mode: 'live',
    });
    const payload = makePayload({ skillRunId: 'sk1', toolCallId: 'tc1', intent: 'buy_thing', args, idempotencyKey: key });
    const result = checkIdempotencyKeyDrift(payload, 'live');
    expect(result.drifted).toBe(true);
  });

  test('returns drifted=true when key was built with different toolCallId', () => {
    const args: Record<string, unknown> = { merchant: { id: null, descriptor: 'ACME CORP' } };
    const key = buildChargeIdempotencyKey({
      skillRunId: 'sk1',
      toolCallId: 'different-tool-call',
      intent: 'buy_thing',
      args,
      mode: 'live',
    });
    const payload = makePayload({ skillRunId: 'sk1', toolCallId: 'tc1', intent: 'buy_thing', args, idempotencyKey: key });
    const result = checkIdempotencyKeyDrift(payload, 'live');
    expect(result.drifted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normaliseMerchantDescriptor — descriptor normalisation (invariant 21)
// ---------------------------------------------------------------------------

describe('normaliseMerchantDescriptor idempotency', () => {
  test('normalised descriptor produces same key as already-normalised input', () => {
    const rawDescriptor = '  acme corp.  ';
    const normalised = normaliseMerchantDescriptor(rawDescriptor);
    const args = { merchant: { id: null, descriptor: normalised } };

    const key1 = buildChargeIdempotencyKey({
      skillRunId: 'sk1', toolCallId: 'tc1', intent: 'buy', args, mode: 'live',
    });
    const key2 = buildChargeIdempotencyKey({
      skillRunId: 'sk1', toolCallId: 'tc1', intent: 'buy',
      args: { merchant: { id: null, descriptor: normaliseMerchantDescriptor(normalised) } },
      mode: 'live',
    });
    // Double-normalising should produce the same key
    expect(key1).toBe(key2);
  });

  test('case drift in descriptor produces different raw but same normalised key', () => {
    const upper = 'ACME CORP';
    const lower = 'acme corp';
    const normUpper = normaliseMerchantDescriptor(upper);
    const normLower = normaliseMerchantDescriptor(lower);
    expect(normUpper).toBe(normLower);
  });
});

// ---------------------------------------------------------------------------
// computeSptExpiresAt
// ---------------------------------------------------------------------------

describe('computeSptExpiresAt', () => {
  test('returns null when tokenExpiresAt is null', () => {
    expect(computeSptExpiresAt(null)).toBeNull();
  });

  test('returns ISO string with SPT_WORKER_HANDOFF_MARGIN_MS subtracted', () => {
    const expiryDate = new Date('2026-06-01T12:00:00.000Z');
    const result = computeSptExpiresAt(expiryDate);
    expect(result).not.toBeNull();
    const parsed = new Date(result!).getTime();
    expect(parsed).toBe(expiryDate.getTime() - SPT_WORKER_HANDOFF_MARGIN_MS);
  });

  test('result is a valid ISO 8601 string', () => {
    const expiryDate = new Date('2026-06-01T12:00:00.000Z');
    const result = computeSptExpiresAt(expiryDate);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('margin is 60 seconds by default', () => {
    expect(SPT_WORKER_HANDOFF_MARGIN_MS).toBe(60_000);
    const expiryDate = new Date('2026-06-01T12:01:00.000Z');
    const result = computeSptExpiresAt(expiryDate);
    expect(result).toBe('2026-06-01T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Idempotency key format contract (spec §9.1)
// ---------------------------------------------------------------------------

describe('idempotency key format', () => {
  test('key starts with charge key version prefix', () => {
    const args = { merchant: { id: null, descriptor: 'ACME CORP' } };
    const key = buildChargeIdempotencyKey({
      skillRunId: 'sk1', toolCallId: 'tc1', intent: 'buy', args, mode: 'live',
    });
    expect(key).toMatch(/^v\d+:/);
  });

  test('live and shadow keys differ for same inputs', () => {
    const args = { merchant: { id: null, descriptor: 'ACME CORP' } };
    const liveKey = buildChargeIdempotencyKey({
      skillRunId: 'sk1', toolCallId: 'tc1', intent: 'buy', args, mode: 'live',
    });
    const shadowKey = buildChargeIdempotencyKey({
      skillRunId: 'sk1', toolCallId: 'tc1', intent: 'buy', args, mode: 'shadow',
    });
    expect(liveKey).not.toBe(shadowKey);
  });

  test('key encodes intent with charge mode prefix', () => {
    const args = { merchant: { id: null, descriptor: 'ACME CORP' } };
    const liveKey = buildChargeIdempotencyKey({
      skillRunId: 'sk1', toolCallId: 'tc1', intent: 'buy', args, mode: 'live',
    });
    expect(liveKey).toContain('charge:live:buy');
  });
});
