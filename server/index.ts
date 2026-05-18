import 'dotenv/config';
import './instrumentation.js';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './lib/env.js';
import { initWebSocket } from './websocket/index.js';
import * as llmInflightRegistry from './services/llmInflightRegistry.js';
import { seedPermissions, backfillOrgUserRoles } from './services/permissionSeedService.js';
import { agentService } from './services/agentService.js';
import { boardService } from './services/boardService.js';
import { skillService } from './services/skillService.js';
import { systemSkillService } from './services/systemSkillService.js';
import { agentScheduleService } from './services/agentScheduleService.js';
import { routerJobService } from './services/routerJobService.js';
import { queueService } from './services/queueService.js';
import { initializePageIntegrationWorker } from './services/pageIntegrationWorker.js';
import { initializePaymentReconciliationJob } from './services/paymentReconciliationJob.js';
import { registerRateLimitCleanupJob } from './lib/rateLimitCleanupJob.js';
import { registerOauthStateCleanupJob } from './lib/oauthStateCleanupJob.js';
import { client as dbClient } from './db/index.js';
import { getIO } from './websocket/index.js';
import { getPgBoss, stopPgBoss } from './lib/pgBossInstance.js';
import { startDlqMonitor } from './services/dlqMonitorService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Routes
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import organisationsRouter from './routes/organisations.js';
import usersRouter from './routes/users.js';
import enginesRouter from './routes/engines.js';
import categoriesRouter from './routes/categories.js';
import automationsRouter from './routes/automations.js';
import executionsRouter from './routes/executions.js';
import filesRouter from './routes/files.js';
import systemUsersRouter from './routes/systemUsers.js';
import systemSettingsRouter from './routes/systemSettings.js';
import systemExecutionsRouter from './routes/systemExecutions.js';
import webhooksRouter from './routes/webhooks.js';
import subaccountsRouter from './routes/subaccounts.js';
import permissionSetsRouter from './routes/permissionSets.js';
import portalRouter from './routes/portal.js';
import agentsRouter from './routes/agents.js';
import agentPromptRevisionsRouter from './routes/agentPromptRevisions.js';
import boardTemplatesRouter from './routes/boardTemplates.js';
import boardConfigRouter from './routes/boardConfig.js';
import tasksRouter from './routes/tasks.js';
import subaccountAgentsRouter from './routes/subaccountAgents.js';
import scheduleCalendarRouter from './routes/scheduleCalendar.js';
import agentTestFixturesRouter from './routes/agentTestFixtures.js';
// agentTemplates deprecated — replaced by systemAgents
import systemAgentsRouter from './routes/systemAgents.js';
import systemSkillsRouter from './routes/systemSkills.js';
import skillsRouter from './routes/skills.js';
import agentRunsRouter from './routes/agentRuns.js';
import agentOverviewRouter from './routes/agentOverview.js';
import memoryBlocksRouter from './routes/memoryBlocks.js';
import workspaceMemoryRouter from './routes/workspaceMemory.js';
import knowledgeRouter from './routes/knowledge.js';
import agentTriggersRouter from './routes/agentTriggers.js';
import scheduledTasksRouter from './routes/scheduledTasks.js';
import reviewItemsRouter from './routes/reviewItems.js';
import actionsRouter from './routes/actions.js';
import systemAutomationsRouter from './routes/systemAutomations.js';
import systemEnginesRouter from './routes/systemEngines.js';
import integrationConnectionsRouter from './routes/integrationConnections.js';
import credentialsRouter from './routes/credentials.js';
import orgConnectionsRouter from './routes/orgConnections.js';
import webLoginConnectionsRouter from './routes/webLoginConnections.js';
import operatorSessionConnectionsRouter from './routes/operatorSessionConnections.js';
import workflowTemplatesRouter from './routes/workflowTemplates.js';
import workflowRunsRouter from './routes/workflowRuns.js';
import workflowStudioRouter from './routes/workflowStudio.js';
import workflowGatesRouter from './routes/workflowGates.js';
import subaccountOnboardingRouter from './routes/subaccountOnboarding.js';
import automationConnectionMappingsRouter from './routes/automationConnectionMappings.js';
// Brain Tree OS adoption P4 — workspace health audit
import workspaceHealthRouter from './routes/workspaceHealth.js';
import subaccountEnginesRouter from './routes/subaccountEngines.js';
import projectsRouter from './routes/projects.js';
import llmUsageRouter from './routes/llmUsage.js';
import systemPnlRouter from './routes/systemPnl.js';
import agentExecutionLogRouter from './routes/agentExecutionLog.js';
import hierarchyTemplatesRouter from './routes/hierarchyTemplates.js';
import systemTemplatesRouter from './routes/systemTemplates.js';
import oauthIntegrationsRouter from './routes/oauthIntegrations.js';
import googleDriveRouter from './routes/integrations/googleDrive.js';
import githubAppRouter from './routes/githubApp.js';
import githubWebhookRouter from './routes/githubWebhook.js';
import mcpRouter from './routes/mcp.js';
import agentInboxRouter from './routes/agentInbox.js';
// Personal Assistant V1 — EA drafts CRUD + approval/reject/retry (Chunk 6)
import eaDraftsRouter from './routes/eaDrafts.js';
// Personal Assistant V1 — Voice profile CRUD + opt-out + reactivate (Chunk 13)
import voiceProfilesRouter from './routes/voiceProfiles.js';
// Personal Assistant V1 — Home-widget data endpoint (Chunk 14)
import agentHomeWidgetsRouter from './routes/agentHomeWidgets.js';
import orgAgentConfigsRouter from './routes/orgAgentConfigs.js';
import connectorConfigsRouter from './routes/connectorConfigs.js';
import ghlWebhookRouter from './routes/webhooks/ghlWebhook.js';
import teamworkWebhookRouter from './routes/webhooks/teamworkWebhook.js';
import slackWebhookRouter from './routes/webhooks/slackWebhook.js';
import subaccountTagsRouter from './routes/subaccountTags.js';
import subaccountSkillsRouter from './routes/subaccountSkills.js';
// Closed-Loop Skill Improvement — amendment lifecycle + freeze routes (Chunk 5)
import skillAmendmentsRouter from './routes/skillAmendments.js';
import skillAmendmentFreezesRouter from './routes/skillAmendmentFreezes.js';
import orgMemoryRouter from './routes/orgMemory.js';
// orgWorkspaceRouter removed — org tasks now live in the org subaccount's task board (migration 0106)
import mcpServersRouter from './routes/mcpServers.js';
import goalsRouter from './routes/goals.js';
import webhookAdapterRouter from './routes/webhookAdapter.js';
import inboxRouter from './routes/inbox.js';
import feedbackRouter from './routes/feedback.js';
import jobQueueRouter from './routes/jobQueue.js';
import attachmentsRouter from './routes/attachments.js';
import pageProjectsRouter from './routes/pageProjects.js';
import pageRoutesRouter from './routes/pageRoutes.js';
import publicPageServingRouter from './routes/public/pageServing.js';
import publicPagePreviewRouter from './routes/public/pagePreview.js';
import ieeRouter from './routes/iee.js';
// Operator Backend — progress polling, settings, task actions (Chunk 7)
import operatorSessionsRouter from './routes/operatorSessions.js';
import subaccountOperatorSettingsRouter from './routes/subaccountOperatorSettings.js';
import subaccountIeeBrowserSettingsRouter from './routes/subaccountIeeBrowserSettings.js';
import adminIeeBrowserRolloutRouter from './routes/adminIeeBrowserRollout.js';
import operatorTasksRouter from './routes/operatorTasks.js';
import skillAnalyzerRouter from './routes/skillAnalyzer.js';
import activityRouter from './routes/activity.js';
import skillStudioRouter from './routes/skillStudio.js';
import publicFormSubmissionRouter from './routes/public/formSubmission.js';
import publicPageTrackingRouter from './routes/public/pageTracking.js';
// ClientPulse module routes
// Side-effect import — registers ClientPulse's sensitive operational_config
// dot-paths with the module-composable registry before any route registers.
// Per spec §3.6 / §4.10(3): top of the route-wiring section.
import './modules/clientpulse/registerSensitivePaths.js';
import modulesRouter from './routes/modules.js';
import onboardingRouter from './routes/onboarding.js';
import configHistoryRouter from './routes/configHistory.js';
import clientpulseReportsRouter from './routes/clientpulseReports.js';
import clientpulseMergeFieldsRouter from './routes/clientpulseMergeFields.js';
import clientpulseInterventionsRouter from './routes/clientpulseInterventions.js';
import clientpulseDrilldownRouter from './routes/clientpulseDrilldown.js';
import organisationConfigRouter from './routes/organisationConfig.js';
import ghlRouter from './routes/ghl.js';
import geoAuditsRouter from './routes/geoAudits.js';
import crmQueryPlannerRouter from './routes/crmQueryPlanner.js';
import { subdomainResolution } from './middleware/subdomainResolution.js';
import { postCommitEmitterMiddleware } from './middleware/postCommitEmitter.js';
// Memory & Briefings Phase 1 — delivery channels route (S22)
import deliveryChannelsRouter from './routes/deliveryChannels.js';
// Memory & Briefings Phase 2 — clarifications route (S8)
import clarificationsRouter from './routes/clarifications.js';
// Memory & Briefings Phase 2 — HITL review queue route (S7)
import memoryReviewQueueRouter from './routes/memoryReviewQueue.js';
// Memory & Briefings Phase 3 — subaccount onboarding flow route (S5)
import subaccountOnboardingFlowRouter from './routes/subaccountOnboardingFlow.js';
// Memory & Briefings Phase 3 — config documents route (S21)
import configDocumentsRouter from './routes/configDocuments.js';
// Memory & Briefings Phase 4 — portal config + drop zone + inspector + rollup
import subaccountPortalConfigRouter from './routes/subaccountPortalConfig.js';
import dropZoneRouter from './routes/dropZone.js';
import memoryInspectorRouter from './routes/memoryInspector.js';
import portfolioRollupRouter from './routes/portfolioRollup.js';
// Memory & Briefings Phase 5 — memory block version history + diff + reset (S24)
import memoryBlockVersionsRouter from './routes/memoryBlockVersions.js';
// Memory improvements spec §4 Phase 1 — block sources / lineage route
import memoryBlockSourcesRouter from './routes/memoryBlockSources.js';
// Memory improvements spec §4 Phase 2/4 — memory utility dashboard route
import memoryUtilityRouter from './routes/memoryUtility.js';
import pulseRouter from './routes/pulse.js';
// Universal Brief routes (Phase 2 + Phase 5)
import taskIntakeRouter from './routes/taskIntake.js';
import sessionMessageRouter from './routes/sessionMessage.js';
import taskConversationsRouter from './routes/conversations.js';
import rulesRouter from './routes/rules.js';
import { delegationOutcomesRouter } from './routes/delegationOutcomes.js';
import referenceDocumentsRouter from './routes/referenceDocuments.js';
import documentBundlesRouter from './routes/documentBundles.js';
import externalDocumentReferencesRouter from './routes/externalDocumentReferences.js';
import systemIncidentsRouter from './routes/systemIncidents.js';
import { recordIncident } from './services/incidentIngestor.js';
import { registerSystemIncidentNotifyWorker } from './services/systemIncidentNotifyJob.js';
// Workspace identity routes (agents-as-employees)
import workspaceRouter from './routes/workspace.js';
import workspaceMailRouter from './routes/workspaceMail.js';
import workspaceCalendarRouter from './routes/workspaceCalendar.js';
import workspaceInboundWebhookRouter from './routes/workspaceInboundWebhook.js';
import stripeAgentWebhookRouter from './routes/webhooks/stripeAgentWebhook.js';
// Suggested action chip dispatch
import suggestedActionsRouter from './routes/suggestedActions.js';
// Thread Context — per-conversation living doc (Chunk A)
import conversationThreadContextRouter from './routes/conversationThreadContext.js';
// Sub-Account Optimiser — generic agent-output primitive (Chunk 1, migration 0267)
import agentRecommendationsRouter from './routes/agentRecommendations.js';
// Agentic Commerce — spend ledger, budgets, policies, approval channels (Chunks 12, 13)
import spendingBudgetsRouter from './routes/spendingBudgets.js';
import spendingPoliciesRouter from './routes/spendingPolicies.js';
import agentChargesRouter from './routes/agentCharges.js';
import approvalChannelsRouter from './routes/approvalChannels.js';
// Workflows V1 Phase 2 — task event stream replay (Chunk 9)
import taskEventStreamRouter from './routes/taskEventStream.js';
// Workflows V1 Phase 2 — assignable-users API + Teams CRUD (Chunk 10)
import assignableUsersRouter from './routes/assignableUsers.js';
import teamsRouter from './routes/teams.js';
// Workflows V1 Phase 2 — Ask form submit / skip / autofill (Chunk 12)
import asksRouter from './routes/asks.js';
// Workflows V1 Phase 2 — File viewer, diff, per-hunk revert (Chunk 13)
import fileRevertRouter from './routes/fileRevert.js';
// Workflows V1 Phase 2 — workflow drafts fetch + discard (Chunk 14b)
import workflowDraftsRouter from './routes/workflowDrafts.js';
// Pre-Launch Phase 2 — client-side error reporting
import clientErrorsRouter from './routes/clientErrors.js';
// F3 Baseline Capture — baseline status, manual entry, admin reset (Chunks 4A/4B)
import baselinesRouter from './routes/baselines.js';
// Consolidation Build C3 — recurring tasks aggregator
import recurringTasksRouter from './routes/recurringTasks.js';
// Trust & Verification Layer Stage 2 — scorecards + agent attach/detach + bench
import scorecardsRouter from './routes/scorecards.js';
import agentScorecardsRouter from './routes/agentScorecards.js';
import benchRunsRouter from './routes/benchRuns.js';
import governQualityRouter from './routes/governQuality.js';
// Trust & Verification Layer Stage 3 — operator corrections
import correctionsRouter from './routes/corrections.js';
// Agent Workspace — presence SSE stream (Chunk 9)
import agentPresenceStreamRouter from './routes/agentPresenceStream.js';
// Phase 1 Showcase — run artifact read surface (Chunk 2)
import runArtifactsRouter from './routes/runArtifacts.js';
import runArtifactsFinalizeRouter from './routes/internal/runArtifactsFinalize.js';
// Support Desk canonical substrate (C13)
import supportRouter from './routes/support/index.js';
// Personal Assistant V1 — EA first-run wizard provisioning (Chunk 19c)
import personalSetupRouter from './routes/personalSetup.js';
// Deterministic validators — staff-only validator registry endpoint (Chunk 6)
import validatorsRouter from './routes/validators.js';

