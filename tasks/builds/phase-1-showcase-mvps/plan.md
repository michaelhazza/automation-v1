# Phase 1 Showcase MVPs — Implementation Plan

**Build slug:** `phase-1-showcase-mvps`
**Spec:** `tasks/builds/phase-1-showcase-mvps/spec.md` (locked)
**Plan date:** 2026-05-10
**Author:** architect
**Task class:** Major
**Sequencing:** Phase A (serial: file delivery) → Phase B (parallel: 42 Macro + Support Agent)
**Total chunks:** 10
**Total LOC estimate:** ~5,961 (rounded to ~6,000; includes shared file delivery counted once)
**Estimated effort:** 6 to 8 weeks

---

## Contents

1. System Invariants (load-bearing)
2. Architecture Notes
3. Model-collapse check
4. Chunk overview
5. Per-chunk detail (Chunks 1 through 10)
6. Risk register and mitigations
7. Executor notes

---

## 1. System Invariants (load-bearing)

These invariants from spec §3 are load-bearing across multiple chunks. Every chunk's acceptance criteria reference the invariants it touches.

- **INV-1 (no regression on existing 42 Macro runs).** Today's IEE browser worker is producing real runs; Full MVP changes are strictly additive. Preserved by Chunks 3, 4, 5.
- **INV-2 (no regression on Support Desk Canonical surfaces).** PR #277 schemas, services, skill specs, route group, and UI components are locked. Preserved by Chunks 6, 7, 8, 10.
- **INV-3 (foundation primitives are read-only).** `agent_runs.controller_style`, `policy_envelope_snapshot`, Risk Tier on actions, `CredentialBrokerService`. Preserved by every chunk.
- **INV-5 (additive schema only).** No column-type changes, removals, or renames. Honoured by Chunk 1 (`run_artifacts`), Chunk 7 (`subaccount_agents.applied_template_slug`), Chunk 9 (`support_eval_runs`).
- **INV-6 (RLS on every new table).** Registered in `server/config/rlsProtectedTables.ts`. Required for Chunks 1, 7, 9.
- **INV-7 (migrations reversible).** `.down.sql` counterpart in `migrations/_down/` for every new migration. Required for Chunks 1, 7, 9.
- **INV-8 (Native Controller default).** `agent_runs.controller_style = 'native'` for every Support Agent run. Honoured by Chunk 8.
- **INV-9 (Risk Tier classification on new actions).** `support.classify_ticket` inherits Tier 1. Honoured by Chunk 6.
- **INV-10 (customer-facing replies are Tier 6 by default).** Default `gateLevel = block` on `support.approve_draft`; `agent_config.mode='autonomous'` is the policy override. Honoured by Chunks 7, 8.
- **INV-11 (three-phase dispatch).** Every customer-facing reply goes through `supportDraftDispatchService.dispatchDraft`. Support Agent never writes `canonical_ticket_messages` directly. Honoured by Chunk 8.
- **INV-12 (file delivery is content-hashed and attributable).** Every customer-visible file has content hash, originating run id, originating org id; no ephemeral files in customer-facing UI. Honoured by Chunks 1, 2, 3.
- **INV-13 (parallel build allowed after dependencies land).** Phase A serial on Chunk 1; Phase B parallel for Chunks 2-10.
- **INV-15 (eval harness is part of acceptance for the Support Agent).** Required by Chunk 9.
- **INV-16 (stable log codes; run-rendered events double as `agent_execution_events.event_type`).** All 19 events from spec §3.5 are the single source of truth. Honoured by Chunks 1, 2, 3, 5, 6, 8, 9.
- **INV-17 (both MVPs surface in Run Trace).** Honoured by Chunks 4, 8, 10.

A chunk's "Invariants touched" line names which of these the chunk advances or upholds.

## 2. Architecture Notes

### Resolved Open Decisions (spec §11)

The 7 Open Decisions in spec §11 resolve as follows. Every decision has either an in-plan resolution or a named chunk owner.

- **OD 11.1 — PDF library.** ACCEPTED: `@react-pdf/renderer`. Owned by Chunk 3. Determinism contract per spec §4.4.3 is mandatory: pin exact version (no caret) in `package.json`, zero `/CreationDate` and `/ModDate` PDF metadata, sort xref deterministically, strip `/ID` array. The hash recorded in `run_artifacts.content_hash` is the SHA-256 of the normalised bytes.
- **OD 11.2 — Worker-to-S3 path.** Deferred to chunk-build time within Chunk 1. Both Option A (direct upload + finalize) and Option B (main-app proxy) bind to the same logical contract per spec §6.1.4. Chunk 1 implements the main-app side of both options; Chunk 1 builder picks the physical-transit option based on whether worker-scoped IAM is provisioned. Row insert + `phase1.file_delivery.uploaded` emission ALWAYS happen in the main app regardless of choice.
- **OD 11.3 — Model routing.** ACCEPTED: Sonnet for both classify and draft in MVP. Haiku-classify routing deferred to Phase 1.5. Owned by Chunk 6.
- **OD 11.4 — Classification cache.** DEFERRED — Chunk 6 ships `support.classify_ticket` WITHOUT a dedicated cache table. Spec §5.4.3 marks the cache row as gated. Re-classification on a re-fetched ticket is acceptable for MVP. Phase 1.5 may merge into a generic skill-result cache.
- **OD 11.5 — Eval regression set.** ACCEPTED: monthly Foundry refresh, manual-seed fallback, fail-open under 2 rows. Owned by Chunk 9. Implementation already specified in spec §5.5.2.
- **OD 11.6 — UI permission scope.** ACCEPTED: existing `support.inbox.configure` permission gates inbox mode toggle; default granted to org admin only. No new permission tile. Owned by Chunk 10.
- **OD 11.7 — Phase 1.5 inheritance.** ACCEPTED: do not over-generalise; let Phase 1.5 specs reference shared primitives. No code action in this plan.

### Detector path correction

Spec §4.6.2 references `server/services/systemMonitoring/detectors/`. That path does not exist. The existing detector pattern lives at `server/services/workspaceHealth/detectors/` with an `index.ts` registry (e.g. `staleConnectorDetector.ts`). Chunk 5 places `staleMacroRunDetector.ts` under `workspaceHealth/detectors/` and registers it in the existing `index.ts`. This is a non-functional path correction; the spec's intent (a detector that fires `phase1.macro.run_stuck`) is preserved.

### Two distinct approval paths (spec §5.4.2)

The plan does not introduce a separate "agent-approved-via-approve_draft-in-assisted-mode" code path. In assisted mode the Support Agent's call to `support.approve_draft` is BLOCKED at the Risk Tier 6 gate; the human approval flows through the existing `reviewItems` / `reviewAuditRecords` path consumed by `supportDraftDispatchService`. The autonomous-mode path lowers the gate via `agent_config.mode='autonomous'` only. Chunk 8 implements both conditions through a single conditional in the agent's approval-routing step; both modes funnel into `supportDraftDispatchService.dispatchDraft`.

### Singleton install race defence (spec §5.3.1)

Chunk 7 ships advisory lock + partial unique index + slug column + backfill UPDATE in a single migration. The advisory lock is the primary defence (clean error path); the partial unique index is the safety net (serialisation guarantee). The install service maps `23505` to `409 already_installed`. Acceptance criterion §9.2 ("two simultaneous installs → one 200, one 409") is the integration test in `supportAgentInstall.integration.test.ts` (within Chunk 7).

### Slug stability invariant (spec §5.3.1)

Once a `subaccount_agents` row carries `applied_template_slug = 'support-agent'`, that value MUST NOT be rewritten by future system-agent renames. The slug is the identity that the partial unique index keys on; rewriting historical slugs would either reopen the singleton race or invalidate the index's coverage. Chunk 7 ships a static check (grep against the install service's UPDATE statements) that fails the build if any code path mutates `applied_template_slug` outside the install service.

### Per-ticket atomic claim (spec §5.3.4)

