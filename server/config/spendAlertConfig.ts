// ---------------------------------------------------------------------------
// spendAlertConfig — operational alert threshold registry for agentic commerce
//
// All defaults are tunable per environment via env-var overrides.
// Spec: tasks/builds/agentic-commerce/spec.md §10 invariant 39
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 13
// ---------------------------------------------------------------------------

/**
 * negativeAggregateClamp — always critical (no threshold; single occurrence triggers).
 * Fired by agentSpendAggregateService when a subtraction would take an aggregate
 * below zero. Signals derived-view drift that needs manual investigation.
 */
export const NEGATIVE_AGGREGATE_CLAMP_LEVEL = 'critical' as const;

/**
 * webhookDeliveryDelayMs — warning when the time between Stripe event creation
 * and stripeAgentWebhookService receipt exceeds this value (default 10 minutes).
 */
export const WEBHOOK_DELIVERY_DELAY_WARNING_MS: number =
  Number(process.env['SPEND_WEBHOOK_DELAY_WARNING_MS'] ?? 10 * 60 * 1000);

/**
 * chargeRetryAttempts — warning when the count of agent_charges rows sharing
 * the same intent_id (i.e. retries) exceeds this value (default 3).
 */
export const CHARGE_RETRY_ATTEMPTS_WARNING_THRESHOLD: number =
  Number(process.env['SPEND_CHARGE_RETRY_WARNING_THRESHOLD'] ?? 3);

/**
 * advisoryLockWaitMs — warning when pg_advisory_xact_lock acquisition for a
 * spending_budget_id takes longer than this value (default 1000 ms).
 */
export const ADVISORY_LOCK_WAIT_WARNING_MS: number =
  Number(process.env['SPEND_ADVISORY_LOCK_WAIT_WARNING_MS'] ?? 1000);

/**
 * spendThroughputAnomaly — warning when the 1-min proposed→terminal rate falls
 * below this fraction of the 7-day rolling baseline (default 0.5 = 50%).
 * Critical when below the critical fraction for more than the critical duration.
 */
export const SPEND_THROUGHPUT_ANOMALY_WARNING_FRACTION: number =
  Number(process.env['SPEND_THROUGHPUT_WARNING_FRACTION'] ?? 0.5);

export const SPEND_THROUGHPUT_ANOMALY_CRITICAL_FRACTION: number =
  Number(process.env['SPEND_THROUGHPUT_CRITICAL_FRACTION'] ?? 0.2);

export const SPEND_THROUGHPUT_ANOMALY_CRITICAL_DURATION_MS: number =
  Number(process.env['SPEND_THROUGHPUT_CRITICAL_DURATION_MS'] ?? 5 * 60 * 1000);

/**
 * Alert level types.
 */
export type SpendAlertLevel = 'warning' | 'critical';

/**
 * Full config snapshot — useful for injection in tests.
 */
export interface SpendAlertConfig {
  negativeAggregateClampLevel: typeof NEGATIVE_AGGREGATE_CLAMP_LEVEL;
  webhookDeliveryDelayWarningMs: number;
  chargeRetryAttemptsWarningThreshold: number;
  advisoryLockWaitWarningMs: number;
  spendThroughputAnomalyWarningFraction: number;
  spendThroughputAnomalyCriticalFraction: number;
  spendThroughputAnomalyCriticalDurationMs: number;
}

export const SPEND_ALERT_CONFIG: SpendAlertConfig = {
  negativeAggregateClampLevel: NEGATIVE_AGGREGATE_CLAMP_LEVEL,
  webhookDeliveryDelayWarningMs: WEBHOOK_DELIVERY_DELAY_WARNING_MS,
  chargeRetryAttemptsWarningThreshold: CHARGE_RETRY_ATTEMPTS_WARNING_THRESHOLD,
  advisoryLockWaitWarningMs: ADVISORY_LOCK_WAIT_WARNING_MS,
  spendThroughputAnomalyWarningFraction: SPEND_THROUGHPUT_ANOMALY_WARNING_FRACTION,
  spendThroughputAnomalyCriticalFraction: SPEND_THROUGHPUT_ANOMALY_CRITICAL_FRACTION,
  spendThroughputAnomalyCriticalDurationMs: SPEND_THROUGHPUT_ANOMALY_CRITICAL_DURATION_MS,
};