// ── Process-level exception handlers ─────────────────────────────────────────
// Catch unhandled errors so the process doesn't die silently without logging.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[WARN] Unhandled promise rejection:', reason);
  // Do not call process.exit here — some libraries (pg-boss, Socket.IO) emit
  // non-fatal unhandled rejections (e.g. heartbeat on a closed connection).
  // In production, the process manager (PM2 / Docker restart policy) handles
  // truly fatal states.  Logging is sufficient for diagnosis.
});

const app = express();
const httpServer = createServer(app);

// Security middleware
const isProduction = env.NODE_ENV === 'production';

// Trust the first upstream proxy (load balancer / Nginx) in production so
// that req.ip reflects the real client IP, not the proxy IP. Without this,
// rate-limiter keys based on req.ip are the same for all users behind the LB.
if (isProduction) {
  app.set('trust proxy', 1);
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: false,
  contentSecurityPolicy: isProduction
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: [
            "'self'",
            // WebSocket — restrict to same origin only
            `wss://${env.APP_BASE_URL.replace(/^https?:\/\//, '')}`,
            // External APIs used by the server (not browser) — listed for completeness
            // LLM providers are called server-side only so don't need CSP.
            // OAuth providers redirect the browser, so their domains must be allowed:
            'https://accounts.google.com',
            'https://github.com',
            'https://app.hubspot.com',
            'https://slack.com',
            'https://marketplace.leadconnectorhq.com',
            // Langfuse observability (if browser SDK used)
            'https://cloud.langfuse.com',
          ],
        },
      }
    : false,
}));

