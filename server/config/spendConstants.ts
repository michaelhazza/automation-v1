// ---------------------------------------------------------------------------
// spendConstants — single source of truth for agentic-commerce constants
//
// Spec: tasks/builds/agentic-commerce/spec.md §9.1, §10 invariants 24/26/42
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 4
// ---------------------------------------------------------------------------

/**
 * Execution window for `approved` charges. An approved charge that does not
 * transition to `executed` or `shadow_settled` within this window is auto-marked
 * `failed` with `reason = 'execution_timeout'`. Spec §4, §10 invariant 11.
 */
export const EXECUTION_TIMEOUT_MINUTES = 30;

/**
 * Current charge-key version. Prepended to every hash produced by
 * `chargeRouterServicePure.buildChargeIdempotencyKey`. Bump when the
 * canonicalisation contract changes — old rows (`v1:...`) stay valid for
 * in-flight retries while new calls hash as `v2:...`. Mirrors the pattern
 * in `server/lib/idempotencyVersion.ts`.
 */
export const CHARGE_KEY_VERSION = 'v1' as const;
export type ChargeKeyVersion = typeof CHARGE_KEY_VERSION;

// Load-time guard — mirrors IDEMPOTENCY_KEY_VERSION assert in idempotencyVersion.ts.
// Catches accidental empty or malformed constant after a refactor.
if (!/^v\d+$/.test(CHARGE_KEY_VERSION)) {
  throw new Error(
    `[spendConstants] CHARGE_KEY_VERSION must match /^v\\d+$/ — got ${JSON.stringify(CHARGE_KEY_VERSION)}. `
    + 'Bump deliberately via the constant in server/config/spendConstants.ts; '
    + 'do not leave it empty or set it to an unprefixed string.',
  );
}

/**
 * Hard cap on merchant allowlist entries per Spending Policy. Allowlists larger
 * than this value are rejected at write time by spendingBudgetService.
 */
export const MERCHANT_ALLOWLIST_MAX_ENTRIES = 250;

/**
 * ISO 4217 minor-unit exponent table. Maps currency code to the number of
 * decimal places in the minor unit (e.g. USD = 2 means "cents"; JPY = 0
 * means the minor unit IS the yen — no subdivision).
 *
 * Used by validateAmountForCurrency (fractional-minor-unit check per
 * invariant 24) and stripeAgentWebhookService (inbound webhook amount
 * reconciliation). Single source of truth — extend here when adding new
 * currencies; never redeclare in individual services.
 *
 * Spec §10 invariant 24.
 */
export const ISO_4217_MINOR_UNIT_EXPONENT: Readonly<Record<string, number>> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  NZD: 2,
  SGD: 2,
  HKD: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  MXN: 2,
  BRL: 2,
  PLN: 2,
  CZK: 2,
  ILS: 2,
  MYR: 2,
  THB: 2,
  PHP: 2,
  // Zero-decimal currencies (minor unit = whole currency unit)
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  HUF: 0,
  TWD: 0,
  // Three-decimal currencies
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3,
} as const;

/**
 * Stripe HTTP-status retry classification table. Documented here for reference;
 * the authoritative classifier is `chargeRouterServicePure.classifyStripeError`.
 *
 * | HTTP status | Classification            | Retry?     |
 * |-------------|--------------------------|------------|
 * | 401         | auth_refresh_retry       | Yes — after SPT refresh |
 * | 402         | fail_402                 | No — payment declined   |
 * | 409         | idempotency_conflict     | No — key collision      |
 * | 429         | rate_limited_retry       | Yes — with backoff      |
 * | 5xx         | server_retry             | Yes — with backoff      |
 * | other 4xx   | fail_other_4xx           | No                      |
 *
 * Spec §10 invariant 26.
 */
export const STRIPE_RETRY_CLASSIFICATION = {
  AUTH_REFRESH_RETRY: 'auth_refresh_retry',
  FAIL_402: 'fail_402',
  IDEMPOTENCY_CONFLICT: 'idempotency_conflict',
  RATE_LIMITED_RETRY: 'rate_limited_retry',
  SERVER_RETRY: 'server_retry',
  FAIL_OTHER_4XX: 'fail_other_4xx',
} as const;

export type StripeRetryClassification = (typeof STRIPE_RETRY_CLASSIFICATION)[keyof typeof STRIPE_RETRY_CLASSIFICATION];

/**
 * Margin (ms) subtracted from the worker round-trip deadline before the main
 * app considers a handoff stale. Prevents races where a worker response arrives
 * milliseconds after the deadline and is incorrectly discarded.
 *
 * Default 60 000 ms (1 minute). Configurable at runtime via the handoff margin
 * constant; consumers read this value rather than hardcoding their own.
 */
export const SPT_WORKER_HANDOFF_MARGIN_MS = 60_000;
