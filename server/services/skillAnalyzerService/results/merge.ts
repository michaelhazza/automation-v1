import { eq, and } from 'drizzle-orm';
import { logger } from '../../../lib/logger.js';
import { db } from '../../../db/index.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../../../db/schema/index.js';
import { systemSkillService } from '../../systemSkillService.js';
import type { EnrichedResult } from '../types.js';
import type { PatchMergeFieldsParams } from '../types.js';

/** Patch one or more fields of a result row's proposedMergedContent jsonb.
 *  Used by the Phase 5 PATCH /merge endpoint. Validates classification
 *  (PARTIAL_OVERLAP / IMPROVEMENT only), validates the existing
 *  proposedMergedContent is non-null, validates the definition shape if
 *  it's being patched. Sets userEditedMerge=true on success. Per spec §7.3. */
export async function patchMergeFields(
  params: PatchMergeFieldsParams,
): Promise<EnrichedResult> {
  const { resultId, jobId, organisationId, patch } = params;

  // Validate the definition shape early so we don't have to do it inside
  // the merge logic. The shared predicate is the single source of truth
  // for "what counts as a valid Anthropic tool definition".
  if (patch.definition !== undefined) {
    const { isValidToolDefinitionShape } = await import('../../../../shared/skillParameters.js');
    if (!isValidToolDefinitionShape(patch.definition)) {
      throw {
        statusCode: 400,
        message: 'definition must be an Anthropic tool-definition object with name, description, and input_schema',
      };
    }
  }

  // Job ownership
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const jobRows = await db
    .select({ id: skillAnalyzerJobs.id })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);
  if (!jobRows[0]) {
    throw { statusCode: 404, message: 'Job not found' };
  }

  const resultRows = await getOrgScopedDb('skillAnalyzerService.patchMergeFields.read')
    .select()
    .from(skillAnalyzerResults)
    .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)))
    .limit(1);
  const row = resultRows[0];
  if (!row) {
    throw { statusCode: 404, message: 'Result not found' };
  }

  // Optimistic concurrency: if the client sent ifUnmodifiedSince and the row
  // has already been written after that point, reject to avoid overwriting a
  // concurrent edit.
  if (params.ifUnmodifiedSince && row.mergeUpdatedAt) {
    if (new Date(row.mergeUpdatedAt) > new Date(params.ifUnmodifiedSince)) {
      throw {
        statusCode: 409,
        message: 'merge content was modified by another session — reload and retry',
      };
    }
  }

  // v2 §11.11.2: a result locked by approval may not be edited. The reviewer
  // must first unapprove (PATCH action=null).
  if (row.approvedAt) {
    throw {
      statusCode: 409,
      message: 'Result is locked — unapprove before editing the merge.',
      errorCode: 'RESULT_LOCKED',
    };
  }

  // Per spec §7.3: merge edits only valid for PARTIAL_OVERLAP / IMPROVEMENT.
  if (row.classification !== 'PARTIAL_OVERLAP' && row.classification !== 'IMPROVEMENT') {
    throw {
      statusCode: 409,
      message: 'merge edits are only valid on PARTIAL_OVERLAP / IMPROVEMENT results',
    };
  }

  // Per spec §7.3: cannot patch a null merge — the LLM hasn't produced one.
  const current = row.proposedMergedContent as
    | { name: string; description: string; definition: object; instructions: string | null }
    | null;
  if (!current) {
    throw {
      statusCode: 409,
      message: 'merge proposal unavailable — re-run analysis',
    };
  }

  // Apply the partial patch.
  const next = {
    name: patch.name !== undefined ? patch.name : current.name,
    description: patch.description !== undefined ? patch.description : current.description,
    definition: patch.definition !== undefined ? patch.definition : current.definition,
    instructions: patch.instructions !== undefined ? patch.instructions : current.instructions,
  };

  // v2 §11.11.1: any merge edit wipes warning_resolutions + approval state so
  // stale decisions can't satisfy a new merge's warnings.
  const hadResolutions = Array.isArray(row.warningResolutions) && (row.warningResolutions as unknown[]).length > 0;
  await getOrgScopedDb('skillAnalyzerService.patchMergeFields.update')
    .update(skillAnalyzerResults)
    .set({
      proposedMergedContent: next,
      userEditedMerge: true,
      mergeUpdatedAt: new Date(),
      warningResolutions: [],
      executionResolvedName: null,
      approvedAt: null,
      approvalDecisionSnapshot: null,
      approvalHash: null,
      actionTaken: row.actionTaken === 'approved' ? null : row.actionTaken,
      actionTakenAt: row.actionTaken === 'approved' ? null : row.actionTakenAt,
    })
    .where(eq(skillAnalyzerResults.id, resultId));

  // Return the freshly enriched row.
  const updatedRows = await getOrgScopedDb('skillAnalyzerService.patchMergeFields.refetch')
    .select()
    .from(skillAnalyzerResults)
    .where(eq(skillAnalyzerResults.id, resultId))
    .limit(1);
  const updated = updatedRows[0];
  if (!updated) {
    throw { statusCode: 500, message: 'patchMergeFields: row vanished after update' };
  }

  let enriched: EnrichedResult = updated;
  if (updated.matchedSkillId) {
    try {
      const matched = await systemSkillService.getSkill(updated.matchedSkillId);
      enriched = {
        ...updated,
        matchedSkillContent: {
          id: matched.id,
          slug: matched.slug,
          name: matched.name,
          description: matched.description,
          definition: matched.definition as object,
          instructions: matched.instructions,
        },
      };
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404) {
        // Library skill deleted — leave matchedSkillContent omitted.
      } else {
        logger.error('[skillAnalyzer] Unexpected error fetching matched skill', {
          matchedSkillId: updated.matchedSkillId,
          error: String(err),
        });
        throw err;
      }
    }
  }
  if (hadResolutions) enriched.resolutionsCleared = true;
  return enriched;
}

