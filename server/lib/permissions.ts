/**
 * Atomic permission keys for the Automation OS permission system.
 *
 * Org-level permissions are checked against a user's org_user_roles entry.
 * Subaccount-level permissions are checked against subaccount_user_assignments.
 * system_admin users bypass all permission checks.
 */

// ─── Org-level permissions ────────────────────────────────────────────────────

export const ORG_PERMISSIONS = {
  // Automations
  AUTOMATIONS_VIEW: 'org.automations.view',
  AUTOMATIONS_CREATE: 'org.automations.create',
  AUTOMATIONS_EDIT: 'org.automations.edit',
  AUTOMATIONS_DELETE: 'org.automations.delete',
  AUTOMATIONS_ACTIVATE: 'org.automations.activate',
  AUTOMATIONS_TEST: 'org.automations.test',
  // Executions
  EXECUTIONS_VIEW: 'org.executions.view',
  EXECUTIONS_MANAGE: 'org.executions.manage',
  // Users
  USERS_VIEW: 'org.users.view',
  USERS_INVITE: 'org.users.invite',
  USERS_EDIT: 'org.users.edit',
  USERS_DELETE: 'org.users.delete',
  // Workflow engines
  ENGINES_VIEW: 'org.engines.view',
  ENGINES_MANAGE: 'org.engines.manage',
  // System automation visibility
  AUTOMATIONS_VIEW_SYSTEM: 'org.automations.view_system',
  AUTOMATIONS_CLONE: 'org.automations.clone',
  // Org-level connections
  CONNECTIONS_VIEW: 'org.connections.view',
  CONNECTIONS_MANAGE: 'org.connections.manage',
  // Automation categories
  CATEGORIES_VIEW: 'org.categories.view',
  CATEGORIES_MANAGE: 'org.categories.manage',
  // Subaccounts
  SUBACCOUNTS_VIEW: 'org.subaccounts.view',
  SUBACCOUNTS_CREATE: 'org.subaccounts.create',
  SUBACCOUNTS_EDIT: 'org.subaccounts.edit',
  SUBACCOUNTS_DELETE: 'org.subaccounts.delete',
  // Permission sets
  PERMISSION_SETS_MANAGE: 'org.permission_sets.manage',
  // Settings / billing / usage
  SETTINGS_VIEW: 'org.settings.view',
  SETTINGS_EDIT: 'org.settings.edit',
  // AI Agents
  AGENTS_VIEW: 'org.agents.view',
  AGENTS_CREATE: 'org.agents.create',
  AGENTS_EDIT: 'org.agents.edit',
  AGENTS_DELETE: 'org.agents.delete',
  AGENTS_CHAT: 'org.agents.chat',
  // Scheduled task data sources (migration 0078 / spec §10)
  SCHEDULED_TASKS_DATA_SOURCES_MANAGE: 'org.scheduled_tasks.data_sources.manage',
  // Workspace
  WORKSPACE_VIEW: 'org.workspace.view',
  WORKSPACE_MANAGE: 'org.workspace.manage',
  // Review
  REVIEW_VIEW: 'org.review.view',
  REVIEW_APPROVE: 'org.review.approve',
  // MCP Servers
  MCP_SERVERS_VIEW: 'org.mcp_servers.view',
  MCP_SERVERS_MANAGE: 'org.mcp_servers.manage',
  // ── IEE — Integrated Execution Environment (rev 6 §11.5.3) ──────────────
  IEE_USAGE_VIEW: 'org.billing.iee.view',
  // ── Workflows (multi-step automation; spec §8.1) ────────────────────────
  WORKFLOW_TEMPLATES_READ: 'org.workflow_templates.read',
  WORKFLOW_TEMPLATES_WRITE: 'org.workflow_templates.write',
  WORKFLOW_TEMPLATES_PUBLISH: 'org.workflow_templates.publish',
  WORKFLOW_STUDIO_ACCESS: 'org.workflow_studio.access',
  // Org-scope workflow runs (migration 0171 / ClientPulse §13.3). Distinct from
  // SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_START because org-scope runs operate
  // across the whole organisation rather than a single subaccount.
  WORKFLOW_RUNS_START: 'org.workflow_runs.start',
  // ── Workspace health audit (Brain Tree OS adoption P4) ──────────────────
  HEALTH_AUDIT_VIEW: 'org.health_audit.view',
  HEALTH_AUDIT_RESOLVE: 'org.health_audit.resolve',
  // ── GEO audits (Generative Engine Optimisation) ─────────────────────────
  GEO_AUDIT_VIEW: 'org.geo_audit.view',
  GEO_AUDIT_RUN: 'org.geo_audit.run',
  // ── Universal Brief (Phase 2) ────────────────────────────────────────────
  BRIEFS_READ: 'org.briefs.read',
  BRIEFS_WRITE: 'org.briefs.write',
  RULES_READ: 'org.rules.read',
  RULES_WRITE: 'org.rules.write',
  RULES_SET_AUTHORITATIVE: 'org.rules.set_authoritative',
  // ── Observability (delegation outcomes; paperclip-hierarchy spec) ───────────
  ORG_OBSERVABILITY_VIEW: 'org.observability.view',
  // ── Cached Context Infrastructure ────────────────────────────────────────
  REFERENCE_DOCUMENTS_READ:       'reference_documents.read',
  REFERENCE_DOCUMENTS_WRITE:      'reference_documents.write',
  REFERENCE_DOCUMENTS_DEPRECATE:  'reference_documents.deprecate',
  DOCUMENT_BUNDLES_READ:          'document_bundles.read',
  DOCUMENT_BUNDLES_WRITE:         'document_bundles.write',
  DOCUMENT_BUNDLES_ATTACH:        'document_bundles.attach',
} as const;

