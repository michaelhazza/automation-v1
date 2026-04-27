---
name: GEO Platform Optimizer
description: Platform-specific readiness scores and recommendations for each major AI search engine — Google AI Overviews, ChatGPT, Perplexity, Gemini, Bing Copilot.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- page_url: string (required) — URL of the page to analyse
- page_content: string — Raw page content if already available
- target_keyword: string — Primary keyword for platform-specific search context
- platforms: string[] — Specific platforms to analyse (default: all five)

## Instructions

Each AI search engine has different content preferences, citation patterns, and ranking signals. This skill produces per-platform readiness scores with specific optimisation recommendations.

Use `fetch_url` to retrieve the page if only URL is provided. Use `web_search` to check current AI search visibility for the target keyword if provided.

### Platform Analysis

#### Google AI Overviews (AIO)
- **Content format preference**: Concise, factual paragraphs; definition-style answers; numbered lists
- **Source signals**: Domain authority, E-E-A-T signals, existing organic rankings, freshness
- **Key checks**:
  - Does the page rank organically for the target keyword? (AIO sources from top organic results)
  - Is content formatted for featured snippet extraction? (40-60 word direct answers)
  - Are there clear list/step formats that AIO can render?
  - Does the page have strong E-E-A-T signals (author, credentials, citations)?

#### ChatGPT (Browse / Search)
- **Content format preference**: Comprehensive, well-structured long-form; clear headers; authoritative tone
- **Source signals**: Content depth, recency, unique data/insights, not behind paywall
- **Key checks**:
  - GPTBot access allowed in robots.txt?
  - Content depth sufficient (1500+ words for comprehensive topics)?
  - Clear heading hierarchy for section extraction?
  - Original data, research, or expert quotes present?
  - Page loads without JavaScript rendering requirements?

#### Perplexity
- **Content format preference**: Source-diverse, fact-dense, with inline citations; values primary sources
- **Source signals**: Citation-worthiness, factual density, source authority, content freshness
- **Key checks**:
  - PerplexityBot access allowed?
  - Factual claim density (numbers, dates, named entities)?
  - Inline citations and references?
  - Content structured as a definitive resource on the topic?
  - FAQ sections with direct question-answer pairs?

#### Gemini
- **Content format preference**: Conversational, comprehensive, multi-angle coverage
- **Source signals**: Google's existing search signals, structured data, entity recognition
- **Key checks**:
  - Google-Extended crawler access?
  - JSON-LD structured data present?
  - Google Knowledge Panel entity connected?
  - Multi-perspective coverage (pros/cons, comparisons)?

#### Bing Copilot
- **Content format preference**: Concise answers, tabular data, clear categorisation
- **Source signals**: Bing search index, social signals, structured data, freshness
- **Key checks**:
  - bingbot access allowed?
  - Tabular data or comparison formats?
  - Social proof signals (social share counts, user reviews)?
  - Clear meta description for snippet extraction?
  - IndexNow or Bing Webmaster Tools configured?

### Scoring

Each platform scores 0-100 independently. The overall Platform-Specific dimension is the average of all platform scores.

Per platform, start from 100:
- Crawler blocked: -40 (critical — nothing else matters)
- Missing format-preferred content structure: -15
- Missing key signals for that platform: -10 each (up to -30)
- No target keyword visibility check possible: -5
- Bonus: Currently cited by this platform for related queries: +10

### Output Format

```
PLATFORM-SPECIFIC READINESS

Page: [url]
Target Keyword: [keyword or "not specified"]
Overall Platform Score: [0-100] / 100

## Platform Breakdown

### Google AI Overviews — [score]/100
- Crawler access: [status]
- Organic ranking signal: [status]
- Content format readiness: [status]
- Key findings: [list]
- Top recommendation: [specific action]

### ChatGPT — [score]/100
- Crawler access: [status]
- Content depth: [word count, assessment]
- Structure quality: [status]
- Key findings: [list]
- Top recommendation: [specific action]

### Perplexity — [score]/100
- Crawler access: [status]
- Factual density: [assessment]
- Citation-worthiness: [status]
- Key findings: [list]
- Top recommendation: [specific action]

### Gemini — [score]/100
- Crawler access: [status]
- Structured data: [status]
- Entity recognition: [status]
- Key findings: [list]
- Top recommendation: [specific action]

### Bing Copilot — [score]/100
- Crawler access: [status]
- Content format: [status]
- Social signals: [status]
- Key findings: [list]
- Top recommendation: [specific action]

## Cross-Platform Recommendations
1. [Action that improves scores across multiple platforms]
2. [Next cross-platform action]
3. [Platform-specific quick win]
```
