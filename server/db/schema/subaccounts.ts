import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
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

    // ── Phase 4 — portal features toggle grid (migration 0132, §6.3) ─────
    // Per-client feature-level toggles. Only consulted when portalMode is
    // 'collaborative'. Empty object is valid — portalGate falls back to
    // registry defaults (all ON).
    portalFeatures: jsonb('portal_features')
      .notNull()
      .default({})
      .$type<Partial<{
        dropZone: boolean;
        clarificationRouting: boolean;
        taskRequests: boolean;
        memoryInspector: boolean;
        healthDigest: boolean;
      }>>(),

    // ── Phase 4 — client upload trust state (migration 0133, §5.5) ──────
    clientUploadTrustState: jsonb('client_upload_trust_state')
      .notNull()
      .default({ approvedCount: 0, trustedAt: null, resetAt: null })
      .$type<{ approvedCount: number; trustedAt: string | null; resetAt: string | null }>(),

    // ── Pulse — per-subaccount retention override (migration 0160) ──
    runRetentionDays: integer('run_retention_days'),

    // ── Sub-Account Optimiser — opt-out toggle (migration 0267, spec §4) ──
    // Default true: every sub-account participates in daily optimiser scans
    // unless the operator explicitly opts out via admin SQL or Configuration Assistant.
    optimiserEnabled: boolean('optimiser_enabled').notNull().default(true),

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
