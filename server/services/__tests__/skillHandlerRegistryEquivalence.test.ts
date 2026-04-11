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
import 'dotenv/config';

import { SKILL_HANDLERS } from '../skillExecutor.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

// ---------------------------------------------------------------------------
// Canonical pre-refactor case label set (95 entries)
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
  'playbook_read_existing',
  'playbook_validate',
  'playbook_simulate',
  'playbook_estimate_cost',
  'playbook_propose_save',
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
  'update_memory_block',
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

test('SKILL_HANDLERS has exactly 95 keys (pre-refactor switch case count)', () => {
  const count = Object.keys(SKILL_HANDLERS).length;
  if (count !== 95) {
    throw new Error(
      `SKILL_HANDLERS has ${count} keys, expected 95. ` +
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
console.log(`skillHandlerRegistryEquivalence: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
