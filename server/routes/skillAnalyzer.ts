import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { skillAnalyzerService } from '../services/skillAnalyzerService.js';
import { configBackupService } from '../services/configBackupService.js';
import * as skillAnalyzerConfigService from '../services/skillAnalyzerConfigService.js';

const router = Router();

// Multer config for skill file uploads
const upload = multer({
  dest: 'data/uploads/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = ['.md', '.json', '.zip'];
    const isAllowed = allowed.some((ext) => file.originalname.toLowerCase().endsWith(ext));
    if (isAllowed) {
      cb(null, true);
    } else {
      const ext = file.originalname.includes('.') ? file.originalname.split('.').pop() : '(none)';
      cb(new Error(`Unsupported file type: .${ext}. Accepted: .md, .json, .zip`));
    }
  },
});

// All routes require authentication + system admin
router.use(authenticate);
router.use(requireSystemAdmin);

// ---------------------------------------------------------------------------
// POST /api/system/skill-analyser/jobs — Create analysis job
// ---------------------------------------------------------------------------

router.post(
  '/api/system/skill-analyser/jobs',
  upload.array('files'),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const userId = req.user!.id;

    // guard-ignore-next-line: input-validation reason="multipart/form-data route; multer parses fields, validateBody incompatible with file uploads"
    const sourceType = req.body.sourceType as 'paste' | 'upload' | 'github' | 'download';

    if (!['paste', 'upload', 'github', 'download'].includes(sourceType)) {
      return res.status(400).json({ error: 'Invalid sourceType. Must be paste, upload, github, or download.' });
    }

    let rawInput: string | Express.Multer.File[];
    let sourceMetadata: Record<string, unknown>;

    if (sourceType === 'paste') {
      const text = req.body.text as string;
      if (!text || text.trim().length < 10) {
        return res.status(400).json({ error: 'Paste text must be at least 10 characters.' });
      }
      rawInput = text;
      sourceMetadata = { charCount: text.length };
    } else if (sourceType === 'upload') {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded.' });
      }
      rawInput = files;
      sourceMetadata = {
        fileCount: files.length,
        files: files.map((f) => ({
          fileName: f.originalname,
          fileSize: f.size,
          mimeType: f.mimetype,
        })),
      };
    } else if (sourceType === 'download') {
      const url = req.body.url as string;
      if (!url || !/^https:\/\/.+/.test(url)) {
        return res.status(400).json({
          error: 'Invalid download URL. Must be a valid HTTPS URL.',
        });
      }
      rawInput = url;
      sourceMetadata = { url };
    } else {
      // github
      const url = req.body.url as string;
      if (!url || !/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url)) {
        return res.status(400).json({
          error: 'Invalid GitHub URL. Expected: https://github.com/{owner}/{repo}[/tree/{branch}/{path}]',
        });
      }
      rawInput = url;
      sourceMetadata = { url };
    }

    const { jobId } = await skillAnalyzerService.createJob({
      organisationId: orgId,
      userId,
      sourceType,
      sourceMetadata,
      rawInput,
    });

    const { job } = await skillAnalyzerService.getJob(jobId, orgId);

    return res.status(201).json({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/system/skill-analyser/jobs — List jobs
// ---------------------------------------------------------------------------

router.get(
  '/api/system/skill-analyser/jobs',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const jobs = await skillAnalyzerService.listJobs(orgId, limit, offset);

    // Enrich jobs with backup status for UI badges (single batch query)
    const jobIds = jobs.map((j) => j.id);
    const backupMap = await configBackupService.getBackupsBySourceIds(jobIds, orgId);
    const jobsWithBackup = jobs.map((job) => {
      const backup = backupMap.get(job.id);
      return { ...job, backupId: backup?.id ?? null, backupStatus: backup?.status ?? null };
    });

    return res.json({ jobs: jobsWithBackup });
  })
);

// ---------------------------------------------------------------------------
// GET /api/system/skill-analyser/jobs/:jobId — Get job with results
// ---------------------------------------------------------------------------

