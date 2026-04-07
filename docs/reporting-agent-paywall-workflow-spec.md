# Reporting Agent — Paywall → Video → Transcript → Slack Workflow
## Detailed Development Specification

**Status:** Draft v3.2 — third-round micro-tightenings T15–T21 (correlationId invariant, fingerprint guard, artifact validation, persist-before-post, override flag, session cookie fallback, unified backoff)
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
- Object-storage upload of artifacts. Artifacts remain in `execution_artifacts` rows; the **report markdown is also persisted into the DB row body** (see §6.9, reviewer T5) so deliverables remain accessible after worker container cleanup.
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
- **Mandatory and boot-time enforced** (per reviewer recommendation): if `ENCRYPTION_KEY` is missing or not 32 bytes after base64 decode, both `server` and `worker` processes refuse to start with a clear error message pointing at the env var.

#### Why a separate `ENCRYPTION_KEY` rather than reusing `JWT_SECRET`

`JWT_SECRET` and `ENCRYPTION_KEY` must be separate values, even though both are 32-byte secrets:

1. **Different cryptographic purposes.** `JWT_SECRET` is an HMAC signing key (sign/verify tokens). `ENCRYPTION_KEY` is an AES-GCM encryption key (encrypt/decrypt at rest). Reusing one key across two purposes violates basic key-separation hygiene (NIST SP 800-57, OWASP Cryptographic Storage Cheat Sheet).
2. **Different rotation cadences.** JWT secrets rotate when invalidating sessions (relatively often). Encryption keys rotate rarely because rotation requires re-encrypting every stored secret. Sharing forces both to a bad cadence.
3. **Different blast radius.** Leaked JWT secret = forged sessions until rotation. Leaked encryption key = every stored credential decryptable forever. These should not share an exposure surface.
4. **Different future custody.** `ENCRYPTION_KEY` should eventually move to a KMS/HSM. `JWT_SECRET` stays in process env. Separating now keeps that path open.

Generation (one-time, per environment):
```bash
openssl rand -base64 32
```
Add to `.env` (local), Replit secrets (main app prod), and the worker container env (DigitalOcean). Never committed.

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

Per reviewer T6: visibility and edit rights are separate concerns. An owner-tier user may legitimately need read access to a skill body without edit rights. The helper is split into two distinct predicates:

```ts
function canViewContents(skill, viewer): boolean {
  // Owner tier always sees contents (no manage permission required for read)
  if (viewer.tier === skill.ownerTier) return true;
  // Lower tiers gated by the flag
  return skill.contentsVisible === true;
}

function canManageSkill(skill, viewer): boolean {
  // Edit/delete: must be owner tier AND have the skill-management permission
  if (viewer.tier !== skill.ownerTier) return false;
  return hasSkillManagePermission(viewer, skill);
}
```

API responses include both booleans so the client can render read-only vs edit UI correctly:

```ts
type SkillDetail = {
  // ...
  canViewContents: boolean;
  canManageSkill: boolean;
};
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
| Whisper API 5xx | Throw as `TripWire` so pg-boss retries the parent skill execution (uses shared `withBackoff` helper, see §8.5 / T21) |
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

### 5.5.1 Per-step Slack idempotency (reviewer T3)

Slack itself is not idempotent. The parent agent run's idempotency key protects against heartbeat duplication, but does **not** protect against operator retries after a mid-run failure that occurred *after* the Slack post succeeded. Without a safeguard, an operator-triggered retry would post the same report twice.

Mitigation:

1. The `send_to_slack` skill computes a **deterministic post hash** (T11) before posting:
   ```
   postHash = sha256(`${runId}:${channel}:${filename ?? ''}:${messageTextHash}`)
   ```
   `messageTextHash` is `sha256(finalRenderedMarkdown)` — computed on the **final rendered output** that will actually be posted, not on a templated/intermediate string. This ensures formatting-only differences (whitespace, mrkdwn escaping) still produce the same hash and dedupe correctly. Concretely: render → hash → check → post, in that order. Never hash the template, the unrendered prompt output, or the input args.
2. The skill writes its result (`postHash`, `messageTs`, `channel`, `permalink`) to `execution_steps.output` **and** to a denormalised lookup on `agent_runs.metadata.slackPosts: Array<{ postHash, channel, messageTs, permalink, postedAt }>`.
3. Before posting, the skill checks `agent_runs.metadata.slackPosts` for an entry with the same `postHash`. If one exists:
   - Default behaviour: **skip** the post and return the cached `messageTs` + `permalink`. Log a warning.
   - Alternative behaviour (configurable per skill input `onDuplicate: 'skip' | 'reply_in_thread' | 'force'`, default `'skip'`): post a follow-up reply in-thread referencing the prior post.
4. The check is best-effort, not a database lock. Two simultaneous workers can still race and double-post, but parent-run idempotency makes simultaneous runs impossible in normal operation. The hash narrows the residual race window to the few hundred ms between read and write, and ensures that retries from the same run never duplicate even if the agent loop calls `send_to_slack` twice with semantically identical input.

This is ~50 LOC and closes both the operator-retry loophole and the trivially-different-input loophole called out in T11.

### 5.5.2 Persist before post (T18)

The `send_to_slack` skill executor must follow a strict order, **even when called for a fresh post**:

1. **Persist** the message body and any attachment artifacts to the DB (`execution_artifacts.inline_text` and/or `task_deliverables.body_text`) via `writeWithLimit`.
2. **Then** call the Slack API.
3. **Then** record the post hash + messageTs back to the run metadata.

If step 2 fails, the body is already in the DB, so an operator can manually re-trigger Slack delivery from the run-detail UI without re-running the entire agent (which would re-hit Whisper, etc.).

The skill rejects `{ message }` callers who do not also pass an `artifactId` or `bodyText` for the durable copy — the skill will not post anything that has not been persisted first. This is enforced in zod, not by convention.

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
- **Test connection** — disabled until required fields are filled. POSTs to `/api/integration-connections/test-web-login` with the form values (without saving). Server enqueues a one-off `iee-browser-task` with `mode: 'login_test'` (see §6.3.1 — this is a deterministic, non-LLM path). Result polled and shown inline as success/failure with the screenshot artifact link if it failed.
- **Save** — persists the row. Encrypts `password`. If "Test connection" was successful in this session, marks `status: 'active'`. Otherwise `status: 'untested'`.

### 6.3.1 `login_test` mode — deterministic, no LLM loop

Per reviewer T2: connection-test mode must not enter the LLM execution loop at all. This avoids accidental prompt/context exposure of credentials and keeps the test cheap and deterministic.

Add a `mode` discriminator to `BrowserTaskPayloadSchema`:

```ts
mode: z.enum(['standard', 'login_test']).default('standard'),
```

Worker handler:

```ts
async function handle(payload: BrowserTaskPayload) {
  const ctx = await openExecutionRun(payload);
  const page = await playwrightContext.newPage(ctx);
  const creds = await fetchAndDecryptWebLogin(payload);  // §6.6.1

  if (payload.mode === 'login_test') {
    // 1. performLogin
    // 2. optionally navigate to contentUrl
    // 3. verify successSelector / final URL
    // 4. capture success or failure screenshot
    // 5. close run as completed/failed
    // NEVER enter executionLoop
    try {
      await performLogin(page, creds);
      if (creds.contentUrl) await page.goto(creds.contentUrl, { waitUntil: 'networkidle' });
      const screenshot = await captureSuccessScreenshot(page);
      await ieeArtifactRepo.create({ executionRunId: ctx.id, kind: 'log', path: screenshot, mimeType: 'image/png', metadata: { kind: 'login_test_success' } });
      await closeExecutionRun(ctx, { status: 'completed', resultSummary: { mode: 'login_test', success: true } });
    } catch (err) {
      await closeExecutionRun(ctx, { status: 'failed', failureReason: 'login_failed', resultSummary: { mode: 'login_test', success: false, error: err.message } });
    }
    return;
  }

  // Standard mode (production runs)
  await performLogin(page, creds);
  if (creds.contentUrl) await page.goto(creds.contentUrl, { waitUntil: 'networkidle' });
  await executionLoop(ctx, page);
}
```

The two modes share `performLogin` and the credential-fetch path but diverge cleanly afterwards. Test mode never instantiates the LLM client, never calls `routeCall`, and never writes a Whisper or report row.

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
    // T20 — three-tier success detection, in priority order:
    //   1. successSelector (if configured) — most reliable
    //   2. URL changed away from loginUrl
    //   3. A new session-like cookie was set by the login response
    //      (matches /session|sess|sid|auth|token/i in the cookie name)
    // The first one that succeeds wins. We accumulate failures only if all three fail.
    let succeeded = false;
    const failures: string[] = [];

    if (creds.successSelector) {
      try {
        await page.waitForSelector(creds.successSelector, { timeout: creds.timeoutMs });
        succeeded = true;
      } catch { failures.push('selector_not_found'); }
    }

    if (!succeeded && page.url() !== creds.loginUrl) {
      succeeded = true;
    } else if (!succeeded) {
      failures.push('url_unchanged');
    }

    if (!succeeded) {
      const cookies = await page.context().cookies();
      const sessionCookie = cookies.find(c =>
        /session|sess|sid|auth|token/i.test(c.name) && c.value && c.value.length > 8
      );
      if (sessionCookie) {
        succeeded = true;
      } else {
        failures.push('no_session_cookie');
      }
    }

    if (!succeeded) {
      throw new LoginFailed(failures.join(','));
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

`shared/iee/jobPayload.ts` extension. **Note: no `password` ever appears in the payload schema.** The schema enforces this by construction.

```ts
// Internal worker-only type (NOT in shared/) — never serialised to pg-boss
export type WebLoginCredentials = {
  loginUrl: string;
  contentUrl?: string;
  username: string;
  password: string;            // plaintext, worker memory only
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  successSelector?: string;
  timeoutMs: number;
};

