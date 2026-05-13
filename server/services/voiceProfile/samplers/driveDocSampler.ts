import { logger } from '../../../lib/logger.js';
import type { VoiceSample } from '../voiceProfileServicePure.js';

export interface DriveSamplerConfig {
  ownerUserId: string;
  docIds: string[];
  maxSamples?: number;
}

export interface SamplerResult {
  samples: VoiceSample[];
  sampleSize: number;
}

/**
 * Sample content from the owner's Google Drive documents. Returns samples in
 * memory only — never persisted. Caller is responsible for distilling
 * features and discarding samples.
 */
export const driveDocSampler = {
  async sample(config: DriveSamplerConfig, ctx: { organisationId: string; subaccountId?: string }): Promise<SamplerResult> {
    // TODO V1: Google Drive API integration
    // 1. Resolve Drive token via broker for the owner
    // 2. For each docId: GET /drive/v3/files/{id}/export?mimeType=text/plain
    // 3. Extract plaintext content, build VoiceSample per document
    // 4. Return { samples, sampleSize }
    logger.info('driveDocSampler: V1 skeleton — returning empty samples', { ownerUserId: config.ownerUserId, organisationId: ctx.organisationId });
    return { samples: [], sampleSize: 0 };
  },
};
