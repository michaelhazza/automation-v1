/**
 * briefMessageHandlerPure.test.ts
 *
 * Pure unit tests for selectDispatchRoute (DR2).
 * No DB access — only the routing decision function.
 *
 * Run via: npx tsx server/services/__tests__/briefMessageHandlerPure.test.ts
 */

export {};

import { expect, test } from 'vitest';
import { selectDispatchRoute } from '../briefDispatchRoutePure.js';

console.log('\nDR2 — selectDispatchRoute pure tests\n');

// simple_reply and cheap_answer always short-circuit
test('simple_reply route → simple_reply regardless of caps', () => {
  expect(selectDispatchRoute('simple_reply', { frequencyCapHit: false, concurrencyCapHit: false }) === 'simple_reply', 'expected simple_reply').toBeTruthy();
  expect(selectDispatchRoute('simple_reply', { frequencyCapHit: true, concurrencyCapHit: true }) === 'simple_reply', 'caps must not override simple_reply').toBeTruthy();
});

test('cheap_answer route → simple_reply regardless of caps', () => {
  expect(selectDispatchRoute('cheap_answer', { frequencyCapHit: false, concurrencyCapHit: false }) === 'simple_reply', 'expected simple_reply').toBeTruthy();
  expect(selectDispatchRoute('cheap_answer', { frequencyCapHit: true, concurrencyCapHit: false }) === 'simple_reply', 'cap must not override cheap_answer').toBeTruthy();
});

// Frequency cap takes precedence (spec §4.5.3 cap precedence)
test('needs_orchestrator + frequency cap hit → frequency_capped', () => {
  expect(selectDispatchRoute('needs_orchestrator', { frequencyCapHit: true, concurrencyCapHit: false }) === 'frequency_capped', 'frequency cap must block orchestrator').toBeTruthy();
});

test('needs_orchestrator + both caps hit → frequency_capped (frequency takes precedence)', () => {
  expect(selectDispatchRoute('needs_orchestrator', { frequencyCapHit: true, concurrencyCapHit: true }) === 'frequency_capped', 'frequency cap must take precedence over concurrency cap').toBeTruthy();
});

test('needs_orchestrator + concurrency cap hit (no frequency) → concurrency_capped', () => {
  expect(selectDispatchRoute('needs_orchestrator', { frequencyCapHit: false, concurrencyCapHit: true }) === 'concurrency_capped', 'concurrency cap must block when frequency is clear').toBeTruthy();
});

test('needs_orchestrator + no caps → orchestrator', () => {
  expect(selectDispatchRoute('needs_orchestrator', { frequencyCapHit: false, concurrencyCapHit: false }) === 'orchestrator', 'clear caps → orchestrator').toBeTruthy();
});

test('needs_clarification + no caps → orchestrator', () => {
  expect(selectDispatchRoute('needs_clarification', { frequencyCapHit: false, concurrencyCapHit: false }) === 'orchestrator', 'needs_clarification → orchestrator').toBeTruthy();
});

test('needs_clarification + frequency cap → frequency_capped', () => {
  expect(selectDispatchRoute('needs_clarification', { frequencyCapHit: true, concurrencyCapHit: false }) === 'frequency_capped', 'needs_clarification capped by frequency').toBeTruthy();
});
