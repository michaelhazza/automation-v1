import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams, useNavigate, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import api from './lib/api';
import { isAuthenticated, User, setUserRole, removeUserRole, removeActiveOrg } from './lib/auth';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { ConfigAssistantPopupProvider } from './hooks/useConfigAssistantPopup';
import ConfigAssistantPopup from './components/config-assistant/ConfigAssistantPopup';
import { buildOperateRedirectUrl } from './lib/operateRedirects';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const AutomationsPage = lazy(() => import('./pages/AutomationsPage'));
const AutomationExecutionPage = lazy(() => import('./pages/AutomationExecutionPage'));
// Operate stream pages (C8)
const HomePage = lazy(() => import('./pages/operate/HomePage'));
const InboxPage = lazy(() => import('./pages/operate/InboxPage'));
const OperateActivityPage = lazy(() => import('./pages/operate/ActivityPage'));
const RunTracePage = lazy(() => import('./pages/operate/RunTracePage'));
const ExecutionDetailPage = lazy(() => import('./pages/ExecutionDetailPage'));
const ProfileSettingsPage = lazy(() => import('./pages/ProfileSettingsPage'));
const AdminAutomationsPage = lazy(() => import('./pages/AdminAutomationsPage'));
const AdminAutomationEditPage = lazy(() => import('./pages/AdminAutomationEditPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const TeamsAdminPage = lazy(() => import('./pages/TeamsAdminPage'));
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
// Build stream consolidated pages (replaces legacy AdminAgentsPage / AdminAgentEditPage / AdminSkillsPage / AdminSkillEditPage / SystemAgentsPage / GoalsPage / SkillAnalyzerPage / SkillStudioPage / ScheduledTasksPage)
const AgentsListPage = lazy(() => import('./pages/build/AgentsListPage'));
const AgentEditPage = lazy(() => import('./pages/build/AgentEditPage'));
const RecurringTasksPage = lazy(() => import('./pages/build/RecurringTasksPage'));
const ProjectEditPage = lazy(() => import('./pages/build/ProjectEditPage'));
const SubaccountBlueprintsPage = lazy(() => import('./pages/SubaccountBlueprintsPage'));
const ClientPulseSettingsPage = lazy(() => import('./pages/ClientPulseSettingsPage'));
const WorkspaceBoardPage = lazy(() => import('./pages/WorkspaceBoardPage'));

const SystemAgentEditPage = lazy(() => import('./pages/SystemAgentEditPage'));
const SystemSkillsPage = lazy(() => import('./pages/SystemSkillsPage'));
const SystemSkillEditPage = lazy(() => import('./pages/SystemSkillEditPage'));
const SystemPnlPage = lazy(() => import('./pages/SystemPnlPage'));
const SystemIncidentsPage = lazy(() => import('./pages/SystemIncidentsPage'));
const OrgSettingsPage = lazy(() => import('./pages/OrgSettingsPage'));
// Memory & Briefings Phase 2 — HITL review queue (S7)
const MemoryReviewQueuePage = lazy(() => import('./pages/MemoryReviewQueuePage'));
// Memory & Briefings Phase 3 — subaccount onboarding flow (S5)
const SubaccountOnboardingPage = lazy(() => import('./pages/SubaccountOnboardingPage'));
// Memory & Briefings Phase 3 — configuration document upload (S21)
const ConfigDocumentUploadPage = lazy(() => import('./pages/ConfigDocumentUploadPage'));
// Memory & Briefings Phase 5 — memory block detail + version history (S24)
const MemoryBlockDetailPage = lazy(() => import('./pages/MemoryBlockDetailPage'));
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
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'));
const OrgChartPage = lazy(() => import('./pages/OrgChartPage'));
const UsagePage = lazy(() => import('./pages/UsagePage'));
const PageProjectsPage = lazy(() => import('./pages/PageProjectsPage'));
const PageProjectDetailPage = lazy(() => import('./pages/PageProjectDetailPage'));
const JobQueueDashboardPage = lazy(() => import('./pages/JobQueueDashboardPage'));
const AgentTriggersPage = lazy(() => import('./pages/AgentTriggersPage'));
const SubaccountTagsPage = lazy(() => import('./pages/SubaccountTagsPage'));
const SubaccountSkillsPage = lazy(() => import('./pages/SubaccountSkillsPage'));

const SubaccountAgentEditPage = lazy(() => import('./pages/SubaccountAgentEditPage'));
const AgentRunHistoryPage = lazy(() => import('./pages/AgentRunHistoryPage'));
const AgentRunLivePage = lazy(() => import('./pages/AgentRunLivePage'));
// Workflows V1 Phase 2 — open task view (Chunk 11)
const OpenTaskView = lazy(() => import('./pages/OpenTaskView'));
// Workflows V1 Phase 2 — Workflow Studio (Chunk 14a)
const StudioPage = lazy(() => import('./pages/StudioPage'));
// Learned Rules library (Phase 5)
const LearnedRulesPage = lazy(() => import('./pages/LearnedRulesPage'));
const AdminHealthFindingsPage = lazy(() => import('./pages/AdminHealthFindingsPage'));
const AdminActionLogPage = lazy(() => import('./pages/AdminActionLogPage'));

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

// Agentic Commerce — Chunk 14 spend UI
// Govern surface (consolidation-govern)
const KnowledgePage = lazy(() => import('./pages/govern/KnowledgePage'));
const SpendingPage = lazy(() => import('./pages/govern/SpendingPage'));
const ConnectionsPage = lazy(() => import('./pages/govern/ConnectionsPage'));
// Trust & Verification Layer — Stage 2 UI (Chunk 12)
const QualityPage = lazy(() => import('./pages/govern/QualityPage'));
const ScorecardCreatePage = lazy(() => import('./pages/govern/ScorecardCreatePage'));
const ModelBenchPage = lazy(() => import('./pages/govern/ModelBenchPage'));
const SubaccountApprovalChannelsPage = lazy(() => import('./pages/SubaccountApprovalChannelsPage'));
const OrgApprovalChannelsPage = lazy(() => import('./pages/OrgApprovalChannelsPage'));
// Phase 1 Showcase — Support Agent operate surfaces
const SupportAgentDashboard = lazy(() => import('./pages/operate/SupportAgentDashboard').then(m => ({ default: m.SupportAgentDashboard })));
const SupportEvalsPage = lazy(() => import('./pages/operate/SupportEvalsPage').then(m => ({ default: m.SupportEvalsPage })));
// Support Desk canonical substrate (C13)
const TicketsListPage = lazy(() => import('./pages/support/TicketsListPage'));
const TicketDetailPage = lazy(() => import('./pages/support/TicketDetailPage'));
const DraftReviewQueue = lazy(() => import('./pages/support/DraftReviewQueue'));
const InboxConfigPage = lazy(() => import('./pages/support/InboxConfigPage'));
const SupportDeskSetupPage = lazy(() => import('./pages/integrations/SupportDeskSetupPage'));
// Personal Assistant V1 — EA first-run wizard + PA page (Chunk 19c)
const EAFirstRunWizard = lazy(() => import('./pages/personal/EAFirstRunWizard'));
const PersonalAssistantPage = lazy(() => import('./pages/personal/PersonalAssistantPage'));

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
  if (user.role !== 'org_admin' && user.role !== 'system_admin') return <Navigate to="/" replace />;
  return <ErrorBoundary><Outlet /></ErrorBoundary>;
}

function SystemAdminGuard({ user }: { user: User | null }) {
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'system_admin') return <Navigate to="/" replace />;
  return <ErrorBoundary><Outlet /></ErrorBoundary>;
}

