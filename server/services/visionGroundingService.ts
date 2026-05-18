/**
 * visionGroundingService.ts — Managed vLLM endpoint config + vision_inference_calls harvest.
 *
 * Spec: docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md
 *   §8.6 (config contract), §8.7 (network policy — parseVisionEndpointHostPort export),
 *   §10 (execution model — resolveEndpointConfig + harvestVisionCalls),
 *   §12.1 (harvest idempotency — ON CONFLICT DO NOTHING, setOrgGUC first).
 *
 * Three exports:
 *   resolveEndpointConfig()            — sync; reads env vars; throws on missing/non-HTTPS URL.
 *   parseVisionEndpointHostPort(url)   — pure; exported for _ieeShared.ts allowlist construction.
 *   harvestVisionCalls(tx, ieeRun)     — async; reads iee_artifacts, inserts vision_inference_calls.
 */

import { eq, and, like } from 'drizzle-orm';
import { ieeArtifacts } from '../db/schema/ieeArtifacts.js';
import { visionInferenceCalls } from '../db/schema/visionInferenceCalls.js';
import { setOrgGUC } from '../lib/orgScoping.js';
import { FailureError, failure } from '../../shared/iee/failure.js';
import { computeCostCents } from '../../shared/visionInferencePricing.js';
import { logger } from '../lib/logger.js';
import type { Transaction } from '../db/index.js';
import type { IeeRun } from '../db/schema/ieeRuns.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisionEndpointConfig {
  endpointUrl: string;
  apiKey: string | null;
  modelId: string;
}

/**
 * Shape of one entry in vision_calls.json written by the harness.
 * Spec §8.4. In V1 the harness is a stub so this is never populated;
 * defined here for the follow-up build wiring.
 */
interface VisionCallRecord {
  modelId: string;
  costCents: number;
  latencyMs: number;
  imageSizeBytes: number;
  actionType: string;
  fallbackTrigger: boolean;
  stepIndex: number;
  callIndex: number;
  subaccountId?: string | null;
}

// ---------------------------------------------------------------------------
// resolveEndpointConfig
// ---------------------------------------------------------------------------

/**
 * Resolve managed vLLM endpoint config from env vars. Synchronous;
 * called inline within IEE dispatch (spec §8.6).
 *
 * Env vars:
 *   VISION_INFERENCE_ENDPOINT_URL — required; must be HTTPS.
 *   VISION_INFERENCE_API_KEY      — optional bearer token; null when absent.
 *   VISION_INFERENCE_MODEL_ID     — optional; defaults to 'ui-tars-7b'.
 *
 * Throws FailureError(vision_inference_not_configured) if URL is absent or non-HTTPS.
 */
export function resolveEndpointConfig(): VisionEndpointConfig {
  const endpointUrl = process.env.VISION_INFERENCE_ENDPOINT_URL;
  if (!endpointUrl) {
    throw new FailureError(
      failure('vision_inference_not_configured', 'VISION_INFERENCE_ENDPOINT_URL missing or non-HTTPS'),
    );
  }
  if (!endpointUrl.startsWith('https://')) {
    throw new FailureError(
      failure('vision_inference_not_configured', 'VISION_INFERENCE_ENDPOINT_URL missing or non-HTTPS'),
    );
  }
  return {
    endpointUrl,
    apiKey: process.env.VISION_INFERENCE_API_KEY ?? null,
    modelId: process.env.VISION_INFERENCE_MODEL_ID ?? 'ui-tars-7b',
  };
}

// ---------------------------------------------------------------------------
// parseVisionEndpointHostPort
// ---------------------------------------------------------------------------

/**
 * Parse host and port from a vision endpoint URL for sandbox network allowlist
 * construction. Pure — no I/O, no DB. Exported for _ieeShared.ts (spec §8.7).
 *
 * Throws if the URL is not HTTPS (allowlist entries must be HTTPS-only).
 */
export function parseVisionEndpointHostPort(endpointUrl: string): { host: string; port: number } {
  if (!endpointUrl.startsWith('https://')) {
    throw new Error('VISION_INFERENCE_ENDPOINT_URL must be HTTPS');
  }
  const url = new URL(endpointUrl);
  const port = url.port ? Number(url.port) : 443;
  return { host: url.hostname, port };
}

// ---------------------------------------------------------------------------
// harvestVisionCalls
// ---------------------------------------------------------------------------

