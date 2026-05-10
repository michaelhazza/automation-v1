# Implementation Plan — support-desk-canonical

**Build slug:** `support-desk-canonical`
**Plan author:** architect (Opus 4.7), 2026-05-09
**Spec:** `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md` (Status: accepted, locked)
**Plan status:** LOCKED — 2026-05-09, post chatgpt-plan-review. All blockers (F1–F3) and tightenings (P1–P4 × 2 rounds) resolved.
**Brief:** `tasks/builds/support-desk-canonical/brief.md` (LOCKED v5.3, commit `0e04cc0d`)
**Handoff:** `tasks/builds/support-desk-canonical/handoff.md`
**Branch:** `claude/support-ticket-structure-xMcy8`
**Scope class:** Major
**Single PR.** Per spec §3 + brief §11: the canonical layer ships together with its first validating provider implementation. No multi-PR phase split.

> **Hard-gate override — OQ-1:** OQ-1 (Foundry training-vs-runtime ticket-schema parity) remains open by operator decision. This plan may proceed to Phase 2 because Foundry-trained-model wiring is **not** part of this build. The spec's accepted/locked status is valid. OQ-1 is a blocker only for future Support Agent / Foundry-trained runtime wiring, not for canonical substrate implementation. The open todo entry in `tasks/todo.md § Deferred from feature-coordinator hard-gate override — support-desk-canonical (2026-05-09)` stays open until that future wiring is scoped.

---

## Contents

1. Architecture notes
2. Model-collapse check
3. Risks and mitigations
4. Chunk index and dependency graph
5. Per-chunk detail (C1–C15)
6. Executor notes
7. Self-consistency

---

## 1. Architecture notes

### 1.1 The five canonical entities and migration ordering

Five tenant-isolated tables, all following the `canonical_accounts` template (UUID PK, `organisation_id`, `connector_config_id`, `subaccount_id`, `external_metadata` JSONB, `last_synced_at`, `source_connection_id`, FORCE-RLS on `organisation_id`). Migrations are forward-only and dependency-ordered:

| Migration | Tables / changes | Why this order |
|---|---|---|
| `0307` | `canonical_inboxes` | Dimensional table; tickets reference inboxes |
| `0308` | `canonical_support_agents` | Dimensional table; tickets and messages reference agents |
| `0309` | `canonical_tickets` | FK to inboxes (0307) and agents (0308) |
| `0310` | `canonical_ticket_messages` | FK to tickets (0309); split author FKs to contacts (existing) and `canonical_support_agents` (0308); **`source_draft_id` UUID column WITHOUT FK** (drafts table does not exist yet) |
| `0311` | `canonical_ticket_drafts` + `ALTER TABLE canonical_ticket_messages ADD CONSTRAINT … FOREIGN KEY (source_draft_id) REFERENCES canonical_ticket_drafts(id)` + partial index `(organisation_id, source_draft_id) WHERE source_draft_id IS NOT NULL` | Drafts table closes the deferred FK from 0310 |
| `0312` (conditional) | `action_attempts` ledger | **Only ships if OQ-3 closes "no native idempotency"** in C7. If Teamwork supports a native idempotency header, skip 0312 entirely — the column on the draft is sufficient. |

**Down migrations are required for every up migration** (0307–0311 always; 0312 if it ships). Per-migration drop order is the inverse of create order to honour the FKs.

### 1.2 Three-phase dispatch invariant (preflight → durable transition → adapter call)

The dispatch path is the highest-stakes write in this spec (brief §5.7 + §5.8). The state machine for `canonical_ticket_drafts.status` enforces the invariant that **no duplicate customer-visible reply** can land regardless of crashes, retries, or concurrent approvals.

Three phases in order:

1. **Preflight (§8.1)** — pure-function-friendly checks on draft validity, inbox mode, ticket status eligibility, collision-window, supersession. Returns a typed reason on fail; does not mutate.
2. **Durable transition (§8.2)** — single `UPDATE … WHERE status IN ('draft','awaiting_review')` with `RETURNING *`. First-commit-wins concurrency guard. Sets `action_idempotency_key`, `dispatching_started_at`, `reviewer_user_id`, `reviewed_at`. Atomic.
3. **Adapter call (§8.3)** — only after phase 2 commits. Calls `adapter.ticketing.addReply` or `addInternalNote` with the idempotency key. Routes ambiguous failures (timeout, network err, retryable code) to `needs_reconciliation` (NEVER directly to `failed` or `expired`).

The transition guard is a pure function (`supportDraftDispatchServicePure.ts`) tested with a fixture matrix covering every valid transition, every forbidden transition, and the post-terminal prohibition. Forbidden transitions are enumerated in spec §8 + §14.7.

### 1.3 Polymorphic-FK split for `canonical_ticket_messages.author_*`

Pattern (recorded in `KNOWLEDGE.md [2026-05-09]`): a single Postgres column cannot have conditional FKs to two different parent tables. Solution: split into two nullable FK columns guarded by a CHECK constraint on `author_type`:

- `author_contact_id UUID NULL → canonical_contacts(id)` — set when `author_type='customer'` and a deterministic email match exists.
- `author_support_agent_id UUID NULL → canonical_support_agents(id)` — set when `author_type IN ('agent','bot')`.

CHECK constraint on `canonical_ticket_messages` enforces:

- `author_type='customer'` ⇒ `author_support_agent_id IS NULL` (`author_contact_id` may be NULL when no canonical match).
- `author_type IN ('agent','bot')` ⇒ `author_contact_id IS NULL AND author_support_agent_id IS NOT NULL`.
- `author_type='system'` ⇒ both NULL.

This preserves the brief §5.9 denormalised-tenant invariant (RLS never joins back to the parent ticket) while giving the read layer clean join targets per author type.

### 1.4 Deferred-FK pattern for `source_draft_id`

Pattern (recorded in `KNOWLEDGE.md [2026-05-09]`): when a child table references a parent table that does not exist yet at migration time, ship the column as a plain UUID NULLABLE in the earlier migration, and add the `FOREIGN KEY` constraint plus dependent partial indexes via `ALTER TABLE` in the later migration that creates the parent.

Concrete plumbing for this build:

- `0310` creates `canonical_ticket_messages.source_draft_id UUID NULL` — no FK, no index.
- `0311` runs `ALTER TABLE canonical_ticket_messages ADD CONSTRAINT canonical_ticket_messages_source_draft_id_fkey FOREIGN KEY (source_draft_id) REFERENCES canonical_ticket_drafts(id)` plus `CREATE INDEX … ON canonical_ticket_messages (organisation_id, source_draft_id) WHERE source_draft_id IS NOT NULL` after `canonical_ticket_drafts` is created.

The 0311 down migration drops the FK and the partial index BEFORE dropping the drafts table.

### 1.5 Deletion-by-poll precondition (§5.1, §22 OQ-5 closed)

Polling may set `provider_deleted=true` only during a **full-reconciliation pass** with all four preconditions held: every page complete, no `support.provider.poll_page_failed` emitted, no rate-limit truncation, and the endpoint has "absence-proves-deletion" semantics (unwindowed all-tickets-in-inbox). **Incremental polls must NEVER infer deletion from absence.** This is a structural correctness invariant — false tombstones silently hide live tickets from the agent queue.

Phase 2 wiring (in C8):

- The default `connectorPollingService` cycle is incremental (windowed `since=lastTicketSyncAt` per Phase C). It is forbidden from setting `provider_deleted`.
- A separate full-reconciliation pass cadence is named explicitly when wiring in C8. v1 default: **operator-triggered** initially (no cron) — the reconciliation pass is invoked from a one-shot job entry point. Phase 2 adds a nightly schedule once production observation confirms no rate-limit issues; this is documented in the C8 section as a deferred-but-scaffolded item.
- Webhook `ticket.deleted` events (C9) tombstone immediately and unconditionally, bypassing the precondition (they are explicit signals, not absence inferences).

### 1.6 Status-map fail-closed contract (§6 + §11.2)

Closed by OQ-2 in §11.2 — the full Teamwork v1 inventory is locked: 6 default system statuses + 8 historical aliases mapped, custom (operator-defined) statuses fall through to `'unknown_provider_status'` quarantine.

Pure mapping function in a NEW file: `server/adapters/teamwork/teamworkSupportStatusMap.ts`. Tested with a fixture matrix covering every known value, NULL, empty, mixed-case, unknown.

The fail-closed posture is structurally enforced at three layers: (a) the `SupportStatusMap` TypeScript type forbids mapping TO `unknown_provider_status` (`Exclude<…, 'unknown_provider_status'>`), (b) the mapping function returns the quarantine value on any miss, (c) the DB `CHECK` constraint on `canonical_tickets.status` includes `unknown_provider_status` so the value cannot be silently overwritten.

The original provider status string is preserved in `external_metadata.provider_status_raw` whenever the canonical status is `unknown_provider_status`.

### 1.7 Read-access permission posture (§9 + §10 + §12)

**No `support.tickets.read` permission key.** Read-pathway authorisation is implicit in org membership + sub-account scoping plus `getOrgScopedDb` RLS. This is a deliberate decision (chatgpt-spec-review R2) — the layer matches the existing canonical-CRM read posture.

Mutating operations gate on four new permission keys, all registered via the existing `permissionSetService` pattern:

- `support.draft.approve` — POST /approve, POST /edit, manual-resolve `mark_sent`/`retry_reconciliation` sub-actions.
- `support.draft.reject` — POST /reject, manual-resolve `mark_failed` sub-action.
- `support.draft.override_collision` — body field `override_collision: true` on POST /approve. Strictly stronger than `support.draft.approve`.
- `support.inbox.configure` — PATCH /inboxes/:id (the `agent_config` JSONB write).

Defaults (v1): org admins get all four; sub-account admins get the three operator keys; regular users get none. Sub-action enforcement on `/manual-resolve` happens AFTER authentication so the wrong key cannot pass through into a privileged sub-action (§12).

### 1.8 Pure-function testing posture (`docs/spec-context.md`)

`testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`. Total of **5 pure test files** ship across the build (spec §18 + §20):

1. `server/adapters/teamwork/teamworkSupportStatusMap.test.ts` (in C6) — status mapping fixture matrix.
2. `server/services/__tests__/supportDraftDispatchService.test.ts` (in C11) — transition guard + idempotency-key derivation + same-run supersession transaction-order.
3. `server/services/__tests__/supportDraftReconciliation.test.ts` (in C9) — reconciliation decision module + back-link match logic. **Moved to C9** because `supportDraftReconciliationPure.ts` ships in C9 (first consumer is the webhook back-link routine). C11 imports the module; the test stays colocated with the module.
4. `server/services/__tests__/supportTicketServicePure.test.ts` (in C10) — ticket transition guard + deletion read-filter + redaction read-filter + deletion-by-poll precondition.
5. `server/services/__tests__/supportContactResolutionPure.test.ts` (in C8) — pure email-match resolver.

**No vitest tests** for `connectorPollingService.ts`, `webhookAdapterService.ts`, route files, services that wrap database calls, or UI components. Per `convention_rejections` in `docs/spec-context.md`. Vitest is the runner (`docs/testing-conventions.md`); handwritten harnesses are rejected by `verify-test-quality.sh`.

### 1.9 Reused primitives (§2 — verified extant)

All primitives in spec §2 verified present at plan-authoring time:

- `server/adapters/integrationAdapter.ts` — `IntegrationAdapter` interface, `CanonicalContactData` family, `classifyAdapterError` (extended in C5).
- `server/adapters/teamworkAdapter.ts` — existing OAuth + API-key auth, `mapTeamworkEventType`, signature verification (extended in C6, C7).
- `server/services/connectorPollingService.ts` — scheduled polling, `connector_configs` cursor model (extended in C8).
- `server/services/webhookAdapterService.ts` — dispatcher + per-event dedupe (extended in C9).
- `server/lib/orgScopedDb.ts` (`getOrgScopedDb`), `server/instrumentation.ts` (`withOrgTx`, `withAdminConnection`), `server/db/withPrincipalContext.ts` — three-layer RLS (reused verbatim in C10, C11).
- `server/config/rlsProtectedTables.ts` — manifest (extended in C1, C2, C3, C4, conditionally C7).
- `server/lib/createWorker.ts` — pg-boss worker pattern (used in C11 for the reconciliation worker).
- `server/lib/withBackoff.ts` — adapter retry helper (used in C6, C7, C11).
- `server/lib/rateLimiter.ts` (`getProviderRateLimiter('teamwork')`) — already in the existing teamwork adapter (used by C6, C7).
- `server/services/connectionTokenService.ts` — token decryption (used by C6, C7).
- `server/config/actionRegistry.ts` — skill registration model (used by C12).

No new primitive is introduced unless the spec calls one out. The five genuinely-new primitives (per spec §2 final paragraph) are the canonical entities themselves, the dispatch state machine, the action-idempotency-key + ledger, and the fail-closed status quarantine — all justified inline.

## 2. Model-collapse check

**Decision:** reject collapse.

**Three-question check:**

1. Does this feature decompose into ingest → extract → transform → render? — Partially: ingestion (poll + webhook) → canonical state → agent reads. But the work is dominated by data-and-state-machine plumbing, not by pipeline steps that a single multimodal model could replace.
2. Is each step doing something a frontier multimodal model could do in a single call? — No. The work is: tenant-isolated schema, RLS policies, idempotency-safe outbound dispatch with three-phase commit, adapter contract extensions, pg-boss reconciliation worker, structured-log codes, four UI pages with permission gates. None of this is single-model-call shape.
3. Could the whole pipeline collapse into one model call with a structured-output schema? — No. The system's correctness depends on persistent canonical storage, transactional state machines, RLS, and convergence-on-disk between webhook and poll paths. A model call cannot replace a transaction, a UNIQUE constraint, a state machine, or RLS isolation.