// ─── System-level permissions (sysadmin-only surfaces) ───────────────────────
// In Phase 0.5 all incident endpoints require requireSystemAdmin directly so
// these keys exist primarily for audit-trail labels and future delegation.

export const SYSTEM_PERMISSIONS = {
  INCIDENT_VIEW: 'system:incident:view',
  INCIDENT_ACK: 'system:incident:ack',
  INCIDENT_RESOLVE: 'system:incident:resolve',
  INCIDENT_SUPPRESS: 'system:incident:suppress',
  INCIDENT_ESCALATE: 'system:incident:escalate',
} as const;

// ─── Subaccount-level permissions ─────────────────────────────────────────────

export const SUBACCOUNT_PERMISSIONS = {
  // Automations
  AUTOMATIONS_VIEW: 'subaccount.automations.view',
  AUTOMATIONS_EXECUTE: 'subaccount.automations.execute',
  AUTOMATIONS_CREATE: 'subaccount.automations.create',
  AUTOMATIONS_EDIT: 'subaccount.automations.edit',
  AUTOMATIONS_DELETE: 'subaccount.automations.delete',
  // Executions
  EXECUTIONS_VIEW: 'subaccount.executions.view',
  EXECUTIONS_VIEW_ALL: 'subaccount.executions.view_all',
  EXECUTIONS_MANAGE: 'subaccount.executions.manage',
  // Members
  USERS_VIEW: 'subaccount.users.view',
  USERS_INVITE: 'subaccount.users.invite',
  USERS_EDIT: 'subaccount.users.edit',
  USERS_REMOVE: 'subaccount.users.remove',
  // Categories
  CATEGORIES_MANAGE: 'subaccount.categories.manage',
  // Connections
  CONNECTIONS_VIEW: 'subaccount.connections.view',
  CONNECTIONS_MANAGE: 'subaccount.connections.manage',
  // Automation configuration (connection mappings, config overrides)
  AUTOMATIONS_CLONE: 'subaccount.automations.clone',
  AUTOMATIONS_CONFIGURE: 'subaccount.automations.configure',
  // Settings
  SETTINGS_EDIT: 'subaccount.settings.edit',
  // Workspace
  WORKSPACE_VIEW: 'subaccount.workspace.view',
  WORKSPACE_MANAGE: 'subaccount.workspace.manage',
  // Review
  REVIEW_VIEW: 'subaccount.review.view',
  REVIEW_APPROVE: 'subaccount.review.approve',
  // ── IEE — Integrated Execution Environment (rev 6 §11.5.3) ──────────────
  IEE_USAGE_VIEW: 'subaccount.billing.iee.view',
  // ── Workflows (multi-step automation; spec §8.1) ────────────────────────
  WORKFLOW_RUNS_READ: 'subaccount.workflow_runs.read',
  WORKFLOW_RUNS_START: 'subaccount.workflow_runs.start',
  WORKFLOW_RUNS_CANCEL: 'subaccount.workflow_runs.cancel',
  WORKFLOW_RUNS_EDIT_OUTPUT: 'subaccount.workflow_runs.edit_output',
  WORKFLOW_RUNS_APPROVE: 'subaccount.workflow_runs.approve',
  // Skills (subaccount-scoped skill management; migration 0117)
  SKILLS_VIEW: 'subaccount.skills.view',
  SKILLS_MANAGE: 'subaccount.skills.manage',
  // Schedule visibility (Scheduled Runs Calendar portal surface; Feature 1
  // of docs/routines-response-dev-spec.md §3.4). Grants client users the
  // "Upcoming Work" card path without granting general workspace.view.
  SCHEDULE_VIEW_CALENDAR: 'subaccount.schedule.view_calendar',
  // Workspace identity (agents-as-employees; migration 0257)
  WORKSPACE_CONNECTOR_MANAGE: 'subaccount.workspace.manage_connector',
  AGENTS_ONBOARD: 'subaccount.agents.onboard',
  AGENTS_MANAGE_LIFECYCLE: 'subaccount.agents.manage_lifecycle',
  AGENTS_TOGGLE_EMAIL: 'subaccount.agents.toggle_email',
  AGENTS_VIEW_MAILBOX: 'subaccount.agents.view_mailbox',
  AGENTS_VIEW_CALENDAR: 'subaccount.agents.view_calendar',
  AGENTS_VIEW_ACTIVITY: 'subaccount.agents.view_activity',
} as const;

