import { pgTable, uuid, text, integer, timestamp, index, unique } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// compute_reservations — soft reservation system for concurrency safety
//
// Created before each LLM call. Compute Budget checks include active
// reservations so two concurrent requests each see each other and block
// correctly. No database locks. No serialised requests.
//
// Renamed from budget_reservations in migration 0270_compute_budget_rename.sql.
// ---------------------------------------------------------------------------

export const computeReservations = pgTable(
  'compute_reservations',
  {
    id:                   uuid('id').defaultRandom().primaryKey(),
    idempotencyKey:       text('idempotency_key').notNull(),
    entityType:           text('entity_type').notNull(),
    // 'subaccount' | 'run' | 'organisation'
    entityId:             text('entity_id').notNull(),
    estimatedCostCents:   integer('estimated_cost_cents').notNull(),
    // Set on completion — enables delta release back to available compute budget
    actualCostCents:      integer('actual_cost_cents'),
    status:               text('status').notNull().default('active'),
    // 'active' | 'committed' | 'released'
    createdAt:            timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt:            timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    // H-1: true UNIQUE — prevents duplicate inserts on concurrent requests
    idempotencyUnique: unique('compute_reservations_idempotency_key_unique').on(table.idempotencyKey),
    entityStatusIdx:   index('compute_reservations_entity_status_idx').on(table.entityType, table.entityId, table.status),
    expiresIdx:        index('compute_reservations_expires_idx').on(table.expiresAt),
  }),
);

export type ComputeReservation = typeof computeReservations.$inferSelect;