// Shared (enqueued) payload — reference only, no secrets
export const BrowserTaskPayloadSchema = z.object({
  // ...existing fields...
  webLoginConnectionId: z.string().uuid().optional(),
  // Optional explicit success criteria, see §6.10 (Tightening 7)
  browserTaskContract: BrowserTaskContractSchema.optional(),
});
```

### 6.6 Enqueue path (main app)

**Critical security rule (per reviewer T1):** the main app **never** puts decrypted secrets into the pg-boss job payload. It enqueues only a `connectionId` reference. The worker fetches and decrypts the secret just-in-time, holds it in process memory for the duration of `performLogin`, and discards it before the LLM execution loop begins.

`agentExecutionService.ts` enqueues:

```ts
await boss.send('iee-browser-task', {
  runId, organisationId, subaccountId, correlationId,
  goal: '...',
  webLoginConnectionId: connection.id,   // ← reference only
  // NO `credentials` field. NO password. NO username here either —
  // the entire web_login row is loaded by the worker.
  idempotencyKey: '...',
});
```

The shared payload schema (§6.5) is updated accordingly: `credentials` is removed; `webLoginConnectionId: z.string().uuid().optional()` replaces it.

### 6.6.1 Worker-side fetch + decrypt

`worker/src/handlers/browserTask.ts`:

```ts
async function handle(payload: BrowserTaskPayload) {
  const ctx = await openExecutionRun(payload);
  const page = await playwrightContext.newPage(ctx);

  let creds: WebLoginCredentials | undefined;
  if (payload.webLoginConnectionId) {
    // Fetch the connection row scoped to the run's org/subaccount
    const conn = await integrationConnectionRepo.getByIdScoped(
      payload.webLoginConnectionId,
      payload.organisationId,
      payload.subaccountId,
    );
    if (!conn || conn.type !== 'web_login') {
      throw { failureReason: 'web_login_connection_not_found' };
    }
    // Decrypt just-in-time
    creds = {
      ...conn.configJson,
      password: secretsCrypto.decrypt(conn.secretsJson.password),
    };
    // Audit the read
    await auditRepo.record({
      organisationId: payload.organisationId,
      actor: { type: 'worker', runId: payload.runId },
      action: 'integration_connection.secret_read',
      resourceId: conn.id,
      purpose: 'iee-browser-task',
      correlationId: payload.correlationId,
    });
  }

  if (creds) {
    await performLogin(page, creds);
    if (creds.contentUrl) {
      await page.goto(creds.contentUrl, { waitUntil: 'networkidle' });
    }
    // Discard plaintext credentials before handing to the LLM loop
    creds = undefined;
  }

  await executionLoop(ctx, page);
}
```

The worker therefore needs **read access to `integration_connections` and `secretsCrypto`**. This means:
- The worker process needs `ENCRYPTION_KEY` in its environment (added to `worker/Dockerfile` env passthrough and `docker-compose.yml`).
- The worker needs DB access to `integration_connections` (already has it via the existing IEE schema sharing).
- A purposely **single-method, single-purpose** repo file (see §6.6.2) — no generic `getById`, no list, no search.

This trades a tiny amount of additional worker code for a materially better security posture: plaintext secrets never enter pg-boss queue rows, never enter Postgres job payloads, and exist only in worker process memory for the seconds between fetch and `performLogin` completion.

### 6.6.2 Worker repo: single-method hard boundary (T8)

The worker is now a privileged component (it has `ENCRYPTION_KEY` and DB access to `integration_connections`). To prevent that privilege from becoming a future footgun, the worker's persistence layer for connections is **deliberately constrained to one method**:

`worker/src/persistence/integrationConnections.ts`:

```ts
// The ONLY method exported. There is no getById, no list, no search.
// This file does not export the connection table object.
export async function getWebLoginConnectionForRun(
  runContext: { organisationId: string; subaccountId: string | null; runId: string },
  connectionId: string,
): Promise<DecryptedWebLoginConnection> {
  const row = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.id, connectionId),
      eq(integrationConnections.organisationId, runContext.organisationId),
      eq(integrationConnections.type, 'web_login'),
      isNull(integrationConnections.deletedAt),
      // T14: subaccount scoping rule, see §6.6.3
      runContext.subaccountId
        ? or(
            eq(integrationConnections.subaccountId, runContext.subaccountId),
            isNull(integrationConnections.subaccountId),
          )
        : isNull(integrationConnections.subaccountId),
    ),
  });
  if (!row) {
    throw new WebLoginConnectionNotFound(connectionId, runContext);
  }
  // Decrypt at the boundary so callers never see ciphertext shape
  return {
    id: row.id,
    config: row.configJson as WebLoginConfig,
    password: secretsCrypto.decrypt((row.secretsJson as { password: string }).password),
  };
}
```

**Hard rules enforced by this single function:**
1. `organisationId` must match the run's org. Always.
2. `type` must be `'web_login'`. No type confusion bugs.
3. `deletedAt` must be null. Soft-deleted credentials cannot be used.
4. **T14 rule** — see §6.6.3.

There is no escape hatch in `worker/src/persistence/`. If a future feature needs a different connection type, it adds a sibling single-purpose function (`getSlackConnectionForRun`, `getOpenAiConnectionForRun`) — never a generic `getConnectionById`.

A unit test asserts the file's exported surface area is exactly `getWebLoginConnectionForRun` (and any future siblings) and nothing else. Lint rule (added to `worker/.eslintrc`) bans `import { db }` outside `worker/src/persistence/`.

### 6.6.3 Cross-subaccount credential isolation (T14)

**The rule:** if the agent run has a `subaccountId`, the connection must belong to that subaccount **or** be a null-subaccount org-wide fallback. A connection belonging to a *different* subaccount must never resolve, even if the caller passes its ID.

This is enforced in the WHERE clause of `getWebLoginConnectionForRun` (see §6.6.2):

```sql
-- pseudocode of the predicate
WHERE organisation_id = :runOrgId
  AND type = 'web_login'
  AND deleted_at IS NULL
  AND (
    (:runSubaccountId IS NOT NULL AND (subaccount_id = :runSubaccountId OR subaccount_id IS NULL))
    OR
    (:runSubaccountId IS NULL AND subaccount_id IS NULL)
  )
