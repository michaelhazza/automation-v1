# Live External Document References — Specification

**Status:** Draft — awaiting spec-reviewer pass
**Classification:** Major — new subsystem, cross-cutting concern, touches context assembly, OAuth, data model, and three UI surfaces
**Source brief:** [`docs/external-document-references-dev-brief.md`](./external-document-references-dev-brief.md)
**Mockups:** [`docs/mockups/external-doc-references.html`](./mockups/external-doc-references.html)
**Target migration start:** `0262`

---

## Table of contents

1. [Summary](#1-summary)
2. [Motivation](#2-motivation)
3. [Architecture overview](#3-architecture-overview)
4. [Data model](#4-data-model)
5. [Google Drive OAuth integration](#5-google-drive-oauth-integration)
6. [Fetch resolver service](#6-fetch-resolver-service)
7. [Cache strategy](#7-cache-strategy)
8. [State machine and failure policy](#8-state-machine-and-failure-policy)
9. [Context assembly integration](#9-context-assembly-integration)
10. [UI surfaces](#10-ui-surfaces)
11. [Contracts](#11-contracts)
12. [Permissions and RLS](#12-permissions-and-rls)
13. [File inventory](#13-file-inventory)
14. [Implementation phases](#14-implementation-phases)
15. [Execution model](#15-execution-model)
16. [Testing posture](#16-testing-posture)
17. [Execution-safety contracts](#17-execution-safety-contracts)
18. [Deferred items](#18-deferred-items)

---

## 1. Summary

This spec defines the v1 implementation of live external document references — the ability to attach files from connected cloud storage (starting with Google Drive) to tasks, scheduled tasks, and agents, with the platform fetching the latest version of each file at runtime.

When an agent run starts, the platform resolves each attached external reference by performing a cheap change-detection check against the provider and serving from a persistent cache on hit, or refetching and updating the cache on miss. The agent receives normalised plain text alongside provenance metadata. The content is always current without any manual intervention from the user.

This is distinct from the existing static-upload flow. Uploaded documents are snapshots; external document references are live pointers. Both coexist in the same attachment surface and the same context-assembly pipeline.

**In scope for v1:**

- Google Drive OAuth connection (subaccount-scoped, shared credential)
- Attaching Drive files to tasks (TaskModal), scheduled tasks and agents (DataSourceManager)
- Google Docs (prose) and Google Sheets (tabular, normalised to CSV) resolver
- PDF basic text extraction (no OCR, no layout)
- Persistent DocumentCache keyed on `(provider, file_id, connection_id)` with revisionId/ETag change detection
- Single-flight guard to prevent cache stampedes
- Reference state machine: `active`, `degraded`, `broken`
- Task-level failure policy: `tolerant` (default), `strict`, `best_effort`
- Provenance metadata injected with every document block
- Token quotas: per-subaccount 100 references, per-task 20 references, per-document hard block at 100K tokens
- Re-attach flow for broken references

**Out of scope for v1 (see §14):**

Other providers, folder attachments, webhook invalidation, image and Office binary parsing, pinned version (deferred to post-v1 review), pre-run health checks.

---

## 2. Motivation

The platform today supports two ways to give an agent document context: upload a file (static snapshot stored in R2/S3) or point at a URL (fetched at run time by `agentService.fetchSourceContent`). Neither path handles the dominant real-world case: a file that lives in a shared workspace, is actively edited by the team, and needs to be read in its current state every time the agent runs.

A weekly competitive-summary agent that reads a planning document should pick up Monday's edits. A client-onboarding agent that reads a "company context" document at the subaccount level should always be reading the latest version. Both of these are scheduled, recurring tasks — and today both require the operator to re-upload the document every time it changes, which does not happen.

The live external document reference closes this gap: the operator picks the file once, and the platform handles freshness automatically from that point on. Scheduled tasks, which are the primary use case, benefit immediately because their runs are unattended by definition.

A secondary benefit is connection durability. The connection is shared across the subaccount, not tied to the attaching user's personal session, so it survives when that user goes on holiday or leaves the company.

## 3. Architecture overview

### 3.1 Existing primitives being extended

This spec reuses and extends four existing systems:

| Existing primitive | What changes |
|---|---|
| `reference_documents` + `document_bundle_members` + `document_bundle_attachments` | New `source_type = 'google_drive'` variant; new external-only columns on `reference_documents`; `fetch_failure_policy` column on `document_bundle_attachments` |
| `integration_connections` | New `provider_type = 'google_drive'`; shared OAuth credentials flow |
| `agent_data_sources` (DataSourceManager) | New `source_type = 'google_drive'`; new nullable `connection_id` FK column |
| `runContextLoader` / context assembly pipeline (`agentExecutionService`, `agentService`) | New branch in `loadSourceContent` for `google_drive` type; provenance block injected alongside content |

New primitives justified below:

- **`document_cache` table** — the existing caching in `agentService.ts` is purely in-memory with no persistence across restarts. External document references require persistent caching with revision tracking and lazy invalidation. A new table is the correct primitive (not extending the in-memory map or reusing `scraping_cache`, which is URL-keyed and semantically different).
- **`document_fetch_events` table** — the existing execution event system (`agentExecutionEventService`) is for agent-level events, not per-document fetch audit records. A separate table keeps the audit log queryable per-document without coupling to the run event stream.
- **`externalDocumentResolverService`** — a new service that encapsulates provider-specific fetch and normalisation logic behind a stable interface. This is the extension point for future providers (OneDrive, Dropbox). Placing this logic inside `agentService.ts` would make that file unbounded in scope.

### 3.2 Data flow at run time

```
agentExecutionService.executeRun()
  └─► runContextLoader.loadRunContextData()
        └─► for each external reference in the context bundle:
              externalDocumentResolverService.resolve(reference)
                ├─ check document_cache for (provider, file_id, connection_id)
                │    hit: check revisionId/ETag against provider (cheap HEAD or metadata call)
                │         unchanged: return cached content
                │         changed:   fetch full content → update cache → return
                │    miss: fetch full content → write cache → return
                └─ return ResolvedDocument { content, provenance, tokensUsed, cacheHit }
        └─► assemble context blocks in attachmentOrder sequence
              each block: [provenance header] + [normalised content]
        └─► enforce token budget: truncate if cumulative tokens exceed budget
  └─► build system prompt with assembled context blocks
```

Single-flight guard: an in-process `Map<string, Promise<ResolvedDocument>>` keyed on `(provider:fileId:connectionId)` prevents concurrent runs from making duplicate fetch calls for the same document within the same scheduler tick.

### 3.3 Attachment surfaces

External references reach the runtime through two different paths, depending on entity type:

| Entity | Attachment surface | Storage |
|---|---|---|
| Task | TaskModal, Attachments tab | `reference_documents` + `document_bundle_attachments(subject_type='task')` |
| Scheduled task | DataSourceManager | `agent_data_sources` with `source_type='google_drive'` and `scheduled_task_id` |
| Agent | DataSourceManager | `agent_data_sources` with `source_type='google_drive'` and `agent_id` |

The context assembly pipeline already reads from both systems (via `runContextLoader`). Both paths route through `externalDocumentResolverService` at fetch time and write to the same `document_cache` and `document_fetch_events` tables.

## 4. Data model

All changes ship in a single migration: `0262_external_doc_refs_google_drive.sql`. No phase split — every table and column is needed at the same time for the feature to function.

### 4.1 Extended tables

#### `reference_documents`

Current schema: `server/db/schema/referenceDocuments.ts`. Current `source_type` enum values: `'manual' | 'external'`.

New columns added in migration 0262:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `external_provider` | `varchar(64)` | yes | `'google_drive'` for v1; null for `source_type = 'manual'` |
| `external_connection_id` | `uuid` | yes | FK to `integration_connections.id` (set null on connection delete) |
| `external_file_id` | `varchar(1024)` | yes | Provider-native file identifier (Drive `fileId`) |
| `external_file_name` | `varchar(512)` | yes | Display name as returned by the provider at attach time |
| `external_file_mime_type` | `varchar(256)` | yes | MIME type as returned by the Picker at attach time (e.g. `application/vnd.google-apps.document`); stored for display and initial routing; fetch-time MIME type is authoritative if they differ |
| `attached_by_user_id` | `uuid` | yes | FK to `users.id`; the user who attached it; null for programmatic attachment |
| `attachment_order` | `integer` | no, default `0` | Explicit index determining context-injection order; stable across renames and migrations |
| `attachment_state` | `varchar(32)` | yes | `'active' | 'degraded' | 'broken'`; null for `source_type = 'manual'` |

The existing `source_type` enum is extended: `'manual' | 'external' | 'google_drive'`. Documents with `source_type = 'google_drive'` always have `external_provider`, `external_connection_id`, `external_file_id`, and `attachment_state` set.

**Why `source_type` rather than a separate FK table:** the existing `document_bundle_members` join and the context loader already dispatch on `source_type`. Adding a new variant is the minimal-diff path and avoids a new join.

#### `document_bundle_attachments`

Current schema: `server/db/schema/documentBundleAttachments.ts`.

New column:

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `fetch_failure_policy` | `varchar(32)` | no | `'tolerant'` | `'strict' | 'tolerant' | 'best_effort'`; applies to all external references in the bundle |

One bundle attachment row exists per (bundle, subject) pair. The failure policy is therefore per-subject (task, agent, scheduled task) as the brief specifies.

#### `agent_data_sources`

Current schema: `server/db/schema/agentDataSources.ts`. Current `source_type` enum values: `'r2' | 's3' | 'http_url' | 'google_docs' | 'dropbox' | 'file_upload'`.

New `source_type` value: `'google_drive'`.

New column:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `connection_id` | `uuid` | yes | FK to `integration_connections.id` (set null on connection delete); required when `source_type = 'google_drive'`, null otherwise |

When `source_type = 'google_drive'`, `source_path` stores the Drive `fileId` (not a URL). The existing `fetchSourceContent` dispatch in `agentService.ts` branches on this type and delegates to `externalDocumentResolverService`.

#### `integration_connections`

Current schema: `server/db/schema/integrationConnections.ts`. Current `provider_type` enum values include `'gmail' | 'slack' | 'hubspot' | 'ghl' | 'teamwork'` etc.

New `provider_type` value: `'google_drive'`.

Google Drive connections are OAuth 2.0 (`auth_type = 'oauth2'`). The existing encrypted token fields (`access_token`, `refresh_token`, `token_expires_at`) carry the Drive credentials. No schema column additions required — only the enum extension.

### 4.2 New tables

#### `document_cache`

Persistent cache for normalised external document content.

```sql
CREATE TABLE document_cache (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id     uuid NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  provider          varchar(64)  NOT NULL,  -- 'google_drive'
  file_id           varchar(1024) NOT NULL,
  connection_id     uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  content           text NOT NULL,
  revision_id       varchar(512),           -- Drive revisionId or HTTP ETag; null if provider offers none
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  content_size_tokens integer NOT NULL,
  content_hash      varchar(64) NOT NULL,   -- sha-256 hex digest of the content field; for integrity verification
  resolver_version  integer NOT NULL,       -- links to the resolver implementation version
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, file_id, connection_id)
);
```

Composite unique constraint on `(provider, file_id, connection_id)` is the idempotency key for cache writes. A conflicting insert (retry path) does an `ON CONFLICT (provider, file_id, connection_id) DO UPDATE SET content = EXCLUDED.content, ...` — atomic upsert, no duplicate rows.

RLS: tenant-isolated on `organisation_id` and `subaccount_id`.

#### `document_fetch_events`

Append-only audit log of every content access (cache hit or miss).

```sql
CREATE TABLE document_fetch_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id     uuid NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  reference_id      uuid,                   -- nullable: references reference_documents.id or agent_data_sources.id depending on path
  reference_type    varchar(32) NOT NULL,   -- 'reference_document' | 'agent_data_source'
  run_id            uuid,                   -- nullable: null for manual test-fetch actions
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  cache_hit         boolean NOT NULL,
  provider          varchar(64) NOT NULL,
  doc_name          varchar(512),
  revision_id       varchar(512),
  tokens_used       integer NOT NULL,
  tokens_before_truncation integer,         -- null if no truncation occurred
  resolver_version  integer NOT NULL,
  failure_reason    varchar(64),            -- null on success; 'auth_revoked|file_deleted|rate_limited|network_error|quota_exceeded|budget_exceeded|unsupported_content' on failure
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

`document_fetch_events` is append-only. No updates, no deletes (soft or hard). The `failure_reason` enum is closed in v1; new values require a spec amendment and a migration.

RLS: tenant-isolated on `organisation_id` and `subaccount_id`.

### 4.3 Enum extensions

All enum extensions ship in migration 0262 as `ALTER TYPE ... ADD VALUE`:

| Table / column | New value | When used |
|---|---|---|
| `reference_documents.source_type` | `'google_drive'` | External Drive references via TaskModal |
| `agent_data_sources.source_type` | `'google_drive'` | External Drive references via DataSourceManager |
| `integration_connections.provider_type` | `'google_drive'` | The OAuth connection powering Drive access |

## 5. Google Drive OAuth integration

### 5.1 Connection type

Google Drive is a new OAuth 2.0 provider added to `integration_connections`. It is separate from the existing Gmail integration — connecting Drive does not grant email access and connecting Gmail does not grant Drive access. The two integrations use different OAuth scopes and produce separate `integration_connections` rows.

Required OAuth scope for v1: `https://www.googleapis.com/auth/drive.readonly`. Read-only is sufficient; the platform never writes to Drive.

`provider_type = 'google_drive'` is added to the enum in migration 0262. No new columns are needed on `integration_connections` — the existing encrypted token fields cover the Drive credential.

### 5.2 OAuth flow

The Drive connection flow reuses the existing OAuth infrastructure (`/api/integrations/oauth/...` routes). The only addition is a new provider handler for `google_drive` that:

1. Redirects to Google's OAuth 2.0 consent screen with `drive.readonly` scope
2. On callback, exchanges the code for `access_token` + `refresh_token` and stores them encrypted in `integration_connections`
3. Sets `connection_status = 'active'`
4. At run time, refreshes the access token via `refresh_token` when `token_expires_at` is within 5 minutes of expiry — identical to the existing Gmail refresh logic

Token refresh is handled inline within `externalDocumentResolverService.resolve()` before any Drive API call. If refresh fails, the reference transitions to `degraded` (if cache exists) or `broken` (if cache is empty or expired).

### 5.3 Subaccount scope

Drive connections are scoped to the subaccount (`subaccount_id` set, `organisation_id` set). A connection created in subaccount A is not accessible to subaccount B. This matches the existing isolation model for all other OAuth connections.

The connection is shared across the subaccount: any admin in the subaccount can attach Drive files using the connection, and the connection remains live if the connecting user leaves the organisation. This is enforced by the OAuth grant being stored at the subaccount level, not tied to a specific user's session.

**Connection ownership note.** The `owner_user_id` column on `integration_connections` records who created the connection for audit purposes, but access is not gated on that user's ongoing presence. Any subaccount admin can re-attach references to a different connection if the original connection is revoked.

### 5.4 Scopes and file picker authorisation

The Drive file picker (§10.3) uses the Google Picker API, which requires a short-lived OAuth token scoped to `drive.readonly`. This token is obtained from the server at picker-open time:

```
GET /api/integrations/google-drive/picker-token?connectionId=<id>
→ { accessToken: string, pickerApiKey: string, appId: string }
```

The server decrypts and returns the connection's current access token (refreshing if needed). The frontend embeds this token in the Picker API call. The token is not stored client-side beyond the duration of the picker session. The Google-issued access token TTL is set by Google (typically 1 hour); the server-side refresh logic manages expiry independently. For the picker specifically, the token is treated as ephemeral: used only to initialise the Picker API and discarded when the picker closes or the modal unmounts. It is never cached, persisted, or reused across picker sessions on the frontend.

This route is guarded by `authenticate` + `requirePermission('org.integrations.manage')` and validates that the requested `connectionId` belongs to the caller's subaccount.

## 6. Fetch resolver service

### 6.1 Resolver interface

`externalDocumentResolverService` (`server/services/externalDocumentResolverService.ts`) is the single entry point for all external document fetches. It implements the resolver interface and delegates to provider-specific resolvers.

```typescript
interface ExternalDocumentResolver {
  // Returns the provider's current change-detection token (revisionId or ETag).
  // Cheap call — metadata only, no content download.
  checkRevision(fileId: string, accessToken: string): Promise<string | null>;

  // Fetches and normalises the document content to plain text.
  fetchContent(fileId: string, mimeType: string, accessToken: string): Promise<string>;

  // The version of this resolver implementation.
  // Increment when normalisation output changes in a way that would alter cached content.
  readonly resolverVersion: number;
}
```

**Determinism invariant:** given the same `(fileId, mimeType, accessToken)` at a fixed point in time, `fetchContent` must produce deterministic normalised output. The resolver must not apply non-deterministic transformations (timestamp injection, random sampling, etc.). This is required for reliable cache invalidation on resolver-version increment — if two calls to the same version produce different output, the versioning scheme breaks.

```typescript
```

`externalDocumentResolverService.resolve(params)` orchestrates: token refresh → cache lookup → change detection → fetch or serve from cache → write `document_fetch_events` row → return `ResolvedDocument`. See §11.4 for the full `ResolvedDocument` shape.

### 6.2 Google Drive resolver (v1)

The v1 Google Drive resolver (`server/services/resolvers/googleDriveResolver.ts`) handles the three supported file types:

**Google Docs** — `application/vnd.google-apps.document`

Fetched via the Google Drive export API:
```
GET https://www.googleapis.com/drive/v3/files/{fileId}/export?mimeType=text/plain
Authorization: Bearer {accessToken}
```
Returns raw plain text. No additional normalisation needed for prose documents.

**Google Sheets** — `application/vnd.google-apps.spreadsheet`

Fetched via the Drive export API as CSV:
```
GET https://www.googleapis.com/drive/v3/files/{fileId}/export?mimeType=text/csv
Authorization: Bearer {accessToken}
```
Returns the first sheet as CSV. If the file has multiple sheets, only the first sheet is exported (Google's API behaviour). This limitation is documented in provenance metadata.

**Size guard:** Before tokenisation, if the raw exported CSV response body exceeds 5MB, the resolver hard-fails with `failure_reason = 'quota_exceeded'`. The content is not cached. This prevents memory exhaustion from unexpectedly large spreadsheets (e.g., sheets with hundreds of thousands of rows). The 5MB limit is checked on the raw response body size before any processing.

**PDF** — `application/pdf`

PDFs stored in Drive are fetched via the Drive download API (not the export API, since PDFs are not Google Workspace types):
```
GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media
Authorization: Bearer {accessToken}
```
Text is extracted using a basic PDF text extraction library. No OCR. No layout preservation. Scanned or image-only PDFs produce empty or near-empty content.

**Minimum content threshold:** If extracted content is fewer than 200 tokens (approximately 150 words), the resolver treats the fetch as a failure with `failure_reason = 'unsupported_content'`. The content is not cached. The reference transitions to `degraded` (prior cache entry exists within staleness boundary) or `broken` (no usable cache). This threshold applies to all file types, not just PDFs — content below 200 tokens is unlikely to provide usable agent context and silently injecting it produces misleading runs.

**Unsupported types** — The resolver rejects any other MIME type with `failure_reason = 'unsupported_type'` (not a `failureReason` enum member in v1; this surfaces as a task setup error, not a runtime failure, since unsupported types are blocked in the file picker UI). If somehow an unsupported type reaches the resolver, the reference transitions to `broken`.

**Change detection** — Use the Drive Files API metadata endpoint:
```
GET https://www.googleapis.com/drive/v3/files/{fileId}?fields=id,name,mimeType,modifiedTime,headRevisionId
Authorization: Bearer {accessToken}
```
`headRevisionId` is the change-detection token stored as `revision_id` in `document_cache`. If `headRevisionId` matches the cached value, the document is unchanged and the cached content is served without downloading.

### 6.3 Resolver versioning

Each resolver implementation carries a `resolverVersion: number` integer (starting at `1` for the initial v1 implementation). This integer is stored in every `document_cache` row and every `document_fetch_events` row. The resolver's own `resolverVersion` property is the single source of truth — there is no separate global constant. The cache lookup reads `resolver.resolverVersion` directly.

When the resolver logic changes in a way that would alter the normalised output for existing documents (e.g., improved paragraph extraction, changed CSV escaping), the `resolverVersion` is incremented.

**Lazy invalidation:** On cache lookup, the cached row's `resolver_version` is compared to the current resolver's `resolverVersion`. If they differ, the cache entry is treated as a miss regardless of the revision ID match, and a full refetch + cache update is triggered. No background reprocessing or eager cache flush on deploy.

This ensures agents within the same run always see content normalised by the same resolver version (no mid-run inconsistency), and agents after a deploy gradually transition to the new resolver output as their documents are next accessed.

### 6.4 Supported file types

| MIME type | Google product | v1 support | Notes |
|---|---|---|---|
| `application/vnd.google-apps.document` | Google Docs | Supported | Plain text export |
| `application/vnd.google-apps.spreadsheet` | Google Sheets | Supported | First sheet as CSV |
| `application/pdf` | PDF | Supported | Basic text extraction; no OCR |
| `application/vnd.google-apps.presentation` | Google Slides | Not supported | Blocked in file picker |
| `application/vnd.openxmlformats-officedocument.*` | Word/Excel | Not supported | Blocked in file picker |
| All others | — | Not supported | Blocked in file picker |

Unsupported types are greyed out and non-selectable in the Drive file picker modal. An operator cannot attach them. If a file is converted to an unsupported type after attachment, the reference transitions to `broken` on the next fetch attempt.

### 6.5 Provider call timeouts

Hard timeouts apply to all outbound Drive API calls. On timeout, the call is treated as `failure_reason = 'network_error'` and the failure policy is applied.

| Call | Timeout | Constant |
|---|---|---|
| `resolver.checkRevision()` (metadata) | 2 seconds | `EXTERNAL_DOC_CHECK_REVISION_TIMEOUT_MS` |
| `resolver.fetchContent()` (export/download) | 5 seconds | `EXTERNAL_DOC_FETCH_CONTENT_TIMEOUT_MS` |
| Total resolver time across all references per run | 30 seconds | `EXTERNAL_DOC_MAX_TOTAL_RESOLVER_MS` |

When `EXTERNAL_DOC_MAX_TOTAL_RESOLVER_MS` is exceeded mid-run:
- The current in-flight `resolve()` call completes (no forced cancellation mid-call)
- Remaining unresolved references are treated as `failure_reason = 'budget_exceeded'`
- Already-resolved documents remain in context; no rollback occurs
- The failure policy is then applied to each skipped reference

These timeouts also bound the lifetime of entries in the in-process single-flight map (§7.3): all in-flight promises settle within their hard limits, preventing unbounded map growth in abnormal conditions.

### 6.6 Rate limiting and 429 handling

No client-side per-connection request throttle is implemented in v1 (left to Google's server-side API limiting). Resolvers must handle HTTP 429 responses with exponential backoff:

- Up to 2 retries; initial backoff 1 second, doubling to 2 seconds
- A 429 that persists after 2 retries is treated as `failure_reason = 'rate_limited'`
- Retries count against the per-call timeout budget (§6.5); a timeout during a retry is `failure_reason = 'network_error'`

**Retry classification:**

| Failure reason | Retryable | Notes |
|---|---|---|
| `network_error` | Yes | Within per-call timeout budget |
| `rate_limited` | Yes | Bounded retries (max 2, see above) |
| `auth_revoked` | No | Token refresh already attempted; re-auth required |
| `file_deleted` | No | File is gone; retry produces same result |
| `unsupported_content` | No | Content quality issue; retry produces same result |
| `quota_exceeded` | No | System limit; not recoverable by retry |
| `budget_exceeded` | No | Budget enforcement decision; not an error |

---

## 7. Cache strategy

### 7.1 Cache key and lookup

Cache key: `(provider, file_id, connection_id)` — composite unique index on `document_cache`.

Using `connection_id` in the key rather than `(provider, file_id)` alone is a deliberate v1 simplification. The same file accessed via two different connections produces two separate cache entries. This limits cross-connection deduplication efficiency but avoids the access-control complexity of sharing a single cache entry across connections with potentially different permission scopes. v2 may evolve to `(provider, file_id)` with per-connection access validation.

Lookup procedure (inside `externalDocumentResolverService.resolve`):

1. Look up `document_cache` by `(provider, file_id, connection_id)`
2. **Cache miss:** skip to step 4
3. **Cache hit — resolver version check:** if `resolver_version` differs from current, treat as miss
4. **Cache hit — change detection and MIME check:** call `resolver.checkRevision(fileId, accessToken)`. The metadata response includes both `headRevisionId` and `mimeType`.
   - **MIME-type mismatch:** if the returned `mimeType` differs from `reference_documents.external_file_mime_type`, invalidate the cache entry immediately and proceed to step 5 (full refetch). Do not serve cached content typed for a different format — a Google Doc converted to Slides after attachment would otherwise inject text/plain content from the old format. This check takes precedence over revision ID match: a MIME mismatch always triggers a full refetch regardless of whether the revision ID matches.
   - **Revision match (same MIME):** serve cached content. Write a `cache_hit = true` `document_fetch_events` row
   - **Revision mismatch or provider returned null (same MIME):** proceed to step 5
5. **Fetch:** call `resolver.fetchContent(fileId, mimeType, accessToken)`
6. **Cache write:** upsert `document_cache` row (`ON CONFLICT ... DO UPDATE`). Write a `cache_hit = false` `document_fetch_events` row
7. Return `ResolvedDocument`

### 7.2 Change detection

Google Drive provides `headRevisionId` on the file metadata endpoint. This is the primary change-detection signal. When the stored `revision_id` matches `headRevisionId`, the resolver skips the full content download.

For providers that offer no reliable change signal (future providers, or edge cases in Drive), the resolver falls back to a TTL-based strategy: if `fetched_at` is more recent than the configured `cache_ttl_minutes` (default: 60 minutes, configurable per subaccount in a future spec), the cached content is served without a change check. If `fetched_at` exceeds the TTL, a full refetch is triggered.

**Null revisionId path:** if `checkRevision()` returns null (provider offered no revision token), the resolver falls back to the TTL-based strategy above. The `revision_id` column remains null in the cache entry; subsequent runs use `fetched_at` for freshness comparison. This prevents a permanent cache-miss loop where absence of a revision token causes a full refetch on every run.

### 7.3 Single-flight guard

An in-process `Map<string, Promise<ResolvedDocument>>` keyed on `cacheKey = \`${provider}:${fileId}:${connectionId}\`` prevents concurrent runs from issuing duplicate fetch calls for the same document within the same process tick.

When a resolve call arrives for a key already in the map, the new caller awaits the existing promise rather than starting a new fetch. The map entry is removed once the promise settles (success or failure).

**Memory-safety constraints:**
- Entries are removed on both resolution and rejection. A rejected promise removes its entry before the error propagates to any waiting callers.
- Maximum map size: 1000 concurrent in-flight keys. If the map is at capacity when a new resolve call arrives, the single-flight guard is bypassed for that call (it proceeds as an independent fetch). The idempotent cache upsert handles concurrent writes safely.
- No TTL eviction is applied to the map. Abnormal stuck promises are bounded by the per-call timeouts (§6.5), which guarantee all in-flight operations settle within their hard limits.

This guard is in-process only. It does not prevent concurrent fetches across separate server instances. The `document_cache` upsert is idempotent per `(provider, file_id, connection_id)`, so concurrent cross-instance fetches produce at most one cache entry and at most two `document_fetch_events` rows (one per server instance), both with the same `revision_id`. This is acceptable for v1.

### 7.4 Staleness boundary and TTL

A reference in `degraded` state is serving stale cached content. Stale content is acceptable up to a configurable maximum staleness threshold. In v1, this threshold is fixed at 7 days (10,080 minutes). If the last successful fetch (`document_cache.fetched_at`) is older than 7 days, the reference transitions from `degraded` to `broken`.

This prevents silent long-term drift where an agent runs for months on content that was never successfully refreshed.

The 7-day threshold is a hard-coded constant in v1 (`EXTERNAL_DOC_MAX_STALENESS_MINUTES = 10080` in `server/lib/constants.ts`). Subaccount-level configuration is deferred.

### 7.5 Lazy invalidation on resolver upgrade

When `resolver_version` is incremented (a new code deploy changes normalisation logic), existing `document_cache` rows with the old `resolver_version` are not eagerly deleted. They remain in the database and are invalidated lazily on the next access to each cached entry (§7.1, step 3). This prevents:

- Cache stampedes on deploy (no synchronous bulk-delete of all cache entries)
- Mid-run inconsistency (all agents in the same run tick see the same resolver version; the new version takes effect on the next scheduler cycle)

## 8. State machine and failure policy

### 8.1 Reference states

`attachment_state` on `reference_documents` (and an equivalent status derived at runtime from `agent_data_sources` fetch results) takes three values:

| State | Meaning | Task can run? |
|---|---|---|
| `active` | Connection live, last fetch succeeded, cache current | Yes |
| `degraded` | Last fetch failed; agent received stale cached content within staleness boundary | Yes, with warning in run log |
| `broken` | Reference cannot be served even from cache (connection revoked, file deleted, cache expired past staleness boundary) | No — task will not run until reference is resolved or removed |

`degraded` is intentionally synonymous with "serving stale cached content during a transient provider outage." It is not a permanent failure state. A single successful fetch transitions the reference back to `active`.

### 8.2 Valid transitions

```
         attach
(none) ─────────► active ─────────────────────────────────────────────────────┐
                    │                                                           │
                    │ fetch fails, cache exists within staleness boundary       │
                    ▼                                                           │
                degraded ──── fetch succeeds ────────────────────────────────► active
                    │                                                           │
                    │ cache expires past staleness boundary,                    │
                    │ OR connection revoked with empty/expired cache,           │
                    │ OR file deleted                                           │
                    ▼                                                           │
                 broken ──── re-attach (new connection + file picker) ────────► active
                    │
                    │ remove reference
                    ▼
                (removed)
```

**Forbidden transitions:**
- `broken` → `degraded`: a broken reference cannot self-heal to degraded; re-attach always returns to `active`
- `active` → `broken` without passing through `degraded`: only possible when the cache is empty (first-ever fetch fails) or has expired (staleness boundary exceeded on the first post-failure check)

**State write path:** `attachment_state` is written on `reference_documents` at the end of each `externalDocumentResolverService.resolve()` call. The write uses an optimistic `UPDATE ... WHERE attachment_state = <expected_pre_state>` predicate (state-based idempotency). A 0-rows-updated result means the state was already updated by a concurrent resolve call; the current caller treats its result as superseded and does not retry.

**`agent_data_sources` rows** (DataSourceManager path) do not have an `attachment_state` column — they use the existing `last_fetch_status` column (`'ok' | 'error' | 'pending'`). The DataSourceManager UI maps these to equivalent display states using the following explicit mapping:

| `last_fetch_status` | Condition | Effective state |
|---|---|---|
| `'ok'` | any | `active` |
| `'error'` | cache exists within staleness boundary | `degraded` |
| `'error'` | cache empty or expired past staleness boundary | `broken` |
| `'pending'` | any | `active` (initial state before first fetch; run is permitted; no cache exists — first run always incurs a full fetch) |

This mapping is enforced in `runContextLoader` when applying the failure policy to `agent_data_sources` rows. `last_fetch_status` is not changed to a three-value enum in v1.

### 8.3 Task-level failure policy

`fetch_failure_policy` on `document_bundle_attachments` determines how a run responds when one or more external references are in `degraded` or `broken` state at run time. Three values:

| Policy | On degraded reference | On broken reference |
|---|---|---|
| `tolerant` (default) | Serve stale cache, add warning to run log. Run continues. | Run does not start. |
| `strict` | Run does not start. | Run does not start. |
| `best_effort` | Serve stale cache silently. Run continues. | Skip the reference. Run continues. |

Key invariant: a `broken` reference always blocks the run under `tolerant` and `strict`. `best_effort` is the only policy under which a `broken` reference is skipped rather than blocking. This is intentional — `best_effort` should only be used for genuinely optional context where the agent can still produce useful output without the document.

**Budget enforcement interaction:** Budget-exhaustion is treated as a synthetic failure for policy evaluation (recorded as `failure_reason = 'budget_exceeded'`). When the per-run token budget or per-run reference cap is exceeded:

| Policy | Behaviour |
|---|---|
| `strict` | Run fails immediately; no further references processed |
| `tolerant` | Remaining references are skipped with a warning in the run log; run continues with context assembled so far |
| `best_effort` | Remaining references are silently skipped; run continues |

See §9.4 for the full budget enforcement algorithm.

**Processing order invariant:** failure policy is applied in the same deterministic attachment order as reference processing. A failure or skip of reference N does not affect references already resolved (N-1 and earlier). Failures in later references cannot retroactively affect or invalidate earlier ones.

### 8.4 Pinned version

Pinned version (`pinnedVersionId`) is **deferred to post-v1**. The `reference_documents.current_version_id` FK exists in the schema and would be the natural extension point. Pinning is a compliance-sensitive feature that requires additional UI and explicit version-lock semantics not needed for the primary use case. It is listed in §14.

## 9. Context assembly integration

### 9.1 Where external references inject

External document references inject into the agent's `## Your Knowledge Base` system prompt block — the same block that eagerly-loaded data sources already populate. The existing `runContextLoader.loadRunContextData` function is extended to call `externalDocumentResolverService.resolve` for each external reference in the run's context bundle before building the `eager` content list.

No new prompt partition is introduced. External references are content within the existing Knowledge Base block, ordered by `attachmentOrder` and separated by provenance headers (§9.3). The existing 60K-token prompt budget for the Knowledge Base block applies; per-document token limits are enforced before that (§9.4).

### 9.2 Attachment order

External references are processed in ascending `attachment_order` sequence (`reference_documents.attachment_order`). `attachment_order` is an explicit integer set at attach time (auto-assigned as `max(existing) + 1`). It is stable across database migrations, row renames, and environment resets.

If multiple references share the same `attachment_order` (possible only through direct DB manipulation), they are sub-sorted by `created_at` ascending as a deterministic tiebreaker.

**Ordering invariant:** `attachment_order` values within a bundle are strictly increasing at write time. The system auto-assigns `max(existing_attachment_order) + 1` at attach time. The `created_at` tiebreaker is a defensive fallback for direct-DB manipulation only — not an intended ordering mechanism. Duplicate `attachment_order` values within a bundle produced by the system are a bug.

**Mixed-source ordering:** references from both `reference_documents` (task path) and `agent_data_sources` (DataSourceManager path) are merged into a single ordered list before budget enforcement and context injection. All references from both sources are sorted by `attachment_order` ascending; the `created_at` tiebreaker applies across both sources. The failure policy is applied uniformly to the merged list.

Budget enforcement (§9.4) processes references in this same order: the first references in sequence are always included; later ones are skipped if the budget is exhausted. This makes inclusions deterministic across scheduler non-determinism.

### 9.3 Provenance metadata

Every external document block is preceded by a provenance header injected as part of the context block (not as a separate system prompt section). This is mandatory, not optional.

```
--- Document: {document_name}
Source: Google Drive
Fetched: {fetched_at_iso8601}
Revision: {revision_id}   (omitted if provider returned none)
---

{normalised_content}
```

The provenance header helps the model reason about document recency, supports post-run debugging when an agent references unexpected content, and satisfies compliance traceability requirements. It is included on both cache hits and cache misses.

**Provenance accuracy invariant:** provenance metadata must always reflect the actual content served. If cached content is served, `Fetched:` must be the `fetched_at` timestamp from the cache row (when content was last written to cache), not the current time. Fresh revision metadata must never be paired with stale cached content. Pairing a `Revision: 8` header with content from revision 5 would be incorrect and misleading for compliance traceability.

For degraded references (serving stale cache), the provenance header includes an additional line:
```
Warning: content is from cache ({fetched_at}); last fetch failed
```

### 9.4 Token quotas and budget enforcement

Quotas enforced at runtime (not at attach time):

| Scope | Limit | Enforcement |
|---|---|---|
| Per-subaccount references | 100 total | Checked at attach time; attach API rejects if at limit |
| Per-task references | 20 total | Checked at attach time; attach API rejects if at limit |
| Per-document soft warn | 50,000 tokens | Logged to `document_fetch_events.tokens_used`; no truncation |
| Per-document hard block | 100,000 tokens | Content truncated before injection (§9.5) |
| Per-run combined cap | 25 references | Hard cap across both `reference_documents` and `agent_data_sources` paths combined; references beyond 25 are skipped with `failure_reason = 'quota_exceeded'`; failure policy applied to each skipped reference |
| Per-run budget | Task's existing token budget | Cumulative; remaining attachments skipped once exceeded |

**Per-run budget enforcement algorithm:**

```
cumulative_tokens = 0
for reference in sorted(references, key=attachment_order):
    resolved = resolver.resolve(reference)
    if resolved.failure_reason is set:
        apply failure_policy (§8.3)
        continue
    if cumulative_tokens + resolved.tokens_used > run_token_budget:
        record budget_exceeded in document_fetch_events
        apply failure_policy
        break   # remaining references are skipped in order
    cumulative_tokens += resolved.tokens_used
    inject_into_context(resolved)
```

Token counts are computed after truncation (§9.5) but before injection. The `document_fetch_events` row records both `tokens_used` (post-truncation) and `tokens_before_truncation` (pre-truncation; null if no truncation occurred).

**Invariant:** per-document truncation is always applied before token budget evaluation. All budget checks must operate on `tokensUsed` (post-truncation), never on the raw token count. Every `ResolvedDocument` returned by `resolve()` carries post-truncation counts in `tokensUsed`; callers must not re-compute token counts from `content`.

**Small-document fragmentation warning:** after resolving all references, if more than 50% of successfully resolved references contain fewer than 500 tokens each, a warning is emitted in the run log: `"N of M references contained fewer than 500 tokens; context may be fragmented"`. No blocking occurs — this is a diagnostic signal only.

### 9.5 Truncation strategy

Documents exceeding the 100K-token hard limit are truncated using a head + tail strategy:

- 70% of the token budget preserved from the head (beginning of document)
- 30% preserved from the tail (end of document)
- A visible marker inserted at the cut point: `[TRUNCATED: {n} tokens removed]`

Rationale: the head typically contains the document's key assertions; the tail often contains totals, conclusions, or signatures — both semantically important. Silently dropping the tail risks destroying the document's logical conclusion (e.g., the total row in a financial sheet, the conclusion section of a legal brief).

The truncation point is computed by token count, not by byte or line count. Token counting for final budget enforcement must use the exact tokenizer as the runtime LLM. A fast approximation (within 5%) is permitted only for pre-checks — the 200-token minimum content threshold (§6.2) and the 500-token fragmentation warning (§9.4). Using an approximation for final budget enforcement creates environment-dependent behaviour: runs that fit within budget locally may fail in production where the exact tokenizer is used.

## 10. UI surfaces

Reference mockups: [`docs/mockups/external-doc-references.html`](./mockups/external-doc-references.html) — screens 1 through 6.

### 10.1 Integrations and Credentials page *(mockup: Screen 1)*

**File:** `client/src/components/CredentialsTab.tsx`

**Change:** Add `'google_drive'` to `OAUTH_PROVIDER_OPTIONS` array.

New entry shape (matching the existing pattern):

```typescript
{
  value: 'google_drive',
  label: 'Google Drive',
  description: 'Attach Drive files as live document references',
  icon: <GoogleDriveIcon />,   // SVG component — the Drive triangle logo
}
```

The "Add Connection" dropdown renders this entry below a divider separating file-store providers (Google Drive, future OneDrive/Dropbox) from action providers (Gmail, Slack, HubSpot). No other changes to the CredentialsTab layout or connection list rendering.

After a Drive connection is successfully created, a blue information box is shown beneath the connections list:

> **Shared across this subaccount.** Any admin can attach Drive files using this connection. The connection is not tied to your personal account, so it survives if you leave the team. Agents access files on behalf of this connection, not their own identity.

This message is shown only when at least one `google_drive` connection exists in the subaccount. It is dismissed permanently when the user clicks a close button (stored in `localStorage` per-subaccount, not server-side).

### 10.2 TaskModal — Attachments tab *(mockup: Screens 2 and 4)*

**File:** `client/src/components/TaskModal.tsx`

**Changes:**

1. **Attach-from-cloud buttons.** For each connected file-store integration (`provider_type` is a file-store type — `google_drive` in v1), a secondary button appears next to the existing "Upload file" button. The button shows the provider's icon and name (e.g., a Drive triangle icon + "Google Drive"). If no file-store connections exist, no secondary button is shown. If multiple file-store connections exist, one button per provider (not per connection — clicking opens the picker and the user selects which connection to use if multiple exist for that provider).

2. **Drive reference rows.** External Drive references render in the same `bg-slate-50 border border-slate-200 rounded-lg` row style as uploaded attachments. Differences: the type icon is the provider logo (Drive triangle); the meta line shows `Google Drive · {file_type} · Fetched {relative_time}`; a small state badge (`active`, `degraded`, or `broken`) appears inline after the document name; the download button is absent (there is no local copy to download); the delete button removes the reference.

3. **Degraded row.** A degraded reference renders inside an amber-bordered wrapper `border border-amber-200 bg-amber-50 rounded-lg`. The row content is unchanged; the amber border signals the stale state without requiring the user to parse the state badge.

4. **Broken row.** A broken reference renders inside a red-bordered wrapper `border border-red-200 bg-red-50 rounded-lg`. Below the row, an expanded detail section shows: the failure reason in plain English, a "Re-attach using another connection" button, and a "Remove reference" text button. The modal's Save Changes button is disabled while any broken reference exists.

5. **Failure policy control.** Below the attachment list (only visible when at least one Drive reference is attached), a single-line control:

   > If a Drive file can't be fetched: `[select: Use saved copy and continue (default) | Stop the run | Skip the file and continue]`

   The select maps to `fetch_failure_policy` values: `tolerant`, `strict`, `best_effort`. Default: `tolerant`. The control is hidden when no Drive references are attached.

**New API routes needed:**

- `POST /api/tasks/:taskId/external-references` — attach a Drive file
- `DELETE /api/tasks/:taskId/external-references/:referenceId` — remove a reference
- `PATCH /api/tasks/:taskId/bundle-attachment` — update `fetch_failure_policy`

### 10.3 Drive file picker modal *(mockup: Screen 3)*

**New file:** `client/src/components/DriveFilePicker.tsx`

A modal triggered when the user clicks a cloud-storage provider button. For the Google Drive case, it wraps the Google Picker API (loaded via script tag). The Picker API is Google's native file browser — it handles authentication, navigation, and file selection within an iframe provided by Google.

Picker flow:

1. Frontend requests a short-lived access token: `GET /api/integrations/google-drive/picker-token?connectionId=<id>`
2. Frontend loads the Google Picker script if not already loaded
3. Frontend constructs a `google.picker.PickerBuilder` with the token, app ID, and view configured to show only supported MIME types (Google Docs, Sheets, PDFs)
4. User picks a file; the Picker returns: `{ id, name, mimeType, url }`
5. Frontend calls the attach API (`POST /api/tasks/:taskId/external-references`) with the selected file metadata
6. On success, the picker closes and the new Drive reference row appears in the attachment list

If the subaccount has multiple Google Drive connections, a connection-selector step is shown before the Picker opens, allowing the user to choose which connection's Drive to browse.

The Picker is configured to disable multi-select in v1 (one file per picker session). Multiple Drive files are attached by opening the picker multiple times.

Unsupported file types (Slides, Office binaries) are filtered from the Picker's view using MIME type filters on the `google.picker.DocsView`. They do not appear in the picker at all — the user cannot select them.

### 10.4 DataSourceManager *(mockup: Screen 5)*

**File:** `client/src/components/DataSourceManager.tsx`

**Changes:**

1. **New source type option.** `'google_drive'` is added to the source type selector in the "Add Source" inline form. The label is "Google Drive".

2. **Conditional form fields.** When `source_type = 'google_drive'` is selected, the URL input is replaced with a file picker trigger. The form shows: Name (required), Description (optional), Source type (required), and a File field with a "Google Drive" button that opens `DriveFilePicker`. After picking, the selected file's name is shown inline with a checkmark. The `source_path` field stores the Drive `fileId`; the `connection_id` field stores the connection used.

3. **Table display.** The Mode column (eager/lazy) is removed from the table. The Status column for `google_drive` rows shows: `active` (green), `error` (red), or `pending` (grey) — mapped from `last_fetch_status`. The type cell shows `google_drive`. No other table changes.

**New API changes needed in existing scheduled-task and agent data-source routes:**

- Accept `source_type = 'google_drive'` as a valid value
- Accept `connection_id` as an optional field when `source_type = 'google_drive'`
- Validate that `connection_id` is a live `google_drive` connection in the caller's subaccount
- `source_path` must be a non-empty string (the Drive `fileId`) when `source_type = 'google_drive'`

### 10.5 Re-attach modal *(mockup: Screen 6)*

**New file:** `client/src/components/ExternalDocumentRebindModal.tsx`

Triggered by the "Re-attach using another connection" button on a broken reference. Shows:

- The broken document name and failure reason
- A connection selector listing available `google_drive` connections in the subaccount
- An access verification step: after the user selects a connection, the platform calls `GET /api/integrations/google-drive/verify-access?connectionId=<id>&fileId=<id>` to confirm the new connection can read the file before committing the re-attach
- A "Re-attach" confirm button (disabled until a connection with verified access is selected)
- A "Remove reference instead" text button

On confirm: calls `PATCH /api/tasks/:taskId/external-references/:referenceId` with the new `connection_id`. The reference state transitions to `active` on the next successful fetch.

## 11. Contracts

### 11.1 ExternalDocumentReference — `reference_documents` row (google_drive variant)

**Producer:** attach API (`POST /api/tasks/:taskId/external-references`)
**Consumer:** `externalDocumentResolverService`, `runContextLoader`, TaskModal UI

```typescript
{
  id: "3a7c1d2e-...",            // uuid PK
  organisation_id: "...",
  subaccount_id: "...",
  source_type: "google_drive",
  external_provider: "google_drive",
  external_connection_id: "9f3b...",   // FK integration_connections.id
  external_file_id: "1BxiMVs0XRA5nFMd...",  // Drive fileId
  external_file_name: "Company Overview",
  external_file_mime_type: "application/vnd.google-apps.document",
  attached_by_user_id: "...",
  attachment_order: 1,
  attachment_state: "active",          // 'active' | 'degraded' | 'broken'
  name: "Company Overview",            // from existing reference_documents.name
  description: null,
  created_at: "2026-04-30T09:00:00Z",
  updated_at: "2026-04-30T09:04:12Z"
}
```

Nullability: `external_connection_id`, `external_file_id`, `external_file_name`, `external_file_mime_type`, `attached_by_user_id`, `attachment_state` are nullable at the DB level; for rows with `source_type = 'google_drive'` all six are always non-null. A DB CHECK constraint enforces: `source_type != 'google_drive' OR (external_connection_id IS NOT NULL AND external_file_id IS NOT NULL AND external_file_mime_type IS NOT NULL AND attachment_state IS NOT NULL)`.

### 11.2 DocumentCache row shape

**Producer:** `externalDocumentResolverService` (on cache miss or resolver version mismatch)
**Consumer:** `externalDocumentResolverService` (on cache lookup)

```typescript
{
  id: "...",
  organisation_id: "...",
  subaccount_id: "...",
  provider: "google_drive",
  file_id: "1BxiMVs0XRA5nFMd...",
  connection_id: "9f3b...",
  content: "# Company Overview\n\nAcme Corp was founded in...",  // normalised plain text
  revision_id: "7",                // Drive headRevisionId; null if unavailable
  fetched_at: "2026-04-30T09:04:00Z",
  content_size_tokens: 3241,
  content_hash: "a3f9c2d1...",  // sha-256 of content
  resolver_version: 1,
  created_at: "2026-04-30T09:04:00Z",
  updated_at: "2026-04-30T09:04:00Z"
}
```

**Source-of-truth precedence:** `document_cache` is the authoritative source of content for a given `(provider, file_id, connection_id)`. It is superseded only by a fresh provider fetch. The `revision_id` column is the authoritative freshness token — it is not stored anywhere else.

**Write path idempotency:** upsert on `CONFLICT (provider, file_id, connection_id)`. A retry of a failed cache write that had partially committed will update in place rather than creating a duplicate row. This is `key-based` idempotency.

### 11.3 DocumentFetchEvent row shape

**Producer:** `externalDocumentResolverService` (every resolve call, success or failure)
**Consumer:** run log UI (billing surface), future analytics

```typescript
{
  id: "...",
  organisation_id: "...",
  subaccount_id: "...",
  reference_id: "3a7c1d2e-...",      // reference_documents.id or agent_data_sources.id
  reference_type: "reference_document",  // 'reference_document' | 'agent_data_source'
  run_id: "8e9f...",                 // agent_runs.id; null for manual test-fetch
  fetched_at: "2026-04-30T09:04:12Z",
  cache_hit: true,
  provider: "google_drive",
  doc_name: "Company Overview",
  revision_id: "7",
  tokens_used: 3241,
  tokens_before_truncation: null,    // null = no truncation occurred
  resolver_version: 1,
  failure_reason: null               // null on success
}
```

`failure_reason` closed enum: `'auth_revoked' | 'file_deleted' | 'rate_limited' | 'network_error' | 'quota_exceeded' | 'budget_exceeded' | 'unsupported_content'`. New values require a spec amendment and an `ALTER TYPE` migration.

**Failure reason classes** (for logging and UI mapping — not separate DB enums):

| Class | Values | Implication |
|---|---|---|
| External (provider-side) | `auth_revoked`, `file_deleted`, `rate_limited`, `network_error` | User action needed on the connection or file |
| Content (document-side) | `unsupported_content` | Document format is not usable; user should review the attachment |
| System (platform limits) | `quota_exceeded`, `budget_exceeded` | Platform quota or run budget configuration |

UI surfaces should use this classification to decide whether to surface a warning to the user and what remediation to suggest.

No updates or deletes on this table. It is append-only.

### 11.4 ResolvedDocument — runtime payload

**Producer:** `externalDocumentResolverService.resolve()`
**Consumer:** `runContextLoader`, context assembly pipeline

```typescript
interface ResolvedDocument {
  referenceId: string;
  content: string;               // normalised plain text, truncated if necessary
  provenance: {
    provider: "google_drive";
    docName: string;
    fetchedAt: string;           // ISO 8601
    revisionId: string | null;
    isStale: boolean;            // true if serving from cache on a degraded reference
    truncated: boolean;
    tokensRemovedByTruncation: number | null;
  };
  tokensUsed: number;            // token count of content (post-truncation)
  cacheHit: boolean;
  failureReason: string | null;  // null on success
}
```

When `failureReason` is non-null, `content` is an empty string and `tokensUsed` is 0. The caller (context assembly) applies the failure policy before deciding whether to inject anything.

### 11.5 DriveFileMeta — picker API response

**Producer:** Google Picker API (client-side)
**Consumer:** `DriveFilePicker.tsx` → attach API

```typescript
interface DriveFileMeta {
  id: string;        // Drive fileId
  name: string;      // Display name
  mimeType: string;  // MIME type string
  url: string;       // Drive web view URL (for display only; not used for fetching)
}
```

The frontend sends `{ fileId, fileName, mimeType, connectionId }` to the attach API. `url` is not persisted. `mimeType` is stored in `reference_documents.external_file_mime_type` and used by the resolver as the initial export-strategy hint.

**Source-of-truth precedence:** The Drive API's `mimeType` field (returned at fetch time) is the authoritative MIME type, not the one stored at attach time. If a user converts a Google Doc to a Slides presentation after attachment, the fetch-time MIME type triggers an unsupported-type failure regardless of what was stored at attach time.

### 11.6 DocumentResolveLog — runtime structured log entry

**Producer:** `externalDocumentResolverService.resolve()` (emitted to structured logger on every call)
**Consumer:** observability tooling, run-level debugging

```typescript
interface DocumentResolveLog {
  runId: string | null;              // null for manual test-fetch
  referenceId: string;
  provider: string;
  cacheHit: boolean;
  durationMs: number;                // total wall-clock time for the resolve() call
  tokensUsed: number;
  failureReason: string | null;
  concurrentFetchDetected?: boolean; // true when cache miss + upsert conflict occurred, indicating a concurrent cross-instance fetch
}
```

This log entry is emitted alongside the `document_fetch_events` DB row. The DB row is the durable audit record; the structured log is for real-time observability. Both are written on every resolve call, success or failure.

**Derived metric:** `cache_hit_rate = count(cacheHit = true) / total resolve calls` per run. Derivable from `document_fetch_events` grouped by `run_id`. Useful for diagnosing fetch latency spikes (low hit rate on a cached run indicates resolver-version invalidations or frequent document edits).

**Cross-instance cache race observability:** when multiple `resolve()` calls for the same `(provider, file_id, connection_id)` result in concurrent fetches across server instances, this is detectable as duplicate `document_fetch_events` rows with identical `revision_id` and `run_id` within a short time window. The `concurrentFetchDetected` flag in the structured log confirms the condition from the instance that lost the upsert conflict. No logic change is required — this is a pure observability contract.

## 12. Permissions and RLS

### 12.1 New tables

Both new tables are tenant-scoped and must satisfy the four RLS requirements from `DEVELOPMENT_GUIDELINES.md`.

#### `document_cache`

| Requirement | Implementation |
|---|---|
| RLS policy | Migration 0262: `CREATE POLICY document_cache_isolation ON document_cache USING (subaccount_id = current_setting('app.current_subaccount_id')::uuid)` |
| `rlsProtectedTables.ts` entry | `{ tableName: 'document_cache', schemaFile: 'documentCache.ts', policyMigration: '0262_external_doc_refs_google_drive.sql', rationale: 'Per-subaccount document cache — content may include confidential business documents fetched from Drive.' }` |
| Route guard | Cache reads/writes happen server-side only (inside `externalDocumentResolverService`). No direct HTTP endpoint for cache data. The resolver runs within a scoped DB context established by the caller (agent run or test-fetch route). |
| Principal-scoped context | The resolver is called from the agent execution path, which already establishes `app.current_subaccount_id` via `withOrgTx` / `getOrgScopedDb`. No additional setup needed. |

#### `document_fetch_events`

| Requirement | Implementation |
|---|---|
| RLS policy | Migration 0262: same pattern — `USING (subaccount_id = current_setting('app.current_subaccount_id')::uuid)` |
| `rlsProtectedTables.ts` entry | `{ tableName: 'document_fetch_events', schemaFile: 'documentFetchEvents.ts', policyMigration: '0262_external_doc_refs_google_drive.sql', rationale: 'Per-subaccount fetch audit log — records which documents were accessed in which runs.' }` |
| Route guard | Append-only from `externalDocumentResolverService`; no direct HTTP read endpoint in v1. |
| Principal-scoped context | Same as `document_cache` — inherits from the caller's `withOrgTx` context. |

### 12.2 Route guards

All new routes follow the existing guard chain: `authenticate` → `resolveSubaccount` → `requirePermission(key)`.

| Route | Permission key | Notes |
|---|---|---|
| `POST /api/tasks/:taskId/external-references` | `org.tasks.manage` | Attach a Drive file to a task |
| `DELETE /api/tasks/:taskId/external-references/:referenceId` | `org.tasks.manage` | Remove a reference |
| `PATCH /api/tasks/:taskId/external-references/:referenceId` | `org.tasks.manage` | Re-bind connection |
| `PATCH /api/tasks/:taskId/bundle-attachment` | `org.tasks.manage` | Update failure policy |
| `GET /api/integrations/google-drive/picker-token` | `org.integrations.manage` | Short-lived token for file picker |
| `GET /api/integrations/google-drive/verify-access` | `org.integrations.manage` | Verify connection can read a file before re-attach |
| `POST /api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources` (google_drive variant) | `org.scheduled_tasks.data_sources.manage` | Existing route; new source type accepted |
| `POST /api/agents/:id/data-sources` (google_drive variant) | `org.agents.manage` | Existing route; new source type accepted |

**Unique constraint HTTP mapping:**

- `document_cache` upsert conflict on `(provider, file_id, connection_id)`: handled internally by the resolver as a non-error (idempotent upsert). Never surfaced as an HTTP error.
- Duplicate `external-references` attach (same `external_file_id` + `external_connection_id` on the same task bundle): return `409 Conflict` with `{ error: 'reference_already_attached' }`.
- Attach at per-task quota limit (20): return `422 Unprocessable Entity` with `{ error: 'per_task_quota_exceeded', limit: 20 }`.
- Attach at per-subaccount quota limit (100): return `422` with `{ error: 'per_subaccount_quota_exceeded', limit: 100 }`.

### 12.3 Agent execution path

The agent execution path accesses `document_cache` and `document_fetch_events` through the same `getOrgScopedDb` / `withOrgTx` primitives that gate all tenant data access. The resolver receives a scoped DB client from the caller; it does not establish its own connection or bypass RLS.

Permission to read a Drive file is validated at attach time (the attaching user has the access they need by definition of having selected the file through the picker). The agent does not re-verify access via its own identity. If the connection is revoked after attach, the reference transitions to `broken` on the next failed fetch — not silently.

## 13. File inventory

### 13.1 Migrations

| File | Change |
|---|---|
| `migrations/0262_external_doc_refs_google_drive.sql` | All schema changes: `ALTER TYPE` for three enums, new columns on `reference_documents` + `document_bundle_attachments` + `agent_data_sources`, new tables `document_cache` + `document_fetch_events`, RLS policies for both new tables, CHECK constraint on `reference_documents`, `UNIQUE (bundle_id, external_file_id, external_connection_id)` on `reference_documents` |

### 13.2 Schema files (new)

| File | Purpose |
|---|---|
| `server/db/schema/documentCache.ts` | Drizzle schema for `document_cache` |
| `server/db/schema/documentFetchEvents.ts` | Drizzle schema for `document_fetch_events` |

### 13.3 Schema files (modified)

| File | Change |
|---|---|
| `server/db/schema/referenceDocuments.ts` | Add `external_provider`, `external_connection_id`, `external_file_id`, `external_file_name`, `external_file_mime_type`, `attached_by_user_id`, `attachment_order`, `attachment_state`; extend `source_type` enum |
| `server/db/schema/documentBundleAttachments.ts` | Add `fetch_failure_policy` column |
| `server/db/schema/agentDataSources.ts` | Add `connection_id` column; extend `source_type` enum |
| `server/db/schema/integrationConnections.ts` | Extend `provider_type` enum with `'google_drive'` |

### 13.4 Config files (modified)

| File | Change |
|---|---|
| `server/config/rlsProtectedTables.ts` | Add entries for `document_cache` and `document_fetch_events` |

### 13.5 Services (new)

| File | Purpose |
|---|---|
| `server/services/externalDocumentResolverService.ts` | Orchestrates resolve: cache lookup, change detection, fetch, cache write, FetchEvent write |
| `server/services/resolvers/googleDriveResolver.ts` | Google Drive-specific fetch, export, and text normalisation |

### 13.6 Services (modified)

| File | Change |
|---|---|
| `server/services/agentService.ts` | Add `'google_drive'` branch in `fetchSourceContent` dispatch; delegates to `externalDocumentResolverService` |
| `server/services/runContextLoader.ts` | Call `externalDocumentResolverService.resolve` for each `google_drive` reference; assemble provenance blocks in `attachment_order` sequence |
| `server/lib/constants.ts` | Add `EXTERNAL_DOC_MAX_STALENESS_MINUTES`, `EXTERNAL_DOC_HARD_TOKEN_LIMIT`, `EXTERNAL_DOC_SOFT_TOKEN_WARN`, `EXTERNAL_DOC_CHECK_REVISION_TIMEOUT_MS`, `EXTERNAL_DOC_FETCH_CONTENT_TIMEOUT_MS`, `EXTERNAL_DOC_MAX_TOTAL_RESOLVER_MS`, `EXTERNAL_DOC_MAX_REFS_PER_RUN` — no global resolver-version constant; each resolver defines its own `resolverVersion` property |

### 13.7 Routes (new)

| File | New routes |
|---|---|
| `server/routes/externalDocumentReferences.ts` | `POST /api/tasks/:taskId/external-references`, `DELETE /api/tasks/:taskId/external-references/:referenceId`, `PATCH /api/tasks/:taskId/external-references/:referenceId`, `PATCH /api/tasks/:taskId/bundle-attachment` |
| `server/routes/integrations/googleDrive.ts` | `GET /api/integrations/google-drive/picker-token`, `GET /api/integrations/google-drive/verify-access`, OAuth callback handler for `google_drive` provider |

### 13.8 Routes (modified)

| File | Change |
|---|---|
| `server/routes/scheduledTasks.ts` | Accept `source_type = 'google_drive'` and `connection_id` in data source create/update routes |
| `server/routes/agents.ts` | Accept `source_type = 'google_drive'` and `connection_id` in data source create/update routes |
| `server/routes/integrations/oauth.ts` | Add `google_drive` case to provider dispatch |

### 13.9 Client components (new)

| File | Purpose |
|---|---|
| `client/src/components/DriveFilePicker.tsx` | Google Picker API wrapper; supports connection selection when multiple Drive connections exist |
| `client/src/components/ExternalDocumentRebindModal.tsx` | Re-attach flow for broken references |

### 13.10 Client components (modified)

| File | Change |
|---|---|
| `client/src/components/CredentialsTab.tsx` | Add `'google_drive'` to `OAUTH_PROVIDER_OPTIONS`; add post-connection info box |
| `client/src/components/TaskModal.tsx` | Dynamic cloud-storage attach buttons; Drive reference rows with state badges; degraded/broken wrappers; failure policy select |
| `client/src/components/DataSourceManager.tsx` | Add `'google_drive'` source type; conditional file picker field; remove Mode column from table |

---

## 14. Implementation phases

All schema changes land in a single migration (`0262`) so every table and column is present before any service code runs. Phases 2–6 are purely code changes with no further migrations.

### Dependency graph

```
Phase 1 (schema + Drive OAuth)
  └─► Phase 2 (resolver service)
        ├─► Phase 3 (TaskModal attachment path)
        ├─► Phase 4 (DataSourceManager path)
        └─► Phase 5 (context assembly + state machine)
                    └─► Phase 6 (re-bind modal + UI hardening)
```

Backward-dependency check: every phase references only columns, tables, and services introduced in equal-or-earlier phases. No forward references exist.

### Phase 1: Schema and Drive OAuth

**Delivers:** the structural foundation — all new tables, enum extensions, and the OAuth flow that lets users connect a Drive account.

Schema changes (all in `0262_external_doc_refs_google_drive.sql`):

- `ALTER TYPE` for `reference_documents.source_type`, `agent_data_sources.source_type`, `integration_connections.provider_type`
- New columns on `reference_documents` (7 columns including `external_file_mime_type`)
- New column on `document_bundle_attachments` (`fetch_failure_policy`)
- New column on `agent_data_sources` (`connection_id`)
- New tables: `document_cache`, `document_fetch_events` with RLS policies
- CHECK constraint on `reference_documents` enforcing non-null external columns for `google_drive` rows

Code changes:

- `server/db/schema/documentCache.ts` — new Drizzle schema
- `server/db/schema/documentFetchEvents.ts` — new Drizzle schema
- `server/db/schema/referenceDocuments.ts` — extend type, new columns
- `server/db/schema/documentBundleAttachments.ts` — `fetch_failure_policy` column
- `server/db/schema/agentDataSources.ts` — `connection_id` column, enum extension
- `server/db/schema/integrationConnections.ts` — enum extension
- `server/config/rlsProtectedTables.ts` — two new entries
- `server/routes/integrations/googleDrive.ts` — OAuth callback handler, token refresh wired to `integrationConnectionService`; `GET /api/integrations/google-drive/picker-token` stub (returns access token for Picker API)
- `server/routes/integrations/oauth.ts` — add `google_drive` case to provider dispatch
- `client/src/components/CredentialsTab.tsx` — add `google_drive` entry to `OAUTH_PROVIDER_OPTIONS`; post-connection info box

**Gate:** `npm run db:generate` passes; `npm run typecheck` passes; Drive OAuth connect flow works end-to-end (connection row created in `integration_connections` with `provider_type = 'google_drive'`).

### Phase 2: Resolver service

**Delivers:** `externalDocumentResolverService` and the Google Drive resolver — the engine that fetches, normalises, and caches external document content.

Code changes:

- `server/lib/constants.ts` — `EXTERNAL_DOC_MAX_STALENESS_MINUTES`, `EXTERNAL_DOC_HARD_TOKEN_LIMIT`, `EXTERNAL_DOC_SOFT_TOKEN_WARN`, `EXTERNAL_DOC_RESOLVER_VERSION`
- `server/services/resolvers/googleDriveResolver.ts` — `checkRevision`, `fetchContent` for Docs/Sheets/PDF; `resolverVersion: 1`
- `server/services/externalDocumentResolverService.ts` — full resolve pipeline: token refresh, cache lookup (resolver-version check + change detection), fetch on miss, cache upsert, `document_fetch_events` append, state machine write, single-flight guard (in-process `Map`)
- Pure function tests: `server/services/__tests__/externalDocumentResolverServicePure.test.ts` — normalisation, truncation, provenance assembly, staleness boundary logic

**Gate:** pure function tests pass; resolver can be called in isolation against a mocked Drive API and produces correct `ResolvedDocument` shapes.

**Depends on:** Phase 1 (schema for `document_cache`, `document_fetch_events`; `integration_connections` for token retrieval).

### Phase 3: Task attachment path (TaskModal)

**Delivers:** the ability to attach and remove Drive files from regular tasks via TaskModal. No runtime fetch yet — references are stored and displayed.

Code changes:

- `server/routes/externalDocumentReferences.ts` — four routes: `POST /api/tasks/:taskId/external-references` (attach, quota check), `DELETE /api/tasks/:taskId/external-references/:referenceId` (remove), `PATCH /api/tasks/:taskId/external-references/:referenceId` (re-bind connection), `PATCH /api/tasks/:taskId/bundle-attachment` (update `fetch_failure_policy`)
- `server/routes/integrations/googleDrive.ts` — `GET /api/integrations/google-drive/verify-access?connectionId&fileId` (metadata call to confirm read access)
- `client/src/components/DriveFilePicker.tsx` — Google Picker API wrapper; connection selector when multiple Drive connections exist; MIME-type filtering
- `client/src/components/TaskModal.tsx` — dynamic cloud-storage buttons; Drive reference rows with state badges; amber/red wrappers for degraded/broken; failure policy select control

**Gate:** user can attach a Drive file from TaskModal, see it in the list with `active` state badge, and remove it. No actual fetch occurs yet.

**Depends on:** Phase 1 (schema, picker-token route), Phase 2 (picker-token route calls `integrationConnectionService` for token refresh).

### Phase 4: DataSourceManager path (scheduled tasks and agents)

**Delivers:** the `google_drive` source type in DataSourceManager, letting scheduled tasks and agents attach Drive files through the existing data-source UI.

Code changes:

- `client/src/components/DataSourceManager.tsx` — add `google_drive` to source-type selector; conditional file picker field (replaces URL input); `connection_id` passed in create/update payloads; `google_drive` row rendering in table
- `server/routes/scheduledTasks.ts` — accept `source_type = 'google_drive'` and `connection_id` in data-source create/update; validate `connection_id` belongs to caller's subaccount and is `active`
- `server/routes/agents.ts` — same as above

**Gate:** user can add a Drive file as a data source on a scheduled task, see it listed with `type = google_drive` and `status = pending`, and delete it.

**Depends on:** Phase 1 (schema, `agentDataSources.connection_id`), Phase 2 (picker-token from Phase 1 already wires in, used by `DriveFilePicker` reused here).

### Phase 5: Context assembly and state machine

**Delivers:** Drive references are fetched at run time and injected into the agent's knowledge base. State machine transitions (active/degraded/broken) are written after each resolve. Token quotas and the failure policy are enforced.

Code changes:

- `server/services/agentService.ts` — add `'google_drive'` branch in `fetchSourceContent` dispatch; delegates to `externalDocumentResolverService.resolve()`
- `server/services/runContextLoader.ts` — after loading `agentDataSources`, call `externalDocumentResolverService.resolve()` for each `google_drive` reference (both from `reference_documents` and `agent_data_sources`); assemble provenance blocks in `attachment_order` sequence; enforce per-run token budget (§9.4 algorithm); apply `fetch_failure_policy`
- `server/services/runContextLoaderPure.ts` — extend pure functions to handle external references in the pool ordering and budget enforcement logic; pure function tests (extend `runContextLoaderPure.test.ts`)

**Gate:** a scheduled task with a Drive file data source runs successfully; the run log shows the document content and provenance header; `document_fetch_events` row is written; `attachment_state` on `reference_documents` rows is updated correctly.

**Depends on:** Phase 2 (resolver), Phase 3 (task references in DB), Phase 4 (agent_data_sources google_drive rows in DB).

### Phase 6: Re-bind modal and UI hardening

**Delivers:** the broken-reference re-attach flow, header-level error state in TaskModal, and any UI states that require Phase 5's state machine writes to be present.

Code changes:

- `client/src/components/ExternalDocumentRebindModal.tsx` — broken-document chip, failure reason, connection selector, access-verification step, re-attach confirm / remove reference
- `client/src/components/TaskModal.tsx` — header error line ("1 reference requires attention · task will not run"); Save Changes button disabled when any broken reference exists
- `client/src/components/DataSourceManager.tsx` — broken/error state display for `google_drive` rows (aligns `last_fetch_status = 'error'` to the same visual treatment)

**Gate:** a task with a broken reference shows the modal header error; clicking "Re-attach using another connection" opens `ExternalDocumentRebindModal`; selecting a live connection and confirming updates the reference and clears the broken state on next run.

**Depends on:** Phase 3 (reference rows exist), Phase 5 (state machine writes produce `broken` state).

---

## 15. Execution model

### 15.1 Operation classifications

No pg-boss jobs are introduced in v1. Every operation in this feature is synchronous and inline. The resolver runs within the existing agent run pg-boss job — not as a separate job.

| Operation | Model | Notes |
|---|---|---|
| Drive OAuth callback | Inline/sync | Stores tokens synchronously; browser redirect completes before return |
| `POST /api/tasks/:taskId/external-references` | Inline/sync | Quota check + `reference_documents` insert; returns new row |
| `GET /api/integrations/google-drive/picker-token` | Inline/sync | Token refresh (if needed) happens inline before returning |
| `GET /api/integrations/google-drive/verify-access` | Inline/sync | Single metadata call to Drive API; result returned synchronously |
| `PATCH /api/tasks/:taskId/external-references/:referenceId` (re-bind) | Inline/sync | Updates `external_connection_id`, sets `attachment_state = 'active'` |
| `PATCH /api/tasks/:taskId/bundle-attachment` | Inline/sync | Updates `fetch_failure_policy` |
| `externalDocumentResolverService.resolve()` | Inline/sync (called from agent run job) | Cache lookup, change-detection, fetch, cache write — all inline within the pg-boss job that runs the agent |
| `attachment_state` write | Inline/sync | Written at end of `resolve()`, scoped DB client from caller |
| `document_fetch_events` append | Inline/sync | Appended at end of every `resolve()` call |
| `document_cache` upsert | Inline/sync | Upserted inside `resolve()` on cache miss or resolver-version mismatch |

### 15.2 Consistency with non-functional goals

The inline model is consistent with the primary use case (scheduled, unattended runs). The agent run is already an async background job, so blocking the run on document fetches adds no synchronous latency visible to the user. The practical impact is run duration: a run fetching 20 documents cold (no cache) adds up to ~10 seconds at ~500ms per Drive API call. Cache hits reduce this to a single metadata HEAD call per document (~50ms). This is acceptable in v1.

### 15.3 No jobs section

No pg-boss job config entries are added. No new entries in `server/config/jobConfig.ts`. If a future spec introduces background pre-fetch or webhook invalidation, that spec must add the job config at that time.

---

## 16. Testing posture

Per `docs/spec-context.md`:

```yaml
testing_posture: static_gates_primary
runtime_tests: pure_function_only
frontend_tests: none_for_now
api_contract_tests: none_for_now
e2e_tests_of_own_app: none_for_now
```

### 16.1 In scope

Pure function tests for logic that can be exercised without a live DB or Drive API:

| Test file | What it covers |
|---|---|
| `server/services/__tests__/externalDocumentResolverServicePure.test.ts` | Truncation (head+tail strategy, token counts, marker insertion); provenance header assembly; staleness boundary check; resolver-version mismatch detection; `ResolvedDocument` shape on success and failure paths |
| `server/services/__tests__/runContextLoaderPure.test.ts` (extended) | `attachment_order` sorting with tiebreaker; per-run budget enforcement algorithm; failure-policy application (tolerant/strict/best_effort) against a set of mock `ResolvedDocument` results |
| `server/services/resolvers/__tests__/googleDriveResolver.test.ts` | Text normalisation for Docs export (plain text passthrough), Sheets export (CSV structure), PDF extraction; MIME-type dispatch; unsupported-type error path |

All pure function tests are run via `npx tsx <test-file>`, not the umbrella suite.

### 16.2 Not in scope

- E2E tests against the live Drive API
- API contract tests for the new routes
- Frontend component tests for `DriveFilePicker` or `ExternalDocumentRebindModal`
- Performance baselines for fetch latency or cache hit rate
- Integration tests for the full agent-run pipeline (covered by CI gate, not local)

---

## 17. Execution-safety contracts

### 17.1 Idempotency posture

| Operation | Posture | Mechanism |
|---|---|---|
| `document_cache` write | key-based | `UNIQUE (provider, file_id, connection_id)` + `ON CONFLICT (provider, file_id, connection_id) DO UPDATE SET content = EXCLUDED.content, revision_id = EXCLUDED.revision_id, fetched_at = EXCLUDED.fetched_at, content_size_tokens = EXCLUDED.content_size_tokens, resolver_version = EXCLUDED.resolver_version, updated_at = now()`. A retry of a failed write upserts in place — no duplicate rows. |
| `document_fetch_events` append | non-idempotent (intentional) | Append-only; a retry appends a second row. Both rows share the same `(reference_id, run_id)` but get distinct `id` UUIDs. This is an acceptable audit-log duplicate — it does not corrupt state, double-bill the run, or produce conflicting `attachment_state` writes. |
| `reference_documents` state write | state-based | `UPDATE reference_documents SET attachment_state = $new, updated_at = now() WHERE id = $id AND attachment_state = $expected`. 0 rows updated = already transitioned by a concurrent caller; current caller discards its write without retrying. |
| Attach reference | key-based | `UNIQUE (bundle_id, external_file_id, external_connection_id)` on `reference_documents`, defined in migration 0262. Duplicate attach returns `409 Conflict`. |
| Re-bind reference | state-based | `UPDATE reference_documents SET external_connection_id = $new, attachment_state = 'active' WHERE id = $id AND external_connection_id = $old`. 0 rows updated = already rebound; return the current row as the idempotent success result. |

**Uncommitted cache entries:** only successfully committed `document_cache` rows are valid cache entries. If `fetchContent` succeeds but the cache upsert fails (transaction rollback per §17.8), the content must not be treated as cached. No `document_fetch_events` row with `cache_hit = true` may reference content not confirmed in `document_cache`. Subsequent resolve calls for the same reference treat it as absent and perform a full fetch.

### 17.2 Retry classification

| Operation | Retry class | Boundary |
|---|---|---|
| `resolver.checkRevision()` (Drive metadata call) | safe | Read-only, stateless |
| `resolver.fetchContent()` (Drive export/download) | safe | Read-only, stateless |
| `document_cache` upsert | guarded | `ON CONFLICT DO UPDATE` idempotency key |
| `document_fetch_events` append | safe | Duplicates are acceptable audit rows |
| `reference_documents` state write | guarded | Optimistic predicate; 0-rows-updated is a safe terminal result |
| Attach route | guarded | Unique constraint turns a duplicate into `409`, not a `500` |
| Re-bind route | guarded | Optimistic predicate; 0-rows-updated returns current row |

### 17.3 Concurrency guard for racing state writes

Two concurrent agent runs for the same task can both call `resolve()` for the same reference simultaneously — e.g., two scheduled runs that fired within the same minute.

**Guard:** `UPDATE reference_documents SET attachment_state = $new WHERE id = $id AND attachment_state = $expected`

- Both callers read the same current state and compute the same new state
- One `UPDATE` succeeds (1 row affected); the other gets 0 rows affected
- The losing writer does not retry — 0 rows updated is a safe no-op because both callers agree on the final state
- This is first-commit-wins; because both writes carry the same state value, the final persisted state is correct regardless of which caller wins

The `document_cache` upsert races are handled by the `ON CONFLICT DO UPDATE` — any number of concurrent upserts for the same `(provider, file_id, connection_id)` produce exactly one row with the latest content.

The in-process single-flight guard (§7.3) reduces the probability of these races to near-zero within a single server instance. Cross-instance races are safe due to the guards above.

### 17.4 Terminal event guarantee

External document fetches are inline operations within the existing agent run pg-boss job. The terminal event guarantee for the run belongs to the existing `agentExecutionEventService` — this spec does not introduce new cross-flow event chains and therefore has no new terminal event requirements.

`document_fetch_events` rows are audit records, not events in the event-chain sense. They carry no terminal/non-terminal semantics.

### 17.5 No-silent-partial-success

Every failure path produces a visible audit trace:

| Policy | On degraded | On broken | Run status | Audit trace |
|---|---|---|---|---|
| `tolerant` | Serve stale cache; run continues | Run does not start | `success` (with warning) or `failed` | `document_fetch_events` row with `failure_reason`; warning in run log listing which references failed |
| `strict` | Run does not start | Run does not start | `failed` | `document_fetch_events` row with `failure_reason = 'auth_revoked'` etc. |
| `best_effort` | Serve stale cache silently; run continues | Skip reference; run continues | `success` | `document_fetch_events` row with `failure_reason`; run log records which references were skipped |

There is no path where a reference failure produces a `success` run with no `document_fetch_events` row. The append in `externalDocumentResolverService.resolve()` fires on every path — success or failure.

**Log completeness invariant:** every `resolve()` call produces exactly one `document_fetch_events` row and exactly one `DocumentResolveLog` entry (§11.6). This holds for all outcomes including early exits due to `budget_exceeded` (§8.3), `strict` policy failure, and per-call timeout (§6.5). There is no `resolve()` code path that exits without writing both.

### 17.6 Unique constraint HTTP mapping

| Constraint | Trigger condition | HTTP status | Response body |
|---|---|---|---|
| `UNIQUE (provider, file_id, connection_id)` on `document_cache` | Internal cache upsert | Never surfaced as HTTP error — handled by `ON CONFLICT DO UPDATE` internally |
| Duplicate attach (same `external_file_id` + `external_connection_id` on same task bundle) | `POST /api/tasks/:taskId/external-references` | `409 Conflict` | `{ "error": "reference_already_attached" }` |
| Per-task quota exceeded (20 refs) | Attach | `422 Unprocessable Entity` | `{ "error": "per_task_quota_exceeded", "limit": 20 }` |
| Per-subaccount quota exceeded (100 refs) | Attach | `422 Unprocessable Entity` | `{ "error": "per_subaccount_quota_exceeded", "limit": 100 }` |
| Invalid `connection_id` (not `google_drive`, not in subaccount, not `active`) | Attach or data-source create | `422 Unprocessable Entity` | `{ "error": "invalid_connection_id" }` |

No `23505 unique_violation` is allowed to bubble as a `500`. All unique constraints on caller-visible paths are mapped above.

### 17.7 State machine closure

The `attachment_state` enum is closed in v1: `'active' | 'degraded' | 'broken'`. Adding a new state value requires both a spec amendment and an `ALTER TYPE` migration.

Valid transitions (from §8.2):

| From | To | Trigger |
|---|---|---|
| _(none)_ | `active` | Successful attach |
| `active` | `degraded` | `resolve()` fails; cache exists within staleness boundary |
| `active` | `broken` | `resolve()` fails; cache empty or resolver never succeeded |
| `degraded` | `active` | `resolve()` succeeds |
| `degraded` | `broken` | Cache age exceeds `EXTERNAL_DOC_MAX_STALENESS_MINUTES` |
| `broken` | `active` | Re-bind (new connection + next successful fetch) |

**Forbidden transitions:** `broken` → `degraded`; `active` → `broken` without a prior `degraded` state (only possible if the cache was never populated). No code path may write `attachment_state` other than `externalDocumentResolverService.resolve()` (for transitions) and the attach/re-bind routes (for initial `active` and re-bind `active`).

### 17.8 Resolver write atomicity

**Invariant:** the three DB writes inside `externalDocumentResolverService.resolve()` — `document_cache` upsert, `document_fetch_events` append, and `reference_documents.attachment_state` update — must execute within a single transaction scope using the caller's scoped DB client. Either all three succeed or none are persisted. Partial commits (e.g., cache updated but no `document_fetch_events` row) are a bug.

The caller must pass a scoped DB client (established via `withOrgTx` / `getOrgScopedDb`) to `resolve()`. The resolver must not open its own transaction or bypass the caller's transaction boundary.

**Boundary exception:** token refresh (Drive OAuth call) occurs outside the transaction and before it opens. If token refresh fails, the transaction is never opened; the result is returned as `failure_reason = 'auth_revoked'` with no DB writes.

### 17.9 Run-level snapshot consistency

No cross-document consistency guarantee is provided in v1. Each `resolve()` call uses the revision observed at the time of its own `checkRevision` call. If document B is edited between the resolution of document A and document B within the same run, the run receives content from different points in time.

This is an accepted v1 limitation. It affects multi-document reasoning tasks where documents are interdependent. Callers must not assume a consistent snapshot across all documents in a run. Pinned-version support (§18) is the future mitigation for consistency-sensitive workflows.

### 17.10 Per-reference injection invariant

Each reference_id results in exactly one injected document block per run — not zero, not two. A reference that resolves successfully is injected once. A reference that fails is not injected and produces a `document_fetch_events` row with `failure_reason` set. There is no code path that resolves a reference and injects it zero times, or injects it more than once.

Note: this invariant is per reference_id, not per underlying file. If the same Drive file is attached via two different `reference_documents` rows (e.g., on two different tasks that both feed the same run), each reference_id results in one injected block. Inject-once semantics across reference_ids pointing at the same file is a v2 concern (§18).

**Same-file multiple-reference contract:** if the same `(provider, file_id, connection_id)` appears multiple times in the merged reference list for a run, each reference_id is resolved independently. The single-flight guard (§7.3) ensures at most one underlying Drive API fetch per `(provider, file_id, connection_id)` per process tick, but token accounting and `document_fetch_events` rows remain per-reference_id in v1. Both reference_ids contribute their own token budget draw.

### 17.11 Cold-cache invariant

A reference with no existing `document_cache` entry always performs a full `fetchContent` call on first `resolve()`. There is no "empty cache hit" path — a cache miss always proceeds to step 5 (§7.1). This invariant applies regardless of `last_fetch_status`, `attachment_state`, or any other reference metadata. Skipping the fetch for a reference with no cached content is never correct.

---

## 18. Deferred items

- **Other providers (OneDrive, SharePoint, Dropbox).** The `ExternalDocumentResolver` interface (§6.1) is the extension point. v1 ships Google Drive only. No timeline set.

- **Folder-level attachments.** Folder contents are dynamic and scope can expand without user action. Excluded from v1 to avoid unbounded reference growth. Needs its own spec covering folder snapshot semantics, quota implications, and UI.

- **Pinned version.** Attaching a specific immutable revision of a document (§8.4). Deferred because the primary use case is always-latest. The existing `reference_documents.current_version_id` FK is the natural extension point. Needs compliance-driven requirements before designing.

- **Webhook-based cache invalidation.** v1 polls on read (change-detection check per resolve call). Real-time webhook invalidation (Drive push notifications) is v2, after usage patterns are understood.

- **Pre-run attachment health checks.** Background job that surfaces "last fetched successfully X mins ago" or "connection issue detected" before the run fires. Deferred — adds operational complexity; the degraded/broken state machine already surfaces failures post-run.

- **Subaccount-level cache TTL configuration.** The 7-day staleness boundary and 60-minute TTL are hard-coded constants in v1. Making them configurable per subaccount is deferred until usage data shows variance in real-world needs.

- **Cross-connection cache deduplication.** The v1 cache key includes `connection_id`, meaning the same file via two connections creates two cache entries. v2 may evolve to `(provider, file_id)` with per-connection access validation at read time. See §7.1.

- **In-run reference deduplication.** If the same file is referenced by multiple agents in the same run, the content is injected once per reference. v2 may introduce inject-once semantics for shared documents. See §3.1 cost model note.

- **Structured chunking for long documents.** v1 truncates at the hard token limit using head+tail. Long-document chunking with semantic splitting is deferred.

- **Per-document failure policy override.** v1 uses a task-level policy applied to all references. Per-reference overrides (e.g., "this specific file is optional, skip it if unavailable") are deferred.

- **Image and Office binary parsing.** `.docx`, `.xlsx`, Google Slides: blocked in file picker in v1. Requires format-specific parsers; deferred.

- **Service-account and domain-wide delegation.** Alternative Google auth model for enterprise customers. Deferred — the user-connection model covers all v1 workflows.
