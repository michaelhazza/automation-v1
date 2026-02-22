import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { User } from '../lib/auth';
import api from '../lib/api';
import { removeToken, removeUserRole, removeActiveOrg, getActiveOrgId, getActiveOrgName, setActiveOrg } from '../lib/auth';

interface LayoutProps {
  user: User;
  children: React.ReactNode;
}

interface OrgOption {
  id: string;
  name: string;
}

export default function Layout({ user, children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isSystemAdmin = user.role === 'system_admin';
  const isAdmin = user.role === 'org_admin' || isSystemAdmin;
  const isManagerOrAbove = user.role === 'manager' || isAdmin;

  // Active org context — only relevant for system_admin
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
    navigate('/');
  };

  const handleClearOrg = () => {
    removeActiveOrg();
    setActiveOrgIdState(null);
    setActiveOrgNameState(null);
    navigate('/');
  };

  const handleLogout = async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      removeToken();
      removeUserRole();
      removeActiveOrg();
      navigate('/login');
    }
  };

  const hasOrgContext = isSystemAdmin ? !!activeOrgId : !!user.organisationId;

  const navItems = [
    { path: '/', label: 'Dashboard' },
    ...(isSystemAdmin ? [
      { path: '/system/organisations', label: 'Organisations' },
      { path: '/system/users', label: 'System Admins' },
    ] : []),
  ];

  const orgNavItems = [
    { path: '/tasks', label: 'Tasks' },
    { path: '/executions', label: 'Executions' },
    ...(isManagerOrAbove ? [
      { path: '/admin/tasks', label: 'Manage Tasks' },
      { path: '/admin/users', label: 'Users' },
    ] : []),
    ...(isAdmin ? [
      { path: '/admin/engines', label: 'Engines' },
      { path: '/admin/categories', label: 'Categories' },
      { path: '/admin/permission-groups', label: 'Permissions' },
    ] : []),
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      {/* Sidebar */}
      <nav style={{ width: 220, background: '#1e293b', color: '#f8fafc', padding: '24px 0', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ padding: '0 20px 20px', borderBottom: '1px solid #334155', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#f8fafc' }}>Automation OS</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{user.firstName} {user.lastName}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{user.role}</div>

          {/* Org context picker — system_admin only */}
          {isSystemAdmin && (
            <div style={{ marginTop: 12, position: 'relative' }}>
              <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Active org
              </div>
              <button
                onClick={() => setOrgPickerOpen(!orgPickerOpen)}
                style={{
                  width: '100%', textAlign: 'left',
                  background: activeOrgId ? '#1e3a5f' : '#1a1f2e',
                  border: `1px solid ${activeOrgId ? '#3b82f6' : '#475569'}`,
                  borderRadius: 6, padding: '5px 8px',
                  color: activeOrgId ? '#93c5fd' : '#94a3b8',
                  fontSize: 12, cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
                  {activeOrgName ?? 'No org selected'}
                </span>
                <span style={{ fontSize: 10, marginLeft: 4, flexShrink: 0 }}>{orgPickerOpen ? '▲' : '▼'}</span>
              </button>

              {orgPickerOpen && (
                <div style={{
                  position: 'absolute', zIndex: 100, left: 0, top: '100%',
                  background: '#1e293b', border: '1px solid #334155',
                  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  marginTop: 4, width: 200, maxHeight: 260, overflowY: 'auto'
                }}>
                  {orgs.length === 0 && (
                    <div style={{ padding: '10px 12px', color: '#64748b', fontSize: 12 }}>No organisations found</div>
                  )}
                  {orgs.map((org) => (
                    <button
                      key={org.id}
                      onClick={() => handleSelectOrg(org)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px',
                        background: org.id === activeOrgId ? '#1e3a5f' : 'transparent',
                        color: org.id === activeOrgId ? '#93c5fd' : '#cbd5e1',
                        border: 'none', borderBottom: '1px solid #334155',
                        fontSize: 13, cursor: 'pointer'
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
                        padding: '8px 12px', background: 'transparent',
                        color: '#f87171', border: 'none', fontSize: 12, cursor: 'pointer'
                      }}
                    >
                      Clear org context
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nudge for system_admin with no active org */}
        {isSystemAdmin && !activeOrgId && (
          <div style={{ padding: '8px 20px 10px', background: '#1a1f2e', borderBottom: '1px solid #334155', marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.5 }}>
              Select an org above or visit{' '}
              <Link to="/system/organisations" style={{ color: '#60a5fa', textDecoration: 'none' }}>Organisations</Link>.
            </div>
          </div>
        )}

        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            style={{
              display: 'block',
              padding: '10px 20px',
              color: location.pathname === item.path ? '#38bdf8' : '#94a3b8',
              textDecoration: 'none',
              background: location.pathname === item.path ? '#0f172a' : 'transparent',
              fontSize: 14,
            }}
          >
            {item.label}
          </Link>
        ))}

        {hasOrgContext && orgNavItems.length > 0 && (
          <>
            <div style={{ padding: '12px 20px 4px', fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', borderTop: '1px solid #334155', marginTop: 4 }}>
              Organisation
            </div>
            {orgNavItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                style={{
                  display: 'block',
                  padding: '10px 20px',
                  color: location.pathname === item.path ? '#38bdf8' : '#94a3b8',
                  textDecoration: 'none',
                  background: location.pathname === item.path ? '#0f172a' : 'transparent',
                  fontSize: 14,
                }}
              >
                {item.label}
              </Link>
            ))}
          </>
        )}

        <div style={{ flex: 1 }} />
        <div style={{ padding: '16px 20px', borderTop: '1px solid #334155' }}>
          <Link to="/settings" style={{ display: 'block', color: '#94a3b8', textDecoration: 'none', fontSize: 13, marginBottom: 8 }}>
            Profile Settings
          </Link>
          <button
            onClick={handleLogout}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13, padding: 0 }}
          >
            Logout
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, background: '#f1f5f9', overflow: 'auto' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: 32 }}>
          {children}
        </div>
      </main>
    </div>
  );
}
