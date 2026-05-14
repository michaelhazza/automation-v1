// guard-ignore-file: pure-helper-convention reason="Imports sibling '../pulseService' without .js extension — gate regex requires .js suffix; import is valid per convention"
/**
 * pulseServiceResolvedUrl.test.ts — Unit tests for resolvedUrl on PulseItem.
 *
 * Tests the resolution rules for resolvedUrl by importing the production helper
 * directly from pulseService.ts, so changes to the implementation are
 * immediately caught here.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/pulseServiceResolvedUrl.test.ts
 */

import { expect, test } from 'vitest';
import { _resolveUrlForItem } from '../pulseService';

// ---------------------------------------------------------------------------
// Lightweight test runner (matches project tsx convention)
// ---------------------------------------------------------------------------

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertNull(actual: unknown, label: string) {
  if (actual !== null) {
    throw new Error(`${label}: expected null, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// review — with subaccountId
// ---------------------------------------------------------------------------

console.log('\n── review ─────────────────────────────────────────────────────');

test('review with subaccountId returns /clientpulse/clients/:subaccountId', () => {
  expect(_resolveUrlForItem('review', 'item-1', 'sub-abc'), 'review with subaccountId').toBe('/clientpulse/clients/sub-abc');
});

test('review without subaccountId (undefined) returns null', () => {
  assertNull(_resolveUrlForItem('review', 'item-1', undefined), 'review undefined subaccountId');
});

test('review without subaccountId (null) returns null', () => {
  assertNull(_resolveUrlForItem('review', 'item-1', null), 'review null subaccountId');
});

test('review without subaccountId (empty string) returns null', () => {
  assertNull(_resolveUrlForItem('review', 'item-1', ''), 'review empty string subaccountId');
});

// ---------------------------------------------------------------------------
// task — with / without subaccountId
// ---------------------------------------------------------------------------

console.log('\n── task ──────────────────────────────────────────────────────');

test('task with subaccountId returns /admin/subaccounts/:subaccountId/workspace', () => {
  expect(_resolveUrlForItem('task', 'task-99', 'sub-xyz'), 'task with subaccountId').toBe('/admin/subaccounts/sub-xyz/workspace');
});

test('task without subaccountId (undefined) returns null', () => {
  assertNull(_resolveUrlForItem('task', 'task-99', undefined), 'task undefined subaccountId');
});

test('task without subaccountId (null) returns null', () => {
  assertNull(_resolveUrlForItem('task', 'task-99', null), 'task null subaccountId');
});

test('task without subaccountId (empty string) returns null', () => {
  assertNull(_resolveUrlForItem('task', 'task-99', ''), 'task empty string subaccountId');
});

// ---------------------------------------------------------------------------
// failed_run — always /runs/:id/live
// ---------------------------------------------------------------------------

console.log('\n── failed_run ────────────────────────────────────────────────');

test('failed_run with subaccountId returns /runs/:id/live', () => {
  expect(_resolveUrlForItem('failed_run', 'run-42', 'sub-abc'), 'failed_run with subaccountId').toBe('/runs/run-42/live');
});

test('failed_run without subaccountId returns /runs/:id/live', () => {
  expect(_resolveUrlForItem('failed_run', 'run-42', null), 'failed_run without subaccountId').toBe('/runs/run-42/live');
});

test('failed_run URL uses run id, not subaccountId', () => {
  const url = _resolveUrlForItem('failed_run', 'run-99', 'sub-different');
  if (!url || !url.includes('run-99')) {
    throw new Error(`expected URL to contain run-99, got ${url}`);
  }
  if (url.includes('sub-different')) {
    throw new Error(`expected URL NOT to contain sub-different, got ${url}`);
  }
});

// ---------------------------------------------------------------------------
// health_finding — always /admin/health
// ---------------------------------------------------------------------------

console.log('\n── health_finding ────────────────────────────────────────────');

test('health_finding returns /admin/health', () => {
  expect(_resolveUrlForItem('health_finding', 'finding-1', null), 'health_finding null subaccountId').toBe('/admin/health');
});

test('health_finding ignores subaccountId', () => {
  expect(_resolveUrlForItem('health_finding', 'finding-1', 'sub-abc'), 'health_finding with subaccountId').toBe('/admin/health');
});

// ---------------------------------------------------------------------------
// PulseItem shape contract
// ---------------------------------------------------------------------------

console.log('\n── PulseItem shape ───────────────────────────────────────────');

// Simulates what getAttention / getItem will produce once the implementation
// is in place.  Validates that the field exists and has the right type.
type PulseItemLike = {
  id: string;
  kind: 'review' | 'task' | 'failed_run' | 'health_finding';
  resolvedUrl: string | null;
};

function makePulseItem(
  kind: 'review' | 'task' | 'failed_run' | 'health_finding',
  id: string,
  subaccountId: string | null,
): PulseItemLike {
  return { id, kind, resolvedUrl: _resolveUrlForItem(kind, id, subaccountId) };
}

test('review with subaccountId — resolvedUrl on PulseItem', () => {
  const item = makePulseItem('review', 'rev-1', 'sub-1');
  expect(item.resolvedUrl, 'review PulseItem resolvedUrl').toBe('/clientpulse/clients/sub-1');
});

test('review without subaccountId — resolvedUrl null on PulseItem', () => {
  const item = makePulseItem('review', 'rev-1', null);
  assertNull(item.resolvedUrl, 'review PulseItem null resolvedUrl');
});

test('task with subaccountId — resolvedUrl on PulseItem', () => {
  const item = makePulseItem('task', 'task-1', 'sub-2');
  expect(item.resolvedUrl, 'task PulseItem resolvedUrl').toBe('/admin/subaccounts/sub-2/workspace');
});

test('task without subaccountId — resolvedUrl null on PulseItem', () => {
  const item = makePulseItem('task', 'task-1', null);
  assertNull(item.resolvedUrl, 'task PulseItem null resolvedUrl');
});

test('failed_run — resolvedUrl on PulseItem', () => {
  const item = makePulseItem('failed_run', 'run-77', 'sub-3');
  expect(item.resolvedUrl, 'failed_run PulseItem resolvedUrl').toBe('/runs/run-77/live');
});

test('health_finding — resolvedUrl on PulseItem', () => {
  const item = makePulseItem('health_finding', 'finding-5', null);
  expect(item.resolvedUrl, 'health_finding PulseItem resolvedUrl').toBe('/admin/health');
});

test('getItem-equivalent carries resolvedUrl field', () => {
  const item = makePulseItem('review', 'rev-2', 'sub-99');
  if (!('resolvedUrl' in item)) {
    throw new Error('PulseItem missing resolvedUrl field');
  }
  const typeOk = typeof item.resolvedUrl === 'string' || item.resolvedUrl === null;
  if (!typeOk) {
    throw new Error(`resolvedUrl has wrong type: ${typeof item.resolvedUrl}`);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== Summary ===`);
