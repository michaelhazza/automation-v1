---
**Status:** draft
**Spec date:** 2026-05-12
**Last updated:** 2026-05-12
**Author:** spec-coordinator (Opus 4.7)
**Build slug:** `operator-backend`
---

# Spec D — Operator Backend (first concrete autonomous-operator adapter)

**Source brief:** [`tasks/builds/operator-backend/brief.md`](../../../tasks/builds/operator-backend/brief.md) (LOCKED v2.2, 2026-05-12)
**Mockup set:** [`prototypes/operator-backend/`](../../../prototypes/operator-backend/) (round 3.2, 20 prototypes)
**Predecessor specs (all merged):**
- Spec A — adapter contract: [`tasks/builds/execution-backend-adapter-contract/spec.md`](../../../tasks/builds/execution-backend-adapter-contract/spec.md) (PR #281)
- Spec B — sandbox isolation: [`tasks/builds/sandbox-isolation/spec.md`](../../../tasks/builds/sandbox-isolation/spec.md) (PR #287)
- Spec C — operator-session identity: [`docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md`](./2026-05-11-operator-session-identity-spec.md) (PR #286)
**Strategic parent:** `docs/openclaw-strategic-analysis.md` Phases 2–3; `docs/synthetos-governed-agentic-os-brief-v1.2.md` § 7, § 18.3, § 24 deliverable 7.

---

## Table of contents

1. Goals, non-goals, framing
2. What's locked from upstream
3. Domain model
   - 3.1 The adapter (`operator_managed`)
   - 3.2 Capabilities and `long_running` propagation
   - 3.3 `operator_runs` (chain-link rows)
   - 3.4 `agent_runs` state-set extension
   - 3.5 Sandbox template (`operator-session`)
   - 3.6 Credential injection (broker abstraction)
   - 3.7 Operator-session → API-key fallback
   - 3.8 Token-lifecycle handling mid-session
   - 3.9 Mid-session progress visibility
   - 3.10 Cancellation (chain-aware)
   - 3.11 Run Trace integration
   - 3.12 Per-customer cost visibility
   - 3.13 CS runbook for provider account suspension
   - 3.14 Chain-resume model
   - 3.15 Persistent browser profile per task
   - 3.16 Per-subaccount operator settings
   - 3.17 Chain-link start failure + incident emission
4. Contracts
5. File inventory lock
6. Permissions / RLS checklist
7. Execution model
8. Phase plan
9. Phase sequencing (dependency graph)
10. Execution-safety contracts
11. Deferred items
12. Testing posture
13. UI integration (mockups → code)
14. Implementation chunk plan
15. Self-consistency pass result
16. Open questions

---

## 1. Goals, non-goals, framing

### 1.1 What this spec ships

The first concrete autonomous-operator backend that consumes Spec A (adapter contract), Spec B (sandbox isolation), and Spec C (operator-session identity) end-to-end. After this lands, an operator-session subscription can drive long-form autonomous tasks inside a sandboxed runtime, with subscription-mediated cost in place of per-token API spend.

The customer-facing capability:

> Connect an operator-session subscription, run long-form autonomous tasks inside a sandboxed runtime, pay subscription-mediated cost instead of per-token API cost. Long tasks (hours to days) survive across many 120-minute chain-link sessions automatically; per-task limits are configured per subaccount.

### 1.2 Goals

- Register a new `operator_managed` execution backend implementing the Spec A contract (`dispatch`, `loadTerminalState`, `finalise`, `reconcile`, `cancel`).
- Extend `ExecutionCapability` with `'long_running'` and propagate it through every consumer (registry validation, capability-level tests, any UI/routing logic).
- Introduce `operator_runs` (chain-link state) parallel to `iee_runs`. One agent run spans 1..N chain links; `agent_runs.status = 'delegated'` holds until the **task-terminal** event.
- Introduce a chain-resume scheduler: when a chain link approaches its soft cap, the operator drives itself to a checkpoint, persists state, and a follow-up chain link resumes from the checkpoint with the persistent browser profile mounted.
- Introduce a per-subaccount **Operator** settings tab on `AdminSubaccountDetailPage` between Board Config and Usage; org-admin-edit, manager-read.
- Wire the operator-session → API-key fallback (Spec C's reserved seam) end-to-end, including mid-run credential swap, fallback stickiness across chain links, and cost-attribution boundaries.
- Bridge session-level events to the existing `agent-run` WebSocket channel; provide a polling fallback route.
- Write `source_type: 'subscription_mediated'` (one row per chain link, zero-cost) and `source_type: 'sandbox_compute'` (one row per chain link, real spend) to the cost ledger.
- Emit `operator.chain_link_start_failed` incidents via `recordIncident()` on every dispatch attempt that fails; transition the parent agent run to `paused_chain_failure` after three consecutive failures.
- Ship a CS runbook + comms templates for operator-session account suspension.
- Rename the reserved-slot docstrings in Spec A's `types.ts:54` and `registry.ts:139` from "OpenClaw forward-compat ids" to "Operator Backend forward-compat ids" as part of the same change-set.

### 1.3 Non-goals (explicit)

| Out of scope | Belongs in |
|---|---|
| ChatGPT / operator-session credential UX, plan-tier detection, Plus-tier disclosure | Spec C (shipped) |
| Sandbox vendor selection, isolation primitive, output contract | Spec B (shipped) |
| Adapter contract surface, finaliser generalisation, registry | Spec A (shipped) |
| BYO compute / customer-hosted operator workers (`operator_external` registration) | Phase 5 |
| Cross-provider session identity (Anthropic Claude.ai, Google Gemini) | Phase 3.5 (Spec C `provider` field is forward-compat) |
| Routing policy / cost-aware dispatch between Operator Backend and Native adapters | Phase 3.5 |
| "Cost savings vs API" customer-facing dashboard | Phase 3.5 |
| Streaming progress as first-class (WebSocket / SSE replacement for polling) | Phase 3.5 (polling stays V1 visibility primitive, Spec A § 19) |
| Customer self-service tier switching UI | Phase 3.5 |
| Manual checkpoint controls (user-triggered "checkpoint now") | Phase 3.5 (D12) |
| Predict-and-warn classifier for un-resumable flows at task-create time | Phase 3.5 (best-effort auto-extend is V1 policy, D7) |
| Operator session export/import to external infrastructure | Phase 5 |

### 1.4 Framing assumptions

Cross-referenced against [`docs/spec-context.md`](../../spec-context.md):

- **Pre-production, rapid evolution, no live customers yet.** Breaking changes are allowed; commit-and-revert is the rollout model.
- **No feature flags** for new behaviour modes — `operator_managed` registers unconditionally at boot.
- **No staged rollout, no migration-safety tests against live data.**
- **Testing posture: static gates primary, runtime tests pure-function only.** No new vitest harness for full flows; new pure helpers get pure unit tests authored alongside the change. CI gates cover RLS coverage, manifest entries, capability propagation, etc.
- **Prefer existing primitives.** This spec extends `incidentIngestor`, `credentialBrokerService`, `sandboxExecutionService`, `agentRunFinalizationService`, `executionBackendRegistry`, `recordIncident`, pg-boss + `createWorker`, and the existing `agent-run` WebSocket room contract. No new service layer is introduced unless reuse fails.

### 1.5 Scope class

**Major.** New subsystem (Operator Backend adapter), cross-cutting (new capability tag, new state-machine states, new tables, new settings surface, new lifecycle pipeline, new incident-emission path). Authored on Opus 4.7 per `CLAUDE.md` model guidance; chunked build executed on Sonnet against the chunk plan in § 14.


## 2. What's locked from upstream

The Operator Backend is a pure consumer of three predecessor primitives. Nothing on the foundation is in flux; this spec extends only what those specs reserved.

| Capability | Source | Shape this spec consumes |
|---|---|---|
| Adapter contract surface | [Spec A](../../../tasks/builds/execution-backend-adapter-contract/spec.md) | `dispatch`, `loadTerminalState`, `finalise`, `reconcile`, `cancel` per `server/services/executionBackends/types.ts:329-375`. `BackendTerminalState` shape per `types.ts:180-211`. |
| Capability tags | Spec A | `ExecutionCapability` union at `types.ts:86-93` (`'in_process' \| 'delegated' \| 'subprocess' \| 'browser_automation' \| 'code_execution' \| 'terminal_repo' \| 'cancellation'`); this spec adds `'long_running'`. `'session_identity'` from Spec C is declared on the adapter without being a runtime gate. |
| Orphan-task contract | Spec A § 13.1.1 | An adapter MUST write the backend task as orphaned (e.g. `status='cancelled', failureReason='parent_orphaned'`) when the parent UPDATE returns 0 rows-affected during dispatch. |
| Finaliser orchestrator | Spec A | `finaliseAgentRunFromBackend({ backendId, backendTaskId })` at `server/services/agentRunFinalizationService.ts`. Triggered by the adapter's `completedEventQueue` pg-boss event. |
| Adapter registration site | Spec A | `executionBackendRegistry.register(operatorManagedBackend)` added at `server/index.ts:687-691` alongside the existing registrations. |
| Sandbox isolation primitive | [Spec B](../../../tasks/builds/sandbox-isolation/spec.md) | `runTask(input: SandboxRunTaskInput): Promise<SandboxRunTaskOutput>` at `server/services/sandboxExecutionService.ts`. Provider resolution via `resolveSandboxProvider()`. Output contract includes vCPU-seconds, wall-clock, peak memory. |
| Cost-ledger `source_type` enum | Spec B + Spec C | `'sandbox_compute'` (writer exists, Spec B) and `'subscription_mediated'` (reserved, no writer yet, Spec C). Both declared at `server/db/schema/llmRequests.ts:43-44`. This spec ships the `'subscription_mediated'` writer. |
| Credential Broker contract | [Spec C](./2026-05-11-operator-session-identity-spec.md) | `credentialBrokerService.ts` returns `OperatorSessionEnvelope` (`credentialId`, `connectionId`, `authType: 'operator_session'`, `provider`, `planTier`, `usabilityState: 'connected_usable'`, `issuedAt`, `expiresAt`). The adapter consumes the envelope; it never inspects raw credentials. |
| `credential_mode` redacted enum | Spec C | Public surface of the broker contract: `'operator_session' \| 'api_key'`. The adapter MAY consume this enum for cost attribution, fallback stickiness, and incident payloads — it is not an auth-internal. |
| Cross-provider `provider` field | Spec C | Forward-compat for Phase 3.5 (Anthropic Claude.ai, Google Gemini). V1 the only registered value is the one ChatGPT-Plus uses; the spec does not branch on `provider`. |
| Disclosure record retrieval by `consent_record_id` | Spec C | The CS runbook (§ 3.13) retrieves the disclosure record by this id when handling suspension comms. |
| Delegation lifecycle (`agent_runs.status='delegated'`) | Existing IEE pattern (pre-A) | Parent agent run parks in `'delegated'` on first dispatch; the shared finaliser rolls up status/cost/artefacts when the **task-terminal** event fires. |
| pg-boss / `createWorker` | Existing | `server/lib/createWorker.ts` provides `boss.work<T>(queue, ..., handler)`; each queue's handler is a separate file. |
| Incident ingest | Existing | `recordIncident(input, opts?)` at `server/services/incidentIngestor.ts` is fire-and-forget; never throws; enqueues via `system-monitor-ingest`. |
| Org / subaccount RLS | Existing | `setOrgGUC(tx, orgId)` at `server/lib/orgScoping.ts`. `rlsProtectedTables` manifest at `server/config/rlsProtectedTables.ts` (shape `{ tableName, schemaFile, policyMigration, rationale }`). New tenant-scoped tables added to this manifest in the same migration that creates them. |
| WebSocket `agent-run` channel | Existing | `emitAgentRunUpdate(runId, event, data)` at `server/websocket/emitters.ts:88` broadcasts to room `agent-run:{runId}`. Visibility gated by `resolveAgentRunVisibility()`. |

> **Brief correction:** the brief references `server/middleware/orgScoping.ts`. The canonical path is `server/lib/orgScoping.ts`. All cites in this spec use the canonical path; build chunks pin against `server/lib/orgScoping.ts`.


## 3. Domain model

### 3.1 The adapter (`operator_managed`)

- **Id:** `operator_managed` (V1).
- **Forward-compat slot:** `operator_external` reserved as a type slot only — no registration in V1. Phase 5 adds it once BYO compute is on the roadmap.
- **Location:** `server/services/executionBackends/operatorManagedBackend.ts` (new file). Registered at `server/index.ts:687-691` alongside the existing five adapters.
- **Cost model:** `'subscription'` when the broker returns `authType: 'operator_session'`; `'per_token'` when it returns `'api_key'` fallback. The adapter does NOT inspect provider-specific credential shapes — those stay inside the broker. The adapter DOES branch on the broker-returned redacted `credential_mode` for three narrow purposes: credential injection (which envelope to pass to the sandbox), fallback stickiness derivation (§ 3.7 item 6), and cost attribution (§ 3.12). The `costModel` declared on the adapter object is `'subscription'`; the per-chain-link rows respect the actual `credential_mode` value.
- **Sandbox requirement:** `'code_execution'` (matches Spec B's primitive).
- **`completedEventQueue`:** `'operator-session-completed'` (pg-boss queue name).
- **`terminalStateTable`:** `'operator_runs'` (the table this spec introduces; mirrors `iee_runs`).
- **Naming discipline.** The vendor codename "OpenClaw" appears nowhere in code, schema, UI, telemetry, or customer-facing surfaces. The specific vendor product underneath is named only in vendor-specific config files (`infra/sandbox-templates/operator-session/Dockerfile`, env manifest entries). The renames listed at § 5 are applied in the same change-set.

### 3.2 Capabilities and `long_running` propagation

The adapter declares capabilities `['delegated', 'code_execution', 'long_running', 'cancellation', 'session_identity']`.

Both `'long_running'` AND `'session_identity'` are **new** in this spec — added to `ExecutionCapability` at `server/services/executionBackends/types.ts:86-93`. (`'session_identity'` was referenced by Spec C but never added to the union there; this spec adds both literals in the same edit.) Both are declared on `operator_managed`; `'long_running'` gates chain-resume behaviour, `'session_identity'` is non-gating at runtime in V1. The propagation invariant has three rules:

1. **Single source of truth.** `'long_running'` is added to the union exactly once, in `types.ts`. All consumers import the union/type — they MUST NOT redeclare or restringify the literal in non-adapter / non-fixture code.
2. **Zero ad-hoc literals in consumers.** A new CI gate (`scripts/gates/verify-execution-capability-references.sh`) greps the repo for any naked occurrence of the literal `'long_running'` outside the canonical definition. CI fails on a naked occurrence in any of: routes, services other than adapter objects, hooks, jobs, client code. **Permitted occurrences** (enumerated in the gate's allow-list):
   - The canonical definition in `server/services/executionBackends/types.ts`.
   - Adapter object declarations under `server/services/executionBackends/*.ts` (the literal is type-checked against the `ExecutionCapability` union at the declaration site — drift cannot occur silently).
   - Test fixtures / spec strings under `__tests__/` and `*.test.ts` that consume the literal as part of asserting capability behaviour.
   - Documentation, this spec, the brief, this gate's own script.
3. **Type-checker is the enforcement for adapter declarations.** Because adapter `capabilities` arrays are typed as `ExecutionCapability[]`, mistyping `'long_running'` as `'longrunning'` is a compile error. The CI gate covers the non-adapter consumer surface (routes, services, hooks, jobs, client code) where the literal would otherwise leak.

Spec author verifies via grep before declaring the capability-propagation chunk done; CI gate runs on every commit thereafter.

### 3.3 `operator_runs` (chain-link rows)

A new tenant-scoped table parallel to `iee_runs`. One row per chain link. Locked column shape:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Row id. |
| `agent_run_id` | `uuid NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT` | The parent task. |
| `organisation_id` | `uuid NOT NULL` | RLS scope. |
| `subaccount_id` | `uuid NOT NULL` | RLS scope; defence-in-depth on broker subaccount-match (§ 3.6). |
| `chain_seq` | `integer NOT NULL` | Starts at 1; increments per chain link of the task. |
| `parent_chain_link_id` | `uuid NULL REFERENCES operator_runs(id) ON DELETE SET NULL` | NULL on chain link 1. |
| `attempt_number` | `integer NOT NULL DEFAULT 1` | Per § 3.15 item 7 fresh-profile restart semantics. Bumps on each fresh-profile restart of the parent task. |
| `superseded_by_attempt` | `integer NULL` | Set to `N+1` on prior attempts of the task; the current attempt is `NULL`. |
| `image_tag` | `text NOT NULL` | Pinned per chain link per D4. |
| `vendor_session_id` | `text NULL` | Opaque vendor-side session id; surfaced in Run Trace and incidents. NULL until `dispatch()` returns it. |
| `credential_mode` | `text NOT NULL CHECK (credential_mode IN ('operator_session','api_key'))` | Mode for this chain link; sticky per § 3.7 item 6. |
| `status` | `text NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled'))` | Chain-link lifecycle. |
| `failure_reason` | `text NULL` | Closed set; see § 4.7 / § 10.7. |
| `failed_mid_step` | `boolean NOT NULL DEFAULT false` | Sub-flag set when a `failed` chain link hit hard cap (soft + grace) without reaching a checkpoint-safe state (§ 3.14, D7). |
| `started_at` | `timestamptz NULL` | NULL until the sandbox session begins. |
| `completed_at` | `timestamptz NULL` | Wall-clock terminal time. |
| `event_emitted_at` | `timestamptz NULL` | Set non-null after the pg-boss `operator-session-completed` event is emitted (Spec A pattern). |
| `cost_subscription_mediated_cents` | `integer NOT NULL DEFAULT 0` | Always 0 in V1; reserved for future. |
| `cost_sandbox_compute_cents` | `integer NOT NULL DEFAULT 0` | Mirror of the ledger value for cheap reads; ledger is the source of truth. |
| `step_count` | `integer NOT NULL DEFAULT 0` | Operator turns within this chain link. |
| `last_progress_at` | `timestamptz NULL` | Updated on every step boundary; heartbeat-stale backstop reference. |
| `settings_snapshot` | `jsonb NOT NULL` | Effective `subaccount_operator_settings` values captured at dispatch time. All in-flight cap enforcement (soft cap, grace window, budget cap, max chain length, max wall-clock, concurrency cap) reads this snapshot — NOT the current settings row. Shape: the same six fields enumerated in § 3.16. |
| `cancel_requested_at` | `timestamptz NULL` | Set by task-level cancellation path (§ 3.10 step 1). The operator runtime checks `cancel_requested_at IS NOT NULL` at each step boundary. |
| `cancel_requested_by_user_id` | `uuid NULL REFERENCES users(id)` | Audit: who issued the cancel. NULL until cancellation is requested. |
| `checkpoint_payload` | `jsonb NULL` | Encrypted-at-rest where existing infra supports it (per § 3.14 item 10). NULL until a checkpoint-safe state is reached. |
| `profile_volume_id` | `text NULL` | Pointer (not raw filesystem path) to the persistent browser profile volume; FK semantics tracked in `operator_task_profiles` (§ 3.15). |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Audit. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Audit. |

**Indexes:**

- `(agent_run_id, attempt_number, chain_seq)` UNIQUE — at most one chain link per `(task, attempt, seq)`. `chain_seq` restarts at 1 for each `attempt_number` (per § 3.15 item 7 fresh-profile restart semantics).
- `(organisation_id, subaccount_id, status)` — common dashboard query.
- `(status, last_progress_at)` partial WHERE `status = 'running'` — heartbeat-stale reconcile scan.

**RLS policy:** standard org+subaccount scoping; see § 6. `FORCE ROW LEVEL SECURITY` enabled to defeat owner-bypass.

**Manifest entry** in `server/config/rlsProtectedTables.ts` added in the same implementation chunk/commit as the migration (the manifest is a TypeScript module; `policyMigration` points at the SQL migration file).

### 3.4 `agent_runs` state-set extension

The parent task's status enum extends to include the new task-level states. The closed set after this spec:

```
'pending' | 'running' | 'delegated' |
'paused_for_chain_continuation' | 'paused_chain_failure' | 'paused_budget_exceeded' |
'completed' | 'failed' | 'cancelled'
```

`'pending'`, `'running'`, `'delegated'`, `'completed'`, `'failed'`, `'cancelled'` already exist. **New** in this spec:
- `'paused_for_chain_continuation'` — scheduler-owned wait OR FIFO queue for next chain dispatch (§ 3.14, § 3.17).
- `'paused_chain_failure'` — three consecutive dispatch failures (§ 3.17 item 1) OR a running chain link terminating with `failed_mid_step=true` from hard-cap unresumable (§ 3.14 item 3). Hard-cap unresumable counts in the same consecutive-failure budget as dispatch failures.
- `'paused_budget_exceeded'` — task paused because a time-budget guard fired. Covers both per-task budget cap (§ 3.17 item 4) and max wall-clock per task (§ 3.14 item 4); `failure_reason` distinguishes (`'budget_cap_exceeded'` vs `'max_wall_clock_exceeded'`).

**Task-terminal states are `completed | failed | cancelled` only.** The three `paused_*` states are resumable/non-terminal — they emit task-state-change events (UI updates, user notifications, scheduler suspension) but DO NOT trigger terminal artefact/cost finalisation. Cost rows for chain links that completed before the pause are written normally per § 3.12. The customer-visible terminal rollup is reserved for the true terminal states. Downstream consumers (cost dashboards, audit, evals) MUST NOT treat partial/pause-state rollups as final. See § 10.4 for the terminal-event guarantee.

A migration extends the existing `agent_runs.status` CHECK constraint (or text-typed allow-list, whichever the current schema uses). The migration is forward-compatible — existing status values are unchanged.

The same migration adds a new column `operator_chain_failure_count integer NOT NULL DEFAULT 0` to `agent_runs`. It counts **consecutive** chain-link dispatch failures since the last successful dispatch (per § 7.3 item 5). The chain-link dispatcher is the sole writer:

- Increment under `UPDATE agent_runs SET operator_chain_failure_count = operator_chain_failure_count + 1 WHERE id = $1 AND status IN ('delegated','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded')`. The dispatcher's queued-job reason gate (§ 7.3 step 2) ensures retries from paused states are only counted when the queued reason matches the current paused-state resume action.
- Reset to 0 on (a) a successful chain-link dispatch and (b) a user-initiated retry (the `task.operator.chain_failure_retried` audit event path).

**State machine — `agent_runs` task lifecycle (operator-managed paths only):**

```
pending → delegated  (on first chain-link dispatch)
delegated → paused_for_chain_continuation  (on chain-link checkpoint terminal)
paused_for_chain_continuation → delegated  (on next chain-link dispatch)
delegated → paused_chain_failure  (on 3rd consecutive chain-link start failure)
paused_chain_failure → delegated  (on user-initiated retry)
delegated → paused_budget_exceeded  (on per-task budget cap hit)
paused_budget_exceeded → delegated  (on user budget extension)
delegated → completed | failed  (on task-terminal event from final chain link)
{pending | delegated | paused_*} → cancelled  (on user cancel)
```

Forbidden: any transition from a terminal state. Forbidden: `pending → completed` (a task MUST be delegated before terminating). The forbidden transitions are enforced by an optimistic predicate in the writer (see § 10.3).

### 3.5 Sandbox template (`operator-session`)

- **Template path:** `infra/sandbox-templates/operator-session/`. Single source of truth for both e2b (template) and `docker-compose` (local dev).
- **Rename from `openclaw-session`.** The current branch already carries `infra/sandbox-templates/openclaw-session/`. This spec renames that directory to `operator-session` in the same change-set. Files renamed: `Dockerfile`, `entrypoint.sh`, `README.md`, `CURRENT_VERSION`. Image-tag references in `operator_runs.image_tag`, the CI publish job (`.github/workflows/publish-sandbox-templates.yml`), and any docker-compose service name are updated. Git history preserves the rename via `git mv`.
- **Image contents.** The vendor operator runtime (pinned version), the model-invocation CLI it ships with, runtime dependencies. The spec author pins the specific vendor product and version inside the Dockerfile; the codename is local to this file only.
- **Vendor preservation across the rename.** The V1 Dockerfile MUST preserve the existing `openclaw-session` template's vendor runtime and pinned version unchanged during the rename to `operator-session`. Any version change requires a separate spec amendment (the runtime APIs the adapter binds to and the error-classification set in `operatorRuntimeErrors.ts` are load-bearing on this version). The rename is a path-only change.
- **CI rebuild.** Reuses Spec B's image-build pipeline. Republishes when the Dockerfile or pinned vendor version changes.
- **Pinned per chain link.** `operator_runs.image_tag` records the specific image used. In-flight chain links complete on their original image when the vendor releases a new version; only new chain links get the new image. **In particular: a single task's chain links can run on different image tags** (link 1 on tag `v1.4.2`, link 17 on tag `v1.5.0` after a republish). The cost ledger and Run Trace record the image tag per chain link.
- **Mount points.** The persistent browser profile volume (§ 3.15) mounts at the browser's `user-data-dir` path on chain-link start. The Spec B sandbox isolation policy applies — adapter MUST assert task-subaccount matches credential-subaccount before mounting.
### 3.6 Credential injection (broker abstraction)

- Adapter calls `credentialBrokerService.requestOperatorSessionCredential({ subaccountId, agentRunId })` at chain-link start.
- The broker returns an `OperatorSessionEnvelope` (Spec C contract) when usable, OR signals "unavailable" via the contract's existing failure mode. Raw tokens never leave the broker.
- **Subaccount-match assertion (defence in depth).** Before injection, the adapter asserts the returned credential's subaccount matches the `agent_runs.subaccount_id` AND `operator_runs.subaccount_id`. Mismatch is a hard fail with typed error `OPERATOR_SUBACCOUNT_MISMATCH`; chain-link status `failed`; incident emitted via `recordIncident()` with `failure_class: 'permanent'` (not a transient — points to a broker bug or a config drift, not a network hiccup).
- **What flows into the sandbox.** Only the redacted envelope's `credentialId` reference + the minimal start-time injection the operator runtime needs. The adapter MUST NOT log, persist, or print envelope contents in app logs.
- **What the adapter MAY consume from the envelope.** The redacted `authType` (which it maps 1:1 to `credential_mode`), the `planTier` (for cost-attribution context only), and the `usabilityState` (which is asserted to be `'connected_usable'` before injection; any other state is a hard fail with typed error `OPERATOR_SESSION_NOT_USABLE`). The adapter MUST NOT inspect `provider`-specific shapes — those live inside the broker.

### 3.7 Operator-session → API-key fallback

The single biggest production-readiness item. Without it, a rate-limit or suspension mid-run is a silent failure or a hard error with no graceful path.

1. **Failure detection — closed signal set.** The operator runtime + CLI surface errors classified by the adapter as `session_unavailable` when ANY of:
   - HTTP `401`/`403` with provider-specific bodies indicating revocation/suspension/scope-stripped (concrete patterns enumerated in `operatorRuntimeErrors.ts`).
   - HTTP `429` with `Retry-After` ≥ 60s OR the provider's "session suspended" payload.
   - Broker refresh failure with `expired_refresh_token | provider_revoked | insufficient_scope` (Spec C classifications).
   - Connection-level errors > 3 consecutive retries against the operator runtime.

2. **Fallback resolution.** Adapter calls `credentialBrokerService.resolveFallback({ subaccountId, agentRunId, originalCredentialId })`. The broker returns `{ envelope: OperatorSessionEnvelope | ApiKeyEnvelope, mode: 'operator_session' | 'api_key' } | null`.

   `ApiKeyEnvelope` is declared in `server/services/credentialBrokerService.ts` with shape `{ credentialId: string, connectionId: string, authType: 'api_key', provider: string, issuedAt: string, expiresAt: string | null }`. Raw API key material remains broker-internal and never leaves the broker — the adapter consumes the envelope reference (`credentialId`) only, mirroring the `OperatorSessionEnvelope` discipline. (Spec C reserved this seam; the spec author wires the broker side in the same chunk that wires the adapter side.)

3. **Mid-run credential swap.** When fallback exists, the adapter:
   - Pauses the operator runtime via its in-band pause signal (vendor-specific; concrete API named in the implementation chunk).
   - Hot-swaps credentials inside the running sandbox via the same injection seam used at chain-link start.
   - Resumes; retries the failing turn once.
   - Emits `operator-session.fallback_engaged` lifecycle event (§ 4.7) with `chain_link_id`, `from_mode: 'operator_session'`, `to_mode: 'api_key'`, `reason: <failure-class>`, `step_index`.
   - Sets `operator_runs.credential_mode = 'api_key'` for the remainder of this chain link.

4. **Hard-fail path.** If fallback resolution returns `null`, the chain link fails with typed error `OPERATOR_SESSION_UNAVAILABLE`. The chain-link row is written `status='failed', failure_reason='OPERATOR_SESSION_UNAVAILABLE'`. The customer sees the modal `r9-modal-operator-unavailable.html` pattern surfaced over the existing task surface (canonical component path chosen by the implementation chunk).

5. **Cost-ledger semantics on mid-run swap.** The same chain link may produce **two** cost rows of the `credential_mode` boundary type: one `subscription_mediated` row for the pre-swap turns (`step_count` = turns up to swap) and one `per_token` row via the normal `llm_requests` path for the post-swap turns. Spec § 3.12 enumerates the attribution rules in full.

6. **Fallback stickiness across chain links — derivation rule.** Stickiness is NOT stored as a separate column. It is derived at chain-link dispatch time from existing state:
   - Read the latest non-superseded `operator_runs` row for the task (highest `chain_seq` where `attempt_number = current_attempt_number` AND `superseded_by_attempt IS NULL`).
   - Compute the row's **link-boundary timestamp** as `coalesce(event_emitted_at, completed_at, started_at)`. (`event_emitted_at` is NULL until the finaliser stamps it; `completed_at` and `started_at` are progressively earlier-set anchors that survive partial finaliser failures.)
   - If that row's `credential_mode = 'api_key'` AND no `operator-session.usability_restored` event has fired since the link-boundary timestamp for the same `agent_run_id` AND no `task.operator.credential_refreshed` audit event has fired since the link-boundary timestamp → stickiness applies; chain link N+1 starts with `credential_mode = 'api_key'`.
   - Otherwise stickiness clears; chain link N+1 starts with the normal `operator_session` resolution.
   Both clearing signals (`operator-session.usability_restored` and `task.operator.credential_refreshed`) are looked up by querying the existing event/audit stores (already RLS-scoped to the task). Run Trace renders the `fallback_engaged` event once at the chain-link boundary where it first applied; subsequent chain links inheriting fallback show a passive `credential_mode: api_key` indicator without re-emitting the lifecycle event. The pure helper that implements the derivation lives in `operatorManagedBackendPure.ts` (§ 5.1) and is unit-tested per § 12.

### 3.8 Token-lifecycle handling mid-session

- Adapter proactively triggers `credentialBrokerService.refresh({ credentialId })` at `expiresAt - REFRESH_LEAD_TIME_MS` (default 60s; configured via env, not per-subaccount).
- If a token expires mid-LLM-call inside the sandbox: the operator runtime surfaces a typed `auth_expired` signal; adapter triggers refresh, swaps the credential in-band, retries the failing turn once.
- If refresh fails with `expired_refresh_token | provider_revoked | insufficient_scope` (Spec C classifications): the broker marks the credential `revoked`; adapter routes through § 3.7 fallback resolution.
- Refresh failures are typed lifecycle events `operator-session.refresh_failed` (§ 4.7) but are NOT incidents on their own — only the resulting chain-link-start-failure (§ 3.17) triggers an incident if the failure is not recovered by fallback.

### 3.9 Mid-session progress visibility

Two layers, mirroring the existing IEE pattern:

- **Session-level events (push).** Operator runtime step boundaries surface to the adapter; the adapter:
  1. Enqueues a `'operator-session-progressed'` pg-boss event payload `{ runId, chainLinkId, stepIndex, summary, timestamp }` with idempotency key `(operator_run_id, step_index)` (per § 10.1). The adapter does NOT mutate `operator_runs.last_progress_at` or `step_count` directly.
  2. The pg-boss handler (`operatorSessionProgressedHandler.ts`) is the SOLE writer for `last_progress_at` and `step_count` (see § 7.4 for the exact SQL with NULL-safety and the `status='running'` post-terminal guard).
  3. The handler then bridges to the WebSocket `agent-run:{runId}` room via `emitAgentRunUpdate(runId, 'operator-session.progressed', payload)`.

- **Polling fallback (pull).** `GET /api/operator-sessions/:operatorRunId/progress` returns the latest progress snapshot from the `operator_runs` row. Route mirrors `server/routes/iee.ts:GET /api/iee/runs/:ieeRunId/progress`. Same auth gates: `authenticate`, `requirePermission('AGENT_RUN_READ')`, subaccount scoping via `getOrgScopedDb()`.

The polling route exists because (a) the WebSocket bridge can be down without the run being broken, and (b) some agent-run consumers don't keep a socket open. The brief is explicit that V1 keeps polling as the visibility primitive; streaming progress is deferred to Phase 3.5.

### 3.10 Cancellation (chain-aware)

The adapter declares `'cancellation'` capability. Spec A's contract gives one method: `cancel({ runId, backendTaskId })`. The Operator Backend's implementation order at the **chain-link level**:

1. **Operator runtime native hook.** If the runtime exposes a cancel endpoint (vendor-specific), the adapter calls it first.
2. **Per-step-boundary check.** Adapter sets `operator_runs.cancel_requested_at = now()` and `cancel_requested_by_user_id = $actor` (§ 3.3); the operator runtime polls these fields at each step boundary and exits cleanly when `cancel_requested_at IS NOT NULL`.
3. **Heartbeat-stale backstop.** Spec A's shared reconcile loop catches chain links stuck in `running` with `last_progress_at` older than `HEARTBEAT_STALE_MS` (default 5 minutes) and marks them `failed` with `failure_reason='heartbeat_stale'`.

**Task-level cancellation semantics** are chain-aware. When a user cancels a task:

1. **Cancel the active chain link** — writes `operator_runs.status = 'cancelled'` (only if currently `'pending' | 'running'`; otherwise no-op).
2. **Drain queued chain-continuation jobs** — remove FIFO-queued continuation entries (§ 3.17 item 5) for this task from the scheduler queue. Atomic with step 3.
3. **Prevent further chain dispatch** — set `agent_runs.status = 'cancelled'` via the optimistic predicate `UPDATE agent_runs SET status='cancelled' WHERE id = $1 AND status IN ('delegated','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded','pending')`. 0 rows-affected means the task is already in a terminal state; return `409` with the current state.
4. **Emit the task-terminal event** — `operator-session.task_cancelled` (§ 4.7). The finaliser performs full rollup.
5. **Schedule profile retention/GC** — set `operator_task_profiles.scheduled_gc_at = now() + INTERVAL '48 hours'` per § 3.15 item 4 (default retention).

Cancellation from a paused state follows the same task-level path: drain scheduler state, mark `agent_runs.status='cancelled'`, fire task-terminal event, schedule profile GC.

**Concurrency guard.** Steps 1, 2, 3 happen inside one `withOrgTx`-scoped transaction. If two concurrent cancels race, the first writes `status='cancelled'`; the second sees 0 rows-affected on step 3 and returns `409` to the losing caller. No double-emit of the terminal event.
### 3.11 Run Trace integration

The adapter MUST emit Run Trace events for: session start, credential injected (auth-type redacted), each step boundary, fallback engaged (if any), chain-link terminal status, artefact harvest, task-terminal status (final chain link only).

Reuses the virtual-view Run Trace contract from the SynthetOS foundation refactor. New event-type families:

- `operator-session.*` (lifecycle): see § 4.7.
- `operator.*` (incidents, audit, system): see § 4.8, § 4.9.

**Chain-link merged view.** Run Trace renders the chain as a single merged timeline with `chain link N starts` dividers (per mockup `r17-runtrace-chain-link-divider.html`). The renderer changes are scoped to `client/src/pages/operate/components/RunTraceEventRenderer.tsx` — a new `<ChainLinkDivider>` element inserts between events belonging to different `chain_seq` values.

**Attempt grouping.** When a task has `attempt_number > 1` (fresh-profile restart per § 3.15 item 7), Run Trace renders attempts as **top-level groups** above the chain-link structure. Superseded attempts are collapsed by default; the current attempt is the default-expanded view. The merged-timeline view above spans only the current attempt; cross-attempt comparison is a separate (future) view.

**Sensitive content.** Checkpoint payloads (page URLs, screenshots) are NOT rendered in Run Trace by default — they live in `operator_runs.checkpoint_payload` and surface only through the harvested-artefact path (§ 3.12) when promoted. See § 3.14 item 10 for the full policy.

### 3.12 Per-customer cost visibility

Even when LLM cost is zero (subscription-prepaid), sandbox compute is real spend. The adapter writes to the cost ledger:

**A. Sandbox compute (real spend, every chain link).**

One `source_type: 'sandbox_compute'` row per chain link / sandbox session. Inputs taken from Spec B's `SandboxRunTaskOutput`: `vCPUSeconds`, `wallClockMs`, `peakMemoryBytes`. Cost is computed by the existing sandbox-compute pricing function (Spec B). The ledger row carries the chain link's `operator_run_id` and is joined to the parent task at read time via `agent_run_id`.

**B. Subscription-mediated (zero-cost accounting, per chain link).**

One `source_type: 'subscription_mediated'` row per chain link where the chain link **started under** `credential_mode = 'operator_session'` (even if a mid-run fallback later switched the row's final `credential_mode` to `'api_key'`). The cost-writer derives eligibility from: (a) the chain link's START mode (preserved via the row's `started_at` snapshot semantics — see below), OR equivalently (b) the presence of a `fallback_engaged` event with `from_mode='operator_session'` for this chain link. The final `operator_runs.credential_mode` value is NOT the trigger.

Implementation note: the writer queries the lifecycle event store for `operator-session.fallback_engaged` for this `operator_run_id`; presence of such an event means the chain link DID start with `operator_session` regardless of the final column value, and `subscription_mediated` writes the pre-swap portion (`step_count` = `fallback_engaged.step_index`, by the cost-writer pure helper).

Row carries:

| Field | Value |
|---|---|
| `source_type` | `'subscription_mediated'` |
| `cost_cents` | `0` |
| `agent_run_id` | parent task |
| `operator_run_id` | chain-link id |
| `chain_seq` | chain-link sequence number |
| `vendor_session_id` | the opaque vendor session id (audit) |
| `credential_mode` | `'operator_session'` |
| `step_count` | turns within this chain link |
| `plan_tier` | from the broker envelope (audit context) |

**C. Per-token (mid-run swap or fully-fallback chain link).**

When fallback engages mid-chain-link: turns BEFORE the swap → counted in the chain link's `subscription_mediated` row (with `step_count` reflecting only the pre-swap turns); turns AFTER the swap → flow through the normal `llm_requests` writer with `source_type: 'per_token'`. The boundary is recorded in the `operator-session.fallback_engaged` event payload.

When a full chain link runs under fallback (`credential_mode = 'api_key'` from chain-link start): NO `subscription_mediated` row is written; only `per_token` rows via `llm_requests`. The `sandbox_compute` row is still written.

**Aggregation:** dashboards use the existing usage views. The `(agent_run_id, source_type)` index on `llm_requests` (or equivalent) supports the rollup. **No new dashboard is built in V1** — data must be queryable from existing usage views.

**Idempotency posture (per § 10.1):**

- The `subscription_mediated` and `sandbox_compute` chain-link-summary writers are **key-based idempotent** on `(operator_run_id, source_type, boundary)`. Boundary key for `subscription_mediated` is `(operator_run_id, 'subscription_mediated', 'chain_link')`; for `sandbox_compute`: `(operator_run_id, 'sandbox_compute', 'chain_link')`. Many turns may occur within a chain link, but the cost writer emits exactly ONE summary row per `(operator_run_id, source_type)`.
- `per_token` rows (one per LLM call, potentially many per chain link) retain the existing `(agent_run_id, request_id)` idempotency from the LLM-request writer. The new `operator_run_id` column on `llm_requests` is nullable attribution only — it does NOT participate in the per-token row's idempotency key.

A retry after partial commit MUST NOT double-write. The chain-link summary writers are invoked exactly once per chain-link terminal event via the finaliser hook (Spec A pattern), not from the adapter's hot path.

**Concurrency guard (per § 10.3):** the cost-writer holds an advisory lock on `(operator_run_id)` for the duration of the rollup transaction. Two concurrent finalises (rare; only possible if the pg-boss event handler retries before idempotency catches it) cannot interleave row writes.

### 3.13 CS runbook for provider account suspension

Per Spec C Decision 3 risk #1: the customer will blame SynthetOS regardless of what they signed at opt-in. Before the first Plus-tier opt-in customer hits a suspension:

- **Runbook.** `docs/runbooks/operator-session-account-suspension.md`. Authored in this spec change-set. Sections:
  1. What "operator-session suspended" means (one paragraph, plain English).
  2. How the system detects suspension (the §3.7 closed signal set).
  3. The automatic notification chain (incident → CS notification → assigned user inbox + admin notification).
  4. How to retrieve the disclosure record by `consent_record_id` (Spec C).
  5. Comms templates (apology, fact-based, with disclosure link).
  6. Customer's options (reconnect, add fallback API key, cancel ongoing tasks).
  7. Escalation tree.

- **Comms templates.** `docs/runbooks/templates/operator-session-suspension-customer-email.md`, `.../in-app-message.md`. Plain English; refers to the disclosure record without legal jargon.

- **Automatic detection.** The §3.7 fallback path emits a typed `system-monitor` notification on the first `OPERATOR_SESSION_UNAVAILABLE` hit AND on `usability_state` flipping from `'connected_usable'` to anything else (broker-side change). The CS notification is the typed event `cs.operator_session.suspended_detected` produced by `notifyOperatorSessionSuspended()` (`server/services/operatorSessionSuspensionNotifier.ts`, § 5.1) and consumed by the existing inbox pipeline — no new pipeline component is introduced.

Small artefact (one-pager + comms templates + the typed CS notification wiring) but it blocks first Plus-tier onboarding. Belongs in this change-set, not deferred — the moment the adapter ships to a Plus-tier customer, the runbook is on the critical path.
### 3.14 Chain-resume model

A single operator task spans many 120-min chain-link sessions. Each session is a "chain link." When the soft cap approaches, the operator drives itself to a checkpoint, persists state, and the session ends. A scheduler picks up the task and dispatches the next chain link, which resumes from the checkpoint. The user sees one task progressing, not many separate runs.

1. **Chain-link data model.** Locked in § 3.3. `chain_seq` starts at 1; `parent_chain_link_id` FKs to the prior chain link; `checkpoint_payload` JSONB holds (or points to) the resume state.

2. **Checkpoint contents (minimum).** § 4.6 pins the JSONB shape. Required fields: `original_task_brief_ref`, `conversation_history_pointer` (artefact-store reference, not inline blob), `current_page_url`, `last_action_summary`, `next_planned_step`, `last_state_screenshot_artefact_id` (pointer; the screenshot lives in the artefact store).

3. **Soft cap + auto-extend.**
   - Soft cap = `subaccount_operator_settings.session_soft_cap_minutes` (default 120, range 30–240, per § 3.16).
   - At `T - 10 min`, the operator emits a `'preparing_checkpoint'` step-state signal. The adapter enqueues an `operator-session-progressed` event with the step-state `preparing_checkpoint`; per § 3.9 / § 7.4, `operatorSessionProgressedHandler.ts` is the sole writer for `last_progress_at` and `step_count`. The handler bridges the state to the WebSocket room.
   - **`is_resumable_now` emission contract.** The operator runtime MUST emit `is_resumable_now` as a boolean field in the checkpoint step-state payload consumed by `operatorManagedBackend.dispatch()` (the payload shape is the same step-state envelope used for progress events; the build chunk pins the exact vendor field). Absent or malformed values are treated as `false` and the chain link is logged with `failure_reason='checkpoint_signal_invalid'`.
   - If at the soft cap the operator's `is_resumable_now` boolean is `true`, the chain link terminates `'completed'` with `checkpoint_payload` non-null.
   - If `is_resumable_now` is `false` at the soft cap, the adapter auto-extends up to `subaccount_operator_settings.auto_extend_grace_minutes` (default 30, range 0–60, per § 3.16).
   - At soft-cap + grace, the chain link terminates `'failed'` with `failure_reason='hard_cap_unresumable'` and `failed_mid_step=true`. The task transitions IMMEDIATELY to `paused_chain_failure` — this is a single-event pause, NOT a 3-failure threshold. The "three consecutive failures" threshold in § 3.17 item 1 applies only to chain-link START failures (`pending`-state failures). Hard-cap unresumable increments `operator_chain_failure_count` for diagnostic visibility only; it does NOT need three occurrences to trigger the pause. Recovery (user-initiated retry from `paused_chain_failure`) resets the counter.

4. **Chain-link dispatch.** End of chain link N writes `checkpoint_payload` and emits `'operator-session-completed'` (the standard adapter terminal event, with status `'completed'` and a non-null `checkpoint_payload` field — distinct from the task-terminal `'completed'`). The finaliser handler distinguishes (branches evaluated in order; first match wins):
   - `completed` with non-null `checkpoint_payload` AND consumed-budget-minutes ≥ pinned `settings_snapshot.per_task_budget_cap_minutes` → task transitions to `'paused_budget_exceeded'`; do NOT enqueue the next chain link.
   - `completed` with non-null `checkpoint_payload` AND (`now() - first_operator_run.started_at`) ≥ pinned `settings_snapshot.max_wall_clock_per_task_days` → task transitions to `'paused_budget_exceeded'` with `failure_reason='max_wall_clock_exceeded'`; do NOT enqueue the next chain link.
   - `completed` with non-null `checkpoint_payload` AND the parent task is at max chain length (`chain_seq >= settings_snapshot.max_chain_length`) → task-terminal `'failed'` with `failure_reason='max_chain_length_reached'` (rolls up to `agent_runs.status='failed'`).
   - `completed` with non-null `checkpoint_payload` (none of the above caps tripped) → dispatch next chain link via the `'operator-session-dispatch-next-chain-link'` queue.
   - `completed` with NULL `checkpoint_payload` AND `is_resumable_now=true` on the last step AND task scope reports "done" → task-terminal `'completed'`. (The operator runtime emits a `'task_completed'` step-state when the task is genuinely done; that signal sets the writer to NULL checkpoint and triggers task termination.)
   - `failed` with `failed_mid_step=true` → task transitions to `paused_chain_failure`; user must retry or cancel.
   - `failed` with `failed_mid_step=false` → propagate task-terminal `'failed'` (operator runtime hard error, e.g. crash).
   - `cancelled` → propagate task-terminal `'cancelled'`.

5. **Resume payload.** Chain link N+1 starts with: the original task brief, the accumulated conversation-history pointer, the checkpoint from chain link N, and the persistent browser profile (§ 3.15) mounted. The operator's first action is to verify it's on the expected page and continue from the `next_planned_step`.

6. **Conversation history accumulation.** Per-chain-link blobs joined at read time, capped at last N chain links of context for the operator-model invocation. Concretely: each chain link writes a single artefact `operator-conversation-link-{operator_run_id}.json` to the existing artefact store. The artefact's MIME type is `application/vnd.synthetos.operator-conversation-link+json;version=1` and its shape is the Zod schema `OperatorConversationLinkArtefact` declared in `shared/types/operatorConversationArtefact.ts` (a new file, § 5.1). The resume payload composer reads the latest K (default 5) artefacts and concatenates them in chain order. K is a constant in `operatorConversationHistoryPure.ts`; not configurable per-subaccount in V1.

7. **Terminal states + failure classification (runtime vs start vs hard-cap).**
   - **Runtime failure (hard error)** — chain link is in state `'running'` at the time of failure due to an operator-runtime crash, heartbeat-stale, or unrecoverable error that does NOT match the hard-cap-unresumable signal → terminates the **task** with the chain link's failure reason (`agent_runs.status='failed'`). Remaining chain dispatch does NOT happen.
   - **Hard-cap unresumable** (a specific running-state failure where soft-cap + grace elapsed without a checkpoint-safe state) is routed per § 3.14 item 3: chain link `'failed'` + `failed_mid_step=true`, task `paused_chain_failure`. It is NOT a hard runtime failure for the purposes of this classification.
   - **Start failure** — chain link is in state `'pending'` at the time of failure (dispatch-time, before the chain link has begun running) → § 3.17 retry/pause semantics apply (backoff retry then `paused_chain_failure`), NOT immediate task termination.
   - The state-machine boundary is at `pending → running`. The transition timestamp is `operator_runs.started_at` (set by the adapter immediately after the sandbox session is created and the credential is injected).

8. **Run Trace.** Merged timeline with `chain link N starts` dividers (§ 3.11). The virtual-view contract spans chain links via the `agent_run_id` join.

9. **TaskHeader status.** Mockup `r14-taskheader-chain-link-status.html`. Three variants:
   - Known estimate (after first handoff): `"link N of ~M, T hrs elapsed"`. `~M` is computed as `min(max_chain_length, max(N+2, ceil(estimated_total_steps / avg_steps_per_link)))` and refreshes per chain link.
   - Unknown estimate (before first handoff): `"link N of —"`. Tooltip explains "estimate available after the first chain handoff completes."
   - Terminal: `"{N} sessions, {H}h {M}m total"`.

10. **Checkpoint-payload security.** Checkpoint payloads are sensitive task artefacts and MUST be:
    - **Encrypted at rest** where existing artefact infrastructure supports it. Concretely: the JSONB column is written via the existing app-level encryption helper (the same helper used by `agent_run_payloads`'s redaction pipeline). The tentative file is `server/services/agentRunPayloadEncryptionService.ts` exporting `encryptAgentRunPayloadJson(value): Promise<EncryptedJson>` and `decryptAgentRunPayloadJson(value): Promise<unknown>`. If the in-tree names differ, Chunk 1 (or the chunk that first touches the checkpoint writer) MUST update this spec before implementation.
    - **Scoped by org/subaccount/task.** The RLS policy on `operator_runs` enforces org+subaccount; the `task_id` (= `agent_run_id`) is implicit via the FK.
    - **Excluded from broad logs.** The adapter MUST NOT log `checkpoint_payload` contents at any log level. A grep gate (`scripts/gates/verify-no-checkpoint-logging.sh`) bans naive log calls referencing the column.
    - **Redacted in Run Trace by default.** The embedded screenshot is treated as an INTERNAL recovery artefact, not customer-visible. Customer-facing screenshots flow only through the harvested-artefact path (§ 3.12 / artefact harvester).

### 3.15 Persistent browser profile per task

Smooth chain handoff requires browser state (cookies, login session, local storage) to survive across chain links. Without this, every chain link starts cold, must replay credentials, and breaks on MFA.

1. **Profile storage — new table `operator_task_profiles`.**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `task_id` | `uuid NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT` | One profile per task. |
| `organisation_id` | `uuid NOT NULL` | RLS scope. |
| `subaccount_id` | `uuid NOT NULL` | RLS scope. |
| `attempt_number` | `integer NOT NULL DEFAULT 1` | Bumps on fresh-profile restart (§ 3.15 item 7). |
| `volume_id` | `text NOT NULL` | Sandbox-volume id (opaque pointer; safe to log). |
| `size_bytes` | `bigint NOT NULL DEFAULT 0` | Updated on each chain link end. |
| `size_cap_bytes` | `bigint NOT NULL DEFAULT 524288000` | 500 MB default per § 3.15 item 3. |
| `status` | `text NOT NULL CHECK (status IN ('active','scheduled_gc','gc_in_progress','gc_done'))` | Lifecycle. |
| `scheduled_gc_at` | `timestamptz NULL` | Set to `task_terminal_at + retention_window`. |
| `gc_started_at` | `timestamptz NULL` | Set on transition to `'gc_in_progress'`; cleared on transition to `'gc_done'`. The GC handler reclaims stale `'gc_in_progress'` rows (`gc_started_at < now() - INTERVAL '30 minutes'`) per § 7.5. |
| `debug_retention_extended_by` | `uuid NULL REFERENCES users(id)` | Set when admin extends retention to 14 days. |
| `debug_retention_extended_at` | `timestamptz NULL` | Audit. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

Unique constraint: `(task_id, attempt_number)`.

2. **Profile mount.** The `operator-session` Docker template mounts the volume at the browser's `user-data-dir` path on chain-link start. Mount instruction is part of the template's `entrypoint.sh`.

3. **Profile size cap.** Default 500 MB per task. Enforced by:
   - Disk-usage check before chain-link start (adapter reads `size_bytes`; if `size_bytes >= size_cap_bytes`, chain link fails with `failure_reason='profile_size_cap_exceeded'`).
   - Docker volume quota (template-level, set in entrypoint).
   Cap is a system constant, NOT per-subaccount in V1.

4. **Profile lifecycle + retention.** Volume is created on first chain-link start (`status='active'`). Persists across chain links. After task-terminal: `status='scheduled_gc', scheduled_gc_at = now() + INTERVAL '48 hours'` (default). An admin (`org_admin`) may set `debug_retention_extended_by/_at` at task-terminal time, which extends `scheduled_gc_at` to `now() + INTERVAL '14 days'` for that task. Customer-visible artefacts (per § 3.12) are harvested into the artefact store BEFORE the volume is GC'd, regardless of retention window. A pg-boss cron job (`operator-task-profile-gc`, every 15 minutes) marks profiles `status='gc_in_progress'` when `now() >= scheduled_gc_at`, performs the volume delete via the sandbox provider, then sets `status='gc_done'`. Hard max lifetime including retention = `max_wall_clock_per_task_days` + 14 days.

5. **Profile permissions.** Volume access scoped to chain links of the owning task by Spec B's sandbox isolation primitive. The adapter MUST assert `task.subaccount_id == credential.subaccount_id == profile.subaccount_id` before mounting (defence in depth, three-way check). Mismatch → hard fail with typed error `OPERATOR_PROFILE_SUBACCOUNT_MISMATCH`.

6. **First-chain-link cold start.** First chain link gets a fresh `user-data-dir`. Login from the credential broker happens naturally in the model loop — no special bootstrap.

7. **Failure recovery + fresh-profile restart.** If the profile volume is corrupted or unrecoverable, chain-link start fails with typed error `OPERATOR_PROFILE_UNRECOVERABLE` and § 3.17 incident path engages. Authorised users (`org_admin`) may opt to "restart task with fresh profile" — a per-task action with the following LOCKED semantics:
   - **Same `agent_run_id`** (the customer-visible identity is preserved).
   - **New `attempt_number`** on every `operator_runs` row from this point (and a new `operator_task_profiles` row with the bumped attempt). Default starts at `1`; bumps on each fresh-profile restart.
   - **Conversation history resets at the attempt boundary.** Chain link 1 of attempt N+1 starts with the ORIGINAL task brief only.
   - **Old chain links retained but marked `superseded_by_attempt = N+1`.** Visible in Run Trace under a collapsed "Attempt 1" group; current attempt is the default-expanded view.
   - **Old profile retained per § 3.15 item 4 retention rules** (default 48 hr after the attempt-superseded event; admin debug-retention extends to 14 days). The new attempt's volume is created fresh.
   - **Audit event** `task.operator.fresh_profile_restart` (§ 4.9) writes `actor_user_id`, `prior_attempt_number`, `new_attempt_number`, `prior_chain_seq_count`, `request_id`.
   - Run Trace renders attempts as top-level groups; chain links nest under their attempt.

### 3.16 Per-subaccount operator settings

Runtime limits live on the subaccount, not on the org. Subaccounts are where agents run. A new "Operator" tab on `client/src/pages/AdminSubaccountDetailPage.tsx`, inserted between Board Config (`'board'`) and Usage & Costs (`'usage'`) in the `ActiveTab` union and `TAB_LABELS` map.

**Tab visibility:** `org_admin` can edit; `manager` can view; below `manager` cannot see the tab.

**Fields and defaults** (locked):

| Field | DB column | Default | Min | Max | UI section |
|---|---|---|---|---|---|
| Soft session cap (min) | `session_soft_cap_minutes` | 120 | 30 | 240 | Session limits |
| Auto-extend grace (min) | `auto_extend_grace_minutes` | 30 | 0 | 60 | Session limits |
| Max chain length | `max_chain_length` | 50 | 1 | 500 | Task limits |
| Max wall-clock per task (days) | `max_wall_clock_per_task_days` | 30 | 1 | 365 | Task limits |
| Per-task budget cap (op-session minutes) | `per_task_budget_cap_minutes` | 6000 | 60 | 60000 | Task limits |
| Concurrent operator sessions (per subaccount) | `concurrent_operator_sessions_cap` | 5 | 1 | 25 | Session limits |

**Enforcement points and read sources.** Most caps are enforced from `operator_runs.settings_snapshot` for in-flight chain links and from the live `subaccount_operator_settings` row for new dispatches. The concurrency cap is a special case (both sides need the live value):

- `session_soft_cap_minutes`, `auto_extend_grace_minutes` — adapter-side, per § 3.14 item 3. Read from `operator_runs.settings_snapshot`.
- `max_chain_length` — finaliser decision table, per § 3.14 item 4 (`chain_seq >= cap` branch). Read from `operator_runs.settings_snapshot`.
- `max_wall_clock_per_task_days` — finaliser decision table, per § 3.14 item 4 (`now() - first_operator_run.started_at >= cap` → `paused_budget_exceeded` with `failure_reason='max_wall_clock_exceeded'`). Read from `operator_runs.settings_snapshot`.
- `per_task_budget_cap_minutes` — finaliser decision table, per § 3.14 item 4 (consumed budget branch) and § 3.17 item 4. Read from `operator_runs.settings_snapshot`.
- `concurrent_operator_sessions_cap` — adapter `dispatch()`, per § 3.17 item 5 (advisory-lock pattern). Read from **live** `subaccount_operator_settings` at every dispatch (both new tasks and chain continuations). The settings_snapshot's copy is for audit / incident-payload context only — it is NOT the enforcement source. Rationale: the concurrency cap is a subaccount-wide global, not a per-task contract; changes need to take effect immediately for new dispatches even when other in-flight tasks are using stale per-task caps.

**Storage choice.** A new tenant-scoped table `subaccount_operator_settings` (one row per subaccount; primary key `subaccount_id`). This is preferred over adding six columns to the existing `subaccounts` table — keeps the operator concern isolated, and is the same shape `subaccount_optimiser_settings` already uses for the Sub-account Optimiser feature.

| Column | Type | Notes |
|---|---|---|
| `subaccount_id` | `uuid PRIMARY KEY REFERENCES subaccounts(id) ON DELETE CASCADE` | |
| `organisation_id` | `uuid NOT NULL` | RLS scope (defence in depth). |
| `session_soft_cap_minutes` | `integer NOT NULL DEFAULT 120 CHECK (session_soft_cap_minutes BETWEEN 30 AND 240)` | |
| `auto_extend_grace_minutes` | `integer NOT NULL DEFAULT 30 CHECK (auto_extend_grace_minutes BETWEEN 0 AND 60)` | |
| `max_chain_length` | `integer NOT NULL DEFAULT 50 CHECK (max_chain_length BETWEEN 1 AND 500)` | |
| `max_wall_clock_per_task_days` | `integer NOT NULL DEFAULT 30 CHECK (max_wall_clock_per_task_days BETWEEN 1 AND 365)` | |
| `per_task_budget_cap_minutes` | `integer NOT NULL DEFAULT 6000 CHECK (per_task_budget_cap_minutes BETWEEN 60 AND 60000)` | |
| `concurrent_operator_sessions_cap` | `integer NOT NULL DEFAULT 5 CHECK (concurrent_operator_sessions_cap BETWEEN 1 AND 25)` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | ETag source. |
| `updated_by_user_id` | `uuid NULL REFERENCES users(id)` | Audit. |

**Defaulting.** When a chain link reads its caps and no row exists for the subaccount, the read uses the column defaults. The first write inserts the row (UPSERT pattern). No backfill migration is needed; the row is created lazily.

**Optimistic concurrency.** Writes use `If-Match` against `updated_at` rounded to seconds (consistent with the JWT `iat` precision discipline from KNOWLEDGE.md). Mismatch returns `409 OPERATOR_SETTINGS_CONFLICT` with the current row body; UI MUST refetch and redisplay before retry.

**Server-side validation.** Each PATCH validates against the column CHECK constraints AND the explicit min/max in the table above (defence-in-depth — a future CHECK loosening cannot silently widen the API).

**Audit event.** Every successful update writes `subaccount.operator_settings.updated` (§ 4.9) with `before`, `after`, `actor_user_id`, `request_id`, `source` (`ui` | `api` | `system`).

**Settings application.** Changes apply to **new chain links only** for per-task caps. An in-flight chain link uses the per-task cap that was in effect when it dispatched. The snapshot is pinned in `operator_runs.settings_snapshot` (§ 3.3) at dispatch time and is the sole source of truth for in-flight per-task cap enforcement (`session_soft_cap_minutes`, `auto_extend_grace_minutes`, `max_chain_length`, `max_wall_clock_per_task_days`, `per_task_budget_cap_minutes`). The `concurrent_operator_sessions_cap` is a subaccount-wide global, NOT a per-task contract — it is snapshotted for audit context only and is always enforced from the live `subaccount_operator_settings` row at every dispatch (both new tasks and chain continuations). The incident payload's `settings_snapshot` field (§ 3.17 item 2) is copied verbatim from this row. The UI surfaces a footer note: "Changes apply to new sessions only."

### 3.17 Chain-link start failure + incident emission

A chain link can fail to dispatch for several reasons (auth lost, runtime unavailable, profile corrupted, subaccount over concurrency cap, budget cap hit).

1. **Backoff retry on transient failure.** Chain-link dispatch is retried with exponential backoff: 1 min, 5 min, 15 min. After **3 consecutive failures** (`agent_runs.operator_chain_failure_count >= 3`), the task transitions to `paused_chain_failure`.

   The retry counter (`agent_runs.operator_chain_failure_count`, per § 3.4) resets on:
   - A user-initiated retry (via the per-task "Retry" action).
   - A successful chain-link dispatch (i.e. counter is "consecutive failures since last successful dispatch", not lifetime).

2. **Incident emission.** Each retry attempt writes its own incident via `recordIncident()` (`server/services/incidentIngestor.ts`). Typed event: `operator.chain_link_start_failed`. Idempotency key: `operator.chain_link_start_failed:${agent_run_id}:${attempt_number}:${chain_seq}:${retry_attempt}`. Pg-boss redelivery of the same retry attempt is a no-op. Payload (locked shape — § 4.8):

   ```json
   {
     "event": "operator.chain_link_start_failed",
     "organisation_id": "<uuid>",
     "subaccount_id": "<uuid>",
     "agent_run_id": "<uuid>",
     "operator_run_id": "<uuid|null>",
     "chain_seq": 7,
     "attempt_number": 1,
     "failure_class": "transient|permanent|budget|concurrency|profile_corruption|auth",
     "failure_reason": "<verbatim error string>",
     "request_id": "<correlation id>",
     "credential_mode": "operator_session|api_key|unknown",
     "profile_volume_id": "<opaque pointer or null>",
     "settings_snapshot": {
       "session_soft_cap_minutes": 120,
       "auto_extend_grace_minutes": 30,
       "max_chain_length": 50,
       "max_wall_clock_per_task_days": 30,
       "per_task_budget_cap_minutes": 6000,
       "concurrent_operator_sessions_cap": 5
     },
     "retry_attempt": 2,
     "is_terminal": false
   }
   ```

   `is_terminal=true` is set on the 3rd consecutive failure that triggers `paused_chain_failure`. The system-monitoring agent owns: classifying repeated patterns across tasks (e.g. "all chain links failing on subaccount X with the same auth error" → suggest re-auth flow), flagging remedies, escalating to the assigned user or org admin when an automated remedy is not available.

3. **User notification.** On `paused_chain_failure` transition, notify the assigned user via the existing inbox/notification path. Notification payload includes the failure class and the suggested action (Retry / Cancel). User actions:
   - **Retry** — resets retry counter, dispatches next chain link from the current checkpoint (no fresh profile). Audit event `task.operator.chain_failure_retried`.
   - **Cancel** — § 3.10 cancellation path.

4. **Budget-cap auto-pause and accounting.** Hitting the per-task budget cap is NOT a failure — it is a deliberate auto-pause. Task transitions to `paused_budget_exceeded`.

   **Accounting rules:**
   - Minutes consumed are measured using **DB-anchored timestamps** (`operator_runs.started_at` / `operator_runs.completed_at` written from `now()` inside the chain-link transaction by the adapter). NOT app-process wall-clock.
   - Consumption is the **actual sandbox wall-clock minutes** elapsed, not the allocated cap. A 90-minute chain link consumes 90 minutes.
   - When consumption hits the per-task budget cap mid-chain-link, the running chain link MUST checkpoint and pause at the **next resumable boundary** (NOT hard-kill), UNLESS the chain link also breaches the hard safety limit (soft cap + grace), in which case it terminates per § 3.14 item 3 hard-cap behaviour.
   - Budget extension actions are additive (`new_cap = old_cap + extension_minutes`), never absolute resets, and write audit event `task.operator.budget_extended` (§ 4.9) with `actor_user_id`, `extension_minutes`, `request_id`, `source`.
   - The user can extend at increments of 60 minutes (UI offers presets +1000, +3000, plus a custom-amount input bounded 60..60000 with 60-min step per mockup `r16-modal-budget-exceeded-autopause.html`).

5. **Concurrency-cap behaviour — distinguish new-task vs chain-continuation.**

   The `concurrent_operator_sessions_cap` per subaccount is computed at dispatch time as `count of operator_runs WHERE subaccount_id=$1 AND status='running' AND superseded_by_attempt IS NULL`. To serialise slot accounting against concurrent dispatchers, each dispatch transaction first acquires `pg_advisory_xact_lock(hashtext('operator_slots:' || subaccount_id))`, then runs the count, then inserts the chain-link row. The lock is released at COMMIT. `SELECT count(*) ... FOR UPDATE` is insufficient on its own because aggregate counts do not lock the absence of rows.

   - **New user-requested operator task over the cap:** REJECTED at task-create / first-dispatch with typed error `OPERATOR_SESSION_LIMIT_EXCEEDED`. Customer-facing message surfaced via the existing task-create / operator-capacity modal (canonical component path chosen by the implementation chunk; the mockup `r8-modal-concurrency-limit.html` documents the intended pattern). NOT queued. NOT an incident.
   - **Existing chain-continuation hitting the cap mid-task:** QUEUED FIFO on the new `'operator-session-dispatch-next-chain-link'` pg-boss queue. Task state stays `paused_for_chain_continuation`. Dispatched when a slot frees. NOT an incident — normal flow control.

   **Slot-free wake-up mechanism.** After every chain-link finalise (terminal `completed | failed | cancelled`), the finaliser calls `operatorChainSchedulerService.releaseSlotAndEnqueueNext(subaccountId)`. Under the same `pg_advisory_xact_lock(hashtext('operator_slots:' || subaccount_id))` used at dispatch (§ 7.1 step 3), the scheduler scans the oldest `paused_for_chain_continuation` task for that subaccount whose pending `'operator-session-dispatch-next-chain-link'` job has been throttled by the cap, and enqueues exactly one new dispatch job for the freed slot. If multiple tasks are queued, the FIFO order is `agent_runs.updated_at ASC` for tasks in `paused_for_chain_continuation`. The pure helper for the scan/order lives in `operatorChainSchedulerServicePure.ts` (§ 5.1) and is unit-tested per § 12.

   The distinction matters: new tasks fail-fast so the user can address the cap immediately; in-flight tasks defer so a busy moment doesn't kill long-running work.

## 4. Contracts

### 4.1 `ExecutionCapability` extension

**Location:** `server/services/executionBackends/types.ts:86-93`.

**Producer:** the union itself (type-level only). **Consumers:** every adapter object; the registry validation; the capability-level tests; any UI/routing logic that branches on capability.

**Shape:**

```ts
export type ExecutionCapability =
  | 'in_process'
  | 'delegated'
  | 'subprocess'
  | 'browser_automation'
  | 'code_execution'
  | 'terminal_repo'
  | 'cancellation'
  | 'long_running'   // new in Spec D
  | 'session_identity'; // declared on operator_managed; non-gating at runtime in V1
```

**Example consumption (the new adapter):**

```ts
export const operatorManagedBackend: ExecutionBackend = {
  id: 'operator_managed',
  capabilities: ['delegated', 'code_execution', 'long_running', 'cancellation', 'session_identity'],
  costModel: 'subscription',
  sandboxRequirement: 'code_execution',
  completedEventQueue: 'operator-session-completed',
  terminalStateTable: 'operator_runs',
  completedEventPayload: operatorSessionCompletedPayloadSchema,
  dispatch: operatorManagedDispatch,
  loadTerminalState: operatorManagedLoadTerminalState,
  finalise: operatorManagedFinalise,
  reconcile: operatorManagedReconcile,
  cancel: operatorManagedCancel,
};
```

Both `'long_running'` and `'session_identity'` MUST come from the union; no ad-hoc literals (per § 3.2 propagation invariant; CI gate `verify-execution-capability-references.sh`).

### 4.2 `operator_runs` row shape

Column shape pinned in § 3.3. Example row (post-completed chain link 3 of a task):

```json
{
  "id": "1f7b2c4a-...",
  "agent_run_id": "9e1f3b88-...",
  "organisation_id": "<org-uuid>",
  "subaccount_id": "<sub-uuid>",
  "chain_seq": 3,
  "parent_chain_link_id": "8a92d0c1-...",
  "attempt_number": 1,
  "superseded_by_attempt": null,
  "image_tag": "operator-session:v1.4.2",
  "vendor_session_id": "opv1-9bf3c0...",
  "credential_mode": "operator_session",
  "status": "completed",
  "failure_reason": null,
  "failed_mid_step": false,
  "started_at": "2026-05-12T14:02:11Z",
  "completed_at": "2026-05-12T16:01:43Z",
  "event_emitted_at": "2026-05-12T16:01:43.412Z",
  "cost_subscription_mediated_cents": 0,
  "cost_sandbox_compute_cents": 73,
  "step_count": 84,
  "last_progress_at": "2026-05-12T16:01:39Z",
  "settings_snapshot": {
    "session_soft_cap_minutes": 120,
    "auto_extend_grace_minutes": 30,
    "max_chain_length": 50,
    "max_wall_clock_per_task_days": 30,
    "per_task_budget_cap_minutes": 6000,
    "concurrent_operator_sessions_cap": 5
  },
  "cancel_requested_at": null,
  "cancel_requested_by_user_id": null,
  "checkpoint_payload": { /* see § 4.6 */ },
  "profile_volume_id": "vol-91ab3...",
  "created_at": "2026-05-12T14:02:08Z",
  "updated_at": "2026-05-12T16:01:43Z"
}
```

**Producer:** `operatorManagedBackend.dispatch()` (insert), then chain-link lifecycle writers (updates). **Consumer:** the finaliser, the WebSocket bridge, the Run Trace renderer, the cost-writer, the reconcile loop, the per-task profile-GC job, the system-monitoring agent (via incident payloads).

### 4.3 `agent_runs` status extension

Enum closed set after this spec:

```
'pending' | 'running' | 'delegated' |
'paused_for_chain_continuation' | 'paused_chain_failure' | 'paused_budget_exceeded' |
'completed' | 'failed' | 'cancelled'
```

Pinned at § 3.4. State machine pinned at § 3.4. Forbidden transitions pinned at § 10.7.

### 4.4 `operator_task_profiles` row shape

Column shape pinned in § 3.15 item 1. Example row (active profile, in retention):

```json
{
  "id": "c5d1e0aa-...",
  "task_id": "9e1f3b88-...",
  "organisation_id": "<org-uuid>",
  "subaccount_id": "<sub-uuid>",
  "attempt_number": 1,
  "volume_id": "vol-91ab3...",
  "size_bytes": 312_456_192,
  "size_cap_bytes": 524_288_000,
  "status": "scheduled_gc",
  "scheduled_gc_at": "2026-05-14T16:01:43Z",
  "debug_retention_extended_by": null,
  "debug_retention_extended_at": null,
  "created_at": "2026-05-12T14:02:08Z",
  "updated_at": "2026-05-12T16:01:43Z"
}
```

**Producer:** the adapter on first chain-link dispatch (insert), the chain-link lifecycle writer (size_bytes updates), the cancellation/finaliser path (status + scheduled_gc_at), the admin debug-retention action (extended_by/_at), the GC job (status terminal). **Consumer:** the adapter on chain-link start (subaccount-match + mount), the GC job (the eligibility scan), Run Trace + admin UI.

### 4.5 `subaccount_operator_settings` row shape

Pinned in § 3.16. Example row:

```json
{
  "subaccount_id": "<sub-uuid>",
  "organisation_id": "<org-uuid>",
  "session_soft_cap_minutes": 120,
  "auto_extend_grace_minutes": 30,
  "max_chain_length": 50,
  "max_wall_clock_per_task_days": 30,
  "per_task_budget_cap_minutes": 6000,
  "concurrent_operator_sessions_cap": 5,
  "updated_at": "2026-05-12T13:50:11Z",
  "updated_by_user_id": "<user-uuid>"
}
```

**ETag.** `If-Match: "<unix-seconds-of-updated_at>"`. Server returns matching `ETag` header on read. Mismatch on write → 409 + body containing the current state.

**Producer:** the PATCH route (UI / API). **Consumer:** the adapter at chain-link dispatch (snapshot of effective caps), the task-create route (concurrency-cap check), the budget-cap accounting hook, the settings tab UI.

### 4.6 `checkpoint_payload` JSONB shape

```json
{
  "version": 1,
  "original_task_brief_ref": {
    "kind": "agent_run_brief",
    "agent_run_id": "9e1f3b88-...",
    "artefact_id": "br-...",
    "snapshotted_at": "2026-05-12T13:00:00Z"
  },
  "conversation_history_pointer": {
    "kind": "artefact_chain",
    "artefact_ids": ["op-conv-link-1-...", "op-conv-link-2-...", "op-conv-link-3-..."],
    "history_window_size": 5
  },
  "current_page_url": "https://example.com/dashboard/3rd-step",
  "last_action_summary": "Submitted invoice form; awaiting confirmation page.",
  "next_planned_step": "Verify the confirmation page shows 'Invoice INV-1042 paid'.",
  "last_state_screenshot_artefact_id": "screenshot-...",
  "is_resumable_now": true,
  "captured_at": "2026-05-12T16:01:41Z"
}
```

**Source-of-truth precedence (per § 4.11):** if the operator-emitted `last_action_summary` disagrees with the conversation-history pointer's last entry, the conversation-history pointer wins (it is the durable record; the summary is an operator hint).

**Producer:** the operator runtime (emits via the in-band checkpoint signal); the adapter writes the row at chain-link `completed` terminal. **Consumer:** the resume payload composer at next chain-link dispatch.

**Encryption.** JSONB column written via the app-level encryption helper. The implementation chunk wires the encryption if it is not already on this column path.

### 4.7 Lifecycle events (`operator-session.*`)

Event-type family. All events flow through the existing Run Trace virtual-view contract and the `agent-run:{runId}` WebSocket room. Closed set:

| Event | When emitted | Payload fields (minimum) |
|---|---|---|
| `operator-session.dispatched` | Adapter `dispatch()` succeeded (chain-link row inserted, vendor session created) | `chain_link_id, chain_seq, image_tag, credential_mode, started_at` |
| `operator-session.credential_injected` | After successful credential injection (auth type redacted) | `chain_link_id, credential_mode, plan_tier` |
| `operator-session.progressed` | Each operator step boundary | `chain_link_id, step_index, summary, last_progress_at` |
| `operator-session.fallback_engaged` | Mid-run credential swap to API-key fallback | `chain_link_id, from_mode, to_mode, reason, step_index` |
| `operator-session.refresh_failed` | Token refresh failed (Spec C classifications) | `chain_link_id, reason` |
| `operator-session.preparing_checkpoint` | At `soft_cap - 10 min` | `chain_link_id, time_remaining_ms` |
| `operator-session.auto_extending` | Operator entered auto-extend grace window | `chain_link_id, grace_remaining_ms` |
| `operator-session.artefact_harvested` | After chain-link artefacts (screenshots, files, transcripts) are harvested into the artefact store | `agent_run_id, chain_link_id?, artefact_ids, harvest_reason` — `chain_link_id` is omitted when the event fires post-terminal (see § 10.4) |
| `operator-session.chain_link_completed` | Chain link terminal `completed` with checkpoint | `chain_link_id, chain_seq, checkpoint_id, step_count` |
| `operator-session.chain_link_failed` | Chain link terminal `failed` | `chain_link_id, failure_reason, failed_mid_step` |
| `operator-session.chain_link_cancelled` | Chain link terminal `cancelled` | `chain_link_id, cancelled_by_user_id` |
| `operator-session.task_completed` | Task-terminal `completed` (final chain link) | `agent_run_id, total_chain_links, total_wall_clock_ms` |
| `operator-session.task_failed` | Task-terminal `failed` | `agent_run_id, failure_reason, last_chain_link_id` |
| `operator-session.task_cancelled` | Task-terminal `cancelled` | `agent_run_id, cancelled_by_user_id` |
| `operator-session.task_paused_for_chain_continuation` | Task waiting for next chain dispatch | `agent_run_id, last_chain_link_id, reason` |
| `operator-session.task_paused_chain_failure` | Task auto-paused after 3 dispatch failures | `agent_run_id, last_chain_link_id, last_failure_class` |
| `operator-session.task_paused_budget_exceeded` | Task auto-paused at budget cap | `agent_run_id, budget_cap_minutes, consumed_minutes` |
| `operator-session.fresh_profile_restart` | Authorised fresh-profile restart | `agent_run_id, prior_attempt_number, new_attempt_number, actor_user_id` |
| `operator-session.usability_restored` | Broker signal that operator-session credential is usable again (clears fallback stickiness) | `agent_run_id, credential_id` |

**Namespace discipline.** Hyphenated namespace for lifecycle events: `operator-session.*`. The `operator.*` namespace is reserved for INCIDENT and system-monitoring events (§ 4.8). Audit events live under existing audit namespaces (`task.operator.*`, `subaccount.operator_settings.*`) and ride the existing audit primitives (§ 4.9) — they do NOT use the `operator.*` reservation. Any new lifecycle event MUST register in `shared/types/operatorBackendEvents.ts` (a new file) which is the single source of truth for the discriminated union. A CI gate (`verify-operator-event-registry.sh`) checks for naked string literals matching the family pattern outside the registry.

### 4.8 Incident events (`operator.chain_link_start_failed`)

Pinned in § 3.17 item 2. The only incident event introduced by this spec.

**Producer:** the adapter's `dispatch()` path on every failed attempt (1st, 2nd, 3rd). **Consumer:** the system-monitoring agent via `recordIncident()` → `system-monitor-ingest` queue.

**`failure_class` closed set:** `'transient' | 'permanent' | 'budget' | 'concurrency' | 'profile_corruption' | 'auth'`.

The system-monitoring agent's behaviour is out of scope for this spec (lives in the system-monitor domain); this spec only ensures every chain-link start failure produces a structurally-complete incident the monitor can act on without re-fetching state.

### 4.8b CS notification event (`cs.operator_session.suspended_detected`)

Single typed CS notification introduced by this spec. Produced by `notifyOperatorSessionSuspended()` (`server/services/operatorSessionSuspensionNotifier.ts`, § 5.1) and consumed by the existing inbox pipeline.

**Producer triggers:** (a) first `OPERATOR_SESSION_UNAVAILABLE` hit on the § 3.7 fallback path; (b) broker `usability_state` transition away from `'connected_usable'` for an active operator-session credential.

**Payload (locked shape):**

```json
{
  "event": "cs.operator_session.suspended_detected",
  "organisation_id": "<uuid>",
  "subaccount_id": "<uuid>",
  "agent_run_id": "<uuid|null>",
  "connection_id": "<uuid>",
  "credential_id": "<uuid>",
  "usability_state": "<verbatim broker state>",
  "failure_reason": "<verbatim error class>",
  "consent_record_id": "<uuid|null>",
  "first_detected_at": "<iso-8601>",
  "request_id": "<correlation id>"
}
```

**Idempotency key:** `(connection_id, usability_state, detection_date)` — at most one CS notification per connection per state per day. `detection_date` is derived from the persisted broker `usability_state` transition timestamp (the broker stamps the row at the transition; the notifier reads that stamp, not its own call time). This guarantees a stable key across retries of the same notifier invocation.

**Consumer:** existing inbox / notification pipeline. No new pipeline component is introduced.

### 4.9 Audit events

| Event | When | Payload |
|---|---|---|
| `subaccount.operator_settings.updated` | Settings PATCH succeeded | `subaccount_id, before, after, actor_user_id, request_id, source` |
| `task.operator.fresh_profile_restart` | Authorised fresh-profile restart | `agent_run_id, actor_user_id, prior_attempt_number, new_attempt_number, prior_chain_seq_count, request_id` |
| `task.operator.budget_extended` | Budget cap extended | `agent_run_id, actor_user_id, extension_minutes, request_id, source` |
| `task.operator.chain_failure_retried` | User retried after `paused_chain_failure` | `agent_run_id, actor_user_id, request_id` |
| `task.operator.credential_refreshed` | User refreshed credential + resumed (clears fallback stickiness) | `agent_run_id, actor_user_id, request_id` |
| `task.operator.debug_retention_extended` | Admin extended profile retention to 14 days | `agent_run_id, actor_user_id, request_id` |

All audit events flow through the existing `securityAuditService` writer or its task-action sibling. The implementation chunk picks the correct writer per event family; no new audit primitive is introduced.

### 4.10 Cost ledger row shapes (`subscription_mediated`, `sandbox_compute`)

Both are rows in the existing `llm_requests` table (or whatever the canonical cost-ledger table is — the spec uses `llm_requests` as the working name per the agent's extraction). Producer in this spec: the cost-writer hook called from the finaliser path. Consumer: existing usage views and rollups.

**`subscription_mediated` row** (zero-cost, one per `operator_session`-mode chain link):

```json
{
  "id": "<uuid>",
  "source_type": "subscription_mediated",
  "agent_run_id": "9e1f3b88-...",
  "operator_run_id": "<chain-link-uuid>",
  "organisation_id": "<org-uuid>",
  "subaccount_id": "<sub-uuid>",
  "chain_seq": 3,
  "vendor_session_id": "opv1-9bf3c0...",
  "credential_mode": "operator_session",
  "plan_tier": "plus",
  "step_count": 84,
  "input_tokens": 0,
  "output_tokens": 0,
  "cost_cents": 0,
  "created_at": "2026-05-12T16:01:43Z"
}
```

**`sandbox_compute` row** (real spend, one per chain link):

```json
{
  "id": "<uuid>",
  "source_type": "sandbox_compute",
  "agent_run_id": "9e1f3b88-...",
  "operator_run_id": "<chain-link-uuid>",
  "organisation_id": "<org-uuid>",
  "subaccount_id": "<sub-uuid>",
  "vcpu_seconds": 7200,
  "wall_clock_ms": 7192000,
  "peak_memory_bytes": 1_073_741_824,
  "cost_cents": 73,
  "created_at": "2026-05-12T16:01:43Z"
}
```

**New typed columns vs `metadata` jsonb.** Only two columns are added to `llm_requests` by this spec: `operator_run_id` (nullable; references `operator_runs(id)`) and `boundary` (nullable; the discriminator the cost-writer keys on — currently the single value `'chain_link'`). The other operator-specific fields in the example rows above (`chain_seq`, `vendor_session_id`, `credential_mode`, `plan_tier`, `step_count`, `vcpu_seconds`, `wall_clock_ms`, `peak_memory_bytes`) are written into the existing `llm_requests.metadata` jsonb column, NOT as new typed columns. The cost-writer's JSON shape is named in `operatorCostWriterPure.ts` (§ 5.1). Migration `0331` also adds the covering index `(operator_run_id)` for cost-writer idempotency lookups and the partial UNIQUE `(operator_run_id, source_type, boundary)`.

### 4.11 Source-of-truth precedence

Where the same fact has more than one representation, the read path is:

| Fact | Representations | Read priority |
|---|---|---|
| Chain-link terminal status | `operator_runs.status`, `'operator-session.chain_link_*'` event, finaliser log | `operator_runs.status` > event > log |
| Task terminal status | `agent_runs.status`, `'operator-session.task_*'` event, finaliser log | `agent_runs.status` > event > log |
| Chain-link wall-clock minutes | `(completed_at - started_at)`, the `sandbox_compute` ledger row's `wall_clock_ms` | DB timestamps win (per § 3.17 item 4 DB-anchored discipline) |
| Effective per-subaccount caps | `subaccount_operator_settings` row, `operator_runs.settings_snapshot` (top-level column, NOT in checkpoint_payload) | `operator_runs.settings_snapshot` wins for an in-flight chain link; current `subaccount_operator_settings` wins for new dispatches |
| Conversation history | per-link artefacts vs `checkpoint_payload.last_action_summary` | artefacts win (the summary is an operator hint) |
| Fallback-stickiness state | latest non-superseded `operator_runs.credential_mode` for the task, vs broker `operator-session.usability_restored` events, vs `task.operator.credential_refreshed` audit events | derived per § 3.7 item 6; no separate column. The most recent of the three signals wins; absence of clearing signals after an `'api_key'` link means stickiness persists. |
| Sandbox compute cost | `llm_requests` `sandbox_compute` row vs `operator_runs.cost_sandbox_compute_cents` mirror column | `llm_requests` is canonical. `operator_runs.cost_sandbox_compute_cents` is a read-cache, updated ONLY by `operatorCostWriter.writeRowsForChainLink()` in the SAME transaction that writes the ledger row. Readers that see a disagreement must trust the ledger. |
| Profile-volume location | `operator_runs.profile_volume_id` (cached pointer), `operator_task_profiles.volume_id` (canonical) | `operator_task_profiles.volume_id` wins; the cached pointer is invalidated if `operator_task_profiles.attempt_number > operator_runs.attempt_number` |
| Concurrent-session slot count | `count(*) FROM operator_runs WHERE status='running' AND ...`, the slot-allocator's in-memory cache (if any) | DB query inside an `pg_advisory_xact_lock(hashtext('operator_slots:' || subaccount_id))`-held transaction always wins; no in-memory cache is permitted in V1 |

## 5. File inventory lock

This is the single source of truth for every file touched. Prose references anywhere in this spec MUST appear in this table (per `docs/spec-authoring-checklist.md § 2`).

### 5.1 New files

| File | Purpose |
|---|---|
| `server/services/executionBackends/operatorManagedBackend.ts` | The adapter object + lifecycle methods (`dispatch`, `loadTerminalState`, `finalise`, `reconcile`, `cancel`). |
| `server/services/executionBackends/operatorManagedBackendPure.ts` | Pure helpers for status mapping, chain-resume decisions, fallback-stickiness rules, idempotency keys. |
| `server/services/operatorRuntimeErrors.ts` | Closed signal set for `session_unavailable` classification (§ 3.7 item 1). |
| `server/services/operatorChainResumeService.ts` | Resume-payload composer (joins conversation-history artefacts, builds the resume body). |
| `server/services/operatorChainResumeServicePure.ts` | Pure helpers for the composer. |
| `server/services/operatorConversationHistoryPure.ts` | Pure helpers and constants for per-chain-link conversation-history windowing (default `K = 5` per § 3.14 item 6). |
| `server/services/operatorTaskProfileService.ts` | CRUD + GC for `operator_task_profiles`. |
| `server/services/operatorTaskProfileServicePure.ts` | Pure helpers (retention-window math, status transitions, attempt-bump rules). |
| `server/services/subaccountOperatorSettingsService.ts` | Read/write for `subaccount_operator_settings`. ETag handling. |
| `server/services/subaccountOperatorSettingsServicePure.ts` | Pure helpers (range validation, settings-snapshot extraction). |
| `server/services/operatorCostWriter.ts` | Writes `subscription_mediated` + `sandbox_compute` rows on chain-link finalise. |
| `server/services/operatorCostWriterPure.ts` | Pure helpers (idempotency key derivation, row shape). |
| `server/services/operatorSessionSuspensionNotifier.ts` | Exports `notifyOperatorSessionSuspended(input): Promise<void>` — emits the `cs.operator_session.suspended_detected` typed CS notification via the existing inbox/notification primitive. Called from the fallback hard-fail path (§ 3.7 item 4) and from broker `usability_state` transitions away from `'connected_usable'` (§ 3.13). No new service layer — wraps the existing inbox notification writer. |
| `server/services/operatorBackendErrors.ts` | Typed exception classes — `OperatorBackendConflictError` (the 409 unique-constraint envelope from § 10.6), `OperatorSessionLimitExceededError` (429), and one shared mapper helper. The existing route error-handler middleware (the same one that maps `ZodError` and other typed-error classes today) maps these to the HTTP statuses pinned in § 10.6 — modified-files entry below. |
| `server/services/operatorChainSchedulerService.ts` | FIFO queue logic for chain-continuation dispatch + concurrency-cap accounting. |
| `server/services/operatorChainSchedulerServicePure.ts` | Pure helpers (slot-count, queue-eligibility). |
| `server/jobs/operatorSessionCompletedHandler.ts` | pg-boss handler for `'operator-session-completed'` queue — routes to finaliser + chain-resume dispatcher. |
| `server/jobs/operatorSessionDispatchNextChainLinkHandler.ts` | pg-boss handler for `'operator-session-dispatch-next-chain-link'` queue — runs the chain-link dispatch with retry/backoff. |
| `server/jobs/operatorSessionProgressedHandler.ts` | pg-boss handler for `'operator-session-progressed'` queue — bumps `last_progress_at`, bridges to WebSocket. |
| `server/jobs/operatorTaskProfileGcHandler.ts` | pg-boss cron handler for `'operator-task-profile-gc'` queue — runs every 15 min. |
| `server/routes/operatorSessions.ts` | `GET /api/operator-sessions/:operatorRunId/progress` polling fallback. |
| `server/routes/subaccountOperatorSettings.ts` | `GET` + `PATCH /api/subaccounts/:subaccountId/operator-settings`. |
| `server/routes/operatorTasks.ts` | `POST /api/operator-tasks/:agentRunId/retry-chain-failure`, `POST /api/operator-tasks/:agentRunId/extend-budget`, `POST /api/operator-tasks/:agentRunId/fresh-profile-restart`, `POST /api/operator-tasks/:agentRunId/refresh-credential`, `POST /api/operator-tasks/:agentRunId/extend-debug-retention` (org-admin only; extends profile retention to 14 days per § 6.2). |
| `server/db/schema/operatorRuns.ts` | Drizzle schema for `operator_runs`. |
| `server/db/schema/operatorTaskProfiles.ts` | Drizzle schema for `operator_task_profiles`. |
| `server/db/schema/subaccountOperatorSettings.ts` | Drizzle schema for `subaccount_operator_settings`. |
| `shared/types/operatorBackendEvents.ts` | Discriminated union for all `operator-session.*` lifecycle events. |
| `shared/types/operatorRuns.ts` | Public types for chain-link row + state machine. |
| `shared/types/checkpointPayload.ts` | Zod schema for the JSONB checkpoint payload (§ 4.6). |
| `shared/types/operatorConversationArtefact.ts` | Zod schema `OperatorConversationLinkArtefact` for per-chain-link conversation-history artefacts (§ 3.14 item 6); MIME `application/vnd.synthetos.operator-conversation-link+json;version=1`. |
| `client/src/pages/govern/operatorSettings/OperatorSettingsTab.tsx` | New tab body for AdminSubaccountDetailPage. |
| `client/src/pages/govern/operatorSettings/_fields.tsx` | Field components (slider + number input + helper text). |
| `client/src/components/openTask/OperatorChainLinkIndicator.tsx` | The `link N of ~M` indicator beside the TaskHeader status badge. |
| `client/src/components/openTask/OperatorAutoExtendBanner.tsx` | Amber wind-down banner for the approaching-cap state. |
| `client/src/components/run-trace/ChainLinkDivider.tsx` | Divider element for the merged Run Trace timeline. |
| `client/src/components/run-trace/AttemptGroup.tsx` | Top-level attempt-group wrapper (fresh-profile restart). |
| `client/src/components/operator/OperatorBadge.tsx` | 12px badge on TaskCard for the WorkspaceBoard filter. |
| `client/src/components/operator/OperatorFilterToggle.tsx` | Binary toggle above WorkspaceBoardPage. |
| `client/src/components/operator/OperatorConcurrencyLimitModal.tsx` | The R8 modal pattern. |
| `client/src/components/operator/OperatorUnavailableModal.tsx` | The R9 modal pattern. |
| `client/src/components/operator/OperatorBudgetExceededModal.tsx` | The R16 modal pattern. |
| `client/src/components/operator/_shared.ts` | Shared op-backend helpers (status pill colour map, indicator text formatter). |
| `client/src/api/operatorBackendApi.ts` | Fetch helpers for the new routes. |
| `infra/sandbox-templates/operator-session/Dockerfile` | Renamed from `infra/sandbox-templates/openclaw-session/Dockerfile` (git mv). |
| `infra/sandbox-templates/operator-session/entrypoint.sh` | Renamed. |
| `infra/sandbox-templates/operator-session/README.md` | Renamed. |
| `infra/sandbox-templates/operator-session/CURRENT_VERSION` | Renamed. |
| `docs/runbooks/operator-session-account-suspension.md` | CS runbook (§ 3.13). |
| `docs/runbooks/templates/operator-session-suspension-customer-email.md` | Customer email template. |
| `docs/runbooks/templates/operator-session-suspension-in-app-message.md` | In-app message template. |
| `docs/decisions/0011-operator-backend-chain-resume-model.md` | ADR locking D8 + D11 (chain-resume model + persistent profile as required, not deferred). |
| `scripts/gates/verify-execution-capability-references.sh` | CI gate for `'long_running'` propagation. |
| `scripts/gates/verify-operator-event-registry.sh` | CI gate for `operator-session.*` namespace discipline. |
| `scripts/gates/verify-no-checkpoint-logging.sh` | CI gate banning naive log calls referencing `checkpoint_payload`. |

### 5.2 New migrations

| Migration | Purpose |
|---|---|
| `migrations/0327_create_operator_runs.sql` (+ `.down.sql`) | `operator_runs` table + indexes + FORCE RLS + manifest entry. |
| `migrations/0328_create_operator_task_profiles.sql` (+ `.down.sql`) | `operator_task_profiles` table + indexes + FORCE RLS + manifest entry. |
| `migrations/0329_create_subaccount_operator_settings.sql` (+ `.down.sql`) | `subaccount_operator_settings` table + indexes + FORCE RLS + manifest entry. |
| `migrations/0330_extend_agent_runs.sql` (+ `.down.sql`) | Extend `agent_runs.status` CHECK / enum / allow-list with `paused_for_chain_continuation`, `paused_chain_failure`, `paused_budget_exceeded`; add `operator_chain_failure_count integer NOT NULL DEFAULT 0`. |
| `migrations/0331_extend_llm_requests_operator.sql` (+ `.down.sql`) | Add to `llm_requests` (or canonical cost-ledger table): `operator_run_id uuid NULL REFERENCES operator_runs(id)`, `boundary text NULL` (boundary discriminator — currently the single value `'chain_link'` for the new rows, NULL for pre-existing rows), and the partial UNIQUE index `(operator_run_id, source_type, boundary) WHERE operator_run_id IS NOT NULL AND boundary IS NOT NULL`. Plus a covering index `(operator_run_id)` for the cost-writer idempotency lookup. |

Migration numbering starts at 0327; current latest is 0326 (operator-session-identity). The Spec B sandbox migration numbers (0321–0324) are already in the branch.

### 5.3 Modified files

| File | Change |
|---|---|
| `server/services/executionBackends/types.ts` | Add `'long_running'` and `'session_identity'` to `ExecutionCapability` union (lines 86–93); rename "OpenClaw forward-compat ids" docstring at lines 52–55 to "Operator Backend forward-compat ids". |
| `server/services/executionBackends/registry.ts` | Rename "OpenClaw forward-compat ids" docstring at lines 138–141 to "Operator Backend forward-compat ids"; remove the `'openclaw_managed'`/`'openclaw_external'` rejection check (no longer needed — `operator_managed` registers cleanly). |
| `server/index.ts` | Register `operatorManagedBackend` at lines 687–691 alongside the existing five adapters. |
| `server/services/credentialBrokerService.ts` | Wire the broker-side `resolveFallback({ subaccountId, agentRunId, originalCredentialId })` seam reserved by Spec C; wire the `'operator-session.usability_restored'` signal emitter. |
| `server/services/agentRunFinalizationService.ts` | If needed, extend the `backendId → handler` map; the existing dispatcher routes by `backendId` so the change is additive. |
| `server/config/rlsProtectedTables.ts` | Add three entries: `operator_runs`, `operator_task_profiles`, `subaccount_operator_settings`. |
| `server/db/schema/llmRequests.ts` | Add `operatorRunId: uuid('operator_run_id').references(() => operatorRuns.id)` and `boundary: text('boundary')` columns; declare the partial UNIQUE `(operator_run_id, source_type, boundary)` in the schema annotation. |
| `server/db/schema/agentRuns.ts` | Extend the `status` type-annotation comment / `$type` to include the three new paused states. |
| `server/jobs/index.ts` (if it exists) OR `server/lib/createWorker.ts` registration site | Register the four new pg-boss queues: `'operator-session-completed'`, `'operator-session-dispatch-next-chain-link'`, `'operator-session-progressed'`, `'operator-task-profile-gc'`. |
| `server/lib/permissions.ts` | Add `SUBACCOUNT_OPERATOR_SETTINGS_WRITE` to the permission registry. |
| `server/middleware/errorHandler.ts` (or the canonical route error-handler file) | Map `OperatorBackendConflictError` and `OperatorSessionLimitExceededError` to the § 10.6 HTTP envelopes. Additive change to the existing typed-error case statement. |
| `scripts/gates/verify-permission-coverage.sh` (or canonical permission-coverage gate) | Include `SUBACCOUNT_OPERATOR_SETTINGS_WRITE` in the expected registry/grant coverage. |
| `server/services/permissionSeedService.ts` (or the canonical role-grant file) | Grant the new permission key to the `org_admin` role default. |
| `server/index.ts` (route mounting site, distinct from the adapter registration at lines 687–691) | Mount the three new route modules: `operatorSessions`, `subaccountOperatorSettings`, `operatorTasks`. |
| `client/src/pages/AdminSubaccountDetailPage.tsx` | Extend `ActiveTab` union with `'operator'`; extend `TAB_LABELS` with `operator: 'Operator'`; insert the new tab between `'board'` and `'usage'` in `visibleTabs`; render `<OperatorSettingsTab />` when active. |
| `client/src/pages/WorkspaceBoardPage.tsx` | Render `<OperatorFilterToggle />` above the board; pass filter state into the column renderers. |
| `client/src/components/TaskCard.tsx` | Render `<OperatorBadge />` when `task.executionBackendId === 'operator_managed'`. |
| `client/src/components/openTask/TaskHeader.tsx` | Render `<OperatorChainLinkIndicator />` next to the status badge when applicable; switch to amber + `<OperatorAutoExtendBanner />` when chain-link state is `auto_extending`; hide pause button during auto-extend. |
| `client/src/components/openTask/OpenTaskView.tsx` | Conditional rendering of operator-state copy (terminal `completed | failed | cancelled` variants per mockups `r3`, `r4`, `r5`); no structural changes. |
| `client/src/components/openTask/ChatPane.tsx` | Operator-specific system messages (fallback-engaged amber line per `r6`; plain-English failure summary per `r4`). |
| `client/src/components/openTask/ActivityPane.tsx` | Inline amber event row for fallback-engaged (`r6`); 3-line cost summary footer for terminal-completed (`r3`, § 3.12). |
| `client/src/components/openTask/FilesTab.tsx` | Harvested-artefact display; no operator-specific rendering — reuses the existing artefact-list pattern. |
| `client/src/pages/operate/RunTracePage.tsx` | Render `<AttemptGroup />` wrappers when `attempt_number > 1`; render `<ChainLinkDivider />` between events of different `chain_seq`. |
| `client/src/pages/operate/components/RunTraceEventRenderer.tsx` | Wire the new `operator-session.*` event renderers. |
| `client/src/pages/govern/ConnectionsPage.tsx` (AI Subscriptions tab) | Render the "Suspended" pill + Reconnect CTA on a connection in `usability_state != 'connected_usable'` (mockup `r11-connections-suspended-state.html`). |
| `.github/workflows/publish-sandbox-templates.yml` | Update template path from `openclaw-session` to `operator-session`. |
| `.github/workflows/ci.yml` | Wire the three new CI gates: `verify-execution-capability-references.sh`, `verify-operator-event-registry.sh`, `verify-no-checkpoint-logging.sh`. |
| `docker-compose.sandbox.yml` (if present) | Update service name / mount path. |
| `architecture.md` | Add Operator Backend service-layer row under § Key files per domain; add chain-resume section. |
| `docs/capabilities.md` | Add Operator Backend capability entry (vendor-neutral copy per Editorial Rules). |
| `docs/doc-sync.md` | Update if a new convention is introduced (the new `operator-session.*` event registry pattern). |
| `KNOWLEDGE.md` | Append patterns observed during build (post-merge by the finalisation-coordinator). |

### 5.4 Renamed files (`git mv`)

| From | To |
|---|---|
| `infra/sandbox-templates/openclaw-session/Dockerfile` | `infra/sandbox-templates/operator-session/Dockerfile` |
| `infra/sandbox-templates/openclaw-session/entrypoint.sh` | `infra/sandbox-templates/operator-session/entrypoint.sh` |
| `infra/sandbox-templates/openclaw-session/README.md` | `infra/sandbox-templates/operator-session/README.md` |
| `infra/sandbox-templates/openclaw-session/CURRENT_VERSION` | `infra/sandbox-templates/operator-session/CURRENT_VERSION` |

`tasks/builds/openclaw-adapter/scope.md` is a planning placeholder; it is left in place as historical context (referenced from `tasks/builds/operator-backend/brief.md`) and is NOT renamed. Future cleanup is out of scope.

## 6. Permissions / RLS checklist

Three new tenant-scoped tables. Each MUST have the four requirements from `docs/spec-authoring-checklist.md § 4` (RLS policy, manifest entry, route guard, principal-scoped context).

### 6.1 `operator_runs`

| Requirement | Status |
|---|---|
| **RLS policy** | Included in migration `0327_create_operator_runs.sql`. Standard org+subaccount scoping via the existing `current_setting('app.organisation_id')` and `current_setting('app.subaccount_id')` GUCs. `FORCE ROW LEVEL SECURITY` enabled (defeats owner-bypass). Pattern matches `agent_runs` and `iee_runs`. |
| **Manifest entry** | Added to `server/config/rlsProtectedTables.ts` in the same implementation chunk/commit as the migration (the manifest is a TypeScript module; SQL migrations cannot mutate it). `policyMigration` points at the SQL migration. `{ tableName: 'operator_runs', schemaFile: 'operatorRuns.ts', policyMigration: '0327_create_operator_runs.sql', rationale: 'Chain-link state for operator-managed backend; one row per chain link; tenant-scoped by org+subaccount.' }`. |
| **Route guard** | Reads go through `GET /api/operator-sessions/:operatorRunId/progress` — guards: `authenticate`, `requirePermission('AGENT_RUN_READ')`, and `setOrgGUC()` before the query. Direct-DB-access prohibition is enforced by `verify-rls-contract-compliance.sh`. |
| **Principal-scoped context** | The adapter's `dispatch()`/`finalise()` run inside the existing agent-execution principal context (`PrincipalContext`). The chain-link writer uses `withOrgTx` for every write, propagating the org GUC. |

### 6.2 `operator_task_profiles`

| Requirement | Status |
|---|---|
| **RLS policy** | Included in migration `0328_create_operator_task_profiles.sql`. Same shape as `operator_runs`. |
| **Manifest entry** | Added to `rlsProtectedTables.ts` in the same implementation chunk/commit as the migration. Rationale: "Persistent browser-profile metadata per operator task; tenant-scoped." |
| **Route guard** | The fresh-profile-restart route (`POST /api/operator-tasks/:agentRunId/fresh-profile-restart`) guards: `authenticate`, `requirePermission('AGENT_RUN_ADMIN')` (org-admin equivalent for this action), `setOrgGUC()`. The debug-retention-extend route reuses the same guard set. |
| **Principal-scoped context** | Profile-volume mount runs inside the adapter principal context. The GC job runs under `withAdminConnection({ source: 'operatorTaskProfileGc' }) + SET LOCAL ROLE admin_role` (BYPASSRLS) — see § 7.5 and the `workflowDraftsCleanupJob` / `agentRunCleanupJob` precedents. |

### 6.3 `subaccount_operator_settings`

| Requirement | Status |
|---|---|
| **RLS policy** | Included in migration `0329_create_subaccount_operator_settings.sql`. Org+subaccount scoping. |
| **Manifest entry** | Added to `rlsProtectedTables.ts` in the same implementation chunk/commit as the migration. Rationale: "Per-subaccount operator runtime caps; tenant-scoped; org_admin write, manager read." |
| **Route guard** | `GET /api/subaccounts/:subaccountId/operator-settings` → `authenticate`, `requirePermission('SUBACCOUNT_READ')`, `resolveSubaccount`, `setOrgGUC()`. `PATCH` → `authenticate`, `requirePermission('SUBACCOUNT_OPERATOR_SETTINGS_WRITE')`, `resolveSubaccount`, `setOrgGUC()`. The PATCH permission key is new in this spec — added to the permissions registry and the org-admin role's default grant. |
| **Principal-scoped context** | All reads through the adapter use the existing principal context's `subaccountId` for row lookup. Defaulting (no row exists) returns the column defaults; the first write inserts. |

### 6.4 Other touched tables

- **`agent_runs`** — already RLS-protected; this spec only extends the `status` enum and does not change RLS policy.
- **`llm_requests`** (or canonical cost-ledger table) — already RLS-protected; this spec adds a nullable `operator_run_id` column and an index. RLS policy unchanged.

### 6.5 New permission key

- **`SUBACCOUNT_OPERATOR_SETTINGS_WRITE`** — granted by default to `org_admin`. Used only by the PATCH route. The implementation chunk adds the key to the permissions registry, the role-default grant, and the permission-coverage CI gate.

### 6.5b Backend route guards for the new task-action routes

All routes in `server/routes/operatorTasks.ts` (§ 5.1) MUST mount under `authenticate`, resolve the agent run + subaccount, call `setOrgGUC()`, and enforce a route-specific actor rule before mutating state. Actor rules match § 6.6 UI gates:

| Route | Actor rule | Permission key |
|---|---|---|
| `POST /api/operator-tasks/:agentRunId/retry-chain-failure` | assigned user OR `manager`+ | `AGENT_RUN_WRITE` (existing) |
| `POST /api/operator-tasks/:agentRunId/extend-budget` | assigned user OR `manager`+ | `AGENT_RUN_WRITE` (existing) |
| `POST /api/operator-tasks/:agentRunId/refresh-credential` | `org_admin` only | `AGENT_RUN_ADMIN` (existing) |
| `POST /api/operator-tasks/:agentRunId/fresh-profile-restart` | `org_admin` only | `AGENT_RUN_ADMIN` (existing) |
| `POST /api/operator-tasks/:agentRunId/extend-debug-retention` | `org_admin` only | `AGENT_RUN_ADMIN` (existing) |

The `manager+` / assigned-user rule is enforced in the route handler (not by a single permission key) because the underlying state transitions are user-initiated lifecycle actions, not admin operations. The route handler reads `agent_runs.assigned_user_id` and `users.role` before authorising.

### 6.6 UI permission gates

| UI surface | Read | Edit |
|---|---|---|
| Operator settings tab on AdminSubaccountDetailPage | `manager` and above (tab visible) | `org_admin` only (form enabled) |
| Fresh-profile-restart per-task action | n/a (no read-only state) | `org_admin` only (button visible) |
| Budget extension modal | task-assigned user + `manager` and above can extend | n/a (read-only) |
| Concurrency-limit modal | task-creating user + same as above | n/a |
| Reconnect / suspension banner on Connections (AI Subscriptions) | `manager` and above | `org_admin` only (Reconnect CTA enabled) |
| Operator filter toggle on WorkspaceBoard | everyone who can see the board | n/a |
| Operator badge on TaskCard | everyone who can see the board | n/a |

### 6.7 Tenant-isolation invariants (defence in depth)

1. **Three-way subaccount match** at chain-link start: `task.subaccount_id == credential.subaccount_id == profile.subaccount_id`. Mismatch → hard fail + incident.
2. **No cross-tenant adapter calls** — `operatorManagedBackend.dispatch()` reads `agent_runs.subaccount_id` once, sets the GUC via `setOrgGUC()`, and uses the same scoped tx for every subsequent read/write within the chain link.
3. **`operator_runs.organisation_id` AND `subaccount_id` are redundant with the FK chain** but kept on the row for RLS performance — Postgres applies the policy via these columns without a join.
4. **The pg-boss handlers re-read** the org/subaccount from the row they're processing and re-establish the GUC before any tenant-scoped write (the queue payload carries `operator_run_id`; the handler resolves the rest).
5. **The polling route** subaccount-checks via `setOrgGUC` + `getOrgScopedDb`; a row whose `subaccount_id` doesn't match the caller's principal returns 404 (NOT 403, to avoid leaking existence — consistent with the existing IEE route).

## 7. Execution model

Per `docs/spec-authoring-checklist.md § 5`, one model is picked explicitly and the rest of the spec is consistent with it.

### 7.1 Adapter `dispatch()` — inline / synchronous (chain-link start)

The adapter's `dispatch()` call is **inline**: the caller (Spec A's dispatch orchestrator) waits for it to return. `dispatch()` does:

1. Read `agent_runs` for `(organisation_id, subaccount_id)`.
2. Set the GUC; resolve effective caps (`subaccountOperatorSettingsService.getEffectiveSettings(subaccountId)`).
3. Concurrency-cap check. Acquire `pg_advisory_xact_lock(hashtext('operator_slots:' || subaccount_id))` inside the dispatch tx; then `count(*) FROM operator_runs WHERE subaccount_id=$1 AND status='running' AND superseded_by_attempt IS NULL`; then proceed with the `operator_runs` INSERT under the same lock (released at COMMIT). Plain `SELECT ... FOR UPDATE` is insufficient — aggregate counts do not lock absent rows (§ 10.3). If new task hitting cap → throw `OPERATOR_SESSION_LIMIT_EXCEEDED` (NOT queued, per § 3.17 item 5). If chain-continuation hitting cap → return a structured response that the chain-resume dispatcher handles by re-queueing (FIFO).
4. Three-way subaccount match (§ 6.7).
5. Resolve credential via `credentialBrokerService.requestOperatorSessionCredential` (or `resolveFallback` if stickiness is set).
6. Resolve / create profile via `operatorTaskProfileService.ensureActiveProfile(taskId, attemptNumber)`.
7. Insert the `operator_runs` row (status `'pending'`).
8. Call `sandboxExecutionService.runTask(...)` to start the sandbox session, injecting the credential and mounting the profile. The call MUST pass a `sandbox_start_key = operator_run_id` provider-side idempotency token so the sandbox provider can reject a duplicate start. The sandbox-isolation primitive supports this per Spec B.
9. Receive the vendor session id; UPDATE the `operator_runs` row (status `'running'`, `started_at`, `vendor_session_id`).
10. Return `BackendDispatchResult` with `backendTaskId = operatorRun.id`.

**Dispatch-crash recovery (sandbox-orphan handling).** If `dispatch()` crashes between steps 7 and 9 — `operator_runs` row exists with `status='pending'` but `vendor_session_id IS NULL` — a retry of the same dispatch attempts adoption:

1. Re-read the row; if `status='pending'` AND `vendor_session_id IS NULL`, call `sandboxExecutionService.adoptOrStart({ sandbox_start_key: operator_run_id, ... })` (the sandbox primitive returns the existing sandbox if one was created under that token, otherwise starts a fresh one).
2. On adoption success: UPDATE `operator_runs SET status='running', started_at, vendor_session_id`.
3. On adoption failure or ambiguous state: UPDATE `operator_runs SET status='failed', failure_reason='sandbox_start_unknown'` and emit `operator.chain_link_start_failed` per § 3.17.

The `sandbox_start_key = operator_run_id` discipline gives the system exactly-once sandbox creation per chain-link row even when `dispatch()` is retried after a crash. Without it, a retry produces a duplicate sandbox + an orphan billing path.

A failure at any step (3–10) writes the chain-link row with status `'failed'` (or aborts before insert), emits the `operator.chain_link_start_failed` incident per § 3.17, and the chain-link dispatcher (§ 7.3) handles retry/backoff.

### 7.2 Chain-link terminal event — queued (pg-boss)

When the sandbox session terminates (operator runtime emits a terminal step-state OR hard cap is reached OR cancel propagated OR runtime crashed), the adapter writes the chain-link row to its terminal status and enqueues `'operator-session-completed'` with payload `{ operatorRunId, agentRunId }`.

The handler `operatorSessionCompletedHandler.ts`:

1. Reads the `operator_runs` row (and its `checkpoint_payload`).
2. Calls `finaliseAgentRunFromBackend({ backendId: 'operator_managed', backendTaskId: operatorRunId })`.
3. Inside `finalise()`: the adapter decides task-terminal vs paused-for-continuation (per § 3.14 item 4).
4. If task-terminal: parent agent run rolls up; cost rows are written via `operatorCostWriter.writeRowsForChainLink(operatorRunId)`; profile is scheduled for GC.
5. If paused-for-continuation: parent agent run sets `status='paused_for_chain_continuation'`; cost rows for THIS chain link are written via the same writer (per-chain-link cost rows happen regardless of pause/terminal); the chain-resume dispatcher enqueues `'operator-session-dispatch-next-chain-link'` with payload `{ agentRunId }`.

**Idempotency posture (per § 10.1):** key-based on `(operator_run_id, status)`. A re-delivery of the queue message is a no-op — the finaliser sees the row already in terminal state and returns the prior result.

### 7.3 Chain-link dispatch — queued (pg-boss) with backoff retry

`operatorSessionDispatchNextChainLinkHandler.ts`:

1. Reads the parent `agent_runs` row.
2. Proceed only when ALL of the following hold:
   - `agent_runs.status` is one of `'pending'` (first dispatch — bootstrap path), `'paused_for_chain_continuation'`, `'paused_chain_failure'` (after user-initiated retry, counter has been reset), or `'paused_budget_exceeded'` (after user-initiated extension). NOTE: `'delegated'` is intentionally excluded — a `'delegated'` task already has a chain link in flight, and dispatching another would race.
   - The queued-job reason tag matches the current paused-state resume action (`'continuation'` ↔ `paused_for_chain_continuation`; `'retry'` ↔ `paused_chain_failure`; `'budget_extension'` ↔ `paused_budget_exceeded`; `'bootstrap'` ↔ `pending`).
   - `NOT EXISTS (SELECT 1 FROM operator_runs WHERE agent_run_id = $1 AND attempt_number = $2 AND status IN ('pending','running'))` — there is no in-flight chain link for the current attempt.
   Otherwise no-op (idempotent re-delivery).
3. Calls `executionBackendRegistry.get('operator_managed').dispatch({ agentRunId, ... })` — re-uses § 7.1 inline path.
4. On success: writes `agent_runs.status='delegated'` via the optimistic predicate `UPDATE agent_runs SET status='delegated', operator_chain_failure_count=0 WHERE id=$1 AND status IN ('pending','delegated','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded')`. 0 rows-affected means the task is in a terminal state — no-op.
5. On failure with `'transient'` failure class: increments `agent_runs.operator_chain_failure_count` (per § 3.4 writer rules — predicate `UPDATE ... WHERE status IN ('delegated','paused_for_chain_continuation')`); enqueues a delayed re-dispatch (1 min → 5 min → 15 min via pg-boss's `startAfter` parameter).
6. On the 3rd consecutive failure: writes `agent_runs.status='paused_chain_failure'`, emits `'operator-session.task_paused_chain_failure'` event, sends user notification.
7. On failure with `'permanent' | 'auth' | 'profile_corruption'` failure class: bypasses the backoff and goes directly to `paused_chain_failure`.
8. Every failure (transient or permanent) emits an `operator.chain_link_start_failed` incident with `retry_attempt` and `is_terminal`.

**Idempotency posture:** key-based on `(agentRunId, attempt_number, chain_seq_next)`. `chain_seq_next` is computed as `max(chain_seq) + 1` **within the current `attempt_number`** (NOT across attempts — fresh-profile restart restarts chain_seq at 1 for the new attempt per § 3.15 item 7). Re-delivery of the queue message is a no-op when the chain link is already in `pending`/`running`/terminal state at that `(attempt_number, chain_seq_next)`.

### 7.4 Progress events — queued (pg-boss) + WebSocket bridge

Step-boundary events from the operator runtime are enqueued (`'operator-session-progressed'`) to keep the runtime's hot path off the DB. `operatorSessionProgressedHandler.ts` is the **sole writer** for `operator_runs.last_progress_at` and `step_count`:

1. `UPDATE operator_runs SET last_progress_at = greatest(coalesce(last_progress_at, '-infinity'::timestamptz), $event_timestamp), step_count = greatest(step_count, $step_index) WHERE id = $operator_run_id AND status = 'running'`. The `status = 'running'` guard enforces the § 10.4 post-terminal prohibition: progress events arriving after the chain link reached terminal state update zero rows and are dropped. The `coalesce(..., '-infinity'::timestamptz)` makes the `greatest()` NULL-safe for the first event when `last_progress_at` is still NULL. `greatest()` on `step_count` (with NOT NULL default 0) is naturally safe.
2. If step 1 updated 0 rows: log the drop and return (no WebSocket emission). Otherwise emit `'operator-session.progressed'` to the `agent-run:{runId}` WebSocket room via `emitAgentRunUpdate`.

The WebSocket bridge is best-effort: a dropped event is acceptable (the next event picks up the state). The polling fallback route is the durable visibility path.

### 7.5 Profile GC — queued (pg-boss cron)

`operatorTaskProfileGcHandler.ts` is a 15-minute cron job that scans for `(status='scheduled_gc' AND scheduled_gc_at <= now())` rows, marks them `'gc_in_progress'`, deletes the underlying sandbox volume via the sandbox provider, then sets `'gc_done'`. The scan is system-wide.

`operator_task_profiles` has `FORCE ROW LEVEL SECURITY` (§ 6.2), so the cron CANNOT use the default `db` handle (it would fail-closed with 0 rows on every UPDATE — the same pattern as `workflowDraftsCleanupJob`, `llmLedgerArchiveJob`, and the agent-run cleanup job). The handler MUST follow the existing cross-org maintenance pattern from `architecture.md` § *Row-Level Security — Three-Layer Fail-Closed Data Isolation* / § *Admin-bypass RLS*:

```
await withAdminConnection({ source: 'operatorTaskProfileGc' }, async (tx) => {
  await tx.execute(sql`SET LOCAL ROLE admin_role`);
  // scan + update + delete here
});
```

`admin_role` carries `BYPASSRLS`; every invocation is logged to `audit_events` by `withAdminConnection`.

**Idempotency:** key-based on `(profile_id, scheduled_gc_at)`. A re-run of the cron during deletion picks up only rows still in `'scheduled_gc'`; rows transitioned to `'gc_in_progress'` are skipped — EXCEPT for the stale-reclaim rule below.

**Stale `'gc_in_progress'` reclaim.** A crash during volume deletion can strand a row in `'gc_in_progress'` forever. `operator_task_profiles` includes `gc_started_at timestamptz NULL` (set when the row transitions to `'gc_in_progress'`, cleared on transition to `'gc_done'`). The GC handler reclaims any row where `status='gc_in_progress' AND gc_started_at < now() - INTERVAL '30 minutes'` by treating it as eligible for a fresh deletion attempt. Provider HTTP 404 on the delete call is treated as success (volume already gone) and transitions the row to `'gc_done'`.

### 7.6 Cost-writer — inline within finaliser transaction

The cost-writer is **NOT a separate queue**. It runs inline within the `finalise()` transaction triggered by `'operator-session-completed'`. The terminal `status` on `operator_runs` was written by the adapter at chain-link end (§ 7.2). The finaliser does NOT re-set the terminal status; it commits the cost rows together with stamping `operator_runs.event_emitted_at = now()` so that "cost rows written" and "terminal event acknowledged" land atomically. This avoids the "event acknowledged but no cost row" or "cost row but event still un-acknowledged" partial state.

If the cost-writer fails inside the finaliser: the transaction rolls back, `event_emitted_at` stays NULL, and the pg-boss queue retries delivery. The cost-writer's own idempotency (key-based on `(operator_run_id, source_type, boundary)`) ensures the retry doesn't double-write. The chain-link `status` itself was already committed by the adapter and is not affected by the rollback.

### 7.7 No new feature flags

Per framing (`spec-context.md`): `feature_flags: only_for_behaviour_modes`. The adapter registers unconditionally at boot. No `ENABLE_OPERATOR_BACKEND` flag. If the operator-session credential is unavailable for any subaccount, the existing connection-status surfaces the state.

## 8. Phase plan

Single phase. **Phase 1** ships the whole Operator Backend end-to-end as defined here. The brief's D8 (chain-resume required, not a phase-3.5 deferral) and D11 (persistent profile required, not deferred) are honoured: no sub-phase splits the model.

| Item | Verdict | Notes |
|---|---|---|
| Operator Backend (`operator_managed`) end-to-end | **BUILD IN PHASE 1** | This spec; chunks 1–15 in § 14. |
| `operator_external` BYO compute adapter | **DEFER** to Phase 5 | Type slot reserved; no registration. |
| Cross-provider session identity (Anthropic, Google) | **DEFER** to Phase 3.5 | Spec C `provider` field is forward-compat; V1 single-provider. |
| Streaming progress as first-class | **DEFER** to Phase 3.5 | V1 keeps polling as visibility primitive. |
| Manual checkpoint controls | **DEFER** to Phase 3.5 (D12) | V1 chain-resume is fully automatic. |

The implementation chunks in § 14 are sequential within Phase 1 but they are NOT phases — they are build-order ordering only. Each chunk leaves the system in a forward-compatible state (e.g. schema changes ship before the writers that depend on them).

**Out-of-phase deferrals** (Phase 3.5 / Phase 5) are listed in § 11.

## 9. Phase sequencing (dependency graph)

There is one phase, so phase-level sequencing is trivially satisfied. The chunk-level dependency graph in § 14 has been checked against the three failure modes from `docs/spec-authoring-checklist.md § 6`:

1. **No backward dependency.** Every column referenced by code in Chunk N is created in an equal-or-earlier chunk's migration. Verified via the dependency table in § 14.
2. **No orphaned deferrals.** Every "deferred" item is listed in § 11. Cross-checked.
3. **No phase-boundary contradiction.** Only one phase; no boundary.

The implementation order is: schemas + migrations FIRST, then services FIRST among code, then routes, then UI, then renames + CS runbook + ADR + CI gates. Specific chunk ordering is in § 14.

## 10. Execution-safety contracts

### 10.1 Idempotency posture (per write path)

| Write path | Posture | Key |
|---|---|---|
| `operator_runs` insert (chain-link start) | **state-based** | optimistic predicate: `INSERT ... WHERE NOT EXISTS (SELECT 1 FROM operator_runs WHERE agent_run_id=$1 AND attempt_number=$2 AND chain_seq=$3)`. 0 rows-affected = a concurrent dispatcher already started this chain link. UNIQUE `(agent_run_id, attempt_number, chain_seq)` per § 3.3 is the DB-level backstop. |
| `operator_runs` terminal UPDATE | **state-based** | optimistic predicate: `UPDATE ... WHERE status IN ('pending','running')`. 0 rows-affected = already terminal. |
| `agent_runs` terminal UPDATE to `completed` or `failed` | **state-based** | optimistic predicate: `UPDATE ... WHERE status='delegated'`. A paused task MUST transition `delegated` first (re-dispatch a chain link) before it can roll up to terminal `completed`/`failed`. 0 rows-affected = already terminal OR still paused; finaliser logs and returns 200 idempotent-hit. |
| `agent_runs` terminal UPDATE to `cancelled` | **state-based** | optimistic predicate: `UPDATE ... WHERE status IN ('pending','delegated','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded')`. Any pre-terminal state may transition directly to `cancelled` (user cancel). 0 rows-affected = already terminal; return `409` with current state. |
| `agent_runs` pause UPDATE (`paused_for_chain_continuation`) | **state-based** | optimistic predicate: `UPDATE ... WHERE status='delegated'`. 0 rows-affected = a concurrent path already paused or terminated. |
| `operator_task_profiles` insert (first chain link) | **key-based** | unique constraint: `(task_id, attempt_number)`. 23505 → catch and return the existing row (idempotent-hit). |
| `subaccount_operator_settings` UPSERT | **key-based** | PK: `subaccount_id`. Conflict → If-Match check (state-based concurrency control on top of key-based identity). |
| `operator_runs` progress UPDATE (`last_progress_at`, `step_count`) | **key-based** | event key `(operator_run_id, step_index)`; the handler uses `greatest(last_progress_at, ...)` and `greatest(step_count, ...)` so duplicate / out-of-order deliveries are no-ops. The pg-boss enqueue carries the same singleton key. |
| `llm_requests` cost rows | **key-based** | unique index: `(operator_run_id, source_type, boundary)` for the new rows (added by migration `0331`); existing `(agent_run_id, request_id)` for `per_token` rows. 23505 → idempotent-hit. |
| pg-boss `'operator-session-completed'` enqueue | **key-based** | pg-boss singleton key: `'operator-session-completed:' || operator_run_id`. Re-enqueue is a no-op. |
| pg-boss `'operator-session-dispatch-next-chain-link'` enqueue | **key-based** | singleton key: `'operator-session-dispatch-next-chain-link:' || agent_run_id || ':' || attempt_number || ':' || chain_seq_next`. |
| pg-boss `'operator-task-profile-gc'` cron tick | **state-based** | the cron handler's `UPDATE WHERE status='scheduled_gc' AND scheduled_gc_at <= now() RETURNING id` is the eligibility predicate; concurrent ticks see disjoint row sets. |
| Audit-event write | **non-idempotent (intentional)** | every action records its own audit row; replays are intentional duplicates so the audit log captures every attempted-action. |

### 10.2 Retry classification

| Operation | Classification | Notes |
|---|---|---|
| `credentialBrokerService.requestOperatorSessionCredential` | **guarded** | broker enforces its own idempotency; safe to retry on network errors. |
| `sandboxExecutionService.runTask` | **guarded** | the `sandbox_start_key = operator_run_id` token (§ 7.1) gives the provider exactly-once semantics. On retry: `sandboxExecutionService.adoptOrStart()` either adopts the existing sandbox under the token or starts a fresh one. Without the token a retry would orphan the prior sandbox. |
| `operatorCostWriter.writeRowsForChainLink` | **safe** | key-based idempotent. Retry is a no-op. |
| `recordIncident` | **safe** | Spec C / existing pattern — incident ingestor is internally idempotent. |
| WebSocket emission `emitAgentRunUpdate` | **safe** | best-effort; loss is acceptable. |
| `operatorSessionDispatchNextChainLinkHandler` | **guarded** | wrapped by `operator_runs` (chain_seq) idempotency. |
| `operatorTaskProfileGcHandler` | **guarded** | row-state predicate prevents double-delete. |
| Profile-volume `delete` (Spec B provider call) | **unsafe** | a retry against a missing volume must be treated as success (the provider returns 404 → treat as `gc_done`). Wrapped by `operator_task_profiles.status` predicate. |

### 10.3 Concurrency guards

| Race | Guard |
|---|---|
| Two concurrent chain-link dispatchers for the same task | `operator_runs (agent_run_id, attempt_number, chain_seq)` UNIQUE + `INSERT ... WHERE NOT EXISTS` keyed on the same triple. First wins; second gets 0 rows-affected and re-queries to see the winner's row, then no-ops. |
| Two concurrent task-cancel callers | `agent_runs` UPDATE with optimistic predicate on the pre-terminal closed set. First wins; second gets 0 rows-affected and returns 409 with the current state. |
| Two concurrent dispatches racing past the concurrency cap | `pg_advisory_xact_lock(hashtext('operator_slots:' || subaccount_id))` inside the dispatch tx; the lock serialises all dispatchers for the same subaccount. The count then runs against `operator_runs WHERE subaccount_id=$1 AND status='running' AND superseded_by_attempt IS NULL`. The lock is released at COMMIT. Plain `SELECT count(*) FOR UPDATE` is insufficient — aggregate counts don't lock absent rows. |
| Two concurrent settings-PATCH calls | optimistic concurrency on `updated_at`. Second caller's `If-Match` mismatches → 409. |
| Two concurrent finalises for the same chain link | the finaliser's `operator_runs` UPDATE optimistic predicate gives one winner. The cost-writer's key-based idempotency gives second a no-op. |
| Cron GC + admin debug-retention | the GC scan reads `scheduled_gc_at`; if an admin extends retention between scan and update, the row's `scheduled_gc_at` moves forward AND the cron's UPDATE-WHERE predicate (`status='scheduled_gc' AND scheduled_gc_at <= now()`) returns 0 rows on the second pass. Safe. |
| Fresh-profile-restart racing in-flight chain link | the restart route requires the task to be in a paused state. Optimistic predicate: `UPDATE agent_runs SET ... WHERE status IN ('paused_chain_failure','paused_budget_exceeded','paused_for_chain_continuation')`. Terminal `failed | completed | cancelled` is never restarted under the same `agent_run_id` (§ 10.7 forbidden transitions). A `running`/`delegated` chain link blocks restart. |

### 10.4 Terminal event guarantees

**Chain-link terminal events** (one per chain link):

- Exactly one of `'operator-session.chain_link_completed' | '.chain_link_failed' | '.chain_link_cancelled'` per chain link.
- Post-terminal prohibition: no further events with the same `chain_link_id` after a terminal event. **Exception:** `'operator-session.artefact_harvested'` (§ 4.7) is allowed to fire AFTER the chain-link terminal event only because artefact harvest can complete asynchronously to the chain-link finalise. When `artefact_harvested` fires post-terminal, its payload MUST omit `chain_link_id` and reference the task by `agent_run_id` only. When it fires pre-terminal (the common case), it carries `chain_link_id`. The harvest writer decides which form based on whether the chain link is still `'running'` at harvest time.
- The terminal event's `status` is `'completed'` (with checkpoint OR final), `'failed'`, or `'cancelled'`. No `'partial'` at the chain-link level — partial completion of a chain link IS a `'completed'` with checkpoint (which is the normal case for non-final links).

**Task terminal events** (one per task, only on true terminal states):

- Exactly one of `'operator-session.task_completed' | '.task_failed' | '.task_cancelled'` per task.
- Post-terminal prohibition: no further events with the same `agent_run_id` after a terminal event.
- Paused states emit `'operator-session.task_paused_*'` events; they are NOT terminal — multiple may fire over a task's life (pause → resume → pause → resume → terminal).
- **Single-writer guard.** Before emitting any `operator-session.task_*` terminal event, the writer MUST acquire the singleton key `operator-session-task-terminal:${agent_run_id}` (via pg-boss singleton enqueue OR via an `INSERT INTO task_terminal_event_guard (agent_run_id) ON CONFLICT DO NOTHING RETURNING ...` write — implementation chunk picks one mechanism). The first writer that acquires the key emits; subsequent writers (e.g. a racing finaliser after a user cancel won the `agent_runs` UPDATE) see the conflict and no-op. This guarantees exactly one task-terminal event per task even when cancel and finaliser race.

### 10.5 No-silent-partial-success

Every flow that can partially complete emits an explicit status. Concretely:

- A chain link that started but didn't finish a task → `'chain_link_completed'` with checkpoint (NOT silent partial).
- A task that hit the budget cap mid-chain-link → the chain link `'chain_link_completed'` with checkpoint; the task `'task_paused_budget_exceeded'` (NOT a silent partial on the task).
- A task that exhausted max chain length → `'task_failed'` with `failure_reason='max_chain_length_reached'` (NOT silent).
- A fallback-engaged chain link → mixed cost rows per § 3.12; both row types reflect the boundary explicitly.

### 10.6 Unique-constraint → HTTP status mapping

| Constraint | Violated when | HTTP status |
|---|---|---|
| `operator_runs (agent_run_id, attempt_number, chain_seq) UNIQUE` | Concurrent dispatch race | (internal — converted by `INSERT ... WHERE NOT EXISTS` to 0-rows; no HTTP exposure) |
| `operator_task_profiles (task_id, attempt_number) UNIQUE` | Concurrent ensure-profile | 23505 caught, idempotent-hit, returns existing row body to caller. (Internal route's HTTP equivalent: 200 idempotent.) |
| `subaccount_operator_settings (subaccount_id) PK` | UPSERT conflict | normal UPSERT semantics (no HTTP exposure). |
| `llm_requests (operator_run_id, source_type, boundary) UNIQUE` (new) | Cost-writer retry | 23505 caught, idempotent-hit, returns 200. |
| `subaccount_operator_settings` If-Match mismatch | Stale write | 409 `OPERATOR_SETTINGS_CONFLICT` with `current_state` in body. |
| Cancel a task already in terminal state | optimistic predicate 0 rows | 409 `TASK_ALREADY_TERMINAL` with `current_status` in body. |
| Fresh-profile-restart on running chain link | optimistic predicate 0 rows | 409 `OPERATOR_TASK_RESTART_BLOCKED` with `current_status` and `active_chain_link_id` in body. |
| New operator task over concurrency cap | computed at dispatch | 429 `OPERATOR_SESSION_LIMIT_EXCEEDED` with `cap`, `current`, `subaccount_id` in body. |

No `23505` is allowed to bubble as a 500. The typed exception classes — `OperatorBackendConflictError` for 409 cases and `OperatorSessionLimitExceededError` for 429 — live in `server/services/operatorBackendErrors.ts` (§ 5.1). They are mapped to the HTTP statuses above by the existing route error-handler middleware (the same one already mapping `ZodError` and the other typed-error classes); the build chunk wires the case clauses, no new mapper file is introduced.

### 10.7 State machine closures (`operator_runs`, `agent_runs`)

**`operator_runs.status` enum is CLOSED.** Adding a new value requires a spec amendment.

Valid transitions:

```
pending → running          (sandbox session created, vendor_session_id populated)
pending → failed           (dispatch failure — auth, profile, runtime unavailable)
pending → cancelled        (user cancelled before sandbox started)
running → completed        (operator runtime terminal-success OR checkpoint-ready)
running → failed           (operator runtime crash OR heartbeat stale OR auth lost without fallback OR hard-cap unresumable)
running → cancelled        (user cancelled mid-link OR task-level cancel propagated)
```

Forbidden:
- Any transition from `completed | failed | cancelled` (terminal).
- `pending → completed` (a chain link MUST be `running` before it can complete — there is no "skip the runtime" path).
- `pending → cancelled` from heartbeat-stale (cannot have a stale heartbeat without a running sandbox).

**`agent_runs.status` enum is CLOSED** (the Operator-Backend-relevant subset; the full enum is broader and pre-existing).

Valid transitions (operator-managed paths only):

```
pending → delegated                                  (first chain dispatch)
delegated → paused_for_chain_continuation            (chain link completed with checkpoint, task not done)
paused_for_chain_continuation → delegated            (next chain link dispatched)
delegated → paused_chain_failure                     (3 consecutive dispatch failures)
paused_chain_failure → delegated                     (user retried)
delegated → paused_budget_exceeded                   (budget cap hit)
paused_budget_exceeded → delegated                   (user extended budget)
delegated → completed                                (final chain link task_completed)
delegated → failed                                   (operator runtime hard error OR max chain length)
delegated → paused_chain_failure                     (hard-cap unresumable: running chain link with failed_mid_step=true per § 3.14 item 3; counted in the same dispatch-failure budget as start failures)
{pending | delegated | paused_*} → cancelled         (user cancelled)
```

Forbidden:
- Any transition from `completed | failed | cancelled` (terminal).
- `pending → completed | failed` without going through `delegated` (operator-managed tasks must enter delegation first before completion or failure). **`pending → cancelled` IS permitted** — a user may cancel a task before its first chain-link dispatch.
- `paused_* → completed | failed` without re-entering `delegated` (a paused task MUST resume to dispatch a chain link before it can produce a task-terminal `completed`/`failed` status). **`paused_* → cancelled` IS permitted** at any time (user cancel from a paused state).

Enforcement: optimistic predicates on every writer (§ 10.1, § 10.3). No DB-level CHECK on transition graph (Postgres doesn't support state-machine constraints declaratively); the writer-level predicates are the enforcement.

**Adding a new status value:** any future spec adding to either enum MUST:
1. Add the value to the migration AND the union/type-annotation in the schema file.
2. Update this spec's state-machine diagrams (or supersede this spec).
3. Update every writer's optimistic predicates.
4. Update the UI status-pill renderer.

## 11. Deferred items

Single source of truth. Every "deferred", "later", "future", "Phase 3.5", "Phase 5" reference in this spec corresponds to a line below.

- **DEFER — `operator_external` adapter registration.** Type slot reserved; no runtime registration in V1. Phase 5 — BYO compute / customer-hosted operator workers.
- **DEFER — Cross-provider session identity (Anthropic Claude.ai, Google Gemini).** Spec C's `provider` field is forward-compat; V1 only registers the ChatGPT-Plus operator-session provider. Phase 3.5.
- **DEFER — Routing policy / cost-aware dispatch between Operator Backend and Native adapters.** Phase 3.5 — separate spec.
- **DEFER — "Cost savings vs API" customer-facing dashboard.** Phase 3.5. V1 surfaces cost in existing usage views only.
- **DEFER — Streaming progress as first-class capability.** Phase 3.5 — V1 keeps polling as the visibility primitive.
- **DEFER — Customer self-service tier switching UI.** Phase 3.5.
- **DEFER — Manual checkpoint controls (user-triggered "checkpoint now").** Phase 3.5. D12 — chain-resume is entirely automatic in V1.
- **DEFER — Predict-and-warn classifier for un-resumable flows at task-create time.** Phase 3.5. D7/§3.14 — best-effort with auto-extend grace is V1 policy.
- **DEFER — Operator session export/import to external infrastructure.** Phase 5. V1 keeps all chain links inside the managed Operator Backend.
- **DEFER — Per-subaccount profile-size-cap configuration.** V1 has a system-wide 500 MB constant (§ 3.15 item 3). If customer demand surfaces, future spec adds it to `subaccount_operator_settings`.
- **DEFER — Cross-attempt comparison view in Run Trace.** § 3.15 item 7 / § 3.11 — V1 renders attempts as collapsed groups; a side-by-side compare view is deferred.
- **DEFER — In-flight settings hot-application.** V1 snapshots caps at chain-link dispatch time; in-flight chain links use the snapshot. A future spec could push settings changes to a running chain link (the operator runtime would need a "soft re-cap" signal). Deferred — operationally complex, low demand.
- **DEFER — In-memory slot-allocator cache** for concurrency-cap checks. V1 always queries the DB inside `pg_advisory_xact_lock(hashtext('operator_slots:' || subaccount_id))` (§ 7.1 step 3, § 10.3); no in-memory slot allocator is permitted. A future optimisation could cache slot counts in Redis if hot-path performance becomes a concern. Deferred — premature.

## 12. Testing posture

Cross-referenced against [`docs/spec-context.md`](../../spec-context.md) and [`references/test-gate-policy.md`](../../../references/test-gate-policy.md).

- **Static gates primary.** New CI gates (`scripts/gates/verify-execution-capability-references.sh`, `verify-operator-event-registry.sh`, `verify-no-checkpoint-logging.sh`) catch propagation drift and discipline violations.
- **Pure-function tests authored alongside the code.** Pure helpers in `*Pure.ts` files get vitest pure-function tests (`*Pure.test.ts`) covering happy path + at least one edge case per branch. Pure helpers that matter most: state-mapping (chain-link → task), retry-counter logic, settings snapshot extraction, idempotency-key derivation, profile-retention math, fallback-stickiness rules.
- **RLS contract tests.** New tables added to `rlsProtectedTables.ts` are picked up by existing `verify-rls-coverage.sh` / `verify-rls-contract-compliance.sh` automatically. The existing `rls.context-propagation.test.ts` covers the default-deny posture — no new harness needed.
- **No new frontend tests, no E2E, no API-contract tests.** Per `spec-context.md`: `frontend_tests: none_for_now`, `e2e_tests_of_own_app: none_for_now`, `api_contract_tests: none_for_now`.
- **No new test runner.** Vitest only, per `docs/testing-conventions.md`.

### 12.1 What's NOT tested at the runtime level

Per the framing posture (rapid evolution, pre-production, no live customers), V1 does NOT include:

- Runtime integration tests against a real sandbox provider.
- Runtime smoke tests for the chain-resume flow end-to-end.
- Load tests for the concurrency-cap accounting under contention.
- Tests against the vendor operator runtime itself (vendor-side change risk is mitigated by the pinned `image_tag` + per-chain-link image discipline, not by a test).

The first real Plus-tier customer pilot is the first integration test, by design. The brief's CS runbook (§ 3.13) is the operational mitigation.

## 13. UI integration (mockups → code)

The 20 mockups at `prototypes/operator-backend/` (round 3.2) are the design source of truth.

### 13.1 Mockup → code mapping

| Mockup | Code change |
|---|---|
| `index.html` | (catalog; not a code surface) |
| `c1-agent-edit-model-access-live.html` | `client/src/pages/build/AgentEditPage.tsx` — replace "Available soon" placeholder for operator-managed model access with live state (session cap, concurrency limit, fallback status). |
| `c2-run-trace-timeline.html` | `RunTracePage.tsx` + `RunTraceEventRenderer.tsx` — render the new `operator-session.*` event types per § 3.11. |
| `r1-opentaskview-operator-running.html` | `OpenTaskView.tsx` — render existing layout. TaskHeader pill renders "Operator running" via the existing status badge map; the operator-specific copy comes from the chain-link state. No new file — the existing components carry the state through. |
| `r2-opentaskview-operator-running-approaching-limit.html` | `TaskHeader.tsx` — render `<OperatorAutoExtendBanner />` when the chain link is in auto-extend; amber status pill. No per-run "Extend duration" CTA (brief v2 removed manual extension). |
| `r3-opentaskview-operator-completed.html` | Terminal-completed state of existing TaskHeader + ChatPane + Files tab. Cost summary is a 3-line inline footer in ActivityPane — see § 3.12. |
| `r4-opentaskview-operator-failed.html` | Terminal-failed state. ChatPane shows plain-English failure summary derived from `failure_reason`. |
| `r5-opentaskview-operator-cancelled.html` | Terminal-cancelled state. |
| `r6-opentaskview-fallback-engaged.html` | TaskHeader sub-tag "API fallback"; amber inline event row in ActivityPane; ChatPane amber system message. Status pill stays green. |
| `r7-taskheader-operator-controls.html` | Component spec for TaskHeader across states. Drives the `<OperatorChainLinkIndicator />` + auto-extend amber state. |
| `r8-modal-concurrency-limit.html` | `<OperatorConcurrencyLimitModal />`. Shows the cap and the 5 active sessions (or fewer); each row has a Cancel button. |
| `r9-modal-operator-unavailable.html` | `<OperatorUnavailableModal />`. Two status cards (no subscription, no fallback). Primary action: Add fallback API key. |
| `r11-connections-suspended-state.html` | `ConnectionsPage.tsx` (AI Subscriptions tab) — render the suspended row + Reconnect CTA + "What this means" expander with copyable CS comms snippet. |
| `r12-workspace-board-operator-filter.html` | `WorkspaceBoardPage.tsx` + `<OperatorFilterToggle />` + `<OperatorBadge />` on `TaskCard`. Binary toggle (default off). |
| `r13-subaccount-operator-settings-tab.html` | `OperatorSettingsTab.tsx` on AdminSubaccountDetailPage. Two sections (Session limits, Task limits). Six fields per § 3.16. |
| `r14-taskheader-chain-link-status.html` | `<OperatorChainLinkIndicator />` next to status badge — three variants (known estimate, unknown, terminal). |
| `r15-taskheader-auto-extending.html` | The amber state in `<OperatorAutoExtendBanner />`. Pause button hidden; Stop button stays. |
| `r16-modal-budget-exceeded-autopause.html` | `<OperatorBudgetExceededModal />`. Three extension presets + custom-amount input (60–60000, 60-min step). |
| `r17-runtrace-chain-link-divider.html` | `<ChainLinkDivider />` + `<AttemptGroup />` for attempt-grouped renders. |

### 13.2 Surfaces this spec does NOT touch

- No new top-level nav entries.
- No new "autonomous runs" / "operator runs" page — operator runs are tasks, surfaced inside `OpenTaskView` and `WorkspaceBoardPage`.
- No new dashboard. Cost surfaces in existing usage views only.
- No new top-level route. The two new server routes (`/api/operator-sessions/*`, `/api/subaccounts/.../operator-settings`) are API only.

### 13.3 Permission gates summary (UI side)

See § 6.6.

## 14. Implementation chunk plan

Chunk order is sequential; each chunk leaves the system in a forward-compatible state. The dependency graph is verified per `docs/spec-authoring-checklist.md § 6`.

### Chunk 1 — Schemas + migrations + manifest + state-enum extension

**Files:**
- `server/db/schema/operatorRuns.ts`
- `server/db/schema/operatorTaskProfiles.ts`
- `server/db/schema/subaccountOperatorSettings.ts`
- `migrations/0327_create_operator_runs.sql` (+ `.down`)
- `migrations/0328_create_operator_task_profiles.sql` (+ `.down`)
- `migrations/0329_create_subaccount_operator_settings.sql` (+ `.down`)
- `migrations/0330_extend_agent_runs.sql` (+ `.down`)
- `migrations/0331_extend_llm_requests_operator.sql` (+ `.down`)
- `server/config/rlsProtectedTables.ts` (three new entries)
- `server/db/schema/llmRequests.ts` (add `operator_run_id` column)
- `server/db/schema/agentRuns.ts` (extend status `$type`)
- `shared/types/operatorRuns.ts`
- `shared/types/checkpointPayload.ts`
- `shared/types/operatorConversationArtefact.ts`

**Validation:** `npm run lint`, `npm run typecheck`, `npm run db:generate`. Migrations apply cleanly forward + backward.

**Dependency:** none. First chunk.

### Chunk 2 — `ExecutionCapability` extension + rename + CI gate

**Files:**
- `server/services/executionBackends/types.ts` (union + docstring rename)
- `server/services/executionBackends/registry.ts` (docstring rename + remove openclaw rejection)
- `scripts/gates/verify-execution-capability-references.sh`
- `.github/workflows/ci.yml` (wire the new gate)

**Validation:** lint + typecheck + the new gate runs green; manual grep for `'openclaw_managed'` / `'openclaw_external'` returns no production hits (only brief / spec / changelog references).

**Dependency:** Chunk 1 (schemas) — actually independent, but conventionally after schemas.

### Chunk 3 — Pure helpers + event registry + types

**Files:**
- `shared/types/operatorBackendEvents.ts` (the registry)
- `scripts/gates/verify-operator-event-registry.sh`
- `server/services/executionBackends/operatorManagedBackendPure.ts`
- `server/services/operatorChainResumeServicePure.ts`
- `server/services/operatorTaskProfileServicePure.ts`
- `server/services/subaccountOperatorSettingsServicePure.ts`
- `server/services/operatorCostWriterPure.ts`
- `server/services/operatorChainSchedulerServicePure.ts`
- `server/services/operatorConversationHistoryPure.ts`
- `server/services/operatorRuntimeErrors.ts`
- All paired `*.test.ts` files (vitest, pure-function only)

**Validation:** lint + typecheck + targeted `npx vitest run server/services/**/*Pure.test.ts`.

**Dependency:** Chunks 1–2.

### Chunk 4 — Sandbox template rename + Docker assets

**Files (git mv):**
- `infra/sandbox-templates/openclaw-session/` → `infra/sandbox-templates/operator-session/`
- `.github/workflows/publish-sandbox-templates.yml` (path update)
- `docker-compose.sandbox.yml` (if present)

**Validation:** lint; the CI publish workflow runs (or is dry-runnable) without path errors. Image tag references in tests/fixtures updated.

**Dependency:** Chunk 1 (for `image_tag` column shape only).

### Chunk 5 — Service-layer (non-adapter) implementations

**Files:**
- `server/services/operatorTaskProfileService.ts`
- `server/services/subaccountOperatorSettingsService.ts`
- `server/services/operatorChainResumeService.ts`
- `server/services/operatorCostWriter.ts`
- `server/services/operatorChainSchedulerService.ts`
- `server/services/operatorSessionSuspensionNotifier.ts`
- `server/services/operatorBackendErrors.ts`
- `server/services/credentialBrokerService.ts` (wire `resolveFallback` + `usability_restored` signal emitter)

**Validation:** lint + typecheck. No new tests required (pure helpers are tested; impure boundary code lives here).

**Dependency:** Chunks 1–3.

### Chunk 6 — Adapter object + lifecycle methods + registration

**Files:**
- `server/services/executionBackends/operatorManagedBackend.ts`
- `server/index.ts` (registration line)
- `server/services/agentRunFinalizationService.ts` (if `backendId` map needs an entry)

**Validation:** lint + typecheck. Adapter registers without throwing at boot (manual run).

**Dependency:** Chunks 1–5.

### Chunk 7 — pg-boss handlers + queue registration

**Files:**
- `server/jobs/operatorSessionCompletedHandler.ts`
- `server/jobs/operatorSessionDispatchNextChainLinkHandler.ts`
- `server/jobs/operatorSessionProgressedHandler.ts`
- `server/jobs/operatorTaskProfileGcHandler.ts`
- Queue registration site (`server/jobs/index.ts` or `server/lib/createWorker.ts` call-site config)

**Validation:** lint + typecheck. pg-boss boot registers the four queues. Idempotency keys configured.

**Dependency:** Chunk 6.

### Chunk 8 — Routes + permission key + WebSocket bridge

**Files:**
- `server/routes/operatorSessions.ts`
- `server/routes/subaccountOperatorSettings.ts`
- `server/routes/operatorTasks.ts`
- `server/lib/permissions.ts` — add `SUBACCOUNT_OPERATOR_SETTINGS_WRITE` permission key.
- `server/services/permissionSeedService.ts` (or the canonical role-grant file) — grant the new key to `org_admin` role default.
- `server/index.ts` — mount `operatorSessions`, `subaccountOperatorSettings`, `operatorTasks` routes alongside existing mounts.

**Validation:** lint + typecheck. Routes mount under `authenticate` + `requirePermission(...)`. Subaccount-scoped via `resolveSubaccount` + `setOrgGUC`.

**Dependency:** Chunks 1–6.

### Chunk 9 — Client API helpers + types

**Files:**
- `client/src/api/operatorBackendApi.ts`
- `client/src/components/operator/_shared.ts`

**Validation:** lint + typecheck.

**Dependency:** Chunk 8.

### Chunk 10 — UI: settings tab + AdminSubaccountDetailPage extension

**Files:**
- `client/src/pages/govern/operatorSettings/OperatorSettingsTab.tsx`
- `client/src/pages/govern/operatorSettings/_fields.tsx`
- `client/src/pages/AdminSubaccountDetailPage.tsx` (extend `ActiveTab` + `TAB_LABELS` + tab render)

**Validation:** lint + typecheck + `npm run build:client`. Visual review (operator opens the tab).

**Dependency:** Chunk 9.

### Chunk 11 — UI: TaskHeader + chain-link indicator + auto-extend banner + OpenTaskView family

**Files:**
- `client/src/components/openTask/OperatorChainLinkIndicator.tsx`
- `client/src/components/openTask/OperatorAutoExtendBanner.tsx`
- `client/src/components/openTask/TaskHeader.tsx` (render the indicator + banner; hide pause during auto-extend)
- `client/src/components/openTask/OpenTaskView.tsx` (conditional rendering of operator-state copy per `r3`/`r4`/`r5`)
- `client/src/components/openTask/ChatPane.tsx` (operator system messages per `r4`/`r6`)
- `client/src/components/openTask/ActivityPane.tsx` (fallback-engaged amber row per `r6`; cost-summary footer per `r3`)
- `client/src/components/openTask/FilesTab.tsx` (harvested-artefact display)

**Validation:** lint + typecheck + build. Visual review across the five mockup state variants and the fallback/cost states.

**Dependency:** Chunk 9.

### Chunk 12 — UI: Run Trace chain dividers + attempt groups

**Files:**
- `client/src/components/run-trace/ChainLinkDivider.tsx`
- `client/src/components/run-trace/AttemptGroup.tsx`
- `client/src/pages/operate/RunTracePage.tsx` (wire attempt grouping)
- `client/src/pages/operate/components/RunTraceEventRenderer.tsx` (wire new event renderers)

**Validation:** lint + typecheck + build. Visual review of `r17` mockup behaviour.

**Dependency:** Chunk 9.

### Chunk 13 — UI: WorkspaceBoard filter + TaskCard badge + modals

**Files:**
- `client/src/components/operator/OperatorFilterToggle.tsx`
- `client/src/components/operator/OperatorBadge.tsx`
- `client/src/components/operator/OperatorConcurrencyLimitModal.tsx`
- `client/src/components/operator/OperatorUnavailableModal.tsx`
- `client/src/components/operator/OperatorBudgetExceededModal.tsx`
- `client/src/pages/WorkspaceBoardPage.tsx` (render toggle)
- `client/src/components/TaskCard.tsx` (render badge)
- `client/src/pages/build/AgentEditPage.tsx` (replace "Available soon" placeholder for model-access live state per `c1`)
- `client/src/pages/govern/ConnectionsPage.tsx` (suspended state per `r11`)

**Validation:** lint + typecheck + build. Visual review of `r8`, `r9`, `r11`, `r12`, `r16`, `c1`.

**Dependency:** Chunk 9.

### Chunk 14 — CS runbook + ADR + capabilities + architecture doc-sync

**Files:**
- `docs/runbooks/operator-session-account-suspension.md`
- `docs/runbooks/templates/operator-session-suspension-customer-email.md`
- `docs/runbooks/templates/operator-session-suspension-in-app-message.md`
- `docs/decisions/0011-operator-backend-chain-resume-model.md`
- `architecture.md` (add Operator Backend rows)
- `docs/capabilities.md` (vendor-neutral copy)
- `docs/doc-sync.md` (event-registry pattern)

**Validation:** lint (markdown lint if present); `architecture.md` and `docs/capabilities.md` cross-reference checks per `docs/doc-sync.md`.

**Dependency:** Chunks 1–13.

### Chunk 15 — Final CI gate + checkpoint-logging gate + smoke

**Files:**
- `scripts/gates/verify-no-checkpoint-logging.sh`
- `.github/workflows/ci.yml` (wire the gate)
- Manual `npm run build:server` smoke (boot loads the new adapter without errors).

**Validation:** lint + typecheck + build:server. Boot logs show `operator_managed` registered. The four pg-boss queues are present.

**Dependency:** Chunks 1–14.

### Chunk dependency graph (compact)

```
1 (schemas + migrations + state-enum) ── 2 (capability + rename) ── 3 (pure helpers + event registry)
                                                                       │
                                                                       ├── 4 (Docker rename)
                                                                       │
                                                                       └── 5 (service layer)
                                                                            │
                                                                            └── 6 (adapter + registration)
                                                                                 │
                                                                                 ├── 7 (pg-boss handlers)
                                                                                 │
                                                                                 └── 8 (routes + permission key)
                                                                                      │
                                                                                      └── 9 (client API helpers)
                                                                                           │
                                                                                           ├── 10 (settings tab)
                                                                                           ├── 11 (TaskHeader)
                                                                                           ├── 12 (Run Trace)
                                                                                           └── 13 (board + modals)
                                                                                                │
                                                                                                ├── 14 (docs)
                                                                                                │
                                                                                                └── 15 (final gate + smoke)
```

Chunks 10–13 are siblings; they can be reordered or parallelised. Chunks 14–15 close the change-set.

## 15. Self-consistency pass result

Per `docs/spec-authoring-checklist.md § 8`. The author ran the pass before final commit and recorded the outcomes below.

| Question | Outcome |
|---|---|
| Do Goals (§ 1.2) and Implementation (§ 3) match? | Yes. Each goal in § 1.2 maps to one or more sub-sections of § 3; every implementation sub-section is motivated by a goal or by an upstream lock (§ 2) or by a brief-locked decision (D1–D13). |
| Does every phase item have an explicit verdict (BUILD / DEFER / WON'T DO)? | Yes. Single phase = BUILD; § 11 lists every DEFER explicitly. WON'T DO is captured by § 1.3 non-goals. |
| Does every "single source of truth" claim survive grep? | Yes. `ExecutionCapability` union — single, with CI gate. `operator-session.*` event family — single registry file, CI gate. `RLS_PROTECTED_TABLES` — single manifest, three new entries. `subaccount_operator_settings` table — single, no parallel columns on `subaccounts`. `operator_runs.image_tag` — single, vendor codename absent from non-config code. |
| Do non-functional claims match the execution model? | Yes. No latency or cache-efficiency claims that contradict § 7. Cost-writer is inline within the finaliser transaction (§ 7.6) so cost atomicity holds. Polling is the visibility primitive (§ 3.9); WebSocket is best-effort. |
| Does every "must / guarantees / idempotent / source of truth" have a backing mechanism? | Yes. § 10 pins all of it: idempotency posture per write path (§ 10.1), retry classifications (§ 10.2), concurrency guards (§ 10.3), terminal event guarantees (§ 10.4), no-silent-partial-success (§ 10.5), 23505 → HTTP mapping (§ 10.6), state-machine closures (§ 10.7). Source-of-truth precedence in § 4.11. |
| Are all prose-only file references reflected in § 5? | Yes. Every file mentioned in any section of this spec appears in § 5.1, § 5.2, § 5.3, or § 5.4. The spec author grep'd the draft for "new table", "new column", "new migration", "new service", "new endpoint", "new route", "new job", "new skill", "new hook", "new middleware", "new partition" — all hits verified. |
| Are testing claims consistent with `spec-context.md`? | Yes. Pure-function tests only; no new frontend / E2E / API-contract harness; CI gates as the primary discipline. § 12 acknowledges what is NOT tested at runtime and why. |
| Are framing assumptions in § 1.4 consistent with `spec-context.md`? | Yes. Cross-checked. No staged rollout, no feature flags for new behaviour modes, commit-and-revert posture, accepted-primitives reuse. |
| Are predecessor specs' locked surfaces (§ 2) consistent with their actual code? | Yes. Spec A line refs verified by extraction agent. Spec C broker shape verified. Spec B sandbox entry point verified. The one brief discrepancy (`orgScoping.ts` path) is called out at § 2 footnote. |

**Mockup ↔ spec consistency** — every state pictured in `prototypes/operator-backend/` round 3.2 has a corresponding code change in § 13.1.

**Brief ↔ spec consistency** — every locked decision D1–D13 from the brief is implemented:
- D1 Sandbox persistence per chain link → § 3.1, § 3.2, § 3.14, § 3.15 (chain-link sandbox + persistent profile across links).
- D2 Crash supervision = fail the run → § 3.10 implicitly; no auto-restart logic.
- D3 Artefact harvest end-of-session + on-demand → § 3.11 / § 3.12 reuse existing harvester; on-demand is the existing snapshot-now action (no new surface).
- D4 Pinned image per chain link → § 3.5, § 4.2.
- D5 Soft cap 120 min, per-subaccount → § 3.14 item 3, § 3.16.
- D6 Concurrent-session cap 5 default → § 3.16, § 3.17 item 5.
- D7 Auto-extend grace 30 min default → § 3.14 item 3, § 3.16.
- D8 Chain-resume required → § 3.14; ADR-0011.
- D9 Per-task limits configurable → § 3.16.
- D10 Budget-cap auto-pause → § 3.17 item 4.
- D11 Persistent browser profile required → § 3.15; ADR-0011.
- D12 Manual checkpoint deferred → § 11.
- D13 Incident emission on chain-link start failure required → § 3.17, § 4.8.

### 15.1 Pre-review checklist (`docs/spec-authoring-checklist.md § Appendix`)

- [x] **Section 0** — All cited deferred items verified; the brief explicitly references prior planning (`tasks/builds/openclaw-adapter/scope.md`) and supersedes it; no cited deferred items from `tasks/todo.md` underpin this spec.
- [x] Every new primitive has a "why not reuse" justification — § 2 enumerates locked upstream primitives; new primitives (`operator_runs`, `operator_task_profiles`, `subaccount_operator_settings`, the four new pg-boss queues) are justified by their unique responsibility, not by ad-hoc invention.
- [x] Every new file / column / migration / endpoint is in the file inventory (§ 5).
- [x] Every data shape crossing a boundary has a Contracts entry with an example (§ 4).
- [x] Every contract that writes to multiple representations declares the source-of-truth precedence (§ 4.11).
- [x] Every new tenant-scoped table has RLS policy + manifest entry + route guard + principal-scoped context (§ 6).
- [x] Execution model is picked explicitly and prose + inventory + goals all agree (§ 7).
- [x] Phase dependency graph has no backward refs, no orphaned deferrals, no boundary contradiction (§ 8, § 9, § 14).
- [x] `## Deferred Items` section exists (§ 11).
- [x] Self-consistency pass complete (this section).
- [x] Testing plan consistent with `docs/spec-context.md` (§ 12).
- [x] **Section 10** — every externally-triggered write has idempotency posture, retry classification, concurrency guard (§ 10.1, § 10.2, § 10.3).
- [x] Every cross-flow chain has declared terminal event + post-terminal prohibition (§ 10.4).
- [x] Every DB unique constraint has a named HTTP mapping (§ 10.6).
- [x] State machine introduced / modified: valid transitions, forbidden transitions, closure declared (§ 10.7).
- [x] **Section 11** — spec opens with `Status:` / `Spec date:` / `Last updated:` / `Author:` / `Build slug:` frontmatter (top of file).

## 16. Open questions

These do NOT block spec acceptance. They are surfaced to the operator for visibility; the build session may resolve them as it implements.

1. **Vendor product name (pinned in Dockerfile only).** The spec does not state the specific vendor operator product or pinned version. The build chunk that authors `infra/sandbox-templates/operator-session/Dockerfile` selects the vendor and pinned version. Recommend the vendor used by the existing `openclaw-session` template (the rename preserves the pinned version unless explicitly bumped).

2. **`per_token` row schema linkage to `operator_run_id`.** Spec C did not extend `llm_requests` with an `operator_run_id` column (only `agent_run_id`). § 4.10 / Chunk 1 add this column. If the existing `llm_requests` writer has a Zod schema that closes off unknown fields, the writer's schema also needs updating in Chunk 5. The implementation chunk verifies before writing.

3. ~~**Conversation-history per-link artefact format.**~~ RESOLVED in iter 2: pinned to MIME `application/vnd.synthetos.operator-conversation-link+json;version=1` and Zod schema `OperatorConversationLinkArtefact` in `shared/types/operatorConversationArtefact.ts`.

4. **`is_resumable_now` signal source.** § 3.14 item 3 pins the contract — the operator runtime MUST emit it as a boolean in the checkpoint step-state payload; absent/malformed → `false` with `failure_reason='checkpoint_signal_invalid'`. The exact VENDOR FIELD NAME (vendor-side) is what the build chunk picks.

5. **Status-pill colour vs auto-extend banner colour clash.** § 3.4 + mockup `r15` show amber for auto-extend and amber for `paused_*` states. The UI implementation must disambiguate (e.g. label text differs; the indicator next to the pill carries the chain-link sub-state). Build chunk picks.

6. **Plan-tier display in `r11` Connections suspended state.** Mockup `r11-connections-suspended-state.html` shows "Suspended by OpenAI". The vendor codename SHOULD NOT appear in customer-facing copy (per § 3.1 naming discipline). Recommend: "Suspended" only, with the provider name coming from the broker envelope's `provider` field if the provider has a customer-facing display name reserved (Spec C territory). Build chunk verifies the broker exposes a non-codename display string OR the UI defaults to "Suspended" without naming the provider.

---
