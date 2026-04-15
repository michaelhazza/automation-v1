import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { validateBody } from '../middleware/validate.js';
import * as memoryBlockService from '../services/memoryBlockService.js';

const router = Router();

// Body schemas
const createMemoryBlockBody = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
  subaccountId: z.string().uuid().optional(),
  ownerAgentId: z.string().uuid().optional(),
  isReadOnly: z.boolean().optional(),
  /**
   * Phase G / §7.4 / G7.1 — materialise read-only attachments for every
   * currently-linked agent in the sub-account. Ignored when `subaccountId`
   * is absent (org-scoped blocks have no sub-account agent roster).
   */
  autoAttach: z.boolean().optional(),
});

const updateMemoryBlockBody = z.object({
  name: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  isReadOnly: z.boolean().optional(),
  ownerAgentId: z.string().uuid().nullable().optional(),
});

// ─── List memory blocks (org-scoped, optional subaccount filter) ────────────

router.get(
  '/api/memory-blocks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.query;
    const blocks = await memoryBlockService.listBlocks(
      req.orgId!,
      subaccountId as string | undefined,
    );
    res.json(blocks);
  })
);

// ─── Create a memory block ──────────────────────────────────────────────────

router.post(
  '/api/memory-blocks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  validateBody(createMemoryBlockBody, 'warn'),
  asyncHandler(async (req, res) => {
    const { name, content, subaccountId, ownerAgentId, isReadOnly, autoAttach } = req.body;

    const block = await memoryBlockService.createBlock({
      organisationId: req.orgId!,
      subaccountId,
      name,
      content,
      ownerAgentId,
      isReadOnly,
      autoAttach,
    });

    res.status(201).json(block);
  })
);

// ─── Update a memory block (admin) ──────────────────────────────────────────

router.patch(
  '/api/memory-blocks/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  validateBody(updateMemoryBlockBody, 'warn'),
  asyncHandler(async (req, res) => {
    const { name, content, isReadOnly, ownerAgentId } = req.body;

    const updated = await memoryBlockService.updateBlockAdmin(
      req.params.id,
      req.orgId!,
      { name, content, isReadOnly, ownerAgentId },
    );

    if (!updated) {
      res.status(404).json({ error: 'Memory block not found' });
      return;
    }

    res.json(updated);
  })
);

// ─── Delete a memory block (soft delete) ────────────────────────────────────

router.delete(
  '/api/memory-blocks/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const deleted = await memoryBlockService.deleteBlock(req.params.id, req.orgId!);

    if (!deleted) {
      res.status(404).json({ error: 'Memory block not found' });
      return;
    }

    res.json({ success: true });
  })
);

// ─── Attach a block to an agent ─────────────────────────────────────────────

router.post(
  '/api/memory-blocks/:id/attachments',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { agentId, permission } = req.body;

    if (!agentId || !permission) {
      res.status(400).json({ error: 'agentId and permission are required' });
      return;
    }

    if (!['read', 'read_write'].includes(permission)) {
      res.status(400).json({ error: 'permission must be "read" or "read_write"' });
      return;
    }

    const result = await memoryBlockService.attachBlock(req.params.id, agentId, permission, req.orgId!);
    res.status(201).json(result);
  })
);

// ─── Detach a block from an agent ───────────────────────────────────────────

router.delete(
  '/api/memory-blocks/:blockId/attachments/:agentId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { blockId, agentId } = req.params;
    const detached = await memoryBlockService.detachBlock(blockId, agentId, req.orgId!);

    if (!detached) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    res.json({ success: true });
  })
);

export default router;
