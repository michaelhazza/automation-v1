---
name: GEO Crawler Access Check
description: Checks robots.txt and HTTP headers for 14+ AI crawlers to determine whether AI search engines can access and index site content.
isActive: true
visibility: basic
---

## Parameters

- page_url: string (required) — URL of the page to check (domain-level robots.txt will be fetched)
- include_headers: boolean — Whether to check HTTP response headers for AI-specific directives (default: true)

## Instructions

Determine whether AI search engine crawlers can access the site. This is a binary gate — if AI crawlers are blocked, no amount of content optimisation will help AI search visibility.

Use `fetch_url` to retrieve `robots.txt` from the domain root and the page itself (for header inspection).

### AI Crawlers to Check

Check robots.txt `User-agent` directives for each of these crawlers:

| Crawler | Engine | Priority |
|---------|--------|----------|
| GPTBot | OpenAI / ChatGPT | Critical |
| ChatGPT-User | OpenAI browsing | Critical |
| ClaudeBot | Anthropic / Claude | High |
| Claude-Web | Anthropic browsing | High |
| PerplexityBot | Perplexity AI | High |
| Google-Extended | Google AI / Gemini | Critical |
| GoogleOther | Google secondary | Medium |
| Bytespider | ByteDance / TikTok | Medium |
| CCBot | Common Crawl (training data) | Medium |
| FacebookBot | Meta AI | Medium |
| Amazonbot | Amazon / Alexa AI | Low |
| anthropic-ai | Anthropic training | Medium |
| Applebot-Extended | Apple AI | Medium |
| cohere-ai | Cohere training | Low |

### Analysis Steps

1. **Fetch robots.txt** from `{domain}/robots.txt`
2. **Parse directives** for each crawler above:
   - `Disallow: /` = fully blocked
   - `Disallow: [specific paths]` = partially blocked (check if audited page is in blocked path)
   - No mention = allowed by default
   - `Allow: /` after `Disallow: /` = explicitly allowed
3. **Check wildcard blocks**: `User-agent: *` with `Disallow: /` blocks all crawlers including AI
4. **Check HTTP headers** (if include_headers is true):
   - `X-Robots-Tag` header for `noai`, `noimageai`, `noindex` directives
   - `meta name="robots"` in HTML for `noai` or AI-specific directives
5. **Check for llms.txt** — does `{domain}/llms.txt` exist? (indicates AI-awareness)
6. **Crawl-delay analysis** — excessive crawl-delay for AI bots suggests passive blocking

### Scoring

Start from 100, deduct for blocked access:
- Each Critical crawler fully blocked: -20
- Each High crawler fully blocked: -10
- Each Medium crawler fully blocked: -5
- Global wildcard block (`User-agent: *` with `Disallow: /`): -40
- `X-Robots-Tag: noai` on the page: -30
- No robots.txt found (ambiguous): -5
- llms.txt present: +5 (bonus, cap at 100)

### Output Format

```
AI CRAWLER ACCESS REPORT

Domain: [domain]
Page: [url]
Overall Access Score: [0-100] / 100

## Crawler Access Matrix

| Crawler | Engine | Status | Details |
|---------|--------|--------|---------|
| GPTBot | OpenAI | ✅ Allowed / ❌ Blocked / ⚠️ Partial | [specifics] |
[... for each crawler]

## robots.txt Summary
- File found: [yes/no]
- Global wildcard block: [yes/no]
- AI-specific directives: [count]

## HTTP Header Directives
- X-Robots-Tag: [value or "not set"]
- Meta robots AI directives: [found/not found]

## llms.txt
- Present: [yes/no]
- [Brief analysis if present]

## Recommendations
1. [Most critical access fix]
2. [Next priority]
```