```

Without this clause, a malicious or buggy caller could pass `connectionId = <other subaccount's paywall>` and (because org_id matches) successfully decrypt a credential belonging to a different client.

A tenant-isolation test asserts:
- Run with `subaccountId = A` + connection ID belonging to subaccount B → returns not-found, **never** the row.
- Run with `subaccountId = A` + connection ID belonging to org-wide (null subaccount) → returns the row.
- Run with `subaccountId = null` (org-level run) + connection ID belonging to subaccount A → returns not-found.
- Run with `subaccountId = null` + connection ID belonging to org-wide (null subaccount) → returns the row.

Same rule will be applied to every future `get*ConnectionForRun` function.

### 6.7 Audit and rotation

- Every credential read writes an audit row (see §2.5).
- "Last rotated X days ago" surfaced in the IntegrationsPage row using `lastRotatedAt` (set on save when password changes).
- Optional v2: scheduled re-test of `web_login` connections, marks `status: 'broken'` and emails the subaccount admin.

### 6.7.1 Browser-task invocation contract (reviewer T7)

Per the review, the boundary between "generic LLM instruction" and "deterministic browser handler" must be explicit, not emergent. The agent does not just hand the worker a free-text goal — it hands it a **contract** that pins down what the worker is allowed to do.

New `BrowserTaskContractSchema` in `shared/iee/jobPayload.ts`:

```ts
export const BrowserTaskContractSchema = z.object({
  // Which credential to use (resolved by ID, never plaintext — see §6.6)
  webLoginConnectionId: z.string().uuid().optional(),

  // What the agent is asking for, in structured form
  intent: z.enum(['download_latest', 'download_by_url', 'extract_text', 'screenshot']),

  // Domain allow-list — worker refuses to navigate outside these
  allowedDomains: z.array(z.string()).min(1),

  // Expected artifact type — worker refuses to write artifacts that don't match
  expectedArtifactKind: z.enum(['video', 'audio', 'document', 'image', 'text']).optional(),
  expectedMimeTypePrefix: z.string().optional(),  // e.g. "video/", "audio/"

  // Success condition — at least one must be present
  successCondition: z.object({
    selectorPresent: z.string().optional(),
    urlMatches: z.string().optional(),  // regex
    artifactDownloaded: z.boolean().optional(),
  }),

  // Free-form context for the LLM loop — explanatory only, not authoritative
  goal: z.string().min(1).max(1000),

  // Hard limits
  maxSteps: z.number().int().positive().max(50).default(20),
  timeoutMs: z.number().int().positive().max(600_000).default(300_000),
});
```

The agent's tool-call to the browser-task action **must** populate the contract. The LLM cannot bypass `allowedDomains`, the worker enforces it on every `page.goto()`. The LLM cannot bypass `expectedArtifactKind`, the worker rejects mismatched downloads. `goal` remains a free-text hint to the LLM loop but the contract bounds what that loop is allowed to do.

For the Reporting Agent, the contract for the paywall step is:

```ts
{
  webLoginConnectionId: '<42 macro paywall connection id>',
  intent: 'download_latest',
  allowedDomains: ['42macro.com', 'www.42macro.com'],
  expectedArtifactKind: 'video',
  expectedMimeTypePrefix: 'video/',
  successCondition: { artifactDownloaded: true },
  goal: 'Find and download the most recent weekly video on the members videos page.',
  maxSteps: 15,
  timeoutMs: 240_000,
}
```

This contract is constructed by `agentExecutionService` based on the agent's tool-call arguments — it is **not** authored by the LLM directly. The LLM provides intent + connection name; the service fills in `allowedDomains` from the `web_login` connection's `loginUrl` host and the `contentUrl` host, and fills in `expectedArtifactKind` from the agent definition. This keeps the LLM in the role of "decide what to do" while the deterministic service enforces "what is permissible".

#### Deny-by-default enforcement (T9)

The contract is not advisory. The worker operates in **deny-by-default mode**: any action that does not pass an explicit contract check is a **hard failure**, never a warning.

Enforcement points in `worker/src/browser/`:

| Action | Check | On violation |
|---|---|---|
| `page.goto(url)` (initial + every navigation) | URL host ∈ `allowedDomains` (exact or suffix match) | `terminate` with `failure_reason: 'auth_error'` (sub: `contract_violation_domain`) |
| HTTP redirect during navigation | Final URL host ∈ `allowedDomains` | `terminate` with same reason; capture redirect chain in failure metadata |
| Download event | MIME type starts with `expectedMimeTypePrefix` (if set) **and** file kind matches `expectedArtifactKind` | `terminate` with `failure_reason: 'data_incomplete'` (sub: `contract_violation_artifact_kind`) |
| `execution_artifacts` write | `kind` matches `expectedArtifactKind` | `terminate` (defence in depth — should already be caught above) |
| LLM-loop step count | ≤ `maxSteps` | `terminate` with `failure_reason: 'internal_error'` (sub: `step_limit_exceeded`) |
| Wall-clock | ≤ `timeoutMs` | `terminate` with `failure_reason: 'connector_timeout'` |
| `successCondition` not satisfied at end of loop | At least one of selectorPresent / urlMatches / artifactDownloaded met | `terminate` with `failure_reason: 'data_incomplete'` (sub: `success_condition_unmet`) |

