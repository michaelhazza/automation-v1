/**
 * Allowlist of slugs callable from `action_call` playbook steps.
 *
 * Spec: docs/onboarding-playbooks-spec.md §4.3.
 *
 * Only the Configuration Assistant's 28 `config_*` skills are callable from
 * `action_call` steps in v1. Expansions require editing this file, writing
 * down why, and passing spec-review — not a silent runtime override.
 *
 * Phase G (§11.6) will add two new portal/email skills:
 *   - `config_publish_playbook_output_to_portal`
 *   - `config_send_playbook_email_digest`
 *
 * Those skills' handlers live in `server/tools/config/playbookSkillHandlers.ts`
 * and are NOT callable from human-initiated Configuration Assistant sessions
 * (enforced via `visibility: none` in their .md skill definitions).
 *
 * Side-effect classification is NOT stored here — it lives on the step's
 * `sideEffectType` field and is cross-checked by the validator (§4.10). This
 * module only answers "is this slug reachable from `action_call`?".
 */

export const ACTION_CALL_ALLOWED_SLUGS: ReadonlySet<string> = new Set([
  // ── Mutations — agents & links (9) ────────────────────────────────────────
  'config_create_agent',
  'config_update_agent',
  'config_activate_agent',
  'config_link_agent',
  'config_update_link',
  'config_set_link_skills',
  'config_set_link_instructions',
  'config_set_link_schedule',
  'config_set_link_limits',

  // ── Mutations — subaccounts & tasks (3) ───────────────────────────────────
  'config_create_subaccount',
  'config_create_scheduled_task',
  'config_update_scheduled_task',

  // ── Mutations — data sources (3) ──────────────────────────────────────────
  'config_attach_data_source',
  'config_update_data_source',
  'config_remove_data_source',

  // ── Mutations — history (1) ───────────────────────────────────────────────
  'config_restore_version',

  // ── Reads — listings (8) ──────────────────────────────────────────────────
  'config_list_agents',
  'config_list_subaccounts',
  'config_list_links',
  'config_list_scheduled_tasks',
  'config_list_data_sources',
  'config_list_system_skills',
  'config_list_org_skills',
  'config_get_agent_detail',
  'config_get_link_detail',

  // ── Reads — plan / validation / history (3) ───────────────────────────────
  'config_preview_plan',
  'config_run_health_check',
  'config_view_history',

  // ── Phase G additions (§11.6) — ship with daily-intelligence-brief ────────
  'config_publish_playbook_output_to_portal',
  'config_send_playbook_email_digest',
]);

/**
 * Slugs whose handler creates a singleton business resource. Action-call steps
 * invoking these slugs MUST declare `idempotencyScope: 'entity'` with a stable
 * `entityKey` so cross-run replay and concurrent runs deduplicate against the
 * same underlying entity instead of the run id.
 *
 * Spec §4.4 — enforced by the `entity_idempotency_required` validation rule.
 */
export const SINGLETON_RESOURCE_ACTIONS: ReadonlySet<string> = new Set([
  'config_create_scheduled_task',
]);

/**
 * Slugs whose handler is a read-only operation (no mutation, no side effect).
 * A step calling one of these slugs must declare `sideEffectType: 'none'` or
 * `sideEffectType: 'idempotent'`. Spec §4.4 / §4.10.
 */
export const READ_ONLY_ACTIONS: ReadonlySet<string> = new Set([
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
]);

export function isActionCallSlugAllowed(slug: string): boolean {
  return ACTION_CALL_ALLOWED_SLUGS.has(slug);
}

export function isSingletonResourceAction(slug: string): boolean {
  return SINGLETON_RESOURCE_ACTIONS.has(slug);
}

export function isReadOnlyAction(slug: string): boolean {
  return READ_ONLY_ACTIONS.has(slug);
}
