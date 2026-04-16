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

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(`${label} — expected true, got false`);
}

function assertFalse(cond: boolean, label: string) {
  if (cond) throw new Error(`${label} — expected false, got true`);
}

// ---------------------------------------------------------------------------
// DELIVERY_RETRY_CONFIG — retry ladder per spec §10.5
// ---------------------------------------------------------------------------

console.log('');
console.log('deliveryServicePure — retry ladder (§10.5 S22)');
console.log('');

console.log('DELIVERY_RETRY_CONFIG invariants:');

test('email: maxAttempts=4 (3 retries per spec)', () => {
  assertEqual(DELIVERY_RETRY_CONFIG.email.maxAttempts, 4, 'email maxAttempts');
});

test('slack: maxAttempts=3 (2 retries per spec)', () => {
  assertEqual(DELIVERY_RETRY_CONFIG.slack.maxAttempts, 3, 'slack maxAttempts');
});

test('portal: maxAttempts=1 (0 retries — attribute-based)', () => {
  assertEqual(DELIVERY_RETRY_CONFIG.portal.maxAttempts, 1, 'portal maxAttempts');
});

test('email: baseDelayMs=1000', () => {
  assertEqual(DELIVERY_RETRY_CONFIG.email.baseDelayMs, 1000, 'email baseDelayMs');
});

test('slack: baseDelayMs=1000', () => {
  assertEqual(DELIVERY_RETRY_CONFIG.slack.baseDelayMs, 1000, 'slack baseDelayMs');
});

test('portal: baseDelayMs=0 (no delay — no retries)', () => {
  assertEqual(DELIVERY_RETRY_CONFIG.portal.baseDelayMs, 0, 'portal baseDelayMs');
});

// ---------------------------------------------------------------------------
// getMaxAttempts / getMaxRetries
// ---------------------------------------------------------------------------

console.log('getMaxAttempts / getMaxRetries:');

test('email: getMaxAttempts=4', () => {
  assertEqual(getMaxAttempts('email'), 4, 'email maxAttempts');
});

test('slack: getMaxAttempts=3', () => {
  assertEqual(getMaxAttempts('slack'), 3, 'slack maxAttempts');
});

test('portal: getMaxAttempts=1', () => {
  assertEqual(getMaxAttempts('portal'), 1, 'portal maxAttempts');
});

test('email: getMaxRetries=3', () => {
  assertEqual(getMaxRetries('email'), 3, 'email max retries');
});

test('slack: getMaxRetries=2', () => {
  assertEqual(getMaxRetries('slack'), 2, 'slack max retries');
});

test('portal: getMaxRetries=0', () => {
  assertEqual(getMaxRetries('portal'), 0, 'portal max retries');
});

// ---------------------------------------------------------------------------
// computeBackoffDelay — exponential backoff
// ---------------------------------------------------------------------------

console.log('computeBackoffDelay:');

test('attempt=1 returns 0 (first attempt, no delay)', () => {
  assertEqual(computeBackoffDelay(1000, 1), 0, 'no delay on attempt 1');
});

test('attempt=2 returns baseDelayMs×1 (1000ms)', () => {
  assertEqual(computeBackoffDelay(1000, 2), 1000, 'attempt 2 = 1000ms');
});

test('attempt=3 returns baseDelayMs×2 (2000ms)', () => {
  assertEqual(computeBackoffDelay(1000, 3), 2000, 'attempt 3 = 2000ms');
});

test('attempt=4 returns baseDelayMs×4 (4000ms)', () => {
  assertEqual(computeBackoffDelay(1000, 4), 4000, 'attempt 4 = 4000ms');
});

test('baseDelayMs=0 always returns 0 (portal pattern)', () => {
  assertEqual(computeBackoffDelay(0, 2), 0, 'zero baseDelay → zero delay');
  assertEqual(computeBackoffDelay(0, 4), 0, 'zero baseDelay → zero delay at attempt 4');
});

test('attempt=1 with any baseDelay returns 0', () => {
  assertEqual(computeBackoffDelay(500, 1), 0, 'attempt 1 → no delay');
  assertEqual(computeBackoffDelay(2000, 1), 0, 'attempt 1 → no delay (2000ms base)');
});

// ---------------------------------------------------------------------------
// canAttempt — boundary conditions
// ---------------------------------------------------------------------------

console.log('canAttempt (email — 4 max attempts):');

test('email: canAttempt(1) → true', () => {
  assertTrue(canAttempt('email', 1), 'first attempt allowed');
});

test('email: canAttempt(4) → true (last attempt)', () => {
  assertTrue(canAttempt('email', 4), 'last attempt allowed');
});

test('email: canAttempt(5) → false (exhausted)', () => {
  assertFalse(canAttempt('email', 5), 'beyond max → denied');
});

console.log('canAttempt (slack — 3 max attempts):');

test('slack: canAttempt(1) → true', () => {
  assertTrue(canAttempt('slack', 1), 'first attempt allowed');
});

