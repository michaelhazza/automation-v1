/**
 * useViewModePure — unit tests for the pure derivation helpers.
 *
 * Uses Node's built-in assert/strict module — no test framework required.
 * Run with:
 *   npx tsx client/src/hooks/__tests__/useViewModePure.test.ts
 *
 * Test coverage per spec §4.6:
 *   - deriveViewMode: all four representative cases
 *   - deriveAvailableModes: workspace-only, org admin, system admin
 *   - isLegalTransition: every cell of the spec §4.6 transition table
 */

import assert from 'node:assert/strict';
import {
  deriveViewMode,
  deriveAvailableModes,
  isLegalTransition,
} from '../useViewModePure.js';
import type { ViewModeContext } from '../useViewModePure.js';

// ---------------------------------------------------------------------------
// Context factory helpers
// ---------------------------------------------------------------------------

function workspaceUser(): ViewModeContext {
  return { hasActiveClient: true, hasSystemOverride: false, isOrgAdmin: false, isSystemAdmin: false };
}

function orgAdminNoClient(): ViewModeContext {
  return { hasActiveClient: false, hasSystemOverride: false, isOrgAdmin: true, isSystemAdmin: false };
}

function orgAdminWithClient(): ViewModeContext {
  return { hasActiveClient: true, hasSystemOverride: false, isOrgAdmin: true, isSystemAdmin: false };
}

function systemAdminWithOverride(): ViewModeContext {
  return { hasActiveClient: false, hasSystemOverride: true, isOrgAdmin: true, isSystemAdmin: true };
}

function systemAdminNoOverride(): ViewModeContext {
  return { hasActiveClient: true, hasSystemOverride: false, isOrgAdmin: true, isSystemAdmin: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`  FAIL  ${name}\n         ${msg}`);
    console.error(`  FAIL  ${name}`);
    console.error(`         ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// deriveViewMode
// ---------------------------------------------------------------------------

console.log('\nderiveViewMode');

test('workspace user (no override, no orgAdmin, hasActiveClient) → workspace', () => {
  assert.equal(deriveViewMode(workspaceUser()), 'workspace');
});

test('org admin with no active client → org', () => {
  assert.equal(deriveViewMode(orgAdminNoClient()), 'org');
});

test('org admin with active client → workspace', () => {
  assert.equal(deriveViewMode(orgAdminWithClient()), 'workspace');
});

test('system admin with override active → system', () => {
  assert.equal(deriveViewMode(systemAdminWithOverride()), 'system');
});

// ---------------------------------------------------------------------------
// deriveAvailableModes
// ---------------------------------------------------------------------------

console.log('\nderiveAvailableModes');

test('workspace-only user → [workspace]', () => {
  assert.deepEqual(deriveAvailableModes(workspaceUser()), ['workspace']);
});

test('org admin (not system admin) → [workspace, org]', () => {
  assert.deepEqual(deriveAvailableModes(orgAdminNoClient()), ['workspace', 'org']);
});

test('system admin → [workspace, org, system]', () => {
  assert.deepEqual(deriveAvailableModes(systemAdminWithOverride()), ['workspace', 'org', 'system']);
});

// ---------------------------------------------------------------------------
// isLegalTransition — full spec §4.6 transition table
//
// The table has 5 call variants × (from = workspace | org | system) = 15 cells,
// plus idempotent same-to-same transitions.
// ---------------------------------------------------------------------------

console.log('\nisLegalTransition');

// ── Idempotent same-to-same ──────────────────────────────────────────────────

test('workspace → workspace (idempotent) → true regardless of context', () => {
  assert.equal(isLegalTransition('workspace', 'workspace', workspaceUser()), true);
  assert.equal(isLegalTransition('workspace', 'workspace', orgAdminNoClient()), true);
});

test('org → org (idempotent) → true', () => {
  assert.equal(isLegalTransition('org', 'org', orgAdminNoClient()), true);
});

test('system → system (idempotent) → true', () => {
  assert.equal(isLegalTransition('system', 'system', systemAdminWithOverride()), true);
});

// ── setViewMode('org') ───────────────────────────────────────────────────────

test('workspace → org: org admin → true', () => {
  assert.equal(isLegalTransition('workspace', 'org', orgAdminWithClient()), true);
});

test('org → org: org admin (idempotent, covered above, explicit check) → true', () => {
  assert.equal(isLegalTransition('org', 'org', orgAdminNoClient()), true);
});

test('system → org: org admin → true', () => {
  assert.equal(isLegalTransition('system', 'org', systemAdminNoOverride()), true);
});

test('workspace → org: workspace-only user → false', () => {
  assert.equal(isLegalTransition('workspace', 'org', workspaceUser()), false);
});

test('org → org: workspace-only user → false (idempotent overrides: same-to-same always true)', () => {
  // same-to-same is always legal even if user would not normally be allowed in 'org'
  assert.equal(isLegalTransition('org', 'org', workspaceUser()), true);
});

// ── setViewMode('workspace') — has activeClient → true ──────────────────────

test('org → workspace: has active client → true', () => {
  assert.equal(isLegalTransition('org', 'workspace', orgAdminWithClient()), true);
});

test('system → workspace: has active client → true', () => {
  assert.equal(isLegalTransition('system', 'workspace', systemAdminNoOverride()), true);
});

// ── setViewMode('workspace') — no activeClient → false ──────────────────────

test('org → workspace: no active client → false', () => {
  assert.equal(isLegalTransition('org', 'workspace', orgAdminNoClient()), false);
});

test('system → workspace: no active client → false', () => {
  assert.equal(isLegalTransition('system', 'workspace', systemAdminWithOverride()), false);
});

// ── setViewMode('system') — has system_admin → true ─────────────────────────

test('workspace → system: system admin → true', () => {
  assert.equal(isLegalTransition('workspace', 'system', systemAdminNoOverride()), true);
});

test('org → system: system admin → true', () => {
  assert.equal(isLegalTransition('org', 'system', systemAdminNoOverride()), true);
});

// ── setViewMode('system') — lacks system_admin → false ──────────────────────

test('workspace → system: org admin only (not system admin) → false', () => {
  assert.equal(isLegalTransition('workspace', 'system', orgAdminWithClient()), false);
});

test('org → system: workspace-only user → false', () => {
  assert.equal(isLegalTransition('org', 'system', workspaceUser()), false);
});

// ── Composite: setViewMode('workspace') from workspace (same-to-same, no client) ──

test('workspace → workspace: no active client still returns true (idempotent)', () => {
  // The callback is NOT triggered here — isLegalTransition does not invoke callbacks.
  // The hook wires the callback; the pure function just returns legality.
  const ctx: ViewModeContext = { hasActiveClient: false, hasSystemOverride: false, isOrgAdmin: false, isSystemAdmin: false };
  assert.equal(isLegalTransition('workspace', 'workspace', ctx), true);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nFailed tests:');
  for (const f of failures) console.error(f);
  process.exit(1);
}
