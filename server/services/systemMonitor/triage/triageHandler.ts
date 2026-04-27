// triageHandler.ts — incident-driven triage for the system_monitor agent.
//
// Runs the system_monitor LLM in a lightweight read-eval-act tool loop.
// No user-facing agent infrastructure (no subaccountAgents row, no middleware,
// no task management). The agent_runs row is written for audit continuity and
// to supply the agentDiagnosisRunId FK on system_incidents.
//
// Wraps in withSystemPrincipal (caller must ensure this; triageJob.ts does it).

import { eq, sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { agents, agentRuns, systemIncidentEvents } from '../../../db/schema/index.js';
import { systemIncidents } from '../../../db/schema/systemIncidents.js';
import { logger } from '../../../lib/logger.js';
import { routeCall } from '../../llmRouter.js';
import { SKILL_HANDLERS, type SkillExecutionContext } from '../../skillExecutor.js';
import { SYSTEM_MONITOR_PROMPT } from './agentSystemPrompt.js';
import { resolveSystemOpsContext } from '../../systemOperationsOrgResolver.js';
import { READ_INCIDENT_DEFINITION } from '../skills/readIncident.js';
import { READ_AGENT_RUN_DEFINITION } from '../skills/readAgentRun.js';
import { READ_SKILL_EXECUTION_DEFINITION } from '../skills/readSkillExecution.js';
import { READ_RECENT_RUNS_FOR_AGENT_DEFINITION } from '../skills/readRecentRunsForAgent.js';
import { READ_BASELINE_DEFINITION } from '../skills/readBaseline.js';
import { READ_HEURISTIC_FIRES_DEFINITION } from '../skills/readHeuristicFires.js';
import { READ_CONNECTOR_STATE_DEFINITION } from '../skills/readConnectorState.js';
import { READ_DLQ_RECENT_DEFINITION } from '../skills/readDlqRecent.js';
import { READ_LOGS_FOR_CORRELATION_ID_DEFINITION } from '../skills/readLogsForCorrelationId.js';
import { WRITE_DIAGNOSIS_DEFINITION } from '../skills/writeDiagnosis.js';
import { WRITE_EVENT_DEFINITION } from '../skills/writeEvent.js';
import type { ProviderTool, ProviderMessage } from '../../providers/types.js';
import { checkAdmit } from './triageAdmitPure.js';
import { checkRateLimit, maybeAutoEscalate } from './rateLimit.js';
export { checkAdmit, type AdmitVerdict } from './triageAdmitPure.js';

// ── Constants ─────────────────────────────────────────────────────────────────

// Tunable via SYSTEM_MONITOR_TRIAGE_MAX_ITERATIONS (spec §9.10 / §12.2). Resolved
// once at module load — env changes need a redeploy, matching the cron-interval
// envs in queueService.ts.
function resolveMaxIterations(): number {
  const raw = process.env.SYSTEM_MONITOR_TRIAGE_MAX_ITERATIONS;
  const parsed = raw === undefined ? NaN : parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 50) return 10;
  return parsed;
}
const TRIAGE_MAX_ITERATIONS = resolveMaxIterations();
const TRIAGE_MAX_TOKENS = 8_096;

const SYSTEM_MONITOR_TOOL_DEFINITIONS: ProviderTool[] = [
  READ_INCIDENT_DEFINITION,
  READ_AGENT_RUN_DEFINITION,
  READ_SKILL_EXECUTION_DEFINITION,
  READ_RECENT_RUNS_FOR_AGENT_DEFINITION,
  READ_BASELINE_DEFINITION,
  READ_HEURISTIC_FIRES_DEFINITION,
  READ_CONNECTOR_STATE_DEFINITION,
  READ_DLQ_RECENT_DEFINITION,
  READ_LOGS_FOR_CORRELATION_ID_DEFINITION,
  WRITE_DIAGNOSIS_DEFINITION,
  WRITE_EVENT_DEFINITION,
] as ProviderTool[];

// ── System monitor agent resolver ─────────────────────────────────────────────

// Cached after first lookup — the agents row doesn't change at runtime.
let cachedSystemMonitorAgentId: string | null = null;

