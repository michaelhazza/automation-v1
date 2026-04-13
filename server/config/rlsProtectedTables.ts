/**
 * RLS-protected tables manifest (Sprint 2 P1.1 Layer 1).
 *
 * This is the canonical list of Postgres tables that have Row Level
 * Security enabled with a tenant-isolation policy keyed on
 * `current_setting('app.organisation_id', true)`. The list is consumed by:
 *
 *   - `scripts/gates/verify-rls-coverage.sh` — CI gate that fails when a
 *     manifest entry has no matching `CREATE POLICY` in any migration.
 *     Every migration that adds a new tenant-owned table is expected to
 *     append the table to this manifest in the same commit.
 *   - `server/services/__tests__/rls.context-propagation.test.ts` — the
 *     integration test iterates the manifest to assert Layer B (RLS
 *     default fail-closed) holds for every protected table.
 *
 * Adding or removing an entry is a change to the security posture of the
 * platform. New entries should land together with the migration that
 * creates the policy; removals should land together with the
 * down-migration that drops the policy.
 *
 * See `docs/improvements-roadmap-spec.md` §P1.1 Layer 1.
 */

export interface RlsProtectedTable {
  /** Physical Postgres table name. */
  tableName: string;
  /** Drizzle schema file the table is defined in (relative to server/db/schema). */
  schemaFile: string;
  /** Migration file that introduces the CREATE POLICY statement. */
  policyMigration: string;
  /**
   * Human-readable note about what class of data the table holds and why
   * a cross-tenant leak would matter. Surfaced in CI gate error messages.
   */
  rationale: string;
}

/**
 * Initial set of 10 tables protected by Sprint 2 migrations 0079-0081.
 * Tables are listed in migration order so the manifest reads as a diff
 * against the "day zero" unprotected baseline.
 */