router.get(
  '/api/system/skill-analyser/jobs/:jobId',
  asyncHandler(async (req, res) => {
    const { job, results, availableSystemAgents } =
      await skillAnalyzerService.getJob(req.params.jobId, req.orgId!);

    // Phase 1 of skill-analyzer-v2: the client's AnalysisJob type expects
    // availableSystemAgents as a field on `job` (the Review UI reads
    // job.availableSystemAgents). The service returns it as a top-level
    // sibling, so fold it in here.
    return res.json({
      job: { ...job, availableSystemAgents },
      results,
    });
  })
);

// ---------------------------------------------------------------------------
// PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId — Set action
// ---------------------------------------------------------------------------

router.patch(
  '/api/system/skill-analyser/jobs/:jobId/results/:resultId',
  asyncHandler(async (req, res) => {
    // v2 §11.11.2: action=null is the unapprove path — required so a
    // reviewer can edit a locked (approved) result.
    const { action } = req.body as { action: string | null };

    if (action !== null && !['approved', 'rejected', 'skipped'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be approved, rejected, skipped, or null (unapprove).' });
    }

    await skillAnalyzerService.setResultAction({
      resultId: req.params.resultId,
      jobId: req.params.jobId,
      organisationId: req.orgId!,
      userId: req.user!.id,
      action: action as 'approved' | 'rejected' | 'skipped' | null,
    });

    return res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId/agents
// Phase 4 of skill-analyzer-v2 (spec §7.3): toggle / remove / addIfMissing
// modes for the agentProposals jsonb on a DISTINCT result row.
// ---------------------------------------------------------------------------

router.patch(
  '/api/system/skill-analyser/jobs/:jobId/results/:resultId/agents',
  asyncHandler(async (req, res) => {
    const body = req.body as {
      systemAgentId?: string;
      selected?: boolean;
      remove?: boolean;
      addIfMissing?: boolean;
    };

    if (typeof body.systemAgentId !== 'string' || body.systemAgentId.length === 0) {
      return res.status(400).json({ error: 'systemAgentId is required' });
    }

    const updated = await skillAnalyzerService.updateAgentProposal({
      resultId: req.params.resultId,
      jobId: req.params.jobId,
      organisationId: req.orgId!,
      systemAgentId: body.systemAgentId,
      selected: body.selected,
      remove: body.remove,
      addIfMissing: body.addIfMissing,
    });

    return res.json(updated);
  })
);

// ---------------------------------------------------------------------------
// PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId/merge
// Phase 5 of skill-analyzer-v2 (spec §7.3): patch one or more fields of
// proposedMergedContent on a PARTIAL_OVERLAP / IMPROVEMENT result. Sets
// userEditedMerge=true. Definition shape is validated via the shared
// isValidToolDefinitionShape predicate.
// ---------------------------------------------------------------------------

router.patch(
  '/api/system/skill-analyser/jobs/:jobId/results/:resultId/merge',
  asyncHandler(async (req, res) => {
    const body = req.body as {
      name?: string;
      description?: string;
      definition?: object;
      instructions?: string | null;
      mergeUpdatedAt?: string;
    };

    // Light shape check before reaching the service.
    if (
      body.name === undefined &&
      body.description === undefined &&
      body.definition === undefined &&
      body.instructions === undefined
    ) {
      return res.status(400).json({ error: 'at least one of name, description, definition, instructions is required' });
    }

    const { mergeUpdatedAt: ifUnmodifiedSince, ...patch } = body;
    const updated = await skillAnalyzerService.patchMergeFields({
      resultId: req.params.resultId,
      jobId: req.params.jobId,
      organisationId: req.orgId!,
      ifUnmodifiedSince,
      patch,
    });

    return res.json(updated);
  })
);

// ---------------------------------------------------------------------------
// POST /api/system/skill-analyser/jobs/:jobId/results/:resultId/merge/reset
// Phase 5 of skill-analyzer-v2 (spec §7.3): copy originalProposedMerge back
// into proposedMergedContent and clear userEditedMerge. 409 if the original
// is null.
// ---------------------------------------------------------------------------

router.post(
  '/api/system/skill-analyser/jobs/:jobId/results/:resultId/merge/reset',
  asyncHandler(async (req, res) => {
    const updated = await skillAnalyzerService.resetMergeToOriginal({
      resultId: req.params.resultId,
      jobId: req.params.jobId,
      organisationId: req.orgId!,
    });
    return res.json(updated);
  })
);

// ---------------------------------------------------------------------------
// POST /api/system/skill-analyser/jobs/:jobId/results/bulk-action — Bulk action
// ---------------------------------------------------------------------------

router.post(
  '/api/system/skill-analyser/jobs/:jobId/results/bulk-action',
  asyncHandler(async (req, res) => {
    const { resultIds, action } = req.body as { resultIds: string[]; action: string };

    if (!Array.isArray(resultIds) || resultIds.length === 0) {
      return res.status(400).json({ error: 'resultIds must be a non-empty array.' });
    }

    if (!['approved', 'rejected', 'skipped'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be approved, rejected, or skipped.' });
    }

    await skillAnalyzerService.bulkSetResultAction({
      resultIds,
      jobId: req.params.jobId,
      organisationId: req.orgId!,
      userId: req.user!.id,
      action: action as 'approved' | 'rejected' | 'skipped',
    });

    return res.json({ ok: true, count: resultIds.length });
  })
);

// ---------------------------------------------------------------------------
// POST /api/system/skill-analyser/jobs/:jobId/execute — Execute approved actions
// ---------------------------------------------------------------------------

router.post(
  '/api/system/skill-analyser/jobs/:jobId/execute',
  asyncHandler(async (req, res) => {
    const result = await skillAnalyzerService.executeApproved({
      jobId: req.params.jobId,
      organisationId: req.orgId!,
      userId: req.user!.id,
    });

    return res.json(result);
  })
);

// ---------------------------------------------------------------------------
// POST /api/system/skill-analyser/jobs/:jobId/execute/unlock
// v2 §11.11.3: recover a stuck execution_lock when a prior Execute crashed
// hard enough to bypass the `finally` release (SIGKILL, OOM, host reboot).
// Gated by systemAdmin (already required at the router level) + a min-age
// check driven by config.executionLockStaleSeconds. Returns 409 if the lock
// is either already released or younger than the stale threshold.
// ---------------------------------------------------------------------------

router.post(
  '/api/system/skill-analyser/jobs/:jobId/execute/unlock',
  asyncHandler(async (req, res) => {
    const result = await skillAnalyzerService.unlockStaleExecution({
      jobId: req.params.jobId,
      organisationId: req.orgId!,
      userId: req.user!.id,
    });
    return res.json(result);
  })
);

// ---------------------------------------------------------------------------
// POST /api/system/skill-analyser/jobs/:jobId/resume
// Re-enqueue a stalled or failed analysis job. The pipeline handler is
// crash-resumable (Stage 5 skips already-classified rows, Stage 6 hits
// the agent-embedding cache) so this is a no-op on LLM spend. Refuses
// when the job is completed or when pg-boss already has a live entry
// for this jobId — see skillAnalyzerService.resumeJob for the guards.
// ---------------------------------------------------------------------------

router.post(
  '/api/system/skill-analyser/jobs/:jobId/resume',
  asyncHandler(async (req, res) => {
    const result = await skillAnalyzerService.resumeJob({
      jobId: req.params.jobId,
      organisationId: req.orgId!,
      userId: req.user!.id,
    });
    return res.json(result);
  })
);

// ---------------------------------------------------------------------------
// POST /api/system/skill-analyser/jobs/:jobId/results/:resultId/retry-classification
// Retry LLM classification for a single result row with classificationFailed=true.
// Idempotent — no-op if the row is not in a failed state.
// ---------------------------------------------------------------------------

router.post(
  '/api/system/skill-analyser/jobs/:jobId/results/:resultId/retry-classification',
  asyncHandler(async (req, res) => {
    await skillAnalyzerService.retryClassification(
      req.params.jobId,
      req.params.resultId,
      req.orgId!,
    );
    return res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/system/skill-analyser/jobs/:jobId/retry-failed-classifications
// Retry all classificationFailed=true results in a job sequentially.
// ---------------------------------------------------------------------------

router.post(
  '/api/system/skill-analyser/jobs/:jobId/retry-failed-classifications',
  asyncHandler(async (req, res) => {
    const { retried, stillFailed } = await skillAnalyzerService.bulkRetryFailedClassifications(
      req.params.jobId,
      req.orgId!,
    );
    return res.json({ ok: true, retried, stillFailed });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/system/skill-analyser/jobs/:jobId/backup — Get backup for a job
// ---------------------------------------------------------------------------

router.get(
  '/api/system/skill-analyser/jobs/:jobId/backup',
  asyncHandler(async (req, res) => {
    const backup = await configBackupService.getBackupBySourceId(
      req.params.jobId,
      req.orgId!,
    );
    if (!backup) return res.json({ backup: null });
    return res.json({ backup });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/system/skill-analyser/jobs/:jobId/restore — Restore pre-apply backup
// ---------------------------------------------------------------------------

router.post(
  '/api/system/skill-analyser/jobs/:jobId/restore',
  asyncHandler(async (req, res) => {
    const backup = await configBackupService.getBackupBySourceId(
      req.params.jobId,
      req.orgId!,
    );
    if (!backup) {
      throw { statusCode: 404, message: 'No backup found for this job' };
    }

    if (req.query.dryRun === 'true') {
      const preview = await configBackupService.describeRestore({
        backupId: backup.id,
        organisationId: req.orgId!,
      });
      return res.json(preview);
    }

    const result = await configBackupService.restoreBackup({
      backupId: backup.id,
      organisationId: req.orgId!,
      restoredBy: req.user!.id,
    });

    return res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/system/skill-analyser/jobs/:jobId/proposed-agents
// Confirm or reject a proposed new agent. §11 Fix 5
// ---------------------------------------------------------------------------

router.patch(
  '/api/system/skill-analyser/jobs/:jobId/proposed-agents',
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const orgId = req.orgId!;
    const body = (req.body ?? {}) as { proposedAgentIndex?: number; action?: string };
    if (typeof body.proposedAgentIndex !== 'number') {
      return res.status(400).json({ error: 'proposedAgentIndex is required (number).' });
    }
    if (body.action !== 'confirm' && body.action !== 'reject') {
      return res.status(400).json({ error: 'action must be "confirm" or "reject".' });
    }
    await skillAnalyzerService.updateProposedAgent({
      jobId,
      organisationId: orgId,
      proposedAgentIndex: body.proposedAgentIndex,
      action: body.action,
    });
    return res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId/resolve-warning
// Record reviewer decision on a merge warning. §11.2
// ---------------------------------------------------------------------------

router.patch(
  '/api/system/skill-analyser/jobs/:jobId/results/:resultId/resolve-warning',
  asyncHandler(async (req, res) => {
    const { jobId, resultId } = req.params;
    const orgId = req.orgId!;
    const userId = req.user!.id;

    // If-Unmodified-Since is strictly required for resolve-warning. §11.11.5
    const ifUnmodifiedSince = req.header('if-unmodified-since');
    if (!ifUnmodifiedSince) {
      return res
        .status(400)
        .json({ error: 'If-Unmodified-Since header is required.' });
    }

    const body = (req.body ?? {}) as {
      warningCode?: string;
      resolution?: string;
      details?: Record<string, unknown>;
    };
    if (!body.warningCode || typeof body.warningCode !== 'string') {
      return res.status(400).json({ error: 'warningCode is required.' });
    }
    if (!body.resolution || typeof body.resolution !== 'string') {
      return res.status(400).json({ error: 'resolution is required.' });
    }

    const details = body.details ?? {};

    await skillAnalyzerService.resolveWarning({
      resultId,
      jobId,
      organisationId: orgId,
      userId,
      ifUnmodifiedSince,
      warningCode: body.warningCode as never,
      resolution: body.resolution as never,
      details: {
        field: typeof details.field === 'string' ? details.field : undefined,
        disambiguationNote: typeof details.disambiguationNote === 'string' ? details.disambiguationNote : undefined,
        collidingSkillId: typeof details.collidingSkillId === 'string' ? details.collidingSkillId : undefined,
      },
    });

    return res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/system/skill-analyser/config — Read config singleton
// ---------------------------------------------------------------------------

router.get(
  '/api/system/skill-analyser/config',
  asyncHandler(async (_req, res) => {
    const config = await skillAnalyzerConfigService.getConfig();
    return res.json(config);
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/system/skill-analyser/config — Update config singleton
// ---------------------------------------------------------------------------

router.patch(
  '/api/system/skill-analyser/config',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as skillAnalyzerConfigService.ConfigPatch;
    const updated = await skillAnalyzerConfigService.updateConfig(body, req.user!.id);
    return res.json(updated);
  }),
);

export default router;
