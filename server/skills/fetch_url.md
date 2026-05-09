---
name: Fetch URL
description: Make a raw HTTP request to a URL and return the response body. Best for JSON REST APIs, RSS feeds, sitemaps, and plain-HTML pages that do not require JavaScript rendering. For pages with JS rendering or anti-bot protection, use scrape_url instead.
isActive: true
visibility: basic
---

## Parameters

- url: string (required) — The full URL to fetch (must start with http:// or https://)
- method: string — HTTP method: GET or POST (default: GET)
- headers: string — JSON object. Optional HTTP headers as key-value pairs (e.g. {"Authorization": "Bearer token"})
- body: string — Request body for POST requests. JSON-encode objects before passing.

## Instructions

Use `fetch_url` to retrieve a specific page or call an API when you have the exact URL. For discovery and open-ended research, prefer `web_search` instead. For pages that require JavaScript rendering or have anti-bot protection, use `scrape_url` instead. If the response is truncated, the most important content is at the top — use more targeted URLs rather than home pages or landing pages.