/**
 * Harvest vision_calls.json artefact into vision_inference_calls ledger.
 *
 * Called inside ieeFinalise(tx, ...) immediately before the agent_runs terminal
 * UPDATE — shares the orchestrator's transaction for atomicity (spec §12.1).
 *
 * Sets app.organisation_id GUC as its FIRST statement so RLS WITH CHECK passes
 * on INSERT into vision_inference_calls (spec §9 / architecture.md RLS rules).
 *
 * Idempotent via UNIQUE (iee_run_id, step_index, call_index) + ON CONFLICT DO NOTHING.
 * Returns { harvested: count } — zero is valid when the run was DOM-mode or the
 * artefact is absent.
 *
 * Spec §10 execution model, §12.1 idempotency.
 */
export async function harvestVisionCalls(
  tx: Transaction,
  ieeRun: IeeRun,
): Promise<{ harvested: number }> {
  await setOrgGUC(tx, ieeRun.organisationId);

  // Step 2 — look up vision_calls.json artefact pointer.
  // In V1 the harness is a stub and will never write this file, so the
  // artefact row is absent → return { harvested: 0 } immediately.
  const [artifact] = await tx
    .select({ id: ieeArtifacts.id, path: ieeArtifacts.path })
    .from(ieeArtifacts)
    .where(
      and(
        eq(ieeArtifacts.ieeRunId, ieeRun.id),
        like(ieeArtifacts.path, '%vision_calls.json'),
      ),
    )
    .limit(1);

  if (!artifact) {
    return { harvested: 0 };
  }

  // V1: not reachable — harness is stub. Wired for the follow-up build.
  // Step 3 — download artefact bytes from object storage.
  // Step 4 — parse JSON as VisionCallRecord[].
  // Step 5 — parity-validate and INSERT each record.
  // The follow-up build will implement steps 3-5 using the artefact path
  // from `artifact.path` and the existing object-storage download pattern
  // (see server/services/sandboxHarvestService.ts for precedent).

  let records: VisionCallRecord[];
  try {
    // Placeholder: fetch + parse. Replace with real object-storage download in follow-up.
    const rawJson = await fetchArtifactBytes(artifact.path);
    records = JSON.parse(rawJson) as VisionCallRecord[];
  } catch (err) {
    throw new Error(`harvestVisionCalls: failed to read or parse vision_calls.json: ${String(err)}`, { cause: err });
  }

  let harvested = 0;
  for (const rec of records) {
    // Parity-validate costCents against server-side formula.
    // The harness is source-of-truth; this is a tripwire for rate drift.
    try {
      const expectedCostCents = computeCostCents({
        modelId: rec.modelId,
        imageSizeBytes: rec.imageSizeBytes,
        latencyMs: rec.latencyMs,
        outputTokens: 0,
      });
      if (expectedCostCents !== rec.costCents) {
        logger.warn('vision.harvest.cost_parity_mismatch', {
          ieeRunId: ieeRun.id,
          stepIndex: rec.stepIndex,
          callIndex: rec.callIndex,
          recordedCostCents: rec.costCents,
          expectedCostCents,
        });
      }
    } catch (pricingErr) {
      logger.warn('vision.harvest.cost_parity_check_failed', {
        ieeRunId: ieeRun.id,
        modelId: rec.modelId,
        error: String(pricingErr),
      });
    }

    const result = await tx
      .insert(visionInferenceCalls)
      .values({
        organisationId: ieeRun.organisationId,
        subaccountId: rec.subaccountId ?? ieeRun.subaccountId ?? null,
        runId: ieeRun.agentRunId!,
        ieeRunId: ieeRun.id,
        modelId: rec.modelId,
        costCents: rec.costCents,
        latencyMs: rec.latencyMs,
        imageSizeBytes: rec.imageSizeBytes,
        actionType: rec.actionType,
        fallbackTrigger: rec.fallbackTrigger,
        stepIndex: rec.stepIndex,
        callIndex: rec.callIndex,
      })
      .onConflictDoNothing()
      .returning({ id: visionInferenceCalls.id });

    if (result.length > 0) {
      harvested++;
    }
  }

  return { harvested };
}

// ---------------------------------------------------------------------------
// Internal — placeholder for follow-up build
// ---------------------------------------------------------------------------

/**
 * Download artefact bytes by path from object storage.
 * V1: not reachable — harness is stub; this function is never called.
 * Follow-up build replaces this with the real S3/R2 download via getS3Client().
 */
async function fetchArtifactBytes(_path: string): Promise<string> {
  // V1: not reachable — harness is stub. Wired for the follow-up build.
  throw new Error('fetchArtifactBytes: not implemented in V1 (harness is stub)');
}
