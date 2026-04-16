// ---------------------------------------------------------------------------
// agentTestFixtures routes — CRUD for test-input fixtures (Feature 2)
// ---------------------------------------------------------------------------
// All routes require authenticate. Subaccount-scoped routes require
// requireSubaccountPermission(AGENTS_EDIT); org-scoped routes require
// requireOrgPermission(AGENTS_EDIT). client_user has no access.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import {
  authenticate,
  requireOrgPermission,
} from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import {
  listFixtures,
  getFixture,
  createFixture,
  updateFixture,
  deleteFixture,
} from '../services/agentTestFixturesService.js';

const router = Router();

// ── Subaccount-scoped: agent fixtures ────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/agents/:targetId/test-fixtures',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, targetId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const fixtures = await listFixtures(req.orgId!, 'agent', targetId, subaccountId);
    res.json({ fixtures });
  })
);

router.post(
  '/api/subaccounts/:subaccountId/agents/:targetId/test-fixtures',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, targetId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { label, inputJson } = req.body as { label: string; inputJson: Record<string, unknown> };
    if (!label || typeof label !== 'string') {
      res.status(400).json({ error: 'label is required' });
      return;
    }
    const fixture = await createFixture({
      orgId: req.orgId!,
      subaccountId,
      scope: 'agent',
      targetId,
      label,
      inputJson: inputJson ?? {},
      createdBy: req.user!.id,
    });
    res.status(201).json({ fixture });
  })
);

// ── Subaccount-scoped: skill fixtures ────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/skills/:targetId/test-fixtures',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, targetId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const fixtures = await listFixtures(req.orgId!, 'skill', targetId, subaccountId);
    res.json({ fixtures });
  })
);

router.post(
  '/api/subaccounts/:subaccountId/skills/:targetId/test-fixtures',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, targetId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { label, inputJson } = req.body as { label: string; inputJson: Record<string, unknown> };
    if (!label || typeof label !== 'string') {
      res.status(400).json({ error: 'label is required' });
      return;
    }
    const fixture = await createFixture({
      orgId: req.orgId!,
      subaccountId,
      scope: 'skill',
      targetId,
      label,
      inputJson: inputJson ?? {},
      createdBy: req.user!.id,
    });
    res.status(201).json({ fixture });
  })
);

// ── Org-scoped: agent fixtures ───────────────────────────────────────────────

router.get(
  '/api/org/agents/:targetId/test-fixtures',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const fixtures = await listFixtures(req.orgId!, 'agent', req.params.targetId);
    res.json({ fixtures });
  })
);

router.post(
  '/api/org/agents/:targetId/test-fixtures',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { label, inputJson } = req.body as { label: string; inputJson: Record<string, unknown> };
    if (!label || typeof label !== 'string') {
      res.status(400).json({ error: 'label is required' });
      return;
    }
    const fixture = await createFixture({
      orgId: req.orgId!,
      subaccountId: null,
      scope: 'agent',
      targetId: req.params.targetId,
      label,
      inputJson: inputJson ?? {},
      createdBy: req.user!.id,
    });
    res.status(201).json({ fixture });
  })
);

// ── Org-scoped: skill fixtures ───────────────────────────────────────────────

router.get(
  '/api/org/skills/:targetId/test-fixtures',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const fixtures = await listFixtures(req.orgId!, 'skill', req.params.targetId);
    res.json({ fixtures });
  })
);

router.post(
  '/api/org/skills/:targetId/test-fixtures',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { label, inputJson } = req.body as { label: string; inputJson: Record<string, unknown> };
    if (!label || typeof label !== 'string') {
      res.status(400).json({ error: 'label is required' });
      return;
    }
    const fixture = await createFixture({
      orgId: req.orgId!,
      subaccountId: null,
      scope: 'skill',
      targetId: req.params.targetId,
      label,
      inputJson: inputJson ?? {},
      createdBy: req.user!.id,
    });
    res.status(201).json({ fixture });
  })
);

// ── Shared: PATCH + DELETE by fixture id ────────────────────────────────────

router.patch(
  '/api/test-fixtures/:fixtureId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { label, inputJson } = req.body as { label?: string; inputJson?: Record<string, unknown> };
    const fixture = await updateFixture(req.orgId!, req.params.fixtureId, { label, inputJson });
    res.json({ fixture });
  })
);

router.delete(
  '/api/test-fixtures/:fixtureId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    await deleteFixture(req.orgId!, req.params.fixtureId);
    res.json({ ok: true });
  })
);

export default router;
