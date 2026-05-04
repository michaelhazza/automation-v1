---
name: Smart Skip From Website
description: Given a subaccount website URL, scrape the homepage + 1-2 linked pages and extract draft brand voice, audience, and services signals. Used in onboarding Steps 2-3 to pre-fill answers (§8.5).
isActive: true
visibility: basic
---

## Parameters

- url: string (required) — Subaccount website URL (must start with http(s)://).
- organisationId: string (required, uuid) — Tenant scope.
- subaccountId: string (required, uuid) — Target subaccount.

## Output

```json
{
  "audienceSignal": "...",
  "voiceSignal": "...",
  "servicesSignal": "...",
  "sourcePages": ["https://example.com", "https://example.com/about"],
  "fetchedAt": "ISO-8601"
}
```

All signal fields are nullable strings (max 400 chars). The onboarding service
treats a signal shorter than 20 chars as "insufficient" and falls back to
asking the question from scratch.

## Behaviour

1. Fetch the homepage HTML.
2. Extract readable text via `@mozilla/readability` (already a dependency).
3. Pull 1-2 top-navigation links whose anchor text matches /about|team|what we do|services/i.
4. Fetch those pages.
5. Ask the LLM (gpt-4o-mini class) to produce the three signals.

Best-effort — any network / parsing failure returns null signals rather than throwing. The onboarding step then asks the question directly.
