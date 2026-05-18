import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { visionInferenceCalls } from '../db/schema/visionInferenceCalls.js';
import { sandboxArtefacts } from '../db/schema/sandboxArtefacts.js';
import { sandboxExecutions } from '../db/schema/sandboxExecutions.js';
import { computeCostCents } from '../../shared/visionInferencePricing.js';
import { FailureError, failure } from '../../shared/iee/failure.js';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { logger } from '../lib/logger.js';
import type { Transaction } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisionEndpointConfig {
  endpointUrl: string;
  apiKey: string | null;
  modelId: string;
}

// ---------------------------------------------------------------------------
// Token redaction helper — strips a bearer token from any error message
// before the message is logged or thrown. Defence-in-depth: callers must
// also never build messages from the raw token value.
// ---------------------------------------------------------------------------

function redactToken(s: string, token: string | null): string {
  if (!token) return s;
  return s.split(token).join('[REDACTED]');
}

// ---------------------------------------------------------------------------
// Zod schema for vision_calls.json artefact
// ---------------------------------------------------------------------------

const VisionCallRecordSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  callIndex: z.number().int().nonnegative(),
  modelId: z.string().min(1),
  costCents: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  imageSizeBytes: z.number().int().nonnegative(),
  actionType: z.string().min(1),
  fallbackTrigger: z.boolean(),
});

const VisionCallsArtefactSchema = z.array(VisionCallRecordSchema);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const visionGroundingService = {
  /**
   * Reads VISION_INFERENCE_ENDPOINT_URL, VISION_INFERENCE_API_KEY, and
   * VISION_INFERENCE_MODEL_ID from the environment. Throws FailureError with
   * reason 'vision_inference_not_configured' when the URL is absent or
   * non-HTTPS. Never logs the apiKey value.
   */
  resolveEndpointConfig(): VisionEndpointConfig {
    const rawUrl = process.env.VISION_INFERENCE_ENDPOINT_URL ?? '';
    const apiKey = process.env.VISION_INFERENCE_API_KEY ?? null;
    const modelId = process.env.VISION_INFERENCE_MODEL_ID || 'ui-tars-7b';

    if (!rawUrl) {
      throw new FailureError(
        failure('vision_inference_not_configured', 'VISION_INFERENCE_ENDPOINT_URL is not set'),
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new FailureError(
        failure(
          'vision_inference_not_configured',
          redactToken('VISION_INFERENCE_ENDPOINT_URL is not a valid URL', apiKey),
        ),
      );
    }

    if (parsed.protocol !== 'https:') {
      throw new FailureError(
        failure(
          'vision_inference_not_configured',
          'VISION_INFERENCE_ENDPOINT_URL must be HTTPS',
        ),
      );
    }

    logger.info('vision.config.resolved', { hasApiKey: apiKey !== null, modelId });

    return { endpointUrl: rawUrl, apiKey, modelId };
  },

  /**
   * Reads the vision_calls.json artefact for the given IEE run, validates it,
   * and upserts rows into vision_inference_calls via ON CONFLICT DO NOTHING.
   *
   * Early-exits silently when the artefact is absent (dom-mode runs produce no
   * vision_calls.json). Throws on parse failure or when agentRunId is null.
   *
   * Cost-parity validation: re-computes costCents via computeCostCents and
   * logs a warning on drift > 1 cent — does NOT throw.
   */
  async harvestVisionCalls(
    tx: Transaction,
    ieeRun: {
      id: string;
      organisationId: string;
      subaccountId: string | null;
      agentRunId: string | null;
    },
  ): Promise<void> {
    // agentRunId null-guard: a null agentRunId at harvest time is a structural
    // invariant violation. Fail hard rather than proceed with a partial insert.
    if (ieeRun.agentRunId === null) {
      throw new Error('vision.harvest.missing_agent_run_id');
    }

    const agentRunId = ieeRun.agentRunId;

    // Look up the vision_calls.json artefact pointer row.
    // sandboxArtefacts is keyed by (sandboxExecutionId, filename); we reach
    // the correct sandboxExecutionId via sandboxExecutions.runId = agentRunId.
    const artefactRows = await tx
      .select({
        objectKey: sandboxArtefacts.objectKey,
      })
      .from(sandboxArtefacts)
      .innerJoin(
        sandboxExecutions,
        eq(sandboxArtefacts.sandboxExecutionId, sandboxExecutions.id),
      )
      .where(
        and(
          eq(sandboxExecutions.runId, agentRunId),
          eq(sandboxArtefacts.organisationId, ieeRun.organisationId),
          eq(sandboxArtefacts.filename, 'vision_calls.json'),
        ),
      )
      .limit(1);

    if (artefactRows.length === 0) {
      // Absent artefact = dom-mode run or vision run with zero calls. Silent exit.
      return;
    }

    const { objectKey } = artefactRows[0]!;

    // Read artefact bytes from object storage.
    const s3 = getS3Client();
    const bucket = getBucketName();

    let rawJson: string;
    try {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
      rawJson = await response.Body!.transformToString('utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('vision.harvest.artefact_read_failed', {
        ieeRunId: ieeRun.id,
        objectKey,
        error: msg,
      });
      throw new Error(`vision.harvest.artefact_read_failed: ${msg}`, { cause: err });
    }

    // Parse and validate.
    let records: z.infer<typeof VisionCallsArtefactSchema>;
    try {
      records = VisionCallsArtefactSchema.parse(JSON.parse(rawJson));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('vision.harvest.parse_failed', {
        ieeRunId: ieeRun.id,
        error: msg,
      });
      throw new Error(`vision.harvest.parse_failed: ${msg}`, { cause: err });
    }

    if (records.length === 0) {
      return;
    }

    // Cost-parity validation and upsert.
    for (const record of records) {
      // Parity check: re-compute costCents server-side and warn on drift.
      try {
        const serverCents = computeCostCents({
          modelId: record.modelId,
          imageSizeBytes: record.imageSizeBytes,
          latencyMs: record.latencyMs,
          outputTokens: 0,
        });
        const delta = Math.abs(serverCents - record.costCents);
        if (delta > 1) {
          logger.warn('vision.harvest.cost_parity_drift', {
            ieeRunId: ieeRun.id,
            stepIndex: record.stepIndex,
            callIndex: record.callIndex,
            harnessCents: record.costCents,
            serverCents,
          });
        }
      } catch {
        // Unknown modelId — log and continue; the harness-reported cost wins.
        logger.warn('vision.harvest.cost_parity_unknown_model', {
          ieeRunId: ieeRun.id,
          modelId: record.modelId,
        });
      }

      // Upsert — ON CONFLICT (iee_run_id, step_index, call_index) DO NOTHING
      // ensures idempotent harvest retry (spec §12.1).
      await tx
        .insert(visionInferenceCalls)
        .values({
          organisationId: ieeRun.organisationId,
          subaccountId: ieeRun.subaccountId ?? undefined,
          runId: agentRunId,
          ieeRunId: ieeRun.id,
          modelId: record.modelId,
          costCents: record.costCents,
          latencyMs: record.latencyMs,
          imageSizeBytes: record.imageSizeBytes,
          actionType: record.actionType,
          fallbackTrigger: record.fallbackTrigger,
          stepIndex: record.stepIndex,
          callIndex: record.callIndex,
        })
        .onConflictDoNothing();
    }
  },
};
