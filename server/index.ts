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
import orgConnectionsRouter from './routes/orgConnections.js';
import webLoginConnectionsRouter from './routes/webLoginConnections.js';
import workflowTemplatesRouter from './routes/workflowTemplates.js';
import workflowRunsRouter from './routes/workflowRuns.js';
import workflowStudioRouter from './routes/workflowStudio.js';
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
import githubAppRouter from './routes/githubApp.js';
import githubWebhookRouter from './routes/githubWebhook.js';
import mcpRouter from './routes/mcp.js';
import agentInboxRouter from './routes/agentInbox.js';
import orgAgentConfigsRouter from './routes/orgAgentConfigs.js';
import connectorConfigsRouter from './routes/connectorConfigs.js';
import ghlWebhookRouter from './routes/webhooks/ghlWebhook.js';
import teamworkWebhookRouter from './routes/webhooks/teamworkWebhook.js';
import slackWebhookRouter from './routes/webhooks/slackWebhook.js';
import subaccountTagsRouter from './routes/subaccountTags.js';
import subaccountSkillsRouter from './routes/subaccountSkills.js';
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
import pulseRouter from './routes/pulse.js';
// Universal Brief routes (Phase 2 + Phase 5)
import briefsRouter from './routes/briefs.js';
import briefConversationsRouter from './routes/conversations.js';
import rulesRouter from './routes/rules.js';
import { delegationOutcomesRouter } from './routes/delegationOutcomes.js';
import referenceDocumentsRouter from './routes/referenceDocuments.js';
import documentBundlesRouter from './routes/documentBundles.js';
import systemIncidentsRouter from './routes/systemIncidents.js';
import { recordIncident } from './services/incidentIngestor.js';
import { registerSystemIncidentNotifyWorker } from './services/systemIncidentNotifyJob.js';

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
app.use(knowledgeRouter);
app.use(agentTriggersRouter);
app.use(scheduledTasksRouter);
app.use(reviewItemsRouter);
app.use(actionsRouter);
app.use(systemAutomationsRouter);
app.use(systemEnginesRouter);
app.use(integrationConnectionsRouter);
app.use(orgConnectionsRouter);
app.use(webLoginConnectionsRouter);
app.use(workflowTemplatesRouter);
app.use(workflowRunsRouter);
app.use(workflowStudioRouter);
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
app.use(githubAppRouter);
app.use(githubWebhookRouter);
app.use(mcpRouter);
app.use(agentInboxRouter);
app.use(orgAgentConfigsRouter);
app.use(connectorConfigsRouter);
// ghl/teamwork/slack webhook routers mounted before body parsing (need raw body for HMAC)
app.use(subaccountTagsRouter);
app.use(subaccountSkillsRouter);
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
app.use(briefsRouter);
app.use(briefConversationsRouter);
app.use('/api/rules', rulesRouter);
app.use(crmQueryPlannerRouter);
app.use(delegationOutcomesRouter);
app.use(referenceDocumentsRouter);
app.use(documentBundlesRouter);
app.use(systemIncidentsRouter);
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
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  let statusCode = 500;
  let message = 'Internal server error';
  let errorCode = 'internal_error';

  if (err instanceof ZodError) {
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
    },
    correlationId,
  });
});

async function start() {
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
  // Workflow engine workers (tick + watchdog cron) — spec §5.2 + §5.7
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const { WorkflowEngineService } = await import('./services/workflowEngineService.js');
      await WorkflowEngineService.registerWorkers();
    } catch (err) {
      console.error('[boot] failed to register workflow engine workers', err);
    }
  }
  // Skill Analyzer worker (migration 0092)
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { runSkillAnalyzerJobWithIncidentEmission } = await import('./jobs/skillAnalyzerJobWithIncidentEmission.js');
      // Surface terminal failures to the System Monitor. pg-boss retry exhaustion
      // also lands in skill-analyzer__dlq (covered by Phase 1's DLQ derivation),
      // but emitting here too gives faster visibility for failures that happen
      // on the FINAL retry attempt — without this wrap, the operator sees no
      // signal until the DLQ row lands.
      await boss.work('skill-analyzer', async (job) => {
        const { jobId } = job.data as { jobId: string };
        await runSkillAnalyzerJobWithIncidentEmission(jobId);
      });
    } catch (err) {
      console.error('[boot] failed to register skill-analyzer worker', err);
    }
  }
  // IEE run-completed handler (Phase 0 — docs/iee-delegation-lifecycle-spec.md)
  // Consumes pg-boss events emitted by the worker after terminal iee_runs
  // writes, and finalises the parent agent_runs row accordingly.
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    try {
      const boss = await getPgBoss();
      const { registerIeeRunCompletedHandler } = await import('./jobs/ieeRunCompletedHandler.js');
      await registerIeeRunCompletedHandler(boss);
    } catch (err) {
      console.error('[boot] failed to register iee-run-completed handler', err);
    }
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

  initWebSocket(httpServer);

  // Start the LLM in-flight registry's deadline-based sweep + (optional)
  // Redis pub/sub subscription. Spec tasks/llm-inflight-realtime-tracker-spec.md.
  llmInflightRegistry.init();

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
