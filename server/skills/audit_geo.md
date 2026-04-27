---
name: Audit GEO
description: Composite GEO (Generative Engine Optimisation) audit — orchestrates sub-skills to evaluate AI search visibility and produces a 0-100 GEO Score with per-dimension breakdown.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- page_url: string (required) — URL of the page to audit
- target_keyword: string — Primary keyword this page should be visible for in AI search
- include_competitors: boolean — Whether to run competitive GEO comparison (default: false)
- competitor_urls: string[] — Up to 3 competitor URLs to benchmark against (used when include_competitors is true)
- workspace_context: string — Workspace memory: brand context, existing SEO data, content strategy

## Instructions

This is the primary GEO audit skill. It orchestrates the sub-skills (`geo_citability`, `geo_crawlers`, `geo_schema`, `geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`) and produces a unified GEO Score.

Use `fetch_url` to retrieve the page content before analysis. If `fetch_url` fails, return an error — do not fabricate findings.

### Execution Flow

1. Fetch the target page via `fetch_url`
2. Run each dimension analysis (can reference sub-skill methodologies inline):
   - **AI Citability (25%)** — passage extractability, quotable structure, claim density
   - **Brand Authority (20%)** — entity signals, brand mentions, knowledge graph presence
   - **Content Quality / E-E-A-T (20%)** — experience, expertise, authoritativeness, trustworthiness
   - **Technical Infrastructure (15%)** — crawlability for AI bots, page speed signals, mobile readiness
   - **Structured Data (10%)** — JSON-LD coverage and correctness
   - **Platform-Specific (10%)** — readiness for Google AIO, ChatGPT, Perplexity, Gemini, Bing Copilot
3. Compute composite score as weighted sum
4. If `include_competitors` is true, run `geo_compare` methodology on competitor URLs
5. Produce unified report

### Scoring Framework

Six dimensions, default weights (tunable per-org):

| Dimension | Weight | Key Signals |
|-----------|--------|-------------|
| AI Citability | 25% | 134-167 word extractable passages, clear claims, quotable structure |
| Brand Authority | 20% | Wikipedia/Wikidata entity, Knowledge Panel, brand mention density |
| Content Quality / E-E-A-T | 20% | Author attribution, first-person experience, cited sources, credentials |
| Technical Infrastructure | 15% | AI crawler access (robots.txt), page speed, mobile-first, HTTPS |
| Structured Data | 10% | JSON-LD: Organisation, Article, FAQ, HowTo, Product schemas |
| Platform-Specific | 10% | Per-engine optimisation signals |

Each dimension scores 0-100. Composite = weighted sum.

### Output Format

```
GEO AUDIT REPORT

Page: [url]
Target Keyword: [keyword or "not specified"]
Audit Date: [ISO date]
GEO Score: [0-100] / 100

## Score Breakdown

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| AI Citability | [0-100] | 25% | [weighted] |
| Brand Authority | [0-100] | 20% | [weighted] |
| Content Quality / E-E-A-T | [0-100] | 20% | [weighted] |
| Technical Infrastructure | [0-100] | 15% | [weighted] |
| Structured Data | [0-100] | 10% | [weighted] |
| Platform-Specific | [0-100] | 10% | [weighted] |

## Executive Summary

[3-5 sentences: overall AI search visibility posture, biggest opportunities, critical gaps]

## Dimension Details

### AI Citability ([score]/100)
[Findings and specific recommendations]

### Brand Authority ([score]/100)
[Findings and specific recommendations]

### Content Quality / E-E-A-T ([score]/100)
[Findings and specific recommendations]

### Technical Infrastructure ([score]/100)
[Findings and specific recommendations]

### Structured Data ([score]/100)
[Findings and specific recommendations]

### Platform-Specific Readiness ([score]/100)
[Per-platform breakdown: Google AIO, ChatGPT, Perplexity, Gemini, Bing Copilot]

## Priority Recommendations

1. [Highest impact action] — Expected impact: [description]
2. [Second highest] — Expected impact: [description]
3. [Third highest] — Expected impact: [description]
[Up to 10 ranked recommendations]

## 30-Day Improvement Roadmap

### Week 1: Quick Wins
- [Actions that can be done immediately]

### Week 2-3: Structural Improvements
- [Medium-effort changes]

### Week 4: Advanced Optimisation
- [Longer-term strategic actions]

## Competitive Benchmark (if requested)

[Side-by-side comparison table with competitors]

## Notes

[Assumptions, elements that could not be verified, data freshness caveats]
```

### Quality Checklist

Before returning:
- Every finding references specific content or signals from the page — no generic observations
- Scores are calculated from actual findings, not estimated
- Recommendations are specific and actionable (not "improve your content")
- The 30-day roadmap is realistic for the page's current state
- No fabricated findings or scores