export const RLS_PROTECTED_TABLES: ReadonlyArray<RlsProtectedTable> = [
  // 0079 — highest-touched tables
  {
    tableName: 'tasks',
    schemaFile: 'tasks.ts',
    policyMigration: '0079_rls_tasks_actions_runs.sql',
    rationale: 'Kanban cards — title/description can contain PII and business-sensitive content.',
  },
  {
    tableName: 'actions',
    schemaFile: 'actions.ts',
    policyMigration: '0079_rls_tasks_actions_runs.sql',
    rationale: 'Every proposed / executed tool call with its payload — PII via email bodies, API payloads.',
  },
  {
    tableName: 'agent_runs',
    schemaFile: 'agentRuns.ts',
    policyMigration: '0079_rls_tasks_actions_runs.sql',
    rationale: 'Agent conversation transcripts — reasoning text, tool results, LLM outputs.',
  },
  // 0080 — review & workspace
  {
    tableName: 'review_items',
    schemaFile: 'reviewItems.ts',
    policyMigration: '0080_rls_review_audit_workspace.sql',
    rationale: 'HITL review queue — pending proposed actions awaiting human decision.',
  },
  {
    tableName: 'review_audit_records',
    schemaFile: 'reviewAuditRecords.ts',
    policyMigration: '0080_rls_review_audit_workspace.sql',
    rationale: 'Approve/reject decision log for HITL actions — auditor identity + reasoning.',
  },
  {
    tableName: 'workspace_memories',
    schemaFile: 'workspaceMemories.ts',
    policyMigration: '0080_rls_review_audit_workspace.sql',
    rationale: 'Per-subaccount agent memory — the agent\'s running understanding of the workspace.',
  },
  // 0081 — llm usage & audit
  {
    tableName: 'llm_requests',
    schemaFile: 'llmRequests.ts',
    policyMigration: '0081_rls_llm_requests_audit.sql',
    rationale: 'LLM request/response records — includes full prompts and completions.',
  },
  {
    tableName: 'audit_events',
    schemaFile: 'auditEvents.ts',
    policyMigration: '0081_rls_llm_requests_audit.sql',
    rationale: 'Cross-cutting audit log — access patterns, permission changes, admin actions.',
  },
  {
    tableName: 'task_activities',
    schemaFile: 'taskActivities.ts',
    policyMigration: '0091_rls_task_activities_deliverables.sql',
    rationale: 'Task comment/activity feed — user comments and agent posts.',
  },
  {
    tableName: 'task_deliverables',
    schemaFile: 'taskDeliverables.ts',
    policyMigration: '0091_rls_task_activities_deliverables.sql',
    rationale: 'Task outputs uploaded by agents — files, drafts, reports.',
  },
  // 0082 — Sprint 2 P1.1 Layer 3 security event stream
  {
    tableName: 'tool_call_security_events',
    schemaFile: 'toolCallSecurityEvents.ts',
    policyMigration: '0082_tool_call_security_events.sql',
    rationale: 'Every tool call authorisation decision — audit trail for scope / policy checks.',
  },
  // 0104 — ClientPulse: org_subscriptions + reports
  {
    tableName: 'org_subscriptions',
    schemaFile: 'orgSubscriptions.ts',
    policyMigration: '0104_clientpulse_modules.sql',
    rationale: 'Per-org billing state — cross-tenant leak reveals pricing/plan of other orgs.',
  },
  {
    tableName: 'reports',
    schemaFile: 'reports.ts',
    policyMigration: '0104_clientpulse_modules.sql',
    rationale: 'Per-org portfolio health reports — agency client performance data.',
  },
  // 0083 — Sprint 2 P1.2 regression capture
  {
    tableName: 'regression_cases',
    schemaFile: 'regressionCases.ts',
    policyMigration: '0083_regression_cases.sql',
    rationale: 'Captured HITL rejections — reveals the reviewer\'s framing of banned agent behaviours.',
  },
  // 0084 — Sprint 3 P2.1 Sprint 3A append-only message log
  {
    tableName: 'agent_run_messages',
    schemaFile: 'agentRunMessages.ts',
    policyMigration: '0084_agent_run_checkpoint_and_messages.sql',
    rationale: 'Per-run LLM conversation transcript — full prompts, tool inputs, tool outputs from every agent run.',
  },
  // 0105 — Agent Intelligence Upgrade (Phases 2D + 3B)
  {
    tableName: 'agent_briefings',
    schemaFile: 'agentBriefings.ts',
    policyMigration: '0105_agent_intelligence.sql',
    rationale: 'Per-agent cross-run briefing — contains summarised workspace context and recent activity.',
  },
  {
    tableName: 'subaccount_state_summaries',
    schemaFile: 'subaccountStateSummaries.ts',
    policyMigration: '0105_agent_intelligence.sql',
    rationale: 'Auto-generated subaccount operational state — task counts, run stats, health findings.',
  },
  // 0088 — Sprint 5 P4.2 shared memory blocks
  {
    tableName: 'memory_blocks',
    schemaFile: 'memoryBlocks.ts',
    policyMigration: '0088_memory_blocks.sql',
    rationale: 'Shared named context blocks — may contain brand voice, client preferences, or SOPs.',
  },
  // 0108 — Scraping engine
  {
    tableName: 'scraping_selectors',
    schemaFile: 'scrapingSelectors.ts',
    policyMigration: '0108_scraping_engine.sql',
    rationale: 'Per-org scraping selectors for data extraction — tenant-isolated selector configs.',
  },
  {
    tableName: 'scraping_cache',
    schemaFile: 'scrapingCache.ts',
    policyMigration: '0108_scraping_engine.sql',
    rationale: 'Per-org scraping cache — cached page content with tenant isolation.',
  },
];

/** Convenience set for fast membership checks in the CI gate. */
export const RLS_PROTECTED_TABLE_NAMES: ReadonlySet<string> = new Set(
  RLS_PROTECTED_TABLES.map((t) => t.tableName),
);
