import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { agentRuns } from './agentRuns';
import { reviewItems } from './reviewItems';

// ---------------------------------------------------------------------------
// Regression Cases — Sprint 2 P1.2 HITL rejection → automatic regression
// test capture.
//
// Every time a human rejects a review item, the review service enqueues a
// background `regression-capture` job that materialises a deterministic
// test case describing the run state at the moment the rejected proposal
// was emitted. The materialised case includes:
//
//   - the input contract the agent received (system prompt snapshot,
//     tool manifest, trimmed conversation transcript)
//   - the rejected tool call (name + canonicalised args)
//   - the rejection reason (free text from the reviewer)
//   - sha256 fingerprints of the input contract + rejected call so the
//     replay harness can assert "the agent no longer proposes this"
//
// Cases live on a per-agent ring buffer capped by agents.regression_case_cap
// (NULL → DEFAULT_REGRESSION_CASE_CAP). When the cap is exceeded the
// oldest `active` case is moved to `retired` so the suite always reflects
// the most recent rejections.
//
// See docs/improvements-roadmap-spec.md §P1.2.
// ---------------------------------------------------------------------------

export const regressionCases = pgTable(
  'regression_cases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    // The agent_run that produced the rejected proposal. Nullable because
    // runs may be retention-pruned before the case ages out.
    sourceAgentRunId: uuid('source_agent_run_id').references(() => agentRuns.id, {
      onDelete: 'set null',
    }),
    // The review_item that triggered the capture. Nullable for the same
    // reason as sourceAgentRunId.
    sourceReviewItemId: uuid('source_review_item_id').references(
      () => reviewItems.id,
      { onDelete: 'set null' },
    ),

    // ── Captured payload ───────────────────────────────────────────────
    // The materialised input contract: system prompt snapshot, tool
    // manifest, trimmed conversation transcript, run metadata. The
    // regressionCaptureService builds this from agentRunSnapshots +
    // agentMessages at capture time.
    inputContractJson: jsonb('input_contract_json').notNull(),
    // The tool call the human rejected: { name, args }.
    rejectedCallJson: jsonb('rejected_call_json').notNull(),
    // Free text from the reviewer explaining the rejection.
    rejectionReason: text('rejection_reason'),
    // sha256 of canonicalised inputContractJson — used by the replay
    // harness to skip cases whose contract has drifted.
    inputContractHash: text('input_contract_hash').notNull(),
    // sha256 of `${toolName}:${canonicalise(args)}` — the assertion key.
    rejectedCallHash: text('rejected_call_hash').notNull(),

    // ── Lifecycle ──────────────────────────────────────────────────────
    // active: included in the replay suite.
    // retired: excluded — either aged out of the per-agent cap or
    //   manually retired because the underlying behaviour changed.
    // stale: contract hash no longer matches anything the agent would
    //   receive today — replay skipped, operator should retire or
    //   refresh.
    status: text('status')
      .notNull()
      .default('active')
      .$type<'active' | 'retired' | 'stale'>(),

    // Replay accounting — populated by scripts/run-regression-cases.ts.
    lastReplayedAt: timestamp('last_replayed_at', { withTimezone: true }),
    lastReplayResult: text('last_replay_result').$type<
      'pass' | 'fail' | 'skipped' | null
    >(),
    consecutivePasses: integer('consecutive_passes').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    agentStatusIdx: index('regression_cases_agent_status_idx').on(
      table.agentId,
      table.status,
    ),
    orgIdx: index('regression_cases_org_idx').on(table.organisationId),
    sourceRunIdx: index('regression_cases_source_run_idx').on(
      table.sourceAgentRunId,
    ),
    callHashIdx: index('regression_cases_call_hash_idx').on(table.rejectedCallHash),
  }),
);

export type RegressionCase = typeof regressionCases.$inferSelect;
export type NewRegressionCase = typeof regressionCases.$inferInsert;
