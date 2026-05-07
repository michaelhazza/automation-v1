/**
 * Tab-scoped agent endpoints — Consolidation Build C1
 *
 * GET  /api/agents/:id/full                — full aggregated payload with ETag
 * PATCH /api/agents/:id/configure          — configure tab writer
 * PATCH /api/agents/:id/behaviour          — behaviour tab writer
 * PATCH /api/agents/:id/personality        — personality tab writer
 * PUT   /api/agents/:id/skills             — full-replacement skills writer
 * PUT   /api/agents/:id/data-sources       — full-replacement data-sources writer
 * PUT   /api/agents/:id/triggers           — full-replacement triggers writer
 * PATCH /api/agents/:id/budget             — budget tab writer
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../../middleware/auth.js';
import { agentEtagPrecondition } from '../../middleware/agentEtagPrecondition.js';
import { agentService } from '../../services/agentService.js';
import { ORG_PERMISSIONS } from '../../lib/permissions.js';
import { asyncHandler } from '../../lib/asyncHandler.js';

const router = Router();

// ── GET /:id/full ─────────────────────────────────────────────────────────────

router.get(
  '/api/agents/:id/full',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const payload = await agentService.getFull(req.params.id, req.orgId!);
    // isSystemManaged is part of the public AgentFull contract — client uses it for read-only gating.
    res.json(payload);
  }),
);

// ── PATCH /:id/configure ──────────────────────────────────────────────────────

router.patch(
  '/api/agents/:id/configure',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  agentEtagPrecondition,
  asyncHandler(async (req, res) => {
    const result = await agentService.patchConfigure(
      req.params.id,
      req.orgId!,
      req.expectedEtag!,
      req.body,
      { role: req.user?.role },
    );
    res.json(result);
  }),
);

// ── PATCH /:id/behaviour ──────────────────────────────────────────────────────

router.patch(
  '/api/agents/:id/behaviour',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  agentEtagPrecondition,
  asyncHandler(async (req, res) => {
    const result = await agentService.patchBehaviour(
      req.params.id,
      req.orgId!,
      req.expectedEtag!,
      req.body,
      { role: req.user?.role },
    );
    res.json(result);
  }),
);

// ── PATCH /:id/personality ────────────────────────────────────────────────────

router.patch(
  '/api/agents/:id/personality',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  agentEtagPrecondition,
  asyncHandler(async (req, res) => {
    const result = await agentService.patchPersonality(
      req.params.id,
      req.orgId!,
      req.expectedEtag!,
      req.body,
      { role: req.user?.role },
    );
    res.json(result);
  }),
);

// ── PUT /:id/skills ───────────────────────────────────────────────────────────

router.put(
  '/api/agents/:id/skills',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  agentEtagPrecondition,
  asyncHandler(async (req, res) => {
    const force = req.query.force === 'true';
    const result = await agentService.replaceSkills(
      req.params.id,
      req.orgId!,
      req.expectedEtag!,
      req.body,
      { force },
      { role: req.user?.role },
    );
    res.json(result);
  }),
);

// ── PUT /:id/data-sources ─────────────────────────────────────────────────────

router.put(
  '/api/agents/:id/data-sources',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  agentEtagPrecondition,
  asyncHandler(async (req, res) => {
    const force = req.query.force === 'true';
    const result = await agentService.replaceDataSources(
      req.params.id,
      req.orgId!,
      req.expectedEtag!,
      req.body,
      { force },
      { role: req.user?.role },
    );
    res.json(result);
  }),
);

// ── PUT /:id/triggers ─────────────────────────────────────────────────────────

router.put(
  '/api/agents/:id/triggers',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  agentEtagPrecondition,
  asyncHandler(async (req, res) => {
    const force = req.query.force === 'true';
    const result = await agentService.replaceTriggers(
      req.params.id,
      req.orgId!,
      req.expectedEtag!,
      req.body,
      { force },
      { role: req.user?.role },
    );
    res.json(result);
  }),
);

// ── PATCH /:id/budget ─────────────────────────────────────────────────────────

router.patch(
  '/api/agents/:id/budget',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  agentEtagPrecondition,
  asyncHandler(async (req, res) => {
    const result = await agentService.patchBudget(
      req.params.id,
      req.orgId!,
      req.expectedEtag!,
      req.body,
      { role: req.user?.role },
    );
    res.json(result);
  }),
);

export default router;
