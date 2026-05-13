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
import { db } from '../../db/index.js';
import { ieeBrowserSessionProfiles } from '../../db/schema/ieeBrowserSessionProfiles.js';
import { subaccountIeeBrowserSettings } from '../../db/schema/subaccountIeeBrowserSettings.js';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { setOrgAndSubaccountGUC } from '../../lib/orgScoping.js';
import {
  assertSameTenant,
  resolveRetentionDays,
} from './ieeBrowserProfileManagerPure.js';
import { SafetyError, EnvironmentError } from '../../../shared/iee/failureReason.js';
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
  return db.transaction(async (tx) => {
    await setOrgAndSubaccountGUC(tx, organisationId, subaccountId);
    // INSERT ... ON CONFLICT DO UPDATE returns the row in both branches and
    // does NOT abort the transaction on a unique_violation race (unlike a
    // bare INSERT + catch 23505, where the surrounding transaction enters
    // 'aborted' state and any follow-up SELECT fails with
    // "current transaction is aborted"). The conflict target matches the
    // (organisation_id, subaccount_id, session_key) UNIQUE index from
    // migration 0345. On conflict we touch updated_at to surface the
    // serialised re-resolve and return the winning row's volume_id —
    // never the new randomUUID candidate.
    const [row] = await tx
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
  });
}

async function mount(
  profile: ProfileRow,
  ctx: { organisationId: string; subaccountId: string },
): Promise<MountedProfile> {
  assertSameTenant(profile, ctx);

  const updated = await db.transaction(async (tx) => {
    await setOrgAndSubaccountGUC(tx, ctx.organisationId, ctx.subaccountId);
    const rows = await tx
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
      const [current] = await tx
        .select({ status: ieeBrowserSessionProfiles.status })
        .from(ieeBrowserSessionProfiles)
        .where(eq(ieeBrowserSessionProfiles.id, profile.id))
        .limit(1);
      if (current?.status === 'scheduled_gc' || current?.status === 'gc_in_progress') {
        throw new EnvironmentError('profile_locked_for_gc');
      }
      throw new EnvironmentError('profile_not_active');
    }
    return rows;
  });

  const [updatedRow] = updated;

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
  ctx: { organisationId: string; subaccountId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await setOrgAndSubaccountGUC(tx, ctx.organisationId, ctx.subaccountId);
    await tx
      .update(ieeBrowserSessionProfiles)
      .set({ lastUsedAt: sql`NOW()`, updatedAt: sql`NOW()` })
      .where(eq(ieeBrowserSessionProfiles.id, mountedProfile.sessionProfileId));
  });
  logger.info('iee.browser_profile.unmounted', {
    profileId: mountedProfile.sessionProfileId,
  });
}

// TODO: cross-tenant sweep needs withAdminConnection — deferred
async function gcSweep(): Promise<{ scheduled: number; completed: number }> {
  // Step 1: schedule eligible 'active' rows whose lastUsedAt is older than
  // their effective retention window.
  const scheduleResult = await db.execute(sql`
    UPDATE iee_browser_session_profiles p
    SET status = 'scheduled_gc',
        scheduled_gc_at = NOW(),
        updated_at = NOW()
    FROM (
      SELECT p2.id,
             COALESCE(
               p2.retention_days_override,
               s.browser_profile_retention_days,
               30
             ) AS retention_days
      FROM iee_browser_session_profiles p2
      LEFT JOIN subaccount_iee_browser_settings s
        ON s.subaccount_id = p2.subaccount_id
      WHERE p2.status = 'active'
    ) AS eligible
    WHERE p.id = eligible.id
      AND p.last_used_at < NOW() - (
        LEAST(90, GREATEST(7, eligible.retention_days)) * INTERVAL '1 day'
      )
  `);

  const scheduled = (scheduleResult as any).rowCount ?? 0;

  // Step 2: claim up to 10 'scheduled_gc' rows with SKIP LOCKED and mark them
  // gc_in_progress → gc_done atomically.
  const claimed = await db.execute(sql`
    UPDATE iee_browser_session_profiles
    SET status = 'gc_in_progress', gc_started_at = NOW(), updated_at = NOW()
    WHERE id IN (
      SELECT id FROM iee_browser_session_profiles
      WHERE status = 'scheduled_gc'
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);

  const claimedIds: string[] = Array.isArray((claimed as any).rows)
    ? (claimed as any).rows.map((r: any) => r.id)
    : [];

  let completed = 0;
  if (claimedIds.length > 0) {
    const doneResult = await db
      .update(ieeBrowserSessionProfiles)
      .set({ status: 'gc_done', updatedAt: new Date() })
      .where(inArray(ieeBrowserSessionProfiles.id, claimedIds))
      .returning({ id: ieeBrowserSessionProfiles.id });
    completed = doneResult.length ?? claimedIds.length;
  }

  logger.info('iee.browser_profile.gc_sweep', { scheduled, completed });

  return { scheduled, completed };
}

async function recoverCorruption(
  profile: ProfileRow,
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await setOrgAndSubaccountGUC(tx, profile.organisationId, profile.subaccountId);
    await tx
      .update(ieeBrowserSessionProfiles)
      .set({
        status: 'scheduled_gc',
        scheduledGcAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(ieeBrowserSessionProfiles.id, profile.id));
  });
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
