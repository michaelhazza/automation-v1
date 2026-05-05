---
name: Propose Workflow save
description: Records the validated definition for the human admin to save via the Save & Open PR button. DOES NOT WRITE ANY FILE — the server renders the file deterministically and only updates the Studio session row.
isActive: true
visibility: none
---

## Parameters

- definition: string (required) — JSON object. The complete validated Workflow definition object — the same shape workflow_validate returns ok for. Must include slug, name, version, and a steps array.
- sessionId: string (required) — The Studio session id this candidate belongs to.
- unresolved_high_severity_count: number (optional) — If this definition was produced by `import_n8n_workflow`, pass the number of high-severity items still unresolved. Any value > 0 will block the save. Do not pass this field for Workflows authored from scratch.

## Instructions

Call this only **after** you have:

1. Run `workflow_validate` and got `{ ok: true }`
2. Run `workflow_simulate` and described the run shape to the admin
3. Run `workflow_estimate_cost` and surfaced the pessimistic estimate
4. Got explicit confirmation from the admin that they want to save

**If this definition came from `import_n8n_workflow`:** you must also ensure all high-severity items (`⚠` rows in the mapping report) have been either resolved or explicitly dismissed by the admin before calling this tool. Pass `unresolved_high_severity_count: 0` to confirm all high-severity items are cleared. Passing any value > 0 will block the save.

The tool returns a `definitionHash` on success. The server has rendered the .Workflow.ts file from the validated definition and persisted it as the session's candidate. Tell the admin:

> "I've prepared the file. The server has rendered it deterministically from the validated definition (hash: `<short>`). Click **Save & Open PR** in the right pane to commit it via your GitHub identity."

**Never** tell the admin "the file has been committed" — only the human's button click does that, never your tool call. **Never** try to pass `fileContents` — the server is the only producer of the file body.
