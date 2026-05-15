import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { voiceProfiles } from '../../db/schema/voiceProfiles.js';
import { logger } from '../../lib/logger.js';
import { distilFeatures, shouldRefresh, type VoiceSample } from './voiceProfileServicePure.js';
import { gmailSentSampler } from './samplers/gmailSentSampler.js';
import { driveDocSampler } from './samplers/driveDocSampler.js';

export interface DeriveProfileInput {
  profileId: string;
}

export interface DeriveProfileResult {
  profileId: string;
  state: 'ready' | 'failed';
  reason?: string;
}

/**
 * Derive a voice profile from configured samplers. State machine:
 * pending|ready|failed → deriving → ready|failed.
 * Samples never persisted (R5 mitigation).
 */
export async function deriveProfile(
  input: DeriveProfileInput,
  ctx: { organisationId: string },
): Promise<DeriveProfileResult> {
  // Atomically claim the profile for derivation — zero rows means already in-progress
  const claimed = await db
    .update(voiceProfiles)
    .set({ state: 'deriving', updatedAt: new Date() })
    .where(
      and(
        eq(voiceProfiles.id, input.profileId),
        eq(voiceProfiles.organisationId, ctx.organisationId),
        inArray(voiceProfiles.state, ['pending', 'ready', 'failed']),
      ),
    )
    .returning({ id: voiceProfiles.id });

  if (claimed.length === 0) {
    throw Object.assign(new Error('Voice profile derivation already in progress'), {
      code: 'DERIVATION_IN_PROGRESS',
      statusCode: 409,
    });
  }

  // Load the profile row to read sampler config
  const [profile] = await db
    .select()
    .from(voiceProfiles)
    .where(
      and(
        eq(voiceProfiles.id, input.profileId),
        eq(voiceProfiles.organisationId, ctx.organisationId),
      ),
    )
    .limit(1);

  if (!profile) {
    throw Object.assign(new Error(`Voice profile ${input.profileId} not found`), {
      code: 'PROFILE_NOT_FOUND',
      statusCode: 404,
    });
  }

  let samples: VoiceSample[] = [];

  try {
    // Dispatch to configured samplers based on sources array
    for (const source of profile.sources) {
      if (source === 'gmail_sent_sampler' && profile.ownerUserId) {
        const result = await gmailSentSampler.sample(
          { ownerUserId: profile.ownerUserId },
          { organisationId: ctx.organisationId },
        );
        samples = samples.concat(result.samples);
      } else if (source === 'drive_doc_sampler' && profile.ownerUserId) {
        const result = await driveDocSampler.sample(
          { ownerUserId: profile.ownerUserId, docIds: [] },
          { organisationId: ctx.organisationId },
        );
        samples = samples.concat(result.samples);
      }
    }
  } catch (err) {
    logger.error('voiceProfileService: sampler threw', { profileId: input.profileId, err: String(err) });
    await db
      .update(voiceProfiles)
      .set({ state: 'failed', updatedAt: new Date() })
      .where(eq(voiceProfiles.id, input.profileId));
    throw Object.assign(new Error('Sampler error'), {
      code: 'SAMPLER_ERROR',
      statusCode: 502,
    });
  }

  if (samples.length === 0) {
    await db
      .update(voiceProfiles)
      .set({ state: 'failed', updatedAt: new Date() })
      .where(eq(voiceProfiles.id, input.profileId));
    throw Object.assign(new Error('No samples collected from configured sources'), {
      code: 'SAMPLER_EMPTY',
      statusCode: 422,
    });
  }

  const features = distilFeatures(samples);
  // Samples are discarded after distillation — only the features object is persisted

  await db
    .update(voiceProfiles)
    .set({
      state: 'ready',
      profileJson: features,
      lastDerivedAt: new Date(),
      sampleSize: 0, // sample count intentionally zeroed — samples not retained
      updatedAt: new Date(),
    })
    .where(eq(voiceProfiles.id, input.profileId));

  return { profileId: input.profileId, state: 'ready' };
}

/**
 * Refresh check + derive if needed.
 */
export async function refreshProfile(
  input: { profileId: string; force?: boolean },
  ctx: { organisationId: string },
): Promise<DeriveProfileResult> {
  const [profile] = await db
    .select()
    .from(voiceProfiles)
    .where(
      and(
        eq(voiceProfiles.id, input.profileId),
        eq(voiceProfiles.organisationId, ctx.organisationId),
      ),
    )
    .limit(1);

  if (!profile) {
    throw Object.assign(new Error(`Voice profile ${input.profileId} not found`), {
      code: 'PROFILE_NOT_FOUND',
      statusCode: 404,
    });
  }

  const needsRefresh = input.force || shouldRefresh({
    refreshPolicy: profile.refreshPolicy as 'manual' | 'periodic' | 'on_send_count',
    refreshConfig: profile.refreshConfig as { days?: number } | null,
    lastDerivedAt: profile.lastDerivedAt ?? null,
    now: new Date(),
  });

  if (!needsRefresh) {
    return {
      profileId: input.profileId,
      state: profile.state as 'ready' | 'failed',
    };
  }

  return deriveProfile({ profileId: input.profileId }, ctx);
}

export async function getProfile(
  input: { profileId: string },
  ctx: { organisationId: string },
): Promise<typeof voiceProfiles.$inferSelect | null> {
  const [profile] = await db
    .select()
    .from(voiceProfiles)
    .where(
      and(
        eq(voiceProfiles.id, input.profileId),
        eq(voiceProfiles.organisationId, ctx.organisationId),
      ),
    )
    .limit(1);

  return profile ?? null;
}

export async function listProfiles(
  input: { ownerUserId: string },
  ctx: { organisationId: string },
): Promise<(typeof voiceProfiles.$inferSelect)[]> {
  return db
    .select()
    .from(voiceProfiles)
    .where(
      and(
        eq(voiceProfiles.organisationId, ctx.organisationId),
        eq(voiceProfiles.ownerUserId, input.ownerUserId),
      ),
    );
}

/** Opt-out: sets opt_out_at = now() (do NOT delete). */
export async function optOut(
  input: { profileId: string },
  ctx: { organisationId: string },
): Promise<void> {
  await db
    .update(voiceProfiles)
    .set({ optOutAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(voiceProfiles.id, input.profileId),
        eq(voiceProfiles.organisationId, ctx.organisationId),
      ),
    );
}

/** Re-activate: clears opt_out_at. */
export async function reactivate(
  input: { profileId: string },
  ctx: { organisationId: string },
): Promise<void> {
  await db
    .update(voiceProfiles)
    .set({ optOutAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(voiceProfiles.id, input.profileId),
        eq(voiceProfiles.organisationId, ctx.organisationId),
      ),
    );
}
