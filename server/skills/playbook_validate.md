---
name: Validate playbook candidate
description: Run the Playbook DAG validator against a candidate definition. Returns ValidationError[] or { ok: true }. Used by the Playbook Author agent during the iteration loop.
isActive: true
visibility: none
---

```json
{
  "name": "playbook_validate",
  "description": "Validate a candidate playbook definition against the §4 DAG validator. Checks unique step ids, kebab_case ids, dependsOn resolution, cycle detection, orphan detection, missing entry steps, type-specific required fields, missing outputSchema, missing sideEffectType, irreversible+retries combinations, and max DAG depth. Returns { ok: true } on success or { ok: false, errors: [...] } with a structured error list.",
  "input_schema": {
    "type": "object",
    "properties": {
      "definition": {
        "type": "object",
        "description": "The candidate playbook definition object — must contain at least slug, name, version, and a steps array."
      }
    },
    "required": ["definition"]
  }
}
```

## Instructions

Call this every time you produce or revise a candidate playbook definition. The errors array tells you exactly which rules failed and on which step ids — fix and re-validate until you get `{ ok: true }`. After 3 fix attempts without success, surface the errors to the human admin and ask for help.

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