if (isProduction && env.CORS_ORIGINS === '*') {
  console.error('[SERVER] FATAL: CORS_ORIGINS=* is not allowed in production. Set explicit origins.');
  process.exit(1);
}

const corsOrigin = (() => {
  if (!isProduction) return '*';
  return env.CORS_ORIGINS.split(',').map(o => o.trim());
})();

app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));

// Webhook routes that need raw body must be mounted BEFORE json body parsing
app.use(ghlWebhookRouter);
app.use(teamworkWebhookRouter);
app.use(slackWebhookRouter);
app.use(workspaceInboundWebhookRouter);

// Path-scoped tight JSON parser for /api/client-errors — applied BEFORE the
// global 10MB parser so oversized payloads return 413 here instead of being
// accepted. express.json() checks req._body and skips re-parsing once a body
// has already been populated, so the global parser below is a no-op for this
// path. ChatGPT-Round-1 Finding 3.
app.use('/api/client-errors', express.json({ limit: '16kb' }));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Correlation ID — attaches unique ID to every request for tracing
import { correlationMiddleware } from './middleware/correlation.js';
app.use(correlationMiddleware);

// Subdomain resolution — must run before page serving routes
app.use(subdomainResolution);

// Post-commit websocket emit store — MUST be mounted AFTER org-tx middleware
// (auth/org-tx is per-route; ALS binding is inherited by all async children
// so enqueues inside withOrgTx flush after tx commits, not before).
app.use(postCommitEmitterMiddleware);

