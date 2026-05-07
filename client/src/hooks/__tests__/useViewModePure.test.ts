/**
 * useViewModePure — unit tests for the pure derivation helpers.
 * Run via vitest (CI) or `npx vitest run client/src/hooks/__tests__/useViewModePure.test.ts` locally.
 *
 * Test coverage per spec §4.6:
 *   - deriveViewMode: all four representative cases
 *   - deriveAvailableModes: workspace-only, org admin, system admin
 *   - isLegalTransition: every cell of the spec §4.6 transition table
 */

import { test, expect } from 'vitest';
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
// deriveViewMode
// ---------------------------------------------------------------------------

test('workspace user (no override, no orgAdmin, hasActiveClient) → workspace', () => {
  expect(deriveViewMode(workspaceUser())).toBe('workspace');
});

test('org admin with no active client → org', () => {
  expect(deriveViewMode(orgAdminNoClient())).toBe('org');
});

test('org admin with active client → workspace', () => {
  expect(deriveViewMode(orgAdminWithClient())).toBe('workspace');
});

test('system admin with override active → system', () => {
  expect(deriveViewMode(systemAdminWithOverride())).toBe('system');
});

test('stale override flag without isSystemAdmin → workspace (no inconsistent system mode)', () => {
  // Regression: a downgraded user with a leftover systemAdminOrgOverride flag in
  // localStorage must not derive into 'system' — that combination would render a
  // sidebar with no active switcher segment and hidden workspace items.
  const downgraded: ViewModeContext = {
    hasActiveClient: true,
    hasSystemOverride: true,
    isOrgAdmin: true,
    isSystemAdmin: false,
  };
  expect(deriveViewMode(downgraded)).toBe('workspace');
});

test('stale override flag without isSystemAdmin and no client → org (org admin path)', () => {
  const downgraded: ViewModeContext = {
    hasActiveClient: false,
    hasSystemOverride: true,
    isOrgAdmin: true,
    isSystemAdmin: false,
  };
  expect(deriveViewMode(downgraded)).toBe('org');
});

// ---------------------------------------------------------------------------
// deriveAvailableModes
// ---------------------------------------------------------------------------

test('workspace-only user → [workspace]', () => {
  expect(deriveAvailableModes(workspaceUser())).toEqual(['workspace']);
});

test('org admin (not system admin) → [workspace, org]', () => {
  expect(deriveAvailableModes(orgAdminNoClient())).toEqual(['workspace', 'org']);
});

test('system admin → [workspace, org, system]', () => {
  expect(deriveAvailableModes(systemAdminWithOverride())).toEqual(['workspace', 'org', 'system']);
});

// ---------------------------------------------------------------------------
// isLegalTransition — full spec §4.6 transition table
//
// The table has 5 call variants × (from = workspace | org | system) = 15 cells,
// plus idempotent same-to-same transitions.
// ---------------------------------------------------------------------------

// ── Idempotent same-to-same ──────────────────────────────────────────────────

test('workspace → workspace (idempotent) → true regardless of context', () => {
  expect(isLegalTransition('workspace', 'workspace', workspaceUser())).toBe(true);
  expect(isLegalTransition('workspace', 'workspace', orgAdminNoClient())).toBe(true);
});

test('org → org (idempotent) → true', () => {
  expect(isLegalTransition('org', 'org', orgAdminNoClient())).toBe(true);
});

test('system → system (idempotent) → true', () => {
  expect(isLegalTransition('system', 'system', systemAdminWithOverride())).toBe(true);
});

// ── setViewMode('org') ───────────────────────────────────────────────────────

test('workspace → org: org admin → true', () => {
  expect(isLegalTransition('workspace', 'org', orgAdminWithClient())).toBe(true);
});

test('org → org: org admin (idempotent, covered above, explicit check) → true', () => {
  expect(isLegalTransition('org', 'org', orgAdminNoClient())).toBe(true);
});

test('system → org: org admin → true', () => {
  expect(isLegalTransition('system', 'org', systemAdminNoOverride())).toBe(true);
});

test('workspace → org: workspace-only user → false', () => {
  expect(isLegalTransition('workspace', 'org', workspaceUser())).toBe(false);
});

test('org → org: workspace-only user → false (idempotent overrides: same-to-same always true)', () => {
  // same-to-same is always legal even if user would not normally be allowed in 'org'
  expect(isLegalTransition('org', 'org', workspaceUser())).toBe(true);
});

// ── setViewMode('workspace') — has activeClient → true ──────────────────────

test('org → workspace: has active client → true', () => {
  expect(isLegalTransition('org', 'workspace', orgAdminWithClient())).toBe(true);
});

test('system → workspace: has active client → true', () => {
  expect(isLegalTransition('system', 'workspace', systemAdminNoOverride())).toBe(true);
});

// ── setViewMode('workspace') — no activeClient → false ──────────────────────

test('org → workspace: no active client → false', () => {
  expect(isLegalTransition('org', 'workspace', orgAdminNoClient())).toBe(false);
});

test('system → workspace: no active client → false', () => {
  expect(isLegalTransition('system', 'workspace', systemAdminWithOverride())).toBe(false);
});

// ── setViewMode('system') — has system_admin → true ─────────────────────────

test('workspace → system: system admin → true', () => {
  expect(isLegalTransition('workspace', 'system', systemAdminNoOverride())).toBe(true);
});

test('org → system: system admin → true', () => {
  expect(isLegalTransition('org', 'system', systemAdminNoOverride())).toBe(true);
});

// ── setViewMode('system') — lacks system_admin → false ──────────────────────

test('workspace → system: org admin only (not system admin) → false', () => {
  expect(isLegalTransition('workspace', 'system', orgAdminWithClient())).toBe(false);
});

test('org → system: workspace-only user → false', () => {
  expect(isLegalTransition('org', 'system', workspaceUser())).toBe(false);
});

// ── Composite: setViewMode('workspace') from workspace (same-to-same, no client) ──

test('workspace → workspace: no active client still returns true (idempotent)', () => {
  // The callback is NOT triggered here — isLegalTransition does not invoke callbacks.
  // The hook wires the callback; the pure function just returns legality.
  const ctx: ViewModeContext = { hasActiveClient: false, hasSystemOverride: false, isOrgAdmin: false, isSystemAdmin: false };
  expect(isLegalTransition('workspace', 'workspace', ctx)).toBe(true);
});
