import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams, useNavigate, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import api from './lib/api';
import { isAuthenticated, User, setUserRole, removeUserRole, removeActiveOrg } from './lib/auth';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { ConfigAssistantPopupProvider } from './hooks/useConfigAssistantPopup';
import ConfigAssistantPopup from './components/config-assistant/ConfigAssistantPopup';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const AutomationsPage = lazy(() => import('./pages/AutomationsPage'));
const AutomationExecutionPage = lazy(() => import('./pages/AutomationExecutionPage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ExecutionDetailPage = lazy(() => import('./pages/ExecutionDetailPage'));
const ProfileSettingsPage = lazy(() => import('./pages/ProfileSettingsPage'));
const AdminAutomationsPage = lazy(() => import('./pages/AdminAutomationsPage'));
const AdminAutomationEditPage = lazy(() => import('./pages/AdminAutomationEditPage'));
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
const AgentChatPage = lazy(() => import('./pages/AgentChatPage'));
const AdminAgentsPage = lazy(() => import('./pages/AdminAgentsPage'));
const SubaccountBlueprintsPage = lazy(() => import('./pages/SubaccountBlueprintsPage'));
const ClientPulseSettingsPage = lazy(() => import('./pages/ClientPulseSettingsPage'));
const AdminAgentEditPage = lazy(() => import('./pages/AdminAgentEditPage'));
const AdminSkillsPage = lazy(() => import('./pages/AdminSkillsPage'));
const McpServersPage = lazy(() => import('./pages/McpServersPage'));
const IntegrationsAndCredentialsPage = lazy(() => import('./pages/IntegrationsAndCredentialsPage'));
const AdminSkillEditPage = lazy(() => import('./pages/AdminSkillEditPage'));
const WorkspaceBoardPage = lazy(() => import('./pages/WorkspaceBoardPage'));

const SystemAgentsPage = lazy(() => import('./pages/SystemAgentsPage'));
const SystemAgentEditPage = lazy(() => import('./pages/SystemAgentEditPage'));
const SystemSkillsPage = lazy(() => import('./pages/SystemSkillsPage'));
const SystemSkillEditPage = lazy(() => import('./pages/SystemSkillEditPage'));
const SystemPnlPage = lazy(() => import('./pages/SystemPnlPage'));
const SystemIncidentsPage = lazy(() => import('./pages/SystemIncidentsPage'));
const OrgSettingsPage = lazy(() => import('./pages/OrgSettingsPage'));
const WorkspaceMemoryPage = lazy(() => import('./pages/WorkspaceMemoryPage'));
const SubaccountKnowledgePage = lazy(() => import('./pages/SubaccountKnowledgePage'));
// Memory & Briefings Phase 2 — HITL review queue (S7)
const MemoryReviewQueuePage = lazy(() => import('./pages/MemoryReviewQueuePage'));
// Memory & Briefings Phase 3 — subaccount onboarding flow (S5)
const SubaccountOnboardingPage = lazy(() => import('./pages/SubaccountOnboardingPage'));
// Memory & Briefings Phase 3 — configuration document upload (S21)
const ConfigDocumentUploadPage = lazy(() => import('./pages/ConfigDocumentUploadPage'));
// Memory & Briefings Phase 5 — memory block detail + version history (S24)
const MemoryBlockDetailPage = lazy(() => import('./pages/MemoryBlockDetailPage'));
const ScheduledTasksPage = lazy(() => import('./pages/ScheduledTasksPage'));
const ScheduledTaskDetailPage = lazy(() => import('./pages/ScheduledTaskDetailPage'));
const ScheduleCalendarPage = lazy(() => import('./pages/ScheduleCalendarPage'));
const SubaccountScheduleCalendarPage = lazy(() => import('./pages/SubaccountScheduleCalendarPage'));
const SystemAutomationsPage = lazy(() => import('./pages/SystemAutomationsPage'));
const SystemEnginesPage = lazy(() => import('./pages/SystemEnginesPage'));
const SubaccountTeamPage = lazy(() => import('./pages/SubaccountTeamPage'));
const ReviewQueuePage = lazy(() => import('./pages/ReviewQueuePage'));
const WorkflowsLibraryPage = lazy(() => import('./pages/WorkflowsLibraryPage'));
const WorkflowRunDetailPage = lazy(() => import('./pages/WorkflowRunDetailPage'));
const WorkflowRunPage = lazy(() => import('./pages/subaccount/WorkflowRunPage'));
const WorkflowStudioPage = lazy(() => import('./pages/WorkflowStudioPage'));
const RunTraceViewerPage = lazy(() => import('./pages/RunTraceViewerPage'));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'));
const OrgChartPage = lazy(() => import('./pages/OrgChartPage'));
const UsagePage = lazy(() => import('./pages/UsagePage'));
const PageProjectsPage = lazy(() => import('./pages/PageProjectsPage'));
const PageProjectDetailPage = lazy(() => import('./pages/PageProjectDetailPage'));
const JobQueueDashboardPage = lazy(() => import('./pages/JobQueueDashboardPage'));
const AgentTriggersPage = lazy(() => import('./pages/AgentTriggersPage'));
const SubaccountTagsPage = lazy(() => import('./pages/SubaccountTagsPage'));
const SubaccountSkillsPage = lazy(() => import('./pages/SubaccountSkillsPage'));

const GoalsPage = lazy(() => import('./pages/GoalsPage'));
const SubaccountAgentEditPage = lazy(() => import('./pages/SubaccountAgentEditPage'));
const SkillAnalyzerPage = lazy(() => import('./pages/SkillAnalyzerPage'));
const AgentRunHistoryPage = lazy(() => import('./pages/AgentRunHistoryPage'));
const AgentRunLivePage = lazy(() => import('./pages/AgentRunLivePage'));
// Universal Brief — detail page (Phase 2)
const BriefDetailPage = lazy(() => import('./pages/BriefDetailPage'));
// Learned Rules library (Phase 5)
const LearnedRulesPage = lazy(() => import('./pages/LearnedRulesPage'));
const AdminHealthFindingsPage = lazy(() => import('./pages/AdminHealthFindingsPage'));
const AdminActionLogPage = lazy(() => import('./pages/AdminActionLogPage'));

const SkillStudioPage = lazy(() => import('./pages/SkillStudioPage'));
const ConfigAssistantPage = lazy(() => import('./pages/ConfigAssistantPage'));
const ConfigSessionHistoryPage = lazy(() => import('./pages/ConfigSessionHistoryPage'));
const AgentMailboxPage = lazy(() => import('./pages/AgentMailboxPage'));
const AgentCalendarPage = lazy(() => import('./pages/AgentCalendarPage'));

// ClientPulse pages
const SignupPage = lazy(() => import('./pages/SignupPage'));
const OnboardingWizardPage = lazy(() => import('./pages/OnboardingWizardPage'));
const GhlOAuthInterstitialPage = lazy(() => import('./pages/GhlOAuthInterstitialPage'));
const OnboardingCelebrationPage = lazy(() => import('./pages/OnboardingCelebrationPage'));
const ClientPulseDashboardPage = lazy(() => import('./pages/ClientPulseDashboardPage'));
const ClientPulseDrilldownPage = lazy(() => import('./pages/ClientPulseDrilldownPage'));
const ClientPulseClientsListPage = lazy(() => import('./pages/ClientPulseClientsListPage'));
const ReportsListPage = lazy(() => import('./pages/ReportsListPage'));
const ReportDetailPage = lazy(() => import('./pages/ReportDetailPage'));
const SystemModulesPage = lazy(() => import('./pages/SystemModulesPage'));

function PageLoader() {
  return (
    <div className="flex justify-center items-center min-h-[300px]">
      <div className="w-8 h-8 border-[3px] border-slate-200 border-t-indigo-500 rounded-full [animation:spin_0.8s_linear_infinite]" />
    </div>
  );
}

function ProtectedLayout({ user, loading }: { user: User | null; loading: boolean }) {
  // Session 1 (spec §7.4) — on first render of a protected surface, check
  // whether the org's onboarding wizard should auto-open. `needsOnboarding`
  // is derived server-side from organisations.onboarding_completed_at IS NULL.
  useOnboardingRedirect(user);
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

/**
 * Redirect to /onboarding on first render of a protected surface when the
 * server reports needsOnboarding=true AND the current user has permission
 * to complete the wizard. Skips if already on /onboarding/* so the wizard
 * itself doesn't self-redirect. System-admin surfaces without an org
 * context receive { needsOnboarding: false } from the server.
 *
 * Permission gate rationale: POST /api/onboarding/complete requires
 * ORG_PERMISSIONS.AGENTS_EDIT ('org.agents.edit'). Without this gate,
 * read-only org members would be permanently trapped on /onboarding
 * because they can see the wizard but cannot complete it. Users without
 * the permission stay on their requested page; the dashboard's existing
 * empty-state copy surfaces the "waiting for admin" message when GHL
 * isn't connected.
 */
function useOnboardingRedirect(user: User | null) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!user) return;
    if (location.pathname.startsWith('/onboarding')) return;
    let cancelled = false;
    Promise.all([
      api.get<{ needsOnboarding?: boolean }>('/api/onboarding/status'),
      api.get<{ permissions: string[] }>('/api/my-permissions'),
    ])
      .then(([statusRes, permsRes]) => {
        if (cancelled) return;
        if (!statusRes.data?.needsOnboarding) return;
        const canComplete = Array.isArray(permsRes.data?.permissions)
          && permsRes.data.permissions.includes('org.agents.edit');
        if (!canComplete) return;
        navigate('/onboarding', { replace: true });
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [user, location.pathname, navigate]);
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

function SubaccountIntegrationsRoute({ user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  return <IntegrationsAndCredentialsPage user={user} subaccountId={subaccountId} />;
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
      <ConfigAssistantPopupProvider>
        <Toaster position="bottom-right" richColors />
        {/* HelpHint portal root (spec §6.3) — see client/src/components/ui/HelpHint.tsx */}
        <div id="help-hint-portal" />
        {/* Session 1 / spec §5 — single global mount point for the Configuration Assistant popup. */}
        <ConfigAssistantPopup />
      <Routes>
        <Route path="/login" element={
          <Suspense fallback={<PageLoader />}>
            {user ? <Navigate to="/" replace /> : <LoginPage />}
          </Suspense>
        } />
        <Route path="/signup" element={
          <Suspense fallback={<PageLoader />}>
            {user ? <Navigate to="/onboarding" replace /> : <SignupPage />}
          </Suspense>
        } />
        <Route path="/onboarding" element={
          <Suspense fallback={<PageLoader />}>
            {!user ? <Navigate to="/login" replace /> : <OnboardingWizardPage />}
          </Suspense>
        } />
        <Route path="/onboarding/connect-ghl" element={
          <Suspense fallback={<PageLoader />}>
            {!user ? <Navigate to="/login" replace /> : <GhlOAuthInterstitialPage />}
          </Suspense>
        } />
        <Route path="/onboarding/ready" element={
          <Suspense fallback={<PageLoader />}>
            {!user ? <Navigate to="/login" replace /> : <OnboardingCelebrationPage />}
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
          <Route path="/automations" element={<AutomationsPage user={user!} />} />
          <Route path="/automations/:id" element={<AutomationExecutionPage user={user!} />} />
          <Route path="/executions/:id" element={<ExecutionDetailPage user={user!} />} />
          <Route path="/settings" element={<ProfileSettingsPage user={user!} />} />
          <Route path="/inbox" element={<Navigate to="/" replace />} />
          <Route path="/workflows" element={<WorkflowsLibraryPage user={user!} />} />
          <Route path="/workflow-runs/:runId" element={<WorkflowRunDetailPage user={user!} />} />
          {/* §9.2 — subaccount-scoped run page (envelope endpoint + WS live). */}
          <Route path="/sub/:subaccountId/runs/:runId" element={<WorkflowRunPage user={user!} />} />
          {/* §9.4 — portal-scoped variant; same component, viewer-role aware. */}
          <Route path="/portal/:subaccountId/runs/:runId" element={<WorkflowRunPage user={user!} />} />

          {/* Org admin routes — all authenticated users; API enforces permission-set checks */}
          <Route element={<OrgAdminGuard user={user} />}>
            <Route path="/admin/automations" element={<AdminAutomationsPage user={user!} />} />
            <Route path="/admin/automations/:id" element={<AdminAutomationEditPage user={user!} />} />
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
            <Route path="/agents/blueprints" element={<SubaccountBlueprintsPage user={user!} />} />
            {/* Legacy path — kept for bookmarks; renders the renamed page. */}
            <Route path="/admin/agent-templates" element={<SubaccountBlueprintsPage user={user!} />} />
            <Route path="/clientpulse/settings" element={<ClientPulseSettingsPage user={user!} />} />
            <Route path="/admin/skills" element={<AdminSkillsPage user={user!} />} />
            <Route path="/admin/mcp-servers" element={<IntegrationsAndCredentialsPage user={user!} />} />
            <Route path="/admin/skills/:id" element={<AdminSkillEditPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/agents" element={<Navigate to={`/admin/subaccounts`} replace />} />
            <Route path="/admin/subaccounts/:subaccountId/agents/:linkId/manage" element={<SubaccountAgentEditPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/agents/:agentId/mailbox" element={<AgentMailboxPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/agents/:agentId/calendar" element={<AgentCalendarPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/workspace" element={<WorkspaceBoardPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/memory" element={<WorkspaceMemoryPage user={user!} />} />
            {/* Unified Knowledge page (spec §7.2) — References + Memory Blocks in one place */}
            <Route path="/admin/subaccounts/:subaccountId/knowledge" element={<SubaccountKnowledgePage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/scheduled-tasks" element={<ScheduledTasksPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/scheduled-tasks/:stId" element={<ScheduledTaskDetailPage user={user!} />} />
            {/* Feature 1 — Scheduled Runs Calendar (docs/routines-response-dev-spec.md §3.4) */}
            <Route path="/admin/subaccounts/:subaccountId/schedule-calendar" element={<SubaccountScheduleCalendarPage user={user!} />} />
            <Route path="/admin/schedule-calendar" element={<ScheduleCalendarPage user={user!} />} />
            <Route path="/portal/:subaccountId/schedule-calendar" element={<SubaccountScheduleCalendarPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/review-queue" element={<ReviewQueuePage user={user!} />} />
            {/* Memory & Briefings Phase 2 — HITL review queue (S7) */}
            <Route path="/admin/subaccounts/:subaccountId/memory-review-queue" element={<MemoryReviewQueuePage />} />
            {/* Memory & Briefings Phase 3 — S5 onboarding + S21 config docs */}
            <Route path="/admin/subaccounts/:subaccountId/onboarding" element={<SubaccountOnboardingPage />} />
            <Route path="/admin/subaccounts/:subaccountId/config-documents/upload" element={<ConfigDocumentUploadPage />} />
            {/* Memory & Briefings Phase 5 — block detail (S24) */}
            <Route path="/admin/memory-blocks/:blockId" element={<MemoryBlockDetailPage />} />
            <Route path="/admin/subaccounts/:subaccountId/inbox" element={<Navigate to="/" replace />} />
            <Route path="/admin/subaccounts/:subaccountId/runs/:runId" element={<RunTraceViewerPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/usage" element={<UsagePage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/page-projects" element={<PageProjectsPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/page-projects/:projectId" element={<PageProjectDetailPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/triggers" element={<AgentTriggersPage />} />
            <Route path="/admin/subaccounts/:subaccountId/tags" element={<SubaccountTagsPage />} />
            <Route path="/admin/subaccounts/:subaccountId/skills" element={<SubaccountSkillsPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/goals" element={<GoalsPage user={user!} />} />
            <Route path="/admin/org-settings" element={<OrgSettingsPage user={user!} />} />
            <Route path="/admin/org-memory" element={<Navigate to="/admin/org-settings?tab=memory" replace />} />
            <Route path="/admin/org-agent-configs" element={<Navigate to="/admin/agents?tab=org-execution" replace />} />
            <Route path="/admin/hierarchy-templates" element={<Navigate to="/admin/agents?tab=team-templates" replace />} />
            <Route path="/admin/connectors" element={<Navigate to="/admin/mcp-servers" replace />} />
            {/* Workspace health audit findings */}
            <Route path="/admin/health-findings" element={<AdminHealthFindingsPage user={user!} />} />
            {/* Per-subaccount action audit log */}
            <Route path="/admin/subaccounts/:subaccountId/actions" element={<AdminActionLogPage user={user!} />} />
            {/* Pulse — retired; redirect to home */}
            <Route path="/admin/pulse" element={<Navigate to="/" replace />} />
            <Route path="/admin/subaccounts/:subaccountId/pulse" element={<Navigate to="/" replace />} />
            {/* Activity — org scope (redirects to home) */}
            <Route path="/admin/activity" element={<Navigate to="/" replace />} />
            {/* Activity — subaccount scope (redirects to home) */}
            <Route path="/admin/subaccounts/:subaccountId/activity" element={<Navigate to="/" replace />} />
            {/* Skill Studio — org scope */}
            <Route path="/admin/skill-studio" element={<SkillStudioPage user={user!} />} />
            {/* Configuration Assistant */}
            <Route path="/admin/config-assistant" element={<ConfigAssistantPage user={user!} />} />
            <Route path="/admin/config-history/session/:sessionId" element={<ConfigSessionHistoryPage user={user!} />} />
            {/* Universal Brief detail page (Phase 2) */}
            <Route path="/admin/briefs/:briefId" element={<BriefDetailPage user={user!} />} />
            {/* Learned Rules library (Phase 5) */}
            <Route path="/rules" element={<LearnedRulesPage user={user!} />} />
            <Route path="/subaccounts/:id/rules" element={<LearnedRulesPage user={user!} />} />
          </Route>

          {/* ClientPulse routes */}
          <Route path="/clientpulse" element={<ClientPulseDashboardPage user={user!} />} />
          <Route path="/clientpulse/clients" element={<ClientPulseClientsListPage user={user!} />} />
          <Route path="/clientpulse/clients/:subaccountId" element={<ClientPulseDrilldownPage user={user!} />} />
          <Route path="/reports" element={<ReportsListPage user={user!} />} />
          <Route path="/reports/:id" element={<ReportDetailPage user={user!} />} />

          <Route element={<SystemAdminGuard user={user} />}>
            <Route path="/system/organisations" element={<SystemOrganisationsPage user={user!} />} />
            <Route path="/system/modules" element={<SystemModulesPage user={user!} />} />
            <Route path="/system/settings" element={<SystemSettingsPage user={user!} />} />
            <Route path="/system/task-queue" element={<SystemTaskQueuePage user={user!} />} />
            <Route path="/system/job-queues" element={<JobQueueDashboardPage />} />
            <Route path="/system/agents" element={<SystemAgentsPage user={user!} />} />
            <Route path="/system/agents/:id" element={<SystemAgentEditPage user={user!} />} />
            <Route path="/system/skills" element={<SystemSkillsPage user={user!} />} />
            <Route path="/system/llm-pnl" element={<SystemPnlPage />} />
            <Route path="/system/incidents" element={<SystemIncidentsPage />} />
            <Route path="/system/skill-analyser" element={<SkillAnalyzerPage user={user!} />} />
            <Route path="/system/workflow-studio" element={<WorkflowStudioPage user={user!} />} />
            <Route path="/system/skills/:id" element={<SystemSkillEditPage user={user!} />} />
            <Route path="/system/automations" element={<SystemAutomationsPage user={user!} />} />
            <Route path="/system/engines" element={<SystemEnginesPage user={user!} />} />
            {/* Activity — system scope */}
            <Route path="/system/activity" element={<ActivityPage user={user!} />} />
            {/* Skill Studio — system scope */}
            <Route path="/system/skill-studio" element={<SkillStudioPage user={user!} />} />
          </Route>

          {/* Subaccount connections */}
          <Route path="/admin/subaccounts/:subaccountId/connections" element={<SubaccountIntegrationsRoute user={user!} />} />
          <Route path="/portal/:subaccountId/connections" element={<SubaccountIntegrationsRoute user={user!} />} />

          {/* Subaccount team */}
          <Route path="/admin/subaccounts/:subaccountId/team" element={<SubaccountTeamPage user={user!} />} />

          {/* Review queue (portal access) */}
          <Route path="/portal/:subaccountId/review-queue" element={<ReviewQueuePage user={user!} />} />

          {/* Run trace viewer — org-level (admin agent and skill test runs) */}
          <Route path="/admin/runs/:runId" element={<RunTraceViewerPage user={user!} />} />

          {/* Live Agent Execution Log — per-run live + historical timeline.
              Spec: tasks/live-agent-execution-log-spec.md §6.5. */}
          <Route path="/runs/:runId/live" element={<AgentRunLivePage user={user!} />} />

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
          {/* Brain Tree OS adoption P3 — agent run history */}
          <Route path="/agents/:agentId/runs" element={<AgentRunHistoryPage user={user!} />} />
          <Route path="/admin/subaccounts/:subaccountId/agents/:agentId/runs" element={<AgentRunHistoryPage user={user!} />} />

          {/* Client portal routes */}
          <Route path="/portal" element={<PortalLandingPage user={user!} />} />
          <Route path="/portal/:subaccountId" element={<PortalPage user={user!} />} />
          <Route path="/portal/:subaccountId/automations/:automationId" element={<PortalExecutionPage user={user!} />} />
          <Route path="/portal/:subaccountId/executions" element={<PortalExecutionHistoryPage user={user!} />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </ConfigAssistantPopupProvider>
    </BrowserRouter>
  );
}
