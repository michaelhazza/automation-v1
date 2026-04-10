import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { skillAnalyzerService } from '../services/skillAnalyzerService.js';

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

    return res.json({ jobs });
  })
);

// ---------------------------------------------------------------------------
// GET /api/system/skill-analyser/jobs/:jobId — Get job with results
// ---------------------------------------------------------------------------

router.get(
  '/api/system/skill-analyser/jobs/:jobId',
  asyncHandler(async (req, res) => {
    const { job, results } = await skillAnalyzerService.getJob(
      req.params.jobId,
      req.orgId!
    );

    return res.json({ job, results });
  })
);

// ---------------------------------------------------------------------------
// PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId — Set action
// ---------------------------------------------------------------------------

router.patch(
  '/api/system/skill-analyser/jobs/:jobId/results/:resultId',
  asyncHandler(async (req, res) => {
    const { action } = req.body as { action: string };

    if (!['approved', 'rejected', 'skipped'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be approved, rejected, or skipped.' });
    }

    await skillAnalyzerService.setResultAction({
      resultId: req.params.resultId,
      jobId: req.params.jobId,
      organisationId: req.orgId!,
      userId: req.user!.id,
      action: action as 'approved' | 'rejected' | 'skipped',
    });

    return res.json({ ok: true });
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

export default router;
