---
name: Read Campaigns
description: Retrieves current campaign data from the connected ads platform — campaign names, status, budget, spend, and performance summary. Returns structured data for downstream analysis and decision-making.
isActive: true
visibility: basic
---

```json
{
  "name": "read_campaigns",
  "description": "Retrieve current campaign data from the connected ads platform. Returns campaign names, status, budget allocations, spend to date, and key performance indicators for one or more campaigns. Used by the Ads Management Agent before making bid, budget, or copy changes.",
  "input_schema": {
    "type": "object",
    "properties": {
      "platform": {
        "type": "string",
        "enum": ["google_ads", "meta_ads", "linkedin_ads"],
        "description": "The ads platform to read campaigns from"
      },
      "campaign_ids": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Optional list of specific campaign IDs to retrieve. If omitted, returns all active campaigns."
      },
      "include_ad_groups": {
        "type": "boolean",
        "description": "Whether to include ad group breakdown within each campaign. Default false."
      },
      "date_from": {
        "type": "string",
        "description": "Start date for performance metrics (ISO 8601 YYYY-MM-DD). Defaults to last 7 days."
      },
      "date_to": {
        "type": "string",
        "description": "End date for performance metrics (ISO 8601 YYYY-MM-DD). Defaults to today."
      }
    },
    "required": ["platform"]
  }
}
```

## Instructions

Invoke this skill at the start of any Ads Management Agent run that requires knowledge of current campaign state. The returned data is the basis for all downstream analysis, bid adjustments, copy updates, and pause decisions.

**MVP stub:** The ads platform API integrations are not yet connected. This skill returns a structured stub response so downstream skills can handle data unavailability gracefully rather than failing.

Validate `date_from` and `date_to` before returning. If `date_from` > `date_to`, return a validation error.

## Methodology

### Data Schema

```
CAMPAIGN DATA

Platform: [platform]
Retrieved At: [ISO timestamp]
Date Range: [date_from] to [date_to]
Campaign Filter: [IDs or "all active"]

Campaigns:
  - campaign_id: [platform campaign ID]
    name: [campaign name]
    status: [active | paused | ended | draft]
    objective: [awareness | traffic | conversions | leads]
    daily_budget: [amount and currency]
    total_spend: [amount, period]
    impressions: [number]
    clicks: [number]
    ctr: [percentage]
    conversions: [number]
    cpa: [cost per acquisition, or null if no conversion tracking]
    roas: [return on ad spend, or null]
    ad_groups: [array if include_ad_groups=true, else omitted]
```

### Stub Response

```
CAMPAIGN DATA

Platform: [platform]
Status: stub — ads platform integration not configured
Campaigns: []

Note: The [platform] integration has not been configured for this workspace.
Connect the integration in workspace settings to enable live campaign data retrieval.
Downstream skills (analyse_performance, update_bid, update_copy, pause_campaign,
increase_budget) should handle this stub status by noting data unavailability.
```