export type OrgPermissionKey = typeof ORG_PERMISSIONS[keyof typeof ORG_PERMISSIONS];
export type SubaccountPermissionKey = typeof SUBACCOUNT_PERMISSIONS[keyof typeof SUBACCOUNT_PERMISSIONS];
export type PermissionKey = OrgPermissionKey | SubaccountPermissionKey;

// ─── Full permission catalogue (for DB seeding) ───────────────────────────────

export const ALL_PERMISSIONS: Array<{ key: string; description: string; groupName: string }> = [
  // org.automations
  { key: ORG_PERMISSIONS.AUTOMATIONS_VIEW,     description: 'View org automations',              groupName: 'org.automations' },
  { key: ORG_PERMISSIONS.AUTOMATIONS_CREATE,   description: 'Create org automations',            groupName: 'org.automations' },
  { key: ORG_PERMISSIONS.AUTOMATIONS_EDIT,     description: 'Edit org automations',              groupName: 'org.automations' },
  { key: ORG_PERMISSIONS.AUTOMATIONS_DELETE,   description: 'Delete org automations',            groupName: 'org.automations' },
  { key: ORG_PERMISSIONS.AUTOMATIONS_ACTIVATE, description: 'Activate/deactivate automations',   groupName: 'org.automations' },
  { key: ORG_PERMISSIONS.AUTOMATIONS_TEST,     description: 'Test-execute automations',          groupName: 'org.automations' },
  // org.automations (system visibility + clone)
  { key: ORG_PERMISSIONS.AUTOMATIONS_VIEW_SYSTEM, description: 'View system automations available to this org', groupName: 'org.automations' },
  { key: ORG_PERMISSIONS.AUTOMATIONS_CLONE,       description: 'Clone a system automation into the org',        groupName: 'org.automations' },
  // org.connections
  { key: ORG_PERMISSIONS.CONNECTIONS_VIEW,   description: 'View connection status across subaccounts', groupName: 'org.connections' },
  { key: ORG_PERMISSIONS.CONNECTIONS_MANAGE, description: 'Create/edit/revoke org-level connections', groupName: 'org.connections' },
  // org.executions
  { key: ORG_PERMISSIONS.EXECUTIONS_VIEW, description: 'View all org executions',    groupName: 'org.executions' },
  { key: ORG_PERMISSIONS.EXECUTIONS_MANAGE, description: 'Manage executions (approve, acknowledge failures)', groupName: 'org.executions' },
  // org.users
  { key: ORG_PERMISSIONS.USERS_VIEW,   description: 'View org users',               groupName: 'org.users' },
  { key: ORG_PERMISSIONS.USERS_INVITE, description: 'Invite users to org',          groupName: 'org.users' },
  { key: ORG_PERMISSIONS.USERS_EDIT,   description: 'Edit org users',               groupName: 'org.users' },
  { key: ORG_PERMISSIONS.USERS_DELETE, description: 'Delete org users',             groupName: 'org.users' },
  // org.engines
  { key: ORG_PERMISSIONS.ENGINES_VIEW,   description: 'View workflow engines',       groupName: 'org.engines' },
  { key: ORG_PERMISSIONS.ENGINES_MANAGE, description: 'Create/edit/delete engines',  groupName: 'org.engines' },
  // org.categories
  { key: ORG_PERMISSIONS.CATEGORIES_VIEW,   description: 'View org automation categories',         groupName: 'org.categories' },
  { key: ORG_PERMISSIONS.CATEGORIES_MANAGE, description: 'Create/edit/delete org categories', groupName: 'org.categories' },
  // org.subaccounts
  { key: ORG_PERMISSIONS.SUBACCOUNTS_VIEW,   description: 'View subaccounts',               groupName: 'org.subaccounts' },
  { key: ORG_PERMISSIONS.SUBACCOUNTS_CREATE, description: 'Create subaccounts',              groupName: 'org.subaccounts' },
  { key: ORG_PERMISSIONS.SUBACCOUNTS_EDIT,   description: 'Edit subaccount settings',        groupName: 'org.subaccounts' },
  { key: ORG_PERMISSIONS.SUBACCOUNTS_DELETE, description: 'Delete subaccounts',              groupName: 'org.subaccounts' },
  // org.permission_sets
  { key: ORG_PERMISSIONS.PERMISSION_SETS_MANAGE, description: 'Manage permission sets',      groupName: 'org.permission_sets' },
  // org.settings
  { key: ORG_PERMISSIONS.SETTINGS_VIEW, description: 'View organisation settings and usage', groupName: 'org.settings' },
  { key: ORG_PERMISSIONS.SETTINGS_EDIT, description: 'Edit organisation settings and budgets', groupName: 'org.settings' },
  // org.agents
  { key: ORG_PERMISSIONS.AGENTS_VIEW,   description: 'View AI agents',             groupName: 'org.agents' },
  { key: ORG_PERMISSIONS.AGENTS_CREATE, description: 'Create AI agents',           groupName: 'org.agents' },
  { key: ORG_PERMISSIONS.AGENTS_EDIT,   description: 'Edit AI agents',             groupName: 'org.agents' },
  { key: ORG_PERMISSIONS.AGENTS_DELETE, description: 'Delete AI agents',           groupName: 'org.agents' },
  { key: ORG_PERMISSIONS.AGENTS_CHAT,   description: 'Chat with AI agents',        groupName: 'org.agents' },
  { key: ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE,
    description: 'Manage data sources (reference files, URLs) attached to scheduled tasks',
    groupName: 'org.agents' },
  // org.workflows (multi-step automation; spec §8.1)
  { key: ORG_PERMISSIONS.WORKFLOW_TEMPLATES_READ,    description: 'View Workflow templates',                       groupName: 'org.workflows' },
  { key: ORG_PERMISSIONS.WORKFLOW_TEMPLATES_WRITE,   description: 'Create / fork / delete Workflow templates',     groupName: 'org.workflows' },
  { key: ORG_PERMISSIONS.WORKFLOW_TEMPLATES_PUBLISH, description: 'Publish a new version of a Workflow template', groupName: 'org.workflows' },
  { key: ORG_PERMISSIONS.WORKFLOW_STUDIO_ACCESS,     description: 'Access the Workflow Studio chat authoring UI', groupName: 'org.workflows' },
  { key: ORG_PERMISSIONS.WORKFLOW_RUNS_START,        description: 'Start org-scope Workflow runs',                 groupName: 'org.workflows' },
  // org.health_audit (Brain Tree OS adoption P4)
  { key: ORG_PERMISSIONS.HEALTH_AUDIT_VIEW,    description: 'View workspace health findings and run on-demand audits', groupName: 'org.health_audit' },
  { key: ORG_PERMISSIONS.HEALTH_AUDIT_RESOLVE, description: 'Mark workspace health findings as resolved',              groupName: 'org.health_audit' },
  // org.geo_audit (Generative Engine Optimisation)
  { key: ORG_PERMISSIONS.GEO_AUDIT_VIEW, description: 'View GEO audit results and history',        groupName: 'org.geo_audit' },
  { key: ORG_PERMISSIONS.GEO_AUDIT_RUN,  description: 'Run on-demand GEO audits for subaccounts',  groupName: 'org.geo_audit' },
  // org.briefs + org.rules (Universal Brief)
  { key: ORG_PERMISSIONS.BRIEFS_READ,  description: 'View Briefs and their artefacts',                                          groupName: 'org.briefs' },
  { key: ORG_PERMISSIONS.BRIEFS_WRITE, description: 'Create Briefs and post messages into a conversation',                      groupName: 'org.briefs' },
  { key: ORG_PERMISSIONS.RULES_READ,   description: 'View Learned Rules',                                                       groupName: 'org.rules' },
  { key: ORG_PERMISSIONS.RULES_WRITE,  description: 'Create, edit, pause, resume, and delete Rules',                            groupName: 'org.rules' },
  { key: ORG_PERMISSIONS.RULES_SET_AUTHORITATIVE,
                                       description: 'Mark a Rule as authoritative (overrides non-authoritative rules)',        groupName: 'org.rules' },
  // reference_documents + document_bundles (Cached Context Infrastructure)
  { key: ORG_PERMISSIONS.REFERENCE_DOCUMENTS_READ,      description: 'View reference documents and their versions',                              groupName: 'reference_documents' },
  { key: ORG_PERMISSIONS.REFERENCE_DOCUMENTS_WRITE,     description: 'Create, edit, rename, pause, resume, and soft-delete reference documents', groupName: 'reference_documents' },
  { key: ORG_PERMISSIONS.REFERENCE_DOCUMENTS_DEPRECATE, description: 'Deprecate reference documents (forward-only lifecycle action)',            groupName: 'reference_documents' },
  { key: ORG_PERMISSIONS.DOCUMENT_BUNDLES_READ,         description: 'View document bundles and their members',                                  groupName: 'document_bundles' },
  { key: ORG_PERMISSIONS.DOCUMENT_BUNDLES_WRITE,        description: 'Create, edit, promote, and delete document bundles',                       groupName: 'document_bundles' },
  { key: ORG_PERMISSIONS.DOCUMENT_BUNDLES_ATTACH,       description: 'Attach document bundles to agents, tasks, and scheduled tasks',            groupName: 'document_bundles' },
  // subaccount.automations
  { key: SUBACCOUNT_PERMISSIONS.AUTOMATIONS_VIEW,    description: 'View automations in portal',                  groupName: 'subaccount.automations' },
  { key: SUBACCOUNT_PERMISSIONS.AUTOMATIONS_EXECUTE, description: 'Execute automations in portal',                groupName: 'subaccount.automations' },
  { key: SUBACCOUNT_PERMISSIONS.AUTOMATIONS_CREATE,  description: 'Create subaccount-specific automations',       groupName: 'subaccount.automations' },
  { key: SUBACCOUNT_PERMISSIONS.AUTOMATIONS_EDIT,    description: 'Edit subaccount automations',                  groupName: 'subaccount.automations' },
  { key: SUBACCOUNT_PERMISSIONS.AUTOMATIONS_DELETE,  description: 'Delete subaccount automations',                groupName: 'subaccount.automations' },
  // subaccount.connections
  { key: SUBACCOUNT_PERMISSIONS.CONNECTIONS_VIEW,   description: 'View connections for this subaccount',         groupName: 'subaccount.connections' },
  { key: SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE, description: 'Create/edit/revoke connections',               groupName: 'subaccount.connections' },
  // subaccount.automations (clone + configure)
  { key: SUBACCOUNT_PERMISSIONS.AUTOMATIONS_CLONE,     description: 'Clone org/system automation into subaccount',    groupName: 'subaccount.automations' },
  { key: SUBACCOUNT_PERMISSIONS.AUTOMATIONS_CONFIGURE, description: 'Configure connection mappings and overrides', groupName: 'subaccount.automations' },
  // subaccount.executions
  { key: SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW,     description: 'View own execution history',         groupName: 'subaccount.executions' },
  { key: SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW_ALL, description: 'View all subaccount executions',     groupName: 'subaccount.executions' },
  { key: SUBACCOUNT_PERMISSIONS.EXECUTIONS_MANAGE,   description: 'Manage executions (acknowledge failures)', groupName: 'subaccount.executions' },
  // subaccount.users
  { key: SUBACCOUNT_PERMISSIONS.USERS_VIEW,   description: 'View subaccount members',        groupName: 'subaccount.users' },
  { key: SUBACCOUNT_PERMISSIONS.USERS_INVITE, description: 'Invite users to subaccount',     groupName: 'subaccount.users' },
  { key: SUBACCOUNT_PERMISSIONS.USERS_EDIT,   description: 'Edit member permission sets',    groupName: 'subaccount.users' },
  { key: SUBACCOUNT_PERMISSIONS.USERS_REMOVE, description: 'Remove members from subaccount', groupName: 'subaccount.users' },
  // subaccount.categories
  { key: SUBACCOUNT_PERMISSIONS.CATEGORIES_MANAGE, description: 'Manage subaccount categories', groupName: 'subaccount.categories' },
  // subaccount.settings
  { key: SUBACCOUNT_PERMISSIONS.SETTINGS_EDIT, description: 'Edit subaccount settings', groupName: 'subaccount.settings' },
  // org.workspace
  { key: ORG_PERMISSIONS.WORKSPACE_VIEW,   description: 'View workspace boards and tasks',             groupName: 'org.workspace' },
  { key: ORG_PERMISSIONS.WORKSPACE_MANAGE, description: 'Manage workspace boards, tasks and configs',   groupName: 'org.workspace' },
  // subaccount.workspace
  { key: SUBACCOUNT_PERMISSIONS.WORKSPACE_VIEW,   description: 'View workspace board and tasks in portal',   groupName: 'subaccount.workspace' },
  { key: SUBACCOUNT_PERMISSIONS.WORKSPACE_MANAGE, description: 'Manage workspace tasks in portal',           groupName: 'subaccount.workspace' },
  // org.review
  { key: ORG_PERMISSIONS.REVIEW_VIEW,     description: 'View review queue and items',              groupName: 'org.review' },
  { key: ORG_PERMISSIONS.REVIEW_APPROVE,  description: 'Approve or reject review items',           groupName: 'org.review' },
  // subaccount.review
  { key: SUBACCOUNT_PERMISSIONS.REVIEW_VIEW,    description: 'View review queue in portal',              groupName: 'subaccount.review' },
  { key: SUBACCOUNT_PERMISSIONS.REVIEW_APPROVE, description: 'Approve or reject review items in portal', groupName: 'subaccount.review' },
  // org.mcp_servers
  { key: ORG_PERMISSIONS.MCP_SERVERS_VIEW,   description: 'View MCP server configurations',              groupName: 'org.mcp_servers' },
  { key: ORG_PERMISSIONS.MCP_SERVERS_MANAGE, description: 'Create/edit/delete MCP server configurations', groupName: 'org.mcp_servers' },
  // subaccount.workflows (multi-step automation; spec §8.1)
  { key: SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_READ,        description: 'View Workflow runs for this subaccount',     groupName: 'subaccount.workflows' },
  { key: SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_START,       description: 'Start Workflow runs and submit user input',  groupName: 'subaccount.workflows' },
  { key: SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_CANCEL,      description: 'Cancel running Workflows',                   groupName: 'subaccount.workflows' },
  { key: SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_EDIT_OUTPUT, description: 'Edit completed step outputs (mid-run edit)', groupName: 'subaccount.workflows' },
  { key: SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_APPROVE,     description: 'Decide on Workflow approval gates',          groupName: 'subaccount.workflows' },
  // subaccount.skills (subaccount-scoped skill management; migration 0117)
  { key: SUBACCOUNT_PERMISSIONS.SKILLS_VIEW,   description: 'View subaccount-scoped skills',                          groupName: 'subaccount.skills' },
  { key: SUBACCOUNT_PERMISSIONS.SKILLS_MANAGE, description: 'Create, edit, and delete subaccount-scoped skills',      groupName: 'subaccount.skills' },
  // subaccount.schedule (Scheduled Runs Calendar portal surface; Feature 1)
  { key: SUBACCOUNT_PERMISSIONS.SCHEDULE_VIEW_CALENDAR,
    description: 'View the upcoming-runs calendar via the client portal',
    groupName: 'subaccount.schedule' },
  // org.observability (delegation outcomes; paperclip-hierarchy spec)
  { key: ORG_PERMISSIONS.ORG_OBSERVABILITY_VIEW,
    description: 'View delegation outcomes and observability data',
    groupName: 'org.observability' },
  // org.billing + subaccount.billing (IEE — Integrated Execution Environment; rev 6 §11.5.3)
  { key: ORG_PERMISSIONS.IEE_USAGE_VIEW,
    description: 'View IEE usage and billing data at the org level',
    groupName: 'org.billing' },
  { key: SUBACCOUNT_PERMISSIONS.IEE_USAGE_VIEW,
    description: 'View IEE usage and billing data for this subaccount',
    groupName: 'subaccount.billing' },
  // subaccount.workspace + subaccount.agents (agents-as-employees; migration 0257)
  { key: SUBACCOUNT_PERMISSIONS.WORKSPACE_CONNECTOR_MANAGE, description: 'Configure and manage the subaccount workspace connector',  groupName: 'subaccount.workspace' },
  { key: SUBACCOUNT_PERMISSIONS.AGENTS_ONBOARD,             description: 'Onboard an agent to the workplace (provision identity)',    groupName: 'subaccount.agents' },
  { key: SUBACCOUNT_PERMISSIONS.AGENTS_MANAGE_LIFECYCLE,    description: 'Suspend, resume, or revoke an agent identity',             groupName: 'subaccount.agents' },
  { key: SUBACCOUNT_PERMISSIONS.AGENTS_TOGGLE_EMAIL,        description: 'Enable or disable outbound email sending for an agent',     groupName: 'subaccount.agents' },
  { key: SUBACCOUNT_PERMISSIONS.AGENTS_VIEW_MAILBOX,        description: "View an agent's mailbox",                                   groupName: 'subaccount.agents' },
  { key: SUBACCOUNT_PERMISSIONS.AGENTS_VIEW_CALENDAR,       description: "View an agent's calendar",                                  groupName: 'subaccount.agents' },
  { key: SUBACCOUNT_PERMISSIONS.AGENTS_VIEW_ACTIVITY,       description: "View an agent's activity feed",                             groupName: 'subaccount.agents' },
];

