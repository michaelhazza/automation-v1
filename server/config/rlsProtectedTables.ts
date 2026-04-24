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
    tableName: 'llm_requests_archive',
    schemaFile: 'llmRequestsArchive.ts',
    policyMigration: '0188_llm_requests_archive.sql',
    rationale: 'Retention archive for llm_requests — same tenant-isolation policy; rows move in from the nightly llm-ledger-archive job.',
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
  // 0112 — Agent Beliefs (Phase 1)
  {
    tableName: 'agent_beliefs',
    schemaFile: 'agentBeliefs.ts',
    policyMigration: '0112_agent_beliefs.sql',
    rationale: 'Per-agent discrete beliefs — facts extracted from runs, scoped per subaccount-agent.',
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
  // 0139 — Memory & Briefings Phase 1: HITL review queue
  {
    tableName: 'memory_review_queue',
    schemaFile: 'memoryReviewQueue.ts',
    policyMigration: '0139_memory_review_queue.sql',
    rationale: 'Per-org HITL review queue — belief conflicts and block proposals contain workspace intelligence that must not leak across tenants.',
  },
  // 0147 — Memory & Briefings Phase 2: trust calibration
  {
    tableName: 'trust_calibration_state',
    schemaFile: 'trustCalibrationState.ts',
    policyMigration: '0147_trust_calibration_state.sql',
    rationale: 'Per-agent trust counter — auto-thresholds and validation history must stay tenant-isolated to prevent gaming across orgs.',
  },
  // 0141 — Memory & Briefings Phase 4: drop-zone upload audit
  {
    tableName: 'drop_zone_upload_audit',
    schemaFile: 'dropZoneUploadAudit.ts',
    policyMigration: '0141_drop_zone_upload_audit.sql',
    rationale: 'Append-only upload history with file hashes + destination payloads — must stay tenant-isolated for compliance and trust-state recomputation.',
  },
  // 0142 — Memory & Briefings Phase 4: onboarding bundle configs
  {
    tableName: 'onboarding_bundle_configs',
    schemaFile: 'onboardingBundleConfigs.ts',
    policyMigration: '0142_onboarding_bundle_configs.sql',
    rationale: 'Per-org onboarding bundle manifest — must stay tenant-isolated to prevent cross-org bundle leak.',
  },
  // 0153 — Feature 2: test-input fixtures for inline Run-Now test panel
  {
    tableName: 'agent_test_fixtures',
    schemaFile: 'agentTestFixtures.ts',
    policyMigration: '0153_agent_test_fixtures.sql',
    rationale: 'Test-input fixtures contain prompt text and JSON payloads authored by org/subaccount users — must stay tenant-isolated.',
  },
  // 0156 — Orchestrator capability-aware routing: feature requests + routing outcomes
  {
    tableName: 'feature_requests',
    schemaFile: 'featureRequests.ts',
    policyMigration: '0156_orchestrator_capability_routing.sql',
    rationale: 'Capability-request signals with user_intent text and org attribution — must stay tenant-isolated so one org cannot see another org\'s pending feature requests.',
  },
  {
    tableName: 'routing_outcomes',
    schemaFile: 'routingOutcomes.ts',
    policyMigration: '0156_orchestrator_capability_routing.sql',
    rationale: 'Per-run routing decision outcomes — leak would reveal how competitors\' agents are configured and what tasks they run.',
  },
  // 0160 — P1: scheduled polling stats
  {
    tableName: 'integration_ingestion_stats',
    schemaFile: 'integrationIngestionStats.ts',
    policyMigration: '0168_p3b_canonical_rls.sql',
    rationale: 'Per-connection sync metrics — cross-tenant leak reveals integration activity patterns and connector health.',
  },
  // 0167 — P3B: principal tables RLS
  {
    tableName: 'service_principals',
    schemaFile: 'servicePrincipals.ts',
    policyMigration: '0167_p3b_principal_rls.sql',
    rationale: 'Non-human identities scoped per org — leak reveals automation topology and integration credentials.',
  },
  {
    tableName: 'teams',
    schemaFile: 'teams.ts',
    policyMigration: '0167_p3b_principal_rls.sql',
    rationale: 'Org-scoped team groups — leak reveals internal team structure and staffing.',
  },
  {
    tableName: 'team_members',
    schemaFile: 'teamMembers.ts',
    policyMigration: '0167_p3b_principal_rls.sql',
    rationale: 'Team membership junction — leak reveals which users belong to which teams.',
  },
  {
    tableName: 'delegation_grants',
    schemaFile: 'delegationGrants.ts',
    policyMigration: '0167_p3b_principal_rls.sql',
    rationale: 'Time-bounded permission grants — leak reveals delegation topology and allowed actions.',
  },
  {
    tableName: 'canonical_row_subaccount_scopes',
    schemaFile: 'canonicalRowSubaccountScopes.ts',
    policyMigration: '0167_p3b_principal_rls.sql',
    rationale: 'Multi-tenant row attribution — leak reveals which data is shared across subaccounts.',
  },
  // 0168 — P3B: canonical tables RLS + canonical_writer role
  {
    tableName: 'canonical_accounts',
    schemaFile: 'canonicalAccounts.ts',
    policyMigration: '0168_p3b_canonical_rls.sql',
    rationale: 'Core CRM accounts — principal-scoped visibility protects client relationship data.',
  },
  {
    tableName: 'canonical_contacts',
    schemaFile: 'canonicalEntities.ts',
    policyMigration: '0168_p3b_canonical_rls.sql',
    rationale: 'Contact records — PII (names, emails, phones) requires principal-scoped isolation.',
  },
  {
    tableName: 'canonical_opportunities',
    schemaFile: 'canonicalEntities.ts',
    policyMigration: '0168_p3b_canonical_rls.sql',
    rationale: 'Sales pipeline data — deal values and stages are commercially sensitive.',
  },
  {
    tableName: 'canonical_conversations',
    schemaFile: 'canonicalEntities.ts',
    policyMigration: '0168_p3b_canonical_rls.sql',
    rationale: 'Communication records — message content and response times are sensitive.',
  },
  {
    tableName: 'canonical_revenue',
    schemaFile: 'canonicalEntities.ts',
    policyMigration: '0168_p3b_canonical_rls.sql',
    rationale: 'Revenue transactions — cross-tenant leak reveals billing amounts and financial state.',
  },
  {
    tableName: 'health_snapshots',
    schemaFile: 'canonicalEntities.ts',
    policyMigration: '0168_p3b_canonical_rls.sql',
    rationale: 'Computed health scores — leak reveals client relationship health assessments.',
  },
  {
    tableName: 'anomaly_events',
    schemaFile: 'canonicalEntities.ts',
    policyMigration: '0168_p3b_canonical_rls.sql',
    rationale: 'Metric deviations — leak reveals operational anomalies and alert configurations.',
  },
  {
    tableName: 'canonical_metrics',
    schemaFile: 'canonicalMetrics.ts',
    policyMigration: '0168_p3b_canonical_rls.sql',
    rationale: 'Latest metric snapshots — cross-tenant leak reveals current KPI values.',
  },
  {
    tableName: 'canonical_metric_history',
    schemaFile: 'canonicalMetrics.ts',
    policyMigration: '0168_p3b_canonical_rls.sql',
    rationale: 'Append-only metric history — leak reveals historical performance trends.',
  },
  {
    tableName: 'integration_connections',
    schemaFile: 'integrationConnections.ts',
    policyMigration: '0168_p3b_canonical_rls.sql',
    rationale: 'External service credentials — principal-scoped visibility protects connection ownership and tokens.',
  },
  // 0172 — ClientPulse Phase 1 canonical + derived tables
  {
    tableName: 'canonical_subaccount_mutations',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0172_clientpulse_canonical_tables.sql',
    rationale: 'Staff activity mutation log (§2.0b) — leaks reveal per-sub-account staff work patterns.',
  },
  {
    tableName: 'canonical_conversation_providers',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0172_clientpulse_canonical_tables.sql',
    rationale: 'Fingerprint source for third-party conversation providers (§2.0c) — reveals which integrations the sub-account uses.',
  },
  {
    tableName: 'canonical_workflow_definitions',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0172_clientpulse_canonical_tables.sql',
    rationale: 'Fingerprint source from workflow action types + webhook targets (§2.0c) — reveals automation posture.',
  },
  {
    tableName: 'canonical_tag_definitions',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0172_clientpulse_canonical_tables.sql',
    rationale: 'Tag vocabulary per sub-account (§2.0c) — reveals segmentation + third-party tag conventions.',
  },
  {
    tableName: 'canonical_custom_field_definitions',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0172_clientpulse_canonical_tables.sql',
    rationale: 'Custom field keys per sub-account (§2.0c) — reveals CRM customisation + third-party prefix patterns.',
  },
  {
    tableName: 'canonical_contact_sources',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0172_clientpulse_canonical_tables.sql',
    rationale: 'Contact attribution sources per sub-account (§2.0c) — reveals acquisition channels and third-party origin markers.',
  },
  {
    tableName: 'client_pulse_signal_observations',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0172_clientpulse_canonical_tables.sql',
    rationale: 'Timeseries of ClientPulse churn-predictive signals per sub-account — cross-tenant leak reveals client health state.',
  },
  {
    tableName: 'subaccount_tier_history',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0172_clientpulse_canonical_tables.sql',
    rationale: 'Subscription tier migration timeseries — reveals pricing posture and downgrade patterns per sub-account.',
  },
  // 0173 — ClientPulse Phase 2 derived timeseries
  {
    tableName: 'client_pulse_health_snapshots',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0173_clientpulse_health_snapshots.sql',
    rationale: 'ClientPulse health-score timeseries per sub-account — leak reveals portfolio health posture.',
  },
  // 0174 — ClientPulse Phase 3 churn risk assessments
  {
    tableName: 'client_pulse_churn_assessments',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0174_clientpulse_churn_assessments.sql',
    rationale: 'ClientPulse churn-risk band assessments per sub-account — leak reveals which clients are flagged as at-risk.',
  },
  // 0177 — ClientPulse Phase 1 follow-up: integration fingerprint scanner state
  // (bumped from 0176 after merge-conflict with IEE 0176_iee_run_id_and_inflight_index.sql)
  {
    tableName: 'integration_fingerprints',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0177_clientpulse_integration_fingerprints.sql',
    rationale: 'Integration-fingerprint library (system + org scope). System rows are cross-tenant readable; org rows reveal the agency\'s vendor catalogue.',
  },
  {
    tableName: 'integration_detections',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0177_clientpulse_integration_fingerprints.sql',
    rationale: 'Per-sub-account integration detections — leak reveals which third-party vendors each client uses.',
  },
  {
    tableName: 'integration_unclassified_signals',
    schemaFile: 'clientPulseCanonicalTables.ts',
    policyMigration: '0177_clientpulse_integration_fingerprints.sql',
    rationale: 'Novel fingerprint observations awaiting operator triage — leak reveals unclassified third-party activity per sub-account.',
  },
  // 0192 — Live Agent Execution Log (spec: tasks/live-agent-execution-log-spec.md)
  {
    tableName: 'agent_execution_events',
    schemaFile: 'agentExecutionEvents.ts',
    policyMigration: '0192_agent_execution_log.sql',
    rationale: 'Durable per-run agent execution timeline — prompt assembly, memory retrieval, rule evaluation, LLM call start/complete, skill invocation. Payload contains reasoning excerpts, memory excerpts, and tool inputs that can hold PII + operational secrets.',
  },
  {
    tableName: 'agent_run_prompts',
    schemaFile: 'agentRunPrompts.ts',
    policyMigration: '0192_agent_execution_log.sql',
    rationale: 'Fully-assembled system + user prompt per run assembly — contains the client knowledge base, memory-block composition, and task context that the LLM saw. Leak reveals an org\'s entire agent prompt surface.',
  },
  {
    tableName: 'agent_run_llm_payloads',
    schemaFile: 'agentRunLlmPayloads.ts',
    policyMigration: '0192_agent_execution_log.sql',
    rationale: 'Full request + response body per LLM ledger row — post-redaction, but still carries message history, tool inputs, and provider responses. Payload-read is gated tighter than view-log (AGENTS_EDIT), but RLS is still the last-resort tenant boundary.',
  },
  // 0195 — Universal Brief classifier shadow-eval logging.
  // Migration 0200 repairs any dev DB that applied an earlier draft of
  // 0195 that referenced the wrong session variable and omitted FORCE RLS.
  {
    tableName: 'fast_path_decisions',
    schemaFile: 'fastPathDecisions.ts',
    policyMigration: '0195_fast_path_decisions.sql',
    rationale: 'Classifier triage decisions per Brief — contains routing intent, confidence scores, and downstream outcomes. Cross-tenant leak reveals org behavioural patterns and intent signals.',
  },
  // 0194 — Universal Brief polymorphic conversation tables.
  // Migration 0200 repairs any dev DB that applied an earlier draft of
  // 0194 that referenced the wrong session variable and omitted FORCE RLS.
  {
    tableName: 'conversations',
    schemaFile: 'conversations.ts',
    policyMigration: '0194_conversations_polymorphic.sql',
    rationale: 'Polymorphic conversation container for Briefs, Tasks, and Agent-run logs — contains user chat turns which can include PII, business objectives, and operational intent.',
  },
  {
    tableName: 'conversation_messages',
    schemaFile: 'conversations.ts',
    policyMigration: '0194_conversations_polymorphic.sql',
    rationale: 'Individual messages within conversations — includes BriefChatArtefact JSONB blobs with query results, approval payloads, and error diagnostics. Same sensitivity as the parent conversation.',
  },
  // 0202–0208 + 0212 — Cached Context Infrastructure (spec: docs/cached-context-infrastructure-spec.md).
  // Migration 0213 repairs the RLS policies on all eight tables below (wrong
  // session variable + missing FORCE + missing WITH CHECK) to match the
  // canonical 0079/0200 pattern.
  {
    tableName: 'reference_documents',
    schemaFile: 'referenceDocuments.ts',
    policyMigration: '0202_reference_documents.sql',
    rationale: 'User-uploaded reference documents — content may contain confidential business knowledge, client data, or proprietary procedures. Cross-tenant leak exposes the entire document library.',
  },
  {
    tableName: 'reference_document_versions',
    schemaFile: 'referenceDocumentVersions.ts',
    policyMigration: '0203_reference_document_versions.sql',
    rationale: 'Immutable content revisions for reference documents — same sensitivity as the parent document. Version history reveals editing patterns and prior document states.',
  },
  {
    tableName: 'document_bundles',
    schemaFile: 'documentBundles.ts',
    policyMigration: '0204_document_bundles.sql',
    rationale: 'Document bundle groupings — names and descriptions can reveal organisational intent; bundle composition reveals which documents are used together. Cross-tenant leak exposes the org\'s knowledge structure.',
  },
  {
    tableName: 'document_bundle_members',
    schemaFile: 'documentBundleMembers.ts',
    policyMigration: '0205_document_bundle_members.sql',
    rationale: 'Join table linking documents to bundles — membership reveals bundle composition. Cross-tenant leak exposes the relationship between documents and bundles.',
  },
  {
    tableName: 'document_bundle_attachments',
    schemaFile: 'documentBundleAttachments.ts',
    policyMigration: '0206_document_bundle_attachments.sql',
    rationale: 'Links bundles to agents, tasks, or scheduled tasks — reveals which automated workflows reference which knowledge. Cross-tenant leak exposes operational context.',
  },
  {
    tableName: 'bundle_resolution_snapshots',
    schemaFile: 'bundleResolutionSnapshots.ts',
    policyMigration: '0207_bundle_resolution_snapshots.sql',
    rationale: 'Immutable per-run captures of resolved document versions and prefix hashes — contain the exact document content that was sent to the LLM for each run. Cross-tenant leak exposes both content and LLM call patterns.',
  },
  {
    tableName: 'model_tier_budget_policies',
    schemaFile: 'modelTierBudgetPolicies.ts',
    policyMigration: '0208_model_tier_budget_policies.sql',
    rationale: 'Per-org execution budget policies — per-org overrides reveal cost configuration and policy settings. Platform-default rows (organisation_id IS NULL) are intentionally readable across all orgs (custom SELECT policy).',
  },
  // 0212 — Bundle suggestion dismissals
  {
    tableName: 'bundle_suggestion_dismissals',
    schemaFile: 'bundleSuggestionDismissals.ts',
    policyMigration: '0212_bundle_suggestion_dismissals.sql',
    rationale: 'Per-user dismissals of bundle-save suggestions — reveals which document sets a user has seen and ignored. Cross-tenant leak exposes user behaviour patterns.',
  },
];

/** Convenience set for fast membership checks in the CI gate. */
export const RLS_PROTECTED_TABLE_NAMES: ReadonlySet<string> = new Set(
  RLS_PROTECTED_TABLES.map((t) => t.tableName),
);
