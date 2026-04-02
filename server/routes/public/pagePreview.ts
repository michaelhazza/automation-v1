/**
 * Public page preview route.
 *
 * GET /preview/:pageSlug — serves a draft or published page with a
 * preview banner, no tracking, and no-cache headers.  Requires a valid
 * JWT preview token in the `token` query parameter.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { pageService } from '../../services/pageService.js';
import type { Page } from '../../db/schema/pages.js';
import type { PageProject } from '../../db/schema/pageProjects.js';
import { previewTokenService } from '../../lib/previewTokenService.js';

const router = Router();

// ─── Preview banner ────────────────────────────────────────────────────────────

const PREVIEW_BANNER = `
<div style="position:fixed;top:0;left:0;right:0;z-index:999999;background:#f59e0b;color:#000;text-align:center;padding:8px 16px;font-family:system-ui,sans-serif;font-weight:600;font-size:14px;">
  PREVIEW &mdash; NOT LIVE
</div>
<div style="height:40px;"></div>`;

// ─── Page shell builder (preview variant — no tracking, no forms) ──────────────

function buildPreviewShell(page: Page, project: PageProject): string {
  const theme = project.theme ?? {};
  const meta = page.meta ?? {};

  const cssVars = [
    theme.primaryColor ? `--color-primary: ${theme.primaryColor};` : '',
    theme.secondaryColor ? `--color-secondary: ${theme.secondaryColor};` : '',
    theme.fontHeading ? `--font-heading: ${theme.fontHeading};` : '',
    theme.fontBody ? `--font-body: ${theme.fontBody};` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const headingFont = theme.fontHeading
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.fontHeading)}&display=swap" rel="stylesheet">`
    : '';
  const bodyFont =
    theme.fontBody && theme.fontBody !== theme.fontHeading
      ? `<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.fontBody)}&display=swap" rel="stylesheet">`
      : '';

  const favicon = theme.faviconUrl
    ? `<link rel="icon" href="${escapeAttr(theme.faviconUrl)}">`
    : '';

  const pageTitle = meta.title || page.title || project.name;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>[Preview] ${escapeHtml(pageTitle)}</title>
    ${favicon}
    ${headingFont}
    ${bodyFont}
    <meta name="robots" content="noindex">
    <style>:root { ${cssVars} }</style>
</head>
<body>
${PREVIEW_BANNER}
${page.html ?? ''}
</body>
</html>`;
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Route: preview page ───────────────────────────────────────────────────────

router.get('/preview/:pageSlug', async (req: Request, res: Response, next: NextFunction) => {
  // Only handle requests resolved by subdomain middleware
  if (!req.resolvedPageProject) {
    return next();
  }

  const token = req.query.token as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Preview token required' });
    return;
  }

  const project = req.resolvedPageProject;

  try {
    const payload = previewTokenService.verify(token);

    // Ensure the token was issued for this project
    if (payload.projectId !== project.id) {
      res.status(401).json({ error: 'Token does not match this project' });
      return;
    }

    const { pageSlug } = req.params;

    // Look up page by slug + projectId + pageId (no status filter — serves drafts)
    const page = await pageService.getForPreview(payload.pageId, project.id, pageSlug);

    if (!page) {
      res.status(404).send('Page not found');
      return;
    }

    const html = buildPreviewShell(page, project);

    res
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      })
      .send(html);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const typed = err as { statusCode: number; message: string };
      res.status(typed.statusCode).json({ error: typed.message });
      return;
    }
    next(err);
  }
});

export default router;