**Termination semantics:** "terminate" means the run is closed immediately, the artifact (if partial) is marked invalid, the failure reason + sub-detail are persisted to `execution_runs`, and the parent agent run sees a hard failure rather than a soft skip. There is no retry inside the same run.

A wrapper class `ContractEnforcedPage` proxies the Playwright `Page` object — every navigation method is intercepted and validated against `allowedDomains` before being passed through. The LLM execution loop receives only `ContractEnforcedPage`, never the raw page. This makes the enforcement non-bypassable from inside the loop.

The spec text is intentionally explicit about "deny by default, hard fail, no warnings" so future devs cannot quietly soften it into a logged warning.

### 6.7.2 Content fingerprint to skip duplicate downloads (reviewer T4)

"Just take the most recent" will produce wrong behaviour when the newest item is pinned, not actually a video, the same asset reordered, or not downloadable. v1 adds a minimal persisted fingerprint so the agent can skip obvious duplicates without needing full multi-video history.

New table column on `subaccount_agents` (small migration, no new table):

```sql
ALTER TABLE subaccount_agents
  ADD COLUMN last_processed_fingerprints_by_intent jsonb NOT NULL DEFAULT '{}'::jsonb;
```

**Per reviewer T10:** the column is keyed by **intent** so the same agent linkage can run multiple distinct browser intents (e.g. `download_latest` for videos and `download_latest` for a separate report feed) without colliding. Shape:

```ts
type FingerprintsByIntent = {
  [intent: string]: {  // e.g. 'download_latest', 'download_by_url'
    sourceUrl: string;          // canonical URL of the item — see hashing rules below
    pageTitle: string;
    publishedAt?: string;       // ISO if extractable
    contentHash: string;        // sha256 of the FINAL DOWNLOADED FILE BYTES — not URL, not metadata, not headers
    processedAt: string;        // ISO
    agentRunId: string;
  };
};
```

**Hashing rules (must be enforced in code, not by convention):**
- `contentHash` is computed by streaming the downloaded file bytes through `crypto.createHash('sha256')` after the download completes and before the file is moved or transformed. **Never** hash a URL, response headers, or partial content.
- `sourceUrl` is **canonicalised** before storage and before comparison: lowercase host, strip default ports (`:443`, `:80`), strip tracking query params (`utm_*`, `gclid`, `fbclid`, `ref`, `source`), strip URL fragment, normalise trailing slash. A small `canonicaliseUrl()` helper in `worker/src/util/url.ts` is the single source of truth — same helper used on write and on compare.

Without these rules the dedup logic will silently misbehave on the day a tracking parameter changes or a CDN URL gains a cache-buster.

Reads use `last_processed_fingerprints_by_intent[intent]`; writes use a small JSONB merge. No need for a separate row per intent in v1.

The browser-task worker, on a `download_latest` intent, captures these fields as part of the download step result. The agent's next step reads the fingerprint for the current intent and compares:
- If `sourceUrl` matches → skip, terminate the agent run gracefully with `result: 'no_new_content'`.
- Else if `contentHash` matches → skip (same file re-uploaded under a new URL).
- Else proceed.

**Fingerprint persistence guard (T16):** the new fingerprint is persisted **only if all of the following are true**:

1. `download` step succeeded (file written, contract artifact-kind check passed)
2. **Artifact validation succeeded** (T17 — see below)
3. `transcribe_audio` step succeeded (Whisper returned a non-empty transcript)
4. `process_*_transcript` report skill returned a non-empty result

If any step short of these fails, the fingerprint is **not** persisted, so the next run will retry the same content rather than permanently skipping it. The fingerprint write happens at the end of the agent loop, immediately before the terminal `done()` step (or as part of `add_deliverable`).

This means a partial download → corrupt transcript → failed report does NOT poison the fingerprint state. The reviewer's failure mode (permanently skipping valid future content) is closed.

**Artifact validation before hashing (T17):** `contentHash` is computed only after the downloaded file passes a minimal validation step. The validation runs in the worker immediately after the download completes:

```ts
async function validateDownloadedArtifact(
  filePath: string,
  expected: { kind: ArtifactKind; mimeTypePrefix?: string; minBytes: number },
): Promise<{ ok: true; contentHash: string } | { ok: false; reason: string }> {
  const stat = await fs.stat(filePath);
  // 1. Minimum size — guards against HTML error pages and partial downloads
  if (stat.size < expected.minBytes) {
    return { ok: false, reason: `file_too_small:${stat.size}` };
  }
  // 2. MIME re-check from file header (magic bytes), not just response Content-Type
  const detected = await detectMimeFromFileHeader(filePath);  // file-type / mmmagic
  if (expected.mimeTypePrefix && !detected.mime.startsWith(expected.mimeTypePrefix)) {
    return { ok: false, reason: `mime_mismatch:${detected.mime}` };
  }
  // 3. Stream-hash the bytes
  const contentHash = await sha256Stream(filePath);
  return { ok: true, contentHash };
}
```

Default `minBytes` per artifact kind:

| Kind | minBytes |
|---|---|
| `video` | 51_200 (50 KB) |
| `audio` | 10_240 (10 KB) |
| `document` | 1_024 (1 KB) |
| `image` | 1_024 (1 KB) |
| `text` | 16 |

If validation fails, the run terminates with `failure('data_incomplete', 'artifact_validation_failed', { reason })` and the fingerprint is **not** persisted (per T16). The bad file is kept on the worker disk for the run lifetime so an operator can inspect it from the run-detail UI screenshot/artifact section.

This closes the "site returns an HTML error page advertised as a video" failure mode — without it, the worker would hash the HTML, persist the fingerprint, and silently skip every real future video that arrived after.

On successful end of run, the agent calls `update_last_fingerprint` (or the existing `add_deliverable` skill is extended to also write the fingerprint) to persist the new value.

**`ignoreFingerprint` override (T19):** the agent run accepts an optional `ignoreFingerprint: boolean` flag (default `false`) on the run-trigger payload. When `true`, the fingerprint check is **skipped** for that run only — the worker still computes and persists the new fingerprint at the end, but does not consult the prior one.

Use cases:
- Debugging a stuck workflow without manually clearing the fingerprint row
- Reprocessing historical content after a prompt or skill change
- Onboarding a new client whose subaccount already has a populated fingerprint from migration

The flag is exposed only on the manual "Run now" UI and the API trigger — heartbeat-driven runs always default to `false`. Setting it writes an audit event so override usage is traceable.

This is one column + one read + one write per run. Small operational addition, big robustness win against the failure modes the reviewer flagged.

### 6.7.3 Artifact durability & deliverable contract (reviewer T5)

The boundary between transient (worker disk) and durable (DB / object storage) artifacts must be explicit, especially because the report is attached to Slack **and** linked into a deliverable that survives the run.

Rules for v1:

| Artifact | Storage in v1 | Survives run end? | Notes |
|---|---|---|---|
| Downloaded video | `execution_artifacts` row + worker disk | **No** — disk wiped at run end | Used only as input to transcribe; never linked into a deliverable |
| Transcript | `execution_artifacts` row + worker disk; **also** stored as text in `execution_artifacts.metadata.transcriptText` if < 1 MB | Yes (DB copy) | Falls back to "transcript truncated, original on worker disk during run" if > 1 MB. Whisper output is rarely > 1 MB even for hour-long videos. |
| Report markdown | `execution_artifacts` row + worker disk; **and** the full markdown body stored in a new column `task_deliverables.bodyText` | Yes (DB copy) | Source of truth for the deliverable. Slack attachment is a convenience copy. |

Schema addition (folded into the same migration as §2.3):

```sql
ALTER TABLE task_deliverables
  ADD COLUMN body_text text,
  ADD COLUMN body_text_truncated boolean NOT NULL DEFAULT false;
ALTER TABLE execution_artifacts
  ADD COLUMN inline_text text,
  ADD COLUMN inline_text_truncated boolean NOT NULL DEFAULT false;
```

#### Size thresholds and overflow behaviour (T12)

Inline-text columns have **explicit hard ceilings**, enforced at write time. Without these, someone will eventually dump a 10 MB transcript into the DB and slow every list query.

| Column | Max bytes | On overflow |
|---|---|---|
| `execution_artifacts.inline_text` | **1 MB** (1,048,576 bytes) | Truncate at 1 MB - 100 bytes (leaving room for an ellipsis marker), set `inline_text_truncated = true`, keep the original on the worker disk + in `execution_artifacts.path`. The skill that produced it logs a warning step. |
| `task_deliverables.body_text` | **2 MB** (2,097,152 bytes) | Truncate at 2 MB - 100 bytes, set `body_text_truncated = true`, write a separate full-size artifact and link it via `task_deliverables.artifactId`. The deliverable record always remains queryable; the truncation flag tells the UI to show "truncated — open full file". |

Both ceilings are enforced by a single `writeWithLimit(table, column, text, maxBytes)` helper in `server/lib/inlineTextWriter.ts`. The helper returns `{ stored, wasTruncated, originalBytes }` so callers can audit. Truncation **never** silently fails; it always writes the truncated body, sets the flag, and emits a warning step.

**UTF-8 safety:** truncation operates on bytes, not characters. After cutting at `maxBytes - 100`, the helper **backtracks to the nearest UTF-8 character boundary** (the byte before the next continuation byte) so the stored text never ends mid-codepoint. It then appends a marker like `\n\n…[truncated]` (which itself is < 100 bytes, hence the headroom). Without backtracking, a multi-byte character (emoji, accented letter, CJK glyph) split across the boundary would render as a replacement character or break the markdown parser downstream.

A unit test asserts that for inputs containing 4-byte characters at the boundary, the output is valid UTF-8 and shorter than `maxBytes`.

For the Reporting Agent's typical 60-minute video:
- Whisper transcript: ~50–80 KB → comfortably inline.
- Final report markdown: ~5–15 KB → comfortably inline.
- Neither hits the ceiling in normal operation. The ceilings exist to prevent pathological inputs from breaking the DB.

`add_deliverable` skill is updated so callers may pass either `{ artifactId }` or `{ bodyText, mimeType, filename }`. The Reporting Agent uses the latter form for the report. The skill internally uses `writeWithLimit`.

Result: even after worker container cleanup, the deliverable body is queryable from the main DB, with explicit size guarantees. Object storage upload (v2) will replace inline storage for large deliverables but the schema is forward-compatible.

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
       → STEP A (T18): persist report markdown durably FIRST:
                       - write execution_artifacts row with inline_text
                       - write task_deliverables row with body_text
                       (so an operator can manually re-send if Slack fails)
       → STEP B: only after persistence succeeds, call Slack:
                 - slackApi.chatPostMessage(channel: '#breakout-weekly-reports')
                 - slackApi.filesUpload(report.md, threaded under the message)
       → returns { messageTs, permalink, deliverableId }
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

Per reviewer T13: failures across browser-task, transcription, report skill, and Slack are aligned to a **single unified taxonomy**. All failures use a `failureReason` from the standard enum (already used elsewhere in the system per `shared/iee/failureReason.ts`) plus an optional `failureDetail` string for sub-categorisation. This keeps downstream analytics, dashboards, and alerting consistent.

**Standard `failureReason` enum (extend existing if needed):**

| Reason | Meaning |
|---|---|
| `connector_timeout` | External system did not respond within timeout |
| `rate_limited` | External system returned 429 / equivalent |
| `auth_error` | Authentication / authorisation failure (login failed, token revoked, contract domain violation) |
| `data_incomplete` | Expected data was missing or malformed (no new content, contract artifact mismatch, success condition unmet) |
| `internal_error` | Bug or unexpected condition in our own code |
| `unknown` | Catch-all for unclassified failures |

**Mapping for this workflow:**

| Failure point | failureReason | failureDetail | Recovery |
|---|---|---|---|
| `performLogin` selector miss | `auth_error` | `login_failed_selector_missing` | Operator inspects screenshot, updates selectors, re-runs |
| `performLogin` timeout | `connector_timeout` | `login_navigation_timeout` | Heartbeat retries next week |
| Contract domain violation | `auth_error` | `contract_violation_domain` | Bug in agent contract or compromised redirect — investigate immediately |
| Contract artifact-kind mismatch | `data_incomplete` | `contract_violation_artifact_kind` | Source page changed format — operator investigates |
| Step limit exceeded | `internal_error` | `step_limit_exceeded` | Loop is stuck — increase `maxSteps` only after diagnosing root cause |
| Wall-clock timeout | `connector_timeout` | `browser_task_timeout` | Site slow / down |
| Success condition unmet | `data_incomplete` | `success_condition_unmet` | Site structure changed — update success selector |
| No new content (fingerprint match) | *not a failure* — terminates with `result: 'no_new_content'`, status `completed` | — | Normal weekly outcome |
| Whisper 429 (after retries) | `rate_limited` | `whisper_rate_limited` | Heartbeat retries next week |
| Whisper file too large | `data_incomplete` | `audio_too_large` | Source video is unusually long; investigate chunking |
| Whisper API 5xx | `connector_timeout` | `whisper_upstream_error` | TripWire retry |
| Report skill output empty | `internal_error` | `skill_output_empty` | Bug in prompt or transcript |
| Slack token revoked | `auth_error` | `slack_invalid_auth` | Connection marked broken; operator re-pastes token |
| Slack channel not found | `data_incomplete` | `slack_channel_not_found` | Operator updates channel |
| Slack rate limited | `rate_limited` | `slack_rate_limited` | Retry with `Retry-After` |
| Encryption key missing at boot | `internal_error` | `encryption_key_missing` | Server refuses to start (boot-time check) |
| Connection not found / wrong tenant | `auth_error` | `connection_not_found_or_unauthorized` | Operator audit; possible tenant-isolation alert |

### 8.5 Unified retry / backoff abstraction (T21)

