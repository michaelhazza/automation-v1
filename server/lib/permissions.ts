/**
 * Atomic permission keys for the Automation OS permission system.
 *
 * Org-level permissions are checked against a user's org_user_roles entry.
 * Subaccount-level permissions are checked against subaccount_user_assignments.
 * system_admin users bypass all permission checks.
 */

// ─── Org-level permissions ────────────────────────────────────────────────────

export const ORG_PERMISSIONS = {
  // Processes (workflow definitions)
  PROCESSES_VIEW: 'org.processes.view',
  PROCESSES_CREATE: 'org.processes.create',
  PROCESSES_EDIT: 'org.processes.edit',
  PROCESSES_DELETE: 'org.processes.delete',
  PROCESSES_ACTIVATE: 'org.processes.activate',
  PROCESSES_TEST: 'org.processes.test',
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
  // System process visibility
  PROCESSES_VIEW_SYSTEM: 'org.processes.view_system',
  PROCESSES_CLONE: 'org.processes.clone',
  // Org-level connections
  CONNECTIONS_VIEW: 'org.connections.view',
  CONNECTIONS_MANAGE: 'org.connections.manage',
  // Process categories
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
  // ── Playbooks (multi-step automation; spec §8.1) ────────────────────────
  PLAYBOOK_TEMPLATES_READ: 'org.playbook_templates.read',
  PLAYBOOK_TEMPLATES_WRITE: 'org.playbook_templates.write',
  PLAYBOOK_TEMPLATES_PUBLISH: 'org.playbook_templates.publish',
  PLAYBOOK_STUDIO_ACCESS: 'org.playbook_studio.access',
  // Org-scope playbook runs (migration 0171 / ClientPulse §13.3). Distinct from
  // SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_START because org-scope runs operate
  // across the whole organisation rather than a single subaccount.
  PLAYBOOK_RUNS_START: 'org.playbook_runs.start',
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
  // ── Cached Context Infrastructure ────────────────────────────────────────
  REFERENCE_DOCUMENTS_READ:       'reference_documents.read',
  REFERENCE_DOCUMENTS_WRITE:      'reference_documents.write',
  REFERENCE_DOCUMENTS_DEPRECATE:  'reference_documents.deprecate',
  DOCUMENT_BUNDLES_READ:          'document_bundles.read',
  DOCUMENT_BUNDLES_WRITE:         'document_bundles.write',
  DOCUMENT_BUNDLES_ATTACH:        'document_bundles.attach',
} as const;

// ─── Subaccount-level permissions ─────────────────────────────────────────────

export const SUBACCOUNT_PERMISSIONS = {
  // Processes (workflow definitions)
  PROCESSES_VIEW: 'subaccount.processes.view',
  PROCESSES_EXECUTE: 'subaccount.processes.execute',
  PROCESSES_CREATE: 'subaccount.processes.create',
  PROCESSES_EDIT: 'subaccount.processes.edit',
  PROCESSES_DELETE: 'subaccount.processes.delete',
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
  // Process configuration (connection mappings, config overrides)
  PROCESSES_CLONE: 'subaccount.processes.clone',
  PROCESSES_CONFIGURE: 'subaccount.processes.configure',
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
  // ── Playbooks (multi-step automation; spec §8.1) ────────────────────────
  PLAYBOOK_RUNS_READ: 'subaccount.playbook_runs.read',
  PLAYBOOK_RUNS_START: 'subaccount.playbook_runs.start',
  PLAYBOOK_RUNS_CANCEL: 'subaccount.playbook_runs.cancel',
  PLAYBOOK_RUNS_EDIT_OUTPUT: 'subaccount.playbook_runs.edit_output',
  PLAYBOOK_RUNS_APPROVE: 'subaccount.playbook_runs.approve',
  // Skills (subaccount-scoped skill management; migration 0117)
  SKILLS_VIEW: 'subaccount.skills.view',
  SKILLS_MANAGE: 'subaccount.skills.manage',
  // Schedule visibility (Scheduled Runs Calendar portal surface; Feature 1
  // of docs/routines-response-dev-spec.md §3.4). Grants client users the
  // "Upcoming Work" card path without granting general workspace.view.
  SCHEDULE_VIEW_CALENDAR: 'subaccount.schedule.view_calendar',
} as const;

