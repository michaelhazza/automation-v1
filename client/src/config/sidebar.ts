// client/src/config/sidebar.ts
//
// Config-driven nav specification.  Layout.tsx calls buildNavItems(ctx) to
// obtain the ordered list of nav items to render; it keeps the JSX renderer
// so that Tailwind classes and icon components stay in one place.
//
// INVARIANT: NavGroup declaration order IS the visual render order.
// MUST emit items in this group sequence:
//   top → personal → work → projects → agents → company → clientpulse → organisation → support → platform → footer
// Reordering this union (or sorting the output by anything other than this
// sequence) is a visual regression.

import { buildRoute, staticRoute } from './routes.js';
import type { AppRoute } from './routes.js';

export type NavGroup =
  | 'top'           // Home / New Task — above named sections
  | 'personal'      // user-owned personal agents
  | 'work'          // workspace-mode work items
  | 'projects'      // dynamic project list
  | 'agents'        // dynamic agent list
  | 'company'       // company items
  | 'clientpulse'
  | 'organisation'
  | 'support'       // Support Desk section
  | 'platform'      // system-admin section
  | 'footer';       // profile, sign-out

export interface NavItemSpec {
  group: NavGroup;
  kind: 'link' | 'button' | 'section-header' | 'empty-hint';
  key: string;
  label?: string;
  to?: AppRoute;
  iconKey?: string;
  badge?: number;
  badgeLabel?: string;
  exact?: boolean;
  manageTo?: AppRoute;
  onClick?: () => void;
}

export interface NavContext {
  isSystemAdmin: boolean;
  hasOrgContext: boolean;
  hasAnyOrgPerm: boolean;
  activeClientId: string | null;
  hasOrgPerm: (key: string) => boolean;
  hasClientPerm: (key: string) => boolean;
  hasSidebarItem: (slug: string) => boolean;
  viewMode: 'workspace' | 'org' | 'system';
  navProjects: Array<{ id: string; name: string; color: string; status: string }>;
  navAgents: Array<{ id: string; agentId: string; name: string; icon: string | null }>;
  userOwnedAgents: Array<{ agentId: string; name: string }>;
  reviewCount: number;
  liveAgentCount: number;
  incidentCount: number;
  onCreateProject: () => void;
  onCreateAgent: () => void;
  onOpenNewBrief: () => void;
  onLogout: () => void;
  onOpenConfigAssistant: () => void;
}

/**
 * Build the ordered list of nav item specs from the current context.
 * The output order is stable and matches the historical visual order.
 */
