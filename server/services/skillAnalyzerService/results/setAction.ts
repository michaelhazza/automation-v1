import { eq, inArray, and } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '../../../db/index.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../../../db/schema/index.js';
import * as skillAnalyzerConfigService from '../../skillAnalyzerConfigService.js';
import type { MergeWarning, WarningResolution, WarningTier } from '../../skillAnalyzerServicePure.js';
import { evaluateApprovalState } from '../../skillAnalyzerServicePure.js';
import { stableStringify } from '../hashing.js';

/** Set action on a single result. Validates job + org ownership. */
export async function setResultAction(params: {
  resultId: string;
  jobId: string;
  organisationId: string;
  userId: string;
  // action=null unapproves a previously-approved result (clears approved_at).
  action: 'approved' | 'rejected' | 'skipped' | null;
}): Promise<void> {
  const { resultId, jobId, organisationId, userId, action } = params;

  // Verify job belongs to org
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const jobRows = await db
    .select({ id: skillAnalyzerJobs.id, configSnapshot: skillAnalyzerJobs.configSnapshot })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);

  if (!jobRows[0]) {
    throw { statusCode: 404, message: 'Job not found' };
  }

  // Server-side blocking enforcement via canonical evaluateApprovalState.
  // PARTIAL_OVERLAP / IMPROVEMENT results with unresolved decision_required
  // or critical warnings cannot transition to approved.
  if (action === 'approved') {
    const resultRows = await getOrgScopedDb('skillAnalyzerService.setResultAction.read')
      .select()
      .from(skillAnalyzerResults)
      .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)))
      .limit(1);

    const resultRow = resultRows[0];
    if (!resultRow) {
      throw { statusCode: 404, message: 'Result not found' };
    }

    if (
      resultRow.classification === 'PARTIAL_OVERLAP' ||
      resultRow.classification === 'IMPROVEMENT'
    ) {
      const warnings = (resultRow.mergeWarnings ?? []) as MergeWarning[];
      const resolutions = (resultRow.warningResolutions ?? []) as WarningResolution[];
      const snapshot = jobRows[0].configSnapshot as { warningTierMap?: Record<string, WarningTier> } | null;
      const tierMap = skillAnalyzerConfigService.effectiveTierMap(
        snapshot as unknown as { warningTierMap: Record<string, WarningTier> } | null,
      );
      const state = evaluateApprovalState(warnings, resolutions, tierMap);
      if (state.blocked) {
        throw {
          statusCode: 422,
          message: 'Cannot approve: merge has unresolved blocking warnings.',
          errorCode: 'MERGE_CRITICAL_WARNINGS',
          reasons: state.reasons,
        };
      }

      // Approval snapshot + drift-detection hash (§11.11.12, §11.12.1).
      const approvalSnapshot = {
        warnings,
        resolutions,
        state,
        configVersion: (snapshot as { configVersion?: number } | null)?.configVersion ?? null,
        evaluatedAt: new Date().toISOString(),
      };
      const approvalHash = createHash('sha256')
        .update(stableStringify(approvalSnapshot))
        .digest('hex');

      await getOrgScopedDb('skillAnalyzerService.setResultAction.approve')
        .update(skillAnalyzerResults)
        .set({
          actionTaken: 'approved',
          actionTakenAt: new Date(),
          actionTakenBy: userId,
          approvedAt: new Date(),
          approvalDecisionSnapshot: approvalSnapshot,
          approvalHash,
          wasApprovedBefore: true,
        })
        .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)));
      return;
    }
  }

  // reject / skip / unapprove (null) path. For 'approved' on non-PARTIAL_OVERLAP
  // classifications (DISTINCT, DUPLICATE) we simply update actionTaken without
  // the approval gate — those don't have merge warnings to resolve.
  await getOrgScopedDb('skillAnalyzerService.setResultAction.update')
    .update(skillAnalyzerResults)
    .set({
      actionTaken: action,
      actionTakenAt: action === null ? null : new Date(),
      actionTakenBy: action === null ? null : userId,
      // Unapprove clears approved_at so edits are permitted again.
      // was_approved_before stays true (§11.12.2 UX signal).
      approvedAt: action === 'approved' ? new Date() : null,
    })
    .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)));
}

/** Bulk set action on multiple results. */
export async function bulkSetResultAction(params: {
  resultIds: string[];
  jobId: string;
  organisationId: string;
  userId: string;
  action: 'approved' | 'rejected' | 'skipped';
}): Promise<void> {
  const { resultIds, jobId, organisationId, userId, action } = params;
  if (resultIds.length === 0) return;

  // Verify job belongs to org
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const jobRows = await db
    .select({ id: skillAnalyzerJobs.id })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);

  if (!jobRows[0]) {
    throw { statusCode: 404, message: 'Job not found' };
  }

  // Delegate to the per-row setResultAction so approval snapshot + drift hash
  // + was_approved_before get written consistently for every row.
  if (action === 'approved') {
    for (const resultId of resultIds) {
      await setResultAction({ resultId, jobId, organisationId, userId, action });
    }
    return;
  }

  // reject / skip: bulk update without approval snapshot logic.
  await getOrgScopedDb('skillAnalyzerService.bulkSetResultAction')
    .update(skillAnalyzerResults)
    .set({
      actionTaken: action,
      actionTakenAt: new Date(),
      actionTakenBy: userId,
    })
    .where(
      and(
        inArray(skillAnalyzerResults.id, resultIds),
        eq(skillAnalyzerResults.jobId, jobId)
      )
    );
}

