import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { configHistoryService } from '../services/configHistoryService.js';
import { boardService } from '../services/boardService.js';
import { subaccountOnboardingService } from '../services/subaccountOnboardingService.js';
import { agentScheduleService } from '../services/agentScheduleService.js';
import { isBaselineSlug } from '../../shared/constants/baselineArtefacts.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { logger } from '../lib/logger.js';
import {
  listSubaccounts,
  createSubaccount,
  updateSubaccount,
  softDeleteSubaccount,
  updateSubaccountSettings,
  listSubaccountCategories,
  createSubaccountCategory,
  getSubaccountCategory,
  updateSubaccountCategory,
  softDeleteSubaccountCategory,
  listSubaccountAutomationLinks,
  listSubaccountNativeAutomations,
  findOrgAutomation,
  createSubaccountAutomationLink,
  getSubaccountAutomationLink,
  updateSubaccountAutomationLink,
  deleteSubaccountAutomationLink,
  listSubaccountMembers,
  findOrgUser,
  findOrgPermissionSet,
  createSubaccountMemberAssignment,
  getSubaccountMemberAssignment,
  updateSubaccountMemberAssignment,
  deleteSubaccountMemberAssignment,
} from '../services/subaccountService.js';

const router = Router();

// ─── Subaccounts CRUD ─────────────────────────────────────────────────────────

/**
 * GET /api/subaccounts
 * List all subaccounts in the user's org.
 */
router.get(
  '/api/subaccounts',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const organisationId = req.orgId!;
    const rows = await listSubaccounts(organisationId);

    res.json(
      rows.map((sa) => ({
        id: sa.id,
        name: sa.name,
        slug: sa.slug,
        status: sa.status,
        settings: sa.settings,
        includeInOrgInbox: sa.includeInOrgInbox,
        isOrgSubaccount: sa.isOrgSubaccount,
        createdAt: sa.createdAt,
        updatedAt: sa.updatedAt,
      }))
    );
  })
);

/**
 * POST /api/subaccounts
 * Create a new subaccount.
 */
router.post(
  '/api/subaccounts',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_CREATE),
  asyncHandler(async (req, res) => {
    const organisationId = req.orgId!;
    // guard-ignore-next-line: input-validation reason="manual field validation enforced: name required check, status type guard, includeInOrgInbox boolean guard"
    const { name, slug, status, settings } = req.body as {
      name?: string;
      slug?: string;
      status?: string;
      settings?: Record<string, unknown>;
    };

    if (!name) {
      res.status(400).json({ error: 'Validation failed', details: 'name is required' });
      return;
    }

    const derivedSlug = slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const sa = await createSubaccount(organisationId, {
      name,
      slug: derivedSlug,
      status: (status as 'active' | 'suspended' | 'inactive') ?? 'active',
      settings: settings ?? null,
    });

    await configHistoryService.recordHistory({
      entityType: 'subaccount', entityId: sa.id, organisationId,
      snapshot: sa as unknown as Record<string, unknown>,
      changedBy: req.user?.id ?? null, changeSource: 'ui',
    });

    // Auto-init board config from org config (if available)
    boardService.initSubaccountBoard(organisationId, sa.id).catch(() => {
      // Non-critical: if org has no board config, skip silently
    });

    // Phase F — spec §10.5: auto-start onboarding playbooks whose templates
    // declare `autoStartOnOnboarding: true`. Enqueued via pg-boss (D-P0-1) so
    // the work runs in its own org-scoped tx — the alternative fire-and-forget
    // direct call would attempt to use the request transaction after it has
    // been committed on res.finish.
    if (req.user?.id) {
      try {
        const { enqueueGhlOnboarding } = await import(
          '../jobs/ghlAutoStartOnboardingJob.js'
        );
        await enqueueGhlOnboarding({
          organisationId,
          subaccountId: sa.id,
          startedByUserId: req.user.id,
        });
      } catch (err) {
        // Non-fatal: subaccount is still created — operator can re-trigger
        // onboarding from the admin UI if the enqueue fails.
        logger.warn('onboarding_auto_start_enqueue_failed', {
          event: 'onboarding.auto_start.enqueue_failed',
          subaccountId: sa.id,
          organisationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Fire-and-forget: schedule the optimiser for the new subaccount.
    // Failure logs but does not block the response (§5.8 pattern).
    if (sa.optimiserEnabled !== false) {
      agentScheduleService.registerOptimiserSchedule(sa.id, organisationId)
        .catch((err) => {
          logger.warn('optimiser_schedule_register_failed', {
            event: 'optimiser.schedule.register_failed',
            subaccountId: sa.id,
            organisationId,
            error: err?.message ?? String(err),
          });
        });
    }

    // F3 §4 — insert initial pending baseline row (inline, synchronous).
    // Must run within the request's org-scoped transaction; fire-and-forget
    // would execute after the tx commits and lose the org context.
    await subaccountOnboardingService.markBaselinePending({
      organisationId,
      subaccountId: sa.id,
    });

    res.status(201).json({
      id: sa.id,
      name: sa.name,
      slug: sa.slug,
      status: sa.status,
      settings: sa.settings,
      createdAt: sa.createdAt,
    });
  })
);

/**
 * GET /api/subaccounts/:subaccountId
 * Get a single subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    res.json(sa);
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId
 * Update a subaccount's name, slug, status or settings.
 */
router.patch(
  '/api/subaccounts/:subaccountId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { name, slug, status, settings, includeInOrgInbox, runRetentionDays } = req.body as {
      name?: string;
      slug?: string;
      status?: string;
      settings?: Record<string, unknown>;
      includeInOrgInbox?: boolean;
      runRetentionDays?: number | null;
    };

    // Guard: org subaccount cannot have its status changed
    if (sa.isOrgSubaccount && status !== undefined && status !== 'active') {
      res.status(403).json({ error: 'Cannot change the status of the organisation workspace' });
      return;
    }

    await configHistoryService.recordHistory({
      entityType: 'subaccount', entityId: sa.id, organisationId: req.orgId!,
      snapshot: sa as unknown as Record<string, unknown>,
      changedBy: req.user?.id ?? null, changeSource: 'ui',
    });

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) update.name = name;
    if (slug !== undefined) update.slug = slug;
    if (status !== undefined) update.status = status;
    if (settings !== undefined) update.settings = settings;
    if (includeInOrgInbox !== undefined) {
      if (typeof includeInOrgInbox !== 'boolean') throw { statusCode: 400, message: 'includeInOrgInbox must be a boolean' };
      update.includeInOrgInbox = includeInOrgInbox;
    }
    if (runRetentionDays !== undefined) {
      if (runRetentionDays !== null && (typeof runRetentionDays !== 'number' || !Number.isInteger(runRetentionDays) || runRetentionDays < 7 || runRetentionDays > 3650)) {
        throw { statusCode: 400, message: 'runRetentionDays must be an integer between 7 and 3650, or null' };
      }
      update.runRetentionDays = runRetentionDays;
    }

    const updated = await updateSubaccount(sa.id, req.orgId!, update);
    res.json(updated);
  })
);