// Module-driven guard for routes whose visibility is governed by the org's sidebar
// config (e.g. /clientpulse/*, /reports/*). System admins bypass. Mirrors the
// fail-open default used by Layout's `hasSidebarItem`: a missing or empty
// config is treated as "all items enabled" so a config-endpoint outage does
// not lock users out of features they are entitled to. The authoritative gate
// remains the corresponding API endpoint.
function ModuleGuard({ user, slug }: { user: User | null; slug: string }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) { setAllowed(false); return; }
    if (user.role === 'system_admin') { setAllowed(true); return; }
    let cancelled = false;
    api.get<{ items?: string[] }>('/api/my-sidebar-config')
      .then(({ data }) => {
        if (cancelled) return;
        const items = data?.items;
        if (!Array.isArray(items) || items.length === 0) {
          setAllowed(true);
        } else {
          setAllowed(items.includes(slug));
        }
      })
      .catch(() => { if (!cancelled) setAllowed(true); });
    return () => { cancelled = true; };
  }, [user, slug]);

  if (!user) return <Navigate to="/login" replace />;
  if (allowed === null) return <PageLoader />;
  if (!allowed) return <Navigate to="/" replace />;
  return <ErrorBoundary><Outlet /></ErrorBoundary>;
}

function SubaccountIntegrationsRoute() {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  return <Navigate to={`/connections?tab=app-integrations&workspace=${subaccountId}`} replace />;
}

