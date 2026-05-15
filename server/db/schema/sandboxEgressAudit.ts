import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { subaccounts } from './subaccounts.js';

// ---------------------------------------------------------------------------
// sandbox_egress_audit — per-egress-decision rows (spec §20.6, §9.1).
// Written only when policy.network is non-'none'. Full payload logging is
// explicitly prohibited — payloads may contain customer PII.
// Retention: 180 days (spec §17.3).
// ---------------------------------------------------------------------------

export const sandboxEgressAudit = pgTable(
  'sandbox_egress_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sandboxExecutionId: uuid('sandbox_execution_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'restrict' }),
    runId: uuid('run_id').notNull(),

    // Egress decision metadata
    destinationClass: text('destination_class').notNull()
      .$type<'internal' | 'customer' | 'vendor' | 'unknown'>(),
    destinationHost: text('destination_host').notNull(),
    destinationPort: integer('destination_port').notNull(),
    destinationProtocol: text('destination_protocol').notNull()
      .$type<'http' | 'https' | 'tcp' | 'other'>(),

    // Credential context: which issued credential alias was on the call path.
    // Never the credential value — alias only.
    credentialContextAlias: text('credential_context_alias'),

    outcome: text('outcome').notNull().$type<'allow' | 'deny'>(),
    decisionAt: timestamp('decision_at', { withTimezone: true }).defaultNow().notNull(),

    // Which allow-list entry matched, if any (spec §20.6)
    policyRuleId: text('policy_rule_id'),
  },
  (table) => ({
    orgDecisionAtIdx: index('sandbox_egress_audit_org_decision_at_idx').on(table.organisationId, table.decisionAt),
    executionIdIdx: index('sandbox_egress_audit_execution_id_idx').on(table.sandboxExecutionId),
  }),
);

export type SandboxEgressAudit = typeof sandboxEgressAudit.$inferSelect;
export type NewSandboxEgressAudit = typeof sandboxEgressAudit.$inferInsert;
