import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import api from './lib/api';
import { isAuthenticated, User } from './lib/auth';

// Pages
import LoginPage from './pages/LoginPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import DashboardPage from './pages/DashboardPage';
import TasksPage from './pages/TasksPage';
import TaskExecutionPage from './pages/TaskExecutionPage';
import ExecutionHistoryPage from './pages/ExecutionHistoryPage';
import ExecutionDetailPage from './pages/ExecutionDetailPage';
import ProfileSettingsPage from './pages/ProfileSettingsPage';
import AdminEnginesPage from './pages/AdminEnginesPage';
import AdminTasksPage from './pages/AdminTasksPage';
import AdminTaskEditPage from './pages/AdminTaskEditPage';
import AdminCategoriesPage from './pages/AdminCategoriesPage';
import AdminPermissionGroupsPage from './pages/AdminPermissionGroupsPage';
import AdminPermissionGroupDetailPage from './pages/AdminPermissionGroupDetailPage';
import AdminUsersPage from './pages/AdminUsersPage';
import SystemOrganisationsPage from './pages/SystemOrganisationsPage';

function ProtectedRoute({ user, loading, children }: { user: User | null; loading: boolean; children: React.ReactNode }) {
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', color: '#64748b' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminRoute({ user, loading, children }: { user: User | null; loading: boolean; children: React.ReactNode }) {
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'org_admin' && user.role !== 'system_admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SystemAdminRoute({ user, loading, children }: { user: User | null; loading: boolean; children: React.ReactNode }) {
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'system_admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      setLoading(false);
      return;
    }
    api.get('/api/auth/me')
      .then(({ data }) => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/invite/accept" element={<AcceptInvitePage />} />

        {/* Authenticated routes */}
        <Route path="/" element={<ProtectedRoute user={user} loading={loading}><DashboardPage user={user!} /></ProtectedRoute>} />
        <Route path="/tasks" element={<ProtectedRoute user={user} loading={loading}><TasksPage user={user!} /></ProtectedRoute>} />
        <Route path="/tasks/:id" element={<ProtectedRoute user={user} loading={loading}><TaskExecutionPage user={user!} /></ProtectedRoute>} />
        <Route path="/executions" element={<ProtectedRoute user={user} loading={loading}><ExecutionHistoryPage user={user!} /></ProtectedRoute>} />
        <Route path="/executions/:id" element={<ProtectedRoute user={user} loading={loading}><ExecutionDetailPage user={user!} /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute user={user} loading={loading}><ProfileSettingsPage user={user!} /></ProtectedRoute>} />

        {/* Admin routes */}
        <Route path="/admin/engines" element={<AdminRoute user={user} loading={loading}><AdminEnginesPage user={user!} /></AdminRoute>} />
        <Route path="/admin/tasks" element={<AdminRoute user={user} loading={loading}><AdminTasksPage user={user!} /></AdminRoute>} />
        <Route path="/admin/tasks/:id" element={<AdminRoute user={user} loading={loading}><AdminTaskEditPage user={user!} /></AdminRoute>} />
        <Route path="/admin/categories" element={<AdminRoute user={user} loading={loading}><AdminCategoriesPage user={user!} /></AdminRoute>} />
        <Route path="/admin/permission-groups" element={<AdminRoute user={user} loading={loading}><AdminPermissionGroupsPage user={user!} /></AdminRoute>} />
        <Route path="/admin/permission-groups/:id" element={<AdminRoute user={user} loading={loading}><AdminPermissionGroupDetailPage user={user!} /></AdminRoute>} />
        <Route path="/admin/users" element={<AdminRoute user={user} loading={loading}><AdminUsersPage user={user!} /></AdminRoute>} />

        {/* System admin routes */}
        <Route path="/system/organisations" element={<SystemAdminRoute user={user} loading={loading}><SystemOrganisationsPage user={user!} /></SystemAdminRoute>} />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
