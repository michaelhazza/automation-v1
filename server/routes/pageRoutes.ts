import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { pageProjectService } from '../services/pageProjectService.js';
import { pageService } from '../services/pageService.js';

const router = Router();

/**
 * Resolve subaccount and verify project belongs to it.
 * Returns the project record.
 */
async function resolveProject(subaccountId: string, orgId: string, projectId: string) {
  await resolveSubaccount(subaccountId, orgId);
  const project = await pageProjectService.getById(projectId, subaccountId, orgId);
  if (!project) throw { statusCode: 404, message: 'Page project not found' };
  return project;
}

/**
 * GET /api/subaccounts/:subaccountId/page-projects/:projectId/pages
 * List all pages in a project.
 */
router.get(
  '/api/subaccounts/:subaccountId/page-projects/:projectId/pages',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, projectId } = req.params;
    await resolveProject(subaccountId, req.orgId!, projectId);

    const rows = await pageService.list(projectId);
    res.json(rows);
  })
);

/**
 * POST /api/subaccounts/:subaccountId/page-projects/:projectId/pages
 * Create a page.
 */
router.post(
  '/api/subaccounts/:subaccountId/page-projects/:projectId/pages',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId, projectId } = req.params;
    const project = await resolveProject(subaccountId, req.orgId!, projectId);

    const { slug, pageType, title, html, meta, formConfig } = req.body as {
      slug?: string;
      pageType?: 'website' | 'landing';
      title?: string;
      html?: string;
      meta?: Record<string, unknown>;
      formConfig?: Record<string, unknown>;
    };

    if (!slug?.trim()) throw { statusCode: 400, message: 'slug is required' };
    if (!pageType) throw { statusCode: 400, message: 'pageType is required' };
    if (!['website', 'landing'].includes(pageType)) {
      throw { statusCode: 400, message: 'pageType must be "website" or "landing"' };
    }

    const page = await pageService.create(
      {
        projectId,
        slug: slug.trim(),
        pageType,
        title: title?.trim(),
        html,
        meta,
        formConfig,
      },
      project.slug
    );

    res.status(201).json(page);
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId/page-projects/:projectId/pages/:pageId
 * Update a page.
 */
router.patch(
  '/api/subaccounts/:subaccountId/page-projects/:projectId/pages/:pageId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId, projectId, pageId } = req.params;
    const project = await resolveProject(subaccountId, req.orgId!, projectId);

    const { html, meta, formConfig, changeNote } = req.body as {
      html?: string;
      meta?: Record<string, unknown>;
      formConfig?: Record<string, unknown>;
      changeNote?: string;
    };

    const updated = await pageService.update(
      pageId,
      projectId,
      { html, meta, formConfig, changeNote },
      project.slug
    );

    res.json(updated);
  })
);

/**
 * POST /api/subaccounts/:subaccountId/page-projects/:projectId/pages/:pageId/publish
 * Publish a page.
 */
router.post(
  '/api/subaccounts/:subaccountId/page-projects/:projectId/pages/:pageId/publish',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId, projectId, pageId } = req.params;
    await resolveProject(subaccountId, req.orgId!, projectId);

    const published = await pageService.publish(pageId, projectId);
    res.json(published);
  })
);

export default router;
