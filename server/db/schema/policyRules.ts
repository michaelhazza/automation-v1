import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
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
