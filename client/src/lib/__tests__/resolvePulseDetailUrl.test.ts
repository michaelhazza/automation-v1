/**
 * resolvePulseDetailUrl.test.ts
 *
 * TDD tests for the fallback resolver for legacy opaque detailUrl tokens.
 * Run via: npx tsx client/src/lib/__tests__/resolvePulseDetailUrl.test.ts
 */

import { afterAll, beforeEach, expect, test } from 'vitest';
import { resolvePulseDetailUrl } from '../resolvePulseDetailUrl.js';

const warnCalls: Array<{ args: unknown[] }> = [];

// Capture console.warn calls
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  warnCalls.push({ args });
};

function resetWarn() {
  warnCalls.length = 0;
}

// ── review:<id> with subaccountId ─────────────────────────────────────────────

beforeEach(() => { warnCalls.length = 0; });
afterAll(() => { console.warn = originalWarn; });

test('review:<id> + subaccountId → /clientpulse/clients/<subaccountId>', () => {
  const result = resolvePulseDetailUrl('review:abc123', 'sub-42');
  expect(result === '/clientpulse/clients/sub-42', `expected /clientpulse/clients/sub-42, got ${result}`).toBeTruthy();
});

test('review:<id> + subaccountId → logs WARN', () => {
  resolvePulseDetailUrl('review:abc123', 'sub-42');
  expect(warnCalls.length >= 1, 'expected at least one console.warn call').toBeTruthy();
  const [tag, payload] = warnCalls[0].args as [string, unknown];
  expect(tag === '[resolvePulseDetailUrl] fallback_resolver_used', `unexpected warn tag: ${tag}`).toBeTruthy();
  expect(typeof payload === 'object' && payload !== null && (payload as Record<string, unknown>).detailUrl === 'review:abc123', 'warn payload must include detailUrl').toBeTruthy();
});

// ── review:<id> without subaccountId ─────────────────────────────────────────

test('review:<id> + no subaccount → null', () => {
  const result = resolvePulseDetailUrl('review:abc123');
  expect(result === null, `expected null, got ${result}`).toBeTruthy();
});

test('review:<id> + null subaccount → null', () => {
  const result = resolvePulseDetailUrl('review:abc123', null);
  expect(result === null, `expected null, got ${result}`).toBeTruthy();
});

test('review:<id> + empty string subaccount → null', () => {
  const result = resolvePulseDetailUrl('review:abc123', '');
  expect(result === null, `expected null, got ${result}`).toBeTruthy();
});

// ── task:<id> with subaccountId ───────────────────────────────────────────────

test('task:<id> + subaccountId → /admin/subaccounts/<subaccountId>/workspace', () => {
  const result = resolvePulseDetailUrl('task:task-99', 'sub-7');
  expect(result === '/admin/subaccounts/sub-7/workspace', `expected /admin/subaccounts/sub-7/workspace, got ${result}`).toBeTruthy();
});

test('task:<id> + subaccountId → logs WARN', () => {
  resolvePulseDetailUrl('task:task-99', 'sub-7');
  expect(warnCalls.length >= 1, 'expected at least one console.warn call').toBeTruthy();
  const [tag, payload] = warnCalls[0].args as [string, unknown];
  expect(tag === '[resolvePulseDetailUrl] fallback_resolver_used', `unexpected warn tag: ${tag}`).toBeTruthy();
  expect(typeof payload === 'object' && payload !== null && (payload as Record<string, unknown>).detailUrl === 'task:task-99', 'warn payload must include detailUrl').toBeTruthy();
});

// ── task:<id> without subaccountId ───────────────────────────────────────────

test('task:<id> + no subaccount → null', () => {
  const result = resolvePulseDetailUrl('task:task-99');
  expect(result === null, `expected null, got ${result}`).toBeTruthy();
});

test('task:<id> + null subaccount → null', () => {
  const result = resolvePulseDetailUrl('task:task-99', null);
  expect(result === null, `expected null, got ${result}`).toBeTruthy();
});

// ── run:<id> ──────────────────────────────────────────────────────────────────

test('run:<id> → /runs/<id>/live (no subaccount needed)', () => {
  const result = resolvePulseDetailUrl('run:run-55');
  expect(result === '/runs/run-55/live', `expected /runs/run-55/live, got ${result}`).toBeTruthy();
});

test('run:<id> with subaccountId → /runs/<id>/live (subaccount ignored)', () => {
  const result = resolvePulseDetailUrl('run:run-55', 'sub-99');
  expect(result === '/runs/run-55/live', `expected /runs/run-55/live, got ${result}`).toBeTruthy();
});

test('run:<id> → logs WARN', () => {
  resolvePulseDetailUrl('run:run-55');
  expect(warnCalls.length >= 1, 'expected at least one console.warn call').toBeTruthy();
  const [tag] = warnCalls[0].args as [string];
  expect(tag === '[resolvePulseDetailUrl] fallback_resolver_used', `unexpected warn tag: ${tag}`).toBeTruthy();
});

// ── health:<id> ───────────────────────────────────────────────────────────────

test('health:<id> → /admin/health (no subaccount needed)', () => {
  const result = resolvePulseDetailUrl('health:svc-1');
  expect(result === '/admin/health', `expected /admin/health, got ${result}`).toBeTruthy();
});

test('health:<id> with subaccountId → /admin/health (subaccount ignored)', () => {
  const result = resolvePulseDetailUrl('health:svc-1', 'sub-5');
  expect(result === '/admin/health', `expected /admin/health, got ${result}`).toBeTruthy();
});

test('health:<id> → logs WARN', () => {
  resolvePulseDetailUrl('health:svc-1');
  expect(warnCalls.length >= 1, 'expected at least one console.warn call').toBeTruthy();
  const [tag] = warnCalls[0].args as [string];
  expect(tag === '[resolvePulseDetailUrl] fallback_resolver_used', `unexpected warn tag: ${tag}`).toBeTruthy();
});

// ── unknown prefix ────────────────────────────────────────────────────────────

test('unknown prefix → null', () => {
  const result = resolvePulseDetailUrl('widget:foo-1');
  expect(result === null, `expected null, got ${result}`).toBeTruthy();
});

test('unknown prefix + subaccountId → null', () => {
  const result = resolvePulseDetailUrl('widget:foo-1', 'sub-3');
  expect(result === null, `expected null, got ${result}`).toBeTruthy();
});

test('unknown prefix → logs WARN', () => {
  resolvePulseDetailUrl('widget:foo-1');
  expect(warnCalls.length >= 1, 'expected at least one console.warn call').toBeTruthy();
  const [tag] = warnCalls[0].args as [string];
  expect(tag === '[resolvePulseDetailUrl] fallback_resolver_used', `unexpected warn tag: ${tag}`).toBeTruthy();
});

// ── malformed / edge cases ────────────────────────────────────────────────────

test('empty string → null (no throw)', () => {
  const result = resolvePulseDetailUrl('');
  expect(result === null, `expected null, got ${result}`).toBeTruthy();
});

test('no colon → null (no throw)', () => {
  const result = resolvePulseDetailUrl('justaplaintoken');
  expect(result === null, `expected null, got ${result}`).toBeTruthy();
});

test('colon-only value: run: with empty id → /runs//live', () => {
  // run: with empty id still produces a (possibly odd) URL — matches backend behaviour
  const result = resolvePulseDetailUrl('run:');
  expect(result === '/runs//live', `expected /runs//live, got ${result}`).toBeTruthy();
});
