import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// llm_inflight_history — durable forensic log of in-flight add/remove events.
//
// Deferred-items brief §6. The live in-flight registry is in-memory per
// process; when an operator wants to know "what was running at 3:17am
// last Tuesday during the outage", the ledger has the completed calls
// but nothing about the in-flight ones that got swept, orphaned, or
// evicted before their terminal status could land.
//
// This table captures every `added` and `removed` event with its full
// payload, TTL 7 days by default. Reads are system-admin only and
// intentionally cross-tenant (same posture as llm_requests_archive).
//
// Write path: `server/services/llmInflightRegistry.ts` persists events
// fire-and-forget (try/catch + log on failure) — a DB hiccup must not
// delay the sub-second socket emit.
// ---------------------------------------------------------------------------

export const llmInflightHistory = pgTable(
  'llm_inflight_history',
  {
    id:             uuid('id').defaultRandom().primaryKey(),
    runtimeKey:     text('runtime_key').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    organisationId: uuid('organisation_id'),
    subaccountId:   uuid('subaccount_id'),
    // 'added' | 'removed'
    eventKind:      text('event_kind').notNull(),
    // Full InFlightEntry (on 'added') or InFlightRemoval (on 'removed').
    // Stored as jsonb so we can inspect provider, model, featureTag,
    // terminalStatus, etc. without exploding the table schema.
    eventPayload:   jsonb('event_payload').notNull(),
    // For 'removed' events — lifted out of the payload so queries like
    // "show me every swept_stale in the last hour" don't need jsonb ops.
    terminalStatus: text('terminal_status'),
    createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx:        index('llm_inflight_history_created_at_idx').on(table.createdAt),
    runtimeKeyIdx:       index('llm_inflight_history_runtime_key_idx').on(table.runtimeKey),
    idempotencyKeyIdx:   index('llm_inflight_history_idempotency_key_idx').on(table.idempotencyKey),
    orgCreatedAtIdx:     index('llm_inflight_history_org_created_at_idx')
      .on(table.organisationId, table.createdAt),
  }),
);

export type LlmInflightHistoryRow = typeof llmInflightHistory.$inferSelect;
export type NewLlmInflightHistoryRow = typeof llmInflightHistory.$inferInsert;
