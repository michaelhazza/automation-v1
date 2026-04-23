import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import * as referenceDocumentService from '../services/referenceDocumentService.js';
import * as documentBundleService from '../services/documentBundleService.js';

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
// Supports optional bundleName + attachTo params (§7.1, wired in Phase 2).
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

    const attachTo = req.body?.attachTo
      ? (JSON.parse(req.body.attachTo as string) as { subjectType: documentBundleService.AttachmentSubjectType; subjectId: string })
      : undefined;
    const bundleName = (req.body?.bundleName as string | undefined) ?? undefined;

    // Validate: bundleName requires >= 2 files
    if (bundleName && files.length < 2) {
      res.status(400).json({ error: 'At least 2 files are required to create a bundle', code: 'CACHED_CONTEXT_UPLOAD_BUNDLE_TOO_FEW_FILES' });
      return;
    }

    // Validate names array.
    let names: string[] = [];
    if (req.body?.names) {
      names = Array.isArray(req.body.names) ? req.body.names : JSON.parse(req.body.names as string);
    }
    if (names.length > 0 && names.length !== files.length) {
      res.status(400).json({ error: 'names array length must match files array length', code: 'CACHED_CONTEXT_UPLOAD_NAMES_LENGTH_MISMATCH' });
      return;
    }

    const subaccountId = (req.body?.subaccountId as string | undefined) ?? null;

    // Validate MIME types first
    for (const file of files) {
      if (!ALLOWED_MIMES.has(file.mimetype)) {
        res.status(400).json({ error: `File ${file.originalname} has unsupported MIME type: ${file.mimetype}` });
        return;
      }
    }

    // Validate names unique within request
    const resolvedNames: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const name = names[i]?.trim() || files[i].originalname.replace(/\.[^.]+$/, '');
      if (!name) {
        res.status(400).json({ error: `File at index ${i} has an empty name`, code: 'CACHED_CONTEXT_UPLOAD_NAME_EMPTY' });
        return;
      }
      if (resolvedNames.includes(name)) {
        res.status(400).json({ error: `Duplicate name "${name}" in this upload request`, code: 'CACHED_CONTEXT_UPLOAD_NAME_DUPLICATE_IN_REQUEST' });
        return;
      }
      resolvedNames.push(name);
    }

    const createdDocs: Awaited<ReturnType<typeof referenceDocumentService.create>>[] = [];
    for (let i = 0; i < files.length; i++) {
      const content = files[i].buffer.toString('utf8');
      const doc = await referenceDocumentService.create({
        organisationId: req.orgId!,
        subaccountId,
        name: resolvedNames[i],
        content,
        createdByUserId: req.user!.id,
      });
      createdDocs.push(doc);
    }

    const documentIds = createdDocs.map((d) => d.id);

    // If bundleName, create a named bundle directly (promote after findOrCreate)
    let bundleId: string | null = null;
    if (bundleName) {
      const unnamed = await documentBundleService.findOrCreateUnnamedBundle({
        organisationId: req.orgId!,
        subaccountId,
        documentIds,
        createdByUserId: req.user!.id,
      });
      const promoted = await documentBundleService.promoteToNamedBundle({
        bundleId: unnamed.id,
        organisationId: req.orgId!,
        name: bundleName,
        userId: req.user!.id,
      });
      bundleId = promoted.id;
    }

    // If attachTo, attach either the bundle or an unnamed bundle wrapping all docs
    let autoAttachedTo: { subjectType: string; subjectId: string } | null = null;
    if (attachTo) {
      const targetBundleId = bundleId ?? (await documentBundleService.findOrCreateUnnamedBundle({
        organisationId: req.orgId!,
        subaccountId,
        documentIds,
        createdByUserId: req.user!.id,
      })).id;

      await documentBundleService.attach({
        bundleId: targetBundleId,
        subjectType: attachTo.subjectType,
        subjectId: attachTo.subjectId,
        attachedByUserId: req.user!.id,
        organisationId: req.orgId!,
        subaccountId,
      });
      if (!bundleId) bundleId = targetBundleId;
      autoAttachedTo = { subjectType: attachTo.subjectType, subjectId: attachTo.subjectId };
    }

    res.status(201).json({ documentIds, bundleId, autoAttachedTo });
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
    const result = await referenceDocumentService.getByIdWithCurrentVersion(req.params.id, req.orgId!);
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
    const doc = await referenceDocumentService.rename({ documentId: req.params.id, organisationId: req.orgId!, newName: name });
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
      organisationId: req.orgId!,
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
    await referenceDocumentService.pause(req.params.id, req.orgId!, req.user!.id);
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
    await referenceDocumentService.resume(req.params.id, req.orgId!, req.user!.id);
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
    await referenceDocumentService.deprecate({ documentId: req.params.id, organisationId: req.orgId!, reason, userId: req.user!.id });
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
    await referenceDocumentService.softDelete(req.params.id, req.orgId!, req.user!.id);
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
    const versions = await referenceDocumentService.listVersions(req.params.id, req.orgId!);
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
    const versionRow = await referenceDocumentService.getVersion(req.params.id, req.orgId!, version);
    if (!versionRow) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }
    res.json(versionRow);
  }),
);

export default router;
