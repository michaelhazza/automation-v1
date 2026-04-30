// guard-ignore-file: pure-helper-convention reason="Uses dynamic await import('../skillExecutor.js') — gate regex only matches static 'from' imports; sibling is imported correctly"
/**
 * skillHandlerRegistryEquivalence.test.ts — Phase 0 of skill-analyzer-v2.
 *
 * Anti-drift gate. The Phase 0 refactor of skillExecutor.ts replaces a
 * 95-case switch statement with a SKILL_HANDLERS registry constant. This
 * test asserts the set of registry keys exactly matches a hard-coded list
 * of the pre-refactor case labels — so any future addition or accidental
 * loss of a handler is caught at CI time, not in production.
 *
 * Updating this test is intentional friction: when you add a new system
 * skill handler, you must update both SKILL_HANDLERS and this list. That
 * mirror enforces the "every skill row has a handler" invariant the
 * startup validator (validateSystemSkillHandlers) and the analyzer execute
 * gate both depend on.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/skillHandlerRegistryEquivalence.test.ts
 */

// skillExecutor transitively imports server/db/index.ts which validates env
// vars via zod. Load .env first so the import does not throw on DATABASE_URL.
// In environments without a .env file (CI, ephemeral sandboxes), fall back
// to placeholder values — this test is purely structural, it never hits the
// DB or signs a JWT. ESM imports are hoisted, so we seed process.env *before*
// a dynamic import pulls skillExecutor through the env-validated db module.
import { expect, test } from 'vitest';

await import('dotenv/config');
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM   ??= 'test-placeholder@example.com';

const { SKILL_HANDLERS } = await import('../skillExecutor.js');

// ---------------------------------------------------------------------------
// Canonical handler key set (177 entries)
// ---------------------------------------------------------------------------
// If you are adding a new system skill, append its slug here AND add the
// corresponding entry to SKILL_HANDLERS in server/services/skillExecutor.ts.
// Both updates must land in the same commit.

