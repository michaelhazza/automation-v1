---
name: Discover Prospects
description: Google Places caller — returns SMB prospects matching geo, vertical, and size criteria. Fails soft when GOOGLE_PLACES_API_KEY is not set.
isActive: true
visibility: basic
---

## Parameters

- query: string (required) — Search query describing the type of business to find.
- location: string (required) — Geographic location to search within.
- radius: integer (optional, default 5000 metres) — Search radius in metres.
- business_type: string (optional) — Google Places business type filter.
- limit: integer (optional, default 20) — Maximum number of results to return.

## Instructions

Search for business prospects using Google Places. If GOOGLE_PLACES_API_KEY is not configured, return status=not_configured. Return a list of matching businesses with name, address, category, and contact info where available.
