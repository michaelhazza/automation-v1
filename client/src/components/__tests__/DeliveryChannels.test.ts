/**
 * DeliveryChannels.test.ts — pure logic tests for DeliveryChannels
 *
 * Tests channel-state computation for the delivery channel selector.
 * No React/jsdom — tests the pure module extracted from the component.
 *
 * Spec: docs/memory-and-briefings-spec.md §10.4 (S22)
 *
 * Runnable via:
 *   npx tsx client/src/components/__tests__/DeliveryChannels.test.ts
 */

import {
  computeChannelState,
  computeAllChannelStates,
  CHANNEL_META,
} from '../DeliveryChannelsPure.js';
import type { DeliveryChannelConfig, AvailableChannels } from '../DeliveryChannelsPure.js';

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

function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(`${label} — expected true, got false`);
}

function assertFalse(cond: boolean, label: string) {
  if (cond) throw new Error(`${label} — expected false, got true`);
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const allValue: DeliveryChannelConfig = { email: true, portal: true, slack: true };
const noneValue: DeliveryChannelConfig = { email: false, portal: false, slack: false };

const onlyEmail: AvailableChannels = { email: true, portal: false, slack: false };
const emailAndPortal: AvailableChannels = { email: true, portal: true, slack: false };
const allAvailable: AvailableChannels = { email: true, portal: true, slack: true };

// ---------------------------------------------------------------------------
// Always-on inbox invariant (email is always checked and always disabled)
// ---------------------------------------------------------------------------

console.log('');
console.log('DeliveryChannels — always-on inbox invariant (§10.4 S22)');
console.log('');

test('email isChecked=true regardless of value.email=false', () => {
  const state = computeChannelState('email', noneValue, allAvailable, false, true);
  assertTrue(state.isChecked, 'email must always be checked');
});

test('email isChecked=true regardless of value.email=true', () => {
  const state = computeChannelState('email', allValue, allAvailable, false, true);
  assertTrue(state.isChecked, 'email checked when value.email=true');
});

test('email isDisabled=true (alwaysOn=true)', () => {
  const state = computeChannelState('email', allValue, allAvailable, false, true);
  assertTrue(state.isDisabled, 'email must always be disabled (always-on badge)');
});

test('email isDisabled=true even when form disabled=false', () => {
  const state = computeChannelState('email', allValue, allAvailable, false, true);
  assertTrue(state.isDisabled, 'alwaysOn always disables the input');
});

// ---------------------------------------------------------------------------
// 1 integration connected (email only)
// ---------------------------------------------------------------------------

console.log('1 integration connected (email only):');

test('email: checked and disabled', () => {
  const state = computeChannelState('email', allValue, onlyEmail, false, true);
  assertTrue(state.isChecked, 'email checked');
  assertTrue(state.isDisabled, 'email disabled');
});

test('portal: not checked when unavailable', () => {
  const state = computeChannelState('portal', allValue, onlyEmail, false, false);
  assertFalse(state.isChecked, 'portal not checked when unavailable');
});

test('portal: disabled when unavailable', () => {
  const state = computeChannelState('portal', allValue, onlyEmail, false, false);
  assertTrue(state.isDisabled, 'portal disabled when not connected');
});

test('slack: not checked when unavailable', () => {
  const state = computeChannelState('slack', allValue, onlyEmail, false, false);
  assertFalse(state.isChecked, 'slack not checked when unavailable');
});

test('slack: disabled when unavailable', () => {
  const state = computeChannelState('slack', allValue, onlyEmail, false, false);
  assertTrue(state.isDisabled, 'slack disabled when not connected');
});

// ---------------------------------------------------------------------------
// 2 integrations (email + portal — portalMode >= transparency)
// ---------------------------------------------------------------------------

console.log('2 integrations (email + portal):');

test('email: checked and disabled', () => {
  const state = computeChannelState('email', allValue, emailAndPortal, false, true);
  assertTrue(state.isChecked, 'email checked');
  assertTrue(state.isDisabled, 'email disabled');
});

test('portal: checked when value=true and available', () => {
  const state = computeChannelState('portal', allValue, emailAndPortal, false, false);
  assertTrue(state.isChecked, 'portal checked when available and value=true');
  assertFalse(state.isDisabled, 'portal enabled when available');
});

test('portal: not checked when value=false even if available', () => {
  const state = computeChannelState('portal', noneValue, emailAndPortal, false, false);
  assertFalse(state.isChecked, 'portal unchecked when value=false');
});

test('slack: not checked (unavailable)', () => {
  const state = computeChannelState('slack', allValue, emailAndPortal, false, false);
  assertFalse(state.isChecked, 'slack not checked when unavailable');
  assertTrue(state.isDisabled, 'slack disabled when unavailable');
});

// ---------------------------------------------------------------------------
// All integrations connected
// ---------------------------------------------------------------------------

console.log('all integrations connected:');

test('email: always checked and disabled', () => {
  const state = computeChannelState('email', allValue, allAvailable, false, true);
  assertTrue(state.isChecked, 'email checked');
  assertTrue(state.isDisabled, 'email disabled');
});

test('portal: checked when value=true', () => {
  const state = computeChannelState('portal', allValue, allAvailable, false, false);
  assertTrue(state.isChecked, 'portal checked');
  assertFalse(state.isDisabled, 'portal enabled');
});

test('slack: checked when value=true', () => {
  const state = computeChannelState('slack', allValue, allAvailable, false, false);
  assertTrue(state.isChecked, 'slack checked');
  assertFalse(state.isDisabled, 'slack enabled');
});

test('portal: not checked when value=false', () => {
  const state = computeChannelState('portal', noneValue, allAvailable, false, false);
  assertFalse(state.isChecked, 'portal unchecked when value=false');
});

test('slack: not checked when value=false', () => {
  const state = computeChannelState('slack', noneValue, allAvailable, false, false);
  assertFalse(state.isChecked, 'slack unchecked when value=false');
});

// ---------------------------------------------------------------------------
// Form-level disabled propagates
// ---------------------------------------------------------------------------

console.log('form-level disabled:');

test('portal: disabled when form disabled=true even if available', () => {
  const state = computeChannelState('portal', allValue, allAvailable, true, false);
  assertTrue(state.isDisabled, 'portal disabled when form disabled');
});

test('slack: disabled when form disabled=true even if available', () => {
  const state = computeChannelState('slack', allValue, allAvailable, true, false);
  assertTrue(state.isDisabled, 'slack disabled when form disabled');
});

// ---------------------------------------------------------------------------
// computeAllChannelStates — batch helper
// ---------------------------------------------------------------------------

console.log('computeAllChannelStates:');

test('emailAndPortal: email always checked, portal checked, slack not', () => {
  const states = computeAllChannelStates(allValue, emailAndPortal, false);
  assertTrue(states.email.isChecked, 'email checked');
  assertTrue(states.email.isDisabled, 'email disabled (always-on)');
  assertTrue(states.portal.isChecked, 'portal checked');
  assertFalse(states.portal.isDisabled, 'portal enabled');
  assertFalse(states.slack.isChecked, 'slack not checked');
  assertTrue(states.slack.isDisabled, 'slack disabled (not connected)');
});

test('allAvailable + noneValue: only email checked', () => {
  const states = computeAllChannelStates(noneValue, allAvailable, false);
  assertTrue(states.email.isChecked, 'email always checked');
  assertFalse(states.portal.isChecked, 'portal not checked');
  assertFalse(states.slack.isChecked, 'slack not checked');
});

// ---------------------------------------------------------------------------
// CHANNEL_META invariants
// ---------------------------------------------------------------------------

console.log('CHANNEL_META invariants:');

test('exactly 3 channels defined', () => {
  if (CHANNEL_META.length !== 3) {
    throw new Error(`expected 3 channels, got ${CHANNEL_META.length}`);
  }
});

test('email is the only always-on channel', () => {
  const alwaysOn = CHANNEL_META.filter((m) => m.alwaysOn);
  if (alwaysOn.length !== 1 || alwaysOn[0].key !== 'email') {
    throw new Error(`expected only email as always-on, got ${JSON.stringify(alwaysOn.map(m => m.key))}`);
  }
});

test('portal and slack are not always-on', () => {
  const others = CHANNEL_META.filter((m) => m.key !== 'email');
  for (const m of others) {
    assertFalse(m.alwaysOn, `${m.key} must not be always-on`);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
