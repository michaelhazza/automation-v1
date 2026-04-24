/**
 * hierarchyRouteResolverServicePure.test.ts
 *
 * Pure-function tests for the hierarchy route resolver (Chunk 2b).
 * Covers all five branches of the spec §6.6 decision tree.
 *
 * Run via:
 *   npx tsx server/services/__tests__/hierarchyRouteResolverServicePure.test.ts
 */

import {
  resolveRootForScopePure,
  type SubaccountRootRow,
  type OrgLevelLink,
} from '../hierarchyRouteResolverServicePure.js';

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

function assertNull(actual: unknown, label: string): void {
  if (actual !== null) {
    throw new Error(`${label}: expected null, got ${JSON.stringify(actual)}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_LINK: OrgLevelLink = {
  subaccountAgentId: 'sa-org-001',
  agentId: 'agent-org-001',
  subaccountId: 'sub-sentinel',
};

const ROOT_ROW_A: SubaccountRootRow = {
  subaccountAgentId: 'sa-sub-001',
  agentId: 'agent-sub-001',
  subaccountId: 'sub-123',
  createdAt: new Date('2024-01-10T10:00:00Z'),
};

const ROOT_ROW_B: SubaccountRootRow = {
  subaccountAgentId: 'sa-sub-002',
  agentId: 'agent-sub-002',
  subaccountId: 'sub-123',
  createdAt: new Date('2024-01-15T10:00:00Z'),
};

console.log('');
console.log('hierarchyRouteResolverServicePure — Chunk 2b');
console.log('');

// ---------------------------------------------------------------------------
// Branch 1: scope === 'system' → always null
// ---------------------------------------------------------------------------

test('scope:system returns null regardless of org link or roots', () => {
  const result = resolveRootForScopePure({
    scope: 'system',
    subaccountId: 'sub-123',
    subaccountRoots: [ROOT_ROW_A],
    orgLevelLink: ORG_LINK,
  });
  assertNull(result, 'system scope result');
});

test('scope:system returns null when no org link and no roots', () => {
  const result = resolveRootForScopePure({
    scope: 'system',
    subaccountId: null,
    subaccountRoots: [],
    orgLevelLink: null,
  });
  assertNull(result, 'system scope with no data');
});

// ---------------------------------------------------------------------------
// Branch 2: scope === 'org' with orgLevelLink → fallback: 'none'
// ---------------------------------------------------------------------------

test('scope:org with orgLevelLink returns org link with fallback:none', () => {
  const result = resolveRootForScopePure({
    scope: 'org',
    subaccountId: null,
    subaccountRoots: [],
    orgLevelLink: ORG_LINK,
  });
  assertEqual(result, {
    subaccountAgentId: 'sa-org-001',
    agentId: 'agent-org-001',
    subaccountId: 'sub-sentinel',
    fallback: 'none',
  }, 'org scope with link');
});

test('scope:org without orgLevelLink returns null', () => {
  const result = resolveRootForScopePure({
    scope: 'org',
    subaccountId: null,
    subaccountRoots: [],
    orgLevelLink: null,
  });
  assertNull(result, 'org scope without link');
});

// ---------------------------------------------------------------------------
// Branch 3: scope === 'subaccount' + subaccountId === null → fallback: 'expected'
// ---------------------------------------------------------------------------

test('scope:subaccount with null subaccountId falls back to org link with fallback:expected', () => {
  const result = resolveRootForScopePure({
    scope: 'subaccount',
    subaccountId: null,
    subaccountRoots: [],
    orgLevelLink: ORG_LINK,
  });
  assertEqual(result, {
    subaccountAgentId: 'sa-org-001',
    agentId: 'agent-org-001',
    subaccountId: 'sub-sentinel',
    fallback: 'expected',
  }, 'null subaccountId fallback');
});

test('scope:subaccount with null subaccountId and no org link returns null', () => {
  const result = resolveRootForScopePure({
    scope: 'subaccount',
    subaccountId: null,
    subaccountRoots: [],
    orgLevelLink: null,
  });
  assertNull(result, 'null subaccountId, no org link');
});

// ---------------------------------------------------------------------------
// Branch 4: scope === 'subaccount' + exactly one root → fallback: 'none'
// ---------------------------------------------------------------------------

test('scope:subaccount with one root returns that root with fallback:none', () => {
  const result = resolveRootForScopePure({
    scope: 'subaccount',
    subaccountId: 'sub-123',
    subaccountRoots: [ROOT_ROW_A],
    orgLevelLink: ORG_LINK,
  });
  assertEqual(result, {
    subaccountAgentId: 'sa-sub-001',
    agentId: 'agent-sub-001',
    subaccountId: 'sub-123',
    fallback: 'none',
  }, 'one root');
});

test('scope:subaccount with one root ignores org link entirely', () => {
  const result = resolveRootForScopePure({
    scope: 'subaccount',
    subaccountId: 'sub-123',
    subaccountRoots: [ROOT_ROW_A],
    orgLevelLink: null,
  });
  assertEqual(result, {
    subaccountAgentId: 'sa-sub-001',
    agentId: 'agent-sub-001',
    subaccountId: 'sub-123',
    fallback: 'none',
  }, 'one root, no org link');
});

// ---------------------------------------------------------------------------
// Branch 5: scope === 'subaccount' + zero roots → fallback: 'degraded'
// ---------------------------------------------------------------------------

test('scope:subaccount with zero roots falls back to org link with fallback:degraded', () => {
  const result = resolveRootForScopePure({
    scope: 'subaccount',
    subaccountId: 'sub-123',
    subaccountRoots: [],
    orgLevelLink: ORG_LINK,
  });
  assertEqual(result, {
    subaccountAgentId: 'sa-org-001',
    agentId: 'agent-org-001',
    subaccountId: 'sub-sentinel',
    fallback: 'degraded',
  }, 'zero roots fallback (misconfigured subaccount)');
});

test('scope:subaccount with zero roots and no org link returns null', () => {
  const result = resolveRootForScopePure({
    scope: 'subaccount',
    subaccountId: 'sub-123',
    subaccountRoots: [],
    orgLevelLink: null,
  });
  assertNull(result, 'zero roots, no org link');
});

// ---------------------------------------------------------------------------
// Branch 6 (defensive): multiple roots → picks oldest by createdAt
// ---------------------------------------------------------------------------

test('scope:subaccount with multiple roots picks oldest by createdAt', () => {
  // ROOT_ROW_A.createdAt < ROOT_ROW_B.createdAt
  const result = resolveRootForScopePure({
    scope: 'subaccount',
    subaccountId: 'sub-123',
    subaccountRoots: [ROOT_ROW_B, ROOT_ROW_A], // intentionally out of order
    orgLevelLink: ORG_LINK,
  });
  assertEqual(result, {
    subaccountAgentId: 'sa-sub-001', // ROOT_ROW_A is older
    agentId: 'agent-sub-001',
    subaccountId: 'sub-123',
    fallback: 'none',
  }, 'multiple roots picks oldest');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
