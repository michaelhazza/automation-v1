// Internal route: POST /api/internal/run-artifacts/finalize
// Option B proxy — receives a base64-encoded file from the worker, uploads
// to S3, and inserts a run_artifacts row via fileDeliveryService.upload.
//
// Auth: x-worker-secret header checked against WORKER_SHARED_SECRET env var.
// The worker sends this header on every call; missing or invalid secret → 401.

import { Router, type Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { withOrgTx } from '../../instrumentation.js';
import { withAdminConnection } from '../../lib/adminDbConnection.js';
import * as fileDeliveryService from '../../services/fileDeliveryService.js';
import { logger } from '../../lib/logger.js';
import type { RunArtifact } from '../../../shared/types/runArtifact.js';

const router = Router();

function verifyWorkerSecret(req: Request): boolean {
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) return false;
  const supplied = req.headers['x-worker-secret'];
  if (typeof supplied !== 'string') return false;
  // Constant-time comparison to defeat byte-by-byte timing attacks. The length
  // check first avoids the buffer-length precondition on timingSafeEqual; an
  // attacker cannot use the length-mismatch fast path to learn anything beyond
  // the secret length, which is fixed and not secret.
  if (supplied.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

/**
 * Verifies the supplied agentRunId belongs to the supplied organisationId.
 * The worker payload's organisationId is otherwise untrusted; without this
 * cross-check, a compromised worker could attribute any tenant's run to any
 * other tenant's organisation. The lookup uses an admin connection because
 * we cannot scope to the claimed organisationId until we have verified it.
 */
async function verifyRunBelongsToOrg(
  agentRunId: string,
  organisationId: string,
): Promise<boolean> {
  return withAdminConnection(
    {
      source: 'internal:run-artifacts:finalize:verifyRunBelongsToOrg',
      reason: 'Verify worker-supplied organisationId owns the run before opening org-scoped tx',
    },
    async (tx) => {
      const result = await tx.execute<{ organisation_id: string }>(
        sql`SELECT organisation_id FROM agent_runs WHERE id = ${agentRunId}::uuid LIMIT 1`,
      );
      const rows = Array.isArray(result)
        ? result
        : ((result as { rows?: unknown[] }).rows ?? []);
      const row = rows[0] as { organisation_id?: string } | undefined;
      return row?.organisation_id === organisationId;
    },
  );
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

    // Tenant-isolation cross-check: the worker payload's organisationId is
    // untrusted. Verify it actually owns the supplied agentRunId before opening
    // the org-scoped tx with that GUC. A compromised or misconfigured worker
    // can otherwise attribute any tenant's run to any other tenant's org.
    const runOwnedByOrg = await verifyRunBelongsToOrg(body.agentRunId, body.organisationId);
    if (!runOwnedByOrg) {
      logger.warn('internal.run_artifacts.finalize.tenant_mismatch', {
        suppliedOrganisationId: body.organisationId,
        agentRunId: body.agentRunId,
      });
      return res.status(403).json({ error: { code: 'tenant_mismatch', message: 'agentRunId does not belong to organisationId' } });
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
