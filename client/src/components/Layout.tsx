import { useState, useEffect } from 'react';
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

interface OrgOption {
  id: string;
  name: string;
}

interface ClientOption {
  id: string;
  name: string;
  slug: string;
  status: string;
}

// ── SVG icon helpers ───────────────────────────────────────────────────────
const Ico = ({ children, size = 16 }: { children: React.ReactNode; size?: number }) => (
  <svg
    width={size} height={size}
    viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75"
    strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    {children}
  </svg>
);

const Icons = {
  dashboard: () => <Ico><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></Ico>,
  tasks: () => <Ico><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></Ico>,
  executions: () => <Ico><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Ico>,
  portal: () => <Ico><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></Ico>,
  agents: () => <Ico><path d="M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2z" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /><circle cx="18" cy="8" r="3" /><path d="M21 6l-1 1-1-1" /></Ico>,
  manageTasks: () => <Ico><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="11" y2="17" /></Ico>,
  users: () => <Ico><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Ico>,
  engines: () => <Ico><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></Ico>,
  categories: () => <Ico><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></Ico>,
  subaccounts: () => <Ico><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></Ico>,
  permissions: () => <Ico><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></Ico>,
  organisations: () => <Ico><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Ico>,
  queue: () => <Ico><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></Ico>,
  sysUsers: () => <Ico><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></Ico>,
  settings: () => <Ico><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></Ico>,
  logout: () => <Ico><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></Ico>,
  chevronDown: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  chevronUp: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  ),
};

