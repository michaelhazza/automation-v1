import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { validateBody } from '../middleware/validate.js';
import { logger } from '../lib/logger.js';
import * as memoryBlockService from '../services/memoryBlockService.js';
import { PROTECTED_BLOCK_NAMES } from '../lib/protectedBlocks.js';

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

// ─── Protected-block 409 helper ──────────────────────────────────────────────

function rejectProtectedBlock(res: Response, errorCode = 'PROTECTED_MEMORY_BLOCK') {
  res.status(409).json({
    error: 'This memory block is protected and cannot be modified structurally. Contact platform operations.',
    errorCode,
  });
}

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
// Guard: name must not be in PROTECTED_BLOCK_NAMES — reserves the name so a
// user-authored block cannot squat it before the seeder runs.

router.post(
  '/api/memory-blocks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  validateBody(createMemoryBlockBody, 'warn'),
  asyncHandler(async (req, res) => {
    const { name, content, subaccountId, ownerAgentId, isReadOnly, autoAttach } = req.body;

    if (PROTECTED_BLOCK_NAMES.has(name)) {
      res.status(409).json({
        error: `Block name '${name}' is reserved for a platform-managed block. Contact platform operations.`,
        errorCode: 'PROTECTED_MEMORY_BLOCK',
      });
      return;
    }

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
// Guards on protected blocks:
//   - rename (name change) → 409
//   - isReadOnly: false    → 409  (would allow agent self-overwrite)
//   - ownerAgentId change  → 409  (would reassign write provenance)
//   - content edit         → allowed for org admins; logged at info level

router.patch(
  '/api/memory-blocks/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  validateBody(updateMemoryBlockBody, 'warn'),
  asyncHandler(async (req, res) => {
    const { name, content, isReadOnly, ownerAgentId } = req.body;
    const blockId = req.params.id;

    // Fetch block meta only when one of the guarded fields is present
    const needsGuardCheck = name !== undefined || isReadOnly !== undefined || ownerAgentId !== undefined || content !== undefined;
    if (needsGuardCheck) {
      const blockMeta = await memoryBlockService.getBlockMeta(blockId, req.orgId!);
      if (blockMeta && PROTECTED_BLOCK_NAMES.has(blockMeta.name)) {
        if (name !== undefined && name !== blockMeta.name) {
          rejectProtectedBlock(res);
          return;
        }
        if (isReadOnly === false) {
          rejectProtectedBlock(res);
          return;
        }
        // Only reject if ownerAgentId is actually changing — a PATCH that
        // sends the same value as the current owner is a no-op structurally.
        if (ownerAgentId !== undefined && ownerAgentId !== blockMeta.ownerAgentId) {
          rejectProtectedBlock(res);
          return;
        }
        // Content edits are permitted — log for observability
        if (content !== undefined) {
          logger.info('protected_block.content_edited', {
            blockId,
            blockName: blockMeta.name,
            orgId: req.orgId,
            actorUserId: req.user?.id ?? null,
            source: 'manual',
          });
        }
      }
    }

    const updated = await memoryBlockService.updateBlockAdmin(
      blockId,
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
// Guard: protected blocks cannot be soft-deleted via the API.

router.delete(
  '/api/memory-blocks/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const blockId = req.params.id;
    const blockName = await memoryBlockService.getBlockName(blockId, req.orgId!);
    if (blockName && PROTECTED_BLOCK_NAMES.has(blockName)) {
      rejectProtectedBlock(res);
      return;
    }

    const deleted = await memoryBlockService.deleteBlock(blockId, req.orgId!);

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
// Guard: cannot detach the *owning agent* from a protected block. Detaching
// the owner disables the guidelines until the next deploy-time reseed.
// Non-owner agents that have been spuriously attached can still be detached.

router.delete(
  '/api/memory-blocks/:blockId/attachments/:agentId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { blockId, agentId } = req.params;

    const blockMeta = await memoryBlockService.getBlockMeta(blockId, req.orgId!);
    if (blockMeta && PROTECTED_BLOCK_NAMES.has(blockMeta.name) && blockMeta.ownerAgentId === agentId) {
      res.status(409).json({
        error: 'This attachment is protected and cannot be removed. Contact platform operations.',
        errorCode: 'PROTECTED_MEMORY_BLOCK_ATTACHMENT',
      });
      return;
    }

    const detached = await memoryBlockService.detachBlock(blockId, agentId, req.orgId!);

    if (!detached) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    res.json({ success: true });
  })
);

export default router;
