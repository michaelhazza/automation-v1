---
name: Fetch Paywalled Content
description: Logs into a paywalled site using a stored web_login connection, navigates to a content URL, and downloads the artifact (e.g. video) under deny-by-default contract enforcement. Returns the persisted iee_artifacts row + contentHash. Short-circuits with noNewContent=true if the freshly-validated contentHash matches the agent's last processed fingerprint for this intent.
isActive: true
isVisible: false
---

```json
{
  "name": "fetch_paywalled_content",
  "description": "Enqueues a worker browser task that performs deterministic login (via a pre-configured web_login integration connection), navigates to a content URL, and downloads the target artifact. The contract enforces an allowed-domains list, expected MIME prefix, and timeouts. Returns the artifact id + contentHash on success. If the contentHash matches what this agent last processed for the same intent, returns { noNewContent: true } and you should emit `done` immediately without further processing.",
  "input_schema": {
    "type": "object",
    "properties": {
      "webLoginConnectionId": {
        "type": "string",
        "format": "uuid",
        "description": "ID of a web_login integration connection that holds the username + encrypted password for the paywalled site."
      },
      "contentUrl": {
        "type": "string",
        "format": "uri",
        "description": "Post-login URL to navigate to and download from."
      },
      "intent": {
        "type": "string",
        "enum": ["download_latest", "download_by_url", "extract_text", "screenshot"],
        "description": "What the worker should attempt. Use download_latest for most paywall video workflows."
      },
      "allowedDomains": {
        "type": "array",
        "items": { "type": "string" },
        "minItems": 1,
        "description": "Hosts the worker is allowed to navigate to. Anything outside this list is a hard contract violation."
      },
      "expectedArtifactKind": {
        "type": "string",
        "enum": ["video", "audio", "document", "image", "text"],
        "description": "Expected artifact kind. Used for magic-byte validation after download."
      },
      "expectedMimeTypePrefix": {
        "type": "string",
        "description": "MIME prefix the magic bytes must satisfy (e.g. 'video/', 'audio/')."
      },
      "downloadSelector": {
        "type": "string",
        "description": "CSS selector of the download button on the content page."
      },
      "timeoutMs": {
        "type": "integer",
        "minimum": 30000,
        "maximum": 600000,
        "description": "Wall-clock cap for the whole browser run. Default 300000 (5 min)."
      }
    },
    "required": [
      "webLoginConnectionId",
      "contentUrl",
      "intent",
      "allowedDomains",
      "downloadSelector"
    ]
  }
}
```

## Instructions

This is a deterministic action skill — it does NOT call the LLM. It enqueues a single IEE browser task with a strict contract and waits (poll) for the worker to finish.

Behaviour:
1. Builds a `BrowserTaskContract` from the input (allowedDomains, expectedArtifactKind, expectedMimeTypePrefix, intent, timeouts).
2. Builds a goal string telling the LLM-driven worker loop to navigate to the contentUrl and click the download selector.
3. Calls `enqueueIEETask` with `webLoginConnectionId` so the worker performs deterministic login BEFORE the loop starts.
4. Polls `iee_runs` until the row reaches a terminal state (`completed` / `failed` / `timeout`).
5. On success, returns the latest `iee_artifacts` row for the run with `kind='download'` plus the `contentHash`, `sizeBytes`, and `mimeType`.
6. If the worker short-circuited via fingerprint match (T16), the agent run's `runMetadata.reportingAgent.terminationResult` will be `'no_new_content'` — this skill returns `{ noNewContent: true }` and the agent should immediately emit `done`.

Output:
- `noNewContent` (bool): true if the content matches the last processed fingerprint
- `ieeRunId` (uuid)
- `artifactId` (uuid, only when noNewContent=false)
- `path` (string)
- `contentHash` (string)
- `sizeBytes` (int)
- `mimeType` (string)
