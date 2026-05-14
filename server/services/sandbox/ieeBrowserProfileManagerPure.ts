// ---------------------------------------------------------------------------
// ieeBrowserProfileManagerPure.ts — Pure helpers for the IEE browser profile
// manager. No DB, no network, no side effects.
//
// Spec §13.7 (status transitions), §15 (GC retention).
//
// verify-pure-helper-convention.sh checks that test files import from this
// module using a relative path ending in `.js`.
// ---------------------------------------------------------------------------

import type { IeeBrowserSessionProfile } from '../../db/schema/ieeBrowserSessionProfiles.js';
import { SafetyError } from '../../../shared/iee/failureReason.js';

/**
 * Assert that the requesting task's (org, subaccount) matches the profile row.
 * Cross-tenant mounts are invariant violations.
 * Throws SafetyError (code 'other', message 'cross_tenant_mount_attempted') on mismatch.
 */
export function assertSameTenant(
  profile: IeeBrowserSessionProfile,
  ctx: { organisationId: string; subaccountId: string },
): void {
  if (
    profile.organisationId !== ctx.organisationId ||
    profile.subaccountId !== ctx.subaccountId
  ) {
    throw new SafetyError('cross_tenant_mount_attempted', 'other');
  }
}

/**
 * Resolve the effective GC retention days for a profile.
 * Priority: profile.retentionDaysOverride → settings?.browserProfileRetentionDays → 30
 * Clamps result to [7, 90].
 */
export function resolveRetentionDays(
  profile: IeeBrowserSessionProfile,
  settings: { browserProfileRetentionDays: number } | null,
): number {
  let days: number;
  if (profile.retentionDaysOverride != null) {
    days = profile.retentionDaysOverride;
  } else if (settings != null) {
    days = settings.browserProfileRetentionDays;
  } else {
    days = 30;
  }
  return Math.min(90, Math.max(7, days));
}

/**
 * Return true if the status transition from → to is valid per spec §13.7.
 * Valid transitions:
 *   active → scheduled_gc
 *   scheduled_gc → active  (reprieve)
 *   scheduled_gc → gc_in_progress
 *   gc_in_progress → gc_done
 * All others are invalid.
 */
export function isValidStatusTransition(
  from: IeeBrowserSessionProfile['status'],
  to: IeeBrowserSessionProfile['status'],
): boolean {
  if (from === 'active' && to === 'scheduled_gc') return true;
  if (from === 'scheduled_gc' && to === 'active') return true;
  if (from === 'scheduled_gc' && to === 'gc_in_progress') return true;
  if (from === 'gc_in_progress' && to === 'gc_done') return true;
  return false;
}
