import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// Delegation Grants — time-bounded permission grants from a human user to
// another user or service principal, scoped to specific canonical tables and
// actions within an organisation (optionally narrowed to a subaccount).
// ---------------------------------------------------------------------------

export const delegationGrants = pgTable(
  'delegation_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    grantorUserId: uuid('grantor_user_id').notNull().references(() => users.id),
    granteeKind: text('grantee_kind').notNull().$type<'user' | 'service'>(),
    granteeId: text('grantee_id').notNull(),
    subaccountId: uuid('subaccount_id'),
    allowedCanonicalTables: text('allowed_canonical_tables').array().notNull(),
    allowedActions: text('allowed_actions').array().notNull(),
    reason: text('reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('delegation_grants_org_idx').on(table.organisationId),
    activeIdx: uniqueIndex('delegation_grants_active_idx')
      .on(table.grantorUserId, table.granteeKind, table.granteeId, table.subaccountId)
      .where(sql`${table.revokedAt} IS NULL`),
  })
);

export type DelegationGrant = typeof delegationGrants.$inferSelect;
export type NewDelegationGrant = typeof delegationGrants.$inferInsert;
