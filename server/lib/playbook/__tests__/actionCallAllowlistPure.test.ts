/**
 * actionCallAllowlist pure unit tests — runnable via:
 *   npx tsx server/lib/playbook/__tests__/actionCallAllowlistPure.test.ts
 *
 * Verifies the closed set enforcement behaviour for `action_call` steps —
 * spec docs/onboarding-playbooks-spec.md §4.3.
 */

import {
  ACTION_CALL_ALLOWED_SLUGS,
  SINGLETON_RESOURCE_ACTIONS,
  READ_ONLY_ACTIONS,
  isActionCallSlugAllowed,
  isSingletonResourceAction,
  isReadOnlyAction,
} from '../actionCallAllowlist.js';

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

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

// ── Shape ──────────────────────────────────────────────────────────────────

test('allowlist covers the full 30-slug set (28 existing + 2 Phase G)', () => {
  // Spec §4.3 — the closed set for v1. 28 pre-existing config_* slugs plus
  // the two Phase G additions shipped with daily-intelligence-brief.
  assert(
    ACTION_CALL_ALLOWED_SLUGS.size === 30,
    `expected exactly 30 slugs, got ${ACTION_CALL_ALLOWED_SLUGS.size}`,
  );
});

test('read-only set is a subset of the allowlist', () => {
  for (const slug of READ_ONLY_ACTIONS) {
    assert(
      ACTION_CALL_ALLOWED_SLUGS.has(slug),
      `read-only slug '${slug}' missing from allowlist`,
    );
  }
});

test('singleton-resource set is a subset of the allowlist', () => {
  for (const slug of SINGLETON_RESOURCE_ACTIONS) {
    assert(
      ACTION_CALL_ALLOWED_SLUGS.has(slug),
      `singleton slug '${slug}' missing from allowlist`,
    );
  }
});

test('singleton and read-only sets do not overlap', () => {
  for (const slug of SINGLETON_RESOURCE_ACTIONS) {
    assert(
      !READ_ONLY_ACTIONS.has(slug),
      `slug '${slug}' is both singleton and read-only — contradiction`,
    );
  }
});

// ── Predicates ─────────────────────────────────────────────────────────────

test('isActionCallSlugAllowed returns true for known mutation slug', () => {
  assert(
    isActionCallSlugAllowed('config_create_agent'),
    'config_create_agent should be allowed',
  );
});

test('isActionCallSlugAllowed returns true for known read slug', () => {
  assert(
    isActionCallSlugAllowed('config_list_agents'),
    'config_list_agents should be allowed',
  );
});

test('isActionCallSlugAllowed returns true for Phase G portal slug', () => {
  assert(
    isActionCallSlugAllowed('config_publish_playbook_output_to_portal'),
    'phase G portal slug should be allowed',
  );
});

test('isActionCallSlugAllowed returns true for Phase G email slug', () => {
  assert(
    isActionCallSlugAllowed('config_send_playbook_email_digest'),
    'phase G email slug should be allowed',
  );
});

test('isActionCallSlugAllowed rejects non-config skills', () => {
  assert(
    !isActionCallSlugAllowed('send_email'),
    "'send_email' is a Configuration Assistant skill only from LLM paths, not action_call",
  );
  assert(
    !isActionCallSlugAllowed('create_task'),
    "'create_task' is not in the action_call closed set",
  );
});

test('isActionCallSlugAllowed rejects arbitrary / unknown slugs', () => {
  assert(!isActionCallSlugAllowed(''), 'empty string should not be allowed');
  assert(
    !isActionCallSlugAllowed('config_drop_table'),
    'fictional destructive slug should not be allowed',
  );
  assert(
    !isActionCallSlugAllowed('CONFIG_CREATE_AGENT'),
    'case-sensitive rejection — slugs are lower_snake_case only',
  );
});

test('isSingletonResourceAction is true only for config_create_scheduled_task', () => {
  assert(
    isSingletonResourceAction('config_create_scheduled_task'),
    'scheduled-task creation is a singleton',
  );
  assert(
    !isSingletonResourceAction('config_create_agent'),
    'agent creation is NOT a singleton (multiple agents allowed per org)',
  );
  assert(
    !isSingletonResourceAction('config_list_agents'),
    'read operations are never singleton',
  );
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
    assert(isReadOnlyAction(slug), `${slug} should be read-only`);
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
    assert(!isReadOnlyAction(slug), `${slug} is a mutation, not read-only`);
  }
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
