---
name: Propose playbook save
description: Records the validated definition for the human admin to save via the Save & Open PR button. DOES NOT WRITE ANY FILE — the server renders the file deterministically and only updates the Studio session row.
isActive: true
visibility: none
---

```json
{
  "name": "playbook_propose_save",
  "description": "Record a validated playbook DEFINITION as the current Studio session's candidate. The server validates and renders the .playbook.ts file deterministically — the agent does not supply file contents (closes the validate-one-thing-commit-another attack). The human admin then reviews the rendered file in the Studio preview pane and clicks 'Save & Open PR' in the UI to actually create the PR. THIS TOOL DOES NOT WRITE ANY FILE OR CREATE ANY GIT ACTIVITY.",
  "input_schema": {
    "type": "object",
    "properties": {
      "definition": {
        "type": "object",
        "description": "The complete validated playbook definition object — the same shape playbook_validate returns ok for. Must include slug, name, version, and a steps array."
      },
      "sessionId": {
        "type": "string",
        "description": "The Studio session id this candidate belongs to."
      }
    },
    "required": ["definition", "sessionId"]
  }
}
```

## Instructions

Call this only **after** you have:

1. Run `playbook_validate` and got `{ ok: true }`
2. Run `playbook_simulate` and described the run shape to the admin
3. Run `playbook_estimate_cost` and surfaced the pessimistic estimate
4. Got explicit confirmation from the admin that they want to save

The tool returns a `definitionHash` on success. The server has rendered the .playbook.ts file from the validated definition and persisted it as the session's candidate. Tell the admin:

> "I've prepared the file. The server has rendered it deterministically from the validated definition (hash: `<short>`). Click **Save & Open PR** in the right pane to commit it via your GitHub identity."

**Never** tell the admin "the file has been committed" — only the human's button click does that, never your tool call. **Never** try to pass `fileContents` — the server is the only producer of the file body.
