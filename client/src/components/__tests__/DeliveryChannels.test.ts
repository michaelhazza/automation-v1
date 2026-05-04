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

import { expect, test } from 'vitest';
import {
  computeChannelState,
  computeAllChannelStates,
  CHANNEL_META,
} from '../DeliveryChannelsPure.js';
import type { DeliveryChannelConfig, AvailableChannels } from '../DeliveryChannelsPure.js';

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
  expect(state.isChecked, 'email must always be checked').toBe(true);
});

test('email isChecked=true regardless of value.email=true', () => {
  const state = computeChannelState('email', allValue, allAvailable, false, true);
  expect(state.isChecked, 'email checked when value.email=true').toBe(true);
});

test('email isDisabled=true (alwaysOn=true)', () => {
  const state = computeChannelState('email', allValue, allAvailable, false, true);
  expect(state.isDisabled, 'email must always be disabled (always-on badge)').toBe(true);
});

test('email isDisabled=true even when form disabled=false', () => {
  const state = computeChannelState('email', allValue, allAvailable, false, true);
  expect(state.isDisabled, 'alwaysOn always disables the input').toBe(true);
});

// ---------------------------------------------------------------------------
// 1 integration connected (email only)
// ---------------------------------------------------------------------------

console.log('1 integration connected (email only):');

test('email: checked and disabled', () => {
  const state = computeChannelState('email', allValue, onlyEmail, false, true);
  expect(state.isChecked, 'email checked').toBe(true);
  expect(state.isDisabled, 'email disabled').toBe(true);
});

test('portal: not checked when unavailable', () => {
  const state = computeChannelState('portal', allValue, onlyEmail, false, false);
  expect(state.isChecked, 'portal not checked when unavailable').toBe(false);
});

test('portal: disabled when unavailable', () => {
  const state = computeChannelState('portal', allValue, onlyEmail, false, false);
  expect(state.isDisabled, 'portal disabled when not connected').toBe(true);
});

test('slack: not checked when unavailable', () => {
  const state = computeChannelState('slack', allValue, onlyEmail, false, false);
  expect(state.isChecked, 'slack not checked when unavailable').toBe(false);
});

test('slack: disabled when unavailable', () => {
  const state = computeChannelState('slack', allValue, onlyEmail, false, false);
  expect(state.isDisabled, 'slack disabled when not connected').toBe(true);
});

// ---------------------------------------------------------------------------
// 2 integrations (email + portal — portalMode >= transparency)
// ---------------------------------------------------------------------------

console.log('2 integrations (email + portal):');

test('email: checked and disabled', () => {
  const state = computeChannelState('email', allValue, emailAndPortal, false, true);
  expect(state.isChecked, 'email checked').toBe(true);
  expect(state.isDisabled, 'email disabled').toBe(true);
});

test('portal: checked when value=true and available', () => {
  const state = computeChannelState('portal', allValue, emailAndPortal, false, false);
  expect(state.isChecked, 'portal checked when available and value=true').toBe(true);
  expect(state.isDisabled, 'portal enabled when available').toBe(false);
});

test('portal: not checked when value=false even if available', () => {
  const state = computeChannelState('portal', noneValue, emailAndPortal, false, false);
  expect(state.isChecked, 'portal unchecked when value=false').toBe(false);
});

test('slack: not checked (unavailable)', () => {
  const state = computeChannelState('slack', allValue, emailAndPortal, false, false);
  expect(state.isChecked, 'slack not checked when unavailable').toBe(false);
  expect(state.isDisabled, 'slack disabled when unavailable').toBe(true);
});

// ---------------------------------------------------------------------------
// All integrations connected
// ---------------------------------------------------------------------------

console.log('all integrations connected:');

test('email: always checked and disabled', () => {
  const state = computeChannelState('email', allValue, allAvailable, false, true);
  expect(state.isChecked, 'email checked').toBe(true);
  expect(state.isDisabled, 'email disabled').toBe(true);
});

test('portal: checked when value=true', () => {
  const state = computeChannelState('portal', allValue, allAvailable, false, false);
  expect(state.isChecked, 'portal checked').toBe(true);
  expect(state.isDisabled, 'portal enabled').toBe(false);
});

test('slack: checked when value=true', () => {
  const state = computeChannelState('slack', allValue, allAvailable, false, false);
  expect(state.isChecked, 'slack checked').toBe(true);
  expect(state.isDisabled, 'slack enabled').toBe(false);
});

test('portal: not checked when value=false', () => {
  const state = computeChannelState('portal', noneValue, allAvailable, false, false);
  expect(state.isChecked, 'portal unchecked when value=false').toBe(false);
});

test('slack: not checked when value=false', () => {
  const state = computeChannelState('slack', noneValue, allAvailable, false, false);
  expect(state.isChecked, 'slack unchecked when value=false').toBe(false);
});

// ---------------------------------------------------------------------------
// Form-level disabled propagates
// ---------------------------------------------------------------------------

console.log('form-level disabled:');

test('portal: disabled when form disabled=true even if available', () => {
  const state = computeChannelState('portal', allValue, allAvailable, true, false);
  expect(state.isDisabled, 'portal disabled when form disabled').toBe(true);
});

test('slack: disabled when form disabled=true even if available', () => {
  const state = computeChannelState('slack', allValue, allAvailable, true, false);
  expect(state.isDisabled, 'slack disabled when form disabled').toBe(true);
});

// ---------------------------------------------------------------------------
// computeAllChannelStates — batch helper
// ---------------------------------------------------------------------------

console.log('computeAllChannelStates:');

test('emailAndPortal: email always checked, portal checked, slack not', () => {
  const states = computeAllChannelStates(allValue, emailAndPortal, false);
  expect(states.email.isChecked, 'email checked').toBe(true);
  expect(states.email.isDisabled, 'email disabled (always-on)').toBe(true);
  expect(states.portal.isChecked, 'portal checked').toBe(true);
  expect(states.portal.isDisabled, 'portal enabled').toBe(false);
  expect(states.slack.isChecked, 'slack not checked').toBe(false);
  expect(states.slack.isDisabled, 'slack disabled (not connected)').toBe(true);
});

test('allAvailable + noneValue: only email checked', () => {
  const states = computeAllChannelStates(noneValue, allAvailable, false);
  expect(states.email.isChecked, 'email always checked').toBe(true);
  expect(states.portal.isChecked, 'portal not checked').toBe(false);
  expect(states.slack.isChecked, 'slack not checked').toBe(false);
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
    expect(m.alwaysOn, `${m.key} must not be always-on`).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');console.log('');