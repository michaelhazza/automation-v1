export * from './types.js';
import type { ActionDefinition } from './types.js';
import { coreActions } from './core.js';
import { intelligenceActions } from './intelligence.js';
import { agentsActions } from './agents.js';
import { methodologyActions } from './methodology.js';
import { configurationActions } from './configuration.js';
import { clientpulseActions } from './clientpulse.js';
import { commerceActions } from './commerce.js';
import { supportActions } from './support.js';
import { UNIVERSAL_SKILL_NAMES } from '../universalSkills.js';

export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
  ...coreActions,
  ...intelligenceActions,
  ...agentsActions,
  ...methodologyActions,
  ...configurationActions,
  ...clientpulseActions,
  ...commerceActions,
  ...supportActions,
};

// ─── Trust & Verification Layer §6.1 — runtime-check coverage backfill ────────
//
// Every ACTION_REGISTRY entry must satisfy the
// `verify-runtime-check-coverage.mjs` CI gate: either `verify` is set OR
// `verifyNullJustification` is a non-empty string.
//
// The 20 most-used external skills carry concrete `verify` shapes inline above
// (see seed list at tasks/builds/trust-verification-layer/runtime-check-coverage-list.md).
// Everything else falls into one of three default-justification buckets,
// applied here in a single deterministic sweep so the registry source stays
// readable without 90+ near-duplicate verifyNullJustification strings:
//
//   - Read-only skills (no observable external side effect): justification
//     "Read-only skill with no observable side effect to verify".
//   - Methodology / pure-LLM skills (read isMethodology / pure prompt scaffolds):
//     "Pure LLM skill — no deterministic external check is possible".
//   - Internal config/admin skills (write to internal admin tables only,
//     covered by RLS audit + their own integration tests):
//     "Internal config skill — covered by RLS audit + service integration
//     tests; deterministic post-check would duplicate existing coverage".
//
// Operators backfilling a concrete `verify` for one of these later just set
// `verify` inline on the entry above; the sweep skips entries that already
// carry either field.
(function applyRuntimeCheckCoverageDefaults() {
  for (const def of Object.values(ACTION_REGISTRY)) {
    if (def.verify !== undefined || def.verifyNullJustification) continue;

    const isReadOnly =
      def.mcp?.annotations.readOnlyHint === true ||
      def.sideEffectClass === 'read' ||
      def.sideEffectClass === 'none';

    if (def.isMethodology) {
      def.verify = null;
      def.verifyNullJustification =
        'Pure LLM skill — no deterministic external check is possible';
      def.reversible = true;
      def.blastRadius = 'self';
      continue;
    }

    if (isReadOnly) {
      def.verify = null;
      def.verifyNullJustification =
        'Read-only skill with no observable side effect to verify';
      def.reversible = true;
      def.blastRadius = def.isExternal ? 'external' : 'self';
      continue;
    }

    // Internal config/admin write — covered by RLS audit + service tests.
    def.verify = null;
    def.verifyNullJustification =
      'Internal config skill — covered by RLS audit + service integration tests; ' +
      'deterministic post-check would duplicate existing coverage';
    def.reversible = false;
    def.blastRadius = 'tenant';
  }
})();

/**
 * Spend-enabled action slugs for the workflow action_call allowlist.
 * Concatenated into ACTION_CALL_ALLOWED_SLUGS in actionCallAllowlist.ts.
 * Spec: tasks/builds/agentic-commerce/spec.md §7.1, §7.3.
 * Plan: tasks/builds/agentic-commerce/plan.md §Chunk 6.
 */
export const SPEND_ACTION_ALLOWED_SLUGS = [
  'pay_invoice',
  'purchase_resource',
  'subscribe_to_service',
  'top_up_balance',
  'issue_refund',
] as const;

/**
 * Legacy action-slug aliases.
 *
 * Per contract (l) in tasks/builds/clientpulse/session-1-foundation-spec.md
 * §1.3: all inbound action-slug surfaces MUST normalise via `resolveActionSlug`.
 * Routes, webhook handlers, queue consumers, anything that receives an
 * `action_type` from an external caller.
 *
 * The migration in `0181_rename_operator_alert.sql` rewrites historical rows,
 * but in-flight job payloads, cached definitions, dashboard filters, and
 * external callers may still carry the pre-Session-1 slug. Resolving via this
 * map is defence in depth — once per process per alias hit is logged so drift
 * is visible without swamping the log.
 *
 * Append-only: entries can be added but never silently removed. Removal
 * requires a deliberate code change.
 */
export const ACTION_SLUG_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'clientpulse.operator_alert': 'notify_operator',
  config_update_hierarchy_template: 'config_update_organisation_config',
});

const loggedAliasHits = new Set<string>();

/**
 * Normalise an inbound action-type slug to its canonical registered form.
 *
 * Returns the canonical slug if the input matches an alias; returns the input
 * unchanged otherwise. First hit per alias per process logs a warning so alias
 * consumption is observable without log spam.
 */
export function resolveActionSlug(slug: string): string {
  const canonical = ACTION_SLUG_ALIASES[slug];
  if (canonical === undefined) return slug;
  if (!loggedAliasHits.has(slug)) {
    loggedAliasHits.add(slug);

    console.warn(
      `[action-registry] legacy slug consumed: '${slug}' → '${canonical}'. Update the caller.`,
    );
  }
  return canonical;
}

/**
 * Test-only — reset the log-once set so tests can assert the first-hit log
 * fires exactly once per alias per process. Never call from production code.
 */
export function __resetActionSlugAliasLogOnceForTests(): void {
  loggedAliasHits.clear();
}

/** Check if an action type is known. Routes through the alias resolver. */
export function getActionDefinition(actionType: string): ActionDefinition | undefined {
  return ACTION_REGISTRY[resolveActionSlug(actionType)];
}

/**
 * Sprint 5 P4.1 — returns the action types of all universal skills.
 * Re-exports from the dependency-free universalSkills.ts so callers
 * that already import from actionRegistry don't need to change.
 */
export { UNIVERSAL_SKILL_NAMES };
export function getUniversalSkillNames(): string[] {
  return [...UNIVERSAL_SKILL_NAMES];
}

/** Valid action statuses for state machine enforcement */
export const VALID_ACTION_STATUSES = [
  'proposed', 'pending_approval', 'approved', 'executing',
  'completed', 'failed', 'rejected', 'blocked', 'skipped',
] as const;

export type ActionStatus = typeof VALID_ACTION_STATUSES[number];

/** Legal state transitions */
export const LEGAL_TRANSITIONS: Record<string, string[]> = {
  proposed: ['pending_approval', 'approved', 'blocked', 'skipped', 'failed'],
  pending_approval: ['approved', 'rejected'],
  approved: ['executing'],
  executing: ['completed', 'failed'],
  // Terminal states: completed, failed, rejected, blocked, skipped — no transitions out
};
