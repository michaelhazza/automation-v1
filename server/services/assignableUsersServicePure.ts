/**
 * server/services/assignableUsersServicePure.ts
 *
 * Pure helpers for the assignable-users service. No I/O, no DB imports.
 *
 * Spec: docs/workflows-dev-spec.md §14.2
 */

import type { AssignableUsersIntent } from '../../shared/types/assignableUsers.js';

// ─── V1 intent set ────────────────────────────────────────────────────────────

const V1_INTENTS: ReadonlySet<string> = new Set<AssignableUsersIntent>([
  'pick_approver',
  'pick_submitter',
]);

// ─── assertAccessForResolve ───────────────────────────────────────────────────

export interface AssertAccessInput {
  callerRole: string;
  callerOrgId: string;
  callerSubaccountIds: string[];
  targetOrgId: string;
  targetSubaccountId: string;
}

export type AssertAccessResult =
  | { allowed: true }
  | { allowed: false; reason: 'forbidden' };

/**
 * Pure access decision for resolvePool per §14.2:
 *   - org_admin / manager: allowed (cross-subaccount routing)
 *   - user (subaccount admin level): allowed only if targetSubaccountId is in callerSubaccountIds
 *   - client_user / other: forbidden
 *
 * Note: The codebase user roles are system_admin | org_admin | manager | user | client_user.
 * Mapping to spec roles:
 *   org_admin  => org_admin (full org access)
 *   manager    => org_manager (org-level operational access)
 *   user       => subaccount_admin / subaccount_member (depends on subaccount assignment)
 *   client_user => subaccount_member (portal-only, forbidden)
 */
export function assertAccessForResolve(input: AssertAccessInput): AssertAccessResult {
  const { callerRole, callerOrgId, targetOrgId, targetSubaccountId, callerSubaccountIds } = input;

  // Cross-org access is never allowed
  if (callerOrgId !== targetOrgId) {
    return { allowed: false, reason: 'forbidden' };
  }

  // org_admin and manager can access any subaccount in their org
  if (callerRole === 'org_admin' || callerRole === 'manager') {
    return { allowed: true };
  }

  // system_admin can also access (cross-org is handled by req.orgId resolution above)
  if (callerRole === 'system_admin') {
    return { allowed: true };
  }

  // user role: allowed only if they are a member of the target subaccount
  if (callerRole === 'user') {
    if (callerSubaccountIds.includes(targetSubaccountId)) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'forbidden' };
  }

  // client_user and any other role: forbidden
  return { allowed: false, reason: 'forbidden' };
}

// ─── validateIntent ───────────────────────────────────────────────────────────

export type ValidateIntentResult =
  | { ok: true; intent: AssignableUsersIntent }
  | { ok: false; reason: 'invalid_intent' };

/**
 * Guards against unknown or future-only intents leaking into V1.
 * Returns ok=false for any intent not in the V1 set.
 */
export function validateIntent(input: unknown): ValidateIntentResult {
  if (typeof input !== 'string' || !V1_INTENTS.has(input)) {
    return { ok: false, reason: 'invalid_intent' };
  }
  return { ok: true, intent: input as AssignableUsersIntent };
}
