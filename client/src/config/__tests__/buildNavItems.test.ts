// client/src/config/__tests__/buildNavItems.test.ts
// Pure tests for buildNavItems.
// Run via vitest (CI) or `npx vitest run client/src/config/__tests__/buildNavItems.test.ts` locally.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildNavItems } from '../sidebar.js';
import type { NavContext } from '../sidebar.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function noopFn() {}

/** Baseline context with all permissions/flags set to the minimum (no org, no client). */
function baseCtx(overrides: Partial<NavContext> = {}): NavContext {
  return {
    isSystemAdmin: false,
    hasOrgContext: false,
    hasAnyOrgPerm: false,
    activeClientId: null,
    hasOrgPerm: () => false,
    hasClientPerm: () => false,
    hasSidebarItem: () => false,
    viewMode: 'org',
    navProjects: [],
    navAgents: [],
    reviewCount: 0,
    liveAgentCount: 0,
    incidentCount: 0,
    onCreateProject: noopFn,
    onCreateAgent: noopFn,
    onOpenNewBrief: noopFn,
    onLogout: noopFn,
    onOpenConfigAssistant: noopFn,
    ...overrides,
  };
}

function groups(ctx: NavContext) {
  return new Set(buildNavItems(ctx).map((i) => i.group));
}

// ── Test 1: Workspace user (no orgs, no permissions) — only top + footer ──
test('workspace user sees only top and footer groups', () => {
  const ctx = baseCtx();
  const g = groups(ctx);
  assert.ok(g.has('top'));
  assert.ok(g.has('footer'));
  assert.ok(!g.has('work'));
  assert.ok(!g.has('organisation'));
  assert.ok(!g.has('platform'));
  assert.ok(!g.has('projects'));
  assert.ok(!g.has('agents'));
  assert.ok(!g.has('company'));
});

// ── Test 2: Org admin with no activeClientId — top + organisation + footer ──
test('org admin without activeClientId sees organisation group only', () => {
  const ctx = baseCtx({
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: null,
    hasOrgPerm: (key) => ['org.subaccounts.view', 'org.agents.view', 'org.users.view'].includes(key),
    hasSidebarItem: () => true,
  });
  const g = groups(ctx);
  assert.ok(g.has('top'));
  assert.ok(g.has('organisation'));
  assert.ok(g.has('footer'));
  assert.ok(!g.has('work'));
  assert.ok(!g.has('projects'));
  assert.ok(!g.has('agents'));
  assert.ok(!g.has('company'));
});

// ── Test 3: Org admin with activeClientId — full workspace nav ──
test('org admin with activeClientId sees full workspace nav', () => {
  const ctx = baseCtx({
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: 'client-123',
    viewMode: 'workspace',
    hasOrgPerm: (key) => [
      'org.subaccounts.view', 'org.agents.view', 'org.users.view',
      'org.workspace.view', 'org.review.view',
    ].includes(key),
    hasClientPerm: (key) => ['subaccount.review.view', 'subaccount.workspace.view'].includes(key),
    hasSidebarItem: () => true,
    navProjects: [{ id: 'p1', name: 'Project 1', color: '#000', status: 'active' }],
    navAgents: [{ id: 'a1', agentId: 'agent-1', name: 'Agent 1', icon: null }],
  });
  const g = groups(ctx);
  assert.ok(g.has('top'));
  assert.ok(g.has('work'));
  assert.ok(g.has('projects'));
  assert.ok(g.has('agents'));
  assert.ok(g.has('company'));
  assert.ok(g.has('organisation'));
  assert.ok(g.has('footer'));
});

// ── Test 4: System admin sees 'platform' group ──
test('system admin sees platform group', () => {
  const ctx = baseCtx({
    isSystemAdmin: true,
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: null,
  });
  const g = groups(ctx);
  assert.ok(g.has('platform'));
});

// ── Test 5: viewMode='org' suppresses workspace groups even with activeClientId ──
test("viewMode='org' suppresses workspace-only groups even when activeClientId is set", () => {
  const ctx = baseCtx({
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: 'client-456',
    viewMode: 'org',
    hasOrgPerm: (key) => [
      'org.subaccounts.view', 'org.agents.view', 'org.workspace.view',
    ].includes(key),
    hasClientPerm: () => false,
    hasSidebarItem: () => true,
    navProjects: [{ id: 'p2', name: 'Project 2', color: '#fff', status: 'active' }],
    navAgents: [{ id: 'a2', agentId: 'agent-2', name: 'Agent 2', icon: null }],
  });

  const items = buildNavItems(ctx);

  assert.equal(items.some((i) => i.group === 'work'), false);
  assert.equal(items.some((i) => i.group === 'projects'), false);
  assert.equal(items.some((i) => i.group === 'agents'), false);
  assert.equal(items.some((i) => i.group === 'company'), false);
});

// ── Test 6: empty-hint emitted when navProjects/navAgents are empty ──
test('empty navProjects/navAgents emit empty-hint items', () => {
  const ctx = baseCtx({
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: 'client-789',
    viewMode: 'workspace',
    hasOrgPerm: () => true,
    hasClientPerm: () => true,
    hasSidebarItem: () => true,
    navProjects: [],
    navAgents: [],
  });
  const items = buildNavItems(ctx);
  const projectsEmpty = items.find((i) => i.key === 'projects-empty');
  const agentsEmpty = items.find((i) => i.key === 'agents-empty');
  assert.ok(projectsEmpty);
  assert.equal(projectsEmpty?.kind, 'empty-hint');
  assert.ok(agentsEmpty);
  assert.equal(agentsEmpty?.kind, 'empty-hint');
});

// ── Test 7: group emission order matches canonical sequence ──
test('group emission order: top → work → projects → agents → company → clientpulse → organisation → footer (no platform for non-sysadmin)', () => {
  const ctx = baseCtx({
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: 'client-order',
    viewMode: 'workspace',
    hasOrgPerm: () => true,
    hasClientPerm: () => true,
    hasSidebarItem: () => true,
    navProjects: [{ id: 'p1', name: 'P1', color: '#f00', status: 'active' }],
    navAgents: [{ id: 'a1', agentId: 'ag1', name: 'A1', icon: null }],
    liveAgentCount: 1,
  });
  const items = buildNavItems(ctx);

  const seen: string[] = [];
  for (const item of items) {
    if (seen.length === 0 || seen[seen.length - 1] !== item.group) {
      seen.push(item.group);
    }
  }

  const expectedOrder = ['top', 'work', 'projects', 'agents', 'company', 'clientpulse', 'organisation', 'footer'];
  let lastIdx = -1;
  for (const group of seen) {
    const idx = expectedOrder.indexOf(group);
    assert.ok(idx !== -1, `group '${group}' is in the canonical order list`);
    assert.ok(idx > lastIdx, `group '${group}' appears after all earlier groups (lastIdx=${lastIdx})`);
    lastIdx = idx;
  }
  assert.ok(!seen.includes('platform'));
});
