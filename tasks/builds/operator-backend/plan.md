# Implementation Plan — operator-backend

**Spec:** docs/superpowers/specs/2026-05-12-operator-backend-spec.md
**Branch:** claude/sandbox-execution-provider-DLfjn
**Build slug:** operator-backend
**Author:** architect agent
**Authored at:** 2026-05-12T08:00:00Z
**Plan revision:** Rev 3 (chatgpt-plan-review Round 2 applied — R2-F1, R2-F2, R2-F3, cleanup closed; see `tasks/review-logs/chatgpt-plan-review-operator-backend-2026-05-12T08-30-00Z.md`)
**Task class:** Major (new subsystem; multiple cross-cutting concerns)
**Chunk count:** 12 chunks (within the 8-14 target band)

## Rev 2 invariants (locked from chatgpt-plan-review Round 1)

These bind every chunk. Builder MUST honour them.

1. **Dispatcher is sole writer of `paused_* → delegated`.** Routes that operate on paused tasks (retry-chain-failure, extend-budget) RESET counters and ENQUEUE a dispatch job; they MUST NOT transition `agent_runs.status` themselves. The dispatcher transitions paused → delegated INSIDE its own optimistic UPDATE only after a successful chain-link dispatch. (F1)
2. **Dispatch success predicate.** The dispatcher's success UPDATE is exactly `UPDATE agent_runs SET status='delegated', operator_chain_failure_count=0 WHERE id=$1 AND status IN ('pending','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded')`. **`delegated`, `cancelled`, `paused_wall_clock_exceeded`, terminal states are all excluded.** Counter resets to 0 on every successful dispatch (prevents stale counts misleading future dispatches). (F2 + R2 cleanup)
3. **Dual-GUC RLS scoping for the three new tables.** `operator_runs`, `operator_task_profiles`, `subaccount_operator_settings` have RLS policies keyed on BOTH `current_setting('app.organisation_id')` AND `current_setting('app.subaccount_id')`. A new helper `setOrgAndSubaccountGUC(tx, orgId, subaccountId)` is added in Chunk 1 alongside the existing `setOrgGUC` at `server/lib/orgScoping.ts:18`. Every read/write against these three tables MUST call the dual helper before touching the table; calling only `setOrgGUC` is a build error (caught by service-signature design — every operator service signature takes `(orgId, subaccountId)` as its first two parameters). The spec line 1104 incorrectly described `app.subaccount_id` as "existing" — it is NEW and lands in this build. (F3)
4. **Fresh-profile restart predicate.** `POST /api/operator-tasks/:agentRunId/fresh-profile-restart` is allowed ONLY when (a) task status is `paused_chain_failure`, AND (b) the latest failed chain-link has `failure_class = 'profile_corruption'` OR `failure_reason = 'OPERATOR_PROFILE_UNRECOVERABLE'`. Other paused states cannot fresh-profile-restart in V1. (F6)
5. **Migration verification posture.** `npm run db:generate` is the only local migration command (it produces the Drizzle journal file; clean output proves the schema files compile to the migration). CI applies the migrations on PR open. Local `npm run db:rollback` / `npm run db:migrate` are NOT in any chunk's acceptance criteria. (F5)
6. **Architectural decisions resolved at plan time (F4):**
   - `executionModeToEnvironment('operator_managed')` returns `'browser'`. No new `ExecutionEnvironment` literal.
   - Canonical org-scoped tenancy helper for operator tables: `setOrgAndSubaccountGUC` (Chunk 1, new); plain `setOrgGUC` remains the canonical helper for org-only RLS tables.
   - LLM-ledger writer: canonical writer lives at `server/services/llmRouter.ts` (verified — no separate `llmRequestWriter.ts` exists in this codebase). Chunk 5 modifies `llmRouter.ts` to accept `operatorRunId` + `boundary`.
   - Route error-handler: canonical handler verified at builder pre-flight — search `server/middleware/` for the central asyncHandler error mapper; if a single mapper exists, extend it; if errors are mapped at the router level, extend at the operator routers. Chunk 5 acceptance criterion: file path and approach documented in the chunk's commit message.
   - Vendor product/version + `is_resumable_now` field name: builder MUST inspect the vendor runtime at the point of consumption (Chunk 4 for the pinned vendor version in the Dockerfile; Chunk 6 for the `is_resumable_now` field name in the checkpoint step-state payload). Each is a Chunk acceptance item, not an operator question.

---

## Table of contents

- Model-collapse check
- A) Architecture notes
- B) Out-of-scope explicitly
- C) Risks and mitigations
- D) Stepwise implementation plan — chunks
  - Chunk dependency graph
  - Chunk 1 — Schemas + migrations + manifest + types + encryption helper + ExecutionMode extension
  - Chunk 2 — `ExecutionCapability` extension + registry/types docstring rename + capability CI gate
  - Chunk 3 — Pure helpers + event registry + error classifier + event-registry CI gate
  - Chunk 4 — Sandbox template rename + sandbox primitive extension (`sandboxStartKey` + `adoptOrStart`)
  - Chunk 5 — Service layer (non-adapter): profile, settings, chain-resume, cost-writer, scheduler, suspension notifier, errors, broker extensions
  - Chunk 6 — Adapter object + lifecycle methods + registration + pg-boss handlers + queue registration
  - Chunk 7 — Routes + permission key + role grant + WebSocket bridge
  - Chunk 8 — Client API helpers + shared client types
  - Chunk 9 — UI: settings tab + AdminSubaccountDetailPage extension
  - Chunk 10 — UI: TaskHeader family + OpenTaskView + Run Trace + WorkspaceBoard + modals + Connections suspended state
  - Chunk 11 — CS runbook + ADR + capabilities + architecture + doc-sync sweep
  - Chunk 12 — Final CI gate + checkpoint-logging gate + build smoke
- E) Sequence diagram (text)
- Executor notes

---

## Model-collapse check

The Operator Backend is a long-running, stateful orchestration system, not a one-shot pipeline. Could it collapse into one model call with structured output?

Verdict: **reject collapse, here is why.**

The orchestration is intrinsically multi-step because:
- The work spans hours-to-days across many 120-minute chain links; no model call can hold that wall-clock.
- Each chain link runs inside a sandboxed Docker/e2b runtime executing a third-party vendor operator runtime. The model call sits inside the sandbox, not in our orchestrator. We are the harness around the model, not the model itself.
- State-machine surfaces (chain-link rows, paused_* states, FIFO queue, fallback stickiness, profile retention/GC, cost-row writers) are durable database state, not derivable from a prompt.
- Compliance/audit needs (incident emission, audit events, RLS, exactly-once cost rows, encrypted checkpoints) demand explicit code paths; no structured-output schema substitutes for the cost ledger.
- The chain-resume model itself is the load-bearing innovation. The model in the sandbox decides task semantics; the harness decides "when to checkpoint, when to dispatch the next link, when to pause."

This is not an ingest-extract-transform-render pipeline. Reject collapse.

---

## A) Architecture notes

### Place in the existing layering

The Operator Backend is a sixth `ExecutionBackend` adapter alongside `api`, `headless`, `claude-code`, `iee_browser`, `iee_dev`. It conforms to the Spec A contract surface at `server/services/executionBackends/types.ts` and registers at `server/index.ts:687-691`. Its terminal-state table `operator_runs` is the parallel of `iee_runs`; its `completedEventQueue = 'operator-session-completed'` is the parallel of `iee-run-completed`. The shared finaliser `finaliseAgentRunFromBackend({ backendId, backendTaskId })` at `server/services/agentRunFinalizationService.ts:152` routes by `backendId` and calls the adapter's `loadTerminalState` / `finalise`. Additive only.

Within the broader stack:

