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
import { eq, and, sql } from 'drizzle-orm';
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

  try {
    const [inserted] = await db
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
      .returning();
    return inserted;
  } catch (err) {
    // 23505 = unique_violation — another caller won the race; SELECT the winner row.
    if ((err as any).code === '23505') {
      const [existing] = await db
        .select()
        .from(ieeBrowserSessionProfiles)
        .where(
          and(
            eq(ieeBrowserSessionProfiles.organisationId, organisationId),
            eq(ieeBrowserSessionProfiles.subaccountId, subaccountId),
            eq(ieeBrowserSessionProfiles.sessionKey, sessionKey),
          ),
        )
        .limit(1);
      return existing;
    }
    throw err;
  }
}

async function mount(
  profile: ProfileRow,
  ctx: { organisationId: string; subaccountId: string },
): Promise<MountedProfile> {
  assertSameTenant(profile, ctx);

  const updated = await db
    .update(ieeBrowserSessionProfiles)
    .set({ lastUsedAt: sql`NOW()`, updatedAt: sql`NOW()` })
    .where(
      and(
        eq(ieeBrowserSessionProfiles.id, profile.id),
        eq(ieeBrowserSessionProfiles.status, 'active'),
      ),
    )
    .returning({ id: ieeBrowserSessionProfiles.id });

  if (updated.length === 0) {
    // Profile exists but was not in 'active' status — check why.
    const [current] = await db
      .select({ status: ieeBrowserSessionProfiles.status })
      .from(ieeBrowserSessionProfiles)
      .where(eq(ieeBrowserSessionProfiles.id, profile.id))
      .limit(1);

    if (
      current?.status === 'scheduled_gc' ||
      current?.status === 'gc_in_progress'
    ) {
      throw new EnvironmentError('profile_locked_for_gc');
    }
  }

  logger.info('iee.browser_profile.mounted', {
    profileId: profile.id,
    volumeId: profile.volumeId,
    organisationId: ctx.organisationId,
    subaccountId: ctx.subaccountId,
  });

  return {
    sessionProfileId: profile.id,
    volumeId: profile.volumeId,
    userDataDirInSandbox: '/workspace/profile',
  };
}

async function unmount(mountedProfile: MountedProfile): Promise<void> {
  await db
    .update(ieeBrowserSessionProfiles)
    .set({ lastUsedAt: sql`NOW()`, updatedAt: sql`NOW()` })
    .where(eq(ieeBrowserSessionProfiles.id, mountedProfile.sessionProfileId));

  logger.info('iee.browser_profile.unmounted', {
    profileId: mountedProfile.sessionProfileId,
  });
}

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
    SET status = 'gc_in_progress', "gcStartedAt" = NOW(), "updatedAt" = NOW()
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
    const doneResult = await db.execute(sql`
      UPDATE iee_browser_session_profiles
      SET status = 'gc_done', updated_at = NOW()
      WHERE id = ANY(${sql.raw(`ARRAY[${claimedIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})
    `);
    completed = (doneResult as any).rowCount ?? claimedIds.length;
  }

  logger.info('iee.browser_profile.gc_sweep', { scheduled, completed });

  return { scheduled, completed };
}

async function recoverCorruption(
  profile: ProfileRow,
  reason: string,
): Promise<void> {
  await db
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
