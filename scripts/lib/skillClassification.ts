/**
 * Skill classification — single source of truth for the visibility rule.
 *
 * Every file-based system skill in `server/skills/*.md` must carry an explicit
 * `visibility:` frontmatter value. This module defines the rule that decides
 * which value each skill should have:
 *
 *   - APP_FOUNDATIONAL skills → visibility: none
 *     These are the platform-infrastructure primitives agents use to operate
 *     inside this application: task board management, workspace memory,
 *     HITL escalation, sub-agent orchestration, Studio tooling. They are not
 *     customer-facing capabilities — they exist so agents can function. Hiding
 *     them prevents org admins from cluttering their skill UI with internals
 *     they cannot meaningfully configure.
 *
 *   - BUSINESS-VISIBLE skills → visibility: basic
 *     Everything else. These represent work the agent does that a customer
 *     might care about: drafting ad copy, analysing financials, publishing
 *     content, running tests, sending emails. `basic` visibility exposes
 *     name + description to org/subaccount tiers but keeps the full
 *     instructions and tool definition at the system tier.
 *
 * This file is consumed by:
 *   - scripts/apply-skill-visibility.ts     (bulk-applies the rule)
 *   - scripts/verify-skill-visibility.sh    (validation gate in CI)
 *   - scripts/seed.ts                       (pre-seed validation)
 *
 * Adding a new skill? Drop the .md file in server/skills/, then either:
 *   1. Add its slug to APP_FOUNDATIONAL_SKILLS below (if it's infra)
 *   2. Do nothing (it will default to BUSINESS visibility)
 *   3. Run `npx tsx scripts/apply-skill-visibility.ts` to update the frontmatter
 *
 * The CI gate will fail if any .md file has visibility out of sync with this
 * classification — so drift is caught at PR review time, not in production.
 */

/**
 * Skills that exist to make agents work inside this application but are not
 * customer-facing capabilities. Hidden from the org UI (visibility: none).
 *
 * Categories:
 *   - Task board primitives  — create/move/update/reassign tasks, add deliverables
 *   - Workspace memory       — read/write workspace, update memory blocks
 *   - HITL & orchestration   — request_approval, spawn_sub_agents
 *   - Cascading context      — read_data_source (data attached to runs)
 *   - Playbook Studio tools  — only visible to the Playbook Author system agent
 */
export const APP_FOUNDATIONAL_SKILLS: ReadonlySet<string> = new Set([
  // Task board primitives
  'add_deliverable',
  'create_task',
  'move_task',
  'reassign_task',
  'update_task',

  // Workspace memory / cross-agent state
  'read_workspace',
  'write_workspace',
  'update_memory_block',

  // HITL and orchestration
  'request_approval',
  'spawn_sub_agents',

  // Hierarchy introspection — manager delegation primitive
  'list_my_subordinates',

  // Cascading context data sources (runtime-loaded, not user-facing)
  'read_data_source',

  // Playbook Studio tools — only invoked by the Playbook Author system agent
  'playbook_read_existing',
  'playbook_validate',
  'playbook_simulate',
  'playbook_estimate_cost',
  'playbook_propose_save',
]);

export type DesiredVisibility = 'none' | 'basic' | 'full';

/**
 * Decide the desired visibility for a skill based on its slug.
 *
 * Returns 'none' for app-foundational skills, 'basic' for everything else.
 * Never returns 'full' — a skill that should be fully exposed (instructions
 * + tool definition) to lower tiers must be set to 'full' by hand in the
 * .md frontmatter and added to FULL_VISIBILITY_EXCEPTIONS below.
 */
export function desiredVisibilityFor(slug: string): DesiredVisibility {
  if (FULL_VISIBILITY_EXCEPTIONS.has(slug)) return 'full';
  if (APP_FOUNDATIONAL_SKILLS.has(slug)) return 'none';
  return 'basic';
}

/**
 * Skills that are explicitly marked `full` — lower tiers see the complete
 * instructions and tool definition, not just name + description.
 *
 * Add a slug here only when the full body is genuinely useful to an org
 * admin (e.g. the skill has configuration options the admin needs to see
 * to wire it correctly).
 */
export const FULL_VISIBILITY_EXCEPTIONS: ReadonlySet<string> = new Set([
  // Intentionally empty. Add with justification.
]);

/**
 * A skill file's classification outcome, returned by classifySkill() for
 * reporting and validation.
 */
export interface SkillClassification {
  slug: string;
  desired: DesiredVisibility;
  reason: 'app-foundational' | 'full-visibility-exception' | 'business-default';
}

export function classifySkill(slug: string): SkillClassification {
  if (FULL_VISIBILITY_EXCEPTIONS.has(slug)) {
    return { slug, desired: 'full', reason: 'full-visibility-exception' };
  }
  if (APP_FOUNDATIONAL_SKILLS.has(slug)) {
    return { slug, desired: 'none', reason: 'app-foundational' };
  }
  return { slug, desired: 'basic', reason: 'business-default' };
}
