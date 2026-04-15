import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { validateBody } from '../middleware/validate.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import {
  promoteReferenceToBlock,
  demoteBlockToReference,
  createReference,
  updateReference,
  MEMORY_BLOCK_LABEL_MAX,
  MEMORY_BLOCK_CONTENT_MAX,
} from '../services/knowledgeService.js';
import * as memoryBlockService from '../services/memoryBlockService.js';
import { workspaceMemoryService } from '../services/workspaceMemoryService.js';

// ---------------------------------------------------------------------------
// Unified Knowledge page (spec §7) — backend shims that sit on top of the
// existing workspaceMemory + memoryBlock services and add promote/demote.
// ---------------------------------------------------------------------------

const router = Router();

const promoteBody = z.object({
  label: z.string().min(1).max(MEMORY_BLOCK_LABEL_MAX),
  content: z.string().min(1).max(MEMORY_BLOCK_CONTENT_MAX),
});

const demoteBody = z.object({
  content: z.string().min(1).optional(),
});

const createReferenceBody = z.object({
  content: z.string().min(1),
  entryType: z.enum(['observation', 'decision', 'preference', 'issue', 'pattern']).optional(),
});

const updateReferenceBody = z.object({
  content: z.string().min(1),
});

// ─── List: References + Memory Blocks in one call ──────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/knowledge',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const [references, blocks] = await Promise.all([
      workspaceMemoryService.listEntries(subaccountId, {
        limit: 500,
        organisationId: req.orgId!,
      }),
      memoryBlockService.listBlocks(req.orgId!, subaccountId),
    ]);

    res.json({ references, memoryBlocks: blocks });
  }),
);

// ─── References CRUD (manual authoring path) ───────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/knowledge/references',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  validateBody(createReferenceBody, 'warn'),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { content, entryType } = req.body as z.infer<typeof createReferenceBody>;

    const created = await createReference({
      subaccountId,
      organisationId: req.orgId!,
      content,
      entryType,
    });

    res.status(201).json(created);
  }),
);

router.patch(
  '/api/subaccounts/:subaccountId/knowledge/references/:referenceId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  validateBody(updateReferenceBody, 'warn'),
  asyncHandler(async (req, res) => {
    const { subaccountId, referenceId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { content } = req.body as z.infer<typeof updateReferenceBody>;

    const updated = await updateReference({
      referenceId,
      subaccountId,
      organisationId: req.orgId!,
      content,
    });

    if (!updated) {
      res.status(404).json({ error: 'Reference not found' });
      return;
    }
    res.json(updated);
  }),
);

router.delete(
  '/api/subaccounts/:subaccountId/knowledge/references/:referenceId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, referenceId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const deleted = await workspaceMemoryService.deleteEntry(referenceId, req.orgId!, subaccountId);
    if (!deleted) {
      res.status(404).json({ error: 'Reference not found' });
      return;
    }
    res.json({ success: true });
  }),
);

// ─── Promote a Reference into a Memory Block ───────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/knowledge/references/:referenceId/promote',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  validateBody(promoteBody, 'warn'),
  asyncHandler(async (req, res) => {
    const { subaccountId, referenceId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { label, content } = req.body as z.infer<typeof promoteBody>;

    const result = await promoteReferenceToBlock({
      referenceId,
      subaccountId,
      organisationId: req.orgId!,
      label,
      content,
      actorUserId: req.user?.id ?? null,
    });
    res.status(201).json(result);
  }),
);

// ─── Demote a Memory Block into a Reference ────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/knowledge/memory-blocks/:blockId/demote',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  validateBody(demoteBody, 'warn'),
  asyncHandler(async (req, res) => {
    const { subaccountId, blockId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { content } = req.body as z.infer<typeof demoteBody>;

    const result = await demoteBlockToReference({
      blockId,
      subaccountId,
      organisationId: req.orgId!,
      content,
      actorUserId: req.user?.id ?? null,
    });
    res.status(201).json(result);
  }),
);

export default router;
