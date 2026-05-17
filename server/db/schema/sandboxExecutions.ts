import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { CredentialIssuanceAlias, SandboxExecutionStatus, SandboxPolicy, SandboxProviderName } from '../../../shared/types/sandbox.js';
import { subaccounts } from './subaccounts.js';

// ---------------------------------------------------------------------------
// sandbox_executions — one row per sandbox task execution (spec §20.3).
// Includes F3 lease columns for start-claim idempotency (spec §8.1).
// ---------------------------------------------------------------------------

export const sandboxExecutions = pgTable(
  'sandbox_executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'restrict' }),
    runId: uuid('run_id').notNull(),
    agentId: uuid('agent_id').notNull(),
    taskId: text('task_id').notNull(),

    // Provider info
    provider: text('provider').notNull().$type<SandboxProviderName>(),
    // Set when provider start succeeds; primary correlation key for provider-side reconciliation.
    // NULL while pending.
    providerSandboxId: text('provider_sandbox_id'),
    providerProject: text('provider_project'),

    // Template pinning (spec §15.3)
    templateName: text('template_name').notNull(),
    templateVersion: text('template_version').notNull(),
    templateDigest: text('template_digest'),
    templateBuildCommit: text('template_build_commit'),

    // State machine (spec §13.1)
    status: text('status').notNull().default('pending').$type<SandboxExecutionStatus>(),

    // Policy snapshot (spec §20.1) — sandbox-specific projection of the calling run's Policy Envelope
    policyJson: jsonb('policy_json').notNull().$type<SandboxPolicy>(),

    // Credential aliases permitted for this execution (spec §6.3 SANDBOX-ADV-6.1).
    // Populated at run creation; empty array means no credentials injected.
    // Stored as the full CredentialIssuanceAlias[] payload so reconciliation can
    // rebuild redaction patterns identically to the canonical harvest path.
    credentialAliases: jsonb('credential_aliases').notNull().$type<CredentialIssuanceAlias[]>().default([]),

    // Input summary (size + MIME + file count — no content)
    inputSummaryJson: jsonb('input_summary_json'),

    // Harvest outputs (populated on terminal)
    outputJson: jsonb('output_json'),
    metricsJson: jsonb('metrics_json'),
    costCents: integer('cost_cents'),
    errorReason: text('error_reason'),
    errorDetail: text('error_detail'),

    // Attempt tracking (for crash retries — spec §13.2)
    attemptNumber: integer('attempt_number').notNull().default(1),

    // F3 start-claim lease columns (spec §8.1)
    // Set when a worker claims the pending row; NULL after status moves to running.
    startClaimedAt: timestamp('start_claimed_at', { withTimezone: true }),
    // start_claimed_at + lease_window; reclaimable by another worker after expiry.
    startClaimExpiresAt: timestamp('start_claim_expires_at', { withTimezone: true }),
    // Incremented on every lease reclaim. Cap at MAX_START_ATTEMPTS → provider_unavailable.
    startAttemptCount: integer('start_attempt_count').notNull().default(0),

    // Operator Backend adoption seam (spec §7.1, Chunk 4 sandbox primitive extension).
    // Set by adoptOrStart() callers; the Operator Backend passes operator_run_id.
    // UNIQUE: a given start-key binds to exactly one sandbox execution (conflict detection).
    sandboxStartKey: text('sandbox_start_key'),

    // Soft-delete flag (spec §17.4)
    isActive: boolean('is_active').notNull().default(true),

    // Timestamps
    startedAt: timestamp('started_at', { withTimezone: true }),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
    harvestedAt: timestamp('harvested_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgStartedAtIdx: index('sandbox_executions_org_started_at_idx').on(table.organisationId, table.startedAt),
    subaccountStartedAtIdx: index('sandbox_executions_subaccount_started_at_idx').on(table.subaccountId, table.startedAt),
    runIdIdx: index('sandbox_executions_run_id_idx').on(table.runId),
    // Partial index for reconciliation queries (spec §20.3)
    statusPendingIdx: index('sandbox_executions_status_pending_idx')
      .on(table.status)
      .where(sql`${table.status} IN ('pending', 'running', 'harvesting')`),
    // Partial index for provider-webhook-driven reconciliation lookups (spec §20.3)
    providerSandboxIdIdx: index('sandbox_executions_provider_sandbox_id_idx')
      .on(table.providerSandboxId)
      .where(sql`${table.providerSandboxId} IS NOT NULL`),
    // Unique partial index: one sandbox per start-key (adoption seam, Chunk 4).
    sandboxStartKeyIdx: uniqueIndex('sandbox_executions_start_key_idx')
      .on(table.sandboxStartKey)
      .where(sql`${table.sandboxStartKey} IS NOT NULL`),
  }),
);

export type SandboxExecution = typeof sandboxExecutions.$inferSelect;
export type NewSandboxExecution = typeof sandboxExecutions.$inferInsert;
