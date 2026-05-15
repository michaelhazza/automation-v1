// client/src/config/__tests__/buildNavItems.test.ts
// Pure tests for buildNavItems.
// Run via vitest (CI) or `npx vitest run client/src/config/__tests__/buildNavItems.test.ts` locally.

import { test, expect } from 'vitest';
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
    userOwnedAgents: [],
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
  expect(g.has('top')).toBe(true);
  expect(g.has('footer')).toBe(true);
  expect(g.has('work')).toBe(false);
  expect(g.has('organisation')).toBe(false);
  expect(g.has('platform')).toBe(false);
  expect(g.has('projects')).toBe(false);
  expect(g.has('agents')).toBe(false);
  expect(g.has('company')).toBe(false);
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
  expect(g.has('top')).toBe(true);
  expect(g.has('organisation')).toBe(true);
  expect(g.has('footer')).toBe(true);
  expect(g.has('work')).toBe(false);
  expect(g.has('projects')).toBe(false);
  expect(g.has('agents')).toBe(false);
  expect(g.has('company')).toBe(false);
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
  expect(g.has('top')).toBe(true);
  expect(g.has('work')).toBe(true);
  expect(g.has('projects')).toBe(true);
  expect(g.has('agents')).toBe(true);
  expect(g.has('company')).toBe(true);
  expect(g.has('organisation')).toBe(true);
  expect(g.has('footer')).toBe(true);
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
  expect(g.has('platform')).toBe(true);
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

  expect(items.some((i) => i.group === 'work')).toBe(false);
  expect(items.some((i) => i.group === 'projects')).toBe(false);
  expect(items.some((i) => i.group === 'agents')).toBe(false);
  expect(items.some((i) => i.group === 'company')).toBe(false);
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
  expect(projectsEmpty).toBeDefined();
  expect(projectsEmpty?.kind).toBe('empty-hint');
  expect(agentsEmpty).toBeDefined();
  expect(agentsEmpty?.kind).toBe('empty-hint');
});

// ── Test 8: workspace user with no projects/agents — empty-hint only ──
test('workspace user with no projects or agents sees empty-hint items in both sections', () => {
  const ctx = baseCtx({
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: 'client-empty',
    viewMode: 'workspace',
    hasOrgPerm: () => true,
    hasClientPerm: () => true,
    hasSidebarItem: () => true,
    navProjects: [],
    navAgents: [],
  });
  const items = buildNavItems(ctx);
  const projectItems = items.filter((i) => i.group === 'projects');
  const agentItems = items.filter((i) => i.group === 'agents');
  // Only header + empty-hint
  expect(projectItems.some((i) => i.kind === 'empty-hint')).toBe(true);
  expect(projectItems.every((i) => i.kind === 'section-header' || i.kind === 'empty-hint')).toBe(true);
  expect(agentItems.some((i) => i.kind === 'empty-hint')).toBe(true);
  expect(agentItems.every((i) => i.kind === 'section-header' || i.kind === 'empty-hint')).toBe(true);
});

// ── Test 9: org admin in system view — no Build group rows ──
test('org admin in org viewMode sees no workspace-only groups', () => {
  const ctx = baseCtx({
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: 'client-sys',
    viewMode: 'org',
    hasOrgPerm: (key) => ['org.agents.view', 'org.subaccounts.view', 'org.workspace.view'].includes(key),
    hasClientPerm: () => false,
    hasSidebarItem: () => true,
  });
  const g = groups(ctx);
  expect(g.has('work')).toBe(false);
  expect(g.has('projects')).toBe(false);
  expect(g.has('agents')).toBe(false);
  expect(g.has('company')).toBe(false);
  expect(g.has('organisation')).toBe(true);
});

// ── Test 10: system admin in workspace mode of a specific client ──
test('system admin in workspace mode sees platform group alongside workspace groups', () => {
  const ctx = baseCtx({
    isSystemAdmin: true,
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: 'client-xyz',
    viewMode: 'workspace',
    hasOrgPerm: () => true,
    hasClientPerm: () => true,
    hasSidebarItem: () => true,
    navProjects: [{ id: 'p1', name: 'Project A', color: '#abc', status: 'active' }],
    navAgents: [{ id: 'a1', agentId: 'agent-x', name: 'Agent X', icon: null }],
  });
  const g = groups(ctx);
  expect(g.has('work')).toBe(true);
  expect(g.has('projects')).toBe(true);
  expect(g.has('agents')).toBe(true);
  expect(g.has('company')).toBe(true);
  expect(g.has('platform')).toBe(true);
  expect(g.has('organisation')).toBe(true);
});

// ── Test 7: group emission order matches canonical sequence ──
test('group emission order: top → personal → work → projects → agents → company → clientpulse → organisation → support → footer (no platform for non-sysadmin)', () => {
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
    userOwnedAgents: [{ agentId: 'ea-1', name: 'My Assistant' }],
    liveAgentCount: 1,
  });
  const items = buildNavItems(ctx);

  const seen: string[] = [];
  for (const item of items) {
    if (seen.length === 0 || seen[seen.length - 1] !== item.group) {
      seen.push(item.group);
    }
  }

  const expectedOrder = ['top', 'personal', 'work', 'projects', 'agents', 'company', 'clientpulse', 'organisation', 'support', 'footer'];
  let lastIdx = -1;
  for (const group of seen) {
    const idx = expectedOrder.indexOf(group);
    expect(idx).not.toBe(-1);
    expect(idx).toBeGreaterThan(lastIdx);
    lastIdx = idx;
  }
  expect(seen.includes('platform')).toBe(false);
});

// ── Test 11: personal group appears before work group when userOwnedAgents non-empty ──
test('personal group items appear before work group items when userOwnedAgents.length > 0', () => {
  const ctx = baseCtx({
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: 'client-personal-order',
    viewMode: 'workspace',
    hasOrgPerm: () => true,
    hasClientPerm: () => true,
    hasSidebarItem: () => true,
    userOwnedAgents: [{ agentId: 'ea-1', name: 'My Assistant' }],
    navProjects: [],
    navAgents: [],
  });
  const items = buildNavItems(ctx);

  const firstPersonalIdx = items.findIndex((i) => i.group === 'personal');
  const firstWorkIdx = items.findIndex((i) => i.group === 'work');

  expect(firstPersonalIdx).not.toBe(-1);
  expect(firstWorkIdx).not.toBe(-1);
  expect(firstPersonalIdx).toBeLessThan(firstWorkIdx);
});

// ── Test 12: no personal group items emitted when userOwnedAgents is empty ──
test('no personal group items are emitted when userOwnedAgents.length === 0', () => {
  const ctx = baseCtx({
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: 'client-no-personal',
    viewMode: 'workspace',
    hasOrgPerm: () => true,
    hasClientPerm: () => true,
    hasSidebarItem: () => true,
    userOwnedAgents: [],
    navProjects: [],
    navAgents: [],
  });
  const items = buildNavItems(ctx);

  expect(items.some((i) => i.group === 'personal')).toBe(false);
});
