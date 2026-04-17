import { pgTable, uuid, text, real, jsonb, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// Memory Review Queue — HITL queue for memory items requiring human review
// Memory & Briefings spec Phase 1 (migration 0139, §5.3 — S3, S7, S11)
// ---------------------------------------------------------------------------

// Item types surfaced for human review
export type MemoryReviewItemType =
  | 'belief_conflict'       // Two agents hold contradicting beliefs; reviewer picks
  | 'block_proposal'        // Auto-synthesised block awaiting activation
  | 'clarification_pending'; // Agent clarification request (audit trail only)

// Resolution statuses
export type MemoryReviewStatus =
  | 'pending'      // Awaiting human decision
  | 'approved'     // Human approved; downstream service applies the change
  | 'rejected'     // Human rejected
  | 'auto_applied' // Confidence > threshold; applied without human review
  | 'expired';     // expires_at passed without a decision

export const memoryReviewQueue = pgTable(
  'memory_review_queue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),

    // Type of item requiring review
    itemType: text('item_type').notNull().$type<MemoryReviewItemType>(),

    // Item-type-specific payload (shape varies by itemType)
    payload: jsonb('payload').notNull(),

    // Confidence score that drove the routing decision
    confidence: real('confidence').notNull(),

    // Resolution status
    status: text('status').notNull().default('pending').$type<MemoryReviewStatus>(),

    // Optional TTL — item auto-expires at this timestamp if unresolved
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // Agent that created this review item (nullable for system-generated)
    createdByAgentId: uuid('created_by_agent_id'),

    // Resolution tracking
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

    // PR Review Hardening — Item 4: clarification dependency flag.
    // When true the run that triggered this clarification must not have its
    // outputs used by synthesis if the clarification timed out.
    requiresClarification: boolean('requires_clarification').notNull().default(false),
  },
  (table) => ({
    // Primary query path: per-subaccount queue sorted by recency
    subaccountStatusIdx: index('memory_review_queue_subaccount_status_idx')
      .on(table.subaccountId, table.status, table.createdAt),
    // Org-level rollup counts
    orgStatusIdx: index('memory_review_queue_org_status_idx')
      .on(table.organisationId, table.status),
  })
);

export type MemoryReviewQueueItem = typeof memoryReviewQueue.$inferSelect;
export type NewMemoryReviewQueueItem = typeof memoryReviewQueue.$inferInsert;
