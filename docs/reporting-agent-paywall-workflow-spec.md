# Reporting Agent — Paywall → Video → Transcript → Slack Workflow
## Detailed Development Specification

**Status:** Draft v1 — for review before implementation
**Branch:** `claude/agent-paywall-video-workflow-OQTMA`
**Related docs:**
- `docs/iee-development-spec.md` — IEE worker, browser/dev handlers, execution_runs schema
- `architecture.md` — three-tier agent model, skill scoping, integration connections

---

## 1. Overview

### 1.1 Goal

Enable a **subaccount-scoped Reporting Agent** that, on a weekly heartbeat, logs into a paywalled site, downloads the latest video, transcribes it, runs a subaccount-specific report skill over the transcript, and posts the resulting markdown report to Slack.

The first concrete instance is the **Breakout Solutions** subaccount running against the 42 Macro paywall, producing a "42 Macro A-Player Brain" report.

### 1.2 Design philosophy

- **Configuration over code.** Once the platform pieces exist, every additional client (subaccount) is a few UI clicks: add credentials, attach a skill, set heartbeat. No code edits per client.
- **Reuse existing systems.** IEE worker, integration_connections, three-tier agent model, heartbeat scheduling, skill executor — all in place. This spec adds the smallest set of extensions that completes the workflow.
- **Multi-tenant isolation enforced at the database layer.** Every credential, skill, and run is scoped by `organisationId` and (where applicable) `subaccountId`.
- **Secrets never reach the LLM.** Login is performed deterministically by the worker before the LLM execution loop begins. The model only sees an already-authenticated browser context.

### 1.3 Scope summary

| Code change | Description | Class |
|---|---|---|
| **A** | Skill `contentsVisible` flag — orgs/subaccounts always see name + description of attached skills; full body and Manage page only when visible | Standard |
| **B** | `transcribe_audio` system skill backed by OpenAI Whisper API | Standard |
| **C** | `send_to_slack` system skill + Slack bot-token integration type | Standard |
| **D** | `web_login` integration type, secrets encryption helper (if missing), `performLogin` pre-loop hook in `browserTask`, "Test connection" button | Standard |
| **E** | Breakout Solutions Reporting Agent + `process_42_macro_transcript` subaccount skill | **Pure configuration** — done in the UI after A–D ship |

### 1.4 Confirmed decisions (from review session)

1. Build A, B, C, D as code now, on `claude/agent-paywall-video-workflow-OQTMA`.
2. **Transcription provider:** OpenAI Whisper API (`whisper-1`). No local Whisper.
3. **Slack integration:** bot token + `chat.postMessage` (supports channel targeting and `files.upload` for the markdown attachment).
4. **Credentials UI:** the `web_login` integration is added through the existing Integrations page — no JSON editing, no DB access. Includes a "Test connection" button.

### 1.5 Out of scope for v1

- 2FA / captcha handling on paywall login (caller must use sites without it; long-lived session-cookie fallback is a v2 follow-up).
- Multi-video selection logic ("the latest video that has not yet been processed" — v1 just takes the most recent and relies on idempotency keys to avoid duplicate Slack posts).
- Object-storage upload of artifacts. Artifacts remain in `execution_artifacts` rows + worker container disk for the run lifetime, then are referenced by path only.
- Cross-subaccount sharing of subaccount-scoped skills.
- Manual "run now" UI for the Reporting Agent (heartbeat-only in v1; ad-hoc runs use the existing agent run trigger).

---

## 2. Architecture & Data Model Changes

### 2.1 Touched systems

| System | File(s) | Change |
|---|---|---|
| Drizzle schema | `server/db/schema/systemSkills.ts`, `server/db/schema/skills.ts` | Add `contentsVisible` boolean |
| Drizzle schema | `server/db/schema/integrationConnections.ts` | Confirm/extend `type` discriminator with `web_login`, `slack` |
| Migrations | `migrations/NNNN_skill_contents_visible.sql`, `migrations/NNNN_integration_secrets_encryption.sql` (if needed) | Forward-only |
| Skill executor | `server/services/skillExecutor.ts` | Add cases for `transcribe_audio`, `send_to_slack` |
| Skill files | `server/skills/transcribe_audio.md`, `server/skills/send_to_slack.md` | New |
| Worker | `worker/src/handlers/browserTask.ts`, `worker/src/browser/login.ts` (new) | `performLogin()` pre-loop hook |
| Shared types | `shared/iee/jobPayload.ts` | Extend `BrowserTaskPayload` with optional `credentials` |
| Integration services | `server/services/integrationConnectionService.ts`, new `server/services/secretsCrypto.ts` (if missing) | Encrypted secret read/write |
| Routes | `server/routes/integrationConnections.ts` | Add `POST /api/integration-connections/:id/test` |
| Client | `client/src/pages/IntegrationsPage.tsx`, new `client/src/components/integrations/WebLoginForm.tsx`, `SlackForm.tsx` | UI for new types |
| Client | `client/src/pages/SkillDetailPage.tsx`, `client/src/pages/SkillsListPage.tsx` | Honour `contentsVisible` |

### 2.2 No new tables

This spec adds **zero new tables**. Everything fits into:
- `system_skills` / `skills` (one new column)
- `integration_connections` (uses existing `configJson` + `secretsJson`)
- `execution_runs` / `execution_steps` / `execution_artifacts` (already exist from IEE)
- `agents` / `subaccount_agents` (already exist)

