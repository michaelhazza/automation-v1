---
name: Audit SEO
description: Audits a page or content piece for on-page SEO issues and opportunities. Returns a prioritised list of findings with specific recommendations.
isActive: true
visibility: basic
---

## Parameters

- page_url: string — URL of the page to audit (if the page is live)
- page_content: string — Raw page content (HTML or plain text) if the page is not live or URL is not accessible
- target_keyword: string (required) — The primary keyword this page should rank for
- page_type: enum[blog_post, landing_page, product_page, homepage, other] — The type of page being audited
- workspace_context: string — Workspace memory: domain authority context, content strategy, internal link structure overview

## Instructions

Invoke this skill when the Content/SEO Agent needs to evaluate existing content or validate a new draft before publishing. Either `page_url` or `page_content` must be provided — if neither is provided, return an error.

Use `web_search` to look up the live page if `page_url` is provided and the content is not already in context.

Do not fabricate audit findings. Only report issues that are verifiable from the provided content.

### Audit Checklist

**Critical (must fix before publishing):**
- Missing or duplicate title tag
- Missing meta description
- No H1 on the page, or multiple H1 tags
- Target keyword not present in page at all
- Page is not indexable (noindex tag, robots.txt block — note if detectable from content)

**High (fix before publishing, significant ranking impact):**
- Title tag does not include target keyword
- Title tag > 60 characters (SERP truncation)
- Meta description > 155 characters or < 100 characters
- Target keyword not in first 100 words
- Target keyword not in any H2 heading
- No internal links to or from the page
- Content length < 300 words for a page intended to rank

**Medium (improve when possible):**
- Target keyword density < 0.5% or > 2% (stuffed)
- Secondary keywords absent
- No external links to authoritative sources
- Heading hierarchy broken (H3 before H2, etc.)
- Images missing alt text (if detectable in content)

**Low (nice to have):**
- Keyword in URL slug (if URL provided)
- Schema markup present (if detectable)
- FAQ section for long-tail queries

### Scoring

Overall SEO score: 0–100 based on weighted finding severity:
- Critical finding: -20 points each
- High finding: -10 points each
- Medium finding: -5 points each
- Start from 100, floor at 0

### Output Format

```
SEO AUDIT

Page: [url or "provided content"]
Target Keyword: [keyword]
Page Type: [type]
Audit Date: [ISO date]
Overall Score: [0-100]

## Summary

[2-3 sentences: overall state, biggest wins, blocking issues]

## Critical Issues

- [Issue]: [specific detail] → Fix: [specific recommendation]

## High Priority

- [Issue]: [detail] → Fix: [recommendation]

## Medium Priority

- [Issue]: [detail] → Fix: [recommendation]

## Low Priority / Enhancements

- [Issue/opportunity]: [recommendation]

## Quick Wins

[Top 3 fixes that will have the most immediate impact — for when time is limited]

## Notes

[Any assumptions made, elements that could not be verified from the provided content]
```

### Quality Checklist

Before returning:
- Every finding references specific content from the page — no generic observations
- Score is calculated from actual findings, not estimated
- Quick wins are genuinely quick (< 10 minutes each)
- No fabricated findings