// ─── Default permission set templates ─────────────────────────────────────────

export const DEFAULT_PERMISSION_SET_TEMPLATES: Array<{
  name: string;
  description: string;
  permissionKeys: string[];
}> = [
  {
    name: 'Org Admin',
    description: 'Full control over the organisation, including engines, automations, users, subaccounts and permission sets.',
    permissionKeys: Object.values(ORG_PERMISSIONS),
  },
  {
    name: 'Org Manager',
    description: 'Operational access: manage automations and users, view subaccounts and executions.',
    permissionKeys: [
      ORG_PERMISSIONS.AUTOMATIONS_VIEW,
      ORG_PERMISSIONS.AUTOMATIONS_CREATE,
      ORG_PERMISSIONS.AUTOMATIONS_EDIT,
      ORG_PERMISSIONS.AUTOMATIONS_DELETE,
      ORG_PERMISSIONS.AUTOMATIONS_ACTIVATE,
      ORG_PERMISSIONS.AUTOMATIONS_TEST,
      ORG_PERMISSIONS.EXECUTIONS_VIEW,
      ORG_PERMISSIONS.EXECUTIONS_MANAGE,
      ORG_PERMISSIONS.USERS_VIEW,
      ORG_PERMISSIONS.USERS_INVITE,
      ORG_PERMISSIONS.USERS_EDIT,
      ORG_PERMISSIONS.CATEGORIES_VIEW,
      ORG_PERMISSIONS.SUBACCOUNTS_VIEW,
      ORG_PERMISSIONS.AGENTS_VIEW,
      ORG_PERMISSIONS.AGENTS_CHAT,
      ORG_PERMISSIONS.WORKSPACE_VIEW,
      ORG_PERMISSIONS.WORKSPACE_MANAGE,
      ORG_PERMISSIONS.BRIEFS_READ,
      ORG_PERMISSIONS.BRIEFS_WRITE,
      ORG_PERMISSIONS.RULES_READ,
      ORG_PERMISSIONS.RULES_WRITE,
    ],
  },
  {
    name: 'Org Viewer',
    description: 'Read-only access to automations, executions, users and subaccounts.',
    permissionKeys: [
      ORG_PERMISSIONS.AUTOMATIONS_VIEW,
      ORG_PERMISSIONS.EXECUTIONS_VIEW,
      ORG_PERMISSIONS.USERS_VIEW,
      ORG_PERMISSIONS.CATEGORIES_VIEW,
      ORG_PERMISSIONS.SUBACCOUNTS_VIEW,
      ORG_PERMISSIONS.AGENTS_VIEW,
      ORG_PERMISSIONS.AGENTS_CHAT,
      ORG_PERMISSIONS.WORKSPACE_VIEW,
      ORG_PERMISSIONS.BRIEFS_READ,
      ORG_PERMISSIONS.RULES_READ,
    ],
  },
  {
    name: 'Subaccount Admin',
    description: 'Full control over a subaccount: automations, members, categories and settings.',
    permissionKeys: Object.values(SUBACCOUNT_PERMISSIONS),
  },
  {
    name: 'Subaccount Manager',
    description: 'Manage subaccount automations, view all executions and manage members.',
    permissionKeys: [
      SUBACCOUNT_PERMISSIONS.AUTOMATIONS_VIEW,
      SUBACCOUNT_PERMISSIONS.AUTOMATIONS_EXECUTE,
      SUBACCOUNT_PERMISSIONS.AUTOMATIONS_CREATE,
      SUBACCOUNT_PERMISSIONS.AUTOMATIONS_EDIT,
      SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW,
      SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW_ALL,
      SUBACCOUNT_PERMISSIONS.USERS_VIEW,
      SUBACCOUNT_PERMISSIONS.USERS_INVITE,
      SUBACCOUNT_PERMISSIONS.USERS_EDIT,
      SUBACCOUNT_PERMISSIONS.CATEGORIES_MANAGE,
      SUBACCOUNT_PERMISSIONS.WORKSPACE_VIEW,
      SUBACCOUNT_PERMISSIONS.WORKSPACE_MANAGE,
      SUBACCOUNT_PERMISSIONS.SKILLS_VIEW,
      SUBACCOUNT_PERMISSIONS.SKILLS_MANAGE,
    ],
  },
  {
    name: 'Subaccount User',
    description: 'Basic portal access: execute automations and view own execution history.',
    permissionKeys: [
      SUBACCOUNT_PERMISSIONS.AUTOMATIONS_VIEW,
      SUBACCOUNT_PERMISSIONS.AUTOMATIONS_EXECUTE,
      SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW,
      SUBACCOUNT_PERMISSIONS.WORKSPACE_VIEW,
      // Portal-specific grant for the "Upcoming Work" card — clients can see
      // what the agency will do for them next week without needing general
      // workspace-management access.
      SUBACCOUNT_PERMISSIONS.SCHEDULE_VIEW_CALENDAR,
    ],
  },
];
