import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';

// ---------------------------------------------------------------------------
// workspace_health_findings — Brain Tree OS adoption P4
//
// Stores derived health findings from the workspace audit. One row per
// (org, detector, resource) — the unique constraint makes the upsert
// pattern naturally idempotent.
//
// See docs/brain-tree-os-adoption-spec.md §P4 for the detector list.
// ---------------------------------------------------------------------------

export type WorkspaceHealthSeverity = 'info' | 'warning' | 'critical';
export type WorkspaceHealthResourceKind = 'agent' | 'subaccount_agent' | 'automation' | 'subaccount' | 'org' | 'connection';

export const workspaceHealthFindings = pgTable(
  'workspace_health_findings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    detector: text('detector').notNull(),
    severity: text('severity').notNull().$type<WorkspaceHealthSeverity>(),
    resourceKind: text('resource_kind').notNull().$type<WorkspaceHealthResourceKind>(),
    // text, not uuid — most resources are uuids but some detectors (e.g.
    // process.broken_connection_mapping) emit composite keys to keep
    // per-subaccount findings distinct under the unique constraint.
    resourceId: text('resource_id').notNull(),
    resourceLabel: text('resource_label').notNull(),
    message: text('message').notNull(),
    recommendation: text('recommendation').notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => ({
    // Mirrors the SQL UNIQUE constraint declared in migration 0096
    detectorResourceUnique: unique('workspace_health_findings_unique').on(
      table.organisationId,
      table.detector,
      table.resourceId,
    ),
    // Active findings hot-path
    orgSeverityIdx: index('wh_org_severity_idx')
      .on(table.organisationId, table.severity)
      .where(sql`${table.resolvedAt} IS NULL`),
    resourceIdx: index('wh_resource_idx').on(table.resourceKind, table.resourceId),
  }),
);

export type WorkspaceHealthFinding = typeof workspaceHealthFindings.$inferSelect;
export type NewWorkspaceHealthFinding = typeof workspaceHealthFindings.$inferInsert;
