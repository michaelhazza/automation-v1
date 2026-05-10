import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';

export const webhookReplayNonces = pgTable(
  'webhook_replay_nonces',
  {
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    webhookSource: text('webhook_source').notNull(),
    nonce: text('nonce').notNull(),
    seenAt: timestamp('seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgSourceNonceUnique: uniqueIndex('webhook_replay_nonces_org_source_nonce_unique').on(
      table.organisationId,
      table.webhookSource,
      table.nonce,
    ),
    orgSourceSeenAtIdx: index('webhook_replay_nonces_org_source_seen_at_idx').on(
      table.organisationId,
      table.webhookSource,
      table.seenAt,
    ),
  }),
);

export type WebhookReplayNonce = typeof webhookReplayNonces.$inferSelect;
export type NewWebhookReplayNonce = typeof webhookReplayNonces.$inferInsert;
