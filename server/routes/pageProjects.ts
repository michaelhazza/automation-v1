import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { pageProjectService } from '../services/pageProjectService.js';

const router = Router();

/**
 * GET /api/subaccounts/:subaccountId/page-projects
 * List all page projects for a subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId/page-projects',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const rows = await pageProjectService.list(subaccountId, req.orgId!);
    res.json(rows);
  })
);

/**
 * GET /api/subaccounts/:subaccountId/page-projects/:projectId
 * Get a single page project.
 */
router.get(
  '/api/subaccounts/:subaccountId/page-projects/:projectId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, projectId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const project = await pageProjectService.getById(projectId, subaccountId, req.orgId!);
    if (!project) throw { statusCode: 404, message: 'Page project not found' };

    res.json(project);
  })
);

/**
 * POST /api/subaccounts/:subaccountId/page-projects
 * Create a page project.
 */
router.post(
  '/api/subaccounts/:subaccountId/page-projects',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const { name, slug, theme, customDomain, githubRepo } = req.body as {
      name?: string;
      slug?: string;
      theme?: Record<string, unknown>;
      customDomain?: string;
      githubRepo?: string;
    };

    if (!name?.trim()) throw { statusCode: 400, message: 'name is required' };
    if (!slug?.trim()) throw { statusCode: 400, message: 'slug is required' };

    const project = await pageProjectService.create({
      organisationId: req.orgId!,
      subaccountId,
      name: name.trim(),
      slug: slug.trim(),
      theme: theme ?? null,
      customDomain: customDomain?.trim() || null,
      githubRepo: githubRepo?.trim() || null,
    });

    res.status(201).json(project);
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId/page-projects/:projectId
 * Update a page project.
 */
router.patch(
  '/api/subaccounts/:subaccountId/page-projects/:projectId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId, projectId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const { name, slug, theme, customDomain, githubRepo } = req.body as {
      name?: string;
      slug?: string;
      theme?: Record<string, unknown>;
      customDomain?: string;
      githubRepo?: string;
    };

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (slug !== undefined) updates.slug = slug.trim();
    if (theme !== undefined) updates.theme = theme;
    if (customDomain !== undefined) updates.customDomain = customDomain?.trim() || null;
    if (githubRepo !== undefined) updates.githubRepo = githubRepo?.trim() || null;

    const updated = await pageProjectService.update(projectId, subaccountId, req.orgId!, updates);
    res.json(updated);
  })
);

/**
 * DELETE /api/subaccounts/:subaccountId/page-projects/:projectId
 * Soft-delete a page project.
 */
router.delete(
  '/api/subaccounts/:subaccountId/page-projects/:projectId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId, projectId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    await pageProjectService.softDelete(projectId, subaccountId, req.orgId!);
    res.json({ success: true });
  })
);

export default router;