// Routes
app.use(healthRouter);
app.use(authRouter);
app.use(organisationsRouter);
app.use(usersRouter);
app.use(enginesRouter);
app.use(categoriesRouter);
app.use(automationsRouter);
app.use(executionsRouter);
app.use(filesRouter);
app.use(systemUsersRouter);
app.use(systemSettingsRouter);
app.use(systemExecutionsRouter);
app.use(webhooksRouter);
app.use(subaccountsRouter);
app.use(permissionSetsRouter);
app.use(portalRouter);
app.use(agentsRouter);
app.use(agentPromptRevisionsRouter);
app.use(boardTemplatesRouter);
app.use(boardConfigRouter);
app.use(tasksRouter);
app.use(subaccountAgentsRouter);
app.use(scheduleCalendarRouter);
app.use(agentTestFixturesRouter);
// agentTemplatesRouter removed — replaced by systemAgentsRouter
app.use(systemAgentsRouter);
app.use(systemSkillsRouter);
app.use(skillsRouter);
app.use(agentRunsRouter);
app.use(agentOverviewRouter);
app.use(memoryBlocksRouter);
app.use(workspaceMemoryRouter);
app.use(deliveryChannelsRouter);
app.use(clarificationsRouter);
app.use(memoryReviewQueueRouter);
app.use(subaccountOnboardingFlowRouter);
app.use(configDocumentsRouter);
app.use(subaccountPortalConfigRouter);
app.use(dropZoneRouter);
app.use(memoryInspectorRouter);
app.use(portfolioRollupRouter);
app.use(memoryBlockVersionsRouter);
app.use(memoryBlockSourcesRouter);
app.use(memoryUtilityRouter);
app.use(knowledgeRouter);
app.use(agentTriggersRouter);
app.use(scheduledTasksRouter);
app.use(reviewItemsRouter);
app.use(actionsRouter);
app.use(systemAutomationsRouter);
app.use(systemEnginesRouter);
app.use(integrationConnectionsRouter);
app.use(credentialsRouter);
app.use(orgConnectionsRouter);
app.use(webLoginConnectionsRouter);
// operator-session-identity chunk 5 — AI Subscription management routes
app.use(operatorSessionConnectionsRouter);
app.use(workflowTemplatesRouter);
app.use(workflowRunsRouter);
app.use(workflowStudioRouter);
app.use(workflowGatesRouter);
app.use(subaccountOnboardingRouter);
app.use(automationConnectionMappingsRouter);
app.use(workspaceHealthRouter);
app.use(subaccountEnginesRouter);
app.use(projectsRouter);
app.use(llmUsageRouter);
app.use(systemPnlRouter);
app.use(agentExecutionLogRouter);
app.use(hierarchyTemplatesRouter);
app.use(systemTemplatesRouter);
app.use(oauthIntegrationsRouter);
app.use(googleDriveRouter);
app.use(githubAppRouter);
app.use(githubWebhookRouter);
app.use(mcpRouter);
app.use(agentInboxRouter);
app.use(eaDraftsRouter);
app.use(voiceProfilesRouter);
app.use(agentHomeWidgetsRouter);
app.use(orgAgentConfigsRouter);
app.use(connectorConfigsRouter);
// ghl/teamwork/slack/stripe-agent webhook routers mounted before body parsing (need raw body for HMAC)
app.use(stripeAgentWebhookRouter);
app.use(subaccountTagsRouter);
app.use(subaccountSkillsRouter);
// Closed-Loop Skill Improvement — amendment lifecycle + freeze routes (Chunk 5)
app.use(skillAmendmentsRouter);
app.use(skillAmendmentFreezesRouter);
app.use(orgMemoryRouter);
// orgWorkspaceRouter mount removed (migration 0106)
app.use(mcpServersRouter);
app.use(goalsRouter);
app.use(webhookAdapterRouter);
app.use(inboxRouter);
app.use(feedbackRouter);
app.use(jobQueueRouter);
app.use(attachmentsRouter);
app.use(pageProjectsRouter);
app.use(pageRoutesRouter);
app.use(publicFormSubmissionRouter);
app.use(publicPageTrackingRouter);
app.use(publicPagePreviewRouter);
app.use(ieeRouter);
// Operator Backend — progress polling, settings, task actions (Chunk 7)
app.use(operatorSessionsRouter);
app.use(subaccountOperatorSettingsRouter);
app.use(subaccountIeeBrowserSettingsRouter);
app.use(adminIeeBrowserRolloutRouter);
app.use(operatorTasksRouter);
app.use(skillAnalyzerRouter);
app.use(activityRouter);
app.use(pulseRouter);
app.use(skillStudioRouter);
// ClientPulse module routes
app.use(modulesRouter);
app.use(onboardingRouter);
app.use(configHistoryRouter);
app.use(clientpulseReportsRouter);
app.use(clientpulseMergeFieldsRouter);
app.use(clientpulseInterventionsRouter);
app.use(clientpulseDrilldownRouter);
app.use(organisationConfigRouter);
app.use(ghlRouter);
app.use(geoAuditsRouter);
// Universal Brief routes (Phase 2 + Phase 5)
app.use(taskIntakeRouter);
app.use(sessionMessageRouter);
app.use(taskConversationsRouter);
app.use('/api/rules', rulesRouter);
app.use(crmQueryPlannerRouter);
app.use(delegationOutcomesRouter);
app.use(referenceDocumentsRouter);
app.use(documentBundlesRouter);
app.use(externalDocumentReferencesRouter);
app.use(systemIncidentsRouter);
app.use(workspaceRouter);
app.use(workspaceMailRouter);
app.use(workspaceCalendarRouter);
app.use(suggestedActionsRouter);
app.use(conversationThreadContextRouter);
// Sub-Account Optimiser — generic agent-output primitive (Chunk 1)
app.use(agentRecommendationsRouter);
// Agentic Commerce — spend ledger + budgets + policies + approval channels
app.use(spendingBudgetsRouter);
app.use(spendingPoliciesRouter);
app.use(agentChargesRouter);
app.use(approvalChannelsRouter);
// Workflows V1 Phase 2 — task event stream replay (Chunk 9)
app.use(taskEventStreamRouter);
// Workflows V1 Phase 2 — assignable-users API + Teams CRUD (Chunk 10)
app.use(assignableUsersRouter);
app.use(teamsRouter);
// Workflows V1 Phase 2 — Ask form submit / skip / autofill (Chunk 12)
app.use(asksRouter);
app.use(fileRevertRouter);
app.use(workflowDraftsRouter);
app.use(clientErrorsRouter);
app.use(baselinesRouter);
// Consolidation Build C3 — recurring tasks aggregator
app.use(recurringTasksRouter);
// Trust & Verification Layer Stage 2 — scorecards + agent attach/detach + bench
app.use(scorecardsRouter);
app.use(agentScorecardsRouter);
app.use(benchRunsRouter);
app.use(governQualityRouter);
app.use(correctionsRouter);
// Agent Workspace — presence SSE stream (Chunk 9)
app.use(agentPresenceStreamRouter);
// Phase 1 Showcase — run artifact read surface (Chunk 2)
app.use(runArtifactsRouter);
// Phase 1 Showcase — internal worker-to-S3 finalize route (Chunk 1, spec §6.1.4)
app.use(runArtifactsFinalizeRouter);
// Support Desk canonical substrate (C13) — subaccount-scoped per DEC-1 (pre-test-hardening T1)
app.use('/api/subaccounts/:subaccountId/support', supportRouter);
// Personal Assistant V1 — EA first-run wizard provisioning (Chunk 19c)
app.use(personalSetupRouter);
// Deterministic validators — staff-only validator registry endpoint (Chunk 6)
app.use(validatorsRouter);
app.use(publicPageServingRouter); // Must be last — catch-all GET *

