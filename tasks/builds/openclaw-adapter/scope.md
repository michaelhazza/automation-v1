**Status:** pre-scope (placeholder — full spec drafted after Spec C lands)
**Build slug:** openclaw-adapter
**Date drafted:** 2026-05-10
**Author:** main session (operator-driven)

# OpenClaw Adapter — Tentative Scope

This is a **planning placeholder**, not a spec. It captures decisions, scope items, and operational concerns surfaced during Spec A authoring so the OpenClaw adapter spec session has a known starting point. The full spec gets drafted *after* Specs A, B, and C lock; this file pre-stages what that spec must cover.

**Do not implement against this file.** It is an aide-mémoire; the authoritative spec replaces it.

## Contents

- [1. Where this fits](#1-where-this-fits)
- [2. Core scope (the obvious part)](#2-core-scope-the-obvious-part)
- [3. Operational hardening — must be in V1 scope](#3-operational-hardening--must-be-in-v1-scope)
- [4. Operational hardening — Phase 3.5 acceptable](#4-operational-hardening--phase-35-acceptable)
- [5. Open architectural questions for the spec](#5-open-architectural-questions-for-the-spec)
- [6. What is NOT in this scope](#6-what-is-not-in-this-scope)
- [7. Pre-conditions before drafting the full spec](#7-pre-conditions-before-drafting-the-full-spec)

---

## 1. Where this fits

| Phase | Spec | What it ships | Status |
|---|---|---|---|
| 1.5 | Spec A — ExecutionBackend Adapter Contract (`tasks/builds/execution-backend-adapter-contract/spec.md`) | The adapter seam this work plugs into | **draft** |
| 2 | Spec B — Sandbox Isolation (e2b adapter) | The runtime where OpenClaw sessions execute | not yet drafted |
| 3 | Spec C — ChatGPT OAuth Operator Session Identity | The credential type customers connect | not yet drafted |
| 3 | **This — OpenClaw Adapter** | The runtime that consumes A + B + C end-to-end | placeholder |

After all four ship, the customer-facing capability is: **connect a ChatGPT plan, run long-form autonomous coding sessions, pay subscription cost instead of API tokens.**

Authoritative parents:
- `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` Decision 2 (contract) and Decision 3 (OAuth posture)
- `docs/openclaw-strategic-analysis.md` Phase 1 (adapter pattern) and Phase 3 (autonomous operators)
- `docs/synthetos-governed-agentic-os-brief-v1.2.md` § 18.3 (Phase 3 — Autonomous Operators)

## 2. Core scope (the obvious part)

### 2.1 The adapter

A new `ExecutionBackend` adapter implementing the contract from Spec A, registered with the registry as `openclaw_managed`. Capabilities: `['delegated', 'code_execution', 'long_running', 'cancellation', 'session_identity']`. Sandbox requirement: `'code_execution'`. Cost model: `'subscription'` when consuming ChatGPT OAuth, `'per_token'` when consuming an API key.

### 2.2 The sandbox

Each OpenClaw session = one long-lived e2b sandbox spun up from the `openclaw-session` template (Docker image with OpenClaw + Codex CLI preinstalled). Session lifetime: minutes to hours. Adapter holds the session connection across turns; tears down on terminal.

### 2.3 The credential injection

Adapter requests a credential from the Credential Broker at session start; broker returns either an `auth_type: 'operator_session'` (ChatGPT OAuth) or `auth_type: 'api_key'` (BYO). Adapter injects the credential into the sandbox at start; sandbox passes it to OpenClaw + Codex CLI. **Adapter never inspects which auth type it received** — that's the point of the broker abstraction.

### 2.4 The lifecycle

Reuses the IEE delegation pattern (Spec A): parent agent run parks in `'delegated'`, OpenClaw runs in the sandbox, terminal event fires, finaliser rolls up status / cost / artefacts onto the parent. New `openclaw_runs` table for session-side state, parallel to `iee_runs`.

### 2.5 The Docker image

`openclaw-session` template lives at `infra/sandbox-templates/openclaw-session/` in the repo. Used by both e2b (as a template) and `docker-compose` (for local dev). Single source of truth. CI rebuilds and publishes when the Dockerfile or pinned OpenClaw version changes.

## 3. Operational hardening — must be in V1 scope

These were flagged during Spec A and B authoring as "real production-readiness gates." Pulling them into V1 scope so they don't get deferred to a Phase 3.5 nobody schedules.

### 3.1 OAuth → API-key fallback path

When OpenAI rate-limits, suspends, or invalidates a session token mid-run, the adapter must:

1. Detect the failure (specific error codes from OpenClaw / Codex CLI surface).
2. Determine whether the customer has a fallback API key configured in the Credential Broker.
3. If yes — swap credentials inside the running sandbox, retry the failing turn. Log the swap as a lifecycle event.
4. If no — fail the run with a typed error (`OPERATOR_SESSION_UNAVAILABLE`) and surface a clear customer-facing message.

This is the single biggest production-readiness gate. Without it, an OpenAI suspension mid-run = silent failure or hard error with no graceful path.

### 3.2 Session-token lifecycle

OAuth tokens expire faster than API keys. Adapter must:

- Refresh tokens proactively before expiry (background refresh ahead of TTL).
- Handle "token expired during a long LLM call" without losing the OpenClaw session state.
- Surface re-auth prompts via the existing connection UI when refresh fails.

### 3.3 Mid-session progress visibility

Long-running sessions need progress UI. Two layers:

- **Session-level events** — OpenClaw step boundaries emitted as pg-boss `openclaw-session-progressed` events; bridged to the existing WebSocket `agent-run` channel.
- **Polling fallback** — `GET /api/openclaw/sessions/:sessionId/progress` endpoint mirroring the IEE polling pattern, for clients that aren't on WebSocket.

Without this, customers stare at "Delegated — last heartbeat 47 minutes ago" and assume the system is broken.

### 3.4 Per-customer cost visibility from day one

Even if the LLM cost is zero (subscription-prepaid), sandbox compute is real spend. Adapter writes:

- One cost row per session into the cost ledger (`source_type: 'sandbox_compute'` + `source_type: 'subscription_mediated'`).
- Per-session vCPU-seconds, wall-clock duration, and OpenClaw step count.

Surface these in the existing usage views (no new dashboard required for V1; data must be queryable).

### 3.5 Customer-support runbook for "OpenAI suspended my account"

Per Decision 3 risk #1: the customer will blame SynthetOS regardless of what they signed at opt-in. Before the first Plus-tier opt-in customer hits a suspension, we need:

- A documented CS playbook in `docs/runbooks/openai-account-suspension.md` (or similar).
- Customer comms templates (apologetic, fact-based, with the disclosure record retrievable).
- Automatic detection of session-revoked errors, with a typed event that fires a CS notification.

This is a small artefact (one-pager + comms templates) but blocks the first onboarding of a Plus-tier customer.

## 4. Operational hardening — Phase 3.5 acceptable

These can defer if Phase 3 V1 is bandwidth-constrained, but should be locked in scope by Phase 3.5.

### 4.1 Streaming progress events as a first-class capability

The IEE polling endpoint stays the V1 visibility primitive (Spec A § 19). Streaming via WebSocket / Server-Sent Events is additive; it doesn't change the contract. Defer if needed.

### 4.2 Cross-provider posture framework

Decision 3 is ChatGPT-specific; Anthropic Claude.ai, Google Gemini, etc. will follow the same pattern. Generalising "Operator Session Identity Posture" into a provider-agnostic framework is a Phase 3.5 cleanup. The OpenClaw adapter can ship ChatGPT-only and bolt other providers on later through the existing `auth_type` slot.

### 4.3 Customer-self-service tier switching

If a customer connects a Plus plan and discovers their workload is heavier than expected, they need an obvious path to upgrade to Pro. UI surface: a "switch tier" CTA in the connection settings. Phase 3.5 unless there's a customer demanding it.

### 4.4 Cost calculator / "should I be on Pro?" recommender

Computes, for a given customer's recent usage, whether their current tier is the right one. Useful for sales, not blocking V1.

## 5. Open architectural questions for the spec

These need answers when the OpenClaw spec is drafted; flagging now so they don't surface mid-build.

1. **Sandbox sharing across turns.** Does each turn get a fresh sandbox, or is the sandbox persistent across the whole session? Recommendation: persistent (it's the point of "long-running session"). Confirm e2b's session API supports this cleanly.

2. **OpenClaw process supervision.** Inside the sandbox, OpenClaw is one process. If it crashes, do we restart it (preserving session state) or fail the run? Recommendation: fail the run; OpenClaw crashes are signal of a bug, not transient.

3. **Cancellation semantics.** OpenClaw is mid-task; user clicks cancel. Same per-step-boundary check the IEE adapter uses, or a sandbox-level signal? Recommendation: use OpenClaw's native cancellation hook (it has one in newer versions) plus the heartbeat-stale backstop already provided by the contract.

4. **Artefact harvest cadence.** Long sessions can generate dozens of files. Harvest at session end only, or periodic checkpoints? Recommendation: end-of-session harvest plus on-demand "snapshot now" if a customer requests it. Periodic harvest for very long sessions can be a Phase 3.5 add.

5. **Image versioning.** When OpenClaw releases v2.0 with breaking changes, do in-flight sessions migrate to the new image, or stay on the old one? Recommendation: pinned per session; new sessions get new image; in-flight sessions complete on their original image. Explicit per-session image tag in `openclaw_runs.image_tag`.

6. **Sub-account scoping in the sandbox.** All metadata tagging happens at our adapter layer (sandbox doesn't know about sub-accounts). Confirm the broker-injected credentials are sub-account-scoped before injection — i.e., a sub-account's session can only consume that sub-account's credential.

## 6. What is NOT in this scope

- ChatGPT OAuth credential UX, plan-tier detection, Plus-tier disclosure flow — Spec C.
- Sandbox vendor selection or `SandboxExecutionService` interface — Spec B.
- ExecutionBackend adapter contract, finaliser generalisation, registry — Spec A.
- BYO compute / customer-hosted OpenClaw workers — Phase 4+.
- Cross-provider session identity (Anthropic, Gemini) — § 4.2 above; Phase 3.5+.
- Routing policy / cost-aware dispatch between OpenClaw and native — Phase 3.5+.

## 7. Pre-conditions before drafting the full spec

The OpenClaw adapter spec session can begin once **all three** of the following are true:

1. Spec A is `accepted` and the adapter contract has shipped (Phase 1.5 / 2 cutover).
2. Spec B is `accepted`; sandbox primitive shipped or in flight; the `openclaw-session` template exists alongside `synthetos-sandbox` in the same repo.
3. Spec C is `accepted`; Credential Broker `auth_type: 'operator_session'` schema locked.

If any are still in draft, the OpenClaw spec ends up coupled to in-flux abstractions and the review pass costs more.

---

## End

This file is replaced by the full OpenClaw adapter spec when it is drafted. Until then it serves as: (a) the scope reminder, (b) the parking lot for items already decided, (c) the diff against what shows up in the eventual spec.