### 2.3 Migrations

Two migrations, both forward-only, generated via `npm run db:generate`:

1. **`NNNN_skill_contents_visible.sql`**
   ```sql
   ALTER TABLE system_skills ADD COLUMN contents_visible boolean NOT NULL DEFAULT false;
   ALTER TABLE skills ADD COLUMN contents_visible boolean NOT NULL DEFAULT false;
   ```
   Default `false` is intentional — existing skills become hidden-by-default and the system_admin opts in per skill.

2. **`NNNN_integration_secrets_encryption.sql`** — only if `integration_connections.secretsJson` is currently stored as plaintext jsonb. If a `secretsCrypto` helper already exists and rows are already encrypted, this migration is skipped. To be confirmed during implementation by inspecting `server/services/integrationConnectionService.ts`.

### 2.4 Encryption helper (if not already present)

`server/lib/secretsCrypto.ts`:

- AES-256-GCM
- Key from `ENCRYPTION_KEY` env var (32 bytes, base64-encoded)
- `encrypt(plaintext: string): string` returns `iv:authTag:ciphertext` base64
- `decrypt(ciphertext: string): string`
- Used by **every** integration connection service — no per-integration encryption.
- Boot-time check: if `ENCRYPTION_KEY` is missing, server refuses to start with a clear error.

### 2.5 Audit

Every read of `secretsJson` writes an `audit_events` row with `actor`, `connectionId`, `purpose` (e.g. `'iee-browser-task'`, `'send_to_slack'`, `'test_connection'`). Follows the existing audit pattern.

---

## 3. Code Change A — Skill Visibility Flag

### 3.1 Problem

Today, an org admin sees the full body of any system skill attached to one of their agents, and a subaccount admin sees the full body of any org skill attached to a subaccount agent. This leaks platform IP and lets lower tiers tinker with skills they don't own.

At the same time, agents at lower tiers **must** be able to see the **name and description** of every attached skill — that's how the LLM loop knows which skills are available to call. So pure hiding is not viable.

### 3.2 Rule

Visibility is controlled by `contentsVisible` at the **owning tier**:

| Owner | `contentsVisible` | What lower tiers see |
|---|---|---|
| System | `false` (default) | Name + description only. No body. No "Manage Skill" page. |
| System | `true` | Full body, read-only at the org tier. No edit buttons. |
| Org | `false` (default) | Subaccounts see name + description only. |
| Org | `true` | Subaccounts see the full body, read-only. |

**Editing** is always restricted to admins at the owning tier with the existing skill-management permission. Visibility never grants write access.

The agent runtime always has full access to skill bodies regardless of `contentsVisible` — the flag is purely a UI/API concern for human users.

### 3.3 Schema

See §2.3 — single migration adds the boolean to both tables, default `false`.

Drizzle changes:
```ts
// server/db/schema/systemSkills.ts
contentsVisible: boolean('contents_visible').notNull().default(false),

// server/db/schema/skills.ts
contentsVisible: boolean('contents_visible').notNull().default(false),
```

### 3.4 Service layer

`systemSkillService.ts` and `skillService.ts` gain a helper:

```ts
function canViewContents(skill, viewer): boolean {
  // Owner tier always sees contents
  if (viewer.tier === skill.ownerTier && hasManagePermission(viewer, skill)) return true;
  // Lower tiers gated by the flag
  return skill.contentsVisible === true;
}
```

List endpoints return a stripped shape for callers who can't view contents:

```ts
type SkillListItem = {
  id: string;
  name: string;
  description: string;
  scope: 'system' | 'org' | 'subaccount';
  isAttached: boolean;
  canViewContents: boolean;
  // body / inputs / outputs only present if canViewContents === true
  body?: string;
  inputs?: SkillInputDef[];
  outputs?: SkillOutputDef[];
};
```

The detail endpoint (`GET /api/skills/:id`) returns 403 with `errorCode: 'skill_contents_hidden'` if the caller is at a lower tier and the flag is `false`. Lower tier admins can still see the skill exists in the list view (so they can request it be made visible) but cannot open the body.

### 3.5 Client

- **Skills list page**: each row shows name + description + a lock icon if `canViewContents === false`. The "Manage" button is replaced by a "Managed at system level" / "Managed at org level" label.
- **Skill detail page**: route guard — if the API returns `skill_contents_hidden`, show a placeholder card explaining the skill is managed at a higher tier and listing the owning tier admin contact (from existing org/system metadata).
- **Skill edit form** (owning tier only): add a `contentsVisible` toggle with helper text "Allow lower tiers to view the full skill body. Name and description are always visible to attached agents."

### 3.6 Tests

- Service unit: `canViewContents` matrix across (ownerTier × viewerTier × flag × hasManagePermission).
- Route integration: list returns stripped shape for hidden, full shape for visible; detail returns 403 for hidden.
- Client: skill list renders lock icon when `canViewContents: false`; detail page shows placeholder.

### 3.7 Estimated surface area

1 migration, 2 schema files, 2 service files, 2 route files, 3 client files, 1 new component. ~400 LOC including tests.

---

## 4. Code Change B — `transcribe_audio` System Skill

### 4.1 Purpose

Convert an audio or video artifact (typically the output of an `iee-browser-task` download step) into a text transcript that downstream skills can consume.

### 4.2 Provider