- **agent-runs**: parent task; `agent_runs.status` extends with four `paused_*` states; `executionMode` extends with `operator_managed`.
- **operator-session identity** (Spec C, PR #286): credential broker returns `OperatorSessionEnvelope`. This build EXTENDS the broker with `requestOperatorSessionCredential()`, `resolveFallback()`, and adds `subaccountId` to `OperatorSessionEnvelope` plus new `ApiKeyEnvelope`.
- **sandbox isolation** (Spec B, PR #287): `sandboxExecutionService.runTask` already exists at `server/services/sandboxExecutionService.ts:165`. This build EXTENDS `SandboxRunTaskInput` with an optional `sandboxStartKey: string` field and adds `adoptOrStart()` for dispatch-crash recovery.
- **pg-boss**: four new queues (`operator-session-completed`, `operator-session-dispatch-next-chain-link`, `operator-session-progressed`, `operator-task-profile-gc`) registered alongside the existing IEE queues via `server/lib/createWorker.ts`.
- **credentials**: `credentialBrokerService` provides redacted envelopes; adapter never inspects raw tokens.
- **webhooks**: N/A direct; lifecycle events ride the existing `agent-run:{runId}` WebSocket room via `emitAgentRunUpdate`.
- **instrumentation**: uses existing `recordIncident()` (`server/services/incidentIngestor.ts`); new typed event family `operator.chain_link_start_failed`.
- **tenant-context / RLS**: three new tables join the `RLS_PROTECTED_TABLES` manifest with `FORCE ROW LEVEL SECURITY`. Per-row `organisation_id` + `subaccount_id` for policy performance.
- **`withOrgTx` / `setOrgGUC`**: every writer wraps in an org-scoped transaction. Canonical path is `server/lib/orgScoping.ts` (corrected from the brief's `server/middleware/orgScoping.ts`).

### Architecture decisions inherited from Phase 1

- **Single-phase build.** No sub-phase split. Chain-resume (D8) and persistent profile (D11) are required in V1.
- **Chain-resume model.** One task = one `agent_run` = N chain links. Chain links communicate state via `operator_runs.checkpoint_payload` and the persistent browser profile (`operator_task_profiles`).
- **Per-subaccount settings table** (`subaccount_operator_settings`, mirrors `subaccount_optimiser_settings`) rather than six columns on `subaccounts`.
- **Polling as V1 visibility primitive.** WebSocket bridge is best-effort. Streaming progress is Phase 3.5.
- **Hyphenated lifecycle events** (`operator-session.*`) vs **dotted incident/audit events** (`operator.*`, `task.operator.*`, `subaccount.operator_settings.*`). CI gate enforces.
- **Vendor codename `OpenClaw` purged** from code/schema/UI/telemetry/customer-copy. Appears only in vendor-specific config files (`infra/sandbox-templates/operator-session/Dockerfile`, env manifest).
- **No feature flag.** Adapter registers unconditionally at boot.
- **Migration window 0327-0331.** Latest existing migration verified at `migrations/0326_operator_session_columns.sql`.

### New state-machine surfaces

- **`agent_runs.status`** gains `paused_for_chain_continuation | paused_chain_failure | paused_budget_exceeded | paused_wall_clock_exceeded`. Of these, `paused_wall_clock_exceeded` is V1 non-resumable (user-cancel only).
- **`operator_runs.status`** is a NEW closed enum: `pending | running | completed | failed | cancelled`. Hard-cap unresumable is `failed` with `failed_mid_step=true`.
- **`operator_task_profiles.status`** is a NEW closed enum: `active | scheduled_gc | gc_in_progress | gc_done`.
- **Cancellation invariant (spec F3 / § 3.10).** Task-level cancel is task-scoped and atomic: (1) signal cancel intent on the active chain link, (2) drain queued continuation jobs, (3) optimistic-predicate UPDATE `agent_runs.status='cancelled'` excluding `'cancelled'`. All dispatcher jobs RE-READ `agent_runs.status` inside their dispatch transaction. The dispatcher's predicate (§ 7.3 step 4) excludes `'cancelled'` from the allowed predecessor set, so a queued continuation against a cancelled task affects 0 rows and exits no-op. This is the single source of truth for cancel-vs-dispatch race safety.
- **Transactional fallback stickiness (spec F4 / § 3.7 item 6).** Stickiness is NOT stored as a column. It is DERIVED inside the same `withOrgTx`-scoped transaction that inserts the next `operator_runs` row, from the latest non-superseded prior row's `credential_mode`, the absence of an `operator-session.usability_restored` event since the link-boundary timestamp, AND the absence of a `task.operator.credential_refreshed` audit event since the link-boundary timestamp. The inserted `credential_start_mode` is IMMUTABLE per § 3.3; never overwritten by a mid-run swap or a later credential-restoration event.

### Hard contracts at integration boundaries

- **`cs.operator_session.suspended_detected` payload**: locked at spec § 4.8b. Producer `notifyOperatorSessionSuspended()`; consumer existing inbox pipeline; idempotency key `(connection_id, usability_state, detection_date)`.
- **`ApiKeyEnvelope`**: declared in `server/services/credentialBrokerService.ts` with shape `{ credentialId, connectionId, subaccountId, authType: 'api_key', provider, issuedAt, expiresAt: string | null }`. Raw key material stays broker-internal.
- **`OperatorSessionEnvelope` extension**: adds `subaccountId: string` for defence-in-depth three-way subaccount-match (spec § 3.6).
- **Conversation artefact**: MIME `application/vnd.synthetos.operator-conversation-link+json;version=1`; Zod schema `OperatorConversationLinkArtefact` in `shared/types/operatorConversationArtefact.ts`.
- **Spec B sandbox extension**: `SandboxRunTaskInput` gains optional `sandboxStartKey?: string` field; service gains `adoptOrStart(input: SandboxRunTaskInput & { sandboxStartKey: string }): Promise<SandboxRunTaskOutput>` method. Additive to PR #287's primitive. The Operator Backend is the first caller; Spec B baseline contract unchanged for non-operator callers.

### Concurrency primitives in play

- **`pg_advisory_xact_lock(hashtext('operator_slots:' || subaccount_id))`**: serialises concurrency-cap accounting at every dispatch transaction (new tasks plus chain continuations). Plain `SELECT count(*) FOR UPDATE` is insufficient because aggregate counts do not lock the absence of rows.
- **`pg_advisory_xact_lock(hashtext('operator_finalise:' || operator_run_id))`**: serialises two concurrent finalises for the same chain link. Combined with the optimistic stamp `UPDATE operator_runs SET event_emitted_at = now() WHERE id=$1 AND event_emitted_at IS NULL RETURNING id`. Only the winner writes cost rows; loser rolls back no-op.
- **Finaliser idempotency keyed on `event_emitted_at`** (NOT terminal status). A redelivery runs finalisation when `status IN ('completed','failed','cancelled') AND event_emitted_at IS NULL` (covers crash-after-status-but-before-cost-rows). A redelivery is a no-op ONLY when `event_emitted_at IS NOT NULL`.
- **pg-boss singleton key `operator-session-task-terminal:${agent_run_id}`**: guards task-terminal-event emission. The pg-boss singleton mechanism is the guard; no new guard table.
- **Progress handler as sole writer for `last_progress_at` / `step_count`**: `UPDATE ... SET last_progress_at = greatest(coalesce(last_progress_at, '-infinity'::timestamptz), $ts), step_count = greatest(step_count, $idx) WHERE id = $1 AND status = 'running'`. The `status='running'` guard implements the post-terminal prohibition; the `coalesce` is NULL-safe.
- **Cost attribution pinned on `credential_start_mode`** (immutable) NOT `credential_mode` (mutable). Mid-run swap does not retroactively re-attribute the pre-swap rows.

### `ExecutionMode` discriminator extension (CRITICAL gate not explicit in spec § 5.3)

Verified directly against `server/services/executionBackends/registry.ts:44-50`: the registry validates an adapter's `id` via `isExecutionMode()` whose set `EXECUTION_MODES` is `{'api', 'headless', 'claude-code', 'iee_browser', 'iee_dev'}`. The canonical union `ExecutionMode` at `shared/types/executionEnvironment.ts:15` enumerates the same five strings. The `agent_runs.executionMode` column at `server/db/schema/agentRuns.ts:41` `$type`s the same union. **All three sites must add `'operator_managed'`.** Without this, `executionBackendRegistry.register(operatorManagedBackend)` throws `BackendCapabilityViolation` at boot and dispatch through `agentExecutionService` cannot resolve the adapter. This change is the lowest-level dependency of the entire build; it lands in Chunk 1 alongside the schemas.

Also: `executionModeToEnvironment()` (`shared/types/executionEnvironment.ts:21`) is exhaustive. Adding `operator_managed` requires a new case. The existing `ExecutionEnvironment` union is `'api_tool' | 'headless' | 'browser' | 'terminal_repo'`. Recommendation: map `operator_managed` to `'browser'` (matches the operator runtime's actual execution surface) OR extend `ExecutionEnvironment` with `'code_execution'`. The builder picks the option that minimises drift in `agentExecutionService` and documents the choice in the chunk notes.

### Doc-sync targets for Phase 2 close (note, do not update yet)

- **`architecture.md`**: Key files per domain (add Operator Backend service row); chain-resume + per-subaccount settings sections.
- **`docs/capabilities.md`**: vendor-neutral Operator Backend capability entry (Editorial Rules apply).
- **`docs/doc-sync.md`**: register the new `operator-session.*` event-registry pattern as a convention.
- **`KNOWLEDGE.md`**: append patterns observed during build (finalisation-coordinator timing).
- **`docs/decisions/0011-operator-backend-chain-resume-model.md`**: NEW ADR (Chunk 11) locking D8 + D11.
- **`docs/runbooks/operator-session-account-suspension.md`** + two comms templates: NEW (Chunk 11).

---

## B) Out-of-scope explicitly (verbatim from spec § 11)

These are NOT chunks in this plan. Repeated here to prevent scope creep:

- **DEFER, `operator_external` adapter registration.** Type slot reserved; no runtime registration in V1. Phase 5, BYO compute / customer-hosted operator workers.
- **DEFER, Cross-provider session identity (Anthropic Claude.ai, Google Gemini).** Spec C's `provider` field is forward-compat. V1 only registers the ChatGPT-Plus operator-session provider. Phase 3.5.
- **DEFER, Routing policy / cost-aware dispatch between Operator Backend and Native adapters.** Phase 3.5, separate spec.
- **DEFER, "Cost savings vs API" customer-facing dashboard.** Phase 3.5. V1 surfaces cost in existing usage views only.
- **DEFER, Streaming progress as first-class capability.** Phase 3.5. V1 keeps polling as the visibility primitive.
- **DEFER, Customer self-service tier switching UI.** Phase 3.5.
- **DEFER, Manual checkpoint controls (user-triggered "checkpoint now").** Phase 3.5. D12, chain-resume is entirely automatic in V1.
- **DEFER, Predict-and-warn classifier for un-resumable flows at task-create time.** Phase 3.5. D7 / § 3.14, best-effort with auto-extend grace is V1 policy.
- **DEFER, Operator session export/import to external infrastructure.** Phase 5. V1 keeps all chain links inside the managed Operator Backend.
- **DEFER, `paused_wall_clock_exceeded` resume path.** Phase 3.5. V1 recovery from this state is user-cancel only.
- **DEFER, Per-subaccount profile-size-cap configuration.** V1 system-wide 500 MB constant.
- **DEFER, Cross-attempt comparison view in Run Trace.** V1 renders attempts as collapsed groups; side-by-side compare is deferred.
- **DEFER, In-flight settings hot-application.** V1 snapshots caps at chain-link dispatch time.
- **DEFER, In-memory slot-allocator cache.** V1 always queries the DB inside the advisory lock.

---

## C) Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Spec-B sandbox extension is additive (`sandboxStartKey` + `adoptOrStart`); collision risk with concurrent work on the sandbox primitive | The change is purely additive (new optional input field; new method). Chunk 4 modifies `SandboxRunTaskInput` and adds `adoptOrStart()` in one tight commit; the V1 non-operator caller path is byte-identical (the new field is optional). Pre-flight git fetch + merge check at Chunk 4 start. |
| R2 | pg-boss singleton keys for task-terminal-event guard / progress / continuation; namespace collision | All new singleton keys are prefixed with `operator-session.` or `operator-session-` (matching the queue names). Verified no existing pg-boss queues or singleton keys use those prefixes (grep `server/jobs/` + `server/services/`). Chunk 6 (handlers) and Chunk 5 (services) document the exact keys in `operatorChainSchedulerServicePure.ts` and `operatorSessionCompletedHandler.ts`. |
| R3 | Migration order 0327-0331; collision risk with concurrent migrations landing on main | The branch is already on `claude/sandbox-execution-provider-DLfjn`; latest main migration is 0326. Chunk 1 lands all five migrations atomically. If a concurrent migration grabs 0327 before this branch merges, the renumber is mechanical (5 SQL files + 5 down files + 5 manifest entries + Drizzle journal). Pre-merge: run `npm run db:generate` and verify journal is contiguous. |
| R4 | Cancellation queue-tombstone invariant (F3); dispatcher race if any dispatcher doesn't re-read `agent_runs.status` under lock | Single source of truth: dispatcher's optimistic predicate `UPDATE agent_runs SET status='delegated' WHERE id=$1 AND status IN ('pending','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded')`. **`'cancelled'` is excluded.** Chunk 6 (`operatorSessionDispatchNextChainLinkHandler.ts`) enforces this; Chunk 3 pure helper `derivePredecessorAllowList()` makes the exclusion list explicit and unit-tested. The cancel handler at Chunk 7 + Chunk 5 wraps step 1+2+3 in a single `withOrgTx`. |
| R5 | New permission key `SUBACCOUNT_OPERATOR_SETTINGS_WRITE` + scope coverage; forgetting RLS coverage on three new tables | Chunk 1 lands all three RLS_PROTECTED_TABLES manifest entries WITH the migration that creates each table (same commit). `verify-rls-coverage.sh` (existing CI gate) catches a missing entry. Chunk 7 adds the permission key to `server/lib/permissions.ts` + grants to `org_admin` in the role-grant file + lists in the permission-coverage gate's allow-list. |
| R6 | Per-subaccount-operator-settings table; forgetting the `withOrgTx` / RLS wrap on writes | The settings service (`subaccountOperatorSettingsService.ts`, Chunk 5) is structured as a thin facade: every public method takes `orgId` as a first parameter and immediately opens an org-scoped transaction (`withOrgTx(orgId, ...)` or its canonical equivalent). Chunk 5 pure helpers `extractSettingsSnapshot()` and `validateRangeOrThrow()` carry the business logic; the impure facade is small and obvious. Existing CI gate `verify-rls-contract-compliance.sh` checks for direct-DB-access in route handlers. |
| R7 | `ExecutionMode` discriminator extension missed; adapter registration fails at boot | Verified at primitives-reuse search; called out in Architecture notes. Chunk 1 lands the extension in three sites (`shared/types/executionEnvironment.ts`, `server/services/executionBackends/registry.ts`, `server/db/schema/agentRuns.ts`) atomically; Chunk 2 adds the capability literal `'long_running'` + `'session_identity'`; Chunk 6 registration in `server/index.ts` is the boot-time assertion (build:server smoke). |
| R8 | Hard-cap unresumable single-event pause incrementing `operator_chain_failure_count`; risk of widening the 3-strike pause to a 1-strike pause | Pure helper `classifyChainLinkFailure()` in `operatorManagedBackendPure.ts` (Chunk 3) returns a discriminated `{ kind: 'start' | 'runtime' | 'hard_cap_unresumable' }`. Only `'start'` paths increment the counter via the dispatcher; hard-cap-unresumable transitions the task to `paused_chain_failure` DIRECTLY without counter increment. Unit-tested per spec § 3.4. |
| R9 | Encryption helper `server/services/agentRunPayloadEncryptionService.ts` may not exist at build time | Verified at search time: the file does not exist. Spec § 3.14 item 10 explicitly notes this and instructs Chunk 1 to create the helper (small, wraps existing pgcrypto / app-level encryption pattern from `agent_run_payloads`). Plan locks it in Chunk 1 alongside the schemas (it's used by `operatorRuns.checkpoint_payload` write path, which lands in Chunk 5). |
| R10 | UI chunks (9-10) shipped before the routes (Chunk 7); frontend breaks at runtime | Sequencing locked: Chunk 8 (client API helpers) depends on Chunk 7 (routes). Chunks 9 + 10 (UI) depend on Chunk 8. Builder dispatches in order. |
| R11 | `verify-execution-capability-references.sh` gate trips on legitimate test fixtures referencing `'long_running'` | Spec § 3.2 enumerates the gate's allow-list (canonical definition in `types.ts`; adapter declarations under `executionBackends/*.ts`; test fixtures under `__tests__/` and `*.test.ts`; documentation including this spec). Chunk 2 authors the gate with the explicit allow-list patterns. |

---

## D) Stepwise implementation plan, chunks

12 chunks, ordered so each chunk leaves the system in a forward-compatible state. Chunks 9-10 (UI) are siblings and may be parallelised; Chunks 7 + 8 must precede them.

### Chunk dependency graph

```
1 (schemas, migrations, manifest, types, encryption helper, ExecutionMode extension)
   |
   +-- 2 (ExecutionCapability extension, registry/types docstring rename, capability CI gate)
   |     |
   |     +-- 3 (pure helpers, event registry, error classifier, event-registry CI gate)
   |           |
   |           +-- 4 (sandbox template git mv + sandbox primitive extension: sandboxStartKey + adoptOrStart)
   |           |
   |           +-- 5 (service layer: profile, settings, chain-resume, cost-writer, scheduler, suspension notifier, errors, broker extensions)
   |                 |
   |                 +-- 6 (adapter + lifecycle + registration + pg-boss handlers + queue registration)
   |                       |
   |                       +-- 7 (routes + permission key + role grant + WebSocket bridge)
   |                             |
   |                             +-- 8 (client API helpers + shared client types)
   |                                   |
   |                                   +-- 9 (UI: settings tab + AdminSubaccountDetailPage)
   |                                   +-- 10 (UI: TaskHeader family + OpenTaskView + Run Trace dividers + WorkspaceBoard + modals)
   |                                         |
   |                                         +-- 11 (docs: CS runbook + ADR + capabilities + architecture; doc-sync targets)
   |                                               |
   |                                               +-- 12 (final CI gate: checkpoint-logging gate; build:server smoke)
```

Chunks 9 and 10 are siblings; either may land first. Chunks 11 and 12 close the change-set.

---

### Chunk 1 — Schemas + migrations + manifest + types + encryption helper + ExecutionMode extension

**Goal:** Land the entire storage layer plus the type-level discriminator extension in one atomic commit so every later chunk can compile against the schema.

**spec_sections:** § 3.3, § 3.4, § 3.15 item 1, § 3.16, § 4.10, § 5.1 (subset), § 5.2 (all migrations), § 5.3 (subset), § 6 (RLS), § 10.7

**Module shape:**
- *Public interface this chunk exposes:* the new Drizzle tables (`operatorRuns`, `operatorTaskProfiles`, `subaccountOperatorSettings`); new public TS / Zod types under `shared/types/` (`OperatorRunRow`, `CheckpointPayloadSchemaV1`, `OperatorConversationLinkArtefact`, `OperatorBackendEvent` discriminated union); encryption helpers `encryptAgentRunPayloadJson` / `decryptAgentRunPayloadJson`.
- *What stays hidden behind it:* SQL DDL detail, FORCE RLS policy boilerplate, index definitions, Drizzle journal book-keeping, CHECK constraint enumerations, encryption envelope shape.

**Files (declared scope):**
- `server/db/schema/operatorRuns.ts`, NEW: full column shape per spec § 3.3 (including `credential_start_mode` immutable + `credential_mode` mutable + `superseded_by_attempt` + `settings_snapshot` jsonb, `cancel_requested_at/_by`, `checkpoint_payload` jsonb, etc.). Three indexes.
- `server/db/schema/operatorTaskProfiles.ts`, NEW: full column shape per spec § 3.15 item 1; UNIQUE `(task_id, attempt_number)`; `gc_started_at` column.
- `server/db/schema/subaccountOperatorSettings.ts`, NEW: full column shape per spec § 3.16; CHECK on every numeric column. **R2-F3:** add `settingsVersion: integer('settings_version').notNull().default(1)` — the deterministic ETag source. No seconds-precision rounding; the version is the ETag verbatim.
- `server/db/schema/agentRuns.ts`, MODIFY: extend `status` `$type` union with the four new `paused_*` literals; extend `executionMode` `$type` union with `'operator_managed'`; add `operatorChainFailureCount: integer('operator_chain_failure_count').notNull().default(0)`.
- `server/db/schema/llmRequests.ts`, MODIFY: add `operatorRunId: uuid('operator_run_id').references(() => operatorRuns.id)` and `boundary: text('boundary')` columns.
- `shared/types/executionEnvironment.ts`, MODIFY: extend `ExecutionMode` union with `'operator_managed'`; extend `executionModeToEnvironment()` switch with the case `'operator_managed' → 'browser'` (LOCKED per Rev 2 invariant 6 — the operator runtime drives a browser; no new `ExecutionEnvironment` literal).
- `server/services/executionBackends/registry.ts`, MODIFY: add `'operator_managed'` to the `EXECUTION_MODES` Set literal at line 44; rename "OpenClaw forward-compat ids" docstring at lines 138-141 to "Operator Backend forward-compat ids"; remove the `openclaw_managed` / `openclaw_external` rejection check.
- `shared/types/operatorRuns.ts`, NEW: row-level TS types + state-machine helpers; re-exports the Drizzle row type.
- `shared/types/checkpointPayload.ts`, NEW: Zod schema for the JSONB shape at spec § 4.6; named `CheckpointPayloadSchemaV1`; export `type CheckpointPayload = z.infer<typeof CheckpointPayloadSchemaV1>`.
- `shared/types/operatorConversationArtefact.ts`, NEW: Zod schema `OperatorConversationLinkArtefact` per spec § 3.14 item 6; MIME constant.
- `shared/types/operatorBackendEvents.ts`, NEW: discriminated union for the `operator-session.*` lifecycle family. SINGLE SOURCE OF TRUTH for event-name literals.
- `server/services/agentRunPayloadEncryptionService.ts`, NEW: `encryptAgentRunPayloadJson(value: unknown): Promise<EncryptedJson>`, `decryptAgentRunPayloadJson(value: EncryptedJson): Promise<unknown>`. Wraps the existing pgcrypto / app-level encryption pattern used by `agent_run_payloads`.
- `server/config/rlsProtectedTables.ts`, MODIFY: three new entries (`operator_runs`, `operator_task_profiles`, `subaccount_operator_settings`).
- `server/lib/orgScoping.ts`, MODIFY (Rev 2 F3): add `setOrgAndSubaccountGUC(tx: OrgScopedTx, orgId: string, subaccountId: string): Promise<void>` that calls `set_config('app.organisation_id', orgId, true)` AND `set_config('app.subaccount_id', subaccountId, true)` in the same transaction. Both arguments validated non-empty; throw on missing input (mirrors the existing `setOrgGUC` validation). Add a docstring noting that the helper is mandatory for any table whose RLS policy is keyed on both GUCs (initial consumers: the three new operator tables; future subaccount-scoped tables may reuse). The existing `setOrgGUC` is unchanged.
- `migrations/0335_create_operator_runs.sql` + `.down.sql`, NEW: table + indexes + `FORCE ROW LEVEL SECURITY`. UNIQUE `(agent_run_id, attempt_number, chain_seq)`. **RLS policy USING + WITH CHECK both reference `current_setting('app.organisation_id') = organisation_id::text AND current_setting('app.subaccount_id') = subaccount_id::text`** (dual-GUC per Rev 2 invariant 3).
- `migrations/0336_create_operator_task_profiles.sql` + `.down.sql`, NEW: table + RLS (dual-GUC) + UNIQUE `(task_id, attempt_number)`.
- `migrations/0337_create_subaccount_operator_settings.sql` + `.down.sql`, NEW: table + RLS (dual-GUC) + all CHECK constraints. **R2-F3:** include `settings_version integer NOT NULL DEFAULT 1` column. PATCH UPDATE must use `settings_version = settings_version + 1` (not `now()`). This makes the ETag deterministic and collision-free even for same-second concurrent writes.
- `migrations/0338_extend_agent_runs.sql` + `.down.sql`, NEW: extend `agent_runs.status` allow-list (CHECK or enum, whichever the current schema uses); add `operator_chain_failure_count integer NOT NULL DEFAULT 0`.
- `migrations/0339_extend_llm_requests_operator.sql` + `.down.sql`, NEW: add `operator_run_id uuid NULL REFERENCES operator_runs(id)`, `boundary text NULL`, partial UNIQUE index `(operator_run_id, source_type, boundary) WHERE operator_run_id IS NOT NULL AND boundary IS NOT NULL`, covering index `(operator_run_id)`.

**Contracts (locked at this chunk):**
- `operator_runs` row shape per spec § 3.3 + § 4.2 example.
- `operator_task_profiles` row shape per spec § 3.15 + § 4.4 example.
- `subaccount_operator_settings` row shape per spec § 3.16 + § 4.5 example.
- `CheckpointPayloadSchemaV1` per spec § 4.6 (Zod).
- `OperatorConversationLinkArtefact` per spec § 3.14 item 6 (Zod; MIME literal).
- `OperatorBackendEvent` discriminated union (TypeScript) per spec § 4.7.
- `EncryptedJson` type for the encryption helper (re-uses the existing wrapper used by `agent_run_payloads`, read the canonical type before authoring).
- `ExecutionMode` extended with `'operator_managed'`; `EXECUTION_MODES` set extended.

**Dependencies:** none.

**Error-handling strategy:**
- Drizzle schema changes are compile-time; any `$type` mismatch fails `npm run typecheck`.
- Migrations: on apply failure, the `.down.sql` rolls back. CI applies + rolls back on PR open; no local apply/rollback is part of this chunk's acceptance (Rev 2 invariant 5).
- Encryption helper: wraps existing pattern; failures propagate as `Error` (not typed). Encryption failure is not a recoverable runtime state and should crash the chain link.
- The `verify-rls-coverage.sh` CI gate fails on missing manifest entry, caught at PR open.
- The dual-GUC helper throws on empty `orgId` or `subaccountId`. Service callers that have a `subaccountId: null` row (none expected for the three new tables; every row has a non-null `subaccount_id`) cannot use these tables.

**Acceptance criteria:**
- `npm run lint` + `npm run typecheck` clean.
- `npm run db:generate` produces no drift against the schema files (locally allowed per Rev 2 invariant 5; the journal file under `migrations/meta/` updates cleanly).
- Each migration declares both `*.sql` (forward) and `*.down.sql` (rollback) per existing repo convention; CI applies + rolls back on PR open (no local apply/rollback owed).
- The grep `grep -nE "current_setting\\('app\\." migrations/0335_*.sql migrations/0336_*.sql migrations/0337_*.sql` returns BOTH `app.organisation_id` and `app.subaccount_id` references for every one of the three policies (dual-GUC per Rev 2 invariant 3).
- `RLS_PROTECTED_TABLES` has three new entries; `verify-rls-coverage.sh` (CI gate) passes.
- `EXECUTION_MODES` set contains `'operator_managed'` (verified at `registry.ts:44`).
- `executionModeToEnvironment('operator_managed')` returns `'browser'` (per Rev 2 invariant 6).
- `server/lib/orgScoping.ts` exports `setOrgAndSubaccountGUC` (named export; signature per the file scope above); the existing `setOrgGUC` export is unchanged.

**Tests to write in this chunk (Vitest only):**
- `shared/types/__tests__/checkpointPayloadSchema.test.ts`: validates a canonical example + two malformed examples + one missing-required-field case.
- `shared/types/__tests__/operatorConversationArtefact.test.ts`: validates the MIME constant + one canonical artefact.
- `shared/types/__tests__/operatorBackendEvents.test.ts`: asserts that every event-name literal in the union appears exactly once and matches the `operator-session.*` namespace pattern.
- `server/lib/__tests__/orgScopingDualGuc.test.ts`: asserts `setOrgAndSubaccountGUC` issues both `set_config` calls in order; rejects empty `orgId` / `subaccountId`; reuses the same mock tx pattern as any existing `setOrgGUC` test (if absent, structure tests at the unit boundary with a stubbed `tx.execute`).
- No tests for migrations; CI applies them.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` (verify migration files were authored correctly; no drift)
- `npx vitest run shared/types/__tests__/checkpointPayloadSchema.test.ts`
- `npx vitest run shared/types/__tests__/operatorConversationArtefact.test.ts`
- `npx vitest run shared/types/__tests__/operatorBackendEvents.test.ts`
- `npx vitest run server/lib/__tests__/orgScopingDualGuc.test.ts`

**Doc-sync candidates for this chunk:**
- `architecture.md`, Key files per domain (will be updated in Chunk 11).
- `KNOWLEDGE.md`, append a pattern entry for the dual-GUC RLS scoping (the codebase's first instance) — write the entry in Chunk 11.
- None immediately, schema changes are reflected in code; prose updates land in Chunk 11.

---

### Chunk 2 — `ExecutionCapability` extension + registry/types docstring rename + capability CI gate

**Goal:** Add `'long_running'` and `'session_identity'` to the `ExecutionCapability` union; sweep the rename of "OpenClaw forward-compat ids" docstrings; ship the CI gate that enforces the single-source-of-truth invariant.

**spec_sections:** § 3.2 (propagation invariant), § 4.1, § 5.3 (subset)

**Module shape:**
- *Public interface this chunk exposes:* the extended `ExecutionCapability` union type at `server/services/executionBackends/types.ts:86-93`.
- *What stays hidden behind it:* the CI gate's grep pattern, the allow-list, the rename mechanics.

**Files (declared scope):**
- `server/services/executionBackends/types.ts`, MODIFY: add `| 'long_running'` and `| 'session_identity'` to the union at lines 86-93; rename "OpenClaw forward-compat ids" docstring at lines 52-55 to "Operator Backend forward-compat ids".
- `scripts/gates/verify-execution-capability-references.sh`, NEW: bash gate per spec § 3.2 item 2; allow-list pinned in the script header (canonical definition, adapter declarations, test fixtures, this spec, brief, plan).
- `.github/workflows/ci.yml`, MODIFY: wire the new gate into the CI matrix.

**Contracts:**
- `ExecutionCapability` adds `'long_running' | 'session_identity'`. Closed set; spec amendment required to add further.
- CI gate grep pattern: `grep -rn --include='*.ts' "'long_running'" server/ client/ shared/ scripts/ | grep -vE '<allow-list-paths>'` — non-empty output = fail.

**Dependencies:** Chunk 1.

**Error-handling strategy:**
- TypeScript compile error if any adapter declaration mistypes the literal (capability arrays are `ExecutionCapability[]`).
- CI gate failure produces a clear error message naming each offending file + line.

**Acceptance criteria:**
- `npm run typecheck` clean (no adapter declares the literal yet, so no errors expected; once Chunk 6 adds the operator adapter, the literal is type-checked at the adapter site).
- The new gate script exits 0 against the current tree when run by CI.
- Grep `'openclaw_managed'` and `'openclaw_external'` finds no production hits (only brief / spec / plan / changelog references); the registry rejection check at `registry.ts` is REMOVED in Chunk 1's scope, verify here.

**Tests to write in this chunk (Vitest only for test files; script-helper checks use `npx tsx`):**
- `scripts/__tests__/verifyExecutionCapabilityReferences.test.ts`, NEW per `scripts/README.md` convention (these script-helper checks run via `npx tsx`, not `npx vitest`). Exercises a temp-tree case with a known offender and asserts non-zero exit.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx scripts/__tests__/verifyExecutionCapabilityReferences.test.ts`

**Doc-sync candidates for this chunk:**
- `architecture.md`, note the new capability tags (Chunk 11).
- `docs/doc-sync.md`, note the new CI gate (Chunk 11).

---

### Chunk 3 — Pure helpers + event registry + error classifier + event-registry CI gate

**Goal:** Ship every `*Pure.ts` module the impure layer will depend on, plus the operator-event-registry CI gate. No DB / IO.

**spec_sections:** § 3.7 item 6 (stickiness derivation), § 3.14 (chain-resume decision table), § 3.17 (concurrency-cap classifier), § 4.7 (event registry), § 4.11 (source-of-truth precedence in pure modules)

**Module shape:**
- *Public interface this chunk exposes:* pure exports, `deriveCredentialStartMode`, `classifyChainLinkFailure`, `decideChainResumeOutcome`, `derivePredecessorAllowList`, `deriveQueueEligibility`, `extractSettingsSnapshot`, `validateOperatorSettingsRange`, `composeResumePayload`, `deriveProfileRetentionWindow`, `classifyRuntimeError`, `costRowKey`, `enumerateOperatorEventNames`.
- *What stays hidden behind it:* internal lookup tables, exact regex patterns for runtime-error classification, retry-counter arithmetic.

**Files (declared scope):**
- `server/services/executionBackends/operatorManagedBackendPure.ts`, NEW: chain-link → task status mapping; failure classifier (start vs runtime vs hard-cap-unresumable); finaliser decision table per spec § 3.14 item 4; the dispatcher's predecessor allow-list helper (`derivePredecessorAllowList`).
- `server/services/operatorChainResumeServicePure.ts`, NEW: resume-payload composer (joins conversation-history pointers + checkpoint).
- `server/services/operatorTaskProfileServicePure.ts`, NEW: retention-window math; status transition validator; attempt-bump rules.
- `server/services/subaccountOperatorSettingsServicePure.ts`, NEW: range validation; ETag derivation (`String(settings_version)` — deterministic integer column per R2-F3; NOT seconds-based rounding); settings-snapshot extraction.
- `server/services/operatorCostWriterPure.ts`, NEW: idempotency key derivation (`(operator_run_id, source_type, boundary)`); row shape builders for `subscription_mediated` and `sandbox_compute`; pre-swap step count derivation from the `fallback_engaged` event.
- `server/services/operatorChainSchedulerServicePure.ts`, NEW: slot-count / queue-eligibility / FIFO-order helpers; the `paused_for_chain_continuation` task ordering by `agent_runs.updated_at ASC`.
- `server/services/operatorConversationHistoryPure.ts`, NEW: per-chain-link conversation-history windowing (default `K = 5` constant); artefact-pointer concatenation; truncation rules.
- `server/services/operatorRuntimeErrors.ts`, NEW: closed signal set for `session_unavailable` classification per spec § 3.7 item 1. Exports `classifyRuntimeError(err: unknown): 'session_unavailable' | 'transient' | 'permanent' | 'auth' | 'profile_corruption' | 'concurrency' | 'budget'`. Pure.
- `shared/types/operatorBackendEvents.ts`, referenced from Chunk 1; this chunk PROCESSES the registry. (Chunk 1 declares the union; Chunk 3 produces the runtime list and the enumerator helper.)
- `scripts/gates/verify-operator-event-registry.sh`, NEW: bash gate per spec § 4.7 namespace discipline; greps for naked `operator-session.*` string literals outside the registry file.
- `.github/workflows/ci.yml`, MODIFY: wire the gate.

**Contracts:**
- `classifyChainLinkFailure(input): { kind: 'start' | 'runtime' | 'hard_cap_unresumable', failure_class: 'transient' | 'permanent' | 'budget' | 'concurrency' | 'profile_corruption' | 'auth', failure_reason: string }`, closed return shape.
- `decideChainResumeOutcome(input): { action: 'task_terminal_completed' | 'task_terminal_failed' | 'task_paused_budget_exceeded' | 'task_paused_wall_clock_exceeded' | 'task_paused_chain_failure' | 'dispatch_next_chain_link' | 'task_terminal_cancelled', payload: ... }`, implements the finaliser decision table at spec § 3.14 item 4; branches evaluated in spec order, first-match-wins.
- `deriveCredentialStartMode(input): 'operator_session' | 'api_key'`, implements stickiness derivation per spec § 3.7 item 6; takes the latest non-superseded prior row + `usability_restored` event timestamps + `credential_refreshed` audit-event timestamps, returns the immutable mode for the next chain link.
- `derivePredecessorAllowList(reason: 'continuation' | 'retry' | 'budget_extension' | 'bootstrap'): readonly string[]`, the closed predecessor sets per spec § 7.3 step 2. `'cancelled'` is EXCLUDED from every set.
- `costRowKey(operatorRunId, sourceType, boundary): string`, deterministic key for `(operator_run_id, source_type, boundary)` UNIQUE index.

**Dependencies:** Chunk 1 (schemas + types).

**Error-handling strategy:**
- Pure functions throw typed errors (`OperatorPureValidationError`) on invariant violations. No silent fallbacks.
- The event-registry gate fails CI on offending literals.

**Acceptance criteria:**
- `npm run lint` + `npm run typecheck` clean.
- Every pure module has a paired `*Pure.test.ts` covering happy path + at least one edge case per branch. Tests pass via `npx vitest run server/services/<path>.test.ts`.
- The new gate exits 0 against the current tree when CI runs it.

**Tests to write in this chunk (Vitest only):**
- `server/services/executionBackends/__tests__/operatorManagedBackendPure.test.ts`: chain-link failure classifier (start vs runtime vs hard-cap-unresumable); finaliser decision table (every branch); predecessor allow-list helper (per § 7.3 step 2 + § 10.3 cancel-vs-dispatch invariant: `'cancelled'` MUST be excluded).
- `server/services/__tests__/operatorChainResumeServicePure.test.ts`: composer combines K = 5 artefact pointers + checkpoint correctly; original task brief survives across attempts.
- `server/services/__tests__/operatorTaskProfileServicePure.test.ts`: retention-window math (default 48h vs admin 14d); stale `gc_in_progress` reclaim window (30 min).
- `server/services/__tests__/subaccountOperatorSettingsServicePure.test.ts`: every CHECK constraint range + boundary; ETag derivation is `String(settings_version)` (R2-F3: NOT seconds-based; test that ETag is exactly `'1'` for version 1, `'2'` for version 2, collision-free for same-second writes); version-increment path (PATCH increments `settings_version` via `settings_version + 1`).
- `server/services/__tests__/operatorCostWriterPure.test.ts`: `(operator_run_id, source_type, boundary)` key; pre-swap step count derivation from event payload.
- `server/services/__tests__/operatorChainSchedulerServicePure.test.ts`: FIFO order by `agent_runs.updated_at ASC`; slot-count predicate excludes `superseded_by_attempt IS NOT NULL`.
- `server/services/__tests__/operatorConversationHistoryPure.test.ts`: K = 5 windowing; artefact-pointer ordering by chain order.
- `server/services/__tests__/operatorRuntimeErrors.test.ts`: every closed signal in spec § 3.7 item 1 (401/403 patterns, 429 with Retry-After, broker refresh failures, connection-level errors >3 retries).
- `scripts/__tests__/verifyOperatorEventRegistry.test.ts` (per `scripts/README.md` convention): temp-tree case with a known offender; assert non-zero exit.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/executionBackends/__tests__/operatorManagedBackendPure.test.ts`
- `npx vitest run server/services/__tests__/operatorChainResumeServicePure.test.ts`
- `npx vitest run server/services/__tests__/operatorTaskProfileServicePure.test.ts`
- `npx vitest run server/services/__tests__/subaccountOperatorSettingsServicePure.test.ts`
- `npx vitest run server/services/__tests__/operatorCostWriterPure.test.ts`
- `npx vitest run server/services/__tests__/operatorChainSchedulerServicePure.test.ts`
- `npx vitest run server/services/__tests__/operatorConversationHistoryPure.test.ts`
- `npx vitest run server/services/__tests__/operatorRuntimeErrors.test.ts`
- `npx tsx scripts/__tests__/verifyOperatorEventRegistry.test.ts`

**Doc-sync candidates for this chunk:**
- `KNOWLEDGE.md`, capture any pure-helper pattern that surfaced (e.g., the K = 5 windowing decision).

---

### Chunk 4 — Sandbox template rename + sandbox primitive extension (`sandboxStartKey` + `adoptOrStart`)

**Goal:** Rename the Docker template from `openclaw-session` to `operator-session` (git mv preserving history). Extend `SandboxExecutionService` with the additive idempotency seam.

**spec_sections:** § 3.5 (template), § 5.1 (modify), § 5.3 (sandboxExecutionService), § 5.4 (rename), § 7.1 (dispatch-crash recovery)

**Module shape:**
- *Public interface this chunk exposes:* the new optional field `sandboxStartKey?: string` on `SandboxRunTaskInput`; the new method `adoptOrStart(input: SandboxRunTaskInput & { sandboxStartKey: string }): Promise<SandboxRunTaskOutput>` on the service.
- *What stays hidden behind it:* the provider-side adoption logic in the existing 7-case state machine (spec § 8.1 from Spec B; extension uses Case 2's join-in-flight path with the start-key as an additional identity).

**Files (declared scope):**
- `infra/sandbox-templates/openclaw-session/Dockerfile` → `infra/sandbox-templates/operator-session/Dockerfile` (git mv; preserve content).
- `infra/sandbox-templates/openclaw-session/entrypoint.sh` → `infra/sandbox-templates/operator-session/entrypoint.sh` (git mv).
- `infra/sandbox-templates/openclaw-session/README.md` → `infra/sandbox-templates/operator-session/README.md` (git mv).
- `infra/sandbox-templates/openclaw-session/CURRENT_VERSION` → `infra/sandbox-templates/operator-session/CURRENT_VERSION` (git mv).
- `.github/workflows/publish-sandbox-templates.yml`, MODIFY: path update.
- `docker-compose.sandbox.yml`, MODIFY (if present): service name / mount path.
- `shared/types/sandbox.ts`, MODIFY: add `sandboxStartKey?: string` to `SandboxRunTaskInput` interface; document the new field.
- `server/services/sandboxExecutionService.ts`, MODIFY: add `adoptOrStart(input: SandboxRunTaskInput & { sandboxStartKey: string }): Promise<SandboxRunTaskOutput>` method. Implementation: prefer the existing row keyed by `sandboxStartKey` if one exists in `pending` / `running` / `harvesting`; otherwise run the existing `runTask` path. Reuses the existing 7-case state machine logic.
- `server/services/sandboxExecutionServicePure.ts`, MODIFY (if applicable): pure helper for adoption-vs-fresh-start decision.

**Contracts:**
- `SandboxRunTaskInput.sandboxStartKey?: string`, when set, the provider performs idempotent adoption keyed on this token. The Operator Backend always passes `sandboxStartKey = operator_run_id`.
- `adoptOrStart(input): Promise<SandboxRunTaskOutput>`, returns the existing sandbox under the token if one was created, otherwise starts a fresh one. Provides exactly-once sandbox creation per chain-link row even when `dispatch()` is retried after a crash.

**Dependencies:** Chunk 1 (the operator_runs table; the rename can technically run independently, but image_tag references point to the new path).

**Error-handling strategy:**
- A duplicate `sandboxStartKey` with a DIFFERENT `sandboxExecutionId` is a programmer error, throw a typed `SandboxStartKeyConflict` error. (The Operator Backend's discipline of `sandboxStartKey = operator_run_id` should make this impossible; the typed error exists for defence in depth.)
- Provider HTTP errors propagate per the existing `FailureError` contract.

**Acceptance criteria:**
- `git log --follow infra/sandbox-templates/operator-session/Dockerfile` shows continuous history through the rename.
- `npm run lint` + `npm run typecheck` clean.
- `SandboxRunTaskInput` interface has the optional `sandboxStartKey` field; V1 non-operator callers compile unchanged (field is optional).
- `sandboxExecutionService.adoptOrStart` exists and is exported.
- The CI publish workflow path references `operator-session` exclusively (zero hits for `openclaw-session` in `.github/workflows/`).
- **Vendor pinned version (Rev 2 F4):** the pinned vendor product version in `infra/sandbox-templates/operator-session/CURRENT_VERSION` is preserved verbatim from the pre-rename file (no bump in this chunk). The chunk commit message lists the pinned vendor product name + version verbatim from the file, so the value is grep-recoverable in git history. Vendor product/version bumps land in a separate dedicated chunk if and when the operator chooses to bump.

**Tests to write in this chunk (Vitest only):**
- `server/services/__tests__/sandboxExecutionServiceAdoptOrStart.test.ts`, NEW pure test for the adoption-vs-fresh decision (extract decision logic into `sandboxExecutionServicePure.ts` if not already; test there). Covers: (a) no existing row → fresh start path; (b) existing row in `pending` with matching start-key → adopt; (c) existing row in `running` with matching start-key → adopt; (d) existing row in terminal state with matching start-key → return the terminal output; (e) start-key conflict with different `sandboxExecutionId` → throw.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server` (sandbox primitive lives in `server/`)
- `npx vitest run server/services/__tests__/sandboxExecutionServiceAdoptOrStart.test.ts`

**Doc-sync candidates for this chunk:**
- `architecture.md`, Sandbox isolation primitive section: note the additive `sandboxStartKey` extension. (Chunk 11.)

---

### Chunk 5 — Service layer (non-adapter): profile, settings, chain-resume, cost-writer, scheduler, suspension notifier, errors, broker extensions

**Goal:** Ship every service the adapter and pg-boss handlers depend on, plus broker-side wiring for `requestOperatorSessionCredential` + `resolveFallback` + `usability_restored` emitter.

**spec_sections:** § 3.6 (broker abstraction), § 3.7 (fallback), § 3.13 (CS notification), § 3.14 (chain resume), § 3.15 (profiles), § 3.16 (settings), § 3.17 (incidents + scheduler), § 5.1 (services), § 5.3 (modify credential broker)

**Module shape:**
- *Public interface this chunk exposes:* (every signature takes `(orgId, subaccountId)` as the first two parameters per Rev 2 invariant 3; the impure facade ALWAYS calls `setOrgAndSubaccountGUC(tx, orgId, subaccountId)` as the first statement inside `db.transaction(async (tx) => { ... })` before any read/write against the three new tables)
  - `operatorTaskProfileService.ensureActiveProfile(orgId, subaccountId, taskId, attemptNumber): Promise<OperatorTaskProfileRow>`; `scheduleGc(orgId, subaccountId, taskId, attemptNumber, retentionMs): Promise<void>`; `extendDebugRetention(orgId, subaccountId, taskId, actorUserId): Promise<void>`.
  - `subaccountOperatorSettingsService.getEffectiveSettings(orgId, subaccountId): Promise<EffectiveOperatorSettings>`; `updateSettings({ orgId, subaccountId, ... }): Promise<{ row, etag }>`; `readForEtag(orgId, subaccountId): Promise<{ row, etag }>`.
  - `operatorChainResumeService.composeResumePayload(orgId, subaccountId, agentRunId, parentChainLinkId): Promise<ResumePayload>`.
  - `operatorCostWriter.writeRowsForChainLink(orgId, subaccountId, operatorRunId): Promise<void>` (key-based idempotent on `(operator_run_id, source_type, boundary)`).
  - `operatorChainSchedulerService.tryAcquireSlotAndDispatch({ orgId, subaccountId, agentRunId, attemptNumber, chainSeqNext, reason })`; `releaseSlotAndEnqueueNext(orgId, subaccountId)`.
  - `notifyOperatorSessionSuspended(input): Promise<void>`, emits `cs.operator_session.suspended_detected`.
  - `operatorBackendErrors.OperatorBackendConflictError`; `OperatorSessionLimitExceededError` (with shared mapper helper).
  - `credentialBrokerService.requestOperatorSessionCredential(input)`; `resolveFallback(input)`; `emitUsabilityRestored(input)`.
- *What stays hidden behind it:* dual-GUC setup; advisory-lock acquisition (`pg_advisory_xact_lock(hashtext('operator_slots:' || subaccountId))`); pgcrypto encryption call sites for checkpoint payloads; FIFO-queue scan SQL; retry-counter arithmetic; the `sandbox_start_key = operator_run_id` discipline.

**Files (declared scope):**
- `server/services/operatorTaskProfileService.ts`, NEW.
- `server/services/subaccountOperatorSettingsService.ts`, NEW.
- `server/services/operatorChainResumeService.ts`, NEW.
- `server/services/operatorCostWriter.ts`, NEW.
- `server/services/operatorChainSchedulerService.ts`, NEW.
- `server/services/operatorSessionSuspensionNotifier.ts`, NEW.
- `server/services/operatorBackendErrors.ts`, NEW.
- `server/services/credentialBrokerService.ts`, MODIFY:
  - Extend `OperatorSessionEnvelope` with `subaccountId: string`.
  - Declare `ApiKeyEnvelope` with `{ credentialId, connectionId, subaccountId, authType: 'api_key', provider, issuedAt, expiresAt: string | null }`.
  - Add `requestOperatorSessionCredential({ subaccountId, agentRunId }): Promise<OperatorSessionEnvelope | { unavailable: true, reason: string }>`.
  - Add `resolveFallback({ subaccountId, agentRunId, originalCredentialId }): Promise<{ envelope: OperatorSessionEnvelope | ApiKeyEnvelope, mode: 'operator_session' | 'api_key' } | null>`.
  - Add `emitUsabilityRestored({ connectionId, agentRunId? })`, emits `operator-session.usability_restored` lifecycle event via the existing event/audit-event pipeline (shape pinned at spec § 4.7).
- `server/services/llmRouter.ts`, MODIFY (canonical LLM-ledger writer LOCKED per Rev 2 invariant 6 — verified by grep `grep -rln "llmRequests).values\|insert.*llm_requests" server/`): accept optional `operatorRunId` + `boundary` parameters on the writer entrypoint(s); persist to `llm_requests.operator_run_id` and `llm_requests.boundary`; preserve existing `(agent_run_id, request_id)` idempotency for `per_token` rows.
- Route error-handler: builder runs a preflight `grep -nE "asyncHandler|errorHandler" server/middleware/ server/index.ts` to locate the canonical mapper, then extends it (single case-statement addition) OR maps inline at the operator routers if no central mapper exists. Either path is acceptable; the chosen location MUST be documented in the chunk commit message. The mapping rules: `OperatorBackendConflictError` → 409 with `current_state` body; `OperatorSessionLimitExceededError` → 429 with `cap`, `current`, `subaccount_id` body.

**Contracts:**
- `EffectiveOperatorSettings = { ...six numeric fields..., settingsVersion: number, etag: string }`. **R2-F3:** ETag is `String(settings_version)` — the integer column, not a timestamp. PATCH UPDATE uses `settings_version = settings_version + 1` (atomic increment, collision-free even for same-second writes). If-Match check: `row.settings_version.toString() !== ifMatchHeader` → 409 `OPERATOR_SETTINGS_CONFLICT`.
- `ResumePayload = { originalTaskBriefRef, conversationHistoryArtefacts, checkpointPayload, profileVolumeId, settingsSnapshot }`.
- `OperatorBackendConflictError({ kind: 'TASK_ALREADY_TERMINAL' | 'OPERATOR_TASK_RESTART_BLOCKED' | 'OPERATOR_SETTINGS_CONFLICT', currentState: unknown })`, single class with discriminator for the 409 family.
- `OperatorSessionLimitExceededError({ cap, current, subaccountId })`, 429.
- Broker `resolveFallback` return shape per spec § 3.7 item 2.

**Dependencies:** Chunks 1, 2, 3.

**Error-handling strategy:**
- Every public method wraps DB work in an org-scoped transaction AND calls `setOrgAndSubaccountGUC(tx, orgId, subaccountId)` as the FIRST statement inside the transaction (canonical helper added in Chunk 1; lives at `server/lib/orgScoping.ts`). Plain `setOrgGUC` is NOT used by any operator service in this chunk — these three tables require dual-GUC (Rev 2 invariant 3). **R2-F2 discipline:** `setOrgGUC` is permitted ONLY when reading tables whose RLS is org-scoped only (e.g. `agent_runs`, existing permission tables). Any service call path that reads or writes `operator_runs`, `operator_task_profiles`, or `subaccount_operator_settings` MUST use `setOrgAndSubaccountGUC`. Builder must grep-verify the split in every new service file before declaring the chunk done.
- Service-internal errors throw typed exceptions; no raw strings. The route error-handler maps the typed classes to HTTP status codes (chunk acceptance criterion: path documented in commit message).
- Cost-writer holds the advisory lock `pg_advisory_xact_lock(hashtext('operator_finalise:' || operatorRunId))` per spec § 10.3; combined with the `event_emitted_at IS NULL` predicate, two concurrent finalises cannot interleave.
- Profile GC uses `withAdminConnectionGuarded({ source: 'operatorTaskProfileGc' }, async (tx) => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); ... })`. Canonical export is at `server/lib/rlsBoundaryGuard.ts` (verified at search time). Cross-org GC does not need the subaccount GUC (admin role bypasses RLS); the role is the safety boundary.

**Acceptance criteria:**
- `npm run lint` + `npm run typecheck` clean.
- All public functions take `(orgId, subaccountId)` as the FIRST TWO parameters (or read them from a principal context the caller provides); no implicit resolution. Grep `grep -nE "setOrgGUC\\(|setOrgAndSubaccountGUC\\(" server/services/operator*.ts server/services/credentialBrokerService.ts` returns ONLY `setOrgAndSubaccountGUC` calls for the operator services (no plain `setOrgGUC` in operator-service code).
- The broker's existing tests still pass; broker exports the four new symbols.
- `llmRouter.ts` continues to honour `(agent_run_id, request_id)` idempotency for `per_token` rows; the new `operator_run_id` + `boundary` columns are nullable attribution only.
- The chosen route error-handler path is documented in the chunk commit message and grep-verifiable: `grep -n "OperatorBackendConflictError\|OperatorSessionLimitExceededError" server/middleware/ server/routes/operator*.ts` returns at least one hit.

**Tests to write in this chunk (Vitest only):**
- The impure boundary code does NOT need new tests beyond what's in the pure module siblings (Chunk 3). Per spec § 12: "Pure-function tests authored alongside the code... impure boundary code lives here."
- One exception: `server/services/__tests__/operatorBackendErrorsMapper.test.ts`, verifies the route error-handler mapping (extract the mapper into a pure helper if not already; test there).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/__tests__/operatorBackendErrorsMapper.test.ts`

**Doc-sync candidates for this chunk:**
- None directly; prose updates to `architecture.md` for the new service surface land in Chunk 11.

---

### Chunk 6 — Adapter object + lifecycle methods + registration + pg-boss handlers + queue registration

**Goal:** Land the `operatorManagedBackend` adapter implementing the Spec A contract; register it at boot; ship all four pg-boss handlers.

**spec_sections:** § 3.1, § 3.2, § 3.6, § 3.7, § 3.10 (cancel), § 4.1 (adapter object), § 7 (execution model — all subsections), § 10 (every concurrency/idempotency invariant)

**Module shape:**
- *Public interface this chunk exposes:* the `operatorManagedBackend: ExecutionBackend` object with `dispatch / loadTerminalState / finalise / reconcile / cancel`; the four pg-boss handler functions wired to their respective queues.
- *What stays hidden behind it:* the inline `dispatch()` 10-step sequence; the `event_emitted_at`-keyed idempotency check; the `pg_advisory_xact_lock` calls; the three-way subaccount-match assertion; the in-band credential swap mechanics; the `sandboxStartKey = operator_run_id` discipline; the post-terminal prohibition guard on progress writes.

**Files (declared scope):**
- `server/services/executionBackends/operatorManagedBackend.ts`, NEW. Lives at ~600-900 lines. Composes the services from Chunk 5 + pure helpers from Chunk 3 + sandbox primitive from Chunk 4 + broker from Chunk 5.
- `server/jobs/operatorSessionCompletedHandler.ts`, NEW. Reads the `operator_runs` row; calls `finaliseAgentRunFromBackend({ backendId: 'operator_managed', backendTaskId: operatorRunId })`. Idempotency keyed on `event_emitted_at`.
- `server/jobs/operatorSessionDispatchNextChainLinkHandler.ts`, NEW. Reads the parent `agent_runs` row; gates on the allowed-predecessor set + reason-tag match (§ 7.3 step 2); runs the dispatch via `operatorChainSchedulerService.tryAcquireSlotAndDispatch`. Backoff retry (1 min → 5 min → 15 min) via pg-boss `startAfter`.
- `server/jobs/operatorSessionProgressedHandler.ts`, NEW. SOLE writer for `last_progress_at` + `step_count`; emits the `operator-session.progressed` WebSocket event; emits `operator-session.preparing_checkpoint` when the step-state payload carries it; emits `operator-session.auto_extending` once per chain link with the pg-boss singleton key.
- `server/jobs/operatorTaskProfileGcHandler.ts`, NEW. 15-minute cron; uses `withAdminConnectionGuarded({ source: 'operatorTaskProfileGc' }) + SET LOCAL ROLE admin_role` per spec § 7.5. Reclaims stale `gc_in_progress` rows older than 30 minutes.
- `server/index.ts`, MODIFY: at lines 687-691, add `executionBackendRegistry.register(operatorManagedBackend)` alongside the existing five.
- `server/lib/createWorker.ts` (or the canonical pg-boss registration site — verify path), MODIFY: register the four new queues (`operator-session-completed`, `operator-session-dispatch-next-chain-link`, `operator-session-progressed`, `operator-task-profile-gc`); wire singleton keys.
- `server/services/agentRunFinalizationService.ts`, MODIFY (if needed; verify the `backendId → handler` routing is currently table-driven or registry-only): the existing dispatcher routes by `backendId` so the change should be zero-code-additive. If any switch statement enumerates known backends, add the operator case.

**Contracts:**
- `operatorManagedBackend` declares `capabilities: ['delegated', 'code_execution', 'long_running', 'cancellation', 'session_identity']`, type-checked by `ExecutionCapability[]`.
- `completedEventQueue: 'operator-session-completed'`; `terminalStateTable: 'operator_runs'`.
- `completedEventPayload: operatorSessionCompletedPayloadSchema` (Zod, declared adjacent to the adapter): `{ operatorRunId: string (uuid), agentRunId: string (uuid) }`.
- Adapter's `loadTerminalState(tx, backendTaskId)` reads `operator_runs WHERE id = $1 FOR UPDATE` and maps to `BackendTerminalState`.
- Adapter's `finalise(input)` is the orchestrator's hook. Inside, the adapter runs the chain-resume decision (`decideChainResumeOutcome` from Chunk 3), stamps `operator_runs.event_emitted_at = now()` under the optimistic predicate, calls `operatorCostWriter.writeRowsForChainLink`, and writes the parent `agent_runs` status under the optimistic predicate. Returns `{ finalised: bool, parentTerminalStatus: string, postCommit?: () => Promise<void> }`.
- Adapter's `reconcile()` per Spec A: scans for `operator_runs` rows where `status='running' AND last_progress_at < now() - INTERVAL '5 minutes'`; marks them `failed` with `failure_reason='heartbeat_stale'`. LIMIT 100; idempotent.
- Adapter's `cancel({ runId, backendTaskId })` implements the chain-aware cancellation per spec § 3.10.
- **Dispatcher success predicate (Rev 2 invariant 2 + R2 cleanup — explicit):** the optimistic UPDATE that flips paused → delegated is `UPDATE agent_runs SET status='delegated', operator_chain_failure_count=0 WHERE id=$1 AND status IN ('pending','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded')`. `'delegated'`, `'cancelled'`, `'paused_wall_clock_exceeded'`, and all terminal states are EXCLUDED. `operator_chain_failure_count` is reset to 0 on every successful dispatch — prevents stale failure counts from misleading subsequent dispatches after a recovery. A 0-row-affected result is a no-op (race lost; another dispatcher / cancel / finaliser already wrote); the dispatcher logs and exits cleanly.
- **`is_resumable_now` vendor-field-name (Rev 2 invariant 6 — acceptance item):** the builder inspects the vendor operator runtime's checkpoint step-state payload to determine the actual field name. The chunk acceptance criterion: the chosen field name is documented in the commit message + cited in the relevant pure helper (likely `operatorChainResumeServicePure.ts` from Chunk 3 — extend that helper if needed) so future spec maintainers can grep for it.

**Dependencies:** Chunks 1, 2, 3, 4, 5.

**Error-handling strategy:**
- Every typed runtime error from `operatorRuntimeErrors.classifyRuntimeError()` is mapped at the adapter's `dispatch()` call site to a `failure_reason` string on the chain-link row.
- The `dispatch()` 10-step sequence wraps each step's failure in a typed result. On failure, the chain-link row is written with `status='failed'` (or aborts before insert), and the `operator.chain_link_start_failed` incident is emitted per spec § 3.17, keyed on `(agent_run_id, attempt_number, chain_seq, retry_attempt)`.
- Dispatch-crash recovery: re-read the chain-link row; if `status='pending' AND vendor_session_id IS NULL`, call `sandboxExecutionService.adoptOrStart({ sandboxStartKey: operator_run_id, ... })`. Adoption failure → `failure_reason='sandbox_start_unknown'` + incident.
- Adapter's `finalise()` and the cost-writer share the advisory lock; the optimistic `event_emitted_at = now() WHERE event_emitted_at IS NULL RETURNING id` is the race tie-breaker.
- The progress handler's `WHERE status = 'running'` predicate drops post-terminal events silently (logs the drop; no WebSocket emit).

**Acceptance criteria:**
- `npm run lint` + `npm run typecheck` clean.
- `npm run build:server` succeeds; at boot, `operator_managed` registers without throwing.
- pg-boss boot registers the four new queues; idempotency keys configured.
- Adapter satisfies the Spec A registry validation (§ 8.2 of Spec A): all delegated methods present; sandbox requirement valid; `'cancellation'` declared → `cancel()` defined.
- Manual run: invoke `executionBackendRegistry.resolve('operator_managed')` and assert the returned object's identity.

**Tests to write in this chunk (Vitest only):**
- `server/services/executionBackends/__tests__/operatorManagedBackendDispatch.test.ts`: extract the `dispatch()` decision logic into smaller pure helpers tested separately. Cover: (a) concurrency-cap hit for new task → `OPERATOR_SESSION_LIMIT_EXCEEDED`; (b) three-way subaccount mismatch → `OPERATOR_SUBACCOUNT_MISMATCH`; (c) credential broker returns `unavailable` → fallback resolution path; (d) fallback returns null → `OPERATOR_SESSION_UNAVAILABLE` + chain-link `failed`; (e) dispatch-crash recovery: `operator_runs` row with `status='pending' AND vendor_session_id IS NULL` → `adoptOrStart` called; (f) adoption returns the existing sandbox → chain link transitions to `running`.
- `server/jobs/__tests__/operatorSessionCompletedHandler.test.ts`: idempotency, redelivery with `event_emitted_at IS NULL` runs finalisation; redelivery with `event_emitted_at IS NOT NULL` is no-op.
- `server/jobs/__tests__/operatorSessionDispatchNextChainLinkHandler.test.ts`: predecessor allow-list (uses Chunk 3 helper); reason-tag mismatch is no-op; `'cancelled'` task state is no-op (cancel-vs-dispatch invariant); retry counter increments on `transient` failure class; bypass on `permanent | auth | profile_corruption`.
- `server/jobs/__tests__/operatorSessionProgressedHandler.test.ts`: post-terminal event with `status != 'running'` updates 0 rows + no WebSocket emit; NULL-safe `greatest()` for first event; `step_count` monotonic non-decreasing.
- `server/jobs/__tests__/operatorTaskProfileGcHandler.test.ts`: stale `gc_in_progress` reclaim at 30 min; provider 404 on delete → treat as `gc_done`.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server` (boot-time registration smoke)
- `npx vitest run server/services/executionBackends/__tests__/operatorManagedBackendDispatch.test.ts`
- `npx vitest run server/jobs/__tests__/operatorSessionCompletedHandler.test.ts`
- `npx vitest run server/jobs/__tests__/operatorSessionDispatchNextChainLinkHandler.test.ts`
- `npx vitest run server/jobs/__tests__/operatorSessionProgressedHandler.test.ts`
- `npx vitest run server/jobs/__tests__/operatorTaskProfileGcHandler.test.ts`

**Doc-sync candidates for this chunk:**
- `architecture.md`, adapter registry + chain-resume model (Chunk 11).
- `KNOWLEDGE.md`, capture the `sandboxStartKey = operator_run_id` exactly-once discipline as a Pattern entry.

---

### Chunk 7 — Routes + permission key + role grant + WebSocket bridge

**Goal:** Ship the three new route modules, the new permission key, the role grant, and the permission-coverage gate update.

**spec_sections:** § 3.9 (polling route), § 3.10 (cancellation route — uses existing agent-run cancel; verify), § 3.16 (settings GET / PATCH), § 5.1 (routes), § 5.3 (permissions + role grant), § 6.5 + § 6.5b (route guards + actor rules)

**Module shape:**
- *Public interface this chunk exposes:* the three Express routers mounted at:
  - **`GET /api/subaccounts/:subaccountId/operator-sessions/:operatorRunId/progress`** (R2-F1: `subaccountId` in path so `setOrgAndSubaccountGUC` can be called before reading the dual-GUC RLS-protected `operator_runs` table)
  - `/api/subaccounts/:subaccountId/operator-settings` (GET, PATCH)
  - `/api/operator-tasks/:agentRunId/{retry-chain-failure | extend-budget | fresh-profile-restart | refresh-credential | extend-debug-retention}` (POST × 5)
- *What stays hidden behind it:* `authenticate` + `requirePermission` + `resolveSubaccount` boilerplate; GUC split (`setOrgGUC` for org-only tables; `setOrgAndSubaccountGUC` for operator tables — see R2-F2 discipline in error-handling); the assigned-user / `manager+` actor-rule check (handler-internal); ETag round-tripping; 409/429 error envelopes.

**Files (declared scope):**
- `server/routes/operatorSessions.ts`, NEW: **`GET /api/subaccounts/:subaccountId/operator-sessions/:operatorRunId/progress`** (R2-F1). Auth: `authenticate + requirePermission('AGENT_RUN_READ') + resolveSubaccount`. Handler calls `setOrgAndSubaccountGUC(tx, orgId, subaccountId)` (dual) before reading `operator_runs` — required because `operator_runs` RLS policy checks both GUCs. `subaccountId` comes from the URL path parameter, not header-derived. Mirrors `server/routes/iee.ts`'s polling route shape.
- `server/routes/subaccountOperatorSettings.ts`, NEW: `GET` + `PATCH /api/subaccounts/:subaccountId/operator-settings`. PATCH requires `SUBACCOUNT_OPERATOR_SETTINGS_WRITE`; If-Match ETag check. Reads/writes via `subaccountOperatorSettingsService` (Chunk 5).
- `server/routes/operatorTasks.ts`, NEW: five POST routes per spec § 6.5b table.
- `server/lib/permissions.ts`, MODIFY: add `SUBACCOUNT_OPERATOR_SETTINGS_WRITE` to `SUBACCOUNT_PERMISSIONS` (it's a subaccount-scoped action).
- `server/services/permissionSeedService.ts` (or the canonical role-grant file — verify before authoring), MODIFY: grant the new key to the `org_admin` role default.
- `scripts/gates/verify-permission-coverage.sh` (or canonical permission-coverage gate — verify path), MODIFY: include `SUBACCOUNT_OPERATOR_SETTINGS_WRITE` in expected registry/grant coverage.
- `server/index.ts`, MODIFY: mount `operatorSessions`, `subaccountOperatorSettings`, `operatorTasks` routers alongside existing mounts (distinct from the adapter registration at 687-691).

**Contracts:**
- **`GET /api/subaccounts/:subaccountId/operator-sessions/:operatorRunId/progress`** (R2-F1) → `{ operatorRunId, chainSeq, status, lastProgressAt, stepCount, summary?: string }`. 404 on row-not-found (not 403; consistent with existing IEE pattern). Client-side callers must include `subaccountId` in the URL; see Chunk 8 `getOperatorRunProgress(subaccountId, operatorRunId)` signature update.
- `GET /api/subaccounts/:subaccountId/operator-settings` → `{ ...sixFields, updatedAt, updatedByUserId }` + `ETag` response header.
- `PATCH /api/subaccounts/:subaccountId/operator-settings` → `If-Match` request header; 409 `OPERATOR_SETTINGS_CONFLICT` on mismatch.
- `POST /api/operator-tasks/:agentRunId/retry-chain-failure` (Rev 2 F1 — enqueue-only): preconditions `task.status = 'paused_chain_failure'`. Action: resets `operator_chain_failure_count = 0`; writes audit event `task.operator.chain_failure_retried`; enqueues `'operator-session-dispatch-next-chain-link'` job with `reason='retry'`. **Does NOT transition `agent_runs.status`** — the dispatcher is the sole writer of `paused_chain_failure → delegated` (Rev 2 invariant 1). Returns 202.
- `POST /api/operator-tasks/:agentRunId/extend-budget` (Rev 2 F1 — enqueue-only): body `{ extensionMinutes: number }`. Preconditions `task.status = 'paused_budget_exceeded'`. Action: additive budget extension (60-min step; bounds 60..60000 per spec § 3.17 item 4); writes audit event `task.operator.budget_extended`; enqueues `'operator-session-dispatch-next-chain-link'` job with `reason='budget_extension'`. **Does NOT transition `agent_runs.status`** — the dispatcher is the sole writer of `paused_budget_exceeded → delegated` (Rev 2 invariant 1). Returns 202.
- `POST /api/operator-tasks/:agentRunId/fresh-profile-restart` (Rev 2 F6 — restricted predicate): org-admin only. Preconditions in one atomic `SELECT … FOR UPDATE`: `(a) task.status = 'paused_chain_failure'` AND `(b) latest non-superseded chain-link row has failure_class = 'profile_corruption' OR failure_reason = 'OPERATOR_PROFILE_UNRECOVERABLE'`. If either fails → 409 `OPERATOR_PROFILE_RESTART_BLOCKED` with body naming the failing precondition. Action: bumps `agent_runs.attempt_number`; marks prior chain links `superseded_by_attempt = N+1`; resets conversation history; emits `operator-session.fresh_profile_restart`. Other paused states cannot fresh-profile-restart in V1.
- `POST /api/operator-tasks/:agentRunId/refresh-credential` → org-admin only; triggers broker `emitUsabilityRestored`; emits audit event `task.operator.credential_refreshed`; clears fallback stickiness.
- `POST /api/operator-tasks/:agentRunId/extend-debug-retention` → org-admin only; extends `operator_task_profiles.scheduled_gc_at` to `now() + INTERVAL '14 days'`; sets `debug_retention_extended_by/_at`; audit event `task.operator.debug_retention_extended`.

**Dependencies:** Chunks 1, 2, 3, 5, 6.

**Error-handling strategy:**
- All routes use `asyncHandler` per CLAUDE.md (no manual try/catch).
- **R2-F2 GUC split discipline:** routes that ONLY read org-scoped tables (`agent_runs`, permission checks) use `setOrgGUC`. Routes (or service calls within routes) that read/write `operator_runs`, `operator_task_profiles`, or `subaccount_operator_settings` MUST use `setOrgAndSubaccountGUC`. The progress route (R2-F1) and operator-settings routes always use dual-GUC. The operator-tasks routes may use org-only `setOrgGUC` for the initial precondition read of `agent_runs` but MUST switch to dual-GUC before any operator-table access via the service layer (the service signatures enforce this via `(orgId, subaccountId)` first-two-params contract per Rev 2 invariant 3). Builder acceptance criterion: grep-verify `setOrgGUC(` does NOT appear in the call path for any operator-table write. See acceptance criteria below.
- Service errors throw `OperatorBackendConflictError` / `OperatorSessionLimitExceededError` (Chunk 5) → mapped to 409/429 by the route error-handler.
- Direct-DB-access in routes is prohibited per CLAUDE.md and enforced by `verify-rls-contract-compliance.sh` CI gate.

**Acceptance criteria:**
- `npm run lint` + `npm run typecheck` clean.
- Each route mounts under `authenticate` + appropriate `requirePermission` + `resolveSubaccount`. Verified by code review.
- **R2-F2 GUC grep check:** `grep -n "setOrgGUC(" server/routes/operatorSessions.ts server/routes/subaccountOperatorSettings.ts server/routes/operatorTasks.ts` returns ZERO hits. The operator routes must not call plain `setOrgGUC` — dual-GUC is handled inside the service calls. `grep -n "setOrgAndSubaccountGUC(" server/routes/operatorSessions.ts server/routes/subaccountOperatorSettings.ts` returns at least one hit per file (direct call for progress and settings routes; operator-tasks routes invoke it via service layer, so hits are in the service files, not the route files — document the split in the chunk commit message).
- `SUBACCOUNT_OPERATOR_SETTINGS_WRITE` appears in `server/lib/permissions.ts`, in the role-grant file's `org_admin` defaults, and in the permission-coverage gate's expected list.
- **R2-F1:** the progress route is mounted at `GET /api/subaccounts/:subaccountId/operator-sessions/:operatorRunId/progress` (NOT the old `/api/operator-sessions/:operatorRunId/progress`). Grep the mounted path in `server/index.ts` to verify.
- Manual smoke: `curl -H 'Authorization: ...' /api/subaccounts/:subId/operator-sessions/:id/progress` returns 200 / 404 correctly; same for settings GET; PATCH with stale If-Match returns 409.

**Tests to write in this chunk (Vitest only):**
- `server/routes/__tests__/operatorTasksRouteGuards.test.ts`, NEW. Pure helper tests for the assigned-user / `manager+` actor-rule check. Extract `evaluateRouteActorRule(input): { allowed: boolean, reason?: string }` into a pure module and test it. Covers: assigned user OK; manager OK; below-manager non-assigned user denied; admin-only routes deny non-admin.
- `server/routes/__tests__/freshProfileRestartPredicate.test.ts`, NEW (Rev 2 F6). Extract the precondition logic into a pure helper `decideFreshProfileRestartAllowed(input): { allowed: boolean, blockingReason?: 'TASK_NOT_PAUSED_CHAIN_FAILURE' | 'LATEST_FAILURE_NOT_PROFILE_CORRUPTION' }`. Covers: `paused_chain_failure` + `profile_corruption` failure_class → allowed; `paused_chain_failure` + `OPERATOR_PROFILE_UNRECOVERABLE` failure_reason → allowed; `paused_chain_failure` + other failure → blocked with reason `LATEST_FAILURE_NOT_PROFILE_CORRUPTION`; `paused_budget_exceeded` → blocked with reason `TASK_NOT_PAUSED_CHAIN_FAILURE`; `paused_for_chain_continuation` → blocked.
- `server/routes/__tests__/retryChainFailureEnqueueOnly.test.ts`, NEW (Rev 2 F1). Stub the queue + DB; assert: (a) precondition mismatch → 409 with no DB writes and no enqueue; (b) precondition match → counter reset to 0 + audit event written + dispatch job enqueued; (c) `agent_runs.status` is UNCHANGED by the route (extract DB call assertions; verify no `UPDATE agent_runs SET status` SQL is issued). Same shape for extend-budget.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/routes/__tests__/operatorTasksRouteGuards.test.ts`
- `npx vitest run server/routes/__tests__/freshProfileRestartPredicate.test.ts`
- `npx vitest run server/routes/__tests__/retryChainFailureEnqueueOnly.test.ts`

**Doc-sync candidates for this chunk:**
- `architecture.md`, Key files per domain (operator routes) (Chunk 11).

---

### Chunk 8 — Client API helpers + shared client types

**Goal:** Thin TypeScript client for the three new route surfaces. No UI.

**spec_sections:** § 5.1 (client API), § 13.2

**Module shape:**
- *Public interface this chunk exposes:* **`getOperatorRunProgress(subaccountId, operatorRunId)`** (R2-F1: `subaccountId` required to build the URL `/api/subaccounts/:subaccountId/operator-sessions/:operatorRunId/progress`), `getOperatorSettings(subaccountId)`, `updateOperatorSettings(subaccountId, body, etag)`, `retryChainFailure(agentRunId)`, `extendBudget(agentRunId, extensionMinutes)`, `freshProfileRestart(agentRunId)`, `refreshCredential(agentRunId)`, `extendDebugRetention(agentRunId)`.
- *What stays hidden behind it:* fetch boilerplate; header construction; 4xx error-envelope parsing.

**Files (declared scope):**
- `client/src/api/operatorBackendApi.ts`, NEW.
- `client/src/components/operator/_shared.ts`, NEW: shared op-backend helpers (status-pill colour map per `r3/r4/r5/r15`; chain-link indicator text formatter per `r14`).

**Contracts:**
- Each helper returns `{ ok: true, data: T } | { ok: false, error: { code, status, body? } }`, match the existing client-API discriminator pattern in this repo (verify by reading the closest existing helper, e.g. `client/src/api/agentRunsApi.ts` if present).

**Dependencies:** Chunk 7.

**Error-handling strategy:**
- 409 / 429 responses are surfaced to the UI as discriminated error variants (no generic "request failed" wrapper).
- ETag round-trip: `updateOperatorSettings` accepts `etag` parameter, sends as `If-Match`; on 409, returns the server's `current_state` in the error body.

**Acceptance criteria:**
- `npm run lint` + `npm run typecheck` clean.
- `npm run build:client` succeeds.

**Tests to write in this chunk:**
- None, pure thin-wrapper functions with no branchy logic. If the helpers grow conditional shape mapping, extract to `operatorBackendApiPure.ts` and test there.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Doc-sync candidates for this chunk:**
- None.

---

### Chunk 9 — UI: settings tab + AdminSubaccountDetailPage extension

**Goal:** Ship the new "Operator" tab on `AdminSubaccountDetailPage` per mockup `r13`.

**spec_sections:** § 3.16, § 6.6, § 13.1 (r13)

**Module shape:**
- *Public interface this chunk exposes:* the `OperatorSettingsTab` React component rendered when `activeTab === 'operator'`.
- *What stays hidden behind it:* field-component composition (slider + number input + helper text); ETag round-tripping; range validation client-side; the "Changes apply to new sessions only" footer note.

**Files (declared scope):**
- `client/src/pages/govern/operatorSettings/OperatorSettingsTab.tsx`, NEW.
- `client/src/pages/govern/operatorSettings/_fields.tsx`, NEW: field components.
- `client/src/pages/AdminSubaccountDetailPage.tsx`, MODIFY: extend `ActiveTab` union with `'operator'`; extend `TAB_LABELS` with `operator: 'Operator'`; insert between `'board'` and `'usage'` in `visibleTabs`; render `<OperatorSettingsTab />`.

**Contracts:**
- Tab visibility per spec § 6.6: `manager` and above can see the tab; `org_admin` can edit the form. Below `manager` the tab is hidden.

**Dependencies:** Chunk 8.

**Error-handling strategy:**
- 409 on PATCH: refetch + redisplay current values + toast `"Settings changed by another admin, please review and re-apply your changes."`.
- Client-side range validation matches the server-side CHECK constraints.

**Acceptance criteria:**
- `npm run lint` + `npm run typecheck` + `npm run build:client` clean.
- Visual review against mockup `r13-subaccount-operator-settings-tab.html`.
- Tab is hidden below `manager`; form is read-only at `manager`; form is editable at `org_admin`.
- Manual 409 regression check: edit settings in one browser session; before saving, edit + save the same settings in a second admin session; back in the first session, save — expect 409 + the toast `"Settings changed by another admin, please review and re-apply your changes."` (R2-F3: ETag is now `String(settings_version)` — an integer column incremented on every PATCH. The regression is surfaced even when both writes land in the same second, because the version always increments. No same-second blind spot.)

**Tests to write in this chunk:**
- None per spec § 12.1 ("no frontend tests"); any branchy formatter logic goes into `_shared.ts` (Chunk 8) and is tested there. The 409 regression check is the manual acceptance item above.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Doc-sync candidates for this chunk:**
- None directly.

---

### Chunk 10 — UI: TaskHeader family + OpenTaskView + Run Trace + WorkspaceBoard + modals + Connections suspended state

**Goal:** Ship every operator-facing UI surface in one tight chunk so the operator-state copy and the modals land together.

**spec_sections:** § 3.11 (Run Trace), § 13.1 (`r1-r17` + `c1`, `c2`)

**Module shape:**
- *Public interface this chunk exposes:* the React components per spec § 5.1 (UI table), `OperatorChainLinkIndicator`, `OperatorAutoExtendBanner`, `ChainLinkDivider`, `AttemptGroup`, `OperatorBadge`, `OperatorFilterToggle`, `OperatorConcurrencyLimitModal`, `OperatorUnavailableModal`, `OperatorBudgetExceededModal`.
- *What stays hidden behind it:* status-pill colour state machine (green / amber / terminal); auto-extend banner trigger; conditional rendering of operator-state copy across `r3 / r4 / r5 / r6`; cost-summary footer derivation.

**Files (declared scope):**
- `client/src/components/openTask/OperatorChainLinkIndicator.tsx`, NEW.
- `client/src/components/openTask/OperatorAutoExtendBanner.tsx`, NEW.
- `client/src/components/run-trace/ChainLinkDivider.tsx`, NEW.
- `client/src/components/run-trace/AttemptGroup.tsx`, NEW.
- `client/src/components/operator/OperatorBadge.tsx`, NEW.
- `client/src/components/operator/OperatorFilterToggle.tsx`, NEW.
- `client/src/components/operator/OperatorConcurrencyLimitModal.tsx`, NEW.
- `client/src/components/operator/OperatorUnavailableModal.tsx`, NEW.
- `client/src/components/operator/OperatorBudgetExceededModal.tsx`, NEW.
- `client/src/components/openTask/TaskHeader.tsx`, MODIFY: render indicator + banner; hide pause during auto-extend.
- `client/src/components/openTask/OpenTaskView.tsx`, MODIFY: conditional operator-state copy per `r3/r4/r5`.
- `client/src/components/openTask/ChatPane.tsx`, MODIFY: operator system messages per `r4/r6`.
- `client/src/components/openTask/ActivityPane.tsx`, MODIFY: fallback-engaged amber row per `r6`; cost-summary footer per `r3`.
- `client/src/components/openTask/FilesTab.tsx`, MODIFY: harvested-artefact display (no operator-specific rendering; reuses existing artefact-list pattern).
- `client/src/pages/operate/RunTracePage.tsx`, MODIFY: render `<AttemptGroup />` when `attempt_number > 1`; render `<ChainLinkDivider />` between events of different `chain_seq`.
- `client/src/pages/operate/components/RunTraceEventRenderer.tsx`, MODIFY: wire the new `operator-session.*` event renderers.
- `client/src/pages/WorkspaceBoardPage.tsx`, MODIFY: render `<OperatorFilterToggle />`.
- `client/src/components/TaskCard.tsx`, MODIFY: render `<OperatorBadge />` when `task.executionBackendId === 'operator_managed'`.
- `client/src/pages/build/AgentEditPage.tsx`, MODIFY: replace "Available soon" placeholder per `c1`.
- `client/src/pages/govern/ConnectionsPage.tsx`, MODIFY: render "Suspended" pill + Reconnect CTA per `r11`. Plan-tier display per open question 6: render "Suspended" only, without naming the provider in customer-facing copy.

**Contracts:**
- Status pill colour state machine: `running` → green; `paused_*` → amber; terminal → grey. Auto-extend amber state is disambiguated from `paused_*` amber by an inline sub-label (per spec open question 5).
- Operator badge appears only when `task.executionBackendId === 'operator_managed'`.

**Dependencies:** Chunk 8.

**Error-handling strategy:**
- Loading / empty / error states for the polling-based progress view; the polling helper handles transient 5xx.

**Acceptance criteria:**
- `npm run lint` + `npm run typecheck` + `npm run build:client` clean.
- Visual review against mockups `r1`-`r17` + `c1`-`c2`.

**Tests to write in this chunk:**
- None per spec § 12.1. Any non-trivial pure formatter goes into `client/src/components/operator/_shared.ts` (Chunk 8) and is unit-tested there.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Doc-sync candidates for this chunk:**
- `docs/frontend-design-principles.md`, verify per the five hard rules. No update expected; the design is consumer-simple by construction (one primary action per modal; inline state via status pill).

---

### Chunk 11 — CS runbook + ADR + capabilities + architecture + doc-sync sweep

**Goal:** Land every documentation artefact in one commit so the spec / code / docs ship together.

**spec_sections:** § 3.13 (runbook), § 5.1 (docs), § 5.3 (architecture / capabilities / doc-sync)

**Module shape:**
- *Public interface this chunk exposes:* none (docs only).
- *What stays hidden behind it:* n/a.

**Files (declared scope):**
- `docs/runbooks/operator-session-account-suspension.md`, NEW: per spec § 3.13 sections 1-7.
- `docs/runbooks/templates/operator-session-suspension-customer-email.md`, NEW: customer email template.
- `docs/runbooks/templates/operator-session-suspension-in-app-message.md`, NEW: in-app message template.
- `docs/decisions/0011-operator-backend-chain-resume-model.md`, NEW ADR locking D8 (chain-resume required) + D11 (persistent profile required). Use template at `docs/decisions/_template.md`.
- `docs/decisions/README.md`, MODIFY: add the new ADR to the index.
- `architecture.md`, MODIFY: add Operator Backend service-layer row under "Key files per domain"; add chain-resume + per-subaccount settings sections; note the additive `sandboxStartKey` extension to the sandbox primitive; note the four new pg-boss queues.
- `docs/capabilities.md`, MODIFY: add Operator Backend capability entry. Vendor-neutral copy per Editorial Rules (no vendor codename; no engineer-facing primitives).
- `docs/doc-sync.md`, MODIFY: register the `operator-session.*` event registry pattern as a convention (note the CI gate location).

**Contracts:**
- Customer email + in-app message follow the existing comms-template shape (markdown frontmatter + plain-English body); verify the existing template for shape.
- ADR 0011 frontmatter: `status: accepted`, `date: 2026-05-12`, `superseded_by: none`.

**Dependencies:** Chunks 1-10 (so the docs reflect the actual shipped surface).

**Error-handling strategy:**
- n/a.

**Acceptance criteria:**
- All docs render correctly (lint passes; no broken links).
- `docs/doc-sync.md` sweep across all reference docs returns clean verdicts (per the procedure in `docs/doc-sync.md`).
- The ADR cites concrete file paths and the spec.

**Tests to write in this chunk:**
- None.

**Verification commands:**
- `npm run lint`

**Doc-sync candidates for this chunk:**
- This IS the doc-sync chunk.

---

### Chunk 12 — Final CI gate + checkpoint-logging gate + build smoke

**Goal:** Close the change-set with the last CI gate and a build:server boot smoke.

**spec_sections:** § 3.14 item 10 (checkpoint logging ban), § 12 (testing posture)

**Module shape:**
- *Public interface this chunk exposes:* the new CI gate script.
- *What stays hidden behind it:* the gate's grep patterns + allow-list.

**Files (declared scope):**
- `scripts/gates/verify-no-checkpoint-logging.sh`, NEW: bans naive log calls referencing `checkpoint_payload`. Allow-list: this spec, the brief, the plan, the schema declaration, this gate's own script, and the encryption helper's docstrings.
- `.github/workflows/ci.yml`, MODIFY: wire the gate.

**Contracts:**
- Gate grep pattern: `grep -rn --include='*.ts' -E '(logger\.[a-z]+|console\.[a-z]+).*checkpoint_payload' server/ client/ shared/ | grep -vE '<allow-list>'`. Non-empty output = fail.

**Dependencies:** Chunks 1-11.

**Error-handling strategy:**
- CI gate failure produces a clear error message naming each offending file + line.

**Acceptance criteria:**
- `npm run lint` + `npm run typecheck` clean.
- `npm run build:server` succeeds.
- Manual boot smoke: `npm run dev` (or `npm run build:server && node dist/server/index.js`) logs `operator_managed` registered + the four pg-boss queues + the three new routes mounted.

**Tests to write in this chunk:**
- `scripts/__tests__/verifyNoCheckpointLogging.test.ts`, NEW per `scripts/README.md` convention. Temp-tree case with a known offender; assert non-zero exit.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx tsx scripts/__tests__/verifyNoCheckpointLogging.test.ts`

**Doc-sync candidates for this chunk:**
- `docs/doc-sync.md`, note the new gate in the conventions section (already done in Chunk 11; verify here).

---

## E) Sequence diagram (text)

```
[Chunk 1: schemas + migrations + types + manifest + encryption helper + ExecutionMode]
        |
        +-> [Chunk 2: ExecutionCapability extension + docstring rename + capability CI gate]
                |
                +-> [Chunk 3: pure helpers + event registry + runtime-error classifier + event-registry CI gate]
                       |
                       +-> [Chunk 4: sandbox template git mv + sandbox primitive extension (sandboxStartKey + adoptOrStart)]
                       |
                       +-> [Chunk 5: services (profile, settings, chain-resume, cost-writer, scheduler, notifier, errors, broker extensions)]
                             |
                             +-> [Chunk 6: adapter + lifecycle + registration + pg-boss handlers + queue registration]
                                    |
                                    +-> [Chunk 7: routes + permission key + role grant + permission-coverage gate]
                                          |
                                          +-> [Chunk 8: client API helpers + shared client types]
                                                |
                                                +-> [Chunk 9: settings tab UI]
                                                |
                                                +-> [Chunk 10: TaskHeader family + Run Trace + WorkspaceBoard + modals + Connections]
                                                       |
                                                       +-> [Chunk 11: CS runbook + ADR + capabilities + architecture + doc-sync]
                                                              |
                                                              +-> [Chunk 12: checkpoint-logging CI gate + build:server smoke]
```

Chunks 9 + 10 are siblings (either can land first). Chunks 11 + 12 close the change-set.

---

## Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Per-chunk Verification commands are limited to:
- `npm run lint`
- `npm run typecheck`
- `npm run build:server` / `npm run build:client` when the chunk touches the build surface
- `npx vitest run <path-to-test>` for tests AUTHORED IN THIS CHUNK (single-file targeted execution)
- `npx tsx scripts/__tests__/<helper>.test.ts` for script-helper tests authored in this chunk (per `scripts/README.md`)

The three new CI gates (Chunks 2, 3, 12) author the gate script in this plan; CI runs them on PR open. Do NOT run `bash scripts/gates/verify-*.sh` locally to "confirm" the gate works, CI is the authoritative runner. Unit-test the gate's helper logic instead (see the `scripts/__tests__/` tests listed per chunk).

**Pre-existing violations.** No suspected pre-existing gate violations were identified during architecture pass. If CI surfaces one when the PR opens, the fix is added to the relevant chunk (most likely Chunk 1 or Chunk 5) and the chunk is re-run.

**Concurrent-branch risk.** The branch is `claude/sandbox-execution-provider-DLfjn`; latest main migration is 0326. If a concurrent migration grabs 0327 before merge, Chunk 1's migrations renumber mechanically (5 .sql + 5 .down.sql + 5 manifest pointers + Drizzle journal regeneration via `npm run db:generate`).

**Vendor codename discipline.** The string `'OpenClaw'` and the literal `'openclaw'` (case-insensitive) MUST NOT appear in any chunk's code, schema, telemetry, UI, or customer-facing copy. They appear only in:
- `infra/sandbox-templates/operator-session/Dockerfile` (vendor-specific config; the spec author selects the vendor product; preserves the existing pinned version unless explicitly bumped)
- `infra/sandbox-templates/operator-session/CURRENT_VERSION` (the pinned vendor version may carry the codename as part of the image tag)
- environment manifest entries (vendor-specific config)
- this spec / brief / plan / changelog / git history references

Chunk 12 verifies via grep before declaring done.

**Open questions surfaced for the operator before plan-gate:**

All five Rev 1 open questions were closed by chatgpt-plan-review Round 1 (F4) and are now bound by Rev 2 invariant 6 at the top of this file. No outstanding operator decisions for plan-gate.
