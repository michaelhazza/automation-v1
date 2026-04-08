---
name: Propose playbook save
description: Records the agent's final candidate file for the human admin to save via the Save & Open PR button. DOES NOT WRITE ANY FILE — only updates the Studio session row.
isActive: true
visibility: none
---

```json
{
  "name": "playbook_propose_save",
  "description": "Record a finalised playbook file as the current Studio session's candidate. The human admin reviews and clicks 'Save & Open PR' in the UI to actually create the PR. THIS TOOL DOES NOT WRITE ANY FILE OR CREATE ANY GIT ACTIVITY. The trust boundary is the human's button click — never call this and assume the file is committed.",
  "input_schema": {
    "type": "object",
    "properties": {
      "fileContents": {
        "type": "string",
        "description": "The complete TypeScript file contents starting with the imports and ending with `export default definePlaybook({ ... })`."
      },
      "sessionId": {
        "type": "string",
        "description": "The Studio session id this candidate belongs to."
      }
    },
    "required": ["fileContents", "sessionId"]
  }
}
```

## Instructions

Call this only **after** you have:

1. Run `playbook_validate` and got `{ ok: true }`
2. Run `playbook_simulate` and described the run shape to the admin
3. Run `playbook_estimate_cost` and surfaced the pessimistic estimate
4. Got explicit confirmation from the admin that they want to save

After calling, tell the admin:

> "I've prepared the file. Click **Save & Open PR** in the right pane to commit it via your GitHub identity."

**Never** tell the admin "the file has been committed" — only the human's button click does that, never your tool call.
