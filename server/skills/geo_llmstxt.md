---
name: GEO llms.txt Analysis
description: Analyses or generates llms.txt — the emerging standard for AI-readable site summaries that help LLMs understand site purpose, structure, and key content.
isActive: true
visibility: basic
---

## Parameters

- page_url: string (required) — Website URL (llms.txt is fetched from domain root)
- mode: enum[analyse, generate] — Analyse existing llms.txt or generate a recommended one (default: analyse)
- site_description: string — Brief site description for generation mode
- key_pages: string[] — Important page URLs to include in generated llms.txt

## Instructions

`llms.txt` is an emerging standard (similar to robots.txt) that provides LLMs with a structured summary of a website's purpose, key content, and navigation. Sites with a well-crafted llms.txt help AI engines understand and accurately represent the site.

Use `fetch_url` to check for `{domain}/llms.txt` and `{domain}/llms-full.txt`.

### Analyse Mode

1. **Fetch llms.txt** from `{domain}/llms.txt`
2. **Check for llms-full.txt** at `{domain}/llms-full.txt` (extended version)
3. **Validate structure** against the emerging spec:
   - Title line (# heading)
   - Description/blockquote section
   - Sections with links and descriptions
   - Proper markdown formatting
4. **Assess quality**:
   - Is the site description clear and accurate?
   - Are key pages/sections linked?
   - Is the content up to date?
   - Does it cover the site's main value proposition?
   - Is it concise enough for LLM context windows (recommended: under 2000 words)?
5. **Compare to site content** — does llms.txt accurately represent the actual site?

### Generate Mode

If no llms.txt exists, or if the user requests generation, produce a recommended llms.txt following the standard format:

```markdown
# [Site Name]

> [One-paragraph site description: what the site does, who it's for, key value proposition]

## Main Sections

- [Section Name](URL): Brief description of what this section contains
- [Section Name](URL): Brief description

## Key Resources

- [Resource Name](URL): Description of the resource and its value
- [Resource Name](URL): Description

## About

- [About Page](URL): Company/author background
- [Contact](URL): How to reach the team
```

Use `fetch_url` on the homepage and key pages to understand the site structure. Use `web_search` to find the site's main value proposition if not clear from the homepage.

### Scoring (Analyse Mode)

Start from 0 (since most sites don't have llms.txt yet):
- llms.txt exists: 40 points
- Valid structure/formatting: +15
- Covers main site sections: +15
- Description is accurate and clear: +10
- Key pages linked: +10
- Content is current: +5
- llms-full.txt also exists: +5
- No llms.txt found: 0 (not a penalty — it's emerging, but it's a missed opportunity)

### Output Format

```
LLMS.TXT ANALYSIS

Domain: [domain]
llms.txt Status: [found/not found]
llms-full.txt Status: [found/not found]
Score: [0-100] / 100

## Current llms.txt Assessment (if found)
- Structure: [valid/issues found]
- Completeness: [assessment]
- Accuracy: [matches site content / outdated / inaccurate]
- Length: [word count] (recommended: under 2000 words)

## Issues Found (if analyse mode)
- [Specific issues with structure, content, or accuracy]

## Recommended llms.txt (if generate mode or not found)

[Complete llms.txt content ready to deploy]

## Recommendations
1. [Highest priority action]
2. [Next priority]
```
