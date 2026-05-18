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
import { setOrgGUC } from '../lib/orgScoping.js';
import { FailureError, failure } from '../../shared/iee/failure.js';
import { logger } from '../lib/logger.js';
import type { Transaction } from '../db/index.js';
import type { IeeRun } from '../db/schema/ieeRuns.js';

// Follow-up build re-adds these imports when the harvest body is wired:
//   import { visionInferenceCalls } from '../db/schema/visionInferenceCalls.js';
//   import { computeCostCents } from '../../shared/visionInferencePricing.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisionEndpointConfig {
  endpointUrl: string;
  apiKey: string | null;
  modelId: string;
}

// VisionCallRecord shape (spec §8.4) is defined inline by the follow-up build
// when the harvest body is uncommented. V1 stub harness never writes
// vision_calls.json, so no producer exists yet.

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
  //
  // organisationId is included in the WHERE clause as defence-in-depth per
  // DEVELOPMENT_GUIDELINES.md §1 / §9 ("Always filter by organisationId in
  // application code, even with RLS"). The tx GUC was set on line 128, so RLS
  // would also filter, but app-layer filtering is the architectural invariant.
  const [artifact] = await tx
    .select({ id: ieeArtifacts.id, path: ieeArtifacts.path })
    .from(ieeArtifacts)
    .where(
      and(
        eq(ieeArtifacts.organisationId, ieeRun.organisationId),
        eq(ieeArtifacts.ieeRunId, ieeRun.id),
        like(ieeArtifacts.path, '%vision_calls.json'),
      ),
    )
    .limit(1);

  if (!artifact) {
    return { harvested: 0 };
  }

  // V1: artefact-present branch is explicitly deferred.
  //
  // The V1 harness is a loud-failure stub that NEVER writes `vision_calls.json`.
  // If an artefact row matching the pattern exists despite that, it is either:
  //   (a) stale residue from a previous deploy, or
  //   (b) some other process wrote a path matching `%vision_calls.json`.
  //
  // Either way, calling `fetchArtifactBytes` here would throw (stub always
  // throws) → the throw propagates out of `harvestVisionCalls` → the orchestrator
  // transaction rolls back → the terminal `iee_runs` status update never commits.
  // That would block run completion for a benign edge case.
  //
  // Behaviour decision (chatgpt-pr-review R1): return `{ harvested: 0 }` and emit
  // a warning. The follow-up "Full harness wiring" build (§13) replaces this
  // early-return with the real object-storage download + parse + insert loop.
  // The artefact path is captured in the warning for diagnostics.
  logger.warn('vision.harvest.unexpected_artefact_in_v1_stub', {
    ieeRunId: ieeRun.id,
    organisationId: ieeRun.organisationId,
    artefactId: artifact.id,
    artefactPath: artifact.path,
    note: 'V1 harness is a stub; an artefact matching vision_calls.json was not expected. Skipping harvest.',
  });
  return { harvested: 0 };

  // Follow-up build re-implements the harvest body here per spec §8.4 + §8.5
  // + §10: download artefact bytes via object-storage client; parse as
  // VisionCallRecord[]; parity-check each cost against
  // `computeCostCents({ modelId, imageSizeBytes, latencyMs, outputTokens })`;
  // INSERT into `visionInferenceCalls` with `onConflictDoNothing()` on
  // `(iee_run_id, step_index, call_index)`. The V1 early-return above guarantees
  // the unwired stub never throws into the orchestrator transaction.
}

// Follow-up build adds `fetchArtifactBytes(path)` here — downloads vision_calls.json
// from object storage. Removed from V1 because the harvest body never calls it
// (the V1 early-return short-circuits before the download path is reached).
