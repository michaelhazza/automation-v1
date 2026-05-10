**Status:** Draft v1
**Date:** 2026-05-10
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** sandbox-isolation
**Parent strategy brief:** `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` (Decision 1)
**Predecessor spec:** Spec A — `tasks/builds/execution-backend-adapter-contract/spec.md` (accepted, shipped PR #281)
**Sibling brief (concurrent):** `tasks/builds/operator-session-identity/brief.md` (Spec C)
**Successor:** OpenClaw adapter scope — `tasks/builds/openclaw-adapter/scope.md`

# Spec B — Sandbox Isolation — Build Brief

## 0. Purpose

Ship the e2b-backed sandbox primitive that adapters consume for Tier 4 code execution. Spec A landed the adapter contract; the `iee_dev` adapter declares `sandboxRequirement: 'code_execution'` but no real sandbox exists yet — code runs in the worker process. Spec B fills that gap.

Phase 2 features are blocked on this:

- Revenue Ops Assistant (customer-uploaded CSV / Excel parsing)
- Research Intelligence (customer-uploaded PDF / document processing)
- Data transformations (LLM-emitted scripts running on customer data)
- Dev Agent partial MVP (sandbox-assisted scripts and tests)

Every one of those runs code derived from customer-supplied input. Without per-task isolation, a malicious or buggy customer file runs inside the shared worker process and can affect every other tenant's task. Not acceptable to ship.

This is a **scoping brief**, not the spec. The output is locked scope; the full Spec B is authored next in this build slug.

---

## 1. What's locked from upstream

Decided in `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` Decision 1 and confirmed in Spec A:

- **Vendor:** e2b.dev. Vendor adapter pattern preserves swap-out (Modal / Daytona / self-hosted Firecracker remain swappable).
- **Hosted, not in-house.** No Docker-per-task on our hosts in V1. Phase 2 is blocked on this; e2b ships in weeks vs months for self-hosted.
- **One account, two projects** (prod + staging) — one billing relationship. Local dev uses Docker Compose with the same Dockerfile, no e2b account required.
- **Two templates total:** `synthetos-sandbox` (ephemeral Tier 4 tasks) and `openclaw-session` (long-running autonomous sessions; image authored here but consumed by the OpenClaw adapter spec).
- **Multi-tenancy via metadata tags**, not e2b-level isolation. One sandbox per task; tags carry `org_id`, `subaccount_id`, `run_id`, `agent_id`.

---

## 2. What Spec B must define

1. **`SandboxExecutionService` interface.** The primitive adapters call. Shape: `runTask(input) → output`. Adapters (today `iee_dev`, future OpenClaw) consume it; the vendor implementation is hidden behind it.
2. **Three implementations** of the interface:
   - `e2bSandbox` — production / staging
   - `localDockerSandbox` — local dev
   - `inlineSandbox` — unit tests only, no isolation, dangerous-but-explicit
   - Resolution via `SANDBOX_PROVIDER` env var
3. **Output contract.** Inside the sandbox, conventional paths:
   - `/workspace/output.json` — structured result (mandatory, Zod-validated)
   - `/workspace/artefacts/` — files to keep (uploaded to our object storage)
   - `/workspace/logs/stdout.log` + `stderr.log` — captured logs
   - Anything outside these paths is discarded at sandbox close.
4. **Harvest mechanism.** After sandbox terminal, the adapter reads outputs via e2b SDK file API, uploads artefacts to existing object storage, writes log rows to existing log tables, writes cost row to ledger.
5. **Cost ledger extension.** Extend `llm_requests` (or its successor) with `source_type = 'sandbox_compute'` rows. Per-task `vcpu_seconds`, `wall_clock_ms`, `e2b_cost_cents` columns or JSONB on the row.
6. **Wall-clock + cost ceiling per task.** Hard limits set at sandbox start; sandbox auto-terminates at either threshold. **V1 mandatory** — without it, runaway LLM loops burn real money.
7. **Per-customer sandbox-minute metering.** Aggregations queryable from day one; the first time a customer asks "why is my bill higher?" we need this. UI dashboard NOT required in V1; data must exist.
8. **Sub-account credential scoping.** Adapter injects only the sub-account-scoped credential into the sandbox; the sandbox never sees credentials belonging to a different sub-account.
9. **Template build pipeline.** CI job that builds `synthetos-sandbox` (and `openclaw-session`) Docker images from `infra/sandbox-templates/`, pushes to e2b template registry on tag bump. Same Dockerfile used by `docker-compose` for local dev.
10. **Migration path from collapsed `iee_dev`.** Today `iee_dev` collapses untrusted code execution into the worker process. Spec B splits this: `iee_dev` adapter starts consuming `SandboxExecutionService` for the untrusted-execution portion; the trusted "Terminal/Repo" portion (Tier 5) stays in the worker. Pin the exact split.

---

## 3. Concurrent build note

Spec B runs in parallel with **Spec C — Operator Session Identity** (`tasks/builds/operator-session-identity/brief.md`). The two specs touch different code surfaces:

- B = `server/services/sandbox*`, `infra/sandbox-templates/`, cost ledger extension, `iee_dev` adapter rewiring.
- C = `server/services/credentialBroker*`, OAuth callback handlers, new consent-log table, connection UI.

**No code-area conflicts.** Both touch `architecture.md` (different sections) and `llm_requests` schema (different `source_type` values). Doc-sync sweep at finalisation reconciles. Either spec can land first; the second rebases.

Cross-coordination points (be aware, not blocking):

- **Cost ledger row types.** B adds `'sandbox_compute'`; C adds `'subscription_mediated'`. Coexist on a single agent run for OpenClaw later. Each spec defines its own row type independently.
- **Sub-account scoping.** Both must enforce it. B threads sub-account ID through sandbox metadata; C inherits from existing CredentialBroker behaviour (PR #279).

---

## 4. Out of scope

- **OpenClaw `openclaw-session` template's contents** (Codex CLI install, OpenClaw process wiring) — OpenClaw adapter spec.
- **Long-lived session semantics** (`Sandbox.connect()` pattern for hour-long sessions) — OpenClaw adapter spec.
- **OpenClaw adapter itself** — Phase 3 spec.
- **Sandbox cost passthrough vs bundling in plan tiers** — pricing decision, not Spec B.
- **Customer-visible sandbox-minute UI** — Phase 3.5+.
- **Multi-region / data residency** — Phase 4+.
- **Self-hosted sandbox (Firecracker on our infra)** — vendor adapter preserves swap-out; revisit per Decision 1 triggers (25% of LLM spend or sovereign customer).
- **Routing policy** (choosing between sandbox vendors per task) — Phase 3.5+.

---

## 5. What unblocks when Spec B ships

- **Phase 2 features unblock immediately** — Revenue Ops, Research Intelligence, data transformations, Dev Agent partial MVP.
- **Cost controls become enforceable** — wall-clock + cost ceilings prevent the first runaway-LLM incident.
- **OpenClaw adapter has its sandbox primitive ready** — one of three prerequisites complete (A done, B done, C still pending).

---

## 6. Next steps

1. **Operator reviews this brief, locks scope.**
2. **Spawn a new Claude Code session** for this build slug; the session adopts the `spec-coordinator` playbook (`.claude/agents/spec-coordinator.md`).
3. **Session runs:** brief intake (this doc) → spec authoring → `spec-reviewer` → `chatgpt-spec-review` → handoff for Phase 2 build.
4. **Phase 2 build session** kicks off after spec is `accepted`.
5. **Branch:** `claude/sandbox-isolation-{nonce}` off post-A `main`.

---

## End of brief
