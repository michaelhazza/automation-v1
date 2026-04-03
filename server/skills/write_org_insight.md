---
name: Write Org Insight
description: Store a cross-subaccount pattern or insight in org-level memory
isActive: true
---

```json
{
  "name": "write_org_insight",
  "description": "Store a cross-subaccount insight or pattern in the organisation's memory. These persist across runs and accumulate into the organisation's intelligence base. Quality-scored and embedded for semantic retrieval.",
  "input_schema": {
    "type": "object",
    "properties": {
      "content": {
        "type": "string",
        "description": "The insight content. Be specific — include metrics, patterns, and actionable observations."
      },
      "entry_type": {
        "type": "string",
        "enum": ["observation", "decision", "preference", "issue", "pattern"],
        "description": "Type of insight. 'pattern' for cross-subaccount patterns, 'issue' for problems detected."
      },
      "scope_tags": {
        "type": "object",
        "description": "Tag dimensions this insight applies to, e.g. {\"vertical\": \"dental\", \"region\": \"northeast\"}"
      },
      "source_subaccount_ids": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Subaccount IDs that contributed evidence for this insight"
      },
      "evidence_count": {
        "type": "integer",
        "description": "Number of subaccounts supporting this insight. Higher = more confident."
      }
    },
    "required": ["content", "entry_type"]
  }
}
```

## Instructions

Use this to record cross-subaccount patterns and insights discovered during portfolio analysis. Every insight should be:
- Specific (include numbers, names, metrics where possible)
- Scoped (use scope_tags to indicate which subaccount segments it applies to)
- Evidenced (include source_subaccount_ids and evidence_count)
