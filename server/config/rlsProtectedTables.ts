/**
 * RLS-protected tables manifest (Sprint 2 P1.1 Layer 1).
 *
 * This is the canonical list of Postgres tables that have Row Level
 * Security enabled with a tenant-isolation policy keyed on
 * `current_setting('app.organisation_id', true)`. The list is consumed by:
 *
 *   - `scripts/verify-rls-coverage.sh` — CI gate that fails when a
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
  // 0227 — Phase 1 RLS hardening: FORCE RLS + canonical policy on 5 tables
  // that were missing FORCE ROW LEVEL SECURITY in their original migrations.
  // Original migrations: 0139, 0141, 0142, 0147, 0153.
  {
    tableName: 'memory_review_queue',
    schemaFile: 'memoryReviewQueue.ts',
    policyMigration: '0227_rls_hardening_corrective.sql',
    rationale: 'Per-org HITL review queue — belief conflicts and block proposals contain workspace intelligence that must not leak across tenants.',
  },
  {
    tableName: 'trust_calibration_state',
    schemaFile: 'trustCalibrationState.ts',
    policyMigration: '0227_rls_hardening_corrective.sql',
    rationale: 'Per-agent trust counter — auto-thresholds and validation history must stay tenant-isolated to prevent gaming across orgs.',
  },
  {
    tableName: 'drop_zone_upload_audit',
    schemaFile: 'dropZoneUploadAudit.ts',
    policyMigration: '0227_rls_hardening_corrective.sql',
    rationale: 'Append-only upload history with file hashes + destination payloads — must stay tenant-isolated for compliance and trust-state recomputation.',
  },
  {
    tableName: 'onboarding_bundle_configs',
    schemaFile: 'onboardingBundleConfigs.ts',
    policyMigration: '0227_rls_hardening_corrective.sql',
    rationale: 'Per-org onboarding bundle manifest — must stay tenant-isolated to prevent cross-org bundle leak.',
  },
  {
    tableName: 'agent_test_fixtures',
    schemaFile: 'agentTestFixtures.ts',
    policyMigration: '0227_rls_hardening_corrective.sql',
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
  // 0227 — Phase 1 RLS hardening: FORCE RLS + canonical policy on 3 execution-log
  // tables that were missing FORCE ROW LEVEL SECURITY in their original migration 0192.
  {
    tableName: 'agent_execution_events',
    schemaFile: 'agentExecutionEvents.ts',
    policyMigration: '0227_rls_hardening_corrective.sql',
    rationale: 'Durable per-run agent execution timeline — prompt assembly, memory retrieval, rule evaluation, LLM call start/complete, skill invocation. Payload contains reasoning excerpts, memory excerpts, and tool inputs that can hold PII + operational secrets.',
  },
  {
    tableName: 'agent_run_prompts',
    schemaFile: 'agentRunPrompts.ts',
    policyMigration: '0227_rls_hardening_corrective.sql',
    rationale: 'Fully-assembled system + user prompt per run assembly — contains the client knowledge base, memory-block composition, and task context that the LLM saw. Leak reveals an org\'s entire agent prompt surface.',
  },
  {
    tableName: 'agent_run_llm_payloads',
    schemaFile: 'agentRunLlmPayloads.ts',
    policyMigration: '0227_rls_hardening_corrective.sql',
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
  // 0227 — Phase 1 RLS hardening: FORCE RLS on 2 tables that were missing it
  // in their original migrations 0202 and 0203.
  // 0229 — dedicated corrective migration that adds FORCE RLS + proper CREATE
  // POLICY on reference_documents (direct org-isolation shape).
  // reference_document_versions is parent-FK-scoped (parent policied via 0229);
  // 0202/0203 are no longer baselined in verify-rls-coverage.sh.
  {
    tableName: 'reference_documents',
    schemaFile: 'referenceDocuments.ts',
    policyMigration: '0229_reference_documents_force_rls_parent_exists.sql',
    rationale: 'User-uploaded reference documents — content may contain confidential business knowledge, client data, or proprietary procedures. Cross-tenant leak exposes the entire document library.',
  },
  {
    tableName: 'reference_document_versions',
    schemaFile: 'referenceDocumentVersions.ts',
    policyMigration: '0229_reference_documents_force_rls_parent_exists.sql',
    rationale: 'Versioned snapshots of reference documents — reveal document edit history and content evolution; scoped via parent document\'s organisation_id.',
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
    rationale: 'Join table linking documents to bundles — scoped via parent bundle\'s organisation_id. Cross-tenant leak exposes which documents belong to which org\'s knowledge bundles.',
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
  // Paperclip Hierarchy: delegation outcomes telemetry (migration 0217, renumbered from 0205 post-merge)
  {
    tableName: 'delegation_outcomes',
    schemaFile: 'delegationOutcomes.ts',
    policyMigration: '0217_delegation_outcomes.sql',
    rationale: 'Per-run delegation decision log — caller/target agent ids and scope reveal agent hierarchy topology; cross-tenant leak would expose one org\'s agent structure to another.',
  },
  // 0238 — System Agents v7.1: skill idempotency key store
  {
    tableName: 'skill_idempotency_keys',
    schemaFile: 'skillIdempotencyKeys.ts',
    policyMigration: '0238_system_agents_v7_1.sql',
    rationale: 'Per-org deduplication keys for skill invocations — response payloads may contain tool results or PII; cross-tenant leak exposes another org\'s skill execution history and cached outputs.',
  },
  // 0245 — All 55 register-with-new-policy tenant tables (Phase 1 §3.5 step 4)
  // Batch A — Agent domain
  {
    tableName: 'account_overrides',
    schemaFile: 'accountOverrides.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-org billing and usage overrides — cross-tenant leak exposes pricing exceptions and contract terms.',
  },
  {
    tableName: 'action_events',
    schemaFile: 'actionEvents.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Lifecycle events for proposed tool-call actions — payloads contain PII and business-sensitive operation details.',
  },
  {
    tableName: 'action_resume_events',
    schemaFile: 'actionResumeEvents.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Resume signals for paused actions — carry decision context including approval outcomes and operator reasoning.',
  },
  {
    tableName: 'agent_conversations',
    schemaFile: 'agentConversations.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-agent conversation threads — contain instruction sets and contextual turn history scoped to the org.',
  },
  {
    tableName: 'agent_prompt_revisions',
    schemaFile: 'agentPromptRevisions.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Version history of agent system prompts — exposes org-specific instruction tuning and proprietary automation logic.',
  },
  {
    tableName: 'agent_triggers',
    schemaFile: 'agentTriggers.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Webhook and schedule triggers that activate agents — reveal org automation topology and integration entry points.',
  },
  {
    tableName: 'agents',
    schemaFile: 'agents.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Core agent definitions including names, instructions, and capability configs — cross-tenant leak exposes org automation IP.',
  },
  {
    tableName: 'board_configs',
    schemaFile: 'boardConfigs.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-org workspace board layout and column configurations — reveal operational workflows and task categorisation.',
  },
  {
    tableName: 'executions',
    schemaFile: 'executions.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Automation execution records with status and payloads — cross-tenant leak reveals operational patterns and business volume.',
  },
  {
    tableName: 'feedback_votes',
    schemaFile: 'feedbackVotes.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'User feedback on agent outputs — reveal quality signals and operator preferences scoped per org.',
  },
  {
    tableName: 'goals',
    schemaFile: 'goals.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Org-scoped strategic and operational goals — content is commercially sensitive and must not leak across tenants.',
  },
  {
    tableName: 'mcp_server_configs',
    schemaFile: 'mcpServerConfigs.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'MCP server connection configs including endpoint URLs and credentials — cross-tenant leak exposes integration secrets.',
  },
  {
    tableName: 'mcp_tool_invocations',
    schemaFile: 'mcpToolInvocations.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-org MCP tool call ledger with inputs and outputs — may contain PII and reveals org automation activity.',
  },
  // Batch B — Org/Config domain
  {
    tableName: 'config_backups',
    schemaFile: 'configBackups.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Point-in-time configuration snapshots for bulk restore — contain full org configuration including secrets references.',
  },
  {
    tableName: 'config_history',
    schemaFile: 'configHistory.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'JSONB changelog for configuration entities — reveals org configuration history including prior credential values.',
  },
  {
    tableName: 'connector_configs',
    schemaFile: 'connectorConfigs.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Integration connector configurations with API keys and connection parameters — direct credential leak risk.',
  },
  {
    tableName: 'geo_audits',
    schemaFile: 'geoAudits.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'GEO optimisation audit results per org — contain keyword analysis and competitive positioning data.',
  },
  {
    tableName: 'hierarchy_templates',
    schemaFile: 'hierarchyTemplates.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Org-defined agent hierarchy templates — reveal org automation architecture and role structures.',
  },
  {
    tableName: 'iee_artifacts',
    schemaFile: 'ieeArtifacts.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'IEE execution output artifacts — may contain processed data, analysis results, and tool outputs scoped per org.',
  },
  {
    tableName: 'iee_runs',
    schemaFile: 'ieeRuns.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Integrated execution environment run records — reveal org automation activity and processing patterns.',
  },
  {
    tableName: 'iee_steps',
    schemaFile: 'ieeSteps.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-step execution records within IEE runs — contain intermediate outputs and step-level tool interactions.',
  },
  {
    tableName: 'intervention_outcomes',
    schemaFile: 'interventionOutcomes.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'HITL decision outcomes per intervention — reveal operator approval patterns and business decision history.',
  },
  {
    tableName: 'org_agent_configs',
    schemaFile: 'orgAgentConfigs.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Org-level overrides for agent configuration — expose custom agent parameters and capability settings.',
  },
  {
    tableName: 'org_compute_budgets',
    schemaFile: 'orgComputeBudgets.ts',
    policyMigration: '0270_compute_budget_rename.sql',
    rationale: 'Per-org LLM and compute cost limits (Compute Budget) — cross-tenant leak reveals financial configuration and usage caps. Originally protected as org_budgets in migration 0245; renamed to org_compute_budgets in 0270 and re-asserted RLS under the new name there.',
  },
  {
    tableName: 'org_margin_configs',
    schemaFile: 'orgMarginConfigs.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-org billing margin multipliers and fixed fees — cross-tenant leak exposes pricing structure and contract terms. Nullable-aware policy: NULL rows are platform-global defaults.',
  },
  // Batch C — Memory/Workspace domain
  {
    tableName: 'org_memories',
    schemaFile: 'orgMemories.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Compiled cross-subaccount org-level memory summaries — contain aggregated workspace intelligence scoped per org.',
  },
  {
    tableName: 'org_memory_entries',
    schemaFile: 'orgMemories.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Individual cross-subaccount insights extracted from agent runs — contain knowledge claims and operational patterns.',
  },
  {
    tableName: 'org_user_roles',
    schemaFile: 'orgUserRoles.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-org role assignments mapping users to roles — cross-tenant leak exposes IAM structure and user privileges.',
  },
  {
    tableName: 'organisation_secrets',
    schemaFile: 'organisationSecrets.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Encrypted per-org secrets (API keys, credentials, tokens) — highest sensitivity; cross-tenant leak is a direct credentials breach.',
  },
  {
    tableName: 'page_projects',
    schemaFile: 'pageProjects.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Org-scoped page project containers — reveal content creation activity and project metadata.',
  },
  {
    tableName: 'permission_sets',
    schemaFile: 'permissionSets.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Named permission set definitions per org — reveal the org\'s role-based access control model and capability grants.',
  },
  {
    tableName: 'workflow_templates',
    schemaFile: 'workflowTemplates.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Org-owned workflow templates defining multi-step automation workflows — contain proprietary automation IP.',
  },
  {
    tableName: 'policy_rules',
    schemaFile: 'policyRules.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Org-scoped agent behaviour policy rules — contain approval criteria and operation constraints that are commercially sensitive.',
  },
  {
    tableName: 'portal_briefs',
    schemaFile: 'portalBriefs.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Published workflow output for portal cards — contain client-facing deliverable content scoped per org.',
  },
  // Batch D — Data/Process domain
  {
    tableName: 'automation_connection_mappings',
    schemaFile: 'automationConnectionMappings.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-subaccount wiring of automation connection slots to integration connections — reveal integration topology and credential associations.',
  },
  {
    tableName: 'processed_resources',
    schemaFile: 'processedResources.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Deduplication and processing state for ingested resources — reveal ingestion patterns and data pipeline activity per org.',
  },
  {
    tableName: 'projects',
    schemaFile: 'projects.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Org-scoped project containers grouping tasks and automations — content and metadata are commercially sensitive.',
  },
  {
    tableName: 'scheduled_tasks',
    schemaFile: 'scheduledTasks.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Cron-scheduled agent tasks with configuration and data sources — reveal automation schedules and operational intent per org.',
  },
  {
    tableName: 'skill_analyzer_jobs',
    schemaFile: 'skillAnalyzerJobs.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-org skill analysis job records — reveal skill development activity and proprietary skill improvement patterns.',
  },
  {
    tableName: 'skills',
    schemaFile: 'skills.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Reusable skill definitions including instructions and tool schemas — org-level skills contain proprietary automation logic. Nullable-aware policy: NULL-org rows are system built-in skills.',
  },
  {
    tableName: 'slack_conversations',
    schemaFile: 'slackConversations.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-org Slack conversational surface sessions — contain message history and org Slack integration context.',
  },
  {
    tableName: 'subaccount_agents',
    schemaFile: 'subaccountAgents.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Junction table wiring agents to subaccounts — reveals org agent assignment topology.',
  },
  {
    tableName: 'subaccount_onboarding_state',
    schemaFile: 'subaccountOnboardingState.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-subaccount onboarding step completion state — reveals org client onboarding progress and automation adoption.',
  },
  {
    tableName: 'subaccount_tags',
    schemaFile: 'subaccountTags.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-subaccount tag assignments — reveal org segmentation strategy and client categorisation.',
  },
  {
    tableName: 'subaccounts',
    schemaFile: 'subaccounts.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Core subaccount (client workspace) records — cross-tenant leak exposes the org\'s entire client list and portfolio.',
  },
  // Batch E — Tasks/Workspace/Sister-branch domain
  {
    tableName: 'task_activities',
    schemaFile: 'taskActivities.ts',
    policyMigration: '0091_rls_task_activities_deliverables.sql',
    rationale: 'Per-task activity log entries — reveal task lifecycle events and agent actions; cross-tenant leak exposes operational detail.',
  },
  {
    tableName: 'task_deliverables',
    schemaFile: 'taskDeliverables.ts',
    policyMigration: '0091_rls_task_activities_deliverables.sql',
    rationale: 'Task deliverable artefacts — may contain client-facing output, proprietary content, and PII; cross-tenant leak is a direct data breach.',
  },
  {
    tableName: 'task_attachments',
    schemaFile: 'taskAttachments.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'File attachments on tasks — may contain PII, client data, and confidential deliverables.',
  },
  {
    tableName: 'automation_categories',
    schemaFile: 'automationCategories.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Org-defined automation taxonomy categories — reveal org workflow structure and operational categorisation.',
  },
  {
    tableName: 'users',
    schemaFile: 'users.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Org-scoped user accounts with PII (name, email, role) — cross-tenant leak directly exposes staff identity and access.',
  },
  {
    tableName: 'webhook_adapter_configs',
    schemaFile: 'webhookAdapterConfigs.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Per-org webhook adapter configurations with endpoint URLs and branding — reveal integration topology and credentials.',
  },
  {
    tableName: 'workspace_entities',
    schemaFile: 'workspaceEntities.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Workspace-level entity records — contain org operational data and client relationship information.',
  },
  {
    tableName: 'workspace_health_findings',
    schemaFile: 'workspaceHealthFindings.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Automated workspace health audit findings — reveal org operational issues and quality assessments.',
  },
  {
    tableName: 'workspace_memory_entries',
    schemaFile: 'workspaceMemories.ts',
    policyMigration: '0245_all_tenant_tables_rls.sql',
    rationale: 'Individual subaccount-scoped memory entries extracted from agent runs — contain observations, decisions, and patterns with PII risk.',
  },
  // Workspace canonical layer (migration 0254 — agents-are-employees feature).
  {
    tableName: 'workspace_actors',
    schemaFile: 'workspaceActors.ts',
    policyMigration: '0254_workspace_canonical_layer.sql',
    rationale: 'Canonical actor identity rows for agents and humans — links identities to org-chart hierarchy. Leak exposes org structure and agent roster.',
  },
  {
    tableName: 'workspace_identities',
    schemaFile: 'workspaceIdentities.ts',
    policyMigration: '0254_workspace_canonical_layer.sql',
    rationale: 'Provider-scoped email identities for agents — email addresses, lifecycle status, and provisioning metadata. Leak exposes agent email infrastructure.',
  },
  {
    tableName: 'workspace_messages',
    schemaFile: 'workspaceMessages.ts',
    policyMigration: '0254_workspace_canonical_layer.sql',
    rationale: 'Canonical inbound + outbound email store for agent identities — message bodies, addresses, metadata. High PII risk.',
  },
  {
    tableName: 'workspace_calendar_events',
    schemaFile: 'workspaceCalendarEvents.ts',
    policyMigration: '0254_workspace_canonical_layer.sql',
    rationale: 'Canonical calendar event store for agent identities — meeting titles, attendees, times. PII and business-sensitive.',
  },
  // Sister-branch tables (workflow_engines owned by pre-prod-workflow-and-delegation — §0.4).
  // Registry-only entries: no policy migration is being authored here.
  // The owning branch is responsible for the CREATE POLICY statements.
  // policyMigration references the original CREATE TABLE migration as a placeholder
  // per the deferred-enforcement convention; the owning branch will update these
  // entries with the correct policy migration file.
  {
    tableName: 'workflow_engines',
    schemaFile: 'migrations/0000_wandering_firedrake.sql',
    policyMigration: '0000_wandering_firedrake.sql',
    rationale: 'Legacy per-org workflow engine instances — reveal automation execution topology. Policy deferred to pre-prod-workflow-and-delegation branch (spec §0.4). Baselined in scripts/verify-rls-coverage.sh until that branch lands.',
  },
  {
    tableName: 'automation_engines',
    schemaFile: 'automationEngines.ts',
    policyMigration: '0000_wandering_firedrake.sql',
    rationale: 'Renamed from workflow_engines (migration 0220) — same table, same deferral. RLS policy deferred to pre-prod-workflow-and-delegation branch (spec §0.4). Baselined in scripts/verify-rls-coverage.sh until that branch lands.',
  },
  {
    tableName: 'workflow_runs',
    schemaFile: 'workflowRuns.ts',
    policyMigration: '0076_playbooks.sql',
    rationale: 'Per-org workflow execution run records — reveal automation activity and execution history. Policy deferred to pre-prod-workflow-and-delegation branch (spec §0.4). Baselined in scripts/verify-rls-coverage.sh until that branch lands.',
  },
  {
    tableName: 'flow_runs',
    schemaFile: 'migrations/0037_phase1c_memory_and_workflows.sql',
    policyMigration: '0076_playbooks.sql',
    rationale: 'Renamed from workflow_runs (migration 0219) — org-scoped workflow execution instances. RLS policy deferred to pre-prod-workflow-and-delegation branch (spec §0.4). Baselined in scripts/verify-rls-coverage.sh until that branch lands.',
  },
  {
    tableName: 'automations',
    schemaFile: 'automations.ts',
    policyMigration: '0000_wandering_firedrake.sql',
    rationale: 'Renamed from processes→tasks (migrations 0220/0010) — per-org automation definitions. RLS policy deferred; no CREATE POLICY exists yet across any migration. Baselined until policy migration is authored.',
  },
  {
    tableName: 'canonical_flow_definitions',
    schemaFile: 'migrations/0172_clientpulse_canonical_tables.sql',
    policyMigration: '0000_wandering_firedrake.sql',
    rationale: 'Renamed from canonical_workflow_definitions (migration 0219) — same table, policy deferred. Using baselined migration 0000 as placeholder per deferred-enforcement convention.',
  },
  // 0262 — Live external document references: document cache and fetch audit log
  // 0263 — Corrected RLS policies (canonical org_isolation shape, replacing wrong GUC from 0262)
  {
    tableName: 'document_cache',
    schemaFile: 'documentCache.ts',
    policyMigration: '0263_fix_external_doc_rls_and_uniq.sql',
    rationale: 'Per-subaccount document cache; content may include confidential business documents fetched from Drive.',
  },
  {
    tableName: 'document_fetch_events',
    schemaFile: 'documentFetchEvents.ts',
    policyMigration: '0263_fix_external_doc_rls_and_uniq.sql',
    rationale: 'Per-subaccount fetch audit log; records which documents were accessed in which runs.',
  },
  // 0264 (PR #244) — Thread Context: per-conversation living doc
  {
    tableName: 'conversation_thread_context',
    schemaFile: 'conversationThreadContext.ts',
    policyMigration: '0264_conversation_thread_context.sql',
    rationale: 'Per-conversation agent tasks, approach, and decisions — may contain sensitive strategy and business context.',
  },
  // 0267 — Sub-Account Optimiser: generic agent-output primitive (spec §6.1)
  {
    tableName: 'agent_recommendations',
    schemaFile: 'agentRecommendations.ts',
    policyMigration: '0267_agent_recommendations.sql',
    rationale: 'Operator-facing recommendation rows per org/subaccount — may contain business intelligence, budget overruns, and performance findings that must not leak cross-tenant.',
  },
  // 0269 — GHL location token cache (join-scoped; see check2-exempt in rls-not-applicable-allowlist.txt)
  {
    tableName: 'connector_location_tokens',
    schemaFile: 'connectorLocationTokens.ts',
    policyMigration: '0269_connector_location_tokens.sql',
    rationale: 'Per-agency-connection GHL location access tokens — direct credential leak risk; tenant-isolated via parent connector_configs.organisation_id JOIN policy (no direct organisation_id column).',
  },
  // 0270 — Workflows V1: step gates + drafts
  {
    tableName: 'workflow_step_gates',
    schemaFile: 'workflowStepGates.ts',
    policyMigration: '0270_workflows_v1_additive_schema.sql',
    rationale: 'Per-run gate records containing approver pool snapshots and seen payloads — cross-tenant leak exposes workflow execution state and approver identity.',
  },
  {
    tableName: 'workflow_drafts',
    schemaFile: 'workflowDrafts.ts',
    policyMigration: '0270_workflows_v1_additive_schema.sql',
    rationale: 'Orchestrator-authored workflow draft payloads — cross-tenant leak exposes workflow configuration and session state.',
  },
  // 0271 — Agentic Commerce: 7 new tables with canonical org-isolation RLS
  {
    tableName: 'spending_budgets',
    schemaFile: 'spendingBudgets.ts',
    policyMigration: '0271_agentic_commerce_schema.sql',
    rationale: 'Spending Budget accounting containers — carry operator-defined spending authority, kill-switch timestamps, and alert thresholds. Cross-tenant leak exposes financial configuration.',
  },
  {
    tableName: 'spending_policies',
    schemaFile: 'spendingPolicies.ts',
    policyMigration: '0271_agentic_commerce_schema.sql',
    rationale: 'Spending Policy rules objects — hold per-transaction / daily / monthly limits, merchant allowlists, approval thresholds, and shadow/live mode. Cross-tenant leak exposes spend controls.',
  },
  {
    tableName: 'agent_charges',
    schemaFile: 'agentCharges.ts',
    policyMigration: '0271_agentic_commerce_schema.sql',
    rationale: 'Spend Ledger — every money-movement attempt with full policy decision trace, idempotency key, and status lifecycle. Highest-sensitivity financial audit record; cross-tenant leak is a critical incident.',
  },
  {
    tableName: 'subaccount_approval_channels',
    schemaFile: 'subaccountApprovalChannels.ts',
    policyMigration: '0271_agentic_commerce_schema.sql',
    rationale: 'Per-sub-account HITL approval channel configs — reveal notification routing and approval workflow configuration.',
  },
  {
    tableName: 'org_approval_channels',
    schemaFile: 'orgApprovalChannels.ts',
    policyMigration: '0271_agentic_commerce_schema.sql',
    rationale: 'Org-owned HITL approval channel configs — reveal org-level notification routing for spend approvals.',
  },
  {
    tableName: 'org_subaccount_channel_grants',
    schemaFile: 'orgSubaccountChannelGrants.ts',
    policyMigration: '0271_agentic_commerce_schema.sql',
    rationale: 'Bridge table granting org channels to sub-accounts — reveals approval delegation topology.',
  },
  {
    tableName: 'spending_budget_approvers',
    schemaFile: 'spendingBudgetApprovers.ts',
    policyMigration: '0271_agentic_commerce_schema.sql',
    rationale: 'Explicit per-user approver grants for spending budgets — reveals who may approve charges; cross-tenant leak exposes access control configuration.',
  },
  // (cost_aggregates is registered in scripts/rls-not-applicable-allowlist.txt
  // under the "ALTER TABLE ADD organisation_id" carve-out — the column was
  // added in migration 0272, not in the original CREATE TABLE in 0024. RLS
  // policy lives on cost_aggregates in migration 0272.)
];

// ─── Explicit RLS-bypass tables (do NOT add these to the manifest above) ────
//
// The following tables introduced in migration 0224 INTENTIONALLY bypass the
// standard RLS framework (spec §7.4 Option A). They are system-admin-only
// surfaces; access is gated at the route and service layers by
// requireSystemAdmin — there is no per-row RLS policy.
//
// If you are tempted to query these tables from non-sysadmin code paths,
// STOP — every caller must be sysadmin-gated or apply explicit service-layer
// filtering. There is no RLS safety net.
//
//   system_incidents            — central incident sink
//   system_incident_events      — append-only audit log per incident
//   system_incident_suppressions — named mute rules

/** Convenience set for fast membership checks in the CI gate. */
export const RLS_PROTECTED_TABLE_NAMES: ReadonlySet<string> = new Set(
  RLS_PROTECTED_TABLES.map((t) => t.tableName),
);