export type OrgPermissionKey = typeof ORG_PERMISSIONS[keyof typeof ORG_PERMISSIONS];
export type SubaccountPermissionKey = typeof SUBACCOUNT_PERMISSIONS[keyof typeof SUBACCOUNT_PERMISSIONS];
export type PermissionKey = OrgPermissionKey | SubaccountPermissionKey;

// ─── Full permission catalogue (for DB seeding) ───────────────────────────────

export const ALL_PERMISSIONS: Array<{ key: string; description: string; groupName: string }> = [
  // org.processes
  { key: ORG_PERMISSIONS.PROCESSES_VIEW,     description: 'View org processes',              groupName: 'org.processes' },
  { key: ORG_PERMISSIONS.PROCESSES_CREATE,   description: 'Create org processes',            groupName: 'org.processes' },
  { key: ORG_PERMISSIONS.PROCESSES_EDIT,     description: 'Edit org processes',              groupName: 'org.processes' },
  { key: ORG_PERMISSIONS.PROCESSES_DELETE,   description: 'Delete org processes',            groupName: 'org.processes' },
  { key: ORG_PERMISSIONS.PROCESSES_ACTIVATE, description: 'Activate/deactivate processes',   groupName: 'org.processes' },
  { key: ORG_PERMISSIONS.PROCESSES_TEST,     description: 'Test-execute processes',          groupName: 'org.processes' },
  // org.processes (system visibility + clone)
  { key: ORG_PERMISSIONS.PROCESSES_VIEW_SYSTEM, description: 'View system processes available to this org', groupName: 'org.processes' },
  { key: ORG_PERMISSIONS.PROCESSES_CLONE,       description: 'Clone a system process into the org',        groupName: 'org.processes' },
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
  { key: ORG_PERMISSIONS.CATEGORIES_VIEW,   description: 'View org process categories',         groupName: 'org.categories' },
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
  // org.playbooks (multi-step automation; spec §8.1)
  { key: ORG_PERMISSIONS.PLAYBOOK_TEMPLATES_READ,    description: 'View Playbook templates',                       groupName: 'org.playbooks' },
  { key: ORG_PERMISSIONS.PLAYBOOK_TEMPLATES_WRITE,   description: 'Create / fork / delete Playbook templates',     groupName: 'org.playbooks' },
  { key: ORG_PERMISSIONS.PLAYBOOK_TEMPLATES_PUBLISH, description: 'Publish a new version of a Playbook template', groupName: 'org.playbooks' },
  { key: ORG_PERMISSIONS.PLAYBOOK_STUDIO_ACCESS,     description: 'Access the Playbook Studio chat authoring UI', groupName: 'org.playbooks' },
  { key: ORG_PERMISSIONS.PLAYBOOK_RUNS_START,        description: 'Start org-scope Playbook runs',                 groupName: 'org.playbooks' },
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
  // subaccount.processes
  { key: SUBACCOUNT_PERMISSIONS.PROCESSES_VIEW,    description: 'View processes in portal',                  groupName: 'subaccount.processes' },
  { key: SUBACCOUNT_PERMISSIONS.PROCESSES_EXECUTE, description: 'Execute processes in portal',                groupName: 'subaccount.processes' },
  { key: SUBACCOUNT_PERMISSIONS.PROCESSES_CREATE,  description: 'Create subaccount-specific processes',       groupName: 'subaccount.processes' },
  { key: SUBACCOUNT_PERMISSIONS.PROCESSES_EDIT,    description: 'Edit subaccount processes',                  groupName: 'subaccount.processes' },
  { key: SUBACCOUNT_PERMISSIONS.PROCESSES_DELETE,  description: 'Delete subaccount processes',                groupName: 'subaccount.processes' },
  // subaccount.connections
  { key: SUBACCOUNT_PERMISSIONS.CONNECTIONS_VIEW,   description: 'View connections for this subaccount',         groupName: 'subaccount.connections' },
  { key: SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE, description: 'Create/edit/revoke connections',               groupName: 'subaccount.connections' },
  // subaccount.processes (clone + configure)
  { key: SUBACCOUNT_PERMISSIONS.PROCESSES_CLONE,     description: 'Clone org/system process into subaccount',    groupName: 'subaccount.processes' },
  { key: SUBACCOUNT_PERMISSIONS.PROCESSES_CONFIGURE, description: 'Configure connection mappings and overrides', groupName: 'subaccount.processes' },
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
  // subaccount.playbooks (multi-step automation; spec §8.1)
  { key: SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_READ,        description: 'View Playbook runs for this subaccount',     groupName: 'subaccount.playbooks' },
  { key: SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_START,       description: 'Start Playbook runs and submit user input',  groupName: 'subaccount.playbooks' },
  { key: SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_CANCEL,      description: 'Cancel running Playbooks',                   groupName: 'subaccount.playbooks' },
  { key: SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_EDIT_OUTPUT, description: 'Edit completed step outputs (mid-run edit)', groupName: 'subaccount.playbooks' },
  { key: SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_APPROVE,     description: 'Decide on Playbook approval gates',          groupName: 'subaccount.playbooks' },
  // subaccount.skills (subaccount-scoped skill management; migration 0117)
  { key: SUBACCOUNT_PERMISSIONS.SKILLS_VIEW,   description: 'View subaccount-scoped skills',                          groupName: 'subaccount.skills' },
  { key: SUBACCOUNT_PERMISSIONS.SKILLS_MANAGE, description: 'Create, edit, and delete subaccount-scoped skills',      groupName: 'subaccount.skills' },
  // subaccount.schedule (Scheduled Runs Calendar portal surface; Feature 1)
  { key: SUBACCOUNT_PERMISSIONS.SCHEDULE_VIEW_CALENDAR,
    description: 'View the upcoming-runs calendar via the client portal',
    groupName: 'subaccount.schedule' },
];

