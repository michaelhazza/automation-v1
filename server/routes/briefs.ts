import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { createBrief, getBriefArtefacts, getBriefMeta } from '../services/briefCreationService.js';
import { writeConversationMessage } from '../services/briefConversationWriter.js';
import type { BriefUiContext } from '../../shared/types/briefFastPath.js';

const router = Router();

// POST /api/briefs — create a Brief from free text
router.post(
  '/api/briefs',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE),
  asyncHandler(async (req, res) => {
    const { text, source, uiContext, subaccountId } = req.body as {
      text?: string;
      source?: 'global_ask_bar' | 'slash_remember' | 'programmatic';
      uiContext?: Partial<BriefUiContext>;
      subaccountId?: string;
    };

    if (!text?.trim()) {
      res.status(400).json({ message: 'text is required' });
      return;
    }

    const context: BriefUiContext = {
      surface: uiContext?.surface ?? 'global_ask_bar',
      currentOrgId: req.orgId!,
      currentSubaccountId: subaccountId ?? uiContext?.currentSubaccountId,
      userPermissions: new Set<string>(),
    };

    const result = await createBrief({
      organisationId: req.orgId!,
      subaccountId: subaccountId ?? uiContext?.currentSubaccountId,
      submittedByUserId: req.user!.id,
      text: text.trim(),
      source: source ?? 'global_ask_bar',
      uiContext: context,
    });

    res.status(201).json(result);
  }),
);

// GET /api/briefs/:briefId — Brief metadata + its conversationId. The client
// joins tasks → conversations here rather than calling /api/tasks + a
// separate /api/conversations lookup; /api/tasks is subaccount-scoped and
// doesn't carry conversationId.
router.get(
  '/api/briefs/:briefId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_READ),
  asyncHandler(async (req, res) => {
    const { briefId } = req.params;

    const meta = await getBriefMeta(briefId, req.orgId!);
    if (!meta) {
      res.status(404).json({ message: 'Brief not found' });
      return;
    }

    res.json(meta);
  }),
);

// GET /api/briefs/:briefId/artefacts — list artefacts for a Brief
router.get(
  '/api/briefs/:briefId/artefacts',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_READ),
  asyncHandler(async (req, res) => {
    const { briefId } = req.params;

    const artefacts = await getBriefArtefacts(briefId, req.orgId!);
    res.json(artefacts);
  }),
);

// POST /api/briefs/:briefId/messages — add a user message to a Brief
router.post(
  '/api/briefs/:briefId/messages',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE),
  asyncHandler(async (req, res) => {
    const { briefId } = req.params;
    const { content, conversationId } = req.body as { content?: string; conversationId?: string };

    if (!content?.trim()) {
      res.status(400).json({ message: 'content is required' });
      return;
    }
    if (!conversationId) {
      res.status(400).json({ message: 'conversationId is required' });
      return;
    }

    const result = await writeConversationMessage({
      conversationId,
      briefId,
      organisationId: req.orgId!,
      role: 'user',
      content: content.trim(),
      senderUserId: req.user!.id,
    });

    res.status(201).json(result);
  }),
);

export default router;
