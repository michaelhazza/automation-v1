import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { createBrief, getBriefArtefacts, getBriefMeta } from '../services/briefCreationService.js';
import { handleConversationFollowUp } from '../services/briefConversationService.js';
import { decideBriefApproval } from '../services/briefApprovalService.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { tasks } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
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

// POST /api/briefs/:briefId/messages — add a follow-up user message to a Brief
router.post(
  '/api/briefs/:briefId/messages',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE),
  asyncHandler(async (req, res) => {
    const { briefId } = req.params;
    const { content, conversationId, uiContext, subaccountId } = req.body as {
      content?: string;
      conversationId?: string;
      uiContext?: Partial<BriefUiContext>;
      subaccountId?: string;
    };

    if (!content?.trim()) {
      res.status(400).json({ message: 'content is required' });
      return;
    }
    if (!conversationId) {
      res.status(400).json({ message: 'conversationId is required' });
      return;
    }

    // Derive the canonical subaccountId from the brief row itself rather than
    // trusting the client payload. The client only sends `uiContext.surface`,
    // so a missing currentSubaccountId would otherwise default the
    // classifier to 'org' scope and broaden the run for a subaccount-bound
    // brief. Server-side lookup is the source of truth.
    const tx = getOrgScopedDb('briefs.followup');
    const [briefTask] = await tx
      .select({ subaccountId: tasks.subaccountId })
      .from(tasks)
      .where(and(eq(tasks.id, briefId), eq(tasks.organisationId, req.orgId!)))
      .limit(1);

    if (!briefTask) {
      res.status(404).json({ message: 'Brief not found' });
      return;
    }

    const canonicalSubaccountId = briefTask.subaccountId ?? subaccountId ?? uiContext?.currentSubaccountId;

    const context: BriefUiContext = {
      surface: uiContext?.surface ?? 'brief_chat',
      currentOrgId: req.orgId!,
      currentSubaccountId: canonicalSubaccountId ?? undefined,
      userPermissions: new Set<string>(),
    };

    const result = await handleConversationFollowUp({
      conversationId,
      briefId,
      organisationId: req.orgId!,
      subaccountId: canonicalSubaccountId ?? undefined,
      text: content.trim(),
      uiContext: context,
      senderUserId: req.user!.id,
    });

    res.status(201).json(result);
  }),
);

// POST /api/briefs/:briefId/approvals/:artefactId/decision — approve or reject an approval card
router.post(
  '/api/briefs/:briefId/approvals/:artefactId/decision',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE),
  asyncHandler(async (req, res) => {
    const { briefId, artefactId } = req.params;
    const { decision, reason, conversationId, subaccountId } = req.body as {
      decision?: 'approve' | 'reject';
      reason?: string;
      conversationId?: string;
      subaccountId?: string;
    };

    if (decision !== 'approve' && decision !== 'reject') {
      res.status(400).json({ status: 'failed', error: 'decision must be approve or reject' });
      return;
    }
    if (!conversationId) {
      res.status(400).json({ status: 'failed', error: 'conversationId is required' });
      return;
    }

    const result = await decideBriefApproval({
      artefactId,
      decision,
      reason,
      conversationId,
      briefId,
      organisationId: req.orgId!,
      subaccountId,
      userId: req.user!.id,
    });

    if (result.status === 'failed') {
      if (result.error === 'artefact_not_found') { res.status(404).json(result); return; }
      if (result.error === 'artefact_not_approval') { res.status(422).json(result); return; }
      if (result.error === 'artefact_stale') { res.status(410).json(result); return; }
      if (result.error === 'approval_already_decided') { res.status(409).json(result); return; }
    }

    res.status(200).json(result);
  }),
);

export default router;
