---
name: GEO Brand Authority
description: Brand mention tracking, entity signals (Wikipedia, Wikidata, Knowledge Panel), and citation density analysis for AI search engine brand visibility.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- brand_name: string (required) — Brand or company name to analyse
- page_url: string — Primary website URL for the brand
- industry: string — Industry context for competitive benchmarking
- workspace_context: string — Existing brand data, known mentions, competitor context

## Instructions

Evaluate how well AI search engines can recognise, attribute, and cite a brand. AI engines rely on entity recognition and authority signals to determine which brands to mention in responses.

Use `web_search` to research brand presence across key authority signals. Use `fetch_url` to check specific pages.

### Analysis Dimensions

**Entity Recognition (30% of dimension score)**
- Wikipedia article exists for the brand?
- Wikidata entity (Q-number) exists?
- Google Knowledge Panel present? (search `{brand_name}` and check)
- Crunchbase, LinkedIn company page, other structured entity sources?
- Brand mentioned as a named entity in authoritative publications?

**Brand Mention Density (25% of dimension score)**
- Search `"{brand_name}"` to assess mention volume
- Mentions in authoritative sources (news, industry publications, educational sites)
- Mention context: positive, neutral, or negative sentiment
- Recency of mentions (AI engines weight fresh data)
- Co-occurrence with relevant industry terms

**Citation Density vs Backlinks (20% of dimension score)**
- Traditional backlink profile gives a baseline authority signal
- Citation-style mentions (brand mentioned as a source/authority, not just a link) matter more for AI
- Expert quotes attributed to the brand's team
- Case studies or data attributed to the brand

**Author/Expert Signals (15% of dimension score)**
- Named authors on the brand's content with credentials?
- Authors have personal Wikipedia/Wikidata entries?
- Authors cited in external publications?
- Schema.org Person markup with sameAs links?

**Content Authority Signals (10% of dimension score)**
- Original research, data, or proprietary insights published?
- Industry reports or white papers?
- Speaking engagements, conference presentations?
- Awards, certifications, or recognised credentials?

### Scoring

Score 0-100 based on weighted dimensions above:
- No Wikipedia or Wikidata entity: -25
- No Knowledge Panel: -15
- Fewer than 10 authoritative mentions found: -20
- No named authors with credentials: -15
- No original research/data: -10
- Strong entity presence across multiple platforms: +10 (bonus, cap 100)

### Output Format

```
BRAND AUTHORITY ANALYSIS

Brand: [name]
Website: [url]
Authority Score: [0-100] / 100

## Entity Recognition
- Wikipedia: [exists/not found] — [link if found]
- Wikidata: [Q-number or "not found"]
- Google Knowledge Panel: [present/not found]
- Other entity sources: [list]

## Brand Mention Analysis
- Authoritative mentions found: [N]
- Mention sources: [top 5 sources]
- Mention sentiment: [positive/neutral/mixed]
- Most recent mention: [date, source]

## Citation Profile
- Citation-style mentions: [N]
- Expert quotes attributed: [N]
- Original data/research referenced: [N]

## Author/Expert Signals
- Named authors: [N]
- Authors with external credentials: [N]
- Schema.org Person markup: [present/not found]

## Recommendations
1. [Highest impact brand authority action]
2. [Next priority]
3. [Third priority]

## Notes
[Data freshness caveats, assumptions about search results]
```