function BriefRedirect() {
  const { taskId } = useParams<{ taskId: string }>();
  if (!taskId) return <Navigate to="/admin/tasks" replace />;
  return <Navigate to={`/admin/tasks/${taskId}`} replace />;
}

function RedirectAgentEdit() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/agents/${id}/edit`} replace />;
}

// ── Operate-stream redirects (C8) ────────────────────────────────────────────
// Locked redirect grammar — see client/src/lib/operateRedirects.ts

/** /admin/runs/:runId?<query> → /run-trace/:runId?<query> */
function AdminRunRedirect() {
  const { runId } = useParams<{ runId: string }>();
  const { search, hash } = useLocation();
  if (!runId) return <Navigate to="/" replace />;
  const to = buildOperateRedirectUrl(`/run-trace/${encodeURIComponent(runId)}`, search, undefined, hash);
  return <Navigate to={to} replace />;
}

/** /admin/subaccounts/:subaccountId/runs/:runId?<query>
 *  → /run-trace/:runId?subaccountId=:subaccountId&<query> */
function AdminSubaccountRunRedirect() {
  const { subaccountId, runId } = useParams<{ subaccountId: string; runId: string }>();
  const { search, hash } = useLocation();
  if (!runId || !subaccountId) return <Navigate to="/" replace />;
  const to = buildOperateRedirectUrl(
    `/run-trace/${encodeURIComponent(runId)}`,
    search,
    { key: 'subaccountId', value: subaccountId },
    hash,
  );
  return <Navigate to={to} replace />;
}

/** /admin/agent-inbox?<query> → /inbox?<query> */
function AdminAgentInboxRedirect() {
  const { search, hash } = useLocation();
  const to = buildOperateRedirectUrl('/inbox', search, undefined, hash);
  return <Navigate to={to} replace />;
}

/** /subaccounts/:subaccountId/agent-inbox?<query>
 *  → /inbox?subaccountId=:subaccountId&<query> */
function SubaccountAgentInboxRedirect() {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const { search, hash } = useLocation();
  if (!subaccountId) return <Navigate to="/inbox" replace />;
  const to = buildOperateRedirectUrl(
    '/inbox',
    search,
    { key: 'subaccountId', value: subaccountId },
    hash,
  );
  return <Navigate to={to} replace />;
}

/** /admin/subaccounts/:subaccountId/activity?<query>
 *  → /activity?subaccountId=:subaccountId&<query>
 *
 *  Preserves the workspace scope as a query param so a downstream consumer
 *  (ActivityPage URL-param wiring — deferred to Phase 3) can pick it up.
 *  Even before the page wires it, preserving the param keeps the URL lossless
 *  for bookmarks/copy-paste sharing.
 */
function AdminSubaccountActivityRedirect() {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const { search, hash } = useLocation();
  if (!subaccountId) return <Navigate to="/activity" replace />;
  const to = buildOperateRedirectUrl(
    '/activity',
    search,
    { key: 'subaccountId', value: subaccountId },
    hash,
  );
  return <Navigate to={to} replace />;
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
          <ErrorBoundary><Suspense fallback={<PageLoader />}>
            {user ? <Navigate to="/" replace /> : <LoginPage />}
          </Suspense></ErrorBoundary>
        } />
        <Route path="/signup" element={
          <ErrorBoundary><Suspense fallback={<PageLoader />}>
            {user ? <Navigate to="/onboarding" replace /> : <SignupPage />}
          </Suspense></ErrorBoundary>
        } />
        <Route path="/onboarding" element={
          <ErrorBoundary><Suspense fallback={<PageLoader />}>
            {!user ? <Navigate to="/login" replace /> : <OnboardingWizardPage />}
          </Suspense></ErrorBoundary>
        } />
        <Route path="/onboarding/connect-ghl" element={
          <ErrorBoundary><Suspense fallback={<PageLoader />}>
            {!user ? <Navigate to="/login" replace /> : <GhlOAuthInterstitialPage />}
          </Suspense></ErrorBoundary>
        } />
        <Route path="/onboarding/ready" element={
          <ErrorBoundary><Suspense fallback={<PageLoader />}>
            {!user ? <Navigate to="/login" replace /> : <OnboardingCelebrationPage />}
          </Suspense></ErrorBoundary>
        } />
        <Route path="/invite/accept" element={
          <ErrorBoundary><Suspense fallback={<PageLoader />}>
            <AcceptInvitePage />
          </Suspense></ErrorBoundary>
        } />
        <Route path="/forgot-password" element={
          <ErrorBoundary><Suspense fallback={<PageLoader />}>
            <ForgotPasswordPage />
          </Suspense></ErrorBoundary>
        } />
        <Route path="/reset-password" element={
          <ErrorBoundary><Suspense fallback={<PageLoader />}>
            <ResetPasswordPage />
          </Suspense></ErrorBoundary>
        } />

        <Route element={<ProtectedLayout user={user} loading={loading} />}>
          <Route path="/" element={<HomePage user={user!} />} />
          <Route path="/automations" element={<AutomationsPage user={user!} />} />
          <Route path="/automations/:id" element={<AutomationExecutionPage user={user!} />} />
          <Route path="/executions/:id" element={<ExecutionDetailPage user={user!} />} />
          <Route path="/settings" element={<ProfileSettingsPage user={user!} />} />
          <Route path="/inbox" element={<InboxPage user={user!} />} />
          <Route path="/activity" element={<OperateActivityPage user={user!} />} />
          <Route path="/run-trace/:id" element={<RunTracePage user={user!} />} />
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
            <Route path="/admin/teams" element={<TeamsAdminPage user={user!} />} />
            <Route path="/admin/settings" element={<Navigate to="/admin/org-settings" replace />} />
            <Route path="/admin/board-config" element={<Navigate to="/admin/org-settings" replace />} />
            <Route path="/admin/categories" element={<Navigate to="/admin/org-settings" replace />} />
            <Route path="/admin/engines" element={<Navigate to="/admin/org-settings" replace />} />
            <Route path="/admin/permission-sets" element={<Navigate to="/admin/org-settings" replace />} />
            <Route path="/admin/subaccounts" element={<AdminSubaccountsPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId" element={<AdminSubaccountDetailPage user={user!} mode="admin" />} />
            {/* New consolidated agent / recurring-tasks / project routes (Build stream) */}
            <Route path="/agents" element={<AgentsListPage />} />
            <Route path="/agents/:id/edit" element={<AgentEditPage />} />
            <Route path="/recurring-tasks" element={<RecurringTasksPage />} />
            <Route path="/projects/:id/edit" element={<ProjectEditPage />} />
            {/* Legacy redirects — bookmarks and old links */}
            <Route path="/admin/agents" element={<Navigate to="/agents" replace />} />
            <Route path="/admin/agents/:id" element={<RedirectAgentEdit />} />
            <Route path="/admin/skills" element={<Navigate to="/agents" replace />} />
            <Route path="/admin/skills/:id" element={<Navigate to="/agents" replace />} />
            <Route path="/agents/blueprints" element={<SubaccountBlueprintsPage user={user!} />} />
            {/* Legacy path — kept for bookmarks; renders the renamed page. */}
            <Route path="/admin/agent-templates" element={<SubaccountBlueprintsPage user={user!} />} />
            <Route path="/clientpulse/settings" element={<ClientPulseSettingsPage user={user!} />} />
            <Route path="/admin/mcp-servers" element={<Navigate to="/connections" replace />} />
            <Route path="/admin/subaccounts/:subaccountId/agents" element={<Navigate to={`/admin/subaccounts`} replace />} />
            <Route path="/admin/subaccounts/:subaccountId/agents/:linkId/manage" element={<SubaccountAgentEditPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/agents/:agentId/mailbox" element={<AgentMailboxPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/agents/:agentId/calendar" element={<AgentCalendarPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/workspace" element={<WorkspaceBoardPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/memory"    element={<Navigate to="/knowledge" replace />} />
            <Route path="/admin/subaccounts/:subaccountId/knowledge" element={<Navigate to="/knowledge" replace />} />
            <Route path="/admin/subaccounts/:subaccountId/scheduled-tasks" element={<Navigate to="/recurring-tasks" replace />} />
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
            <Route path="/admin/subaccounts/:subaccountId/runs/:runId" element={<AdminSubaccountRunRedirect />} />
            <Route path="/admin/subaccounts/:subaccountId/usage" element={<UsagePage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/page-projects" element={<PageProjectsPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/page-projects/:projectId" element={<PageProjectDetailPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/triggers" element={<AgentTriggersPage />} />
            <Route path="/admin/subaccounts/:subaccountId/tags" element={<SubaccountTagsPage />} />
            <Route path="/admin/subaccounts/:subaccountId/skills" element={<SubaccountSkillsPage user={user!} />} />
            <Route path="/admin/subaccounts/:subaccountId/goals" element={<Navigate to="/" replace />} />
            <Route path="/admin/org-settings" element={<OrgSettingsPage user={user!} />} />
            <Route path="/admin/org-memory" element={<Navigate to="/admin/org-settings?tab=memory" replace />} />
            <Route path="/admin/org-agent-configs" element={<Navigate to="/agents?tab=org-execution" replace />} />
            <Route path="/admin/hierarchy-templates" element={<Navigate to="/agents?tab=team-templates" replace />} />
            <Route path="/admin/connectors" element={<Navigate to="/admin/mcp-servers" replace />} />
            {/* Workspace health audit findings */}
            <Route path="/admin/health-findings" element={<AdminHealthFindingsPage user={user!} />} />
            {/* Per-subaccount action audit log */}
            <Route path="/admin/subaccounts/:subaccountId/actions" element={<AdminActionLogPage user={user!} />} />
            {/* Pulse — retired; redirect to home */}
            <Route path="/admin/pulse" element={<Navigate to="/" replace />} />
            <Route path="/admin/subaccounts/:subaccountId/pulse" element={<Navigate to="/" replace />} />
            {/* Activity — org scope (redirects to canonical /activity) */}
            <Route path="/admin/activity" element={<Navigate to="/activity" replace />} />
            {/* Agent Inbox — redirects to canonical /inbox (locked redirect grammar C8) */}
            <Route path="/admin/agent-inbox" element={<AdminAgentInboxRedirect />} />
            {/* Activity — subaccount scope (redirects to canonical /activity, scope promoted per locked C8 grammar) */}
            <Route path="/admin/subaccounts/:subaccountId/activity" element={<AdminSubaccountActivityRedirect />} />
            {/* Skill Studio — org scope (consolidated into /agents) */}
            <Route path="/admin/skill-studio" element={<Navigate to="/agents" replace />} />
            {/* Configuration Assistant */}
            <Route path="/admin/config-assistant" element={<ConfigAssistantPage user={user!} />} />
            <Route path="/admin/config-history/session/:sessionId" element={<ConfigSessionHistoryPage user={user!} />} />
            {/* Universal Brief detail page (Phase 2) — redirects to canonical /admin/tasks/:taskId */}
            <Route path="/admin/briefs/:taskId" element={<BriefRedirect />} />
            {/* Workflows V1 Phase 2 — open task view (Chunk 11) */}
            <Route path="/admin/tasks/:taskId" element={<OpenTaskView user={user!} />} />
            {/* Workflows V1 Phase 2 — Workflow Studio (Chunk 14a) */}
            <Route path="/admin/workflows/:id/edit" element={<StudioPage user={user!} />} />
            <Route path="/admin/workflows/new" element={<StudioPage user={user!} />} />
            {/* Learned Rules library (Phase 5) */}
            <Route path="/rules" element={<LearnedRulesPage user={user!} />} />
            <Route path="/subaccounts/:id/rules" element={<LearnedRulesPage user={user!} />} />
            {/* Agentic Commerce — legacy approval channels */}
            <Route path="/admin/subaccounts/:subaccountId/approval-channels" element={<SubaccountApprovalChannelsPage />} />
            <Route path="/admin/org-approval-channels" element={<OrgApprovalChannelsPage user={user!} />} />
            {/* Govern surface — consolidated pages */}
            <Route path="/knowledge"    element={<KnowledgePage />} />
            <Route path="/spending"     element={<SpendingPage />} />
            <Route path="/connections"  element={<ConnectionsPage />} />
            {/* Trust & Verification Layer — Stage 2 Quality surface (Chunk 12) */}
            <Route path="/quality"                     element={<QualityPage />} />
            <Route path="/quality/scorecards/create"   element={<ScorecardCreatePage />} />
            <Route path="/quality/bench"               element={<ModelBenchPage />} />
            {/* Redirect legacy spend paths so bookmarks survive */}
            <Route path="/admin/spending-budgets"                        element={<Navigate to="/spending" replace />} />
            <Route path="/admin/spending-budgets/:budgetId"             element={<Navigate to="/spending" replace />} />
            <Route path="/admin/subaccounts/:subaccountId/spend-ledger" element={<Navigate to="/spending" replace />} />
            {/* Phase 1 Showcase — Support Agent operate surfaces */}
            <Route path="/operate/agents/support" element={<SupportAgentDashboard />} />
            <Route path="/operate/agents/support/evals" element={<SupportEvalsPage />} />
            {/* Support Desk canonical substrate (C13) */}
            <Route path="/support/tickets" element={<TicketsListPage />} />
            <Route path="/support/tickets/:id" element={<TicketDetailPage />} />
            <Route path="/support/drafts" element={<DraftReviewQueue />} />
            <Route path="/support/drafts/:id" element={<DraftReviewQueue />} />
            <Route path="/support/inboxes" element={<InboxConfigPage />} />
            <Route path="/integrations/support-desk/setup" element={<SupportDeskSetupPage />} />
          </Route>

          {/* Personal assistant (personal-assistant-v1, §14) — pages created by chunk 19c */}
          <Route path="/personal/setup" element={<EAFirstRunWizard />} />
          <Route path="/personal/:agentId" element={<PersonalAssistantPage />} />
          <Route path="/personal/:agentId/setup" element={<PersonalAssistantPage />} />

          {/* ClientPulse routes — gated by module subscription. Sidebar suppresses
              the nav items via hasSidebarItem('clientpulse'); ModuleGuard mirrors
              that gate at the route level to prevent direct-URL access. */}
          <Route element={<ModuleGuard user={user} slug="clientpulse" />}>
            <Route path="/clientpulse" element={<ClientPulseDashboardPage user={user!} />} />
            <Route path="/clientpulse/clients" element={<ClientPulseClientsListPage user={user!} />} />
            <Route path="/clientpulse/clients/:subaccountId" element={<ClientPulseDrilldownPage user={user!} />} />
          </Route>
          <Route element={<ModuleGuard user={user} slug="reports" />}>
            <Route path="/reports" element={<ReportsListPage user={user!} />} />
            <Route path="/reports/:id" element={<ReportDetailPage user={user!} />} />
          </Route>

          <Route element={<SystemAdminGuard user={user} />}>
            <Route path="/system/organisations" element={<SystemOrganisationsPage user={user!} />} />
            <Route path="/system/modules" element={<SystemModulesPage user={user!} />} />
            <Route path="/system/settings" element={<SystemSettingsPage user={user!} />} />
            <Route path="/system/task-queue" element={<SystemTaskQueuePage user={user!} />} />
            <Route path="/system/job-queues" element={<JobQueueDashboardPage />} />
            <Route path="/system/agents" element={<Navigate to="/agents" replace />} />
            <Route path="/system/agents/:id" element={<SystemAgentEditPage user={user!} />} />
            <Route path="/system/skills" element={<SystemSkillsPage user={user!} />} />
            <Route path="/system/llm-pnl" element={<SystemPnlPage />} />
            <Route path="/system/incidents" element={<SystemIncidentsPage />} />
            <Route path="/system/skill-analyser" element={<Navigate to="/agents" replace />} />
            <Route path="/system/workflow-studio" element={<WorkflowStudioPage user={user!} />} />
            <Route path="/system/skills/:id" element={<SystemSkillEditPage user={user!} />} />
            <Route path="/system/automations" element={<SystemAutomationsPage user={user!} />} />
            <Route path="/system/engines" element={<SystemEnginesPage user={user!} />} />
            {/* Activity — system scope (redirects to canonical /activity) */}
            <Route path="/system/activity" element={<Navigate to="/activity" replace />} />
            {/* Skill Studio — system scope (consolidated into /agents) */}
            <Route path="/system/skill-studio" element={<Navigate to="/agents" replace />} />
          </Route>

          {/* Subaccount connections */}
          <Route path="/admin/subaccounts/:subaccountId/connections" element={<SubaccountIntegrationsRoute />} />
          <Route path="/portal/:subaccountId/connections" element={<SubaccountIntegrationsRoute />} />

          {/* Subaccount team */}
          <Route path="/admin/subaccounts/:subaccountId/team" element={<SubaccountTeamPage user={user!} />} />

          {/* Review queue (portal access) */}
          <Route path="/portal/:subaccountId/review-queue" element={<ReviewQueuePage user={user!} />} />

          {/* Run trace — org-level redirect to canonical /run-trace/:runId */}
          <Route path="/admin/runs/:runId" element={<AdminRunRedirect />} />

          {/* Agent Inbox (subaccount-scoped) — redirects to canonical /inbox (locked redirect grammar C8) */}
          <Route path="/subaccounts/:subaccountId/agent-inbox" element={<SubaccountAgentInboxRedirect />} />

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

          {/* AI Agents — /agents is the canonical AgentsListPage (registered above in the protected layout) */}
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
