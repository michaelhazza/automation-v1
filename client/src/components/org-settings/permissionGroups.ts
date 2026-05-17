const GROUP_META: Record<string, { label: string; description: string }> = {
  'org.automations':  { label: 'Automations',  description: 'Control who can view, create, edit, delete and run automations for this organisation.' },
  'org.connections':  { label: 'Connections',  description: 'Access to view integration and connection status across subaccounts.' },
  'org.executions':   { label: 'Executions',   description: 'Access to view execution history and logs across the organisation.' },
  'org.users':        { label: 'Users',        description: 'Manage team members — invite, view roles, and remove users from the organisation.' },
  'org.agents':       { label: 'Agents',       description: 'Manage AI agents — create, configure, activate and assign agents within the organisation.' },
  'org.subaccounts':  { label: 'Companies',    description: 'Manage client companies (subaccounts) — create, view and configure subaccounts.' },
  'org.billing':      { label: 'Billing',      description: 'Access billing information and manage subscription details.' },
  'org.settings':     { label: 'Settings',     description: 'Modify organisation-level settings and configuration.' },
  'org.skills':       { label: 'Skills',       description: 'Manage AI skills — create and configure reusable skill definitions.' },
  'org.workflows':    { label: 'Workflows',    description: 'Access and manage automation workflows.' },
};

export function getGroupMeta(groupKey: string) {
  return GROUP_META[groupKey] ?? { label: groupKey.replace(/^org\./, '').replace(/\./g, ' '), description: '' };
}