The Support Agent itself (separate brief, depends on this one) is the LLM-driven layer; this spec ships the substrate it will run against. No collapse is possible at the substrate layer.

## 3. Risks and mitigations

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **OQ-1 deferred** — Foundry training-vs-runtime ticket schema parity not verified. Brief §5.1 spec-drift risk. If a Foundry-trained model is later wired without the comparison closing, agent quality is at risk. | Medium-High (operator-acknowledged) | OQ-1 closure path preserved in spec §22. **Phase 2 invariant:** C15 doc-sync MUST add a checklist line in `docs/decisions/0009-support-desk-canonical-not-conversations.md` noting that Foundry-trained-model wiring is gated on operator-driven OQ-1 close; the relevant `tasks/todo.md` § "Deferred from feature-coordinator hard-gate override — support-desk-canonical (2026-05-09)" entry stays open. No code change pre-empts this. |
| R2 | **OQ-3 still open inside Phase 2** — Teamwork native idempotency mechanism unconfirmed; closes only at C7. **Conditional migration `0312` ships only if OQ-3 lands "no-native-idempotency"** — the schema set is data-dependent on a Phase-2 finding. | Medium | C7 explicitly audits Teamwork's API. **Two contingent paths planned in C7:** (a) native header → `action_attempts` ledger + migration 0312 NOT shipped (smaller diff); (b) no native idempotency → `action_attempts` ledger + migration 0312 shipped (with full RLS policy + manifest entry). Both paths satisfy §14.1 invariant. Spec amendment runs in C7 as a same-PR doc edit if needed (§6 + §17 capability matrix `?` row + §18 conditional migration list become concrete). |
| R3 | **OQ-4 still open inside Phase 2** — Teamwork attachment auth model unconfirmed; closes at C7. Drives whether `resolveAttachment` returns `{url}` (cheap) or `{stream}` (expensive proxy). | Low-Medium | C7 audits the auth model. Both return shapes are already in the §6 contract type. The adapter implementation chooses one based on what Teamwork actually exposes. No schema change either way. Spec amendment in C7 if needed. |
| R4 | **Migration sequencing risk** — five migrations land in one PR; if any single migration fails partway, the build cannot revert cleanly without down migrations. The `source_draft_id` deferred FK in 0311 has the most surface for sequencing breakage. | Medium | Each migration ships with a paired down migration in the same chunk (C1–C4). The 0311 down migration drops the FK and partial index BEFORE dropping the drafts table (correct inverse order). C4 includes a one-shot manual local-replay test (`npm run db:push` against a clean local DB) as part of acceptance. |
| R5 | **Three-phase dispatch crash recovery** — a process crash between phase-2 commit and phase-3 launch leaves a draft in `dispatching` indefinitely without the boot scan (§8.7). | High (correctness) | C11 includes the boot recovery scan at `server/lib/supportDispatchBootRecovery.ts` registered at server startup. The scan transitions `dispatching` rows older than 60s to `needs_reconciliation` and enqueues the worker. Pure-tested in `supportDraftDispatchService.test.ts` covering the post-restart resume scenario. |
| R6 | **Same-run propose-reply soft-uniqueness order is load-bearing** (§5.5 + §14.1) — the partial UNIQUE on `(organisation_id, ticket_id, created_by_agent_run_id, proposed_visibility) WHERE status IN ('draft','awaiting_review')` will fire if `INSERT` runs before `UPDATE supersede` within the same transaction. | Medium | C11 implements `support.propose_reply` as a single transaction with `UPDATE … SET status='superseded'` first, then `INSERT`. Pure-tested in `supportDraftDispatchService.test.ts` (transaction-order test pinned per spec §18). |
| R7 | **Polymorphic-FK CHECK constraint asymmetry** — the `author_*` CHECK on messages allows `author_type='customer'` with `author_contact_id` NULL (when no canonical match) but disallows `author_type IN ('agent','bot')` with `author_support_agent_id` NULL. A future contributor may "tidy" the asymmetry and break ingestion of unmatched-customer messages. | Low | The CHECK constraint definition lives inline in `migrations/0310` with a header comment explaining the asymmetry. Pure tests in `supportTicketServicePure.test.ts` cover the unmatched-customer ingestion path. The schema file (`canonicalTicketMessages.ts`) carries the same explanatory comment. |
| R8 | **Provider-deletion tombstone read-filter regression** — a future query author misses the `provider_deleted=true` filter on agent reads, leaking deleted tickets back into the agent queue. | Medium | All agent reads route through `supportTicketService.readThreadForAgent` and `supportTicketService.listOpenTickets` — single boundary functions. Pure-tested in `supportTicketServicePure.test.ts` (deletion read-filter tests pinned). The brief §5.2.B audience-tier table is the contract; the service-layer boundary enforces it. |
| R9 | **`needs_reconciliation` exhausted-budget surface forgotten by operator** — a draft in `manually_marked_sent` with no provider message ever landing stays indefinitely in non-terminal state. Operator may believe the issue is closed when no provider message exists. | Low | The §10 draft review queue surfaces `manually_marked_sent` drafts under a distinct "Verified by operator, awaiting back-link" treatment. C13 implements this surfacing visually. Operator can re-confirm via Teamwork directly; no automated revert (the operator's manual confirmation is their answer). The `support.draft.manually_marked_sent` log code (§14.4 + §15) is operator-visible in audit history. |
| R10 | **Sync-cursor drift** — incremental poll's `lastTicketSyncAt` cursor lives in `connector_configs.configJson`. A migration or accidental reset could replay a large window. | Low | Cursors are owned by `connectorPollingService` (existing primitive). C8 extension does not change cursor semantics. UNIQUE indexes on `(connector_config_id, external_id)` make replays a no-op (deterministic update). `support.ingest.duplicate_collapsed` log code emits when the collapse fires (observability). |
| R11 | **Unbounded reconciliation retry budget** in `supportDraftReconciliationWorker` if the pure decision module has a bug returning `retry_after_ms` indefinitely. | Low | Default `max_attempts = 5` with exponential `withBackoff`. After exhaustion the decision module returns `surface_manual` — never silent failure. Pure-tested in `supportDraftReconciliation.test.ts` covering exhaustion case. |

## 4. Chunk index and dependency graph

15 chunks, single PR, forward-only dependency graph (verbatim from spec §16). No chunk reorders are valid.

```
C1 (inboxes + agents schema 0307, 0308) ──┐
                                           │
C2 (tickets schema 0309) ──────────────────┼─► C5 (adapter contract types — TypeScript only)
                                           │       │
C3 (messages schema 0310 — deferred FK) ───┘       │
                                                   │
C4 (drafts schema 0311 + ALTER 0310) ──────────────┘
       │                                            │
       │                                            ▼
       │                            C6 (Teamwork ingestion impl + status map)
       │                                            │
       │                            C7 (Teamwork addInternalNote + resolveAttachment + idempotency; conditional 0312)
       │                                            │
       │                                            ▼
       │                C8 (connectorPollingService extension — uses C6)
       │                                            │
       │                                            ▼
       │                C9 (webhook dispatcher extension — uses C5+C6)
       │                                            │
       │                                            ▼
       └─────────────►  C10 (read services — uses C1..C4 + C8 ingested data)
                                                    │
                                                    ▼
                                C11 (dispatch service — uses C7 + C10)
                                                    │
                                                    ▼
                                C12 (skill registrations — uses C10 + C11)
                                                    │
                                                    ▼
                                C13 (UI surfaces — uses C10 + C11 + C12)
                                                    │
                                                    ▼
                                C14 (operational state UI — extends C13)
                                                    │
                                                    ▼
                                C15 (docs + ADR + architecture.md doc-sync)
```

### 4.1 Chunk-sizing audit

Per the feature-coordinator's chunk-sizing guideline (≤5 files OR ≤1 logical responsibility), each chunk was checked. **No chunk exceeds both limits.** Notes:

- **C13 (UI surfaces)** lists 5 page files + a components directory that aggregates ~5–8 small files. This is **one logical responsibility** ("ship the five hi-fi prototype pages") so it stays as one chunk. The components directory and the route sub-files are colocated implementation details of C13's responsibility, not separate concerns. **Route split introduced in plan review:** `server/routes/support.ts` was split into three sub-route files + a thin mount index to keep each file under 100 lines given the 10-endpoint surface. This is an intra-chunk structural choice, not a chunk split.
- **C15 (docs)** lists 4 doc destinations (`architecture.md` edit, new ADR, `docs/capabilities.md` edit, `KNOWLEDGE.md` patterns) but they all collapse into the single responsibility "doc-sync close-out for this build". They are touched in one pass and reviewed as a unit.
- **C11 (dispatch service)** has 6 files (down from 8 after `supportDraftReconciliationPure.ts` and its test moved to C9 where the first consumer lives); one logical responsibility ("ship the dispatch service").
- All other chunks satisfy ≤5 files comfortably.

## 5. Per-chunk detail

### C1 — Schema + RLS for `canonical_inboxes` and `canonical_support_agents`

**spec_sections:** §5.3, §5.4, §12 (canonical_inboxes / canonical_support_agents RLS rows), §18 (migrations 0307, 0308)

**files:**
- CREATE `migrations/0307_canonical_inboxes.sql` — table DDL + indexes + FORCE RLS + canonical org-isolation policy.
- CREATE `migrations/0307_canonical_inboxes.down.sql` — drop policy + drop table + idempotent.
- CREATE `migrations/0308_canonical_support_agents.sql` — table DDL + indexes + FORCE RLS + canonical org-isolation policy.
- CREATE `migrations/0308_canonical_support_agents.down.sql` — drop policy + drop table + idempotent.
- CREATE `server/db/schema/canonicalInboxes.ts` — Drizzle schema for `canonical_inboxes` (mirrors migration). Includes `agent_config jsonb` typed via `$type<SupportInboxAgentConfig>()` cast.
- CREATE `server/db/schema/canonicalSupportAgents.ts` — Drizzle schema for `canonical_support_agents`.
- MODIFY `server/config/rlsProtectedTables.ts` — append two `RlsProtectedTable` entries: `canonical_inboxes` (policyMigration `0307_canonical_inboxes.sql`) and `canonical_support_agents` (policyMigration `0308_canonical_support_agents.sql`), each with rationale strings.
- CREATE `shared/types/supportInboxAgentConfig.ts` — Zod schema + TypeScript type `SupportInboxAgentConfig` (per spec §5.3 and §11.5). The `version: 1` literal anchors the shape.

**contracts:**
- DDL columns for `canonical_inboxes` per spec §5.3: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `organisation_id uuid NOT NULL`, `connector_config_id uuid NOT NULL`, `subaccount_id uuid NULL`, `external_id text NOT NULL`, `name text NOT NULL`, `email_address text NULL`, `is_active boolean NOT NULL DEFAULT true`, `agent_config jsonb NOT NULL DEFAULT '{"version":1,"mode":"disabled","collisionWindow":{"minMinutesSinceHumanActivity":30,"respectHumanAssignee":true},"draftExpiry":{"awaitingReviewHours":72,"draftHours":24},"optIns":{"autonomousReplyOnWaitingOnCustomer":false,"postResolutionFollowUp":false}}'::jsonb`, `external_metadata jsonb NULL`, `last_synced_at timestamptz NULL`, `source_connection_id uuid NULL`, `created_at timestamptz NOT NULL DEFAULT NOW()`, `updated_at timestamptz NOT NULL DEFAULT NOW()`.
- DDL indexes on `canonical_inboxes`: `UNIQUE (connector_config_id, external_id)`, `(organisation_id, is_active)`.
- DDL columns for `canonical_support_agents` per spec §5.4: same canonical fields plus `external_id text NOT NULL`, `display_name text NOT NULL`, `email text NULL`, `is_active boolean NOT NULL DEFAULT true`, `agent_kind text NOT NULL` (CHECK in `('human','bot')`).
- DDL indexes on `canonical_support_agents`: `UNIQUE (connector_config_id, external_id)`, `(organisation_id, agent_kind, is_active)`.
- RLS template for both: `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY; CREATE POLICY <table>_org_isolation ON <table> USING (organisation_id::text = current_setting('app.organisation_id', true))` (matching the `canonical_accounts` policy shape — see architecture.md § Row-Level Security for the canonical template).
- TypeScript type `SupportInboxAgentConfig` per spec §5.3:
  ```ts
  {
    version: 1;
    mode: 'autonomous' | 'assisted' | 'disabled';
    collisionWindow: { minMinutesSinceHumanActivity: number; respectHumanAssignee: boolean };
    draftExpiry: { awaitingReviewHours: number; draftHours: number };
    modelOverride?: string;
    promptOverride?: string;
    optIns: { autonomousReplyOnWaitingOnCustomer: boolean; postResolutionFollowUp: boolean };
  }
  ```
  Zod schema enforces the shape; consumers (C10, C11) call `.parse()` on every read of `canonical_inboxes.agent_config`.

**error_handling:**
- DDL failures during migration apply are not catchable at runtime; the migration file is the authoritative shape and `npm run db:push` against a clean local DB is the smoke test.
- The `agent_config` Zod parse on read fails closed: a malformed JSONB row throws `{ statusCode: 500, message: 'support.inbox.agent_config_invalid', errorCode: 'support.inbox.agent_config_invalid' }`. Consumer (C10 inbox service) catches and surfaces via the standard error path.

**dependencies:** none (first chunk).

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run db:generate` produces no drift (schema files match migration DDL).
- Local replay: `npm run db:push` against a clean local DB applies 0307 + 0308 without error; `npm run db:push` again is a no-op.
- `RLS_PROTECTED_TABLES` includes both new entries (verified by inspection — `verify-rls-coverage.sh` runs in CI).

**pure_tests:** none (Zod schema correctness will be exercised by C10 inbox-service tests where applicable; this chunk is pure schema).

### C2 — Schema + RLS for `canonical_tickets` (with tombstone columns)

**spec_sections:** §5.1, §5.1.A, §11.3, §12 (canonical_tickets RLS row), §15 (tombstone observability codes informed by §5.1), §18 (migration 0309)

**files:**
- CREATE `migrations/0309_canonical_tickets.sql` — table DDL + indexes + FORCE RLS + status enum CHECK + tombstone columns + `deletion_source` enum CHECK.
- CREATE `migrations/0309_canonical_tickets.down.sql` — drop policy + drop table + idempotent.
- CREATE `server/db/schema/canonicalTickets.ts` — Drizzle schema mirroring 0309.
- MODIFY `server/config/rlsProtectedTables.ts` — append `canonical_tickets` entry (policyMigration `0309_canonical_tickets.sql`).

**contracts:**
- DDL columns per spec §5.1: identity (`id`, `organisation_id`, `connector_config_id`, `subaccount_id`, `external_id`), customer identity (`customer_email`, `customer_name`, `customer_external_id`, `canonical_contact_id uuid NULL → canonical_contacts(id)`), lifecycle (`status text NOT NULL`, `priority text NOT NULL`, plus six timestamp fields), routing (`inbox_id uuid NOT NULL → canonical_inboxes(id)`, `assignee_agent_id uuid NULL → canonical_support_agents(id)`), collision primitives (`last_human_activity_at`, `last_bot_activity_at`, `bot_claimed_at`, `bot_claimed_by_run_id`), classification (`subject text NOT NULL`, `tags text[]`, `category text NULL`, `source_channel text NOT NULL`), SLA (`sla_due_at`, `sla_breached boolean DEFAULT false`, `sla_policy_external_id text NULL`), tombstone (`provider_deleted boolean NOT NULL DEFAULT false`, `deleted_at_external timestamptz NULL`, `deleted_at_canonical timestamptz NULL`, `deletion_source text NULL`), `external_metadata jsonb NULL`, `last_synced_at`, `source_connection_id`.
- CHECK constraints: `status` ∈ `('open','pending_internal','waiting_on_customer','resolved','closed','unknown_provider_status')`; `priority` ∈ `('low','medium','high','urgent')`; `source_channel` ∈ `('email','chat','form','api')`; `deletion_source` ∈ `('provider_webhook','provider_poll_observation','manual_admin') OR NULL`. Asymmetric tombstone CHECK: `(provider_deleted = false AND deletion_source IS NULL) OR (provider_deleted = true AND deletion_source IS NOT NULL)` — keeps the source non-null whenever the boolean is set.
- DDL indexes per spec §5.1: `UNIQUE (connector_config_id, external_id)`, `(organisation_id, inbox_id, status)`, `(organisation_id, customer_email)`, `(organisation_id, last_human_activity_at)`, partial `(organisation_id, status) WHERE status = 'unknown_provider_status'`, partial `(organisation_id, sla_due_at) WHERE sla_due_at IS NOT NULL AND sla_breached = false`.
- RLS: same canonical template as C1.

**error_handling:**
- The `status` CHECK constraint fires on any insert/update with an invalid value. Service-layer callers (C10) treat `23514` (check_violation) as a typed error: `{ statusCode: 422, message: 'support.ticket.invalid_status', errorCode: 'support.ticket.invalid_status' }`. Adapter-side fail-closed (the mapping function returning `unknown_provider_status`) ensures no caller passes an invalid value in practice.

**dependencies:** C1 (refs `canonical_inboxes` and `canonical_support_agents` via FK).

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run db:generate` clean.
- Local replay: `npm run db:push` against a clean local DB applies 0307 + 0308 + 0309 in order without error.
- `RLS_PROTECTED_TABLES` includes `canonical_tickets`.

**pure_tests:** none (transition-guard test ships in C10 alongside the consumer service).

### C3 — Schema + RLS for `canonical_ticket_messages` (split-author + redaction + deferred-FK column)

**spec_sections:** §5.2, §5.2.A, §5.2.B, §11.4, §12 (canonical_ticket_messages RLS row), §18 (migration 0310)

**files:**
- CREATE `migrations/0310_canonical_ticket_messages.sql` — table DDL + indexes + FORCE RLS + author CHECK + direction/visibility/author_type CHECK + redaction columns + `source_draft_id UUID NULL` (no FK).
- CREATE `migrations/0310_canonical_ticket_messages.down.sql` — drop policy + drop table + idempotent.
- CREATE `server/db/schema/canonicalTicketMessages.ts` — Drizzle schema mirroring 0310, including a header comment explaining the polymorphic-FK split (R7 mitigation).
- MODIFY `server/config/rlsProtectedTables.ts` — append `canonical_ticket_messages` entry (policyMigration `0310_canonical_ticket_messages.sql`).

**contracts:**
- DDL columns per spec §5.2: identity (`id`, `organisation_id`, `ticket_id uuid NOT NULL → canonical_tickets(id)`, `external_id text NOT NULL`, `connector_config_id`), denormalised `ticket_external_id text NOT NULL` for the unique index, `direction text NOT NULL`, `visibility text NOT NULL`, `author_type text NOT NULL`, split author (`author_contact_id uuid NULL → canonical_contacts(id)`, `author_support_agent_id uuid NULL → canonical_support_agents(id)`), content (`body_text text NOT NULL`, `body_html text NULL`, `attachments jsonb NULL`), redaction (`redacted boolean NOT NULL DEFAULT false`, `redacted_at_external timestamptz NULL`, `redacted_at_canonical timestamptz NULL`), timestamps (`created_at_external timestamptz NOT NULL`, `created_at timestamptz NOT NULL DEFAULT NOW()`), provenance (`source_draft_id uuid NULL` — **no FK constraint, no partial index — added in 0311**), `external_metadata jsonb NULL`.
- CHECK constraints: `direction` ∈ `('inbound','outbound','internal_note')`; `visibility` ∈ `('public','internal')`; `author_type` ∈ `('customer','agent','bot','system')`. The polymorphic-FK CHECK per spec §5.2:
  ```
  (author_type = 'customer' AND author_support_agent_id IS NULL)
  OR (author_type IN ('agent','bot') AND author_contact_id IS NULL AND author_support_agent_id IS NOT NULL)
  OR (author_type = 'system' AND author_contact_id IS NULL AND author_support_agent_id IS NULL)
  ```
- DDL indexes per spec §5.2: `UNIQUE (connector_config_id, ticket_external_id, external_id)`, `(organisation_id, ticket_id, created_at_external, id)` for ordered thread reads. **NO partial index on `source_draft_id` here — added in 0311.**
- RLS: same canonical template as C1.

**error_handling:**
- The polymorphic-FK CHECK fires on any insert with the wrong author shape. Ingestion (C8/C9) treats this as an adapter contract violation — logs `SUPPORT_LOG_CODES.INGEST_CONTRACT_VIOLATION` (`'support.ingest.contract_violation'`) at `error` level with the offending row's external IDs, then skips the row (does not fail the entire poll cycle). Registered in `SUPPORT_LOG_CODES` in C9. Phase 2 confirms during C8 if any Teamwork edge case can produce this; if so, the adapter's `fetchTicketMessages` normaliser fixes it before insert.

**dependencies:** C2 (refs `canonical_tickets` via FK), C1 (refs `canonical_support_agents` via FK; refs `canonical_contacts` from existing schema).

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run db:generate` clean.
- Local replay applies 0307 → 0310 cleanly. `source_draft_id` column exists as plain UUID, no FK, no index on the column yet.
- `RLS_PROTECTED_TABLES` includes `canonical_ticket_messages`.

**pure_tests:** none (audience-tier read filter tests ship in C10 alongside the read service).

### C4 — Schema + RLS for `canonical_ticket_drafts` (state machine + idempotency-key UNIQUE + ALTER on messages)

**spec_sections:** §5.5, §8 (state machine), §11 (drafts contract), §12 (canonical_ticket_drafts RLS row), §14.1 (`(connector_config_id, action_idempotency_key)` UNIQUE), §14.7 (state-machine closure CHECK constraints), §18 (migration 0311)

**files:**
- CREATE `migrations/0311_canonical_ticket_drafts.sql` — table DDL + indexes + FORCE RLS + status CHECK + state-invariant CHECK constraints + soft-uniqueness partial UNIQUE + **ALTER TABLE on `canonical_ticket_messages` adding the deferred FK + partial index**.
- CREATE `migrations/0311_canonical_ticket_drafts.down.sql` — drop the ALTER first (FK + partial index on messages), then drop drafts policy + table; idempotent.
- CREATE `server/db/schema/canonicalTicketDrafts.ts` — Drizzle schema mirroring 0311.
- MODIFY `server/db/schema/canonicalTicketMessages.ts` — add the FK relation declaration on `source_draft_id` (Drizzle relation only; the DDL was set in 0311).
- MODIFY `server/config/rlsProtectedTables.ts` — append `canonical_ticket_drafts` entry (policyMigration `0311_canonical_ticket_drafts.sql`).
- CREATE `shared/types/supportProposedActions.ts` — Zod schema + TypeScript type for `canonical_ticket_drafts.proposed_actions` JSONB (per spec §11.7).

**contracts:**
- DDL columns per spec §5.5: identity (`id`, `organisation_id`, `subaccount_id`, `connector_config_id`, `ticket_id uuid NOT NULL → canonical_tickets(id)`), proposed content (`proposed_body_text text NOT NULL`, `proposed_body_html text NULL`, `proposed_visibility text NOT NULL`, `proposed_actions jsonb NULL`), state machine (`status text NOT NULL`), three-phase columns (`action_idempotency_key text NULL`, `dispatching_started_at timestamptz NULL`, `last_reconciliation_at timestamptz NULL`, `reconciliation_attempt_count integer NOT NULL DEFAULT 0`), provenance (`created_by_agent_run_id uuid NULL → agent_runs(id)`, `model_version text NULL`, `prompt_version text NULL`), review trail (`reviewer_user_id uuid NULL → users(id)`, `reviewed_at timestamptz NULL`, `review_notes text NULL`), outbound link (`sent_message_id uuid NULL → canonical_ticket_messages(id)`), lifecycle (`expires_at timestamptz NULL`, `created_at`, `updated_at`).
- CHECK constraints: `status` ∈ `('draft','awaiting_review','dispatching','needs_reconciliation','manually_marked_sent','sent','rejected','failed','expired','superseded')`; `proposed_visibility` ∈ `('public','internal')`. State-invariant CHECKs per spec §14.7:
  - `(status = 'sent' AND sent_message_id IS NOT NULL) OR status <> 'sent'` (sent ⇒ sent_message_id NOT NULL).
  - `(status = 'manually_marked_sent' AND sent_message_id IS NULL) OR status <> 'manually_marked_sent'` (manually_marked_sent ⇒ sent_message_id NULL).
- DDL indexes per spec §5.5: `(organisation_id, ticket_id, status)`, partial `(organisation_id, status, created_at) WHERE status IN ('awaiting_review','needs_reconciliation','manually_marked_sent')`, **partial UNIQUE `(connector_config_id, action_idempotency_key) WHERE action_idempotency_key IS NOT NULL`**, partial `(organisation_id, expires_at) WHERE status IN ('draft','awaiting_review')`, **partial UNIQUE soft-uniqueness `(organisation_id, ticket_id, created_by_agent_run_id, proposed_visibility) WHERE status IN ('draft','awaiting_review')`**.
- RLS: same canonical template as C1.
- ALTER on `canonical_ticket_messages` (closes the deferred FK from C3):
  ```sql
  ALTER TABLE canonical_ticket_messages
    ADD CONSTRAINT canonical_ticket_messages_source_draft_id_fkey
    FOREIGN KEY (source_draft_id) REFERENCES canonical_ticket_drafts(id);

  CREATE INDEX canonical_ticket_messages_source_draft_idx
    ON canonical_ticket_messages (organisation_id, source_draft_id)
    WHERE source_draft_id IS NOT NULL;
  ```
- TypeScript type `SupportProposedActions` per spec §11.7:
  ```ts
  {
    setStatus?: 'open' | 'pending_internal' | 'waiting_on_customer' | 'resolved';
    addTags?: string[];
    removeTags?: string[];
    setAssignee?: { agentExternalId: string } | null;
  }
  ```
  Zod schema constraint: `setStatus` excludes `closed` and `unknown_provider_status` (spec §11.7 explicit constraint).

**error_handling:**
- Status CHECK violation: typed error `{ statusCode: 422, message: 'support.draft.invalid_status', errorCode: 'support.draft.invalid_status' }`.
- Soft-uniqueness partial UNIQUE violation: typed error `{ statusCode: 409, message: 'support.draft.duplicate_in_pre_dispatch', errorCode: 'support.draft.duplicate_in_pre_dispatch' }` — but C11's `support.propose_reply` should NEVER hit this in normal flow because of the same-transaction supersede-then-insert order. Hitting it indicates the supersede branch was skipped — the dispatch service rejects the path.
- Action-idempotency-key UNIQUE violation: typed 409 mapped per spec §14.6 — body includes the existing draft id and its current state. Returned to the operator UI for refresh.

**dependencies:** C3 (the ALTER acts on `canonical_ticket_messages`), C2 (drafts FK on `canonical_tickets`), C1 (transitively).

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run db:generate` clean.
- Local replay applies 0307 → 0311 cleanly; the FK on `canonical_ticket_messages.source_draft_id` exists post-0311; the partial index exists.
- `RLS_PROTECTED_TABLES` includes `canonical_ticket_drafts`.
- `npm run db:push` rollback test: applying 0311 down migration drops the FK + partial index BEFORE dropping the drafts table (no FK violation at drop time).

**pure_tests:** none (transition-guard tests ship in C11 alongside the dispatch service).

### C5 — Adapter contract extensions (TypeScript only)

**spec_sections:** §6 (entire section), §11 (canonical types as adapter inputs/outputs), §18 (adapter layer files)

**files:**
- MODIFY `server/adapters/integrationAdapter.ts` — add new exported types: `CanonicalInboxData`, `CanonicalSupportAgentData`, `CanonicalTicketData`, `CanonicalTicketMessageData`, `SupportCanonicalStatus`, `SupportStatusMap`. Extend `IntegrationAdapter.ticketing` group with `addInternalNote` + `resolveAttachment`. Extend the existing optional `ingestion` group with `listInboxes`, `listSupportAgents`, `fetchTickets`, `fetchTicketMessages`. Broaden `addReply` signature with `options?: { idempotencyKey?: string; status?: string }`. Broaden `getTicket` to expose internal-note distinction (per spec §6).

**contracts:**
- New types verbatim from spec §6 (already locked there). Notable shapes:
  ```ts
  export type SupportCanonicalStatus =
    | 'open' | 'pending_internal' | 'waiting_on_customer'
    | 'resolved' | 'closed' | 'unknown_provider_status';

  export type SupportStatusMap = Record<string, Exclude<SupportCanonicalStatus, 'unknown_provider_status'>>;

  export interface CanonicalInboxData { externalId: string; name: string; emailAddress?: string; isActive: boolean; externalMetadata?: Record<string, unknown>; }

  export interface CanonicalSupportAgentData {
    externalId: string; displayName: string; email?: string;
    agentKind: 'human' | 'bot'; isActive: boolean;
    externalMetadata?: Record<string, unknown>;
  }

  export interface CanonicalTicketData {
    externalId: string; inboxExternalId: string;
    customerEmail?: string; customerName?: string; customerExternalId?: string;
    subject: string; status: SupportCanonicalStatus;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    assigneeAgentExternalId?: string;
    tags?: string[]; category?: string;
    sourceChannel: 'email' | 'chat' | 'form' | 'api';
    openedAt: Date; firstResponseAt?: Date; lastCustomerMessageAt?: Date;
    lastAgentMessageAt?: Date; closedAt?: Date; resolutionAt?: Date;
    slaDueAt?: Date; slaBreached?: boolean; slaPolicyExternalId?: string;
    externalMetadata?: Record<string, unknown>;
  }

  export interface CanonicalTicketMessageData {
    externalId: string; ticketExternalId: string;
    direction: 'inbound' | 'outbound' | 'internal_note';
    visibility: 'public' | 'internal';
    authorType: 'customer' | 'agent' | 'bot' | 'system';
    authorExternalId?: string;
    bodyText: string; bodyHtml?: string;
    attachments?: Array<{ externalId: string; filename: string; providerUrl: string; mimeType?: string; size?: number; }>;
    createdAtExternal: Date;
    externalMetadata?: Record<string, unknown>;
  }
  ```
- `IntegrationAdapter.ticketing` extensions:
  ```ts
  addInternalNote(connection, ticketId, body, options?: { idempotencyKey?: string }): Promise<TicketReplyResult>;
  resolveAttachment(connection, ticketId, messageId, attachmentExternalId): Promise<{ url?: string; stream?: NodeJS.ReadableStream; mimeType?: string; success: boolean; error?: AdapterError }>;
  ```
- `FetchSupportResult<T>` — shared result wrapper for paginated ingestion methods:
  ```ts
  export interface FetchSupportResult<T> {
    rows: T[];
    partial: boolean;        // true if any page failed before completion
    error?: AdapterError;    // last page-level error, if partial=true
    pagesCompleted?: number; // informational; used by deletion-by-poll precondition check
    rateLimited?: boolean;   // true if a 429 truncated the result set
  }
  ```
- `IntegrationAdapter.ingestion` extensions:
  ```ts
  listInboxes(connection): Promise<CanonicalInboxData[]>;
  listSupportAgents(connection): Promise<CanonicalSupportAgentData[]>;
  fetchTickets(connection, inboxExternalId, opts?: FetchOptions): Promise<FetchSupportResult<CanonicalTicketData>>;
  fetchTicketMessages(connection, ticketExternalId, opts?: FetchOptions): Promise<FetchSupportResult<CanonicalTicketMessageData>>;
  ```
  `listInboxes` and `listSupportAgents` are list-only (no deletion-by-poll concern) and return plain arrays. `fetchTickets` and `fetchTicketMessages` use the wrapper so the C8 deletion-by-poll precondition consumer can inspect `partial` before tombstoning.

**error_handling:**
- Pure type-layer chunk; runtime errors do not arise here. The contract narrows the call-site error surface for downstream chunks (C6, C7, C8).

**dependencies:** none (type-layer; C6 consumes it).

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean — every new exported type compiles. The existing `teamworkAdapter.ts` will not yet implement the new methods (that's C6/C7); existing `ingestion?` is optional so the types compile.
- `npm run build:server` clean.

**pure_tests:** none (type-only chunk).

### C6 — Teamwork ingestion + status mapping fail-closed + webhook event-type extension

**spec_sections:** §6 (status-mapping fail-closed contract), §6 (webhook event-type extension), §7 (sync phase order Phases A-D), §11.2 (locked Teamwork status map), §18 (status map module + test, webhook extension)

**files:**
- CREATE `server/adapters/teamwork/teamworkSupportStatusMap.ts` — pure mapping data + function (`TEAMWORK_SUPPORT_STATUS_MAP` and `mapTeamworkStatus`).
- CREATE `server/adapters/teamwork/teamworkSupportStatusMap.test.ts` — Vitest pure test, fixture matrix per spec §20.
- MODIFY `server/adapters/teamworkAdapter.ts` — implement the four new `ingestion` methods (`listInboxes`, `listSupportAgents`, `fetchTickets`, `fetchTicketMessages`) using existing `getProviderRateLimiter('teamwork').acquire` + `withBackoff` + the existing token decryption + the existing `axios` + `TIMEOUT_MS` shape. Replace existing `mapTicketStatus` (the legacy 4-state version) with `mapTeamworkStatus` for support-canonical-shaped reads where applicable. Extend `mapTeamworkEventType` to handle `'ticket.assigned'` and `'ticket.status_changed'` per spec §6 webhook extension.

**contracts:**
- `mapTeamworkStatus(provider: string | null | undefined): SupportCanonicalStatus` — pure function. NULL/empty/missing key → `'unknown_provider_status'`. Lowercases + trims input. The map (verbatim from spec §11.2):
  ```ts
  export const TEAMWORK_SUPPORT_STATUS_MAP: SupportStatusMap = {
    'active':              'open',
    'waiting on customer': 'waiting_on_customer',
    'on hold':             'pending_internal',
    'solved':              'resolved',
    'closed':              'closed',
    'spam':                'closed',
    'new':                 'open',
    'open':                'open',
    'waiting':             'waiting_on_customer',
    'waitingoncustomer':   'waiting_on_customer',
    'waiting_on_customer': 'waiting_on_customer',
    'awaiting_customer':   'waiting_on_customer',
    'onhold':              'pending_internal',
    'on_hold':             'pending_internal',
    'pending':             'pending_internal',
    'resolved':            'resolved',
  };
  ```
- Adapter methods take an `IntegrationConnection` and return canonical types from §6:
  ```ts
  async function listInboxes(connection: IntegrationConnection): Promise<CanonicalInboxData[]>
  async function listSupportAgents(connection: IntegrationConnection): Promise<CanonicalSupportAgentData[]>
  async function fetchTickets(connection: IntegrationConnection, inboxExternalId: string, opts?: FetchOptions): Promise<FetchSupportResult<CanonicalTicketData>>
  async function fetchTicketMessages(connection: IntegrationConnection, ticketExternalId: string, opts?: FetchOptions): Promise<FetchSupportResult<CanonicalTicketMessageData>>
  ```
- All four methods route through `getProviderRateLimiter('teamwork').acquire(connection.id)` + `withBackoff` for retryable errors (per `classifyAdapterError`). The status field on `CanonicalTicketData` is set via `mapTeamworkStatus(rawProviderStatus)`.
- `mapTeamworkEventType` extension: cases for `'ticket.assigned'` → `entityType: 'ticket'`, `'ticket.status_changed'` → `entityType: 'ticket'`. Existing cases retained verbatim.
- Pagination in `fetchTickets` / `fetchTicketMessages` via Teamwork's standard `?page=` + `?pageSize=` — existing pattern from `teamworkAdapter` extended; full pagination is required so a single `fetchTickets` call returns all tickets in the inbox window (used by the deletion-by-poll precondition in C8).

**error_handling:**
- Status-map miss (any provider value not in the table, including custom statuses) → `'unknown_provider_status'`. The mapping function never throws.
- Rate-limit response (429) from Teamwork → `withBackoff` retries; on exhaustion the adapter returns a `classifyAdapterError`-shaped result with `retryable: true`. C8 polling service then emits `support.provider.rate_limited` log code.
- Network error / timeout → `classifyAdapterError` with `retryable: true`. C8 polling emits `support.provider.poll_page_failed` (poll path) or C11 dispatch routes the draft to `needs_reconciliation` (dispatch path).
- A page-level fetch failure inside `fetchTickets` returns a `FetchSupportResult` with `partial=true` and `rows` containing any pages that completed (Phase 2 confirms — see §17.1 manual smoke). The deletion-by-poll precondition consumer (C8) checks `partial=true` and refuses to tombstone.

**dependencies:** C5 (adapter contract types).

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean — `teamworkAdapter` now satisfies the extended `IntegrationAdapter` shape's optional `ingestion` group methods.
- `npm run build:server` clean.
- `npx vitest run server/adapters/teamwork/teamworkSupportStatusMap.test.ts` passes — fixture matrix covers every map entry, NULL, empty, mixed-case, unknown-custom-status (asserts fall-through to `'unknown_provider_status'`).

**pure_tests:**
- `server/adapters/teamwork/teamworkSupportStatusMap.test.ts` — fixture matrix per spec §20:
  - Every key in `TEAMWORK_SUPPORT_STATUS_MAP` returns the documented canonical value.
  - NULL, undefined, empty string → `'unknown_provider_status'`.
  - Mixed-case input (`'On Hold'`, `'WAITING ON CUSTOMER'`) returns the same value as lowercased.
  - Unknown custom status (`'OnHoldByEngineering'`) → `'unknown_provider_status'`.
  - Type assertion: result type is `SupportCanonicalStatus`.

### C7 — Teamwork `addInternalNote` + `resolveAttachment` + idempotency-key plumbing (closes OQ-3 + OQ-4)

**spec_sections:** §6 (`addInternalNote`, `resolveAttachment`), §14.1 (idempotency mechanism), §22 (OQ-3, OQ-4), §17.2 capability matrix `?` rows, §18 (conditional migration 0312)

**files:**
- MODIFY `server/adapters/teamworkAdapter.ts` — implement `addInternalNote(connection, ticketId, body, options?)` and `resolveAttachment(connection, ticketId, messageId, attachmentExternalId)`. Broaden existing `addReply` to forward `options?.idempotencyKey` (header forward if OQ-3 lands "yes"; otherwise ledger lookup before adapter call).
- **CONDITIONAL — only ships if OQ-3 lands "no native idempotency":**
  - CREATE `migrations/0312_action_attempts.sql` — DDL + indexes + FORCE RLS + canonical org-isolation policy.
  - CREATE `migrations/0312_action_attempts.down.sql`.
  - CREATE `server/db/schema/actionAttempts.ts` — Drizzle schema for `action_attempts`.
  - MODIFY `server/config/rlsProtectedTables.ts` — append `action_attempts` entry.
  - **Migration numbering note:** if OQ-3 resolves "native idempotency supported," no `0312` file is created and the sequence number `0312` remains available for the next future migration in this repo — do not create a placeholder or no-op file. If the repo convention requires contiguous numbering, confirm with the operator before C7 closes; if a placeholder is required, create a no-op migration `0312_action_attempts_skipped.sql` that is a comment-only file with an empty up and a no-op down, and document the reason inline.
- **CONDITIONAL — same-PR spec amendment if OQ-3/OQ-4 close:** edit `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md` §6, §17.2 capability matrix `?` rows, §18 conditional migration list, §22 OQ-3/OQ-4 closer to `yes:<header>` / `no:<ledger>` (OQ-3) and `{url}` / `{stream}` (OQ-4). The C7 closer commits this amendment in the same PR.

**contracts:**
- `addInternalNote(connection: IntegrationConnection, ticketId: string, body: string, options?: { idempotencyKey?: string }): Promise<TicketReplyResult>` — calls Teamwork's notes endpoint per the audit. Forwards `idempotencyKey` per OQ-3 outcome.
- `resolveAttachment(connection, ticketId, messageId, attachmentExternalId): Promise<{ url?: string; stream?: NodeJS.ReadableStream; mimeType?: string; success: boolean; error?: AdapterError }>` — narrowed return shape per OQ-4 outcome. Implementation detail per the auth model audit.
- **Conditional `action_attempts` table** (only if OQ-3 = no native idempotency):
  - DDL columns per spec §14.1: `id uuid PRIMARY KEY`, `organisation_id uuid NOT NULL`, `connector_config_id uuid NOT NULL`, `idempotency_key text NOT NULL`, `action_type text NOT NULL`, `attempt_status text NOT NULL`, `attempted_at timestamptz NOT NULL`, `succeeded_at timestamptz NULL`, `provider_response_id text NULL`.
  - CHECK constraints: `action_type` ∈ `('reply','internal_note','status_change','assignment_change','tag_change')`; `attempt_status` ∈ `('in_flight','succeeded','failed')`.
  - DDL indexes: `UNIQUE (connector_config_id, idempotency_key)`, `(organisation_id, attempt_status, attempted_at)`.
  - RLS: same canonical template as C1.
- The adapter wrapper logic (post-OQ-3):
  - If native idempotency: forward the `Idempotency-Key` header (or equivalent) to Teamwork; provider deduplicates server-side. No `action_attempts` ledger needed.
  - If no native idempotency: before calling the adapter, `INSERT INTO action_attempts (..., attempt_status='in_flight') ON CONFLICT (connector_config_id, idempotency_key) DO NOTHING RETURNING id`. If `RETURNING` returns 0 rows (key already exists), look up the existing row's `attempt_status` + `provider_response_id`; if `succeeded`, return the cached result; if `in_flight` or `failed`, route the caller to `needs_reconciliation` instead of re-issuing the adapter call.

**error_handling:**
- `addInternalNote` and `resolveAttachment` use `classifyAdapterError` — retryable errors flagged for `withBackoff`; terminal errors return `{ success: false, error: ... }`.
- `resolveAttachment` failure → `support.attachment.resolve_failed` log code (§15) emitted by the caller (C13's ticket detail view).
- Action-idempotency-key UNIQUE violation on `action_attempts` insert (race) → look up the existing row and treat as already-in-flight; emit `support.action.retry_idempotent` log code (§15).

**dependencies:** C5 (adapter contract), C6 (existing Teamwork adapter shape established). C4 (the dispatch path uses `action_idempotency_key` on drafts; the action_attempts ledger mirrors the same key).

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run build:server` clean.
- If 0312 ships: local replay applies 0307 → 0312 cleanly; `RLS_PROTECTED_TABLES` includes `action_attempts`.
- OQ-3 + OQ-4 closure committed in the same PR — spec amendment lands in the same chunk.
- Operator manual sandbox smoke: one Teamwork attachment URL/stream returns successfully via `resolveAttachment` (per spec §17.1 acceptance criterion).

**pure_tests:** none in this chunk (idempotency-key derivation is tested in C11's `supportDraftDispatchService.test.ts`; the action_attempts ledger row-shape is exercised by the dispatch service's pure decision module).

### C8 — Connector polling integration (Phases A → D + sync-health classification + customer-identity resolution)

**spec_sections:** §7 (entire ingestion flow), §11.6 (customer-identity resolution), §13 (sync-health classification piggybacks on poll cycle), §15 (`support.provider.poll_page_failed`, `support.ingest.contact_unmatched`, `support.ingest.duplicate_collapsed`, `support.status.unknown_provider_status`, `support.provider.rate_limited`, `support.ticket.provider_deleted`), §18 (polling extension)

**files:**
- MODIFY `server/services/connectorPollingService.ts` — extend the existing poll loop with the four-phase support ingestion (Phases A → B → C → D) per spec §7. Wire status-mapping fail-closed application + customer-identity resolution + duplicate-collapsed observability. Add a separate "full-reconciliation pass" entry point for the deletion-by-poll precondition (operator-triggered initially; cron deferred).
- CREATE `server/services/supportContactResolutionPure.ts` — pure email-match resolver per spec §11.6.
- CREATE `server/services/__tests__/supportContactResolutionPure.test.ts` — Vitest pure test per spec §20.
- CREATE `shared/types/supportObservability.ts` — `SUPPORT_LOG_CODES` const per spec §15. Owned by C8 (initial codes that C8 emits); extended in C9 with the remaining codes.

**contracts:**
- `supportContactResolutionPure.resolveByEmail(email: string | null, candidateContacts: Array<{ id: string; email: string }>): { canonicalContactId: string | null; emailMatchCount: 0 | 1 | 'multiple' }` — pure function. Behaviour:
  - NULL/empty email → `{ canonicalContactId: null, emailMatchCount: 0 }`.
  - One match (case-insensitive) → `{ canonicalContactId: <id>, emailMatchCount: 1 }`.
  - Multiple matches → `{ canonicalContactId: null, emailMatchCount: 'multiple' }`.
- The polling extension at the call-site:
  ```ts
  // Phase A — listInboxes upsert keyed on (connector_config_id, external_id)
  // Phase B — listSupportAgents upsert keyed on (connector_config_id, external_id)
  // Phase C — fetchTickets(inboxExternalId, since=cursor) per active inbox
  //          UPSERT canonical_tickets ON CONFLICT (connector_config_id, external_id) DO UPDATE
  //          Resolve customer identity via supportContactResolutionPure
  //          Apply status-mapping fail-closed (raw value preserved in external_metadata.provider_status_raw if status='unknown_provider_status')
  //          Emit support.status.unknown_provider_status when the ticket lands quarantined
  // Phase D — fetchTicketMessages(ticketExternalId, since=cursor) per ticket touched in Phase C
  //          UPSERT canonical_ticket_messages ON CONFLICT (connector_config_id, ticket_external_id, external_id) DO UPDATE
  ```
- Full-reconciliation pass entry point (`pollSupportFullReconciliation(connectorConfigId)`):
  - Fetches every page of `fetchTickets` for each active inbox unconditionally (no `since` cursor).
  - Tracks page-level success/failure inline; aborts tombstoning if any page failed, any rate-limit truncation occurred, or `support.provider.poll_page_failed` was emitted during the pass.
  - Computes the set of `canonical_tickets.external_id` for the inbox locally and the set returned by the provider; the difference is candidate-tombstoned tickets ONLY if all preconditions held.
  - Sets `provider_deleted=true`, `deleted_at_canonical=NOW()`, `deletion_source='provider_poll_observation'` on candidates. Emits `support.ticket.provider_deleted`.
- Emit sites: `support.provider.poll_page_failed` (page error), `support.provider.rate_limited` (429), `support.ingest.contact_unmatched` (zero or `multiple` email match), `support.status.unknown_provider_status` (mapping fail-closed), `support.ingest.duplicate_collapsed` (UNIQUE constraint hit by upsert that produced no change), `support.ticket.provider_deleted` (full-reconciliation pass tombstone).

**error_handling:**
- Per-page failures don't abort the full poll cycle: they emit `support.provider.poll_page_failed` and continue with the next page. The `partial: true` envelope from C6 lets the full-reconciliation pass refuse to tombstone.
- Rate-limit truncation: `support.provider.rate_limited` emitted; the cycle exits gracefully (no partial-success ambiguity); the next cycle picks up where the cursor left off.
- Customer-identity NULL is not an error — leave `canonical_contact_id` NULL and emit `support.ingest.contact_unmatched`. Brief §10 #2.
- The polling service runs under `withAdminConnection` for the top-level loop, then `withOrgTx(organisationId)` per tenant (per architecture.md § Five patterns for service-tier DB access, pattern 4).

**dependencies:** C6 (Teamwork adapter ingestion methods), C2 + C3 (canonical_tickets and canonical_ticket_messages exist), C1 (canonical_inboxes and canonical_support_agents).

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run build:server` clean.
- `npx vitest run server/services/__tests__/supportContactResolutionPure.test.ts` passes — fixture matrix covers every branch (zero match, single, ambiguous, NULL email, case-insensitive match, whitespace-trim).

**pure_tests:**
- `server/services/__tests__/supportContactResolutionPure.test.ts` — fixture matrix per spec §20:
  - NULL/empty email → `{ canonicalContactId: null, emailMatchCount: 0 }`.
  - Single match → `{ canonicalContactId: <id>, emailMatchCount: 1 }`.
  - Two matches → `{ canonicalContactId: null, emailMatchCount: 'multiple' }`.
  - Case-insensitive equivalence (`'Foo@Example.COM'` matches `'foo@example.com'`).
  - Whitespace tolerance.

### C9 — Webhook ingestion convergent dual-path + dispatcher updates (extends `SUPPORT_LOG_CODES`)

**spec_sections:** §7 (webhook + poll convergence), §6 (webhook event-type extension — runtime wiring), §8.5 (back-link match logic), §11.8 (reconciliation decision contract), §15 (`support.ingest.duplicate_collapsed`, `support.provider.webhook_unmapped_event`, `support.ticket.provider_deleted`, `support.message.redacted`), §18 (webhook integration)

**files:**
- MODIFY `server/services/webhookAdapterService.ts` — extend dispatcher cases for `ticket.created`, `ticket.updated`, `ticket.reopened`, `ticket.completed`, `ticket.deleted` (existing event types now route to canonical_tickets upsert) plus `ticket.assigned`, `ticket.status_changed` (new), `ticket.reply.created`, `ticket.note.created` (route to canonical_ticket_messages upsert + back-link routine). Wire `support.message.redacted` event handling per spec §5.2 if Teamwork exposes it (defensive — column ships regardless).
- CREATE `server/services/supportDraftReconciliationPure.ts` — pure decision module for `needs_reconciliation` + **back-link match logic** for §8.5. Moved here from C11 because the webhook back-link routine (C9) is the first consumer; C11's reconciliation worker imports it from this location.
- CREATE `server/services/__tests__/supportDraftReconciliation.test.ts` — Vitest pure test per spec §20 (back-link match logic + reconciliation decision matrix). Moved here alongside the module it tests.
- MODIFY `shared/types/supportObservability.ts` — extend `SUPPORT_LOG_CODES` const (created in C8) with the C9-emitted codes plus the C11 dispatch-lifecycle codes plus the §5.1/§5.2 tombstone codes.

**contracts:**
- Webhook handler per event type:
  - `ticket.created/updated/reopened/completed` → upsert `canonical_tickets` keyed on `(connector_config_id, external_id)` (deterministic update; no duplicate insert).
  - `ticket.deleted` → set `provider_deleted=true`, `deleted_at_external=event.timestamp`, `deleted_at_canonical=NOW()`, `deletion_source='provider_webhook'`. Emit `support.ticket.provider_deleted`.
  - `ticket.assigned` → update `assignee_agent_id` lookup via `canonical_support_agents` external_id.
  - `ticket.status_changed` → update `status` via `mapTeamworkStatus`; preserve raw in `external_metadata.provider_status_raw` on quarantine; emit `support.status.unknown_provider_status` on quarantine.
  - `ticket.reply.created` / `ticket.note.created` → upsert `canonical_ticket_messages` keyed on `(connector_config_id, ticket_external_id, external_id)`. Run the **back-link routine** per spec §8.5 after a successful insert: look up drafts on the same ticket in `manually_marked_sent` (or `sent` with `sent_message_id IS NULL` for any pre-`manually_marked_sent` rows) whose `proposed_visibility` matches the message direction; attempt body + timestamp match via `supportDraftReconciliationPure.findBackLinkCandidate` (defined in this chunk); on unique match, set `source_draft_id` on the message + `sent_message_id` on the draft + transition `manually_marked_sent → sent`.
  - Provider redaction event (if exposed) → set `redacted=true`, null out `body_text`, `body_html`, `attachments` per spec §5.2; emit `support.message.redacted`.
  - Unknown event type → emit `support.provider.webhook_unmapped_event` (engineering signal); no row write.
- `SUPPORT_LOG_CODES` final shape (verbatim from spec §15):
  ```ts
  export const SUPPORT_LOG_CODES = {
    STATUS_UNKNOWN_PROVIDER_STATUS: 'support.status.unknown_provider_status',
    INGEST_DUPLICATE_COLLAPSED: 'support.ingest.duplicate_collapsed',
    INGEST_CONTRACT_VIOLATION: 'support.ingest.contract_violation',
    DRAFT_BACKLINK_AMBIGUOUS: 'support.draft.backlink_ambiguous',
    ACTION_RETRY_IDEMPOTENT: 'support.action.retry_idempotent',
    ACTION_PROVIDER_CONFLICT: 'support.action.provider_conflict',
    ATTACHMENT_RESOLVE_FAILED: 'support.attachment.resolve_failed',
    TICKET_HUMAN_COLLISION_BLOCKED: 'support.ticket.human_collision_blocked',
    INGEST_CONTACT_UNMATCHED: 'support.ingest.contact_unmatched',
    PROVIDER_RATE_LIMITED: 'support.provider.rate_limited',
    PROVIDER_POLL_PAGE_FAILED: 'support.provider.poll_page_failed',
    PROVIDER_WEBHOOK_UNMAPPED_EVENT: 'support.provider.webhook_unmapped_event',
    DRAFT_SENT: 'support.draft.sent',
    DRAFT_FAILED: 'support.draft.failed',
    DRAFT_REJECTED: 'support.draft.rejected',
    DRAFT_EXPIRED: 'support.draft.expired',
    DRAFT_SUPERSEDED: 'support.draft.superseded',
    DRAFT_MANUALLY_MARKED_SENT: 'support.draft.manually_marked_sent',
    TICKET_PROVIDER_DELETED: 'support.ticket.provider_deleted',
    TICKET_RESTORED_AFTER_DELETION: 'support.ticket.restored_after_deletion',
    MESSAGE_REDACTED: 'support.message.redacted',
  } as const;
  ```

**error_handling:**
- The dispatcher's existing `external_event_id` dedupe collapses re-deliveries at the boundary. Webhook + sync-confirm collisions in the upsert path use `ON CONFLICT DO NOTHING` (messages) or `ON CONFLICT DO UPDATE` (tickets) and emit `support.ingest.duplicate_collapsed`.
- Webhook signature verification failure → existing `webhookService.recordIncident` 5xx coverage; not changed by this chunk.
- Back-link routine ambiguous match (body matches multiple drafts) → emit `SUPPORT_LOG_CODES.DRAFT_BACKLINK_AMBIGUOUS` (`'support.draft.backlink_ambiguous'`) at warn level; leave the draft in `manually_marked_sent`; surface in audit history.

**dependencies:** C6 (existing webhook event-type extension in `mapTeamworkEventType`), C5 (canonical adapter types), C2 + C3 (canonical_tickets and canonical_ticket_messages exist), C8 (`SUPPORT_LOG_CODES` file already exists).

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run build:server` clean.
- `npx vitest run server/services/__tests__/supportDraftReconciliation.test.ts` passes — back-link match logic + reconciliation decision matrix.
- `verify-audit-event-namespace.sh` passes — every new `support.*` code is in `SUPPORT_LOG_CODES`. (CI gate; run is verification-only at chunk close.)

**pure_tests:**
- `server/services/__tests__/supportDraftReconciliation.test.ts`:
  - `decideOutcome` returns each of `resolve_sent | resolve_failed | retry_after_ms | surface_manual` in the documented circumstances.
  - Reconciliation budget exhaustion → `surface_manual` (never auto-fail).
  - `findBackLinkCandidate` returns the unique draft when body + timestamp align (reply path); same for internal-note path; returns `{ match: null, ambiguous: true }` when multiple drafts match (operator-resolution case).

### C10 — `supportTicketService` + `supportInboxService` (read-only canonical reads)

**spec_sections:** §5.1.A (ticket transition matrix), §5.2.A (thread ordering), §5.2.B (audience-tier read separation), §9 (skill consumers — read paths), §11.5 (inbox agent_config), §11.8 (read API boundary), §18 (services)

**files:**
- CREATE `server/services/supportTicketService.ts` — read-only canonical reads + thread assembly.
- CREATE `server/services/supportTicketServicePure.ts` — pure transition guard for `canonical_tickets.status` + read-filter helpers.
- CREATE `server/services/__tests__/supportTicketServicePure.test.ts` — Vitest pure test per spec §20.
- CREATE `server/services/supportInboxService.ts` — config CRUD with Zod-validated `agent_config` writes.

**contracts:**
- `supportTicketService` exports:
  ```ts
  async function readThreadForAgent(ticketId: string, principalCtx: PrincipalContext): Promise<{ ticket: CanonicalTicket; messages: CanonicalTicketMessage[] }>;
  async function readThreadForHumanUi(ticketId: string, principalCtx: PrincipalContext): Promise<{ ticket: CanonicalTicket; messages: CanonicalTicketMessage[]; draftOverlay: CanonicalTicketDraft[] }>;
  async function getTicket(ticketId: string, principalCtx: PrincipalContext): Promise<CanonicalTicket>;
  async function listOpenTickets(filter: { inboxIds?: string[]; statusGroup?: 'needs_attention' | 'all_open' | 'quarantined' }, principalCtx): Promise<CanonicalTicket[]>;
  async function applyStatusChange(ticketId: string, newStatus: SupportCanonicalStatus, principalCtx): Promise<void>;      // routes via adapter; canonical update happens on next ingestion
  async function applyAssignmentChange(ticketId: string, assigneeAgentExternalId: string | null, principalCtx): Promise<void>; // routes via adapter; null clears assignee
  async function applyTagMutation(ticketId: string, mutation: { addTags?: string[]; removeTags?: string[] }, principalCtx): Promise<void>;  // routes via adapter
  ```
- `supportTicketServicePure` exports:
  ```ts
  function isValidTicketStatusTransition(from: SupportCanonicalStatus, to: SupportCanonicalStatus): boolean;
  function filterDeletedFromAgentReads<T extends { providerDeleted: boolean }>(rows: T[]): T[];
  function applyMessageRedactionFilterForAudience(messages: CanonicalTicketMessage[], audience: 'agent' | 'human_ui' | 'audit'): CanonicalTicketMessage[];
  ```
- Read-path posture (per §5.2.B + §12):
  - `readThreadForAgent` runs under `withPrincipalContext(toPrincipalContext(principalCtx), …)` inside `withOrgTx(orgId)`. Returns ONLY `canonical_ticket_messages` rows; NEVER drafts. Filters out `provider_deleted=true` tickets at the service boundary; redacted messages render with `body_text='[redacted]'` (the column value is already overwritten in canonical, so no transformation needed at read time).
  - `readThreadForHumanUi` overlays `canonical_ticket_drafts` rows in `dispatching | needs_reconciliation | manually_marked_sent` states. Draft rows visually distinct from confirmed messages (UI concern, but the API surface separates them).
  - `listOpenTickets` filters `provider_deleted=true` rows out of the agent-facing `needs_attention` and `all_open` groups; `quarantined` group returns `unknown_provider_status` tickets only.
- `supportInboxService` exports:
  ```ts
  async function listInboxes(principalCtx: PrincipalContext): Promise<CanonicalInbox[]>;
  async function getInbox(inboxId: string, principalCtx): Promise<CanonicalInbox>;
  async function updateAgentConfig(inboxId: string, config: SupportInboxAgentConfig, principalCtx): Promise<CanonicalInbox>;
  ```
- All methods use `getOrgScopedDb` inside `withOrgTx(principalCtx.organisationId)` so RLS applies. `updateAgentConfig` runs `SupportInboxAgentConfigSchema.parse(config)` before the UPDATE — invalid shape produces `{ statusCode: 422, message: 'support.inbox.agent_config_invalid', errorCode: 'support.inbox.agent_config_invalid' }`.

**error_handling:**
- Invalid status transition in `applyStatusChange` → typed error `{ statusCode: 422, message: 'support.ticket.invalid_transition', errorCode: 'support.ticket.invalid_transition' }`.
- Inbox not found → `{ statusCode: 404, message: 'support.inbox.not_found', errorCode: 'support.inbox.not_found' }`.
- Ticket not found / cross-tenant access (RLS denies) → `{ statusCode: 404, message: 'support.ticket.not_found', errorCode: 'support.ticket.not_found' }` — never a 403 (RLS makes the row invisible; consumers cannot distinguish).
- `getTicket` on a `provider_deleted=true` row from agent-facing path → 404 (consistent with read-filter).

**dependencies:** C1 (`canonical_inboxes`, `canonical_support_agents`), C2 (`canonical_tickets`), C3 (`canonical_ticket_messages`), C4 (`canonical_ticket_drafts` for the human-UI overlay), C8 (ingested data populates the rows). Conceptually depends on existing `withPrincipalContext` + `withOrgTx` + `getOrgScopedDb` primitives.

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run build:server` clean.
- `npx vitest run server/services/__tests__/supportTicketServicePure.test.ts` passes.

**pure_tests:**
- `server/services/__tests__/supportTicketServicePure.test.ts` — covers (per spec §18 + §20):
  - Every valid transition in `canonical_tickets.status` accepts; every forbidden transition rejects (including `closed → open` not allowed via inbound message; `unknown_provider_status → any_other` permitted only when input row has a mapped status).
  - Deletion read-filter: agent reads exclude `provider_deleted=true`; human UI sees tombstone; audit sees deletion-source label.
  - Redaction read-filter: agent sees `'[redacted]'`; human UI sees tombstone; audit sees `'[redacted]'`.
  - Deletion-by-poll precondition: incremental poll never sets `provider_deleted` (the pure module's preconditions function returns `false` when any condition unmet); full-reconciliation pass with all preconditions met returns `true`; pass with any condition unmet returns `false`.

### C11 — `supportDraftDispatchService` (three-phase dispatch + boot recovery + reconciliation worker)

**spec_sections:** §8 (entire dispatch section), §11.7 (proposed_actions), §11.8 (reconciliation decision contract), §14.1–§14.7 (execution-safety contracts), §15 (dispatch-lifecycle codes), §18 (services + worker)

**files:**
- CREATE `server/services/supportDraftDispatchService.ts` — three-phase dispatch (preflight → durable transition → adapter call), manual collision override (§8.6), manual-resolve actions (§8.5).
- CREATE `server/services/supportDraftDispatchServicePure.ts` — pure transition guard + idempotency-key derivation + same-run supersession transaction-order helper.
- CREATE `server/services/__tests__/supportDraftDispatchService.test.ts` — Vitest pure test per spec §20.
- CREATE `server/jobs/supportDraftReconciliationWorker.ts` — pg-boss worker on `support-draft-reconciliation` queue. Imports `decideOutcome` from `supportDraftReconciliationPure.ts` (authored in C9).
- CREATE `server/lib/supportDispatchBootRecovery.ts` — one-shot startup scan (R5 mitigation).
- MODIFY `server/jobs/index.ts` — register the worker at boot via `createWorker`.

**Note: this chunk has 6 files (down from 8 after moving `supportDraftReconciliationPure.ts` and its test to C9, where the first consumer lives). Per the chunk-sizing audit (§4.1), this remains one logical responsibility ("ship the dispatch service").**

**contracts:**
- `supportDraftDispatchService` public API:
  ```ts
  async function approveDraft(draftId: string, principalCtx: PrincipalContext, options?: { overrideCollision?: boolean; reviewNotes?: string }): Promise<{ status: CanonicalTicketDraft['status']; messageId?: string }>;
  async function rejectDraft(draftId: string, principalCtx: PrincipalContext, reason: string): Promise<void>;
  async function editDraftBody(draftId: string, body: string, principalCtx): Promise<void>;
  async function manualResolveDispatch(draftId: string, action: 'mark_sent' | 'mark_failed' | 'retry_reconciliation', principalCtx, notes?: string): Promise<void>;
  async function proposeReply(input: { ticketId: string; body: string; visibility: 'public' | 'internal'; proposedActions?: SupportProposedActions; runId: string }, principalCtx): Promise<CanonicalTicketDraft>;
  ```
- `supportDraftDispatchServicePure` exports:
  ```ts
  function isValidDraftStatusTransition(from: DraftStatus, to: DraftStatus): boolean;  // closed enum, post-terminal prohibition
  function deriveActionIdempotencyKey(input: { connectorConfigId: string; ticketId: string; actionType: 'reply' | 'internal_note'; draftId: string }): string;
  function deriveInPlaceActionKey(input: { connectorConfigId: string; ticketId: string; actionType: 'status_change' | 'assignment_change' | 'tag_change'; payload: Record<string, unknown> }): string;
  function planSameRunSupersession(input: { existingDraft: CanonicalTicketDraft | null; newProposal: { ... } }): { action: 'insert_only' | 'supersede_then_insert' };
  ```
- `supportDraftReconciliationPure` — **module authored in C9** (moved there because the webhook back-link routine is the first consumer). C11's reconciliation worker imports from `server/services/supportDraftReconciliationPure.ts`. Exports (reproduced here for completeness):
  ```ts
  type ReconciliationDecision =
    | { kind: 'resolve_sent'; messageData: CanonicalTicketMessageData }
    | { kind: 'resolve_failed'; reason: string }
    | { kind: 'retry_after_ms'; ms: number }
    | { kind: 'surface_manual'; reason: string };

  function decideOutcome(input: { draft: CanonicalTicketDraft; latestMessages: CanonicalTicketMessageData[]; attemptCount: number; maxAttempts: number }): ReconciliationDecision;

  function findBackLinkCandidate(input: { newlyLandedMessage: CanonicalTicketMessage; candidateDrafts: CanonicalTicketDraft[] }): { match: CanonicalTicketDraft | null; ambiguous: boolean };
  ```
- Three-phase implementation in `approveDraft`:
  1. **Preflight (§8.1):** load draft + ticket + inbox `agent_config`. Run six checks (valid pre-state, inbox not disabled, ticket not quarantined, status eligible per §5.1.A column 3, collision-window OK or override permitted, not superseded). On fail return typed reason without phase 2.
  2. **Durable transition (§8.2):** single `UPDATE canonical_ticket_drafts SET status='dispatching', action_idempotency_key=$key, dispatching_started_at=NOW(), reviewer_user_id=$userId, reviewed_at=NOW(), updated_at=NOW() WHERE id=$draftId AND status IN ('draft','awaiting_review') AND organisation_id=current_setting('app.organisation_id', true)::uuid RETURNING *`. 0 rows → return current state (first-commit-wins).
  3. **Adapter call (§8.3):** call `adapter.ticketing.addReply` or `addInternalNote` with the key. On success: insert `canonical_ticket_messages` (with `source_draft_id=draft.id`) + transition draft `dispatching → sent` + emit `support.draft.sent`. On retryable failure: transition `dispatching → needs_reconciliation` + enqueue worker. On terminal failure: transition `dispatching → failed` + emit `support.draft.failed`.
- `proposeReply` uses the same-run supersession transaction-order pattern (R6 mitigation). Within one transaction:
  ```sql
  -- Step (a): UPDATE supersede the prior pre-dispatch draft, if any
  UPDATE canonical_ticket_drafts
  SET status = 'superseded', updated_at = NOW()
  WHERE organisation_id = $orgId
    AND ticket_id = $ticketId
    AND created_by_agent_run_id = $runId
    AND proposed_visibility = $visibility
    AND status IN ('draft', 'awaiting_review');

  -- Step (b): INSERT the new draft
  INSERT INTO canonical_ticket_drafts (...) VALUES (...);
  ```
  Inverting the order fires the partial UNIQUE.
- Reconciliation worker (`supportDraftReconciliationWorker.ts`):
  - Registered via `createWorker({ queueName: 'support-draft-reconciliation', handler: processReconciliation })`.
  - `processReconciliation` increments `reconciliation_attempt_count`, sets `last_reconciliation_at=NOW()`, calls `decideOutcome` from the pure module, then commits the resulting transition. `withBackoff`-managed retry budget (default `max_attempts=5`).
- Boot recovery (`supportDispatchBootRecovery.ts`):
  - One-shot scan on server start. SELECT drafts with `status='dispatching' AND dispatching_started_at < NOW() - INTERVAL '60 seconds'`. For each: transition to `needs_reconciliation` and enqueue the worker. Idempotent across concurrent process restarts (the UPDATE uses `WHERE status='dispatching'` so only one process succeeds per draft).
  - Registered in `server/index.ts` startup sequence after `pg-boss` ready.
- Manual collision override (§8.6):
  - `approveDraft` with `overrideCollision: true` first calls `assertScope(principal, 'support.draft.override_collision')`. On grant: writes an `auditEvents` row (`action: 'support.draft.collision_override'`, recording user/draft/original collision state/notes). Re-runs phase 1 with collision check skipped.
  - `overrideCollision: true` from an agent-run principal (no human user ID) is rejected: `{ statusCode: 403, message: 'support.draft.override_collision_human_only', errorCode: 'support.draft.override_collision_human_only' }`.
- Manual-resolve actions (§8.5):
  - `mark_sent` → transition `needs_reconciliation → manually_marked_sent` (NOT terminal `sent`); does NOT insert a `canonical_ticket_messages` row; emit `support.draft.manually_marked_sent`; audit-event row.
  - `mark_failed` → transition `needs_reconciliation → failed`; emit `support.draft.failed` with `reason='operator_marked_failed'`; audit-event row.
  - `retry_reconciliation` → re-enqueue the worker with the same key; reset budget.
- Companion `proposed_actions` mutations (§8.3 last paragraph + §14.5): applied after the message insert succeeds; partial-success surfaces via `partial: true` on the `support.draft.sent` event + `support.action.provider_conflict` log code on the failed mutation.

**error_handling:**
- All preflight failures return typed reasons (§8.1): `inbox_disabled`, `ticket_quarantined`, `ticket_status_ineligible`, `human_collision_blocked`, `superseded_by_newer_draft`, `customer_match_required`. Mapped to `{ statusCode: 422, message: 'support.draft.preflight_failed', errorCode: <reason> }`.
- Phase 2 zero-row: `{ status: 'already_dispatched', currentState: <draft.status> }` returned to caller (not an error — graceful no-op).
- Adapter call exceptions classified via `classifyAdapterError` — retryable → reconciliation; terminal → `failed`.
- Action-idempotency-key UNIQUE violation (race): catch `23505`, look up the existing draft, return its state (HTTP 409 per §14.6).
- Reconciliation worker exhaustion: `surface_manual` decision; no automatic transition; the operator's §8.5 surface drives resolution.

**dependencies:** C7 (Teamwork `addInternalNote`/`resolveAttachment`/idempotency plumbing), C9 (`supportDraftReconciliationPure.ts` resides here — the reconciliation worker imports from it), C10 (read services for preflight loading), C4 (drafts table), C3 (messages table for the post-confirmation insert).

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run build:server` clean.
- `npx vitest run server/services/__tests__/supportDraftDispatchService.test.ts` passes — fixture matrix per spec §20 + same-run supersession transaction-order test.
- The reconciliation worker registers at boot (spot-check via boot log).
- Note: `supportDraftReconciliation.test.ts` runs at C9 close; this chunk's acceptance does not re-run it, but verifies the import compiles.

**pure_tests:**
- `server/services/__tests__/supportDraftDispatchService.test.ts`:
  - Every valid `canonical_ticket_drafts.status` transition accepts; every forbidden transition rejects (including post-terminal prohibition; `dispatching → expired` forbidden; `manually_marked_sent → failed/expired/rejected` forbidden; `manually_marked_sent → sent` permitted via back-link route).
  - State-invariant CHECKs: `sent ⇒ sent_message_id IS NOT NULL`; `manually_marked_sent ⇒ sent_message_id IS NULL`.
  - Idempotency-key derivation: same inputs → same key (deterministic); different inputs → different key.
  - Same-run supersession transaction-order: planned shape returns `'supersede_then_insert'` when prior draft exists in `('draft','awaiting_review')`; returns `'insert_only'` otherwise.

### C12 — Skill registrations (10 skills under `server/skills/support/`)

**spec_sections:** §9 (entire skill surface), §10 (UI consumers), §18 (skills + actionRegistry)

**files:**
- CREATE `server/skills/support/list-open-tickets.md`
- CREATE `server/skills/support/read-thread.md`
- CREATE `server/skills/support/propose-reply.md`
- CREATE `server/skills/support/add-internal-note.md`
- CREATE `server/skills/support/approve-draft.md`
- CREATE `server/skills/support/reject-draft.md`
- CREATE `server/skills/support/set-status.md`
- CREATE `server/skills/support/assign.md`
- CREATE `server/skills/support/tag.md`
- CREATE `server/skills/support/find-customer-history.md`
- MODIFY `server/config/actionRegistry.ts` — register the `support.*` action group (10 entries) with `idempotencyStrategy`, `defaultGateLevel`, `requiredIntegration?: 'teamwork'` (the others are read-only or canonical-only). Register the four new permission keys (`support.draft.approve`, `support.draft.reject`, `support.draft.override_collision`, `support.inbox.configure`) per the existing pattern.
- MODIFY `server/services/skillExecutor.ts` — extend `SKILL_HANDLERS` map with handlers for each `support.*` slug. Most are thin shells over `supportTicketService`, `supportInboxService`, or `supportDraftDispatchService`.

**Note: this chunk has 12 files but they collapse to two responsibilities ("define the 10 skill markdown files" + "wire the action registry + handlers"). The 10 markdown files are mechanical content with the same template and ship as a unit. Acceptable per chunk-sizing.**

**contracts:**
- Skill markdown structure per the existing convention (`server/skills/<slug>.md` with frontmatter + body):
  - `slug`, `description`, `inputSchema` (Zod-shaped doc), `outputSchema`, trigger predicate, side-effect contract, pre-conditions.
- `actionRegistry` entries (10 new):
  | Slug | `idempotencyStrategy` | `requiredIntegration?` | Notes |
  |---|---|---|---|
  | `support.list_open_tickets` | `read_only` | none | reads `canonical_tickets` |
  | `support.read_thread` | `read_only` | none | reads `canonical_ticket_messages` |
  | `support.propose_reply` | `state_based` | none | writes `canonical_ticket_drafts` (no provider call) |
  | `support.add_internal_note` | `state_based` | none | writes `canonical_ticket_drafts` |
  | `support.approve_draft` | `keyed_write` | `teamwork` | triggers §8 dispatch; uses `action_idempotency_key` |
  | `support.reject_draft` | `state_based` | none | transitions draft → rejected |
  | `support.set_status` | `keyed_write` | `teamwork` | provider write; in-place-mutation key |
  | `support.assign` | `keyed_write` | `teamwork` | provider write |
  | `support.tag` | `keyed_write` | `teamwork` | provider write |
  | `support.find_customer_history` | `read_only` | none | joins canonical_contacts → canonical_tickets + canonical_revenue + canonical_accounts |
- Permission gates per §9:
  - `support.approve_draft` route handler asserts `support.draft.approve` permission via `requireOrgPermission` (or per-subaccount equivalent — the existing `permissionSetService` pattern).
  - `support.reject_draft` asserts `support.draft.reject`.
  - `support.set_status`, `support.assign`, `support.tag`, `support.add_internal_note` are agent-skill paths; they assert agent's capability gate via the existing capability-aware routing pattern (read access implicit in agent-run principal context).
  - `support.propose_reply` is an agent-skill path; no human permission gate.
- `SKILL_HANDLERS` entries delegate to:
  - `support.list_open_tickets` → `supportTicketService.listOpenTickets`
  - `support.read_thread` → `supportTicketService.readThreadForAgent`
  - `support.propose_reply` → `supportDraftDispatchService.proposeReply` (visibility=public)
  - `support.add_internal_note` → `supportDraftDispatchService.proposeReply` (visibility=internal)
  - `support.approve_draft` → `supportDraftDispatchService.approveDraft`
  - `support.reject_draft` → `supportDraftDispatchService.rejectDraft`
  - `support.set_status` → `supportTicketService.applyStatusChange`
  - `support.assign` → `supportTicketService.applyAssignmentChange`
  - `support.tag` → `supportTicketService.applyTagMutation`
  - `support.find_customer_history` → join via `canonicalDataService` (existing primitive)

**error_handling:**
- Per §8.23 of DEVELOPMENT_GUIDELINES — every `support.*` action in `ACTION_REGISTRY` must have a matching `SKILL_HANDLERS` entry. Boot validator (`validateSystemSkillHandlers()`) catches mismatches.
- Skill-handler errors propagate through the existing `skillExecutor` `processOutputStep` path; service errors `{ statusCode, message, errorCode }` shape is preserved.
- Read-only skills cannot return secrets — `external_metadata` is rendered as-is (the canonical layer does not store credentials).

**dependencies:** C10 (read services), C11 (dispatch service), C7 (provider write paths), C4 (drafts schema for the propose-reply path).

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run build:server` clean.
- All 10 skill .md files parse (existing skill-md parser smoke test in CI handles this).
- `validateSystemSkillHandlers()` passes at boot — every registered action has a handler.

**pure_tests:** none in this chunk (skill .md files are content; handlers are thin shells over already-tested services).

### C13 — UI surfaces (5 hi-fi prototype pages + components directory)

**spec_sections:** §10 (entire UI surfaces), §10 (UI filter semantics, draft review queue surfacing rules, access control on UI)

**files:**
- CREATE `client/src/pages/integrations/SupportDeskSetupPage.tsx` — three-step wizard (per `prototypes/support-desk-canonical/integration-setup.html`).
- CREATE `client/src/pages/support/TicketsListPage.tsx` — five default-visible status filters + quarantined filter pill.
- CREATE `client/src/pages/support/TicketDetailPage.tsx` — three-panel layout, thread via `readThreadForHumanUi`.
- CREATE `client/src/pages/support/DraftReviewQueue.tsx` — split-pane list + detail.
- CREATE `client/src/pages/support/InboxConfigPage.tsx` — per-inbox config (mode/collision/draft-expiry/overrides).
- CREATE `client/src/components/support/StatusPill.tsx`, `PriorityPill.tsx`, `ThreadMessage.tsx`, `DraftOverlayMessage.tsx`, `CollisionCallout.tsx`, `QuarantineBanner.tsx`, `BackLinkAwaitingBadge.tsx` — reusable bits.
- MODIFY `client/src/config/routes.ts` — register `/support/tickets`, `/support/tickets/:id`, `/support/drafts`, `/support/drafts/:id`, `/support/inboxes`.
- MODIFY `client/src/config/sidebar.ts` — add Support Desk nav group.
- CREATE `server/routes/support/supportTicketsRoutes.ts` — tickets sub-router:
  - `GET /tickets`
  - `GET /tickets/:id`
- CREATE `server/routes/support/supportDraftsRoutes.ts` — drafts sub-router:
  - `GET /drafts`
  - `GET /drafts/:id`
  - `POST /drafts/:id/approve` (`support.draft.approve`; `override_collision: true` body field requires `support.draft.override_collision`)
  - `POST /drafts/:id/reject` (`support.draft.reject`)
  - `POST /drafts/:id/edit` (`support.draft.approve`)
  - `POST /drafts/:id/manual-resolve` (sub-action gating per §12)
- CREATE `server/routes/support/supportInboxesRoutes.ts` — inboxes sub-router:
  - `GET /inboxes`
  - `PATCH /inboxes/:id` (`support.inbox.configure`)
- CREATE `server/routes/support/index.ts` — thin mount file; creates an Express router, mounts the three sub-routers under `/`, and exports it. Under 40 lines.
- MODIFY `server/index.ts` — mount `server/routes/support/index.ts` at `/api/support`.

**Route file size rationale:** splitting at the sub-domain boundary (tickets/drafts/inboxes) keeps each file to ~60–80 lines with validation, permission checks, and query-param parsing included. The alternative (one file under 200 lines) was retained in the chunk-sizing audit but is now replaced here because 10 endpoints with body validation and multi-step permission gating reliably exceed 200 lines in practice.

**Note: this chunk has many files but ONE logical responsibility per the chunk-sizing audit (§4.1) — "ship the four hi-fi prototype pages plus their backing routes". The components directory and route file are colocated implementation details. The mockups at `prototypes/support-desk-canonical/` are the design source of truth — Phase 2 builders re-render them faithfully using `consolidation-foundation` primitives (PageShell, SortableTable, FormFooter, etc.).**

**contracts:**
- All routes use `asyncHandler` (architecture rule). Service-layer errors throw `{ statusCode, message, errorCode? }`. Validation, query-param parsing, and permission checks live in each sub-route file; no business logic in the mount file.
- `GET /api/support/tickets` query params: `inboxIds?: string[]`, `statusGroup?: 'needs_attention' | 'all_open' | 'quarantined'`. Returns `CanonicalTicket[]` filtered per §10 ticket-list filter semantics (Option B locked: "Needs attention" = `open + pending_internal`).
- `GET /api/support/tickets/:id` → `{ ticket, messages, draftOverlay }` via `readThreadForHumanUi`.
- `PATCH /api/support/inboxes/:id` body: `{ agentConfig: SupportInboxAgentConfig }`. Server runs `SupportInboxAgentConfigSchema.parse` before the UPDATE. 422 on parse failure.
- `POST /api/support/drafts/:id/approve` body: `{ overrideCollision?: boolean; reviewNotes?: string }`. 422 on preflight failure with the `errorCode` discriminator. 409 on action-idempotency-key collision.
- `POST /api/support/drafts/:id/manual-resolve` body: `{ action: 'mark_sent' | 'mark_failed' | 'retry_reconciliation'; notes?: string }`. Sub-action permission enforcement after `authenticate`: `mark_sent` and `retry_reconciliation` require `support.draft.approve`; `mark_failed` requires `support.draft.reject`. 403 on missing key.
- All routes resolve subaccount via existing `resolveSubaccount(subaccountId, orgId)` where the URL carries one (the support routes are org-scoped; subaccount filtering is via query param on list endpoints).
- UI follows `docs/frontend-design-principles.md`:
  - One primary action per screen (Setup: Start sync. Tickets list: browse-only. Ticket detail: action bar. Draft review: Approve. Inbox config: Save changes).
  - Inline state (status dots, dispatching spinner, collision callout inline).
  - Quarantined tickets are a discrete filter pill, never folded into "Needs attention".
  - Override-collision is **visually hidden** for users without `support.draft.override_collision` (per `docs/frontend-design-principles.md` § Admin-only controls).
  - Manual-resolve UI labels: "Mark provider send as verified" / "Mark as failed in provider" / "Retry reconciliation" — verbatim per §8.5 + handoff §3.
  - Drafts in `dispatching` < 30s are NOT shown; once they cross 30s they appear under `needs_reconciliation` with "still dispatching…" sub-label.
  - `manually_marked_sent` drafts surface separately with "Verified by operator, awaiting back-link" (R9 mitigation).

**error_handling:**
- Loading states on every list and detail view. Empty states ("No tickets in this inbox yet") and error states with retry. Per `docs/frontend-design-principles.md`.
- Optimistic updates on Approve/Reject roll back on 422/409; the user sees the typed error message.
- WebSocket integration: not required for v1 (per spec §13 read paths — inline / synchronous; no real-time co-presence per non-goals). Polling refresh on the draft review queue acceptable.

**dependencies:** C10 (read services), C11 (dispatch service), C12 (skills wired). The route file calls services directly; UI calls routes via `client/src/lib/api.ts`.

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run build:client` clean.
- `npm run build:server` clean.
- Each of the three sub-route files (`supportTicketsRoutes.ts`, `supportDraftsRoutes.ts`, `supportInboxesRoutes.ts`) is under 100 lines; the mount file (`index.ts`) is under 40 lines.
- All four hi-fi mockups visually faithful in the implementation (operator review during chunk close — chatgpt-pr-review will verify).

**pure_tests:** none (UI components and route handlers are not pure-testable per the testing posture).

### C14 — Operational state surfaces (extends C13 with sync-health, connection-health, reconciliation callouts)

**spec_sections:** §10 (operational state surfaces table), §13 (sync-health classification job), §15 (UI surface column for each log code)

**files:**
- MODIFY `client/src/pages/integrations/SupportDeskSetupPage.tsx` — add `running | degraded | failed` sync-health pill on success page (per §10 connection-health).
- MODIFY `client/src/pages/support/TicketsListPage.tsx` — add inline banner for `support.status.unknown_provider_status` count + sync-health indicator at top (yellow when `support.provider.rate_limited` or `support.provider.poll_page_failed` is recent).
- MODIFY `client/src/pages/support/DraftReviewQueue.tsx` — `needs_reconciliation` callout with reconciliation status; `support.action.provider_conflict` "Conflict detected, refresh ticket" inline; `support.ticket.human_collision_blocked` red callout with override action when permission held.
- MODIFY `client/src/pages/support/TicketDetailPage.tsx` — message attachment "Couldn't load — retry" on `support.attachment.resolve_failed`; right rail "Customer not in CRM" on `support.ingest.contact_unmatched`.
- MODIFY `client/src/pages/support/InboxConfigPage.tsx` — per-inbox connection-health status alongside the row.
- MODIFY `server/services/supportInboxService.ts` (or sibling) — read sync-health from `connector_configs.sync_status` (existing column) + `last_successful_sync_at`. Surface via `GET /api/support/inboxes` response.

**contracts:**
- Sync-health pill values: `running | degraded | failed`. Treatment per spec §10:
  - `running` — green, "Last sync · {timestamp}".
  - `degraded` — yellow, tooltip explains rate limit or partial-page-failure.
  - `failed` — red, tooltip explains the last failure reason.
- The §15 code → UI surface mapping table is the source of truth. Each code's UI surface is implemented in this chunk.

**error_handling:**
- The UI degrades gracefully if `connector_configs.sync_status` is null (treated as `running` by default).
- Operator does not see raw codes — only their human-readable surface treatment per the §15 table.

**dependencies:** C13 (the underlying pages exist).

**acceptance_criteria:**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run build:client` clean.
- `npm run build:server` clean.
- Operator visual review (chatgpt-pr-review will verify) confirms the §15 code → UI surface mapping is implemented end-to-end.

**pure_tests:** none.

### C15 — Documentation, ADR, and `architecture.md` doc-sync

**spec_sections:** §18 (documentation), §22 (OQ-1 deferral notice carries forward into doc-sync), brief §10 #7 (ADR rationale: canonical-not-conversations boundary)

**files:**
- MODIFY `architecture.md` — add a new "Canonical Support Desk" subsection under "Service Layer" (or a sibling section, per the existing structure) covering the five canonical entities, the three-phase dispatch invariant, the polymorphic-FK-split pattern, the deferred-FK pattern, the deletion-by-poll precondition, the status-map fail-closed contract, and the read-permission posture. Update the "Key files per domain" index with the new files.
- CREATE `docs/decisions/0009-support-desk-canonical-not-conversations.md` — ADR per spec §18 + brief §10 #7. Locks the decision that tickets do not flow through `canonical_conversations` in v1. Includes the OQ-1 deferral checklist line per R1 mitigation.
- MODIFY `docs/capabilities.md` — add Support Desk capabilities under the existing capability registry. Editorial Rules apply: vendor-neutral phrasing, no model names, no infrastructure language. Capabilities to add per §9:
  - "Read open support tickets" (canonical read).
  - "Read a support ticket thread" (canonical read).
  - "Propose a support reply" (write to drafts).
  - "Approve and send a support reply" (provider write through dispatch).
  - "Reject a draft reply".
  - "Set support ticket status".
  - "Assign a support ticket to a helpdesk agent".
  - "Tag a support ticket".
  - "Find customer history across support and CRM".
  - "Add internal note to a support ticket".
- MODIFY `KNOWLEDGE.md` — append patterns the build settled (already partially recorded at handoff time):
  - The polymorphic-FK split pattern (`[2026-05-09]`).
  - The deferred-FK migration pattern (`[2026-05-09]`).
  - The deletion-by-poll precondition pattern (`[2026-05-09]`).
- MODIFY `docs/doc-sync.md` — confirm the new docs are listed under their update triggers.
- MODIFY `tasks/builds/support-desk-canonical/progress.md` — final "Build complete" entry.

**contracts:**
- ADR `0009`'s structure follows `docs/decisions/_template.md`. Sections: Status, Context, Decision, Consequences, Alternatives Considered. The "Alternatives Considered" section explicitly documents (a) "tickets through `canonical_conversations`" — rejected because the generic shape lacks priority/assignee/inbox/SLA/internal-note distinction (brief §4 + §10 #7); (b) "per-provider tables" — rejected because the canonical-first pattern wins per brief §3. The "Consequences" section names the OQ-1 deferral risk explicitly (R1 mitigation): "Future Foundry-trained model wiring is gated on operator-driven OQ-1 close per `tasks/todo.md` § Deferred from feature-coordinator hard-gate override".
- `architecture.md` Support Desk section structure mirrors existing canonical-CRM and Universal Brief sections — domain model paragraph, identity model paragraph, lifecycle (read paths + write paths), execution model (poll/webhook ingestion + three-phase dispatch + reconciliation worker), key files per domain, routes table, permissions reference. Pattern is well-established in the codebase.

**error_handling:** N/A (documentation chunk).

**dependencies:** C1–C14 (all implementation chunks; the docs reflect the shipped code).

**acceptance_criteria:**
- `npm run lint` clean.
- All doc files parse (markdown syntax). `chatgpt-pr-review` and `chatgpt-spec-review` doc-sync sweeps will verify accuracy on PR open.
- `docs/doc-sync.md` lists the new ADR and the architecture.md update.
- The OQ-1 deferral note appears in ADR `0009`'s Consequences section AND in `architecture.md`'s Support Desk section (operator visibility).

**pure_tests:** none.

## 6. Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Allowed locally per chunk: `npm run lint`, `npm run typecheck` (or `npx tsc --noEmit`), `npm run build:server` and/or `npm run build:client` when the chunk touches the build surface, `npm run db:generate` for schema chunks, `npm run db:push` against a clean local DB for migration smoke tests (C1, C2, C3, C4, optional C7), `npx vitest run <single-test-path>` for the 5 pure tests authored in this build.

CI runs the complete gate suite when the PR is opened. Any pre-existing baseline violations CI catches that interact with this build will be addressed in a same-PR follow-up; this plan does NOT include a "Phase 0 baseline gate sweep" because gates are CI-only.

### 6.1 Pre-existing-violation static check

Static reasoning to verify no pre-existing violations interact:

- **`teamworkAdapter.mapTicketStatus`** (the legacy 4-state version) — verified by C6 audit. The new `mapTeamworkStatus` lives in a new file (`server/adapters/teamwork/teamworkSupportStatusMap.ts`); the legacy mapper is retained for the existing `TicketData['status']` 4-state shape used by callers outside this build. No collision.
- **`mapTeamworkEventType`** — already handles `ticket.deleted` and `ticket.reply.created` / `note.created`. C6 only ADDS cases (`ticket.assigned`, `ticket.status_changed`); no replacement.
- **`actionRegistry`** — registering 10 new entries with `support.*` prefix; no collision with existing action slugs (verified by grep at primitives-search time).
- **`RLS_PROTECTED_TABLES`** — appending 5 (or 6) new entries; no rename of existing entries; no risk.
- **`webhookAdapterService`** — existing dispatcher dedupe via `external_event_id` is unchanged. The new event-type cases are additive.
- **`connectorPollingService`** — existing poll cycle is unchanged in shape. The new four-phase support ingestion is wired as new phases appended to the existing cycle.

No pre-existing-violation fix is folded into Chunk 1.

### 6.2 Per-chunk execution etiquette

- Each chunk lands as one or more commits under the integration branch `claude/support-ticket-structure-xMcy8`. The PR to `main` opens once C15 closes.
- Schema chunks (C1–C4, optional C7) include local `npm run db:push` smoke against a clean local DB before commit.
- Pure tests (5 total, in C6 / C8 / C9 / C10 / C11) run on their own files via `npx vitest run <path>` at chunk close.
- The five-file-per-chunk soft cap is honoured everywhere except C11 (6 files, single responsibility) and C13 (multi-file, single responsibility) — both noted in the chunk-sizing audit (§4.1).
- Spec amendments triggered by C7 (OQ-3, OQ-4 closures) commit in the same PR as C7's implementation.

## 7. Self-consistency

| Question | Answer |
|---|---|
| Goals (spec §1) ↔ implementation chunks match? | Yes. Five entities + Teamwork ingestion + dispatch + skill surface + UI surfaces + operational state UI all mapped to C1–C14. C15 is the closure pass. |
| Every chunk has explicit `dependencies`? | Yes. Forward-only per spec §16. |
| Single-source-of-truth claims survive? | Yes. The five-row precedence table in spec §11 + per-contract precedence in §11.3/§11.4 are reflected in this plan's per-chunk contracts: ingestion writes (C8, C9), dispatch writes (C11), and back-link write (C9 + C11) are the only paths that mutate `source_draft_id`; raw ingestion never sets it. The audience-tier read separation (§5.2.B) is enforced by the C10 service boundary (`readThreadForAgent` vs `readThreadForHumanUi`). |
| Non-functional claims match the execution model (spec §13)? | Yes. Polling is async (existing `connectorPollingService` extension); webhook ingestion is inline at the request boundary; three-phase dispatch is inline within phase 1+2+3 (C11) with reconciliation as the async fallback (worker on `support-draft-reconciliation` queue). |
| Every load-bearing claim has a named mechanism? | Yes. "Idempotent" → `(connector_config_id, action_idempotency_key)` UNIQUE + the optional `action_attempts` ledger from C7. "Convergent" → §7 dedupe keys reflected in C8/C9 upsert paths. "Three-phase dispatch" → C11 transition guard + idempotency-key derivation pure-tested. "Quarantine never silently becomes open" → C6 mapping function + C2 DB CHECK. "Deletion never silently from incremental poll" → C8 full-reconciliation entry point separated from incremental cycle. |
| File inventory ↔ prose consistency? | Yes. Every file mentioned in the per-chunk sections appears under `files:` for that chunk. The conditional `0312` migration + `actionAttempts.ts` schema + `RLS_PROTECTED_TABLES` extension are scoped to C7 contingent on OQ-3 closure. |
| Phase dependencies forward-only? | Yes per spec §16 (verbatim) and §4 of this plan. |
| Risks named with mitigations? | Yes — §3 (R1–R11). Each risk maps to a specific chunk's contracts or a specific test fixture. |
| Single-PR shape preserved? | Yes. No PR splits, no incremental ships. Brief §11 + spec §3 single-body-of-work locked. |
| Test gates posture preserved? | Yes. 5 pure test files total, all Vitest, all per spec §20 boundaries. No vitest of `connectorPollingService` / `webhookAdapterService` / route files / UI components. No new gate scripts authored. |
| Pre-existing violations? | None identified in static check (§6.1). |