/**
 * DELETE /api/subaccounts/:subaccountId
 * Soft-delete a subaccount.
 */
router.delete(
  '/api/subaccounts/:subaccountId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_DELETE),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);

    if (sa.isOrgSubaccount) {
      res.status(403).json({ error: 'Cannot delete the organisation workspace' });
      return;
    }

    await softDeleteSubaccount(sa.id, req.orgId!);
    res.json({ message: 'Subaccount deleted' });
  })
);

// ─── Dev Execution Context (DEC) ──────────────────────────────────────────────

/**
 * GET /api/subaccounts/:subaccountId/dev-context
 * Return the Dev Execution Context configuration for this subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId/dev-context',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const settings = (sa.settings ?? {}) as Record<string, unknown>;
    res.json({ devContext: settings.devContext ?? null });
  })
);

/**
 * PUT /api/subaccounts/:subaccountId/dev-context
 * Save the Dev Execution Context configuration.
 */
router.put(
  '/api/subaccounts/:subaccountId/dev-context',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { devContext } = req.body as { devContext: Record<string, unknown> };
    const currentSettings = (sa.settings ?? {}) as Record<string, unknown>;
    const newSettings = { ...currentSettings, devContext };

    await updateSubaccountSettings(sa.id, req.orgId!, newSettings);
    res.json({ devContext });
  })
);

// ─── Claude Code availability ─────────────────────────────────────────────────

import { claudeCodeRunner } from '../services/claudeCodeRunner.js';

/**
 * GET /api/subaccounts/:subaccountId/claude-code-status
 * Check if Claude Code CLI is available on this machine.
 */
router.get(
  '/api/subaccounts/:subaccountId/claude-code-status',
  authenticate,
  asyncHandler(async (_req, res) => {
    const status = await claudeCodeRunner.isAvailable();
    res.json(status);
  })
);

// ─── Subaccount categories ────────────────────────────────────────────────────

/**
 * GET /api/subaccounts/:subaccountId/categories
 * List portal categories for a subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId/categories',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const rows = await listSubaccountCategories(req.params.subaccountId);
    res.json(rows);
  })
);

/**
 * POST /api/subaccounts/:subaccountId/categories
 * Create a portal category.
 */