OpenAI Whisper API (`whisper-1`). Confirmed in §1.4.

- API key stored as a system-level integration connection of type `openai` (already exists, or add it as part of this change if not — the existing `llmRouter` already calls OpenAI for chat models, so a key is likely present in env. The `transcribe_audio` skill prefers an `openai` integration row; falls back to `OPENAI_API_KEY` env var if the row is absent. Both paths funnel through `secretsCrypto` for the connection row.)
- Endpoint: `POST https://api.openai.com/v1/audio/transcriptions`
- Max file size: 25 MB. For larger files, the skill chunks the audio with `ffmpeg` (worker container already has ffmpeg from the IEE dev handler dependencies — see `worker/Dockerfile`).

### 4.3 Skill definition

`server/skills/transcribe_audio.md`:

```markdown
---
name: transcribe_audio
scope: system
contentsVisible: false
description: Converts an audio or video file (mp3, mp4, m4a, wav, webm, mpeg, mpga) into a text transcript. Accepts either an executionArtifactId from a prior browser/dev task or a direct URL.
inputs:
  - name: executionArtifactId
    type: uuid
    required: false
    description: ID of an execution_artifacts row produced by a prior step in the same agent run
  - name: audioUrl
    type: string
    required: false
    description: HTTPS URL to an audio/video file. Used if executionArtifactId is not provided.
  - name: language
    type: string
    required: false
    description: ISO-639-1 language code (e.g. "en"). Defaults to auto-detect.
outputs:
  - name: transcript
    type: string
    description: Plain-text transcript with paragraph breaks
  - name: durationSeconds
    type: number
  - name: wordCount
    type: number
  - name: transcriptArtifactId
    type: uuid
    description: ID of a new execution_artifacts row containing the transcript as a .txt file
---

# transcribe_audio

This skill is implemented in `skillExecutor.ts`. It does not contain a prompt body — it is a deterministic action skill, not an LLM-prompt skill.
```

### 4.4 Executor implementation

In `server/services/skillExecutor.ts`, add a case for `actionType: 'transcribe_audio'`:

```ts
case 'transcribe_audio': {
  const { executionArtifactId, audioUrl, language } = input;
  if (!executionArtifactId && !audioUrl) {
    throw { statusCode: 400, message: 'transcribe_audio requires executionArtifactId or audioUrl' };
  }

  // 1. Resolve source
  const filePath = executionArtifactId
    ? await ieeArtifactService.resolveLocalPath(executionArtifactId, ctx.organisationId)
    : await downloadToTemp(audioUrl);

  // 2. Chunk if > 24 MB (leave 1 MB headroom under the 25 MB limit)
  const chunks = await maybeChunkAudio(filePath, 24 * 1024 * 1024);

  // 3. Call Whisper per chunk
  const apiKey = await getOpenAiKey(ctx.organisationId);
  const parts: TranscriptPart[] = [];
  for (const chunk of chunks) {
    parts.push(await callWhisper(apiKey, chunk, language));
  }

  // 4. Stitch + persist
  const transcript = parts.map(p => p.text).join('\n\n');
  const artifact = await ieeArtifactService.create({
    organisationId: ctx.organisationId,
    executionRunId: ctx.executionRunId,
    kind: 'file',
    path: writeTempTranscript(transcript),
    mimeType: 'text/plain',
    metadata: { source: 'transcribe_audio', sourceArtifactId: executionArtifactId ?? null },
  });

  return {
    transcript,
    durationSeconds: parts.reduce((s, p) => s + p.durationSeconds, 0),
    wordCount: transcript.split(/\s+/).length,
    transcriptArtifactId: artifact.id,
  };
}
```

### 4.5 Cost tracking

Whisper is billed at $0.006/minute. Each call records a row in the existing `llm_requests` table with `model: 'whisper-1'`, `provider: 'openai'`, `costCents`, `correlationId`, `runId`. Reuse the existing cost tracking middleware in `llmRouter` — extract `recordLlmRequest()` if not already a standalone helper.

### 4.6 Failure modes

| Failure | Behaviour |
|---|---|
| Source artifact missing | Throw `{ statusCode: 404, errorCode: 'artifact_not_found' }` |
| File too large after chunking | Throw `{ statusCode: 413, errorCode: 'audio_too_large' }` |
| Whisper API 429 | Retry with exponential backoff (3 attempts, 2s/4s/8s) |
| Whisper API 5xx | Throw as `TripWire` so pg-boss retries the parent skill execution |
| Unsupported format | Throw `{ statusCode: 400, errorCode: 'unsupported_audio_format' }` |

### 4.7 Tests

- Unit: chunking logic against synthetic large file
- Unit: Whisper response parser
- Integration: mock OpenAI endpoint, run skill end-to-end against a fixture artifact, assert artifact row created and transcript returned

### 4.8 Estimated surface area

1 skill markdown file, 1 executor case (~150 LOC), 1 small helper module for chunking, ~80 LOC tests. ~250 LOC total.

---

## 5. Code Change C — `send_to_slack` System Skill + Slack Integration

### 5.1 Purpose

Post a message to a Slack channel, optionally with one or more file attachments (e.g. the markdown report produced by the Reporting Agent).

### 5.2 Slack integration type

New `type: 'slack'` in `integration_connections`. Stored shape:

