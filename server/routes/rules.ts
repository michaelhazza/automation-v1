import { Router } from 'express';
import { authenticate, requireOrgPermission, hasOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { saveRule } from '../services/ruleCaptureService.js';
import { listRules, patchRule, deprecateRule } from '../services/ruleLibraryService.js';
import { draftCandidates } from '../services/ruleCandidateDrafter.js';
import { listDraftCandidates, approveDraftCandidate, rejectDraftCandidate } from '../services/draftCandidatesService.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { tasks, conversations, conversationMessages } from '../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import type { RuleCaptureRequest, RuleListFilter, RulePatch } from '../../shared/types/briefRules.js';
import type { BriefApprovalCard } from '../../shared/types/briefResultContract.js';

const router = Router();

// POST /api/rules — save a user-triggered rule
router.post(
  '/',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.RULES_WRITE),
  asyncHandler(async (req, res) => {
    const body = req.body as RuleCaptureRequest & { allowConflicts?: boolean };
    const ctx = {
      userId: req.user!.id,
      organisationId: req.orgId!,
    };

    if (body.isAuthoritative) {
      const allowed = await hasOrgPermission(req, ORG_PERMISSIONS.RULES_SET_AUTHORITATIVE);
      if (!allowed) {
        res.status(403).json({ error: 'rules.set_authoritative permission required' });
        return;
      }
    }

    const result = await saveRule(body, ctx, { allowConflicts: body.allowConflicts });
    res.status(result.saved ? 201 : 409).json(result);
  }),
);

// GET /api/rules — list Learned Rules for browsing
router.get(
  '/',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.RULES_READ),
  asyncHandler(async (req, res) => {
    const filter: RuleListFilter = {
      scopeType: req.query.scopeType as RuleListFilter['scopeType'],
      scopeId: req.query.scopeId as string | undefined,
      status: req.query.status as RuleListFilter['status'],
      createdByUserId: req.query.createdByUserId as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
      cursor: req.query.cursor as string | undefined,
    };

    const result = await listRules(filter, req.orgId!);
    res.json(result);
  }),
);

// PATCH /api/rules/:ruleId — edit / pause / resume
router.patch(
  '/:ruleId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.RULES_WRITE),
  asyncHandler(async (req, res) => {
    const patch = req.body as RulePatch;

    if (patch.isAuthoritative !== undefined) {
      const allowed = await hasOrgPermission(req, ORG_PERMISSIONS.RULES_SET_AUTHORITATIVE);
      if (!allowed) {
        res.status(403).json({ error: 'rules.set_authoritative permission required' });
        return;
      }
    }

    const updated = await patchRule(
      req.params.ruleId,
      req.orgId!,
      patch,
      req.user!.id,
    );

    if (!updated) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    res.json(updated);
  }),
);

// DELETE /api/rules/:ruleId — soft-delete (sets deprecated_at)
router.delete(
  '/:ruleId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.RULES_WRITE),
  asyncHandler(async (req, res) => {
    const deleted = await deprecateRule(req.params.ruleId, req.orgId!, 'user_deleted');

    if (!deleted) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    res.status(204).end();
  }),
);

// POST /api/rules/draft-candidates — generate candidate rules from an approval card decision
router.post(
  '/draft-candidates',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE),
  asyncHandler(async (req, res) => {
    const { artefactId, wasApproved } = req.body as { artefactId?: string; wasApproved?: boolean };

    if (!artefactId) {
      res.status(400).json({ error: 'artefactId is required' });
      return;
    }
    if (typeof wasApproved !== 'boolean') {
      res.status(400).json({ error: 'wasApproved is required and must be a boolean' });
      return;
    }

    logger.info('rule.draft_candidates.requested', { event: 'rule.draft_candidates.requested', artefactId, orgId: req.orgId! });

    // conversation_messages, conversations, and tasks are FORCE-RLS — must run
    // inside the request's org-scoped tx so the JSONB scan sees the org's data.
    const tx = getOrgScopedDb('rules.draft-candidates');

    // Org-scoped JSONB scan for the approval card — GIN index (migration 0232) covers this
    const rows = await tx
      .select({ artefacts: conversationMessages.artefacts, briefId: conversations.scopeId })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
      .where(and(
        eq(conversations.organisationId, req.orgId!),
        eq(conversations.scopeType, 'brief'),
        sql`${conversationMessages.artefacts} @> ${JSON.stringify([{ artefactId }])}::jsonb`,
      ));

    let approvalCard: BriefApprovalCard | null = null;
    let briefId: string | null = null;
    let matchCount = 0;

    for (const row of rows) {
      if (!Array.isArray(row.artefacts)) continue;
      for (const a of row.artefacts as Array<Record<string, unknown>>) {
        if (a['artefactId'] !== artefactId) continue;
        matchCount++;
        if (matchCount > 1) {
          logger.error('rule.draft_candidates.collision_detected', {
            event: 'rule.draft_candidates.collision_detected',
            artefactId,
            orgId: req.orgId!,
            matchCount,
          });
          res.status(500).json({ error: 'artefact_id_collision' });
          return;
        }
        if (a['kind'] !== 'approval') {
          res.status(422).json({ error: 'artefact_not_approval' });
          return;
        }
        approvalCard = a as unknown as BriefApprovalCard;
        briefId = row.briefId;
      }
    }

    if (!approvalCard || !briefId) {
      res.status(404).json({ error: 'artefact_not_found' });
      return;
    }

    // Load brief context from task description
    const [task] = await tx
      .select({ description: tasks.description })
      .from(tasks)
      .where(and(eq(tasks.id, briefId), eq(tasks.organisationId, req.orgId!)))
      .limit(1);

    const briefContext = task?.description ?? '';

    // Load top 20 existing rules for deduplication hint in the prompt
    const { rules: existingRelatedRules } = await listRules({ limit: 20 }, req.orgId!);

    const startMs = Date.now();
    let result: Awaited<ReturnType<typeof draftCandidates>>;
    try {
      result = await draftCandidates({
        approvalCard,
        wasApproved,
        briefContext,
        existingRelatedRules: existingRelatedRules.map((r) => ({
          id: r.id,
          text: r.text,
          category: r.scope.kind,
        })),
        organisationId: req.orgId!,
      });
    } catch (err: unknown) {
      logger.error('rule.draft_candidates.failed', {
        event: 'rule.draft_candidates.failed',
        artefactId,
        orgId: req.orgId!,
        error: err instanceof Error ? err.message : String(err),
        status: 'failed',
      });
      res.status(500).json({ error: 'draft_candidates_failed' });
      return;
    }

    logger.info('rule.draft_candidates.returned', {
      event: 'rule.draft_candidates.returned',
      artefactId,
      candidateCount: result.candidates.length,
      latencyMs: Date.now() - startMs,
      status: 'success',
    });

    res.json(result);
  }),
);

// GET /api/rules/draft-candidates — list persisted draft rule candidates for review
router.get(
  '/draft-candidates',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const candidates = await listDraftCandidates(req.orgId!);
    res.json({ data: candidates });
  }),
);

// POST /api/rules/draft-candidates/:id/approve — approve a draft rule candidate
router.post(
  '/draft-candidates/:id/approve',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const result = await approveDraftCandidate(req.params.id, req.orgId!, req.user!.id);
    res.json({ data: result });
  }),
);

// POST /api/rules/draft-candidates/:id/reject — reject a draft rule candidate
router.post(
  '/draft-candidates/:id/reject',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const result = await rejectDraftCandidate(req.params.id, req.orgId!, req.user!.id);
    res.json({ data: result });
  }),
);

export default router;
