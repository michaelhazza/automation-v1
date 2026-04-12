/**
 * universalSkills.ts — dependency-free list of universal skill names.
 *
 * Extracted so that agentExecutionServicePure.ts can import this without
 * pulling in zod (via actionRegistry). Both actionRegistry.ts and the pure
 * module import from here. The canonical isUniversal flag still lives in
 * ACTION_REGISTRY; this list must stay in sync.
 *
 * Sprint 5 P4.1 of docs/improvements-roadmap-spec.md.
 */

/**
 * Action types that are always available to every agent, regardless of the
 * subaccount allowlist or topic filter. The topic filter's "hard removal"
 * mode re-injects these after filtering.
 */
export const UNIVERSAL_SKILL_NAMES: readonly string[] = [
  'ask_clarifying_question',
  'read_workspace',
  'web_search',
  'read_codebase',
  'search_agent_history',
  'read_priority_feed',
];
