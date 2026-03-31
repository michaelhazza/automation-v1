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
  subaccounts: 'Clients', agents: 'AI Team', processes: 'Automations',
  executions: 'Activity', workspace: 'Tasks', memory: 'Memory',
  portal: 'Portal', settings: 'Settings', organisations: 'Organisations',
  users: 'Team', skills: 'Skills', activity: 'Activity',
  'task-queue': 'Diagnostics', 'board-templates': 'Board Templates',
  'review-queue': 'Inbox', 'scheduled-tasks': 'Scheduled', runs: 'Run Trace',
  'org-settings': 'Org Settings', connections: 'Connections', projects: 'Projects',
  'admin-settings': 'Settings',
  usage: 'Usage & Costs',
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
  to, icon, label, badge, exact = false,
}: { to: string; icon: React.ReactNode; label: string; badge?: number; exact?: boolean }) {
  const { pathname } = useLocation();
  const active = exact ? pathname === to : pathname === to || pathname.startsWith(to + '/');
  return (
    <Link
      to={to}
      className={`flex items-center gap-[9px] px-3 py-[7px] mx-1.5 my-px rounded-[7px] text-[13px] font-medium no-underline transition-[color,background] duration-100 ${
        active
          ? 'text-slate-100 bg-white/[0.08]'
          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
      }`}
    >
      <span className={active ? 'text-indigo-300' : ''}>{icon}</span>
      <span className="flex-1">{label}</span>
      {!!badge && badge > 0 && (
        <span className="min-w-[18px] h-[18px] rounded-[9px] px-[5px] bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

function NavSection({ label }: { label: string }) {
  return (
    <div className="px-[18px] pt-[14px] pb-1 text-[10px] font-bold text-slate-700 uppercase tracking-[0.1em]">
      {label}
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

  // Budget alert
  interface BudgetAlert { pct: number; spent: number; limit: number; }
  const [budgetAlert, setBudgetAlert] = useState<BudgetAlert | null>(null);

  // Command palette
  const [cmdOpen, setCmdOpen] = useState(false);

  const hasOrgContext = isSystemAdmin ? !!activeOrgId : !!user.organisationId;
  const hasAnyOrgPerm = orgPerms.size > 0;
  const hasOrgPerm = (key: string) => orgPerms.has('__system_admin__') || orgPerms.has(key);
  const hasClientPerm = (key: string) => clientPerms.has('__system_admin__') || clientPerms.has(key);

  // Fetch orgs list (system admin)
  useEffect(() => {
    if (isSystemAdmin) {
      api.get('/api/organisations').then(({ data }) => setOrgs(data)).catch(() => {});
    }
  }, [isSystemAdmin]);

  // Fetch subaccounts
  useEffect(() => {
    if (hasOrgContext) {
      api.get('/api/subaccounts').then(({ data }) => setSubaccounts(data)).catch(() => setSubaccounts([]));
    } else {
      setSubaccounts([]);
      if (activeClientId) { removeActiveClient(); setActiveClientIdState(null); setActiveClientNameState(null); }
    }
  }, [hasOrgContext, activeOrgId]);

  // Fetch org permissions
  useEffect(() => {
    if (isSystemAdmin) { setOrgPerms(new Set(['__system_admin__'])); return; }
    if (hasOrgContext) {
      api.get('/api/my-permissions').then(({ data }) => setOrgPerms(new Set(data.permissions))).catch(() => setOrgPerms(new Set()));
    } else { setOrgPerms(new Set()); }
  }, [hasOrgContext, activeOrgId, isSystemAdmin]);

  // Fetch client permissions
  useEffect(() => {
    if (isSystemAdmin) { setClientPerms(new Set(['__system_admin__'])); return; }
    if (activeClientId) {
      api.get(`/api/subaccounts/${activeClientId}/my-permissions`).then(({ data }) => setClientPerms(new Set(data.permissions))).catch(() => setClientPerms(new Set()));
    } else { setClientPerms(new Set()); }
  }, [activeClientId, isSystemAdmin]);

  // Review queue badge
  useEffect(() => {
    if (!activeClientId) { setReviewCount(0); return; }
    const fetch = () => api.get(`/api/subaccounts/${activeClientId}/review-queue/count`).then(({ data }) => setReviewCount(data.count ?? 0)).catch(() => {});
    fetch();
    const t = setInterval(fetch, 30_000);
    return () => clearInterval(t);
  }, [activeClientId]);

  // Live agent badge
  useEffect(() => {
    if (!activeClientId) { setLiveAgentCount(0); return; }
    const fetch = () => api.get(`/api/subaccounts/${activeClientId}/live-status`).then(({ data }) => setLiveAgentCount(data.runningAgents ?? 0)).catch(() => {});
    fetch();
    const t = setInterval(fetch, 15_000);
    return () => clearInterval(t);
  }, [activeClientId]);

  // Budget alert — check monthly spend vs limit for active client
  useEffect(() => {
    if (!activeClientId) { setBudgetAlert(null); return; }
    const check = () => api.get(`/api/subaccounts/${activeClientId}/usage/summary`)
      .then(({ data }) => {
        const spent = data.monthly?.totalCostCents ?? 0;
        const limit = data.limits?.monthlyCostLimitCents;
        if (!limit || limit <= 0) { setBudgetAlert(null); return; }
        const pct = spent / limit;
        if (pct >= 0.75) setBudgetAlert({ pct, spent, limit });
        else setBudgetAlert(null);
      }).catch(() => {});
    check();
    const t = setInterval(check, 120_000); // every 2 min
    return () => clearInterval(t);
  }, [activeClientId]);

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
    navigate('/');
  };

  const handleSelectClient = (sa: ClientOption) => {
    setActiveClient(sa.id, sa.name);
    setActiveClientIdState(sa.id);
    setActiveClientNameState(sa.name);
  };

  const handleLogout = async () => {
    try { await api.post('/api/auth/logout'); } finally {
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
              <div className="text-[11px] text-slate-700 mt-0.5">Client workspace</div>
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
        <div className="flex-1 py-1">

          <NavItem to="/" exact icon={<Icons.dashboard />} label="Dashboard" />

          {/* ── Client section */}
          {hasOrgContext && activeClientId && (
            <>
              {(hasClientPerm('subaccount.review.view') || hasOrgPerm('org.review.view')) && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/review-queue`} icon={<Icons.inbox />} label="Inbox" badge={reviewCount} />
              )}
              <NavItem to="/projects" icon={<Icons.projects />} label="Projects" />
              {hasOrgPerm('org.agents.view') && (
                <NavItem to="/agents" icon={<Icons.agents />} label="Agents" badge={liveAgentCount} />
              )}
              {hasOrgPerm('org.agents.view') && (
                <NavItem to="/admin/agent-templates" icon={<Icons.automations />} label="Templates" />
              )}
              {hasOrgPerm('org.processes.view') && (
                <NavItem to="/processes" icon={<Icons.automations />} label="Processes" />
              )}
              <NavItem to="/executions" icon={<Icons.activity />} label="Activity" />
              {(hasClientPerm('subaccount.workspace.view') || hasOrgPerm('org.workspace.view')) && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/workspace`} icon={<Icons.tasks />} label="Tasks" />
              )}
              {(hasClientPerm('subaccount.workspace.manage') || hasOrgPerm('org.workspace.manage')) && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/scheduled-tasks`} icon={<Icons.scheduled />} label="Scheduled" />
              )}
              {hasOrgPerm('org.workspace.manage') && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/memory`} icon={<Icons.memory />} label="Memory" />
              )}
              {hasOrgPerm('org.subaccounts.view') && (
                <NavItem to={`/portal/${activeClientId}`} icon={<Icons.portal />} label="Portal" />
              )}
              {(hasClientPerm('subaccount.categories.manage') || hasClientPerm('subaccount.users.view')) && (
                <NavItem to={`/client-settings/${activeClientId}`} icon={<Icons.settings />} label="Client Settings" />
              )}
              {hasOrgPerm('org.subaccounts.edit') && (
                <NavItem to={`/admin/subaccounts/${activeClientId}`} icon={<Icons.settings />} label="Manage Client" />
              )}
              {hasOrgPerm('org.settings.view') && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/usage`} icon={<Icons.usage />} label="Usage & Costs" />
              )}
            </>
          )}

          {/* ── Org section — no client selected */}
          {hasOrgContext && !activeClientId && hasAnyOrgPerm && (
            <>
              {hasOrgPerm('org.subaccounts.view') && <NavItem to="/admin/subaccounts" icon={<Icons.clients />} label="Clients" />}
              {hasOrgPerm('org.users.view') && <NavItem to="/admin/users" icon={<Icons.team />} label="Team" />}
              {(hasOrgPerm('org.categories.view') || hasOrgPerm('org.engines.view')) && <NavItem to="/admin/settings" icon={<Icons.settings />} label="Settings" />}
              {isSystemAdmin && <NavItem to="/admin/org-settings" icon={<Icons.settings />} label="Org Settings" />}
            </>
          )}

          {/* ── Platform section — system admin */}
          {isSystemAdmin && (
            <>
              <NavSection label="Platform" />
              <NavItem to="/system/organisations" icon={<Icons.orgs />} label="Organisations" />
              <NavItem to="/system/agents" icon={<Icons.agents />} label="Agents" />
              <NavItem to="/system/activity" icon={<Icons.activity />} label="Activity" />
              <NavItem to="/system/task-queue" icon={<Icons.diagnostic />} label="Diagnostics" />
              <NavItem to="/system/board-templates" icon={<Icons.boardTpl />} label="Board Templates" />
              <NavItem to="/system/users" icon={<Icons.team />} label="System Admins" />
              <NavItem to="/system/settings" icon={<Icons.settings />} label="Settings" />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-1.5 pt-1.5 pb-2 border-t border-white/5">
          <NavItem to="/settings" exact icon={<Icons.settings />} label="Profile Settings" />
          <button
            onClick={handleLogout}
            className="flex items-center gap-[9px] px-3 py-[7px] w-[calc(100%-12px)] mx-1.5 my-px border-none cursor-pointer rounded-[7px] bg-transparent text-slate-600 text-[13px] font-medium [font-family:inherit] transition-[color,background] duration-100 hover:text-slate-100 hover:bg-white/[0.04]"
          >
            <Icons.logout />
            <span>Sign out</span>
          </button>
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
    </div>
  );
}
