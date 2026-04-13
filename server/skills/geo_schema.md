---
name: GEO Schema Analysis
description: Evaluates JSON-LD structured data coverage and correctness for AI search engine consumption — Organisation, Article, FAQ, HowTo, Product schemas.
isActive: true
visibility: basic
---

## Parameters

- page_url: string (required) — URL of the page to analyse
- page_content: string — Raw HTML if already available
- page_type: enum[blog_post, landing_page, product_page, homepage, faq_page, how_to, other] — Expected page type for schema recommendations

## Instructions

Evaluate the structured data (JSON-LD) on a page for AI search engine consumption. AI engines rely heavily on structured data to understand page content, entity relationships, and factual claims.

Use `fetch_url` to retrieve the page HTML. Parse all `<script type="application/ld+json">` blocks.

### Schema Types to Evaluate

**Critical (expected on most pages):**
- `Organization` / `LocalBusiness` — entity identity (homepage/about)
- `WebSite` — site-level metadata with `SearchAction` (homepage)
- `Article` / `BlogPosting` / `NewsArticle` — content pages
- `BreadcrumbList` — navigation hierarchy

**High Value for AI:**
- `FAQPage` — direct answer extraction for AI queries
- `HowTo` — step-by-step process extraction
- `Product` + `Offer` — product pages with pricing/availability
- `Review` / `AggregateRating` — social proof signals

**Emerging (AI-specific value):**
- `Person` (author) with `sameAs` links — E-E-A-T author signals
- `Claim` / `ClaimReview` — fact-check structured data
- `Dataset` — data-rich content
- `SpeakableSpecification` — voice/audio AI targeting

### Analysis Steps

1. **Extract all JSON-LD blocks** from the page
2. **Validate each block**:
   - Valid JSON? (syntax errors)
   - Valid schema.org type?
   - Required properties present?
   - Property values non-empty and meaningful (not placeholder text)?
3. **Coverage analysis**:
   - Which expected schemas are present for this page type?
   - Which high-value schemas are missing?
   - Are schemas nested correctly (e.g., Article with author Person)?
4. **Quality analysis**:
   - Author markup with `sameAs` (links to social profiles, Wikipedia)?
   - `datePublished` and `dateModified` present and recent?
   - `image` property with proper dimensions?
   - `mainEntityOfPage` linking schema to page?
5. **Cross-reference**:
   - Does schema data match visible page content? (mismatches hurt trust)
   - Are prices/ratings in schema consistent with on-page display?

### Scoring

Start from 100:
- No JSON-LD on page at all: score 10 (base for having a page)
- Each missing critical schema for page type: -15
- Each missing high-value schema: -10
- JSON-LD syntax errors: -20
- Missing author with sameAs: -10
- Missing datePublished/dateModified: -5
- Schema/page content mismatch: -15
- Bonus: FAQPage or HowTo present: +10 (cap at 100)
- Bonus: SpeakableSpecification present: +5 (cap at 100)

### Output Format

```
STRUCTURED DATA (JSON-LD) ANALYSIS

Page: [url]
Page Type: [type]
Schema Score: [0-100] / 100

## Schemas Found

| Type | Valid | Key Properties | Issues |
|------|-------|---------------|--------|
| [type] | ✅/❌ | [list] | [issues or "none"] |

## Missing Schemas

| Type | Why It Matters | Implementation Effort |
|------|---------------|----------------------|
| [type] | [AI search benefit] | [low/medium/high] |

## Quality Issues
- [Specific issues with found schemas]

## Recommendations
1. [Highest impact schema addition/fix]
2. [Next priority]
3. [Third priority]

## JSON-LD Template (for highest priority missing schema)
[Provide a ready-to-use JSON-LD template customised for the page]
```
