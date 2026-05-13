// Internal route: POST /api/internal/run-artifacts/finalize
// Option B proxy — receives a base64-encoded file from the worker, uploads
// to S3, and inserts a run_artifacts row via fileDeliveryService.upload.
//
// Auth: x-worker-secret header checked against WORKER_SHARED_SECRET env var.
// The worker sends this header on every call; missing or invalid secret → 401.

import { Router, type Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { asyncHandler } from '../../lib/asyncHandler.js';
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

    // MIME-type allowlist: prevents stored XSS via `text/html` / `text/javascript`
    // payloads that the inline-disposition download path would otherwise serve as
    // executable HTML/JS in the application origin. The allowlist matches the
    // five artifactKind values the spec supports (report=PDF, transcript=text,
    // media=audio/video, attachment=common doc types, log=text).
    const ALLOWED_MIME_PREFIXES: ReadonlyArray<string> = [
      'application/pdf',
      'application/json',
      'application/zip',
      'application/octet-stream',
      'text/plain',
      'text/csv',
      'image/',
      'audio/',
      'video/',
    ];
    const mimeAllowed = ALLOWED_MIME_PREFIXES.some((p) => body.mimeType === p || body.mimeType.startsWith(p));
    if (!mimeAllowed) {
      return res.status(400).json({
        error: {
          code: 'mime_type_not_allowed',
          message: `mimeType '${body.mimeType}' is not in the artifact allowlist`,
        },
      });
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

    // Per-artifact size cap. The global express.json parser caps the JSON body
    // at 10MB, but a compromised worker could otherwise loop maximum-size
    // uploads and consume S3 storage budget without per-tenant quotas.
    const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
    const decodedBytes = Buffer.byteLength(body.contentBase64, 'base64');
    if (decodedBytes > MAX_ARTIFACT_BYTES) {
      return res.status(413).json({
        error: {
          code: 'artifact_too_large',
          message: `Artifact exceeds ${MAX_ARTIFACT_BYTES} byte cap (received ${decodedBytes})`,
        },
      });
    }

    const result = await fileDeliveryService.finalizeWorkerUpload({
      organisationId: body.organisationId,
      agentRunId: body.agentRunId,
      ieeRunId: body.ieeRunId,
      artifactKind: body.artifactKind as RunArtifact['artifactKind'],
      displayName: body.displayName,
      mimeType: body.mimeType,
      contentBuffer,
      retainUntil,
    });

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
