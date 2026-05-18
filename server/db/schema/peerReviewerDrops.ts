import { pgTable, uuid, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

// ---------------------------------------------------------------------------
// Peer Reviewer Drops — records of amendments dropped by the peer reviewer.
// Closed-Loop Skill Improvement spec §7.3 (migration 0370).
// ---------------------------------------------------------------------------

export const peerReviewerDrops = pgTable(
  'peer_reviewer_drops',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organisations.id),
    scorecardJudgementId: uuid('scorecard_judgement_id').notNull(),
    dropReason: text('drop_reason').notNull(),
    peerReviewerModelVersion: text('peer_reviewer_model_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    judgementUniq: unique('peer_reviewer_drops_judgement_uniq').on(table.scorecardJudgementId),
  }),
);

export type PeerReviewerDrop = typeof peerReviewerDrops.$inferSelect;
export type NewPeerReviewerDrop = typeof peerReviewerDrops.$inferInsert;
