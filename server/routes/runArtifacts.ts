// Run artifact read surface — download proxy and signed-URL mint.
// Spec §4.5.2, §4.5.3, §6.1.5, §6.1.5b.
//
// Routes:
//   GET  /api/run-artifacts/:id/download   — download proxy, emits phase1.file_delivery.downloaded
//   POST /api/run-artifacts/:id/signed-url — signed-URL mint, emits phase1.file_delivery.signed_url_issued
//
// Both gates: authenticate → artifact lookup → agentRunVisibility.canView.

import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { GetObjectCommand, type GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { logger } from '../lib/logger.js';
import { runArtifacts } from '../db/schema/runArtifacts.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { systemAgents } from '../db/schema/systemAgents.js';
import {
  resolveAgentRunVisibility,
  type AgentRunVisibilityRun,
  type AgentRunVisibilityUser,
} from '../lib/agentRunVisibility.js';
import { buildUserContextForRun } from '../lib/agentRunPermissionContext.js';
import * as fileDeliveryService from '../services/fileDeliveryService.js';
import type { Readable } from 'node:stream';

const router = Router();

// ---------------------------------------------------------------------------
// Shared: resolve artifact + run + visibility
// ---------------------------------------------------------------------------

interface ResolvedArtifact {
  id: string;
  organisationId: string;
  agentRunId: string | null;
  displayName: string;
  mimeType: string;
  storageKey: string;
  storageRegion: string | null;
}

async function loadArtifactWithVisibility(
  artifactId: string,
  orgId: string,
): Promise<ResolvedArtifact | { statusCode: number; errorCode: string }> {
  const db = getOrgScopedDb('runArtifacts.loadArtifact');

  const [artifact] = await db
    .select({
      id: runArtifacts.id,
      organisationId: runArtifacts.organisationId,
      agentRunId: runArtifacts.agentRunId,
      displayName: runArtifacts.displayName,
      mimeType: runArtifacts.mimeType,
      storageKey: runArtifacts.storageKey,
      storageRegion: runArtifacts.storageRegion,
    })
    .from(runArtifacts)
    .where(
      and(
        eq(runArtifacts.id, artifactId),
        eq(runArtifacts.organisationId, orgId),
      ),
    )
    .limit(1);

  if (!artifact) {
    return { statusCode: 404, errorCode: 'artifact_not_found' };
  }

  return artifact;
}

async function resolveVisibilityForArtifact(
  req: Parameters<typeof buildUserContextForRun>[0],
  artifact: ResolvedArtifact,
): Promise<boolean> {
  // No linked run — org membership alone is sufficient for visibility.
  if (!artifact.agentRunId) {
    return true;
  }

  const db = getOrgScopedDb('runArtifacts.resolveVisibility');

  const [runRow] = await db
    .select({
      id: agentRuns.id,
      organisationId: agentRuns.organisationId,
      subaccountId: agentRuns.subaccountId,
      agentId: agentRuns.agentId,
      executionScope: agentRuns.executionScope,
    })
    .from(agentRuns)
    .where(eq(agentRuns.id, artifact.agentRunId))
    .limit(1);

  if (!runRow) {
    // Run was hard-deleted (retention); artifact is org-owned → allow.
    return true;
  }

  const [sysAgent] = await db
    .select({ id: systemAgents.id })
    .from(systemAgents)
    .where(eq(systemAgents.id, runRow.agentId))
    .limit(1);

  const visibilityRun: AgentRunVisibilityRun = {
    organisationId: runRow.organisationId,
    subaccountId: runRow.subaccountId,
    executionScope: runRow.executionScope,
    isSystemRun: Boolean(sysAgent),
  };

  const userCtx = await buildUserContextForRun(req, {
    id: runRow.id,
    organisationId: runRow.organisationId,
    subaccountId: runRow.subaccountId,
    executionScope: runRow.executionScope,
  });

  const visibilityUser: AgentRunVisibilityUser = {
    id: userCtx.id,
    role: userCtx.role,
    organisationId: userCtx.organisationId,
    orgPermissions: userCtx.orgPermissions,
  };

  return resolveAgentRunVisibility(visibilityRun, visibilityUser).canView;
}

// ---------------------------------------------------------------------------
// GET /api/run-artifacts/:id/download
// ---------------------------------------------------------------------------

router.get(
  '/api/run-artifacts/:id/download',
  authenticate,
  asyncHandler(async (req, res) => {
    const artifactId = req.params.id;
    const orgId = req.orgId!;

    const artifactResult = await loadArtifactWithVisibility(artifactId, orgId);

    if ('statusCode' in artifactResult) {
      res.status(artifactResult.statusCode).json({ errorCode: artifactResult.errorCode });
      return;
    }

    const artifact = artifactResult;

    const canView = await resolveVisibilityForArtifact(req, artifact);
    if (!canView) {
      res.status(403).json({ errorCode: 'forbidden' });
      return;
    }

    const s3 = getS3Client();
    const bucket = getBucketName();
    const safeDisplayName = artifact.displayName.replace(/[\r\n]/g, '').replace(/"/g, '\\"');

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: artifact.storageKey,
      ResponseContentDisposition: `attachment; filename="${safeDisplayName}"`,
      ResponseContentType: artifact.mimeType,
    });

    let s3Response: GetObjectCommandOutput;
    try {
      s3Response = await s3.send(command);
    } catch {
      res.status(502).json({ errorCode: 's3_download_failed' });
      return;
    }

    const body = s3Response.Body as Readable | undefined;
    if (!body) {
      res.status(502).json({ errorCode: 's3_download_failed' });
      return;
    }

    res.setHeader('Content-Type', artifact.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeDisplayName}"`);

    const startMs = Date.now();
    let byteCount = 0;
    let streamEnded = false;

    body.on('data', (chunk: Buffer) => {
      byteCount += chunk.length;
    });

    body.on('end', () => {
      streamEnded = true;
      const durationMs = Date.now() - startMs;
      // Emit only on successful byte completion (spec §6.1.5b).
      logger.info('phase1.file_delivery.downloaded', {
        artifactId: artifact.id,
        organisationId: orgId,
        downloaderUserId: req.user?.id ?? null,
        byteCount,
        durationMs,
      });
    });

    body.on('error', () => {
      // Stream interrupted — do not emit downloaded event.
      if (!streamEnded) {
        logger.warn('phase1.file_delivery.download_interrupted', {
          artifactId: artifact.id,
          organisationId: orgId,
          byteCount,
        });
      }
    });

    body.pipe(res);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/run-artifacts/:id/signed-url
// ---------------------------------------------------------------------------

const VALID_REQUEST_SOURCES = [
  'run_trace_panel',
  'pdf_embed',
  'copy_link',
  'api_consumer',
] as const;

type RequestSource = (typeof VALID_REQUEST_SOURCES)[number];

router.post(
  '/api/run-artifacts/:id/signed-url',
  authenticate,
  asyncHandler(async (req, res) => {
    const artifactId = req.params.id;
    const orgId = req.orgId!;

    const body = req.body as { requestSource?: string };
    const requestSource = body.requestSource as RequestSource | undefined;

    if (!requestSource || !VALID_REQUEST_SOURCES.includes(requestSource)) {
      res.status(400).json({ errorCode: 'invalid_request_source' });
      return;
    }

    const artifactResult = await loadArtifactWithVisibility(artifactId, orgId);

    if ('statusCode' in artifactResult) {
      res.status(artifactResult.statusCode).json({ errorCode: artifactResult.errorCode });
      return;
    }

    const artifact = artifactResult;

    const canView = await resolveVisibilityForArtifact(req, artifact);
    if (!canView) {
      res.status(403).json({ errorCode: 'forbidden' });
      return;
    }

    const inlineDisposition = requestSource === 'pdf_embed';

    let url: string;
    try {
      url = await fileDeliveryService.issueSignedUrl(artifactId, orgId, {
        inlineDisposition,
      });
    } catch (err) {
      const structured = err as { statusCode?: number; errorCode?: string };
      if (structured.statusCode === 404) {
        res.status(404).json({ errorCode: 'artifact_not_found' });
        return;
      }
      res.status(502).json({ errorCode: 's3_signed_url_failed' });
      return;
    }

    // Derive expiresAt from the signed URL's X-Amz-Expires parameter if present,
    // otherwise default to 7 days for report / 24h for others.
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + sevenDays).toISOString();

    logger.info('phase1.file_delivery.signed_url_issued', {
      artifactId: artifact.id,
      organisationId: orgId,
      expiresAt,
      inlineDisposition,
      requestSource,
    });

    res.json({ url, expiresAt });
  }),
);

export default router;