export function buildNavItems(ctx: NavContext): NavItemSpec[] {
  const items: NavItemSpec[] = [];
  const {
    isSystemAdmin, hasOrgContext, hasAnyOrgPerm,
    activeClientId, hasOrgPerm, hasClientPerm, hasSidebarItem,
    viewMode, navProjects, navAgents, userOwnedAgents,
    reviewCount, liveAgentCount, incidentCount,
    onCreateProject, onCreateAgent, onOpenNewBrief, onLogout,
    onOpenConfigAssistant,
  } = ctx;

  // ── top group ────────────────────────────────────────────────────────────
  if (hasOrgContext && activeClientId) {
    // New Task button
    items.push({
      group: 'top',
      kind: 'button',
      key: 'new-task',
      label: 'New Task',
      iconKey: 'bolt',
      onClick: onOpenNewBrief,
    });
    // Home — only with review permission
    if (hasClientPerm('subaccount.review.view') || hasOrgPerm('org.review.view')) {
      items.push({
        group: 'top',
        kind: 'link',
        key: 'home',
        label: 'Home',
        to: staticRoute('/'),
        iconKey: 'inbox',
        badge: reviewCount,
      });
    }
  } else {
    // Fallback Home when no client selected
    items.push({
      group: 'top',
      kind: 'link',
      key: 'home',
      label: 'Home',
      to: staticRoute('/'),
      iconKey: 'inbox',
    });
  }

  // ── personal group — user-owned agents ──────────────────────────────────
  if (userOwnedAgents.length > 0) {
    items.push({ group: 'personal', kind: 'section-header', key: 'personal-header', label: 'Personal' });
    for (const a of userOwnedAgents) {
      items.push({
        group: 'personal',
        kind: 'link',
        key: `personal-agent-${a.agentId}`,
        label: a.name,
        to: buildRoute('/personal/:agentId', { agentId: a.agentId }),
        iconKey: 'agents',
      });
    }
  }

  // ── work group — only in workspace mode ─────────────────────────────────
  if (hasOrgContext && activeClientId && viewMode === 'workspace') {
    items.push({ group: 'work', kind: 'section-header', key: 'work-header', label: 'Work' });

    if (hasClientPerm('subaccount.workspace.view') || hasOrgPerm('org.workspace.view')) {
      items.push({
        group: 'work',
        kind: 'link',
        key: 'tasks',
        label: 'Tasks',
        to: buildRoute('/admin/subaccounts/:subaccountId/workspace', { subaccountId: activeClientId }),
        iconKey: 'tasks',
      });
    }
    if (hasOrgPerm('org.automations.view')) {
      items.push({
        group: 'work',
        kind: 'link',
        key: 'automations',
        label: 'Automations',
        to: staticRoute('/automations'),
        iconKey: 'automations',
      });
    }
    if (hasOrgPerm('org.agents.view') || hasOrgPerm('org.workflow_templates.read')) {
      items.push({
        group: 'work',
        kind: 'link',
        key: 'workflows',
        label: 'Workflows',
        to: staticRoute('/workflows'),
        iconKey: 'automations',
      });
    }
    if (hasClientPerm('subaccount.workspace.view') || hasOrgPerm('org.workspace.view')) {
      items.push({
        group: 'work',
        kind: 'link',
        key: 'calendar',
        label: 'Calendar',
        to: buildRoute('/admin/subaccounts/:subaccountId/schedule-calendar', { subaccountId: activeClientId }),
        iconKey: 'scheduled',
      });
    }
    if (hasClientPerm('subaccount.workspace.view') || hasOrgPerm('org.workspace.view')) {
      items.push({
        group: 'work',
        kind: 'link',
        key: 'sites',
        label: 'Sites',
        to: buildRoute('/admin/subaccounts/:subaccountId/page-projects', { subaccountId: activeClientId }),
        iconKey: 'portal',
      });
    }
    if (hasClientPerm('subaccount.workspace.view') || hasOrgPerm('org.workspace.view')) {
      items.push({
        group: 'work',
        kind: 'link',
        key: 'action-log',
        label: 'Action Log',
        to: buildRoute('/admin/subaccounts/:subaccountId/actions', { subaccountId: activeClientId }),
        iconKey: 'activity',
      });
    }
    // Knowledge page calls /api/knowledge which is gated by org.agents.view
    // (memory_blocks are extracted by agents). Keep the sidebar gate aligned
    // with the route to avoid showing a 403 link.
    if (hasOrgPerm('org.agents.view') || isSystemAdmin) {
      items.push({
        group: 'work',
        kind: 'link',
        key: 'knowledge',
        label: 'Knowledge',
        to: staticRoute('/knowledge'),
        iconKey: 'skills',
      });
    }
  }

  // ── projects group — only in workspace mode ──────────────────────────────
  if (hasOrgContext && activeClientId && viewMode === 'workspace') {
    items.push({
      group: 'projects',
      kind: 'section-header',
      key: 'projects-header',
      label: 'Projects',
      onClick: onCreateProject, // signals the + button
    });
    if (navProjects.length === 0) {
      items.push({ group: 'projects', kind: 'empty-hint', key: 'projects-empty', label: 'No projects yet' });
    }
    for (const p of navProjects) {
      items.push({
        group: 'projects',
        kind: 'link',
        key: `project-${p.id}`,
        label: p.name,
        to: buildRoute('/projects/:id', { id: p.id }),
        // color dot rendered by Layout renderer using the project-dot: prefix
        iconKey: `project-dot:${p.color}`,
      });
    }
  }

  // ── agents group — only in workspace mode ────────────────────────────────
  if (hasOrgContext && activeClientId && viewMode === 'workspace') {
    items.push({
      group: 'agents',
      kind: 'section-header',
      key: 'agents-header',
      label: 'Agents',
      onClick: onCreateAgent, // signals the + button
    });
    if (navAgents.length === 0) {
      items.push({ group: 'agents', kind: 'empty-hint', key: 'agents-empty', label: 'No agents yet' });
    }
    for (const a of navAgents) {
      items.push({
        group: 'agents',
        kind: 'link',
        key: `agent-${a.id}`,
        label: a.name,
        to: buildRoute('/agents/:agentId', { agentId: a.agentId }),
        iconKey: a.icon ? `emoji:${a.icon}` : 'agents',
        manageTo: buildRoute('/agents/:id/edit', { id: a.agentId }),
      });
    }
  }

  // ── company group — only in workspace mode ───────────────────────────────
  if (hasOrgContext && activeClientId && viewMode === 'workspace') {
    items.push({ group: 'company', kind: 'section-header', key: 'company-header', label: 'Company' });

    if (hasClientPerm('subaccount.workspace.view') || hasOrgPerm('org.workspace.view')) {
      items.push({
        group: 'company',
        kind: 'link',
        key: 'goals',
        label: 'Goals',
        to: buildRoute('/admin/subaccounts/:subaccountId/goals', { subaccountId: activeClientId }),
        iconKey: 'goals',
      });
    }
    if (hasSidebarItem('agents') && hasOrgPerm('org.agents.view')) {
      items.push({
        group: 'company',
        kind: 'link',
        key: 'org-chart',
        label: 'Org Chart',
        to: staticRoute('/org-chart'),
        iconKey: 'orgs',
      });
    }
    if (hasSidebarItem('companies') && hasOrgPerm('org.subaccounts.view')) {
      items.push({
        group: 'company',
        kind: 'link',
        key: 'portal',
        label: 'Portal',
        to: buildRoute('/portal/:clientId', { clientId: activeClientId }),
        iconKey: 'portal',
      });
    }
    if (hasSidebarItem('companies')) {
      items.push({
        group: 'company',
        kind: 'link',
        key: 'team',
        label: 'Team',
        to: buildRoute('/admin/subaccounts/:subaccountId/team', { subaccountId: activeClientId }),
        iconKey: 'team',
      });
    }
    if (hasSidebarItem('companies') && hasOrgPerm('org.subaccounts.edit')) {
      items.push({
        group: 'company',
        kind: 'link',
        key: 'manage-company',
        label: 'Manage',
        to: buildRoute('/admin/subaccounts/:subaccountId', { subaccountId: activeClientId }),
        iconKey: 'settings',
        exact: true,
      });
    }
  }

  // ── clientpulse group ────────────────────────────────────────────────────
  if (hasOrgContext && hasSidebarItem('clientpulse')) {
    items.push({ group: 'clientpulse', kind: 'section-header', key: 'clientpulse-header', label: 'ClientPulse' });
    items.push({
      group: 'clientpulse',
      kind: 'link',
      key: 'clientpulse-dashboard',
      label: 'Dashboard',
      to: staticRoute('/clientpulse'),
      iconKey: 'dashboard',
      exact: true,
      badge: liveAgentCount > 0 ? liveAgentCount : undefined,
      badgeLabel: liveAgentCount > 0 ? `${liveAgentCount} live` : undefined,
    });
    if (hasSidebarItem('reports')) {
      items.push({
        group: 'clientpulse',
        kind: 'link',
        key: 'clientpulse-reports',
        label: 'Reports',
        to: staticRoute('/reports'),
        iconKey: 'skills',
      });
    }
    items.push({
      group: 'clientpulse',
      kind: 'link',
      key: 'clientpulse-settings',
      label: 'ClientPulse Settings',
      to: staticRoute('/clientpulse/settings'),
      iconKey: 'settings',
    });
  }

  // ── organisation group ───────────────────────────────────────────────────
  if (hasOrgContext && hasAnyOrgPerm) {
    items.push({ group: 'organisation', kind: 'section-header', key: 'org-header', label: 'Organisation' });

    if (hasSidebarItem('companies') && hasOrgPerm('org.subaccounts.view')) {
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'companies',
        label: 'Companies',
        to: staticRoute('/admin/subaccounts'),
        iconKey: 'clients',
        exact: true,
      });
    }
    if (hasSidebarItem('config_assistant')) {
      items.push({
        group: 'organisation',
        kind: 'button',
        key: 'config-assistant',
        label: 'Configuration Assistant',
        iconKey: 'settings',
        onClick: onOpenConfigAssistant,
      });
    }
    if (hasSidebarItem('agents') && hasOrgPerm('org.agents.view')) {
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'admin-agents',
        label: 'Agents',
        to: staticRoute('/agents'),
        iconKey: 'agents',
      });
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'recurring-tasks',
        label: 'Recurring tasks',
        to: staticRoute('/recurring-tasks'),
        iconKey: 'scheduled',
      });
    }
    if (hasOrgPerm('org.agents.view')) {
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'admin-calendar',
        label: 'Calendar',
        to: staticRoute('/admin/schedule-calendar'),
        iconKey: 'scheduled',
      });
    }
    if (hasSidebarItem('workflows') && hasOrgPerm('org.automations.view')) {
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'admin-automations',
        label: 'Automations',
        to: staticRoute('/admin/automations'),
        iconKey: 'automations',
      });
    }
    if (hasSidebarItem('team') && hasOrgPerm('org.users.view')) {
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'admin-users',
        label: 'Team',
        to: staticRoute('/admin/users'),
        iconKey: 'team',
      });
    }
    if (hasSidebarItem('team') && hasOrgPerm('org.teams.manage')) {
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'admin-teams',
        label: 'Teams',
        to: staticRoute('/admin/teams'),
        iconKey: 'team',
      });
    }
    if (hasSidebarItem('health') && hasOrgPerm('org.health_audit.view')) {
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'admin-health',
        label: 'Health',
        to: staticRoute('/admin/health-findings'),
        iconKey: 'diagnostic',
      });
    }
    if (
      hasSidebarItem('manage_org') &&
      (hasOrgPerm('org.categories.view') || hasOrgPerm('org.engines.view') || hasOrgPerm('org.mcp_servers.view') || isSystemAdmin)
    ) {
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'admin-org-settings',
        label: 'Manage',
        to: staticRoute('/admin/org-settings'),
        iconKey: 'settings',
      });
    }
    if (hasOrgPerm('org.scorecards.view') || isSystemAdmin) {
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'quality',
        label: 'Quality',
        to: staticRoute('/quality'),
        iconKey: 'skills',
      });
    }
    if (hasOrgPerm('org.spend.admin') || hasOrgPerm('spend_approver')) {
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'spending',
        label: 'Spending',
        to: staticRoute('/spending'),
        iconKey: 'usage',
      });
    }
    if (hasOrgPerm('org.connections.view') || isSystemAdmin) {
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'connections',
        label: 'Connections',
        to: staticRoute('/connections'),
        iconKey: 'settings',
      });
    }
  }

  // ── support group — Support Desk canonical substrate (C13) ─────────────
  if (hasOrgContext && (hasOrgPerm('support.draft.approve') || hasOrgPerm('support.draft.reject') || hasOrgPerm('support.inbox.configure'))) {
    items.push({ group: 'support', kind: 'section-header', key: 'support-header', label: 'Support Desk' });
    items.push({ group: 'support', kind: 'link', key: 'support-tickets', label: 'Tickets', to: staticRoute('/support/tickets'), iconKey: 'inbox' });
    items.push({ group: 'support', kind: 'link', key: 'support-drafts', label: 'Draft Review', to: staticRoute('/support/drafts'), iconKey: 'tasks' });
    items.push({ group: 'support', kind: 'link', key: 'support-inboxes', label: 'Inboxes', to: staticRoute('/support/inboxes'), iconKey: 'settings' });
  }

  // ── platform group — system admin ────────────────────────────────────────
  if (isSystemAdmin) {
    items.push({ group: 'platform', kind: 'section-header', key: 'platform-header', label: 'Platform' });
    items.push({ group: 'platform', kind: 'link', key: 'sys-orgs', label: 'Organisations', to: staticRoute('/system/organisations'), iconKey: 'orgs' });
    items.push({ group: 'platform', kind: 'link', key: 'sys-agents', label: 'Agents', to: staticRoute('/agents'), iconKey: 'agents' });
    items.push({ group: 'platform', kind: 'link', key: 'sys-skills', label: 'Skills', to: staticRoute('/system/skills'), iconKey: 'skills' });
    items.push({ group: 'platform', kind: 'link', key: 'sys-workflow-studio', label: 'Workflow Studio', to: staticRoute('/system/workflow-studio'), iconKey: 'automations' });
    items.push({ group: 'platform', kind: 'link', key: 'sys-automations', label: 'Automations', to: staticRoute('/system/automations'), iconKey: 'automations' });
    items.push({ group: 'platform', kind: 'link', key: 'sys-activity', label: 'Activity', to: staticRoute('/system/activity'), iconKey: 'activity' });
    items.push({ group: 'platform', kind: 'link', key: 'sys-incidents', label: 'Incidents', to: staticRoute('/system/incidents'), iconKey: 'diagnostic', badge: incidentCount });
    items.push({ group: 'platform', kind: 'link', key: 'sys-task-queue', label: 'Diagnostics', to: staticRoute('/system/task-queue'), iconKey: 'diagnostic' });
    items.push({ group: 'platform', kind: 'link', key: 'sys-job-queues', label: 'Job Queues', to: staticRoute('/system/job-queues'), iconKey: 'diagnostic' });
    items.push({ group: 'platform', kind: 'link', key: 'sys-llm-pnl', label: 'LLM P&L', to: staticRoute('/system/llm-pnl'), iconKey: 'usage' });
    items.push({ group: 'platform', kind: 'link', key: 'sys-settings', label: 'Settings', to: staticRoute('/system/settings'), iconKey: 'settings' });
  }

  // ── footer group ─────────────────────────────────────────────────────────
  items.push({
    group: 'footer',
    kind: 'link',
    key: 'profile-settings',
    label: 'Profile Settings',
    to: staticRoute('/settings'),
    iconKey: 'settings',
    exact: true,
  });
  items.push({
    group: 'footer',
    kind: 'button',
    key: 'sign-out',
    label: 'Sign out',
    iconKey: 'logout',
    onClick: onLogout,
  });

  return items;
}
