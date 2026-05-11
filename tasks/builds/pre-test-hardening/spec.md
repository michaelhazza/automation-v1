# Pre-Test Hardening — Dev Spec

**Slug:** `pre-test-hardening`
**Branch:** `pre-test-hardening`
**Class:** Major
**Migration range reserved:** `0318–0320`
**Source brief:** [`brief.md`](./brief.md)
**Authored:** 2026-05-10

---

## Table of contents

- §0. Framing
- §1. Domain model
- §2. Phase 1 — Webhook auth & isolation
- §3. Phase 2 — Read/write tenant scoping closures
- §4. Phase 3 — Support draft preflight + agent guards
- §5. Phase 4 — Input validation + concurrency hardening
- §6. Phase 5 — Operational hardening
- §7. Test matrix
- §8. Chunk plan
- §9. Acceptance criteria summary
- §10. Out of scope

---

## §0. Framing

### §0.1 Posture

This is the last hardening sprint before testing lockdown. After this build, the system is feature-frozen for testing → production deployment. Scope is intentionally tight: a focused set of code-hardening items plus two non-code operational items (O2 runbook, O5 branch protection). No new features. No refactors beyond what each fix requires.

### §0.2 Sister-branch boundary

Files owned by other in-flight branches are **out of scope for this build**:

- `pre-prod-boundary-and-brief-api` owns: `server/middleware/*`, auth routes, rate-limiting primitive, multer config (audit rows #21, #24).
- `pre-prod-workflow-and-delegation` owns: `server/services/workflowEngineService.ts`, `workflowRunService.ts`, `agentExecutionService.ts`, `agentRuns` schema.

A scope-out grep gate runs in CI; the build is rejected if any file under those paths shows up in the diff.

### §0.3 Migration sequencing

Reserved range: `0318–0320`. Three slots cover:

- Phase 1: 2 migrations (W3 — webhook replay nonces, Teamwork connector token) → `0318`, `0319`.
- Phase 2: 0 migrations (route/service-only).
- Phase 3: 0 migrations.
- Phase 4: 1 migration (V1 — connection status CHECK constraint) → `0320`.
- Phase 5: 0 migrations (O2 phased swap deferred per DEC-3).

Builder must follow the canonical migration shape: `.sql` + matching `.down.sql`, idempotent where the operation permits it, no `CONCURRENTLY` inside a transaction.

### §0.4 Decisions (resolved 2026-05-10)

All four decision points were technical calls about implementation shape. Defaults are activated; rationale captured below for the audit trail. None of these decisions are reversible without rework, so they are part of the spec contract.

| ID | Decision | Resolution + rationale |
|----|----------|------------------------|
| **DEC-1** | Support read scoping shape | **Subaccount-required path.** A support-desk product is operated within one subaccount at a time (one customer-support inbox per subaccount); an "all-subaccounts" view is a power-user / admin feature, not a daily driver. Adding sibling org-listing endpoints would multiply the permission surface (every endpoint needs its own scope key, scope check, audit hook) and introduce a parallel query path that drifts from the subaccount-scoped one over time. Requiring `:subaccountId` matches the canonical pattern used by every other subaccount-scoped surface in the codebase (`resolveSubaccount(req.params.subaccountId, req.orgId!)`) and is mechanically simpler. |
| **DEC-2** | Webhook attribution shape (W3) | **Per-org URL path token.** Webhook config UIs (Teamwork's, and every comparable SaaS) reliably let operators set a delivery URL; setting custom HTTP headers is either unsupported or clunky. Path tokens are also the canonical pattern for the rest of the industry (Stripe, GitHub, Slack all do this) — operators recognise the shape. The token is a coarse-grained discriminator, not a secret; HMAC remains the auth boundary. URL-token leakage in third-party logs is acceptable because (a) the receiver already logs the URL, (b) the token can't be used without the matching HMAC secret, (c) tokens are revocable per-connector. |
| **DEC-3** | Migration 0240 phased swap | **Defer to post-launch + ship runbook now.** The trigger condition (tens-of-millions of rows OR ~100–300ms write-latency tail) is not met today; pre-launch `conversations` will be in the low thousands of rows. The phased migration adds rollout complexity (two non-transactional migration files, intermediate two-index state) that is disproportionate to the current table size. Cost of the runbook entry is near-zero and prevents the next operator from rediscovering the trigger condition under pressure. |
| **DEC-4** | `taskService.createTask` signature (T3) | **Caller-supplied `tx`.** Matches the established `getOrgScopedDb` / `withOrgTx` pattern shipped in the pre-prod-tenancy build. The alternative (callee opens its own `withOrgTx`) breaks down whenever the caller is already inside a transaction: it forces a nested savepoint, re-sets the GUC, and obscures transaction boundaries from the caller. Caller-supplied `tx` also forces every call site to think about org-scoping at its own boundary, which is the correct posture under FORCE-RLS — the boundary is the point where authorisation is established (route handler, job runner, OAuth callback), not the leaf service. Compile-time enforcement (TypeScript signature) catches regressions for free. |

### §0.5 Verification posture

Per `references/test-gate-policy.md`: targeted vitest only locally; CI runs the full suite. Each chunk ships with at least one test asserting the **closed gap fires** (negative test) — the test would fail on `main` and pass after the fix.

### §0.6 Rollback posture

Each chunk in §8 must be independently revertible:

- Migrations `0318`–`0320` ship with matching `.down.sql` files; revert is `npm run db:rollback` against the specific migration timestamp. The down migrations restore the prior schema shape exactly (drop new tables, drop new columns, drop new constraints).
- Runtime route changes (T1, V1, T3 caller migrations) and their corresponding client-side URL/argument changes must land in the same commit so a `git revert` of that commit is sufficient to restore the prior shape on both ends.
- Service-layer additions (S1 preflight checks, S2 guard, V2 advisory lock) are additive within an existing function; revert via `git revert` of the chunk commit.
- Operator-action items (O5 branch protection) are reverted at the GitHub UI; the spec's `progress.md` records the prior state (pre-build branch-protection settings) before the change is applied so the operator can restore exactly that state if needed.

This is not a change-management process — it is a precondition for the build. A chunk that cannot be cleanly reverted is not merge-ready.

### §0.7 Hard invariants for builder

Locked invariants the implementation plan must respect. Any deviation requires a spec update before code is written.

- **Migration range:** `0318–0320`. No additional migration numbers may be used without amending the spec.
- **Webhook replay dedup:** correctness is enforced by `UNIQUE (organisation_id, webhook_source, nonce)` on `webhook_replay_nonces` plus `INSERT ... ON CONFLICT DO NOTHING`. Duplicate delivery returns `200` with no side effects and emits `webhook.teamwork.replay_deduped`. TTL pruning is storage hygiene only and must not affect correctness.
- **Webhook token storage:** the Teamwork webhook token lives on the shared `connector_configs` table (column `webhook_token uuid NULL`, partial UNIQUE index `WHERE webhook_token IS NOT NULL`). The implementation plan must name the table and the partial-index expression before any code is written.
- **Support read scoping:** every support read endpoint moves under `/api/subaccounts/:subaccountId/support/...`. Zero remaining frontend or API-client callers of the unscoped paths; verified by grep at acceptance.
- **Knowledge override race:** the advisory lock is acquired with `pg_advisory_xact_lock(hashtextextended($1::text, 0))` inside the same transaction that reads `MAX(version)` and inserts the new override row.
- **Production reseed guards:** the `NODE_ENV === 'production'` guard fails closed unconditionally. The DB-host denylist is additive defence-in-depth and is never the sole barrier.
- **`taskService.createTask` signature:** caller-supplied `tx` is required at the type level; the regression test additionally verifies that a `tx` without the org GUC set cannot successfully write under FORCE-RLS.

---

## §1. Domain model

### §1.1 Domains touched

- **Webhook ingest** — `server/services/webhookService.ts`, `server/routes/webhooks/*`. HMAC validation, replay protection, attribution, incident surfacing.
- **Support draft dispatch** — `server/services/support/supportDraftDispatchService.ts`, `server/routes/support/*`. Preflight checks, principal-type gating, subaccount-scoped reads.
- **Reference document promotion** — `server/services/referenceDocumentService.ts`, `server/routes/referenceDocuments/*`. Org-membership verification on scope-link writes.
- **Task creation** — `server/services/taskService.ts`. Service-layer write path under FORCE-RLS.
- **Knowledge override** — `server/services/knowledgeService.ts`. Concurrent-write serialisation.
- **Integration connections** — `server/routes/integrationConnections.ts`. Enum validation.
- **Agent working-time rollups** — `server/jobs/workingTimeRollupCompactJob.ts`. SQL bug.
- **Operational scripts** — `scripts/_reseed_*.ts`. Environment guards.

### §1.2 Cross-cutting invariants reinforced

| Invariant | Where it bites here |
|-----------|---------------------|
| Tenant isolation on writes | T2 (promote scope IDs), T3 (taskService) |
| Tenant isolation on reads | T1 (support routes) |
| Webhook fail-closed | W1 (HMAC validation) |
| Webhook unambiguous attribution | W3 (Teamwork connector enumeration) |
| Spec preflight contract | S1, S2 (support draft) |
| Input validation at boundaries | V1 (connection status enum) |
| Concurrency-safe writes | V2 (knowledge override race) |
| Job correctness | O1 (rollup compact SQL) |
| Production safety on operational scripts | O3, O4 (reseed) |
| CI gate enforcement | O5 (branch protection) |

---

## §2. Phase 1 — Webhook auth & isolation

### §2.1 W1 — HMAC validation fails closed

**File:** `server/services/webhookService.ts:74-77`

**Current:** validation skipped when `WEBHOOK_SECRET` env-var is absent.

**Target:** in production (`NODE_ENV === 'production'`), an unset secret causes the request to reject with `401 webhook.signature_required`. In development, the existing skip behaviour is preserved but emits a one-time `logger.warn('webhook_secret_missing', { route })` per process boot.

**Acceptance:**
- Negative test: production env + no secret → 401.
- Positive test: production env + secret + valid HMAC → 200.
- Positive test: development env + no secret → 200, log line emitted once.

### §2.2 W2 — `recordIncident` on Slack + Teamwork webhook 5xx paths

**Files:** `server/routes/webhooks/slackWebhook.ts`, `teamworkWebhook.ts`

**Pattern:** mirror the GHL/GitHub webhook handler shape. Every inline `res.status(500)` path acquires a `recordIncident({ fingerprintOverride, errorDetail, ... })` call before the response, with stable fingerprints:
- `webhook:slack:handler_failed`
- `webhook:teamwork:handler_failed`

**Acceptance:**
- Targeted test per webhook: simulate a downstream throw inside the handler; assert `recordIncident` is called with the correct fingerprint before the 500 response.
- No new fingerprint registry entries needed; reuse existing `webhook:*` namespace.

### §2.3 W3 — Teamwork webhook cross-tenant attribution + persistent dedup

**File:** `server/routes/webhooks/teamworkWebhook.ts:37-67`

**Current:** handler iterates all active Teamwork connector configs, breaks at first HMAC match. Two orgs with the same secret cross-attribute. Replay protection is in-memory.

**Target (DEC-2):**

1. **URL discriminator.** New webhook URL shape: `/api/webhooks/teamwork/:orgWebhookToken` where `orgWebhookToken` is a stable, opaque per-connector-config token (UUIDv4, generated when the connector is created or migrated). Handler resolves the connector config by token in a single indexed lookup; HMAC validation runs against that one config only. **Lookup scope (locked):** the lookup MUST filter by `connector_type = 'teamwork'` AND the connector's active/enabled status, in addition to the token match — never by `webhook_token` alone. This protects against a future provider that also adopts URL-token attribution from accidentally routing to the Teamwork handler if tokens ever collide cross-provider, and ensures disabled connectors can't be reactivated by a webhook delivery. **Plan contract:** the exact column name(s) used to express "active/enabled" on `connector_configs` (e.g. `is_active`, `status`, `enabled_at IS NOT NULL`, etc.) must be named in the implementation plan before code is written — this mirrors the token-storage plan contract and prevents the builder from picking the wrong status field if the schema carries multiple.
2. **Persistent replay protection.** New table `webhook_replay_nonces (organisation_id, webhook_source, nonce, seen_at)`. The `nonce` value for Teamwork is the provider's `deliveryId` (locked here; no derived digest). Handler inserts `(orgId, 'teamwork', deliveryId)` before processing; `ON CONFLICT DO NOTHING`; if zero rows inserted → treat as duplicate delivery and return `200` with no side effects, emitting a structured `webhook.teamwork.replay_deduped` audit/log event. Returning `200` (not `409`) is deliberate: webhook providers retry aggressively on non-2xx, and duplicate delivery is normal at-least-once semantics; structured logging is the operator-facing surface for duplicate detection. TTL prune runs hourly via existing job framework on a 10-minute retention window.
3. **Migration scope.** Existing Teamwork connectors get a token generated by a one-shot migration; URL rotation is communicated to operators via a runbook entry. The pre-launch posture means zero or very few prod connectors exist; cost is negligible.

**Storage (DEC-2 + builder contract):**

- The `webhook_token` column lives on the **shared `connector_configs` table** (same table that already holds `webhook_secret` for every provider). The column is provider-neutral as a per-config attribution token; rows for providers that do not need URL attribution are permitted to leave it NULL today (provider-specific population is a builder responsibility, not a schema constraint).
- Schema shape: `webhook_token uuid NULL` with a partial UNIQUE index `WHERE webhook_token IS NOT NULL` (so non-Teamwork rows with `NULL` do not collide on uniqueness).
- The Teamwork-specific data migration (see migrations below) populates `webhook_token` only on rows where `connector_type = 'teamwork'`; other providers are untouched.

**Migrations:**
- `0318_webhook_replay_nonces.sql` — creates `webhook_replay_nonces (organisation_id, webhook_source text NOT NULL, nonce text NOT NULL, seen_at timestamptz NOT NULL DEFAULT now())` with `UNIQUE (organisation_id, webhook_source, nonce)` (this is the dedup invariant — the unique constraint alone enforces correctness) plus a secondary index on `(organisation_id, webhook_source, seen_at)` for the prune scan; RLS policy registering `webhook_replay_nonces` in `rlsProtectedTables.ts`. Down migration drops the table.
- `0319_connector_configs_webhook_token.sql` — adds `webhook_token uuid NULL` to `connector_configs`; partial UNIQUE index `(webhook_token) WHERE webhook_token IS NOT NULL`; data step populates `webhook_token = gen_random_uuid()` for rows where `connector_type = 'teamwork' AND webhook_token IS NULL`. Down migration drops the index and the column.

**`gen_random_uuid()` preflight (locked):** repo convention is to rely on `gen_random_uuid()` being available (used unconditionally in migrations 0012, 0013, 0018, 0022, 0025 with no preceding `CREATE EXTENSION`). Migration 0319 follows that convention — it does **not** add `CREATE EXTENSION IF NOT EXISTS pgcrypto`. Builder must not introduce a `CREATE EXTENSION` statement here without a corresponding repo-wide convention change (out of scope for this build). If a fresh-database boot ever fails on `gen_random_uuid()`, the fix lives in the schema-bootstrap migration, not in this build's migrations.

**Replay correctness invariant (locked):** Replay rejection correctness depends solely on the `UNIQUE (organisation_id, webhook_source, nonce)` constraint and `INSERT ... ON CONFLICT DO NOTHING`. Replay protection is guaranteed **only while the corresponding nonce row exists in the table.** The hourly TTL prune job's purpose is bounded storage growth, not correctness: prune *failure* extends dedup coverage (more rows retained, more duplicates rejected); prune *success* after the 10-minute retention window deletes old nonce rows, after which a duplicate delivery of the same `deliveryId` would be accepted as a fresh delivery. This is acceptable given Teamwork's at-least-once retry semantics — providers do not retry the same delivery 10+ minutes later in normal operation. The 10-minute retention window is therefore the **storage-retention horizon**, not a correctness boundary; choosing to retain longer (or partition/archive) is a future operational decision, not a correctness fix.

**Acceptance:**
- Negative test: webhook delivered to org A's URL signed with org B's secret → 401.
- Negative test: same `deliveryId` replayed within 10min → `200` with no side effects; structured `webhook.teamwork.replay_deduped` event emitted.
- Negative test: same `deliveryId` replayed across two app instances → still rejected (DB-backed).
- Negative test: nonce row still exists past the 10-minute window because the TTL prune job has been paused → duplicate delivery of the same `deliveryId` is still deduped (i.e. the precondition for dedup is the row's existence, not the wall-clock retention window).
- Positive test: distinct deliveries within window → both processed.
- RLS gate (`scripts/verify-rls-protected-tables.sh`) exits 0 after registration.

---

## §3. Phase 2 — Read/write tenant scoping closures

### §3.1 T1 — Support read-path subaccount scoping

**Files:** `server/routes/support/supportTicketsRoutes.ts:14`, `supportInboxesRoutes.ts:15`, `supportDraftsRoutes.ts:21` and the corresponding service-layer query helpers.

**Current:** route handlers pass `subaccountId: null`; service queries filter only by `organisationId`.

**Target (DEC-1):**

All five read endpoints (`GET /api/support/tickets`, `tickets/:id`, `drafts`, `drafts/:id`, `inboxes`) move under the existing `/api/subaccounts/:subaccountId/support/...` namespace. Path-segment scoping is chosen over a query-parameter shape because it (a) matches the canonical pattern used by every other subaccount-scoped surface, (b) cannot be silently forgotten on a new endpoint, (c) is enforced by the route definition rather than per-handler validation. Routes call `resolveSubaccount(req.params.subaccountId, req.orgId!)`. Service-layer queries gain an explicit `eq(table.subaccountId, subaccountId)` filter. The frontend is updated in the same chunk to call the new URLs; the old paths are removed (no compatibility shim — pre-launch posture).

**Acceptance:**
- Negative test: GET against the legacy unscoped paths (`/api/support/tickets`, `/api/support/drafts`, `/api/support/inboxes`) returns 404 — the route is not mounted (no compatibility shim per DEC-1).
- Negative test: GET with another org's subaccountId in the path → 403 (existing `resolveSubaccount` behaviour).
- Negative test (cross-tenant read): seed two subaccounts; query A returns only A's drafts/tickets/inboxes.
- No service queries on `support_*` tables without an explicit subaccount filter.
- **Route inventory check (grep gate):** zero remaining frontend or API-client callers of `/api/support/tickets`, `/api/support/drafts`, or `/api/support/inboxes` without the `/api/subaccounts/:subaccountId/...` prefix. Builder runs the grep and pastes the empty result into `progress.md`. Patterns must cover string literals, template literals, and any URL-builder helpers (e.g. `apiUrl('/support/tickets')`) — the grep is the contract, not a single regex. **Scope:** the grep targets runtime source only (`server/`, `client/src/`, `shared/`); it explicitly excludes docs (`docs/`, `tasks/`, `*.md`), review logs (`tasks/review-logs/`), and tests that intentionally assert the legacy paths return 404. Builder records the exact `--glob` / exclusion flags used in `progress.md` so the gate is reproducible.

### §3.2 T2 — Reference-document promote: cross-org scope-ID rejection

**Files:** `server/routes/referenceDocuments/promoteRoute.ts` (or wherever `POST /api/reference-documents/promote` and `POST /api/reference-documents/:id/links` live), `server/services/referenceDocumentService.ts`.

**Current:** body-supplied `agentId`, `subaccountId`, `scheduledTaskId`, `taskInstanceId` flow into `referenceDocumentDataSources` insert without org-membership verification.

**Target:** before insert, every non-null scope ID is verified against `WHERE id = :id AND organisation_id = :req.orgId!`. Verification is a single batched query per scope kind (`agents`, `subaccounts`, `scheduled_tasks`, `tasks`). Mismatch → 403 `referenceDocument.scope_cross_org`.

**Atomicity (locked):** all supplied scope IDs across all scope kinds must be verified before any link insert occurs. Verification failure for any single supplied scope ID — regardless of which kind — aborts the entire promote/link operation; no partial scope-link rows are written. Builder structures the service as: (1) collect all supplied scope IDs by kind, (2) run the batched verification queries, (3) if all pass, perform the inserts inside a single transaction; if any fail, return 403 before the insert phase begins.

**Acceptance:**
- Negative test (per scope kind): seed an entity in org B; promote with that ID under org A's auth → 403; insert is not attempted.
- Positive test: promote with same-org IDs → 201.
- Audit log row written on the 403 path. **Audit row content (locked):** the row records the requesting org, the rejection reason, the scope kind that failed, and echoes back the opaque scope ID exactly as submitted in the request (which the requester already possesses). It MUST NOT carry any additional cross-org entity details — no name, no human-readable label, no joined fields, no row hashes, no owning-org id, no surrounding metadata about the cross-org entity. The audit row's purpose is operator forensics on the *attempt*, not exposure of the target entity.

### §3.3 T3 — `taskService.createTask` write-path scoping

**File:** `server/services/taskService.ts:158, 185` and every caller.

**Current:** `createTask` and `taskActivities` insert use module-level `db`. Under FORCE-RLS, writes silently no-op or fail policy unless ALS happens to have a GUC set (which it does NOT for module-level `db`).

**Target (DEC-4):**

1. `createTask(input, tx)` and the corresponding `taskActivities` insert helper require an explicit transaction client supplied by the caller (signature change).
2. Every caller is audited and migrated. Two caller categories:
   - **Already inside `withOrgTx`** — pass the existing `tx` through.
   - **Not yet inside `withOrgTx`** — wrap the call in `withOrgTx({ organisationId, source })` at the appropriate boundary.
3. The unauthenticated GHL path (todo line 2609 — auto-start onboarding) is a known special case and is **explicitly out of scope** per §0.2 — but the refactor must not regress it. The refactor lands a TODO comment at the GHL caller pointing at the deferred work.

**Acceptance:**
- Compile-time enforcement: removing the `tx` parameter from any call site is a TypeScript error.
- Targeted test: `createTask` called inside a `withOrgTx` block writes successfully under FORCE-RLS.
- **Regression test (strict contract):** `createTask` invoked with a transaction client that has NOT had the org GUC set (i.e. a raw transaction or module-level `db`) MUST NOT successfully write a row under FORCE-RLS. The test asserts that the call either throws or that the row count for the target org is unchanged after the call. Because the type-system guarantee can be bypassed (any transaction client is structurally compatible), the test verifies the **runtime** failure path: builder either (a) adds an explicit runtime assertion in `createTask` that the GUC is set on the supplied `tx`, or (b) relies on FORCE-RLS to reject the write — whichever route is chosen, the regression test must fail on `main` and pass after the fix.
- Caller audit checklist appended to `progress.md` listing every modified call site.
- `npx tsc --noEmit -p server/tsconfig.json` clean.

**Estimated reach:** 12–25 caller sites (inferred from the todo entry "dozens of call sites"). Builder confirms the count in the Phase 2 progress entry.

---

## §4. Phase 3 — Support draft preflight + agent guards

### §4.1 S1 — `approveDraft` preflight checks 4–7

**File:** `server/services/support/supportDraftDispatchService.ts approveDraft`

**Spec source:** `tasks/builds/support-ticket-structure/spec.md` §8.1 (the seven-check enumeration).

**Target:** add the four missing checks, in the order the spec defines them, after the existing checks 1–3. Each check is its own pure function under `supportDraftPreflightPure.ts` (or extension of the existing module) and is unit-tested in isolation:

- **Check 4 — Ticket-status eligibility.** Reject if the action (`support.propose_reply` etc.) is disallowed for the current ticket status per spec §5.1.A column 3.
- **Check 5 — Collision-window.** Reject if `now - last_human_activity_at < agent_config.collisionWindow.minMinutesSinceHumanActivity`. Respect `respect-human-assignee` flag. Bypass allowed when `overrideCollision=true` AND principal is human (see S2).
- **Check 6 — Customer-match policy gate.** Reject if the inbox's customer-match policy disallows the customer in question (per spec §5.1.B).
- **Check 7 — Supersession.** Reject if any newer draft exists for the same `ticketId`. "Newer" is determined by lexicographic ordering of the tuple `(created_at, id)`, not `created_at` alone — this avoids same-millisecond ambiguity when two drafts are created in the same DB tick. The query takes the form `EXISTS (SELECT 1 FROM support_drafts WHERE ticket_id = $1 AND (created_at, id) > ($2, $3))` where `$2, $3` are the candidate draft's own values.

**Source-rule snapshot (builder contract):** the implementation plan must, before any code is written, copy into the plan document the exact rows from `tasks/builds/support-ticket-structure/spec.md` that drive checks 4 and 6 — specifically the §5.1.A status/action eligibility matrix (column 3) and the §5.1.B customer-match policy table. The `supportDraftPreflightPure.ts` unit tests then assert each row of the snapshotted matrices, so any later edit to the source spec that contradicts the snapshot is caught by a failing test rather than a silent drift. This avoids cross-document lookup risk during build and freezes the rule-set the build commits to.

When `overrideCollision=true` and the principal is human (S2 holds), check 5 is skipped, an `auditEvents` row is written with the snapshot, and the route-layer `assertScope(principal, 'support.draft.override_collision')` is re-asserted defensively at the service layer.

**Acceptance:**
- Per-check unit test (negative + positive).
- Integration test: `approveDraft` with each rejecting condition → correct error code.
- `overrideCollision=true` + human principal: check 5 skipped, audit row present.
- `overrideCollision=true` + agent principal: 403 (S2).

### §4.2 S2 — Agent-run principal cannot set `overrideCollision: true`

**File:** same service.

**Spec source:** spec §8.6 paragraph 5.

**Target:** at the start of `approveDraft`, if `overrideCollision === true`, assert the principal has a non-null human `userId`. Otherwise reject with `403 { errorCode: 'support.draft.override_collision_human_only' }`.

**Acceptance:**
- Negative test: agent-run principal + `overrideCollision: true` → 403; no DB writes.
- Positive test: human principal + `overrideCollision: true` → check 5 skipped; succeeds.

---

## §5. Phase 4 — Input validation + concurrency hardening

### §5.1 V1 — `PATCH /api/connections` enum validation

**File:** `server/routes/integrationConnections.ts:123`.

**Target:**

1. **Route layer:** Zod schema rejects unknown `connectionStatus` strings: `connectionStatus: z.enum(['active','revoked','error']).optional()`. Reject → 400 `connection.status_invalid`.
2. **DB layer:** new migration `0320_connections_status_check.sql` adds a CHECK constraint on `integration_connections.connection_status` matching the enum. Idempotent.

The two layers are deliberately redundant: the route guard prevents the bad write at runtime; the CHECK constraint ensures any future code path that bypasses the route can't poison the column.

**Migration preflight (locked):** before adding the CHECK constraint, `0320` runs a preflight `SELECT` against `integration_connections` for any existing `connection_status` value not in the enum. If the preflight returns any row, the migration aborts with an explicit diagnostic listing the offending row count and a sample of distinct invalid values. The migration MUST NOT silently coerce, NULL out, or rewrite the bad data — pre-prod posture means an explicit halt is preferable to a silent mutation, and the operator decides the cleanup path before re-running.

**Acceptance:**
- Negative test: PATCH with `connectionStatus: 'foo'` → 400.
- Negative test: direct DB insert with `'foo'` (test fixture) → 23514 CHECK violation.
- Negative test: seed an `integration_connections` row with `connection_status = 'foo'` and run the migration → migration aborts with the preflight diagnostic, no CHECK constraint added, no data mutated.
- Positive test: PATCH with `'revoked'` → 200; subsequent GET returns the row.

### §5.2 V2 — Knowledge `overrideEntry` concurrent-write serialisation

**File:** `server/services/knowledgeService.ts:766-811`.

**Target:** at transaction start, acquire the lock with `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))` where `$1` is the `blockId`. The explicit `::text` cast pins the input shape (drizzle may pass UUIDs as either string or branded UUID; `hashtextextended` requires `text`) so the lock-key derivation is identical across call sites and across deploys.

**Same-transaction requirement (locked):** the advisory lock MUST be acquired inside the same transaction that subsequently (a) reads the current `MAX(version)` for the block and (b) inserts the new override row. Acquiring the lock in a separate transaction or before opening the write transaction defeats the serialisation. Builder structures the service as: open `withOrgTx` → `pg_advisory_xact_lock` → read max version → insert → commit. The lock is per-block and transaction-scoped, released automatically on commit/rollback; concurrent overrides on the same `blockId` serialise so `(memoryBlockId, version)` collisions cannot occur.

**Acceptance:**
- Concurrency test: spawn N concurrent overrides with distinct bodies on the same `blockId`; assert all succeed in some order; final `MAX(version) = N + initial`.
- 500-leak test: concurrent overrides do not produce a 500 with constraint name in the body.
- Cross-block concurrency test: overrides on distinct `blockId`s do not serialise (lock is per-block).

---

## §6. Phase 5 — Operational hardening

### §6.1 O1 — `workingTimeRollupCompactJob` SQL fix

**File:** `server/jobs/workingTimeRollupCompactJob.ts:99`.

**Current:** `DELETE FROM agent_working_time_rollups ... RETURNING id` — fails because the table has a composite PK and no `id` column.

**Target:** drop `RETURNING id`. If the caller needs a row count, use `affectedRows` from the drizzle response. The job's purpose is bounded compaction; a count is sufficient — no individual-row reference is needed downstream.

**Acceptance:**
- Targeted test: seed `agent_working_time_rollups` with a couple of rows past retention; run job; assert rows deleted, no SQL error.

### §6.2 O2 — Migration 0240 phased swap (deferred per DEC-3)

**Scope in this build:** runbook entry only — no code change.

New file `docs/runbooks/migration-0240-phased-swap.md` documents (a) the trigger condition (table size or write-latency tail past the threshold), (b) the two-step `CREATE UNIQUE INDEX CONCURRENTLY` + drop-old + rename migration, (c) the rollback plan, (d) the operator's command sequence. Linked from `docs/doc-sync.md` if the doc sync gate requires.

### §6.3 O3 — Reseed drop-create env guard

**File:** `scripts/_reseed_drop_create.ts`.

**Target:** `main()` first lines, in this order, fail-closed at each step:

1. **Primary guard (always-on, fails closed):** if `process.env.NODE_ENV === 'production'` → throw with an explicit message naming the script. This guard is correctness-critical and does NOT depend on any other configuration being present. If `NODE_ENV` is unset or the `PROD_DB_HOST_DENYLIST` env var is unset, this guard still applies.
2. **Secondary guard (defence-in-depth):** if `DATABASE_URL` matches any host fragment in the denylist → throw. The denylist is composed by union of (a) a small hardcoded set of always-blocked hosted-DB keywords (`supabase`, `neon`, `render`, `rds.amazonaws`, `pooler.`) maintained in `scripts/lib/prod-db-guard.ts` and (b) an optional `PROD_DB_HOST_DENYLIST` env var (comma-separated additional fragments). The hardcoded set means a missing env var cannot silently degrade host-fragment protection.
3. **Otherwise proceed.**

The guard module `scripts/lib/prod-db-guard.ts` (new) is reused by O4 and any future destructive script. Both guards run unconditionally — the secondary guard is additive defence and never bypasses the primary one.

**False-positive policy (locked):** the hardcoded denylist (`supabase`, `neon`, `render`, `rds.amazonaws`, `pooler.`) will block any staging or developer DB hosted on those providers. This is the intended behaviour for destructive reseed scripts — operators running these scripts must point at an explicit local or self-hosted dev database (`localhost`, a sandbox container, etc.). **Builder must NOT add a `--force`, `--allow-hosted`, environment-variable bypass, or any other escape hatch to override the guards.** A hardcoded false-positive on a hosted dev DB is acceptable; an unintended drop on a hosted prod DB is not.

**Acceptance:**
- Negative test: invoke with `NODE_ENV=production` and *no* denylist set → throws on the primary guard; no SQL executed.
- Negative test: invoke with `DATABASE_URL` matching a hardcoded denylist fragment under `NODE_ENV=development` → throws on the secondary guard.
- Negative test: invoke with `DATABASE_URL` matching a host added only via `PROD_DB_HOST_DENYLIST` → throws.
- Positive test: invoke with `NODE_ENV=development` and a dev DB URL not matching any fragment → proceeds (existing behaviour preserved).

### §6.4 O4 — Reseed restore transaction wrap

**File:** `scripts/_reseed_restore_users.ts`.

**Target:** wrap the entire restore body in `db.transaction(async (tx) => { ... })`. All DML inside uses `tx`. Re-uses the prod-DB guard from O3 (defence-in-depth).

**Acceptance:**
- Targeted test: simulate mid-restore throw; assert DB state is unchanged after rollback.
- Positive test: full restore runs to completion; users + joined rows present.

### §6.5 O5 — Branch protection on `main`

**Operator-action — not code.** Spec records the requirement; the operator applies it at the GitHub UI.

**Sequencing:** O5 is independent of every code chunk and may be applied at any point in the build. It MUST be applied before merge-ready signoff (so the final PR cannot merge red), but it does not block earlier chunk work — applying it too early on an already-green sequence of in-progress PRs would unnecessarily restrict the build's own commits. Recommended sequencing: capture current required-check names from a recent ready-to-merge PR (this can be done at any time), then apply branch protection during the merge-ready phase, after all code chunks have landed and CI is green on the integration branch.

**Settings → Branches → main → Branch protection:**

- Require pull request before merging.
- Require status checks to pass before merging — required-check names must match the **current** GitHub Actions check names captured from the latest ready-to-merge PR's check run (the names shown in the PR's "Checks" tab). The intended set covers, at minimum: lint + typecheck, the grep-invariants gate, and the portable-framework tests. Operator captures the live names rather than committing to historical labels — check names change as workflows are renamed.
- Require branches to be up to date before merging.
- Do not allow bypassing the above settings (or restrict bypass to a small admin group).

**Acceptance:** spec captures the requirement. Build's `progress.md` includes (a) the list of currently-existing CI check names sourced from a recent PR run, (b) a screenshot or `gh api repos/<owner>/<repo>/branches/main/protection` output confirming those exact names are required, and (c) confirmation that the three intended categories above are represented.

---

## §7. Test matrix

| Phase | Item | Negative test (regression catcher) | Positive test |
|-------|------|------------------------------------|---------------|
| 1 | W1 | prod + no secret → 401 | prod + secret + valid sig → 200 |
| 1 | W2 (Slack) | downstream throw → `recordIncident` called | normal flow → no incident |
| 1 | W2 (Teamwork) | downstream throw → `recordIncident` called | normal flow → no incident |
| 1 | W3 | wrong-org URL → 401 | per-org URL → 200 |
| 1 | W3 | replay within 10min → dedup | distinct deliveries → both processed |
| 1 | W3 | replay across instances → dedup | — |
| 2 | T1 | GET on legacy unscoped path → 404 (not mounted) | scoped GET → only that subaccount's rows |
| 2 | T1 | cross-org subaccountId → 403 | — |
| 2 | T2 | promote with cross-org agentId → 403 | same-org → 201 |
| 2 | T2 | (per other scope kinds) | — |
| 2 | T3 | createTask outside withOrgTx → throw or no-op | createTask inside withOrgTx → success under FORCE-RLS |
| 3 | S1 (×4 checks) | each rejecting condition → correct error code | clean draft → success |
| 3 | S1 | overrideCollision human path → audit row written | — |
| 3 | S2 | agent + override=true → 403 | human + override=true → success |
| 4 | V1 | PATCH 'foo' → 400 | PATCH 'revoked' → 200 |
| 4 | V1 | direct insert 'foo' → 23514 | — |
| 4 | V2 | concurrent same-block → all succeed, no 23505 | concurrent distinct blocks → no serialisation |
| 5 | O1 | seeded rows → DELETE succeeds, no SQL error | — |
| 5 | O3 | NODE_ENV=production → throw | NODE_ENV=development → proceed |
| 5 | O3 | denylist host → throw | — |
| 5 | O4 | mid-restore throw → DB unchanged | full restore → users present |
| 5 | O5 | (manual verification) | — |

---

## §8. Chunk plan (architect refines)

The architect agent decomposes this spec into builder-sized chunks. Recommended boundaries:

- **C1 — W1, W2** (webhook auth + 5xx incidents). Co-locates webhook stack changes.
- **C2 — W3** (cross-tenant attribution + persistent dedup). Includes migrations 0318, 0319.
- **C3 — T1** (support read scoping). Co-locates the three route files + service helpers.
- **C4 — T2** (promote endpoint).
- **C5 — T3** (`taskService.createTask` rewrite). Largest chunk — runs solo to keep the diff reviewable.
- **C6 — S1, S2** (support draft preflight + agent guard). Co-locates because S2 is a guard inside S1's call path.
- **C7 — V1** (connection status enum + migration 0320).
- **C8 — V2** (knowledge override race).
- **C9 — O1, O3, O4** (operational scripts + job SQL fix).
- **C10 — O2 runbook + O5 branch-protection record.**

Architect may merge or split based on diff size and review-pipeline considerations. Each chunk passes its own G1 gate (lint + typecheck + targeted test) before the next chunk starts.

---

## §9. Acceptance criteria summary

The build is merge-ready when:

1. All scoped items (W1–W3, T1–T3, S1–S2, V1–V2, O1, O3, O4) ship per their per-item acceptance criteria; O2 (runbook only) and O5 (operator-applied branch protection) are explicitly recorded in `progress.md` as completed against their non-code acceptance.
2. `npx tsc --noEmit -p server/tsconfig.json` clean.
3. `npm run lint` clean.
4. `bash scripts/verify-rls-protected-tables.sh` exits 0 (W3 adds one new registered table).
5. Sister-branch scope-out gate exits 0 (no diff in §0.2 forbidden paths).
6. `progress.md` documents:
   - DEC-1 through DEC-4 resolutions (locked in spec §0.4 — `progress.md` only re-states the resolutions and notes any in-build deviations).
   - T3 caller audit checklist with every modified call site listed.
   - O5 branch-protection screenshot or `gh api` output.
7. `pr-reviewer` passes.
8. `adversarial-reviewer` auto-fires (webhook + RLS surface) and returns no escalated findings.
9. `chatgpt-pr-review` round 1 returns no blockers.

---

## §10. Out of scope

- **Audit row #21, #24** — sister-branch (`pre-prod-boundary-and-brief-api`).
- **GHL unauthenticated auto-start onboarding RLS** (todo line 2609) — depends on T3 landing first; deserves its own decision because the fix space (admin-bypass vs ALS-context wiring) is non-trivial.
- **Defense-in-depth tightenings, code-quality polish, doc rot, post-launch architectural items** — backlog cluster identified in 2026-05-10 triage; not launch-blocking; ship later.
- **New features** — nothing in this spec adds product surface; every change closes a known gap.
