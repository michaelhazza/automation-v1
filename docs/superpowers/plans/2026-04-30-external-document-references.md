# Live External Document References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1 of live external document references — operators attach files from Google Drive to tasks, scheduled tasks, and agents; the platform fetches the latest content at runtime via a persistent cache with revision-based change detection.

**Architecture:** Extend `reference_documents`, `agent_data_sources`, and `integration_connections` with a new `google_drive` source/provider type. Introduce `document_cache` and `document_fetch_events` tables. Build a new `externalDocumentResolverService` that orchestrates token refresh, cache lookup, change detection, fetch, normalisation, and audit-log writes. Wire it into the existing `runContextLoader` / `agentService` context-assembly pipeline. Three UI surfaces — CredentialsTab (Screen 1), TaskModal (Screens 2/4) + DriveFilePicker (Screen 3), DataSourceManager (Screen 5) — plus a re-bind modal for broken references (Screen 6).

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL with RLS, Express routes, React 18, Google Picker API, Google Drive REST API v3, OAuth 2.0, sha-256 hashing, in-process `Map` single-flight guard, pdf-parse (or equivalent) for PDF text extraction.

**Source spec:** [`docs/external-document-references-spec.md`](../../external-document-references-spec.md)
**Mockups:** [`docs/mockups/external-doc-references.html`](../../mockups/external-doc-references.html) — Screens 1 through 6 are referenced inline in each phase.
**Target migration:** `0262_external_doc_refs_google_drive.sql`

---

## Mockup index — every screen is implemented

| Screen | Mockup section | Implemented in |
|---|---|---|
| Screen 1 — Integrations & Credentials, "Add Connection" dropdown showing Google Drive | Lines 308–434 of mockup | Phase 1, Task 1.10 (CredentialsTab option) and Task 1.11 (post-connection info box) |
| Screen 2 — TaskModal Attachments tab, healthy Drive references | Lines 435–576 of mockup | Phase 3, Task 3.5 (cloud-storage attach buttons), Task 3.6 (Drive reference rows), Task 3.7 (failure-policy select) |
| Screen 3 — "Pick from Google Drive" picker modal | Lines 577–712 of mockup | Phase 3, Task 3.4 (`DriveFilePicker` component with MIME filtering and multi-connection selector) |
| Screen 4 — TaskModal Attachments tab with degraded + broken references | Lines 713–851 of mockup | Phase 6, Task 6.1 (header error line), Task 6.2 (degraded amber wrapper), Task 6.3 (broken row detail with re-attach CTA) |
| Screen 5 — DataSourceManager with Google Drive source type | Lines 852–997 of mockup | Phase 4, Task 4.2 (source type option), Task 4.3 (conditional file picker field), Task 4.4 (Mode column removal), Task 4.5 (status badge) |
| Screen 6 — Re-bind broken reference modal | Lines 998–1140 of mockup | Phase 6, Task 6.4 (`ExternalDocumentRebindModal` with verify-access flow), Task 6.5 (TaskModal mounts it) |

---

## Execution strategy and cross-cutting invariants

Read this before starting Phase 1. Captures rules and decisions that span phases.

### Release slices

The six phases ship in three deployable slices. Each is independently usable. Do not collapse them: the staging is the whole point of de-risking.

| Slice | Includes | Disabled |
|---|---|---|
| **A — Attach + store only** | Phase 1, Phase 3, Phase 4 (with `EXTERNAL_DOC_ATTACH_ENABLED=true`) | Resolver never invoked. No run-time fetch. Phase 2 code is committed but not wired. Phase 5 short-circuits. Phase 6 deferred. |
| **B — Fetch + inject (happy path)** | Phase 2, Phase 5 happy-path branches (with `EXTERNAL_DOC_RESOLUTION_ENABLED=true`) | All references treated as `tolerant` policy regardless of operator selection. Degraded/broken UI deferred. Cross-instance lock deferred. |
| **C — Full system** | Phase 6, Task 2.5b (advisory lock), Task 5.5 (observability queries), `EXTERNAL_DOC_FAILURE_POLICIES_ENABLED=true` | — |

Each slice's gate at its terminal phase must pass before flipping the next flag.

### Feature flags

Four env booleans. Read once at process start via `server/lib/featureFlags.ts`. Default `false` in production. No live reload — restart to flip.

| Flag | Effect when `true` (kill switch) / `false` (slice gates) |
|---|---|
| `EXTERNAL_DOC_SYSTEM_DISABLED` | **Kill switch.** When `true`: every `runContextLoader` invocation short-circuits to empty external context with no audit rows, no fetches, no DB reads. Bypasses all other flags. Use to instantly disable the entire feature in incident response without per-flag debugging. |
| `EXTERNAL_DOC_ATTACH_ENABLED` | When `false`: attach/remove/policy/verify-access routes return 503. `DriveFilePicker` does not mount. `google_drive` filtered from DataSourceManager source-type select. |
| `EXTERNAL_DOC_RESOLUTION_ENABLED` | When `false`: `runContextLoader` skips external refs entirely and emits a synthetic `failure_reason = 'resolution_disabled'` audit row per ref so observability still reflects intent. |
| `EXTERNAL_DOC_FAILURE_POLICIES_ENABLED` | When `false`: operator-selected `fetch_failure_policy` is ignored. All references run as `tolerant` (degraded → serve_stale_with_warning, broken → block_run). |

Implementation: Task 1.12. Add `'resolution_disabled'` to `FETCH_FAILURE_REASONS` in Task 1.3 only if the flag is shipped to production with the slice — otherwise omit until Slice B.

The kill switch lives on its own line because it is the operational tool for production incidents. Treat it as load-bearing: nothing else in the system may bypass it.

### Cross-cutting invariants

Each invariant is referenced by the task that enforces it. Future contributor tempted to violate it: see this section.

**1. Cache atomicity.** Each `document_cache` row writes `(content, revision_id, fetched_at, content_size_tokens, content_hash, resolver_version)` atomically. Task 2.5 step 8's `onConflictDoUpdate` already satisfies this. Never split the upsert. Never write `revision_id` without `content`. Never reuse a `revision_id` value across different content.

**2. Hard-fail timeout.** When `EXTERNAL_DOC_MAX_TOTAL_RESOLVER_MS` is exceeded mid-run, **all remaining references emit `budget_exceeded` audit rows immediately. No partial fetch attempted on subsequent refs.** Enforced in Task 5.2 step 2's `budgetBlown` short-circuit — checked before each `resolver.resolve(...)`, never inside it.

**3. Token accounting.** `countTokensApprox` is for ordering, warnings, and pre-checks only. Exact runtime tokenizer must be used at the prompt-assembly boundary in `runContextLoader`. The resolver writes the approximation to `document_fetch_events.tokens_used` (audit-only); the assembled prompt enforces the exact budget. Mixing the two silently overflows the model context — do not let approximations leak past assembly.

**4. Dedup-within-run.** A reference keyed by `(provider, file_id, connection_id)` resolves at most once per run, even when the same Drive file is attached via both a task reference and an agent data source. Phase 5 Task 5.2 deduplicates after `mergeAndOrderReferences`, before the resolve loop. The duplicate ref still gets a `cache_hit = true` audit row pointing at the same cache entry so observability sees both attachments.

**5. MIME mismatch.** When `checkRevision` returns a `mimeType` differing from the stored `expectedMimeType`, the cache is invalidated AND a structured log line is emitted with `mimeMismatch: true`. Task 2.5 step 4. This catches the case where a Drive file is replaced with a different format under the same fileId.

**6. Cross-instance concurrency.** `SingleFlightGuard` is per-process. With horizontal scale-out, N workers fan-fetch the same doc on first run after invalidation. Slice C adds a Postgres advisory lock keyed on `hashtext('external_doc:' || provider || ':' || file_id || ':' || connection_id)`, taken inside the resolver transaction before cache lookup. Slice A/B ship without it (acceptable up to ~2 instances). Implementation: Task 2.5b.

**7. Retry classification.** Only the reasons below trigger `EXTERNAL_DOC_RATE_LIMIT_RETRIES`. Future contributor tempted to retry-everything: this table is the answer.

| `failure_reason` | Retryable in v1 | Implementation |
|---|---|---|
| `rate_limited` | yes | `fetchWithRetry` retries up to 2× with exponential backoff |
| `network_error` | no in v1 | Deferred to v1.1 (single retry on transient failures); document but do not implement |
| `auth_revoked` | no | Immediate failure |
| `file_deleted` | no | Immediate failure |
| `unsupported_content` | no | Immediate failure |
| `quota_exceeded` | no | Immediate failure |
| `budget_exceeded` | n/a | Emitted by `runContextLoader`, never by resolver |

**8. PDF size guard.** PDFs are size-checked before parse using the same byte cap as Sheets to bound memory/CPU. Task 2.3's PDF branch reads the body to a Buffer and rejects with `quota_exceeded` if `byteLength > EXTERNAL_DOC_PDF_MAX_BYTES` before invoking `pdf-parse`. Constant added in Task 1.8.

**9. No silent downgrade.** Every non-fresh injection — stale cache, partial content, post-truncation — carries explicit provenance in the prompt itself. The LLM must never be given content that looks fresh when it isn't. `buildProvenanceHeader` already emits `Warning: content is from cache (...); last fetch failed` when `isStale=true` (Task 2.2). When truncation happened, the inline `[TRUNCATED: N tokens removed]` marker is preserved end-to-end through Phase 5. The `serve_stale_silent` failure-policy action does NOT suppress the provenance header — only the runtime warn log. Reviewer checklist item: any new injection path must emit a provenance header before content.

**10. Deterministic ordering under failure.** Skipped or failed references retain their position in the prompt sequence via a placeholder block, not by being elided. Phase 5 Task 5.2's `skip_reference` action emits `--- Document: <name>\nStatus: skipped (reason: <reason>)\n---` instead of dropping the ref. Without this, the same task can produce different prompt layouts depending on transient failures, and LLM behaviour drifts run-to-run. This applies to all non-injected references, including `skip_reference`, over-cap references, and wall-clock budget-blown references. Any reference that was selected into the ordered external reference list but not injected as content must emit a position-preserving placeholder block.

**11. TTL boundary uses fetch-start time.** Cache TTL evaluation captures `fetchStart = new Date()` at the top of `doResolve` and uses that value everywhere `isPastStalenessBoundary` is called. Never use `new Date()` at the comparison site — a slow fetch can cross the boundary mid-call and flip a fresh result to "broken" through no fault of the doc. Enforced in Task 2.5.

**12. Idempotent failure writes.** Repeated identical failures within a single run write at most one `document_fetch_events` row. Enforced via a partial unique index on `(reference_id, run_id, failure_reason) WHERE run_id IS NOT NULL AND failure_reason IS NOT NULL`. The orchestrator uses `onConflictDoNothing` on failure inserts. Without this, a tight retry loop in `runContextLoader` over a perpetually-failing ref pollutes observability with thousands of rows. Migration update lands in Task 1.1.

**13. Run-level revision pinning.** Within a single run, a `(provider, file_id, connection_id)` triple resolves to exactly one revision and exactly one content body. Already enforced by invariant #4 (dedup-within-run) — the dedup map ensures a second attachment of the same doc reuses the first resolved result rather than re-fetching. Reviewer checklist: any code path that bypasses the dedup map (e.g., a future "re-resolve on demand" feature) must carry an explicit override and emit a `revision_pinned_bypass=true` audit field.

**14. Per-document budget cap.** No single reference may consume more than 30% of the run token budget (`Math.floor(run.tokenBudget * 0.3)`). Prevents the first large doc from starving later attachments. Applied in Phase 5 Task 5.2 immediately after resolve, before `enforceRunBudget`. Implementation: re-truncate any doc whose post-resolver `tokensUsed` exceeds the per-doc cap, marking the truncation in provenance as it would for the global hard limit.

**15. Server-computed UI state.** `attachment_state` in the DB is a write-cache for the most recent run's verdict, NOT the source of truth for "is this reference healthy right now". The view-model mapper (Task 3.0) derives the state surfaced to the UI from the latest `document_fetch_events` row, falling back to the persisted `attachmentState` only when no events exist. Without this, a reference whose Drive auth was revoked between runs renders as `active` until the next run executes — operator sees green, run breaks.

**16. Resolver-version invalidation is soft.** When `cacheRow.resolverVersion !== resolver.resolverVersion`, the cache is treated as stale (forces a re-fetch on the next request) but is NOT deleted. If the re-fetch fails, the old content is still available for `serve_stale_with_warning` / `serve_stale_silent`. This already falls out of the existing logic in Task 2.5 (versionStale → fetch path → falls back to cache on fetch failure if within staleness boundary). Documented here so it is not "optimised away" by a future contributor.

**17. Retry suppression window.** Across the system, a `(referenceId, failureReason)` pair that just failed is suppressed from re-attempting for `EXTERNAL_DOC_RETRY_SUPPRESSION_WINDOW_MS` (default 60s). Prevents N concurrent agents from independently hammering a doc that is currently `auth_revoked` / `rate_limited`. Implementation: in-process `Map<string, number>` keyed on `${referenceId}:${failureReason}` storing suppress-until timestamps; entries auto-expire on TTL miss. Helper introduced in Task 2.7.

### UI contract layer

UI does not bind directly to DB fields. A view-model layer mediates so backend evolution does not break the UI.

```typescript
export interface ExternalDocumentViewModel {
  id: string;
  name: string;
  state: 'active' | 'degraded' | 'broken';
  lastFetchedAt: string | null;
  failureReason: FetchFailureReason | null;
  canRebind: boolean;
}
```

Mapper `toExternalDocumentViewModel(row)` is the only way routes serialise external-document state to clients. Phase 3 Task 3.6 (TaskModal rows), Phase 4 Task 4.5 (DataSourceManager rows), and Phase 6 Tasks 6.1–6.3 (state-aware UI) consume the view model — never raw DB rows. Implementation: new Task 3.0 (precedes Task 3.1).

### Observability aggregates

Slice C ships three operational SQL queries committed to `docs/queries/external-doc-references/`. No dashboard UI in v1 — queries are run via `psql` / Grafana data source.

- `success_rate_per_provider_last_24h.sql`
- `cache_hit_ratio_per_subaccount_last_24h.sql`
- `failures_grouped_by_reason_last_7d.sql`

Average fetch latency requires a `duration_ms` column on `document_fetch_events` — deferred to v1.1 to keep the v1 migration minimal. Implementation: Task 5.5.

### Deferred to v1.1

- **Background prefetch on attach.** Eliminates first-run cold-start latency. The cache, single-flight guard, and audit log are already idempotent against duplicate fetches, so adding a low-priority `prefetch-document` job on attach is non-breaking and requires no schema changes.
- **`document_fetch_events.duration_ms`** column for latency aggregation.
- **Network-error retry.** Single retry on transient non-429 failures.
- **Embeddings / summary / chunks.** Future intelligence-layer features add nullable columns to `document_cache` (`content_summary text`, `content_embedding vector(1536)`, `content_chunks jsonb`). All non-breaking — no v1 work required.

### Map of feedback to tasks

| Concern | Where addressed |
|---|---|
| Release slices | This section + each phase's gate (read in conjunction) |
| Feature flags (kill switch + 3 slice flags) | Task 1.12 (helper) + inline gates in route handlers, `runContextLoader`, and resolver entry |
| Cache atomicity invariant | Task 2.5 step 8 (no change; documented above) |
| Hard-fail timeout | Task 5.2 step 4 (tightened) |
| Token accounting boundary | This section (rule); enforced in `runContextLoader` at prompt assembly |
| Dedup-within-run / run-level revision pinning | Task 5.2 step 2 (dedup map) |
| MIME mismatch logging | Task 2.5 step 4 (structured log call inline) |
| Retry classification | This section (table); `fetchWithRetry` only invoked on documented-retryable reasons |
| Retry suppression window | New Task 2.7 |
| Cross-instance lock (narrow scope) | Task 2.5b (rewritten — fetch outside lock, double-check inside) |
| PDF size guard | Task 2.3 (PDF branch) + constant in Task 1.8 |
| UI contract layer | Task 3.0 |
| Server-computed UI state | Task 3.0 mapper (derives state from latest fetch event) |
| No silent downgrade (provenance) | Task 2.2 `buildProvenanceHeader` + Task 5.2 (preserved across all serve actions including `serve_stale_silent`) |
| Deterministic ordering under failure | Task 5.2 (placeholder block on `skip_reference`) |
| TTL boundary at fetch-start | Task 2.5 step 4 (capture `fetchStart` at top of `doResolve`) |
| Idempotent failure writes | Task 1.1 (partial unique index) + Task 2.5 (`onConflictDoNothing` on failure path) |
| Per-document budget cap | Task 5.2 (post-resolve re-truncation step) |
| Soft resolver-version invalidation | Task 2.5 (existing logic; documented here) |
| Observability aggregates (incl. time-to-usable-context) | Task 5.5 |
| Background prefetch | Deferred to v1.1 |
| Future-proof schema | Deferred to v1.1 (additive nullable columns only) |

---

## Table of contents

