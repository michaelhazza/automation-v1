---
name: GEO Citability Analysis
description: Analyses content extraction quality for AI citation — evaluates passage structure, claim density, and quotability for AI search engines.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- page_url: string — URL of the page to analyse (fetched via fetch_url)
- page_content: string — Raw page content if already available
- target_keyword: string — Primary keyword context for relevance scoring

## Instructions

Evaluate how well a page's content can be extracted and cited by AI search engines (ChatGPT, Perplexity, Google AI Overviews, etc.). AI engines favour content that is structured in clean, self-contained passages that can be quoted directly.

Either `page_url` or `page_content` must be provided. Use `fetch_url` if only URL is given.

### Analysis Criteria

**Passage Extractability (40% of dimension score)**
- Optimal passage length: 134-167 words (research-backed range for AI citation)
- Count passages that fall within this range vs total content passages
- Paragraphs should be self-contained — each makes a complete point without requiring surrounding context
- Check for clear topic sentences that signal what the passage covers

**Claim Density (25% of dimension score)**
- Specific, verifiable claims per passage (dates, numbers, names, sources)
- Factual density vs filler content ratio
- Statistical claims with cited sources score highest
- Vague claims ("many experts agree") score lowest

**Quotable Structure (20% of dimension score)**
- Definition-style statements ("X is Y") that AI can extract as answers
- List-format content (numbered or bulleted) for step-by-step queries
- FAQ-format sections with clear question-answer pairs
- Summary/TL;DR sections that pre-package key takeaways

**Semantic Clarity (15% of dimension score)**
- Clear entity references (not just pronouns across paragraphs)
- Consistent terminology (not synonym-hopping for keyword variation)
- Logical flow that AI can follow for multi-hop reasoning
- Headers that accurately describe section content (not clickbait)

### Scoring

Score 0-100 based on weighted criteria above. Deductions:
- No passages in optimal length range: -30
- Claim density below 1 verifiable claim per 200 words: -20
- No definition-style or FAQ-style content: -15
- Pronoun-heavy content without clear entity references: -10
- Headers that don't match section content: -10

### Output Format

```
AI CITABILITY ANALYSIS

Page: [url or "provided content"]
Citability Score: [0-100] / 100

## Passage Analysis
- Total content passages: [N]
- Passages in optimal range (134-167 words): [N] ([%])
- Average passage length: [N] words
- Self-contained passages: [N] ([%])

## Claim Density
- Verifiable claims found: [N]
- Claims per 200 words: [ratio]
- Claims with sources: [N]

## Quotable Structures
- Definition statements: [N]
- FAQ pairs: [N]
- Step-by-step lists: [N]
- Summary sections: [N]

## Top Recommendations
1. [Most impactful improvement]
2. [Second most impactful]
3. [Third most impactful]

## Passage-Level Findings
[Specific passages that work well and specific ones that need restructuring]
```
