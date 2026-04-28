---
name: GEO Competitive Comparison
description: Competitive GEO analysis — benchmarks a client site against 2-3 competitors across all GEO dimensions to identify relative strengths and gaps.
isActive: true
visibility: basic
---

## Parameters

- page_url: string (required) — Client's page URL to benchmark
- competitor_urls: string[] (required) — 2-3 competitor page URLs to compare against
- target_keyword: string — Primary keyword for the competitive landscape
- workspace_context: string — Known competitive context, industry specifics

## Instructions

Produce a side-by-side GEO comparison between the client's page and competitor pages. This identifies where the client leads, where they trail, and what specific actions would close competitive gaps.

Use `fetch_url` to retrieve all pages. Use `web_search` for brand authority and citation data on each competitor.

### Comparison Framework

For each page (client + competitors), evaluate:

1. **AI Citability** — passage structure, claim density, quotability
2. **Crawler Access** — robots.txt AI crawler permissions
3. **Structured Data** — JSON-LD coverage and quality
4. **Content Depth** — word count, heading structure, comprehensiveness
5. **Brand Authority** — entity presence, mention density (lighter check than full geo_brand_authority)
6. **Platform Signals** — quick check on format readiness per platform

### Analysis Steps

1. Fetch all pages via `fetch_url`
2. For each page, score the six comparison dimensions (0-100 each)
3. Compute relative positioning: where client leads vs trails
4. Identify the specific content/structural elements that create the gap
5. Produce actionable recommendations to close each gap

### Scoring

Each dimension scored 0-100 for each URL. No composite — the value is in the comparison, not the absolute score.

### Output Format

```
COMPETITIVE GEO ANALYSIS

Client: [url]
Competitors: [url1], [url2], [url3]
Target Keyword: [keyword or "not specified"]
Analysis Date: [ISO date]

## Comparison Matrix

| Dimension | Client | Competitor 1 | Competitor 2 | Competitor 3 |
|-----------|--------|-------------|-------------|-------------|
| AI Citability | [score] | [score] | [score] | [score] |
| Crawler Access | [score] | [score] | [score] | [score] |
| Structured Data | [score] | [score] | [score] | [score] |
| Content Depth | [score] | [score] | [score] | [score] |
| Brand Authority | [score] | [score] | [score] | [score] |
| Platform Signals | [score] | [score] | [score] | [score] |
| **Overall** | **[avg]** | **[avg]** | **[avg]** | **[avg]** |

## Client Strengths (Leading Competitors)
- [Dimension]: [specific reason client leads] — Maintain by: [action]

## Client Gaps (Trailing Competitors)
- [Dimension]: Client [score] vs [competitor] [score]
  - Why they lead: [specific content/structural element]
  - How to close: [specific action with expected impact]

## Quick Win Opportunities
[Top 3 actions that would close the largest competitive gaps with minimal effort]

## Strategic Recommendations
1. [Highest impact competitive action]
2. [Next priority]
3. [Longer-term strategic play]

## Notes
[Assumptions, data freshness, page access issues]
```

### Quality Checklist

Before returning:
- All URLs were successfully fetched (note any that failed)
- Scores are based on actual page analysis, not estimates
- Gap analysis references specific content differences, not generic observations
- Recommendations are specific enough to act on