router.post(
  '/api/subaccounts/:subaccountId/categories',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { name, description, colour } = req.body as { name?: string; description?: string; colour?: string };

    if (!name) {
      res.status(400).json({ error: 'Validation failed', details: 'name is required' });
      return;
    }

    const cat = await createSubaccountCategory(req.params.subaccountId, { name, description, colour });
    res.status(201).json(cat);
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId/categories/:categoryId
 * Update a portal category.
 */
router.patch(
  '/api/subaccounts/:subaccountId/categories/:categoryId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { name, description, colour } = req.body as { name?: string; description?: string; colour?: string };

    const cat = await getSubaccountCategory(req.params.categoryId, req.params.subaccountId);
    if (!cat) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (colour !== undefined) update.colour = colour;

    const updated = await updateSubaccountCategory(cat.id, update);
    res.json(updated);
  })
);

/**
 * DELETE /api/subaccounts/:subaccountId/categories/:categoryId
 * Soft-delete a portal category.
 */
router.delete(
  '/api/subaccounts/:subaccountId/categories/:categoryId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const cat = await getSubaccountCategory(req.params.categoryId, req.params.subaccountId);
    if (!cat) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    await softDeleteSubaccountCategory(cat.id);
    res.json({ message: 'Category deleted' });
  })
);

// ─── Subaccount process links ─────────────────────────────────────────────────

/**
 * GET /api/subaccounts/:subaccountId/automations
 * List all automations visible to this subaccount:
 *   - Org automations linked via subaccount_process_links
 *   - Subaccount-native automations (automations.subaccount_id = subaccountId)
 */
router.get(
  '/api/subaccounts/:subaccountId/automations',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const linkedProcesses = await listSubaccountAutomationLinks(req.params.subaccountId);
    const nativeProcesses = await listSubaccountNativeAutomations(req.params.subaccountId);

    res.json({ linkedProcesses, nativeProcesses });
  })
);

/**
 * POST /api/subaccounts/:subaccountId/automations
 * Link an org-level process to this subaccount.
 * Body: { processId, subaccountCategoryId? }
 */
router.post(
  '/api/subaccounts/:subaccountId/automations',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { processId, subaccountCategoryId } = req.body as { processId?: string; subaccountCategoryId?: string };

    if (!processId) {
      res.status(400).json({ error: 'Validation failed', details: 'processId is required' });
      return;
    }

    const process = await findOrgAutomation(processId, req.orgId!);
    if (!process) {
      res.status(404).json({ error: 'Process not found or not accessible' });
      return;
    }

    // Only org-level automations (no subaccount_id) can be linked
    if (process.subaccountId !== null) {
      res.status(400).json({ error: 'Subaccount-native automations cannot be linked; they already belong to a subaccount' });
      return;
    }

    const link = await createSubaccountAutomationLink({
      subaccountId: req.params.subaccountId,
      processId,
      subaccountCategoryId,
    });

    res.status(201).json(link);
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId/automations/:linkId
 * Update a process link (toggle isActive, change category).
 */
router.patch(
  '/api/subaccounts/:subaccountId/automations/:linkId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { isActive, subaccountCategoryId } = req.body as { isActive?: boolean; subaccountCategoryId?: string | null };

    const link = await getSubaccountAutomationLink(req.params.linkId, req.params.subaccountId);
    if (!link) {
      res.status(404).json({ error: 'Process link not found' });
      return;
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (isActive !== undefined) update.isActive = isActive;
    if (subaccountCategoryId !== undefined) update.subaccountCategoryId = subaccountCategoryId;

    const updated = await updateSubaccountAutomationLink(link.id, update);
    res.json(updated);
  })
);

/**
 * DELETE /api/subaccounts/:subaccountId/automations/:linkId
 * Remove a process link from this subaccount.
 */
router.delete(
  '/api/subaccounts/:subaccountId/automations/:linkId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const link = await getSubaccountAutomationLink(req.params.linkId, req.params.subaccountId);
    if (!link) {
      res.status(404).json({ error: 'Process link not found' });
      return;
    }

    await deleteSubaccountAutomationLink(link.id);
    res.json({ message: 'Process link removed' });
  })
);

// ─── Subaccount members ───────────────────────────────────────────────────────

/**
 * GET /api/subaccounts/:subaccountId/members
 * List users assigned to this subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId/members',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const rows = await listSubaccountMembers(req.params.subaccountId);
    res.json(rows);
  })
);

/**
 * POST /api/subaccounts/:subaccountId/members
 * Assign a user to this subaccount with a permission set.
 * Body: { userId, permissionSetId }
 */
