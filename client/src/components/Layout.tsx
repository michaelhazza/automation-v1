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
    style={{ flexShrink: 0 }}>{children}</svg>
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
    <Link to={to} style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '7px 12px', margin: '1px 6px', borderRadius: 7,
      fontSize: 13, fontWeight: 500, textDecoration: 'none',
      color: active ? '#f1f5f9' : '#94a3b8',
      background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
      transition: 'color 0.1s, background 0.1s',
    }}
      onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLAnchorElement).style.color = '#e2e8f0'; (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.04)'; } }}
      onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLAnchorElement).style.color = '#94a3b8'; (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; } }}
    >
      <span style={{ color: active ? '#a5b4fc' : 'inherit' }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {!!badge && badge > 0 && (
        <span style={{
          minWidth: 18, height: 18, borderRadius: 9, padding: '0 5px',
          background: '#6366f1', color: 'white', fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

function NavSection({ label }: { label: string }) {
  return (
    <div style={{ padding: '14px 18px 4px', fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
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
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}>
      <CommandPalette
        isOpen={cmdOpen}
        onClose={() => setCmdOpen(false)}
        activeClientId={activeClientId}
        onSelectClient={handleSelectClientFromPalette}
      />

      {/* ── Icon Rail ─────────────────────────────────────────────────── */}
      <aside style={{
        width: 56, background: '#080e1a', display: 'flex', flexDirection: 'column',
        alignItems: 'center', paddingTop: 10, paddingBottom: 10,
        borderRight: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, gap: 4,
      }}>
        {/* App logo */}
        <Link to="/" style={{ textDecoration: 'none', marginBottom: 6 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, cursor: 'pointer',
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(99,102,241,0.4)',
          }}>
            <Icons.bolt />
          </div>
        </Link>

        {/* Org picker — system admin only */}
        {isSystemAdmin && (
          <div ref={orgPickerRef} style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={() => setOrgPickerOpen(o => !o)}
              title={activeOrgName ?? 'Select organisation'}
              style={{
                width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: activeOrgId ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: activeOrgId ? '#a5b4fc' : '#475569',
                transition: 'background 0.15s', fontFamily: 'inherit',
              }}
            >
              <Icons.platform />
            </button>
            {orgPickerOpen && (
              <div style={{
                position: 'absolute', left: 44, top: 0, zIndex: 300,
                background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
                width: 220, maxHeight: 280, overflowY: 'auto',
              }}>
                <div style={{ padding: '8px 12px 5px', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Organisation
                </div>
                {orgs.length === 0 && <div style={{ padding: '10px 14px', color: '#475569', fontSize: 12 }}>No organisations</div>}
                {orgs.map(org => (
                  <button key={org.id} onClick={() => handleSelectOrg(org)} style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px',
                    background: org.id === activeOrgId ? 'rgba(99,102,241,0.15)' : 'transparent',
                    color: org.id === activeOrgId ? '#a5b4fc' : '#cbd5e1',
                    border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)',
                    fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    {org.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Divider above client icons */}
        {hasOrgContext && subaccounts.length > 0 && (
          <div style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.07)', margin: '2px 0' }} />
        )}

        {/* Client icons */}
        {subaccounts.map(sa => {
          const isActive = sa.id === activeClientId;
          const bg = avatarColor(sa.name);
          return (
            <div key={sa.id} style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {isActive && (
                <div style={{
                  position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                  width: 3, height: 20, borderRadius: '0 3px 3px 0', background: 'white',
                }} />
              )}
              <button
                onClick={() => handleSelectClient(sa)}
                title={sa.name}
                style={{
                  width: 36, height: 36, border: 'none', cursor: 'pointer',
                  borderRadius: isActive ? 10 : 14,
                  background: bg, color: 'white',
                  fontSize: 12, fontWeight: 700, letterSpacing: '-0.02em',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: isActive ? 1 : 0.55,
                  boxShadow: isActive ? `0 0 0 2px rgba(255,255,255,0.2)` : 'none',
                  transition: 'border-radius 0.15s, opacity 0.15s, box-shadow 0.15s',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.opacity = '0.55'; }}
              >
                {toInitials(sa.name)}
              </button>
              {sa.status !== 'active' && (
                <div style={{
                  position: 'absolute', bottom: 2, right: 7,
                  width: 8, height: 8, borderRadius: '50%',
                  background: sa.status === 'suspended' ? '#f59e0b' : '#64748b',
                  border: '1.5px solid #080e1a',
                }} />
              )}
            </div>
          );
        })}

        <div style={{ flex: 1 }} />

        {/* User avatar */}
        <button
          onClick={() => navigate('/settings')}
          title={`${user.firstName} ${user.lastName}`}
          style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
            cursor: 'pointer', background: 'linear-gradient(135deg, #334155, #475569)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#e2e8f0', fontFamily: 'inherit',
          }}
        >
          {userInitials}
        </button>
      </aside>

      {/* ── Main Sidebar ──────────────────────────────────────────────── */}
      <aside className="sidebar-scroll" style={{
        width: 220, background: '#0f172a', display: 'flex', flexDirection: 'column',
        borderRight: '1px solid rgba(255,255,255,0.05)', flexShrink: 0,
        overflowY: 'auto', overflowX: 'hidden',
      }}>
        {/* Context header */}
        <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          {activeClientId && activeClientName ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeClientName}
              </div>
              <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>Client workspace</div>
            </>
          ) : hasOrgContext ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>
                {isSystemAdmin ? (activeOrgName ?? 'Organisation') : 'Organisation'}
              </div>
              <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>Org workspace</div>
            </>
          ) : isSystemAdmin ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Platform</div>
              <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>System admin</div>
            </>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Automation OS</div>
          )}
        </div>

        {/* Navigation */}
        <div style={{ flex: 1, paddingTop: 4, paddingBottom: 4 }}>

          <NavItem to="/" exact icon={<Icons.dashboard />} label="Dashboard" />

          {/* ── Client section */}
          {hasOrgContext && activeClientId && (
            <>
              {(hasClientPerm('subaccount.review.view') || hasOrgPerm('org.review.view')) && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/review-queue`} icon={<Icons.inbox />} label="Inbox" badge={reviewCount} />
              )}
              <NavItem to="/projects" icon={<Icons.projects />} label="Projects" />
              {hasOrgPerm('org.agents.view') && (
                <NavItem to="/agents" icon={<Icons.agents />} label="AI Team" badge={liveAgentCount} />
              )}
              {hasOrgPerm('org.processes.view') && (
                <NavItem to="/processes" icon={<Icons.automations />} label="Automations" />
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
            </>
          )}

          {/* ── Org section — no client selected */}
          {hasOrgContext && !activeClientId && hasAnyOrgPerm && (
            <>
              {hasOrgPerm('org.subaccounts.view') && <NavItem to="/admin/subaccounts" icon={<Icons.clients />} label="Clients" />}
              {hasOrgPerm('org.users.view') && <NavItem to="/admin/users" icon={<Icons.team />} label="Team" />}
              {hasOrgPerm('org.agents.view') && <NavItem to="/admin/agents" icon={<Icons.agents />} label="AI Team" />}
              {hasOrgPerm('org.processes.view') && <NavItem to="/admin/processes" icon={<Icons.automations />} label="Automations" />}
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
        <div style={{ padding: '6px 6px 8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <NavItem to="/settings" exact icon={<Icons.settings />} label="Profile Settings" />
          <button
            onClick={handleLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '7px 12px', width: 'calc(100% - 12px)', margin: '1px 6px',
              border: 'none', cursor: 'pointer', borderRadius: 7,
              background: 'transparent', color: '#475569',
              fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
              transition: 'color 0.1s, background 0.1s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f1f5f9'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#475569'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            <Icons.logout />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f8fafc' }}>

        {/* Breadcrumb bar */}
        <div style={{
          height: 42, padding: '0 16px 0 24px', display: 'flex', alignItems: 'center',
          background: 'white', borderBottom: '1px solid #e2e8f0', flexShrink: 0,
          fontSize: 13, gap: 6,
        }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            {breadcrumbs.length === 0
              ? <span style={{ color: '#1e293b', fontWeight: 600 }}>Dashboard</span>
              : breadcrumbs.map((crumb, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {i > 0 && <span style={{ color: '#cbd5e1' }}>›</span>}
                  {i === breadcrumbs.length - 1
                    ? <span style={{ color: '#1e293b', fontWeight: 600 }}>{crumb.label}</span>
                    : <Link to={crumb.to} style={{ color: '#64748b', textDecoration: 'none' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#6366f1')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
                      >{crumb.label}</Link>
                  }
                </span>
              ))
            }
          </div>
          {/* Cmd+K trigger */}
          <button
            onClick={() => setCmdOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              background: '#f1f5f9', border: '1px solid #e2e8f0',
              color: '#94a3b8', fontSize: 12, fontFamily: 'inherit',
              transition: 'border-color 0.1s, color 0.1s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#6366f1'; (e.currentTarget as HTMLButtonElement).style.color = '#6366f1'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#e2e8f0'; (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8'; }}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span>Search</span>
            <span style={{ fontSize: 10, opacity: 0.6 }}>⌘K</span>
          </button>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '28px 24px' }} className="page-enter">
          {children}
        </div>
      </main>
    </div>
  );
}