// ── Shared NavLink component ───────────────────────────────────────────────
function NavLink({ to, icon, label, exact = false, indent = false }: { to: string; icon: React.ReactNode; label: string; exact?: boolean; indent?: boolean }) {
  const location = useLocation();
  const isActive = exact ? location.pathname === to : location.pathname === to || location.pathname.startsWith(to + '/');
  return (
    <Link
      to={to}
      className={`nav-item${isActive ? ' active' : ''}`}
      style={indent ? { paddingLeft: 38 } : undefined}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

// ── Expandable nav group ──────────────────────────────────────────────────
function NavGroup({ icon, label, children, defaultOpen }: { icon: React.ReactNode; label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="nav-item"
        style={{ width: '100%', borderRadius: 0, cursor: 'pointer', justifyContent: 'space-between' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {icon}
          <span>{label}</span>
        </span>
        <span style={{ color: '#475569', transition: 'transform 0.15s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          <Icons.chevronDown />
        </span>
      </button>
      {open && (
        <div style={{ animation: 'fadeIn 0.1s ease-out' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Section divider ────────────────────────────────────────────────────────
function NavSection({ label }: { label: string }) {
  return (
    <div style={{ padding: '14px 20px 5px', fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
      {label}
    </div>
  );
}

export default function Layout({ user, children }: LayoutProps) {
  const navigate = useNavigate();
  const isSystemAdmin = user.role === 'system_admin';

  // ── Org context ────────────────────────────────────────────────────────
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(getActiveOrgId);
  const [activeOrgName, setActiveOrgNameState] = useState<string | null>(getActiveOrgName);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);

  useEffect(() => {
    if (isSystemAdmin) {
      api.get('/api/organisations')
        .then(({ data }) => setOrgs(data.map((o: OrgOption) => ({ id: o.id, name: o.name }))))
        .catch(() => {});
    }
  }, [isSystemAdmin]);

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

  const handleClearOrg = () => {
    removeActiveOrg();
    setActiveOrgIdState(null);
    setActiveOrgNameState(null);
    removeActiveClient();
    setActiveClientIdState(null);
    setActiveClientNameState(null);
    navigate('/');
  };

  // ── Client context ─────────────────────────────────────────────────
  const [activeClientId, setActiveClientIdState] = useState<string | null>(getActiveClientId);
  const [activeClientName, setActiveClientNameState] = useState<string | null>(getActiveClientName);
  const [subaccounts, setClients] = useState<ClientOption[]>([]);
  const [subaccountPickerOpen, setClientPickerOpen] = useState(false);

  const hasOrgContext = isSystemAdmin ? !!activeOrgId : !!user.organisationId;

  useEffect(() => {
    if (hasOrgContext) {
      api.get('/api/subaccounts')
        .then(({ data }) => setClients(data))
        .catch(() => setClients([]));
    } else {
      setClients([]);
    }
  }, [hasOrgContext, activeOrgId]);

  const handleSelectClient = (sa: ClientOption) => {
    setActiveClient(sa.id, sa.name);
    setActiveClientIdState(sa.id);
    setActiveClientNameState(sa.name);
    setClientPickerOpen(false);
  };

  const handleClearClient = () => {
    removeActiveClient();
    setActiveClientIdState(null);
    setActiveClientNameState(null);
    setClientPickerOpen(false);
  };

  // ── Logout ─────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    try { await api.post('/api/auth/logout'); } finally {
      removeToken(); removeUserRole(); removeActiveOrg(); removeActiveClient();
      navigate('/login');
    }
  };

  // ── User avatar initials ───────────────────────────────────────────────
  const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || '?';

  // ── Role display ───────────────────────────────────────────────────────
  const roleLabel: Record<string, string> = {
    system_admin: 'System Admin',
    org_admin: 'Org Admin',
    manager: 'Manager',
    user: 'User',
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}>
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <nav
        className="sidebar-scroll"
        style={{
          width: 240, background: '#0f172a', color: '#f8fafc',
          display: 'flex', flexDirection: 'column',
          position: 'sticky', top: 0, height: '100vh',
          overflowY: 'auto', overflowX: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* Brand */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(99,102,241,0.5)',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9', letterSpacing: '-0.02em' }}>Automation OS</div>
            </div>
          </div>

          {/* User info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(135deg, #334155, #475569)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.firstName} {user.lastName}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                {roleLabel[user.role ?? ''] ?? user.role}
              </div>
            </div>
          </div>
        </div>

        {/* Context pickers */}
        {(isSystemAdmin || hasOrgContext) && (
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Org picker */}
            {isSystemAdmin && (
              <div style={{ position: 'relative' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                  Organisation
                </div>
                <button
                  onClick={() => setOrgPickerOpen(!orgPickerOpen)}
                  className="context-picker-btn"
                  style={{
                    background: activeOrgId ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${activeOrgId ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.08)'}`,
                    color: activeOrgId ? '#a5b4fc' : '#64748b',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150, fontSize: 12 }}>
                    {activeOrgName ?? 'Select organisation'}
                  </span>
                  <span style={{ color: '#64748b', flexShrink: 0 }}>
                    {orgPickerOpen ? <Icons.chevronUp /> : <Icons.chevronDown />}
                  </span>
                </button>

                {orgPickerOpen && (
                  <div style={{
                    position: 'absolute', zIndex: 200, left: 0, top: 'calc(100% + 4px)',
                    background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
                    width: '100%', maxHeight: 240, overflowY: 'auto',
                    animation: 'fadeInScale 0.12s ease-out both',
                  }}>
                    {orgs.length === 0 && (
                      <div style={{ padding: '12px 14px', color: '#475569', fontSize: 12 }}>No organisations found</div>
                    )}
                    {orgs.map((org) => (
                      <button
                        key={org.id}
                        onClick={() => handleSelectOrg(org)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '9px 14px',
                          background: org.id === activeOrgId ? 'rgba(99,102,241,0.14)' : 'transparent',
                          color: org.id === activeOrgId ? '#a5b4fc' : '#cbd5e1',
                          border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)',
                          fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                          transition: 'background 0.1s',
                        }}
                      >
                        {org.name}
                      </button>
                    ))}
                    {activeOrgId && (
                      <button
                        onClick={handleClearOrg}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '9px 14px', background: 'transparent',
                          color: '#f87171', border: 'none', fontSize: 12, cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        Clear organisation
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Client picker */}
            {hasOrgContext && (
              <div style={{ position: 'relative' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                  Client
                </div>
                <button
                  onClick={() => setClientPickerOpen(!subaccountPickerOpen)}
                  className="context-picker-btn"
                  style={{
                    background: activeClientId ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${activeClientId ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.08)'}`,
                    color: activeClientId ? '#6ee7b7' : '#64748b',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150, fontSize: 12 }}>
                    {activeClientName ?? 'Select client'}
                  </span>
                  <span style={{ color: '#64748b', flexShrink: 0 }}>
                    {subaccountPickerOpen ? <Icons.chevronUp /> : <Icons.chevronDown />}
                  </span>
                </button>

                {subaccountPickerOpen && (
                  <div style={{
                    position: 'absolute', zIndex: 200, left: 0, top: 'calc(100% + 4px)',
                    background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
                    width: '100%', maxHeight: 240, overflowY: 'auto',
                    animation: 'fadeInScale 0.12s ease-out both',
                  }}>
                    {subaccounts.length === 0 && (
                      <div style={{ padding: '12px 14px', color: '#475569', fontSize: 12 }}>No clients found</div>
                    )}
                    {subaccounts.map((sa) => (
                      <button
                        key={sa.id}
                        onClick={() => handleSelectClient(sa)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '9px 14px',
                          background: sa.id === activeClientId ? 'rgba(16,185,129,0.1)' : 'transparent',
                          color: sa.id === activeClientId ? '#6ee7b7' : '#cbd5e1',
                          border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)',
                          fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                          transition: 'background 0.1s',
                        }}
                      >
                        <div style={{ fontWeight: 500 }}>{sa.name}</div>
                        {sa.status !== 'active' && (
                          <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>{sa.status}</div>
                        )}
                      </button>
                    ))}
                    {activeClientId && (
                      <button
                        onClick={handleClearClient}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '9px 14px', background: 'transparent',
                          color: '#f87171', border: 'none', fontSize: 12, cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        Clear client
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Nudge for system_admin without org */}
        {isSystemAdmin && !activeOrgId && (
          <div style={{ margin: '10px 14px', padding: '10px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: '#fbbf24', lineHeight: 1.5 }}>
              Select an org above or visit{' '}
              <Link to="/system/organisations" style={{ color: '#93c5fd', textDecoration: 'underline' }}>Organisations</Link>.
            </div>
          </div>
        )}

        {/* ── Navigation ──────────────────────────────────────────────── */}
        <div style={{ flex: 1, paddingTop: 6, paddingBottom: 6 }}>
          {/* Always visible */}
          <NavLink to="/" exact icon={<Icons.dashboard />} label="Dashboard" />

          {/* ── Client section — only when a client is selected ── */}
          {activeClientId && (
            <>
              <NavSection label={activeClientName ?? 'Client'} />
              <NavLink to="/agents" icon={<Icons.agents />} label="AI Team" />
              <NavGroup icon={<Icons.tasks />} label="Automations">
                <NavLink to="/processes" icon={<Icons.manageTasks />} label="Manage" indent />
                <NavLink to="/executions" icon={<Icons.executions />} label="Activity" indent />
              </NavGroup>
              {/* Admin-only client items */}
              {['system_admin', 'org_admin'].includes(user.role) && (
                <>
                  <NavLink
                    to={`/admin/subaccounts/${activeClientId}/workspace`}
                    icon={<Icons.queue />}
                    label="Tasks"
                  />
                  <NavLink
                    to={`/portal/${activeClientId}`}
                    icon={<Icons.portal />}
                    label="Portal"
                  />
                  <NavLink
                    to={`/admin/subaccounts/${activeClientId}`}
                    icon={<Icons.settings />}
                    label="Client Settings"
                  />
                </>
              )}
            </>
          )}

          {/* ── Organisation section — only when org context exists ────────── */}
          {hasOrgContext && ['system_admin', 'org_admin'].includes(user.role) && (
            <>
              <NavSection label="Organisation" />
              <NavGroup icon={<Icons.agents />} label="Agents">
                <NavLink to="/admin/agents" icon={<Icons.agents />} label="Manage" indent />
                <NavLink to="/admin/skills" icon={<Icons.categories />} label="Skills" indent />
              </NavGroup>
              <NavGroup icon={<Icons.tasks />} label="Automations">
                <NavLink to="/admin/processes" icon={<Icons.manageTasks />} label="Manage" indent />
                <NavLink to="/executions" exact icon={<Icons.executions />} label="Activity" indent />
              </NavGroup>
              <NavLink to="/admin/subaccounts" exact icon={<Icons.subaccounts />} label="Clients" />
              <NavLink to="/admin/users" icon={<Icons.users />} label="Team" />
              {isSystemAdmin && (
                <NavLink to="/admin/org-settings" icon={<Icons.settings />} label="Org Settings" />
              )}
            </>
          )}

          {/* ── Platform section — system_admin only ───────────────────── */}
          {isSystemAdmin && (
            <>
              <NavSection label="Platform" />
              <NavLink to="/system/organisations" icon={<Icons.organisations />} label="Organisations" />
              <NavLink to="/system/activity" icon={<Icons.executions />} label="Activity" />
              <NavLink to="/system/task-queue" icon={<Icons.queue />} label="Diagnostics" />
              <NavLink to="/system/users" icon={<Icons.sysUsers />} label="System Admins" />
              <NavLink to="/system/settings" icon={<Icons.settings />} label="Settings" />
            </>
          )}
        </div>

        {/* ── Bottom user card ─────────────────────────────────────────── */}
        <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.2)' }}>
          <Link
            to="/settings"
            className="nav-item"
            style={{ borderRadius: 8, marginBottom: 2, borderLeft: 'none', paddingLeft: 12 }}
          >
            <Icons.settings />
            <span style={{ fontSize: 13 }}>Profile Settings</span>
          </Link>
          <button
            onClick={handleLogout}
            className="nav-item"
            style={{ borderRadius: 8, borderLeft: 'none', paddingLeft: 12 }}
          >
            <Icons.logout />
            <span style={{ fontSize: 13 }}>Sign out</span>
          </button>
        </div>
      </nav>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main style={{ flex: 1, background: '#f8fafc', overflow: 'auto', minHeight: '100vh' }}>
        <div style={{ padding: '28px 24px', height: '100%', boxSizing: 'border-box' }} className="page-enter">
          {children}
        </div>
      </main>
    </div>
  );
}