// Serve static files in production
if (env.NODE_ENV === 'production') {
  const clientDistPath = path.resolve(__dirname, '../dist/client');
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// 404 handler for API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler — standardised JSON response format
import { logger } from './lib/logger.js';
import { ZodError } from 'zod';
import { mapOperatorBackendErrorToHttp } from './services/operatorBackendErrors.js';
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  let statusCode = 500;
  let message = 'Internal server error';
  let errorCode = 'internal_error';
  let extraBody: Record<string, unknown> | null = null;

  // Operator backend typed errors — checked before generic Error branch so
  // the richer body (kind, current_state / cap, current, subaccount_id) is used.
  const operatorMapped = mapOperatorBackendErrorToHttp(err);
  if (operatorMapped) {
    statusCode = operatorMapped.statusCode;
    errorCode = operatorMapped.errorCode;
    message = err instanceof Error ? err.message : String(err);
    extraBody = operatorMapped.body;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    errorCode = 'validation_error';
    message = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
  } else if (err instanceof Error) {
    // Unwrap DrizzleQueryError — its .message is the raw SQL; the real error is in .cause
    const cause = (err as Error & { cause?: Error }).cause;
    message = cause?.message ?? err.message;
    const withStatus = err as Error & { status?: number; statusCode?: number; errorCode?: string };
    statusCode = withStatus.status ?? withStatus.statusCode ?? 500;
    errorCode = withStatus.errorCode ?? errorCode;
  } else if (typeof err === 'object' && err !== null) {
    const e = err as { status?: number; statusCode?: number; message?: string; errorCode?: string };
    statusCode = e.status ?? e.statusCode ?? 500;
    message = e.message ?? message;
    errorCode = e.errorCode ?? errorCode;
  }

  const correlationId = req.correlationId;

  logger.error('unhandled_error', {
    correlationId,
    path: req.path,
    method: req.method,
    statusCode,
    message,
    stack: err instanceof Error ? err.stack : undefined,
  });

  if (statusCode >= 500) {
    const e = err as Record<string, unknown> & { __incidentRecorded?: boolean };
    if (!e.__incidentRecorded) {
      e.__incidentRecorded = true;
      recordIncident({
        source: 'route',
        summary: message,
        errorCode,
        stack: err instanceof Error ? err.stack : undefined,
        correlationId,
      });
    }
  }

  const isProduction = env.NODE_ENV === 'production';
  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: isProduction && statusCode >= 500 ? 'Internal server error' : message,
      ...(extraBody ?? {}),
    },
    correlationId,
  });
});

