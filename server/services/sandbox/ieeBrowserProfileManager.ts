// ---------------------------------------------------------------------------
// ieeBrowserProfileManager.ts — IEE browser profile volume lifecycle service.
//
// Manages Playwright browser profile volumes: lazy-create, mount, unmount,
// GC sweep, and corruption recovery.
//
// Profile rows live in `iee_browser_session_profiles` (Chunk 1).
// Volume provisioning is delegated to the e2b provider — this service
// allocates UUIDs and tracks state only.
//
// Spec §13.7 (lifecycle), §15 (GC retention), §15 R2-F6 (serialisation).
// ---------------------------------------------------------------------------

import { randomUUID } from 'crypto';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { ieeBrowserSessionProfiles } from '../../db/schema/ieeBrowserSessionProfiles.js';
import { eq, and, sql } from 'drizzle-orm';
import {
  assertSameTenant,
  resolveRetentionDays,
} from './ieeBrowserProfileManagerPure.js';
import { SafetyError, EnvironmentError } from '../../../shared/iee/failureReason.js';
import { FailureError, failure } from '../../../shared/iee/failure.js';
import { logger } from '../../lib/logger.js';
import type { IeeBrowserSessionProfile } from '../../db/schema/ieeBrowserSessionProfiles.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProfileRow = IeeBrowserSessionProfile;

export interface MountedProfile {
  sessionProfileId: string;   // uuid of the iee_browser_session_profiles row
  volumeId: string;
  userDataDirInSandbox: string; // '/workspace/profile'
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolve({
  organisationId,
  subaccountId,
  sessionKey,
}: {
  organisationId: string;
  subaccountId: string;
  sessionKey: string;
}): Promise<ProfileRow> {
  const volumeId = randomUUID();
  const scopedDb = getOrgScopedDb('ieeBrowserProfileManager.resolve');
  // INSERT ... ON CONFLICT DO UPDATE returns the row in both branches and
  // does NOT abort the transaction on a unique_violation race (unlike a
  // bare INSERT + catch 23505, where the surrounding transaction enters
  // 'aborted' state and any follow-up SELECT fails with
  // "current transaction is aborted"). The conflict target matches the
  // (organisation_id, subaccount_id, session_key) UNIQUE index from
  // migration 0345. On conflict we touch updated_at to surface the
  // serialised re-resolve and return the winning row's volume_id —
  // never the new randomUUID candidate.
  const [row] = await scopedDb
    .insert(ieeBrowserSessionProfiles)
    .values({
      organisationId,
      subaccountId,
      sessionKey,
      volumeId,
      status: 'active',
      sizeBytes: 0,
      sizeCapBytes: 524288000,
    })
    .onConflictDoUpdate({
      target: [
        ieeBrowserSessionProfiles.organisationId,
        ieeBrowserSessionProfiles.subaccountId,
        ieeBrowserSessionProfiles.sessionKey,
      ],
      set: { updatedAt: sql`NOW()` },
    })
    .returning();
  if (!row) throw new EnvironmentError('profile_resolve_returned_no_row');
  return row;
}

async function mount(
  profile: ProfileRow,
  ctx: { organisationId: string; subaccountId: string },
): Promise<MountedProfile> {
  assertSameTenant(profile, ctx);

  const scopedDb = getOrgScopedDb('ieeBrowserProfileManager.mount');
  const rows = await scopedDb
    .update(ieeBrowserSessionProfiles)
    .set({ lastUsedAt: sql`NOW()`, updatedAt: sql`NOW()` })
    .where(
      and(
        eq(ieeBrowserSessionProfiles.id, profile.id),
        eq(ieeBrowserSessionProfiles.status, 'active'),
      ),
    )
    .returning({ id: ieeBrowserSessionProfiles.id, volumeId: ieeBrowserSessionProfiles.volumeId });
  if (rows.length === 0) {
    const [current] = await scopedDb
      .select({ status: ieeBrowserSessionProfiles.status })
      .from(ieeBrowserSessionProfiles)
      .where(eq(ieeBrowserSessionProfiles.id, profile.id))
      .limit(1);
    if (current?.status === 'scheduled_gc' || current?.status === 'gc_in_progress') {
      throw new EnvironmentError('profile_locked_for_gc');
    }
    throw new EnvironmentError('profile_not_active');
  }

  const [updatedRow] = rows;

  logger.info('iee.browser_profile.mounted', {
    profileId: profile.id,
    volumeId: updatedRow.volumeId,
    organisationId: ctx.organisationId,
    subaccountId: ctx.subaccountId,
  });

  return {
    sessionProfileId: updatedRow.id,
    volumeId: updatedRow.volumeId,
    userDataDirInSandbox: '/workspace/profile',
  };
}

async function unmount(
  mountedProfile: MountedProfile,
  _ctx: { organisationId: string; subaccountId: string },
): Promise<void> {
  const scopedDb = getOrgScopedDb('ieeBrowserProfileManager.unmount');
  await scopedDb
    .update(ieeBrowserSessionProfiles)
    .set({ lastUsedAt: sql`NOW()`, updatedAt: sql`NOW()` })
    .where(eq(ieeBrowserSessionProfiles.id, mountedProfile.sessionProfileId));
  logger.info('iee.browser_profile.unmounted', {
    profileId: mountedProfile.sessionProfileId,
  });
}

/**
 * gcSweep — RUNTIME-DISABLED scaffold.
 *
 * Cross-tenant profile GC sweep. Candidate discovery (UPDATE … WHERE status =
 * 'active') runs without org/subaccount GUC scoping, so a tenant-scoped
 * connection cannot read other tenants' rows under FORCE RLS. The sweep
 * requires `withAdminConnection` for candidate selection and tenant-scoped
 * transactions for per-row state writes. Neither is wired today. To prevent
 * accidental use, this function THROWS at runtime. Wire the admin scan + per-
 * tenant per-row mutation per IEE-DEF-3 before any caller lights up — at that
 * point the implementation in git history is the reference. Tracked in
 * tasks/todo.md IEE-DEF-3.
 */
async function gcSweep(): Promise<{ scheduled: number; completed: number }> {
  throw new FailureError(
    failure(
      'sandbox_provider_unavailable',
      'ieeBrowserProfileManager.gcSweep is a RUNTIME-DISABLED scaffold. Wire withAdminConnection + per-tenant per-row mutation before enabling (IEE-DEF-3 in tasks/todo.md).',
      { method: 'gcSweep' },
    ),
  );
}

async function recoverCorruption(
  profile: ProfileRow,
  reason: string,
): Promise<void> {
  const scopedDb = getOrgScopedDb('ieeBrowserProfileManager.recoverCorruption');
  await scopedDb
    .update(ieeBrowserSessionProfiles)
    .set({
      status: 'scheduled_gc',
      scheduledGcAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
    })
    .where(eq(ieeBrowserSessionProfiles.id, profile.id));
  logger.warn('iee.browser_profile.corruption_recovered', {
    profileId: profile.id,
    reason,
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const ieeBrowserProfileManager = {
  resolve,
  mount,
  unmount,
  gcSweep,
  recoverCorruption,
} as const;
