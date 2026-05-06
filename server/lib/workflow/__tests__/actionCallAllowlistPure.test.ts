/**
 * actionCallAllowlist pure unit tests — runnable via:
 *   npx tsx server/lib/workflow/__tests__/actionCallAllowlistPure.test.ts
 *
 * Verifies the closed set enforcement behaviour for `action_call` steps —
 * spec docs/onboarding-workflows-spec.md §4.3.
 */

import { expect, test } from 'vitest';
import {
  ACTION_CALL_ALLOWED_SLUGS,
  SINGLETON_RESOURCE_ACTIONS,
  READ_ONLY_ACTIONS,
  isActionCallSlugAllowed,
  isSingletonResourceAction,
  isReadOnlyAction,
} from '../actionCallAllowlist.js';

// ── Shape ──────────────────────────────────────────────────────────────────

test('allowlist covers the full 37-slug set (28 base + 2 Phase G + 2 Memory & Briefings Phase 3 + 5 spend)', () => {
  // Spec §4.3 — the closed set for v1. 28 pre-existing config_* slugs plus
  // two Phase G additions (portal + email digest) plus two Memory &
  // Briefings Phase 3 additions (`config_weekly_digest_gather` and
  // `config_deliver_workflow_output`) plus five Agentic Commerce spend skills
  // (pay_invoice, purchase_resource, subscribe_to_service, top_up_balance,
  // issue_refund). Every expansion requires editing
  // actionCallAllowlist.ts AND bumping this number — that's the friction.
  expect(ACTION_CALL_ALLOWED_SLUGS.size === 37, `expected exactly 37 slugs, got ${ACTION_CALL_ALLOWED_SLUGS.size}`).toBeTruthy();
});

test('read-only set is a subset of the allowlist', () => {
  for (const slug of READ_ONLY_ACTIONS) {
    expect(ACTION_CALL_ALLOWED_SLUGS.has(slug), `read-only slug '${slug}' missing from allowlist`).toBeTruthy();
  }
});

test('singleton-resource set is a subset of the allowlist', () => {
  for (const slug of SINGLETON_RESOURCE_ACTIONS) {
    expect(ACTION_CALL_ALLOWED_SLUGS.has(slug), `singleton slug '${slug}' missing from allowlist`).toBeTruthy();
  }
});

test('singleton and read-only sets do not overlap', () => {
  for (const slug of SINGLETON_RESOURCE_ACTIONS) {
    expect(!READ_ONLY_ACTIONS.has(slug), `slug '${slug}' is both singleton and read-only — contradiction`).toBeTruthy();
  }
});

// ── Predicates ─────────────────────────────────────────────────────────────

test('isActionCallSlugAllowed returns true for known mutation slug', () => {
  expect(isActionCallSlugAllowed('config_create_agent'), 'config_create_agent should be allowed').toBeTruthy();
});

test('isActionCallSlugAllowed returns true for known read slug', () => {
  expect(isActionCallSlugAllowed('config_list_agents'), 'config_list_agents should be allowed').toBeTruthy();
});

test('isActionCallSlugAllowed returns true for Phase G portal slug', () => {
  expect(isActionCallSlugAllowed('config_publish_workflow_output_to_portal'), 'phase G portal slug should be allowed').toBeTruthy();
});

test('isActionCallSlugAllowed returns true for Phase G email slug', () => {
  expect(isActionCallSlugAllowed('config_send_workflow_email_digest'), 'phase G email slug should be allowed').toBeTruthy();
});

test('isActionCallSlugAllowed rejects non-config skills', () => {
  expect(!isActionCallSlugAllowed('send_email'), "'send_email' is a Configuration Assistant skill only from LLM paths, not action_call").toBeTruthy();
  expect(!isActionCallSlugAllowed('create_task'), "'create_task' is not in the action_call closed set").toBeTruthy();
});

test('isActionCallSlugAllowed rejects arbitrary / unknown slugs', () => {
  expect(!isActionCallSlugAllowed(''), 'empty string should not be allowed').toBeTruthy();
  expect(!isActionCallSlugAllowed('config_drop_table'), 'fictional destructive slug should not be allowed').toBeTruthy();
  expect(!isActionCallSlugAllowed('CONFIG_CREATE_AGENT'), 'case-sensitive rejection — slugs are lower_snake_case only').toBeTruthy();
});

test('isSingletonResourceAction is true only for config_create_scheduled_task', () => {
  expect(isSingletonResourceAction('config_create_scheduled_task'), 'scheduled-task creation is a singleton').toBeTruthy();
  expect(!isSingletonResourceAction('config_create_agent'), 'agent creation is NOT a singleton (multiple agents allowed per org)').toBeTruthy();
  expect(!isSingletonResourceAction('config_list_agents'), 'read operations are never singleton').toBeTruthy();
});

test('isReadOnlyAction is true for all list/get/preview/health/history slugs', () => {
  const expected = [
    'config_list_agents',
    'config_list_subaccounts',
    'config_list_links',
    'config_list_scheduled_tasks',
    'config_list_data_sources',
    'config_list_system_skills',
    'config_list_org_skills',
    'config_get_agent_detail',
    'config_get_link_detail',
    'config_preview_plan',
    'config_run_health_check',
    'config_view_history',
  ];
  for (const slug of expected) {
    expect(isReadOnlyAction(slug), `${slug} should be read-only`).toBeTruthy();
  }
});

test('isReadOnlyAction is false for mutations', () => {
  const mutations = [
    'config_create_agent',
    'config_update_agent',
    'config_activate_agent',
    'config_link_agent',
    'config_create_subaccount',
    'config_create_scheduled_task',
    'config_attach_data_source',
    'config_restore_version',
  ];
  for (const slug of mutations) {
    expect(!isReadOnlyAction(slug), `${slug} is a mutation, not read-only`).toBeTruthy();
  }
});

// ── Spend skills (Agentic Commerce Chunk 6) ───────────────────────────────

test('spend slugs are allowed in action_call steps', () => {
  const spendSlugs = [
    'pay_invoice',
    'purchase_resource',
    'subscribe_to_service',
    'top_up_balance',
    'issue_refund',
  ];
  for (const slug of spendSlugs) {
    expect(isActionCallSlugAllowed(slug), `spend slug '${slug}' must be on the allowlist`).toBeTruthy();
  }
});

// ── Summary ────────────────────────────────────────────────────────────────