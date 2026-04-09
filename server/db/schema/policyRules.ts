import { pgTable, uuid, text, integer, real, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// Policy Rules — first-match, priority-ordered gate level configuration
// Phase 1A: replaces hardcoded registry defaults with configurable DB rules.
// ---------------------------------------------------------------------------

export const policyRules = pgTable(
  'policy_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    // null = org-wide; set = applies only to this subaccount
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),

    // exact match (e.g. 'send_email') or '*' wildcard
    toolSlug: text('tool_slug').notNull(),
    // lower = evaluated first; 9999 = fallback wildcard
    priority: integer('priority').notNull().default(100),

    // extensible condition bag: { user_role, subaccount_id, amount_usd, … }
    conditions: jsonb('conditions').notNull().default({}),

    decision: text('decision').notNull().$type<'auto' | 'review' | 'block'>(),
    evaluationMode: text('evaluation_mode').notNull().default('first_match'),

    // reviewer UI options: { allow_ignore, allow_respond, allow_edit, allow_accept }
    interruptConfig: jsonb('interrupt_config'),
    // allowed outcome types for this rule: ['approve', 'edit', 'reject']
    allowedDecisions: jsonb('allowed_decisions'),
    // markdown description template — supports {{tool_slug}}, {{subaccount_id}}
    descriptionTemplate: text('description_template'),

    timeoutSeconds: integer('timeout_seconds'),
    timeoutPolicy: text('timeout_policy').$type<'auto_reject' | 'auto_approve' | 'escalate'>(),

    // Sprint 3 P2.3 — per-rule confidence gate override. NULL falls back to
    // CONFIDENCE_GATE_THRESHOLD in server/config/limits.ts. When a matching
    // rule produces an `auto` decision but the agent's tool_intent confidence
    // is below this threshold, the decision is upgraded to `review`.
    confidenceThreshold: real('confidence_threshold'),
    // Sprint 3 P2.3 — situational guidance injected as a <system-reminder>
    // block by decisionTimeGuidanceMiddleware the moment a matching tool is
    // about to be called. Replaces "front-load everything in the master
    // prompt" with targeted, context-aware instructions.
    guidanceText: text('guidance_text'),

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgPriorityIdx: index('policy_rules_org_priority_idx').on(
      table.organisationId,
      table.isActive,
      table.priority,
    ),
    toolIdx: index('policy_rules_tool_idx').on(table.organisationId, table.toolSlug),
  }),
);

export type PolicyRule = typeof policyRules.$inferSelect;
export type NewPolicyRule = typeof policyRules.$inferInsert;
