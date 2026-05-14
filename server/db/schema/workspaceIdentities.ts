import { pgTable, uuid, text, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { workspaceActors } from './workspaceActors';
import { connectorConfigs } from './connectorConfigs';
import { users } from './users';

// Partial unique indexes (actor_backend_active, provisioning_request, email_per_config,
// migration_request_actor) live in SQL — Drizzle index DSL does not express partial indexes.
export const workspaceIdentities = pgTable(
  'workspace_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    actorId: uuid('actor_id').notNull().references(() => workspaceActors.id),
    connectorConfigId: uuid('connector_config_id').notNull().references(() => connectorConfigs.id),
    backend: text('backend').notNull(), // 'synthetos_native' | 'google_workspace'
    emailAddress: text('email_address').notNull(),
    emailSendingEnabled: boolean('email_sending_enabled').notNull().default(true),
    externalUserId: text('external_user_id'),
    displayName: text('display_name').notNull(),
    photoUrl: text('photo_url'),
    status: text('status').notNull().default('provisioned'), // workspace_identity_status enum enforced in SQL
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid('status_changed_by').references(() => users.id),
    provisioningRequestId: text('provisioning_request_id').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('workspace_identities_org_idx').on(table.organisationId),
    subaccountIdx: index('workspace_identities_subaccount_idx').on(table.subaccountId),
    actorIdx: index('workspace_identities_actor_idx').on(table.actorId),
    statusIdx: index('workspace_identities_status_idx').on(table.status),
  })
);

export type WorkspaceIdentity = typeof workspaceIdentities.$inferSelect;
export type NewWorkspaceIdentity = typeof workspaceIdentities.$inferInsert;