```ts
{
  type: 'slack',
  configJson: {
    workspaceName: string,           // display only
    workspaceId: string,             // T0123...
    defaultChannel: string,          // e.g. "#weekly-reports"
    botUserId: string,               // U0123... (returned at install time)
  },
  secretsJson: {
    botToken: string,                // xoxb-... encrypted via secretsCrypto
  }
}
```

### 5.3 Install flow (UI)

Two paths, supported in order of preference:

1. **OAuth install** (preferred long-term): user clicks "Install Slack" → redirected through Slack OAuth → callback stores tokens. Requires a small `routes/slackOAuth.ts` and a registered Slack app.
2. **Manual bot token paste** (v1 fallback, simpler): user creates a Slack app themselves, pastes the bot token, picks a default channel from a dropdown populated by calling `conversations.list` with the token. **Ship the manual path in v1.** OAuth can come in v2.

### 5.4 Skill definition

`server/skills/send_to_slack.md`:

```markdown
---
name: send_to_slack
scope: system
contentsVisible: false
description: Posts a message to a Slack channel via the configured Slack integration. Supports text and optional file attachments. Channel defaults to the integration's configured default if not specified.
inputs:
  - name: message
    type: string
    required: true
    description: Message text. Slack mrkdwn supported.
  - name: channel
    type: string
    required: false
    description: Channel name (#name) or ID. Defaults to the integration's configured default channel.
  - name: attachments
    type: array
    required: false
    description: Array of { artifactId, filename } objects. Each artifact is uploaded via files.upload and linked to the message.
  - name: threadTs
    type: string
    required: false
    description: Optional thread parent timestamp to reply in-thread.
outputs:
  - name: messageTs
    type: string
  - name: permalink
    type: string
---
```

### 5.5 Executor implementation

In `skillExecutor.ts`:

```ts
case 'send_to_slack': {
  const conn = await integrationConnectionService.getActiveSlack(ctx.organisationId, ctx.subaccountId);
  if (!conn) throw { statusCode: 412, errorCode: 'slack_not_configured' };
  const botToken = await secretsCrypto.decrypt(conn.secretsJson.botToken);
  const channel = input.channel ?? conn.configJson.defaultChannel;

  // 1. Post message
  const post = await slackApi.chatPostMessage({
    token: botToken,
    channel,
    text: input.message,
    thread_ts: input.threadTs,
  });

  // 2. Upload attachments (if any), threaded under the message
  for (const att of input.attachments ?? []) {
    const filePath = await ieeArtifactService.resolveLocalPath(att.artifactId, ctx.organisationId);
    await slackApi.filesUpload({
      token: botToken,
      channels: channel,
      file: fs.createReadStream(filePath),
      filename: att.filename,
      thread_ts: post.ts,
      initial_comment: undefined,
    });
  }

  // 3. Permalink
  const permalink = await slackApi.chatGetPermalink({ token: botToken, channel, message_ts: post.ts });

  // 4. Audit
  await auditService.record({ actor: 'agent', purpose: 'send_to_slack', resourceId: conn.id });

  return { messageTs: post.ts, permalink: permalink.permalink };
}
```

`slackApi` is a thin wrapper module (`server/lib/slackApi.ts`) using `node-fetch` — no SDK dependency, three methods total. Keeps the dependency surface small.

### 5.6 Subaccount vs org connection resolution

`getActiveSlack(orgId, subaccountId)`:
1. If `subaccountId` provided, look for a `slack` connection scoped to that subaccount → return if found.
2. Else fall back to org-scoped `slack` connection.
3. Else return `null` → caller throws `slack_not_configured`.

Same pattern as the rest of the integration services.

### 5.7 Failure modes

| Failure | Behaviour |
|---|---|
| No Slack connection | `412 slack_not_configured` |
| Bot token revoked / `invalid_auth` | `401 slack_invalid_auth` + mark connection `status: 'broken'` so the UI surfaces it |
| Channel not found | `404 slack_channel_not_found` |
| `ratelimited` | Retry with `Retry-After` header, max 3 attempts |
| File upload > 1 GB | Reject before upload (Slack hard limit) |

### 5.8 Tests

- Unit: connection resolution (subaccount → org → null)
- Integration: mocked Slack API, end-to-end skill execution with one text message + one file attachment, assert correct API calls and audit row

### 5.9 Estimated surface area

1 skill markdown file, 1 executor case, `slackApi.ts` wrapper (~80 LOC), 1 form component on the Integrations page (~120 LOC), connection service helper, ~100 LOC tests. ~400 LOC total.

---

## 6. Code Change D — `web_login` Integration & Paywall Credentials

This is the **biggest** of the four changes and is the one that unblocks the paywall step. Build it first.

### 6.1 New integration type

`type: 'web_login'` in `integration_connections`. Stored shape:

```ts
{
  type: 'web_login',
  name: '42 Macro paywall',
  organisationId: '<org>',
  subaccountId: '<breakout solutions id>',  // optional; null = org-wide
  configJson: {
    loginUrl: 'https://42macro.com/login',
    contentUrl: 'https://42macro.com/members/videos',
    username: 'reports@breakoutsolutions.com',
    usernameSelector: '#email',
    passwordSelector: '#password',
    submitSelector: 'button[type=submit]',
    successSelector: '.member-dashboard',
    timeoutMs: 30000,
  },
  secretsJson: {
    password: '<encrypted via secretsCrypto>',
  },
  status: 'active' | 'broken' | 'untested',
  lastTestedAt: timestamp | null,
}
```

