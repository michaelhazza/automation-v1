// ---------------------------------------------------------------------------
// skillAmendmentService — lifecycle management for skill amendments.
// Closed-Loop Skill Improvement spec §7.1, §9.1, §11, §12, §18 (Chunks 4–5).
// ---------------------------------------------------------------------------

import { eq, and, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { skillAmendments, skillAmendmentFreezes, systemSkills, skills } from '../db/schema/index.js';
import { assertValidAmendmentTransition } from './skillAmendmentServiceStateMachinePure.js';
import { invalidateResolverCache } from './skillService.js';
import { logger } from '../lib/logger.js';
import type {
  AmendmentKind,
  AmendmentStatus,
  RejectReason,
  RetirementReason,
  IncidentSeverity,
  FreezeScope,
  FreezeType,
  AmendmentListItem,
  AmendmentDetail,
  AmendmentSkillDetail,
} from '../../shared/types/skillAmendments.js';
import type { SkillAmendmentFreeze } from '../db/schema/skillAmendmentFreezes.js';

const IMPERATIVE_MODAL_PATTERN = /\b(must|should|never|always|do not|don['']t|do)\b/i;

const KIND_CEILINGS: Record<AmendmentKind, number> = {
  instruction_extension: 800,
  example: 1500,
  guardrail: 400,
  context_fact: 300,
  exception: 600,
};

const EVALUATOR_TARGETS = ['scorecard_judge_prompt', 'rca_proposer_prompt', 'peer_review_prompt'];

/**
 * Validate an amendment body against per-kind rules.
 *
 * Rules:
 * - Body must not exceed the KIND_CEILINGS[kind] character limit.
 * - For context_fact: body must not contain imperative-modal language.
 * - For any kind: body must not reference evaluator-surface target strings
 *   (anti-recursion guard per §6.2 / §8.2).
 */
export function validateAmendmentBody(
  kind: AmendmentKind,
  body: string,
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  const ceiling = KIND_CEILINGS[kind];
  if (body.length > ceiling) {
    errors.push(`body exceeds ${ceiling}-character limit for kind '${kind}' (got ${body.length})`);
  }

  if (kind === 'context_fact' && IMPERATIVE_MODAL_PATTERN.test(body)) {
    errors.push("context_fact body must use declarative language only — imperative modal words (must, should, never, always, do not, don't, do) are not allowed");
  }

  for (const target of EVALUATOR_TARGETS) {
    if (body.includes(target)) {
      errors.push(`body must not reference evaluator surface '${target}' (anti-recursion rule)`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSkillSlugFromRow(row: { systemSkillSlug: string | null; orgSkillSlug: string | null }): string {
  return row.systemSkillSlug ?? row.orgSkillSlug ?? '';
}

function extractRcaField(rcaJson: Record<string, unknown> | null, field: string): string | null {
  if (!rcaJson) return null;
  const val = rcaJson[field];
  return typeof val === 'string' ? val : null;
}

// ---------------------------------------------------------------------------
// skillAmendmentService
// ---------------------------------------------------------------------------

export const skillAmendmentService = {
  validateAmendmentBody,

  // ── List pending amendments (priority-ordered per spec §13.1) ──────────────

  async listPendingAmendments(orgId: string, subaccountId: string): Promise<AmendmentListItem[]> {
    const db = getOrgScopedDb('skillAmendmentService.listPendingAmendments');
    const rows = await db
      .select({
        id: skillAmendments.id,
        kind: skillAmendments.kind,
        status: skillAmendments.status,
        systemSkillSlug: systemSkills.slug,
        orgSkillSlug: skills.slug,
        blastRadiusEstimate: skillAmendments.blastRadiusEstimate,
        incidentSeverity: skillAmendments.incidentSeverity,
        occurrenceCount: skillAmendments.occurrenceCount,
        rcaJson: skillAmendments.rcaJson,
        createdAt: skillAmendments.createdAt,
      })
      .from(skillAmendments)
      .leftJoin(systemSkills, eq(skillAmendments.systemSkillId, systemSkills.id))
      .leftJoin(skills, eq(skillAmendments.orgSkillId, skills.id))
      .where(
        and(
          eq(skillAmendments.orgId, orgId),
          eq(skillAmendments.subaccountId, subaccountId),
          eq(skillAmendments.status, 'pending_review'),
        ),
      )
      .orderBy(
        sql`CASE WHEN ${skillAmendments.incidentSeverity} IS NOT NULL THEN 0 ELSE 1 END`,
        sql`CASE ${skillAmendments.blastRadiusEstimate} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
        sql`${skillAmendments.occurrenceCount} DESC`,
        skillAmendments.createdAt,
      );

    return rows.map((row) => {
      const rcaJson = row.rcaJson as Record<string, unknown> | null;
      const remedyKind = extractRcaField(rcaJson, 'proposed_remedy_kind');
      return {
        id: row.id,
        kind: row.kind,
        status: row.status as AmendmentStatus,
        skillSlug: getSkillSlugFromRow(row),
        blastRadiusEstimate: row.blastRadiusEstimate,
        incidentSeverity: row.incidentSeverity ?? null,
        occurrenceCount: row.occurrenceCount,
        failureMode: extractRcaField(rcaJson, 'failure_mode'),
        proposedRemedyKind: (remedyKind && remedyKind !== 'no_remedy_proposed' ? remedyKind : null) as AmendmentKind | null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  },

  // ── Get one amendment ──────────────────────────────────────────────────────

  async getAmendment(id: string, orgId: string): Promise<AmendmentDetail> {
    const db = getOrgScopedDb('skillAmendmentService.getAmendment');
    const [row] = await db
      .select({
        id: skillAmendments.id,
        kind: skillAmendments.kind,
        status: skillAmendments.status,
        systemSkillSlug: systemSkills.slug,
        orgSkillSlug: skills.slug,
        blastRadiusEstimate: skillAmendments.blastRadiusEstimate,
        incidentSeverity: skillAmendments.incidentSeverity,
        occurrenceCount: skillAmendments.occurrenceCount,
        rcaJson: skillAmendments.rcaJson,
        createdAt: skillAmendments.createdAt,
        body: skillAmendments.body,
        source: skillAmendments.source,
        confidence: skillAmendments.confidence,
        peerReviewerVerdict: skillAmendments.peerReviewerVerdict,
        peerReviewerReasoning: skillAmendments.peerReviewerReasoning,
        lineageRootId: skillAmendments.lineageRootId,
        versionNumber: skillAmendments.versionNumber,
        subaccountId: skillAmendments.subaccountId,
      })
      .from(skillAmendments)
      .leftJoin(systemSkills, eq(skillAmendments.systemSkillId, systemSkills.id))
      .leftJoin(skills, eq(skillAmendments.orgSkillId, skills.id))
      .where(and(eq(skillAmendments.id, id), eq(skillAmendments.orgId, orgId)));

    if (!row) throw { statusCode: 404, message: 'Amendment not found' };

    const rcaJson = row.rcaJson as Record<string, unknown> | null;
    const remedyKind = extractRcaField(rcaJson, 'proposed_remedy_kind');
    return {
      id: row.id,
      kind: row.kind,
      status: row.status as AmendmentStatus,
      skillSlug: getSkillSlugFromRow(row),
      blastRadiusEstimate: row.blastRadiusEstimate,
      incidentSeverity: row.incidentSeverity ?? null,
      occurrenceCount: row.occurrenceCount,
      failureMode: extractRcaField(rcaJson, 'failure_mode'),
      proposedRemedyKind: (remedyKind && remedyKind !== 'no_remedy_proposed' ? remedyKind : null) as AmendmentKind | null,
      createdAt: row.createdAt.toISOString(),
      body: row.body,
      source: row.source,
      confidence: row.confidence ?? null,
      peerReviewerVerdict: row.peerReviewerVerdict ?? null,
      peerReviewerReasoning: row.peerReviewerReasoning ?? null,
      rcaJson: rcaJson,
      lineageRootId: row.lineageRootId ?? null,
      versionNumber: row.versionNumber,
      subaccountId: row.subaccountId,
    };
  },

  // ── accept ─────────────────────────────────────────────────────────────────

  async accept(
    id: string,
    userId: string,
    _role: string,
    orgId: string,
    _subaccountId: string,
  ): Promise<{ amendmentId: string }> {
    assertValidAmendmentTransition({ from: 'pending_review', to: 'accepted' });

    const db = getOrgScopedDb('skillAmendmentService.accept');
    const result = await db
      .update(skillAmendments)
      .set({
        status: 'accepted',
        activatedAt: new Date(),
        activatedByUserId: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(skillAmendments.id, id), eq(skillAmendments.orgId, orgId), eq(skillAmendments.status, 'pending_review')))
      .returning({ systemSkillId: skillAmendments.systemSkillId, orgSkillId: skillAmendments.orgSkillId, subaccountId: skillAmendments.subaccountId });

    if (result.length === 0) {
      throw { statusCode: 409, message: 'invalid_state_transition', errorCode: 'amendment_state_conflict' };
    }

    const row = result[0];
    invalidateResolverCache({
      orgId,
      systemSkillId: row.systemSkillId ?? null,
      orgSkillId: row.orgSkillId ?? null,
      subaccountId: row.subaccountId,
    });

    logger.info('skill_amendment.accepted', { amendmentId: id, userId, orgId });

    return { amendmentId: id };
  },

  // ── acceptAfterEdit ────────────────────────────────────────────────────────

  async acceptAfterEdit(
    id: string,
    editedBody: string,
    userId: string,
    _role: string,
    orgId: string,
    subaccountId: string,
  ): Promise<{ originalId: string; newAmendmentId: string }> {
    const db = getOrgScopedDb('skillAmendmentService.acceptAfterEdit');

    const [original] = await db
      .select()
      .from(skillAmendments)
      .where(and(eq(skillAmendments.id, id), eq(skillAmendments.orgId, orgId)));

    if (!original) throw { statusCode: 404, message: 'Amendment not found' };

    const bodyValidation = validateAmendmentBody(original.kind, editedBody);
    if (!bodyValidation.valid) {
      throw { statusCode: 422, message: 'invalid_amendment_body', errorCode: 'body_validation_failed', details: bodyValidation.errors };
    }

    const rejectResult = await db
      .update(skillAmendments)
      .set({
        status: 'rejected',
        rejectReason: 'other',
        rejectedAt: new Date(),
        rejectedByUserId: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(skillAmendments.id, id), eq(skillAmendments.orgId, orgId), eq(skillAmendments.status, 'pending_review')))
      .returning({ id: skillAmendments.id });

    if (rejectResult.length === 0) {
      throw { statusCode: 409, message: 'invalid_state_transition', errorCode: 'amendment_state_conflict' };
    }

    const [newRow] = await db
      .insert(skillAmendments)
      .values({
        orgId: original.orgId,
        subaccountId: original.subaccountId,
        systemSkillId: original.systemSkillId,
        orgSkillId: original.orgSkillId,
        kind: original.kind,
        status: 'accepted',
        source: original.source,
        body: editedBody,
        blastRadiusEstimate: original.blastRadiusEstimate,
        confidence: original.confidence,
        versionNumber: original.versionNumber + 1,
        lineageRootId: original.lineageRootId ?? original.id,
        scorecardJudgementId: original.scorecardJudgementId,
        rcaRecordId: original.rcaRecordId,
        rcaJson: original.rcaJson,
        proposerRunId: original.proposerRunId,
        proposerModelVersion: original.proposerModelVersion,
        activatedAt: new Date(),
        activatedByUserId: userId,
      })
      .returning({ id: skillAmendments.id });

    invalidateResolverCache({
      orgId,
      systemSkillId: original.systemSkillId ?? null,
      orgSkillId: original.orgSkillId ?? null,
      subaccountId: original.subaccountId,
    });

    logger.info('skill_amendment.accepted_after_edit', { originalId: id, newAmendmentId: newRow.id, userId, orgId, subaccountId });

    return { originalId: id, newAmendmentId: newRow.id };
  },

  // ── reject ─────────────────────────────────────────────────────────────────

  async reject(
    id: string,
    rejectReason: RejectReason,
    userId: string,
    _role: string,
    orgId: string,
  ): Promise<{ amendmentId: string }> {
    assertValidAmendmentTransition({ from: 'pending_review', to: 'rejected' });

    const db = getOrgScopedDb('skillAmendmentService.reject');
    const result = await db
      .update(skillAmendments)
      .set({
        status: 'rejected',
        rejectReason,
        rejectedAt: new Date(),
        rejectedByUserId: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(skillAmendments.id, id), eq(skillAmendments.orgId, orgId), eq(skillAmendments.status, 'pending_review')))
      .returning({ systemSkillId: skillAmendments.systemSkillId, orgSkillId: skillAmendments.orgSkillId, subaccountId: skillAmendments.subaccountId });

    if (result.length === 0) {
      throw { statusCode: 409, message: 'invalid_state_transition', errorCode: 'amendment_state_conflict' };
    }

    const row = result[0];
    invalidateResolverCache({
      orgId,
      systemSkillId: row.systemSkillId ?? null,
      orgSkillId: row.orgSkillId ?? null,
      subaccountId: row.subaccountId,
    });

    logger.info('skill_amendment.rejected', { amendmentId: id, rejectReason, userId, orgId });

    return { amendmentId: id };
  },

  // ── retire ─────────────────────────────────────────────────────────────────

  async retire(
    id: string,
    retirementReason: RetirementReason,
    orgId: string,
    incidentSeverity?: IncidentSeverity,
  ): Promise<{ amendmentId: string }> {
    const db = getOrgScopedDb('skillAmendmentService.retire');

    const [current] = await db
      .select({ status: skillAmendments.status, systemSkillId: skillAmendments.systemSkillId, orgSkillId: skillAmendments.orgSkillId, subaccountId: skillAmendments.subaccountId })
      .from(skillAmendments)
      .where(and(eq(skillAmendments.id, id), eq(skillAmendments.orgId, orgId)));

    if (!current) throw { statusCode: 404, message: 'Amendment not found' };

    assertValidAmendmentTransition({ from: current.status as AmendmentStatus, to: 'retired', reason: retirementReason });

    const result = await db
      .update(skillAmendments)
      .set({
        status: 'retired',
        retiredAt: new Date(),
        retirementReason,
        incidentSeverity: incidentSeverity ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(skillAmendments.id, id), eq(skillAmendments.orgId, orgId), eq(skillAmendments.status, current.status)))
      .returning({ id: skillAmendments.id });

    if (result.length === 0) {
      throw { statusCode: 409, message: 'invalid_state_transition', errorCode: 'amendment_state_conflict' };
    }

    invalidateResolverCache({
      orgId,
      systemSkillId: current.systemSkillId ?? null,
      orgSkillId: current.orgSkillId ?? null,
      subaccountId: current.subaccountId,
    });

    logger.info('skill_amendment.retired', { amendmentId: id, retirementReason, orgId });

    return { amendmentId: id };
  },

  // ── listAmendmentsForSkill ─────────────────────────────────────────────────

  async listAmendmentsForSkill(
    skillId: string,
    orgId: string,
    subaccountId: string,
  ): Promise<AmendmentSkillDetail[]> {
    const db = getOrgScopedDb('skillAmendmentService.listAmendmentsForSkill');
    const rows = await db
      .select({
        id: skillAmendments.id,
        kind: skillAmendments.kind,
        status: skillAmendments.status,
        body: skillAmendments.body,
        source: skillAmendments.source,
        blastRadiusEstimate: skillAmendments.blastRadiusEstimate,
        confidence: skillAmendments.confidence,
        versionNumber: skillAmendments.versionNumber,
        lineageRootId: skillAmendments.lineageRootId,
        activatedAt: skillAmendments.activatedAt,
        retiredAt: skillAmendments.retiredAt,
        retirementReason: skillAmendments.retirementReason,
        rejectedAt: skillAmendments.rejectedAt,
        rejectReason: skillAmendments.rejectReason,
        createdAt: skillAmendments.createdAt,
      })
      .from(skillAmendments)
      .where(
        and(
          eq(skillAmendments.orgId, orgId),
          eq(skillAmendments.subaccountId, subaccountId),
          sql`(${skillAmendments.systemSkillId} = ${skillId}::uuid OR ${skillAmendments.orgSkillId} = ${skillId}::uuid)`,
        ),
      )
      .orderBy(skillAmendments.createdAt);

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status as AmendmentStatus,
      body: row.body,
      source: row.source,
      blastRadiusEstimate: row.blastRadiusEstimate,
      confidence: row.confidence ?? null,
      versionNumber: row.versionNumber,
      lineageRootId: row.lineageRootId ?? null,
      activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
      retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
      retirementReason: row.retirementReason ?? null,
      rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
      rejectReason: row.rejectReason ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  },

  // ── freezes ────────────────────────────────────────────────────────────────

  freezes: {
    async list(orgId: string, subaccountId: string): Promise<SkillAmendmentFreeze[]> {
      const db = getOrgScopedDb('skillAmendmentService.freezes.list');
      return db
        .select()
        .from(skillAmendmentFreezes)
        .where(and(eq(skillAmendmentFreezes.orgId, orgId), eq(skillAmendmentFreezes.subaccountId, subaccountId)))
        .orderBy(skillAmendmentFreezes.createdAt);
    },

    async create(input: {
      scope: FreezeScope;
      scopeId?: string;
      freezeType: FreezeType;
      reason: string;
      orgId: string;
      subaccountId: string;
      userId: string;
      role: string;
    }): Promise<{ freezeId: string }> {
      const db = getOrgScopedDb('skillAmendmentService.freezes.create');
      try {
        const [row] = await db
          .insert(skillAmendmentFreezes)
          .values({
            orgId: input.orgId,
            subaccountId: input.subaccountId,
            scope: input.scope,
            scopeId: input.scopeId ?? null,
            freezeType: input.freezeType,
            reason: input.reason,
            createdByUserId: input.userId,
          })
          .returning({ id: skillAmendmentFreezes.id });
        return { freezeId: row.id };
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505') {
          throw { statusCode: 409, message: 'duplicate_active_freeze', errorCode: 'freeze_conflict' };
        }
        throw err;
      }
    },

    async thaw(freezeId: string, userId: string, orgId: string): Promise<void> {
      const db = getOrgScopedDb('skillAmendmentService.freezes.thaw');
      const result = await db
        .update(skillAmendmentFreezes)
        .set({ thawedAt: new Date(), thawedByUserId: userId })
        .where(
          and(
            eq(skillAmendmentFreezes.id, freezeId),
            eq(skillAmendmentFreezes.orgId, orgId),
            sql`${skillAmendmentFreezes.thawedAt} IS NULL`,
          ),
        )
        .returning({ id: skillAmendmentFreezes.id });

      if (result.length === 0) {
        throw { statusCode: 409, message: 'freeze_already_thawed_or_not_found', errorCode: 'freeze_conflict' };
      }
    },
  },
};
