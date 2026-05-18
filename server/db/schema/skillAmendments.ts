import { pgTable, uuid, text, integer, boolean, jsonb, doublePrecision, timestamp, index } from 'drizzle-orm/pg-core';
import type { AmendmentKind, AmendmentStatus, AmendmentSource, BlastRadius, RejectReason, RetirementReason, IncidentSeverity } from '../../../shared/types/skillAmendments.js';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { systemSkills } from './systemSkills';
import { skills } from './skills';
import { users } from './users';

// ---------------------------------------------------------------------------
// Skill Amendments — typed amendment overlay on skill instructions.
// Closed-Loop Skill Improvement spec §7.1 (migration 0370).
// ---------------------------------------------------------------------------

export const skillAmendments = pgTable(
  'skill_amendments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    // exactly one of systemSkillId / orgSkillId is non-null (XOR CHECK in migration)
    systemSkillId: uuid('system_skill_id').references(() => systemSkills.id),
    orgSkillId: uuid('org_skill_id').references(() => skills.id),
    kind: text('kind').notNull().$type<AmendmentKind>(),
    status: text('status').notNull().default('draft').$type<AmendmentStatus>(),
    source: text('source').notNull().$type<AmendmentSource>(),
    body: text('body').notNull(),
    blastRadiusEstimate: text('blast_radius_estimate').notNull().$type<BlastRadius>(),
    confidence: doublePrecision('confidence'),
    versionNumber: integer('version_number').notNull().default(1),
    // lineage_root_id: self-reference; no FK by design (avoids circular FK constraint)
    lineageRootId: uuid('lineage_root_id'),
    // scorecard_judgement_id: FK target identified Phase 2
    scorecardJudgementId: uuid('scorecard_judgement_id'),
    rcaRecordId: uuid('rca_record_id'),
    rcaJson: jsonb('rca_json'),
    proposerRunId: uuid('proposer_run_id'),
    proposerModelVersion: text('proposer_model_version'),
    peerReviewerModelVersion: text('peer_reviewer_model_version'),
    peerReviewerVerdict: boolean('peer_reviewer_verdict'),
    peerReviewerReasoning: text('peer_reviewer_reasoning'),
    // originating_correction_cluster_id: FK added Phase 2
    originatingCorrectionClusterId: uuid('originating_correction_cluster_id'),
    suppressedDuplicateCount: integer('suppressed_duplicate_count').notNull().default(0),
    occurrenceCount: integer('occurrence_count').notNull().default(0),
    rejectReason: text('reject_reason').$type<RejectReason>(),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectedByUserId: uuid('rejected_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retirementReason: text('retirement_reason').$type<RetirementReason>(),
    incidentSeverity: text('incident_severity').$type<IncidentSeverity>(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    activatedByUserId: uuid('activated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Partial unique on scorecardJudgementId WHERE status != 'retired' is a SQL partial index —
    // expressed as a raw index in migration; no Drizzle unique() helper for partial indexes.
    pendingIdx: index('skill_amendments_pending_idx').on(
      table.orgId,
      table.subaccountId,
      table.status,
      table.systemSkillId,
      table.orgSkillId,
    ),
  }),
);

export type SkillAmendment = typeof skillAmendments.$inferSelect;
export type NewSkillAmendment = typeof skillAmendments.$inferInsert;
