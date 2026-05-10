**Status:** Draft v2
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

**Security invariant.** Customer-derived code, customer-uploaded file parsing, LLM-emitted scripts, and untrusted transformation logic MUST execute only inside `SandboxExecutionService`. The worker process may orchestrate, validate, harvest, and persist results, but must not execute customer-derived code directly. This is the durable anchor for Spec B and every successor adapter.

This is a **scoping brief**, not the spec. The output is locked scope; the full Spec B is authored next in this build slug.

---

## 1. What's locked from upstream

Decided in `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` Decision 1 and confirmed in Spec A:

- **Vendor:** e2b. Vendor adapter pattern preserves swap-out (Modal / Daytona / self-hosted Firecracker remain swappable). Brand styled `e2b` (lowercase) throughout this build slug.
- **Hosted, not in-house.** No Docker-per-task on our hosts in V1. Phase 2 is blocked on this; e2b ships in weeks vs months for self-hosted.
- **One account, two projects** (prod + staging), one billing relationship. **No tenant-specific e2b projects in V1** — multi-tenancy is enforced through metadata tags and our own scoping logic, not provider-level project boundaries. Local dev uses Docker Compose with the same Dockerfile, no e2b account required.
- **Two templates total:** `synthetos-sandbox` (ephemeral Tier 4 tasks) and `openclaw-session` (long-running autonomous sessions; image authored here but consumed by the OpenClaw adapter spec).
- **Multi-tenancy via metadata tags**, not e2b-level isolation. One sandbox per task; tags carry `org_id`, `subaccount_id`, `run_id`, `agent_id`.

---

## 2. What Spec B must define

1. **`SandboxExecutionService` interface.** The primitive adapters call. Shape: `runTask(input) → output`. Adapters (today `iee_dev`, future OpenClaw) consume it; the vendor implementation is hidden behind it.
2. **Three implementations** of the interface:
   - `e2bSandbox` — production / staging
   - `localDockerSandbox` — local dev
   - `inlineSandbox` — unit tests only, no isolation, dangerous-but-explicit. **MUST fail fast outside `NODE_ENV=test` or an explicit pure-test harness.** Production, staging, preview, and local dev must never resolve to it; local dev uses `localDockerSandbox`.
   - Resolution via `SANDBOX_PROVIDER` env var, with the test-only guard above enforced at provider construction.
3. **Output contract.** Inside the sandbox, conventional paths:
   - `/workspace/output.json` — structured result (mandatory, Zod-validated)
   - `/workspace/artefacts/` — files to keep (uploaded to our object storage). Naming aligned with existing `artefact` usage in run-trace surfaces; if `artifact` appears anywhere in the codebase today, Spec B picks one spelling and migrates the other in the same change.
   - `/workspace/logs/stdout.log` + `stderr.log` — captured logs
   - Anything outside these paths is discarded at sandbox close.
4. **Harvest mechanism.** After sandbox terminal, the adapter reads outputs via e2b SDK file API, uploads artefacts to existing object storage, writes log rows to existing log tables, writes cost row to ledger. **Harvest, artefact upload, log persistence, and cost-ledger writes MUST be idempotent by `sandboxExecutionId`** (and `runId` / `taskId` where applicable). Retrying after a worker crash must not duplicate artefacts, logs, or billing rows.
5. **Redaction layer.** Harvested outputs, logs, and artefacts MUST pass through a redaction / safety layer before persistence. Known credential patterns, injected secret values, and provider tokens must not be written to logs, artefacts, object storage metadata, or run trace surfaces. Spec B pins the redaction contract: where it runs, which pattern set is enforced, and fail-closed behaviour when scanning itself fails.
6. **Cost ledger — single canonical target.** Spec B chooses one cost-ledger write target and avoids parallel accounting paths. If `llm_requests` is reused, Spec B must justify why non-LLM compute belongs there and define the exact row shape (`source_type = 'sandbox_compute'`, `vcpu_seconds`, `wall_clock_ms`, `e2b_cost_cents`, indexes, aggregation contract). If a separate table is introduced, the spec must define its relationship to the existing ledger and the joined query shape used by metering.
7. **Wall-clock + cost ceiling per task.** Hard limits set at sandbox start; sandbox auto-terminates at either threshold. **Enforced provider-side where e2b supports it, with a worker-side fallback** — never enforced only in application logic. **V1 mandatory** — without it, runaway LLM loops burn real money.
8. **Per-customer sandbox-minute metering.** Aggregations queryable from day one. **`subaccountId` is the minimum billing attribution grain; both `organisationId` and `subaccountId` rollups must be queryable.** UI dashboard NOT required in V1; the data must exist and be queryable from the first deploy.
9. **Sub-account credential scoping.** The sandbox receives only task-scoped, sub-account-scoped credentials required for the specific operation. Secrets must be **short-lived where provider support allows**, **redacted from logs**, **excluded from harvested artefacts**, and **traceable through an audit event**. The sandbox never sees credentials belonging to a different sub-account.
10. **Runtime posture — default-deny.** Sandbox filesystem, network, credential injection, artefact size, and runtime package installation must be explicitly allowed by policy. Anything not required for V1 task execution is denied or omitted. Spec B must pin V1 defaults for:
    - Outbound network: allow-list, or deny-by-default with explicit per-task egress
    - Writable filesystem area (V1 default: `/workspace` only)
    - Credential injection mechanism (env var vs mounted file vs short-lived token)
    - Maximum artefact size and total artefact bytes per task
    - Runtime package install: yes / no / policy-gated
