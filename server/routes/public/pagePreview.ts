/**
 * Public page preview route.
 *
 * GET /preview/:pageSlug — serves a draft or published page with a
 * preview banner, no tracking, and no-cache headers.  Requires a valid
 * JWT preview token in the `token` query parameter.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { pageService } from '../../services/pageService.js';
import type { Page } from '../../db/schema/pages.js';
import type { PageProject } from '../../db/schema/pageProjects.js';
import { previewTokenService } from '../../lib/previewTokenService.js';

const router = Router();

// ─── CSP header ────────────────────────────────────────────────────────────────

const CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "frame-src https://link.msgsndr.com https://js.stripe.com https://buy.stripe.com https://www.youtube.com https://player.vimeo.com https://calendly.com",
  "connect-src 'self'",
  "script-src 'self' https://js.stripe.com 'unsafe-inline'",
].join('; ');

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
    theme.primaryColor ? `--color-primary: ${sanitizeCssValue(theme.primaryColor)};` : '',
    theme.secondaryColor ? `--color-secondary: ${sanitizeCssValue(theme.secondaryColor)};` : '',
    theme.fontHeading ? `--font-heading: ${sanitizeCssValue(theme.fontHeading)};` : '',
    theme.fontBody ? `--font-body: ${sanitizeCssValue(theme.fontBody)};` : '',
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

function sanitizeCssValue(val: string): string {
  return val.replace(/[{};@<>"'\\]/g, '');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Route: preview page ───────────────────────────────────────────────────────

router.get('/preview/:pageSlug', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.resolvedPageProject) {
    return next();
  }

  const token = req.query.token as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Preview token required' });
    return;
  }

  const project = req.resolvedPageProject;
  const payload = previewTokenService.verify(token);

  if (payload.projectId !== project.id) {
    res.status(401).json({ error: 'Token does not match this project' });
    return;
  }

  const { pageSlug } = req.params;
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
      'Content-Security-Policy': CSP,
    })
    .send(html);
}));

export default router;
