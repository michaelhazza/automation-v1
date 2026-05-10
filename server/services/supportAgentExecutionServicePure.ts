// Pure helpers for the Support Agent execution loop — no DB, no IO, no side effects.
// Tested in server/services/__tests__/supportAgentExecutionServicePure.test.ts

import type { SupportInboxAgentConfig } from '../../shared/types/supportInboxAgentConfig.js';

// ---------------------------------------------------------------------------
// Per-ticket terminal verdict enum
// ---------------------------------------------------------------------------

export type PerTicketVerdict =
  | 'drafted_for_review'
  | 'drafted_and_dispatched'
  | 'skipped_collision'
  | 'escalated_to_human'
  | 'skipped_low_confidence'
  | 'skipped_no_action_needed';

export const TERMINAL_VERDICTS: ReadonlyArray<PerTicketVerdict> = [
  'drafted_for_review',
  'drafted_and_dispatched',
  'skipped_collision',
  'escalated_to_human',
  'skipped_low_confidence',
  'skipped_no_action_needed',
];

export function isTerminalVerdict(value: unknown): value is PerTicketVerdict {
  return typeof value === 'string' && (TERMINAL_VERDICTS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Atomic claim predicate construction
// ---------------------------------------------------------------------------

/**
 * Returns the SQL fragment (as a string) for the WHERE clause used in the
 * optimistic claim UPDATE. The TTL check is expressed as a string so the
 * caller can inject it via sql.raw() — never interpolated via user input.
 *
 * Caller is responsible for parameterising ticketId and orgId.
 */
export function buildClaimPredicateSql(claimTtlMinutes: number): string {
  if (!Number.isInteger(claimTtlMinutes) || claimTtlMinutes <= 0) {
    throw new Error(`claimTtlMinutes must be a positive integer, got ${claimTtlMinutes}`);
  }
  return `bot_claimed_at IS NULL OR bot_claimed_at < now() - interval '${claimTtlMinutes} minutes'`;
}

// ---------------------------------------------------------------------------
// Human-activity collision check predicate
// ---------------------------------------------------------------------------

/**
 * Returns true when the ticket should be skipped because a human acted recently.
 *
 * @param lastHumanActivityAt  The canonical_tickets.last_human_activity_at value (null if never)
 * @param minMinutes           collisionWindow.minMinutesSinceHumanActivity from inbox config
 * @param nowMs                Current time in ms (injected for testability)
 */
export function isHumanActivityTooRecent(
  lastHumanActivityAt: Date | null,
  minMinutes: number,
  nowMs: number,
): boolean {
  if (!lastHumanActivityAt) return false;
  const elapsedMinutes = (nowMs - lastHumanActivityAt.getTime()) / 60_000;
  return elapsedMinutes < minMinutes;
}

/**
 * Returns the elapsed minutes since lastHumanActivityAt, or null if never.
 */
export function minutesSinceHumanActivity(
  lastHumanActivityAt: Date | null,
  nowMs: number,
): number | null {
  if (!lastHumanActivityAt) return null;
  return (nowMs - lastHumanActivityAt.getTime()) / 60_000;
}

// ---------------------------------------------------------------------------
// list_open_tickets filter SQL builder (pure — returns SQL string fragment)
// ---------------------------------------------------------------------------

/**
 * Returns the SQL NOT EXISTS fragment for the terminal-event predicate used
 * in support.list_open_tickets. This is the outer-loop idempotency guard.
 *
 * The clause is parameterless (no user input) — safe to embed via sql.raw().
 */
export function buildTerminalEventPredicateSql(): string {
  return `NOT EXISTS (
  SELECT 1
  FROM   agent_execution_events e
  WHERE  e.organisation_id = canonical_tickets.organisation_id
    AND  e.payload->>'ticketId' = canonical_tickets.id::text
    AND  e.event_type IN (
           'phase1.support.draft_proposed',
           'phase1.support.collision_skipped',
           'phase1.support.ticket_terminal'
         )
    AND  e.created_at >= COALESCE(canonical_tickets.last_customer_message_at, canonical_tickets.created_at)
)`;
}

// ---------------------------------------------------------------------------
// Master-prompt placeholder substitution
// ---------------------------------------------------------------------------

export interface PromptPlaceholders {
  voice_profile: string;
  min_confidence: string;
  escalation_categories: string;
  inbox_mode: string;
}

/**
 * Substitutes {{placeholder}} tokens in a master prompt template.
 * Unknown placeholders are left as-is (no silent erasure).
 */
export function substituteMasterPromptPlaceholders(
  template: string,
  placeholders: PromptPlaceholders,
): string {
  return template
    .replace(/\{\{voice_profile\}\}/g, placeholders.voice_profile)
    .replace(/\{\{min_confidence\}\}/g, placeholders.min_confidence)
    .replace(/\{\{escalation_categories\}\}/g, placeholders.escalation_categories)
    .replace(/\{\{inbox_mode\}\}/g, placeholders.inbox_mode);
}

/**
 * Builds the placeholder map from a SupportInboxAgentConfig.
 */
export function buildPromptPlaceholders(config: SupportInboxAgentConfig): PromptPlaceholders {
  const escalationCategories = config.escalationCategories?.length
    ? config.escalationCategories.join(', ')
    : 'none configured';

  return {
    voice_profile: config.voiceProfile ?? 'neutral',
    min_confidence: String(config.minConfidence ?? 0.8),
    escalation_categories: escalationCategories,
    inbox_mode: config.mode,
  };
}

// ---------------------------------------------------------------------------
// Account-issue intents that trigger customer history lookup
// ---------------------------------------------------------------------------

export const ACCOUNT_ISSUE_INTENTS = new Set([
  'account_question',
  'billing_question',
  'cancellation_request',
]);

export function requiresCustomerHistory(intent: string): boolean {
  return ACCOUNT_ISSUE_INTENTS.has(intent);
}

// ---------------------------------------------------------------------------
// Claim TTL default
// ---------------------------------------------------------------------------

export const DEFAULT_CLAIM_TTL_MINUTES = 15;
