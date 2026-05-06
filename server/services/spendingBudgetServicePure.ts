// ---------------------------------------------------------------------------
// spendingBudgetServicePure — pure helpers for spending budget operations
//
// No DB, no I/O. All functions are deterministic and side-effect-free.
// Impure orchestration lives in spendingBudgetService.ts.
//
// Spec: tasks/builds/agentic-commerce/spec.md §5.1, §11.1
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 13
// Invariants: 29, 32
// ---------------------------------------------------------------------------

import { normaliseMerchantDescriptor } from './chargeRouterServicePure.js';
import { MERCHANT_ALLOWLIST_MAX_ENTRIES } from '../config/spendConstants.js';
import type { MerchantAllowlistEntry } from '../db/schema/spendingPolicies.js';

// ---------------------------------------------------------------------------
// validateMerchantAllowlist
//
// Validates and de-duplicates a merchant allowlist per invariant 32.
// Returns { valid: true, normalised } or { valid: false, reason }.
// ---------------------------------------------------------------------------

export type ValidateAllowlistResult =
  | { valid: true; normalised: MerchantAllowlistEntry[] }
  | { valid: false; reason: 'allowlist_too_large' | 'whitespace_only_entry' };

export function validateMerchantAllowlist(
  allowlist: MerchantAllowlistEntry[],
): ValidateAllowlistResult {
  // Validate individual entries before dedup so we can reject whitespace-only descriptors.
  for (const entry of allowlist) {
    const trimmed = entry.descriptor.trim();
    if (trimmed.length === 0) {
      return { valid: false, reason: 'whitespace_only_entry' };
    }
  }

  // Normalise descriptors and deduplicate by normalised descriptor (case/whitespace-folded).
  const seen = new Set<string>();
  const normalised: MerchantAllowlistEntry[] = [];

  for (const entry of allowlist) {
    const normalisedDescriptor = normaliseMerchantDescriptor(entry.descriptor);
    const dedupeKey = `${entry.source}:${entry.id ?? ''}:${normalisedDescriptor}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalised.push({ ...entry, descriptor: normalisedDescriptor });
  }

  // Check size cap after dedup.
  if (normalised.length > MERCHANT_ALLOWLIST_MAX_ENTRIES) {
    return { valid: false, reason: 'allowlist_too_large' };
  }

  return { valid: true, normalised };
}

// ---------------------------------------------------------------------------
// incrementPolicyVersion
// ---------------------------------------------------------------------------

export function incrementPolicyVersion(currentVersion: number): number {
  return currentVersion + 1;
}

// ---------------------------------------------------------------------------
// Promotion state machine
//
// Used by spendingBudgetService and Chunk 15's promotion flow.
// Describes valid transitions from policy mode to mode.
// ---------------------------------------------------------------------------

export type PolicyMode = 'shadow' | 'live';

export type PromotionTransitionResult =
  | { valid: true; newMode: PolicyMode }
  | { valid: false; reason: 'already_live' | 'invalid_transition' };

/**
 * Validates and resolves a promote-to-live transition.
 * Only shadow → live is valid in v1.
 */
export function resolvePromotionTransition(currentMode: PolicyMode): PromotionTransitionResult {
  if (currentMode === 'live') {
    return { valid: false, reason: 'already_live' };
  }
  if (currentMode === 'shadow') {
    return { valid: true, newMode: 'live' };
  }
  return { valid: false, reason: 'invalid_transition' };
}

// ---------------------------------------------------------------------------
// computeDefaultGrantScope
//
// Determines which permission scope should receive the default spend_approver grant
// when a new Spending Budget is created.
//
// - If subaccountId is set → grant to sub-account-admin users for that subaccount.
// - If subaccountId is null (org-level budget) → grant to org-admin users.
// ---------------------------------------------------------------------------

export type DefaultGrantScope =
  | { type: 'org'; organisationId: string }
  | { type: 'subaccount'; organisationId: string; subaccountId: string };

export function computeDefaultGrantScope(
  organisationId: string,
  subaccountId: string | null,
): DefaultGrantScope {
  if (subaccountId) {
    return { type: 'subaccount', organisationId, subaccountId };
  }
  return { type: 'org', organisationId };
}
