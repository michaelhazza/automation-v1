---
name: Read Analytics
description: Retrieves social media performance metrics for one or more platforms and time periods. Returns structured engagement data for use in performance analysis and reporting.
isActive: true
visibility: basic
---

```json
{
  "name": "read_analytics",
  "description": "Retrieve social media performance metrics for one or more platforms and a specified time period. Returns structured engagement data (impressions, reach, engagement rate, follower growth, top posts) for use in performance analysis and content strategy decisions.",
  "input_schema": {
    "type": "object",
    "properties": {
      "platforms": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["twitter", "linkedin", "instagram", "facebook"]
        },
        "description": "Platforms to retrieve analytics for"
      },
      "date_from": {
        "type": "string",
        "description": "Start date in ISO 8601 format (YYYY-MM-DD)"
      },
      "date_to": {
        "type": "string",
        "description": "End date in ISO 8601 format (YYYY-MM-DD). Defaults to today."
      },
      "metrics": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["impressions", "reach", "engagement_rate", "clicks", "follower_growth", "top_posts", "post_count"]
        },
        "description": "Specific metrics to retrieve. If omitted, returns all available metrics."
      },
      "campaign_tag": {
        "type": "string",
        "description": "Optional: filter results to posts tagged with this campaign identifier"
      }
    },
    "required": ["platforms", "date_from"]
  }
}
```

## Instructions

Invoke this skill to retrieve performance data before running analysis or generating a report. Pass the results to downstream skills (`analyse_performance` for the Social Media Agent, or `draft_report` for the Client Reporting Agent).

**MVP stub:** The platform API integrations are not yet connected. This skill returns a structured stub response that downstream skills can recognise and handle. When the integrations are live, the stub is replaced with real API calls.

Validate that `date_from` is not in the future. Validate that `date_to` >= `date_from`. If either check fails, return a validation error rather than a stub response.

## Methodology

### Data Schema

Each platform response follows this structure:

```
Platform: [platform]
Period: [date_from] to [date_to]
Campaign Filter: [campaign_tag or "none"]

Metrics:
  impressions: [number or null]
  reach: [number or null]
  engagement_rate: [percentage, e.g. "3.4%" or null]
  clicks: [number or null]
  follower_growth: [number — net change over period, or null]
  post_count: [number or null]

Top Posts (up to 5):
  - post_id: [platform post ID]
    published_at: [ISO datetime]
    content_preview: [first 100 chars]
    impressions: [number]
    engagement_rate: [percentage]
    campaign_tag: [tag or null]
```

### Stub Response

```
ANALYTICS RESULTS

Status: stub — platform integration not configured
Platforms requested: [list]
Period: [date_from] to [date_to]

Note: The social media analytics integration has not been configured for this workspace.
Downstream skills (analyse_performance, draft_report) should handle this stub status
by noting data unavailability rather than failing.

To connect platform analytics, configure the relevant API credentials in the
workspace integration settings.
```

### Validation Errors

```
ANALYTICS ERROR

Error: [validation_error | date_range_invalid | platform_not_configured]
Detail: [specific error message]
```
