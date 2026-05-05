// ---------------------------------------------------------------------------
// chargeRouterServicePure — pure charge-router decision functions
//
// No DB, no Stripe, no I/O. All functions are deterministic and side-effect-free.
// Impure orchestration lives in chargeRouterService.ts (Chunk 5).
//
// Spec: tasks/builds/agentic-commerce/spec.md §4, §8.1, §8.5, §9.1,
//       §10 invariants 18/19/21/24/26/32/42, §16.2, §16.12
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 4
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import { canonicaliseJson } from '../lib/canonicalJsonPure.js';
import {
  CHARGE_KEY_VERSION,
  ISO_4217_MINOR_UNIT_EXPONENT,
} from '../config/spendConstants.js';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface SpendingPolicy {
  id: string;
  spendingBudgetId: string;
  mode: 'shadow' | 'live';
  perTxnLimitMinor: number;
  dailyLimitMinor: number;
  monthlyLimitMinor: number;
  approvalThresholdMinor: number;
  merchantAllowlist: Array<{
    id: string | null;
    descriptor: string;
    source: 'stripe_id' | 'descriptor';
  }>;
  approvalExpiresHours: number;
  version: number;
  velocityConfig: null;
  confidenceGateConfig: null;
}

export interface ChargeRouterRequest {
  organisationId: string;
  subaccountId: string | null;
  agentId: string | null;
  skillRunId: string;
  toolCallId: string;
  intent: string;
  amountMinor: number;
  currency: string;
  merchant: {
    id: string | null;
    descriptor: string;
  };
  chargeType: 'purchase' | 'subscription' | 'top_up' | 'invoice_payment' | 'refund';
  args: Record<string, unknown>;
  parentChargeId: string | null;
}

export interface EvaluatePolicyInput {
  policy: SpendingPolicy;
  budget: { currency: string; disabledAt: Date | null };
  request: ChargeRouterRequest;
  killSwitchActive: boolean;
  sptStatus: 'active' | 'expired' | 'revoked' | 'unavailable';
  reservedCapacity: { dailyMinor: number; monthlyMinor: number };
  settledNet: { dailyMinor: number; monthlyMinor: number };
}

export interface EvaluatePolicyResult {
  outcome: 'approved' | 'pending_approval' | 'blocked';
  failureReason: string | null;
  reservedMinor: number;
  decisionPath: {
    killSwitch: 'pass' | 'fail';
    spt: 'pass' | 'fail';
    currency: 'pass' | 'fail';
    allowlist: 'pass' | 'fail';
    perTxnLimit: 'pass' | 'fail' | 'unset';
    dailyLimit: 'pass' | 'fail' | 'unset';
    monthlyLimit: 'pass' | 'fail' | 'unset';
    threshold: 'auto' | 'review';
  };
}

/** Minimal plan step shape for previewSpendForPlan */
export interface ParsedPlanStep {
  amountMinor: number;
  currency: string;
  merchant: { id: string | null; descriptor: string };
  intent: string;
}

export interface ParsedPlan {
  steps: ParsedPlanStep[];
}

// ---------------------------------------------------------------------------
// evaluatePolicy
// ---------------------------------------------------------------------------

/**
 * Pure policy evaluation. Gate ordering per spec §4:
 *   (1)   Kill Switch / SPT validity
 *   (1.5) Currency check
 *   (2)   Merchant Allowlist
 *   (3)   Spending Limits (including reserved capacity)
 *   (4)   Approval Threshold
 *
 * Limits set to 0 are treated as "unset" (no cap). Spec §4, §14 conservative defaults.
 * Throws for programming errors (non-positive amountMinor, unknown currency).
 */