async function start() {
  // Phase 3: webhook secret boot assertion (spec §6.3.1).
  // Must run BEFORE any service initialisation so a misconfigured production
  // process exits in milliseconds rather than after kicking off background workers,
  // pg-boss queues, schedule reconciliation, or binding the HTTP port.
  if (env.NODE_ENV === 'production' && !env.WEBHOOK_SECRET) {
    throw new Error(
      '[boot] WEBHOOK_SECRET is unset in production. Outbound webhooks would be unsigned and inbound callbacks would accept any token. Set WEBHOOK_SECRET to a long random string before booting in production.',
    );
  }
  const { validateEncryptionKeyOrThrow } = await import('./services/connectionTokenValidation.js');
  validateEncryptionKeyOrThrow();

  // ChatGPT-Round-2 Finding 1 — fail fast if the security-audit sentinel
  // organisation row is missing. Pre-auth events (auth.login.failure, etc.)
  // depend on this row existing; without it, recordSecurityEvent silently
  // swallows the FK violation and login-failure audit is lost.
  const { validateSecurityAuditSentinelOrgOrThrow } = await import('./services/securityAuditSentinelValidation.js');
  await validateSecurityAuditSentinelOrgOrThrow();

  await seedPermissions();
  await backfillOrgUserRoles();
  await agentService.scheduleAllProactiveSources();
  await boardService.seedDefaultTemplate();
  await skillService.seedBuiltInSkills();
  // System skills are file-based (server/skills/*.md) — no seeding needed.
  // Initialize shared pg-boss instance + DLQ monitor before registering workers
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    const boss = await getPgBoss();
    await startDlqMonitor(boss);
    await registerSystemIncidentNotifyWorker(boss);
    // Async-ingest worker — only registers when SYSTEM_INCIDENT_INGEST_MODE=async.
    // Sync mode (the default) writes incidents inline in the calling process and
    // has no consumer for this queue. Registering the worker unconditionally would
    // cause the queue to drain even in sync mode, which is harmless but confusing.
    //
    // Always log the resolved mode so operators see the active path at boot,
    // independent of whether the async branch executes. Useful when triaging
    // "why is the queue empty?" without needing to grep env config.
    const ingestMode = process.env.SYSTEM_INCIDENT_INGEST_MODE === 'async' ? 'async' : 'sync';
    logger.info('incident_ingest_mode', {
      mode: ingestMode,
      asyncWorkerRegistered: ingestMode === 'async',
    });
    if (process.env.SYSTEM_INCIDENT_INGEST_MODE === 'async') {
      const { handleSystemMonitorIngest } = await import('./services/incidentIngestorAsyncWorker.js');
      await boss.work(
        'system-monitor-ingest',
        { teamSize: 4, teamConcurrency: 1 },
        async (job: { id: string; data: unknown }) => {
          await handleSystemMonitorIngest(job.data as Parameters<typeof handleSystemMonitorIngest>[0]);
        }
      );
      logger.info('async_incident_ingest_worker_registered');
    }
  }
  await agentScheduleService.initialize();
  await routerJobService.initializeRouterJobs();
  await queueService.startMaintenanceJobs();
  await initializePageIntegrationWorker();
  await initializePaymentReconciliationJob();
  await registerRateLimitCleanupJob();  // Phase 2C — TTL on rate_limit_buckets
  await registerOauthStateCleanupJob(); // Pre-Launch Phase 1 — TTL on oauth_state_nonces (S-P0-1, S-P0-2)
  // Workflow engine workers (tick + watchdog cron) — spec §5.2 + §5.7
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const { WorkflowEngineService } = await import('./services/workflowEngineService.js');
      const { buildHandlerContext } = await import('./lib/buildHandlerContext.js');
      await WorkflowEngineService.registerWorkers(buildHandlerContext());
    } catch (err) {
      console.error('[boot] failed to register workflow engine workers', err);
    }
  }
  // Skill Analyzer worker (migration 0092)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { runSkillAnalyzerJobWithIncidentEmission } = await import('./jobs/skillAnalyzerJobWithIncidentEmission.js');
      const { getRetryCount } = await import('./lib/jobErrors.js');
      // Surface terminal failures to the System Monitor. pg-boss retry exhaustion
      // also lands in skill-analyzer__dlq (covered by Phase 1's DLQ derivation),
      // but emitting here too gives faster visibility for failures that happen
      // on the FINAL retry attempt — without this wrap, the operator sees no
      // signal until the DLQ row lands.
      // The wrapper only emits an incident when retryCount >= retryLimit
      // (terminal attempt). Earlier-attempt throws rethrow without emitting.
      const { createWorker } = await import('./lib/createWorker.js');
      await createWorker<{ jobId: string; organisationId: string }>({
        queue: 'skill-analyzer',
        boss,
        handler: async (job) => {
          const { jobId } = job.data;
          const retryCount = getRetryCount(job as unknown as { retrycount?: number } & Record<string, unknown>);
          await runSkillAnalyzerJobWithIncidentEmission(jobId, retryCount);
        },
      });
    } catch (err) {
      console.error('[boot] failed to register skill-analyzer worker', err);
    }
  }
  // Execution-backend adapter registration (Execution Backend Adapter Contract
  // spec § 8.3). Every adapter MUST be registered against
  // `executionBackendRegistry` at boot, regardless of the queue backend in
  // use, because `executeRun` resolves `executionBackendRegistry.resolve(id)`
  // on every dispatch — including the three non-delegated adapters
  // (`api`, `headless`, `claude-code`) which have no pg-boss dependency.
  // Coupling registration to `JOB_QUEUE_BACKEND === 'pg-boss'` would render
  // dispatch broken for ALL modes when an alternate queue backend is
  // selected. Registration is therefore unconditional; the IEE event handler
  // (which DOES require pg-boss) is attached separately in the pg-boss block
  // below.
  // Adapter registration is fatal at boot. Spec § 8.2 makes registration
  // validation a boot-time safety boundary: adapters that fail validation
  // never reach dispatch. If validation throws (capability violation,
  // queue/storage drift, sandbox-requirement enum drift), letting the app
  // continue to start would leave the registry partial or empty — every
  // later `executionBackendRegistry.resolve(id)` would throw at runtime,
  // so a 500 on every dispatch is strictly worse than crashing on boot
  // with a clear log line. Mirrors the same fatal-on-failure contract as
  // the other required boot dependencies above. Order matches spec § 8.3:
  // `api`, `headless`, `claude-code`, `iee_browser`, `iee_dev` — order is
  // log-output only; the registry is a map.
  try {
    const { executionBackendRegistry } = await import('./services/executionBackends/registry.js');
    const { apiBackend } = await import('./services/executionBackends/apiBackend.js');
    const { headlessBackend } = await import('./services/executionBackends/headlessBackend.js');
    const { claudeCodeBackend } = await import('./services/executionBackends/claudeCodeBackend.js');
    const { ieeBrowserBackend } = await import('./services/executionBackends/ieeBrowserBackend.js');
    const { ieeDevBackend } = await import('./services/executionBackends/ieeDevBackend.js');
    const { operatorManagedBackend } = await import('./services/executionBackends/operatorManagedBackend.js');
    executionBackendRegistry.register(apiBackend);
    executionBackendRegistry.register(headlessBackend);
    executionBackendRegistry.register(claudeCodeBackend);
    executionBackendRegistry.register(ieeBrowserBackend);
    executionBackendRegistry.register(ieeDevBackend);
    executionBackendRegistry.register(operatorManagedBackend);
  } catch (err) {
    console.error('[boot] failed to register execution backends', err);
    throw err;
  }

  // Operator Backend pg-boss handlers (Spec D — operator_managed adapter)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerOperatorSessionCompletedHandler } = await import('./jobs/operatorSessionCompletedHandler.js');
      await registerOperatorSessionCompletedHandler(boss);
    } catch (err) {
      console.error('[boot] failed to register operator-session-completed handler', err);
    }
  }
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerOperatorSessionDispatchNextChainLinkHandler } = await import('./jobs/operatorSessionDispatchNextChainLinkHandler.js');
      await registerOperatorSessionDispatchNextChainLinkHandler(boss);
    } catch (err) {
      console.error('[boot] failed to register operator-session-dispatch-next-chain-link handler', err);
    }
  }
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerOperatorSessionProgressedHandler } = await import('./jobs/operatorSessionProgressedHandler.js');
      await registerOperatorSessionProgressedHandler(boss);
    } catch (err) {
      console.error('[boot] failed to register operator-session-progressed handler', err);
    }
  }
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerOperatorTaskProfileGcHandler } = await import('./jobs/operatorTaskProfileGcHandler.js');
      await registerOperatorTaskProfileGcHandler(boss);
    } catch (err) {
      console.error('[boot] failed to register operator-task-profile-gc handler', err);
    }
  }

  // IEE run-completed handler (Phase 0 — docs/iee-delegation-lifecycle-spec.md)
  // Consumes pg-boss events emitted after terminal iee_runs writes, and
  // finalises the parent agent_runs row accordingly. Boot ordering
  // invariant: adapter registration above must complete BEFORE the handler
  // attaches, because the handler resolves
  // `finaliseAgentRunFromBackend` -> `executionBackendRegistry.resolve(id)`
  // on every event and an unregistered id throws `BackendNotRegistered`.
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerIeeRunCompletedHandler } = await import('./jobs/ieeRunCompletedHandler.js');
      await registerIeeRunCompletedHandler(boss);
    } catch (err) {
      console.error('[boot] failed to register iee-run-completed handler', err);
    }
  }
  // IEE daily cost rollup (iee-worker-retirement spec §4 Chunk 1).
  // Migrated from the standalone worker process. Runs at 02:10 UTC.
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const { registerIeeCostRollupDailyJob } = await import('./jobs/ieeCostRollupDailyJob.js');
      await registerIeeCostRollupDailyJob();
    } catch (err) {
      console.error('[boot] failed to register iee-cost-rollup-daily job', err);
    }
  }
  // Workflow gate stall-notification worker (Workflows V1 §5.3)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const pgboss = await getPgBoss();
      const { WORKFLOW_GATE_STALL_NOTIFY_QUEUE, workflowGateStallNotifyHandler, eaDraftStallResetHandler, crossOwnerApprovalTimeoutSweep } = await import('./jobs/workflowGateStallNotifyJob.js');
      const { createWorker } = await import('./lib/createWorker.js');
      await createWorker({
        queue: WORKFLOW_GATE_STALL_NOTIFY_QUEUE,
        boss: pgboss,
        handler: async (job) => {
          await workflowGateStallNotifyHandler(job as import('pg-boss').Job<import('./jobs/workflowGateStallNotifyJob.js').WorkflowGateStallNotifyPayload>);
          await eaDraftStallResetHandler();
          await crossOwnerApprovalTimeoutSweep();
        },
      });
    } catch (err) {
      console.error('[boot] failed to register workflow-gate-stall-notify worker', err);
    }
  }
  // Document summarise worker (auto-knowledge-retrieval)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerDocumentSummariseWorker } = await import('./jobs/documentSummariseJob.js');
      registerDocumentSummariseWorker(boss);
    } catch (err) {
      console.error('[boot] failed to register document-summarise worker', err);
    }
  }
  // Document chunk-embed worker (auto-knowledge-retrieval)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerDocumentChunkEmbedWorker } = await import('./jobs/documentChunkEmbedJob.js');
      registerDocumentChunkEmbedWorker(boss);
    } catch (err) {
      console.error('[boot] failed to register document-chunk-embed worker', err);
    }
  }
  // Document re-embed worker (auto-knowledge-retrieval — embedding-model upgrade sweep)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerDocumentReembedWorker } = await import('./jobs/documentReembedJob.js');
      registerDocumentReembedWorker(boss);
    } catch (err) {
      console.error('[boot] failed to register document-reembed worker', err);
    }
  }
  // Document promotion-finalise worker (auto-knowledge-retrieval — deferred file durability flip)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerDocumentPromotionFinaliseWorker } = await import('./jobs/documentPromotionFinaliseJob.js');
      registerDocumentPromotionFinaliseWorker(boss);
    } catch (err) {
      console.error('[boot] failed to register document-promotion-finalise worker', err);
    }
  }
  // Support draft reconciliation worker
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerSupportDraftReconciliationWorker } = await import('./jobs/supportDraftReconciliationWorker.js');
      registerSupportDraftReconciliationWorker(boss);
    } catch (err) {
      console.error('[boot] failed to register support-draft-reconciliation worker', err);
    }
  }
  // Phase 1 Showcase — run-artifacts retention sweep (spec §6.1.2b)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerRunArtifactsRetentionSweepJob } = await import('./jobs/runArtifactsRetentionSweepJob.js');
      await registerRunArtifactsRetentionSweepJob(boss);
    } catch (err) {
      console.error('[boot] failed to register run-artifacts-retention-sweep worker', err);
    }
  }
  // Phase 1 Showcase — Support Agent run worker (spec §5.3.3, §5.3.7)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerSupportAgentRunJob } = await import('./jobs/supportAgentRunJob.js');
      registerSupportAgentRunJob(boss);
    } catch (err) {
      console.error('[boot] failed to register support-agent-run worker', err);
    }
  }
  // Phase 1 Showcase — Support Agent eval daily worker (spec §5.5.4)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerSupportEvalDailyJob } = await import('./jobs/supportEvalDailyJob.js');
      registerSupportEvalDailyJob(boss);
    } catch (err) {
      console.error('[boot] failed to register support-eval-daily worker', err);
    }
  }
  // IEE browser — daily cost rollup (Chunk 15B)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const { registerIeeBrowserDailyRollupJob } = await import('./jobs/ieeBrowserDailyRollupJob.js');
      await registerIeeBrowserDailyRollupJob();
    } catch (err) {
      console.error('[boot] failed to register iee-browser daily rollup job', err);
    }
  }
  // operator-session-identity chunk 6 — token refresh worker
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { createWorker } = await import('./lib/createWorker.js');
      const { processOperatorSessionRefresh } = await import('./jobs/operatorSessionRefreshJob.js');
      await createWorker({
        queue: 'operator-session-refresh',
        boss,
        // Cross-org: payload carries only connectionId (no organisationId).
        // The handler resolves org context via withAdminConnection then opens
        // its own org-scoped tx. Opt out of createWorker's auto-transaction.
        resolveOrgContext: () => null,
        handler: processOperatorSessionRefresh,
      });
      logger.info('[boot] operator-session-refresh worker registered');
    } catch (err) {
      console.error('[boot] failed to register operator-session-refresh worker', err);
    }
  }
  // Voice profile refresh (nightly cross-org scan)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { voiceProfileRefreshHandler, VOICE_PROFILE_REFRESH_JOB } = await import('./jobs/voiceProfileRefreshJob.js');
      await boss.work(VOICE_PROFILE_REFRESH_JOB, async (job) => {
        await voiceProfileRefreshHandler(job as import('pg-boss').Job<Record<string, never>>);
      });
      logger.info('[boot] voice-profile-refresh worker registered');
    } catch (err) {
      console.error('[boot] failed to register voice-profile-refresh worker', err);
    }
  }
  // Gmail inbox poll (per-connection, triggered by pg-boss scheduler)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { gmailInboxPollHandler, GMAIL_INBOX_POLL_JOB } = await import('./jobs/gmailInboxPollJob.js');
      await boss.work(GMAIL_INBOX_POLL_JOB, async (job) => {
        await gmailInboxPollHandler(job as import('pg-boss').Job<import('./jobs/gmailInboxPollJob.js').GmailPollJobData>);
      });
      logger.info('[boot] gmail-inbox-poll worker registered');
    } catch (err) {
      console.error('[boot] failed to register gmail-inbox-poll worker', err);
    }
  }
  // Calendar lookahead (per-connection, triggered by pg-boss scheduler)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { calendarLookaheadHandler, CALENDAR_LOOKAHEAD_JOB } = await import('./jobs/calendarLookaheadJob.js');
      await boss.work(CALENDAR_LOOKAHEAD_JOB, async (job) => {
        await calendarLookaheadHandler(job as import('pg-boss').Job<import('./jobs/calendarLookaheadJob.js').CalendarLookaheadJobData>);
      });
      logger.info('[boot] calendar-lookahead worker registered');
    } catch (err) {
      console.error('[boot] failed to register calendar-lookahead worker', err);
    }
  }
  // Support dispatch boot recovery (R5 mitigation — recover drafts stranded in dispatching)
  try {
    const { runSupportDispatchBootRecovery } = await import('./lib/supportDispatchBootRecovery.js');
    await runSupportDispatchBootRecovery();
  } catch (err) {
    console.error('[boot] support dispatch boot recovery failed', err);
  }
  // Org subaccount data migration (migration 0106) — idempotent but expensive.
  // Only runs if migration_states records BOTH config and memory as completed.
  try {
    const { eq, inArray } = await import('drizzle-orm');
    const { migrationStates } = await import('./db/schema/index.js');
    const { db: bootDb } = await import('./db/index.js');
    const migStates = await bootDb
      .select({ key: migrationStates.key, completedAt: migrationStates.completedAt })
      .from(migrationStates)
      .where(inArray(migrationStates.key, [
        'org_subaccount_config_migration',
        'org_subaccount_memory_migration',
      ]));
    const configDone = migStates.some(s => s.key === 'org_subaccount_config_migration' && s.completedAt);
    const memoryDone = migStates.some(s => s.key === 'org_subaccount_memory_migration' && s.completedAt);
    if (configDone && memoryDone) {
      console.log('[boot] org subaccount migration already completed (config + memory), skipping');
    } else {
      const { runOrgSubaccountMigration } = await import('./jobs/orgSubaccountMigrationJob.js');
      await runOrgSubaccountMigration();
    }
  } catch (err) {
    console.error('[boot] org subaccount data migration failed — existing org agents may not be accessible', err);
  }
  // Reconcile any scheduled-task runs left in `retrying` from a previous
  // process — their in-process retry timer was lost on restart.
  try {
    const { scheduledTaskService } = await import('./services/scheduledTaskService.js');
    await scheduledTaskService.reconcileRetryingRuns();
  } catch (err) {
    console.error('[boot] scheduled task retry reconciliation failed', err);
  }
  // System skill handler pairing: every active system_skills row must
  // reference a handler function that exists in SKILL_HANDLERS. This is the
  // fail-fast gate against the "data refers to code" drift the Phase 0 DB
  // migration opens up (see docs/skill-analyzer-v2-spec.md §10 Phase 0). If
  // any row points at a missing handler, the server refuses to boot with a
  // clear error listing the offending keys so the operator can fix it before
  // the port binds.
  try {
    const { validateSystemSkillHandlers } = await import('./services/systemSkillHandlerValidator.js');
    await validateSystemSkillHandlers();
  } catch (err) {
    console.error('[boot] system skill handler validation failed:', err);
    throw err;
  }
  // Soft drift check between compile-time SYSTEM_AGENT_BY_SLUG (server/config/c.ts)
  // and the active rows in system_agents. Warn-only — Phase B promotes this to
  // a hard fail-fast invariant once code paths actively rely on registry/DB parity.
  try {
    const { validateSystemAgentRegistry } = await import('./services/systemAgentRegistryValidator.js');
    await validateSystemAgentRegistry();
  } catch (err) {
    console.warn('[boot] system-agent registry drift check could not run:', err);
  }

  // Deterministic validators — snapshot all registered validators to DB at boot.
  // Best-effort: logs and continues on failure (spec §5.2).
  try {
    const { snapshotAllValidatorsToDb } = await import('./lib/scorecardValidators/registry.js');
    const { db: adminDb } = await import('./db/index.js');
    await snapshotAllValidatorsToDb(() => adminDb);
  } catch (err) {
    logger.warn('boot.validator_snapshot_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Agent Workspace — files-snapshot cache invalidation subscribers (Chunk 5)
  const { subscribeFilesSnapshotInvalidators } = await import('./services/agentOverviewAggregator.js');
  subscribeFilesSnapshotInvalidators();

  initWebSocket(httpServer);

  // Start the LLM in-flight registry's deadline-based sweep + (optional)
  // Redis pub/sub subscription. Spec tasks/llm-inflight-realtime-tracker-spec.md.
  llmInflightRegistry.init();

  // memory-tiered-consolidation — start the batched reinforcement flusher.
  // No-op when MEMORY_CONSOLIDATION_TIER_ENABLED is not set.
  const { startReinforcementBatchFlusher } = await import('./services/workspaceMemoryService/reinforcementBatch.js');
  startReinforcementBatchFlusher();

  const PORT = env.NODE_ENV === 'production' ? 5000 : env.PORT;

  // Windows `node --watch` kills the old process before it can gracefully
  // release the socket, so the new process typically boots while the port is
  // still held in TIME_WAIT. Without a retry loop the new process crashes on
  // EADDRINUSE, --watch restarts it, it crashes again, and the cycle can
  // burn 2–3 minutes before the kernel releases the port. In production the
  // process manager (PM2 / Docker) owns restart policy, so we only retry in
  // dev.
  const MAX_LISTEN_RETRIES = 30;           // 30 × 2s = 1 min ceiling
  const LISTEN_RETRY_DELAY_MS = 2_000;
  const canRetryListen = env.NODE_ENV !== 'production';

  const listenWithRetry = (attempt: number) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && canRetryListen && attempt < MAX_LISTEN_RETRIES) {
        console.warn(
          `[SERVER] Port ${PORT} in use (likely TIME_WAIT from previous process) — retrying in ${LISTEN_RETRY_DELAY_MS / 1000}s [${attempt + 1}/${MAX_LISTEN_RETRIES}]`,
        );
        setTimeout(() => listenWithRetry(attempt + 1), LISTEN_RETRY_DELAY_MS);
        return;
      }
      // Non-retryable error or retry ceiling reached — exit explicitly rather
      // than throwing from an EventEmitter listener. The latter relies on
      // Node's emit machinery routing the throw to uncaughtException, but a
      // non-fatal path (unhandledRejection, which only logs) would silently
      // leave the server running without a bound port.
      console.error(
        `[SERVER] Fatal: cannot bind port ${PORT} after ${attempt + 1} attempt(s) — ${err.code ?? 'unknown'}: ${err.message}`,
      );
      process.exit(1);
    };
    httpServer.once('error', onError);
    httpServer.listen(PORT, '0.0.0.0', () => {
      httpServer.removeListener('error', onError);
      console.log(`[SERVER] Automation OS running on port ${PORT} (${env.NODE_ENV})`);
    });
  };
  listenWithRetry(0);
}

