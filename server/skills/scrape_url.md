---
name: Scrape URL
description: Fetch and extract content from any web page using a tiered scraping engine with automatic anti-bot escalation.
isActive: true
visibility: basic
---

## Parameters

- url: string (required) — The full URL to scrape (must start with http:// or https://)
- extract: string — What to extract, in natural language (e.g., "pricing table", "all article text", "product listings with prices"). If omitted, returns the full page content.
- output_format: string — Output format: text, markdown, or json (default: markdown)
- css_selectors: array of strings — CSS selectors to extract specific elements. Optional — if omitted, the engine auto-detects relevant content. Example: `["div.pricing-grid", "span.price"]`

## Instructions

Use `scrape_url` to extract content from a web page. Unlike `fetch_url`, this skill handles JavaScript-rendered pages, anti-bot protection, and content extraction automatically.

- For a known URL with specific data needs: use `scrape_url` with an `extract` description
- For discovery and research: use `web_search` first to find relevant URLs, then `scrape_url` to extract content
- For recurring data extraction with consistent structure: use `scrape_structured` instead

The engine automatically selects the best fetching strategy (HTTP, stealth browser, or anti-bot bypass) based on the target site's response. No configuration needed.

### Decision rules
- **Use scrape_url** when: you have a specific URL and need its content
- **Use scrape_structured** when: you need consistent field extraction across runs (prices, names, features)
- **Use fetch_url** when: calling a JSON API endpoint (not a web page)
- **Use web_search** when: you don't have a specific URL yet