`status` and `lastTestedAt` are nice-to-haves; if those columns don't already exist on `integration_connections`, add them in the same migration as the encryption changes (§2.4) — they're useful for **every** integration type, not just `web_login`.

### 6.2 UI — Add Web Login form

On `IntegrationsPage.tsx`, "Add Integration" dropdown gains a **Web Login** option. Selecting it opens `WebLoginForm.tsx`:

**Fields (visible by default):**
- Name (free text, e.g. "42 Macro paywall")
- Login URL (required, https only — client-side validation)
- Content URL (optional but recommended)
- Username (required)
- Password (required, type=password, never echoed back from the server after save)
- Scope: Org-wide / Subaccount (defaulted to current subaccount if viewing one)

**Advanced section (collapsible):**
- Username selector (default `input[type=email], input[name=email], #email`)
- Password selector (default `input[type=password], #password`)
- Submit selector (default `button[type=submit], input[type=submit]`)
- Success selector (default empty — recommended to set; success detection falls back to URL change if empty)
- Timeout ms (default 30000)

**Buttons:**
- **Test connection** — disabled until required fields are filled. POSTs to `/api/integration-connections/test-web-login` with the form values (without saving). Server enqueues a one-off `iee-browser-task` with `goal: 'login_test'`. Result polled and shown inline as success/failure with the screenshot artifact link if it failed.
- **Save** — persists the row. Encrypts `password`. If "Test connection" was successful in this session, marks `status: 'active'`. Otherwise `status: 'untested'`.

### 6.3 Routes

Add to `server/routes/integrationConnections.ts`:

```ts
// Save
POST   /api/integration-connections                  (existing route, extended for type=web_login)
PATCH  /api/integration-connections/:id              (existing)
DELETE /api/integration-connections/:id              (existing)

// Test (no-save)
POST   /api/integration-connections/test-web-login   (new — does not require an :id)

// Test (saved)
POST   /api/integration-connections/:id/test         (new — generic, dispatches by type)
```

The test routes return `{ jobId, executionRunId }` immediately and the UI polls `GET /api/iee/runs/:executionRunId` (existing) for status.

### 6.4 Worker — `performLogin` pre-loop hook

`worker/src/handlers/browserTask.ts` flow change:

```ts
async function handle(payload: BrowserTaskPayload) {
  const ctx = await openExecutionRun(payload);
  const page = await playwrightContext.newPage(ctx);

  // NEW: deterministic login before LLM loop
  if (payload.credentials) {
    await performLogin(page, payload.credentials);
    // performLogin throws on failure with failureReason='login_failed'
    // and captures a screenshot artifact for debugging
  }

  // If a contentUrl was provided, navigate there before handing to the LLM
  if (payload.credentials?.contentUrl) {
    await page.goto(payload.credentials.contentUrl, { waitUntil: 'networkidle' });
  }

  // Now hand to the LLM execution loop with the already-authenticated page
  await executionLoop(ctx, page);
}
```

`worker/src/browser/login.ts` (new):

```ts
export async function performLogin(page: Page, creds: WebLoginCredentials): Promise<void> {
  const span = createSpan('iee.browser.login', { hasSuccessSelector: !!creds.successSelector });
  try {
    await page.goto(creds.loginUrl, { waitUntil: 'networkidle', timeout: creds.timeoutMs });
    await page.fill(creds.usernameSelector, creds.username);
    await page.fill(creds.passwordSelector, creds.password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: creds.timeoutMs }).catch(() => null),
      page.click(creds.submitSelector),
    ]);
    if (creds.successSelector) {
      await page.waitForSelector(creds.successSelector, { timeout: creds.timeoutMs });
    } else {
      // Fall back to: URL must have changed away from loginUrl
      if (page.url() === creds.loginUrl) throw new LoginFailed('url_unchanged');
    }
    span.end({ status: 'ok' });
  } catch (err) {
    const screenshotPath = await captureFailureScreenshot(page);
    span.end({ status: 'error', screenshotPath });
    throw {
      failureReason: 'login_failed',
      cause: err.message,
      screenshotPath,
    };
  }
}
```

**The credentials object never enters the LLM prompt context.** It is held in worker process memory only, used by `performLogin`, then discarded. The session cookies persist on the Playwright context for the duration of the run.

### 6.5 Shared types

`shared/iee/jobPayload.ts` extension:

```ts
export const WebLoginCredentialsSchema = z.object({
  loginUrl: z.string().url(),
  contentUrl: z.string().url().optional(),
  username: z.string(),
  password: z.string(),
  usernameSelector: z.string(),
  passwordSelector: z.string(),
  submitSelector: z.string(),
  successSelector: z.string().optional(),
  timeoutMs: z.number().int().positive().default(30000),
});

export const BrowserTaskPayloadSchema = z.object({
  // ...existing fields...
  credentials: WebLoginCredentialsSchema.optional(),
});
```

### 6.6 Enqueue path (main app)

`agentExecutionService.ts` (or wherever browser tasks are dispatched) gains a small helper:

```ts
async function resolveWebLoginCredentials(orgId: string, subaccountId: string | null, connectionName?: string) {
  const conn = await integrationConnectionService.getActiveWebLogin(orgId, subaccountId, connectionName);
  if (!conn) return undefined;
  return {
    ...conn.configJson,
    password: await secretsCrypto.decrypt(conn.secretsJson.password),
  };
}
```

