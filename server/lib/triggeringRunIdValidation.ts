// triggeringRunIdValidation.ts — validates an optional ?triggeringRunId= query param.
// Used by routes that accept an agent-run reference to audit-log the edit that triggered them.
//
// Spec: tasks/builds/lael-phase-1-and-2/spec.md §Phase 2.
//
// Validation chain (fail-fast, in order):
//   1. UUID shape check
//   2. Run visibility check (404 on miss — tenancy-leak prevention)
//   3. Same-org assertion (defence in depth)
//   4. Subaccount compatibility (when caller provides a subaccountId)

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getOrgScopedDb } from './orgScopedDb.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { systemAgents } from '../db/schema/systemAgents.js';
import {
  resolveAgentRunVisibility,
  type AgentRunVisibilityUser,
} from './agentRunVisibility.js';

const uuidSchema = z.string().uuid();

export type TriggeringRunIdValidationOk = {
  ok: true;
  runId: string;
  subaccountId: string | null;
};

export type TriggeringRunIdValidationError = {
  ok: false;
  status: 400 | 403 | 404;
  errorCode: string;
};

export type TriggeringRunIdValidationResult =
  | TriggeringRunIdValidationOk
  | TriggeringRunIdValidationError;

export interface TriggeringRunIdValidationParams {
  /** The raw run ID string from the query param. */
  runId: string;
  /** Organisation ID of the calling user — used for same-org assertion. */
  orgId: string;
  /**
   * Subaccount ID of the target entity being edited, if applicable.
   * When provided, the run's subaccountId must be null or match this value.
   */
  subaccountId?: string | null;
  /** Caller's user context — used for visibility check. */
  user: AgentRunVisibilityUser;
}

/**
 * Validate a triggeringRunId query parameter before writing an audit row.
 *
 * Returns `{ ok: true, runId, subaccountId }` on success.
 * Returns `{ ok: false, status, errorCode }` on the first failing check.
 */
export async function validateTriggeringRunId(
  params: TriggeringRunIdValidationParams,
): Promise<TriggeringRunIdValidationResult> {
  const { runId, orgId, subaccountId, user } = params;

  // Step 1 — UUID shape
  const parsed = uuidSchema.safeParse(runId);
  if (!parsed.success) {
    return { ok: false, status: 400, errorCode: 'invalid_triggering_run_id' };
  }

  // Step 2 — Fetch run for visibility check
  const db = getOrgScopedDb('triggeringRunIdValidation.fetch');

  const [row] = await db
    .select({
      id: agentRuns.id,
      organisationId: agentRuns.organisationId,
      subaccountId: agentRuns.subaccountId,
      agentId: agentRuns.agentId,
      executionScope: agentRuns.executionScope,
    })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);

  if (!row) {
    // Return 404 not 403 — prevents tenancy leak (caller can't determine
    // whether the run belongs to another org).
    return { ok: false, status: 404, errorCode: 'triggering_run_not_found' };
  }

  // System-tier detection
  const [sysAgent] = await db
    .select({ id: systemAgents.id })
    .from(systemAgents)
    .where(eq(systemAgents.id, row.agentId))
    .limit(1);

  const visibilityRun = {
    organisationId: row.organisationId,
    subaccountId: row.subaccountId,
    executionScope: row.executionScope,
    isSystemRun: Boolean(sysAgent),
  };

  const visibility = resolveAgentRunVisibility(visibilityRun, user);
  if (!visibility.canView) {
    // Still return 404 to prevent tenancy leak
    return { ok: false, status: 404, errorCode: 'triggering_run_not_found' };
  }

  // Step 3 — Same-org assertion (defence in depth)
  if (row.organisationId !== orgId) {
    return { ok: false, status: 403, errorCode: 'triggering_run_org_mismatch' };
  }

  // Step 4 — Subaccount compatibility (when caller provides a target subaccountId)
  if (subaccountId != null) {
    // Run's subaccountId must be null (org-level run) OR match the target subaccountId.
    if (row.subaccountId !== null && row.subaccountId !== subaccountId) {
      return { ok: false, status: 403, errorCode: 'triggering_run_subaccount_mismatch' };
    }
  }

  return { ok: true, runId, subaccountId: row.subaccountId };
}
