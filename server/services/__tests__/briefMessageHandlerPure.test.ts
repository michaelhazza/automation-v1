/**
 * briefMessageHandlerPure.test.ts
 *
 * Pure unit tests for selectDispatchRoute (DR2).
 * No DB access — only the routing decision function.
 *
 * Run via: npx tsx server/services/__tests__/briefMessageHandlerPure.test.ts
 */

export {};

import { selectDispatchRoute } from '../briefDispatchRoutePure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

console.log('\nDR2 — selectDispatchRoute pure tests\n');

// simple_reply and cheap_answer always short-circuit
test('simple_reply route → simple_reply regardless of caps', () => {
  assert(selectDispatchRoute('simple_reply', { frequencyCapHit: false, concurrencyCapHit: false }) === 'simple_reply', 'expected simple_reply');
  assert(selectDispatchRoute('simple_reply', { frequencyCapHit: true, concurrencyCapHit: true }) === 'simple_reply', 'caps must not override simple_reply');
});

test('cheap_answer route → simple_reply regardless of caps', () => {
  assert(selectDispatchRoute('cheap_answer', { frequencyCapHit: false, concurrencyCapHit: false }) === 'simple_reply', 'expected simple_reply');
  assert(selectDispatchRoute('cheap_answer', { frequencyCapHit: true, concurrencyCapHit: false }) === 'simple_reply', 'cap must not override cheap_answer');
});

// Frequency cap takes precedence (spec §4.5.3 cap precedence)
test('needs_orchestrator + frequency cap hit → frequency_capped', () => {
  assert(
    selectDispatchRoute('needs_orchestrator', { frequencyCapHit: true, concurrencyCapHit: false }) === 'frequency_capped',
    'frequency cap must block orchestrator',
  );
});

test('needs_orchestrator + both caps hit → frequency_capped (frequency takes precedence)', () => {
  assert(
    selectDispatchRoute('needs_orchestrator', { frequencyCapHit: true, concurrencyCapHit: true }) === 'frequency_capped',
    'frequency cap must take precedence over concurrency cap',
  );
});

test('needs_orchestrator + concurrency cap hit (no frequency) → concurrency_capped', () => {
  assert(
    selectDispatchRoute('needs_orchestrator', { frequencyCapHit: false, concurrencyCapHit: true }) === 'concurrency_capped',
    'concurrency cap must block when frequency is clear',
  );
});

test('needs_orchestrator + no caps → orchestrator', () => {
  assert(
    selectDispatchRoute('needs_orchestrator', { frequencyCapHit: false, concurrencyCapHit: false }) === 'orchestrator',
    'clear caps → orchestrator',
  );
});

test('needs_clarification + no caps → orchestrator', () => {
  assert(
    selectDispatchRoute('needs_clarification', { frequencyCapHit: false, concurrencyCapHit: false }) === 'orchestrator',
    'needs_clarification → orchestrator',
  );
});

test('needs_clarification + frequency cap → frequency_capped', () => {
  assert(
    selectDispatchRoute('needs_clarification', { frequencyCapHit: true, concurrencyCapHit: false }) === 'frequency_capped',
    'needs_clarification capped by frequency',
  );
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
