// server/routes/scorecards.ts
// Scorecard CRUD + share-toggle + duplicate.
// Trust & Verification Layer spec §12.1, §12.2.

import { Router, Request } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { scorecardService } from '../services/scorecardService.js';
import { compressSourcePill } from '../services/scorecardServicePure.js';
import {
  createScorecardBody,
  updateScorecardBody,
  shareToggleBody,
  duplicateScorecardBody,
} from '../schemas/scorecards.js';
import type { Scorecard } from '../db/schema/scorecards.js';

const router = Router();

// ── Determine viewer context from request ────────────────────────────────────

// Org-scoped routes (requireOrgPermission gate) treat all callers as org_admin
// visibility so the full org library is returned. Subaccount-scoped visibility
// is served via /api/subaccounts/:id/scorecards which uses viewerScope='subaccount'.
function viewerScope(req: Request): 'system_admin' | 'org_admin' {
  const role = req.user?.role;
  if (role === 'system_admin') return 'system_admin';
  return 'org_admin';
}

function withSourcePills(
  cards: Scorecard[],
  scope: 'system_admin' | 'org_admin' | 'subaccount',
) {
  if (scope === 'system_admin') return cards;
  const pillScope: 'org_admin' | 'subaccount' = scope === 'org_admin' ? 'org_admin' : 'subaccount';
  return cards.map(sc => ({
    ...sc,
    sourcePill: compressSourcePill(sc.scopeType as 'system' | 'org' | 'subaccount', pillScope),
  }));
}

// ── Staff-only validator field guard ─────────────────────────────────────────
//
// Spec §1 / §10.1 — the deterministic-validator quality-check fields
// (kind, validatorSlug, validatorParameters, preconditionSlugs,
// preconditionParameters, safetyClass) are admin-gated (Synthetos staff only).
// The UI hides the editor unless the viewer is system_admin. The server-side
// /api/validators route is gated by requireSystemAdmin. The scorecard
// create/update Zod schema currently accepts these fields for any caller with
// SCORECARDS_MANAGE, so a non-staff org_admin posting JSON directly could
// configure validators or safety-class flags. Reject (rather than silently
// strip) when a non-staff caller submits any of these fields — silent
// stripping in a PATCH flow would erase staff-set values on the existing row
// (Codex review iteration 3, 2026-05-19). The non-staff UI never sends these
// fields, so well-formed UI requests pass through trivially; only direct API
// users that include them trip the guard.
const STAFF_ONLY_QC_FIELDS = [
  'kind',
  'validatorSlug',
  'validatorParameters',
  'preconditionSlugs',
  'preconditionParameters',
  'safetyClass',
] as const;

function hasMeaningfulValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'boolean') return v === true;
  return true;
}

/**
 * Returns the name of the first staff-only field a non-staff caller submitted
 * with a meaningful value, or null if the request is safe.
 */
function findStaffOnlyFieldViolation(body: unknown, role: string | undefined): string | null {
  if (role === 'system_admin') return null;
  if (!body || typeof body !== 'object') return null;
  const b = body as { qualityChecks?: unknown };
  if (!Array.isArray(b.qualityChecks)) return null;
  for (const qc of b.qualityChecks) {
    if (!qc || typeof qc !== 'object') continue;
    const q = qc as Record<string, unknown>;
    for (const field of STAFF_ONLY_QC_FIELDS) {
      if (hasMeaningfulValue(q[field])) return field;
    }
  }
  return null;
}

// ── GET /api/scorecards ───────────────────────────────────────────────────────

router.get(
  '/api/scorecards',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_VIEW),
  asyncHandler(async (req, res) => {
    const scope = viewerScope(req);
    const cards = await scorecardService.list({
      viewerScope: scope,
      orgId: req.orgId!,
      subaccountId: null,
    });
    res.json({ scorecards: withSourcePills(cards, scope), sourcePillCompressed: true });
  }),
);

// ── POST /api/scorecards ─────────────────────────────────────────────────────

router.post(
  '/api/scorecards',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_MANAGE),
  validateBody(createScorecardBody, 'enforce'),
  asyncHandler(async (req, res) => {
    const violation = findStaffOnlyFieldViolation(req.body, req.user?.role);
    if (violation) {
      res.status(403).json({ error: `Field "${violation}" on quality checks is staff-only` });
      return;
    }
    const card = await scorecardService.create(req.body, 'org', req.orgId!, req.orgId!);
    res.status(201).json(card);
  }),
);

// ── GET /api/scorecards/:id ──────────────────────────────────────────────────

router.get(
  '/api/scorecards/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_VIEW),
  asyncHandler(async (req, res) => {
    const card = await scorecardService.getById(req.params.id);
    if (!card || card.deletedAt) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(card);
  }),
);

// ── PATCH /api/scorecards/:id ────────────────────────────────────────────────

router.patch(
  '/api/scorecards/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_MANAGE),
  validateBody(updateScorecardBody, 'enforce'),
  asyncHandler(async (req, res) => {
    const violation = findStaffOnlyFieldViolation(req.body, req.user?.role);
    if (violation) {
      res.status(403).json({ error: `Field "${violation}" on quality checks is staff-only` });
      return;
    }
    const card = await scorecardService.update(req.params.id, req.body);
    res.json(card);
  }),
);

// ── DELETE /api/scorecards/:id ───────────────────────────────────────────────

router.delete(
  '/api/scorecards/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_MANAGE),
  asyncHandler(async (req, res) => {
    await scorecardService.delete(req.params.id);
    res.status(204).end();
  }),
);

// ── POST /api/scorecards/:id/duplicate ──────────────────────────────────────

router.post(
  '/api/scorecards/:id/duplicate',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_MANAGE),
  validateBody(duplicateScorecardBody, 'enforce'),
  asyncHandler(async (req, res) => {
    const card = await scorecardService.duplicate(req.params.id, req.body, req.orgId!);
    res.status(201).json(card);
  }),
);

// ── POST /api/scorecards/:id/share-toggle ────────────────────────────────────

router.post(
  '/api/scorecards/:id/share-toggle',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_MANAGE),
  validateBody(shareToggleBody, 'enforce'),
  asyncHandler(async (req, res) => {
    const card = await scorecardService.toggleShareWithSubaccounts(req.params.id, req.body.shareWithSubaccounts);
    res.json(card);
  }),
);

// ── Subaccount-scoped scorecard routes ───────────────────────────────────────
// GET /api/subaccounts/:subaccountId/scorecards
// POST /api/subaccounts/:subaccountId/scorecards

router.get(
  '/api/subaccounts/:subaccountId/scorecards',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SCORECARDS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const cards = await scorecardService.list({
      viewerScope: 'subaccount',
      orgId: req.orgId!,
      subaccountId,
    });
    res.json({ scorecards: withSourcePills(cards, 'subaccount'), sourcePillCompressed: true });
  }),
);

router.post(
  '/api/subaccounts/:subaccountId/scorecards',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SCORECARDS_MANAGE),
  validateBody(createScorecardBody, 'enforce'),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const violation = findStaffOnlyFieldViolation(req.body, req.user?.role);
    if (violation) {
      res.status(403).json({ error: `Field "${violation}" on quality checks is staff-only` });
      return;
    }
    const card = await scorecardService.create(req.body, 'subaccount', subaccountId, req.orgId!);
    res.status(201).json(card);
  }),
);

export default router;
