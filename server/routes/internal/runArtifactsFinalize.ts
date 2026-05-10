// Internal route: POST /api/internal/run-artifacts/finalize
// Option B proxy — receives a base64-encoded file from the worker, uploads
// to S3, and inserts a run_artifacts row via fileDeliveryService.upload.
//
// Auth: x-worker-secret header checked against WORKER_SHARED_SECRET env var.
// The worker sends this header on every call; missing or invalid secret → 401.

import { Router, type Request } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { withOrgTx } from '../../instrumentation.js';
import * as fileDeliveryService from '../../services/fileDeliveryService.js';
import { logger } from '../../lib/logger.js';
import type { RunArtifact } from '../../../shared/types/runArtifact.js';

const router = Router();

function verifyWorkerSecret(req: Request): boolean {
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) return false;
  return req.headers['x-worker-secret'] === secret;
}

interface FinalizeBody {
  organisationId: string;
  agentRunId: string;
  ieeRunId?: string;
  artifactKind: RunArtifact['artifactKind'];
  displayName: string;
  mimeType: string;
  contentBase64: string;
  retainUntil?: string; // ISO8601
}

router.post(
  '/api/internal/run-artifacts/finalize',
  asyncHandler(async (req, res) => {
    if (!verifyWorkerSecret(req)) {
      return res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid worker secret' } });
    }

    const body = req.body as FinalizeBody;

    if (
      typeof body.organisationId !== 'string' ||
      typeof body.agentRunId !== 'string' ||
      typeof body.artifactKind !== 'string' ||
      typeof body.displayName !== 'string' ||
      typeof body.mimeType !== 'string' ||
      typeof body.contentBase64 !== 'string'
    ) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Missing required fields' } });
    }

    const validKinds: ReadonlyArray<RunArtifact['artifactKind']> = [
      'report', 'transcript', 'media', 'attachment', 'log',
    ];
    if (!validKinds.includes(body.artifactKind as RunArtifact['artifactKind'])) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Invalid artifactKind' } });
    }

    const contentBuffer = Buffer.from(body.contentBase64, 'base64');
    const retainUntil = body.retainUntil ? new Date(body.retainUntil) : undefined;

    if (retainUntil && isNaN(retainUntil.getTime())) {
      return res.status(400).json({ error: { code: 'invalid_retain_until', message: 'retainUntil must be a valid ISO date string' } });
    }

    if (retainUntil) {
      const maxRetain = new Date();
      maxRetain.setDate(maxRetain.getDate() + 365);
      if (retainUntil > maxRetain) {
        return res.status(400).json({ error: { code: 'retain_until_too_far', message: 'retainUntil cannot be more than 365 days in the future' } });
      }
    }

    let result: Awaited<ReturnType<typeof fileDeliveryService.upload>> | undefined;

    // guard-ignore-next-line: rls-contract-compliance reason="internal finalize route opens an org-scoped tx with set_config GUC using the organisationId from the authenticated worker payload — no HTTP auth context exists for getOrgScopedDb on this worker-facing endpoint"
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.organisation_id', ${body.organisationId}, true)`,
      );
      await withOrgTx(
        {
          tx,
          organisationId: body.organisationId,
          source: 'internal:run-artifacts:finalize',
        },
        async () => {
          result = await fileDeliveryService.upload({
            organisationId: body.organisationId,
            agentRunId: body.agentRunId,
            ieeRunId: body.ieeRunId,
            artifactKind: body.artifactKind as RunArtifact['artifactKind'],
            displayName: body.displayName,
            mimeType: body.mimeType,
            contentBuffer,
            retainUntil,
          });
        },
      );
    });

    if (!result) {
      return res.status(500).json({ error: { code: 'internal_error', message: 'Upload did not complete' } });
    }

    logger.info('internal.run_artifacts.finalize', {
      organisationId: body.organisationId,
      agentRunId: body.agentRunId,
      artifactId: result.artifactId,
      wasReplay: result.wasReplay,
    });

    return res.json(result);
  }),
);

export default router;
