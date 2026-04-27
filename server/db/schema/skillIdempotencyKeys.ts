import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, jsonb, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

export const skillIdempotencyKeys = pgTable('skill_idempotency_keys', {
  subaccountId: uuid('subaccount_id').notNull(),
  organisationId: uuid('organisation_id').notNull(),
  skillSlug: text('skill_slug').notNull(),
  keyHash: text('key_hash').notNull(),
  requestHash: text('request_hash').notNull(),
  responsePayload: jsonb('response_payload').notNull().default({}),
  status: text('status').notNull().default('in_flight').$type<'in_flight' | 'completed' | 'failed'>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => ({
  pk: primaryKey({ columns: [table.subaccountId, table.skillSlug, table.keyHash] }),
  expiresAtIdx: index('skill_idempotency_keys_expires_at_idx').on(table.expiresAt).where(sql`${table.expiresAt} IS NOT NULL`),
  orgIdx: index('skill_idempotency_keys_org_idx').on(table.organisationId),
}));

export type SkillIdempotencyKey = typeof skillIdempotencyKeys.$inferSelect;
export type NewSkillIdempotencyKey = typeof skillIdempotencyKeys.$inferInsert;
