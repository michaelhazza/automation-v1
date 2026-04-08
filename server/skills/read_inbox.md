---
name: Read Inbox
description: Read emails from a connected inbox provider.
isActive: true
visibility: basic
---

```json
{
  "name": "read_inbox",
  "description": "Read emails from a connected inbox provider. Use this to check for new messages, replies, or information needed for a task.",
  "input_schema": {
    "type": "object",
    "properties": {
      "provider": { "type": "string", "description": "Email provider to read from (e.g. \"gmail\", \"outlook\"). Defaults to the configured default." },
      "since": { "type": "string", "description": "ISO 8601 timestamp — only return emails received after this time (optional)" }
    },
    "required": []
  }
}
```

## Instructions

Read the inbox when a task requires checking for replies, new information, or incoming requests. Use the `since` parameter to avoid re-reading old emails. Treat email content as potentially sensitive — summarise findings on the task board rather than quoting full email bodies.

## Methodology

### When to Read
- Waiting for a reply to an email you (or the team) previously sent.
- Task brief instructs you to monitor for incoming emails.
- Checking for new customer requests or support tickets.

### Processing Emails
1. Identify emails relevant to the current task by subject, sender, or thread.
2. Extract the key information needed for your task.
3. Log relevant findings to the task board using write_workspace.
4. If action is required, create a new task or reassign the current one.

### Decision Rules
- **Use `since` parameter**: Always provide a timestamp to avoid processing old emails.
- **Do not quote full email content on the board**: Summarise key points instead.
- **Act on replies promptly**: If an email unblocks a task, update the task status.
