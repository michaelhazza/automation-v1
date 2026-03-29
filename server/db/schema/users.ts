import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    role: text('role')
      .notNull()
      .default('user')
      .$type<'system_admin' | 'org_admin' | 'manager' | 'user' | 'client_user'>(),
    status: text('status').notNull().default('pending').$type<'active' | 'inactive' | 'pending'>(),
    inviteToken: text('invite_token'),
    inviteExpiresAt: timestamp('invite_expires_at'),
    invitedByUserId: uuid('invited_by_user_id'),
    passwordResetToken: text('password_reset_token'),
    passwordResetExpiresAt: timestamp('password_reset_expires_at'),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    emailUniqueIdx: uniqueIndex('users_email_unique_idx')
      .on(table.organisationId, table.email)
      .where(sql`${table.deletedAt} IS NULL`),
    orgRoleIdx: index('users_org_role_idx').on(table.organisationId, table.role),
    orgIdIdx: index('users_org_id_idx').on(table.organisationId),
    roleIdx: index('users_role_idx').on(table.role),
    statusIdx: index('users_status_idx').on(table.status),
    inviteTokenIdx: uniqueIndex('users_invite_token_idx')
      .on(table.inviteToken)
      .where(sql`${table.inviteToken} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
