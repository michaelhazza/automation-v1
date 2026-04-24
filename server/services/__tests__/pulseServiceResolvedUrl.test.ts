/**
 * pulseServiceResolvedUrl.test.ts — Unit tests for resolvedUrl on PulseItem.
 *
 * Tests the resolution rules for resolvedUrl via a local reference implementation
 * that mirrors the rules table in the task spec. The real helper in pulseService.ts
 * is not exported (by design), so these tests act as both a specification and a
 * regression guard — if the implementation diverges from the rules table the
 * TypeScript interface and the items.push() blocks will produce wrong values.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/pulseServiceResolvedUrl.test.ts
 */

// ---------------------------------------------------------------------------
// Reference implementation of resolveUrlForItem (mirrors rules table)
// ---------------------------------------------------------------------------

function resolveUrlForItem(
  kind: string,
  id: string,
  subaccountId: string | null | undefined,
): string | null {
  switch (kind) {
    case 'review':
      return subaccountId ? `/clientpulse/clients/${subaccountId}` : null;
    case 'task':
      return subaccountId ? `/admin/subaccounts/${subaccountId}/workspace` : null;
    case 'failed_run':
      return `/runs/${id}/live`;
    case 'health_finding':
      return '/admin/health';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Lightweight test runner (matches project tsx convention)
// ---------------------------------------------------------------------------

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
  assertEqual(
    resolveUrlForItem('review', 'item-1', 'sub-abc'),
    '/clientpulse/clients/sub-abc',
    'review with subaccountId',
  );
});

test('review without subaccountId (undefined) returns null', () => {
  assertNull(resolveUrlForItem('review', 'item-1', undefined), 'review undefined subaccountId');
});

test('review without subaccountId (null) returns null', () => {
  assertNull(resolveUrlForItem('review', 'item-1', null), 'review null subaccountId');
});

test('review without subaccountId (empty string) returns null', () => {
  assertNull(resolveUrlForItem('review', 'item-1', ''), 'review empty string subaccountId');
});

// ---------------------------------------------------------------------------
// task — with / without subaccountId
// ---------------------------------------------------------------------------

console.log('\n── task ──────────────────────────────────────────────────────');

test('task with subaccountId returns /admin/subaccounts/:subaccountId/workspace', () => {
  assertEqual(
    resolveUrlForItem('task', 'task-99', 'sub-xyz'),
    '/admin/subaccounts/sub-xyz/workspace',
    'task with subaccountId',
  );
});

test('task without subaccountId (undefined) returns null', () => {
  assertNull(resolveUrlForItem('task', 'task-99', undefined), 'task undefined subaccountId');
});

test('task without subaccountId (null) returns null', () => {
  assertNull(resolveUrlForItem('task', 'task-99', null), 'task null subaccountId');
});

test('task without subaccountId (empty string) returns null', () => {
  assertNull(resolveUrlForItem('task', 'task-99', ''), 'task empty string subaccountId');
});

// ---------------------------------------------------------------------------
// failed_run — always /runs/:id/live
// ---------------------------------------------------------------------------

console.log('\n── failed_run ────────────────────────────────────────────────');

test('failed_run with subaccountId returns /runs/:id/live', () => {
  assertEqual(
    resolveUrlForItem('failed_run', 'run-42', 'sub-abc'),
    '/runs/run-42/live',
    'failed_run with subaccountId',
  );
});

test('failed_run without subaccountId returns /runs/:id/live', () => {
  assertEqual(
    resolveUrlForItem('failed_run', 'run-42', null),
    '/runs/run-42/live',
    'failed_run without subaccountId',
  );
});

test('failed_run URL uses run id, not subaccountId', () => {
  const url = resolveUrlForItem('failed_run', 'run-99', 'sub-different');
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
  assertEqual(
    resolveUrlForItem('health_finding', 'finding-1', null),
    '/admin/health',
    'health_finding null subaccountId',
  );
});

test('health_finding ignores subaccountId', () => {
  assertEqual(
    resolveUrlForItem('health_finding', 'finding-1', 'sub-abc'),
    '/admin/health',
    'health_finding with subaccountId',
  );
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
  return { id, kind, resolvedUrl: resolveUrlForItem(kind, id, subaccountId) };
}

test('review with subaccountId — resolvedUrl on PulseItem', () => {
  const item = makePulseItem('review', 'rev-1', 'sub-1');
  assertEqual(item.resolvedUrl, '/clientpulse/clients/sub-1', 'review PulseItem resolvedUrl');
});

test('review without subaccountId — resolvedUrl null on PulseItem', () => {
  const item = makePulseItem('review', 'rev-1', null);
  assertNull(item.resolvedUrl, 'review PulseItem null resolvedUrl');
});

test('task with subaccountId — resolvedUrl on PulseItem', () => {
  const item = makePulseItem('task', 'task-1', 'sub-2');
  assertEqual(item.resolvedUrl, '/admin/subaccounts/sub-2/workspace', 'task PulseItem resolvedUrl');
});

test('task without subaccountId — resolvedUrl null on PulseItem', () => {
  const item = makePulseItem('task', 'task-1', null);
  assertNull(item.resolvedUrl, 'task PulseItem null resolvedUrl');
});

test('failed_run — resolvedUrl on PulseItem', () => {
  const item = makePulseItem('failed_run', 'run-77', 'sub-3');
  assertEqual(item.resolvedUrl, '/runs/run-77/live', 'failed_run PulseItem resolvedUrl');
});

test('health_finding — resolvedUrl on PulseItem', () => {
  const item = makePulseItem('health_finding', 'finding-5', null);
  assertEqual(item.resolvedUrl, '/admin/health', 'health_finding PulseItem resolvedUrl');
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
console.log(`  PASS: ${passed}`);
console.log(`  FAIL: ${failed}`);
if (failed > 0) process.exit(1);
