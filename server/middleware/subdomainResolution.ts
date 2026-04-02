/**
 * Subdomain resolution middleware for page serving.
 *
 * Parses the incoming hostname against PAGES_BASE_DOMAIN and resolves
 * the corresponding page project + page slug, attaching them to the request.
 *
 * URL patterns:
 *   projectslug.synthetos.ai              -> project homepage (page slug "index")
 *   projectslug.synthetos.ai/pricing      -> website page
 *   pageslug--projectslug.synthetos.ai    -> landing page (flat subdomain)
 */

import { Request, Response, NextFunction } from 'express';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { pageProjects, subaccounts } from '../db/schema/index.js';
import type { PageProject } from '../db/schema/pageProjects.js';

declare global {
  namespace Express {
    interface Request {
      resolvedPageProject?: PageProject;
      resolvedPageSlug?: string;
      resolvedProjectSlug?: string;
    }
  }
}

const PAGES_BASE_DOMAIN = process.env.PAGES_BASE_DOMAIN ?? 'synthetos.ai';

export const subdomainResolution = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const hostname = req.hostname;
    const suffix = `.${PAGES_BASE_DOMAIN}`;

    // Only handle requests to *.PAGES_BASE_DOMAIN
    if (!hostname.endsWith(suffix)) {
      return next();
    }

    // Extract the subdomain part (everything before .synthetos.ai)
    const subdomain = hostname.slice(0, -suffix.length);
    if (!subdomain) {
      return next();
    }

    let projectSlug: string;
    let pageSlug: string;

    if (subdomain.includes('--')) {
      // Landing page pattern: pageslug--projectslug
      const separatorIndex = subdomain.indexOf('--');
      pageSlug = subdomain.slice(0, separatorIndex);
      projectSlug = subdomain.slice(separatorIndex + 2);
    } else {
      // Website pattern: projectslug with page slug from URL path
      projectSlug = subdomain;
      const pathSegment = req.path.replace(/^\//, '').replace(/\/$/, '');
      pageSlug = pathSegment || 'index';
    }

    if (!projectSlug) {
      return next();
    }

    // Look up project by slug where not deleted
    const [project] = await db
      .select()
      .from(pageProjects)
      .where(
        and(
          eq(pageProjects.slug, projectSlug),
          isNull(pageProjects.deletedAt),
        ),
      );

    if (!project) {
      return next();
    }

    // Verify the subaccount is active
    const [subaccount] = await db
      .select({ status: subaccounts.status })
      .from(subaccounts)
      .where(eq(subaccounts.id, project.subaccountId));

    if (!subaccount || subaccount.status !== 'active') {
      return next();
    }

    // Attach resolved context to the request
    req.resolvedPageProject = project;
    req.resolvedProjectSlug = projectSlug;
    req.resolvedPageSlug = pageSlug;

    next();
  } catch (err) {
    next(err);
  }
};
