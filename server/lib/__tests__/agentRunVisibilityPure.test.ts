import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  resolveAgentRunVisibility,
  type AgentRunVisibilityRun,
  type AgentRunVisibilityUser,
} from '../agentRunVisibility.js';

function mkRun(overrides: Partial<AgentRunVisibilityRun> = {}): AgentRunVisibilityRun {
  return {
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    executionScope: 'subaccount',
    isSystemRun: false,
    ...overrides,
  };
}

function mkUser(overrides: Partial<AgentRunVisibilityUser> = {}): AgentRunVisibilityUser {
  return {
    id: 'u-1',
    role: 'user',
    organisationId: 'org-1',
    orgPermissions: new Set<string>(),
    ...overrides,
  };
}

test('system_admin always sees + payload-views', () => {
  const v = resolveAgentRunVisibility(mkRun({ isSystemRun: true }), mkUser({ role: 'system_admin' }));
  assert.equal(v.canView, true);
  assert.equal(v.canViewPayload, true);
});

test('cross-org access rejected for non-admins', () => {
  const v = resolveAgentRunVisibility(
    mkRun({ organisationId: 'other-org' }),
    mkUser(),
  );
  assert.equal(v.canView, false);
  assert.equal(v.canViewPayload, false);
});

test('system-tier run denies non-admins', () => {
  const v = resolveAgentRunVisibility(
    mkRun({ isSystemRun: true }),
    mkUser({ orgPermissions: new Set(['org.agents.view']) }),
  );
  assert.equal(v.canView, false);
});

test('org_admin bypasses within their org', () => {
  const v = resolveAgentRunVisibility(mkRun(), mkUser({ role: 'org_admin' }));
  assert.equal(v.canView, true);
  assert.equal(v.canViewPayload, true);
});

test('user without AGENTS_VIEW → canView false', () => {
  const v = resolveAgentRunVisibility(mkRun(), mkUser());
  assert.equal(v.canView, false);
});

test('user with AGENTS_VIEW but not AGENTS_EDIT → view yes, payload no', () => {
  const v = resolveAgentRunVisibility(
    mkRun(),
    mkUser({ orgPermissions: new Set(['org.agents.view']) }),
  );
  assert.equal(v.canView, true);
  assert.equal(v.canViewPayload, false);
});

test('user with AGENTS_VIEW + AGENTS_EDIT → both', () => {
  const v = resolveAgentRunVisibility(
    mkRun(),
    mkUser({ orgPermissions: new Set(['org.agents.view', 'org.agents.edit']) }),
  );
  assert.equal(v.canView, true);
  assert.equal(v.canViewPayload, true);
});

test('canViewPayload strictly implies canView (all positive cases)', () => {
  const cases: Array<[AgentRunVisibilityRun, AgentRunVisibilityUser]> = [
    [mkRun(), mkUser({ role: 'system_admin' })],
    [mkRun(), mkUser({ role: 'org_admin' })],
    [mkRun(), mkUser({ orgPermissions: new Set(['org.agents.view', 'org.agents.edit']) })],
  ];
  for (const [r, u] of cases) {
    const v = resolveAgentRunVisibility(r, u);
    if (v.canViewPayload) assert.equal(v.canView, true, 'payload implies view');
  }
});