All external-call retries (Whisper, Slack, future integrations) go through a single helper rather than ad-hoc per-integration loops:

```ts
// server/lib/withBackoff.ts
export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: {
    label: string;                       // e.g. 'whisper.transcribe', 'slack.chat.post'
    maxAttempts: number;                 // default 3
    baseDelayMs: number;                 // default 500
    maxDelayMs: number;                  // default 8000
    isRetryable: (err: unknown) => boolean;
    onRetry?: (attempt: number, err: unknown) => void;
    correlationId: string;               // logged on every attempt
    runId: string;                       // logged on every attempt
  },
): Promise<T>;
```

Strategy: exponential backoff with full jitter. Honours `Retry-After` headers when present (Slack 429). Logs each attempt with `{ label, attempt, delayMs, correlationId, runId }` so retry behaviour is visible in observability without per-call instrumentation.

Per-integration `isRetryable` predicates:

| Caller | Retryable | Non-retryable |
|---|---|---|
| Whisper | 429, 5xx, network errors | 4xx (other), `audio_too_large` |
| Slack | 429, 5xx, network errors | `invalid_auth`, `channel_not_found`, `ratelimited` returns Retry-After |
| Browser fetch (download) | network errors, 5xx | 4xx |

Why a single helper rather than per-integration loops:
- Predictable behaviour under load (one place tunes the curve)
- Single observability surface for retry storms
- Single place to add circuit breakers in v2
- Inline retry loops drift apart over time and produce inconsistent operational behaviour

Lint rule: no `setTimeout(..., 1000 * Math.pow(2, attempt))` style ad-hoc backoff outside `withBackoff`.

---

A single helper `failure(reason, detail, metadata?)` is used by **every** code path to construct the failure object. Inline shapes like `throw { failureReason: 'login_failed' }` are **banned** — caught by both:
1. **Lint rule** (added to `.eslintrc` for both `server/` and `worker/`): no object literal containing the key `failureReason` outside `server/lib/failure.ts` and `worker/src/runtime/failure.ts`.
2. **Runtime zod validation** at the persistence boundary: `execution_runs.failureReason` and `agent_runs.failureReason` are typed as the enum, and the persistence layer rejects any other value with an error.

The helper signature is fixed:

```ts
export function failure(
  reason: FailureReason,           // enum
  detail: string,                   // free-form sub-reason, e.g. 'login_failed_selector_missing'
  metadata?: Record<string, unknown>,
): FailureObject;
```

This is the **single emit point** for the entire workflow. Without it, the reviewer's prediction holds: 2–3 places will bypass the enum and analytics will degrade silently.

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

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | Does `integration_connections.secretsJson` already use encryption? Is there a `secretsCrypto.ts` helper today? | Implementer (grep on first commit) | Open — answered in 5 min of grep |
| 2 | Does the 42 Macro paywall have 2FA, captcha, or Cloudflare bot detection? | User | **Closed** — confirmed: simple email/password form, no captcha, no 2FA. Login screenshot reviewed. |
| 3 | Is `ffmpeg` already in `worker/Dockerfile`? | Implementer (grep) | Open |
| 4 | What Slack workspace for dev testing? | User | **Closed** — implementer uses a throwaway dev workspace + mocked Slack API in integration tests. Production Slack is configured by the org admin in the UI per §7.2 — not a build-time concern. |
| 5 | Does the existing skill executor already support generic "LLM prompt skills" with custom inputs/outputs (used by E for `process_42_macro_transcript`)? | Implementer (grep `draft_tech_spec`) | Open |
| 6 | Is there an existing audit_events helper for the credential read path? | Implementer | Open |
| 7 | Should `ENCRYPTION_KEY` reuse `JWT_SECRET`? | User | **Closed** — no, must be a separate value. Reasons documented in §2.4. |

All remaining open questions are implementer greps at the start of D — they cannot block planning, only minor scope.

### 9.5 v2 follow-ups (not in this spec)

- OAuth install flow for Slack (replace bot-token paste).
- Session-cookie credential mode for `web_login` (handles 2FA/captcha sites).
- Object-storage upload for execution_artifacts (so reports persist beyond the worker container lifetime).
- Scheduled re-test of `web_login` connections + email on broken status.
- "Run now" button on the Reporting Agent in the subaccount UI.
- Multi-video deduplication (track which videos have been processed so re-runs skip them).
- Per-skill cost dashboards (transcribe minutes used, Slack messages posted).

### 9.6 Approval needed before implementation

- Confirm scope and ordering of A/B/C/D after v2 tightenings.
- Confirm pr-reviewer subagent will gate every merge.

Once these are confirmed, implementation begins on D.

---

## 10. Change Log

### v2 (current) — reviewer tightenings

| # | Tightening | Section |
|---|---|---|
| T1 | Decrypted secrets never enter pg-boss payload. Worker fetches by `connectionId` and decrypts just-in-time. | §6.5, §6.6, §6.6.1 |
| T2 | `login_test` mode is a deterministic, non-LLM path. Worker handler branches before `executionLoop`. | §6.3.1 |
| T3 | Per-step Slack idempotency: cache `messageTs` on the run, skip duplicate posts on operator retry. | §5.5.1 |
| T4 | Persisted content fingerprint on `subaccount_agents` to skip duplicate downloads (pinned, reordered, same hash). | §6.7.2 |
| T5 | Artifact durability matrix: report markdown stored in `task_deliverables.body_text` so deliverables survive worker cleanup. | §6.7.3 |
| T6 | Split `canViewContents` from `canManageSkill`. Owner-tier read no longer requires manage permission. | §3.4 |
| T7 | Explicit `BrowserTaskContractSchema` (allowedDomains, expectedArtifactKind, successCondition, etc.) constructed by the service, not the LLM. | §6.7.1 |
| Q2 | Paywall 2FA confirmed absent. | §9.4 |
| Q4 | Slack workspace for dev: throwaway + mocked. | §9.4 |
| Q7 | `ENCRYPTION_KEY` must be separate from `JWT_SECRET`. Rationale documented. | §2.4 |

The only true blocker from the review (T1, plaintext secrets in payload) is closed. All others are hardening that has been folded into the relevant section rather than carried as TODOs.

### v3.2 (current) — third-round micro-tightenings

| # | Tightening | Section |
|---|---|---|
| T15 | `correlationId` + `runId` invariant: every log line, artifact, Slack post, failure object, and audit event must carry both. Logger child context + persistence-layer zod check enforce it. | §11.9.1 |
| T16 | Fingerprint persisted **only** if download + artifact validation + transcribe + report all succeed. Prevents permanent skip of valid future content after partial failure. | §6.7.2 |
| T17 | Artifact validation before hashing: minimum file size + MIME re-check from file header (magic bytes), not just response Content-Type. Closes "HTML error page advertised as video" failure mode. | §6.7.2 |
| T18 | `send_to_slack` must persist the report body to DB (`task_deliverables.body_text` / `execution_artifacts.inline_text`) **before** calling Slack. Operator can re-send manually if Slack fails. Enforced in zod, not by convention. | §5.5.2, §8.1 |
| T19 | `ignoreFingerprint: boolean` flag on the run trigger payload (default `false`, heartbeat always `false`). For debug, reprocessing, and onboarding. Audit-logged. | §6.7.2 |
| T20 | Three-tier login success detection: successSelector → URL change → session-cookie presence. Closes false negatives on sites with no stable selector and no URL change. | §6.4 |
| T21 | All retry/backoff goes through a single `withBackoff` helper. Per-integration `isRetryable` predicates. Single observability surface, single place to add circuit breakers in v2. Lint rule bans ad-hoc backoff loops. | §8.5 |

