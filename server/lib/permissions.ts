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
  AGENTS_OBSERVATIONS_PIN: 'org.agents.observations.pin',
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
  // Org-tier workflow-run operation permissions (migration 0359 / WF5).
  // WORKFLOW_RUNS_START covers EXECUTE semantics (replay); these four cover
  // the remaining route gates previously held by AGENTS_VIEW / AGENTS_EDIT.
  WORKFLOW_RUNS_VIEW: 'org.workflow_runs.view',
  WORKFLOW_RUNS_CANCEL: 'org.workflow_runs.cancel',
  WORKFLOW_RUNS_EDIT_OUTPUT: 'org.workflow_runs.edit_output',
  WORKFLOW_RUNS_APPROVE: 'org.workflow_runs.approve',
  // ── Workspace health audit (Brain Tree OS adoption P4) ──────────────────
  HEALTH_AUDIT_VIEW: 'org.health_audit.view',
  HEALTH_AUDIT_RESOLVE: 'org.health_audit.resolve',
  // ── GEO audits (Generative Engine Optimisation) ─────────────────────────
  GEO_AUDIT_VIEW: 'org.geo_audit.view',
  GEO_AUDIT_RUN: 'org.geo_audit.run',
  // ── Agentic Commerce — spend approval (spec §11.1) ───────────────────────
  // spend_approver default-grant: when a SpendingBudget is created,
  // spendingBudgetService.create() runs atomically to grant spend_approver to
  // all current org-admin (org-scoped budget) or subaccount-admin users
  // (subaccount-scoped budget). Implementation: spendingBudgetService.ts.
  SPEND_APPROVER: 'spend_approver',
  // ── Universal Brief (Phase 2) ────────────────────────────────────────────
  BRIEFS_READ: 'org.briefs.read',
  TASKS_WRITE: 'org.tasks.write',
  RULES_READ: 'org.rules.read',
  RULES_WRITE: 'org.rules.write',
  RULES_SET_AUTHORITATIVE: 'org.rules.set_authoritative',
  // ── Observability (delegation outcomes; paperclip-hierarchy spec) ───────────
  ORG_OBSERVABILITY_VIEW: 'org.observability.view',
  // ── Teams ─────────────────────────────────────────────────────────────────
  TEAMS_MANAGE: 'org.teams.manage',
  // ── Cached Context Infrastructure ────────────────────────────────────────
  REFERENCE_DOCUMENTS_READ:       'reference_documents.read',
  REFERENCE_DOCUMENTS_WRITE:      'reference_documents.write',
  REFERENCE_DOCUMENTS_DEPRECATE:  'reference_documents.deprecate',
  DOCUMENT_BUNDLES_READ:          'document_bundles.read',
  DOCUMENT_BUNDLES_WRITE:         'document_bundles.write',
  DOCUMENT_BUNDLES_ATTACH:        'document_bundles.attach',
  // ── Trust & Verification Layer — scorecards (migration 0297) ─────────────
  SCORECARDS_VIEW:       'org.scorecards.view',
  SCORECARDS_MANAGE:     'org.scorecards.manage',
  SCORECARDS_BENCH_RUN:  'org.scorecards.bench_run',
  // ── Agent Workspace — presence stream (Chunk 9) ──────────────────────────
  AGENTS_PRESENCE_STREAM_SUBSCRIBE: 'org.agents.presence.stream.subscribe',
  // ── Support desk — draft review and inbox config (support-desk-canonical) ─
  SUPPORT_DRAFT_APPROVE: 'support.draft.approve',
  SUPPORT_DRAFT_REJECT: 'support.draft.reject',
  SUPPORT_DRAFT_OVERRIDE_COLLISION: 'support.draft.override_collision',
  SUPPORT_INBOX_CONFIGURE: 'support.inbox.configure',
  SUPPORT_INBOX_VIEW: 'support.inbox.view',
  SUPPORT_EVALS_VIEW: 'support.evals.view',
  // ── Personal Assistant V1 (EA / VoiceProfile / HomeWidget; §21.5) ─────────
  VOICE_PROFILE_READ:  'user.voice_profile.read',
  VOICE_PROFILE_WRITE: 'user.voice_profile.write',
  EA_DRAFT_READ:       'user.ea_draft.read',
  EA_DRAFT_DECIDE:     'user.ea_draft.decide',
  HOME_WIDGET_READ:    'user.home_widget.read',
  EA_PROVISION:        'user.ea.provision',
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
  // ── Trust & Verification Layer — subaccount scorecards (migration 0297) ──
  SCORECARDS_VIEW:      'subaccount.scorecards.view',
  SCORECARDS_MANAGE:    'subaccount.scorecards.manage',
  CORRECTIONS_CREATE:   'subaccount.corrections.create',
  // ── Credentials audit log (SynthetOS Phase 1) ────────────────────────────
  CREDENTIALS_AUDIT_READ: 'credentials:audit:read',
  // ── AI Subscriptions (operator_session; operator-session-identity chunk 5) ─
  OPERATOR_SESSION_VIEW:            'subaccount.operator_session.view',
  OPERATOR_SESSION_CONNECT:         'subaccount.operator_session.connect',
  OPERATOR_SESSION_DISCONNECT:      'subaccount.operator_session.disconnect',
  OPERATOR_SESSION_REAUTH:          'subaccount.operator_session.reauth',
  OPERATOR_SESSION_ALLOW_AGENT_USE: 'subaccount.operator_session.allow_agent_use',
  // ── Operator Backend — per-subaccount settings (operator-backend Chunk 7) ─
  OPERATOR_SETTINGS_WRITE: 'subaccount.operator_settings.write',
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
  // org.teams
  { key: ORG_PERMISSIONS.TEAMS_MANAGE, description: 'Create, edit, and delete teams and manage team membership', groupName: 'org.teams' },
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
  { key: ORG_PERMISSIONS.AGENTS_CHAT,              description: 'Chat with AI agents',                                  groupName: 'org.agents' },
  { key: ORG_PERMISSIONS.AGENTS_OBSERVATIONS_PIN, description: 'Pin agent observations to the Recent observations card', groupName: 'org.agents' },
  { key: ORG_PERMISSIONS.AGENTS_PRESENCE_STREAM_SUBSCRIBE, description: 'Subscribe to agent presence SSE stream', groupName: 'org.agents' },
  { key: ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE,
    description: 'Manage data sources (reference files, URLs) attached to scheduled tasks',
    groupName: 'org.agents' },
  // org.workflows (multi-step automation; spec §8.1)
  { key: ORG_PERMISSIONS.WORKFLOW_TEMPLATES_READ,    description: 'View Workflow templates',                       groupName: 'org.workflows' },
  { key: ORG_PERMISSIONS.WORKFLOW_TEMPLATES_WRITE,   description: 'Create / fork / delete Workflow templates',     groupName: 'org.workflows' },
  { key: ORG_PERMISSIONS.WORKFLOW_TEMPLATES_PUBLISH, description: 'Publish a new version of a Workflow template', groupName: 'org.workflows' },
  { key: ORG_PERMISSIONS.WORKFLOW_STUDIO_ACCESS,     description: 'Access the Workflow Studio chat authoring UI', groupName: 'org.workflows' },
  { key: ORG_PERMISSIONS.WORKFLOW_RUNS_START,        description: 'Start org-scope Workflow runs',                 groupName: 'org.workflows' },
  { key: ORG_PERMISSIONS.WORKFLOW_RUNS_VIEW,        description: 'View Workflow runs at the org level',             groupName: 'org.workflows' },
  { key: ORG_PERMISSIONS.WORKFLOW_RUNS_CANCEL,      description: 'Cancel running Workflows at the org level',       groupName: 'org.workflows' },
  { key: ORG_PERMISSIONS.WORKFLOW_RUNS_EDIT_OUTPUT, description: 'Edit completed step outputs and submit form inputs (org)', groupName: 'org.workflows' },
  { key: ORG_PERMISSIONS.WORKFLOW_RUNS_APPROVE,     description: 'Decide on Workflow approval gates (org)',         groupName: 'org.workflows' },
  // org.health_audit (Brain Tree OS adoption P4)
  { key: ORG_PERMISSIONS.HEALTH_AUDIT_VIEW,    description: 'View workspace health findings and run on-demand audits', groupName: 'org.health_audit' },
  { key: ORG_PERMISSIONS.HEALTH_AUDIT_RESOLVE, description: 'Mark workspace health findings as resolved',              groupName: 'org.health_audit' },
  // org.geo_audit (Generative Engine Optimisation)
  { key: ORG_PERMISSIONS.GEO_AUDIT_VIEW, description: 'View GEO audit results and history',        groupName: 'org.geo_audit' },
  { key: ORG_PERMISSIONS.GEO_AUDIT_RUN,  description: 'Run on-demand GEO audits for subaccounts',  groupName: 'org.geo_audit' },
  // org.briefs + org.tasks + org.rules (Universal Brief)
  { key: ORG_PERMISSIONS.BRIEFS_READ,  description: 'View Briefs and their artefacts',                                          groupName: 'org.briefs' },
  { key: ORG_PERMISSIONS.TASKS_WRITE,  description: 'Create Tasks and post messages into a conversation',                       groupName: 'org.tasks' },
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
  // spend_approver (Agentic Commerce §11.1) — org-scoped; default-granted by budget creation (Chunk 13)
  { key: ORG_PERMISSIONS.SPEND_APPROVER,
    description: 'Approve or deny agent spending actions against a Spending Budget',
    groupName: 'org.spend' },
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
  // org.scorecards + subaccount.scorecards + subaccount.corrections (Trust & Verification Layer; migration 0297)
  { key: ORG_PERMISSIONS.SCORECARDS_VIEW,      description: 'List org, system, and subaccount-visible scorecards',                    groupName: 'org.scorecards' },
  { key: ORG_PERMISSIONS.SCORECARDS_MANAGE,    description: 'Create, edit, and delete org-scope scorecards; set mandatory slugs',     groupName: 'org.scorecards' },
  { key: ORG_PERMISSIONS.SCORECARDS_BENCH_RUN, description: 'Trigger a model bench run for agent or skill evaluation',               groupName: 'org.scorecards' },
  { key: SUBACCOUNT_PERMISSIONS.SCORECARDS_VIEW,    description: 'List subaccount-visible scorecards',                               groupName: 'subaccount.scorecards' },
  { key: SUBACCOUNT_PERMISSIONS.SCORECARDS_MANAGE,  description: 'Create, edit, and delete subaccount-scope scorecards; attach/detach suggested scorecards', groupName: 'subaccount.scorecards' },
  { key: SUBACCOUNT_PERMISSIONS.CORRECTIONS_CREATE, description: 'Use the Correct action on Run-trace to submit a correction',       groupName: 'subaccount.corrections' },
  // org.support (support-desk-canonical)
  { key: ORG_PERMISSIONS.SUPPORT_DRAFT_APPROVE,            description: 'Approve and send support reply drafts',                groupName: 'org.support' },
  { key: ORG_PERMISSIONS.SUPPORT_DRAFT_REJECT,             description: 'Reject support reply drafts',                         groupName: 'org.support' },
  { key: ORG_PERMISSIONS.SUPPORT_DRAFT_OVERRIDE_COLLISION, description: 'Override collision check on draft approval',           groupName: 'org.support' },
  { key: ORG_PERMISSIONS.SUPPORT_INBOX_CONFIGURE,          description: 'Configure support inbox agent settings',              groupName: 'org.support' },
  { key: ORG_PERMISSIONS.SUPPORT_INBOX_VIEW,               description: 'View support inbox and agent configuration',          groupName: 'org.support' },
  { key: ORG_PERMISSIONS.SUPPORT_EVALS_VIEW,               description: 'View support agent eval results',                     groupName: 'org.support' },
  // subaccount.credentials (SynthetOS Phase 1)
  { key: SUBACCOUNT_PERMISSIONS.CREDENTIALS_AUDIT_READ, description: 'View the credential audit log for this subaccount', groupName: 'subaccount.credentials' },
  // subaccount.operator_session (AI Subscriptions; operator-session-identity chunk 5)
  { key: SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_VIEW,            description: 'View AI Subscription metadata (no token material)',              groupName: 'AI Subscriptions' },
  { key: SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_CONNECT,         description: 'Connect a new AI Subscription and re-accept consent',           groupName: 'AI Subscriptions' },
  { key: SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_DISCONNECT,      description: 'Disconnect an AI Subscription (terminal disable)',               groupName: 'AI Subscriptions' },
  { key: SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_REAUTH,          description: 'Trigger re-authentication when sign-in expired',                groupName: 'AI Subscriptions' },
  { key: SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_ALLOW_AGENT_USE, description: 'Edit per-subscription agent allowlist',                         groupName: 'AI Subscriptions' },
  // subaccount.operator_settings (Operator Backend; operator-backend Chunk 7)
  { key: SUBACCOUNT_PERMISSIONS.OPERATOR_SETTINGS_WRITE, description: 'Edit per-subaccount operator runtime caps (org_admin only)', groupName: 'subaccount.operator_settings' },
  // user.personal_assistant (Personal Assistant V1; §21.5)
  { key: ORG_PERMISSIONS.VOICE_PROFILE_READ,  description: 'Read own voice profile',                                    groupName: 'user.personal_assistant' },
  { key: ORG_PERMISSIONS.VOICE_PROFILE_WRITE, description: 'Refresh, opt out of, or reactivate own voice profile',      groupName: 'user.personal_assistant' },
  { key: ORG_PERMISSIONS.EA_DRAFT_READ,       description: 'View EA drafts awaiting approval',                          groupName: 'user.personal_assistant' },
  { key: ORG_PERMISSIONS.EA_DRAFT_DECIDE,     description: 'Approve or reject EA drafts',                               groupName: 'user.personal_assistant' },
  { key: ORG_PERMISSIONS.HOME_WIDGET_READ,    description: 'Read home-widget data for user-owned agents',               groupName: 'user.personal_assistant' },
  { key: ORG_PERMISSIONS.EA_PROVISION,        description: 'Provision a Personal Assistant agent via the first-run wizard', groupName: 'user.personal_assistant' },
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
      ORG_PERMISSIONS.AGENTS_PRESENCE_STREAM_SUBSCRIBE,
      ORG_PERMISSIONS.WORKSPACE_VIEW,
      ORG_PERMISSIONS.WORKSPACE_MANAGE,
      ORG_PERMISSIONS.BRIEFS_READ,
      ORG_PERMISSIONS.TASKS_WRITE,
      ORG_PERMISSIONS.RULES_READ,
      ORG_PERMISSIONS.RULES_WRITE,
      ORG_PERMISSIONS.WORKFLOW_RUNS_VIEW,
      ORG_PERMISSIONS.WORKFLOW_RUNS_CANCEL,
      ORG_PERMISSIONS.WORKFLOW_RUNS_EDIT_OUTPUT,
      ORG_PERMISSIONS.WORKFLOW_RUNS_APPROVE,
      ORG_PERMISSIONS.VOICE_PROFILE_READ,
      ORG_PERMISSIONS.VOICE_PROFILE_WRITE,
      ORG_PERMISSIONS.EA_DRAFT_READ,
      ORG_PERMISSIONS.EA_DRAFT_DECIDE,
      ORG_PERMISSIONS.HOME_WIDGET_READ,
      ORG_PERMISSIONS.EA_PROVISION,
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
      ORG_PERMISSIONS.AGENTS_PRESENCE_STREAM_SUBSCRIBE,
      ORG_PERMISSIONS.WORKSPACE_VIEW,
      ORG_PERMISSIONS.BRIEFS_READ,
      ORG_PERMISSIONS.RULES_READ,
      ORG_PERMISSIONS.WORKFLOW_RUNS_VIEW,
      ORG_PERMISSIONS.VOICE_PROFILE_READ,
      ORG_PERMISSIONS.VOICE_PROFILE_WRITE,
      ORG_PERMISSIONS.EA_DRAFT_READ,
      ORG_PERMISSIONS.EA_DRAFT_DECIDE,
      ORG_PERMISSIONS.HOME_WIDGET_READ,
      ORG_PERMISSIONS.EA_PROVISION,
    ],
  },
  {
    name: 'Subaccount Admin',
    description: 'Full control over a subaccount: automations, members, categories and settings.',
    permissionKeys: [
      ...Object.values(SUBACCOUNT_PERMISSIONS),
      ORG_PERMISSIONS.VOICE_PROFILE_READ,
      ORG_PERMISSIONS.VOICE_PROFILE_WRITE,
      ORG_PERMISSIONS.EA_DRAFT_READ,
      ORG_PERMISSIONS.EA_DRAFT_DECIDE,
      ORG_PERMISSIONS.HOME_WIDGET_READ,
      ORG_PERMISSIONS.EA_PROVISION,
    ],
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
      ORG_PERMISSIONS.VOICE_PROFILE_READ,
      ORG_PERMISSIONS.VOICE_PROFILE_WRITE,
      ORG_PERMISSIONS.EA_DRAFT_READ,
      ORG_PERMISSIONS.EA_DRAFT_DECIDE,
      ORG_PERMISSIONS.HOME_WIDGET_READ,
      ORG_PERMISSIONS.EA_PROVISION,
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
      ORG_PERMISSIONS.VOICE_PROFILE_READ,
      ORG_PERMISSIONS.VOICE_PROFILE_WRITE,
      ORG_PERMISSIONS.EA_DRAFT_READ,
      ORG_PERMISSIONS.EA_DRAFT_DECIDE,
      ORG_PERMISSIONS.HOME_WIDGET_READ,
      ORG_PERMISSIONS.EA_PROVISION,
    ],
  },
];
