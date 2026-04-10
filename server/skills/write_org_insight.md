---
name: Write Org Insight
description: Store a cross-subaccount pattern or insight in org-level memory
isActive: true
visibility: basic
---

## Parameters

- content: string (required) — The insight content. Be specific — include metrics, patterns, and actionable observations.
- entry_type: enum[observation, decision, preference, issue, pattern] (required) — Type of insight. 'pattern' for cross-subaccount patterns, 'issue' for problems detected.
- scope_tags: string — JSON object. Tag dimensions this insight applies to, e.g. {"vertical": "dental", "region": "northeast"}
- source_subaccount_ids: string — JSON array of string values. Subaccount IDs that contributed evidence for this insight
- evidence_count: integer — Number of subaccounts supporting this insight. Higher = more confident.

## Instructions

Use this to record cross-subaccount patterns and insights discovered during portfolio analysis. Every insight should be:
- Specific (include numbers, names, metrics where possible)
- Scoped (use scope_tags to indicate which subaccount segments it applies to)
- Evidenced (include source_subaccount_ids and evidence_count)