Chunk 8 wires `canonical_tickets.bot_claimed_at` and `bot_claimed_by_run_id` (canonical-layer columns already in PR #277) as the per-ticket concurrency guard. Optimistic predicate: `UPDATE ... WHERE id=:ticketId AND organisation_id=:orgId AND (bot_claimed_at IS NULL OR bot_claimed_at < now() - interval ':claimTtlMinutes minutes')`. 0 rows affected = collision; emit `phase1.support.collision_skipped` (`reason: concurrent_claim`). Default TTL 15 minutes, cleared on terminal verdict. Database-side `now()` comparison is clock-skew safe.

### Run-loop idempotency boundary (spec §5.3.4)

The Support Agent's outer-loop idempotency is the `support.list_open_tickets` query that filters out tickets with a recent terminal `phase1.support.*` event since `last_customer_message_at` (with `COALESCE` fallback to `created_at`). No new persistence beyond the per-ticket terminal events already emitted. The pg-boss handler runs `singleton: true` per `(subaccount_id, inbox_id)` advisory lock; cross-inbox parallelism is allowed.

### Eval harness as static gate (spec §7.3)

`scripts/gates/verify-support-agent-eval-thresholds.sh` is authored INSIDE Chunk 9, not as its own chunk. The gate is CI-only, fails open under fewer than 2 rows, fails build only when two consecutive runs fall below threshold for the same metric. The fail-open is logged and emits `phase1.support.eval_drift_detected` payload `{ reason: 'regression_set_unavailable', rowCount: <N> }` so the operator sees the silence in the Activity feed.

### File delivery — single emit point (spec §6.1.4 / §6.1.5b)

All four `phase1.file_delivery.*` events emit from the main app, never the worker. Even when Option A (direct worker → S3) is in effect, the row insert + event emit happen in the main-app finalize endpoint. Chunk 1 owns the upload + emit; Chunk 2 owns the read-surface emits (`signed_url_issued`, `downloaded`); both consume the same `phase1.file_delivery.uploaded` payload contract from the canonical event registry (§3.5).

### Composite partial unique index for `run_artifacts` (spec §6.1.2)

`UNIQUE INDEX run_artifacts_run_kind_hash_unique ON run_artifacts(organisation_id, agent_run_id, artifact_kind, content_hash) WHERE agent_run_id IS NOT NULL`. The partial-on-NOT-NULL is required because `agent_run_id` is `ON DELETE SET NULL`; once the run row is hard-deleted by retention, the artifact's `agent_run_id` becomes NULL until the §6.1.2b sweeper picks it up. Excluding NULLs from the index keeps the constraint meaningful only while the run lineage is intact and prevents post-deletion artifacts from blocking new inserts.

### Source-of-truth precedence: `iee_artifacts` vs `run_artifacts` (spec §6.1.2)

`iee_artifacts` remains the worker-internal ledger (used by IEE progress UI, transcription cache, dedup-by-content-hash inside the worker). `run_artifacts` is the customer-delivery ledger. Promotion is from `iee_artifacts` → `run_artifacts` (`fileDeliveryService.upload` writes a new `run_artifacts` row referencing the same `iee_run_id` and `content_hash`); the original `iee_artifacts` row is never moved. Customer-facing UI reads `run_artifacts` only; the worker reads `iee_artifacts` only. No automatic backfill of pre-MVP `iee_artifacts` rows.

### Idempotency posture summary

| Chunk | Write path | Posture | Mechanism |
|---|---|---|---|
| 1 | `fileDeliveryService.upload` row insert | key-based | Composite partial unique index `run_artifacts_run_kind_hash_unique`; `23505` → 200 idempotent hit |
| 1 | Retention sweeper deletes | safe-by-construction | `DELETE WHERE retain_until < now()` is naturally idempotent |
| 2 | `signed_url_issued` event emit | non-idempotent (intentional) | Each call mints a fresh URL; emit per call |
| 2 | `downloaded` event emit | non-idempotent (intentional) | Each download is a discrete event |
| 3 | PDF render + upload | safe (delegates to Chunk 1) | Same content hash on re-render hits the same `run_artifacts` row via Chunk 1's index |
| 5 | `staleMacroRunDetector` row write | state-based | Reuses existing detector idempotency in `workspaceHealth/detectors/` |
| 6 | `support.classify_ticket` skill execution | non-idempotent (intentional) | Each call is a fresh LLM request; no cache in MVP per OD 11.4 |
| 7 | Support Agent install | key-based | Advisory lock + partial unique index `subaccount_agents_support_agent_singleton_idx`; `23505` → 409 |
| 8 | Per-ticket atomic claim | state-based | Optimistic predicate on `bot_claimed_at` |
| 8 | Outer-loop run | safe-by-elimination | `support.list_open_tickets` filters via terminal-event predicate |
| 8 | Per-ticket terminal events | non-idempotent (intentional) | Exactly one emit per ticket per agent run; predicate enforces single-emit |
| 9 | Daily eval run row insert | state-based | pg-boss handler `singleton: true` per `(organisation_id)` |
| 10 | UI mode-toggle write | safe (REST PATCH) | Idempotent on `agent_config.mode` |

## 3. Model-collapse check

The three pre-plan questions:

1. **Does this feature decompose into ingest → extract → transform → render?** Partially. The 42 Macro MVP has a browser → transcript → analysis → PDF pipeline (deterministic, mostly built). The Support Agent has a classify → draft → approve loop (LLM-driven).
2. **Is each step doing something a frontier multimodal model could do in a single call?** Some steps yes (classify+draft could be one structured-output call). The browser automation, content-hash dedup, file delivery, and three-phase dispatch are NOT model-collapsible — they are deterministic infrastructure with hard correctness contracts.
3. **Can the whole pipeline collapse into one model call with a structured-output schema?** No.

**Rejection rationale.** Both MVPs have first-class architectural requirements that a single-model-call collapse would violate:

- **42 Macro:** byte-deterministic PDF output (INV-12, §4.4.3), content-hashed S3 storage, signed-URL attribution, three failure-mode renderers. None of these are LLM responsibilities; they are infrastructure with hard correctness contracts (e.g. `run_artifacts.content_hash` is the SHA-256 of the rendered bytes — non-LLM).
- **Support Agent:** HITL approval is a first-class architectural requirement (INV-10 Tier 6 default, INV-11 three-phase dispatch). Collapsing classify → draft → approve into one model call would lose: the draft-review affordance (the human reads the draft before it sends), the per-step Run Trace audit trail (each step is a separate `agent_execution_events` row with its own discriminator), the policy-envelope decision points (Risk Tier 6 evaluated PER customer-facing reply), and the autonomous-vs-assisted mode distinction (the gate evaluates between draft and dispatch, not at model-call time).

The pipeline is decomposed not because we "always built it that way" but because each step is a separate transactional + audit + gate boundary. A model call alone cannot enforce a transaction or persist an approval record.

## 4. Chunk overview

| # | Chunk | LOC | Phase | Predecessors |
|---|---|---|---|---|
| 1 | File delivery service (table + service + sweeper, no consumer routes) | ~860 | A | Foundation refactor (shipped) |
| 2 | Run artifact read surface (artifact list + download proxy + signed-URL mint routes) | ~320 | B | Chunk 1 |
| 3 | PDF report generation (deterministic render + ieeRunCompletedHandler integration) | ~512 | B | Chunk 1 |
| 4 | 42 Macro Run Trace UI (artifact panel + headline + failure renderers) | ~200 | B | Chunks 2 + 3 |
| 5 | 42 Macro production hardening (failure-mode branches + stuck-run detector) | ~245 | B | none |
| 6 | Support Agent skill: classify_ticket + Zod runtime contract | ~575 | B | none |
| 7 | Support Agent install + record + master prompt (advisory lock + partial unique index) | ~628 | B | none |
| 8 | Support Agent execution loop (atomic claim + classify-draft-route + skill prompt polish) | ~980 | B | Chunks 6 + 7 |
| 9 | Support Agent eval harness (regression set + thresholds + drift + admin page + CI gate) | ~1,091 | B | Chunk 8 |
| 10 | Support Agent UI surfaces (dashboard + inbox config tab + Run Trace event renderers) | ~550 | B | Chunks 7 + 8 |

**Forward-only dependency graph.**

```
Chunk 1 ─┬─→ Chunk 2 ─→ Chunk 4
         └─→ Chunk 3 ─→ Chunk 4
Chunk 5  (independent)
Chunk 6 ─┐
Chunk 7 ─┴─→ Chunk 8 ─┬─→ Chunk 9
                      └─→ Chunk 10
```

Chunks 5, 6, 7 may run in parallel with each other and with Chunk 1 (they touch disjoint code). Chunk 4 fans in from Chunks 2 + 3. Chunks 9 + 10 fan in from Chunk 8. No backward references; no orphaned deferrals.

**Phase boundaries.**

- **Phase A (serial, ~1 to 2 weeks):** Chunk 1 alone. Both MVPs block on file delivery being consumable (schema in main, service interface stable, S3 IAM in place).
- **Phase B (parallel, ~3 to 5 weeks):** Chunks 2-10. The 42 Macro track is Chunks 2 + 3 + 4 + 5 (Chunk 5 may run in parallel with all three). The Support Agent track is Chunks 6 + 7 + 8 + 9 + 10. The two tracks share only Chunk 1's outputs.

## 5. Per-chunk detail

### Chunk 1 — File delivery service (table + service + sweeper, no consumer routes)

**Phase:** A (serial). **Predecessors:** Foundation refactor (shipped). **LOC estimate:** ~860. **Spec sections:** §6.1.1, §6.1.2, §6.1.2b, §6.1.3, §6.1.4, §6.1.5b.

**Module shape.**
- *Public interface this chunk exposes:* `fileDeliveryService` with four methods — `upload(input)`, `issueSignedUrl(artifactId, organisationId, options?)`, `listForRun(agentRunId, organisationId)`, `deleteByRun(agentRunId, organisationId)`. The `run_artifacts` Drizzle schema (read by Chunks 2, 3, 4). The `phase1.file_delivery.uploaded` and `phase1.file_delivery.expired` events on the canonical event registry. One internal endpoint for Option A `POST /api/internal/run-artifacts/finalize` (or Option B `POST /api/internal/run-artifacts/upload`).
- *What stays hidden behind it:* S3 client construction, retain-until math, content-hash derivation, storage-key path construction (`orgs/{org_id}/runs/{run_id}/{artifact_kind}/{content_hash}.{ext}`), the retention sweeper job's batching loop, the `23505 → 200` idempotent-hit translation, the `wasReplay` boolean derivation.

**Boundary with Chunk 2.** Chunk 1 implements `issueSignedUrl()` as a service method but does NOT expose it over HTTP and does NOT emit `phase1.file_delivery.signed_url_issued`. Chunk 2 owns the first public caller (`POST /api/run-artifacts/:id/signed-url`) and the `signed_url_issued` event emit. This prevents the event from being emitted at both layers. Chunk 1's only emitted events are `phase1.file_delivery.uploaded` and `phase1.file_delivery.expired`.

**Files to create or modify.**

| File | Change | LOC |
|---|---|---|
| `migrations/<next-available>_run_artifacts.sql` + `.down.sql` | New table + composite partial unique index `run_artifacts_run_kind_hash_unique` + RLS policy `org_isolation`. Number assigned at chunk-build time. | +60 |
| `server/db/schema/runArtifacts.ts` | New Drizzle schema | +50 |
| `server/services/fileDeliveryService.ts` | New service: upload, issueSignedUrl, listForRun, deleteByRun | +280 |
| `server/services/__tests__/fileDeliveryServicePure.test.ts` | Pure-function tests: storage-key derivation, signed-URL TTL math, retain-until calculation | +120 |
| `server/services/__tests__/fileDeliveryService.integration.test.ts` | Integration test: upload + signed URL + download round-trip against local S3 mock; duplicate upload returns existing artifactId with `wasReplay: true` | +120 |
| `server/config/rlsProtectedTables.ts` | Register `run_artifacts` per INV-6 | +1 |
| `worker/src/lib/uploadArtifact.ts` | Worker-side upload helper (Option A direct or Option B proxy depending on IAM availability) | +80 |
| `server/jobs/runArtifactsRetentionSweepJob.ts` | New pg-boss job for daily sweep of `retain_until < now()` | +60 |
| `server/routes/internal/runArtifactsFinalize.ts` (Option A) OR a finalize handler colocated within `fileDeliveryService` (Option B) | Internal route called from the worker after S3 PUT completes (Option A); or main-app proxy upload handler (Option B) | +60 |
| `shared/types/runTraceEvents.ts` | Add Zod members for `phase1.file_delivery.uploaded`, `phase1.file_delivery.expired` (per spec §3.5 registry) | +30 |

**Total: ~860 LOC** (spec §6.1.6 totals ~710 because some routes are deferred to Chunk 2; the +150 here covers the sweeper job + finalize handler + Zod event additions, ~150 of which is event-schema scaffolding shared with Chunks 2, 3).

**Contracts.**

```ts
// shared/types/runArtifact.ts (re-exported from server/db/schema/runArtifacts.ts)
export interface RunArtifact {
  id: string;
  organisationId: string;
  agentRunId: string | null;       // nullable — see partial-on-NOT-NULL note
  ieeRunId: string | null;
  artifactKind: 'report' | 'transcript' | 'media' | 'attachment' | 'log';
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;             // sha256 hex
  storageProvider: 's3' | 'gcs' | 'r2';
  storageKey: string;
  storageRegion: string | null;
  retainUntil: Date | null;
  downloadCount: number;
  createdAt: Date;
}

// fileDeliveryService.ts public interface
export interface UploadInput {
  organisationId: string;
  agentRunId: string;
  ieeRunId?: string;
  artifactKind: RunArtifact['artifactKind'];
  displayName: string;
  mimeType: string;
  contentBuffer: Buffer | NodeJS.ReadableStream;
  retainUntil?: Date;
}

export interface UploadResult {
  artifactId: string;
  contentHash: string;
  sizeBytes: number;
  wasReplay: boolean;              // true on idempotent hit via §6.1.2 composite index
}

export interface SignedUrlOptions {
  expiresIn?: number;              // seconds; default 7 days for report, 24h for media
  inlineDisposition?: boolean;
}
```

**Error handling.** Service throws structured errors as `{ statusCode, message, errorCode }`:
- S3 upload exhaustion (after `withBackoff` retry) → `{ statusCode: 502, errorCode: 's3_upload_failed' }`. Caller (Chunk 3 PDF render, Chunk 1 worker upload) bubbles to pg-boss for retry.
- DB unique-violation `23505` on `run_artifacts_run_kind_hash_unique` → caught internally, returns existing row with `wasReplay: true`. NEVER bubbled as 500.
- `agent_run_id` references a soft-deleted or hard-deleted run → `{ statusCode: 410, errorCode: 'run_gone' }`.
- Insufficient principal scope (RLS denies the read in `listForRun`) → empty array, not a 403 (RLS is fail-closed; no information leak).

**Idempotency posture.** Per §10.1: **key-based** on `(organisation_id, agent_run_id, artifact_kind, content_hash)` via composite partial unique index. **Retry classification:** `safe`. **HTTP mapping for `23505`:** 200 with existing `artifactId` and `wasReplay: true` (idempotent hit), never 500.

**Invariants touched.** INV-5 (additive), INV-6 (RLS), INV-7 (`.down.sql`), INV-12 (content-hashed delivery), INV-16 (event registry).

**Events emitted (verbatim from §3.5).**
- `phase1.file_delivery.uploaded` — emitted by `fileDeliveryService.upload` after the `run_artifacts` insert returns. Payload: `{artifactId, organisationId, agentRunId?, ieeRunId?, contentHash, sizeBytes, storageProvider, storageKey, mimeType, artifactKind, wasReplay: boolean}`.
- `phase1.file_delivery.expired` — emitted by the daily sweeper job. Payload: `{artifactId, organisationId, retainUntil, ageDays}`.

**RLS + permissions.** `run_artifacts` registered in `server/config/rlsProtectedTables.ts`. Standard `org_isolation` RLS policy. Service uses `withOrgTx(organisationId, ...)` for every read/write. Internal finalize endpoint authenticates via worker shared secret (existing pattern); worker has write-only IAM on S3 (Option A) or no IAM (Option B).

**Dependencies.** None (Phase A serial). Foundation refactor's `agent_runs` and `iee_runs` tables are read-only references for FK targets.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` (verify migration file shape)
- `npm run build:server`
- `npx vitest run server/services/__tests__/fileDeliveryServicePure.test.ts`
- `npx vitest run server/services/__tests__/fileDeliveryService.integration.test.ts`

**Acceptance gate criteria (from spec §9.3).**
- `run_artifacts` table created and RLS-protected; composite partial unique index `run_artifacts_run_kind_hash_unique` enforces per-(org, run, kind, hash) idempotency.
- `fileDeliveryService` is the only service-layer path for artifact upload and signed-URL issuance. (Chunk 2 owns the HTTP route that calls `issueSignedUrl()` and emits `signed_url_issued`; Chunk 1 ships the service method only.)
- Retention sweep daily job hard-deletes `run_artifacts` rows with `retain_until < now()`, deletes the corresponding S3 object, emits `phase1.file_delivery.expired`, and `fileDeliveryService.listForRun` no longer returns the swept artifact.
- Duplicate upload idempotency: calling `fileDeliveryService.upload` a second time for the same (org, run, kind, hash) returns the existing `artifactId` (no new row) and emits `phase1.file_delivery.uploaded` with `wasReplay: true`.

**Doc-sync targets.**
- `architecture.md` § Shared Infrastructure — add `fileDeliveryService` row to the "use these" table.
- `docs/capabilities.md` — append a "File delivery for agent runs" entry under Product Capabilities (vendor-neutral wording).
- `KNOWLEDGE.md` — append a Pattern entry: "Worker-internal `iee_artifacts` vs customer-delivery `run_artifacts` source-of-truth precedence."
- `replit.md` — list S3 bucket + IAM as a runtime-env precondition if `S3_ARTIFACTS_BUCKET` is a new env var.
- `npm run code-graph:rebuild` after merge.

---

### Chunk 2 — Run artifact read surface (artifact list + download proxy + signed-URL mint routes)

**Phase:** B (parallel). **Predecessors:** Chunk 1. **LOC estimate:** ~320. **Spec sections:** §4.5.2, §4.5.3, §6.1.5, §6.1.5b.

**Module shape.**
- *Public interface this chunk exposes:* Three HTTP routes — `GET /api/agent-runs/:runId/artifacts` (list), `GET /api/run-artifacts/:id/download` (download proxy with attribution), `POST /api/run-artifacts/:id/signed-url` (signed-URL mint for share-link). The `runArtifacts.ts` API client wrapper consumed by Chunk 4.
- *What stays hidden behind it:* the `agentRunVisibility.canView()` integration, the proxy-vs-direct attribution branch, the `phase1.file_delivery.signed_url_issued` and `phase1.file_delivery.downloaded` event emit timing, request-source discriminator derivation, S3 stream-to-response wiring.

**Files to create or modify.**

| File | Change | LOC |
|---|---|---|
| `server/routes/agentRuns.ts` | Add `GET /api/agent-runs/:runId/artifacts` — wraps `withOrgTx(req.orgId!, ...)`; returns artifact metadata only (no embedded URLs); RLS on `run_artifacts` enforces tenant scope | +40 |
| `server/routes/runArtifacts.ts` | New route file — `GET /api/run-artifacts/:id/download` (download proxy, emits `phase1.file_delivery.downloaded`) and `POST /api/run-artifacts/:id/signed-url` (signed-URL mint, emits `phase1.file_delivery.signed_url_issued`); both wrap `withOrgTx`, both call `agentRunVisibility.canView(req.user, artifact.agentRunId)` before returning bytes or a URL | +120 |
| `server/routes/__tests__/agentRunsArtifactsRoute.integration.test.ts` | Single integration test: list + download proxy + signed-URL mint round-trip | +90 |
| `client/src/lib/api/runArtifacts.ts` | API client wrapper consumed by Chunk 4 | +40 |
| `shared/types/runTraceEvents.ts` | Add Zod members for `phase1.file_delivery.signed_url_issued` and `phase1.file_delivery.downloaded` | +30 |

**Contracts.**

```ts
// GET /api/agent-runs/:runId/artifacts
// Response: { artifacts: RunArtifact[] } — metadata only, NO embedded URLs

// POST /api/run-artifacts/:id/signed-url
// Body: { requestSource: 'run_trace_panel' | 'pdf_embed' | 'copy_link' | 'api_consumer' }
// Response: { url: string; expiresAt: string }
// Side-effect: emits phase1.file_delivery.signed_url_issued

// GET /api/run-artifacts/:id/download
// Response: streamed bytes with Content-Type and Content-Disposition headers
// Side-effect: emits phase1.file_delivery.downloaded with byteCount and durationMs

// shared/types/runTraceEvents.ts (additive Zod members)
const Phase1FileDeliveryDownloaded = z.object({
  type: z.literal('phase1.file_delivery.downloaded'),
  artifactId: z.string().uuid(),
  organisationId: z.string().uuid(),
  downloaderUserId: z.string().uuid().nullable(),
  byteCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
```

**Error handling.**
- Artifact not found → `{ statusCode: 404, errorCode: 'artifact_not_found' }`.
- `agentRunVisibility.canView()` returns false → `{ statusCode: 403, errorCode: 'forbidden' }` (no row leak).
- S3 stream interruption mid-download → `phase1.file_delivery.downloaded` is NOT emitted (only emit on successful byte completion).
- Signed-URL mint failure (S3 client error) → `{ statusCode: 502, errorCode: 's3_signed_url_failed' }`.

**Idempotency posture.** `signed_url_issued` and `downloaded` events are **non-idempotent (intentional)** — each call mints a fresh URL or initiates a discrete download; emit per call. The artifact row write is owned by Chunk 1; Chunk 2 is read-only on `run_artifacts`.

**Invariants touched.** INV-12 (attribution boundary on download proxy vs Copy-link), INV-16 (event names verbatim), INV-17 (Run Trace surface).

**Events emitted (verbatim from §3.5).**
- `phase1.file_delivery.signed_url_issued` — emitted by `POST /api/run-artifacts/:id/signed-url` after signing. Payload: `{artifactId, organisationId, expiresAt, inlineDisposition, requestSource}`.
- `phase1.file_delivery.downloaded` — emitted by `GET /api/run-artifacts/:id/download` ONLY (proxy path). Payload: `{artifactId, organisationId, downloaderUserId?, byteCount, durationMs}`. Per §6.1.5b: downloads via copied URLs DO NOT emit this event — that is the explicit attribution trade-off.

**RLS + permissions.** `agentRunVisibility.canView(req.user, artifact.agentRunId)` is the per-request gate (existing helper at `server/lib/agentRunVisibility.ts`). RLS on `run_artifacts` is the second layer. No new permission tile; per OD 11.6 deferred to Phase 2 if customer feedback warrants.

**Dependencies.** Chunk 1 (`fileDeliveryService.listForRun`, `fileDeliveryService.issueSignedUrl`).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client`
- `npx vitest run server/routes/__tests__/agentRunsArtifactsRoute.integration.test.ts`

**Acceptance gate criteria (from spec §9.3).**
- Preview / Download from the Run Trace artifacts panel emits `phase1.file_delivery.downloaded` (proxy path); Copy-link emits `phase1.file_delivery.signed_url_issued` only and downloads via the copied URL DO NOT emit `downloaded`.

**Doc-sync targets.**
- `architecture.md` § Routes — add row for `runArtifacts.ts`.
- `npm run code-graph:rebuild` after merge.

---

### Chunk 3 — PDF report generation (deterministic render + ieeRunCompletedHandler integration)

**Phase:** B (parallel). **Predecessors:** Chunk 1. **LOC estimate:** ~512. **Spec sections:** §4.4.1, §4.4.2, §4.4.3, §4.4.4, §4.6.1.

**Module shape.**
- *Public interface this chunk exposes:* `reportRenderingService.renderMacroReportPdf(input: MacroReportInput): Promise<Buffer>` (returns the normalised PDF bytes). The extension point in `ieeRunCompletedHandler.ts` (one new branch that fires after happy-path 42 Macro completion).
- *What stays hidden behind it:* `@react-pdf/renderer` integration, the `MacroReport.tsx` JSX template, the post-render normalization step (zero `/CreationDate` and `/ModDate`, sort xref deterministically, strip `/ID` array), the `withBackoff` retry wrapper around the render+upload pair, the failure-event emit-point timing.

**Files to create or modify.**

| File | Change | LOC |
|---|---|---|
| `package.json` | Pin `@react-pdf/renderer` to exact version (no caret); record version in service for Producer field | +2 |
| `server/services/reportRenderingService.ts` | New service: `renderMacroReportPdf(input)`; calls `@react-pdf/renderer`, applies normalization, returns Buffer | +200 |
| `server/services/reportTemplates/MacroReport.tsx` | React component for the PDF template (cover, exec summary, full analysis, transcript excerpt) | +180 |
| `server/services/__tests__/reportRenderingServicePure.test.ts` | Pure-function tests: golden PDF byte check, content-hash determinism across re-renders | +80 |
| `server/jobs/ieeRunCompletedHandler.ts` | Add 42 Macro branch: render PDF then upload via `fileDeliveryService.upload`. Existing handler — extended only. | +30 |
| `shared/types/runTraceEvents.ts` | Add Zod members for `phase1.macro.report_rendering_failed` and `phase1.macro.artifact_upload_failed` | +20 |

**Total: ~512 LOC.**

**Contracts.**

```ts
// server/services/reportRenderingService.ts
export interface MacroReportInput {
  organisationId: string;
  agentRunId: string;
  ieeRunId: string;
  date: string;                    // ISO date for cover
  source: { videoTitle: string; publishedDate: string; sourceUrl: string };
  executiveSummary: string[];      // 3 to 5 bullets
  fullAnalysis: { heading: string; body: string }[];
  transcriptExcerpt: string | null;
  pdfRendererVersion: string;      // pinned; recorded in PDF Producer field
}

export interface ReportRenderingService {
  renderMacroReportPdf(input: MacroReportInput): Promise<Buffer>;
}
```

**Determinism contract (spec §4.4.3, mandatory).**

1. `@react-pdf/renderer` is pinned to an exact version in `package.json` (no caret). The version is recorded in the rendered PDF metadata (`Producer` field).
2. After `@react-pdf/renderer` returns raw bytes, the service applies post-render normalization: zeroes `/CreationDate` and `/ModDate`, sorts the object stream's xref table deterministically, strips the `/ID` array.
3. The hash recorded in `run_artifacts.content_hash` is the SHA-256 of the normalised bytes. The bytes uploaded to S3 are also the normalised bytes.
4. `reportRenderingServicePure.test.ts` includes a golden-byte assertion: rendering the same `MacroReportInput` twice produces an identical Buffer.

**Error handling.**
- Render failure (template error, library exception) → `{ statusCode: 500, errorCode: 'pdf_render_failed' }`. `ieeRunCompletedHandler` catches and bubbles to pg-boss (existing 3-attempt exponential backoff).
- Upload failure (after `withBackoff` exhaustion, delegated to Chunk 1) → `{ statusCode: 502, errorCode: 's3_upload_failed' }`. Same pg-boss retry path.
- Render succeeds, upload fails → no `run_artifacts` row inserted (Chunk 1 only inserts after S3 PUT returns 200). On retry exhaustion, the run completes without the report row and emits `phase1.macro.artifact_upload_failed`. The transcript artifact is still delivered (it does not depend on the report).
- Render succeeds, upload retried, hits Chunk 1's idempotent-hit path → emits `phase1.file_delivery.uploaded` with `wasReplay: true` and proceeds normally.

**Idempotency posture.** `safe`. The handler can be invoked unconditionally for the same `agent_run_id`; a duplicate invocation finds the existing `run_artifacts` row via Chunk 1's composite partial unique index, returns `wasReplay: true`, and exits. No work is duplicated, no row is overwritten.

**Invariants touched.** INV-1 (no regression on existing 42 Macro runs — additive only), INV-12 (content-hashed delivery via Chunk 1), INV-16 (event names verbatim).

**Events emitted (verbatim from §3.5).**
- `phase1.macro.report_rendering_failed` — emitted by `reportRenderingService` after retry exhaustion. Payload: `{agentRunId, ieeRunId, attemptCount, lastError}`.
- `phase1.macro.artifact_upload_failed` — emitted indirectly via Chunk 1's `fileDeliveryService.upload` after retry exhaustion. Payload: `{agentRunId, ieeRunId, artifactKind, lastError}`.

**RLS + permissions.** Service runs server-side in main app (not worker), invoked by pg-boss. No HTTP surface; no permission gate beyond the run's own RLS scope (handler reads `agent_runs.organisation_id` and threads it through `withOrgTx`).

**Dependencies.** Chunk 1 (`fileDeliveryService.upload`, `phase1.file_delivery.uploaded` event).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/reportRenderingServicePure.test.ts`

**Acceptance gate criteria (from spec §9.1).**
- PDF report renders correctly for the smoke-test scenario, byte-deterministic across re-runs after the §4.4.3 normalization step (timestamps zeroed, xref sorted, `/ID` stripped, library version pinned).
- PDF + transcript artifacts uploaded to S3 with signed URLs (Chunk 1's surface).
- Failure-path renderers visible in Run Trace: `phase1.macro.report_rendering_failed` and `phase1.macro.artifact_upload_failed` (rendering owned by Chunk 4; emission owned here).

**Doc-sync targets.**
- `architecture.md` § Key files per domain — note `reportRenderingService.ts` under "PDF generation".
- `KNOWLEDGE.md` — append a Pattern entry: "@react-pdf/renderer determinism contract: pinned version + post-render normalization is mandatory for content-hashable output."

---

### Chunk 4 — 42 Macro Run Trace UI (artifact panel + headline + failure renderers)

**Phase:** B (parallel). **Predecessors:** Chunks 2 + 3. **LOC estimate:** ~200. **Spec sections:** §4.5.1, §4.5.2, §4.5.3, §5.6.3 (failure renderers cross-reference).

**Module shape.**
- *Public interface this chunk exposes:* `RunTraceArtifactsPanel` React component (consumed by the existing Run Trace view), `RunTraceHeadline` extension (artifact-ready badge), `MacroFailureRenderers` (event renderer registrations consumed by the existing Run Trace event renderer registry).
- *What stays hidden behind it:* artifact-fetch state machine, signed-URL minting on demand vs eager, error-state copy, `Copy link` clipboard wiring, `Preview` PDF embed integration with the existing `PDFEmbed` primitive.

**Files to create or modify.**

| File | Change | LOC |
|---|---|---|
| `client/src/components/run-trace/RunTraceArtifactsPanel.tsx` | New component: lists artifacts with Preview/Download/Copy link affordances | +120 |
| `client/src/components/run-trace/RunTraceHeadline.tsx` | Extend existing component with artifact-ready badge | +20 |
| `client/src/components/run-trace/MacroFailureRenderers.tsx` | Renderers for `phase1.macro.report_rendering_failed` and `phase1.macro.artifact_upload_failed` (red icon + retry-context summary) | +60 |

**Total: ~200 LOC.** No frontend component tests per the project's testing posture.

**Contracts.** Consumes Chunk 2's API client (`runArtifacts.ts`) — no new HTTP surface.

**Error handling.** Standard React error boundaries; failed artifact list shows a single inline retry affordance. No silent error swallow.

**Idempotency posture.** N/A (read-only UI; mint and download are owned by Chunk 2 routes).

**Invariants touched.** INV-1 (no regression on existing 42 Macro runs — additive UI), INV-17 (Run Trace surface).

**Events emitted.** None — this chunk renders events emitted by Chunks 1, 2, 3.

**RLS + permissions.** N/A (UI-layer).

**Dependencies.** Chunk 2 (artifact list + signed-URL mint API), Chunk 3 (failure events).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Acceptance gate criteria (from spec §9.1).**
- Run Trace headline shows "Report ready · Download".
- Artifacts panel renders below the tool tree with Preview / Download / Copy link affordances.
- Both `phase1.macro.report_rendering_failed` and `phase1.macro.artifact_upload_failed` render inline in the Run Trace tree-of-decisions view.

**Doc-sync targets.**
- `npm run code-graph:rebuild` after merge.

---

### Chunk 5 — 42 Macro production hardening (failure-mode branches + stuck-run detector)

**Phase:** B (parallel). **Predecessors:** none (independent of Chunk 1). **LOC estimate:** ~245. **Spec sections:** §4.6.1, §4.6.2, §4.6.3.

**Module shape.**
- *Public interface this chunk exposes:* explicit failure-mode branches in `worker/src/browser/macroExecutor.ts` (or equivalent), `staleMacroRunDetector` registered in the existing `workspaceHealth/detectors/index.ts`, the `phase1.macro.run_stuck` and `phase1.macro.login_failed` log codes.
- *What stays hidden behind it:* `MACRO_STUCK_THRESHOLD_MS` constant (default 15 minutes), the stuck-step detection predicate (per-step timestamp comparison), the per-failure-mode admin-alert payload construction.

**Files to create or modify.**

| File | Change | LOC |
|---|---|---|
| `worker/src/browser/macroExecutor.ts` (or equivalent existing file) | Add explicit failure-mode branches per spec §4.6.1 table (login change, page structure change, transcription failure, S3 upload failure, provider rate limit) | +60 |
| `server/services/workspaceHealth/detectors/staleMacroRunDetector.ts` | New detector: identifies 42 Macro runs stuck on the same step beyond `MACRO_STUCK_THRESHOLD_MS` | +80 |
| `server/services/workspaceHealth/detectors/__tests__/staleMacroRunDetectorPure.test.ts` | Pure-function tests for stuck-step threshold logic | +80 |
| `server/services/workspaceHealth/detectors/index.ts` | Register the new detector | +5 |
| `shared/types/runTraceEvents.ts` | Add Zod members for `phase1.macro.run_started`, `phase1.macro.run_completed`, `phase1.macro.artifact_delivered`, `phase1.macro.login_failed`, `phase1.macro.run_stuck` | +25 |

**Path correction note.** Spec §4.6.2 references `server/services/systemMonitoring/detectors/`. That path does not exist; the existing detector pattern lives at `server/services/workspaceHealth/detectors/`. This chunk uses the existing path; no functional change.

**Contracts.**

```ts
// server/services/workspaceHealth/detectors/staleMacroRunDetector.ts
export interface StaleMacroRunFinding {
  type: 'macro.run_stuck';
  agentRunId: string;
  ieeRunId: string;
  organisationId: string;
  currentStep: string;
  stuckSinceMs: number;            // wall-clock duration on the same step
  thresholdMs: number;             // MACRO_STUCK_THRESHOLD_MS
}

export const staleMacroRunDetector: WorkspaceHealthDetector = { ... };
```

**Error handling.**
- Login failure (selector miss, post-login probe fails) → run terminates with `failureReason: 'login_failed'`; emits `phase1.macro.login_failed`; admin notified via existing alert path.
- Page structure change (extract returns no candidates) → `failureReason: 'page_structure_change'`; admin notified.
- Transcription failure (Whisper retry exhausted) → run continues with `transcript: null`; report says "Transcription unavailable; raw audio file is attached".
- S3 upload failure (Chunk 1's surface, exhausted) → `failureReason: 'artifact_upload_failed'`; admin notified; no partial `run_artifacts` row persists.
- Provider rate limit → existing `withBackoff`; surfaces as "rate-limited" in Run Trace.
- Failures use the `shared/iee/failure.ts` helper per architecture rules (no inline `{ failureReason: '...' }` literals).

**Idempotency posture.** `staleMacroRunDetector` row write reuses existing detector idempotency in `workspaceHealth/detectors/` (state-based — detector finds are upserted by `(detectorType, runId)`). Failure-mode branches are state-based on existing `agent_runs.status` transitions.

**Invariants touched.** INV-1 (no regression — additive failure paths and detector), INV-3 (foundation primitives read-only), INV-16 (event names verbatim).

**Events emitted (verbatim from §3.5).**
- `phase1.macro.run_started` — emitted at 42 Macro agent run start.
- `phase1.macro.run_completed` — emitted at 42 Macro agent run completion.
- `phase1.macro.artifact_delivered` — emitted by `ieeRunCompletedHandler` after happy-path upload (overlaps with Chunk 3; this chunk is responsible for the verbatim event-type registration in `runTraceEvents.ts`, Chunk 3 calls `emit()`).
- `phase1.macro.login_failed` — emitted by 42 Macro browser worker on login exhaustion.
- `phase1.macro.run_stuck` — emitted by `staleMacroRunDetector`. Payload: `{agentRunId, ieeRunId, organisationId, currentStep, stuckSinceMs, thresholdMs}`.

**RLS + permissions.** Detector runs under admin connection (existing pattern in `workspaceHealth/`); writes findings rows scoped to `organisation_id`. Worker-side failure-mode branches inherit existing IEE worker auth.

**Dependencies.** None (independent of Chunk 1's file delivery surface). May be implemented first if Phase A delays.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/workspaceHealth/detectors/__tests__/staleMacroRunDetectorPure.test.ts`

**Acceptance gate criteria (from spec §9.1).**
- Login failure produces a clear failure mode in Run Trace and triggers an admin alert.
- Stale-run detector fires when a run is stuck.
- No regression on existing 42 Macro run wall-clock duration: 95th percentile end-to-end run time after MVP changes is within 1.25x of the pre-MVP baseline (baseline captured at the start of the build phase and recorded in `tasks/builds/phase-1-showcase-mvps/progress.md`).

**Doc-sync targets.**
- `architecture.md` § Workspace Health Detectors — list `staleMacroRunDetector`.
- `KNOWLEDGE.md` — append a Convention entry: "Detector pattern lives at `server/services/workspaceHealth/detectors/`, not `systemMonitoring/`."

---

### Chunk 6 — Support Agent skill: classify_ticket + Zod runtime contract (no cache)

**Phase:** B (parallel). **Predecessors:** none. **LOC estimate:** ~575. **Spec sections:** §5.4.1, §5.4.3.

**Module shape.**
- *Public interface this chunk exposes:* the `support.classify_ticket` skill (markdown spec + handler + pure helpers), the Zod schema `SupportClassifyTicketResultSchema` in `shared/types/supportClassifyTicketResult.ts`, the registry registration in `server/config/actionRegistry.ts` (Risk Tier 1, gateLevel `auto`), the `phase1.support.classify_failed` event payload contract.
- *What stays hidden behind it:* prompt-template construction, intent-enum scoring helpers, the LLM-router call shape, the malformed-output detection logic, the redacted-PII payload field for `classify_failed`.

**Files to create or modify.**

| File | Change | LOC |
|---|---|---|
| `server/skills/support/classify-ticket.md` | New skill spec (input_schema, output_schema, gate_level, idempotency: read_only) | +110 |
| `server/services/skillHandlers/supportClassifyTicket.ts` | LLM-backed classify implementation; calls LLM router; parses through Zod; on failure emits `phase1.support.classify_failed` and routes to escalation | +180 |
| `server/services/skillHandlers/supportClassifyTicketPure.ts` | Pure helpers: intent enum, scoring, prompt construction, malformed-output classification | +90 |
| `server/services/__tests__/supportClassifyTicketPure.test.ts` | Pure-function tests with fixture tickets including 3 malformed-output cases (null intent, out-of-range confidence, missing recommended_action) | +120 |
| `server/config/actionRegistry.ts` | Register `support.classify_ticket` with `riskTier: 1`, `gateLevel: 'auto'` | +15 |
| `server/db/schema/systemSkills.ts` | Register the new `support.classify_ticket` skill row (system-skill catalog) | +5 |
| `shared/types/supportClassifyTicketResult.ts` | Zod schema with strict enums, `confidence: z.number().min(0).max(1)`, `escalate_reason: z.string().nullable()` | +35 |
| `shared/types/runTraceEvents.ts` | Add Zod member for `phase1.support.classify_failed` and `phase1.support.ticket_classified` | +20 |

**Total: ~575 LOC.**

**Cache decision (OD 11.4 — DEFERRED).** This chunk does NOT ship a `support_skill_result_cache` table. Re-classification on a re-fetched ticket is acceptable for MVP cost (Sonnet classify cost is dominated by per-ticket draft cost; a stale cache is more harmful than a re-call). Phase 1.5 may merge into a generic skill-result cache. Deferred Items in spec §10.5 already records this.

**Contracts.**

```ts
// shared/types/supportClassifyTicketResult.ts
import { z } from 'zod';

export const SupportIntentSchema = z.enum([
  'account_question', 'billing_question', 'bug_report', 'feature_request',
  'how_to_question', 'complaint', 'cancellation_request', 'sales_inquiry', 'other',
]);

export const SupportUrgencySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const SupportRecommendedActionSchema = z.enum([
  'draft_reply', 'escalate_to_human', 'add_internal_note_only', 'close_as_no_action',
]);

export const SupportClassifyTicketResultSchema = z.object({
  intent: SupportIntentSchema,
  urgency: SupportUrgencySchema,
  recommended_action: SupportRecommendedActionSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  escalate_reason: z.string().nullable(),
});

export type SupportClassifyTicketResult = z.infer<typeof SupportClassifyTicketResultSchema>;
```

**Error handling.**
- LLM call failure (router error, timeout) → `{ statusCode: 502, errorCode: 'classify_llm_failed' }`. Caller (Chunk 8 agent loop) treats as low-confidence and routes to escalation.
- Zod parse failure on model output → handler does NOT throw; instead emits `phase1.support.classify_failed` with the raw model output stored under a redacted-PII payload field, returns a sentinel result `{ confidence: 0, recommended_action: 'escalate_to_human', escalate_reason: 'classification_parse_failed' }`. The agent loop sees the sentinel and routes to `add_internal_note + assign(human)` per spec §5.4.1.
- Skill never proceeds to drafting on a malformed classification.

**Idempotency posture.** `non-idempotent (intentional)` — each call is a fresh LLM request. Caller (Chunk 8) calls it at most once per ticket per agent run; the per-ticket atomic claim is the dedup mechanism upstream.

**Invariants touched.** INV-2 (no regression on canonical surfaces — read-only consumer), INV-9 (Risk Tier 1 inherited per rubric), INV-16 (event name verbatim).

**Events emitted (verbatim from §3.5).**
- `phase1.support.ticket_classified` — emitted on successful classification. Payload: `{ticketId, intent, urgency, confidence}`. Non-terminal.
- `phase1.support.classify_failed` — emitted on Zod parse failure. Payload: `{ticketId, parseError, rawModelOutputRedacted}`. Non-terminal at the per-ticket level (the next renderer is the escalation `ticket_terminal` event with `perTicketVerdict: 'escalated_to_human'` emitted by Chunk 8).

**RLS + permissions.** Skill handler runs under principal-scoped agent-execution context. Reads `canonical_tickets` and `canonical_ticket_messages` via existing `supportTicketService` (PR #277 surface) — Inherits the existing tenant-scope guard. No new permission tile.

**Dependencies.** None. Reads `canonical_tickets` (PR #277 schema). Calls LLM router (existing).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/supportClassifyTicketPure.test.ts`

**Acceptance gate criteria (from spec §9.2).**
- `support.classify_ticket` skill returns valid output for the regression set; classification accuracy meets the initial threshold (>= 85% per intent) OR a tuned-during-pilot threshold formally agreed with Product before lock-in. (Threshold validation owned by Chunk 9; this chunk delivers the skill that produces the inputs.)
- Classify-failure escalation path: a malformed model output emits `phase1.support.classify_failed` and routes the ticket to `add_internal_note + assign(human)` rather than proceeding to drafting. Covered by `supportClassifyTicketPure.test.ts` malformed-output fixtures.

**Doc-sync targets.**
- `docs/capabilities.md` § Skills Reference — add `support.classify_ticket` row (LLM, auto gate).
- `architecture.md` § Skill System — note new `support.classify_ticket` skill in the catalogue if a list exists.
- `KNOWLEDGE.md` — append a Pattern entry: "LLM skill output enforced via Zod parse + sentinel-result fallback on parse failure (avoids throw-on-malformed-output blocking the agent loop)."

---

### Chunk 7 — Support Agent install + record + master prompt (advisory lock + partial unique index)

**Phase:** B (parallel). **Predecessors:** none. **LOC estimate:** ~628. **Spec sections:** §5.3.1, §5.3.2, §5.3.5, §5.3.6.

**Module shape.**
- *Public interface this chunk exposes:* `supportAgentInstallService.install(subaccountId, orgId, actorUserId)` returning `{ subaccountAgentId }` or 409, the `POST /api/subaccounts/:subaccountId/support-agent/install` route, the system-agent `support-agent` row (seeded by migration), the master prompt at `server/prompts/support-agent-master.md`, the Zod-additive fields on `SupportInboxAgentConfig`, the `validatePromptOverride` pure helper.
- *What stays hidden behind it:* the advisory-lock key derivation (`hashtextextended((subaccount_id::text || ':' || system_agent_id::text)::text)`), the partial-unique-index DDL, the backfill UPDATE, the `23505 → 409` translation, the `applied_template_slug` write enforcement, the master-prompt placeholder substitution (`{{org_name}}`, `{{subaccount_name}}`, etc.), the forbidden-token regex set.

**Files to create or modify.**

| File | Change | LOC |
|---|---|---|
| `migrations/<next-available>_support_agent_install.sql` + `.down.sql` | (1) Additive `subaccount_agents.applied_template_slug text` column. (2) Backfill UPDATE from `system_agents.slug` for existing rows. (3) Partial unique index `subaccount_agents_support_agent_singleton_idx`. (4) Seed row in `system_agents` for `support-agent` slug. Number assigned at chunk-build time. | +90 |
| `server/db/schema/subaccountAgents.ts` | Drizzle schema: add `appliedTemplateSlug: text('applied_template_slug')` (nullable) | +3 |
| `server/services/supportAgentInstallService.ts` | New install service: advisory-lock + existence-check + INSERT with `applied_template_slug='support-agent'`; maps `23505` to `409 already_installed` | +120 |
| `server/services/__tests__/supportAgentInstall.integration.test.ts` | Integration test for the concurrent-install acceptance criterion (§9.2) — two concurrent install attempts for same subaccount → exactly one 200, one 409 | +90 |
| `server/routes/support/supportAgentInstallRoute.ts` | `POST /api/subaccounts/:subaccountId/support-agent/install`; calls `resolveSubaccount` then delegates to install service | +40 |
| `server/prompts/support-agent-master.md` | Master prompt markdown per spec §5.3.2; `version: 1` frontmatter | +120 |
| `shared/types/supportInboxAgentConfig.ts` | Additive Zod fields: `minConfidence?: number` (default 0.8), `voiceProfile?: 'casual' \| 'neutral' \| 'formal' \| 'custom'` (default `'neutral'`), `escalationCategories?: string[]` (default `[]`) | +15 |
| `server/services/promptOverridePure.ts` | `validatePromptOverride` pure helper: 500-char cap + forbidden-token scan | +60 |
| `server/services/__tests__/promptOverridePure.test.ts` | Tests for forbidden-token scan + length cap | +60 |
| `scripts/gates/verify-support-agent-skill-set.sh` | Static check (grep against the seed migration's `default_system_skill_slugs` array): fails build if `web_search` or `search_knowledge_base` appears, or if `applied_template_slug` is mutated outside the install service | +30 |

**Total: ~628 LOC.** Slight overage on the spec's ~500 (spec counted prompt-override controls under §5.6.4 separately; consolidated here for module cohesion).

**Contracts.**

```ts
// server/services/supportAgentInstallService.ts
export interface SupportAgentInstallService {
  install(input: {
    subaccountId: string;
    organisationId: string;
    actorUserId: string;
  }): Promise<{ subaccountAgentId: string }>;
}

// On 23505 from partial unique index, throws { statusCode: 409, errorCode: 'already_installed', message: 'Support Agent already installed for this subaccount' }
```

**Migration DDL (per spec §5.3.1).**

```sql
-- migrations/<next-available>_support_agent_install.sql
ALTER TABLE subaccount_agents ADD COLUMN applied_template_slug text;

UPDATE subaccount_agents sa
SET    applied_template_slug = sysa.slug
FROM   agents a, system_agents sysa
WHERE  sa.applied_template_id = sysa.id
  AND  a.id = sa.agent_id
  AND  a.system_agent_id = sysa.id
  AND  sa.applied_template_slug IS NULL;

CREATE UNIQUE INDEX subaccount_agents_support_agent_singleton_idx
ON subaccount_agents (subaccount_id)
WHERE is_active = true
  AND applied_template_slug = 'support-agent';

-- seed support-agent system_agents row (slug='support-agent', master_prompt loaded from server/prompts/support-agent-master.md, default_system_skill_slugs per spec §5.3.1, model 'claude-sonnet-4-6')
INSERT INTO system_agents (...) VALUES (...) ON CONFLICT (slug) DO NOTHING;
```

`.down.sql` reverses: DROP INDEX, ALTER TABLE DROP COLUMN, DELETE FROM system_agents WHERE slug='support-agent'.

**Error handling.**
- Two concurrent installs: advisory lock serialises; second transaction sees existing row in existence check, returns 409. If both somehow proceed past the lock (impossible under the ordering above, but defence in depth), the partial unique index rejects with `23505`; service catches and returns 409.
- Migration failure: `.down.sql` reverts table + index + seed row in a single transaction.
- Prompt override rejection (length or forbidden token): `validatePromptOverride()` returns `{ valid: false, reason }` and the route returns `{ statusCode: 422, errorCode: 'prompt_override_invalid', message: <reason> }`.
- Slug mutation outside install service: build-time grep gate fails CI.

**Idempotency posture.** **key-based** on `(subaccount_id, applied_template_slug='support-agent', is_active=true)` via partial unique index; advisory lock `pg_advisory_xact_lock(hashtextextended((subaccount_id::text || ':' || system_agent_id::text)::text))` is the primary defence. `23505` → `409 already_installed`.

**Invariants touched.** INV-2 (no regression on canonical surfaces — additive only), INV-3 (foundation primitives read-only — install adds rows under existing schema rules), INV-5 (additive `applied_template_slug` column), INV-7 (`.down.sql` ships), INV-10 (Tier 6 default on `support.approve_draft` honoured by master prompt's gate-routing rules).

**Events emitted.** None directly. The first agent run after install emits `phase1.support.*` events; those are owned by Chunk 8.

**RLS + permissions.** `subaccount_agents` already RLS-protected (existing). Install route uses `requireSubaccountPermission('support.inbox.configure')` per OD 11.6 — install is treated as a configure-the-inbox-support-agent action against the existing tile, so no new permission surface ships in Phase 1. (A dedicated `support.agent.install` tile may be introduced in Phase 1.5 if customer feedback warrants finer-grained scoping; for MVP the configure tile is sufficient and avoids permission-tile churn.) `resolveSubaccount(req.params.subaccountId, req.orgId!)` per route convention. Audit log entry written to `audit_events` with diff (before / after).

**Dependencies.** None. Reads existing `system_agents`, `subaccount_agents`, `agents` schemas.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` (verify migration shape)
- `npm run build:server`
- `npx vitest run server/services/__tests__/supportAgentInstall.integration.test.ts`
- `npx vitest run server/services/__tests__/promptOverridePure.test.ts`
- `scripts/gates/verify-support-agent-skill-set.sh` is authored in this chunk but is CI-only — DO NOT run locally. CI invokes it on every PR.

**Acceptance gate criteria (from spec §9.2).**
- Support Agent record exists with locked master prompt and the 12 listed default skills.
- Default skill list grep check: `default_system_skill_slugs` for the Support Agent contains NO `web_search` and NO `search_knowledge_base`. `verify-support-agent-skill-set.sh` fails the build if either appears.
- Concurrent install race: two simultaneous install attempts of the Support Agent against the same `subaccount_id` return exactly one success (200) and one 409 with body `{ error: 'already_installed' }`. Advisory lock + partial unique index in §5.3.1 are both exercised by `supportAgentInstall.integration.test.ts`.

**Doc-sync targets.**
- `architecture.md` § Three-Tier Agent Model — note `applied_template_slug` column on `subaccount_agents`.
- `architecture.md` § Routes — add row for `supportAgentInstallRoute.ts`.
- `docs/capabilities.md` § Agency Capabilities — add Support Agent capability row (Outcome / Trigger / Deliverable).
- `KNOWLEDGE.md` — append a Pattern entry: "Singleton-agent-per-subaccount: advisory lock primary defence + partial unique index on `applied_template_slug` safety net (additive column + backfill in same migration)."
- `KNOWLEDGE.md` — append a Convention entry: "`applied_template_slug` is a stable install discriminator; never rewrite. Mutating it outside the install service is a CI gate failure."
- `npm run code-graph:rebuild` after merge.

---

### Chunk 8 — Support Agent execution loop (atomic claim + classify-draft-route + skill prompt polish)

**Phase:** B (parallel). **Predecessors:** Chunks 6 + 7. **LOC estimate:** ~980. **Spec sections:** §5.2, §5.3.3, §5.3.4, §5.3.7, §5.4.2, §5.4.4. **Delivery note:** may be delivered as one PR or split into two PRs (8A: execution loop core + atomic claim + terminal-event predicate + scheduling/webhook trigger; 8B: prompt polish for `support.propose_reply` and `support.find_customer_history` plus integration with approval routing). The split is at builder discretion based on PR-size limits.

**Module shape.**
- *Public interface this chunk exposes:* the `supportAgentExecutionService` invoked by pg-boss on schedule + webhook (Teamwork ticket.created). The atomic-claim helper `tryClaimTicket(runId, ticketId, orgId, claimTtlMinutes)`. The polished skill prompt templates for `support.propose_reply` and `support.find_customer_history`. The 7 Run Trace event types (`ticket_classified`, `classify_failed`, `draft_proposed`, `draft_dispatched`, `draft_blocked_by_policy`, `collision_skipped`, `ticket_terminal`).
- *What stays hidden behind it:* the per-ticket terminal-verdict state machine, the `support.list_open_tickets` predicate (terminal-event-against-`last_customer_message_at`), the per-(subaccount, inbox) `singleton: true` advisory lock on the pg-boss handler, the master-prompt placeholder substitution at run start, the per-ticket confidence-check + escalation routing, the autonomous-vs-assisted approval branching, the `agent_runs.controller_style = 'native'` enforcement.

**Files to create or modify.**

| File | Change | LOC |
|---|---|---|
| `server/services/supportAgentExecutionService.ts` | New service: orchestrates classify → draft → approval-routing per ticket | +280 |
| `server/services/supportAgentExecutionServicePure.ts` | Pure helpers: terminal-verdict enum, claim-predicate construction, list-open-tickets-filter SQL builder, master-prompt placeholder substitution | +140 |
| `server/services/__tests__/supportAgentExecutionServicePure.test.ts` | Pure tests for terminal-verdict enum, predicate construction, placeholder substitution | +120 |
| `server/services/__tests__/supportAgentClaimPure.test.ts` | Optimistic-claim predicate construction, TTL math, terminal-verdict enum coverage | +80 |
| `server/services/__tests__/supportAgentClaim.integration.test.ts` | Integration test: two concurrent agent runs targeting the same ticket; exactly one wins the claim, the other emits `phase1.support.collision_skipped` | +90 |
| `server/services/__tests__/supportListOpenTicketsPure.test.ts` | 4 fixtures per spec §5.3.4: terminal-event vs `last_customer_message_at` ordering (eligible / excluded / COALESCE fallback / degenerate-but-correct) | +80 |
| `server/services/skillHandlers/supportProposeReply.ts` (existing) | Polish prompt template with `{{voice_profile}}` injection, customer-history context, intent-specific drafting rules, confidence scoring | +50 |
| `server/services/skillHandlers/supportFindCustomerHistory.ts` (existing) | Polish prompt template for cross-CRM lookup with deterministic search + LLM summary | +40 |
| `server/jobs/supportAgentRunJob.ts` | New pg-boss job: triggered on schedule + on Teamwork webhook; `singleton: true` per `(subaccount_id, inbox_id)` | +60 |
| `shared/types/runTraceEvents.ts` | Add Zod members for `phase1.support.draft_proposed`, `draft_dispatched`, `draft_blocked_by_policy`, `collision_skipped`, `ticket_terminal` | +40 |

**Total: ~980 LOC.** Higher than spec's ~600 because spec rolled prompt-polish work and tests under different sections; consolidated here for module cohesion. Builder may split tests + polish into a sub-PR if PR-size limit is binding.

**Per-ticket execution flow (canonical, per spec §5.3.3).**

1. Loop body invokes `supportAgentExecutionService.processInbox(subaccountAgentRunId, inboxId)`.
2. Inside the loop, for each ticket from `support.list_open_tickets`:
   - **Atomic claim** via `tryClaimTicket` (optimistic predicate on `bot_claimed_at`). 0 rows = collision; emit `phase1.support.collision_skipped` (`reason: 'concurrent_claim'`) and skip.
   - **Human-activity collision check** immediately after claim: if `last_human_activity_at` is fresh (within inbox `agent_config.collisionWindow.minMinutesSinceHumanActivity`), release the claim, emit `phase1.support.collision_skipped` (`reason: 'human_active'`), and skip.
   - **Read thread** via `support.read_thread`.
   - **Classify** via `support.classify_ticket` (Chunk 6).
   - **Confidence check**: if confidence < `min_confidence`, call `support.add_internal_note` with classification reasoning + `support.assign(human)`, emit `phase1.support.ticket_terminal` (`perTicketVerdict: 'escalated_to_human'`), skip drafting.
   - **Account-issue check**: if intent ∈ {`account_question`, `billing_question`, `cancellation_request`}, call `support.find_customer_history` and incorporate into draft.
   - **Drafting**: call `support.propose_reply` to write a `canonical_ticket_drafts` row.
   - **Approval routing** per inbox `agent_config.mode`:
     - `autonomous`: call `support.approve_draft` → three-phase dispatch fires automatically (Tier 6 gate lowered by policy override).
     - `assisted`: leave the draft in `awaiting_review`; emit `phase1.support.draft_proposed` (`perTicketVerdict: 'drafted_for_review'`); existing review queue + Slack Block Kit takes over.
   - **Release claim** on terminal verdict.
3. Loop terminates when `support.list_open_tickets` returns empty or `agent_runs.token_budget` exhausted.

**Two distinct approval paths (spec §5.4.2 — single conditional, no branching code path).**

```ts
if (inbox.agent_config.mode === 'autonomous') {
  await skillExecutor.run('support.approve_draft', { draftId });   // Tier 6 lowered to auto by policy override
} else {
  // assisted: leave draft in awaiting_review; existing review queue + Slack Block Kit
  // No call to support.approve_draft; the human's approval flows through reviewItems / reviewAuditRecords
}
```

The `support.approve_draft` call only fires in autonomous mode. In assisted mode the agent never calls it — that's how the Tier 6 gate is honoured: by NOT crossing it.

**Run-loop idempotency boundary (spec §5.3.4 — `support.list_open_tickets` SQL).**

```sql
WHERE NOT EXISTS (
  SELECT 1
  FROM   agent_execution_events e
  WHERE  e.organisation_id = canonical_tickets.organisation_id
    AND  e.payload->>'ticketId' = canonical_tickets.id::text
    AND  e.event_type IN (
           'phase1.support.draft_proposed',
           'phase1.support.collision_skipped',
           'phase1.support.ticket_terminal'
         )
    AND  e.created_at >= COALESCE(canonical_tickets.last_customer_message_at, canonical_tickets.created_at)
)
```

Tested with 4 fixtures in `supportListOpenTicketsPure.test.ts` (eligible / excluded / COALESCE fallback / degenerate-but-correct).

**Atomic claim SQL.**

```sql
UPDATE canonical_tickets
SET    bot_claimed_at = now(),
       bot_claimed_by_run_id = :runId
WHERE  id = :ticketId
  AND  organisation_id = :orgId
  AND  (bot_claimed_at IS NULL
        OR bot_claimed_at < now() - interval ':claimTtlMinutes minutes')
RETURNING id;
```

0 rows returned = collision; emit `collision_skipped` and skip. Default TTL 15 minutes. Database `now()` evaluation is clock-skew safe.

**Error handling.**
- Skill execution exception (LLM error, network timeout) → emit `phase1.support.ticket_terminal` (`perTicketVerdict: 'escalated_to_human'`, `reason: 'skill_error'`), release claim, continue loop.
- Claim-acquire failure (DB error, not 0-rows) → bubble to pg-boss for retry.
- Three-phase dispatch failure (in autonomous mode) → existing `supportDraftDispatchService` error path; emit `phase1.support.draft_blocked_by_policy` if blocked by preflight; otherwise propagate.
- Per-ticket budget exhaustion → emit `phase1.support.ticket_terminal` (`perTicketVerdict: 'skipped_low_confidence'` if classification was the cost, else `'skipped_no_action_needed'`), continue.

**Idempotency posture.**
- **Per-ticket claim:** state-based (optimistic predicate on `bot_claimed_at`).
- **Outer loop:** safe-by-elimination (`support.list_open_tickets` filters via terminal-event predicate).
- **Per-ticket terminal events:** non-idempotent (intentional) — exactly one emit per ticket per agent run; predicate enforces single-emit.
- **pg-boss handler:** `singleton: true` per `(subaccount_id, inbox_id)` advisory lock.

**Invariants touched.** INV-2, INV-3, INV-8 (Native Controller default — `agent_runs.controller_style = 'native'` set at run create), INV-10 (Tier 6 default + autonomous-mode override), INV-11 (three-phase dispatch via `supportDraftDispatchService.dispatchDraft` only), INV-16, INV-17.

**Events emitted (verbatim from §3.5).**
- `phase1.support.ticket_classified` — non-terminal. Payload: `{ticketId, intent, urgency, confidence}`.
- `phase1.support.classify_failed` — non-terminal at per-ticket level (followed by `ticket_terminal` with `perTicketVerdict: 'escalated_to_human'`). Owned by Chunk 6 emission; this chunk consumes the sentinel result and emits the terminal.
- `phase1.support.draft_proposed` — terminal for draft branches. Payload: `{ticketId, draftId, controllerStyleAtPropose, riskTierResolved, perTicketVerdict: 'drafted_for_review' | 'drafted_and_dispatched'}`.
- `phase1.support.draft_dispatched` — non-terminal at per-ticket level (logs three-phase dispatch step). Emitted by `supportDraftDispatchService` during the autonomous-mode dispatch.
- `phase1.support.draft_blocked_by_policy` — non-terminal. Payload: `{ticketId, draftId, blockingPolicy}`.
- `phase1.support.collision_skipped` — terminal. Payload: `{ticketId, reason: 'concurrent_claim' | 'human_active', lastHumanActivityAgo?, perTicketVerdict: 'skipped_collision'}`.
- `phase1.support.ticket_terminal` — terminal for non-draft, non-collision branches. Payload: `{ticketId, perTicketVerdict: 'escalated_to_human' | 'skipped_low_confidence' | 'skipped_no_action_needed', reason, claimReleasedAt}`.

Exactly one of {`draft_proposed`, `collision_skipped`, `ticket_terminal`} fires per ticket per agent run.

**RLS + permissions.** Service runs under principal-scoped agent-execution context. Reads/writes `canonical_tickets`, `canonical_ticket_drafts` via existing PR #277 services (no direct table writes). Writes to `agent_execution_events` via existing event-emission helper. `agent_runs.controller_style = 'native'` set at run create.

**Dependencies.** Chunk 6 (`support.classify_ticket` skill), Chunk 7 (`system_agents.support-agent` row + master prompt + Zod additive fields).

**Preflight verification (last_customer_message_at write path).** The terminal-event-anchored predicate in `support.list_open_tickets` uses `COALESCE(canonical_tickets.last_customer_message_at, canonical_tickets.created_at)` as the cut-off timestamp. Before relying on this in production, the builder MUST verify that Teamwork ingestion (PR #277) updates `canonical_tickets.last_customer_message_at` whenever an inbound customer message is inserted into `canonical_ticket_messages`. If that write is not present, Chunk 8 ships the update as part of the ingestion path (additive, no schema change) before wiring the predicate. Verification: grep PR #277's Teamwork ingestion service for an UPDATE on `canonical_tickets.last_customer_message_at`; if absent, add a single-statement update keyed on inbound customer message inserts, with a unit test that asserts the column moves forward when a new customer message arrives. This is non-negotiable — a stale `last_customer_message_at` collapses the outer-loop idempotency guarantee silently (the agent stops re-engaging tickets that have new customer messages).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/supportAgentExecutionServicePure.test.ts`
- `npx vitest run server/services/__tests__/supportAgentClaimPure.test.ts`
- `npx vitest run server/services/__tests__/supportAgentClaim.integration.test.ts`
- `npx vitest run server/services/__tests__/supportListOpenTicketsPure.test.ts`

**Acceptance gate criteria (from spec §9.2).**
- Support Agent run on a seeded inbox produces drafts in `canonical_ticket_drafts`.
- Assisted mode: drafts route to review queue and Slack Block Kit; human approval triggers three-phase dispatch.
- Autonomous mode: agent auto-approves drafts per inbox policy; three-phase dispatch fires without human.
- Collision avoidance: agent skips tickets where `last_human_activity_at` is within the configured window; emits `phase1.support.collision_skipped`.

**Doc-sync targets.**
- `architecture.md` § Skill System / Three-Tier Agent Model — note `supportAgentExecutionService` and the per-ticket atomic claim pattern.
- `KNOWLEDGE.md` — append a Pattern entry: "Per-ticket atomic claim via optimistic predicate on `bot_claimed_at`; TTL 15min; outer-loop idempotency via terminal-event-anchored `last_customer_message_at` filter."
- `KNOWLEDGE.md` — append a Convention entry: "Two distinct approval paths: assisted mode never calls `support.approve_draft` (the gate is honoured by NOT crossing it); autonomous mode calls it (gate lowered by policy override)."
- `npm run code-graph:rebuild` after merge.

---

### Chunk 9 — Support Agent eval and quality harness (regression set + thresholds + drift + admin page + CI gate)

**Phase:** B (parallel). **Predecessors:** Chunk 8. **LOC estimate:** ~1,091. **Spec sections:** §5.5.1, §5.5.2, §5.5.3, §5.5.4, §7.3.

**Module shape.**
- *Public interface this chunk exposes:* `supportEvalHarness.runOnce(input)` (returns scores + threshold pass/fail), the `support_eval_runs` table + Drizzle schema, `phase1.support.eval_drift_detected` event, the admin page `/operate/agents/support/evals`, the CI gate `verify-support-agent-eval-thresholds.sh`, the daily pg-boss job.
- *What stays hidden behind it:* judge-prompt construction, threshold-comparison math, drift detection (week-over-week delta), regression-set loading from Foundry export, manual-seed fallback, prompt-version + model-id + skill-template-hash triple-key derivation, the sub-2-row fail-open emit-point, the "fewer-than-2" CI gate-exit-0 logic.

**Files to create or modify.**

| File | Change | LOC |
|---|---|---|
| `migrations/<next-available>_support_eval_runs.sql` + `.down.sql` | New table + RLS policy `org_isolation` | +40 |
| `server/db/schema/supportEvalRuns.ts` | Drizzle schema | +60 |
| `server/services/supportEvalHarness.ts` | New service: load regression set, run classify, run draft, score | +250 |
| `server/services/supportEvalHarnessPure.ts` | Pure helpers: judge-prompt construction, threshold checks, drift math, prompt-version + model-id + skill-template-hash triple-key derivation, AND the two-row gate-decision pure function (`evaluateGateDecision(rows: SupportEvalRunSnapshot[]): GateVerdict`) consumed by the Bash gate. The Bash gate stays a thin wrapper: fetch rows, hand to the pure function, exit with its verdict. | +130 |
| `server/services/__tests__/supportEvalHarnessPure.test.ts` | Pure-function tests for thresholds, drift, judge-prompt construction, AND the two-row gate decision (fixtures: two-rows-both-pass, two-rows-both-fail-same-metric, two-rows-mixed, single-row, zero-rows). The Bash gate's logic must NOT live in Bash — it lives in `evaluateGateDecision` and is unit-tested here. | +175 |
| `server/config/rlsProtectedTables.ts` | Register `support_eval_runs` per INV-6 | +1 |
| `scripts/gates/verify-support-agent-eval-thresholds.sh` | CI-only static gate; fails build when two consecutive eval runs drop below thresholds (same metric); fails open under fewer than 2 rows | +60 |
| `client/src/pages/operate/SupportEvalsPage.tsx` | New admin page: latest results, regression-set browser, drift trend, failure-mode coverage | +200 |
| `server/routes/support/supportEvalsRoutes.ts` | New route group for the admin page | +80 |
| `server/jobs/supportEvalDailyJob.ts` | pg-boss job for daily drift run | +80 |
| `shared/types/runTraceEvents.ts` | Add Zod member for `phase1.support.eval_drift_detected` | +15 |

**Total: ~1,091 LOC.**

**Contracts.**

```ts
// server/db/schema/supportEvalRuns.ts (minimal shape per spec §7.3)
export const supportEvalRuns = pgTable('support_eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  classificationAccuracyPerIntent: jsonb('classification_accuracy_per_intent').notNull(),  // {intent: number}
  draftJudgeScoreAvg: numeric('draft_judge_score_avg', { precision: 4, scale: 2 }).notNull(),
  thresholdClassificationMin: numeric('threshold_classification_min', { precision: 4, scale: 2 }).notNull(),
  thresholdJudgeMin: numeric('threshold_judge_min', { precision: 4, scale: 2 }).notNull(),
  promptVersion: integer('prompt_version').notNull(),
  modelId: text('model_id').notNull(),
  skillTemplateHashes: jsonb('skill_template_hashes').notNull(),  // {classify: hash, propose_reply: hash, find_customer_history: hash}
  rowCount: integer('row_count').notNull(),  // regression-set size at this run
  partial: boolean('partial').notNull().default(false),  // true when LLM-call exhaustion left some scores unset; matches "no silent partial success" posture
});
```

**Regression-set fallback (spec §5.5.2).**

- **Sub-2-row state.** Gate exits 0 (fail-open) when fewer than two rows exist. Job emits `phase1.support.eval_drift_detected` with payload `{ reason: 'regression_set_unavailable', rowCount: <N> }` so the operator sees the silence in the Activity feed.
- **Stale-data state.** Regression set older than 90 days emits an Activity-feed warning at every CI run but does not block. Acceptance gate at lock-in time (per spec §8.5 step 5) requires a fresh export within the last 30 days.
- **Manual seed path.** If Foundry is permanently unavailable, support lead seeds 50 to 200 hand-curated tickets via a one-shot script. Eval surface shows "Manually seeded — last refreshed YYYY-MM-DD".

**Gate logic (CI-only).**

```bash
#!/usr/bin/env bash
# scripts/gates/verify-support-agent-eval-thresholds.sh
# Fetches the two most recent support_eval_runs ordered by run_at DESC.
# Hands the rows to evaluateGateDecision() in supportEvalHarnessPure.ts.
# Build fails iff the pure function returns { verdict: 'fail' }.
# The decision logic — "both rows below threshold for the SAME metric" / "fewer than 2 rows = fail-open" — lives in the pure function and is unit-tested in supportEvalHarnessPure.test.ts.
# The Bash script's only responsibilities: fetch rows from the DB, marshal to JSON, invoke a tiny Node entry point that calls evaluateGateDecision, exit with the returned code.
```

**Drift detection.** Splits time-series view per `(prompt_version, model_id, skill_template_hashes)` triple. Drift across versions is INFORMATIONAL; drift WITHIN a version against the same regression set is the alerting condition. Threshold-bump CI gate (§5.3.5) consumes the same comparison.

**Error handling.**
- LLM call exhaustion during eval → row inserted with partial scores + `partial = true` (the column is part of the `support_eval_runs` contract above; matches the "no silent partial success" rule); job logs warn; downstream gate treats `partial = true` rows as ineligible for the two-row gate decision (counts as "fewer than 2 rows" if both candidate rows are partial).
- Foundry export unreachable → fall back to manual seed; emit `eval_drift_detected` with `reason: 'regression_set_unavailable'`.
- DB write failure → pg-boss retries (existing 3-attempt exponential backoff).

**Idempotency posture.** **state-based** — pg-boss daily job is `singleton: true` per `organisation_id`; duplicate triggers no-op via the lock. Each run inserts a new `support_eval_runs` row with a unique `run_at`.

**Invariants touched.** INV-6 (RLS on new table), INV-7 (`.down.sql`), INV-15 (eval harness is part of acceptance), INV-16 (event name verbatim).

**Events emitted (verbatim from §3.5).**
- `phase1.support.eval_drift_detected` — emitted by `supportEvalDailyJob`. Not run-scoped (admin-only). Payload: `{evalRunId, accuracyDelta, judgeScoreDelta, threshold}` for normal drift; `{reason: 'regression_set_unavailable', rowCount: <N>}` for sub-2-row state.

**RLS + permissions.** `support_eval_runs` registered in `rlsProtectedTables.ts`. Admin page reads via service that wraps `withOrgTx`. `requireOrgPermission('support.evals.view')` (existing tile or org-admin-only).

**Dependencies.** Chunk 8 (consumes runtime classification scores; the harness re-runs the regression set via the same execution service).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client`
- `npm run db:generate`
- `npx vitest run server/services/__tests__/supportEvalHarnessPure.test.ts`

**Acceptance gate criteria (from spec §9.2).**
- Eval harness runs daily; results visible at `/operate/agents/support/evals`.
- Drift alert fires when classification accuracy drops > 10% week over week.
- Initial classification threshold (>= 85% per intent) OR a tuned-during-pilot threshold formally agreed with Product before lock-in.

**Doc-sync targets.**
- `architecture.md` § Quality Infrastructure — add `supportEvalHarness` and the gate script.
- `docs/capabilities.md` — Support Agent capability mentions "drift detection on classification quality" without naming internal tables.
- `KNOWLEDGE.md` — append a Pattern entry: "Eval-as-static-gate: CI gate fails build only when two consecutive runs sub-threshold for the same metric (avoids judge-variance noise); fewer-than-2-rows fail-open with `eval_drift_detected` activity emit."

---

### Chunk 10 — Support Agent UI surfaces (dashboard + inbox config tab + Run Trace event renderers)

**Phase:** B (parallel). **Predecessors:** Chunks 7 + 8. **LOC estimate:** ~550. **Spec sections:** §5.6.1, §5.6.2, §5.6.3, §5.6.4.

**Module shape.**
- *Public interface this chunk exposes:* `SupportAgentDashboard` page at `/operate/agents/support`, `InboxAgentConfigTab` extending PR #277 inbox config UI, `SupportEventRenderers` (registered with the existing Run Trace event renderer registry), `supportAgentRoutes.ts` for dashboard + config (placed under existing `server/routes/support/` group).
- *What stays hidden behind it:* per-inbox status pill rendering, mode-toggle write coalescing, per-(prompt-version, model-id) drift badge derivation, the 7 Run Trace renderer implementations (one per spec §5.6.3 event), the existing PR #277 inbox config component composition.

**Files to create or modify.**

| File | Change | LOC |
|---|---|---|
| `client/src/pages/operate/SupportAgentDashboard.tsx` | New page: per-inbox status pill, autonomous/assisted toggle, links to inbox detail + Run Trace history + eval drift indicator | +180 |
| `client/src/components/support/InboxAgentConfigTab.tsx` | Extends PR #277 inbox config. Fields: mode, collisionWindow, minConfidence, voiceProfile, promptOverride (uses `validatePromptOverride` from Chunk 7), escalationCategories | +150 |
| `client/src/components/run-trace/SupportEventRenderers.tsx` | Renderers for the 7 Run Trace event types in §5.6.3 (6 non-terminal/per-ticket events including `phase1.support.classify_failed` + the `phase1.support.ticket_terminal` terminal); admin-only `phase1.support.eval_drift_detected` is NOT rendered here | +160 |
| `server/routes/support/supportAgentRoutes.ts` | Routes for dashboard + config (placed under existing `server/routes/support/` group; no new `routes/operate/` directory) | +60 |

**Total: ~550 LOC.** No frontend component tests; the route module gets a single integration test alongside other support routes.

**Contracts.**

```ts
// supportAgentRoutes.ts
// GET /api/support/agent/dashboard
//   Response: { inboxes: Array<{ inboxId, mode, draftsPending, sentToday, escalations, evalDriftStatus: 'green'|'amber'|'red' }> }
// PATCH /api/support/inboxes/:inboxId/agent-config
//   Body: Partial<SupportInboxAgentConfig> — validates promptOverride via promptOverridePure helper from Chunk 7
//   Response: { inbox: CanonicalInbox }
//   Permission: requireSubaccountPermission('support.inbox.configure')  // OD 11.6
```

**Inbox Agent Configuration tab fields (spec §5.6.2).**

- `mode`: `disabled` / `assisted` / `autonomous` (default `disabled`; bumped to `assisted` on agent enablement at install time per Chunk 7).
- `collisionWindow.minMinutesSinceHumanActivity`: 5 / 15 / 30 / 60 minutes.
- `collisionWindow.respectHumanAssignee`: boolean toggle.
- `minConfidence` (additive, MVP): 0.7 / 0.8 / 0.9 (default 0.8).
- `voiceProfile` (additive, MVP): dropdown (Casual / Neutral / Formal / Custom; default Neutral).
- `promptOverride` (existing): freeform textarea, validated via Chunk 7's `validatePromptOverride` (500-char cap + forbidden-token scan).
- `escalationCategories` (additive, MVP): multi-select.

**Error handling.**
- PATCH validation failure (`promptOverride` rejected) → `{ statusCode: 422, errorCode: 'prompt_override_invalid', message: <reason> }`.
- Permission denied → `{ statusCode: 403, errorCode: 'forbidden' }` (handled by existing `requireSubaccountPermission`).
- Concurrent edits → last-write-wins on `agent_config` JSONB; audit log captures both diffs.

**Idempotency posture.** **safe** (REST PATCH; idempotent on the JSONB shape).

**Invariants touched.** INV-2, INV-10 (autonomous-mode toggle is the policy override), INV-13 (no feature flags — uses existing `agent_config.mode` enum), INV-17 (Run Trace surface).

**Events emitted.** None directly. Renders events emitted by Chunks 1, 2, 3, 8.

**RLS + permissions.** Permission tile per OD 11.6: `support.inbox.configure` (existing). Default granted to org admin only. Audit log entry written to `audit_events` on every `agent_config` PATCH with diff.

**Dependencies.** Chunk 7 (`SupportInboxAgentConfig` Zod schema with additive fields, `validatePromptOverride`), Chunk 8 (event types for Run Trace rendering).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npm run build:server`

**Acceptance gate criteria (from spec §9.2).**
- All 7 Run Trace event types from §5.6.3 render correctly.
- Inbox Agent Configuration tab saves per-inbox `agent_config` correctly.
- Per-inbox toggle for autonomous vs assisted writes to `canonical_inboxes.agent_config.mode`.

**Doc-sync targets.**
- `architecture.md` § Routes — add row for `supportAgentRoutes.ts`.
- `docs/capabilities.md` — Support Agent capability page (Operator-facing) updated with autonomous-vs-assisted mode posture.
- `npm run code-graph:rebuild` after merge.

---

## 6. Risk register and mitigations

Spec §10 lists 11 risks; this register adds rollout/build-friction concerns the architect identified during plan authoring.

| # | Risk | Likelihood | Impact | Mitigation | Owning chunk |
|---|---|---|---|---|---|
| R1 | LLM-as-judge drift on draft quality eval | Medium | Medium | Anchor judges to fixed model + prompt-template hash; the drift detector splits time-series per `(prompt_version, model_id, skill_template_hashes)` triple so judge variance across versions is informational, not alerting. | Chunk 9 |
| R2 | Customer voice profile bleeds across inboxes (cross-tenant prompt leak) | Low | High | Per-inbox `agent_config` is RLS-scoped; integration test in Chunk 8 verifies no cross-inbox prompt material; `promptOverridePure.ts` forbidden-token scan + 500-char cap; audit log on every override edit. | Chunks 7, 8 |
| R3 | 42 Macro PDF rendering cost is higher than expected | Medium | Low | `@react-pdf/renderer` is JS-native; profile in staging; acceptable threshold defined in spec §4.4.3. Determinism contract pins exact version in `package.json` so a future cost regression is detectable via `Producer` field. | Chunk 3 |
| R4 | File delivery S3 IAM misconfiguration | Medium | High | OD 11.2 deferral allows Option B (main-app proxy) as fallback if worker-scoped IAM is not provisioned; Chunk 1 ships both transit options bound to the same logical contract; staging dry-run before production rollout per spec §8.5; per-org bucket prefix (`orgs/{org_id}/...`) prevents cross-tenant access. | Chunk 1 |
| R5 | Support Agent collision policy false negatives (agent acts when human is active) | Medium | High | Smoke test 5 (spec §7.5) specifically verifies this; INV-11 + observability alert. Chunk 8's claim + human-activity check is sequential (claim then check, both server-side `now()`); database-side comparison is clock-skew safe. | Chunk 8 |
| R6 | Three-phase dispatch idempotency-key mismatch under retries | Low | High | Inherited from PR #277 `supportDraftDispatchService`; covered by existing tests. Chunk 8 explicitly does not modify dispatch internals — `INV-2` enforced. | Chunk 8 |
| R7 | Eval threshold too strict; agent fails to ship | Low | Medium | Iterative threshold calibration during pilot; threshold reviewable post-merge. Spec §9.2 acceptance allows tuned-during-pilot threshold formally agreed with Product before lock-in. | Chunk 9 |
| R8 | Drift detection has too many false positives | Medium | Low | Tunable threshold; aggregate over rolling window, not single run; gate fails build only when two consecutive runs sub-threshold for the same metric (spec §7.3). | Chunk 9 |
| R9 | Support Agent runs eat token budget faster than expected | Medium | Medium | Per-subaccount budget on `subaccountAgents.tokenBudgetPerRun`; alert at 80% per-month spend (existing primitive). | Chunk 8 |
| R10 | `classify_ticket` cache invalidation issues (stale classifications) | Low | Low | OD 11.4 DEFERRED — no cache in MVP; re-classification on every run. Risk re-evaluates in Phase 1.5 when cache is added. | Chunk 6 |
| R11 | Foundry-vs-runtime ticket-shape drift surfacing in agent | Low | High | Inherited risk from support-desk-canonical OQ-1; daily cross-check in eval (Chunk 9). | Chunk 9 |
| R12 (build-friction) | Singleton install race test is hard to write deterministically | Medium | Medium | `supportAgentInstall.integration.test.ts` uses two real `pg_advisory_xact_lock` transactions in parallel; test seed uses `wait` primitives + assert exactly one 200 + one 409. Builder may iterate test runtime. | Chunk 7 |
| R13 (build-friction) | PDF byte-determinism brittle under `@react-pdf/renderer` minor updates | Low | Medium | Exact-version pin (no caret) in `package.json`; golden-byte assertion in `reportRenderingServicePure.test.ts` catches regressions; KNOWLEDGE entry documents the contract. Renderer-swap (per OD 11.1) re-validates determinism. | Chunk 3 |
| R14 (rollout) | Phase A (Chunk 1) takes longer than 1-2 weeks; blocks Phase B's customer-facing surfaces | Medium | Medium | Chunks 5, 6, 7 are independent of file delivery and can run in parallel with Chunk 1. Chunks 8 (uses 6 + 7) can also start without Chunk 1. The customer-facing surfaces (Chunks 2, 3, 4) are the only ones that actually wait. | Sequencing |
| R15 (rollout) | Chunk 8's prompt-polish work for `propose_reply` and `find_customer_history` requires LLM iteration that is not unit-testable | Medium | Medium | Iteration is bounded by Chunk 9's eval harness — once the harness exists, prompt iteration is feedback-driven against the regression set. Recommend Chunk 9 land before Chunk 8's prompt-polish PR is merged (the prompt-polish work can be a separate PR within Chunk 8's scope). | Chunks 8, 9 |
| R16 (rollout) | Migration number collisions between Chunks 1, 7, 9 (each adds a migration) | Low | Low | All three chunks use `<next-available>` placeholders; migration numbers assigned at chunk-build time in commit order; existing migration runner is idempotent and detects collision before apply. | Chunks 1, 7, 9 |

## 7. Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

This includes the new `verify-support-agent-eval-thresholds.sh` (authored inside Chunk 9) and `verify-support-agent-skill-set.sh` (authored inside Chunk 7). Both are CI gates; CI invokes them on every PR. The local executor does NOT run them as part of any chunk's verification step. The chunk's job is to author the gate, write a targeted unit test that exercises the gate's logic on a single fixture, and ship the gate script itself. Verifying that the gate runs across the whole repo is CI's job.

**Per-chunk verification is restricted to:**

- `npm run lint`
- `npm run typecheck` (or `npx tsc --noEmit`)
- `npm run build:server` and/or `npm run build:client` when the chunk touches the build surface
- `npm run db:generate` to verify migration file shape (Chunks 1, 7, 9)
- Targeted execution of Vitest tests authored in THIS chunk via `npx vitest run <path-to-test>`

No `scripts/verify-*.sh`, no `scripts/gates/*.sh` run, no `npm run test:*` umbrella commands, no Phase 0 baseline gate sweep, no Programme-end full gate set, no regression sanity check.

**Tests use Vitest exclusively** per `docs/testing-conventions.md`. Authoring `node:test`, `node:assert`, or `npx tsx`-runnable harnesses is rejected by `scripts/verify-test-quality.sh` (CI-only).

### Phase ordering for the operator

1. Start Chunk 1 (Phase A, serial — file delivery infrastructure).
2. While Chunk 1 is in flight, start Chunks 5, 6, 7 in parallel (Phase B work that does not depend on Chunk 1).
3. After Chunk 1 lands and is consumable, start Chunks 2 + 3 in parallel (both depend on Chunk 1).
4. After Chunks 2 + 3 land, start Chunk 4 (Run Trace UI for 42 Macro).
5. After Chunks 6 + 7 land, start Chunk 8 (Support Agent execution loop).
6. After Chunk 8 lands, start Chunks 9 + 10 in parallel.

The two MVPs land independently after Chunk 1 — 42 Macro track is Chunks 2-5; Support Agent track is Chunks 6-10. Phase 1 lock-in (1 week per spec §0.6) follows both tracks landing.

### Migration number assignment

Chunks 1, 7, 9 each add a migration with a `<next-available>` placeholder. At chunk-build time:
1. Builder runs `ls migrations/ | sort -n | tail -1` to find the highest existing number.
2. Builder assigns the next number to their migration.
3. If two chunks land in close succession, the second chunk re-checks before push and renames if needed.
4. The existing migration runner is idempotent and detects collisions before apply.

### Forbidden anywhere in any chunk

- `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`.
- `bash scripts/run-all-unit-tests.sh`, `bash scripts/run-all-gates.sh`.
- Any individual `scripts/verify-*.sh` or `scripts/gates/*.sh` invocation.
- Any "baseline gate sweep", "Programme-end full gate set", "regression sanity check", or "quick re-verify".
- Hedging language ("optionally", "if helpful", "feel free to") around any of the above.

### Doc-sync checkpoints (per `docs/doc-sync.md`)

Each chunk's "Doc-sync targets" line lists specific docs to update IN THE SAME COMMIT as the code change. The most common targets across this plan:

- `architecture.md` — Routes, Services, Skill System, Three-Tier Agent Model, Quality Infrastructure sections.
- `docs/capabilities.md` — Skills Reference, Agency Capabilities, Product Capabilities sections (vendor-neutral wording).
- `KNOWLEDGE.md` — append-only Pattern, Convention, or Correction entries.
- `replit.md` — only when env vars change (Chunk 1 if `S3_ARTIFACTS_BUCKET` is new).
- `npm run code-graph:rebuild` — after every chunk that adds files in `server/`, `client/`, or `shared/`.

### Pre-existing violations

This plan does not include a "run gates to baseline" step. If a builder suspects a pre-existing gate violation interacts with the planned work, they identify it by static reasoning (read the code, read the gate script's grep pattern, point at the offending line). The builder fixes it inline ONLY when the violation is directly caused by, or directly blocks, this chunk's work; otherwise the violation is logged as a blocker or a deferred item in `tasks/todo.md` and CI catches it when the PR is opened. Drive-by fixes of unrelated pre-existing violations expand the chunk's blast radius without authorisation and are not allowed.

### Rollback posture (spec §8.4)

- Each migration has `.down.sql`.
- Per-subaccount disable: flip `subaccount_agents.is_active=false`. The Support Agent run pauses immediately on the next scheduled tick.
- Per-inbox disable: set `canonical_inboxes.agent_config.mode='disabled'`. The agent skips that inbox on the next run.
- Code revert: standard commit-and-revert; no feature-flag flush needed.
- File delivery rollback: Chunk 1's `.down.sql` drops `run_artifacts`; in-flight uploads fail at the row insert and the `phase1.macro.artifact_upload_failed` event surfaces. S3 objects orphan-leak until manually cleaned (acceptable for rollback).

### What this plan does NOT cover

Per spec §10.5 Deferred Items — out of scope for the MVP but documented:

- SLA tracking primitives (Phase 1.5 / Phase 2).
- Recurring-problem detection / clustering (Phase 2).
- Knowledge-base search in the Support Agent (Phase 2).
- Operator Controller for the Support Agent (Phase 3).
- Operator Session Identity (ChatGPT OAuth as session-based model identity, Phase 3).
- PDF report run-over-run delta section (Phase 2).
- Dedicated `agentRunCompletedHandler` job (Phase 1 reuses `ieeRunCompletedHandler`).
- Worker-direct S3 IAM (OD 11.2 — Phase 2 if proxy used in MVP).
- Haiku-classify routing (OD 11.3 — Phase 1.5).
- Generic skill-result cache (OD 11.4 — deferred from Chunk 6; Phase 1.5).
- Run-artifacts retry endpoint (Phase 2 if S3-error-recovery becomes a customer pain point).

If a builder encounters a need for any of the above during chunk execution, the correct response is to flag it as a blocker via the triage agent rather than implement it inline.

---

## End of plan

This plan is the build contract for the locked spec at `tasks/builds/phase-1-showcase-mvps/spec.md`. Execution lifecycle:

1. Switch to Sonnet for execution (per CLAUDE.md plan-gate convention).
2. `feature-coordinator` consumes this plan and dispatches builders one chunk at a time.
3. Each builder produces a PR; PR goes through `spec-conformance` (where applicable), `pr-reviewer`, `dual-reviewer` (when Codex available), `adversarial-reviewer` (when security surface touched).
4. After all chunks merge, `finalisation-coordinator` runs the merge-ready pipeline.
5. Phase 1 lock-in begins after both MVPs land in production and pass the spec §8.5 verification (5 customers running successfully for 2 consecutive weeks).
