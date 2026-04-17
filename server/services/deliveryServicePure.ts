/**
 * deliveryServicePure — pure delivery channel logic
 *
 * Deterministic helpers for the delivery retry ladder and channel dispatch
 * decisions. No I/O, no DB, no external calls. Testable via tsx.
 *
 * Retry ladder per spec §10.5:
 *   email  — 3 retries (inbox write + email notification)
 *   slack  — 2 retries
 *   portal — 0 retries (attribute-based visibility; no external call)
 *
 * Spec: docs/memory-and-briefings-spec.md §10.5 (S22)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeliveryChannel = 'email' | 'portal' | 'slack';

export type ChannelDispatchStatus =
  | 'delivered'       // successfully dispatched
  | 'skipped'         // config says false for this channel
  | 'failed'          // all retries exhausted
  | 'not_configured'; // no active integration for this channel

export interface ChannelDispatchResult {
  channel: DeliveryChannel;
  status: ChannelDispatchStatus;
  /** Total number of attempts made (including the initial attempt). */
  attempts: number;
  error?: string;
}

export interface DeliveryArtefact {
  /** Inbox task title. */
  title: string;
  /** Body content (markdown). */
  content: string;
  /** Optional agent ID that produced this artefact. */
  createdByAgentId?: string;
}

export interface DeliveryChannelConfig {
  email: boolean;
  portal: boolean;
  slack: boolean;
}

// ---------------------------------------------------------------------------
// Retry ladder
// ---------------------------------------------------------------------------

/**
 * Per-channel retry configuration.
 *
 * maxAttempts is the total number of attempts (initial + retries).
 * email maxAttempts=4 means 1 initial + 3 retries per spec §10.5.
 */
export const DELIVERY_RETRY_CONFIG: Record<
  DeliveryChannel,
  { maxAttempts: number; baseDelayMs: number }
> = {
  email: { maxAttempts: 4, baseDelayMs: 1000 }, // 3 retries
  portal: { maxAttempts: 1, baseDelayMs: 0 },   // 0 retries — attribute-based
  slack: { maxAttempts: 3, baseDelayMs: 1000 }, // 2 retries
};

export function getMaxAttempts(channel: DeliveryChannel): number {
  return DELIVERY_RETRY_CONFIG[channel]?.maxAttempts ?? 1;
}

export function getMaxRetries(channel: DeliveryChannel): number {
  return getMaxAttempts(channel) - 1;
}

/**
 * Exponential backoff delay before attempt N.
 *
 * attempt is 1-indexed. Attempt 1 is the initial call — no delay.
 * Attempt 2 is the first retry — delay = baseDelayMs.
 * Attempt 3 is the second retry — delay = baseDelayMs × 2. Etc.
 *
 * Formula: baseDelayMs × 2^(attempt − 2) for attempt ≥ 2.
 * Returns 0 when baseDelayMs is 0 (portal) or attempt < 2.
 */
export function computeBackoffDelay(baseDelayMs: number, attempt: number): number {
  if (baseDelayMs <= 0 || attempt < 2) return 0;
  return baseDelayMs * Math.pow(2, attempt - 2);
}

/**
 * Returns true when a further attempt is allowed (has not yet exhausted
 * the retry budget). attemptNumber is 1-indexed.
 */
export function canAttempt(channel: DeliveryChannel, attemptNumber: number): boolean {
  return attemptNumber <= getMaxAttempts(channel);
}

// ---------------------------------------------------------------------------
// Dispatch decision
// ---------------------------------------------------------------------------

/**
 * Decide whether a channel should be dispatched.
 *
 * Always-on inbox invariant (§10.5): email dispatch is unconditional.
 * Even when `config.email === false`, the inbox write always happens —
 * `config.email` controls the outbound email notification only, but the
 * task is always written to inbox regardless.
 *
 * Portal: attribute-based — no active dispatch. Returns true when enabled
 * in config so the caller logs it as delivered.
 *
 * Slack: requires `config.slack === true`.
 */
export function shouldDispatchChannel(
  channel: DeliveryChannel,
  config: DeliveryChannelConfig,
): boolean {
  if (channel === 'email') return true; // always-on inbox invariant
  return Boolean(config[channel]);
}

// ---------------------------------------------------------------------------
// Eligibility resolver — single source of truth for final channel set
// ---------------------------------------------------------------------------

/**
 * Combine channel *availability* (from DB/integrations) with user *config*
 * (per-subaccount delivery preferences) to return the final set of enabled
 * channels for a delivery run.
 *
 * Rules:
 *   email  — always true (always-on inbox invariant §10.5)
 *   portal — true only when available.portal AND config.portal
 *   slack  — true only when available.slack AND config.slack
 *
 * All callers (routes, backend validation, execution layer) must use this
 * function — no caller should re-implement the logic. PR Review Item 5.
 */
export function resolveDeliveryEligibility(
  available: DeliveryChannelConfig,
  config: DeliveryChannelConfig,
): DeliveryChannelConfig {
  return {
    email:  true,
    portal: available.portal && config.portal,
    slack:  available.slack  && config.slack,
  };
}