All seven are operational hygiene and edge-case containment. None require redesign. Spec is build-ready.

### v3.1 — pre-implementation checklist + small implementation-trap notes

| Area | Change | Section |
|---|---|---|
| Slack dedup | `messageTextHash` must be computed on the final rendered markdown, not on a templated/intermediate string | §5.5.1 |
| Fingerprint | `contentHash` must stream the file bytes; `sourceUrl` must go through `canonicaliseUrl()` on both write and compare | §6.7.2 |
| Truncation | `writeWithLimit` must backtrack to a UTF-8 character boundary before appending the marker | §6.7.3 |
| Failure helper | Inline `{ failureReason: ... }` shapes are banned; lint rule + zod validation enforce single emit point | §8.4 |
| New §11 | Pre-implementation checklist: 11 build-time verification steps to run before merging each of A/B/C/D, including the manual paywall smoke test as the highest-priority gate for D | §11 |

These are implementation hygiene, not architecture. Spec is now build-ready.

### v3 — second-round reviewer tightenings

| # | Tightening | Section |
|---|---|---|
| T8 | Worker connection repo is a single-purpose function (`getWebLoginConnectionForRun`). No generic `getById`, no list, no search. Lint rule prevents `db` import outside `worker/src/persistence/`. | §6.6.2 |
| T9 | Deny-by-default contract enforcement. Hard fail (never warning) on domain violation, artifact mismatch, step/time limits, success-condition unmet. `ContractEnforcedPage` proxy makes it non-bypassable. | §6.7.1 |
| T10 | Fingerprint shape is keyed by intent (`last_processed_fingerprints_by_intent`) so multi-intent agents don't collide. | §6.7.2 |
| T11 | Slack post dedup uses a deterministic `postHash = sha256(runId + channel + filename + messageTextHash)` so trivially-different inputs still dedupe. | §5.5.1 |
| T12 | Explicit byte ceilings on inline text (1 MB artifact, 2 MB deliverable) with `*_truncated` flags and a single `writeWithLimit` helper. Truncation never silently fails. | §6.7.3 |
| T13 | All failures aligned to a single `failureReason` enum (`connector_timeout`, `rate_limited`, `auth_error`, `data_incomplete`, `internal_error`, `unknown`) plus a `failureDetail` sub-string. Single `failure()` helper enforces consistency. | §8.4 |
| T14 | Cross-subaccount credential isolation enforced in the WHERE clause of `getWebLoginConnectionForRun`. Tenant-isolation tests assert all four resolution cases. | §6.6.3 |

All seven are hardening / edge-case containment / future-proofing. None require redesign. Reviewer explicitly green-lit build after this round.

### v2 — first-round reviewer tightenings

| # | Tightening | Section |
|---|---|---|
| T1 | Decrypted secrets never enter pg-boss payload. Worker fetches by `connectionId` and decrypts just-in-time. | §6.5, §6.6, §6.6.1 |
| T2 | `login_test` mode is a deterministic, non-LLM path. Worker handler branches before `executionLoop`. | §6.3.1 |
| T3 | Per-step Slack idempotency: cache `messageTs` on the run, skip duplicate posts on operator retry. | §5.5.1 |
| T4 | Persisted content fingerprint on `subaccount_agents` to skip duplicate downloads (pinned, reordered, same hash). | §6.7.2 |
| T5 | Artifact durability matrix: report markdown stored in `task_deliverables.body_text` so deliverables survive worker cleanup. | §6.7.3 |
| T6 | Split `canViewContents` from `canManageSkill`. Owner-tier read no longer requires manage permission. | §3.4 |
| T7 | Explicit `BrowserTaskContractSchema` (allowedDomains, expectedArtifactKind, successCondition, etc.) constructed by the service, not the LLM. | §6.7.1 |
| Q2 | Paywall 2FA confirmed absent. | §9.4 |
| Q4 | Slack workspace for dev: throwaway + mocked. | §9.4 |
| Q7 | `ENCRYPTION_KEY` must be separate from `JWT_SECRET`. Rationale documented. | §2.4 |

### v1 — original draft (superseded)

Initial spec covering A/B/C/D code changes and the §7 configuration walkthrough.

---

## 11. Pre-Implementation Checklist

These are **build-time verification steps**, not new architecture. Run them at the start of Code Change D and again before merging each of A/B/C/D. None of these should slow planning, but skipping any of them will cause real-world pain after deploy.

### 11.1 Browser contract is genuinely non-bypassable

Architectural intent: §6.7.1 (`ContractEnforcedPage`).

Verification (must all be true before merging D):

- [ ] `grep -rn "page\." worker/src/browser/` returns only references to the wrapper, never to a raw Playwright `Page` outside `playwrightContext.ts`
- [ ] `executionLoop()` signature accepts only `ContractEnforcedPage`, not `Page`
- [ ] No helper utility (`worker/src/browser/observe.ts`, `worker/src/browser/executor.ts`) reads from a raw `Page`
- [ ] Unit test: instantiate `ContractEnforcedPage` with a fake page; assert that calling `goto('https://evil.example.com')` against an `allowedDomains: ['42macro.com']` contract throws and never delegates to the underlying page
- [ ] Unit test: assert that a server-side redirect to an out-of-contract host terminates the run (the wrapper hooks into the `response` event to validate final URL)

If any one of these fails, the deny-by-default model is broken and the change must not merge.

### 11.2 Agent → contract construction boundary

Architectural intent: §6.7.1 (service-built contract, not LLM-built).

Verification:

- [ ] `agentExecutionService` is the **only** caller of `BrowserTaskContractSchema.parse()`
- [ ] The LLM tool definition for `browser_task` exposes only `intent` and `connectionName` (or `connectionId`) — **never** `allowedDomains`, `expectedArtifactKind`, or `successCondition`
- [ ] Tool argument validation strips any extra keys the LLM tries to send (zod `.strict()`)
- [ ] Unit test: simulated LLM tool call attempting `{ intent: 'download_latest', allowedDomains: ['evil.com'] }` is rejected by the tool argument schema before reaching the service

This closes the prompt-injection / hallucination expansion path.

### 11.3 Worker is a trusted enclave with secrets — lock down logging

Architectural intent: §6.6.2 (single-purpose repo, T8).

Verification:

- [ ] `grep -rEn "console\.(log|error|warn|info)" worker/src/` reviewed manually; no logger receives a `WebLoginCredentials`, `password`, `botToken`, or full connection row
- [ ] Logger redaction list updated: `password`, `secretsJson`, `botToken`, `apiKey`, `Authorization`, `cookie`. Logger applies redaction recursively on object payloads.
- [ ] Error serialization (e.g. `err.message`, `err.stack`) never includes the credentials object — `performLogin` catches and re-throws via `failure()` with metadata that explicitly excludes `creds`
- [ ] No retry path re-enqueues a payload containing decrypted secrets (impossible by §6.5 / T1, but verified once more here)
- [ ] `DecryptedWebLoginConnection` type's `password` field is `Branded<string, 'Plaintext'>` so any accidental serialization via `JSON.stringify` of a payload containing it can be caught by a custom replacer

### 11.4 Failure helper is the only emit point

Architectural intent: §8.4 (T13).

Verification:

- [ ] Lint rule active in both `server/` and `worker/` ESLint configs
- [ ] `grep -rn "failureReason:" server/ worker/ shared/ | grep -v 'lib/failure.ts' | grep -v 'runtime/failure.ts' | grep -v 'schema/'` returns zero results outside the helper, schemas, and persistence layer
- [ ] Persistence layer zod validates `failureReason` against the enum on every write

### 11.5 Slack hash stability

Architectural intent: §5.5.1 (T11).

Verification:

- [ ] `messageTextHash` is computed inside `send_to_slack` skill executor **after** any markdown rendering / variable substitution and **before** the `chatPostMessage` call
- [ ] Unit test: same logical input passed twice through the skill produces the same `postHash`
- [ ] Unit test: input with different whitespace/escaping but identical rendered output produces the same `postHash`
- [ ] Unit test: input that genuinely differs in content produces a different `postHash`

### 11.6 Fingerprint correctness

Architectural intent: §6.7.2 (T4 + T10).

Verification:

- [ ] `contentHash` computed by streaming the file from disk through `crypto.createHash('sha256')` after download completes; never derived from URL, headers, or in-memory metadata
- [ ] `canonicaliseUrl()` helper exists in `worker/src/util/url.ts` and is called both at write time (before storing fingerprint) and at compare time (before lookup)
- [ ] Unit test: two URLs differing only in `?utm_source=...` produce the same canonical form
- [ ] Unit test: two byte-identical files at different URLs produce the same `contentHash`
- [ ] Unit test: a 1-byte change in the file produces a different `contentHash`

### 11.7 UTF-8 safe truncation

Architectural intent: §6.7.3 (T12).

Verification:

- [ ] `writeWithLimit` backtracks to a UTF-8 character boundary before appending the truncation marker
- [ ] Unit test: input containing 4-byte emoji at byte position `maxBytes - 1` produces valid UTF-8 output, shorter than `maxBytes`, with no replacement characters
- [ ] Unit test: round-trip the truncated value through `Buffer.from(stored, 'utf8').toString('utf8')` and assert no decoding error

### 11.8 Login flow resilience — manual smoke test against the real paywall

This is the **single biggest external risk** in D and must be done before writing the bulk of the code.

Verification:

- [ ] Manually run a one-off Playwright script (10 lines) against `https://42macro.com/login` with the real credentials — confirm:
  - Login succeeds with the default selectors (`#email`, `#password`, `button[type=submit]`)
  - No hidden redirect chain (more than one navigation between login and dashboard)
  - No JS-only navigation that breaks `waitForNavigation`
  - The members video page renders server-side (not behind a JS hydration that hides downloads)
  - The latest video has a stable, scrapable download URL or button
- [ ] If any of the above fails: capture the actual DOM and stop. Re-plan §6.4 selector defaults and possibly the `download_latest` browser intent strategy before continuing.
- [ ] Document the confirmed selectors in §7.2 step 1 so the operator setup is one-shot.

### 11.9 pg-boss payload size sanity

Architectural intent: §6.5 / T1 (no secrets in payload).

Verification:

- [ ] `BrowserTaskPayloadSchema` enqueued payload is logged once during a test run; `JSON.stringify(payload).length < 4096` (typical < 1 KB after T1)
- [ ] No payload field contains arrays of artifact bytes, transcripts, or markdown bodies
- [ ] No field of the payload schema is `z.any()` or unbounded `z.string()` — every string has a `max()`

### 11.9.1 Correlation ID invariant (T15)

**The rule:** every log line, every persisted artifact metadata blob, every Slack post payload, every failure object, and every audit event in this workflow must carry both `runId` and `correlationId`. No exceptions.

This is what makes "why did this run fail?" answerable in 30 seconds — without it, debugging fragments across the agent run, the worker, the Whisper call, and the Slack post.

Concretely:

- **Logger**: the worker and server loggers must be instantiated with a child context that includes `{ runId, correlationId, organisationId }`. Anywhere a logger is created without that context is a bug.
- **Artifacts**: `execution_artifacts.metadata` always includes `{ runId, correlationId }` in its jsonb payload, alongside the artifact-specific metadata.
- **Slack**: the `send_to_slack` skill stores `{ runId, correlationId }` in `agent_runs.metadata.slackPosts[i]` so an operator looking at a Slack message can trace it back to a run.
- **Failure objects**: `failure(reason, detail, metadata)` always merges `{ runId, correlationId }` into `metadata` automatically — callers never pass these explicitly, the helper enriches them from the `AsyncLocalStorage` trace context.
- **Audit events**: `audit_events.metadata` always includes both fields.

Verification (added to §11.10 checklist):
- [ ] `grep -rEn "logger\.(info|warn|error)" worker/src server/services/skillExecutor.ts` reviewed; every logger instance traces back to a child context that includes `runId` and `correlationId`
- [ ] Persistence layer for `execution_artifacts`, `audit_events`, and `agent_runs.metadata.slackPosts` rejects writes missing either field (zod check)
- [ ] Manual: trigger a deliberate failure end-to-end; confirm a single search for `correlationId=<id>` surfaces the agent_run row, all execution_steps, the worker logs, the audit event, and the Slack post (or its failure)

### 11.10 Observability completeness — "why did this run fail?" in 30 seconds

Verification: for a deliberately-failed run (login_failed by wrong password), an operator opening the run detail page should see, **without grepping logs**:

- [ ] The terminal `failureReason` and `failureDetail`
- [ ] The `performLogin` step result (success / failure with sub-reason)
- [ ] The screenshot artifact captured at the failure point, linked from the run detail UI
- [ ] The contract that was used (allowedDomains, intent, expectedArtifactKind)
- [ ] Any contract violations that occurred (with the offending URL / mime type / etc.)
- [ ] The fingerprint decision (skip vs process, with the matching prior fingerprint if skipped)
- [ ] The Slack post result (messageTs + permalink, or failure reason)

If any of these are not surfaced in the existing run-detail UI, add the minimum tracing/event fields to make them visible. Better to add a logging line now than to debug a production failure blind in three weeks.

### 11.11 Things to **not** spend time on (deferred)

Per the reviewer, do not delay D for:

- Perfect Slack race handling (the hash + parent-run idempotency is sufficient for v1)
- Object-storage upload for artifacts
- Multi-video / multi-period selection logic
- Slack OAuth install flow
- Advanced retry orchestration beyond the existing retry profiles

These are tracked as v2 follow-ups in §9.5.








