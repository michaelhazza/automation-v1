// client/src/config/__tests__/buildNavItems.test.ts
// Pure tests for buildNavItems.
// Run with: npx tsx client/src/config/__tests__/buildNavItems.test.ts

import assert from 'node:assert/strict';
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
    activeClientName: null,
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

// ── Test 1: Workspace user (no orgs, no permissions) ─────────────────────
// Sees only 'top' + 'footer' groups.
{
  const ctx = baseCtx();
  const g = groups(ctx);
  assert.ok(g.has('top'), 'workspace user: top group present');
  assert.ok(g.has('footer'), 'workspace user: footer group present');
  assert.ok(!g.has('work'), 'workspace user: no work group');
  assert.ok(!g.has('organisation'), 'workspace user: no organisation group');
  assert.ok(!g.has('platform'), 'workspace user: no platform group');
  assert.ok(!g.has('projects'), 'workspace user: no projects group');
  assert.ok(!g.has('agents'), 'workspace user: no agents group');
  assert.ok(!g.has('company'), 'workspace user: no company group');
}

// ── Test 2: Org admin with no activeClientId ─────────────────────────────
// Sees 'top' + 'organisation' + 'footer'.
{
  const ctx = baseCtx({
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: null,
    hasOrgPerm: (key) => ['org.subaccounts.view', 'org.agents.view', 'org.users.view'].includes(key),
    hasSidebarItem: () => true,
  });
  const g = groups(ctx);
  assert.ok(g.has('top'), 'org admin (no client): top group present');
  assert.ok(g.has('organisation'), 'org admin (no client): organisation group present');
  assert.ok(g.has('footer'), 'org admin (no client): footer group present');
  assert.ok(!g.has('work'), 'org admin (no client): no work group');
  assert.ok(!g.has('projects'), 'org admin (no client): no projects group');
  assert.ok(!g.has('agents'), 'org admin (no client): no agents group');
  assert.ok(!g.has('company'), 'org admin (no client): no company group');
}

// ── Test 3: Org admin with activeClientId ────────────────────────────────
// Sees full workspace nav: top + work + projects + agents + company + organisation + footer.
{
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
  assert.ok(g.has('top'), 'full workspace: top group');
  assert.ok(g.has('work'), 'full workspace: work group');
  assert.ok(g.has('projects'), 'full workspace: projects group');
  assert.ok(g.has('agents'), 'full workspace: agents group');
  assert.ok(g.has('company'), 'full workspace: company group');
  assert.ok(g.has('organisation'), 'full workspace: organisation group');
  assert.ok(g.has('footer'), 'full workspace: footer group');
}

// ── Test 4: System admin sees 'platform' group ───────────────────────────
{
  const ctx = baseCtx({
    isSystemAdmin: true,
    hasOrgContext: true,
    hasAnyOrgPerm: true,
    activeClientId: null,
  });
  const g = groups(ctx);
  assert.ok(g.has('platform'), 'system admin: platform group present');
}

// ── Test 5: viewMode='org' suppresses workspace groups even with activeClientId ─
// Concrete assertions per spec:
//   - items.some(i => i.group === 'work') === false
//   - items.some(i => i.group === 'projects') === false
//   - items.some(i => i.group === 'agents') === false
{
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

  // viewMode='org' suppresses workspace-only groups even when activeClientId is set.
  assert.equal(
    items.some((i) => i.group === 'work'),
    false,
    'viewMode=org with activeClientId: work group suppressed',
  );
  assert.equal(
    items.some((i) => i.group === 'projects'),
    false,
    'viewMode=org with activeClientId: projects group suppressed',
  );
  assert.equal(
    items.some((i) => i.group === 'agents'),
    false,
    'viewMode=org with activeClientId: agents group suppressed',
  );
}

console.log('buildNavItems: all tests passed');
