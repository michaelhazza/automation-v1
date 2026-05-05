/**
 * deliveryServicePure.test.ts — pure delivery logic tests
 *
 * Tests the retry ladder, channel dispatch decisions, and always-inbox
 * invariant from deliveryServicePure.ts.
 *
 * Spec: docs/memory-and-briefings-spec.md §10.5 (S22)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/deliveryServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  DELIVERY_RETRY_CONFIG,
  getMaxAttempts,
  getMaxRetries,
  computeBackoffDelay,
  canAttempt,
  shouldDispatchChannel,
  resolveDeliveryEligibility,
  type DeliveryChannel,
} from '../deliveryServicePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// DELIVERY_RETRY_CONFIG — retry ladder per spec §10.5
// ---------------------------------------------------------------------------

console.log('');
console.log('deliveryServicePure — retry ladder (§10.5 S22)');
console.log('');

console.log('DELIVERY_RETRY_CONFIG invariants:');

test('email: maxAttempts=4 (3 retries per spec)', () => {
  expect(DELIVERY_RETRY_CONFIG.email.maxAttempts, 'email maxAttempts').toBe(4);
});

test('slack: maxAttempts=3 (2 retries per spec)', () => {
  expect(DELIVERY_RETRY_CONFIG.slack.maxAttempts, 'slack maxAttempts').toBe(3);
});

test('portal: maxAttempts=1 (0 retries — attribute-based)', () => {
  expect(DELIVERY_RETRY_CONFIG.portal.maxAttempts, 'portal maxAttempts').toBe(1);
});

test('email: baseDelayMs=1000', () => {
  expect(DELIVERY_RETRY_CONFIG.email.baseDelayMs, 'email baseDelayMs').toBe(1000);
});

test('slack: baseDelayMs=1000', () => {
  expect(DELIVERY_RETRY_CONFIG.slack.baseDelayMs, 'slack baseDelayMs').toBe(1000);
});

test('portal: baseDelayMs=0 (no delay — no retries)', () => {
  expect(DELIVERY_RETRY_CONFIG.portal.baseDelayMs, 'portal baseDelayMs').toBe(0);
});

// ---------------------------------------------------------------------------
// getMaxAttempts / getMaxRetries
// ---------------------------------------------------------------------------

console.log('getMaxAttempts / getMaxRetries:');

test('email: getMaxAttempts=4', () => {
  expect(getMaxAttempts('email'), 'email maxAttempts').toBe(4);
});

test('slack: getMaxAttempts=3', () => {
  expect(getMaxAttempts('slack'), 'slack maxAttempts').toBe(3);
});

test('portal: getMaxAttempts=1', () => {
  expect(getMaxAttempts('portal'), 'portal maxAttempts').toBe(1);
});

test('email: getMaxRetries=3', () => {
  expect(getMaxRetries('email'), 'email max retries').toBe(3);
});

test('slack: getMaxRetries=2', () => {
  expect(getMaxRetries('slack'), 'slack max retries').toBe(2);
});

test('portal: getMaxRetries=0', () => {
  expect(getMaxRetries('portal'), 'portal max retries').toBe(0);
});

// ---------------------------------------------------------------------------
// computeBackoffDelay — exponential backoff
// ---------------------------------------------------------------------------

console.log('computeBackoffDelay:');

test('attempt=1 returns 0 (first attempt, no delay)', () => {
  expect(computeBackoffDelay(1000, 1), 'no delay on attempt 1').toBe(0);
});

test('attempt=2 returns baseDelayMs×1 (1000ms)', () => {
  expect(computeBackoffDelay(1000, 2), 'attempt 2 = 1000ms').toBe(1000);
});

test('attempt=3 returns baseDelayMs×2 (2000ms)', () => {
  expect(computeBackoffDelay(1000, 3), 'attempt 3 = 2000ms').toBe(2000);
});

test('attempt=4 returns baseDelayMs×4 (4000ms)', () => {
  expect(computeBackoffDelay(1000, 4), 'attempt 4 = 4000ms').toBe(4000);
});

test('baseDelayMs=0 always returns 0 (portal pattern)', () => {
  expect(computeBackoffDelay(0, 2), 'zero baseDelay → zero delay').toBe(0);
  expect(computeBackoffDelay(0, 4), 'zero baseDelay → zero delay at attempt 4').toBe(0);
});

test('attempt=1 with any baseDelay returns 0', () => {
  expect(computeBackoffDelay(500, 1), 'attempt 1 → no delay').toBe(0);
  expect(computeBackoffDelay(2000, 1), 'attempt 1 → no delay (2000ms base)').toBe(0);
});

// ---------------------------------------------------------------------------
// canAttempt — boundary conditions
// ---------------------------------------------------------------------------

console.log('canAttempt (email — 4 max attempts):');

test('email: canAttempt(1) → true', () => {
  expect(canAttempt('email', 1), 'first attempt allowed').toBe(true);
});

test('email: canAttempt(4) → true (last attempt)', () => {
  expect(canAttempt('email', 4), 'last attempt allowed').toBe(true);
});

test('email: canAttempt(5) → false (exhausted)', () => {
  expect(canAttempt('email', 5), 'beyond max → denied').toBe(false);
});

console.log('canAttempt (slack — 3 max attempts):');

test('slack: canAttempt(1) → true', () => {
  expect(canAttempt('slack', 1), 'first attempt allowed').toBe(true);
});

test('slack: canAttempt(3) → true (last attempt)', () => {
  expect(canAttempt('slack', 3), 'last attempt allowed').toBe(true);
});

test('slack: canAttempt(4) → false (exhausted)', () => {
  expect(canAttempt('slack', 4), 'beyond max → denied').toBe(false);
});

console.log('canAttempt (portal — 1 max attempt):');

test('portal: canAttempt(1) → true (only one attempt)', () => {
  expect(canAttempt('portal', 1), 'single attempt allowed').toBe(true);
});

test('portal: canAttempt(2) → false (no retries)', () => {
  expect(canAttempt('portal', 2), 'portal has no retries').toBe(false);
});

// ---------------------------------------------------------------------------
// shouldDispatchChannel — always-inbox invariant + per-channel dispatch
// ---------------------------------------------------------------------------

console.log('shouldDispatchChannel:');

const allFalseConfig = { email: false, portal: false, slack: false };
const allTrueConfig = { email: true, portal: true, slack: true };

// Always-inbox invariant (§10.5): email dispatch is unconditional
test('email: shouldDispatch=true when config.email=false (always-on inbox invariant)', () => {
  expect(shouldDispatchChannel('email', allFalseConfig), 'inbox must always be dispatched regardless of config').toBe(true);
});

test('email: shouldDispatch=true when config.email=true', () => {
  expect(shouldDispatchChannel('email', allTrueConfig), 'email true → dispatch').toBe(true);
});

test('portal: shouldDispatch=false when config.portal=false', () => {
  expect(shouldDispatchChannel('portal', allFalseConfig), 'portal false → skip').toBe(false);
});

test('portal: shouldDispatch=true when config.portal=true', () => {
  expect(shouldDispatchChannel('portal', allTrueConfig), 'portal true → dispatch').toBe(true);
});

test('slack: shouldDispatch=false when config.slack=false', () => {
  expect(shouldDispatchChannel('slack', allFalseConfig), 'slack false → skip').toBe(false);
});

test('slack: shouldDispatch=true when config.slack=true', () => {
  expect(shouldDispatchChannel('slack', allTrueConfig), 'slack true → dispatch').toBe(true);
});

// Mixed configs
test('only slack enabled: email still dispatched', () => {
  const config = { email: false, portal: false, slack: true };
  expect(shouldDispatchChannel('email', config), 'email always dispatched').toBe(true);
  expect(shouldDispatchChannel('portal', config), 'portal not dispatched').toBe(false);
  expect(shouldDispatchChannel('slack', config), 'slack dispatched').toBe(true);
});

test('all disabled: only email dispatched (inbox invariant holds)', () => {
  expect(shouldDispatchChannel('email', allFalseConfig), 'email: always-on').toBe(true);
  expect(shouldDispatchChannel('portal', allFalseConfig), 'portal: skipped').toBe(false);
  expect(shouldDispatchChannel('slack', allFalseConfig), 'slack: skipped').toBe(false);
});

// ---------------------------------------------------------------------------
// Retry ladder consistency check
// ---------------------------------------------------------------------------

console.log('retry ladder consistency:');

const CHANNELS: DeliveryChannel[] = ['email', 'portal', 'slack'];

test('all channels have positive maxAttempts', () => {
  for (const ch of CHANNELS) {
    const max = getMaxAttempts(ch);
    if (max < 1) {
      throw new Error(`${ch}: maxAttempts must be >= 1, got ${max}`);
    }
  }
});

test('getMaxRetries = getMaxAttempts - 1 for all channels', () => {
  for (const ch of CHANNELS) {
    const retries = getMaxRetries(ch);
    const attempts = getMaxAttempts(ch);
    if (retries !== attempts - 1) {
      throw new Error(`${ch}: maxRetries (${retries}) ≠ maxAttempts (${attempts}) - 1`);
    }
  }
});

test('spec §10.5: email has most retries, portal has fewest', () => {
  expect(getMaxRetries('email') > getMaxRetries('slack'), 'email retries > slack retries per spec').toBe(true);
  expect(getMaxRetries('slack') > getMaxRetries('portal'), 'slack retries > portal retries per spec').toBe(true);
  expect(getMaxRetries('portal'), 'portal has 0 retries').toBe(0);
});

// ---------------------------------------------------------------------------
// resolveDeliveryEligibility — single source of truth for final channel set
// ---------------------------------------------------------------------------

console.log('resolveDeliveryEligibility:');

test('email is always eligible regardless of availability or config', () => {
  const result = resolveDeliveryEligibility(
    { email: false, portal: false, slack: false },
    { email: false, portal: false, slack: false },
  );
  expect(result.email, 'email must be true even when available=false and config=false').toBe(true);
});

test('portal requires both available and config enabled — all three cases', () => {
  // available + config on → true
  const bothOn = resolveDeliveryEligibility(
    { email: true, portal: true,  slack: false },
    { email: true, portal: true,  slack: false },
  );
  expect(bothOn.portal, 'portal: available=true + config=true → true').toBe(true);

  // not available → false even if config on
  const notAvail = resolveDeliveryEligibility(
    { email: true, portal: false, slack: false },
    { email: true, portal: true,  slack: false },
  );
  expect(notAvail.portal, 'portal: available=false + config=true → false').toBe(false);

  // available but config off → false
  const configOff = resolveDeliveryEligibility(
    { email: true, portal: true,  slack: false },
    { email: true, portal: false, slack: false },
  );
  expect(configOff.portal, 'portal: available=true + config=false → false').toBe(false);
});

test('slack requires both available and config enabled — available+config→true', () => {
  const result = resolveDeliveryEligibility(
    { email: true, portal: false, slack: true },
    { email: true, portal: false, slack: true },
  );
  expect(result.slack, 'slack: available=true + config=true → true').toBe(true);
});

test('slack requires both available and config enabled — not available→false', () => {
  const result = resolveDeliveryEligibility(
    { email: true, portal: false, slack: false },
    { email: true, portal: false, slack: true },
  );
  expect(result.slack, 'slack: available=false + config=true → false').toBe(false);
});

test('slack requires both available and config enabled — config off→false', () => {
  const result = resolveDeliveryEligibility(
    { email: true, portal: false, slack: true },
    { email: true, portal: false, slack: false },
  );
  expect(result.slack, 'slack: available=true + config=false → false').toBe(false);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log('');
