---
name: Read Org Insights
description: Query cross-subaccount insights stored in org-level memory
isActive: true
visibility: basic
---

```json
{
  "name": "read_org_insights",
  "description": "Read insights and patterns stored in the organisation's cross-subaccount memory. These are observations, decisions, and patterns that span multiple subaccounts. Supports filtering by scope tags, entry type, and semantic similarity.",
  "input_schema": {
    "type": "object",
    "properties": {
      "scope_tag_key": {
        "type": "string",
        "description": "Filter insights by scope tag key (e.g. 'vertical')"
      },
      "scope_tag_value": {
        "type": "string",
        "description": "Filter insights by scope tag value (e.g. 'dental')"
      },
      "entry_type": {
        "type": "string",
        "enum": ["observation", "decision", "preference", "issue", "pattern"],
        "description": "Filter by insight type"
      },
      "semantic_query": {
        "type": "string",
        "description": "Natural language query for semantic search across org insights"
      },
      "limit": {
        "type": "integer",
        "description": "Maximum number of insights to return. Default 10."
      }
    }
  }
}
```

## Instructions

Use this skill to recall cross-subaccount patterns and insights you've previously stored. This is your organisation-level memory — accumulated knowledge about what works, what doesn't, and what patterns exist across the portfolio.