11. **Terminal-state taxonomy + retry posture.** Spec B defines terminal states and the retry / billing / visibility posture for each:
    - Completed successfully
    - Timed out (wall-clock ceiling)
    - Cost-ceiling terminated
    - Crashed
    - Output validation failed (missing `/workspace/output.json` or Zod failure)
    - Harvest failed (post-execution read failure)
    - Artefact upload failed
    - Provider unavailable
    Each terminal state declares whether it is user-visible, retryable, billable, and audit-worthy.
12. **Observability.** Every sandbox execution MUST emit structured telemetry tied to `organisationId`, `subaccountId`, `runId`, `agentId`, `taskId`, `sandboxExecutionId`, `provider`, `templateVersion`, `wallClockMs`, and `terminalState`. Required structured events at minimum: sandbox start, sandbox terminal, timeout, cost-ceiling termination, output validation failure, harvest failure, artefact upload failure, credential injection denied / missing, provider unavailable.
13. **Template build pipeline.** CI job that builds `synthetos-sandbox` (and `openclaw-session`) Docker images from `infra/sandbox-templates/`, pushes to e2b template registry on tag bump. Same Dockerfile used by `docker-compose` for local dev.
14. **Migration path from collapsed `iee_dev`.** Today `iee_dev` collapses untrusted code execution into the worker process. Spec B splits this: `iee_dev` adapter starts consuming `SandboxExecutionService` for the untrusted-execution portion; the trusted "Terminal / Repo" portion (Tier 5) stays in the worker. The split is pinned by the classification table below — there is no "small script" exception that lets customer-derived code back into the worker.

### 2a. Execution classification (Spec B must enforce this table)

| Execution class | Examples | Runs where |
|---|---|---|
| Customer-uploaded data parsing | CSV, Excel, PDF, doc parsing | **Sandbox** |
| LLM-emitted scripts over customer data | Python / JS transforms generated by an agent | **Sandbox** |
| Customer-derived transformation logic | Anything whose source is a customer input or LLM output | **Sandbox** |
| Deterministic internal orchestration | Adapter routing, run metadata, harvest plumbing | Worker |
| Trusted repo / dev operations | Controlled, non-customer repo commands | Worker (V1) — explicitly NOT customer-derived code |

If in doubt, it runs in the sandbox. There is no third tier.

---

## 3. Concurrent build note

Spec B runs in parallel with **Spec C — Operator Session Identity** (`tasks/builds/operator-session-identity/brief.md`). The two specs touch different code surfaces:

- B = `server/services/sandbox*`, `infra/sandbox-templates/`, cost ledger extension, `iee_dev` adapter rewiring.
- C = `server/services/credentialBroker*`, OAuth callback handlers, new consent-log table, connection UI.

**No code-area conflicts.** Both touch `architecture.md` (different sections) and `llm_requests` schema (different `source_type` values). Doc-sync sweep at finalisation reconciles. Either spec can land first; the second rebases.

Cross-coordination points (be aware, not blocking):

- **Cost ledger row types.** B adds `'sandbox_compute'`; C adds `'subscription_mediated'`. Coexist on a single agent run for OpenClaw later. Each spec defines its own row type independently.
- **Sub-account scoping.** Both must enforce it. B threads sub-account ID through sandbox metadata; C inherits from existing CredentialBroker behaviour (PR #279).
- **Credential redaction patterns.** B's redaction layer (§2.5) and C's CredentialBroker logging behaviour must agree on the pattern set. The first spec to land defines the shared patterns; the second consumes them rather than forking.

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

## 6. Scope invariants for Spec B

Lock-ready invariants. The spec is non-conformant if any are violated.

- Customer-derived code, customer-uploaded file parsing, and LLM-emitted scripts MUST NOT execute in the worker process.
- `SandboxExecutionService` is the only approved execution boundary for untrusted Tier 4 code execution.
- Sandbox execution MUST be scoped to one task / run and tagged with organisation, subaccount, run, and agent metadata.
- Injected credentials MUST be task-scoped, subaccount-scoped, redacted from logs, and excluded from harvested artefacts. Short-lived where provider support allows.
- Harvested outputs, logs, and artefacts MUST pass through a redaction / safety layer before persistence.
- Harvest, artefact upload, log persistence, and cost-ledger writes MUST be idempotent by `sandboxExecutionId`.
- Wall-clock and cost ceilings are mandatory in V1 and must fail closed; provider-side enforcement where supported, worker-side fallback otherwise.
- Default-deny posture for sandbox filesystem, network, credential injection, artefact size, and runtime package installation.
- `inlineSandbox` is test-only and must fail fast outside approved test harnesses.
- Spec B must define terminal states, retry posture, billing posture, and structured telemetry for every sandbox execution.
- One canonical cost-ledger write target — no parallel accounting paths.

---

## 7. Next steps

1. **Operator reviews this brief, locks scope.**
2. **Spawn a new Claude Code session** for this build slug; the session adopts the `spec-coordinator` playbook (`.claude/agents/spec-coordinator.md`).
3. **Session runs:** brief intake (this doc) → spec authoring → `spec-reviewer` → `chatgpt-spec-review` → handoff for Phase 2 build.
4. **Phase 2 build session** kicks off after spec is `accepted`.
5. **Branch:** `claude/sandbox-isolation-{nonce}` off post-A `main`.

---

## End of brief