export function evaluatePolicy(input: EvaluatePolicyInput): EvaluatePolicyResult {
  const { policy, budget, request, killSwitchActive, sptStatus, reservedCapacity, settledNet } = input;

  // Validate caller contract: programming errors throw, not return blocked.
  if (request.amountMinor <= 0) {
    throw new Error(
      `[chargeRouterServicePure] amountMinor must be > 0 — got ${request.amountMinor}. `
      + 'Zero or negative charge amounts are a programming error (spec §10 invariant 19).',
    );
  }
  if (!(request.currency in ISO_4217_MINOR_UNIT_EXPONENT)) {
    throw new Error(
      `[chargeRouterServicePure] Unknown currency "${request.currency}" not in ISO_4217_MINOR_UNIT_EXPONENT table. `
      + 'Add it to server/config/spendConstants.ts before using it.',
    );
  }

  // Initialise decision path with optimistic values; overwritten as gates run.
  const dp: EvaluatePolicyResult['decisionPath'] = {
    killSwitch: 'pass',
    spt: 'pass',
    currency: 'pass',
    allowlist: 'pass',
    perTxnLimit: 'unset',
    dailyLimit: 'unset',
    monthlyLimit: 'unset',
    threshold: 'auto',
  };

  // ── Gate 1: Kill Switch ────────────────────────────────────────────────────
  if (killSwitchActive || budget.disabledAt !== null) {
    dp.killSwitch = 'fail';
    return {
      outcome: 'blocked',
      failureReason: 'kill_switch',
      reservedMinor: 0,
      decisionPath: dp,
    };
  }

  // ── Gate 1 (SPT): SPT validity ─────────────────────────────────────────────
  if (sptStatus === 'expired' || sptStatus === 'revoked' || sptStatus === 'unavailable') {
    dp.spt = 'fail';
    return {
      outcome: 'blocked',
      failureReason: sptStatus === 'expired' ? 'spt_expired'
        : sptStatus === 'revoked' ? 'spt_revoked'
        : 'spt_unavailable',
      reservedMinor: 0,
      decisionPath: dp,
    };
  }

  // ── Gate 1.5: Currency check (spec §10 invariant 18) ─────────────────────
  if (request.currency !== budget.currency) {
    dp.currency = 'fail';
    return {
      outcome: 'blocked',
      failureReason: 'currency_mismatch',
      reservedMinor: 0,
      decisionPath: dp,
    };
  }

  // ── Gate 2: Merchant Allowlist ─────────────────────────────────────────────
  // Empty allowlist blocks everything. Match on stripe_id first; fall back to descriptor.
  const allowlistPass = matchMerchantAllowlist(request.merchant, policy.merchantAllowlist);
  if (!allowlistPass) {
    dp.allowlist = 'fail';
    return {
      outcome: 'blocked',
      failureReason: 'allowlist_miss',
      reservedMinor: 0,
      decisionPath: dp,
    };
  }

  // ── Gate 3: Spending Limits (with reserved capacity) ──────────────────────
  // Effective spend = settled net + current reserved + this new charge.
  // Limit of 0 = unset (no cap). Spec §4, §16.2.

  // Per-transaction limit.
  if (policy.perTxnLimitMinor > 0) {
    dp.perTxnLimit = request.amountMinor <= policy.perTxnLimitMinor ? 'pass' : 'fail';
  }
  if (dp.perTxnLimit === 'fail') {
    return {
      outcome: 'blocked',
      failureReason: 'per_txn_limit_exceeded',
      reservedMinor: 0,
      decisionPath: dp,
    };
  }

  // Daily limit.
  if (policy.dailyLimitMinor > 0) {
    const projectedDaily = settledNet.dailyMinor + reservedCapacity.dailyMinor + request.amountMinor;
    dp.dailyLimit = projectedDaily <= policy.dailyLimitMinor ? 'pass' : 'fail';
  }
  if (dp.dailyLimit === 'fail') {
    return {
      outcome: 'blocked',
      failureReason: 'daily_limit_exceeded',
      reservedMinor: 0,
      decisionPath: dp,
    };
  }

  // Monthly limit.
  if (policy.monthlyLimitMinor > 0) {
    const projectedMonthly = settledNet.monthlyMinor + reservedCapacity.monthlyMinor + request.amountMinor;
    dp.monthlyLimit = projectedMonthly <= policy.monthlyLimitMinor ? 'pass' : 'fail';
  }
  if (dp.monthlyLimit === 'fail') {
    return {
      outcome: 'blocked',
      failureReason: 'monthly_limit_exceeded',
      reservedMinor: 0,
      decisionPath: dp,
    };
  }

  // ── Gate 4: Approval Threshold ────────────────────────────────────────────
  // threshold of 0 means every positive charge routes to HITL.
  if (request.amountMinor > policy.approvalThresholdMinor) {
    dp.threshold = 'review';
    return {
      outcome: 'pending_approval',
      failureReason: null,
      reservedMinor: request.amountMinor,
      decisionPath: dp,
    };
  }

  // All gates passed — auto-approved.
  return {
    outcome: 'approved',
    failureReason: null,
    reservedMinor: request.amountMinor,
    decisionPath: dp,
  };
}

