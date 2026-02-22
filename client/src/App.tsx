import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import api from './lib/api';
import { isAuthenticated, User, setUserRole, removeUserRole, removeActiveOrg } from './lib/auth';
import Layout from './components/Layout';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const TaskExecutionPage = lazy(() => import('./pages/TaskExecutionPage'));
const ExecutionHistoryPage = lazy(() => import('./pages/ExecutionHistoryPage'));
const ExecutionDetailPage = lazy(() => import('./pages/ExecutionDetailPage'));
const ProfileSettingsPage = lazy(() => import('./pages/ProfileSettingsPage'));
const AdminEnginesPage = lazy(() => import('./pages/AdminEnginesPage'));
const AdminTasksPage = lazy(() => import('./pages/AdminTasksPage'));
const AdminTaskEditPage = lazy(() => import('./pages/AdminTaskEditPage'));
const AdminCategoriesPage = lazy(() => import('./pages/AdminCategoriesPage'));
const AdminPermissionGroupsPage = lazy(() => import('./pages/AdminPermissionGroupsPage'));
const AdminPermissionGroupDetailPage = lazy(() => import('./pages/AdminPermissionGroupDetailPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const SystemOrganisationsPage = lazy(() => import('./pages/SystemOrganisationsPage'));
const SystemUsersPage = lazy(() => import('./pages/SystemUsersPage'));
const SystemSettingsPage = lazy(() => import('./pages/SystemSettingsPage'));
const SystemTaskQueuePage = lazy(() => import('./pages/SystemTaskQueuePage'));

function PageLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300, color: '#64748b' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#3b82f6',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px'
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

function ProtectedLayout({ user, loading }: { user: User | null; loading: boolean }) {
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', color: '#64748b' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Layout user={user}>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </Layout>
  );
}

// Admin-only routes: engines, categories, permission groups (org_admin / system_admin)
function AdminGuard({ user }: { user: User | null }) {
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'org_admin' && user.role !== 'system_admin') return <Navigate to="/" replace />;
  return <Outlet />;
}

// Manager+ routes: task management and user management
function ManagerGuard({ user }: { user: User | null }) {
  if (!user) return <Navigate to="/login" replace />;
  const allowed = ['manager', 'org_admin', 'system_admin'];
  if (!allowed.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function SystemAdminGuard({ user }: { user: User | null }) {
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'system_admin') return <Navigate to="/" replace />;
  return <Outlet />;
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
      .then(({ data }) => {
        setUser(data);
        setUserRole(data.role);
      })
      .catch(() => {
        setUser(null);
        removeUserRole();
        removeActiveOrg();
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={
          <Suspense fallback={<PageLoader />}>
            {user ? <Navigate to="/" replace /> : <LoginPage />}
          </Suspense>
        } />
        <Route path="/invite/accept" element={
          <Suspense fallback={<PageLoader />}>
            <AcceptInvitePage />
          </Suspense>
        } />
        <Route path="/forgot-password" element={
          <Suspense fallback={<PageLoader />}>
            <ForgotPasswordPage />
          </Suspense>
        } />
        <Route path="/reset-password" element={
          <Suspense fallback={<PageLoader />}>
            <ResetPasswordPage />
          </Suspense>
        } />

        <Route element={<ProtectedLayout user={user} loading={loading} />}>
          <Route path="/" element={<DashboardPage user={user!} />} />
          <Route path="/tasks" element={<TasksPage user={user!} />} />
          <Route path="/tasks/:id" element={<TaskExecutionPage user={user!} />} />
          <Route path="/executions" element={<ExecutionHistoryPage user={user!} />} />
          <Route path="/executions/:id" element={<ExecutionDetailPage user={user!} />} />
          <Route path="/settings" element={<ProfileSettingsPage user={user!} />} />

          {/* Manager+ routes: task management and user management */}
          <Route element={<ManagerGuard user={user} />}>
            <Route path="/admin/tasks" element={<AdminTasksPage user={user!} />} />
            <Route path="/admin/tasks/:id" element={<AdminTaskEditPage user={user!} />} />
            <Route path="/admin/users" element={<AdminUsersPage user={user!} />} />
          </Route>

          {/* Admin-only routes: infrastructure configuration */}
          <Route element={<AdminGuard user={user} />}>
            <Route path="/admin/engines" element={<AdminEnginesPage user={user!} />} />
            <Route path="/admin/categories" element={<AdminCategoriesPage user={user!} />} />
            <Route path="/admin/permission-groups" element={<AdminPermissionGroupsPage user={user!} />} />
            <Route path="/admin/permission-groups/:id" element={<AdminPermissionGroupDetailPage user={user!} />} />
          </Route>

          <Route element={<SystemAdminGuard user={user} />}>
            <Route path="/system/organisations" element={<SystemOrganisationsPage user={user!} />} />
            <Route path="/system/users" element={<SystemUsersPage user={user!} />} />
            <Route path="/system/settings" element={<SystemSettingsPage user={user!} />} />
            <Route path="/system/task-queue" element={<SystemTaskQueuePage user={user!} />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
