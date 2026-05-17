import type { Job } from 'pg-boss';
import { eq, and, isNull, ne, sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { voiceProfiles } from '../db/schema/voiceProfiles.js';
import { logger } from '../lib/logger.js';
import { shouldRefresh } from '../services/voiceProfile/voiceProfileServicePure.js';
import { refreshProfile } from '../services/voiceProfile/voiceProfileService.js';

export const VOICE_PROFILE_REFRESH_JOB = 'voice-profile-refresh';

// Empty payload — job scans all eligible profiles
export type VoiceProfileRefreshJobData = Record<string, never>;

/**
 * Nightly job: finds voice_profiles where refresh_policy='periodic' AND
 * opt_out_at IS NULL AND state != 'failed', then filters in JS via
 * shouldRefresh for the time-threshold check. The failed-state exclusion
 * avoids re-queuing profiles that require manual intervention. Per-row
 * try/catch so one failure does not block others.
 */
export async function voiceProfileRefreshHandler(_job: Job<VoiceProfileRefreshJobData>): Promise<void> {
  const now = new Date();

  const candidates = await withAdminConnection(
    { source: 'voiceProfileRefreshJob', reason: 'cross-org periodic refresh scan' },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      return tx.select().from(voiceProfiles).where(
        and(
          eq(voiceProfiles.refreshPolicy, 'periodic'),
          isNull(voiceProfiles.optOutAt),
          ne(voiceProfiles.state, 'failed'),
        ),
      );
    },
  );

  for (const row of candidates) {
    try {
      const eligible = shouldRefresh({
        refreshPolicy: row.refreshPolicy as 'manual' | 'periodic' | 'on_send_count',
        refreshConfig: row.refreshConfig as { days?: number } | null,
        lastDerivedAt: row.lastDerivedAt ?? null,
        now,
      });
      if (!eligible) continue;

      await refreshProfile({ profileId: row.id, force: true }, { organisationId: row.organisationId });
      logger.info('[voice-profile-refresh] refreshed', { profileId: row.id });
    } catch (err) {
      logger.error('[voice-profile-refresh] row_failed', { profileId: row.id, err: String(err) });
      // Continue with next row — one failure does not block others.
    }
  }
}
