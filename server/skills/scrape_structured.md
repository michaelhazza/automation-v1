---
name: Scrape Structured
description: Extract structured data from a web page with adaptive selectors that self-heal when the site changes layout.
isActive: true
visibility: basic
---

## Parameters

- url: string (required) — The full URL to scrape
- fields: string (required) — What to extract, in natural language (e.g., "plan name, monthly price, annual price, features list")
- remember: boolean — Learn selectors for next time so future scrapes are faster and don't require LLM extraction (default: true)
- selector_group: string — Named group for stored selectors (default: auto-generated as `<hostname>:<sha256(fields.trim().toLowerCase()).slice(0,8)>` — deterministic per site+field-set). Use the same group name across runs targeting the same site to benefit from learned selectors.

## Instructions

Use `scrape_structured` for recurring data extraction where you need consistent JSON output across multiple runs. The first extraction uses the LLM to identify data fields. Subsequent extractions use learned selectors — zero LLM calls, instant results.

The adaptive selector engine automatically handles site redesigns. If the original CSS selectors break, the engine relocates the elements using structural similarity matching. If confidence is below threshold, it returns `selector_uncertain: true` — ask the user to verify.

### Output format

Returns JSON with one key per requested field. Values are always arrays — even for single-record pages (the parallel arrays model):

```json
{
  "plan_name": ["Starter", "Pro", "Enterprise"],
  "monthly_price": ["$9", "$29", "$99"],
  "annual_price": ["$7/mo", "$24/mo", "$79/mo"],
  "selector_confidence": 0.94,
  "adaptive_match_used": false,
  "selector_uncertain": false,
  "content_hash": "abc123...",
  "url": "https://example.com/pricing"
}
```

Multi-record pages produce parallel arrays where index N of each field array corresponds to the same record.

### Decision rules

- **Use scrape_structured** when: you need the same fields from the same URL repeatedly (competitor pricing, feature lists, availability data)
- **Use scrape_url** when: you need general content from a URL, or you need it only once
- **Set `remember: false`** when: you need a one-off structured extraction and don't want selectors stored (same as `scrape_url` with `output_format: json`)
- **Use the same `selector_group`** across runs on the same site to benefit from learned selectors
