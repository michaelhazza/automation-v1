import { expect, test } from 'vitest';
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
  expect(v.canView).toBe(true);
  expect(v.canViewPayload).toBe(true);
});

test('cross-org access rejected for non-admins', () => {
  const v = resolveAgentRunVisibility(
    mkRun({ organisationId: 'other-org' }),
    mkUser(),
  );
  expect(v.canView).toBe(false);
  expect(v.canViewPayload).toBe(false);
});

test('system-tier run denies non-admins', () => {
  const v = resolveAgentRunVisibility(
    mkRun({ isSystemRun: true }),
    mkUser({ orgPermissions: new Set(['org.agents.view']) }),
  );
  expect(v.canView).toBe(false);
});

test('org_admin bypasses within their org', () => {
  const v = resolveAgentRunVisibility(mkRun(), mkUser({ role: 'org_admin' }));
  expect(v.canView).toBe(true);
  expect(v.canViewPayload).toBe(true);
});

test('user without AGENTS_VIEW → canView false', () => {
  const v = resolveAgentRunVisibility(mkRun(), mkUser());
  expect(v.canView).toBe(false);
});

test('user with AGENTS_VIEW but not AGENTS_EDIT → view yes, payload no', () => {
  const v = resolveAgentRunVisibility(
    mkRun(),
    mkUser({ orgPermissions: new Set(['org.agents.view']) }),
  );
  expect(v.canView).toBe(true);
  expect(v.canViewPayload).toBe(false);
});

test('user with AGENTS_VIEW + AGENTS_EDIT → both', () => {
  const v = resolveAgentRunVisibility(
    mkRun(),
    mkUser({ orgPermissions: new Set(['org.agents.view', 'org.agents.edit']) }),
  );
  expect(v.canView).toBe(true);
  expect(v.canViewPayload).toBe(true);
});

test('canViewPayload strictly implies canView (all positive cases)', () => {
  const cases: Array<[AgentRunVisibilityRun, AgentRunVisibilityUser]> = [
    [mkRun(), mkUser({ role: 'system_admin' })],
    [mkRun(), mkUser({ role: 'org_admin' })],
    [mkRun(), mkUser({ orgPermissions: new Set(['org.agents.view', 'org.agents.edit']) })],
  ];
  for (const [r, u] of cases) {
    const v = resolveAgentRunVisibility(r, u);
    if (v.canViewPayload) expect(v.canView, 'payload implies view').toBe(true);
  }
});
