---
name: Search Knowledge Base
description: Searches the workspace knowledge base for articles, FAQs, and documentation relevant to a query. Returns ranked results with excerpts.
isActive: true
visibility: basic
---

## Parameters

- query: string (required) — The search query — typically the customer's issue or question in natural language
- intent_category: string — Optional: the email intent category from classify_email (e.g. technical_support, billing_dispute). Narrows the search scope.
- max_results: number — Maximum number of results to return. Defaults to 5. Max 10.

## Instructions

Invoke this skill between `classify_email` and `draft_reply` to retrieve grounding content for the reply. Pass the full search results as `knowledge_base_context` to `draft_reply`.

This skill is a stub at MVP. The runtime implementation will integrate with the workspace's configured knowledge base source (e.g. Notion, Confluence, Intercom Articles, or a vector search index). Until the integration is wired, the skill returns a structured stub response indicating the knowledge base is not yet configured, so the Support Agent knows to flag the reply as `confidence: low`.

### Search Strategy

1. Extract key terms from the query: product names, error codes, feature names, action verbs
2. Search the knowledge base using both keyword and semantic matching if available
3. Rank results by relevance to the query and the `intent_category` if provided
4. Return the top N results (default 5, max 10) with:
   - Article title
   - Relevance score (0.0–1.0)
   - Excerpt (first 300 characters of the most relevant passage)
   - Source URL or document reference

### Result Filtering

Exclude results where:
- Relevance score < 0.4
- Article is marked as archived or draft
- Article category is explicitly out of scope for the intent (e.g. do not return engineering runbooks for a billing_dispute query)

### Output Format

```
KNOWLEDGE BASE RESULTS

Query: [original query]
Intent Category: [if provided]
Results Found: [count]
Search Timestamp: [ISO timestamp]

## Result 1 — [Article Title]

Relevance: [score]
Source: [URL or document reference]
Excerpt:
> [300-character excerpt of the most relevant passage]

## Result 2 — [Article Title]

...

## No Results

[If no results found: "No knowledge base articles matched this query. The reply should be flagged for human review."]
```

### Stub Response (MVP — integration not yet wired)

```
KNOWLEDGE BASE RESULTS

Query: [original query]
Status: stub — knowledge base integration not configured
Results Found: 0

Note: The knowledge base search integration has not been configured for this workspace.
The downstream draft_reply skill will flag this reply as confidence: low and insert
[VERIFY] placeholders where product knowledge is needed. A human reviewer should
validate factual claims before the reply is sent.
```
