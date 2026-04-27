---
name: Fetch URL
description: Make an HTTP request to a URL and return the response body.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- url: string (required) — The full URL to fetch (must start with http:// or https://)
- method: string — HTTP method: GET or POST (default: GET)
- headers: string — JSON object. Optional HTTP headers as key-value pairs (e.g. {"Authorization": "Bearer token"})
- body: string — Request body for POST requests. JSON-encode objects before passing.

## Instructions

Use `fetch_url` to retrieve a specific page or call an API when you have the exact URL. For discovery and open-ended research, prefer `web_search` instead. If the response is truncated, the most important content is at the top — use more targeted URLs rather than home pages or landing pages.
