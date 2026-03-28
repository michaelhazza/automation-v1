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
const ProcessesPage = lazy(() => import('./pages/TasksPage'));
const ProcessExecutionPage = lazy(() => import('./pages/TaskExecutionPage'));
const ExecutionHistoryPage = lazy(() => import('./pages/ExecutionHistoryPage'));
const ExecutionDetailPage = lazy(() => import('./pages/ExecutionDetailPage'));
const ProfileSettingsPage = lazy(() => import('./pages/ProfileSettingsPage'));
const AdminEnginesPage = lazy(() => import('./pages/AdminEnginesPage'));
const AdminProcessesPage = lazy(() => import('./pages/AdminTasksPage'));
const AdminProcessEditPage = lazy(() => import('./pages/AdminTaskEditPage'));
const AdminCategoriesPage = lazy(() => import('./pages/AdminCategoriesPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const AdminSubaccountsPage = lazy(() => import('./pages/AdminSubaccountsPage'));
const AdminSubaccountDetailPage = lazy(() => import('./pages/AdminSubaccountDetailPage'));
const SystemOrganisationsPage = lazy(() => import('./pages/SystemOrganisationsPage'));
const SystemUsersPage = lazy(() => import('./pages/SystemUsersPage'));
const SystemSettingsPage = lazy(() => import('./pages/SystemSettingsPage'));
const SystemTaskQueuePage = lazy(() => import('./pages/SystemTaskQueuePage'));
const PortalLandingPage = lazy(() => import('./pages/PortalLandingPage'));
const PortalPage = lazy(() => import('./pages/PortalPage'));
const PortalExecutionPage = lazy(() => import('./pages/PortalExecutionPage'));
const PortalExecutionHistoryPage = lazy(() => import('./pages/PortalExecutionHistoryPage'));
const AgentsPage = lazy(() => import('./pages/AgentsPage'));
const AgentChatPage = lazy(() => import('./pages/AgentChatPage'));
const AdminAgentsPage = lazy(() => import('./pages/AdminAgentsPage'));
const AdminAgentEditPage = lazy(() => import('./pages/AdminAgentEditPage'));
const AdminBoardConfigPage = lazy(() => import('./pages/AdminBoardConfigPage'));
const AdminSkillsPage = lazy(() => import('./pages/AdminSkillsPage'));
const AdminSkillEditPage = lazy(() => import('./pages/AdminSkillEditPage'));
const WorkspaceBoardPage = lazy(() => import('./pages/WorkspaceBoardPage'));
const SystemBoardTemplatesPage = lazy(() => import('./pages/SystemBoardTemplatesPage'));
const SystemActivityPage = lazy(() => import('./pages/SystemActivityPage'));
const OrgSettingsPage = lazy(() => import('./pages/OrgSettingsPage'));
const WorkspaceMemoryPage = lazy(() => import('./pages/WorkspaceMemoryPage'));
const ScheduledTasksPage = lazy(() => import('./pages/ScheduledTasksPage'));
const ScheduledTaskDetailPage = lazy(() => import('./pages/ScheduledTaskDetailPage'));

function PageLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
      <div style={{
        width: 32, height: 32,
        border: '3px solid #e2e8f0',
        borderTopColor: '#6366f1',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
    </div>
  );
}

function ProtectedLayout({ user, loading }: { user: User | null; loading: boolean }) {
  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div style={{ width: 36, height: 36, border: '3px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Layout user={user}>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </Layout>
  );
}

// Org admin routes — any authenticated user may attempt these; API enforces permission-set checks.
function OrgAdminGuard({ user }: { user: User | null }) {
  if (!user) return <Navigate to="/login" replace />;
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
          <Route path="/processes" element={<ProcessesPage user={user!} />} />
          <Route path="/processes/:id" element={<ProcessExecutionPage user={user!} />} />
          <Route path="/executions" element={<ExecutionHistoryPage user={user!} />} />
          <Route path="/executions/:id" element={<ExecutionDetailPage user={user!} />} />
          <Route path="/settings" element={<ProfileSettingsPage user={user!} />} />

          {/* Org admin routes — all authenticated users; API enforces permission-set checks */}
          <Route element={<OrgAdminGuard user={user} />}>
            <Route path="/admin/processes" element={<AdminProcessesPage user={user!} />} />
            <Route path="/admin/processes/:id" element={<AdminProcessEditPage user={user!} />} />
            <Route path="/admin/users" element={<AdminUsersPage user={user!} />} />
            <Route path="/admin/engines" element={<AdminEnginesPage user={user!} />} />
            <Route path="/admin/categories" element={<AdminCategoriesPage user={user!} />} />
            <Route path="/admin/subaccounts" element={<AdminSubaccountsPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId" element={<AdminSubaccountDetailPage user={user!} />} />
            <Route path="/admin/permission-sets" element={<Navigate to="/admin/org-settings" replace />} />
            <Route path="/admin/agents" element={<AdminAgentsPage user={user!} />} />
            <Route path="/admin/agents/:id" element={<AdminAgentEditPage user={user!} />} />
            <Route path="/admin/skills" element={<AdminSkillsPage user={user!} />} />
            <Route path="/admin/skills/:id" element={<AdminSkillEditPage user={user!} />} />
            <Route path="/admin/board-config" element={<AdminBoardConfigPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/workspace" element={<WorkspaceBoardPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/memory" element={<WorkspaceMemoryPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/scheduled-tasks" element={<ScheduledTasksPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/scheduled-tasks/:stId" element={<ScheduledTaskDetailPage user={user!} />} />
            <Route path="/admin/org-settings" element={<OrgSettingsPage user={user!} />} />
          </Route>

          <Route element={<SystemAdminGuard user={user} />}>
            <Route path="/system/organisations" element={<SystemOrganisationsPage user={user!} />} />
            <Route path="/system/users" element={<SystemUsersPage user={user!} />} />
            <Route path="/system/settings" element={<SystemSettingsPage user={user!} />} />
            <Route path="/system/activity" element={<SystemActivityPage user={user!} />} />
            <Route path="/system/task-queue" element={<SystemTaskQueuePage user={user!} />} />
            <Route path="/system/board-templates" element={<SystemBoardTemplatesPage user={user!} />} />
          </Route>

          {/* AI Agents */}
          <Route path="/agents" element={<AgentsPage user={user!} />} />
          <Route path="/agents/:id" element={<AgentChatPage user={user!} />} />

          {/* Client portal routes */}
          <Route path="/portal" element={<PortalLandingPage user={user!} />} />
          <Route path="/portal/:subaccountId" element={<PortalPage user={user!} />} />
          <Route path="/portal/:subaccountId/processes/:processId" element={<PortalExecutionPage user={user!} />} />
          <Route path="/portal/:subaccountId/executions" element={<PortalExecutionHistoryPage user={user!} />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