/** Reset proposedMergedContent back to the LLM's original (untouched) merge.
 *  Used by the Phase 5 POST /merge/reset endpoint. Per spec §7.3 returns
 *  409 if originalProposedMerge is null on an eligible row. */
export async function resetMergeToOriginal(params: {
  resultId: string;
  jobId: string;
  organisationId: string;
}): Promise<EnrichedResult> {
  const { resultId, jobId, organisationId } = params;

  // Job ownership
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const jobRows = await db
    .select({ id: skillAnalyzerJobs.id })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);
  if (!jobRows[0]) {
    throw { statusCode: 404, message: 'Job not found' };
  }

  const resultRows = await getOrgScopedDb('skillAnalyzerService.resetMergeToOriginal.read')
    .select()
    .from(skillAnalyzerResults)
    .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)))
    .limit(1);
  const row = resultRows[0];
  if (!row) {
    throw { statusCode: 404, message: 'Result not found' };
  }

  if (row.classification !== 'PARTIAL_OVERLAP' && row.classification !== 'IMPROVEMENT') {
    throw {
      statusCode: 409,
      message: 'merge reset is only valid on PARTIAL_OVERLAP / IMPROVEMENT results',
    };
  }

  // v2 §11.11.2: locked result can't be reset without first unapproving.
  if (row.approvedAt) {
    throw {
      statusCode: 409,
      message: 'Result is locked — unapprove before resetting the merge.',
      errorCode: 'RESULT_LOCKED',
    };
  }

  if (!row.originalProposedMerge) {
    throw { statusCode: 409, message: 'no original merge proposal to reset from' };
  }

  // v2 §11.11.1: reset wipes resolutions + approval state identically to
  // PATCH /merge to keep invariants consistent.
  await getOrgScopedDb('skillAnalyzerService.resetMergeToOriginal.update')
    .update(skillAnalyzerResults)
    .set({
      proposedMergedContent: row.originalProposedMerge,
      userEditedMerge: false,
      mergeUpdatedAt: new Date(),
      warningResolutions: [],
      executionResolvedName: null,
      approvedAt: null,
      approvalDecisionSnapshot: null,
      approvalHash: null,
      actionTaken: row.actionTaken === 'approved' ? null : row.actionTaken,
      actionTakenAt: row.actionTaken === 'approved' ? null : row.actionTakenAt,
    })
    .where(eq(skillAnalyzerResults.id, resultId));

  const hadResolutions = Array.isArray(row.warningResolutions) && (row.warningResolutions as unknown[]).length > 0;

  // Return enriched row (matchedSkillContent included)
  const updatedRows = await getOrgScopedDb('skillAnalyzerService.resetMergeToOriginal.refetch')
    .select()
    .from(skillAnalyzerResults)
    .where(eq(skillAnalyzerResults.id, resultId))
    .limit(1);
  const updated = updatedRows[0];
  if (!updated) {
    throw { statusCode: 500, message: 'resetMergeToOriginal: row vanished after update' };
  }

  let enriched: EnrichedResult = updated;
  if (updated.matchedSkillId) {
    try {
      const matched = await systemSkillService.getSkill(updated.matchedSkillId);
      enriched = {
        ...updated,
        matchedSkillContent: {
          id: matched.id,
          slug: matched.slug,
          name: matched.name,
          description: matched.description,
          definition: matched.definition as object,
          instructions: matched.instructions,
        },
      };
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404) {
        // Library skill deleted — leave matchedSkillContent omitted.
      } else {
        logger.error('[skillAnalyzer] Unexpected error fetching matched skill', {
          matchedSkillId: updated.matchedSkillId,
          error: String(err),
        });
        throw err;
      }
    }
  }
  if (hadResolutions) enriched.resolutionsCleared = true;
  return enriched;
}

