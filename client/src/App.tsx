import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import api from './lib/api';
import { isAuthenticated, User, setUserRole, removeUserRole, removeActiveOrg } from './lib/auth';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';

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
const AdminProcessesPage = lazy(() => import('./pages/AdminTasksPage'));
const AdminProcessEditPage = lazy(() => import('./pages/AdminTaskEditPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const AdminSubaccountsPage = lazy(() => import('./pages/AdminSubaccountsPage'));
const AdminSubaccountDetailPage = lazy(() => import('./pages/AdminSubaccountDetailPage'));
const SystemOrganisationsPage = lazy(() => import('./pages/SystemOrganisationsPage'));
const SystemSettingsPage = lazy(() => import('./pages/SystemSettingsPage'));
const SystemTaskQueuePage = lazy(() => import('./pages/SystemTaskQueuePage'));
const PortalLandingPage = lazy(() => import('./pages/PortalLandingPage'));
const PortalPage = lazy(() => import('./pages/PortalPage'));
const PortalExecutionPage = lazy(() => import('./pages/PortalExecutionPage'));
const PortalExecutionHistoryPage = lazy(() => import('./pages/PortalExecutionHistoryPage'));
const AgentsPage = lazy(() => import('./pages/AgentsPage'));
const AgentChatPage = lazy(() => import('./pages/AgentChatPage'));
const AdminAgentsPage = lazy(() => import('./pages/AdminAgentsPage'));
const AdminAgentTemplatesPage = lazy(() => import('./pages/AdminAgentTemplatesPage'));
const SubaccountAgentsPage = lazy(() => import('./pages/SubaccountAgentsPage'));
const AdminAgentEditPage = lazy(() => import('./pages/AdminAgentEditPage'));
const AdminSettingsPage = lazy(() => import('./pages/AdminSettingsPage'));
const AdminSkillsPage = lazy(() => import('./pages/AdminSkillsPage'));
const McpServersPage = lazy(() => import('./pages/McpServersPage'));
const AdminSkillEditPage = lazy(() => import('./pages/AdminSkillEditPage'));
const WorkspaceBoardPage = lazy(() => import('./pages/WorkspaceBoardPage'));
const SystemActivityPage = lazy(() => import('./pages/SystemActivityPage'));
const SystemAgentsPage = lazy(() => import('./pages/SystemAgentsPage'));
const SystemAgentEditPage = lazy(() => import('./pages/SystemAgentEditPage'));
const SystemSkillsPage = lazy(() => import('./pages/SystemSkillsPage'));
const SystemSkillEditPage = lazy(() => import('./pages/SystemSkillEditPage'));
const OrgSettingsPage = lazy(() => import('./pages/OrgSettingsPage'));
const WorkspaceMemoryPage = lazy(() => import('./pages/WorkspaceMemoryPage'));
const ScheduledTasksPage = lazy(() => import('./pages/ScheduledTasksPage'));
const ScheduledTaskDetailPage = lazy(() => import('./pages/ScheduledTaskDetailPage'));
const SystemProcessesPage = lazy(() => import('./pages/SystemProcessesPage'));
const SystemEnginesPage = lazy(() => import('./pages/SystemEnginesPage'));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage'));
const SubaccountTeamPage = lazy(() => import('./pages/SubaccountTeamPage'));
const ReviewQueuePage = lazy(() => import('./pages/ReviewQueuePage'));
const RunTraceViewerPage = lazy(() => import('./pages/RunTraceViewerPage'));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'));
const OrgChartPage = lazy(() => import('./pages/OrgChartPage'));
const UsagePage = lazy(() => import('./pages/UsagePage'));
const PageProjectsPage = lazy(() => import('./pages/PageProjectsPage'));
const PageProjectDetailPage = lazy(() => import('./pages/PageProjectDetailPage'));
const JobQueueDashboardPage = lazy(() => import('./pages/JobQueueDashboardPage'));
const OrgMemoryPage = lazy(() => import('./pages/OrgMemoryPage'));
const AgentTriggersPage = lazy(() => import('./pages/AgentTriggersPage'));
const OrgAgentConfigsPage = lazy(() => import('./pages/OrgAgentConfigsPage'));
const SubaccountTagsPage = lazy(() => import('./pages/SubaccountTagsPage'));
const HierarchyTemplatesPage = lazy(() => import('./pages/HierarchyTemplatesPage'));
const ConnectorConfigsPage = lazy(() => import('./pages/ConnectorConfigsPage'));

function PageLoader() {
  return (
    <div className="flex justify-center items-center min-h-[300px]">
      <div className="w-8 h-8 border-[3px] border-slate-200 border-t-indigo-500 rounded-full [animation:spin_0.8s_linear_infinite]" />
    </div>
  );
}

function ProtectedLayout({ user, loading }: { user: User | null; loading: boolean }) {
  if (loading) return (
    <div className="flex justify-center items-center min-h-screen">
      <div className="w-9 h-9 border-[3px] border-slate-200 border-t-indigo-500 rounded-full [animation:spin_0.8s_linear_infinite]" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Layout user={user}>
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
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
      .catch((err) => {
        console.error('[App] Auth check failed:', err);
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
            <Route path="/admin/settings" element={<Navigate to="/admin/org-settings" replace />} />
            <Route path="/admin/board-config" element={<Navigate to="/admin/org-settings" replace />} />
            <Route path="/admin/categories" element={<Navigate to="/admin/org-settings" replace />} />
            <Route path="/admin/engines" element={<Navigate to="/admin/org-settings" replace />} />
            <Route path="/admin/permission-sets" element={<Navigate to="/admin/org-settings" replace />} />
            <Route path="/admin/subaccounts" element={<AdminSubaccountsPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId" element={<AdminSubaccountDetailPage user={user!} mode="admin" />} />
            <Route path="/admin/agents" element={<AdminAgentsPage user={user!} />} />
            <Route path="/admin/agents/:id" element={<AdminAgentEditPage user={user!} />} />
            <Route path="/admin/agent-templates" element={<AdminAgentTemplatesPage user={user!} />} />
            <Route path="/admin/skills" element={<AdminSkillsPage user={user!} />} />
            <Route path="/admin/mcp-servers" element={<McpServersPage user={user!} />} />
            <Route path="/admin/skills/:id" element={<AdminSkillEditPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/agents" element={<Navigate to={`/admin/subaccounts`} replace />} />
            <Route path="/admin/subaccounts/:subaccountId/workspace" element={<WorkspaceBoardPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/memory" element={<WorkspaceMemoryPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/scheduled-tasks" element={<ScheduledTasksPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/scheduled-tasks/:stId" element={<ScheduledTaskDetailPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/review-queue" element={<ReviewQueuePage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/runs/:runId" element={<RunTraceViewerPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/usage" element={<UsagePage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/page-projects" element={<PageProjectsPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/page-projects/:projectId" element={<PageProjectDetailPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/triggers" element={<AgentTriggersPage />} />
            <Route path="/admin/subaccounts/:subaccountId/tags" element={<SubaccountTagsPage />} />
            <Route path="/admin/org-settings" element={<OrgSettingsPage user={user!} />} />
            <Route path="/admin/org-memory" element={<OrgMemoryPage />} />
            <Route path="/admin/org-agent-configs" element={<OrgAgentConfigsPage />} />
            <Route path="/admin/hierarchy-templates" element={<HierarchyTemplatesPage />} />
            <Route path="/admin/connectors" element={<ConnectorConfigsPage />} />
          </Route>

          <Route element={<SystemAdminGuard user={user} />}>
            <Route path="/system/organisations" element={<SystemOrganisationsPage user={user!} />} />
            <Route path="/system/settings" element={<SystemSettingsPage user={user!} />} />
            <Route path="/system/activity" element={<SystemActivityPage user={user!} />} />
            <Route path="/system/task-queue" element={<SystemTaskQueuePage user={user!} />} />
            <Route path="/system/job-queues" element={<JobQueueDashboardPage />} />
            <Route path="/system/agents" element={<SystemAgentsPage user={user!} />} />
            <Route path="/system/agents/:id" element={<SystemAgentEditPage user={user!} />} />
            <Route path="/system/skills" element={<SystemSkillsPage user={user!} />} />
            <Route path="/system/skills/:id" element={<SystemSkillEditPage user={user!} />} />
            <Route path="/system/processes" element={<SystemProcessesPage user={user!} />} />
            <Route path="/system/engines" element={<SystemEnginesPage user={user!} />} />
          </Route>

          {/* Subaccount connections */}
          <Route path="/admin/subaccounts/:subaccountId/connections" element={<ConnectionsPage user={user!} />} />
          <Route path="/portal/:subaccountId/connections" element={<ConnectionsPage user={user!} />} />

          {/* Subaccount team */}
          <Route path="/admin/subaccounts/:subaccountId/team" element={<SubaccountTeamPage user={user!} />} />

          {/* Review queue (portal access) */}
          <Route path="/portal/:subaccountId/review-queue" element={<ReviewQueuePage user={user!} />} />

          {/* Run trace viewer */}
          <Route path="/admin/subaccounts/:subaccountId/runs/:runId" element={<RunTraceViewerPage user={user!} />} />

          {/* Client-level settings (subaccount admins — Categories, Automations, Members) */}
          <Route path="/client-settings/:subaccountId" element={<AdminSubaccountDetailPage user={user!} mode="client" />} />

          {/* Projects */}
          <Route path="/projects" element={<Navigate to="/" replace />} />
          <Route path="/projects/:id" element={<ProjectDetailPage user={user!} />} />

          {/* Org Chart */}
          <Route path="/org-chart" element={<OrgChartPage user={user!} />} />

          {/* AI Agents */}
          <Route path="/agents" element={<Navigate to="/" replace />} />
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
