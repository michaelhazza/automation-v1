/**
 * Public page serving routes.
 *
 * Catches GET * requests where subdomain resolution has attached a
 * resolvedPageProject and serves the published page HTML with full
 * document shell, caching, CSP headers, and analytics tracking script.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { pageService } from '../../services/pageService.js';
import type { Page } from '../../db/schema/pages.js';
import type { PageProject } from '../../db/schema/pageProjects.js';

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

// ─── Tracking script template ──────────────────────────────────────────────────

function buildTrackingScript(pageId: string): string {
  return `
<script data-page-id="${pageId}">
(function(){
  var PAGE_ID = document.currentScript.getAttribute('data-page-id');
  function getSessionId(){
    var sid = null;
    try {
      var match = document.cookie.match(/(^|;\\s*)__s_sid=([^;]+)/);
      if(match) sid = match[2];
    } catch(e){}
    if(!sid){
      try { sid = localStorage.getItem('__s_sid'); } catch(e){}
    }
    if(!sid){
      sid = 'ses_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
    try {
      var d = new Date();
      d.setDate(d.getDate() + 30);
      document.cookie = '__s_sid=' + sid + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
    } catch(e){}
    try { localStorage.setItem('__s_sid', sid); } catch(e){}
    return sid;
  }
  var sessionId = getSessionId();
  window.__sessionId = sessionId;
  var params = new URLSearchParams(window.location.search);
  var body = {
    pageId: PAGE_ID,
    sessionId: sessionId,
    referrer: document.referrer || null,
    utmSource: params.get('utm_source'),
    utmMedium: params.get('utm_medium'),
    utmCampaign: params.get('utm_campaign'),
    utmTerm: params.get('utm_term'),
    utmContent: params.get('utm_content')
  };
  try {
    fetch('/api/public/track', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body),
      keepalive: true
    });
  } catch(e){}
})();
</script>`;
}

// ─── Page shell builder ────────────────────────────────────────────────────────

function buildPageShell(page: Page, project: PageProject, opts?: { trackingScript?: string }): string {
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

  const metaTags = [
    meta.title
      ? `<meta property="og:title" content="${escapeAttr(meta.title)}">`
      : '',
    meta.description
      ? `<meta name="description" content="${escapeAttr(meta.description)}"><meta property="og:description" content="${escapeAttr(meta.description)}">`
      : '',
    meta.ogImage
      ? `<meta property="og:image" content="${escapeAttr(meta.ogImage)}">`
      : '',
    meta.canonicalUrl
      ? `<link rel="canonical" href="${escapeAttr(meta.canonicalUrl)}">`
      : '',
    meta.noIndex ? '<meta name="robots" content="noindex">' : '',
  ]
    .filter(Boolean)
    .join('\n    ');

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
    <title>${escapeHtml(pageTitle)}</title>
    ${favicon}
    ${headingFont}
    ${bodyFont}
    ${metaTags}
    <style>:root { ${cssVars} }</style>
</head>
<body>
${page.html ?? ''}
${opts?.trackingScript ?? ''}
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

// ─── Route: serve published pages ──────────────────────────────────────────────

router.get('*', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.resolvedPageProject) {
    return next();
  }
  if (req.path.startsWith('/preview/') || req.path.startsWith('/api/')) {
    return next();
  }

  const pageSlug = req.resolvedPageSlug ?? 'index';
  const project = req.resolvedPageProject;

  const page = await pageService.getPublishedBySlug(project.id, pageSlug);
  if (!page) {
    res.status(404).send('Page not found');
    return;
  }

  const etag = `"${page.id}-${page.updatedAt.getTime()}"`;
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  const html = buildPageShell(page, project, {
    trackingScript: buildTrackingScript(page.id),
  });

  res
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      ETag: etag,
      'Cache-Control': 'public, max-age=300',
      'Last-Modified': page.updatedAt.toUTCString(),
      'Content-Security-Policy': CSP,
    })
    .send(html);
}));

export default router;
