**Status:** **LOCKED v2** (2026-05-12) — chain-resume model + per-subaccount settings ratified, proceed to spec authoring
**Date:** 2026-05-11
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `operator-backend`
**Predecessor placeholder:** `tasks/builds/openclaw-adapter/scope.md` (this brief supersedes it)
**Locked predecessors:** Spec A `tasks/builds/execution-backend-adapter-contract/spec.md` (#281), Spec B `tasks/builds/sandbox-isolation/spec.md` (#287), Spec C `tasks/builds/operator-session-identity/` (#286)
**Strategic parent:** `docs/openclaw-strategic-analysis.md` Phases 2–3, `docs/synthetos-governed-agentic-os-brief-v1.2.md` § 7, § 18.3, § 24 deliverable 7

# Spec D — Operator Backend — Build Brief

## 0a. Changelog

### v2 lock (2026-05-12) — chain-resume and per-subaccount settings addendum

Conversation surfaced that the v1 brief's "120-min session cap, fail run on hit" model would make Spec D strictly worse than open-core for any task lasting more than 2 hours. v1 framed each operator run as a single sandboxed session; v2 introduces a **chain-resume model** so a single task can span many 120-min sessions with state preserved across handoffs. v2 also moves the runtime limits from hard-coded constants to a per-subaccount settings surface (consistent with where agents already run).

What changed:
- New §3.12 — Chain-resume model (the headline addition).
- New §3.13 — Persistent browser profile per task (the smoothness mechanic).
- New §3.14 — Per-subaccount operator settings tab on `AdminSubaccountDetailPage` (the UI surface).
- New §3.15 — Incident emission on chain-link start failure (system-monitor hook).
- Locked decisions §4 — added D7-D13. D5 reframed as **soft cap** (auto-extend grace added). D6 default updated from 3 to 5 (still per-subaccount).
- Out-of-scope §5 — added "Manual checkpoint controls", "Predict-and-warn classifier for un-resumable flows", "Operator session export/import to external infra" — all deferred.

No change to §2 (locked upstream), §6 (unblocks), §7 (sequencing). The naming rename (§0) is unaffected.

## 0. Naming decision (read first)

The architecture diagram and the v1.2 master brief use **"Operator Backend"** as the canonical product name for the Phase 3 autonomous-operator runtime slot. Historical planning docs (`docs/openclaw-strategic-analysis.md`, `tasks/builds/openclaw-adapter/scope.md`, the reserved adapter ids in `server/services/executionBackends/types.ts`) used the vendor codename "OpenClaw" as shorthand for the underlying third-party operator runtime.

**Per-operator instruction (2026-05-11):** the vendor codename does not appear anywhere in SynthetOS code, schema, UI, telemetry, or customer-facing surfaces. Everything renames to the generic "Operator Backend" abstraction. The specific vendor product underneath is selected by the spec and referenced only in vendor-specific config files.

Rename map (the spec MUST apply consistently):

| Old (planning shorthand) | New (canonical, SynthetOS-side) |
|---|---|
| OpenClaw adapter | Operator Backend adapter |
| `openclaw_managed` | `operator_managed` |
| `openclaw_external` | `operator_external` (reserved, Phase 5) |
| `openclaw-session` (Docker template) | `operator-session` |
| `openclaw_runs` (DB table) | `operator_runs` |
| `openclaw-session-completed` (pg-boss queue) | `operator-session-completed` |
| `openclaw-session-progressed` (pg-boss event) | `operator-session-progressed` |
| Spec A reserved-slot docstrings ("OpenClaw forward-compat ids") | "Operator Backend forward-compat ids" |

The Spec A docstrings at `server/services/executionBackends/types.ts:54` and `registry.ts:139` are corrected in this work as part of the rename pass.

## 1. Purpose

Ship the first concrete autonomous-operator backend — the runtime that consumes Spec A (adapter contract) + Spec B (sandbox isolation) + Spec C (operator-session identity) end-to-end. After this lands, the customer-facing capability is:

> Connect an operator-session subscription, run long-form autonomous tasks inside a sandboxed runtime, pay subscription-mediated cost instead of per-token API cost.

This brief locks scope. The spec is authored next.

## 2. What's locked from upstream

| Capability | Source | Status |
|---|---|---|
| Adapter contract surface (`dispatch`, `loadTerminalState`, `finalise`, `reconcile`, `cancel`) | Spec A | merged #281 |
| Reserved capability tags (`'delegated'`, `'code_execution'`, `'cancellation'`, `'session_identity'`) | Spec A | merged |
| Sandbox isolation primitive + cost ledger `source_type: 'sandbox_compute'` | Spec B | merged #287 |
| Credential Broker `auth_type: 'operator_session'` schema + retrieval invariant + redaction surface | Spec C | merged #286 |
| Cost ledger `source_type: 'subscription_mediated'` (reserved, no writer yet) | Spec C | merged |
| Delegation lifecycle pattern (`agent_runs.status = 'delegated'` → terminal event → finaliser) | existing IEE pattern | pre-A |

Nothing on the foundation is in flux. The Operator Backend is a pure consumer of the three predecessor primitives.

## 3. What this spec must define

### 3.1 The adapter

- **Adapter id:** `operator_managed` (V1). `operator_external` reserved as a type slot, no registration until Phase 5.
- **Capabilities:** `['delegated', 'code_execution', 'long_running', 'cancellation', 'session_identity']`. `'long_running'` is added to the `ExecutionCapability` union by this spec (Spec A's union does not include it; this is the additive amendment).
- **Sandbox requirement:** `'code_execution'`.
- **Cost model:** `'subscription'` when the broker returns an `auth_type: 'operator_session'` credential; `'per_token'` when it returns an `auth_type: 'api_key'` fallback. Adapter does not branch on auth type at runtime — broker hands back a redacted envelope and the adapter passes it through.

### 3.2 The session lifecycle

- One agent run = one long-lived sandbox session (minutes to hours).
- Adapter holds the session connection across operator turns; sandbox tears down only on terminal status.
- New `operator_runs` table parallel to `iee_runs` for session-side state. Columns at minimum: `id`, `agent_run_id`, `subaccount_id`, `image_tag`, `vendor_session_id`, `status` (`pending | running | completed | failed | cancelled`), `failure_reason`, `started_at`, `completed_at`, `event_emitted_at`, `cost_subscription_mediated_cents`, `cost_sandbox_compute_cents`, `step_count`, `last_progress_at`.
- Parent agent run parks in `'delegated'` on dispatch; the shared finaliser (Spec A) rolls up status / cost / artefacts when the terminal event fires.

### 3.3 The Docker image

- Template path: `infra/sandbox-templates/operator-session/`. Single source of truth for both e2b (template) and `docker-compose` (local dev).
- Image contains: the vendor operator runtime (pinned version), the model-invocation CLI it ships with, runtime dependencies. Spec names the specific vendor product and pinned version.
- CI rebuilds and publishes when the Dockerfile or pinned vendor version changes (reuses the Spec B image build pipeline).
- **Pinned per session:** `operator_runs.image_tag` records the specific image used. In-flight sessions complete on their original image when the vendor releases a new version; only new sessions get the new image.

### 3.4 Credential injection (the broker abstraction)

- Adapter requests a credential from `CredentialBrokerService` at session start. Broker returns a redacted envelope (Spec C invariant — `connected_usable` state only, raw token never leaves the broker).
- Envelope is injected into the sandbox at start and passed to the operator runtime + CLI.
- **Adapter never inspects which auth type it received.** That's the point of the abstraction. If a future provider lands, only the broker changes.
- Sub-account scoping is the broker's responsibility (Spec C). Adapter MUST assert the returned credential's subaccount matches the agent run's subaccount before injection — defence in depth.

### 3.5 Operator-session → API-key fallback (the critical reliability gate)

The single biggest production-readiness item. Without it, a provider rate-limit / suspension mid-run = silent failure or hard error with no graceful path. Spec MUST define:

1. **Failure detection** — specific error codes / signals from the operator runtime + CLI that classify as `session_unavailable` (rate-limited, suspended, revoked, scope-stripped).
2. **Fallback resolution** — adapter calls a broker-level fallback-selection seam (Spec C reserved this; shape is the Operator Backend spec author's call). Returns either an `api_key` credential or `null`.
3. **Mid-run credential swap** — if a fallback exists, swap credentials inside the running sandbox and retry the failing turn. Log the swap as a typed lifecycle event (`operator-session.fallback_engaged`) visible in Run Trace.
4. **Hard fail path** — if no fallback exists, fail the run with typed error `OPERATOR_SESSION_UNAVAILABLE` and surface a clear customer-facing message via the existing connection UI.
5. **Cost ledger semantics on mid-run swap** — the same agent run may produce both a `subscription_mediated` row (turns before swap) and `per_token` rows (turns after). Spec defines the exact attribution rule.

### 3.6 Token-lifecycle handling mid-session

- Adapter proactively triggers broker refresh ahead of token TTL.
- Handle "token expired during a long LLM call" without losing sandbox session state — refresh, resume the in-flight turn.
- When refresh fails with `expired_refresh_token` / `provider_revoked` / `insufficient_scope` (Spec C classifications): mark the credential `revoked` via the broker, route through § 3.5 fallback.

### 3.7 Mid-session progress visibility

Long-running sessions need progress UI. Two layers per the existing IEE pattern:

- **Session-level events** — operator runtime step boundaries emitted as pg-boss `operator-session-progressed` events; bridged to the existing WebSocket `agent-run` channel.
- **Polling fallback** — `GET /api/operator-sessions/:sessionId/progress` endpoint mirroring the IEE polling contract for clients off WebSocket.
- `operator_runs.last_progress_at` updated on every step boundary.

Without this, customers stare at "Delegated — last heartbeat 47 minutes ago" and assume the system is broken.

### 3.8 Cancellation

- Adapter declares `'cancellation'` capability.
- Implementation order: (1) operator runtime's native cancellation hook if available, (2) per-step-boundary check (same pattern as IEE adapter), (3) heartbeat-stale backstop from the shared contract.
- Cancel writes `operator_runs.status = 'cancelled'` and emits the terminal event; finaliser rolls up.

### 3.9 Run Trace integration

Adapter MUST emit Run Trace events for: session start, credential injected (auth-type redacted), each step boundary, fallback engaged (if any), terminal status, artefact harvest. Reuses the virtual-view Run Trace contract from the Phase 1 foundation refactor.

### 3.10 Per-customer cost visibility from day one

Even when LLM cost is zero (subscription-prepaid), sandbox compute is real spend. Adapter writes to the cost ledger:

- One `source_type: 'sandbox_compute'` row per session (vCPU-seconds, wall-clock duration, peak memory — from Spec B's sandbox output contract).
- One or more `source_type: 'subscription_mediated'` rows attributing operator-runtime turns to the subscription credential (zero-cost rows, but with `step_count` and `vendor_session_id` for accounting).
- If § 3.5 fallback engages: additional `source_type: 'per_token'` rows for post-swap turns via the normal `llm_requests` path.

Surface in the existing usage views — no new dashboard required for V1, data must be queryable.

### 3.11 CS runbook for provider account suspension

Per Spec C Decision 3 risk #1: the customer will blame SynthetOS regardless of what they signed at opt-in. Before the first Plus-tier opt-in customer hits a suspension:

- Documented CS playbook at `docs/runbooks/operator-session-account-suspension.md`.
- Customer comms templates (apologetic, fact-based, with the Spec C disclosure record retrievable by `consent_record_id`).
- Automatic detection of session-revoked errors firing a typed CS notification.

Small artefact (one-pager + comms templates) but blocks first Plus-tier onboarding.

### 3.12 Chain-resume model (the long-running-task mechanic)

A single operator task can span many 120-min sessions. Each session is a "chain link." When the soft cap is approached, the operator drives itself to a checkpoint-safe state, persists a checkpoint, and the session ends. A scheduler picks up the task and dispatches the next chain link, which resumes from the checkpoint. The user sees one task progressing, not many separate runs.

Spec MUST define:

1. **Chain-link data model.** `operator_runs.chain_seq` (int, starts at 1), `operator_runs.parent_chain_link_id` (FK to prior chain link), `operator_runs.checkpoint_payload` (JSONB or pointer to artefact store).
2. **Checkpoint contents.** Minimum payload that lets a fresh sandbox session resume: original task brief reference, accumulated conversation history (or pointer), current page URL, last action taken, next planned step from the task plan, screenshot of last state.
3. **Soft cap and auto-extend.** Session targets the soft cap (default 120 min per D5). At T-10 min, operator emits a "preparing checkpoint" status. If mid-step at the soft cap (model-judged via an `is_resumable_now` boolean the operator emits), auto-extend up to D7 grace minutes. Hard stop at soft cap + grace.
4. **Chain link dispatch.** End of chain link N writes the checkpoint and emits `operator-session.chain_link_completed`. Existing heartbeat/scheduler picks up the task (it's in a new state `paused_for_chain_continuation`) and dispatches chain link N+1.
5. **Resume payload.** Chain link N+1 starts with original brief + accumulated conversation history + last checkpoint + persistent browser profile (§3.13). The operator's first action is to verify it's on the expected page and continue from the next planned step.
6. **Conversation history accumulation.** Each chain link appends to the same logical conversation. Spec defines whether history is stored as one growing JSONB blob, an append-only event log, or per-chain-link blobs joined at read time. Recommendation: per-chain-link blobs joined at read time, capped at last N chain links of context for the operator model invocation if total context grows unbounded.
7. **Terminal states.** Task terminal status is rolled up from the final chain link's status. Failure on chain link N terminates the task with the chain link's failure reason; remaining chain links are not dispatched.
8. **Run trace integration.** Run Trace renders the chain as a single merged timeline with `chain link N starts` dividers between event groups. Existing virtual-view contract from §3.9 extends to span chain links.
9. **TaskHeader status.** TaskHeader shows "Operator run, link N of ~M, ~T hrs elapsed." Estimate `~M` is computed after the first chain handoff; shown as "—" before then.

### 3.13 Persistent browser profile per task

Smooth chain handoff requires browser state (cookies, login session, local storage) to survive across chain links. Without this, every chain link starts cold, must replay credentials, and breaks on MFA. Open-core does this naturally by keeping a single browser process alive; we have to engineer the equivalent.

Spec MUST define:

1. **Profile storage.** Each task owns a sandbox volume identified by `operator_task_profiles.task_id`, holding the browser's `user-data-dir`. New table or column on existing task model — spec author's call.
2. **Profile mount.** The operator-session Docker template (`infra/sandbox-templates/operator-session/`) mounts the volume at the browser's `user-data-dir` path on chain link start. Each chain link reuses the same volume.
3. **Profile size cap.** Default 500 MB per task. Spec author sets the implementation (Docker volume quota, disk-usage check before chain link start, or both).
4. **Profile lifecycle.** Volume created on first chain link start. Persists across chain links. Garbage-collected at task terminal (completed, failed, cancelled). Max lifetime = D9 max wall-clock per task.
5. **Profile permissions.** Volume access scoped to chain links of the owning task. Subaccount isolation enforced by Spec B's sandbox isolation primitive — adapter MUST assert the task's subaccount matches the credential's subaccount before mounting.
6. **First-chain-link cold start.** First chain link gets a fresh `user-data-dir`. Login from credential broker happens in the model loop, naturally — no special bootstrap.
7. **Failure recovery.** If the profile volume is corrupted or unrecoverable, chain link start fails with `OPERATOR_PROFILE_UNRECOVERABLE` and §3.15 incident path engages. Operator may opt to "restart task with fresh profile" — a per-task action that wipes the volume and dispatches a new chain seq 1.

### 3.14 Per-subaccount operator settings

Runtime limits live on the subaccount, not on the org. Subaccounts are where agents run. New "Operator" tab on `client/src/pages/AdminSubaccountDetailPage.tsx` between the existing "Board Config" and "Usage" tabs. Org-admin-only. Fields and defaults:

| Field | Default | Min | Max | Notes |
|---|---|---|---|---|
| Soft session cap (min) | 120 | 30 | 240 | Per chain link. Matches D5. |
| Auto-extend grace (min) | 30 | 0 | 60 | Past soft cap, finishes current step. Matches D7. |
| Max chain length | 50 | 1 | 500 | Sessions per task. Matches D9. |
| Max wall-clock per task (days) | 30 | 1 | 365 | Matches D9. |
| Per-task budget cap (operator-session minutes) | 6000 | 60 | 60000 | Auto-pause at cap. Matches D10. |
| Concurrent operator sessions (per subaccount) | 5 | 1 | 25 | Matches D6 (v2 default). |

Each field has plain-English help text. The settings page MUST NOT overwhelm — group into two sections "Session limits" and "Task limits" if the screen feels dense.

Permission model: only `org_admin` can edit. `manager` can view. Below `manager` cannot see the tab. Audit trail: every edit writes an audit event `subaccount.operator_settings.updated` with before/after diff.

### 3.15 Chain-link start failure and incident emission

A chain link can fail to dispatch (auth lost, operator runtime unavailable, profile volume corrupted, subaccount over concurrency cap, budget cap hit). Spec MUST define:

1. **Backoff retry on transient failure.** Chain link dispatch is retried with exponential backoff: 1 min, 5 min, 15 min. After 3 consecutive failures, task transitions to `paused_chain_failure`.
2. **Incident emission.** Each retry attempt writes its own incident via `server/services/incidentIngestor.ts` so the system monitoring agent can investigate, classify root cause, and flag remedies. Typed event: `operator.chain_link_start_failed`. Incident payload MUST include enough state for the monitor to investigate without re-fetching: `task_id`, `chain_seq`, `attempt_number` (1, 2, or 3), `failure_class` (transient / permanent / budget / concurrency / profile_corruption), `failure_reason` (verbatim error string), `operator_run_id` (FK to the row in `operator_runs`), and `is_terminal` (true on the 3rd consecutive failure that triggers `paused_chain_failure`). The system monitoring agent owns: classifying repeated patterns across tasks (e.g. "all chain links failing on subaccount X with the same auth error" → suggest re-auth flow), flagging remedies in the incident ticket, and escalating to the assigned user or org admin when an automated remedy is not available.
3. **User notification.** On `paused_chain_failure` transition, notify the assigned user (existing inbox/notification path). User can manually retry (resets backoff counter) or cancel the task.
4. **Budget-cap auto-pause.** Hitting the per-task budget cap is NOT a failure — it's a deliberate auto-pause. Task transitions to `paused_budget_exceeded`. User can extend budget (additive, +N minutes) or cancel.
5. **Concurrency-cap deferral.** Chain link N+1 dispatch finding the subaccount at its concurrency cap waits in a queue, dispatched FIFO when a slot frees. NOT an incident — normal flow control. Task state stays `paused_for_chain_continuation`.

## 4. Locked architectural decisions

Resolved 2026-05-11 by operator review, amended 2026-05-12 (v2 — D5/D6 reframed, D7-D13 added). The spec author MUST honour these values; deviations require returning to the operator.

1. **Sandbox persistence across turns — PERSISTENT.** One sandbox lives for the whole session; state survives turns. Spec confirms e2b session API supports clean persistence across the duration cap (§ 4.5).
2. **Operator runtime crash supervision — FAIL THE RUN.** Crashes are not auto-restarted. Restart-on-crash risk: duplicate side effects from already-effected operator turns. Customer retries from scratch when needed.
3. **Artefact harvest cadence — END-OF-SESSION + ON-DEMAND.** Default harvest at session terminal. Customer-triggered "snapshot now" available mid-session. Periodic checkpointing deferred to Phase 3.5 if requested.
4. **Image versioning during in-flight sessions — PINNED PER SESSION.** `operator_runs.image_tag` records the image used. New sessions get new image; in-flight sessions complete on their original. No live-migration.
5. **Session soft cap — DEFAULT 120 MIN, PER-SUBACCOUNT CONFIGURABLE (v2).** Soft wall-clock cap per chain link. At soft cap, auto-extend up to D7 grace if mid-step (model-judged via `is_resumable_now`); hard stop after grace. Configurable per-subaccount via §3.14 settings (range 30-240 min). v1 said "hard cap, operator override per-run" — v2 reframes as soft cap with grace and replaces per-run override with per-subaccount default.
6. **Concurrent-session cap per subaccount — DEFAULT 5, PER-SUBACCOUNT CONFIGURABLE (v2).** Range 1-25. Typed error (`OPERATOR_SESSION_LIMIT_EXCEEDED`) surfaced when a (cap+1)th concurrent session is requested. Per-subaccount ceiling, not per-user. v1 default was 3; v2 raises to 5 and makes configurable.
7. **Auto-extend grace — DEFAULT 30 MIN, PER-SUBACCOUNT CONFIGURABLE (v2).** Range 0-60 min. Operator drives itself toward checkpoint-safe state past the soft cap. If `is_resumable_now` stays false at soft cap + grace, hard stop and chain link terminates as `failed_mid_step`. Spec defines whether the failure is recoverable on retry.
8. **Chain-resume model — REQUIRED (v2).** A task can span many chain links per §3.12. Open-core parity for long-running tasks depends on this. Not optional; not a phase-3.5 deferral.
9. **Chain-resume per-task limits — PER-SUBACCOUNT CONFIGURABLE (v2).** Max chain length default 50 (range 1-500). Max wall-clock per task default 30 days (range 1-365). Per-task budget cap default 6000 operator-session minutes (range 60-60000, equivalent to 50 chain links of 120 min). All configurable per §3.14.
10. **Budget-cap behaviour — AUTO-PAUSE (v2).** Hitting per-task budget cap auto-pauses the task in state `paused_budget_exceeded`. User extends budget additively (+N min) or cancels. NOT a failure. Settings UI shows clear "default in subaccount" link for adjusting going forward.
11. **Persistent browser profile per task — REQUIRED (v2).** Per §3.13. Smooth chain handoff is a hard requirement; cold-restart-per-link is not acceptable. Volume size cap default 500 MB per task (range left to spec author).
12. **Manual checkpoint controls — DEFERRED (v2).** Chain-resume is entirely automatic in V1. No user-facing "checkpoint now and continue later" controls. Re-evaluate if customer demand surfaces post-launch.
13. **Incident emission on chain-link start failure — REQUIRED (v2).** Per §3.15. Each failed dispatch attempt writes an `operator.chain_link_start_failed` incident via the existing `incidentIngestor` so the system monitoring agent picks it up. Three consecutive failures transitions task to `paused_chain_failure` with user notification.

## 5. Out of scope (explicit non-goals)

| Out of scope | Belongs in |
|---|---|
| ChatGPT / operator-session credential UX, plan-tier detection, Plus-tier disclosure | Spec C (shipped) |
| Sandbox vendor selection, isolation primitive, output contract | Spec B (shipped) |
| Adapter contract surface, finaliser generalisation, registry | Spec A (shipped) |
| BYO compute / customer-hosted operator workers (`operator_external` registration) | Phase 5 |
| Cross-provider session identity (Anthropic Claude.ai, Google Gemini) | Phase 3.5 — schema already forward-compat (Spec C `provider` field) |
| Routing policy / cost-aware dispatch between Operator Backend and Native adapters | Phase 3.5 — strategic analysis Phase 2, separate spec |
| "Cost savings vs API" customer-facing dashboard | Phase 3.5 (strategic analysis Phase 3) |
| Streaming progress as first-class capability (WebSocket / SSE replacement for polling) | Phase 3.5 — polling stays V1 visibility primitive (Spec A § 19) |
| Customer self-service tier switching UI | Phase 3.5 |
| Manual checkpoint controls (user-triggered "checkpoint now") | Phase 3.5 — chain-resume is automatic in V1 (D12) |
| Predict-and-warn classifier for un-resumable flows at task-create time | Phase 3.5 — best-effort with auto-extend grace is V1 policy (D7, H) |
| Operator session export/import to external infrastructure | Phase 5 — V1 keeps all chain links inside the managed Operator Backend |

## 6. What unblocks when this ships

- **First Phase 3 use case (Executive Assistant)** can author against a real Operator Backend, not a placeholder. Per v1.2 brief § 16.1 this is the standing autonomous operator use case.
- **Dev Agent full delivery** (v1.2 § 16.3 Phase 3 path) can author against the same backend.
- **The cost-saving narrative becomes real and demonstrable** — Operator Session Identity (Spec C) had no runtime consumer; this spec is that consumer.
- **The architecture diagram's Box D (Operator Backend, Phase 3+) becomes populated** — the slot stops being aspirational.

## 7. Sequencing

This spec is the last of the Phase 3 foundation work before use-case specs (Executive Assistant, Dev Agent) can author. Recommended order:

1. Operator reviews this brief, locks scope.
2. Spawn a new Claude Code session for the build slug; the session adopts `spec-coordinator`.
3. Session runs: brief intake (this doc) → spec authoring → `spec-reviewer` → `chatgpt-spec-review` → handoff to `feature-coordinator`.
4. Build session ships the adapter, the `operator_runs` table, the sandbox template, the CS runbook, and the rename of Spec A's reserved-slot docstrings.
5. Use-case specs (Executive Assistant, Dev Agent) authored next, consuming this adapter.

**Branch:** `claude/operator-backend-{nonce}` off post-A/B/C `main`.

## End of brief
