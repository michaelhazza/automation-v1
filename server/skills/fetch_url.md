---
name: Fetch URL
description: Make an HTTP request to a URL and return the response body.
isActive: true
---

```json
{
  "name": "fetch_url",
  "description": "Make an HTTP GET or POST request to a URL and return the response body (truncated at 10,000 characters). Use to read web pages, call external APIs, or retrieve content from a specific URL.",
  "input_schema": {
    "type": "object",
    "properties": {
      "url": { "type": "string", "description": "The full URL to fetch (must start with http:// or https://)" },
      "method": { "type": "string", "description": "HTTP method: GET or POST (default: GET)" },
      "headers": { "type": "object", "description": "Optional HTTP headers as key-value pairs (e.g. {\"Authorization\": \"Bearer token\"})" },
      "body": { "type": "string", "description": "Request body for POST requests. JSON-encode objects before passing." }
    },
    "required": ["url"]
  }
}
```

## Instructions

Use `fetch_url` to retrieve a specific page or call an API when you have the exact URL. For discovery and open-ended research, prefer `web_search` instead. If the response is truncated, the most important content is at the top — use more targeted URLs rather than home pages or landing pages.
