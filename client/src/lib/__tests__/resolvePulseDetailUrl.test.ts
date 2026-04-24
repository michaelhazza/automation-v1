/**
 * resolvePulseDetailUrl.test.ts
 *
 * TDD tests for the fallback resolver for legacy opaque detailUrl tokens.
 * Run via: npx tsx client/src/lib/__tests__/resolvePulseDetailUrl.test.ts
 */

import { resolvePulseDetailUrl } from '../resolvePulseDetailUrl.js';

let passed = 0;
let failed = 0;
const warnCalls: Array<{ args: unknown[] }> = [];

// Capture console.warn calls
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  warnCalls.push({ args });
};

function resetWarn() {
  warnCalls.length = 0;
}

function test(name: string, fn: () => void) {
  resetWarn();
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

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ── review:<id> with subaccountId ─────────────────────────────────────────────

test('review:<id> + subaccountId → /clientpulse/clients/<subaccountId>', () => {
  const result = resolvePulseDetailUrl('review:abc123', 'sub-42');
  assert(result === '/clientpulse/clients/sub-42', `expected /clientpulse/clients/sub-42, got ${result}`);
});

test('review:<id> + subaccountId → logs WARN', () => {
  resolvePulseDetailUrl('review:abc123', 'sub-42');
  assert(warnCalls.length >= 1, 'expected at least one console.warn call');
  const [tag, payload] = warnCalls[0].args as [string, unknown];
  assert(tag === '[resolvePulseDetailUrl] fallback_resolver_used', `unexpected warn tag: ${tag}`);
  assert(
    typeof payload === 'object' && payload !== null && (payload as Record<string, unknown>).detailUrl === 'review:abc123',
    'warn payload must include detailUrl',
  );
});

// ── review:<id> without subaccountId ─────────────────────────────────────────

test('review:<id> + no subaccount → null', () => {
  const result = resolvePulseDetailUrl('review:abc123');
  assert(result === null, `expected null, got ${result}`);
});

test('review:<id> + null subaccount → null', () => {
  const result = resolvePulseDetailUrl('review:abc123', null);
  assert(result === null, `expected null, got ${result}`);
});

test('review:<id> + empty string subaccount → null', () => {
  const result = resolvePulseDetailUrl('review:abc123', '');
  assert(result === null, `expected null, got ${result}`);
});

// ── task:<id> with subaccountId ───────────────────────────────────────────────

test('task:<id> + subaccountId → /admin/subaccounts/<subaccountId>/workspace', () => {
  const result = resolvePulseDetailUrl('task:task-99', 'sub-7');
  assert(result === '/admin/subaccounts/sub-7/workspace', `expected /admin/subaccounts/sub-7/workspace, got ${result}`);
});

test('task:<id> + subaccountId → logs WARN', () => {
  resolvePulseDetailUrl('task:task-99', 'sub-7');
  assert(warnCalls.length >= 1, 'expected at least one console.warn call');
  const [tag, payload] = warnCalls[0].args as [string, unknown];
  assert(tag === '[resolvePulseDetailUrl] fallback_resolver_used', `unexpected warn tag: ${tag}`);
  assert(
    typeof payload === 'object' && payload !== null && (payload as Record<string, unknown>).detailUrl === 'task:task-99',
    'warn payload must include detailUrl',
  );
});

// ── task:<id> without subaccountId ───────────────────────────────────────────

test('task:<id> + no subaccount → null', () => {
  const result = resolvePulseDetailUrl('task:task-99');
  assert(result === null, `expected null, got ${result}`);
});

test('task:<id> + null subaccount → null', () => {
  const result = resolvePulseDetailUrl('task:task-99', null);
  assert(result === null, `expected null, got ${result}`);
});

// ── run:<id> ──────────────────────────────────────────────────────────────────

test('run:<id> → /runs/<id>/live (no subaccount needed)', () => {
  const result = resolvePulseDetailUrl('run:run-55');
  assert(result === '/runs/run-55/live', `expected /runs/run-55/live, got ${result}`);
});

test('run:<id> with subaccountId → /runs/<id>/live (subaccount ignored)', () => {
  const result = resolvePulseDetailUrl('run:run-55', 'sub-99');
  assert(result === '/runs/run-55/live', `expected /runs/run-55/live, got ${result}`);
});

test('run:<id> → logs WARN', () => {
  resolvePulseDetailUrl('run:run-55');
  assert(warnCalls.length >= 1, 'expected at least one console.warn call');
  const [tag] = warnCalls[0].args as [string];
  assert(tag === '[resolvePulseDetailUrl] fallback_resolver_used', `unexpected warn tag: ${tag}`);
});

// ── health:<id> ───────────────────────────────────────────────────────────────

test('health:<id> → /admin/health (no subaccount needed)', () => {
  const result = resolvePulseDetailUrl('health:svc-1');
  assert(result === '/admin/health', `expected /admin/health, got ${result}`);
});

test('health:<id> with subaccountId → /admin/health (subaccount ignored)', () => {
  const result = resolvePulseDetailUrl('health:svc-1', 'sub-5');
  assert(result === '/admin/health', `expected /admin/health, got ${result}`);
});

test('health:<id> → logs WARN', () => {
  resolvePulseDetailUrl('health:svc-1');
  assert(warnCalls.length >= 1, 'expected at least one console.warn call');
  const [tag] = warnCalls[0].args as [string];
  assert(tag === '[resolvePulseDetailUrl] fallback_resolver_used', `unexpected warn tag: ${tag}`);
});

// ── unknown prefix ────────────────────────────────────────────────────────────

test('unknown prefix → null', () => {
  const result = resolvePulseDetailUrl('widget:foo-1');
  assert(result === null, `expected null, got ${result}`);
});

test('unknown prefix + subaccountId → null', () => {
  const result = resolvePulseDetailUrl('widget:foo-1', 'sub-3');
  assert(result === null, `expected null, got ${result}`);
});

test('unknown prefix → logs WARN', () => {
  resolvePulseDetailUrl('widget:foo-1');
  assert(warnCalls.length >= 1, 'expected at least one console.warn call');
  const [tag] = warnCalls[0].args as [string];
  assert(tag === '[resolvePulseDetailUrl] fallback_resolver_used', `unexpected warn tag: ${tag}`);
});

// ── malformed / edge cases ────────────────────────────────────────────────────

test('empty string → null (no throw)', () => {
  const result = resolvePulseDetailUrl('');
  assert(result === null, `expected null, got ${result}`);
});

test('no colon → null (no throw)', () => {
  const result = resolvePulseDetailUrl('justaplaintoken');
  assert(result === null, `expected null, got ${result}`);
});

test('colon-only value: run: with empty id → /runs//live', () => {
  // run: with empty id still produces a (possibly odd) URL — matches backend behaviour
  const result = resolvePulseDetailUrl('run:');
  assert(result === '/runs//live', `expected /runs//live, got ${result}`);
});

// ── summary ───────────────────────────────────────────────────────────────────

console.warn = originalWarn;
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
