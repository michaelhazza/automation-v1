---
name: Propose playbook save
description: Records the validated definition for the human admin to save via the Save & Open PR button. DOES NOT WRITE ANY FILE — the server renders the file deterministically and only updates the Studio session row.
isActive: true
visibility: none
---

## Parameters

- definition: string (required) — JSON object. The complete validated playbook definition object — the same shape playbook_validate returns ok for. Must include slug, name, version, and a steps array.
- sessionId: string (required) — The Studio session id this candidate belongs to.

## Instructions

Call this only **after** you have:

1. Run `playbook_validate` and got `{ ok: true }`
2. Run `playbook_simulate` and described the run shape to the admin
3. Run `playbook_estimate_cost` and surfaced the pessimistic estimate
4. Got explicit confirmation from the admin that they want to save

The tool returns a `definitionHash` on success. The server has rendered the .playbook.ts file from the validated definition and persisted it as the session's candidate. Tell the admin:

> "I've prepared the file. The server has rendered it deterministically from the validated definition (hash: `<short>`). Click **Save & Open PR** in the right pane to commit it via your GitHub identity."

**Never** tell the admin "the file has been committed" — only the human's button click does that, never your tool call. **Never** try to pass `fileContents` — the server is the only producer of the file body.
