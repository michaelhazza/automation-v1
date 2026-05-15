import { eq, inArray } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { organisations, subaccounts, agentRuns } from '../../../db/schema/index.js';
import type { AgentRunRequest, AgentRunResult, ValidatePrepareResult } from '../types.js';

export async function validateAndPrepare(
  request: AgentRunRequest,
  startTime: number,
): Promise<ValidatePrepareResult> {
  // ── 0a. Execution scope validation ─────────────────────────────────
  // Post-migration 0106: all runs are subaccount-scoped. Both fields are required.
  // Use Error instances (not plain objects) so background callers that check
  // `err instanceof Error` (scheduledTaskService, subtaskWakeupService, etc.)
  // can read err.message. asyncHandler also accepts Error with statusCode/errorCode
  // as extra properties.
  if (!request.subaccountId) {
    const err = Object.assign(new Error('All agent runs require a subaccountId'), { statusCode: 400, errorCode: 'MISSING_SUBACCOUNT_ID' });
    throw err;
  }
  if (!request.subaccountAgentId) {
    const err = Object.assign(new Error('All agent runs require a subaccountAgentId post-migration'), { statusCode: 400, errorCode: 'MISSING_SUBACCOUNT_AGENT_ID' });
    throw err;
  }

  // ── 0b. General org execution kill switch ───────────────────────────
  // Applies to ALL runs (org subaccount and regular subaccounts alike).
  const [orgForKillSwitch] = await db
    .select({ executionEnabled: organisations.orgExecutionEnabled })
    .from(organisations)
    .where(eq(organisations.id, request.organisationId));
  if (orgForKillSwitch && !orgForKillSwitch.executionEnabled) {
    const result: AgentRunResult = {
      runId: '',
      status: 'failed',
      summary: null,
      totalToolCalls: 0,
      totalTokens: 0,
      durationMs: Date.now() - startTime,
      tasksCreated: 0,
      tasksUpdated: 0,
      deliverablesCreated: 0,
    };
    return { kind: 'early_exit', result };
  }

  // ── 0c. Check if this is an org subaccount run (for cross-subaccount access control) ─
  const [subaccountRow] = await db
    .select({ isOrgSubaccount: subaccounts.isOrgSubaccount })
    .from(subaccounts)
    // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT to check isOrgSubaccount flag; subaccountId comes from authenticated agent run request already validated upstream"
    .where(eq(subaccounts.id, request.subaccountId));
  const isOrgSubaccountRun = subaccountRow?.isOrgSubaccount ?? false;

  // ── 0d. Idempotency check — return existing run if key already used ───
  // Candidate set: explicit list (e.g. dual-bucket for test runs) falls
  // through to a single-key lookup if absent.
  const idempotencyLookupKeys =
    request.idempotencyCandidateKeys && request.idempotencyCandidateKeys.length > 0
      ? Array.from(new Set(request.idempotencyCandidateKeys))
      : request.idempotencyKey
        ? [request.idempotencyKey]
        : [];
  if (idempotencyLookupKeys.length > 0) {
    const [existing] = await db
      .select()
      .from(agentRuns)
      .where(inArray(agentRuns.idempotencyKey, idempotencyLookupKeys))
      .limit(1);

    if (existing) {
      const result: AgentRunResult = {
        runId: existing.id,
        status: existing.status as AgentRunResult['status'],
        summary: existing.summary,
        totalToolCalls: existing.totalToolCalls,
        totalTokens: existing.totalTokens,
        durationMs: existing.durationMs ?? (Date.now() - startTime),
        tasksCreated: existing.tasksCreated,
        tasksUpdated: existing.tasksUpdated,
        deliverablesCreated: existing.deliverablesCreated,
      };
      return { kind: 'early_exit', result };
    }
  }

  return {
    kind: 'proceed',
    ctx: {
      startTime,
      isOrgSubaccountRun,
      idempotencyLookupKeys,
    },
  };
}
