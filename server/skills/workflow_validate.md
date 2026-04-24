---
name: Validate Workflow candidate
description: Run the Workflow DAG validator against a candidate definition. Returns ValidationError[] or { ok: true }. Used by the Workflow Author agent during the iteration loop.
isActive: true
visibility: none
---

## Parameters

- definition: string (required) — JSON object. The candidate Workflow definition object — must contain at least slug, name, version, and a steps array.

## Instructions

Call this every time you produce or revise a candidate Workflow definition. The errors array tells you exactly which rules failed and on which step ids — fix and re-validate until you get `{ ok: true }`. After 3 fix attempts without success, surface the errors to the human admin and ask for help.

## Output

```json
{ "ok": true }
```

or

```json
{
  "ok": false,
  "errors": [
    { "rule": "transitive_dep", "stepId": "publish_landing_page", "message": "..." }
  ]
}
```
