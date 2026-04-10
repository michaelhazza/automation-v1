---
name: Create Page
description: Create a new page in a page project. The page starts as a draft.
isActive: true
visibility: basic
---

## Parameters

- projectId: string (required) — ID of the page project to create the page in
- slug: string (required) — URL slug for the page (lowercase, hyphens only)
- pageType: enum[website, landing] (required) — Type of page: 'website' for general content, 'landing' for conversion-focused pages
- title: string — Page title (used in <title> tag and meta)
- html: string (required) — HTML content for the page body
- meta: string — JSON object. SEO and social meta fields (title, description, ogImage, etc.)
- formConfig: string — JSON object. Optional form configuration for lead capture on landing pages

## Instructions

Create pages that are well-structured, accessible, and optimised for their purpose. HTML is sanitized automatically — focus on clean semantic markup rather than worrying about XSS.

### Page Creation Checklist
1. **Choose the right page type**: Use "landing" for single-purpose conversion pages. Use "website" for general content pages.
2. **Pick a descriptive slug**: Short, lowercase, hyphen-separated. The slug forms the URL path.
3. **Write clean HTML**: Use semantic elements (`<section>`, `<h1>`, `<p>`, etc.). Inline styles or Tailwind classes are fine.
4. **Set meta fields**: Always include at least `title` and `description` for SEO.
5. **Add form config for landing pages**: If the page collects leads, include `formConfig` with field definitions.

### Decision Rules
- **Page starts as draft**: It will not be publicly accessible until explicitly published.
- **Preview URL is returned**: Use the preview URL to review the page before publishing.
- **One page per slug per project**: Slugs must be unique within a project.
- **Sanitization is automatic**: Script tags and event handlers are stripped. Do not rely on inline JS.