const CANONICAL_HANDLER_KEYS: readonly string[] = [
  'search_tools',
  'load_tool',
  'web_search',
  'read_workspace',
  'write_workspace',
  'trigger_process',
  'spawn_sub_agents',
  'read_data_source',
  'create_task',
  'triage_intake',
  'move_task',
  'add_deliverable',
  'reassign_task',
  'update_task',
  'read_inbox',
  'fetch_url',
  'workflow_read_existing',
  'workflow_validate',
  'workflow_simulate',
  'workflow_estimate_cost',
  'workflow_propose_save',
  'send_email',
  'update_record',
  'request_approval',
  'read_codebase',
  'search_codebase',
  'run_tests',
  'analyze_endpoint',
  'report_bug',
  'capture_screenshot',
  'run_playwright_test',
  'write_patch',
  'run_command',
  'create_pr',
  'create_page',
  'update_page',
  'publish_page',
  'draft_architecture_plan',
  'draft_tech_spec',
  'review_ux',
  'review_code',
  'write_tests',
  'draft_requirements',
  'derive_test_cases',
  'write_spec',
  'classify_email',
  'draft_reply',
  'search_knowledge_base',
  'draft_post',
  'publish_post',
  'read_analytics',
  'read_campaigns',
  'analyse_performance',
  'analyse_42macro_transcript',
  'draft_ad_copy',
  'update_bid',
  'update_copy',
  'pause_campaign',
  'increase_budget',
  'enrich_contact',
  'draft_sequence',
  'update_crm',
  'read_revenue',
  'read_expenses',
  'analyse_financials',
  'update_financial_record',
  'generate_competitor_brief',
  'synthesise_voc',
  'draft_content',
  'audit_seo',
  'create_lead_magnet',
  'draft_report',
  'deliver_report',
  'configure_integration',
  'read_crm',
  'analyse_pipeline',
  'draft_followup',
  'detect_churn_risk',
  'read_docs',
  'propose_doc_update',
  'write_docs',
  'assign_task',
  'query_subaccount_cohort',
  'read_org_insights',
  'write_org_insight',
  'compute_health_score',
  'detect_anomaly',
  'compute_churn_risk',
  'generate_portfolio_report',
  'trigger_account_intervention',
  'transcribe_audio',
  'fetch_paywalled_content',
  'send_to_slack',
  'ask_clarifying_question',
  'request_clarification',
  'update_memory_block',
  'search_agent_history',
  'read_priority_feed',
  'skill_read_existing',
  'skill_read_regressions',
  'skill_validate',
  'skill_simulate',
  'skill_propose_save',
  'scrape_url',
  'scrape_structured',
  'monitor_webpage',
  'audit_geo',
  'geo_citability',
  'geo_crawlers',
  'geo_schema',
  'geo_platform_optimizer',
  'geo_brand_authority',
  'geo_llmstxt',
  'geo_compare',
  'generic_methodology',
  // Phase A–G: Onboarding Workflows config handlers
  'config_create_agent',
  'config_update_agent',
  'config_activate_agent',
  'config_link_agent',
  'config_update_link',
  'config_set_link_skills',
  'config_set_link_instructions',
  'config_set_link_schedule',
  'config_set_link_limits',
  'config_create_subaccount',
  'config_create_scheduled_task',
  'config_update_scheduled_task',
  'config_attach_data_source',
  'config_update_data_source',
  'config_remove_data_source',
  'config_restore_version',
  'config_list_agents',
  'config_list_subaccounts',
  'config_list_links',
  'config_list_scheduled_tasks',
  'config_list_data_sources',
  'config_list_system_skills',
  'config_list_org_skills',
  'config_get_agent_detail',
  'config_get_link_detail',
  'config_run_health_check',
  'config_preview_plan',
  'config_view_history',
  'config_publish_workflow_output_to_portal',
  'config_send_workflow_email_digest',
  // Feature 3 — n8n Workflow Import
  'import_n8n_workflow',
  // Phase 3 — Weekly Digest + Workflow Delivery
  'weekly_digest_gather',
  'config_weekly_digest_gather',
  'config_deliver_workflow_output',
  // ClientPulse session-1/2 additions (14 handlers folded in over multiple merges)
  'compute_staff_activity_pulse',
  'scan_integration_fingerprints',
  'crm.fire_automation',
  'crm.send_email',
  'crm.send_sms',
  'crm.create_task',
  'notify_operator',
  'config_update_organisation_config',
  'list_platform_capabilities',
  'list_connections',
  'check_capability_gap',
  'request_feature',
  'smart_skip_from_website',
  'canonical_dictionary',
  // CRM Query Planner + deliberation handlers (added after initial 163-entry baseline)
  'crm.query',
  'ask_clarifying_questions',
  'challenge_assumptions',
  // System Monitoring Agent handlers (wired in via system-monitor handler registry sync)
  'read_agent_run',
  'read_baseline',
  'read_connector_state',
  'read_dlq_recent',
  'read_heuristic_fires',
  'read_incident',
  'read_logs_for_correlation_id',
  'read_recent_runs_for_agent',
  'read_skill_execution',
  'write_diagnosis',
  'write_event',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('SKILL_HANDLERS contains every canonical key', () => {
  const registryKeys = new Set(Object.keys(SKILL_HANDLERS));
  const missing: string[] = [];
  for (const key of CANONICAL_HANDLER_KEYS) {
    if (!registryKeys.has(key)) missing.push(key);
  }
  if (missing.length > 0) {
    throw new Error(
      `SKILL_HANDLERS is missing ${missing.length} canonical handler(s): ${missing.join(', ')}. ` +
      'Either restore the missing handler in server/services/skillExecutor.ts SKILL_HANDLERS, ' +
      'or remove it from CANONICAL_HANDLER_KEYS in this test if the removal was intentional.',
    );
  }
});

test('SKILL_HANDLERS does not contain any unexpected keys', () => {
  const canonicalSet = new Set(CANONICAL_HANDLER_KEYS);
  const unexpected: string[] = [];
  for (const key of Object.keys(SKILL_HANDLERS)) {
    if (!canonicalSet.has(key)) unexpected.push(key);
  }
  if (unexpected.length > 0) {
    throw new Error(
      `SKILL_HANDLERS has ${unexpected.length} key(s) not in CANONICAL_HANDLER_KEYS: ${unexpected.join(', ')}. ` +
      'If you added a new handler, also add it to CANONICAL_HANDLER_KEYS in this test.',
    );
  }
});

test('SKILL_HANDLERS has exactly 177 keys', () => {
  const count = Object.keys(SKILL_HANDLERS).length;
  if (count !== 177) {
    throw new Error(
      `SKILL_HANDLERS has ${count} keys, expected 177. ` +
      'If you intentionally added or removed a handler, update both this assertion AND CANONICAL_HANDLER_KEYS.',
    );
  }
});

test('Every SKILL_HANDLERS entry is a function', () => {
  for (const [key, handler] of Object.entries(SKILL_HANDLERS)) {
    if (typeof handler !== 'function') {
      throw new Error(`SKILL_HANDLERS["${key}"] is not a function (got ${typeof handler})`);
    }
  }
});

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

console.log('');
// Make this file a module so the top-level `await import()` used above
// satisfies TS1375 (top-level await requires ESM module semantics).
export {};