// ─── Default permission set templates ─────────────────────────────────────────

export const DEFAULT_PERMISSION_SET_TEMPLATES: Array<{
  name: string;
  description: string;
  permissionKeys: string[];
}> = [
  {
    name: 'Org Admin',
    description: 'Full control over the organisation, including engines, processes, users, subaccounts and permission sets.',
    permissionKeys: Object.values(ORG_PERMISSIONS),
  },
  {
    name: 'Org Manager',
    description: 'Operational access: manage processes and users, view subaccounts and executions.',
    permissionKeys: [
      ORG_PERMISSIONS.PROCESSES_VIEW,
      ORG_PERMISSIONS.PROCESSES_CREATE,
      ORG_PERMISSIONS.PROCESSES_EDIT,
      ORG_PERMISSIONS.PROCESSES_DELETE,
      ORG_PERMISSIONS.PROCESSES_ACTIVATE,
      ORG_PERMISSIONS.PROCESSES_TEST,
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
    description: 'Read-only access to processes, executions, users and subaccounts.',
    permissionKeys: [
      ORG_PERMISSIONS.PROCESSES_VIEW,
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
    description: 'Full control over a subaccount: processes, members, categories and settings.',
    permissionKeys: Object.values(SUBACCOUNT_PERMISSIONS),
  },
  {
    name: 'Subaccount Manager',
    description: 'Manage subaccount processes, view all executions and manage members.',
    permissionKeys: [
      SUBACCOUNT_PERMISSIONS.PROCESSES_VIEW,
      SUBACCOUNT_PERMISSIONS.PROCESSES_EXECUTE,
      SUBACCOUNT_PERMISSIONS.PROCESSES_CREATE,
      SUBACCOUNT_PERMISSIONS.PROCESSES_EDIT,
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
    description: 'Basic portal access: execute processes and view own execution history.',
    permissionKeys: [
      SUBACCOUNT_PERMISSIONS.PROCESSES_VIEW,
      SUBACCOUNT_PERMISSIONS.PROCESSES_EXECUTE,
      SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW,
      SUBACCOUNT_PERMISSIONS.WORKSPACE_VIEW,
      // Portal-specific grant for the "Upcoming Work" card — clients can see
      // what the agency will do for them next week without needing general
      // workspace-management access.
      SUBACCOUNT_PERMISSIONS.SCHEDULE_VIEW_CALENDAR,
    ],
  },
];
