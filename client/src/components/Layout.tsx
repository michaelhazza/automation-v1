import { Link, useNavigate, useLocation } from 'react-router-dom';
import { User } from '../lib/auth';
import api from '../lib/api';
import { removeToken } from '../lib/auth';

interface LayoutProps {
  user: User;
  children: React.ReactNode;
}

export default function Layout({ user, children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      removeToken();
      navigate('/login');
    }
  };

  const isAdmin = user.role === 'org_admin' || user.role === 'system_admin';
  const isSystemAdmin = user.role === 'system_admin';

  const navItems = [
    { path: '/', label: 'Dashboard' },
    { path: '/tasks', label: 'Tasks' },
    { path: '/executions', label: 'Executions' },
    ...(isAdmin ? [
      { path: '/admin/tasks', label: 'Manage Tasks' },
      { path: '/admin/engines', label: 'Engines' },
      { path: '/admin/categories', label: 'Categories' },
      { path: '/admin/permission-groups', label: 'Permissions' },
      { path: '/admin/users', label: 'Users' },
    ] : []),
    ...(isSystemAdmin ? [
      { path: '/system/organisations', label: 'Organisations' },
    ] : []),
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      {/* Sidebar */}
      <nav style={{ width: 220, background: '#1e293b', color: '#f8fafc', padding: '24px 0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0 20px 24px', borderBottom: '1px solid #334155', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#f8fafc' }}>Automation OS</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{user.firstName} {user.lastName}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{user.role}</div>
        </div>
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