The agent or skill that schedules a browser task indicates which connection to use (by name or by leaving it implicit if there's only one `web_login` for the subaccount). The decrypted password lives only in the pg-boss payload row in Postgres and in worker process memory — never on disk in the worker.

### 6.7 Audit and rotation

- Every credential read writes an audit row (see §2.5).
- "Last rotated X days ago" surfaced in the IntegrationsPage row using `lastRotatedAt` (set on save when password changes).
- Optional v2: scheduled re-test of `web_login` connections, marks `status: 'broken'` and emails the subaccount admin.

### 6.8 2FA / captcha — **out of scope**

If the paywall requires 2FA or shows a captcha, `performLogin` will fail. v1 documents this as a known limitation. v2 will add a "session cookie" credential mode where the user manually logs in once in their browser, exports the session cookie, and pastes it into the integration form — the worker injects it into the Playwright context instead of running the login flow.

### 6.9 Tests

- Unit: `secretsCrypto` round-trip
- Unit: `performLogin` against a tiny in-process http server with a fake login form (success + failure paths)
- Integration: end-to-end via the test route, including the screenshot artifact on failure
- Client: form validation, password masking, test-connection polling

### 6.10 Estimated surface area

1 schema migration (status/lastTestedAt + secrets encryption if needed), `secretsCrypto.ts` (~120 LOC if new), `slackApi.ts`-style `webLoginService.ts` extension, `performLogin` + screenshot helper (~150 LOC), 2 new routes, 1 form component (~250 LOC), shared zod schema, ~200 LOC tests. **~900 LOC total** — the largest of the four changes.

---

## 7. Configuration Walkthrough — Breakout Solutions Reporting Agent

This section is the **end-state UI clickthrough** that becomes possible once A–D are merged. Zero code edits. All actions performed by the Breakout Solutions org admin (or system_admin scoped into the org).

### 7.1 Prerequisites

- Breakout Solutions subaccount exists in the local DB (already done by user).
- System_admin has reviewed and merged code changes A, B, C, D.
- System_admin has verified the `transcribe_audio` and `send_to_slack` system skills are present in `system_skills`.

### 7.2 Step-by-step

**Step 1 — Add the paywall credentials**

1. Navigate to the Breakout Solutions subaccount → **Integrations** tab.
2. Click **Add Integration → Web Login**.
3. Fill in:
   - Name: `42 Macro paywall`
   - Login URL: `https://42macro.com/login`
   - Content URL: `https://42macro.com/members/videos`
   - Username: `reports@breakoutsolutions.com`
   - Password: `••••••••`
   - Scope: **Subaccount** (defaulted)
4. Expand **Advanced** if the default selectors don't match the site. (For 42 Macro, set explicit selectors after inspecting the login page.)
5. Click **Test connection**. Wait for the green tick (or screenshot-on-failure if it fails).
6. Click **Save**.

**Step 2 — Add the Slack connection**

1. Same Integrations tab → **Add Integration → Slack**.
2. Paste the bot token (from a Slack app the org admin created with `chat:write`, `files:write`, `channels:read` scopes).
3. Pick the default channel from the dropdown (e.g. `#breakout-weekly-reports`).
4. Click **Save**. Status: `active`.

**Step 3 — Create the subaccount-scoped report skill**

1. Subaccount → **Skills** tab → **Create Skill**.
2. Name: `process_42_macro_transcript`
3. Description: `Takes a 42 Macro video transcript or written research and produces a three-tier markdown report (Dashboard, Executive Summary, Full Analysis) following the 42 Macro A-Player Brain framework. Output is YYYYMMDD_Report_Name.md.`
4. Type: **LLM Prompt Skill** (uses the generic prompt skill executor — no code).
5. Inputs:
   - `transcript` (string, required)
   - `sourceDate` (string, optional)
6. Outputs:
   - `reportMarkdown` (string)
   - `filename` (string)
7. **Body**: paste the entire 42 Macro A-Player Brain prompt from the user's message verbatim (PART 1 through PART 5).
8. **Contents Visible**: ON (Breakout Solutions admins should be able to read and edit this themselves).
9. Save.

**Step 4 — Create the Reporting Agent (org level)**

The agent itself is created at the org level so it can be reused across clients in future, but the heartbeat and skill bindings are subaccount-specific.

1. Org → **Agents** → **Create Agent**.
2. Name: `Reporting Agent`
3. Master Prompt:
   ```
   You are the Reporting Agent. On each run, you:
   1. Use the configured web_login integration to log into the source site and download the latest video.
   2. Call transcribe_audio on the downloaded artifact.
   3. Call the subaccount-specific report skill (e.g. process_42_macro_transcript) with the transcript.
   4. Call send_to_slack with the resulting report as a markdown attachment.
   5. Call add_deliverable to link the report to the parent task for audit.
   Do not improvise login flows. The browser is pre-authenticated for you.
   If any step fails, stop and surface the failure reason — do not retry destructively.
   ```
4. Attached **system skills**: `transcribe_audio`, `send_to_slack`, `add_deliverable`. (Browser task is invoked automatically by the agent execution service when the goal includes a download — no separate skill attachment needed.)
5. Heartbeat: **disabled at org level** (we want per-client schedules).
6. Save.

**Step 5 — Link agent to Breakout Solutions and configure schedule**

1. Breakout Solutions → **Agents** tab → **Link Agent → Reporting Agent**.
2. On the link form:
   - Attached subaccount skill: tick `process_42_macro_transcript`.
   - Heartbeat: **enabled**, interval 168 hours (weekly), offset 0 minutes (or stagger if desired).
   - Web login connection: `42 Macro paywall` (auto-detected if there's only one).
   - Slack connection: `Breakout Slack` (auto-detected).
3. Save.

**Step 6 — Verify**

1. Click **Run now** on the linked subaccount agent (uses the existing manual trigger).
2. Watch the agent run page: should see browser-task → transcribe_audio → process_42_macro_transcript → send_to_slack → add_deliverable steps.
3. Check the Slack channel for the posted report.
4. Check the task board for the deliverable.

If all green: the weekly heartbeat will now run automatically.

### 7.3 What gets created in the database after these steps

| Table | Rows added |
|---|---|
| `integration_connections` | 2 (web_login + slack), both subaccount-scoped |
| `skills` | 1 (process_42_macro_transcript, subaccount scope, contentsVisible: true) |
| `agents` | 1 (Reporting Agent, org scope) |
| `subaccount_agents` | 1 (link to Breakout Solutions, heartbeat enabled) |

That's it. Four rows + one skill body. No code, no migrations, no deploys.

### 7.4 Adding a second client later

To add the same workflow for another client (say "Acme Capital"):

1. Add their paywall credentials and Slack connection on the Acme subaccount.
2. Create their subaccount-scoped report skill (different prompt, different methodology).
3. Link the existing org-level Reporting Agent to Acme.

No new code. The Reporting Agent is generic; the **client-specific intelligence lives in the subaccount-scoped skill**.

---

## 8. End-to-End Runtime Flow

This section traces a single weekly run from heartbeat fire to Slack post, showing every component touched.

### 8.1 Sequence

```
T+0    pg-boss heartbeat fires for subaccountAgent(Breakout::ReportingAgent)
       ↓
T+0    agentScheduleService creates an agent_run row
       (status: pending, idempotencyKey: 'reporting:breakout:weekly:2026-W14')
       ↓
T+0    agentExecutionService picks up the run, builds the LLM context
       (system prompt + attached skill manifest with name+description for each)
       ↓
T+1s   LLM step 1: model decides to call browser-task with goal:
       "Log into 42 Macro paywall, navigate to videos page, download the latest"
       ↓
T+1s   agentExecutionService.routeCall detects the IEE-routed action,
       resolves the web_login credentials for this subaccount,
       enqueues 'iee-browser-task' with credentials in payload
       ↓
T+2s   IEE worker picks up the job
       → opens execution_runs row
       → performLogin(page, credentials)  ← deterministic, no LLM
       → page.goto(contentUrl)
       → executionLoop begins with authenticated context
       ↓
T+30s  LLM browser loop: navigate → find latest video → click → download
       ↓ writes execution_artifacts row with the .mp4
       ↓ writes terminal step (success), execution_runs.status = completed
       ↓
T+30s  Worker completes job; agentExecutionService receives result
       (artifactId of the downloaded video)
       ↓
T+31s  LLM step 2 (back in main agent loop): calls transcribe_audio
       with executionArtifactId
       ↓
T+31s  skillExecutor handles transcribe_audio:
       → resolves artifact path
       → chunks if needed
       → calls Whisper API
       → writes new execution_artifacts row (transcript .txt)
       → returns { transcript, transcriptArtifactId, durationSeconds, wordCount }
       ↓
T+90s  LLM step 3: calls process_42_macro_transcript with transcript
       → generic LLM-prompt skill executor
       → llmRouter.routeCall with the skill body as system prompt + transcript as user
       → returns { reportMarkdown, filename: '20260407_42_Macro_Weekly.md' }
       ↓
T+105s LLM step 4: calls send_to_slack with the reportMarkdown
       → skillExecutor writes report to a temp file
       → creates execution_artifacts row for the report
       → slackApi.chatPostMessage(channel: '#breakout-weekly-reports')
       → slackApi.filesUpload(report.md, threaded under the message)
       → returns { messageTs, permalink }
       ↓
T+108s LLM step 5: calls add_deliverable
       → links the report artifact + Slack permalink to the agent run task
       ↓
T+109s LLM step 6: calls done() — agent_runs.status = completed
       ↓
T+109s WebSocket emits run-complete to subscribed clients
       Audit events written for: credential read, slack post, deliverable created
```

Total wall-clock for a typical 60-minute video: roughly 2–3 minutes (Whisper is the long pole).

### 8.2 What gets persisted

| Table | Rows |
|---|---|
| `agent_runs` | 1 (the parent Reporting Agent run) |
| `execution_runs` | 1 (the browser task) |
| `execution_steps` | ~5–15 (browser loop iterations) |
| `execution_artifacts` | 3 (video, transcript, report.md) |
| `llm_requests` | ~6 (browser loop steps + transcribe + report skill) |
| `task_deliverables` | 1 (the markdown report) |
| `audit_events` | ~4 (credential read, slack post, deliverable, run complete) |

### 8.3 Idempotency

- `agent_runs.idempotencyKey = 'reporting:breakout:weekly:<isoWeek>'` — re-firing the same week's heartbeat is a no-op.
- `execution_runs.idempotencyKey = '<agentRunId>:browser:1'` — pg-boss double-delivery protection.
- `send_to_slack` is **not** idempotent at the Slack API level, but the parent agent run's idempotency means it cannot be re-invoked for the same week. If a partial failure occurs after the Slack post, the agent run is marked failed but the Slack message stays — operator decides whether to manually clean it up.

### 8.4 Failure handling matrix

| Failure point | failureReason | Recovery |
|---|---|---|
| `performLogin` selector miss | `login_failed` | Operator inspects screenshot artifact, updates selectors, re-runs |
| Paywall down | `login_failed` (timeout) | Heartbeat retries next week; operator can manually re-run |
| No new video found | `no_new_content` (custom — agent skips remaining steps gracefully) | Normal — agent run marked completed, no Slack post |
| Whisper rate limit | retried 3× then `transcription_failed` | Heartbeat retries next week |
| Whisper file too large | `audio_too_large` | Operator investigates source video; may need higher chunk count |
| Report skill output empty | `skill_output_invalid` | Bug in prompt or transcript — operator inspects |
| Slack token revoked | `slack_invalid_auth` | Connection marked broken; operator re-pastes token |

---

## 9. Verification, Rollout, Open Questions

### 9.1 Implementation order

1. **D first** (web_login + secretsCrypto + performLogin) — riskiest unknown is the paywall login. Validate against the real 42 Macro site before building anything else. If 2FA blocks us, the rest of the work is wasted.
2. **A** (skill visibility flag) — independent, small, unblocks B/C UI properly.
3. **B** (transcribe_audio).
4. **C** (send_to_slack + Slack integration).
5. **E** — pure configuration in the UI; no code.

Each of A–D is its own commit on `claude/agent-paywall-video-workflow-OQTMA`. After all four merge, run the §7 walkthrough.

### 9.2 Verification per change

| Change | Verification |
|---|---|
| A | `npm run lint`, `npm run typecheck`, service unit tests, route integration tests, manual UI check (lock icon + 403) |
| B | Unit tests for chunking + Whisper parser, integration test with mock Whisper, manual run against a 5-min .mp3 |
| C | Unit tests for connection resolution, integration test with mock Slack, manual post to a real test workspace |
| D | `secretsCrypto` round-trip test, `performLogin` against in-process fake form, **end-to-end manual test against real 42 Macro paywall** |
| E | Walkthrough §7.2 in local UI; assert all 6 steps complete and a markdown report lands in #breakout-weekly-reports |

After every code change: run `npm run lint`, `npm run typecheck`, relevant test suites, and invoke `pr-reviewer` before merge. This is mandatory per `CLAUDE.md`.

### 9.3 Rollout

- All four changes ship behind no feature flags — they are additive (new tables/columns/skills) and the visibility flag defaults to `false` so existing skills become hidden, which is the safer default.
- Migration order on deploy: A's migration → D's migration (status/lastTestedAt + secretsCrypto). Both forward-only.
- Worker container needs: confirm `ffmpeg` is in `worker/Dockerfile` (used by transcribe_audio chunking and the existing IEE dev handler). Add it if missing — single line.
- Env vars to add: `ENCRYPTION_KEY` (32-byte base64) and `OPENAI_API_KEY` (likely already present).

### 9.4 Open questions to resolve before/during build

| # | Question | Owner | Blocking? |
|---|---|---|---|
| 1 | Does `integration_connections.secretsJson` already use encryption? Is there a `secretsCrypto.ts` helper today? | Implementer (grep on first commit) | Decides whether D includes the encryption helper migration |
| 2 | Does the 42 Macro paywall have 2FA, captcha, or Cloudflare bot detection? | User to confirm by manual login attempt | **Yes — blocks D end-to-end test** |
| 3 | Is `ffmpeg` already in `worker/Dockerfile`? | Implementer (grep) | Decides whether B includes a Dockerfile change |
| 4 | What Slack workspace + bot app should the test connection point at during dev? | User | Blocks C end-to-end test |
| 5 | Does the existing skill executor already support generic "LLM prompt skills" with custom inputs/outputs (used by E for `process_42_macro_transcript`)? | Implementer (grep `draft_tech_spec`) | If not, E becomes a small code change too |
| 6 | Is there an existing audit_events helper, or do we need to write one for the credential read path? | Implementer | Small impact |

Q1, Q3, Q5, Q6 are answered by 5 minutes of grep at the start of implementation. Q2 and Q4 need user input.

### 9.5 v2 follow-ups (not in this spec)

- OAuth install flow for Slack (replace bot-token paste).
- Session-cookie credential mode for `web_login` (handles 2FA/captcha sites).
- Object-storage upload for execution_artifacts (so reports persist beyond the worker container lifetime).
- Scheduled re-test of `web_login` connections + email on broken status.
- "Run now" button on the Reporting Agent in the subaccount UI.
- Multi-video deduplication (track which videos have been processed so re-runs skip them).
- Per-skill cost dashboards (transcribe minutes used, Slack messages posted).

### 9.6 Approval needed before implementation

- Confirm scope and ordering of A/B/C/D.
- Answer open questions Q2 (paywall 2FA) and Q4 (Slack test workspace).
- Approve `ENCRYPTION_KEY` introduction (and key generation/rotation policy).
- Confirm pr-reviewer subagent will gate every merge.

Once these are confirmed, implementation begins on D.