router.post(
  '/api/subaccounts/:subaccountId/members',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { userId, permissionSetId } = req.body as { userId?: string; permissionSetId?: string };

    if (!userId || !permissionSetId) {
      res.status(400).json({ error: 'Validation failed', details: 'userId and permissionSetId are required' });
      return;
    }

    const user = await findOrgUser(userId, sa.organisationId);
    if (!user) {
      res.status(404).json({ error: 'User not found in this organisation' });
      return;
    }

    const ps = await findOrgPermissionSet(permissionSetId, sa.organisationId);
    if (!ps) {
      res.status(404).json({ error: 'Permission set not found in this organisation' });
      return;
    }

    const assignment = await createSubaccountMemberAssignment({
      subaccountId: req.params.subaccountId,
      userId,
      permissionSetId,
    });

    res.status(201).json(assignment);
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId/members/:userId
 * Update a member's permission set.
 * Body: { permissionSetId }
 */
router.patch(
  '/api/subaccounts/:subaccountId/members/:userId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { permissionSetId } = req.body as { permissionSetId?: string };

    if (!permissionSetId) {
      res.status(400).json({ error: 'Validation failed', details: 'permissionSetId is required' });
      return;
    }

    const assignment = await getSubaccountMemberAssignment(req.params.subaccountId, req.params.userId);
    if (!assignment) {
      res.status(404).json({ error: 'Member assignment not found' });
      return;
    }

    const ps = await findOrgPermissionSet(permissionSetId, sa.organisationId);
    if (!ps) {
      res.status(404).json({ error: 'Permission set not found in this organisation' });
      return;
    }

    const updated = await updateSubaccountMemberAssignment(assignment.id, permissionSetId);
    res.json(updated);
  })
);

/**
 * DELETE /api/subaccounts/:subaccountId/members/:userId
 * Remove a user's access to this subaccount.
 */
router.delete(
  '/api/subaccounts/:subaccountId/members/:userId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const assignment = await getSubaccountMemberAssignment(req.params.subaccountId, req.params.userId);
    if (!assignment) {
      res.status(404).json({ error: 'Member assignment not found' });
      return;
    }

    await deleteSubaccountMemberAssignment(assignment.id);
    res.json({ message: 'Member removed from subaccount' });
  })
);

// ─── Baseline artefacts (F1 §4A) ─────────────────────────────────────────────

/**
 * GET /api/subaccounts/:subaccountId/baseline-artefacts-status
 * Read the current baseline_artefacts_status JSONB blob for a sub-account.
 */
router.get(
  '/api/subaccounts/:subaccountId/baseline-artefacts-status',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    res.json({ status: sa.baselineArtefactsStatus });
  })
);

/**
 * POST /api/subaccounts/:subaccountId/baseline-artefacts/started
 * Emit a telemetry event when the user opens a capture step.
 * Body: { slug: string }
 */
router.post(
  '/api/subaccounts/:subaccountId/baseline-artefacts/started',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { slug } = req.body as { slug?: string };
    if (!slug || !isBaselineSlug(slug)) {
      res.status(400).json({
        error: 'Invalid baseline slug',
        errorCode: 'INVALID_BASELINE_SLUG',
      });
      return;
    }
    subaccountOnboardingService.recordArtefactStarted({
      subaccountId: sa.id,
      organisationId: req.orgId!,
      slug,
      userId: req.user!.id,
    });
    res.json({ ok: true });
  })
);

/**
 * POST /api/subaccounts/:subaccountId/baseline-artefacts/:slug/skip
 * Skip a Tier-3 baseline artefact. Tier-1 and Tier-2 slugs return 400.
 * Body: { reason: 'defer_for_later' | 'not_applicable' }
 */
router.post(
  '/api/subaccounts/:subaccountId/baseline-artefacts/:slug/skip',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { slug } = req.params;
    const { reason } = req.body as { reason?: string };
    if (!reason || (reason !== 'defer_for_later' && reason !== 'not_applicable')) {
      res.status(400).json({ error: 'Validation failed', details: 'reason must be defer_for_later or not_applicable' });
      return;
    }
    await subaccountOnboardingService.markArtefactSkipped({
      organisationId: req.orgId!,
      subaccountId: sa.id,
      slug,
      userId: req.user!.id,
      reason,
    });
    res.json({ ok: true });
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId/baseline-artefacts/:slug
 * Edit the content of a completed baseline artefact.
 * Body: { payload: Record<string, unknown> }
 */
router.patch(
  '/api/subaccounts/:subaccountId/baseline-artefacts/:slug',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { slug } = req.params;
    const { payload } = req.body as { payload?: Record<string, unknown> };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      res.status(400).json({ error: 'Validation failed', details: 'payload must be an object' });
      return;
    }
    await subaccountOnboardingService.markArtefactEdited({
      organisationId: req.orgId!,
      subaccountId: sa.id,
      slug,
      userId: req.user!.id,
      payload,
    });
    res.json({ ok: true });
  })
);

export default router;
