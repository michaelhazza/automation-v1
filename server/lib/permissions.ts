/**
 * Atomic permission keys for the Automation OS permission system.
 *
 * Org-level permissions are checked against a user's org_user_roles entry.
 * Subaccount-level permissions are checked against subaccount_user_assignments.
 * system_admin users bypass all permission checks.
 */

// ─── Org-level permissions ────────────────────────────────────────────────────

export const ORG_PERMISSIONS = {
  // Tasks
  TASKS_VIEW: 'org.tasks.view',
  TASKS_CREATE: 'org.tasks.create',
  TASKS_EDIT: 'org.tasks.edit',
  TASKS_DELETE: 'org.tasks.delete',
  TASKS_ACTIVATE: 'org.tasks.activate',
  TASKS_TEST: 'org.tasks.test',
  // Executions
  EXECUTIONS_VIEW: 'org.executions.view',
  // Users
  USERS_VIEW: 'org.users.view',
  USERS_INVITE: 'org.users.invite',
  USERS_EDIT: 'org.users.edit',
  USERS_DELETE: 'org.users.delete',
  // Workflow engines
  ENGINES_VIEW: 'org.engines.view',
  ENGINES_MANAGE: 'org.engines.manage',
  // Task categories
  CATEGORIES_VIEW: 'org.categories.view',
  CATEGORIES_MANAGE: 'org.categories.manage',
  // Subaccounts
  SUBACCOUNTS_VIEW: 'org.subaccounts.view',
  SUBACCOUNTS_CREATE: 'org.subaccounts.create',
  SUBACCOUNTS_EDIT: 'org.subaccounts.edit',
  SUBACCOUNTS_DELETE: 'org.subaccounts.delete',
  // Permission sets
  PERMISSION_SETS_MANAGE: 'org.permission_sets.manage',
} as const;

// ─── Subaccount-level permissions ─────────────────────────────────────────────

export const SUBACCOUNT_PERMISSIONS = {
  // Tasks
  TASKS_VIEW: 'subaccount.tasks.view',
  TASKS_EXECUTE: 'subaccount.tasks.execute',
  TASKS_CREATE: 'subaccount.tasks.create',
  TASKS_EDIT: 'subaccount.tasks.edit',
  TASKS_DELETE: 'subaccount.tasks.delete',
  // Executions
  EXECUTIONS_VIEW: 'subaccount.executions.view',
  EXECUTIONS_VIEW_ALL: 'subaccount.executions.view_all',
  // Members
  USERS_VIEW: 'subaccount.users.view',
  USERS_INVITE: 'subaccount.users.invite',
  USERS_EDIT: 'subaccount.users.edit',
  USERS_REMOVE: 'subaccount.users.remove',
  // Categories
  CATEGORIES_MANAGE: 'subaccount.categories.manage',
  // Settings
  SETTINGS_EDIT: 'subaccount.settings.edit',
} as const;

export type OrgPermissionKey = typeof ORG_PERMISSIONS[keyof typeof ORG_PERMISSIONS];
export type SubaccountPermissionKey = typeof SUBACCOUNT_PERMISSIONS[keyof typeof SUBACCOUNT_PERMISSIONS];
export type PermissionKey = OrgPermissionKey | SubaccountPermissionKey;

// ─── Full permission catalogue (for DB seeding) ───────────────────────────────

