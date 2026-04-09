import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import * as memoryBlockService from '../services/memoryBlockService.js';

const router = Router();

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
  asyncHandler(async (req, res) => {
    const { name, content, subaccountId, ownerAgentId, isReadOnly } = req.body;

    if (!name || !content) {
      res.status(400).json({ error: 'name and content are required' });
      return;
    }

    const block = await memoryBlockService.createBlock({
      organisationId: req.orgId!,
      subaccountId,
      name,
      content,
      ownerAgentId,
      isReadOnly,
    });

    res.status(201).json(block);
  })
);

// ─── Update a memory block (admin) ──────────────────────────────────────────

router.patch(
  '/api/memory-blocks/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
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