start().catch((err) => {
  console.error('[SERVER] Startup failed', err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
const SHUTDOWN_TIMEOUT_MS = 15_000;
let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SHUTDOWN] Received ${signal} — starting graceful shutdown`);

  const forceExit = setTimeout(() => {
    console.error('[SHUTDOWN] Timed out after 15 s — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  // Allow the process to exit naturally if everything closes in time
  forceExit.unref();

  try {
    // 1. Stop accepting new connections & wait for in-flight requests
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
      console.log('[SHUTDOWN] HTTP server closing (waiting for in-flight requests)');
    });
    console.log('[SHUTDOWN] HTTP server closed');

    // 2. Close Socket.IO server
    const io = getIO();
    if (io) {
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
      console.log('[SHUTDOWN] Socket.IO server closed');
    }

    // 2a. Stop the LLM in-flight registry (sweep timer + Redis clients)
    try {
      await llmInflightRegistry.shutdown();
      console.log('[SHUTDOWN] LLM in-flight registry stopped');
    } catch (err) {
      console.error('[SHUTDOWN] Error stopping LLM in-flight registry', err);
    }

    // 2b. Drain the reinforcement batch flusher (waits up to 10s for in-flight flushes)
    try {
      const { stopReinforcementBatchFlusher } = await import('./services/workspaceMemoryService/reinforcementBatch.js');
      await stopReinforcementBatchFlusher();
      console.log('[SHUTDOWN] Reinforcement batch flusher stopped');
    } catch (err) {
      console.error('[SHUTDOWN] Error stopping reinforcement batch flusher', err);
    }

    // 3. Stop shared pg-boss instance (covers all queue workers)
    try {
      await stopPgBoss();
      console.log('[SHUTDOWN] pg-boss stopped');
    } catch (err) {
      console.error('[SHUTDOWN] Error stopping pg-boss', err);
    }

    // 4. Close database connection pool
    try {
      await dbClient.end();
      console.log('[SHUTDOWN] Database connection pool closed');
    } catch (err) {
      console.error('[SHUTDOWN] Error closing database pool', err);
    }

    console.log('[SHUTDOWN] Clean shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[SHUTDOWN] Error during shutdown', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