export const ALL_PERMISSIONS: Array<{ key: string; description: string; groupName: string }> = [
  // org.tasks
  { key: ORG_PERMISSIONS.TASKS_VIEW,     description: 'View org tasks',              groupName: 'org.tasks' },
  { key: ORG_PERMISSIONS.TASKS_CREATE,   description: 'Create org tasks',            groupName: 'org.tasks' },
  { key: ORG_PERMISSIONS.TASKS_EDIT,     description: 'Edit org tasks',              groupName: 'org.tasks' },
  { key: ORG_PERMISSIONS.TASKS_DELETE,   description: 'Delete org tasks',            groupName: 'org.tasks' },
  { key: ORG_PERMISSIONS.TASKS_ACTIVATE, description: 'Activate/deactivate tasks',   groupName: 'org.tasks' },
  { key: ORG_PERMISSIONS.TASKS_TEST,     description: 'Test-execute tasks',          groupName: 'org.tasks' },
  // org.executions
  { key: ORG_PERMISSIONS.EXECUTIONS_VIEW, description: 'View all org executions',    groupName: 'org.executions' },
  // org.users
  { key: ORG_PERMISSIONS.USERS_VIEW,   description: 'View org users',               groupName: 'org.users' },
  { key: ORG_PERMISSIONS.USERS_INVITE, description: 'Invite users to org',          groupName: 'org.users' },
  { key: ORG_PERMISSIONS.USERS_EDIT,   description: 'Edit org users',               groupName: 'org.users' },
  { key: ORG_PERMISSIONS.USERS_DELETE, description: 'Delete org users',             groupName: 'org.users' },
  // org.engines
  { key: ORG_PERMISSIONS.ENGINES_VIEW,   description: 'View workflow engines',       groupName: 'org.engines' },
  { key: ORG_PERMISSIONS.ENGINES_MANAGE, description: 'Create/edit/delete engines',  groupName: 'org.engines' },
  // org.categories
  { key: ORG_PERMISSIONS.CATEGORIES_VIEW,   description: 'View org task categories',         groupName: 'org.categories' },
  { key: ORG_PERMISSIONS.CATEGORIES_MANAGE, description: 'Create/edit/delete org categories', groupName: 'org.categories' },
  // org.subaccounts
  { key: ORG_PERMISSIONS.SUBACCOUNTS_VIEW,   description: 'View subaccounts',               groupName: 'org.subaccounts' },
  { key: ORG_PERMISSIONS.SUBACCOUNTS_CREATE, description: 'Create subaccounts',              groupName: 'org.subaccounts' },
  { key: ORG_PERMISSIONS.SUBACCOUNTS_EDIT,   description: 'Edit subaccount settings',        groupName: 'org.subaccounts' },
  { key: ORG_PERMISSIONS.SUBACCOUNTS_DELETE, description: 'Delete subaccounts',              groupName: 'org.subaccounts' },
  // org.permission_sets
  { key: ORG_PERMISSIONS.PERMISSION_SETS_MANAGE, description: 'Manage permission sets',      groupName: 'org.permission_sets' },
  // subaccount.tasks
  { key: SUBACCOUNT_PERMISSIONS.TASKS_VIEW,    description: 'View tasks in portal',                  groupName: 'subaccount.tasks' },
  { key: SUBACCOUNT_PERMISSIONS.TASKS_EXECUTE, description: 'Execute tasks in portal',                groupName: 'subaccount.tasks' },
  { key: SUBACCOUNT_PERMISSIONS.TASKS_CREATE,  description: 'Create subaccount-specific tasks',       groupName: 'subaccount.tasks' },
  { key: SUBACCOUNT_PERMISSIONS.TASKS_EDIT,    description: 'Edit subaccount tasks',                  groupName: 'subaccount.tasks' },
  { key: SUBACCOUNT_PERMISSIONS.TASKS_DELETE,  description: 'Delete subaccount tasks',                groupName: 'subaccount.tasks' },
  // subaccount.executions
  { key: SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW,     description: 'View own execution history',         groupName: 'subaccount.executions' },
  { key: SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW_ALL, description: 'View all subaccount executions',     groupName: 'subaccount.executions' },
  // subaccount.users
  { key: SUBACCOUNT_PERMISSIONS.USERS_VIEW,   description: 'View subaccount members',        groupName: 'subaccount.users' },
  { key: SUBACCOUNT_PERMISSIONS.USERS_INVITE, description: 'Invite users to subaccount',     groupName: 'subaccount.users' },
  { key: SUBACCOUNT_PERMISSIONS.USERS_EDIT,   description: 'Edit member permission sets',    groupName: 'subaccount.users' },
  { key: SUBACCOUNT_PERMISSIONS.USERS_REMOVE, description: 'Remove members from subaccount', groupName: 'subaccount.users' },
  // subaccount.categories
  { key: SUBACCOUNT_PERMISSIONS.CATEGORIES_MANAGE, description: 'Manage subaccount categories', groupName: 'subaccount.categories' },
  // subaccount.settings
  { key: SUBACCOUNT_PERMISSIONS.SETTINGS_EDIT, description: 'Edit subaccount settings', groupName: 'subaccount.settings' },
];