// ---------------------------------------------------------------------------
// buildChargeIdempotencyKey
// ---------------------------------------------------------------------------

/**
 * Constructs the charge idempotency key per spec §9.1.
 *
 * Shape: `${CHARGE_KEY_VERSION}:${skillRunId}:${toolCallId}:${prefixedIntent}:${sha256Hash}`
 * where prefixedIntent = `charge:${mode}:${intent}` and sha256Hash = sha256(canonicaliseJson(args)).
 *
 * CALLER CONTRACT (spec §10 invariant 21): args.merchant MUST already have been
 * passed through normaliseMerchantDescriptor before being placed on the args object.
 * This function does NOT re-normalise — it canonicalises and hashes whatever it receives.
 */
export function buildChargeIdempotencyKey(input: {
  skillRunId: string;
  toolCallId: string;
  intent: string;
  args: Record<string, unknown>;
  mode: 'shadow' | 'live';
}): string {
  const { skillRunId, toolCallId, intent, args, mode } = input;
  const prefixedIntent = `charge:${mode}:${intent}`;
  const argsHash = createHash('sha256').update(canonicaliseJson(args)).digest('hex');
  return `${CHARGE_KEY_VERSION}:${skillRunId}:${toolCallId}:${prefixedIntent}:${argsHash}`;
}

// ---------------------------------------------------------------------------
// normaliseMerchantDescriptor
// ---------------------------------------------------------------------------

/**
 * Canonical normaliser for merchant descriptor strings. Spec §16.12 algorithm:
 *   1. NFKC unicode normalisation
 *   2. Trim leading/trailing whitespace
 *   3. Collapse internal whitespace runs to a single ASCII space
 *   4. en-US uppercase (locale-pinned)
 *   5. Strip punctuation but preserve `&`
 *
 * Single source of truth — used by skill handlers (Chunk 6), worker spend_request
 * emit path (Chunk 11), and main-app idempotency-recompute path (Chunk 11).
 */
