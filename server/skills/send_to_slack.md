---
name: Send to Slack
description: Posts a message to a Slack channel via the configured Slack integration. Supports text and optional file attachments. Channel defaults to the integration's configured default if not specified. Persists the report body to the deliverable BEFORE calling Slack so operators can manually re-send if Slack fails.
isActive: true
visibility: basic
---

```json
{
  "name": "send_to_slack",
  "description": "Post a message to a Slack channel via the configured Slack integration. Supports markdown text and optional file attachments. Channel defaults to the integration's configured default. Idempotent within an agent run via deterministic post-hash dedup — calling twice with semantically identical input is a no-op.",
  "input_schema": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "description": "Message text. Slack mrkdwn supported. This is the text that will be hashed for dedup."
      },
      "channel": {
        "type": "string",
        "description": "Channel name (#name) or ID. Defaults to the integration's configured default channel if omitted."
      },
      "bodyText": {
        "type": "string",
        "description": "Full report body to persist as a deliverable BEFORE the Slack post. Required if attachments are not used. Spec T18."
      },
      "filename": {
        "type": "string",
        "description": "Filename for the attached deliverable. Used in dedup hash and Slack file upload."
      },
      "taskId": {
        "type": "string",
        "format": "uuid",
        "description": "Optional task ID to attach the persisted deliverable to."
      },
      "onDuplicate": {
        "type": "string",
        "enum": ["skip", "force"],
        "description": "Behaviour when a previous post in this run had the same post hash. Default 'skip'."
      }
    },
    "required": ["message"]
  }
}
```

## Instructions

This is the deterministic delivery skill for the Reporting Agent. Use it to post the final report to a Slack channel after generating the report markdown.

Order of operations (strict — enforced by the executor):

1. **Persist the report body** to `task_deliverables.body_text` (and the artifact's `inline_text`) via `writeWithLimit`. This happens BEFORE the Slack API call so operators can manually re-send if Slack fails or rate-limits.

2. **Compute the post hash** as `sha256(runId + channel + filename + sha256(finalRenderedMarkdown))`. The hash is computed on the FINAL rendered text, not the raw input. T11.

3. **Check the cache** on `agent_runs.metadata.slackPosts` for an entry with the same post hash. If found:
   - Default behaviour: skip the post and return the cached `messageTs` + `permalink`
   - With `onDuplicate: 'force'`: post anyway

4. **Post to Slack** via `chat.postMessage`. Optionally upload the file attachment via `files.upload` threaded under the post.

5. **Verify the response** — assert `messageTs` and `permalink` are present (T26). Throw `internal_error:slack_post_incomplete` if either is missing.

6. **Record the post hash** to `agent_runs.metadata.slackPosts[]` so future calls in the same run dedupe.

The Slack bot token is read from an `integration_connections` row of `providerType = 'slack'`. Subaccount-scoped connections take precedence over org-scoped fallbacks.
