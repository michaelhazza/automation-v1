import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import * as referenceDocumentService from '../services/referenceDocumentService.js';

const router = Router();

// ---------------------------------------------------------------------------
// Multer config — in-memory storage, 10 MB per file.
// MIME whitelist enforced in the bulk-upload handler.
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const ALLOWED_MIMES = new Set([
  'text/markdown',
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// ---------------------------------------------------------------------------
// GET /api/reference-documents — list all documents for the org
// ---------------------------------------------------------------------------
router.get(
  '/api/reference-documents',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId, includeDeleted } = req.query as Record<string, string | undefined>;
    const docs = await referenceDocumentService.listByOrg(req.orgId!, {
      subaccountId: subaccountId ?? undefined,
      includeDeleted: includeDeleted === 'true',
    });
    res.json(docs);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/reference-documents — create a single document
// ---------------------------------------------------------------------------
router.post(
  '/api/reference-documents',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const { name, description, content, subaccountId } = req.body as {
      name?: string;
      description?: string;
      content?: string;
      subaccountId?: string;
    };
    if (!name || !content) {
      res.status(400).json({ error: 'name and content are required' });
      return;
    }
    const doc = await referenceDocumentService.create({
      organisationId: req.orgId!,
      subaccountId: subaccountId ?? null,
      name,
      description,
      content,
      createdByUserId: req.user!.id,
    });
    res.status(201).json(doc);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/reference-documents/bulk-upload — multipart upload of 1-N files
//
// Supports optional `attachTo` JSON body param (§7.1). In Phase 1 this is
// stubbed: if `attachTo` is present, return 501 NOT_IMPLEMENTED_UNTIL_PHASE_2.
// Documents-only uploads work fully.
// ---------------------------------------------------------------------------
router.post(
  '/api/reference-documents/bulk-upload',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_WRITE),
  upload.array('files'),
  asyncHandler(async (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'At least one file is required' });
      return;
    }

    // attachTo stub — Phase 2 will wire this to documentBundleService.
    const attachTo = req.body?.attachTo ? JSON.parse(req.body.attachTo as string) : undefined;
    if (attachTo) {
      res.status(501).json({ error: 'attachTo is not implemented until Phase 2', code: 'NOT_IMPLEMENTED_UNTIL_PHASE_2' });
      return;
    }

    // Validate names array.
    let names: string[] = [];
    if (req.body?.names) {
      names = Array.isArray(req.body.names) ? req.body.names : JSON.parse(req.body.names as string);
    }
    if (names.length > 0 && names.length !== files.length) {
      res.status(400).json({ error: 'names array length must match files array length' });
      return;
    }

    const subaccountId = (req.body?.subaccountId as string | undefined) ?? null;
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    void idempotencyKey; // used for dedup when Phase 2 wires the transaction

    const results: unknown[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (!ALLOWED_MIMES.has(file.mimetype)) {
        res.status(400).json({ error: `File ${file.originalname} has unsupported MIME type: ${file.mimetype}` });
        return;
      }

      const name = names[i] ?? file.originalname.replace(/\.[^.]+$/, '');
      const content = file.buffer.toString('utf8');

      const doc = await referenceDocumentService.create({
        organisationId: req.orgId!,
        subaccountId,
        name,
        content,
        createdByUserId: req.user!.id,
      });
      results.push(doc);
    }

    res.status(201).json({ documents: results });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/reference-documents/:id
// ---------------------------------------------------------------------------
router.get(
  '/api/reference-documents/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_READ),
  asyncHandler(async (req, res) => {
    const result = await referenceDocumentService.getByIdWithCurrentVersion(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Reference document not found' });
      return;
    }
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/reference-documents/:id — rename + update description
// ---------------------------------------------------------------------------
router.patch(
  '/api/reference-documents/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const doc = await referenceDocumentService.rename({ documentId: req.params.id, newName: name });
    res.json(doc);
  }),
);

// ---------------------------------------------------------------------------
// PUT /api/reference-documents/:id/content — update document content
// ---------------------------------------------------------------------------
router.put(
  '/api/reference-documents/:id/content',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const { content, notes } = req.body as { content?: string; notes?: string };
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    const version = await referenceDocumentService.updateContent({
      documentId: req.params.id,
      content,
      updatedByUserId: req.user!.id,
      notes,
    });
    res.json(version);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/reference-documents/:id/pause
// ---------------------------------------------------------------------------
router.post(
  '/api/reference-documents/:id/pause',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_WRITE),
  asyncHandler(async (req, res) => {
    await referenceDocumentService.pause(req.params.id, req.user!.id);
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// POST /api/reference-documents/:id/resume
// ---------------------------------------------------------------------------
router.post(
  '/api/reference-documents/:id/resume',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_WRITE),
  asyncHandler(async (req, res) => {
    await referenceDocumentService.resume(req.params.id, req.user!.id);
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// POST /api/reference-documents/:id/deprecate
// ---------------------------------------------------------------------------
router.post(
  '/api/reference-documents/:id/deprecate',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_DEPRECATE),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as { reason?: string };
    if (!reason) {
      res.status(400).json({ error: 'reason is required' });
      return;
    }
    await referenceDocumentService.deprecate({ documentId: req.params.id, reason, userId: req.user!.id });
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/reference-documents/:id — soft delete
// ---------------------------------------------------------------------------
router.delete(
  '/api/reference-documents/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_WRITE),
  asyncHandler(async (req, res) => {
    await referenceDocumentService.softDelete(req.params.id, req.user!.id);
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// GET /api/reference-documents/:id/versions — list all versions
// ---------------------------------------------------------------------------
router.get(
  '/api/reference-documents/:id/versions',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_READ),
  asyncHandler(async (req, res) => {
    const versions = await referenceDocumentService.listVersions(req.params.id);
    res.json(versions);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/reference-documents/:id/versions/:v — get specific version
// ---------------------------------------------------------------------------
router.get(
  '/api/reference-documents/:id/versions/:v',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_READ),
  asyncHandler(async (req, res) => {
    const version = parseInt(req.params.v, 10);
    if (isNaN(version) || version < 1) {
      res.status(400).json({ error: 'version must be a positive integer' });
      return;
    }
    const versionRow = await referenceDocumentService.getVersion(req.params.id, version);
    if (!versionRow) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }
    res.json(versionRow);
  }),
);

export default router;
