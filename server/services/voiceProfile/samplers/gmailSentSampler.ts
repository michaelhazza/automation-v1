import { logger } from '../../../lib/logger.js';
import type { VoiceSample } from '../voiceProfileServicePure.js';

export interface GmailSamplerConfig {
  ownerUserId: string;
  maxSamples?: number; // default 50
}

export interface SamplerResult {
  samples: VoiceSample[];
  sampleSize: number;
}

/**
 * Sample sent messages from the owner's Gmail account. Returns samples in
 * memory only — never persisted. Caller is responsible for distilling
 * features and discarding samples.
 */
export const gmailSentSampler = {
  async sample(config: GmailSamplerConfig, ctx: { organisationId: string; subaccountId?: string }): Promise<SamplerResult> {
    // TODO V1: Gmail API integration
    // 1. Resolve Gmail token via broker for the owner
    // 2. GET /gmail/v1/users/me/messages?labelIds=SENT&maxResults=N
    // 3. For each message ID: GET /gmail/v1/users/me/messages/{id}?format=full
    // 4. Extract plaintext body, build VoiceSample
    // 5. Return { samples, sampleSize }
    logger.info('gmailSentSampler: V1 skeleton — returning empty samples', { ownerUserId: config.ownerUserId, organisationId: ctx.organisationId });
    return { samples: [], sampleSize: 0 };
  },
};