test('slack: canAttempt(3) → true (last attempt)', () => {
  assertTrue(canAttempt('slack', 3), 'last attempt allowed');
});

test('slack: canAttempt(4) → false (exhausted)', () => {
  assertFalse(canAttempt('slack', 4), 'beyond max → denied');
});

console.log('canAttempt (portal — 1 max attempt):');

test('portal: canAttempt(1) → true (only one attempt)', () => {
  assertTrue(canAttempt('portal', 1), 'single attempt allowed');
});

test('portal: canAttempt(2) → false (no retries)', () => {
  assertFalse(canAttempt('portal', 2), 'portal has no retries');
});

// ---------------------------------------------------------------------------
// shouldDispatchChannel — always-inbox invariant + per-channel dispatch
// ---------------------------------------------------------------------------

console.log('shouldDispatchChannel:');

const allFalseConfig = { email: false, portal: false, slack: false };
const allTrueConfig = { email: true, portal: true, slack: true };

// Always-inbox invariant (§10.5): email dispatch is unconditional
test('email: shouldDispatch=true when config.email=false (always-on inbox invariant)', () => {
  assertTrue(
    shouldDispatchChannel('email', allFalseConfig),
    'inbox must always be dispatched regardless of config',
  );
});

test('email: shouldDispatch=true when config.email=true', () => {
  assertTrue(shouldDispatchChannel('email', allTrueConfig), 'email true → dispatch');
});

test('portal: shouldDispatch=false when config.portal=false', () => {
  assertFalse(shouldDispatchChannel('portal', allFalseConfig), 'portal false → skip');
});

test('portal: shouldDispatch=true when config.portal=true', () => {
  assertTrue(shouldDispatchChannel('portal', allTrueConfig), 'portal true → dispatch');
});

test('slack: shouldDispatch=false when config.slack=false', () => {
  assertFalse(shouldDispatchChannel('slack', allFalseConfig), 'slack false → skip');
});

test('slack: shouldDispatch=true when config.slack=true', () => {
  assertTrue(shouldDispatchChannel('slack', allTrueConfig), 'slack true → dispatch');
});

// Mixed configs
test('only slack enabled: email still dispatched', () => {
  const config = { email: false, portal: false, slack: true };
  assertTrue(shouldDispatchChannel('email', config), 'email always dispatched');
  assertFalse(shouldDispatchChannel('portal', config), 'portal not dispatched');
  assertTrue(shouldDispatchChannel('slack', config), 'slack dispatched');
});

test('all disabled: only email dispatched (inbox invariant holds)', () => {
  assertTrue(shouldDispatchChannel('email', allFalseConfig), 'email: always-on');
  assertFalse(shouldDispatchChannel('portal', allFalseConfig), 'portal: skipped');
  assertFalse(shouldDispatchChannel('slack', allFalseConfig), 'slack: skipped');
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
  assertTrue(
    getMaxRetries('email') > getMaxRetries('slack'),
    'email retries > slack retries per spec',
  );
  assertTrue(
    getMaxRetries('slack') > getMaxRetries('portal'),
    'slack retries > portal retries per spec',
  );
  assertEqual(getMaxRetries('portal'), 0, 'portal has 0 retries');
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
  assertTrue(result.email, 'email must be true even when available=false and config=false');
});

test('portal requires both available and config enabled — all three cases', () => {
  // available + config on → true
  const bothOn = resolveDeliveryEligibility(
    { email: true, portal: true,  slack: false },
    { email: true, portal: true,  slack: false },
  );
  assertTrue(bothOn.portal, 'portal: available=true + config=true → true');

  // not available → false even if config on
  const notAvail = resolveDeliveryEligibility(
    { email: true, portal: false, slack: false },
    { email: true, portal: true,  slack: false },
  );
  assertFalse(notAvail.portal, 'portal: available=false + config=true → false');

  // available but config off → false
  const configOff = resolveDeliveryEligibility(
    { email: true, portal: true,  slack: false },
    { email: true, portal: false, slack: false },
  );
  assertFalse(configOff.portal, 'portal: available=true + config=false → false');
});

test('slack requires both available and config enabled — available+config→true', () => {
  const result = resolveDeliveryEligibility(
    { email: true, portal: false, slack: true },
    { email: true, portal: false, slack: true },
  );
  assertTrue(result.slack, 'slack: available=true + config=true → true');
});

test('slack requires both available and config enabled — not available→false', () => {
  const result = resolveDeliveryEligibility(
    { email: true, portal: false, slack: false },
    { email: true, portal: false, slack: true },
  );
  assertFalse(result.slack, 'slack: available=false + config=true → false');
});

test('slack requires both available and config enabled — config off→false', () => {
  const result = resolveDeliveryEligibility(
    { email: true, portal: false, slack: true },
    { email: true, portal: false, slack: false },
  );
  assertFalse(result.slack, 'slack: available=true + config=false → false');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