// ─── Default permission set templates ─────────────────────────────────────────

export const DEFAULT_PERMISSION_SET_TEMPLATES: Array<{
  name: string;
  description: string;
  permissionKeys: string[];
}> = [
  {
    name: 'Org Admin',
    description: 'Full control over the organisation, including engines, tasks, users, subaccounts and permission sets.',
    permissionKeys: Object.values(ORG_PERMISSIONS),
  },
  {
    name: 'Org Manager',
    description: 'Operational access: manage tasks and users, view subaccounts and executions.',
    permissionKeys: [
      ORG_PERMISSIONS.TASKS_VIEW,
      ORG_PERMISSIONS.TASKS_CREATE,
      ORG_PERMISSIONS.TASKS_EDIT,
      ORG_PERMISSIONS.TASKS_DELETE,
      ORG_PERMISSIONS.TASKS_ACTIVATE,
      ORG_PERMISSIONS.TASKS_TEST,
      ORG_PERMISSIONS.EXECUTIONS_VIEW,
      ORG_PERMISSIONS.USERS_VIEW,
      ORG_PERMISSIONS.USERS_INVITE,
      ORG_PERMISSIONS.USERS_EDIT,
      ORG_PERMISSIONS.CATEGORIES_VIEW,
      ORG_PERMISSIONS.SUBACCOUNTS_VIEW,
    ],
  },
  {
    name: 'Org Viewer',
    description: 'Read-only access to tasks, executions, users and subaccounts.',
    permissionKeys: [
      ORG_PERMISSIONS.TASKS_VIEW,
      ORG_PERMISSIONS.EXECUTIONS_VIEW,
      ORG_PERMISSIONS.USERS_VIEW,
      ORG_PERMISSIONS.CATEGORIES_VIEW,
      ORG_PERMISSIONS.SUBACCOUNTS_VIEW,
    ],
  },
  {
    name: 'Subaccount Admin',
    description: 'Full control over a subaccount: tasks, members, categories and settings.',
    permissionKeys: Object.values(SUBACCOUNT_PERMISSIONS),
  },
  {
    name: 'Subaccount Manager',
    description: 'Manage subaccount tasks, view all executions and manage members.',
    permissionKeys: [
      SUBACCOUNT_PERMISSIONS.TASKS_VIEW,
      SUBACCOUNT_PERMISSIONS.TASKS_EXECUTE,
      SUBACCOUNT_PERMISSIONS.TASKS_CREATE,
      SUBACCOUNT_PERMISSIONS.TASKS_EDIT,
      SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW,
      SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW_ALL,
      SUBACCOUNT_PERMISSIONS.USERS_VIEW,
      SUBACCOUNT_PERMISSIONS.USERS_INVITE,
      SUBACCOUNT_PERMISSIONS.USERS_EDIT,
      SUBACCOUNT_PERMISSIONS.CATEGORIES_MANAGE,
    ],
  },
  {
    name: 'Subaccount User',
    description: 'Basic portal access: execute tasks and view own execution history.',
    permissionKeys: [
      SUBACCOUNT_PERMISSIONS.TASKS_VIEW,
      SUBACCOUNT_PERMISSIONS.TASKS_EXECUTE,
      SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW,
    ],
  },
];