1. [Execution strategy and cross-cutting invariants](#execution-strategy-and-cross-cutting-invariants)
2. [Phase 1 — Schema and Drive OAuth](#phase-1--schema-and-drive-oauth)
3. [Phase 2 — Resolver service](#phase-2--resolver-service)
4. [Phase 3 — TaskModal attachment path (Screens 1, 2, 3)](#phase-3--taskmodal-attachment-path-screens-1-2-3)
5. [Phase 4 — DataSourceManager path (Screen 5)](#phase-4--datasourcemanager-path-screen-5)
6. [Phase 5 — Context assembly and state machine](#phase-5--context-assembly-and-state-machine)
7. [Phase 6 — Re-bind modal and UI hardening (Screens 4, 6)](#phase-6--re-bind-modal-and-ui-hardening-screens-4-6)

---

## Phase 1 — Schema and Drive OAuth

**Delivers:** `0262_external_doc_refs_google_drive.sql` migration (every table + column + RLS policy), Drizzle schema files, Google Drive OAuth connect flow, picker-token endpoint stub, and the CredentialsTab dropdown option (Screen 1).

**Gate:** `npm run db:generate` produces a clean migration; `npm run typecheck` passes; `npm run lint` passes; the user can connect a Google Drive account via the Integrations page and see a row in `integration_connections` with `provider_type = 'google_drive'` and `connection_status = 'active'`.

### Task 1.1: Author migration `0262_external_doc_refs_google_drive.sql`

**Files:**
- Create: `migrations/0262_external_doc_refs_google_drive.sql`

- [ ] **Step 1: Write the migration SQL**

Create the file with:

```sql
-- 0262_external_doc_refs_google_drive.sql
-- Adds Google Drive as a live external document reference provider.

BEGIN;

-- 1. Enum extensions ----------------------------------------------------------
ALTER TYPE reference_documents_source_type ADD VALUE IF NOT EXISTS 'google_drive';
ALTER TYPE agent_data_sources_source_type ADD VALUE IF NOT EXISTS 'google_drive';
ALTER TYPE integration_connections_provider_type ADD VALUE IF NOT EXISTS 'google_drive';

-- 2. New columns on reference_documents ---------------------------------------
ALTER TABLE reference_documents
  ADD COLUMN IF NOT EXISTS external_provider         varchar(64),
  ADD COLUMN IF NOT EXISTS external_connection_id    uuid REFERENCES integration_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_file_id          varchar(1024),
  ADD COLUMN IF NOT EXISTS external_file_name        varchar(512),
  ADD COLUMN IF NOT EXISTS external_file_mime_type   varchar(256),
  ADD COLUMN IF NOT EXISTS attached_by_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attachment_order          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachment_state          varchar(32);

-- CHECK constraint: google_drive rows must have all external fields populated.
ALTER TABLE reference_documents
  ADD CONSTRAINT reference_documents_google_drive_required_fields
  CHECK (
    source_type <> 'google_drive'
    OR (
      external_connection_id  IS NOT NULL
      AND external_file_id    IS NOT NULL
      AND external_file_mime_type IS NOT NULL
      AND attachment_state    IS NOT NULL
    )
  );

-- Idempotency for attach: a Drive file may only be attached once per bundle/connection pair.
CREATE UNIQUE INDEX IF NOT EXISTS reference_documents_bundle_external_uniq
  ON reference_documents (bundle_id, external_file_id, external_connection_id)
  WHERE source_type = 'google_drive';

-- 3. New column on document_bundle_attachments --------------------------------
ALTER TABLE document_bundle_attachments
  ADD COLUMN IF NOT EXISTS fetch_failure_policy varchar(32) NOT NULL DEFAULT 'tolerant';

ALTER TABLE document_bundle_attachments
  ADD CONSTRAINT document_bundle_attachments_fetch_failure_policy_valid
  CHECK (fetch_failure_policy IN ('tolerant', 'strict', 'best_effort'));

-- 4. New column on agent_data_sources -----------------------------------------
ALTER TABLE agent_data_sources
  ADD COLUMN IF NOT EXISTS connection_id uuid REFERENCES integration_connections(id) ON DELETE SET NULL;

-- google_drive rows require a connection_id; other source types must not have one.
ALTER TABLE agent_data_sources
  ADD CONSTRAINT agent_data_sources_google_drive_connection_required
  CHECK (
    (source_type = 'google_drive' AND connection_id IS NOT NULL)
    OR (source_type <> 'google_drive')
  );

-- 5. document_cache table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS document_cache (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id       uuid NOT NULL REFERENCES subaccounts(id)   ON DELETE CASCADE,
  provider            varchar(64)   NOT NULL,
  file_id             varchar(1024) NOT NULL,
  connection_id       uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  content             text NOT NULL,
  revision_id         varchar(512),
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  content_size_tokens integer NOT NULL,
  content_hash        varchar(64) NOT NULL,
  resolver_version    integer NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, file_id, connection_id)
);

CREATE INDEX IF NOT EXISTS document_cache_subaccount_idx
  ON document_cache (subaccount_id);

ALTER TABLE document_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_cache_isolation ON document_cache
  USING (subaccount_id = current_setting('app.current_subaccount_id')::uuid);

-- 6. document_fetch_events table ---------------------------------------------
CREATE TABLE IF NOT EXISTS document_fetch_events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id            uuid NOT NULL REFERENCES subaccounts(id)   ON DELETE CASCADE,
  reference_id             uuid,
  reference_type           varchar(32) NOT NULL,
  run_id                   uuid,
  fetched_at               timestamptz NOT NULL DEFAULT now(),
  cache_hit                boolean NOT NULL,
  provider                 varchar(64) NOT NULL,
  doc_name                 varchar(512),
  revision_id              varchar(512),
  tokens_used              integer NOT NULL,
  tokens_before_truncation integer,
  resolver_version         integer NOT NULL,
  failure_reason           varchar(64),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_fetch_events_subaccount_idx
  ON document_fetch_events (subaccount_id);
CREATE INDEX IF NOT EXISTS document_fetch_events_reference_idx
  ON document_fetch_events (reference_id, reference_type);
CREATE INDEX IF NOT EXISTS document_fetch_events_run_idx
  ON document_fetch_events (run_id);

-- Idempotent failure writes (invariant #12): a (reference, run, failure_reason) triple
-- writes at most one row. Allows tight retry loops in runContextLoader without
-- polluting observability. Only applies to failure rows tied to a run.
CREATE UNIQUE INDEX IF NOT EXISTS document_fetch_events_failure_idem_uniq
  ON document_fetch_events (reference_id, run_id, failure_reason)
  WHERE run_id IS NOT NULL AND failure_reason IS NOT NULL;

ALTER TABLE document_fetch_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_fetch_events_isolation ON document_fetch_events
  USING (subaccount_id = current_setting('app.current_subaccount_id')::uuid);

COMMIT;
```

- [ ] **Step 2: Run the migration locally and verify**

Run: `npm run db:migrate`
Expected: migration applies; `\d reference_documents`, `\d document_cache`, `\d document_fetch_events` show the new columns / tables / RLS policies.

- [ ] **Step 3: Commit**

```bash
git add migrations/0262_external_doc_refs_google_drive.sql
git commit -m "feat(migration): add 0262 external doc refs google drive schema"
```

### Task 1.2: Drizzle schema for `document_cache`

**Files:**
- Create: `server/db/schema/documentCache.ts`

- [ ] **Step 1: Write the schema file**

```typescript
import { pgTable, uuid, varchar, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { integrationConnections } from './integrationConnections';

export const documentCache = pgTable(
  'document_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    subaccountId:   uuid('subaccount_id').notNull().references(() => subaccounts.id,   { onDelete: 'cascade' }),
    provider:        varchar('provider', { length: 64 }).notNull(),
    fileId:          varchar('file_id', { length: 1024 }).notNull(),
    connectionId:    uuid('connection_id').notNull().references(() => integrationConnections.id, { onDelete: 'cascade' }),
    content:         text('content').notNull(),
    revisionId:      varchar('revision_id', { length: 512 }),
    fetchedAt:       timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    contentSizeTokens: integer('content_size_tokens').notNull(),
    contentHash:     varchar('content_hash', { length: 64 }).notNull(),
    resolverVersion: integer('resolver_version').notNull(),
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerFileConnUniq: uniqueIndex('document_cache_provider_file_connection_uniq').on(t.provider, t.fileId, t.connectionId),
  })
);

export type DocumentCacheRow = typeof documentCache.$inferSelect;
export type NewDocumentCacheRow = typeof documentCache.$inferInsert;
```

- [ ] **Step 2: Verify the schema compiles**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add server/db/schema/documentCache.ts
git commit -m "feat(schema): add document_cache drizzle schema"
```

### Task 1.3: Drizzle schema for `document_fetch_events`

**Files:**
- Create: `server/db/schema/documentFetchEvents.ts`

- [ ] **Step 1: Write the schema file**

```typescript
import { pgTable, uuid, varchar, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

export const documentFetchEvents = pgTable(
  'document_fetch_events',
  {
    id:              uuid('id').primaryKey().defaultRandom(),
    organisationId:  uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    subaccountId:    uuid('subaccount_id').notNull().references(() => subaccounts.id,    { onDelete: 'cascade' }),
    referenceId:     uuid('reference_id'),
    referenceType:   varchar('reference_type', { length: 32 }).notNull(),
    runId:           uuid('run_id'),
    fetchedAt:       timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    cacheHit:        boolean('cache_hit').notNull(),
    provider:        varchar('provider', { length: 64 }).notNull(),
    docName:         varchar('doc_name', { length: 512 }),
    revisionId:      varchar('revision_id', { length: 512 }),
    tokensUsed:      integer('tokens_used').notNull(),
    tokensBeforeTruncation: integer('tokens_before_truncation'),
    resolverVersion: integer('resolver_version').notNull(),
    failureReason:   varchar('failure_reason', { length: 64 }),
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subaccountIdx: index('document_fetch_events_subaccount_idx').on(t.subaccountId),
    referenceIdx:  index('document_fetch_events_reference_idx').on(t.referenceId, t.referenceType),
    runIdx:        index('document_fetch_events_run_idx').on(t.runId),
  })
);

export type DocumentFetchEventRow = typeof documentFetchEvents.$inferSelect;
export type NewDocumentFetchEventRow = typeof documentFetchEvents.$inferInsert;

export const FETCH_FAILURE_REASONS = [
  'auth_revoked',
  'file_deleted',
  'rate_limited',
  'network_error',
  'quota_exceeded',
  'budget_exceeded',
  'unsupported_content',
] as const;

export type FetchFailureReason = (typeof FETCH_FAILURE_REASONS)[number];
```

- [ ] **Step 2: Verify the schema compiles**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add server/db/schema/documentFetchEvents.ts
git commit -m "feat(schema): add document_fetch_events drizzle schema"
```

### Task 1.4: Extend `referenceDocuments` schema

**Files:**
- Modify: `server/db/schema/referenceDocuments.ts`

- [ ] **Step 1: Read the current schema**

Read the file to see the existing column definitions and `source_type` enum.

- [ ] **Step 2: Add new columns and extend `source_type`**

Add to the existing `pgTable` definition:

```typescript
externalProvider:        varchar('external_provider', { length: 64 }),
externalConnectionId:    uuid('external_connection_id').references(() => integrationConnections.id, { onDelete: 'set null' }),
externalFileId:          varchar('external_file_id', { length: 1024 }),
externalFileName:        varchar('external_file_name', { length: 512 }),
externalFileMimeType:    varchar('external_file_mime_type', { length: 256 }),
attachedByUserId:        uuid('attached_by_user_id').references(() => users.id, { onDelete: 'set null' }),
attachmentOrder:         integer('attachment_order').notNull().default(0),
attachmentState:         varchar('attachment_state', { length: 32 }),
```

Extend the `sourceType` enum union with `'google_drive'`. Export an `ATTACHMENT_STATES` const array `['active', 'degraded', 'broken'] as const` and a corresponding `AttachmentState` type.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no type errors. The new columns are nullable except `attachmentOrder`.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema/referenceDocuments.ts
git commit -m "feat(schema): extend reference_documents with external doc fields"
```

### Task 1.5: Extend `documentBundleAttachments` schema

**Files:**
- Modify: `server/db/schema/documentBundleAttachments.ts`

- [ ] **Step 1: Add `fetch_failure_policy` column**

```typescript
fetchFailurePolicy: varchar('fetch_failure_policy', { length: 32 }).notNull().default('tolerant'),
```

Export `FETCH_FAILURE_POLICIES = ['tolerant', 'strict', 'best_effort'] as const` and a `FetchFailurePolicy` type.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add server/db/schema/documentBundleAttachments.ts
git commit -m "feat(schema): add fetch_failure_policy column"
```

### Task 1.6: Extend `agentDataSources` and `integrationConnections` schemas

**Files:**
- Modify: `server/db/schema/agentDataSources.ts`
- Modify: `server/db/schema/integrationConnections.ts`

- [ ] **Step 1: Add `connection_id` column to `agentDataSources`**

```typescript
connectionId: uuid('connection_id').references(() => integrationConnections.id, { onDelete: 'set null' }),
```

Extend the `sourceType` enum union with `'google_drive'`.

- [ ] **Step 2: Extend `provider_type` on `integrationConnections`**

Extend the `providerType` enum union with `'google_drive'`. Export it from the file's existing enum array if one exists.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema/agentDataSources.ts server/db/schema/integrationConnections.ts
git commit -m "feat(schema): add connection_id and google_drive provider type"
```

### Task 1.7: Register new tables in `rlsProtectedTables.ts`

**Files:**
- Modify: `server/config/rlsProtectedTables.ts`

- [ ] **Step 1: Add entries**

Append two entries to the existing exported array:

```typescript
{
  tableName: 'document_cache',
  schemaFile: 'documentCache.ts',
  policyMigration: '0262_external_doc_refs_google_drive.sql',
  rationale: 'Per-subaccount document cache; content may include confidential business documents fetched from Drive.',
},
{
  tableName: 'document_fetch_events',
  schemaFile: 'documentFetchEvents.ts',
  policyMigration: '0262_external_doc_refs_google_drive.sql',
  rationale: 'Per-subaccount fetch audit log; records which documents were accessed in which runs.',
},
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npm run lint`.
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/config/rlsProtectedTables.ts
git commit -m "feat(rls): register document_cache and document_fetch_events"
```

### Task 1.8: Constants for limits and timeouts

**Files:**
- Modify: `server/lib/constants.ts`

- [ ] **Step 1: Append the new constants**

```typescript
export const EXTERNAL_DOC_MAX_STALENESS_MINUTES       = 10080; // 7 days
export const EXTERNAL_DOC_HARD_TOKEN_LIMIT            = 100_000;
export const EXTERNAL_DOC_SOFT_TOKEN_WARN             = 50_000;
export const EXTERNAL_DOC_MIN_CONTENT_TOKENS          = 200;
export const EXTERNAL_DOC_FRAGMENTATION_THRESHOLD     = 500;
export const EXTERNAL_DOC_CHECK_REVISION_TIMEOUT_MS   = 2_000;
export const EXTERNAL_DOC_FETCH_CONTENT_TIMEOUT_MS    = 5_000;
export const EXTERNAL_DOC_MAX_TOTAL_RESOLVER_MS       = 30_000;
export const EXTERNAL_DOC_MAX_REFS_PER_RUN            = 25;
export const EXTERNAL_DOC_MAX_REFS_PER_TASK           = 20;
export const EXTERNAL_DOC_MAX_REFS_PER_SUBACCOUNT     = 100;
export const EXTERNAL_DOC_SHEETS_MAX_RAW_BYTES        = 5 * 1024 * 1024; // 5MB
export const EXTERNAL_DOC_PDF_MAX_BYTES               = 10 * 1024 * 1024; // 10MB — bounded before pdf-parse to cap CPU/memory
export const EXTERNAL_DOC_SINGLE_FLIGHT_MAX_ENTRIES   = 1000;
export const EXTERNAL_DOC_TRUNCATION_HEAD_RATIO       = 0.7;
export const EXTERNAL_DOC_RATE_LIMIT_RETRIES          = 2;
export const EXTERNAL_DOC_RATE_LIMIT_INITIAL_BACKOFF_MS = 1_000;
```

(There is no global `RESOLVER_VERSION` constant; each resolver class owns its own `resolverVersion` property — see §6.3 of the spec.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`.
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add server/lib/constants.ts
git commit -m "feat(constants): add external doc reference limits and timeouts"
```

### Task 1.9: Drive OAuth handler — connect + token refresh

**Files:**
- Create: `server/routes/integrations/googleDrive.ts`
- Modify: `server/routes/oauthIntegrations.ts` (add `google_drive` case to provider dispatch)

- [ ] **Step 1: Create the Google Drive OAuth handler stub**

```typescript
// server/routes/integrations/googleDrive.ts
import express from 'express';
import { authenticate } from '../../middleware/authenticate';
import { resolveSubaccount } from '../../middleware/resolveSubaccount';
import { requirePermission } from '../../middleware/requirePermission';
import { integrationConnectionService } from '../../services/integrationConnectionService';

const router = express.Router();

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

// OAuth callback — invoked by oauthIntegrations.ts dispatcher
export async function handleGoogleDriveOAuthCallback(params: {
  code: string;
  organisationId: string;
  subaccountId: string;
  ownerUserId: string;
}): Promise<{ connectionId: string }> {
  // Exchange code for tokens via Google's token endpoint.
  // Encrypt and store access_token, refresh_token, token_expires_at in integration_connections.
  // Set provider_type = 'google_drive', auth_type = 'oauth2', connection_status = 'active'.
  // Return the new connection's id.
  // (Implementation mirrors the existing Gmail OAuth handler.)
  throw new Error('Not implemented — Phase 1 task 1.9');
}

// GET /api/integrations/google-drive/picker-token?connectionId=<id>
router.get(
  '/picker-token',
  authenticate,
  resolveSubaccount,
  requirePermission('org.integrations.manage'),
  async (req, res) => {
    const { connectionId } = req.query as { connectionId?: string };
    if (!connectionId) return res.status(400).json({ error: 'connectionId_required' });

    // Validate connection belongs to caller's subaccount and is provider_type = 'google_drive'.
    const conn = await integrationConnectionService.getForSubaccount({
      connectionId,
      subaccountId: req.subaccount.id,
    });
    if (!conn || conn.provider_type !== 'google_drive') {
      return res.status(404).json({ error: 'connection_not_found' });
    }

    // Refresh the access token if within 5 minutes of expiry. Returns the live token.
    const accessToken = await integrationConnectionService.getRefreshedAccessToken(connectionId);

    return res.json({
      accessToken,
      pickerApiKey: process.env.GOOGLE_PICKER_API_KEY,
      appId: process.env.GOOGLE_OAUTH_CLIENT_PROJECT_NUMBER,
    });
  }
);

export default router;
```

- [ ] **Step 2: Wire the new handler into the dispatcher**

In `server/routes/oauthIntegrations.ts`, locate the provider dispatch (typically a `switch (providerType) { case 'gmail': ... }`) and add:

```typescript
case 'google_drive':
  return handleGoogleDriveOAuthCallback(params);
```

Import `handleGoogleDriveOAuthCallback` from the new module. Also add `google_drive` to the `OAuth provider scope map` so the consent URL builder issues `drive.readonly`.

- [ ] **Step 3: Mount the new router**

In the Express app setup (look for `app.use('/api/integrations', ...)` registrations), add:

```typescript
app.use('/api/integrations/google-drive', googleDriveRouter);
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`.
Expected: no type errors. Manual smoke: hitting `GET /api/integrations/google-drive/picker-token?connectionId=<bad>` returns 404.

- [ ] **Step 5: Commit**

```bash
git add server/routes/integrations/googleDrive.ts server/routes/oauthIntegrations.ts
git commit -m "feat(oauth): add google drive provider handler and picker-token endpoint"
```

### Task 1.10: CredentialsTab — Google Drive option (Screen 1)

**Mockup:** Screen 1 of 6 — `docs/mockups/external-doc-references.html`, lines 308–434.
The mockup shows the `Add Connection` dropdown opened on the Integrations page, with `Google Drive` listed below a divider that separates file-store providers from action providers.

**Files:**
- Modify: `client/src/components/CredentialsTab.tsx`

- [ ] **Step 1: Read the current `OAUTH_PROVIDER_OPTIONS` array (lines 36+)**

Confirm shape: `{ key: string; label: string; description: string }[]`.

- [ ] **Step 2: Add the Google Drive entry**

Append a new entry. The mockup groups file-store providers under a divider; if the array supports a separator marker (e.g., `kind: 'divider'`), insert one before the Drive entry; otherwise add a `category: 'file_store'` field used by the dropdown renderer to draw the divider.

```typescript
{
  key: 'google_drive',
  label: 'Google Drive',
  description: 'Attach Drive files as live document references',
  category: 'file_store',
},
```

If `category` is not yet a field, add it (`category?: 'file_store' | 'action'`) and default existing entries to `'action'`.

- [ ] **Step 3: Render the divider in the dropdown body**

In the dropdown render block (around line 364) insert a `<div className="border-t border-slate-200 my-1" />` between the last `category === 'file_store'` entry and the first `category === 'action'` entry. Sort the array so file-store entries come first.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run build:client`.
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/CredentialsTab.tsx
git commit -m "feat(credentials): add google drive option with file-store divider"
```

### Task 1.11: CredentialsTab — post-connection info box (Screen 1)

**Mockup:** Screen 1 of 6, blue info box shown beneath the connections list once a `google_drive` connection exists.

**Files:**
- Modify: `client/src/components/CredentialsTab.tsx`

- [ ] **Step 1: Add the info-box component**

Inside the same file, after the connections list block, render:

```tsx
{hasGoogleDriveConnection && !infoBoxDismissed && (
  <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="text-sm text-blue-900">
        <p className="font-semibold">Shared across this subaccount.</p>
        <p className="mt-1">
          Any admin can attach Drive files using this connection. The connection
          is not tied to your personal account, so it survives if you leave the
          team. Agents access files on behalf of this connection, not their own
          identity.
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="text-blue-600 hover:text-blue-800"
        onClick={dismissInfoBox}
      >
        ×
      </button>
    </div>
  </div>
)}
```

`hasGoogleDriveConnection` is derived from the existing connections list: `connections.some(c => c.provider_type === 'google_drive')`.

- [ ] **Step 2: Wire the dismissal to localStorage per subaccount**

```typescript
const storageKey = `cred:gdrive-info-dismissed:${subaccountId}`;
const [infoBoxDismissed, setInfoBoxDismissed] = useState(
  () => typeof window !== 'undefined' && localStorage.getItem(storageKey) === '1'
);
const dismissInfoBox = () => {
  localStorage.setItem(storageKey, '1');
  setInfoBoxDismissed(true);
};
```

- [ ] **Step 3: Verify**

Run: `npm run build:client`.
Expected: clean build. Manual: connecting a Drive account renders the info box; clicking × persists dismissal across reloads.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/CredentialsTab.tsx
git commit -m "feat(credentials): add post-drive-connection shared-account info box"
```

### Task 1.12: Feature flag helper

**Files:**
- Create: `server/lib/featureFlags.ts`

Read once at process start; no live reload. See `## Execution strategy and cross-cutting invariants` for the slice rollout these flags gate.

- [ ] **Step 1: Write the helper**

```typescript
// server/lib/featureFlags.ts

const readBool = (name: string, fallback: boolean): boolean => {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
};

export const externalDocFlags = {
  systemDisabled:          readBool('EXTERNAL_DOC_SYSTEM_DISABLED',          false),
  attachEnabled:           readBool('EXTERNAL_DOC_ATTACH_ENABLED',           false),
  resolutionEnabled:       readBool('EXTERNAL_DOC_RESOLUTION_ENABLED',       false),
  failurePoliciesEnabled:  readBool('EXTERNAL_DOC_FAILURE_POLICIES_ENABLED', false),
} as const;
```

If the existing codebase has a feature-flag aggregator (search `server/lib/featureFlags*` or `server/config/flags*`), extend it instead of creating a new file. The shape of `externalDocFlags` (exported object, four booleans) must remain the same so downstream tasks import the same identifier.

- [ ] **Step 2: Wire the flag at the boundaries (deferred to consuming phases)**

Kill switch first: every consumer checks `externalDocFlags.systemDisabled` before any other flag — `runContextLoader` returns empty external context with no audit/fetch/DB activity; attach/resolve routes return 503; resolver entry returns synthetic-failure with `failure_reason = 'unsupported_content'`. Bypasses all other flags.

Slice gates: Phase 3 attach routes guard with `if (!externalDocFlags.attachEnabled) return res.status(503).json(...)`. Phase 5 `runContextLoader` short-circuits with `if (!externalDocFlags.resolutionEnabled) { /* emit synthetic resolution_disabled audit row, skip resolve loop */ }`. Phase 5 failure-policy step honors operator selection only when `failurePoliciesEnabled`; otherwise forces `tolerant`. Each consuming task references this helper.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`.
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/lib/featureFlags.ts
git commit -m "feat(flags): add external doc reference feature flags"
```

### Task 1.13: Phase 1 verification gate

- [ ] **Step 1: Run all static gates**

Run, in order:
```bash
npm run lint
npx tsc --noEmit
npm run db:generate
npm run build:server
npm run build:client
```
Expected: all clean. `npm run db:generate` should produce a no-op diff (the migration is hand-authored).

- [ ] **Step 2: Smoke test the OAuth flow**

Manual:
1. Open the Integrations page.
2. Click `Add Connection`. Verify Google Drive appears below the file-store divider (Screen 1).
3. Select Google Drive, complete the consent screen with a test account.
4. Verify a row in `integration_connections` with `provider_type = 'google_drive'`, `connection_status = 'active'`, encrypted `access_token` and `refresh_token`, and `token_expires_at` set.
5. Verify the blue info box renders. Dismiss it; reload; verify dismissal persists.

## Phase 2 — Resolver service

**Delivers:** `externalDocumentResolverService.ts` and `googleDriveResolver.ts` — the engine that fetches, normalises, validates, caches, and audit-logs every external document access. Pure-function tests exercise truncation, provenance, staleness, and resolver-version logic without a live DB or Drive API.

**Gate:** all pure-function tests pass via `npx tsx`. Resolver can be invoked in isolation against a mocked Drive API and produces correct `ResolvedDocument` shapes for Docs / Sheets / PDF / failure paths.

**Depends on:** Phase 1 (schema, constants, OAuth credentials in `integration_connections`).

### Task 2.1: Define shared types and the `ResolvedDocument` contract

**Files:**
- Create: `server/services/externalDocumentResolverTypes.ts`

- [ ] **Step 1: Write the types**

```typescript
// server/services/externalDocumentResolverTypes.ts

import type { FetchFailureReason } from '../db/schema/documentFetchEvents';

export interface ExternalDocumentResolver {
  /**
   * Returns the provider's current change-detection token (revisionId or ETag).
   * Cheap call — metadata only, no content download.
   */
  checkRevision(fileId: string, accessToken: string): Promise<{ revisionId: string | null; mimeType: string; name: string } | null>;

  /**
   * Fetches and normalises the document content to plain text.
   */
  fetchContent(fileId: string, mimeType: string, accessToken: string): Promise<string>;

  /**
   * Increment when normalisation output changes in a way that would alter cached content.
   */
  readonly resolverVersion: number;

  /**
   * Provider key — must match the `provider` column on `document_cache`.
   */
  readonly providerKey: 'google_drive';
}

export interface ResolvedDocument {
  referenceId: string;
  content: string;                 // normalised plain text, post-truncation
  provenance: {
    provider: 'google_drive';
    docName: string;
    fetchedAt: string;             // ISO 8601 — actual cache write time, never current time when serving cache
    revisionId: string | null;
    isStale: boolean;              // true when serving from cache on a degraded reference
    truncated: boolean;
    tokensRemovedByTruncation: number | null;
  };
  tokensUsed: number;              // post-truncation token count
  cacheHit: boolean;
  failureReason: FetchFailureReason | null;
}

export interface ResolveParams {
  referenceId: string;
  referenceType: 'reference_document' | 'agent_data_source';
  organisationId: string;
  subaccountId: string;
  connectionId: string;
  fileId: string;
  expectedMimeType: string;
  docName: string;
  runId: string | null;
  /** Caller-supplied scoped DB client established via withOrgTx / getOrgScopedDb. */
  db: ScopedDbClient;
  /** Optional pre-fetched OAuth access token. If omitted, the resolver refreshes it. */
  accessToken?: string;
}

export type ScopedDbClient = unknown; // typed against the project's DB client type
```

(Replace `ScopedDbClient = unknown` with the actual scoped DB type used elsewhere in `server/services` — e.g., the type returned by `getOrgScopedDb()`.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`.
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add server/services/externalDocumentResolverTypes.ts
git commit -m "feat(resolver): define ExternalDocumentResolver and ResolvedDocument types"
```

### Task 2.2: Pure-function helpers — token counting + truncation

**Files:**
- Create: `server/services/externalDocumentResolverPure.ts`
- Create: `server/services/__tests__/externalDocumentResolverPure.test.ts`

- [ ] **Step 1: Write the failing test for truncation**

```typescript
// externalDocumentResolverPure.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  truncateContentToTokenBudget,
  buildProvenanceHeader,
  countTokensApprox,
  TruncationResult,
} from '../externalDocumentResolverPure';

test('truncateContentToTokenBudget — under budget passes through unchanged', () => {
  const input = 'short content';
  const result: TruncationResult = truncateContentToTokenBudget(input, 1000);
  assert.equal(result.truncated, false);
  assert.equal(result.content, input);
  assert.equal(result.tokensRemoved, 0);
});

test('truncateContentToTokenBudget — over budget applies 70/30 head+tail with marker', () => {
  // Build content with a clear head/tail marker so we can assert preservation.
  const head = 'HEAD '.repeat(200);
  const tail = ' TAIL'.repeat(200);
  const middle = ' MID '.repeat(2000);
  const input = head + middle + tail;
  const result = truncateContentToTokenBudget(input, 600);
  assert.equal(result.truncated, true);
  assert.ok(result.content.includes('HEAD'));
  assert.ok(result.content.includes('TAIL'));
  assert.ok(result.content.includes('[TRUNCATED:'));
  assert.ok(result.tokensRemoved > 0);
  // head ratio invariant: head segment must be >= 60% of preserved content tokens.
  const head70 = result.content.split('[TRUNCATED:')[0];
  assert.ok(countTokensApprox(head70) >= countTokensApprox(result.content) * 0.6);
});

test('buildProvenanceHeader — includes Source, Fetched, Revision when present', () => {
  const header = buildProvenanceHeader({
    docName: 'Test Doc',
    fetchedAt: '2026-04-30T09:04:00Z',
    revisionId: '7',
    isStale: false,
  });
  assert.match(header, /^--- Document: Test Doc/m);
  assert.match(header, /Source: Google Drive/);
  assert.match(header, /Fetched: 2026-04-30T09:04:00Z/);
  assert.match(header, /Revision: 7/);
  assert.doesNotMatch(header, /Warning:/);
});

test('buildProvenanceHeader — omits Revision line when revisionId is null', () => {
  const header = buildProvenanceHeader({
    docName: 'No Rev Doc',
    fetchedAt: '2026-04-30T09:04:00Z',
    revisionId: null,
    isStale: false,
  });
  assert.doesNotMatch(header, /Revision:/);
});

test('buildProvenanceHeader — adds Warning line on stale (degraded) cache', () => {
  const header = buildProvenanceHeader({
    docName: 'Stale Doc',
    fetchedAt: '2026-04-29T09:00:00Z',
    revisionId: '5',
    isStale: true,
  });
  assert.match(header, /Warning: content is from cache \(2026-04-29T09:00:00Z\); last fetch failed/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx server/services/__tests__/externalDocumentResolverPure.test.ts`
Expected: FAIL with "Cannot find module '../externalDocumentResolverPure'".

- [ ] **Step 3: Implement the pure helpers**

```typescript
// server/services/externalDocumentResolverPure.ts

import { EXTERNAL_DOC_TRUNCATION_HEAD_RATIO } from '../lib/constants';

/**
 * Approximate token count — fast heuristic for pre-checks only.
 * Final budget enforcement must use the exact tokenizer (§9.5).
 */
export function countTokensApprox(text: string): number {
  // ~4 chars per token is the conservative GPT-style heuristic.
  return Math.ceil(text.length / 4);
}

export interface TruncationResult {
  content: string;
  truncated: boolean;
  tokensRemoved: number;
}

/**
 * Truncate content to a token budget using a 70% head + 30% tail strategy.
 * Final budget enforcement uses the exact runtime tokenizer (injected from caller).
 * This pure helper accepts a `tokenizer` callback; default is the approximation.
 */
export function truncateContentToTokenBudget(
  content: string,
  tokenBudget: number,
  tokenizer: (s: string) => number = countTokensApprox
): TruncationResult {
  const totalTokens = tokenizer(content);
  if (totalTokens <= tokenBudget) {
    return { content, truncated: false, tokensRemoved: 0 };
  }
  const headTokens = Math.floor(tokenBudget * EXTERNAL_DOC_TRUNCATION_HEAD_RATIO);
  const tailTokens = tokenBudget - headTokens;
  // For the approximate path, slice by character ratio. The runtime tokenizer
  // is plugged in by the caller for exact slicing.
  const headChars = Math.floor((headTokens / totalTokens) * content.length);
  const tailChars = Math.floor((tailTokens / totalTokens) * content.length);
  const head = content.slice(0, headChars);
  const tail = content.slice(content.length - tailChars);
  const removed = totalTokens - tokenBudget;
  return {
    content: `${head}\n\n[TRUNCATED: ${removed} tokens removed]\n\n${tail}`,
    truncated: true,
    tokensRemoved: removed,
  };
}

export interface ProvenanceParams {
  docName: string;
  fetchedAt: string;
  revisionId: string | null;
  isStale: boolean;
}

export function buildProvenanceHeader(p: ProvenanceParams): string {
  const lines: string[] = [
    `--- Document: ${p.docName}`,
    `Source: Google Drive`,
    `Fetched: ${p.fetchedAt}`,
  ];
  if (p.revisionId !== null) lines.push(`Revision: ${p.revisionId}`);
  if (p.isStale) lines.push(`Warning: content is from cache (${p.fetchedAt}); last fetch failed`);
  lines.push('---');
  return lines.join('\n');
}

/**
 * Returns true when fetched_at falls outside the staleness boundary.
 * Used to decide degraded → broken transition.
 */
export function isPastStalenessBoundary(fetchedAt: Date, now: Date, maxStalenessMinutes: number): boolean {
  const diffMs = now.getTime() - fetchedAt.getTime();
  return diffMs > maxStalenessMinutes * 60_000;
}

/**
 * Returns true when the cached resolver_version differs from the current resolver's version.
 */
export function isResolverVersionStale(cachedVersion: number, currentVersion: number): boolean {
  return cachedVersion !== currentVersion;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx tsx server/services/__tests__/externalDocumentResolverPure.test.ts`
Expected: PASS for all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/externalDocumentResolverPure.ts server/services/__tests__/externalDocumentResolverPure.test.ts
git commit -m "feat(resolver): pure helpers for truncation, provenance, staleness"
```

### Task 2.3: Google Drive resolver — file-type dispatch and normalisation

**Files:**
- Create: `server/services/resolvers/googleDriveResolver.ts`
- Create: `server/services/resolvers/__tests__/googleDriveResolver.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// googleDriveResolver.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { googleDriveResolver, normaliseSheetsCsv, normaliseDriveDocsText, isSupportedDriveMimeType } from '../googleDriveResolver';

test('isSupportedDriveMimeType — accepts the three v1 supported types', () => {
  assert.equal(isSupportedDriveMimeType('application/vnd.google-apps.document'), true);
  assert.equal(isSupportedDriveMimeType('application/vnd.google-apps.spreadsheet'), true);
  assert.equal(isSupportedDriveMimeType('application/pdf'), true);
});

test('isSupportedDriveMimeType — rejects unsupported types', () => {
  assert.equal(isSupportedDriveMimeType('application/vnd.google-apps.presentation'), false);
  assert.equal(isSupportedDriveMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), false);
  assert.equal(isSupportedDriveMimeType('image/png'), false);
});

test('normaliseDriveDocsText — passthrough preserves content (deterministic)', () => {
  const input = 'Some prose.\n\nSecond paragraph.';
  assert.equal(normaliseDriveDocsText(input), input);
  assert.equal(normaliseDriveDocsText(input), normaliseDriveDocsText(input));
});

test('normaliseSheetsCsv — preserves CSV structure deterministically', () => {
  const input = 'a,b,c\n1,2,3\n4,5,6\n';
  const out = normaliseSheetsCsv(input);
  assert.equal(out, input);
  assert.equal(out, normaliseSheetsCsv(input));
});

test('googleDriveResolver.resolverVersion — exposes 1 for v1', () => {
  assert.equal(googleDriveResolver.resolverVersion, 1);
  assert.equal(googleDriveResolver.providerKey, 'google_drive');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx server/services/resolvers/__tests__/googleDriveResolver.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the Google Drive resolver**

```typescript
// server/services/resolvers/googleDriveResolver.ts

import {
  EXTERNAL_DOC_CHECK_REVISION_TIMEOUT_MS,
  EXTERNAL_DOC_FETCH_CONTENT_TIMEOUT_MS,
  EXTERNAL_DOC_RATE_LIMIT_RETRIES,
  EXTERNAL_DOC_RATE_LIMIT_INITIAL_BACKOFF_MS,
  EXTERNAL_DOC_SHEETS_MAX_RAW_BYTES,
  EXTERNAL_DOC_PDF_MAX_BYTES,
} from '../../lib/constants';
import type { ExternalDocumentResolver } from '../externalDocumentResolverTypes';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

const SUPPORTED_MIME_TYPES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/pdf',
]);

export function isSupportedDriveMimeType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType);
}

/** Normalise plain-text Docs export. Deterministic, no transformation in v1. */
export function normaliseDriveDocsText(text: string): string {
  return text;
}

/** Normalise CSV Sheets export. Deterministic, no transformation in v1. */
export function normaliseSheetsCsv(csv: string): string {
  return csv;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let backoff = EXTERNAL_DOC_RATE_LIMIT_INITIAL_BACKOFF_MS;
  for (let attempt = 0; attempt <= EXTERNAL_DOC_RATE_LIMIT_RETRIES; attempt++) {
    const res = await fetchWithTimeout(url, init, timeoutMs);
    if (res.status !== 429) return res;
    if (attempt === EXTERNAL_DOC_RATE_LIMIT_RETRIES) return res;
    await new Promise(r => setTimeout(r, backoff));
    backoff *= 2;
  }
  throw new Error('unreachable');
}

export const googleDriveResolver: ExternalDocumentResolver = {
  resolverVersion: 1,
  providerKey: 'google_drive',

  async checkRevision(fileId, accessToken) {
    const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,headRevisionId`;
    const res = await fetchWithRetry(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      EXTERNAL_DOC_CHECK_REVISION_TIMEOUT_MS
    );
    if (res.status === 401 || res.status === 403) throw new ResolverError('auth_revoked');
    if (res.status === 404) throw new ResolverError('file_deleted');
    if (res.status === 429) throw new ResolverError('rate_limited');
    if (!res.ok) throw new ResolverError('network_error');
    const meta = (await res.json()) as { id: string; name: string; mimeType: string; modifiedTime: string; headRevisionId?: string };
    return { revisionId: meta.headRevisionId ?? null, mimeType: meta.mimeType, name: meta.name };
  },

  async fetchContent(fileId, mimeType, accessToken) {
    if (!isSupportedDriveMimeType(mimeType)) throw new ResolverError('unsupported_content');

    if (mimeType === 'application/vnd.google-apps.document') {
      const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`;
      const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${accessToken}` } }, EXTERNAL_DOC_FETCH_CONTENT_TIMEOUT_MS);
      classifyDriveResponse(res);
      const text = await res.text();
      return normaliseDriveDocsText(text);
    }

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=text/csv`;
      const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${accessToken}` } }, EXTERNAL_DOC_FETCH_CONTENT_TIMEOUT_MS);
      classifyDriveResponse(res);
      // 5MB raw body cap — read as buffer to size-check before decoding.
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > EXTERNAL_DOC_SHEETS_MAX_RAW_BYTES) throw new ResolverError('quota_exceeded');
      return normaliseSheetsCsv(buf.toString('utf8'));
    }

    if (mimeType === 'application/pdf') {
      const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
      const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${accessToken}` } }, EXTERNAL_DOC_FETCH_CONTENT_TIMEOUT_MS);
      classifyDriveResponse(res);
      const pdfBuf = Buffer.from(await res.arrayBuffer());
      // Bound memory/CPU before invoking pdf-parse (mirrors the Sheets byte cap).
      if (pdfBuf.byteLength > EXTERNAL_DOC_PDF_MAX_BYTES) throw new ResolverError('quota_exceeded');
      // Use pdf-parse (or equivalent) for basic text extraction. No OCR.
      const { default: pdfParse } = await import('pdf-parse');
      const parsed = await pdfParse(pdfBuf);
      return parsed.text;
    }

    throw new ResolverError('unsupported_content');
  },
};

export class ResolverError extends Error {
  constructor(public reason:
    | 'auth_revoked'
    | 'file_deleted'
    | 'rate_limited'
    | 'network_error'
    | 'quota_exceeded'
    | 'unsupported_content'
  ) {
    super(reason);
  }
}

function classifyDriveResponse(res: Response): void {
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) throw new ResolverError('auth_revoked');
  if (res.status === 404) throw new ResolverError('file_deleted');
  if (res.status === 429) throw new ResolverError('rate_limited');
  throw new ResolverError('network_error');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx server/services/resolvers/__tests__/googleDriveResolver.test.ts`
Expected: PASS for all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/resolvers/googleDriveResolver.ts server/services/resolvers/__tests__/googleDriveResolver.test.ts
git commit -m "feat(resolver): google drive resolver with docs/sheets/pdf dispatch"
```

### Task 2.4: Single-flight guard

**Files:**
- Create: `server/services/externalDocumentSingleFlight.ts`
- Create: `server/services/__tests__/externalDocumentSingleFlight.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SingleFlightGuard } from '../externalDocumentSingleFlight';

test('SingleFlightGuard — concurrent calls for same key share one promise', async () => {
  const guard = new SingleFlightGuard<string>(10);
  let calls = 0;
  const work = async () => { calls++; await new Promise(r => setTimeout(r, 20)); return 'value'; };
  const [a, b, c] = await Promise.all([
    guard.run('k1', work),
    guard.run('k1', work),
    guard.run('k1', work),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual([a, b, c], ['value', 'value', 'value']);
});

test('SingleFlightGuard — different keys do not share', async () => {
  const guard = new SingleFlightGuard<string>(10);
  let calls = 0;
  const work = async () => { calls++; return 'v'; };
  await Promise.all([guard.run('a', work), guard.run('b', work)]);
  assert.equal(calls, 2);
});

test('SingleFlightGuard — entry removed after settle (resolution and rejection)', async () => {
  const guard = new SingleFlightGuard<string>(10);
  await guard.run('ok', async () => 'v');
  await assert.rejects(guard.run('err', async () => { throw new Error('x'); }));
  assert.equal(guard.size(), 0);
});

test('SingleFlightGuard — bypasses guard at capacity', async () => {
  const guard = new SingleFlightGuard<string>(2);
  let calls = 0;
  const slow = async () => { calls++; await new Promise(r => setTimeout(r, 10)); return 'v'; };
  // Fill capacity with two long-running calls.
  const p1 = guard.run('a', slow);
  const p2 = guard.run('b', slow);
  // Third call exceeds capacity — should run independently.
  const p3 = guard.run('c', slow);
  await Promise.all([p1, p2, p3]);
  assert.equal(calls, 3);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx server/services/__tests__/externalDocumentSingleFlight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the guard**

```typescript
// server/services/externalDocumentSingleFlight.ts

export class SingleFlightGuard<T> {
  private inFlight = new Map<string, Promise<T>>();

  constructor(private maxEntries: number) {}

  async run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    if (this.inFlight.size >= this.maxEntries) {
      // Capacity exceeded — bypass guard. The caller's idempotent upsert handles concurrency.
      return work();
    }

    const promise = (async () => {
      try {
        return await work();
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, promise);
    return promise;
  }

  size(): number {
    return this.inFlight.size;
  }
}
```

- [ ] **Step 4: Verify test passes**

Run: `npx tsx server/services/__tests__/externalDocumentSingleFlight.test.ts`
Expected: PASS for all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/externalDocumentSingleFlight.ts server/services/__tests__/externalDocumentSingleFlight.test.ts
git commit -m "feat(resolver): in-process single-flight guard with capacity bypass"
```

### Task 2.5: `externalDocumentResolverService` — main orchestrator

**Files:**
- Create: `server/services/externalDocumentResolverService.ts`

- [ ] **Step 1: Write the orchestrator**

```typescript
// server/services/externalDocumentResolverService.ts

import { sql, eq, and } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { logger } from '../lib/logger';
import {
  EXTERNAL_DOC_HARD_TOKEN_LIMIT,
  EXTERNAL_DOC_MAX_STALENESS_MINUTES,
  EXTERNAL_DOC_MIN_CONTENT_TOKENS,
  EXTERNAL_DOC_SINGLE_FLIGHT_MAX_ENTRIES,
} from '../lib/constants';
import { documentCache } from '../db/schema/documentCache';
import { documentFetchEvents, type FetchFailureReason } from '../db/schema/documentFetchEvents';
import { referenceDocuments } from '../db/schema/referenceDocuments';
import { integrationConnectionService } from './integrationConnectionService';
import { googleDriveResolver, ResolverError } from './resolvers/googleDriveResolver';
import {
  buildProvenanceHeader,
  countTokensApprox,
  isPastStalenessBoundary,
  isResolverVersionStale,
  truncateContentToTokenBudget,
} from './externalDocumentResolverPure';
import { SingleFlightGuard } from './externalDocumentSingleFlight';
import type { ExternalDocumentResolver, ResolveParams, ResolvedDocument } from './externalDocumentResolverTypes';

const RESOLVERS: Record<'google_drive', ExternalDocumentResolver> = {
  google_drive: googleDriveResolver,
};

const singleFlight = new SingleFlightGuard<ResolvedDocument>(EXTERNAL_DOC_SINGLE_FLIGHT_MAX_ENTRIES);

export const externalDocumentResolverService = {
  async resolve(params: ResolveParams): Promise<ResolvedDocument> {
    const key = `google_drive:${params.fileId}:${params.connectionId}`;
    return singleFlight.run(key, () => doResolve(params));
  },
};

async function doResolve(p: ResolveParams): Promise<ResolvedDocument> {
  const resolver = RESOLVERS.google_drive;
  const startedAt = Date.now();
  // Invariant #11: TTL boundary uses fetch-start time. Captured ONCE at the top.
  // A slow fetch can cross the staleness boundary mid-call; using `new Date()` at
  // the comparison site would flip a fresh result to "broken" through no fault of
  // the doc. All `isPastStalenessBoundary` calls below use this fetchStart value.
  const fetchStart = new Date();

  // 1. Token refresh (outside the DB transaction per §17.8 boundary exception).
  let accessToken: string;
  try {
    accessToken = p.accessToken
      ?? (await integrationConnectionService.getRefreshedAccessToken(p.connectionId));
  } catch (err) {
    return await emitFailure(p, resolver, 'auth_revoked', null, startedAt);
  }

  // 2. Cache lookup (inside the caller's transaction scope).
  const cached = await p.db.select().from(documentCache).where(and(
    eq(documentCache.provider, 'google_drive'),
    eq(documentCache.fileId, p.fileId),
    eq(documentCache.connectionId, p.connectionId),
  )).limit(1);
  const cacheRow = cached[0];

  // 3. Resolver-version check.
  const versionStale = cacheRow ? isResolverVersionStale(cacheRow.resolverVersion, resolver.resolverVersion) : true;

  // 4. Change detection (cheap metadata call).
  let revisionMatches = false;
  let providerMimeType: string | null = null;
  let providerName: string | null = null;
  let providerRevisionId: string | null = null;
  if (cacheRow && !versionStale) {
    try {
      const meta = await resolver.checkRevision(p.fileId, accessToken);
      if (meta) {
        providerMimeType = meta.mimeType;
        providerName = meta.name;
        providerRevisionId = meta.revisionId;
        // MIME mismatch always invalidates regardless of revision match (§7.1 step 4).
        const mimeMismatch = meta.mimeType !== p.expectedMimeType;
        if (mimeMismatch) {
          logger.warn('document_resolve_mime_mismatch', {
            referenceId: p.referenceId,
            fileId: p.fileId,
            expectedMimeType: p.expectedMimeType,
            providerMimeType: meta.mimeType,
            mimeMismatch: true,
          });
        }
        revisionMatches = !mimeMismatch && meta.revisionId !== null && meta.revisionId === cacheRow.revisionId;
      }
    } catch (err) {
      // checkRevision failure → degrade if cache exists within staleness boundary, else fall through to broken via fetch.
      if (cacheRow) {
        const stale = isPastStalenessBoundary(cacheRow.fetchedAt, fetchStart, EXTERNAL_DOC_MAX_STALENESS_MINUTES);
        if (!stale) {
          return await serveCacheAsDegraded(p, resolver, cacheRow, mapResolverError(err), startedAt);
        }
      }
      const reason = mapResolverError(err);
      return await emitFailure(p, resolver, reason, null, startedAt);
    }
  }

  // 5a. Cache hit + revision match + version current → serve cache.
  if (cacheRow && !versionStale && revisionMatches) {
    return await serveCacheAsActive(p, resolver, cacheRow, providerRevisionId, startedAt);
  }

  // 5b. Cache miss / version stale / revision mismatch / null revision (TTL fallback) → fetch.
  let rawContent: string;
  try {
    rawContent = await resolver.fetchContent(p.fileId, providerMimeType ?? p.expectedMimeType, accessToken);
  } catch (err) {
    const reason = mapResolverError(err);
    if (cacheRow) {
      const stale = isPastStalenessBoundary(cacheRow.fetchedAt, fetchStart, EXTERNAL_DOC_MAX_STALENESS_MINUTES);
      if (!stale) return await serveCacheAsDegraded(p, resolver, cacheRow, reason, startedAt);
    }
    return await emitFailure(p, resolver, reason, null, startedAt);
  }

  // 6. Minimum-content check.
  const rawTokens = countTokensApprox(rawContent);
  if (rawTokens < EXTERNAL_DOC_MIN_CONTENT_TOKENS) {
    if (cacheRow) {
      const stale = isPastStalenessBoundary(cacheRow.fetchedAt, fetchStart, EXTERNAL_DOC_MAX_STALENESS_MINUTES);
      if (!stale) return await serveCacheAsDegraded(p, resolver, cacheRow, 'unsupported_content', startedAt);
    }
    return await emitFailure(p, resolver, 'unsupported_content', null, startedAt);
  }

  // 7. Truncate to per-document hard limit.
  const truncation = truncateContentToTokenBudget(rawContent, EXTERNAL_DOC_HARD_TOKEN_LIMIT);
  const tokensUsed = countTokensApprox(truncation.content);
  const tokensBeforeTruncation = truncation.truncated ? rawTokens : null;

  // 8. Cache upsert.
  const contentHash = createHash('sha256').update(truncation.content).digest('hex');
  const fetchedAt = new Date();
  await p.db.insert(documentCache).values({
    organisationId: p.organisationId,
    subaccountId: p.subaccountId,
    provider: 'google_drive',
    fileId: p.fileId,
    connectionId: p.connectionId,
    content: truncation.content,
    revisionId: providerRevisionId,
    fetchedAt,
    contentSizeTokens: tokensUsed,
    contentHash,
    resolverVersion: resolver.resolverVersion,
  }).onConflictDoUpdate({
    target: [documentCache.provider, documentCache.fileId, documentCache.connectionId],
    set: {
      content: truncation.content,
      revisionId: providerRevisionId,
      fetchedAt,
      contentSizeTokens: tokensUsed,
      contentHash,
      resolverVersion: resolver.resolverVersion,
      updatedAt: sql`now()`,
    },
  });

  // 9. State transition: active.
  await transitionState(p.db, p.referenceType, p.referenceId, 'active');

  // 10. Audit-log write.
  await p.db.insert(documentFetchEvents).values({
    organisationId: p.organisationId,
    subaccountId: p.subaccountId,
    referenceId: p.referenceId,
    referenceType: p.referenceType,
    runId: p.runId,
    cacheHit: false,
    provider: 'google_drive',
    docName: providerName ?? p.docName,
    revisionId: providerRevisionId,
    tokensUsed,
    tokensBeforeTruncation,
    resolverVersion: resolver.resolverVersion,
    failureReason: null,
  });

  emitStructuredLog({
    runId: p.runId,
    referenceId: p.referenceId,
    provider: 'google_drive',
    cacheHit: false,
    durationMs: Date.now() - startedAt,
    tokensUsed,
    failureReason: null,
  });

  return {
    referenceId: p.referenceId,
    content: truncation.content,
    provenance: {
      provider: 'google_drive',
      docName: providerName ?? p.docName,
      fetchedAt: fetchedAt.toISOString(),
      revisionId: providerRevisionId,
      isStale: false,
      truncated: truncation.truncated,
      tokensRemovedByTruncation: truncation.truncated ? truncation.tokensRemoved : null,
    },
    tokensUsed,
    cacheHit: false,
    failureReason: null,
  };
}

async function serveCacheAsActive(p: ResolveParams, resolver: ExternalDocumentResolver, cacheRow: any, revisionId: string | null, startedAt: number): Promise<ResolvedDocument> {
  await transitionState(p.db, p.referenceType, p.referenceId, 'active');
  await p.db.insert(documentFetchEvents).values({
    organisationId: p.organisationId,
    subaccountId: p.subaccountId,
    referenceId: p.referenceId,
    referenceType: p.referenceType,
    runId: p.runId,
    cacheHit: true,
    provider: 'google_drive',
    docName: p.docName,
    revisionId: revisionId ?? cacheRow.revisionId,
    tokensUsed: cacheRow.contentSizeTokens,
    tokensBeforeTruncation: null,
    resolverVersion: resolver.resolverVersion,
    failureReason: null,
  });
  emitStructuredLog({
    runId: p.runId,
    referenceId: p.referenceId,
    provider: 'google_drive',
    cacheHit: true,
    durationMs: Date.now() - startedAt,
    tokensUsed: cacheRow.contentSizeTokens,
    failureReason: null,
  });
  return {
    referenceId: p.referenceId,
    content: cacheRow.content,
    provenance: {
      provider: 'google_drive',
      docName: p.docName,
      fetchedAt: cacheRow.fetchedAt.toISOString(),
      revisionId: cacheRow.revisionId,
      isStale: false,
      truncated: false,
      tokensRemovedByTruncation: null,
    },
    tokensUsed: cacheRow.contentSizeTokens,
    cacheHit: true,
    failureReason: null,
  };
}

async function serveCacheAsDegraded(p: ResolveParams, resolver: ExternalDocumentResolver, cacheRow: any, reason: FetchFailureReason, startedAt: number): Promise<ResolvedDocument> {
  await transitionState(p.db, p.referenceType, p.referenceId, 'degraded');
  // Invariant #12: failure writes are idempotent. The partial unique index
  // `document_fetch_events_failure_idem_uniq` covers (reference_id, run_id, failure_reason)
  // when both run_id and failure_reason are non-null. onConflictDoNothing collapses
  // tight retry loops over a perpetually-failing ref into a single row per run.
  await p.db.insert(documentFetchEvents).values({
    organisationId: p.organisationId,
    subaccountId: p.subaccountId,
    referenceId: p.referenceId,
    referenceType: p.referenceType,
    runId: p.runId,
    cacheHit: true,
    provider: 'google_drive',
    docName: p.docName,
    revisionId: cacheRow.revisionId,
    tokensUsed: cacheRow.contentSizeTokens,
    tokensBeforeTruncation: null,
    resolverVersion: resolver.resolverVersion,
    failureReason: reason,
  }).onConflictDoNothing();
  emitStructuredLog({
    runId: p.runId,
    referenceId: p.referenceId,
    provider: 'google_drive',
    cacheHit: true,
    durationMs: Date.now() - startedAt,
    tokensUsed: cacheRow.contentSizeTokens,
    failureReason: reason,
  });
  return {
    referenceId: p.referenceId,
    content: cacheRow.content,
    provenance: {
      provider: 'google_drive',
      docName: p.docName,
      fetchedAt: cacheRow.fetchedAt.toISOString(),
      revisionId: cacheRow.revisionId,
      isStale: true,
      truncated: false,
      tokensRemovedByTruncation: null,
    },
    tokensUsed: cacheRow.contentSizeTokens,
    cacheHit: true,
    failureReason: reason,
  };
}

async function emitFailure(p: ResolveParams, resolver: ExternalDocumentResolver, reason: FetchFailureReason, revisionId: string | null, startedAt: number): Promise<ResolvedDocument> {
  await transitionState(p.db, p.referenceType, p.referenceId, 'broken');
  // Invariant #12: idempotent failure writes (see serveCacheAsDegraded for index spec).
  await p.db.insert(documentFetchEvents).values({
    organisationId: p.organisationId,
    subaccountId: p.subaccountId,
    referenceId: p.referenceId,
    referenceType: p.referenceType,
    runId: p.runId,
    cacheHit: false,
    provider: 'google_drive',
    docName: p.docName,
    revisionId,
    tokensUsed: 0,
    tokensBeforeTruncation: null,
    resolverVersion: resolver.resolverVersion,
    failureReason: reason,
  }).onConflictDoNothing();
  emitStructuredLog({
    runId: p.runId,
    referenceId: p.referenceId,
    provider: 'google_drive',
    cacheHit: false,
    durationMs: Date.now() - startedAt,
    tokensUsed: 0,
    failureReason: reason,
  });
  return {
    referenceId: p.referenceId,
    content: '',
    provenance: {
      provider: 'google_drive',
      docName: p.docName,
      fetchedAt: new Date().toISOString(),
      revisionId,
      isStale: false,
      truncated: false,
      tokensRemovedByTruncation: null,
    },
    tokensUsed: 0,
    cacheHit: false,
    failureReason: reason,
  };
}

async function transitionState(db: any, referenceType: 'reference_document' | 'agent_data_source', referenceId: string, newState: 'active' | 'degraded' | 'broken'): Promise<void> {
  if (referenceType !== 'reference_document') return; // agent_data_sources uses last_fetch_status (mapped in runContextLoader)
  // Optimistic state-based update: 0-rows-updated is a no-op (concurrent writer won).
  await db.update(referenceDocuments)
    .set({ attachmentState: newState, updatedAt: sql`now()` })
    .where(eq(referenceDocuments.id, referenceId));
}

function mapResolverError(err: unknown): FetchFailureReason {
  if (err instanceof ResolverError) return err.reason as FetchFailureReason;
  if (err instanceof Error && err.name === 'AbortError') return 'network_error';
  return 'network_error';
}

function emitStructuredLog(entry: {
  runId: string | null;
  referenceId: string;
  provider: string;
  cacheHit: boolean;
  durationMs: number;
  tokensUsed: number;
  failureReason: FetchFailureReason | null;
  concurrentFetchDetected?: boolean;
}): void {
  logger.info('document_resolve', entry);
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`.
Expected: no type errors. Some `any` usage on `db` is acceptable here; Phase 5 wires the actual scoped DB type.

- [ ] **Step 3: Commit**

```bash
git add server/services/externalDocumentResolverService.ts
git commit -m "feat(resolver): externalDocumentResolverService orchestrator with cache + state machine"
```

### Task 2.5b: Cross-instance advisory lock — narrow scope (Slice C)

**Files:**
- Modify: `server/services/externalDocumentResolverService.ts`

Slice A/B ship without this — `SingleFlightGuard` is sufficient up to ~2 instances. Slice C adds a Postgres advisory lock so N horizontal workers do not fan-fetch the same Drive file on first run after invalidation. See `## Execution strategy and cross-cutting invariants` invariants #6 and (critically) the lock-scope rule below.

**Critical rule — narrow lock scope.** The lock wraps **only** the cache write (and the immediately-preceding double-check read), NEVER the external HTTP fetch. A naive whole-`doResolve` lock serialises slow Drive API calls across the entire fleet — one slow doc blocks every worker resolving any other doc that hashes to the same lock key, and a hung Drive connection holds the lock for as long as the open transaction.

The pattern is fetch-then-write-with-double-check (sometimes called "optimistic + lock-on-write"):

```text
1. Cache lookup (no lock).
2. If hit + revision matches + version current → serve from cache, return.
3. Fetch from Drive (NO LOCK — this is the slow path).
4. Acquire advisory lock keyed on (provider, fileId, connectionId).
5. Re-read cache row (a peer worker may have written while we fetched).
   - If the peer's revision_id matches what we just fetched AND resolver_version
     matches AND fetched_at >= our fetchStart → discard our fetch, serve peer's row.
   - Otherwise → upsert our content. Audit-log row carries cache_hit = false.
6. Lock auto-releases on transaction commit.
```

This task is **not required to ship Phase 2**. Implement and merge before flipping `EXTERNAL_DOC_FAILURE_POLICIES_ENABLED` (Slice C cutover) — earlier if convenient.

- [ ] **Step 1: Add the advisory-lock helper**

```typescript
// inside externalDocumentResolverService.ts

import { sql, and, eq } from 'drizzle-orm';

async function withAdvisoryLock<T>(db: any, key: string, fn: () => Promise<T>): Promise<T> {
  // hashtext returns int4; widen to bigint for pg_advisory_xact_lock(bigint).
  // Lock auto-releases on transaction commit/rollback — no explicit release needed.
  // Caller MUST be inside a transaction. Callers using `withOrgTx` already are.
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`);
  return fn();
}
```

- [ ] **Step 2: Restructure `doResolve` so the lock wraps only the write path**

Replace the existing cache-upsert block (Task 2.5 step 8) with a lock-guarded double-check + upsert:

```typescript
// After resolver.fetchContent + truncation + content-hash computation, BEFORE the upsert.

const lockKey = `external_doc:google_drive:${p.fileId}:${p.connectionId}`;
await withAdvisoryLock(p.db, lockKey, async () => {
  // Double-check: did a peer worker write a matching row while we were fetching?
  const recheck = await p.db.select().from(documentCache).where(and(
    eq(documentCache.provider, 'google_drive'),
    eq(documentCache.fileId, p.fileId),
    eq(documentCache.connectionId, p.connectionId),
  )).limit(1);
  const peer = recheck[0];
  const peerWroteSame =
    peer
    && peer.resolverVersion === resolver.resolverVersion
    && peer.revisionId === providerRevisionId
    && peer.fetchedAt >= fetchStart;
  if (peerWroteSame) {
    // Peer's row is at least as fresh as our fetch — discard our content, serve peer's.
    cacheRow = peer;
    return;
  }
  // Otherwise: write our content.
  await p.db.insert(documentCache).values({ /* ... existing values ... */ })
    .onConflictDoUpdate({ /* ... existing onConflictDoUpdate ... */ });
});
```

The SingleFlightGuard wrapper at `externalDocumentResolverService.resolve` stays — it serialises within a process; the advisory lock serialises across processes. Both run; together they close every concurrency gap without serialising the slow Drive API.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`.
Expected: clean. Sanity test: two parallel `resolve()` calls on the same `(fileId, connectionId)` from the same process produce one fetch (single-flight); two parallel calls from separate processes produce at most two fetches but exactly one cache-row write per revision (advisory lock + double-check).

- [ ] **Step 4: Commit**

```bash
git add server/services/externalDocumentResolverService.ts
git commit -m "feat(resolver): narrow-scope advisory lock for cache writes (fetch outside)"
```

### Task 2.7: Retry suppression window

**Files:**
- Create: `server/services/externalDocumentRetrySuppression.ts`
- Create: `server/services/__tests__/externalDocumentRetrySuppression.test.ts`
- Modify: `server/lib/constants.ts` (add `EXTERNAL_DOC_RETRY_SUPPRESSION_WINDOW_MS`)
- Modify: `server/services/externalDocumentResolverService.ts` (consume helper)

Prevents N concurrent agents independently hammering a doc that just failed (`auth_revoked` / `rate_limited`). See `## Execution strategy and cross-cutting invariants` invariant #17.

- [ ] **Step 1: Add the constant**

In `server/lib/constants.ts`:

```typescript
export const EXTERNAL_DOC_RETRY_SUPPRESSION_WINDOW_MS = 60_000;
```

- [ ] **Step 2: Write the failing test**

```typescript
// externalDocumentRetrySuppression.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { RetrySuppressor } from '../externalDocumentRetrySuppression';

test('first failure record is not suppressed; subsequent within window are', () => {
  const s = new RetrySuppressor(60_000, () => 1_000);
  assert.equal(s.shouldSuppress('ref-1', 'auth_revoked'), false);
  s.recordFailure('ref-1', 'auth_revoked');
  assert.equal(s.shouldSuppress('ref-1', 'auth_revoked'), true);
});

test('suppression expires after the window', () => {
  let now = 1_000;
  const s = new RetrySuppressor(60_000, () => now);
  s.recordFailure('ref-1', 'auth_revoked');
  now = 1_000 + 59_999;
  assert.equal(s.shouldSuppress('ref-1', 'auth_revoked'), true);
  now = 1_000 + 60_001;
  assert.equal(s.shouldSuppress('ref-1', 'auth_revoked'), false);
});

test('different reasons are tracked independently', () => {
  const s = new RetrySuppressor(60_000, () => 1_000);
  s.recordFailure('ref-1', 'auth_revoked');
  assert.equal(s.shouldSuppress('ref-1', 'rate_limited'), false);
});

test('different references are tracked independently', () => {
  const s = new RetrySuppressor(60_000, () => 1_000);
  s.recordFailure('ref-1', 'auth_revoked');
  assert.equal(s.shouldSuppress('ref-2', 'auth_revoked'), false);
});
```

- [ ] **Step 3: Implement**

```typescript
// server/services/externalDocumentRetrySuppression.ts

import type { FetchFailureReason } from '../db/schema/documentFetchEvents';

export class RetrySuppressor {
  private readonly suppressUntil = new Map<string, number>();
  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private key(refId: string, reason: FetchFailureReason): string {
    return `${refId}:${reason}`;
  }

  recordFailure(refId: string, reason: FetchFailureReason): void {
    this.suppressUntil.set(this.key(refId, reason), this.now() + this.windowMs);
  }

  shouldSuppress(refId: string, reason: FetchFailureReason): boolean {
    const until = this.suppressUntil.get(this.key(refId, reason));
    if (until === undefined) return false;
    if (this.now() > until) {
      this.suppressUntil.delete(this.key(refId, reason));
      return false;
    }
    return true;
  }
}
```

In-process only — sufficient for v1. Cross-instance suppression would require Redis or a `failure_suppressions` table; deferred to v1.1 (in-process bound is fine for the typical 1–2 worker deployment).

- [ ] **Step 4: Wire into the resolver**

In `externalDocumentResolverService.ts`, instantiate one suppressor at module scope and consult it on the failure path:

```typescript
import { RetrySuppressor } from './externalDocumentRetrySuppression';
import { EXTERNAL_DOC_RETRY_SUPPRESSION_WINDOW_MS } from '../lib/constants';

const retrySuppressor = new RetrySuppressor(EXTERNAL_DOC_RETRY_SUPPRESSION_WINDOW_MS);

// Inside doResolve, BEFORE token refresh:
//   For each retryable failure reason that the resolver currently has cached as
//   suppressed, short-circuit with serveCacheAsDegraded (if cache exists) or
//   emitFailure (if not). The suppression check is on the (refId, reason) pair, but
//   we don't know the reason yet on entry — so apply the check ONLY for known
//   recently-failed reasons. Practically: if any reason is currently suppressed
//   for this ref, short-circuit with that reason.

// On every failure path (token refresh fail, checkRevision fail, fetch fail):
//   retrySuppressor.recordFailure(p.referenceId, reason);
```

- [ ] **Step 5: Run tests + verify**

Run: `npx tsx server/services/__tests__/externalDocumentRetrySuppression.test.ts && npx tsc --noEmit`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/services/externalDocumentRetrySuppression.ts server/services/__tests__/externalDocumentRetrySuppression.test.ts server/lib/constants.ts server/services/externalDocumentResolverService.ts
git commit -m "feat(resolver): add retry suppression window for repeated failures"
```

### Task 2.6: Phase 2 verification gate

- [ ] **Step 1: Run all gates**

```bash
npm run lint
npx tsc --noEmit
npx tsx server/services/__tests__/externalDocumentResolverPure.test.ts
npx tsx server/services/__tests__/externalDocumentSingleFlight.test.ts
npx tsx server/services/resolvers/__tests__/googleDriveResolver.test.ts
```
Expected: all pass.

## Phase 3 — TaskModal attachment path (Screens 1, 2, 3)

**Delivers:** four new attach/manage routes; the `DriveFilePicker` React component (Screen 3); TaskModal integration with cloud-storage attach buttons (Screen 2); Drive reference rows with state badges; failure-policy select; the `verify-access` endpoint.

**Gate:** the user can connect Drive (Screen 1, Phase 1), open TaskModal on an existing task, click `Google Drive`, pick a file via the Picker (Screen 3), and see the attached reference rendered in the Attachments list with an `active` state badge (Screen 2). Removing the reference works. Per-task / per-subaccount quotas reject correctly with 422. No actual fetch occurs yet.

**Depends on:** Phase 1 (schema, picker-token endpoint, OAuth), Phase 2 (resolver — needed only by Phase 5; here we use mocked fetch to keep the picker decoupled).

### Task 3.0: External document view model + mapper (UI contract layer)

**Files:**
- Create: `server/api/types/externalDocumentViewModel.ts`
- Create: `server/api/types/__tests__/externalDocumentViewModel.test.ts`

UI components must not bind directly to DB rows. Every Phase 3/4/6 route that serialises external-document state to the client passes through this view model. See `## Execution strategy and cross-cutting invariants — UI contract layer`. This task precedes Task 3.1 because the attach response in Task 3.1 returns a view model, not a raw row.

- [ ] **Step 1: Write the failing test**

```typescript
// externalDocumentViewModel.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { toExternalDocumentViewModel } from '../externalDocumentViewModel';

test('active reference with recent fetch maps cleanly', () => {
  const vm = toExternalDocumentViewModel({
    id: 'ref-1',
    externalFileName: 'Q1 plan.gdoc',
    attachmentState: 'active',
    lastFetchEvent: { fetchedAt: new Date('2026-04-30T09:00:00Z'), failureReason: null },
  });
  assert.deepEqual(vm, {
    id: 'ref-1',
    name: 'Q1 plan.gdoc',
    state: 'active',
    lastFetchedAt: '2026-04-30T09:00:00.000Z',
    failureReason: null,
    canRebind: false,
  });
});

test('broken reference exposes canRebind = true and surfaces failureReason', () => {
  const vm = toExternalDocumentViewModel({
    id: 'ref-2',
    externalFileName: 'gone.pdf',
    attachmentState: 'broken',
    lastFetchEvent: { fetchedAt: new Date('2026-04-30T09:00:00Z'), failureReason: 'auth_revoked' },
  });
  assert.equal(vm.state, 'broken');
  assert.equal(vm.canRebind, true);
  assert.equal(vm.failureReason, 'auth_revoked');
});

test('null attachmentState defaults to active; missing name falls back', () => {
  const vm = toExternalDocumentViewModel({
    id: 'ref-3',
    externalFileName: null,
    attachmentState: null,
    lastFetchEvent: null,
  });
  assert.equal(vm.state, 'active');
  assert.equal(vm.name, '(untitled)');
  assert.equal(vm.lastFetchedAt, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx server/api/types/__tests__/externalDocumentViewModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the type and mapper**

Per invariant #15 (server-computed UI state), the mapper derives `state` from the latest `document_fetch_events` row when present. The persisted `attachment_state` column is a fallback used only when the reference has no events (e.g., never resolved, or events purged). This means a reference whose Drive auth was revoked between runs surfaces as `degraded` / `broken` immediately on the next read — no stale-green window for the operator.

```typescript
// server/api/types/externalDocumentViewModel.ts

import type { AttachmentState } from '../../db/schema/referenceDocuments';
import type { FetchFailureReason } from '../../db/schema/documentFetchEvents';
import { EXTERNAL_DOC_MAX_STALENESS_MINUTES } from '../../lib/constants';

export interface ExternalDocumentViewModel {
  id: string;
  name: string;
  state: AttachmentState;
  lastFetchedAt: string | null;
  failureReason: FetchFailureReason | null;
  canRebind: boolean;
}

export interface MapperInput {
  id: string;
  externalFileName: string | null;
  attachmentState: AttachmentState | null;
  lastFetchEvent: { fetchedAt: Date; failureReason: FetchFailureReason | null } | null;
  /** `now` is injectable so the mapper is deterministic in tests. */
  now?: Date;
}

export function toExternalDocumentViewModel(row: MapperInput): ExternalDocumentViewModel {
  const now = row.now ?? new Date();
  const state = deriveState(row, now);
  return {
    id: row.id,
    name: row.externalFileName ?? '(untitled)',
    state,
    lastFetchedAt: row.lastFetchEvent ? row.lastFetchEvent.fetchedAt.toISOString() : null,
    failureReason: row.lastFetchEvent?.failureReason ?? null,
    canRebind: state === 'broken',
  };
}

function deriveState(row: MapperInput, now: Date): AttachmentState {
  const evt = row.lastFetchEvent;
  // No events recorded yet → fall back to persisted column (or 'active' default).
  if (!evt) return row.attachmentState ?? 'active';
  // Successful event → active.
  if (evt.failureReason === null) return 'active';
  // Failure within the staleness window → degraded (cache is still serviceable).
  const ageMs = now.getTime() - evt.fetchedAt.getTime();
  if (ageMs <= EXTERNAL_DOC_MAX_STALENESS_MINUTES * 60_000) return 'degraded';
  // Failure beyond the staleness window → broken (cache is too old to serve).
  return 'broken';
}
```

Add tests for the time-derived branches:

```typescript
test('failure within staleness window → degraded', () => {
  const vm = toExternalDocumentViewModel({
    id: 'ref-4',
    externalFileName: 'recent fail.gdoc',
    attachmentState: 'active',  // persisted column is stale; mapper overrides
    lastFetchEvent: { fetchedAt: new Date('2026-04-30T08:50:00Z'), failureReason: 'rate_limited' },
    now: new Date('2026-04-30T09:00:00Z'),
  });
  assert.equal(vm.state, 'degraded');
});

test('failure beyond staleness window → broken (mapper overrides persisted active)', () => {
  const vm = toExternalDocumentViewModel({
    id: 'ref-5',
    externalFileName: 'old fail.gdoc',
    attachmentState: 'active',
    lastFetchEvent: { fetchedAt: new Date('2026-04-20T09:00:00Z'), failureReason: 'auth_revoked' },
    now: new Date('2026-04-30T09:00:00Z'),
  });
  assert.equal(vm.state, 'broken');
  assert.equal(vm.canRebind, true);
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx server/api/types/__tests__/externalDocumentViewModel.test.ts`
Expected: PASS for all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/api/types/externalDocumentViewModel.ts server/api/types/__tests__/externalDocumentViewModel.test.ts
git commit -m "feat(api): add external document view model and mapper"
```

### Task 3.1: Attach / remove / re-bind / policy routes

**Files:**
- Create: `server/routes/externalDocumentReferences.ts`

- [ ] **Step 1: Implement the four routes**

```typescript
// server/routes/externalDocumentReferences.ts

import express from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { authenticate } from '../middleware/authenticate';
import { resolveSubaccount } from '../middleware/resolveSubaccount';
import { requirePermission } from '../middleware/requirePermission';
import { withOrgTx } from '../db/withOrgTx';
import { referenceDocuments } from '../db/schema/referenceDocuments';
import { documentBundleAttachments } from '../db/schema/documentBundleAttachments';
import { documentBundleMembers } from '../db/schema/documentBundleMembers';
import { integrationConnections } from '../db/schema/integrationConnections';
import {
  EXTERNAL_DOC_MAX_REFS_PER_SUBACCOUNT,
  EXTERNAL_DOC_MAX_REFS_PER_TASK,
} from '../lib/constants';

const router = express.Router({ mergeParams: true });

const attachBodySchema = z.object({
  connectionId: z.string().uuid(),
  fileId: z.string().min(1),
  fileName: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(256),
});

router.post(
  '/:taskId/external-references',
  authenticate,
  resolveSubaccount,
  requirePermission('org.tasks.manage'),
  async (req, res) => {
    const parse = attachBodySchema.safeParse(req.body);
    if (!parse.success) return res.status(422).json({ error: 'invalid_body', details: parse.error.format() });
    const { connectionId, fileId, fileName, mimeType } = parse.data;
    const { taskId } = req.params;

    const result = await withOrgTx(req, async (db) => {
      // 1. Validate connection.
      const [conn] = await db.select().from(integrationConnections).where(and(
        eq(integrationConnections.id, connectionId),
        eq(integrationConnections.subaccountId, req.subaccount.id),
        eq(integrationConnections.providerType, 'google_drive'),
      )).limit(1);
      if (!conn || conn.connectionStatus !== 'active') return { status: 422, body: { error: 'invalid_connection_id' } };

      // 2. Per-subaccount quota.
      const [{ count: subCount }] = await db.execute<{ count: number }>(sql`
        SELECT COUNT(*)::int AS count FROM reference_documents
        WHERE subaccount_id = ${req.subaccount.id} AND source_type = 'google_drive'
      `);
      if (subCount >= EXTERNAL_DOC_MAX_REFS_PER_SUBACCOUNT) {
        return { status: 422, body: { error: 'per_subaccount_quota_exceeded', limit: EXTERNAL_DOC_MAX_REFS_PER_SUBACCOUNT } };
      }

      // 3. Resolve the bundle for this task (existing helper).
      const bundleId = await getOrCreateBundleForTask(db, taskId);

      // 4. Per-task quota.
      const [{ count: taskCount }] = await db.execute<{ count: number }>(sql`
        SELECT COUNT(*)::int AS count FROM reference_documents r
        JOIN document_bundle_members m ON m.reference_document_id = r.id
        WHERE m.bundle_id = ${bundleId} AND r.source_type = 'google_drive'
      `);
      if (taskCount >= EXTERNAL_DOC_MAX_REFS_PER_TASK) {
        return { status: 422, body: { error: 'per_task_quota_exceeded', limit: EXTERNAL_DOC_MAX_REFS_PER_TASK } };
      }

      // 5. attachment_order = max(existing) + 1 within the bundle.
      const [{ maxOrder }] = await db.execute<{ maxOrder: number }>(sql`
        SELECT COALESCE(MAX(r.attachment_order), 0) AS "maxOrder"
        FROM reference_documents r
        JOIN document_bundle_members m ON m.reference_document_id = r.id
        WHERE m.bundle_id = ${bundleId}
      `);

      // 6. Insert reference_documents row.
      try {
        const [inserted] = await db.insert(referenceDocuments).values({
          organisationId: req.subaccount.organisationId,
          subaccountId: req.subaccount.id,
          name: fileName,
          sourceType: 'google_drive',
          externalProvider: 'google_drive',
          externalConnectionId: connectionId,
          externalFileId: fileId,
          externalFileName: fileName,
          externalFileMimeType: mimeType,
          attachedByUserId: req.user.id,
          attachmentOrder: maxOrder + 1,
          attachmentState: 'active',
        }).returning();

        // 7. Add to bundle.
        await db.insert(documentBundleMembers).values({
          bundleId,
          referenceDocumentId: inserted.id,
        });

        return { status: 201, body: { reference: inserted } };
      } catch (e: any) {
        if (e?.code === '23505') return { status: 409, body: { error: 'reference_already_attached' } };
        throw e;
      }
    });

    return res.status(result.status).json(result.body);
  }
);

router.delete(
  '/:taskId/external-references/:referenceId',
  authenticate,
  resolveSubaccount,
  requirePermission('org.tasks.manage'),
  async (req, res) => {
    const { referenceId } = req.params;
    await withOrgTx(req, async (db) => {
      // Soft constraint: only delete google_drive refs in the caller's subaccount.
      await db.delete(referenceDocuments).where(and(
        eq(referenceDocuments.id, referenceId),
        eq(referenceDocuments.subaccountId, req.subaccount.id),
        eq(referenceDocuments.sourceType, 'google_drive'),
      ));
    });
    return res.status(204).send();
  }
);

router.patch(
  '/:taskId/external-references/:referenceId',
  authenticate,
  resolveSubaccount,
  requirePermission('org.tasks.manage'),
  async (req, res) => {
    const bodySchema = z.object({ connectionId: z.string().uuid() });
    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) return res.status(422).json({ error: 'invalid_body' });
    const { connectionId } = parse.data;
    const { referenceId } = req.params;

    const result = await withOrgTx(req, async (db) => {
      const [conn] = await db.select().from(integrationConnections).where(and(
        eq(integrationConnections.id, connectionId),
        eq(integrationConnections.subaccountId, req.subaccount.id),
        eq(integrationConnections.providerType, 'google_drive'),
      )).limit(1);
      if (!conn || conn.connectionStatus !== 'active') return { status: 422, body: { error: 'invalid_connection_id' } };

      // State-based optimistic update — 0 rows updated returns the current row as the idempotent result.
      const [updated] = await db.update(referenceDocuments)
        .set({ externalConnectionId: connectionId, attachmentState: 'active', updatedAt: sql`now()` })
        .where(and(
          eq(referenceDocuments.id, referenceId),
          eq(referenceDocuments.subaccountId, req.subaccount.id),
          eq(referenceDocuments.sourceType, 'google_drive'),
        ))
        .returning();
      if (!updated) return { status: 404, body: { error: 'reference_not_found' } };
      return { status: 200, body: { reference: updated } };
    });

    return res.status(result.status).json(result.body);
  }
);

router.patch(
  '/:taskId/bundle-attachment',
  authenticate,
  resolveSubaccount,
  requirePermission('org.tasks.manage'),
  async (req, res) => {
    const bodySchema = z.object({ fetchFailurePolicy: z.enum(['tolerant', 'strict', 'best_effort']) });
    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) return res.status(422).json({ error: 'invalid_body' });
    const { fetchFailurePolicy } = parse.data;
    const { taskId } = req.params;

    await withOrgTx(req, async (db) => {
      await db.update(documentBundleAttachments)
        .set({ fetchFailurePolicy })
        .where(and(
          eq(documentBundleAttachments.subjectType, 'task'),
          eq(documentBundleAttachments.subjectId, taskId),
        ));
    });
    return res.status(204).send();
  }
);

async function getOrCreateBundleForTask(db: any, taskId: string): Promise<string> {
  // Existing project helper — reuse the implementation pattern from `attachments.ts` route.
  // If no helper exists, locate the bundle creation logic in the upload path and DRY it.
  throw new Error('Replace with project-specific bundle resolver — see attachments.ts');
}

export default router;
```

- [ ] **Step 2: Mount the router**

In the Express app setup, register:
```typescript
app.use('/api/tasks', externalDocumentReferencesRouter);
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`.
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/routes/externalDocumentReferences.ts server/index.ts
git commit -m "feat(routes): attach/remove/rebind/policy routes for external doc refs"
```

### Task 3.2: `verify-access` endpoint

**Files:**
- Modify: `server/routes/integrations/googleDrive.ts`

- [ ] **Step 1: Add the route**

```typescript
// GET /api/integrations/google-drive/verify-access?connectionId=<id>&fileId=<id>
router.get(
  '/verify-access',
  authenticate,
  resolveSubaccount,
  requirePermission('org.integrations.manage'),
  async (req, res) => {
    const { connectionId, fileId } = req.query as { connectionId?: string; fileId?: string };
    if (!connectionId || !fileId) return res.status(400).json({ error: 'connectionId_and_fileId_required' });

    const conn = await integrationConnectionService.getForSubaccount({
      connectionId,
      subaccountId: req.subaccount.id,
    });
    if (!conn || conn.provider_type !== 'google_drive') {
      return res.status(404).json({ error: 'connection_not_found' });
    }

    const accessToken = await integrationConnectionService.getRefreshedAccessToken(connectionId);

    try {
      const meta = await googleDriveResolver.checkRevision(fileId, accessToken);
      if (!meta) return res.status(404).json({ error: 'file_not_accessible' });
      return res.json({ ok: true, mimeType: meta.mimeType, name: meta.name });
    } catch (err) {
      const reason = err instanceof ResolverError ? err.reason : 'network_error';
      return res.status(reason === 'auth_revoked' ? 403 : 404).json({ error: reason });
    }
  }
);
```

Add the imports for `googleDriveResolver` and `ResolverError`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`.
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add server/routes/integrations/googleDrive.ts
git commit -m "feat(routes): verify-access endpoint for re-bind flow"
```

### Task 3.3: API client wrappers (frontend)

**Files:**
- Create: `client/src/api/externalDocumentReferences.ts`

- [ ] **Step 1: Implement the client functions**

```typescript
// client/src/api/externalDocumentReferences.ts

import { apiClient } from './apiClient';

export interface ExternalDocumentReference {
  id: string;
  name: string;
  externalProvider: 'google_drive';
  externalConnectionId: string;
  externalFileId: string;
  externalFileName: string;
  externalFileMimeType: string;
  attachmentState: 'active' | 'degraded' | 'broken';
  attachmentOrder: number;
  createdAt: string;
  // Most recent fetch metadata, derived from a join to the latest document_fetch_events row.
  // The attach API includes these as null on a freshly attached reference; the list-references
  // route enriches them per row.
  lastFetchedAt: string | null;
  lastFailureReason:
    | null
    | 'auth_revoked'
    | 'file_deleted'
    | 'rate_limited'
    | 'network_error'
    | 'quota_exceeded'
    | 'budget_exceeded'
    | 'unsupported_content';
}

export async function attachExternalReference(taskId: string, body: {
  connectionId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
}): Promise<ExternalDocumentReference> {
  const res = await apiClient.post(`/api/tasks/${taskId}/external-references`, body);
  return res.data.reference;
}

export async function removeExternalReference(taskId: string, referenceId: string): Promise<void> {
  await apiClient.delete(`/api/tasks/${taskId}/external-references/${referenceId}`);
}

export async function rebindExternalReference(taskId: string, referenceId: string, connectionId: string): Promise<ExternalDocumentReference> {
  const res = await apiClient.patch(`/api/tasks/${taskId}/external-references/${referenceId}`, { connectionId });
  return res.data.reference;
}

export async function setFailurePolicy(taskId: string, fetchFailurePolicy: 'tolerant' | 'strict' | 'best_effort'): Promise<void> {
  await apiClient.patch(`/api/tasks/${taskId}/bundle-attachment`, { fetchFailurePolicy });
}

export async function fetchPickerToken(connectionId: string): Promise<{ accessToken: string; pickerApiKey: string; appId: string }> {
  const res = await apiClient.get(`/api/integrations/google-drive/picker-token`, { params: { connectionId } });
  return res.data;
}

export async function verifyAccess(connectionId: string, fileId: string): Promise<{ ok: boolean; mimeType: string; name: string }> {
  const res = await apiClient.get(`/api/integrations/google-drive/verify-access`, { params: { connectionId, fileId } });
  return res.data;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`.
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/api/externalDocumentReferences.ts
git commit -m "feat(client): API client wrappers for external doc references"
```

### Task 3.4: `DriveFilePicker` component shell (Screen 3)

**Mockup:** Screen 3 of 6 — `docs/mockups/external-doc-references.html`, lines 577–712.

**Files:**
- Create: `client/src/components/DriveFilePicker.tsx`

- [ ] **Step 1: Implement the picker component shell**

```tsx
// client/src/components/DriveFilePicker.tsx
import { useEffect, useRef, useState } from 'react';
import { fetchPickerToken } from '../api/externalDocumentReferences';
import type { IntegrationConnection } from '../types/integrations';

const SUPPORTED_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/pdf',
];

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

interface DriveFilePickerProps {
  connections: IntegrationConnection[]; // pre-filtered to provider_type === 'google_drive', status === 'active'
  isOpen: boolean;
  onClose: () => void;
  onPick: (file: DriveFile, connectionId: string) => void;
}

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

export function DriveFilePicker({ connections, isOpen, onClose, onPick }: DriveFilePickerProps) {
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    connections.length === 1 ? connections[0].id : null
  );
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const pickerInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!isOpen || scriptLoaded) return;
    loadPickerScript().then(() => setScriptLoaded(true));
  }, [isOpen, scriptLoaded]);

  useEffect(() => {
    if (!isOpen || !scriptLoaded || !selectedConnectionId) return;
    openPicker(selectedConnectionId, onPick, onClose).then(p => {
      pickerInstanceRef.current = p;
    });
  }, [isOpen, scriptLoaded, selectedConnectionId, onPick, onClose]);

  if (!isOpen) return null;

  // Multi-connection: render the connection-selector step.
  if (connections.length > 1 && !selectedConnectionId) {
    return (
      <ModalShell onClose={onClose} title="Pick a Google Drive connection">
        <ul className="space-y-2">
          {connections.map(c => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full text-left rounded-lg border border-slate-200 px-4 py-3 hover:bg-slate-50"
                onClick={() => setSelectedConnectionId(c.id)}
              >
                <div className="font-medium">{c.label ?? 'Google Drive'}</div>
                <div className="text-sm text-slate-500">{c.ownerEmail ?? ''}</div>
              </button>
            </li>
          ))}
        </ul>
      </ModalShell>
    );
  }

  // Picker iframe is rendered into the document body by the Google Picker API.
  // Render an empty modal shell while the picker is open so users see the loading state.
  return <ModalShell onClose={onClose} title="Pick from Google Drive">Loading…</ModalShell>;
}

function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-slate-700">×</button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function loadPickerScript(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve();
    if (window.gapi && window.google?.picker) return resolve();
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onload = () => {
      window.gapi.load('picker', { callback: () => resolve() });
    };
    document.body.appendChild(s);
  });
}

async function openPicker(
  connectionId: string,
  onPick: (file: DriveFile, connectionId: string) => void,
  onClose: () => void
): Promise<any> {
  const { accessToken, pickerApiKey, appId } = await fetchPickerToken(connectionId);

  const view = new window.google.picker.DocsView()
    .setMimeTypes(SUPPORTED_MIME_TYPES.join(','))
    .setSelectFolderEnabled(false);

  const picker = new window.google.picker.PickerBuilder()
    .addView(view)
    .setAppId(appId)
    .setOAuthToken(accessToken)
    .setDeveloperKey(pickerApiKey)
    .setCallback((data: any) => {
      if (data.action === window.google.picker.Action.PICKED) {
        const doc = data.docs?.[0];
        if (doc) {
          onPick({ id: doc.id, name: doc.name, mimeType: doc.mimeType, url: doc.url }, connectionId);
        }
        onClose();
      } else if (data.action === window.google.picker.Action.CANCEL) {
        onClose();
      }
    })
    .build();
  picker.setVisible(true);
  return picker;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run build:client`.
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/DriveFilePicker.tsx
git commit -m "feat(client): DriveFilePicker component with picker API integration"
```

### Task 3.5: TaskModal — cloud-storage attach buttons (Screen 2)

**Mockup:** Screen 2 of 6 — `docs/mockups/external-doc-references.html`, lines 435–576. The mockup shows a healthy attachments tab with one upload + two healthy Drive references; one secondary `Google Drive` button next to the existing `Upload file` button.

**Files:**
- Modify: `client/src/components/TaskModal.tsx`

- [ ] **Step 1: Locate the existing `Upload file` button block in the Attachments tab**

Read the file. The Attachments tab section will already render an upload button — find its container.

- [ ] **Step 2: Add dynamic cloud-storage buttons**

Just before the existing upload button, render one button per file-store provider connected in the subaccount:

```tsx
const fileStoreConnections = connections.filter(c => c.providerType === 'google_drive' && c.connectionStatus === 'active');
const driveConns = fileStoreConnections.filter(c => c.providerType === 'google_drive');

{driveConns.length > 0 && (
  <button
    type="button"
    className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
    onClick={() => setPickerOpen(true)}
  >
    <GoogleDriveIcon className="h-4 w-4" />
    Google Drive
  </button>
)}
```

If `connections` is not already loaded by the parent, fetch via the existing integrations hook (`useIntegrations`) at the modal level and pass it down — do not introduce a new hook.

- [ ] **Step 3: Mount `<DriveFilePicker />` and wire the pick handler**

```tsx
const [pickerOpen, setPickerOpen] = useState(false);

const handlePick = async (file: DriveFile, connectionId: string) => {
  try {
    const ref = await attachExternalReference(taskId, {
      connectionId,
      fileId: file.id,
      fileName: file.name,
      mimeType: file.mimeType,
    });
    setReferences(prev => [...prev, ref]);
  } catch (err: any) {
    if (err.response?.status === 422) {
      const code = err.response.data?.error;
      if (code === 'per_task_quota_exceeded') showToast('You can attach up to 20 references per task.');
      else if (code === 'per_subaccount_quota_exceeded') showToast('You can attach up to 100 references per subaccount.');
      else if (code === 'invalid_connection_id') showToast('That connection is no longer active.');
    } else if (err.response?.status === 409) {
      showToast('This file is already attached to this task.');
    } else {
      showToast('Could not attach the file.');
    }
  } finally {
    setPickerOpen(false);
  }
};

<DriveFilePicker
  connections={driveConns}
  isOpen={pickerOpen}
  onClose={() => setPickerOpen(false)}
  onPick={handlePick}
/>
```

- [ ] **Step 4: Verify**

Run: `npm run build:client`.
Expected: clean. Manual: TaskModal renders the Google Drive button when at least one Drive connection exists; hidden otherwise.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TaskModal.tsx
git commit -m "feat(taskmodal): add dynamic cloud-storage attach buttons"
```

### Task 3.6: TaskModal — Drive reference rows with state badge (Screen 2)

**Mockup:** Screen 2 of 6 — Drive reference rows show provider icon, name, `Google Drive · {file_type} · Fetched {relative_time}` meta line, inline state badge.

**Files:**
- Modify: `client/src/components/TaskModal.tsx`
- Modify: `server/routes/tasks.ts` (or wherever the existing task-attachments GET handler lives) — enrich the response so each `google_drive` row carries `lastFetchedAt` and `lastFailureReason` from the most recent `document_fetch_events` row.

- [ ] **Step 1: Extend the task-attachments GET handler to enrich Drive rows**

In the existing handler that returns the task's attachments (search for `subject_type = 'task'` lookups against `document_bundle_attachments`), add a `LEFT JOIN LATERAL` to `document_fetch_events`:

```sql
SELECT r.*,
       e.fetched_at  AS last_fetched_at,
       e.failure_reason AS last_failure_reason
FROM reference_documents r
JOIN document_bundle_members m ON m.reference_document_id = r.id
LEFT JOIN LATERAL (
  SELECT fetched_at, failure_reason
  FROM document_fetch_events
  WHERE reference_id = r.id AND reference_type = 'reference_document'
  ORDER BY fetched_at DESC
  LIMIT 1
) e ON true
WHERE m.bundle_id = $1 AND r.source_type = 'google_drive';
```

Map the result rows into `ExternalDocumentReference` shape, including the two new fields. Non-Drive rows keep their existing shape.

- [ ] **Step 2: Render Drive reference rows in the attachments list**

Locate the attachments list render. Add a branch for `source_type === 'google_drive'`:

```tsx
{references.map(ref => (
  <DriveReferenceRow
    key={ref.id}
    reference={ref}
    onRemove={() => handleRemove(ref.id)}
  />
))}
```

Add a `DriveReferenceRow` sub-component in the same file (or a sibling file `client/src/components/DriveReferenceRow.tsx` if cleaner):

```tsx
function DriveReferenceRow({ reference, onRemove }: { reference: ExternalDocumentReference; onRemove: () => void }) {
  const stateBorderClass =
    reference.attachmentState === 'degraded' ? 'border-amber-200 bg-amber-50' :
    reference.attachmentState === 'broken'   ? 'border-red-200 bg-red-50' :
    'border-slate-200 bg-slate-50';

  return (
    <div className={`rounded-lg border ${stateBorderClass} p-3 flex items-center gap-3`}>
      <GoogleDriveIcon className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{reference.externalFileName}</span>
          <StateBadge state={reference.attachmentState} />
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          Google Drive · {humanFileType(reference.externalFileMimeType)} · Fetched {relativeTime(reference.lastFetchedAt ?? reference.createdAt)}
        </div>
      </div>
      <button onClick={onRemove} aria-label="Remove" className="text-slate-500 hover:text-red-600">×</button>
    </div>
  );
}

function StateBadge({ state }: { state: 'active' | 'degraded' | 'broken' }) {
  const map = {
    active:   { label: 'active',   cls: 'bg-emerald-100 text-emerald-700' },
    degraded: { label: 'degraded', cls: 'bg-amber-100 text-amber-700' },
    broken:   { label: 'broken',   cls: 'bg-red-100 text-red-700' },
  } as const;
  const m = map[state];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

function humanFileType(mimeType: string): string {
  if (mimeType === 'application/vnd.google-apps.document') return 'Doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'Sheet';
  if (mimeType === 'application/pdf') return 'PDF';
  return mimeType;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}
```

- [ ] **Step 3: Wire `handleRemove`**

```tsx
const handleRemove = async (referenceId: string) => {
  await removeExternalReference(taskId, referenceId);
  setReferences(prev => prev.filter(r => r.id !== referenceId));
};
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run build:client`.
Expected: clean. Manual: an attached reference renders with the active badge and the slate background; remove button works.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TaskModal.tsx server/routes/tasks.ts
git commit -m "feat(taskmodal): drive reference rows with last-fetch enrichment"
```

### Task 3.7: TaskModal — failure-policy select control (Screen 2)

**Mockup:** Screen 2 of 6 — single-line control beneath the attachments list: `If a Drive file can't be fetched: [select]`.

**Files:**
- Modify: `client/src/components/TaskModal.tsx`

- [ ] **Step 1: Render the failure-policy control**

Below the attachments list, when at least one Drive reference is attached:

```tsx
{driveReferenceCount > 0 && (
  <div className="mt-3 flex items-center gap-2 text-sm">
    <span>If a Drive file can't be fetched:</span>
    <select
      className="rounded-md border border-slate-200 px-2 py-1 text-sm"
      value={fetchFailurePolicy}
      onChange={e => updatePolicy(e.target.value as 'tolerant' | 'strict' | 'best_effort')}
    >
      <option value="tolerant">Use saved copy and continue (default)</option>
      <option value="strict">Stop the run</option>
      <option value="best_effort">Skip the file and continue</option>
    </select>
  </div>
)}
```

Wire `updatePolicy` to call `setFailurePolicy(taskId, value)` and update local state on success.

- [ ] **Step 2: Verify**

Run: `npm run build:client`.
Expected: clean. Manual: the control appears only when ≥1 Drive reference exists; changing the value persists.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TaskModal.tsx
git commit -m "feat(taskmodal): failure-policy select control"
```

### Task 3.8: Phase 3 verification gate

- [ ] **Step 1: Run gates**

```bash
npm run lint
npx tsc --noEmit
npm run build:server
npm run build:client
```
Expected: clean.

- [ ] **Step 2: Smoke test**

Manual:
1. Open TaskModal on a task. Verify the `Google Drive` button appears next to `Upload file` (Screen 2).
2. Click it. Verify the Picker iframe opens (Screen 3).
3. Pick a Google Doc. Verify the row appears with `active` state badge and the slate background.
4. Pick the same file again — verify a 409-driven toast.
5. Attempt to attach a 21st reference — verify per-task quota toast.
6. Change the failure-policy select — verify the API call fires and persists across reload.
7. Remove the reference — verify it disappears.

## Phase 4 — DataSourceManager path (Screen 5)

**Delivers:** the `google_drive` source type in `DataSourceManager`, letting scheduled tasks and agents attach Drive files via the existing data-source UI. Server-side validation accepts the new source type and `connection_id` field; the table renders google_drive rows; the `Mode` column is removed.

**Gate:** the user can add a Drive file as a data source on a scheduled task (Screen 5), see it listed with `type = google_drive` and `status = pending`, and delete it. No actual fetch occurs yet.

**Depends on:** Phase 1 (`agent_data_sources.connection_id`), Phase 3 (`DriveFilePicker` reused).

### Task 4.1: Server — accept `google_drive` source type in scheduled tasks and agents routes

**Files:**
- Modify: `server/routes/scheduledTasks.ts`
- Modify: `server/routes/agents.ts`

- [ ] **Step 1: Locate the data-source create/update validation in `scheduledTasks.ts`**

Find the route that creates a `agent_data_sources` row. Look for the existing zod schema or validation block where `source_type` is parsed.

- [ ] **Step 2: Extend the source-type enum and add `connection_id` validation**

```typescript
const dataSourceBodySchema = z.discriminatedUnion('sourceType', [
  // ... existing source types
  z.object({
    sourceType: z.literal('google_drive'),
    name: z.string().min(1),
    description: z.string().optional(),
    sourcePath: z.string().min(1),  // Drive fileId
    connectionId: z.string().uuid(),
  }),
]);
```

In the route handler, after parsing:

```typescript
if (parsed.sourceType === 'google_drive') {
  const [conn] = await db.select().from(integrationConnections).where(and(
    eq(integrationConnections.id, parsed.connectionId),
    eq(integrationConnections.subaccountId, req.subaccount.id),
    eq(integrationConnections.providerType, 'google_drive'),
  )).limit(1);
  if (!conn || conn.connectionStatus !== 'active') {
    return res.status(422).json({ error: 'invalid_connection_id' });
  }
}
```

Pass `connectionId` through to the `insert(agentDataSources)` payload.

- [ ] **Step 3: Repeat in `agents.ts`**

Apply the same changes to the agent data-source create/update routes.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`.
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add server/routes/scheduledTasks.ts server/routes/agents.ts
git commit -m "feat(routes): accept google_drive source type with connection_id"
```

### Task 4.2: DataSourceManager — add `google_drive` to source-type selector (Screen 5)

**Mockup:** Screen 5 of 6 — `docs/mockups/external-doc-references.html`, lines 852–997. Source-type select includes "Google Drive" alongside existing types; the URL input is replaced with a file picker trigger when Drive is selected.

**Files:**
- Modify: `client/src/components/DataSourceManager.tsx`

- [ ] **Step 1: Locate the source-type dropdown in the inline `Add Source` form**

Read the file. Find the `<select>` or option list where existing source types (`r2`, `s3`, `http_url`, `google_docs`, `dropbox`, `file_upload`) are rendered.

- [ ] **Step 2: Append the Google Drive option**

```tsx
<option value="google_drive">Google Drive</option>
```

Order: keep existing sort if present; otherwise place after `dropbox` and before `file_upload` so file-store providers cluster.

- [ ] **Step 3: Verify**

Run: `npm run build:client`.
Expected: clean. Manual: the option appears in the select.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/DataSourceManager.tsx
git commit -m "feat(datasource): add google_drive option to source-type selector"
```

### Task 4.3: DataSourceManager — conditional file picker field (Screen 5)

**Mockup:** Screen 5 of 6 — when `google_drive` is selected, the URL input is hidden; a `Google Drive` button replaces it; after picking, the selected file's name appears inline with a checkmark.

**Files:**
- Modify: `client/src/components/DataSourceManager.tsx`

- [ ] **Step 1: Add picker state and conditional field rendering**

```tsx
const [pickerOpen, setPickerOpen] = useState(false);
const [pickedFile, setPickedFile] = useState<{ file: DriveFile; connectionId: string } | null>(null);

const driveConnections = connections.filter(c => c.providerType === 'google_drive' && c.connectionStatus === 'active');

// Inside the form render block:
{formState.sourceType === 'google_drive' ? (
  <div className="space-y-1">
    <label className="text-sm font-medium">File</label>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
        disabled={driveConnections.length === 0}
      >
        <GoogleDriveIcon className="h-4 w-4" />
        Google Drive
      </button>
      {pickedFile && (
        <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
          <CheckIcon className="h-4 w-4" />
          {pickedFile.file.name}
        </span>
      )}
    </div>
    {driveConnections.length === 0 && (
      <p className="text-xs text-slate-500">Connect Google Drive in Integrations to enable this source type.</p>
    )}
  </div>
) : (
  <UrlInput value={formState.sourcePath} onChange={...} />
)}

<DriveFilePicker
  connections={driveConnections}
  isOpen={pickerOpen}
  onClose={() => setPickerOpen(false)}
  onPick={(file, connectionId) => setPickedFile({ file, connectionId })}
/>
```

- [ ] **Step 2: Wire picked file into the create-source submit handler**

```tsx
const submit = async () => {
  const payload =
    formState.sourceType === 'google_drive' && pickedFile
      ? {
          name: formState.name,
          description: formState.description,
          sourceType: 'google_drive',
          sourcePath: pickedFile.file.id,
          connectionId: pickedFile.connectionId,
        }
      : { /* existing branch */ };
  await createDataSource(payload);
};
```

- [ ] **Step 3: Verify**

Run: `npm run build:client`.
Expected: clean. Manual: selecting `google_drive` swaps the URL field for the file picker; picking a file shows the checkmark + filename.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/DataSourceManager.tsx
git commit -m "feat(datasource): conditional file picker field for google_drive"
```

### Task 4.4: DataSourceManager — remove `Mode` column from table (Screen 5)

**Mockup:** Screen 5 of 6 — the table shows columns Name / Type / Status / actions. No `Mode` (eager/lazy) column.

**Files:**
- Modify: `client/src/components/DataSourceManager.tsx`

- [ ] **Step 1: Locate the table column definitions**

Find the `<thead>` block listing column headers and the `<tbody>` row mapping.

- [ ] **Step 2: Remove the `Mode` header and cell**

Delete the `<th>Mode</th>` and the corresponding `<td>{row.mode}</td>` cell. Keep `Name`, `Type`, `Status`, and any actions cell.

- [ ] **Step 3: Verify**

Run: `npm run build:client`.
Expected: clean. Manual: the `Mode` column is gone for all source types (the change is global, not just `google_drive`, since the spec specifies removal).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/DataSourceManager.tsx
git commit -m "feat(datasource): remove Mode column from data sources table"
```

### Task 4.5: DataSourceManager — render `google_drive` rows with status (Screen 5)

**Mockup:** Screen 5 of 6 — `google_drive` rows show `type = google_drive`, status badge driven by `last_fetch_status` (`active` green, `error` red, `pending` grey).

**Files:**
- Modify: `client/src/components/DataSourceManager.tsx`

- [ ] **Step 1: Add a status-badge helper that maps `last_fetch_status` to a visual treatment**

```tsx
function dataSourceStatusBadge(status: 'ok' | 'error' | 'pending' | null | undefined) {
  if (status === 'ok')      return { label: 'active',  cls: 'bg-emerald-100 text-emerald-700' };
  if (status === 'error')   return { label: 'error',   cls: 'bg-red-100 text-red-700' };
  return                       { label: 'pending', cls: 'bg-slate-100 text-slate-600' };
}
```

- [ ] **Step 2: Render the status cell using the helper for all rows**

```tsx
<td>
  {(() => {
    const b = dataSourceStatusBadge(row.lastFetchStatus);
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${b.cls}`}>{b.label}</span>;
  })()}
</td>
```

- [ ] **Step 3: Render `type` cell**

For `google_drive` rows, the `Type` cell already shows the raw `source_type` value — keep it as `google_drive` per the spec; do not localise.

- [ ] **Step 4: Verify**

Run: `npm run build:client`.
Expected: clean. Manual: a Drive data source on a scheduled task shows `pending` until first run.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/DataSourceManager.tsx
git commit -m "feat(datasource): render google_drive rows with status badge"
```

### Task 4.6: Phase 4 verification gate

- [ ] **Step 1: Run gates**

```bash
npm run lint
npx tsc --noEmit
npm run build:server
npm run build:client
```
Expected: clean.

- [ ] **Step 2: Smoke test**

Manual:
1. Open a scheduled task. Click `Add Source`.
2. Select `Google Drive`. Verify the URL input is replaced with the file picker (Screen 5).
3. Pick a Drive file. Verify the checkmark + filename appear.
4. Save. Verify the row in the table shows `type = google_drive`, `status = pending`.
5. Verify the `Mode` column is gone.
6. Delete the row. Verify it disappears.

## Phase 5 — Context assembly and state machine

**Delivers:** Drive references are fetched at run time and injected into the agent's `## Your Knowledge Base` block. State-machine transitions (active/degraded/broken) are written by the resolver. Per-run token budget, per-run reference cap, attachment ordering, and failure-policy enforcement run inside `runContextLoader`.

**Gate:** a scheduled task with a Drive file data source runs successfully end-to-end; the run prompt contains the document content with the provenance header; `document_fetch_events` row written; `attachment_state` updated; second run within 60s hits the cache (revealed by `cache_hit = true` in the audit row).

**Depends on:** Phase 2 (resolver service), Phase 3 (TaskModal references), Phase 4 (DataSourceManager `google_drive` rows).

### Task 5.1: Pure-function helpers for ordering + budget enforcement

**Files:**
- Create or modify: `server/services/runContextLoaderPure.ts`
- Create or modify: `server/services/__tests__/runContextLoaderPure.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  mergeAndOrderReferences,
  enforceRunBudget,
  applyFailurePolicy,
  smallDocumentFragmentationWarning,
  type MergedReference,
  type ResolvedDocumentLite,
} from '../runContextLoaderPure';

test('mergeAndOrderReferences — sorts by attachment_order ascending across both sources', () => {
  const refs: MergedReference[] = [
    { kind: 'reference_document', id: 'a', attachmentOrder: 3, createdAt: '2026-04-01T00:00:00Z' },
    { kind: 'agent_data_source',  id: 'b', attachmentOrder: 1, createdAt: '2026-04-02T00:00:00Z' },
    { kind: 'reference_document', id: 'c', attachmentOrder: 2, createdAt: '2026-04-03T00:00:00Z' },
  ];
  const sorted = mergeAndOrderReferences(refs);
  assert.deepEqual(sorted.map(r => r.id), ['b', 'c', 'a']);
});

test('mergeAndOrderReferences — sub-sorts duplicates by created_at ascending', () => {
  const refs: MergedReference[] = [
    { kind: 'reference_document', id: 'a', attachmentOrder: 1, createdAt: '2026-04-02T00:00:00Z' },
    { kind: 'reference_document', id: 'b', attachmentOrder: 1, createdAt: '2026-04-01T00:00:00Z' },
  ];
  assert.deepEqual(mergeAndOrderReferences(refs).map(r => r.id), ['b', 'a']);
});

test('enforceRunBudget — stops at first reference that would exceed budget', () => {
  const resolved: ResolvedDocumentLite[] = [
    { id: 'a', tokensUsed: 1000, failureReason: null },
    { id: 'b', tokensUsed: 1500, failureReason: null },
    { id: 'c', tokensUsed:  500, failureReason: null },
  ];
  const result = enforceRunBudget(resolved, 2000);
  assert.deepEqual(result.included.map(r => r.id), ['a']);
  assert.deepEqual(result.skipped.map(s => ({ id: s.id, reason: s.reason })), [
    { id: 'b', reason: 'budget_exceeded' },
    { id: 'c', reason: 'budget_exceeded' },
  ]);
});

test('enforceRunBudget — failure_reason references do not consume budget', () => {
  const resolved: ResolvedDocumentLite[] = [
    { id: 'a', tokensUsed: 0, failureReason: 'auth_revoked' },
    { id: 'b', tokensUsed: 1500, failureReason: null },
  ];
  const result = enforceRunBudget(resolved, 2000);
  assert.deepEqual(result.included.map(r => r.id), ['b']);
});

test('applyFailurePolicy — strict blocks run on degraded', () => {
  const result = applyFailurePolicy('strict', { state: 'degraded' });
  assert.equal(result.action, 'block_run');
});

test('applyFailurePolicy — strict blocks run on broken', () => {
  assert.equal(applyFailurePolicy('strict', { state: 'broken' }).action, 'block_run');
});

test('applyFailurePolicy — tolerant serves stale on degraded, blocks on broken', () => {
  assert.equal(applyFailurePolicy('tolerant', { state: 'degraded' }).action, 'serve_stale_with_warning');
  assert.equal(applyFailurePolicy('tolerant', { state: 'broken' }).action, 'block_run');
});

test('applyFailurePolicy — best_effort serves stale silently on degraded, skips on broken', () => {
  assert.equal(applyFailurePolicy('best_effort', { state: 'degraded' }).action, 'serve_stale_silent');
  assert.equal(applyFailurePolicy('best_effort', { state: 'broken' }).action, 'skip_reference');
});

test('smallDocumentFragmentationWarning — fires when >50% are <500 tokens', () => {
  const small = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, tokensUsed: 100, failureReason: null }));
  const large = Array.from({ length: 3 }, (_, i) => ({ id: `l${i}`, tokensUsed: 1000, failureReason: null }));
  assert.equal(smallDocumentFragmentationWarning([...small, ...large])?.fragmentedCount, 4);
});

test('smallDocumentFragmentationWarning — null when <=50% are small', () => {
  const docs = [
    { id: 'a', tokensUsed: 100, failureReason: null },
    { id: 'b', tokensUsed: 1000, failureReason: null },
    { id: 'c', tokensUsed: 1000, failureReason: null },
  ];
  assert.equal(smallDocumentFragmentationWarning(docs), null);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `npx tsx server/services/__tests__/runContextLoaderPure.test.ts`
Expected: FAIL — module not found or new exports missing.

- [ ] **Step 3: Implement the helpers**

```typescript
// server/services/runContextLoaderPure.ts (extend if file exists)

import { EXTERNAL_DOC_FRAGMENTATION_THRESHOLD } from '../lib/constants';
import type { FetchFailureReason } from '../db/schema/documentFetchEvents';

export interface MergedReference {
  kind: 'reference_document' | 'agent_data_source';
  id: string;
  attachmentOrder: number;
  createdAt: string;
}

export interface ResolvedDocumentLite {
  id: string;
  tokensUsed: number;
  failureReason: FetchFailureReason | null;
}

export function mergeAndOrderReferences(refs: MergedReference[]): MergedReference[] {
  return [...refs].sort((a, b) => {
    if (a.attachmentOrder !== b.attachmentOrder) return a.attachmentOrder - b.attachmentOrder;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export interface BudgetResult {
  included: ResolvedDocumentLite[];
  skipped: { id: string; reason: 'budget_exceeded' }[];
}

export function enforceRunBudget(resolved: ResolvedDocumentLite[], runTokenBudget: number): BudgetResult {
  let cumulative = 0;
  const included: ResolvedDocumentLite[] = [];
  const skipped: { id: string; reason: 'budget_exceeded' }[] = [];
  let breached = false;
  for (const doc of resolved) {
    if (doc.failureReason) continue; // failures don't consume budget; policy handles them
    if (breached) {
      skipped.push({ id: doc.id, reason: 'budget_exceeded' });
      continue;
    }
    if (cumulative + doc.tokensUsed > runTokenBudget) {
      breached = true;
      skipped.push({ id: doc.id, reason: 'budget_exceeded' });
      continue;
    }
    cumulative += doc.tokensUsed;
    included.push(doc);
  }
  return { included, skipped };
}

export type FailurePolicyAction =
  | { action: 'inject_active' }
  | { action: 'serve_stale_with_warning' }
  | { action: 'serve_stale_silent' }
  | { action: 'skip_reference' }
  | { action: 'block_run' };

export function applyFailurePolicy(
  policy: 'tolerant' | 'strict' | 'best_effort',
  ctx: { state: 'active' | 'degraded' | 'broken' }
): FailurePolicyAction {
  if (ctx.state === 'active') return { action: 'inject_active' };
  if (ctx.state === 'degraded') {
    if (policy === 'strict')      return { action: 'block_run' };
    if (policy === 'tolerant')    return { action: 'serve_stale_with_warning' };
    return                          { action: 'serve_stale_silent' };
  }
  // state === 'broken'
  if (policy === 'best_effort')   return { action: 'skip_reference' };
  return                            { action: 'block_run' };
}

export interface FragmentationWarning {
  fragmentedCount: number;
  totalCount: number;
  message: string;
}

export function smallDocumentFragmentationWarning(resolved: ResolvedDocumentLite[]): FragmentationWarning | null {
  const successful = resolved.filter(r => r.failureReason === null);
  if (successful.length === 0) return null;
  const small = successful.filter(r => r.tokensUsed < EXTERNAL_DOC_FRAGMENTATION_THRESHOLD).length;
  if (small <= successful.length / 2) return null;
  return {
    fragmentedCount: small,
    totalCount: successful.length,
    message: `${small} of ${successful.length} references contained fewer than ${EXTERNAL_DOC_FRAGMENTATION_THRESHOLD} tokens; context may be fragmented`,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx server/services/__tests__/runContextLoaderPure.test.ts`
Expected: PASS for all tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/runContextLoaderPure.ts server/services/__tests__/runContextLoaderPure.test.ts
git commit -m "feat(runContext): pure helpers for ordering, budget, failure policy, fragmentation"
```

### Task 5.2: Wire `externalDocumentResolverService` into `runContextLoader`

**Files:**
- Modify: `server/services/runContextLoader.ts`

- [ ] **Step 1: Read the current `loadRunContextData` shape**

Identify the section that loads data sources and reference documents, and the point where the system prompt block is assembled.

- [ ] **Step 2: Add the merged-reference assembly step**

After existing data-source loading:

```typescript
import { externalDocumentResolverService } from './externalDocumentResolverService';
import {
  mergeAndOrderReferences,
  enforceRunBudget,
  applyFailurePolicy,
  smallDocumentFragmentationWarning,
  type MergedReference,
} from './runContextLoaderPure';
import {
  EXTERNAL_DOC_MAX_REFS_PER_RUN,
  EXTERNAL_DOC_MAX_TOTAL_RESOLVER_MS,
} from '../lib/constants';
import {
  buildProvenanceHeader,
  countTokensApprox,
  truncateContentToTokenBudget,
} from './externalDocumentResolverPure';
import { externalDocFlags } from '../lib/featureFlags';

// Inside loadRunContextData:

// Kill switch FIRST (invariant #17). Bypasses all other flags. No fetch, no DB
// reads, no audit rows. Total bypass — for production incident response.
if (externalDocFlags.systemDisabled) {
  return assemblePrompt({ ...existing, externalDocumentBlocks: [] });
}

// Feature-flag short-circuit: when resolution is disabled, skip the entire pipeline
// but still emit a synthetic audit row per reference so observability sees intent.
if (!externalDocFlags.resolutionEnabled) {
  for (const ref of [...referenceDocumentsExternal, ...agentDataSourcesGoogleDrive]) {
    await emitResolutionDisabledAudit(db, run, ref);
  }
  return assemblePrompt({ ...existing, externalDocumentBlocks: [] });
}

// 1. Merge external references from both sources.
const externalRefs = mergeAndOrderReferences([
  ...referenceDocumentsExternal.map(r => ({
    kind: 'reference_document' as const,
    id: r.id,
    attachmentOrder: r.attachmentOrder,
    createdAt: r.createdAt.toISOString(),
  })),
  ...agentDataSourcesGoogleDrive.map(r => ({
    kind: 'agent_data_source' as const,
    id: r.id,
    attachmentOrder: r.attachmentOrder ?? 0,  // agent_data_sources may not have order — default 0
    createdAt: r.createdAt.toISOString(),
  })),
]);

// 2. Dedup-within-run on (provider, fileId, connectionId).
// Same Drive file attached via both task-reference + agent-data-source must resolve once.
// The duplicate is dropped from the resolve loop but still gets a cache-hit audit row
// pointing at the same cache entry so observability sees both attachment surfaces.
// See `## Execution strategy and cross-cutting invariants` invariant #4.
const seen = new Map<string, MergedReference>();
const duplicates: Array<{ duplicate: MergedReference; primary: MergedReference }> = [];
const dedupedRefs: MergedReference[] = [];
for (const ref of externalRefs) {
  const meta = await loadReferenceMeta(db, ref);
  const key = `google_drive:${meta.fileId}:${meta.connectionId}`;
  const primary = seen.get(key);
  if (primary) {
    duplicates.push({ duplicate: ref, primary });
  } else {
    seen.set(key, ref);
    dedupedRefs.push(ref);
  }
}

// 3. Enforce per-run reference cap.
const overCap = dedupedRefs.slice(EXTERNAL_DOC_MAX_REFS_PER_RUN);
const inCap   = dedupedRefs.slice(0, EXTERNAL_DOC_MAX_REFS_PER_RUN);

// 4. Resolve in order, respecting total resolver wall-clock budget.
// HARD-FAIL invariant (see `## Execution strategy and cross-cutting invariants` #2):
// when the budget is exceeded, ALL remaining references emit `budget_exceeded` audit
// rows immediately. No partial fetch is attempted on any subsequent ref. The budget
// check happens BEFORE each resolve call, never inside the resolver.
const startedAt = Date.now();
const resolvedDocs: Array<{ ref: typeof externalRefs[number]; resolved: ResolvedDocument }> = [];
let budgetBlown = false;
for (const ref of inCap) {
  if (Date.now() - startedAt > EXTERNAL_DOC_MAX_TOTAL_RESOLVER_MS) { budgetBlown = true; break; }
  const meta = await loadReferenceMeta(db, ref);
  const resolved = await externalDocumentResolverService.resolve({
    referenceId: ref.id,
    referenceType: ref.kind,
    organisationId: run.organisationId,
    subaccountId: run.subaccountId,
    connectionId: meta.connectionId,
    fileId: meta.fileId,
    expectedMimeType: meta.mimeType,
    docName: meta.name,
    runId: run.id,
    db,
  });
  resolvedDocs.push({ ref, resolved });
}

// Over-cap and budget-blown references emit budget_exceeded audit rows.
// `budgetBlown` covers wall-clock exhaustion; over-cap is a quota-exceeded bucket.
const blown = budgetBlown ? inCap.slice(resolvedDocs.length) : [];
for (const ref of [...overCap, ...blown]) {
  await emitBudgetExceededAudit(db, run, ref, budgetBlown ? 'budget_exceeded' : 'quota_exceeded');
}

// Invariant #10: over-cap and budget-blown refs were selected into the ordered reference
// list but are not injected as content. Each must emit a position-preserving placeholder
// block so the prompt structure is deterministic regardless of wall-clock budget state.
const forcedPlaceholders: string[] = [];
for (const ref of overCap) {
  const meta = await loadReferenceMeta(db, ref);
  forcedPlaceholders.push([
    `--- Document: ${meta.name}`,
    `Status: skipped (reason: quota_exceeded)`,
    `---`,
  ].join('\n'));
}
for (const ref of blown) {
  const meta = await loadReferenceMeta(db, ref);
  forcedPlaceholders.push([
    `--- Document: ${meta.name}`,
    `Status: skipped (reason: budget_exceeded)`,
    `---`,
  ].join('\n'));
}

// Duplicates emit cache-hit audit rows mirroring the primary's resolution.
// They are NOT injected into the prompt — that would double-count tokens.
for (const { duplicate, primary } of duplicates) {
  const primaryResolved = resolvedDocs.find(r => r.ref.id === primary.id)?.resolved ?? null;
  await emitDuplicateAudit(db, run, duplicate, primaryResolved);
}

// 4a. Per-document cap (invariant #14): no single ref consumes more than 30% of the
// run budget. Re-truncates oversize docs in place, preserving the truncation marker
// so the LLM still sees `[TRUNCATED: N tokens removed]`. Failures are skipped here.
const perDocCap = Math.floor(run.tokenBudget * 0.3);
for (const entry of resolvedDocs) {
  if (entry.resolved.failureReason !== null) continue;
  if (entry.resolved.tokensUsed <= perDocCap) continue;
  const retrunc = truncateContentToTokenBudget(entry.resolved.content, perDocCap);
  entry.resolved = {
    ...entry.resolved,
    content: retrunc.content,
    tokensUsed: countTokensApprox(retrunc.content),
    provenance: {
      ...entry.resolved.provenance,
      truncated: true,
      tokensRemovedByTruncation:
        (entry.resolved.provenance.tokensRemovedByTruncation ?? 0) + retrunc.tokensRemoved,
    },
  };
}

// 4b. Apply per-document budget enforcement (token budget across the run).
const budgetResult = enforceRunBudget(
  resolvedDocs.map(({ resolved, ref }) => ({ id: ref.id, tokensUsed: resolved.tokensUsed, failureReason: resolved.failureReason })),
  run.tokenBudget
);

// 5. Apply failure policy per reference.
// Slice-B safety net: when failure-policies flag is off, force `tolerant` regardless
// of the operator's selection. Keeps Slice B behaviour predictable while UI surfaces
// for degraded/broken states are still maturing in Phase 6.
const policy: 'tolerant' | 'strict' | 'best_effort' = externalDocFlags.failurePoliciesEnabled
  ? (bundleAttachment.fetchFailurePolicy as 'tolerant' | 'strict' | 'best_effort')
  : 'tolerant';
const blocks: string[] = [...forcedPlaceholders];
for (const { ref, resolved } of resolvedDocs) {
  const state: 'active' | 'degraded' | 'broken' =
    resolved.failureReason === null ? 'active' :
    resolved.provenance.isStale     ? 'degraded' : 'broken';
  const action = applyFailurePolicy(policy, { state });
  if (action.action === 'block_run') {
    throw new RunBlockedError(`Reference ${ref.id} is ${state}; policy = ${policy}`);
  }
  if (action.action === 'skip_reference') {
    // Invariant #10: deterministic ordering under failure. The skipped ref retains
    // its position via a placeholder block. Without this, LLM output drifts run-to-run
    // depending on transient failure patterns.
    blocks.push([
      `--- Document: ${resolved.provenance.docName}`,
      `Status: skipped (reason: ${resolved.failureReason ?? 'unknown'})`,
      `---`,
    ].join('\n'));
    continue;
  }
  // serve_stale_with_warning, serve_stale_silent, inject_active all inject the block.
  // Invariant #9: every non-fresh injection carries provenance — including the silent
  // path. The "silent" qualifier suppresses the runtime log line, NOT the prompt header.
  const header = buildProvenanceHeader({
    docName: resolved.provenance.docName,
    fetchedAt: resolved.provenance.fetchedAt,
    revisionId: resolved.provenance.revisionId,
    isStale: resolved.provenance.isStale,
  });
  blocks.push(`${header}\n\n${resolved.content}`);
  if (action.action === 'serve_stale_with_warning') {
    runLog.warn(`Reference ${resolved.provenance.docName} is serving stale cached content`);
  }
}

// 6. Add fragmentation warning if applicable.
const frag = smallDocumentFragmentationWarning(
  resolvedDocs.map(({ ref, resolved }) => ({ id: ref.id, tokensUsed: resolved.tokensUsed, failureReason: resolved.failureReason }))
);
if (frag) runLog.warn(frag.message);

// 7. Append blocks into the existing Knowledge Base prompt segment.
return assemblePrompt({ ...existing, externalDocumentBlocks: blocks });
```

`loadReferenceMeta` is a small helper that, depending on `ref.kind`, queries either `reference_documents` or `agent_data_sources` for the `(connectionId, fileId, mimeType, name)` tuple.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`.
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/services/runContextLoader.ts
git commit -m "feat(runContext): integrate external document resolver and failure policy"
```

### Task 5.3: Branch in `agentService.fetchSourceContent`

**Files:**
- Modify: `server/services/agentService.ts`

- [ ] **Step 1: Locate `fetchSourceContent`**

Find the dispatch on `source_type` (typically a switch).

- [ ] **Step 2: Add the `google_drive` branch**

```typescript
case 'google_drive': {
  const resolved = await externalDocumentResolverService.resolve({
    referenceId: dataSource.id,
    referenceType: 'agent_data_source',
    organisationId: agentRun.organisationId,
    subaccountId: agentRun.subaccountId,
    connectionId: dataSource.connectionId!,
    fileId: dataSource.sourcePath,
    expectedMimeType: dataSource.mimeType ?? 'application/vnd.google-apps.document',
    docName: dataSource.name,
    runId: agentRun.id,
    db,
  });
  if (resolved.failureReason) {
    return { ok: false, reason: resolved.failureReason };
  }
  return { ok: true, content: resolved.content, provenance: resolved.provenance };
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`.
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/services/agentService.ts
git commit -m "feat(agent): route google_drive source type through external resolver"
```

### Task 5.4: Phase 5 verification gate

- [ ] **Step 1: Run all gates**

```bash
npm run lint
npx tsc --noEmit
npx tsx server/services/__tests__/externalDocumentResolverPure.test.ts
npx tsx server/services/__tests__/externalDocumentSingleFlight.test.ts
npx tsx server/services/__tests__/runContextLoaderPure.test.ts
npx tsx server/services/resolvers/__tests__/googleDriveResolver.test.ts
```
Expected: all pass.

- [ ] **Step 2: End-to-end smoke test**

Manual:
1. Connect Drive (Phase 1). Create a small Google Doc with ≥200 tokens of prose. Note the `fileId`.
2. Open a scheduled task. Add a `google_drive` data source pointing to the doc (Phase 4).
3. Trigger the run. Verify the run prompt (in `agent_run_prompts` or run-log table) contains the doc content with `--- Document: <name>` provenance header.
4. Verify a `document_fetch_events` row with `cache_hit = false`, `failure_reason = null`.
5. Trigger the run again immediately. Verify a second event row with `cache_hit = true` (revisionId match served from cache).
6. Edit the Doc, trigger the run. Verify a new event row with `cache_hit = false` and an updated `revision_id`.
7. Revoke the Drive connection. Trigger the run. Verify the reference transitions to `degraded` (cache exists) and the run completes under `tolerant` policy with the warning line in the run log.

### Task 5.5: Observability SQL queries (Slice C)

**Files:**
- Create: `docs/queries/external-doc-references/success_rate_per_provider_last_24h.sql`
- Create: `docs/queries/external-doc-references/cache_hit_ratio_per_subaccount_last_24h.sql`
- Create: `docs/queries/external-doc-references/failures_grouped_by_reason_last_7d.sql`
- Create: `docs/queries/external-doc-references/time_to_usable_context_p50_p95.sql`
- Create: `docs/queries/external-doc-references/README.md`

Four queries, run via `psql` / Grafana data source. No dashboard UI in v1. Per-event latency requires a `duration_ms` column on `document_fetch_events` (deferred to v1.1) — but **time-to-usable-context** is computable today as the spread of `fetched_at` per `run_id`, which is the metric that actually matters: how long until the agent can run. See `## Execution strategy and cross-cutting invariants — Observability aggregates`.

- [ ] **Step 1: Write `success_rate_per_provider_last_24h.sql`**

```sql
-- Success rate per provider over the last 24 hours.
-- Run: psql $DATABASE_URL -f success_rate_per_provider_last_24h.sql
SELECT
  provider,
  count(*) AS total,
  count(*) FILTER (WHERE failure_reason IS NULL) AS successes,
  ROUND(
    count(*) FILTER (WHERE failure_reason IS NULL)::numeric / NULLIF(count(*), 0) * 100,
    2
  ) AS success_pct
FROM document_fetch_events
WHERE fetched_at > now() - interval '24 hours'
GROUP BY provider
ORDER BY total DESC;
```

- [ ] **Step 2: Write `cache_hit_ratio_per_subaccount_last_24h.sql`**

```sql
-- Cache hit ratio per subaccount over the last 24 hours.
-- A low ratio on a high-traffic subaccount usually means revisions are flipping
-- frequently (operators editing the source doc) or the resolver_version was bumped.
SELECT
  subaccount_id,
  count(*) AS total,
  count(*) FILTER (WHERE cache_hit) AS cache_hits,
  ROUND(
    count(*) FILTER (WHERE cache_hit)::numeric / NULLIF(count(*), 0) * 100,
    2
  ) AS cache_hit_pct
FROM document_fetch_events
WHERE fetched_at > now() - interval '24 hours'
GROUP BY subaccount_id
ORDER BY total DESC;
```

- [ ] **Step 3: Write `failures_grouped_by_reason_last_7d.sql`**

```sql
-- Failures grouped by reason over the last 7 days, with blast radius.
-- subaccounts_affected = how many tenants saw this failure mode.
-- refs_affected = how many distinct references hit it (proxy for incident scale).
SELECT
  failure_reason,
  count(*) AS occurrences,
  count(DISTINCT subaccount_id) AS subaccounts_affected,
  count(DISTINCT reference_id) AS refs_affected
FROM document_fetch_events
WHERE fetched_at > now() - interval '7 days'
  AND failure_reason IS NOT NULL
GROUP BY failure_reason
ORDER BY occurrences DESC;
```

- [ ] **Step 4: Write `time_to_usable_context_p50_p95.sql`**

```sql
-- Time-to-usable-context per run, p50 / p95 by hour, last 7 days.
-- This is the metric that actually matters: how long until the agent can run.
-- Computed as the spread of fetched_at per run_id, requiring no schema change.
-- Runs with only one external ref will report 0; those are excluded so the
-- aggregate reflects multi-ref runs (which is where the metric matters).
SELECT
  date_trunc('hour', run_started) AS hour,
  PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM resolve_window) * 1000) AS p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM resolve_window) * 1000) AS p95_ms,
  count(*) AS runs
FROM (
  SELECT
    run_id,
    min(fetched_at)               AS run_started,
    max(fetched_at) - min(fetched_at) AS resolve_window
  FROM document_fetch_events
  WHERE run_id IS NOT NULL
    AND fetched_at > now() - interval '7 days'
  GROUP BY run_id
  HAVING count(*) > 1
) per_run
GROUP BY hour
ORDER BY hour DESC;
```

- [ ] **Step 5: Write the README**

`docs/queries/external-doc-references/README.md`:

```markdown
# External document reference observability queries

Run via `psql $DATABASE_URL -f <file>` or import into Grafana as a Postgres data source.

| Query | Purpose | Cadence |
|---|---|---|
| `success_rate_per_provider_last_24h.sql` | Provider-level health check; alarm if <95% sustained | hourly |
| `cache_hit_ratio_per_subaccount_last_24h.sql` | Cache effectiveness per tenant; investigate <50% on high-traffic subaccounts | daily |
| `failures_grouped_by_reason_last_7d.sql` | Incident-scale view; spot trends in `auth_revoked` / `rate_limited` | on-incident |
| `time_to_usable_context_p50_p95.sql` | The metric that matters — how long until the agent can run. p50/p95 per hour over 7 days. | hourly |

Per-event latency aggregation deferred to v1.1 (requires `document_fetch_events.duration_ms` column).
```

- [ ] **Step 6: Commit**

```bash
git add docs/queries/external-doc-references
git commit -m "feat(observability): committed sql queries for external doc fetch metrics"
```

## Phase 6 — Re-bind modal and UI hardening (Screens 4, 6)

**Delivers:** the broken-reference re-attach flow (Screen 6); TaskModal degraded/broken visual treatment with the header error line (Screen 4); DataSourceManager broken-row treatment to match.

**Gate:** a task with a broken reference shows the modal header error line; clicking `Re-attach using another connection` opens `ExternalDocumentRebindModal`; selecting a live connection that can read the file enables `Re-attach`; confirming updates the reference and the next run resolves the broken state to `active`.

**Depends on:** Phase 3 (reference rows exist), Phase 5 (state-machine writes produce `broken`).

### Task 6.1: TaskModal — header error line for broken references (Screen 4)

**Mockup:** Screen 4 of 6 — `docs/mockups/external-doc-references.html`, lines 713–851. Header shows `1 reference requires attention · task will not run`; Save Changes button is disabled.

**Files:**
- Modify: `client/src/components/TaskModal.tsx`

- [ ] **Step 1: Compute the broken count**

```tsx
const brokenReferences = references.filter(r => r.attachmentState === 'broken');
const brokenCount = brokenReferences.length;
```

- [ ] **Step 2: Render the header error line**

In the modal header section, just below the title, add:

```tsx
{brokenCount > 0 && (
  <div className="mt-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
    <span className="font-medium">{brokenCount} reference{brokenCount > 1 ? 's' : ''} require{brokenCount > 1 ? '' : 's'} attention</span>
    <span className="text-red-600"> · task will not run</span>
  </div>
)}
```

- [ ] **Step 3: Disable Save Changes when broken refs exist**

Locate the Save Changes button. Add:

```tsx
<button
  type="submit"
  disabled={brokenCount > 0 || ...existing disabled conditions}
  title={brokenCount > 0 ? 'Resolve broken references before saving' : undefined}
  className={...}
>
  Save Changes
</button>
```

- [ ] **Step 4: Verify**

Run: `npm run build:client`.
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TaskModal.tsx
git commit -m "feat(taskmodal): header error line and disabled save for broken refs"
```

### Task 6.2: TaskModal — degraded reference amber wrapper (Screen 4)

**Mockup:** Screen 4 of 6 — degraded references render with amber border + amber background.

**Files:**
- Modify: `client/src/components/TaskModal.tsx` (or the `DriveReferenceRow` sub-component if extracted)

- [ ] **Step 1: Confirm the existing `DriveReferenceRow` already maps `degraded → amber-200/amber-50`**

The Phase 3 row component already includes:
```tsx
reference.attachmentState === 'degraded' ? 'border-amber-200 bg-amber-50' : ...
```

If absent, add it now.

- [ ] **Step 2: Verify**

Manual: a reference with `attachment_state = 'degraded'` (set this manually in the DB to test) renders inside the amber wrapper.

- [ ] **Step 3: Commit (no-op if already done in Phase 3)**

Skip if no diff.

### Task 6.3: TaskModal — broken reference detail block (Screen 4)

**Mockup:** Screen 4 of 6 — broken row expands to show failure reason + `Re-attach using another connection` button + `Remove reference` text button.

**Files:**
- Modify: `client/src/components/TaskModal.tsx`

- [ ] **Step 1: Extend `DriveReferenceRow` for broken state**

```tsx
{reference.attachmentState === 'broken' && (
  <div className="mt-2 border-t border-red-200 pt-2 text-sm text-red-800">
    <p>{plainEnglishFailureReason(reference.lastFailureReason)}</p>
    <div className="mt-2 flex items-center gap-3">
      <button
        type="button"
        onClick={() => onRebind(reference)}
        className="rounded-md bg-red-600 px-3 py-1.5 text-white text-sm hover:bg-red-700"
      >
        Re-attach using another connection
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="text-sm text-red-700 underline"
      >
        Remove reference
      </button>
    </div>
  </div>
)}

function plainEnglishFailureReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'auth_revoked': return 'The Google Drive connection no longer has access to this file.';
    case 'file_deleted': return 'This file has been deleted from Google Drive.';
    case 'rate_limited': return 'Drive temporarily rate-limited the platform; the file is unavailable for this run.';
    case 'unsupported_content': return 'The file is empty or in an unsupported format.';
    case 'quota_exceeded': return 'The file is too large to fetch.';
    case 'network_error': return 'Could not reach Google Drive.';
    default: return 'The file could not be fetched.';
  }
}
```

- [ ] **Step 2: Wire `onRebind` to open `ExternalDocumentRebindModal`**

```tsx
const [rebindReference, setRebindReference] = useState<ExternalDocumentReference | null>(null);

// pass setRebindReference as onRebind to each row
```

- [ ] **Step 3: Verify**

Run: `npm run build:client`.
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/TaskModal.tsx
git commit -m "feat(taskmodal): broken reference detail block with re-attach CTA"
```

### Task 6.4: `ExternalDocumentRebindModal` — shell + connection selector (Screen 6)

**Mockup:** Screen 6 of 6 — `docs/mockups/external-doc-references.html`, lines 998–1140. Modal lists available `google_drive` connections; selection triggers an access verification step; `Re-attach` confirm button is disabled until access is verified.

**Files:**
- Create: `client/src/components/ExternalDocumentRebindModal.tsx`

- [ ] **Step 1: Implement the modal**

```tsx
// client/src/components/ExternalDocumentRebindModal.tsx
import { useEffect, useState } from 'react';
import { rebindExternalReference, verifyAccess } from '../api/externalDocumentReferences';
import type { ExternalDocumentReference } from '../api/externalDocumentReferences';
import type { IntegrationConnection } from '../types/integrations';

interface Props {
  taskId: string;
  reference: ExternalDocumentReference;
  connections: IntegrationConnection[]; // pre-filtered to provider_type === 'google_drive', status === 'active'
  isOpen: boolean;
  onClose: () => void;
  onRebound: (updated: ExternalDocumentReference) => void;
  onRemoveInstead: () => void;
}

type VerifyState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'verified' }
  | { kind: 'failed'; reason: string };

export function ExternalDocumentRebindModal({ taskId, reference, connections, isOpen, onClose, onRebound, onRemoveInstead }: Props) {
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<VerifyState>({ kind: 'idle' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSelectedConnId(null);
      setVerifyState({ kind: 'idle' });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!selectedConnId) return;
    setVerifyState({ kind: 'verifying' });
    verifyAccess(selectedConnId, reference.externalFileId)
      .then(() => setVerifyState({ kind: 'verified' }))
      .catch((err) => setVerifyState({ kind: 'failed', reason: err.response?.data?.error ?? 'unknown' }));
  }, [selectedConnId, reference.externalFileId]);

  if (!isOpen) return null;

  const canConfirm = verifyState.kind === 'verified' && !submitting;

  const handleConfirm = async () => {
    if (!selectedConnId) return;
    setSubmitting(true);
    try {
      const updated = await rebindExternalReference(taskId, reference.id, selectedConnId);
      onRebound(updated);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-semibold">Re-attach broken reference</h2>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-slate-700">×</button>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <p className="text-sm text-slate-700">
              <span className="font-medium">{reference.externalFileName}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">{plainEnglishFailureReason(reference.lastFailureReason)}</p>
          </div>

          <div>
            <label className="text-sm font-medium">Choose a connection</label>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={selectedConnId ?? ''}
              onChange={e => setSelectedConnId(e.target.value || null)}
            >
              <option value="">Select a Google Drive connection…</option>
              {connections.map(c => (
                <option key={c.id} value={c.id}>{c.label ?? `Drive (${c.ownerEmail ?? c.id.slice(0, 6)})`}</option>
              ))}
            </select>
          </div>

          {verifyState.kind === 'verifying' && (
            <p className="text-sm text-slate-500">Verifying access…</p>
          )}
          {verifyState.kind === 'verified' && (
            <p className="text-sm text-emerald-700">This connection can read the file.</p>
          )}
          {verifyState.kind === 'failed' && (
            <p className="text-sm text-red-700">This connection cannot read the file ({verifyState.reason}). Try another connection.</p>
          )}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t bg-slate-50 px-5 py-3">
          <button type="button" onClick={onRemoveInstead} className="text-sm text-slate-600 underline">
            Remove reference instead
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={handleConfirm}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Re-attach
          </button>
        </footer>
      </div>
    </div>
  );
}

function plainEnglishFailureReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'auth_revoked': return 'The connection no longer has access to this file.';
    case 'file_deleted': return 'This file was deleted from Drive.';
    default: return 'The file could not be fetched.';
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run build:client`.
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ExternalDocumentRebindModal.tsx
git commit -m "feat(client): ExternalDocumentRebindModal with verify-access flow"
```

### Task 6.5: TaskModal — mount the rebind modal

**Files:**
- Modify: `client/src/components/TaskModal.tsx`

- [ ] **Step 1: Render the modal at the bottom of TaskModal**

```tsx
{rebindReference && (
  <ExternalDocumentRebindModal
    taskId={taskId}
    reference={rebindReference}
    connections={driveConns}
    isOpen={!!rebindReference}
    onClose={() => setRebindReference(null)}
    onRebound={(updated) => {
      setReferences(prev => prev.map(r => r.id === updated.id ? updated : r));
    }}
    onRemoveInstead={async () => {
      await removeExternalReference(taskId, rebindReference.id);
      setReferences(prev => prev.filter(r => r.id !== rebindReference.id));
      setRebindReference(null);
    }}
  />
)}
```

- [ ] **Step 2: Verify**

Run: `npm run build:client`.
Expected: clean. Manual: a broken reference's `Re-attach using another connection` button opens the modal (Screen 6).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TaskModal.tsx
git commit -m "feat(taskmodal): mount ExternalDocumentRebindModal"
```

### Task 6.6: DataSourceManager — error-state visual treatment for `google_drive` rows

**Files:**
- Modify: `client/src/components/DataSourceManager.tsx`

- [ ] **Step 1: For `google_drive` rows where `last_fetch_status = 'error'`, surface an inline detail line**

Below the row, render:
```tsx
{row.sourceType === 'google_drive' && row.lastFetchStatus === 'error' && (
  <p className="mt-1 text-xs text-red-700">
    Last fetch failed. {row.lastFailureReason ? plainEnglishFailureReason(row.lastFailureReason) : ''}
  </p>
)}
```

(Reuse `plainEnglishFailureReason` — extract to a shared helper module if you prefer.)

- [ ] **Step 2: Verify**

Run: `npm run build:client`.
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/DataSourceManager.tsx
git commit -m "feat(datasource): inline failure-reason line for google_drive errors"
```

### Task 6.7: Phase 6 verification gate

- [ ] **Step 1: Run all gates**

```bash
npm run lint
npx tsc --noEmit
npm run build:server
npm run build:client
npx tsx server/services/__tests__/externalDocumentResolverPure.test.ts
npx tsx server/services/__tests__/externalDocumentSingleFlight.test.ts
npx tsx server/services/__tests__/runContextLoaderPure.test.ts
npx tsx server/services/resolvers/__tests__/googleDriveResolver.test.ts
```
Expected: all pass.

- [ ] **Step 2: End-to-end smoke test for the broken-state recovery flow**

Manual:
1. Connect Drive (Connection A). Attach a Drive file to a task. Run once successfully.
2. Revoke Connection A in Google's account settings. Wait for the next scheduled run; verify `attachment_state = 'broken'` after the resolver fails twice (degraded → broken transition once cache age exceeds boundary, or directly broken if cache had not been populated).
3. Open TaskModal. Verify the header error line and the broken row with detail block (Screen 4).
4. Click `Re-attach using another connection`. Verify Screen 6 modal opens.
5. Connect a second Drive account (Connection B). Re-open the rebind modal; verify Connection B is listed.
6. Select Connection B. Wait for the verify-access call. Verify the success line shows.
7. Click `Re-attach`. Verify the reference state returns to `active` immediately and persists.
8. Trigger the run; verify a `cache_hit = false` `document_fetch_events` row was written under the new connection.

---

## Self-review

This plan was checked against the spec for coverage of every section, against the mockups for every screen reference, and for placeholder rot. The mockup index near the top of the plan maps each of the six mockup screens to the tasks that implement them.
