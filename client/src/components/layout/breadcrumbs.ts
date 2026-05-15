// ── Avatar color from string hash ──────────────────────────────────────────
export const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#22c55e','#0ea5e9','#14b8a6'];

export function avatarColor(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function toInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

// ── Breadcrumb derivation from URL ─────────────────────────────────────────
export const SEG: Record<string, string | null> = {
  admin: null, system: null,
  subaccounts: 'Companies', agents: 'AI Team', automations: 'Automations', workflows: 'Workflows',
  executions: 'Activity', workspace: 'Tasks', memory: 'Memory',
  portal: 'Portal', settings: 'Settings', organisations: 'Organisations',
  users: 'Team', skills: 'Skills', activity: 'Activity',
  'task-queue': 'Diagnostics', 'board-templates': 'Board Templates',
  'review-queue': 'Inbox', inbox: 'Inbox', 'scheduled-tasks': 'Scheduled', runs: 'Run Trace', goals: 'Goals', briefs: 'Tasks', tasks: 'Tasks',
  'org-settings': 'Manage Org', connections: 'Connections', projects: 'Projects',
  'agent-templates': 'Subaccount Blueprints',
  'admin-settings': 'Settings',
  usage: 'Usage & Costs',
  'mcp-servers': 'Integrations',
  'llm-pnl': 'LLM P&L',
  'spending-budgets': 'Spending Budgets',
  'spend-ledger': 'Spend Ledger',
  'approval-channels': 'Approval Channels',
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildBreadcrumbs(pathname: string, clientName: string | null) {
  if (pathname === '/') return [];
  const parts = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; to: string }[] = [];
  let path = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    path += '/' + part;
    if (UUID_RE.test(part)) {
      if (parts[i - 1] === 'subaccounts' && clientName) {
        crumbs.push({ label: clientName, to: path });
      }
      continue;
    }
    const label = SEG[part];
    if (label === null) continue;
    if (label === undefined) {
      crumbs.push({ label: part.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), to: path });
    } else {
      crumbs.push({ label, to: path });
    }
  }
  return crumbs;
}
