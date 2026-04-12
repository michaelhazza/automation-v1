import { useState, useEffect, useRef, useCallback } from 'react';
import CommandPalette from './CommandPalette';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { User } from '../lib/auth';
import api from '../lib/api';
import {
  removeToken, removeUserRole,
  removeActiveOrg, getActiveOrgId, getActiveOrgName, setActiveOrg,
  getActiveClientId, getActiveClientName, setActiveClient, removeActiveClient,
} from '../lib/auth';
import { useSocketRoom } from '../hooks/useSocket';
import { getSocket, disconnectSocket, reconnectSocket } from '../lib/socket';

interface LayoutProps {
  user: User;
  children: React.ReactNode;
}

interface OrgOption { id: string; name: string; }
interface ClientOption { id: string; name: string; slug: string; status: string; }

// ── Avatar color from string hash ──────────────────────────────────────────
const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#22c55e','#0ea5e9','#14b8a6'];
function avatarColor(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function toInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

// ── SVG icons ──────────────────────────────────────────────────────────────
const Ico = ({ children, size = 15 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    className="shrink-0">{children}</svg>
);

const Icons = {
  bolt:        () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  platform:    () => <Ico><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></Ico>,
  inbox:       () => <Ico><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></Ico>,
  projects:    () => <Ico><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></Ico>,
  agents:      () => <Ico><path d="M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2z"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><circle cx="18" cy="8" r="3"/><path d="M21 6l-1 1-1-1"/></Ico>,
  automations: () => <Ico><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></Ico>,
  activity:    () => <Ico><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ico>,
  tasks:       () => <Ico><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></Ico>,
  scheduled:   () => <Ico><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></Ico>,
  memory:      () => <Ico><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></Ico>,
  portal:      () => <Ico><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></Ico>,
  usage:       () => <Ico><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></Ico>,
  settings:    () => <Ico><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></Ico>,
  clients:     () => <Ico><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></Ico>,
  team:        () => <Ico><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Ico>,
  orgs:        () => <Ico><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></Ico>,
  skills:      () => <Ico><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></Ico>,
  connections: () => <Ico><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><circle cx="18" cy="6" r="4"/><path d="M18 4v4"/><path d="M16 6h4"/></Ico>,
  goals:       () => <Ico><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></Ico>,
  diagnostic:  () => <Ico><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></Ico>,
  boardTpl:    () => <Ico><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></Ico>,
  logout:      () => <Ico><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></Ico>,
  chevDown:    () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
  chevRight:   () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  search:      () => <Ico><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></Ico>,
  dashboard:   () => <Ico><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="14"/><rect x="14" y="14" width="7" height="7"/></Ico>,
};

// ── Breadcrumb derivation from URL ─────────────────────────────────────────
const SEG: Record<string, string | null> = {
  admin: null, system: null,
  subaccounts: 'Companies', agents: 'AI Team', processes: 'Workflows',
  executions: 'Activity', workspace: 'Tasks', memory: 'Memory',
  portal: 'Portal', settings: 'Settings', organisations: 'Organisations',
  users: 'Team', skills: 'Skills', activity: 'Activity',
  'task-queue': 'Diagnostics', 'board-templates': 'Board Templates',
  'review-queue': 'Inbox', inbox: 'Inbox', 'scheduled-tasks': 'Scheduled', runs: 'Run Trace', goals: 'Goals',
  'org-settings': 'Manage Org', connections: 'Connections', projects: 'Projects',
  'agent-templates': 'Team Templates',
  'admin-settings': 'Settings',
  usage: 'Usage & Costs',
  'mcp-servers': 'Integrations',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildBreadcrumbs(pathname: string, clientName: string | null) {
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

// ── NavItem ────────────────────────────────────────────────────────────────
function NavItem({
  to, icon, label, badge, badgeLabel, exact = false, manageTo,
}: { to: string; icon: React.ReactNode; label: string; badge?: number; badgeLabel?: string; exact?: boolean; manageTo?: string }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const baseTo = to.split('?')[0]; // ignore query params for matching
  const active = exact ? pathname === baseTo : pathname === baseTo || pathname.startsWith(baseTo + '/');
  return (
    <Link
      to={to}
      className={`group flex items-center gap-[9px] px-3 py-[7px] mx-1.5 my-px rounded-[7px] text-[13px] font-medium no-underline transition-[color,background] duration-100 ${
        active
          ? 'text-slate-100 bg-white/[0.08]'
          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
      }`}
    >
      <span className={active ? 'text-indigo-300' : ''}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badgeLabel ? (
        <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-400">
          <span className="w-[6px] h-[6px] rounded-full bg-blue-400 animate-pulse" />
          {badgeLabel}
        </span>
      ) : !!badge && badge > 0 ? (
        <span className="min-w-[18px] h-[18px] rounded-[9px] px-[5px] bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
      {manageTo ? (
        <button
          type="button"
          title="Manage"
          aria-label={`Manage ${label}`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(manageTo); }}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-[18px] h-[18px] flex items-center justify-center rounded text-slate-500 hover:text-slate-200 hover:bg-white/[0.10] border-0 bg-transparent cursor-pointer transition-opacity p-0 shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      ) : null}
    </Link>
  );
}

// ── NavSectionAction (+ button) ────────────────────────────────────────────
function NavSectionAction({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-[16px] h-[16px] flex items-center justify-center rounded text-slate-500 hover:text-slate-300 hover:bg-white/[0.08] border-0 bg-transparent cursor-pointer transition-colors text-[13px] leading-none p-0"
    >
      +
    </button>
  );
}

function NavSection({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="px-[18px] pt-[14px] pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] flex items-center justify-between">
      <span>{label}</span>
      {action}
    </div>
  );
}

// ── Trial Countdown (sidebar footer) ──────────────────────────────────────
function TrialCountdown() {
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api.get('/api/my-subscription').then(({ data }) => {
      setStatus(data.status ?? null);
      setTrialEndsAt(data.trialEndsAt ?? null);
    }).catch(() => { /* not available yet */ });
  }, []);

  if (status !== 'trialing' || !trialEndsAt) return null;

  const msLeft = new Date(trialEndsAt).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

  let label = '';
  let cls = 'text-slate-500';
  if (daysLeft > 7) {
    label = `${daysLeft} days left in trial`;
    cls = 'text-slate-500';
  } else if (daysLeft > 2) {
    label = `${daysLeft} days left in trial`;
    cls = 'text-amber-400';
  } else if (daysLeft === 2) {
    label = 'Trial ends in 2 days';
    cls = 'text-red-400';
  } else if (daysLeft === 1) {
    label = 'Trial ends tomorrow';
    cls = 'text-red-400';
  } else {
    label = 'Trial ends today';
    cls = 'text-red-400';
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-[6px] mx-1.5 my-px text-[11.5px] font-medium ${cls}`}>
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <span>{label}</span>
    </div>
  );
}

// ── Main Layout ────────────────────────────────────────────────────────────
export default function Layout({ user, children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isSystemAdmin = user.role === 'system_admin';

  // Org context
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(getActiveOrgId);
  const [activeOrgName, setActiveOrgNameState] = useState<string | null>(getActiveOrgName);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);
  const orgPickerRef = useRef<HTMLDivElement>(null);

  // Client context
  const [activeClientId, setActiveClientIdState] = useState<string | null>(getActiveClientId);
  const [activeClientName, setActiveClientNameState] = useState<string | null>(getActiveClientName);
  const [subaccounts, setSubaccounts] = useState<ClientOption[]>([]);

  // Permissions
  const [orgPerms, setOrgPerms] = useState<Set<string>>(new Set());
  const [clientPerms, setClientPerms] = useState<Set<string>>(new Set());

  // Badges
  const [reviewCount, setReviewCount] = useState(0);
  const [liveAgentCount, setLiveAgentCount] = useState(0);

  // Inline create modals
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState('#6366f1');
  const [createProjectLoading, setCreateProjectLoading] = useState(false);
  const [newProjectRepoUrl, setNewProjectRepoUrl] = useState('');

  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentDesc, setNewAgentDesc] = useState('');
  const [newAgentPrompt, setNewAgentPrompt] = useState('');
  const [newAgentIcon, setNewAgentIcon] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [createAgentLoading, setCreateAgentLoading] = useState(false);
  const [createAgentError, setCreateAgentError] = useState('');

  // New Client modal
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientSlug, setNewClientSlug] = useState('');
  const [createClientError, setCreateClientError] = useState('');
  const [createClientLoading, setCreateClientLoading] = useState(false);

  // New Issue modal
  const [showNewIssue, setShowNewIssue] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState('');
  const [newIssueDesc, setNewIssueDesc] = useState('');
  const [newIssuePriority, setNewIssuePriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [newIssueLoading, setNewIssueLoading] = useState(false);

  // Dynamic nav lists
  interface NavProject { id: string; name: string; color: string; status: string; }
  interface NavAgent { id: string; agentId: string; agent: { name: string; icon: string | null; status: string }; agentRole: string | null; isActive: boolean; }
  const [navProjects, setNavProjects] = useState<NavProject[]>([]);
  const [navAgents, setNavAgents] = useState<NavAgent[]>([]);

  // Budget alert
  interface BudgetAlert { pct: number; spent: number; limit: number; }
  const [budgetAlert, setBudgetAlert] = useState<BudgetAlert | null>(null);

  // Command palette
  const [cmdOpen, setCmdOpen] = useState(false);

  // Module-driven sidebar config
  const [sidebarItems, setSidebarItems] = useState<Set<string> | null>(null);
  const [sidebarLoaded, setSidebarLoaded] = useState(false);

  const hasOrgContext = isSystemAdmin ? !!activeOrgId : !!user.organisationId;
  const hasAnyOrgPerm = orgPerms.size > 0;
  const hasOrgPerm = (key: string) => orgPerms.has('__system_admin__') || orgPerms.has('__org_admin__') || orgPerms.has(key);
  const hasClientPerm = (key: string) => clientPerms.has('__system_admin__') || clientPerms.has('__org_admin__') || orgPerms.has('__org_admin__') || clientPerms.has(key);
  /** Check if a nav-item slug is enabled by the module sidebar config. System admins bypass. Returns false while loading to prevent flash. */
  const hasSidebarItem = (slug: string) => {
    if (!sidebarLoaded) return false; // suppress until config loaded
    return !sidebarItems || sidebarItems.has(slug);
  };

  // Auto-set org context for non-system-admin users who belong to an org
  useEffect(() => {
    if (!isSystemAdmin && user.organisationId && !activeOrgId) {
      api.get('/api/organisations/mine').then(({ data }) => {
        const name = data?.name ?? 'My Organisation';
        setActiveOrg(user.organisationId, name);
        setActiveOrgIdState(user.organisationId);
        setActiveOrgNameState(name);
      }).catch(() => {
        // Fallback: set org ID without name so pages at least work
        setActiveOrg(user.organisationId, 'My Organisation');
        setActiveOrgIdState(user.organisationId);
        setActiveOrgNameState('My Organisation');
      });
    }
  }, [isSystemAdmin, user.organisationId, activeOrgId]);

  // Fetch orgs list (system admin)
  useEffect(() => {
    if (isSystemAdmin) {
      api.get('/api/organisations').then(({ data }) => setOrgs(data)).catch((err) => console.error('[Layout] Failed to fetch organisations:', err));
    }
  }, [isSystemAdmin]);

  // Fetch subaccounts
  useEffect(() => {
    if (hasOrgContext) {
      api.get('/api/subaccounts').then(({ data }) => setSubaccounts(data)).catch((err) => { console.error('[Layout] Failed to fetch subaccounts:', err); setSubaccounts([]); });
    } else {
      setSubaccounts([]);
      if (activeClientId) { removeActiveClient(); setActiveClientIdState(null); setActiveClientNameState(null); }
    }
  }, [hasOrgContext, activeOrgId]);

  // Fetch org permissions
  useEffect(() => {
    if (isSystemAdmin) { setOrgPerms(new Set(['__system_admin__'])); return; }
    if (hasOrgContext) {
      api.get('/api/my-permissions').then(({ data }) => setOrgPerms(new Set(data.permissions))).catch((err) => { console.error('[Layout] Failed to fetch org permissions:', err); setOrgPerms(new Set()); });
    } else { setOrgPerms(new Set()); }
  }, [hasOrgContext, activeOrgId, isSystemAdmin]);

  // Fetch client permissions
  useEffect(() => {
    if (isSystemAdmin) { setClientPerms(new Set(['__system_admin__'])); return; }
    if (activeClientId) {
      api.get(`/api/subaccounts/${activeClientId}/my-permissions`).then(({ data }) => setClientPerms(new Set(data.permissions))).catch((err) => { console.error('[Layout] Failed to fetch client permissions:', err); setClientPerms(new Set()); });
    } else { setClientPerms(new Set()); }
  }, [activeClientId, isSystemAdmin]);

  // Fetch module-driven sidebar config
  useEffect(() => {
    if (isSystemAdmin) { setSidebarItems(null); setSidebarLoaded(true); return; }
    if (hasOrgContext) {
      setSidebarLoaded(false);
      api.get('/api/my-sidebar-config').then(({ data }) => {
        if (data.items && Array.isArray(data.items) && data.items.length > 0) {
          setSidebarItems(new Set(data.items));
        } else {
          setSidebarItems(null); // No module config = show default (all items)
        }
      }).catch(() => setSidebarItems(null)).finally(() => setSidebarLoaded(true));
    } else { setSidebarItems(null); setSidebarLoaded(true); }
  }, [hasOrgContext, activeOrgId, isSystemAdmin]);

  // Review queue badge — initial load + WebSocket updates
  useEffect(() => {
    if (!activeClientId) { setReviewCount(0); return; }
    api.get(`/api/subaccounts/${activeClientId}/review-queue/count`).then(({ data }) => setReviewCount(data.count ?? 0)).catch((err) => console.error('[Layout] Failed to fetch review queue count:', err));
  }, [activeClientId]);

  // Live agent badge — initial load + WebSocket updates
  useEffect(() => {
    if (!activeClientId) { setLiveAgentCount(0); return; }
    api.get(`/api/subaccounts/${activeClientId}/live-status`).then(({ data }) => setLiveAgentCount(data.runningAgents ?? 0)).catch((err) => console.error('[Layout] Failed to fetch live status:', err));
  }, [activeClientId]);

  // Resync function — re-fetch all badge counts from REST (used on reconnect)
  const resyncBadges = useCallback(() => {
    if (!activeClientId) return;
    api.get(`/api/subaccounts/${activeClientId}/review-queue/count`).then(({ data }) => setReviewCount(data.count ?? 0)).catch((err) => console.error('[Layout] Failed to resync review count:', err));
    api.get(`/api/subaccounts/${activeClientId}/live-status`).then(({ data }) => setLiveAgentCount(data.runningAgents ?? 0)).catch((err) => console.error('[Layout] Failed to resync live status:', err));
    api.get(`/api/subaccounts/${activeClientId}/usage/summary`)
      .then(({ data }) => {
        const spent = data.monthly?.totalCostCents ?? 0;
        const limit = data.limits?.monthlyCostLimitCents;
        if (!limit || limit <= 0) { setBudgetAlert(null); return; }
        const pct = spent / limit;
        if (pct >= 0.75) setBudgetAlert({ pct, spent, limit });
        else setBudgetAlert(null);
      }).catch((err) => console.error('[Layout] Failed to resync usage summary:', err));
  }, [activeClientId]);

  // WebSocket: subscribe to subaccount room for live updates
  // On reconnect, re-fetch baseline state via REST to avoid stale counts
  useSocketRoom('subaccount', activeClientId, {
    'live:agent_started': () => setLiveAgentCount(c => c + 1),
    'live:agent_completed': () => setLiveAgentCount(c => Math.max(0, c - 1)),
    'review:item_updated': () => {
      // Re-fetch count on any review change
      if (activeClientId) api.get(`/api/subaccounts/${activeClientId}/review-queue/count`).then(({ data }) => setReviewCount(data.count ?? 0)).catch((err) => console.error('[Layout] Failed to refresh review count:', err));
    },
    'review:item_created': () => setReviewCount(c => c + 1),
    'budget:update': (data: unknown) => {
      const d = data as { pct?: number; spent?: number; limit?: number };
      if (d.pct !== undefined && d.pct >= 0.75) setBudgetAlert({ pct: d.pct, spent: d.spent ?? 0, limit: d.limit ?? 0 });
      else setBudgetAlert(null);
    },
  }, resyncBadges);

  // Dynamic nav: projects + agents for active client
  useEffect(() => {
    if (!activeClientId) { setNavProjects([]); setNavAgents([]); return; }
    api.get(`/api/subaccounts/${activeClientId}/projects`).then(({ data }) =>
      setNavProjects((data as NavProject[]).filter(p => p.status === 'active').slice(0, 12))
    ).catch((err) => { console.error('[Layout] Failed to fetch nav projects:', err); setNavProjects([]); });
    api.get(`/api/subaccounts/${activeClientId}/agents`).then(({ data }) =>
      setNavAgents((data as NavAgent[]).filter(a => a.isActive))
    ).catch((err) => { console.error('[Layout] Failed to fetch nav agents:', err); setNavAgents([]); });
  }, [activeClientId]);

  // Budget alert — initial load (updates come via WebSocket 'budget:update')
  useEffect(() => {
    if (!activeClientId) { setBudgetAlert(null); return; }
    api.get(`/api/subaccounts/${activeClientId}/usage/summary`)
      .then(({ data }) => {
        const spent = data.monthly?.totalCostCents ?? 0;
        const limit = data.limits?.monthlyCostLimitCents;
        if (!limit || limit <= 0) { setBudgetAlert(null); return; }
        const pct = spent / limit;
        if (pct >= 0.75) setBudgetAlert({ pct, spent, limit });
        else setBudgetAlert(null);
      }).catch((err) => console.error('[Layout] Failed to fetch budget alert:', err));
  }, [activeClientId]);

  // Initialise WebSocket connection
  useEffect(() => {
    getSocket();
    return () => { /* Keep connection alive across Layout re-renders */ };
  }, []);

  // Cmd+K to open command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(o => !o); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleSelectClientFromPalette = useCallback((id: string, name: string) => {
    setActiveClientIdState(id);
    setActiveClientNameState(name);
  }, []);

  // Close org picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (orgPickerRef.current && !orgPickerRef.current.contains(e.target as Node)) setOrgPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelectOrg = (org: OrgOption) => {
    setActiveOrg(org.id, org.name);
    setActiveOrgIdState(org.id);
    setActiveOrgNameState(org.name);
    setOrgPickerOpen(false);
    removeActiveClient();
    setActiveClientIdState(null);
    setActiveClientNameState(null);
    reconnectSocket(); // Reconnect with new org context
    navigate('/');
  };

  const handleSelectClient = (sa: ClientOption) => {
    setActiveClient(sa.id, sa.name);
    setActiveClientIdState(sa.id);
    setActiveClientNameState(sa.name);
  };

  const handleLogout = async () => {
    try { await api.post('/api/auth/logout'); } finally {
      disconnectSocket();
      removeToken(); removeUserRole(); removeActiveOrg(); removeActiveClient();
      navigate('/login');
    }
  };

  const userInitials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || '?';
  const breadcrumbs = buildBreadcrumbs(location.pathname, activeClientName);

  return (
    <div className="flex h-screen overflow-hidden">
      <CommandPalette
        isOpen={cmdOpen}
        onClose={() => setCmdOpen(false)}
        activeClientId={activeClientId}
        onSelectClient={handleSelectClientFromPalette}
      />

      {/* ── Icon Rail ─────────────────────────────────────────────────── */}
      <aside className="w-14 bg-[#080e1a] flex flex-col items-center pt-2.5 pb-2.5 border-r border-white/5 shrink-0 gap-1">
        {/* App logo */}
        <Link to="/" className="no-underline mb-1.5">
          <div className="w-9 h-9 rounded-[10px] cursor-pointer bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-[0_2px_8px_rgba(99,102,241,0.4)]">
            <Icons.bolt />
          </div>
        </Link>

        {/* Org picker — system admin only */}
        {isSystemAdmin && (
          <div ref={orgPickerRef} className="relative w-full flex justify-center">
            <button
              onClick={() => setOrgPickerOpen(o => !o)}
              title={activeOrgName ?? 'Select organisation'}
              className={`w-9 h-9 rounded-lg border-none cursor-pointer flex items-center justify-center transition-colors duration-150 [font-family:inherit] ${
                activeOrgId
                  ? 'bg-indigo-500/25 text-indigo-300'
                  : 'bg-white/[0.06] text-slate-600'
              }`}
            >
              <Icons.platform />
            </button>
            {orgPickerOpen && (
              <div className="absolute left-11 top-0 z-[300] bg-slate-800 border border-white/10 rounded-[10px] shadow-[0_16px_48px_rgba(0,0,0,0.6)] w-[220px] max-h-[280px] overflow-y-auto">
                <div className="px-3 pt-2 pb-[5px] text-[10px] font-bold text-slate-600 uppercase tracking-[0.1em]">
                  Organisation
                </div>
                {orgs.length === 0 && (
                  <div className="px-[14px] py-[10px] text-slate-600 text-xs">No organisations</div>
                )}
                {orgs.map(org => (
                  <button
                    key={org.id}
                    onClick={() => handleSelectOrg(org)}
                    className={`block w-full text-left px-[14px] py-[9px] border-0 border-b border-white/5 text-[13px] cursor-pointer [font-family:inherit] transition-colors ${
                      org.id === activeOrgId
                        ? 'bg-indigo-500/[0.15] text-indigo-300'
                        : 'bg-transparent text-slate-300'
                    }`}
                  >
                    {org.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Divider above client icons */}
        {hasOrgContext && subaccounts.length > 0 && (
          <div className="w-6 h-px bg-white/[0.07] my-0.5" />
        )}

        {/* Client icons */}
        {subaccounts.map(sa => {
          const isActive = sa.id === activeClientId;
          const bg = avatarColor(sa.name);
          return (
            <div key={sa.id} className="relative w-full flex items-center justify-center">
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-[3px] bg-white" />
              )}
              <button
                onClick={() => handleSelectClient(sa)}
                title={sa.name}
                style={{ background: bg }}
                className={`w-9 h-9 border-none cursor-pointer text-white text-xs font-bold tracking-[-0.02em] flex items-center justify-center [font-family:inherit] transition-[border-radius,opacity,box-shadow] duration-150 ${
                  isActive
                    ? 'rounded-[10px] opacity-100 shadow-[0_0_0_2px_rgba(255,255,255,0.2)]'
                    : 'rounded-[14px] opacity-[0.55] hover:opacity-[0.85]'
                }`}
              >
                {toInitials(sa.name)}
              </button>
              {sa.status !== 'active' && (
                <div className={`absolute bottom-0.5 right-[7px] w-2 h-2 rounded-full border-[1.5px] border-[#080e1a] ${
                  sa.status === 'suspended' ? 'bg-amber-400' : 'bg-slate-500'
                }`} />
              )}
            </div>
          );
        })}

        {/* New Client button */}
        {hasOrgContext && hasOrgPerm('org.subaccounts.edit') && (
          <button
            onClick={() => { setShowCreateClient(true); setCreateClientError(''); setNewClientName(''); setNewClientSlug(''); }}
            title="New company"
            className="w-9 h-9 rounded-[14px] border border-dashed border-white/20 cursor-pointer bg-transparent text-white/40 hover:text-white/70 hover:border-white/40 text-lg font-light flex items-center justify-center transition-all duration-150"
          >
            +
          </button>
        )}

        <div className="flex-1" />

        {/* User avatar */}
        <button
          onClick={() => navigate('/settings')}
          title={`${user.firstName} ${user.lastName}`}
          className="w-8 h-8 rounded-lg border border-white/10 cursor-pointer bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center text-[11px] font-bold text-slate-200 [font-family:inherit]"
        >
          {userInitials}
        </button>
      </aside>

      {/* ── Main Sidebar ──────────────────────────────────────────────── */}
      <aside className="sidebar-scroll w-[220px] bg-slate-900 flex flex-col border-r border-white/5 shrink-0 overflow-y-auto overflow-x-hidden">
        {/* Context header */}
        <div className="px-[18px] pt-[14px] pb-3 border-b border-white/5">
          {activeClientId && activeClientName ? (
            <>
              <div className="text-[13px] font-bold text-slate-100 overflow-hidden text-ellipsis whitespace-nowrap">
                {activeClientName}
              </div>
              <div className="text-[11px] text-slate-700 mt-0.5">Company workspace</div>
            </>
          ) : hasOrgContext ? (
            <>
              <div className="text-[13px] font-bold text-slate-100">
                {isSystemAdmin ? (activeOrgName ?? 'Organisation') : 'Organisation'}
              </div>
              <div className="text-[11px] text-slate-700 mt-0.5">Org workspace</div>
            </>
          ) : isSystemAdmin ? (
            <>
              <div className="text-[13px] font-bold text-slate-100">Platform</div>
              <div className="text-[11px] text-slate-700 mt-0.5">System admin</div>
            </>
          ) : (
            <div className="text-[13px] font-bold text-slate-100">Automation OS</div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex-1 py-1 overflow-y-auto overflow-x-hidden">

          {/* ── Top controls — always visible when client selected */}
          {hasOrgContext && activeClientId && (
            <>
              <button
                onClick={() => setShowNewIssue(true)}
                className="flex items-center gap-[9px] px-3 py-[7px] mx-1.5 my-px rounded-[7px] text-[13px] font-medium border-0 cursor-pointer transition-[color,background] duration-100 text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] bg-transparent w-[calc(100%-12px)] text-left [font-family:inherit]"
              >
                <span><Icons.bolt /></span>
                <span className="flex-1">New Issue</span>
              </button>
              <NavItem to="/" exact icon={<Icons.dashboard />} label="Dashboard" badge={liveAgentCount > 0 ? liveAgentCount : undefined} badgeLabel={liveAgentCount > 0 ? `${liveAgentCount} live` : undefined} />
              {(hasClientPerm('subaccount.review.view') || hasOrgPerm('org.review.view')) && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/inbox`} icon={<Icons.inbox />} label="Inbox" badge={reviewCount} />
              )}
            </>
          )}

          {/* ── Fallback dashboard when no client selected */}
          {!(hasOrgContext && activeClientId) && (
            <NavItem to="/" exact icon={<Icons.dashboard />} label="Dashboard" />
          )}

          {/* ── Work section */}
          {hasOrgContext && activeClientId && (
            <>
              <NavSection label="Work" />
              {(hasClientPerm('subaccount.workspace.view') || hasOrgPerm('org.workspace.view')) && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/workspace`} icon={<Icons.tasks />} label="Tasks" />
              )}
              {hasOrgPerm('org.processes.view') && (
                <NavItem to="/processes" icon={<Icons.automations />} label="Workflows" />
              )}
              {(hasOrgPerm('org.agents.view') || hasOrgPerm('org.playbook_templates.read')) && (
                <NavItem to="/playbooks" icon={<Icons.automations />} label="Playbooks" />
              )}
              {(hasClientPerm('subaccount.workspace.manage') || hasOrgPerm('org.workspace.manage')) && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/scheduled-tasks`} icon={<Icons.scheduled />} label="Scheduled" />
              )}
              {(hasClientPerm('subaccount.workspace.view') || hasOrgPerm('org.workspace.view')) && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/page-projects`} icon={<Icons.portal />} label="Sites" />
              )}
              {hasOrgPerm('org.agents.view') && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/triggers`} icon={<Icons.scheduled />} label="Triggers" />
              )}
              {hasOrgPerm('org.agents.edit') && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/tags`} icon={<Icons.settings />} label="Tags" />
              )}
              {(hasClientPerm('subaccount.workspace.view') || hasOrgPerm('org.workspace.view')) && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/goals`} icon={<Icons.goals />} label="Goals" />
              )}
              {(hasClientPerm('subaccount.workspace.view') || hasOrgPerm('org.workspace.view')) && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/actions`} icon={<Icons.activity />} label="Action Log" />
              )}
            </>
          )}

          {/* ── Projects section — dynamic list */}
          {hasOrgContext && activeClientId && (
            <>
              <NavSection label="Projects" action={<NavSectionAction onClick={() => setShowCreateProject(true)} />} />
              {navProjects.length === 0 && (
                <div className="px-[18px] py-1 text-[11px] text-slate-600 italic">No projects yet</div>
              )}
              {navProjects.map((p) => (
                <NavItem
                  key={p.id}
                  to={`/projects/${p.id}`}
                  icon={<span className="w-[10px] h-[10px] rounded-full shrink-0" style={{ background: p.color }} />}
                  label={p.name}
                />
              ))}
            </>
          )}

          {/* ── Agents section — dynamic list */}
          {hasOrgContext && activeClientId && (
            <>
              <NavSection label="Agents" action={<NavSectionAction onClick={() => setShowCreateAgent(true)} />} />
              {navAgents.length === 0 && (
                <div className="px-[18px] py-1 text-[11px] text-slate-600 italic">No agents yet</div>
              )}
              {navAgents.map((a) => (
                <NavItem
                  key={a.id}
                  to={`/agents/${a.agentId}`}
                  icon={a.agent.icon ? <span className="text-[13px] shrink-0 leading-none">{a.agent.icon}</span> : <Icons.agents />}
                  label={a.agent.name}
                  manageTo={`/admin/subaccounts/${activeClientId}/agents/${a.id}/manage`}
                />
              ))}
            </>
          )}

          {/* ── Company section */}
          {hasOrgContext && activeClientId && (
            <>
              <NavSection label="Company" />
              {hasOrgPerm('org.agents.view') && (
                <NavItem to="/org-chart" icon={<Icons.orgs />} label="Org Chart" />
              )}
              {hasOrgPerm('org.agents.view') && (
                <NavItem to="/admin/skills" icon={<Icons.skills />} label="Skills" />
              )}
              {hasOrgPerm('org.subaccounts.view') && (
                <NavItem to={`/portal/${activeClientId}`} icon={<Icons.portal />} label="Portal" />
              )}
              <NavItem to="/executions" icon={<Icons.activity />} label="Activity" />
              <NavItem to={`/admin/subaccounts/${activeClientId}/team`} icon={<Icons.team />} label="Team" />
              {hasOrgPerm('org.subaccounts.edit') && (
                <NavItem to={`/admin/subaccounts/${activeClientId}`} exact icon={<Icons.settings />} label="Manage" />
              )}
            </>
          )}

          {/* ── ClientPulse section — shown when org has client_pulse module */}
          {hasOrgContext && hasSidebarItem('clientpulse') && (
            <>
              <NavSection label="ClientPulse" />
              <NavItem to="/clientpulse" exact icon={<Icons.dashboard />} label="Dashboard" />
              {hasSidebarItem('reports') && <NavItem to="/reports" icon={<Icons.skills />} label="Reports" />}
            </>
          )}

          {/* ── Organisation section — always shown when org context exists */}
          {hasOrgContext && hasAnyOrgPerm && (
            <>
              <NavSection label="Organisation" />
              {hasSidebarItem('inbox') && (hasOrgPerm('org.review.view') || hasOrgPerm('org.subaccounts.view')) && <NavItem to="/inbox" icon={<Icons.inbox />} label="Inbox" />}
              {hasSidebarItem('companies') && hasOrgPerm('org.subaccounts.view') && <NavItem to="/admin/subaccounts" exact icon={<Icons.clients />} label="Companies" />}
              {hasSidebarItem('agents') && hasOrgPerm('org.agents.view') && <NavItem to="/admin/agents" icon={<Icons.agents />} label="Agents" />}
              {hasSidebarItem('workflows') && hasOrgPerm('org.processes.view') && <NavItem to="/admin/processes" icon={<Icons.automations />} label="Workflows" />}
              {hasSidebarItem('skills') && <NavItem to="/admin/skills" icon={<Icons.skills />} label="Skills" />}
              {hasSidebarItem('integrations') && hasOrgPerm('org.mcp_servers.view') && <NavItem to="/admin/mcp-servers" icon={<Icons.connections />} label="Integrations" />}
              {hasSidebarItem('team') && hasOrgPerm('org.users.view') && <NavItem to="/admin/users" icon={<Icons.team />} label="Team" />}
              {hasSidebarItem('ops') && hasOrgPerm('org.executions.view') && <NavItem to="/admin/ops" icon={<Icons.activity />} label="Ops Dashboard" />}
              {hasSidebarItem('skills') && hasOrgPerm('org.agents.view') && <NavItem to="/admin/skill-studio" icon={<Icons.skills />} label="Skill Studio" />}
              {hasSidebarItem('health') && hasOrgPerm('org.health_audit.view') && <NavItem to="/admin/health-findings" icon={<Icons.diagnostic />} label="Health" />}
              {hasSidebarItem('manage_org') && (hasOrgPerm('org.categories.view') || hasOrgPerm('org.engines.view') || isSystemAdmin) && <NavItem to="/admin/org-settings" icon={<Icons.settings />} label="Manage Org" />}
            </>
          )}

          {/* ── Platform section — system admin */}
          {isSystemAdmin && (
            <>
              <NavSection label="Platform" />
              <NavItem to="/system/organisations" icon={<Icons.orgs />} label="Organisations" />
              <NavItem to="/system/agents" icon={<Icons.agents />} label="Agents" />
              <NavItem to="/system/skills" icon={<Icons.skills />} label="Skills" />
              <NavItem to="/system/playbook-studio" icon={<Icons.automations />} label="Playbook Studio" />
              <NavItem to="/system/processes" icon={<Icons.automations />} label="Workflows" />
              <NavItem to="/system/ops" icon={<Icons.activity />} label="Ops Dashboard" />
              <NavItem to="/system/skill-studio" icon={<Icons.skills />} label="Skill Studio" />
              <NavItem to="/system/activity" icon={<Icons.activity />} label="Activity" />
              <NavItem to="/system/task-queue" icon={<Icons.diagnostic />} label="Diagnostics" />
              <NavItem to="/system/job-queues" icon={<Icons.diagnostic />} label="Job Queues" />
              <NavItem to="/system/config-templates" icon={<Icons.agents />} label="Config Templates" />
              <NavItem to="/system/modules" icon={<Icons.boardTpl />} label="Modules" />
              <NavItem to="/system/settings" icon={<Icons.settings />} label="Settings" />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-1.5 pt-1.5 pb-2 border-t border-white/5">
          <TrialCountdown />
          <NavItem to="/settings" exact icon={<Icons.settings />} label="Profile Settings" />
          <button
            onClick={handleLogout}
            className="flex items-center gap-[9px] px-3 py-[7px] w-[calc(100%-12px)] mx-1.5 my-px border-none cursor-pointer rounded-[7px] bg-transparent text-slate-600 text-[13px] font-medium [font-family:inherit] transition-[color,background] duration-100 hover:text-slate-100 hover:bg-white/[0.04]"
          >
            <Icons.logout />
            <span>Sign out</span>
          </button>
          <a
            href="mailto:support@synthetos.ai"
            className="flex items-center gap-[9px] px-3 py-[5px] mx-1.5 my-px rounded-[7px] text-slate-700 text-[12px] no-underline transition-[color,background] duration-100 hover:text-slate-400 hover:bg-white/[0.04]"
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>Need help?</span>
          </a>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-50">

        {/* Breadcrumb bar */}
        <div className="h-[42px] pr-4 pl-6 flex items-center bg-white border-b border-slate-200 shrink-0 text-[13px] gap-1.5">
          <div className="flex-1 flex items-center gap-1.5">
            {breadcrumbs.length === 0
              ? <span className="text-slate-900 font-semibold">Dashboard</span>
              : breadcrumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-slate-300">›</span>}
                  {i === breadcrumbs.length - 1
                    ? <span className="text-slate-900 font-semibold">{crumb.label}</span>
                    : <Link to={crumb.to} className="text-slate-500 no-underline hover:text-indigo-500 transition-colors duration-100">{crumb.label}</Link>
                  }
                </span>
              ))
            }
          </div>
          {/* Cmd+K trigger */}
          <button
            onClick={() => setCmdOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer bg-slate-100 border border-slate-200 text-slate-400 text-xs [font-family:inherit] transition-[border-color,color] duration-100 hover:border-indigo-500 hover:text-indigo-500"
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span>Search</span>
            <span className="text-[10px] opacity-60">⌘K</span>
          </button>
        </div>

        {/* Budget alert banner */}
        {budgetAlert && activeClientId && (
          <div className={`flex items-center gap-3 px-5 py-2.5 text-[13px] shrink-0 ${
            budgetAlert.pct >= 0.95 ? 'bg-red-500' : budgetAlert.pct >= 0.9 ? 'bg-red-400' : 'bg-amber-400'
          } text-white`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span className="flex-1 font-medium">
              {budgetAlert.pct >= 0.95
                ? `Budget almost exhausted — ${Math.round(budgetAlert.pct * 100)}% of monthly limit used ($${(budgetAlert.spent / 100).toFixed(2)} of $${(budgetAlert.limit / 100).toFixed(2)}). Near limit — figures may update shortly.`
                : `Budget warning — ${Math.round(budgetAlert.pct * 100)}% of monthly limit used ($${(budgetAlert.spent / 100).toFixed(2)} of $${(budgetAlert.limit / 100).toFixed(2)})`
              }
            </span>
            <Link
              to={`/admin/subaccounts/${activeClientId}/usage`}
              className="text-white/90 hover:text-white font-semibold underline"
            >
              View usage →
            </Link>
            <button
              onClick={() => setBudgetAlert(null)}
              className="bg-transparent border-0 text-white/70 hover:text-white cursor-pointer p-0.5 [font-family:inherit]"
            >
              ✕
            </button>
          </div>
        )}

        {/* Page content */}
        <div className="flex-1 overflow-auto py-7 px-6 page-enter">
          {children}
        </div>
      </main>

      {/* ── Create Project modal ──────────────────────────────────────── */}
      {showCreateProject && activeClientId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_both]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-[17px] font-bold text-slate-900 m-0">New Project</h2>
              <button onClick={() => setShowCreateProject(false)} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newProjectName.trim() || createProjectLoading) return;
              setCreateProjectLoading(true);
              try {
                const { data } = await api.post(`/api/subaccounts/${activeClientId}/projects`, { name: newProjectName.trim(), color: newProjectColor, repoUrl: newProjectRepoUrl.trim() || undefined });
                setShowCreateProject(false);
                setNewProjectName('');
                setNewProjectColor('#6366f1');
                setNewProjectRepoUrl('');
                // Refresh projects list and navigate
                api.get(`/api/subaccounts/${activeClientId}/projects`).then(({ data: p }) =>
                  setNavProjects((p as NavProject[]).filter(pr => pr.status === 'active').slice(0, 12))
                );
                navigate(`/projects/${data.id}`);
              } catch { /* ignore */ }
              finally { setCreateProjectLoading(false); }
            }} className="p-6 flex flex-col gap-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name</label>
                <input autoFocus type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Project name" className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Colour</label>
                <div className="flex gap-2">
                  {['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#22c55e','#0ea5e9','#eab308'].map(c => (
                    <button key={c} type="button" onClick={() => setNewProjectColor(c)} className={`w-7 h-7 rounded-full border-2 cursor-pointer transition-all ${newProjectColor === c ? 'border-slate-900 scale-110' : 'border-transparent'}`} style={{ background: c }} />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">GitHub repo <span className="text-slate-400 font-normal">(optional)</span></label>
                <input type="url" value={newProjectRepoUrl} onChange={(e) => setNewProjectRepoUrl(e.target.value)} placeholder="https://github.com/org/repo" className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setShowCreateProject(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer">Cancel</button>
                <button type="submit" disabled={!newProjectName.trim() || createProjectLoading} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white border-0 rounded-lg text-[13px] font-semibold cursor-pointer">{createProjectLoading ? 'Creating...' : 'Create Project'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Create Agent modal ──────────────────────────────────────── */}
      {showCreateAgent && activeClientId && (() => {
        const AGENT_ICONS = [
          // People & roles
          '🤖','🧑‍💻','👩‍💼','🕵️','🧑‍🔬','👷','🧑‍🏫','🧑‍⚕️','🦸','🧙',
          // Work & tools
          '🔍','🛠️','📊','📋','🧪','🎯','💡','📝','🔧','⚙️',
          // Communication
          '💬','📢','🔔','📨','🤝','📞','🗂️','📂','📎','🏷️',
          // Status & quality
          '✅','🚀','⚡','🔒','🛡️','🏆','💎','🌟','🎨','🧩',
          // Domain
          '🐛','🔬','📐','🧮','📈','🗃️','🌐','☁️','🔗','🤔',
        ];
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_both]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
              <h2 className="text-[17px] font-bold text-slate-900 m-0">Create Agent</h2>
              <button onClick={() => { setShowCreateAgent(false); setShowIconPicker(false); }} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newAgentName.trim() || !newAgentPrompt.trim() || createAgentLoading) return;
              setCreateAgentLoading(true);
              setCreateAgentError('');
              try {
                const { data: agent } = await api.post('/api/agents', {
                  name: newAgentName.trim(),
                  description: newAgentDesc.trim() || undefined,
                  masterPrompt: newAgentPrompt.trim(),
                  icon: newAgentIcon.trim() || undefined,
                  agentRole: newAgentRole.trim() || undefined,
                  status: 'active',
                });
                await api.post(`/api/subaccounts/${activeClientId}/agents`, { agentId: agent.id });
                setShowCreateAgent(false); setShowIconPicker(false);
                setNewAgentName(''); setNewAgentDesc(''); setNewAgentPrompt('');
                setNewAgentIcon(''); setNewAgentRole(''); setCreateAgentError('');
                api.get(`/api/subaccounts/${activeClientId}/agents`).then(({ data }) =>
                  setNavAgents((data as NavAgent[]).filter(a => a.isActive))
                );
                navigate(`/agents/${agent.id}`);
              } catch (err: unknown) {
                const e = err as { response?: { data?: { error?: string } } };
                setCreateAgentError(e.response?.data?.error ?? 'Failed to create agent');
              } finally { setCreateAgentLoading(false); }
            }} className="p-6 flex flex-col gap-4">
              {createAgentError && <div className="text-[13px] text-red-600">{createAgentError}</div>}

              {/* Icon + Name row */}
              <div className="flex gap-3">
                <div className="shrink-0 relative">
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Icon</label>
                  <button
                    type="button"
                    onClick={() => setShowIconPicker(!showIconPicker)}
                    className={`w-12 h-10 text-center text-lg border rounded-lg cursor-pointer transition-colors flex items-center justify-center ${
                      showIconPicker ? 'border-indigo-500 ring-2 ring-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    {newAgentIcon || <span className="text-slate-300 text-sm">+</span>}
                  </button>

                  {/* Icon picker popover */}
                  {showIconPicker && (
                    <div className="absolute top-full left-0 mt-2 z-20 bg-white border border-slate-200 rounded-xl shadow-xl p-3 w-[340px] animate-[fadeIn_0.1s_ease-out_both]">
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Choose an icon</div>
                      <div className="grid grid-cols-7 gap-1">
                        {AGENT_ICONS.map((icon) => (
                          <button
                            key={icon}
                            type="button"
                            onClick={() => { setNewAgentIcon(icon); setShowIconPicker(false); }}
                            className={`w-10 h-10 rounded-lg text-2xl flex items-center justify-center cursor-pointer border-0 transition-all ${
                              newAgentIcon === icon
                                ? 'bg-indigo-100 ring-2 ring-indigo-500 scale-110'
                                : 'bg-transparent hover:bg-slate-100'
                            }`}
                          >
                            {icon}
                          </button>
                        ))}
                      </div>
                      {newAgentIcon && (
                        <button
                          type="button"
                          onClick={() => { setNewAgentIcon(''); setShowIconPicker(false); }}
                          className="mt-2 w-full text-[11px] text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer"
                        >
                          Clear icon
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name *</label>
                  <input
                    autoFocus
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    placeholder="e.g. QA Engineer"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description <span className="text-slate-400 font-normal">(optional)</span></label>
                <input
                  value={newAgentDesc}
                  onChange={(e) => setNewAgentDesc(e.target.value)}
                  placeholder="What does this agent do?"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Role <span className="text-slate-400 font-normal">(optional — displayed in org chart)</span></label>
                <input
                  value={newAgentRole}
                  onChange={(e) => setNewAgentRole(e.target.value)}
                  placeholder="e.g. Business Analyst, QA Lead, Senior Developer"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">System prompt *</label>
                <textarea
                  value={newAgentPrompt}
                  onChange={(e) => setNewAgentPrompt(e.target.value)}
                  placeholder="You are a QA engineer. Your job is to..."
                  rows={5}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => { setShowCreateAgent(false); setShowIconPicker(false); }} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer">Cancel</button>
                <button type="submit" disabled={!newAgentName.trim() || !newAgentPrompt.trim() || createAgentLoading} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white border-0 rounded-lg text-[13px] font-semibold cursor-pointer">{createAgentLoading ? 'Creating...' : 'Create Agent'}</button>
              </div>
            </form>
          </div>
        </div>
        );
      })()}

      {/* ── New Client modal ──────────────────────────────────────────── */}
      {showCreateClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_both]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-[17px] font-bold text-slate-900 m-0">New Company</h2>
              <button onClick={() => setShowCreateClient(false)} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newClientName.trim() || createClientLoading) return;
              setCreateClientLoading(true);
              setCreateClientError('');
              try {
                const { data } = await api.post('/api/subaccounts', {
                  name: newClientName.trim(),
                  slug: newClientSlug.trim() || undefined,
                  status: 'active',
                });
                setShowCreateClient(false);
                // Optimistically add the new company immediately so the icon appears right away
                const newEntry: ClientOption = { id: data.id, name: data.name, slug: data.slug ?? '', status: data.status ?? 'active' };
                setSubaccounts(prev => [...prev, newEntry]);
                handleSelectClient(newEntry);
                // Refresh list in background to sync any server-side changes
                api.get('/api/subaccounts').then(({ data: updated }) => setSubaccounts(updated)).catch(() => {});
              } catch (err: unknown) {
                const e = err as { response?: { status?: number; data?: { error?: string } } };
                const msg = e.response?.data?.error;
                if (e.response?.status === 403) setCreateClientError(msg ?? 'You do not have permission to create companies.');
                else if (e.response?.status === 409) setCreateClientError(msg ?? 'A company with this slug already exists.');
                else setCreateClientError(msg ?? 'Failed to create company.');
              } finally { setCreateClientLoading(false); }
            }} className="p-6 flex flex-col gap-4">
              {createClientError && <div className="text-[13px] text-red-600">{createClientError}</div>}
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Company name *</label>
                <input autoFocus type="text" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="e.g. Acme Corp" className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Slug <span className="text-slate-400 font-normal">(optional, auto-generated)</span></label>
                <input type="text" value={newClientSlug} onChange={(e) => setNewClientSlug(e.target.value)} placeholder="acme-corp" className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setShowCreateClient(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer">Cancel</button>
                <button type="submit" disabled={!newClientName.trim() || createClientLoading} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white border-0 rounded-lg text-[13px] font-semibold cursor-pointer">{createClientLoading ? 'Creating...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── New Issue modal ───────────────────────────────────────────── */}
      {showNewIssue && activeClientId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_both]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-[17px] font-bold text-slate-900 m-0">New Issue</h2>
              <button onClick={() => setShowNewIssue(false)} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newIssueTitle.trim() || newIssueLoading) return;
              setNewIssueLoading(true);
              try {
                // Find top-level agent (no parent) to auto-assign
                const agentsRes = await api.get(`/api/subaccounts/${activeClientId}/agents`).catch((err) => { console.error('[Layout] Failed to fetch agents for new issue:', err); return { data: [] }; });
                const topAgent = (agentsRes.data as any[]).find((a: any) => a.isActive && !a.parentSubaccountAgentId);
                await api.post(`/api/subaccounts/${activeClientId}/tasks`, {
                  title: newIssueTitle.trim(),
                  description: newIssueDesc.trim() || undefined,
                  status: 'inbox',
                  priority: newIssuePriority,
                  assignedAgentId: topAgent?.agentId ?? undefined,
                });
                setShowNewIssue(false);
                setNewIssueTitle('');
                setNewIssueDesc('');
                setNewIssuePriority('normal');
              } catch { /* ignore */ }
              finally { setNewIssueLoading(false); }
            }} className="p-6 flex flex-col gap-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Title</label>
                <input autoFocus type="text" value={newIssueTitle} onChange={(e) => setNewIssueTitle(e.target.value)} placeholder="What needs to be done?" className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description <span className="text-slate-400 font-normal">(optional)</span></label>
                <textarea value={newIssueDesc} onChange={(e) => setNewIssueDesc(e.target.value)} placeholder="Add more context..." rows={3} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Priority</label>
                <select value={newIssuePriority} onChange={(e) => setNewIssuePriority(e.target.value as typeof newIssuePriority)} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setShowNewIssue(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer">Cancel</button>
                <button type="submit" disabled={!newIssueTitle.trim() || newIssueLoading} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white border-0 rounded-lg text-[13px] font-semibold cursor-pointer">{newIssueLoading ? 'Creating...' : 'Create Issue'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