async function resolveSystemMonitorAgentId(organisationId: string): Promise<string> {
  if (cachedSystemMonitorAgentId) return cachedSystemMonitorAgentId;
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      sql`${agents.organisationId} = ${organisationId}::uuid
        AND ${agents.slug} = 'system_monitor'
        AND ${agents.deletedAt} IS NULL`,
    )
    .limit(1);
  if (!row) {
    throw new Error('system_monitor agents row not found — run migration 0233 first');
  }
  cachedSystemMonitorAgentId = row.id;
  return row.id;
}

// ── Lightweight tool loop ─────────────────────────────────────────────────────

async function runToolLoop(
  agentRunId: string,
  incidentId: string,
  organisationId: string,
  agentId: string,
): Promise<{ success: boolean; terminatedReason?: string }> {
  const skillCtx: SkillExecutionContext = {
    runId: agentRunId,
    organisationId,
    subaccountId: null,
    agentId,
    orgProcesses: [],
  };

  const messages: ProviderMessage[] = [
    {
      role: 'user',
      content: `Triage incident ${incidentId}. Begin by reading the incident record, then gather supporting evidence, then write your diagnosis and the investigate prompt.`,
    },
  ];

  for (let i = 0; i < TRIAGE_MAX_ITERATIONS; i++) {
    const response = await routeCall({
      messages,
      system: SYSTEM_MONITOR_PROMPT,
      tools: SYSTEM_MONITOR_TOOL_DEFINITIONS,
      maxTokens: TRIAGE_MAX_TOKENS,
      temperature: 0.3,
      context: {
        organisationId,
        sourceType: 'system',
        taskType: 'general',
        featureTag: 'system-monitor-triage',
        agentName: 'system_monitor',
        runId: agentRunId,
      },
    });

    // Accumulate assistant turn
    const assistantContent: ProviderMessage['content'] = response.toolCalls && response.toolCalls.length > 0
      ? [
          ...(response.content ? [{ type: 'text' as const, text: response.content }] : []),
          ...response.toolCalls.map((tc) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        ]
      : response.content;

    messages.push({ role: 'assistant', content: assistantContent });

    if (!response.toolCalls || response.toolCalls.length === 0) {
      return { success: true, terminatedReason: response.stopReason };
    }

    // Execute each tool call
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
    for (const tc of response.toolCalls) {
      let result: unknown;
      try {
        const handler = SKILL_HANDLERS[tc.name];
        if (!handler) {
          result = { success: false, error: `Unknown tool: ${tc.name}` };
        } else {
          result = await handler(tc.input, skillCtx);
        }
      } catch (err) {
        result = { success: false, error: String(err) };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return { success: false, terminatedReason: 'max_iterations' };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export interface TriageResult {
  status: 'skipped' | 'failed' | 'completed';
  reason?: string;
}

export async function runTriage(incidentId: string): Promise<TriageResult> {
  // 1. Load incident
  const [incident] = await db
    .select({
      id: systemIncidents.id,
      severity: systemIncidents.severity,
      source: systemIncidents.source,
      status: systemIncidents.status,
      triageAttemptCount: systemIncidents.triageAttemptCount,
    })
    .from(systemIncidents)
    .where(eq(systemIncidents.id, incidentId))
    .limit(1);

  if (!incident) {
    logger.warn('triage_incident_not_found', { incidentId });
    return { status: 'skipped', reason: 'incident_not_found' };
  }

  // 2. Admit check
  const verdict = checkAdmit(
    incident.severity,
    incident.source,
    null, // metadata not fetched — source field is the primary self-check signal
    incident.triageAttemptCount,
  );

  if (!verdict.admitted) {
    await db.insert(systemIncidentEvents).values({
      incidentId,
      eventType: 'agent_triage_skipped',
      actorKind: 'agent',
      payload: { reason: verdict.reason },
      occurredAt: new Date(),
    });
    logger.info('triage_skipped', { incidentId, reason: verdict.reason });
    return { status: 'skipped', reason: verdict.reason };
  }

  // 2b. Rate-limit gate (spec §9.9). Soft cap defaults to 2 / fingerprint / 24h
  // (configurable via SYSTEM_MONITOR_MAX_TRIAGE_PER_FINGERPRINT). The hard ceiling
  // in checkAdmit (cap=5) is defense-in-depth and normally never trips in this flow.
  const rateLimit = await checkRateLimit(incidentId);
  if (!rateLimit.allowed) {
    await db.insert(systemIncidentEvents).values({
      incidentId,
      eventType: 'agent_triage_skipped',
      actorKind: 'agent',
      payload: { reason: 'rate_limited', triageAttemptCount: incident.triageAttemptCount },
      occurredAt: new Date(),
    });
    logger.info('triage_skipped', { incidentId, reason: 'rate_limited' });
    return { status: 'skipped', reason: 'rate_limited' };
  }

  // Window has expired on a previously rate-limited incident. For high/critical
  // open incidents this triggers auto-escalation instead of re-triaging — the
  // operator hasn't resolved it after 24h, so defer to a human via the system-ops
  // sentinel subaccount (spec §9.9). maybeAutoEscalate handles the Phase 0.5
  // escalation guardrails internally; if blocked, an agent_escalation_blocked
  // event is written by the underlying path.
  if (rateLimit.windowExpired && (incident.severity === 'high' || incident.severity === 'critical')) {
    await maybeAutoEscalate(incidentId);
    return { status: 'skipped', reason: 'auto_escalated' };
  }

  // 3. Resolve system ops context + system_monitor agent
  const { organisationId } = await resolveSystemOpsContext();
  const agentId = await resolveSystemMonitorAgentId(organisationId);

  // 4. Create agent_runs row for audit trail
  const runId = crypto.randomUUID();
  await db.insert(agentRuns).values({
    id: runId,
    organisationId,
    agentId,
    runType: 'triggered',
    runSource: 'system',
    executionScope: 'subaccount',
    principalType: 'service',
    principalId: 'system_monitor',
    status: 'running',
    runMetadata: { incidentId },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // 5. Increment triage attempt counter and flip triage_status → 'running' before the run.
  // The UI reads triage_status directly to render the in-flight banner, replacing
  // the previous 5-minute time-window inference (which misrepresented crashed jobs).
  await db
    .update(systemIncidents)
    .set({
      triageAttemptCount: sql`${systemIncidents.triageAttemptCount} + 1`,
      lastTriageAttemptAt: new Date(),
      triageStatus: 'running',
      updatedAt: new Date(),
    })
    .where(eq(systemIncidents.id, incidentId));

  // 6. Run the LLM tool loop
  let loopResult: { success: boolean; terminatedReason?: string };
  try {
    loopResult = await runToolLoop(runId, incidentId, organisationId, agentId);
  } catch (err) {
    loopResult = { success: false, terminatedReason: String(err) };
  }

  // 7. Update agent_runs row
  const finalStatus = loopResult.success ? 'completed' : 'failed';
  await db
    .update(agentRuns)
    .set({
      status: finalStatus,
      ...(loopResult.terminatedReason ? { errorMessage: loopResult.terminatedReason } : {}),
      updatedAt: new Date(),
    })
    .where(eq(agentRuns.id, runId));

  // 8. Flip triage_status to its terminal value + emit outcome event.
  if (loopResult.success) {
    await db
      .update(systemIncidents)
      .set({ triageStatus: 'completed', updatedAt: new Date() })
      .where(eq(systemIncidents.id, incidentId));
    // The write_diagnosis skill emits agent_diagnosis_added inside the loop.
    // Log completion for observability; the DB event is the agent's responsibility.
    logger.info('triage_completed', { incidentId, runId });
    return { status: 'completed' };
  } else {
    await db
      .update(systemIncidents)
      .set({ triageStatus: 'failed', updatedAt: new Date() })
      .where(eq(systemIncidents.id, incidentId));
    await db.insert(systemIncidentEvents).values({
      incidentId,
      eventType: 'agent_triage_failed',
      actorKind: 'agent',
      actorAgentRunId: runId,
      payload: { reason: loopResult.terminatedReason ?? 'agent_run_failed' },
      occurredAt: new Date(),
    });
    logger.error('triage_failed', {
      incidentId,
      runId,
      reason: loopResult.terminatedReason,
    });
    return { status: 'failed', reason: loopResult.terminatedReason };
  }
}