export function normaliseMerchantDescriptor(input: string): string {
  // Step 1: NFKC normalisation.
  let result = input.normalize('NFKC');
  // Step 2: Trim.
  result = result.trim();
  // Step 3: Collapse internal whitespace.
  result = result.replace(/\s+/g, ' ');
  // Step 4: en-US uppercase.
  result = result.toLocaleUpperCase('en-US');
  // Step 5: Strip punctuation but keep `&`. Spec §16.12 strip list.
  result = result.replace(/[.,;:'"``!?\-_/\\()]/g, '');
  return result;
}

// ---------------------------------------------------------------------------
// previewSpendForPlan
// ---------------------------------------------------------------------------

/**
 * Advisory preview of spend verdicts for a multi-step plan. Used during the
 * planning phase to surface policy mismatches before execution begins.
 * Fail-open — errors in individual step evaluation surface as 'would_block'.
 *
 * Spec §12 (planning-phase advisory), §10 invariant 15.
 */
export function previewSpendForPlan(
  plan: ParsedPlan,
  policy: SpendingPolicy,
): Array<{ stepIndex: number; verdict: 'would_auto' | 'would_review' | 'would_block' | 'over_budget' }> {
  const results: Array<{ stepIndex: number; verdict: 'would_auto' | 'would_review' | 'would_block' | 'over_budget' }> = [];

  let accumulatedMinor = 0;

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];

    // Check merchant allowlist.
    const onAllowlist = matchMerchantAllowlist(step.merchant, policy.merchantAllowlist);
    if (!onAllowlist) {
      results.push({ stepIndex: i, verdict: 'would_block' });
      continue;
    }

    // Per-transaction limit check.
    if (policy.perTxnLimitMinor > 0 && step.amountMinor > policy.perTxnLimitMinor) {
      results.push({ stepIndex: i, verdict: 'would_block' });
      continue;
    }

    // Running budget check (daily limit used as a plan-level proxy).
    if (policy.dailyLimitMinor > 0 && accumulatedMinor + step.amountMinor > policy.dailyLimitMinor) {
      results.push({ stepIndex: i, verdict: 'over_budget' });
      continue;
    }

    accumulatedMinor += step.amountMinor;

    // Threshold check.
    if (step.amountMinor > policy.approvalThresholdMinor) {
      results.push({ stepIndex: i, verdict: 'would_review' });
    } else {
      results.push({ stepIndex: i, verdict: 'would_auto' });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// validateAmountForCurrency
// ---------------------------------------------------------------------------

/**
 * Validates that amountMinor is a valid integer for the given currency per
 * ISO 4217 exponent rules. Spec §10 invariant 24.
 *
 * Rejects fractional minor units (e.g. 0.5 of any currency) and unknown currencies.
 */
export function validateAmountForCurrency(
  amountMinor: number,
  currency: string,
): { valid: true } | { valid: false; reason: 'fractional_minor_unit' | 'unknown_currency' } {
  if (!(currency in ISO_4217_MINOR_UNIT_EXPONENT)) {
    return { valid: false, reason: 'unknown_currency' };
  }
  // Minor unit must be a non-negative integer — no fractional minor units.
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    return { valid: false, reason: 'fractional_minor_unit' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// classifyStripeError
// ---------------------------------------------------------------------------

export type StripeErrorClassification =
  | 'auth_refresh_retry'
  | 'fail_402'
  | 'idempotency_conflict'
  | 'rate_limited_retry'
  | 'server_retry'
  | 'fail_other_4xx';

/**
 * Maps a Stripe error (HTTP status or stripe-node error shape) to the canonical
 * retry classification per spec §10 invariant 26.
 *
 * Single authority — chargeRouterService.executeApproved branches on this result.
 * No other call site invents its own classification.
 */
export function classifyStripeError(err: unknown): StripeErrorClassification {
  const status = extractHttpStatus(err);
  if (status === null) {
    // Non-HTTP errors (network failure, parse error) — treat as server_retry.
    return 'server_retry';
  }
  if (status === 401) return 'auth_refresh_retry';
  if (status === 402) return 'fail_402';
  if (status === 409) return 'idempotency_conflict';
  if (status === 429) return 'rate_limited_retry';
  if (status >= 500) return 'server_retry';
  // Other 4xx (400, 403, 404, 422, etc.)
  return 'fail_other_4xx';
}

// ---------------------------------------------------------------------------
// deriveWindowKey
// ---------------------------------------------------------------------------

/**
 * Returns a canonical window key for a UTC timestamp.
 * Daily:   'YYYY-MM-DD'
 * Monthly: 'YYYY-MM'
 *
 * Uses half-open [start, end) semantics per spec §10 invariant 42 —
 * a charge AT exactly 2026-05-04T00:00:00.000Z falls into '2026-05-04',
 * not '2026-05-03'.
 *
 * Currently only 'UTC' timezone is supported (v1). The timezone parameter
 * is present for forward-compatibility.
 */
export function deriveWindowKey(
  timestamp: Date,
  dimension: 'daily' | 'monthly',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  timezone: 'UTC',
): string {
  const year = timestamp.getUTCFullYear();
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, '0');
  if (dimension === 'monthly') {
    return `${year}-${month}`;
  }
  const day = String(timestamp.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/**
 * Merchant allowlist matching. Primary: stripe_id exact match. Fallback: normalised descriptor.
 * Empty allowlist = no merchants allowed = every charge fails the allowlist gate.
 */
function matchMerchantAllowlist(
  merchant: { id: string | null; descriptor: string },
  allowlist: SpendingPolicy['merchantAllowlist'],
): boolean {
  if (allowlist.length === 0) return false;

  const normalisedIncoming = normaliseMerchantDescriptor(merchant.descriptor);

  for (const entry of allowlist) {
    // Primary: stripe ID match (exact, opaque string — never normalised per spec §16.12).
    if (
      entry.source === 'stripe_id'
      && entry.id !== null
      && merchant.id !== null
      && entry.id === merchant.id
    ) {
      return true;
    }
    // Fallback: normalised descriptor match.
    if (entry.source === 'descriptor' && entry.descriptor === normalisedIncoming) {
      return true;
    }
  }
  return false;
}

/**
 * Extracts HTTP status from a Stripe-node-compatible error shape.
 * Returns null if the shape does not carry an HTTP status.
 */
function extractHttpStatus(err: unknown): number | null {
  if (err === null || typeof err !== 'object') return null;
  const candidate = err as Record<string, unknown>;
  // stripe-node v4+: StripeError.statusCode
  if (typeof candidate['statusCode'] === 'number') return candidate['statusCode'];
  // stripe-node v3: StripeError.status
  if (typeof candidate['status'] === 'number') return candidate['status'];
  // Generic HTTP error shapes (axios, fetch wrappers, etc.)
  if (typeof candidate['httpStatus'] === 'number') return candidate['httpStatus'];
  return null;
}
