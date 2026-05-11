**Status:** DRAFT (2026-05-11) — awaiting operator sign-off before spec authoring
**Date:** 2026-05-11
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `operator-backend`
**Predecessor placeholder:** `tasks/builds/openclaw-adapter/scope.md` (this brief supersedes it)
**Locked predecessors:** Spec A `tasks/builds/execution-backend-adapter-contract/spec.md` (#281), Spec B `tasks/builds/sandbox-isolation/spec.md` (#287), Spec C `tasks/builds/operator-session-identity/` (#286)
**Strategic parent:** `docs/openclaw-strategic-analysis.md` Phases 2–3, `docs/synthetos-governed-agentic-os-brief-v1.2.md` § 7, § 18.3, § 24 deliverable 7

# Spec D — Operator Backend — Build Brief

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

## 4. Open architectural questions (for the spec)

Flagging now so they don't surface mid-build:

1. **Sandbox persistence across turns.** Recommendation: persistent — it's the point of "long-running session." Confirm e2b session API supports clean persistence across the planned session duration cap.
2. **Operator runtime crash supervision.** Recommendation: fail the run, do not restart. Crashes signal a vendor bug, not transient state. Restart-on-crash risks silently re-running already-effected side effects.
3. **Artefact harvest cadence.** Recommendation: end-of-session harvest + on-demand "snapshot now" if a customer requests it. Periodic harvest for very long sessions = Phase 3.5 add.
4. **Image versioning during in-flight sessions.** Recommendation per § 3.3: pinned per session via `operator_runs.image_tag`.
5. **Session duration cap.** Spec picks a hard wall-clock cap. Recommendation: 120 min V1 with operator override. Rationale: sandbox cost is real, runaway sessions are a billing risk.
6. **Concurrent-session cap per subaccount.** Spec picks a default ceiling. Recommendation: 3 concurrent V1, typed error when exceeded.

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
