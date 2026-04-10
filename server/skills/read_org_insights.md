---
name: Read Org Insights
description: Query cross-subaccount insights stored in org-level memory
isActive: true
visibility: basic
---

## Parameters

- scope_tag_key: string — Filter insights by scope tag key (e.g. 'vertical')
- scope_tag_value: string — Filter insights by scope tag value (e.g. 'dental')
- entry_type: enum[observation, decision, preference, issue, pattern] — Filter by insight type
- semantic_query: string — Natural language query for semantic search across org insights
- limit: integer — Maximum number of insights to return. Default 10.

## Instructions

Use this skill to recall cross-subaccount patterns and insights you've previously stored. This is your organisation-level memory — accumulated knowledge about what works, what doesn't, and what patterns exist across the portfolio.
