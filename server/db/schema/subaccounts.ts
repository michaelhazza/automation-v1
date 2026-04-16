import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';

// Memory & Briefings spec — portal mode tier enum (migration 0131, §6.2)
export type PortalMode = 'hidden' | 'transparency' | 'collaborative';

// Memory & Briefings spec — clarification routing config shape (migration 0134, §5.4)
// Null at the column level means "use fallback chain defaults".
export interface ClarificationRoutingConfig {
  /** Explicit user ID to route clarifications to. Overrides the fallback chain. */
  primaryUserId?: string;
  /** Route client-domain questions through the portal when in collaborative mode. */
  routeClientQuestionsToPortal?: boolean;
}

export const subaccounts = pgTable(
  'subaccounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('active').$type<'active' | 'suspended' | 'inactive'>(),
    settings: jsonb('settings'),

    // ── Org-level inbox visibility ────────────────────────────────────
    // When true, inbox items from this subaccount appear in the org-wide inbox.
    // Configurable per subaccount by org admins.
    includeInOrgInbox: boolean('include_in_org_inbox').notNull().default(true),

    // ── Org subaccount flag ──────────────────────────────────────────
    // When true, this subaccount is the organisation's own workspace.
    // One per org (enforced by partial unique index). Cannot be soft-deleted
    // or have status changed away from 'active' (enforced by DB CHECK constraints).
    isOrgSubaccount: boolean('is_org_subaccount').notNull().default(false),

    // ── Memory & Briefings — portal mode (migration 0131, §6.2) ─────
    // Controls which client-portal features are visible to client contacts.
    // Default 'hidden' = portal exists but no memory/clarification surfaces shown.
    portalMode: text('portal_mode').notNull().default('hidden').$type<PortalMode>(),

    // ── Memory & Briefings — clarification routing (migration 0134, §5.4) ──
    // Null = use default fallback chain (subaccount_manager → agency_owner).
    clarificationRoutingConfig: jsonb('clarification_routing_config')
      .$type<ClarificationRoutingConfig | null>(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('subaccounts_org_idx').on(table.organisationId),
    orgStatusIdx: index('subaccounts_org_status_idx').on(table.organisationId, table.status),
    slugUniqueIdx: uniqueIndex('subaccounts_slug_unique_idx')
      .on(table.organisationId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type Subaccount = typeof subaccounts.$inferSelect;
export type NewSubaccount = typeof subaccounts.$inferInsert;
