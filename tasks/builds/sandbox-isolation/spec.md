**Status:** draft
**Spec date:** 2026-05-11
**Last updated:** 2026-05-11
**Author:** main session (Opus, spec-coordinator playbook)
**Build slug:** sandbox-isolation
**Source brief:** `tasks/builds/sandbox-isolation/brief.md` (v5, 2026-05-10)
**Parent strategy:** `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` (Decision 1)
**Predecessor spec:** `tasks/builds/execution-backend-adapter-contract/spec.md` (shipped PR #281)
**Sibling spec (concurrent):** `tasks/builds/operator-session-identity/spec.md` (Spec C, in flight)
**Successor:** `tasks/builds/openclaw-adapter/scope.md`
**Branch:** claude/evolve-sandbox-isolation-brief-Q51hc

---

# Spec B — Sandbox Isolation

The e2b-backed sandbox primitive that adapters consume for Tier 4 untrusted code execution. Provides the `SandboxExecutionService` interface, three implementations (`e2bSandbox` / `localDockerSandbox` / `inlineSandbox`), the output / harvest pipeline (validate → redact → persist → ledger), wall-clock + cost ceilings, sub-account credential scoping, terminal-state taxonomy, observability, and the migration path that splits `iee_dev`'s collapsed worker-execution into worker-orchestration + sandbox-execution.

This is the implementation spec for the locked brief. Every brief invariant in §6 is encoded here; the spec is non-conformant if any drifts.

---

## Table of Contents

1. Purpose, scope, framing
2. Goals
3. Non-goals
4. Framing assumptions
5. Verify present state
6. Existing primitives — reuse / extend / new
7. Domain model + execution classification
8. Architecture
   - 8.1 `SandboxExecutionService` interface
   - 8.2 Provider implementations
   - 8.3 Output contract
   - 8.4 Harvest pipeline
9. Runtime posture (default-deny)
10. Wall-clock + cost ceilings
11. Credential scoping
12. Cost ledger + metering
13. Terminal-state taxonomy + retry posture
14. Observability + telemetry
15. Template build pipeline + version pinning
16. Provider availability + fallback
17. Retention + deletion
18. Migration path — splitting `iee_dev`
19. File inventory lock
20. Contracts (consolidated)
21. RLS / permissions checklist
22. Execution model
23. Phase plan + dependency graph
24. Execution-safety contracts
25. Testing posture
26. Concurrent build coordination (Spec C)
27. Deferred items
28. Locked V1 decisions (formerly open questions)
29. Self-consistency pass result

---

## 1. Purpose, scope, framing

Spec A landed the `ExecutionBackend` adapter contract and the `iee_dev` adapter. The adapter declares `sandboxRequirement: 'code_execution'` (`server/services/executionBackends/ieeDevBackend.ts:36`) but no real sandbox exists yet — customer-derived code currently runs in the worker process. Spec B fills that gap by introducing `SandboxExecutionService` and the e2b-backed provider implementation, and rewires `iee_dev` to consume it.

**Security invariant (durable, anchors the whole spec).** Customer-derived code, customer-uploaded file parsing, LLM-emitted scripts, and untrusted transformation logic MUST execute only inside `SandboxExecutionService`. The worker process may orchestrate, validate, harvest, and persist results, but must not execute customer-derived code directly.

**Why now.** Four Phase 2 features are blocked on this:
- Revenue Ops Assistant (customer-uploaded CSV / Excel parsing)
- Research Intelligence (customer-uploaded PDF / document processing)
- Data transformations (LLM-emitted scripts running on customer data)
- Dev Agent partial MVP (sandbox-assisted scripts and tests)

Each runs code derived from customer-supplied input. Without per-task isolation, a malicious or buggy customer file runs inside the shared worker process and can affect every other tenant's task.

**Vendor / hosting model (locked upstream by Decision 1).** Hosted on e2b (lowercase brand). One e2b account, two projects (prod + staging), one billing relationship. No tenant-specific e2b projects in V1; multi-tenancy is enforced through metadata tags + our own scoping logic, not provider-level project boundaries. Local dev uses Docker Compose with the same Dockerfile, no e2b account required. Two templates total: `synthetos-sandbox` (ephemeral Tier 4) and `openclaw-session` (long-running autonomous sessions; image authored here, consumed by the OpenClaw adapter spec). Vendor adapter pattern preserves swap-out (Modal / Daytona / self-hosted Firecracker remain swappable).

---

## 2. Goals

G1. Define and ship `SandboxExecutionService` as the single approved boundary for untrusted Tier 4 code execution.

G2. Deliver three provider implementations of the same interface — `e2bSandbox` (prod / staging), `localDockerSandbox` (local dev, template-parity), `inlineSandbox` (test-only, fail-fast outside test harness).

G3. Pin an immutable output contract (`/workspace/output.json` + `/workspace/artefacts/` + `/workspace/logs/{stdout,stderr}.log`) and harvest pipeline (validate → redact → persist) such that sandbox outputs remain untrusted until normalised.

G4. Make harvest, artefact upload, log persistence, and cost-ledger writes idempotent by `sandboxExecutionId`. Worker crashes must not duplicate artefacts, logs, or billing rows.

G5. Enforce wall-clock + cost ceilings per task. Provider-side where e2b supports it, worker-side fallback otherwise. Sandbox auto-terminates at either threshold.

G6. Inject task-scoped, sub-account-scoped, short-lived credentials. Redacted from logs and excluded from harvested artefacts. The sandbox never sees credentials belonging to a different sub-account.

G7. Default-deny posture for sandbox filesystem, network, credential injection, artefact size, runtime package installation. Preflight input validation BEFORE sandbox creation rejects invalid / oversized inputs without paying for a sandbox start.

G8. Pin a closed terminal-state taxonomy (8 states) with declared retry / billing / visibility / audit posture per state.

G9. Emit structured telemetry for every sandbox execution. Tagged with `organisationId`, `subaccountId`, `runId`, `agentId`, `taskId`, `sandboxExecutionId`, `provider`, `templateVersion`, `wallClockMs`, `terminalState`.

G10. RLS / scoping-enforce every sandbox-derived row (telemetry, logs, artefacts, cost). No sandbox-derived row queryable outside the owning org / subaccount.

G11. Single canonical cost-ledger write target. Extend `llm_requests` with `source_type = 'sandbox_compute'`; no parallel accounting paths. Append-only / correction-based, never silent overwrite. Both `organisationId` and `subaccountId` rollups queryable from day one.

G12. Pin and record immutable template version / digest on every execution. No floating `latest` for production.

G13. Provider unavailability fails closed. No silent fallback to worker execution or `inlineSandbox`. Acceptable responses: queue + retry, surface typed failure to the run, or hard-fail with audit trail.

G14. Define retention + deletion posture for harvested logs / artefacts. Sandbox filesystems are ephemeral execution surfaces, not persistence layers — only explicitly harvested, validated, redacted outputs may be retained. Ledger rows retained / anonymised / correction-reversed on run deletion — never physically deleted in a way that breaks finance or audit trails.

G15. Split `iee_dev`'s collapsed execution path. Adapter consumes `SandboxExecutionService` for the untrusted-execution portion; trusted "Terminal / Repo" portion (Tier 5) stays in the worker. No "small script" exception lets customer-derived code back into the worker.

---

## 3. Non-goals

Out of scope for Spec B (lifted directly from brief §4):

- **OpenClaw `openclaw-session` template contents** (Codex CLI install, OpenClaw process wiring) — OpenClaw adapter spec.
- **Long-lived session semantics** (`Sandbox.connect()` pattern for hour-long sessions) — OpenClaw adapter spec. Spec B's `runTask` contract is single-task, ephemeral.
- **The OpenClaw adapter itself** — Phase 3 spec.
- **Sandbox cost passthrough vs bundling in plan tiers** — pricing decision, not Spec B.
- **Customer-visible sandbox-minute UI** — Phase 3.5+. The metering data must be queryable from day one; the UI is deferred.
- **Multi-region / data residency** — Phase 4+.
- **Self-hosted sandbox (Firecracker on our infra)** — vendor adapter preserves swap-out; revisit per Decision 1 triggers (25% of LLM spend or sovereign customer).
- **Routing policy** (choosing between sandbox vendors per task) — Phase 3.5+.
- **Migrating the `artefact` / `artifact` naming across the wider codebase** — out of scope unless required for the sandbox interface itself.
- **Sandbox-vs-worker decision plumbing for non-Tier-4 paths** — the execution classification table in §7 pins the dispatch rule; rewiring decision logic outside `iee_dev` is not in scope here.

---

## 4. Framing assumptions

- Pre-production. No live users, no live agencies. `commit-and-revert` rollout. Behaviour-mode flags only; no rollout gates. (Per `docs/spec-context.md`.)
- Testing posture: `static_gates_primary`, `runtime_tests: pure_function_only`. Spec B authors pure tests for every new decision helper (`*ServicePure.ts`) and relies on existing CI gates (RLS coverage, RLS contract compliance, manifest enforcement). No vitest / supertest / E2E against the app.
- Existing primitives are preferred over new ones per `docs/spec-context.md § accepted_primitives`. Spec B reuses `withBackoff`, `failure() + FailureReason`, `runCostBreaker`, `RLS_PROTECTED_TABLES`, `withOrgTx / getOrgScopedDb`, `redactValue`, `credentialBrokerService`, `createWorker`, and the existing S3 / object-storage client.
- Spec A's `ExecutionBackend` interface (`server/services/executionBackends/types.ts`) is the consumer contract above the sandbox boundary; Spec B's `SandboxExecutionService` sits below it. No changes to Spec A's interface in this spec.
- Concurrent with Spec C. Different code surfaces (§26). Either can land first; the second rebases. Shared design points: `llm_requests.source_type` enum extension (B adds `sandbox_compute`, C adds `subscription_mediated`); sub-account scoping (both enforce); credential redaction patterns (first to land defines the shared bundle).
- Brief §6 invariants are non-negotiable acceptance criteria. The self-consistency pass (§29) checks each invariant against the spec.

## 5. Verify present state

Per `docs/spec-authoring-checklist.md § Section 0`, every spec that draws from deferred items in `tasks/todo.md` or a prior mini-spec must verify each cited item against current state.

**Spec B is greenfield.** It does not draw items from `tasks/todo.md`. It introduces a new service, three new implementations, a new template directory, a new `source_type` value, and rewires one existing adapter. There are no prior deferred items to verify open / closed.

The only adjacent in-flight assertion to verify is from Spec A itself: that `iee_dev` declares `sandboxRequirement: 'code_execution'` but does not enforce it. Verified open: `server/services/executionBackends/ieeDevBackend.ts:36` declares the requirement; the adapter's `dispatch()` currently delegates to the existing worker rather than a sandbox primitive.

---

## 6. Existing primitives — reuse / extend / new

The following table is the source of truth for which primitives Spec B reuses versus introduces. Per `docs/spec-authoring-checklist.md § Section 1`, each "new primitive" path requires a one-paragraph justification (placed in the relevant architecture section).

| Capability | Existing primitive | File | Decision |
|---|---|---|---|
| Retry / backoff | `withBackoff` | `server/lib/withBackoff.ts` | **Reuse.** Provider unavailability + harvest retry both wrap with `withBackoff`. |
| Typed failure surface | `failure() + FailureReason` enum | `shared/iee/failure.ts` | **Reuse + extend.** Add sandbox-specific `FailureReason` values (`sandbox_timeout`, `sandbox_cost_ceiling`, `sandbox_output_invalid`, `sandbox_harvest_failed`, `sandbox_artefact_upload_failed`, `sandbox_provider_unavailable`, `sandbox_credential_denied`, `sandbox_input_rejected`). |
| Per-run cost ceiling | `runCostBreaker` | `server/lib/runCostBreaker.ts` | **Reuse + extend.** Sandbox cost contributes to the same per-run aggregate; sandbox-side wall-clock + cost ceilings are separate but feed `cost_aggregates` via the harvest writer. |
| Redaction pattern engine | `redactValue` + `DEFAULT_REDACTION_PATTERNS` | `server/lib/redaction.ts` | **Reuse.** Spec B's harvest pipeline calls `redactValue` against `output.json`, stdout/stderr lines, and artefact metadata. Shared with Spec C (see §26). |
| Credential issuance + injection | `credentialBrokerService.issueCredential` / `injectIntoEnvironment` | `server/services/credentialBrokerService.ts` | **Reuse + extend.** Add a sandbox-specific injection path (mounted file in `/workspace/secrets/`, env-var bridge, or short-lived token), §11. |
| RLS manifest enforcement | `RLS_PROTECTED_TABLES` + `verify-rls-coverage.sh` / `verify-rls-contract-compliance.sh` | `server/config/rlsProtectedTables.ts`, `scripts/gates/` | **Reuse.** All new sandbox tables (`sandbox_executions`, `sandbox_artefacts`, `sandbox_telemetry_events`, `sandbox_egress_audit`) added to the manifest in the same migration that creates them. |
| Org-scoped DB access | `withOrgTx` / `getOrgScopedDb` / `withAdminConnection` | `server/middleware/orgScoping.ts` | **Reuse.** Harvest writer uses `withOrgTx` per execution; admin-only reconciliation paths use `withAdminConnection`. |
| Cost ledger | `llm_requests` table | `server/db/schema/llmRequests.ts` | **Reuse + extend.** Spec B extends the `sourceType` enum to include `sandbox_compute` and lands a Spec-B-specific CHECK constraint pairing `sandbox_compute` with sandbox-specific columns (see §12). |
| Pg-boss worker harness | `createWorker` | `server/lib/createWorker.ts` | **Reuse.** Used by the reconciliation, ceiling-monitor, telemetry-prune, egress-audit-prune, and artefact-purge jobs (§19.1, §22). Harvest itself is inline within `runTask` for the happy path (§22) — no `sandbox-harvest` queue is introduced. |
| Object storage | S3-compatible client | `server/lib/storage.ts` | **Reuse.** Artefact upload uses the existing client; sandbox artefacts live under a separate prefix (`sandbox-artefacts/{orgId}/{subaccountId}/{sandboxExecutionId}/`). |
| Execution event telemetry | `agentExecutionEventService` + criticality registry | `server/services/agentExecutionEventService.ts`, `shared/types/agentExecutionLog.ts` | **Adjacent, not reused directly.** Sandbox emits its own structured-log events tied to the run via `runId`, but does not write to `agent_execution_events` (different lifecycle granularity — sandbox is per-task, agent events are per-run). The new sandbox event types are still part of the overall run trace via `runId` correlation. |
| Adapter contract | `ExecutionBackend` interface | `server/services/executionBackends/types.ts` | **Reuse.** No changes; Spec B sits below this boundary. |
| **NEW** Sandbox execution service interface | n/a | new — see §8.1 | **New.** No existing primitive provides per-task isolated execution with policy-bounded runtime, harvest pipeline, and provider-swappable backends. Closest neighbour is the worker itself, which is what we're trying to remove from the customer-code path — reuse is the bug, not the fix. |
| **NEW** Sandbox template build pipeline | n/a — `infra/sandbox-templates/` does not exist | new — see §15 | **New.** Templates are infrastructure artefacts (Docker images shared by e2b and Docker-Compose); pinned via CI tag-bump. |
| **NEW** Per-execution sandbox telemetry table | n/a | new — see §14 | **New.** `sandbox_telemetry_events` table stores structured events at sandbox-lifecycle granularity (start / terminal / timeout / harvest_failed / artefact_upload_failed / credential_denied). Cannot reuse `agent_execution_events` because the criticality registry, criticality semantics, and per-event types are different — and one agent run can contain many sandbox executions. |
| **NEW** Sandbox egress audit table | n/a | new — see §9 | **New.** Required when outbound network is allowed (§9). Records destination class, task / run identity, credential context, deny / allow outcome per egress decision. |

### Why a new `SandboxExecutionService` interface (not extension of `ExecutionBackend`)

`ExecutionBackend` is the adapter contract — it answers "which backend dispatches this run?" `SandboxExecutionService` is the primitive an adapter calls when it needs to execute untrusted code as part of dispatching. They are different layers:

- Multiple `ExecutionBackend` adapters (today `iee_dev`, tomorrow OpenClaw) call the same `SandboxExecutionService`.
- An `ExecutionBackend` may not need a sandbox at all (Tier 5 / trusted repo paths).
- The sandbox primitive needs three provider implementations swappable via env var; `ExecutionBackend` adapters need three distinct backend kinds wired via routing. Different lifecycle, different consumers.

Reuse via extension would force `ExecutionBackend` to grow a `runSandboxedTask()` method nobody outside the sandbox-consuming adapters needs, and would couple swap-out of the sandbox vendor to swap-out of an adapter — exactly the coupling Decision 1's vendor-adapter pattern was designed to prevent.

---

## 7. Domain model + execution classification

### 7.1 Concepts

- **Sandbox execution.** A single, ephemeral, per-task isolated runtime: inputs in → `output.json` + artefacts + logs out → terminated. Identified by `sandboxExecutionId` (UUID). Tagged with `organisationId`, `subaccountId`, `runId`, `agentId`, `taskId`, `provider`, `templateName`, `templateVersion`.
- **Sandbox provider.** One of `e2b` / `local_docker` / `inline`. Selected by `SANDBOX_PROVIDER` env var; `inline` rejected outside test harness (§8.2).
- **Sandbox template.** A pre-baked Docker image (`synthetos-sandbox` for Spec B, `openclaw-session` for the OpenClaw adapter spec) consumed identically by `e2bSandbox` and `localDockerSandbox`. Templates have an immutable version / digest pinned per execution.
- **Task.** A single unit of work passed to `SandboxExecutionService.runTask`. One task = one sandbox execution; no task reuses a sandbox. (Long-lived sessions are an OpenClaw adapter concern, not Spec B.)
- **Run.** The umbrella `agent_runs` row that may contain zero or many sandbox executions, plus orchestration steps that run in the worker. `runId` is the correlation key across telemetry, logs, artefacts, cost rows.
- **Harvest.** The post-terminal pipeline that reads outputs from a closed sandbox and persists them: schema-validate `output.json` → redact → store artefacts → emit logs → write cost row. Idempotent by `sandboxExecutionId`.

### 7.2 Execution classification table (locked)

This table is the dispatch rule. The `iee_dev` adapter (and any future adapter) MUST honour it. Spec B's CI gate (`verify-sandbox-classification`, §25) checks any code path that calls into a runtime against this table.

| Execution class | Examples | Runs where |
|---|---|---|
| Customer-uploaded data parsing | CSV, Excel, PDF, doc parsing | **Sandbox** |
| LLM-emitted scripts over customer data | Python / JS transforms generated by an agent | **Sandbox** |
| Customer-derived transformation logic | Anything whose source is a customer input or LLM output | **Sandbox** |
| Deterministic internal orchestration | Adapter routing, run metadata, harvest plumbing | Worker |
| Trusted repo / dev operations | Controlled, non-customer repo commands | Worker (V1) — explicitly NOT customer-derived code |

**No third tier.** If in doubt, it runs in the sandbox. There is no "small script" exception that lets customer-derived code back into the worker. The CI gate enforces this — see §25.

### 7.3 Source-of-truth precedence

When multiple representations of the same fact exist (cost in sandbox telemetry vs `llm_requests` row, terminal state in `sandbox_executions` row vs telemetry event), the precedence is:

1. **`sandbox_executions` row** wins for terminal state, provider info, and template version.
2. **`llm_requests` row** wins for billable cost. Sandbox telemetry's `wallClockMs` / `vcpuSeconds` feeds the ledger but the ledger row is canonical for finance.
3. **`sandbox_telemetry_events`** is the per-event audit trail. It must agree with the row-canonical representations above; on disagreement, it is read-only-correctable (an event reflecting the row's authoritative state can be appended; existing events are never rewritten).
4. **Artefact files in object storage** are content. Their existence / size is tracked in row state. Storage is authoritative for content; row state is authoritative for "harvested? yes / no".

## 8. Architecture

### 8.1 `SandboxExecutionService` interface

`SandboxExecutionService` is the only approved boundary for untrusted Tier 4 code execution. Adapters (today `iee_dev`, future OpenClaw) consume it. The vendor implementation is hidden behind it. The interface is the single seam at which Spec B's swap-out invariant applies — three implementations share one shape.

**Surface (architecture-level, no signatures):**

- **`runTask(input) → output`.** One call per task. The caller passes a typed input descriptor; the call resolves when the sandbox terminates (success / timeout / cost-ceiling / crash / etc.) and the harvest pipeline has produced a normalised output. The caller never sees raw, unredacted, unvalidated sandbox output.
- **`getExecution(sandboxExecutionId)`.** Read-side helper for reconciliation paths (provider webhooks, ambiguous-terminal recovery). Returns the canonical `sandbox_executions` row.

**Input descriptor (consumer-facing contract).** Pinned in §20 (Contracts). Required fields: `sandboxExecutionId` (idempotency key, caller-generated UUID), `organisationId`, `subaccountId`, `runId`, `agentId`, `taskId`, `templateName`, `templateVersion`, `policy` (the runtime-posture policy — §9), `inputBytes` (size-validated, redaction-aware), `inputFiles[]` (preflight-validated paths + content hashes), `credentialIssuanceContext` (which credentials to materialise inside the sandbox — §11), `ceilings` (`wallClockMs`, `costCents` — §10).

**Output contract (caller-facing).** Pinned in §20. Required fields: `sandboxExecutionId`, `terminalState` (one of the 8 from §13), `output` (the validated, redacted `output.json` content), `artefactRefs[]` (signed-URL handles to stored artefacts), `logRefs` (handles to stdout/stderr log persistence), `metrics` (`wallClockMs`, `vcpuSeconds`, `peakMemoryMb`, `egressBytes`), `costCents` (provider-reported + corrected), `templateName`, `templateVersion`, `provider`.

**Idempotency.** `runTask` is idempotent by `sandboxExecutionId`. A retry with the same ID returns the canonical row + output if the previous attempt terminated; otherwise it joins the in-flight attempt (no second sandbox starts). DB-level guarantee: `UNIQUE (sandbox_execution_id)` on `sandbox_executions` + state-based atomic claim.

**Error model.** Failures surface as `FailureError` instances with `FailureReason` values from §6 (e.g., `sandbox_timeout`, `sandbox_cost_ceiling`, `sandbox_provider_unavailable`). No exceptions that are not `FailureError` are surfaced to callers — internal exceptions either retry under `withBackoff` or get reclassified.

**Pure helper module.** A sibling `sandboxExecutionServicePure.ts` carries the policy → provider-flags mapping, the `terminalState` classification helper, and the cost-attribution logic. Pure tests target these (§25).

### 8.2 Provider implementations

Three implementations share `SandboxExecutionService`. Resolution happens at service construction time from `SANDBOX_PROVIDER` env var. The resolver applies environment-specific hard guards:

- `e2b` — accepted in any environment (production, staging, local dev, test).
- `local_docker` — accepted only when `NODE_ENV !== 'production'`. The resolver throws if `SANDBOX_PROVIDER=local_docker` is set against `NODE_ENV=production`, preventing local-dev wiring from reaching production.
- `inline` — accepted only when `NODE_ENV === 'test'` AND `SANDBOX_ALLOW_INLINE=1`. The resolver throws otherwise (covers staging, preview, local dev, production). This is what closes the "silent fallback to in-process execution" hole forbidden by brief §2.2 / §6 invariants.

The resolver throws at construction time (boot-time fail-fast), not on first call — so a misconfigured environment never starts the service at all.

#### 8.2.1 `e2bSandbox` (production / staging)

- Backed by the e2b SDK.
- One sandbox per task. No pooling, no reuse. Sandbox start → `runTask` → terminal → close → harvest.
- Sandbox is tagged at creation with `{ org_id, subaccount_id, run_id, agent_id, task_id, sandbox_execution_id, template_name, template_version }`. Metadata tags are the multi-tenancy boundary (Decision 1 locked this — no tenant-specific e2b projects in V1).
- Provider-side ceiling enforcement: wall-clock + cost limits configured at sandbox start where e2b supports it (`timeout` parameter). Worker-side fallback (§10) catches the cases the provider does not enforce.
- Provider terminal classification: e2b SDK terminal hooks feed `terminalState` via the pure classifier. Ambiguous provider terminals (network blip, SDK timeout without sandbox terminal) reconcile via `getExecution` + `withBackoff` retry, never via assumed success.

#### 8.2.2 `localDockerSandbox` (local dev)

- Backed by `docker-compose run --rm` against the same `synthetos-sandbox` Docker image used by e2b template publish (§15). Operator runs the sandbox locally without an e2b account.
- **Template parity contract.** The Dockerfile under `infra/sandbox-templates/synthetos-sandbox/` is the single source. `e2bSandbox` consumes its e2b-published version (by digest); `localDockerSandbox` consumes its local-built version. Parity gaps must be documented inline in `infra/sandbox-templates/synthetos-sandbox/README.md` — currently expected gaps:
  - **Network policy.** Local Docker runs in `--network=none` by default; e2b enforces network policy via its own networking layer. Gap: behaviours that depend on egress audit logging (§9) can only be exercised end-to-end against `e2bSandbox`.
  - **Cost enforcement.** `localDockerSandbox` has no cost; cost ceiling enforcement is a no-op locally. Wall-clock is enforced via `docker run --stop-timeout` + worker-side fallback.
  - **Provider-side telemetry.** Some e2b-specific telemetry fields (`provider`, `templateVersion`, `vcpuSeconds`) are populated locally with synthetic values flagged with `provider: 'local_docker'`.
- Local dev must use this — never `inline`. The provider resolver enforces this (§8.2 hard guard).

#### 8.2.3 `inlineSandbox` (test-only, dangerous-but-explicit)

- Runs the task in-process. **No isolation.** Exists only because pure unit tests for harvest-layer logic, cost classification, and redaction need a sandbox primitive they can call without spinning up Docker.
- **Hard guard.** The provider resolver throws if `inlineSandbox` is resolved outside `NODE_ENV === 'test'` AND a `SANDBOX_ALLOW_INLINE=1` test-harness flag. Production, staging, preview, and local dev MUST resolve to a non-inline provider; the hard guard is what closes the "silent fallback" hole that the brief §2.2 and §6 invariants forbid.
- Tests that use `inlineSandbox` MUST set the test-harness flag explicitly. The flag must NOT be present in `.env.example`, `.env.development`, or any non-test deployment manifest.

### 8.3 Output contract

The sandbox observes four fixed paths inside `/workspace`. Anything outside these paths is discarded at sandbox close — Spec B's harvest reads nothing else.

- **`/workspace/output.json`** — structured result. Mandatory. Zod-validated against the task's declared output schema (passed in the input descriptor). Missing file or schema failure → terminal state `output_validation_failed` (§13). Maximum size: pinned per task in the input descriptor (default cap: 1 MB; tasks needing larger output must declare it and the harvest writer rejects above-cap).
- **`/workspace/artefacts/`** — files to keep. Each file under this directory becomes a harvested artefact, uploaded to object storage (§8.4). Naming uses the existing `artefact` spelling consistent with the brief §2.3 invariant — Spec B does NOT introduce a second spelling in new sandbox APIs. The existing `run_artifacts` table's `artifactKind` enum is consulted but Spec B's artefact rows live in a separate sandbox-derived bucket (see §8.4) to avoid cross-coupling sandbox lifecycle with the existing run-artefact lifecycle.
- **`/workspace/logs/stdout.log`** + **`/workspace/logs/stderr.log`** — captured logs. Line-oriented. Bytes-capped (default cap: 10 MB per stream; over-cap is treated as an output-channel validation failure and routed to terminal state `output_validation_failed` with sub-reason `log_overflow` — see §13.1 sub-codes / §27). Harvested through the redaction pipeline (§8.4) before persistence.

**Untrusted-outputs invariant (brief §2.3).** `output.json`, log lines, and artefact manifests are untrusted until schema-validated, size-limited, redacted, and normalised. No downstream consumer (run state, user-visible surface, billing, or agent decision logic) reads raw sandbox output. The harvest pipeline (§8.4) is the gate.

**Anything outside the four paths.** Discarded at sandbox close. The harvest reader treats absence as absence — there is no "best-effort scrape the whole filesystem" fallback.

### 8.4 Harvest pipeline

Post-sandbox-terminal, the calling adapter (executing inline within the `runTask` call — §22) runs the harvest pipeline. The pipeline is a strict ordered set of steps; failure at any step writes the corresponding terminal state (§13) and stops the pipeline. If the worker process dies between sandbox terminal and harvest completion, the `sandbox-harvest-reconciliation` job (§19.1) re-enqueues the harvest.

**Steps (in order):**

1. **Terminal classification.** Provider-side terminal hooks feed `terminalState` via the pure classifier (`sandboxExecutionServicePure.classifyTerminal`). Ambiguous provider terminals fail closed → terminal state `provider_unavailable` (§13).
2. **Output read.** Read `/workspace/output.json` via the provider's file API. Absent → `output_validation_failed`. Over-size → `output_validation_failed` with a distinct sub-code.
3. **Output validate.** Zod-validate against the task's declared schema. Failure → `output_validation_failed`.
4. **Output redact.** Pass `output.json` content (parsed, walked) through `redactValue` with the default pattern bundle from `server/lib/redaction.ts` plus the sandbox-specific extensions from §11.
5. **Log read.** Read both stdout / stderr log files. Over-cap → `output_validation_failed` (sub-reason `log_overflow`). Each log line is redacted via `redactValue` before any persistence.
6. **Artefact enumeration.** List `/workspace/artefacts/`. Each file's metadata (name, size) is captured; content is read in a streaming fashion. Per-task max artefact size and total artefact bytes (default 10 MB / 100 MB; pinned per task in the input descriptor) — over-cap → `artefact_upload_failed` (sub-reason `artefact_oversized`).
7. **Artefact metadata redact.** Filenames and any extracted metadata pass through `redactValue` before storage. (A leaked credential in a filename is just as bad as a leaked credential in `output.json`.)
8. **Object storage upload.** Each artefact uploaded to S3 prefix `sandbox-artefacts/{orgId}/{subaccountId}/{sandboxExecutionId}/{filename}`. Upload failure → `artefact_upload_failed`. Idempotent on the `sandbox_artefacts` row keyed by `(sandbox_execution_id, filename)` — see §20.
9. **Log persistence.** Redacted log lines written to a sandbox-specific log surface tagged by `sandbox_execution_id`. Idempotent on `(sandbox_execution_id, log_stream, sequence)`. The concrete sink (new `sandbox_logs` table with RLS, OR extension of an existing structured-log layer that already enforces that key shape) is a build-time decision tracked in §27 deferred row `SANDBOX-DEF-LOG-SCHEMA`; whichever path is chosen MUST honour the idempotency key and the per-tenant RLS / scoping requirements from §14.4 / §21.
10. **Cost row write.** A single `llm_requests` row with `source_type = 'sandbox_compute'` (§12). Idempotent on `(sandbox_execution_id, source_type)` via a partial unique index.
11. **Telemetry terminal event.** One terminal event in `sandbox_telemetry_events` declaring the outcome (§14).
12. **`sandbox_executions` row update.** Atomic transition from `harvesting` to a terminal state (one of the 8 from §13) via `UPDATE ... WHERE status = 'harvesting'`. Optimistic concurrency: two harvest invocations (e.g., one from worker, one from reconciliation job) race; the second observes 0 rows updated and joins.

**Pipeline is one transaction per write step, not one transaction across all steps.** Long-running uploads must not hold a DB transaction. The cross-step idempotency contract is by `(sandbox_execution_id, step)` — each step is idempotent on its own write. Failure between steps surfaces as a partial state that the next harvest attempt can resume from (§24).

**Inputs to harvest.** Only the four paths in §8.3. No "let's also grab the rest of the filesystem in case." The brief's §2.15 retention invariant — "Sandbox filesystems are ephemeral execution surfaces, not persistence layers — only explicitly harvested, validated, redacted outputs may be retained" — is enforced by the pipeline shape itself.

**Reconciliation path.** If a worker crashes between sandbox terminal and harvest start (or between any two harvest steps), the `sandbox-harvest-reconciliation` job runs every 5 minutes (V1 cadence, pinned in §22) to find `sandbox_executions` rows stuck in non-terminal states past their wall-clock-ceiling-plus-buffer. The job re-enqueues the harvest for the affected execution. Idempotency at every step makes this safe to re-run.

## 9. Runtime posture (default-deny)

Spec B pins V1 runtime defaults for every dimension the sandbox can be configured along. Anything not required for V1 task execution is denied or omitted. The policy travels with the task in the input descriptor (see `policy` field in §8.1, contracted in §20).

### 9.1 Outbound network

**V1 default: deny-by-default + explicit per-task egress allow-list.** A task's `policy.network` declares one of:

- `none` — no egress. Default for V1 customer-data tasks (CSV / Excel / PDF parsing, transformation logic).
- `allowlist` — explicit per-task allow-list of `{ host, port, protocol }` triples. Used only when the task requires external data (e.g., fetching schema metadata, calling out to a permitted analysis API).

**Egress audit logging is mandatory whenever `network` is anything other than `none`.** Spec B introduces a `sandbox_egress_audit` table (§20). Every egress decision records: `sandbox_execution_id`, `destination_class` (`internal` / `customer` / `vendor` / `unknown`), `destination_host`, `destination_port`, `credential_context` (which issued credential, if any, was on the call path — never the credential value), `outcome` (`allow` / `deny`), `decision_at`. Full payload logging is NOT required and explicitly prohibited — payloads may contain customer PII.

**Interception mechanism — build-time decision** (see §27 deferred row `SANDBOX-DEF-EGRESS-MECH`). V1 candidates are (a) e2b SDK network-policy hooks if they expose per-decision callbacks, (b) an application-layer egress proxy outside the sandbox with mandatory routing from the template's entrypoint, or (c) CNI/eBPF-side hooks if e2b exposes them. The choice is made during the C12 template-build chunk after verifying which mechanism e2b actually exposes; the audit-row schema (§20.6) is unaffected by the choice. The schema is locked here; the writer is not.

**No egress = no egress audit row.** Tasks with `network: 'none'` skip egress logging entirely (zero audit rows). The audit table only exists for the cases where egress is permitted.

### 9.2 Filesystem

**V1 default: writable area is `/workspace` only.** Everything else is read-only or denied. Three subdirectories matter:

- `/workspace/input/` — task inputs land here. Read-only inside the sandbox.
- `/workspace/output.json`, `/workspace/artefacts/`, `/workspace/logs/` — the four output paths (§8.3). Writable.
- `/workspace/secrets/` — credentials injected by the broker (§11). Tmpfs-mounted, never persisted to disk image, redacted from any error trace.

Symlinks out of `/workspace` are rejected at sandbox start. Path traversal in the artefact enumerator (§8.4 step 6) is rejected before upload.

### 9.3 Credential injection mechanism

**V1 default: short-lived broker-issued credentials, mounted as files under `/workspace/secrets/`.** See §11 for the full credential-scoping contract. Two alternative mechanisms are NOT V1:

- **Env vars only.** Considered. Rejected for V1 because env vars are easier to accidentally print, log, or include in error messages. Mounted files require explicit file reads, which the redaction pipeline (§8.4 steps 5, 7) intercepts.
- **Long-lived tokens.** Forbidden. The broker only ever issues short-lived tokens where the provider supports it (e.g., AWS STS, Google service-account tokens). Where short-lived issuance isn't possible, the broker proxies the call from outside the sandbox; the sandbox never sees the long-lived secret.

### 9.4 Artefact size limits

**V1 default: 10 MB per artefact, 100 MB total per task.** Pinned in the input descriptor's `policy.artefactLimits`. Over-cap routes to terminal state `artefact_upload_failed` with sub-reason `artefact_oversized` (§13.1). The pure helper rejects above-limit before any upload.

### 9.5 Runtime package installation

**V1 prefers pre-baked template dependencies.** The `synthetos-sandbox` template (§15) ships with the dependency set Phase 2 features need (e.g., Python with pandas / pdfplumber / openpyxl for CSV / Excel / PDF parsing). Runtime install is NOT a customer-input-driven path.

**If runtime install is ever enabled in a future phase (deferred — §27):**
- Must be explicitly gated by `policy.allowRuntimeInstall` (default `false`).
- Must be logged via a structured telemetry event (`runtime_install_requested`, `runtime_install_completed`, `runtime_install_denied`).
- Must be time- and cost-bounded against the per-task ceilings (§10).
- Must be unavailable to arbitrary customer input — only LLM-emitted scripts vetted by an internal policy gate can trigger it, and even then only against an allow-list of package indices.

V1 ships with `allowRuntimeInstall: false` everywhere. Whether to enable it for the Dev Agent partial MVP only is a deferred decision tracked in §27.

### 9.6 Preflight input validation

**Pinned BEFORE sandbox creation. Invalid inputs never reach a paid sandbox start.** The preflight validator runs in the worker, prior to calling `runTask`. Validation rules:

- **Maximum input bytes per task.** Pinned per task type in `policy.inputLimits.maxBytes`. Default cap: 25 MB. Above-cap → `sandbox_input_rejected` failure before sandbox start. No `sandbox_executions` row written, no provider call made, no cost.
- **Allowed file types.** Pinned per task type as MIME-type allow-list. CSV / Excel / PDF parsing tasks accept the relevant MIME types; transformation tasks accept the LLM-emitted script's declared interpreter MIME.
- **MIME / type-sniffing posture.** File type is determined by content-sniffing (`file` magic-bytes), not extension. Mismatch between declared MIME and sniffed MIME → reject. Closes the "upload `.csv` that's actually a binary exploit" hole.
- **Failure behaviour BEFORE sandbox creation.** Spec B's `sandbox_input_rejected` is a distinct `FailureReason`. No telemetry events written, no cost row, no audit row — there's nothing to audit because no execution occurred. The rejection itself is recorded in the calling run's failure trace.

The `verify-sandbox-classification` CI gate (§25) checks that no `runTask` call path skips the preflight validator.

---

## 10. Wall-clock + cost ceilings

**Mandatory V1. Without it, runaway LLM loops burn real money.**

### 10.1 Two ceilings, both per-task

- **Wall-clock ceiling** (`policy.ceilings.wallClockMs`). Pinned per task in the input descriptor. Sandbox auto-terminates if this elapses. Default per task class: 60 s (CSV / Excel / quick scripts), 5 min (PDF parsing), 15 min (heavy transformations). Hard cap: 30 min for V1. Tasks needing more than 30 min are an OpenClaw concern, not Spec B.
- **Cost ceiling** (`policy.ceilings.costCents`). Pinned per task in the input descriptor. Sandbox auto-terminates if accumulated cost crosses this threshold. Default per task class: 1 cent (CSV / Excel), 10 cents (PDF parsing), 50 cents (heavy transformations). Hard cap: 200 cents (USD $2.00) per single task for V1.

The pure helper `resolveSandboxCeilings(input)` computes the active ceiling from the input descriptor + tenant overrides (if any — V1 has none). Lives in `sandboxExecutionServicePure.ts` so the same logic runs in tests, harvest, and reconciliation.

### 10.2 Enforcement (provider-side + worker-side fallback)

**Provider-side wherever e2b supports it.** The `e2bSandbox` constructor passes the wall-clock ceiling as the e2b SDK's `timeout` parameter. Provider terminates the sandbox at the limit. Cost ceiling provider-side enforcement: best-effort against e2b's billing API where supported; otherwise read-only-observable until the worker-side fallback fires.

**Worker-side fallback.** A `sandbox-ceiling-monitor` job (per execution, scheduled at execution start) wakes at `wallClockMs + buffer` AND polls provider cost at **5-second intervals** between sandbox start and the wall-clock ceiling. If the sandbox is still running past either ceiling and provider-side enforcement has not terminated it, the monitor calls the provider's terminate API directly. Job idempotent on `sandbox_execution_id`. The 5-second polling interval is a V1 parameter (locked in §28 #4); re-evaluation after first month of production cost data is a deferred ops task (§27).

**Never enforced only in application logic above the sandbox.** Application-layer "is this likely to run too long?" guesses don't count — that's not enforcement, that's wishful thinking. The brief §2.7 invariant — "provider-side where supported, worker-side fallback, never only app logic" — is encoded in this two-layer model.

### 10.3 Failure-closed posture

If both provider-side and worker-side enforcement fail (e.g., provider API unavailable and monitor job stalled), the sandbox is treated as having terminated in `provider_unavailable` state (§13) after a grace window. Cost is recorded as the last-known-good value; the gap is flagged on the audit row (`audit_note: 'ceiling_enforcement_failed'`). This is a deliberately conservative posture — the sandbox might still be running and incurring cost, but our books treat it as terminated and the operator gets paged via the structured `provider_unavailable` event.

---

## 11. Credential scoping

The sandbox receives only task-scoped, sub-account-scoped credentials required for the specific operation. The contract:

### 11.1 What credentials look like inside the sandbox

- Mounted as files under `/workspace/secrets/{credentialAlias}.token` (tmpfs, never persisted to image).
- Filename uses an alias declared in the input descriptor's `credentialIssuanceContext` (e.g., `openai_api`, `github_org_repo`). The alias is the only thing the sandbox runtime references — never the raw provider-token name.
- Each file contains the raw token value. Permissions `0400` (read-only to the sandbox process user). Cleaned up at sandbox close.
- A companion `/workspace/secrets/manifest.json` describes the aliases available and their declared scopes (read-only, scopes-list, expiry timestamp) — but never the values.

### 11.2 What `credentialBrokerService` issues

- **One issuance per credential per execution.** Triggered by the calling adapter before `runTask`. Each issuance creates an `IssuedCredential` row (existing primitive — `credentialBrokerService.issueCredential`).
- **Short-lived where provider support allows.** For AWS, Google Cloud, GitHub OAuth tokens, etc., the broker materialises a fresh token bounded to the task's expected wall-clock + buffer. For providers without short-lived issuance (e.g., legacy API keys), the broker either (a) proxies the call from outside the sandbox or (b) refuses (`sandbox_credential_denied` failure).
- **Sub-account-scoped.** The broker is scoped by `(organisationId, subaccountId, connectionId)`. A sandbox executing on behalf of subaccount A NEVER receives credentials belonging to subaccount B, even within the same organisation. This is the existing CredentialBroker invariant — Spec B inherits it.
- **Audit trail.** Issuance emits a `credential_issued` audit event with `{ credentialId, sandboxExecutionId, organisationId, subaccountId, connectionId, alias, expiresAt }`. Revocation at sandbox terminal emits `credential_revoked`. The credential value is never in any audit row. Sink: both events ride the existing `credentialBrokerService` audit trail (the broker is the canonical owner of credential lifecycle events; Spec B does not introduce a parallel credential-audit table). The `sandboxExecutionId` field is the cross-reference into Spec B's own sandbox surfaces.

### 11.3 Redaction overlap with the harvest pipeline

Every credential value materialised for a sandbox execution is added to a per-execution redaction pattern set, on top of the default bundle from `redactValue`. This means:

- `output.json` mentioning the credential value (e.g., LLM emitted "I called the API with token abc..." in a debug field) → redacted.
- stdout / stderr lines containing the credential value → redacted.
- Artefact filenames or extracted metadata containing the credential value → redacted.

The per-execution pattern set is materialised by `credentialBrokerService.issueCredential` returning the value plus the redaction pattern (regex) the harvest pipeline registers for the lifetime of the execution. The pattern is discarded on sandbox close — it never lives longer than the execution.

### 11.4 Exclusion from harvested artefacts

If `/workspace/secrets/` ever appears in the artefact enumeration (it shouldn't, because it's outside `/workspace/artefacts/`), the harvest pipeline refuses to upload it and writes a `credential_leak_attempted` event into `sandbox_telemetry_events` (§14.2 lists this as a closed-enum event-type). The filename is captured in `payload_json.filename`; the secret value is never read or logged. This is a defense-in-depth check against bugs that mount `/secrets/` somewhere else.

### 11.5 Shared with Spec C

Spec C's `credentialBrokerService` extensions and Spec B's sandbox credential-injection path agree on the pattern bundle. Per §26, the first of B / C to land defines the shared bundle; the second consumes it. Spec B's pattern bundle additions: regex patterns for the per-execution token aliases as declared by issuance. Spec C's additions: OAuth refresh-token detection, consent-state markers. Both go into `server/lib/redaction.ts` `DEFAULT_REDACTION_PATTERNS`.

## 12. Cost ledger + metering

### 12.1 Single canonical write target — reuse `llm_requests`

**Spec B writes sandbox-compute cost into the existing `llm_requests` table** (`server/db/schema/llmRequests.ts`). One canonical ledger. No parallel accounting paths. Brief §6 invariant: "One canonical cost-ledger write target — no parallel accounting paths."

**Why reuse instead of a new table.** The existing table already has the right tenancy columns (`organisationId`, `subaccountId`, `agentRunId`), the right cost columns (`costRaw`, `costWithMargin`, `costWithMarginCents`, `fixedFeeCents`), the right source attribution (`sourceType` enum), and per-tenant indexes (`llm_requests_org_month_idx`, `llm_requests_subaccount_month_idx`, `llm_requests_run_idx`). A second table would duplicate every aggregation query and force metering callers to UNION. Justification per §6's "new primitive" rule: reuse + extension is correct here; introducing a new table would force every downstream consumer (metering, billing reconciliation, customer dashboards in Phase 3.5+) to handle two row shapes.

**Why the column name `llm_requests` is acceptable for non-LLM compute.** The table's role is "metered usage events tied to a run." LLM requests, agent process executions, IEE adapter runs, analyzer runs, and now sandbox computes all share that shape. The brief acknowledges this — "If `llm_requests` is reused, Spec B must justify why non-LLM compute belongs there and define the exact row shape." The justification is the shared shape, not a naming claim. (A future rename to `metered_runs` or similar would be a separate spec; out of scope here.)

### 12.2 New `source_type` enum values: `sandbox_compute` + `sandbox_compute_correction`

Spec B extends the `sourceType` enum in `server/db/schema/llmRequests.ts` to include both `sandbox_compute` (primary harvest write) and `sandbox_compute_correction` (correction rows per §12.4). Current enum values: `['agent_run', 'process_execution', 'system', 'iee', 'analyzer']`. After Spec B: `[..., 'sandbox_compute', 'sandbox_compute_correction']`. Spec C separately adds `'subscription_mediated'` (§26 coordination).

**CHECK constraint extension.** The existing migration `0185_llm_observability.sql` introduced CHECK constraints pairing `sourceType` with required columns (e.g., `sourceType = 'iee' AND iee_run_id IS NOT NULL`). Spec B's migration extends the constraint to require:
- when `sourceType = 'sandbox_compute'`: `sandbox_execution_id IS NOT NULL` AND `sandbox_vcpu_seconds IS NOT NULL` AND `sandbox_wall_clock_ms IS NOT NULL` AND `sandbox_provider IS NOT NULL` AND `sandbox_template_version IS NOT NULL`;
- when `sourceType = 'sandbox_compute_correction'`: `sandbox_execution_id IS NOT NULL` (the correction row references the original by `sandbox_execution_id`; the other sandbox columns may be null or carry delta values).

### 12.3 New columns on `llm_requests` (nullable except for sandbox rows via CHECK)

Spec B adds five nullable columns:

- `sandbox_execution_id` — UUID, FK-like reference to `sandbox_executions.id` (no hard FK to avoid coupling sandbox lifecycle to billing-ledger writes; row-level join is fine).
- `sandbox_vcpu_seconds` — DECIMAL. Vendor-reported vCPU-seconds.
- `sandbox_wall_clock_ms` — INTEGER. Vendor-reported wall-clock duration.
- `sandbox_provider` — TEXT. One of `'e2b' | 'local_docker' | 'inline'`. Required for `sandbox_compute` rows; `local_docker` and `inline` rows have zero-cost but still write the row for traceability (cost columns may be zero or null — see below).
- `sandbox_template_version` — TEXT. The immutable digest / version of the template (§15).

A partial unique index `llm_requests_sandbox_execution_id_unique_idx` on `(sandbox_execution_id) WHERE source_type = 'sandbox_compute'` guarantees one row per sandbox execution. Provides DB-level idempotency for the harvest pipeline's step 10.

### 12.4 Cost attribution rule

**Append-only / correction-based, never silent overwrite.** Brief §6 invariant. Spec B enforces this in three ways:

- **First write at harvest step 10.** The harvest pipeline writes one row at terminal. This row carries the provider-reported cost at harvest time. Idempotent via the partial unique index in §12.3.
- **Correction rows.** If provider-side cost reconciliation later finds a discrepancy (e.g., e2b's nightly cost recomputation revises the value), Spec B writes a SECOND row with `sourceType = 'sandbox_compute_correction'` (an additional enum value), `sandbox_execution_id` matching the original, and a delta-encoded cost. The original row is never UPDATEd. Billing rolls up `sandbox_compute` + `sandbox_compute_correction` for the same `sandbox_execution_id`.
- **No silent updates.** A direct-DB grep gate (`verify-no-sandbox-cost-update`, §25) checks that no code path issues an UPDATE against `llm_requests` for `source_type IN ('sandbox_compute', 'sandbox_compute_correction')`. The gate is grep-based, line-oriented, similar to existing CI gates from PR #267 (`verify-error-envelope`, `verify-rate-limit-key`).

### 12.5 Zero-cost rows (`local_docker`, `inline`)

Sandboxes running on `local_docker` and `inline` providers have no provider cost. They still write a `sandbox_compute` row at harvest with `costRaw = 0`, `costWithMargin = 0`, `costWithMarginCents = 0` and `sandbox_vcpu_seconds`, `sandbox_wall_clock_ms` populated from local observations. The row exists for traceability — it carries the same `sandbox_execution_id`, `organisationId`, `subaccountId`, `runId`, and feeds the same metering rollups. This avoids divergence in the aggregation query path between local-dev and production data shapes.

### 12.6 Per-customer sandbox-minute metering

Brief §2.8 requires both `organisationId` and `subaccountId` rollups to be queryable from day one. Already covered by the existing indexes (`llm_requests_org_month_idx`, `llm_requests_subaccount_month_idx`) which filter on `sourceType` implicitly when the query does. Spec B adds:

- **Metering query helper.** A pure module `server/services/sandboxMeteringQueryPure.ts` exposes one-call rollup helpers: `getOrgSandboxMinutes(orgId, monthRange)`, `getSubaccountSandboxMinutes(orgId, subaccountId, monthRange)`. The pure module returns the SQL fragment; the calling service wraps with `withOrgTx`. Pure-tests cover the rollup math.
- **No UI in V1.** Brief §2.8 explicitly defers the customer dashboard. Spec B ships the queryable data + the pure helper; the dashboard is Phase 3.5+.

### 12.7 Run-aggregate integration

`runCostBreaker` reads from `cost_aggregates` per-run. Spec B's harvest cost row triggers an update to the run-level aggregate via the existing aggregate writer (untouched by Spec B). The aggregate writer is already source-type-agnostic — it sums by run. No code change required for the aggregate path beyond the new enum value being recognised.

---

## 13. Terminal-state taxonomy + retry posture

### 13.1 Closed taxonomy (8 states)

Spec B introduces a closed status set on `sandbox_executions`. Adding a new value requires a spec amendment. Pure module `sandboxExecutionServicePure.classifyTerminal(providerSignal, harvestResult)` is the only producer.

| State | Definition | User-visible? | Retryable? | Billable? | Audit-worthy? |
|---|---|---|---|---|---|
| `completed` | `output.json` present, schema-valid, harvest succeeded end-to-end. | Yes (success) | No (idempotent re-read returns cached output) | Yes | No special (telemetry only) |
| `timed_out` | Wall-clock ceiling tripped, provider or worker-side fallback terminated the sandbox. | Yes (typed failure) | Yes (with caller-driven retry; may increase ceiling per spec) | Yes (partial cost up to ceiling) | Yes |
| `cost_ceiling_hit` | Cost ceiling tripped, sandbox terminated. | Yes (typed failure) | Yes (with caller-driven retry + higher ceiling) | Yes (capped at ceiling) | Yes |
| `crashed` | Process exited non-zero or sandbox process died unexpectedly inside the ceiling window. | Yes (typed failure with diagnostic hash) | Yes (caller retry, finite — N-attempts cap in §13.2) | Yes (actual cost up to crash) | Yes |
| `output_validation_failed` | `output.json` missing, malformed, over-size, or schema-failed. Includes sub-reasons: `missing`, `schema_failed`, `over_size`, `log_overflow` (stdout / stderr stream exceeded the per-stream cap from §8.3). | Yes (typed failure with sub-reason) | Yes (caller retry; the LLM-emitter or input may have produced bad output that retry won't fix — caller's call) | Yes (full execution cost) | Yes |
| `harvest_failed` | Read of outputs / logs / artefacts failed after sandbox terminal. | No (the sandbox terminal already happened; this is internal) | Yes (reconciliation job re-attempts harvest) | Yes (sandbox cost was real) | Yes |
| `artefact_upload_failed` | Object-storage upload failed after harvest read, or artefact exceeded the per-task size caps. Includes sub-reasons: `upload_io_error`, `artefact_oversized` (per-artefact or total-bytes cap from §9.4 exceeded). | No (internal) | Yes (reconciliation job re-attempts upload only — except `artefact_oversized` which is non-retryable: caller must regenerate input) | Yes (sandbox cost was real) | Yes |
| `provider_unavailable` | Sandbox provider returned an ambiguous terminal, the SDK timed out without a terminal hook, or both enforcement layers in §10 failed. | Yes (typed failure) | Yes (worker enqueues retry under `withBackoff`) | Depends — if sandbox started, last-known cost is recorded; if start failed, no cost | Yes |

Three additional non-terminal states tracked on `sandbox_executions.status` (not in the taxonomy above):

- `pending` — preflight passed, broker is issuing credentials, sandbox not yet started.
- `running` — sandbox is alive, accepting inputs / executing.
- `harvesting` — sandbox terminated, harvest in flight.

State transitions allowed:

- `pending → running` — sandbox started successfully.
- `pending → provider_unavailable` — start failed (no `running` ever entered; harvest pipeline skipped). This is the only terminal transition that bypasses `harvesting`, because no sandbox process ran and there is nothing to harvest. See §14.5 for the minimum-events scoping that allows this case.
- `pending → sandbox_input_rejected_*` — preflight rejected (state in §9.6; no `sandbox_executions` row written for these, so this is logically "pre-state"). For row-tracking purposes there is no row.
- `running → harvesting` — sandbox emitted terminal, by any cause (clean exit, timeout, cost-ceiling, crash, provider ambiguous-terminal). The harvest pipeline then classifies the terminal cause and writes the appropriate terminal state per the table above. There are no `running → terminal-state` direct transitions; the harvest pipeline (§8.4 step 12) is the single writer of terminal states.
- `harvesting → completed | timed_out | cost_ceiling_hit | crashed | output_validation_failed | harvest_failed | artefact_upload_failed | provider_unavailable` — harvest outcome (one of the 8 from §13.1).
- Most terminal states are absorbing; no transition out of them (corrections in §12.4 are a separate cost-row insertion, not a status update).
- **Reconciliation-recoverable exception.** The two internal-only terminal states `harvest_failed` and `artefact_upload_failed` are recoverable: the `sandbox-harvest-reconciliation` job (per §13.2 `safe` classification) atomically re-enters the harvesting phase via `UPDATE sandbox_executions SET status='harvesting' WHERE status IN ('harvest_failed', 'artefact_upload_failed')`. From `harvesting`, the pipeline writes either `completed` (if reconciliation succeeded) or a new terminal state (if it failed for a different reason). After the cap on reconciliation retries (§13.2 finite-cap rules), the derived `sandbox_harvest_failed_permanent` failure surfaces to the customer (§13.4) and the row's status stays absorbing at its last recovery-attempt terminal. The other 6 terminal states are strictly absorbing.

### 13.2 Retry classification per state

| State | Retry classification (per `docs/spec-authoring-checklist.md § 10.2`) | Boundary that owns retry |
|---|---|---|
| `completed` | n/a — success | n/a |
| `timed_out` | `guarded` — retry creates a new `sandbox_execution_id`; the caller decides if a higher ceiling is appropriate | Calling adapter (`iee_dev` / future OpenClaw) |
| `cost_ceiling_hit` | `guarded` — same as `timed_out` | Calling adapter |
| `crashed` | `guarded` — retry creates a new `sandbox_execution_id`; finite cap (3 attempts per logical task, recorded on `agent_runs` row) | Calling adapter |
| `output_validation_failed` | `guarded` — caller decides; may indicate broken prompt / LLM emission and retry won't help | Calling adapter |
| `harvest_failed` | `safe` — reconciliation job re-runs the harvest pipeline using existing idempotency keys | `sandbox-harvest-reconciliation` job |
| `artefact_upload_failed` | `safe` — reconciliation job re-runs ONLY the upload step | `sandbox-harvest-reconciliation` job |
| `provider_unavailable` | `guarded` — `withBackoff` retry inside the sandbox-call wrapper (§16) | Sandbox-call wrapper |

**Finite caps.** `crashed` and `output_validation_failed` retries are bounded by a per-task attempt counter on the calling run. Default cap: 3. After cap, the calling run surfaces a typed failure and stops re-invoking. Spec B does not invent a generic retry tracker; the cap lives on the existing `agent_runs` row machinery via the adapter (calling adapter is responsible for tracking, since the calling run already tracks step attempts).

### 13.3 Billing posture per state

Most states are billable for the work that occurred. Exceptions: `sandbox_input_rejected` (pre-execution) is non-billable. `provider_unavailable` at start (sandbox never ran) is non-billable. Mid-execution `provider_unavailable` charges last-known cost up to the failure.

This is encoded in the harvest cost-row writer (§12.4) — it always writes a row except for the two non-billable states. The amount written reflects actual provider-reported cost; for partial-execution states, the partial cost.

### 13.4 Visibility posture per state

Customer-facing run trace surfaces only user-visible states. Internal-only states (`harvest_failed`, `artefact_upload_failed`) surface as a generic "execution pending / reconciling" to the customer while the internal reconciliation runs — once reconciliation succeeds, the customer sees the harvested output retroactively (terminal becomes `completed`). If reconciliation also fails after retries, the run surfaces a typed failure using the existing `FailureReason.sandbox_harvest_failed` value with `permanent: true` in the structured detail (no new `FailureReason` enum value is added; `sandbox_harvest_failed_permanent` is purely a display-label / log-tag, not a status or `FailureReason`). An operator audit event fires.

### 13.5 Audit posture per state

All terminal states are recorded in `sandbox_telemetry_events` (§14). States flagged "audit-worthy" in the §13.1 table additionally fire structured-log events at warning-or-error severity for operator visibility.

## 14. Observability + telemetry

### 14.1 Structured events (`sandbox_telemetry_events` table)

Every sandbox execution emits structured telemetry to `sandbox_telemetry_events` (new table, RLS-protected, contract in §20). Each row contains:

- `id` (UUID), `sandbox_execution_id` (FK-like to `sandbox_executions.id`)
- `event_type` (closed enum — see §14.2)
- `event_at` (timestamptz)
- `criticality` (`info | warn | error`)
- `organisation_id`, `subaccount_id`, `run_id`, `agent_id`, `task_id` — full tenancy + correlation set
- `provider`, `template_name`, `template_version`
- `payload_json` (event-specific structured data, schema declared per event type — see §14.2)

A unique-by-sequence index `(sandbox_execution_id, sequence)` provides ordered iteration across an execution's events. Pure helper `appendSandboxEvent()` atomically allocates the next sequence (mirrors the existing `agentExecutionEventService` atomic-sequence pattern).

### 14.2 Closed event-type enum (V1)

| `event_type` | When fired | Criticality | Payload notes |
|---|---|---|---|
| `sandbox_input_rejected` | Preflight rejected (over-size, MIME mismatch, etc.). Fired on the calling run's failure trace; **NOT** in `sandbox_telemetry_events` because no execution row exists (see §9.6). Listed here for completeness. | error | n/a (no sandbox row) |
| `sandbox_start` | Sandbox successfully started, `pending → running` transition. | info | `{ ceilings, network_policy, alias_count }` |
| `sandbox_start_failed` | Start API call failed; `pending → provider_unavailable`. | error | `{ reason, providerErrorCode? }` |
| `sandbox_terminal` | Sandbox terminated (any reason). The first `sandbox_terminal` per execution is the canonical terminal (`isCanonical: true`); subsequent ones written by the reconciliation recovery path (§13.1) are flagged `isCanonical: false` with `reconciliationAttempt: N`. | info | `{ terminalState, wallClockMs, vcpuSeconds, providerReportedCostCents, harvestStepReached: 0..12, isCanonical: boolean, reconciliationAttempt?: number }` — `harvestStepReached` lets the minimum-events gate decide which phase applies (§14.5) |
| `sandbox_timeout` | Wall-clock ceiling tripped. | warn | `{ ceilingMs, observedMs, enforcedBy: 'provider' | 'worker' }` |
| `sandbox_cost_ceiling_hit` | Cost ceiling tripped. | warn | `{ ceilingCents, observedCents, enforcedBy }` |
| `sandbox_crashed` | Sandbox process exited non-zero or died. | warn | `{ exitCode?, diagnosticHash }` |
| `output_validation_failed` | `output.json` missing / malformed / schema-failed / over-size; or stdout/stderr stream over the per-stream cap. | warn | `{ subReason: 'missing' | 'schema_failed' | 'over_size' | 'log_overflow', schemaPath?, observedSize?, stream? }` |
| `output_validated` | Successful schema validation. | info | `{ outputBytes, redactedFieldCount }` |
| `harvest_started` | Harvest pipeline began. | info | n/a |
| `harvest_failed` | A harvest step failed. | error | `{ step, reason }` |
| `artefact_uploaded` | One artefact upload completed (or the row already existed and the upload was a no-op idempotent hit). | info | `{ filename, bytes, contentHash, wasIdempotent?: boolean }` |
| `artefact_upload_failed` | One artefact upload failed, or an artefact exceeded the per-task size caps. | error | `{ filename, reason: 'upload_io_error' | 'artefact_oversized', observedBytes?, capBytes? }` |
| `credential_injection_denied` | Broker refused to issue (e.g., long-lived token requested and no proxy available). | error | `{ alias, connectionId, reason }` |
| `credential_leak_attempted` | Defense-in-depth: harvest enumerator saw `/workspace/secrets/` content. | error | `{ filename }` (filename only — value never logged) |
| `egress_audited` | Egress decision recorded. **Only fires when `network` policy is non-`none`.** | info | `{ destinationClass, destinationHost, destinationPort, credentialContext, outcome }` (also denormalised to `sandbox_egress_audit` for query-friendly access) |
| `provider_diagnostic` | Transient provider-call event — retry, slow-start, rate-limit, ambiguous-terminal. May fire multiple times per execution. Always pre-terminal. | warn | `{ phase: 'start' | 'mid_execution' | 'terminal' | 'harvest', subKind: 'retry' | 'slow_start' | 'rate_limit' | 'ambiguous_terminal', backoffAttempt }` |
| `provider_unavailable` | Terminal provider state — emitted exactly once per execution when the row reaches a `provider_unavailable` terminal status. Pairs with `sandbox_start_failed` when the failure was pre-start (`phase: 'start'`); pairs with `sandbox_terminal` when the failure was post-start (any other `phase`). | error | `{ phase: 'start' | 'mid_execution' | 'terminal' | 'harvest' }` |
| `runtime_install_requested` | Reserved for future runtime-install path (§9.5). V1 events never fire — `allowRuntimeInstall` is forced `false`. | info | `{ packageList, taskClass }` |
| `runtime_install_denied` | Reserved. V1 events never fire (because no install is requested). | warn | `{ reason }` |
| `runtime_install_completed` | Reserved. V1 events never fire. | info | `{ packageList, durationMs }` |

Adding a new event type requires a spec amendment. The CHECK constraint on `sandbox_telemetry_events.event_type` enforces the closure.

### 14.3 Structured log events (out-of-band of the DB table)

In addition to the DB-backed `sandbox_telemetry_events`, the sandbox lifecycle emits structured log events via the existing logger (matching the `foundation.credential_broker.issued` pattern from `credentialBrokerService`). Names mirror the event types above but prefixed `sandbox.`:

- `sandbox.start`, `sandbox.terminal`, `sandbox.timeout`, `sandbox.cost_ceiling_hit`, `sandbox.crashed`, `sandbox.output_validation_failed`, `sandbox.output_validated`, `sandbox.harvest.started`, `sandbox.harvest.failed`, `sandbox.artefact_uploaded`, `sandbox.artefact_upload_failed`, `sandbox.credential.injection_denied`, `sandbox.credential.leak_attempted`, `sandbox.egress_audited`, `sandbox.provider_diagnostic`, `sandbox.provider_unavailable`.

Log lines carry the same tenancy + correlation tuple as the DB events. The DB events are the queryable / RLS-protected canonical record; log lines are for ops paging and live-tailing.

### 14.4 RLS / scoping enforcement

`sandbox_telemetry_events`, `sandbox_executions`, `sandbox_egress_audit`, and the `sandbox_compute` rows on `llm_requests` are all RLS-protected. Every row is queryable only within its owning `(organisationId, subaccountId)` context. Metadata tagging via e2b is NOT a substitute — the brief §2.12 invariant requires enforced query-side isolation as well. Spec B accomplishes this via:

- All four tables / row types added to `RLS_PROTECTED_TABLES` manifest in the same migration that creates them.
- Standard three-layer fail-closed policy shape used (Layer A `withOrgTx` opens transaction with `set_config('app.organisation_id', $orgId)`; Layer B RLS policies on `organisation_id` column; Layer C `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` CI gates).
- Read paths use `getOrgScopedDb()` exclusively. The `verify-rls-contract-compliance` CI gate already rejects raw `db.` imports inside service / route code (pattern set in PR #274 / #275); Spec B inherits this.

### 14.5 Required minimum-events guarantee

Per brief §2.12, every sandbox execution MUST emit minimum-events scoped to the lifecycle phase the execution reached:

- **Pre-start failure path** (`pending → provider_unavailable`, start API call failed before any sandbox process ran): MUST emit `sandbox_start_failed`. No `sandbox_terminal` or output-validation events are required — no sandbox started and no output exists.
- **Post-start without output-read** (mid-execution `provider_unavailable` where the wrapper declared the sandbox terminated before harvest read `output.json`, OR `harvest_failed` at harvest step 2 (output read) — see §8.4): MUST emit `sandbox_start` and `sandbox_terminal`. Output-validation events are NOT required because the output was never read.
- **Post-start with output-read** (all other post-start terminals — `completed`, `timed_out`, `cost_ceiling_hit`, `crashed`, `output_validation_failed`, `harvest_failed` past step 2, `artefact_upload_failed`): MUST emit `sandbox_start`, `sandbox_terminal`, AND one of (`output_validated` | `output_validation_failed`). The harvest pipeline (§8.4) is the only producer of the output-validation pair; the row state machine in §13.1 cannot reach these terminals without harvest having reached at least step 3.

Spec B's harvest pipeline + start path are structured so that an execution that ends without the events required for its phase is impossible. The `verify-sandbox-minimum-events` CI grep gate (§25) enforces this by checking each terminal-status writer against the matching event-writer set for its phase (the gate uses the `sandbox_executions.status` value plus the `sandbox_terminal` event payload's `harvestStepReached` field to decide which phase applies).

---

## 15. Template build pipeline + version pinning

### 15.1 What lives in `infra/sandbox-templates/`

New directory introduced by Spec B. Contains two subdirectories:

- `infra/sandbox-templates/synthetos-sandbox/` — Spec B's template. Dockerfile + entrypoint + dependency manifest. The dependency manifest pins Phase 2-relevant packages (Python + pandas / pdfplumber / openpyxl / etc.; Node baseline for JS transforms; a small shell layer for the entrypoint). README documents parity gaps vs `localDockerSandbox` (§8.2.2).
- `infra/sandbox-templates/openclaw-session/` — image authored here, consumed by the OpenClaw adapter spec. Contents (Codex CLI install, OpenClaw process wiring) are NOT defined here — that's the OpenClaw adapter's deliverable. Spec B provides the empty scaffolding + the CI publish hook.

### 15.2 CI publish job

New CI job `publish-sandbox-templates` runs on tag bump matching `sandbox-template/synthetos-sandbox/v*` or `sandbox-template/openclaw-session/v*`:

1. Build the Docker image from the relevant template directory.
2. Run the dependency / vulnerability scan (§15.4).
3. Publish to e2b template registry with the tag's version.
4. Compute + record the immutable image digest.
5. Bump `infra/sandbox-templates/synthetos-sandbox/CURRENT_VERSION` (a single-line file) to the new version + digest.

`CURRENT_VERSION` is the source of truth runtime code reads to determine "what version do new executions pin?" An out-of-band change to `CURRENT_VERSION` without a corresponding registry publish is a CI failure (`verify-template-version-coherence`, §25).

### 15.3 Per-execution pinning

Every `sandbox_executions` row pins:

- `template_name` (e.g., `synthetos-sandbox`)
- `template_version` (semver from the tag bump)
- `template_digest` (the immutable Docker digest)
- `template_build_commit` (git commit of the build that produced the image)
- `provider_project` (e2b project name — `synthetos-prod` or `synthetos-staging`)

The provider call passes `template_version` (resolved to the corresponding e2b template alias). The recorded digest provides post-hoc verification that the alias didn't get re-pointed.

**No floating `latest` for production.** Production execution paths refuse to start a sandbox if `template_version === 'latest'`. The pure helper enforces this. `localDockerSandbox` similarly refuses `latest` — local dev pins to the dev-built version too.

### 15.4 Dependency update + vulnerability scanning posture

Spec B pins what blocks a template publish:

- **Critical or High CVE in baked dependencies** → publish blocked. CI fails. Operator must update the Dockerfile, re-tag, re-run.
- **Outdated base image** (older than 60 days from publish attempt) → publish blocked. Forces regular base-image refresh.
- **Unpinned dependency versions in the manifest** → publish blocked. Every package gets a pinned version.

Scanner of record: `trivy image` (existing tooling; if not already available, Spec B introduces the install step in the publish job). Out-of-band re-scans on existing published versions are out of scope for V1 — but the per-execution `template_version` + `template_build_commit` columns make retroactive identification of vulnerable-version usage trivial.

### 15.5 Local dev consumption

`docker-compose.yml` runs a service that builds the template from the local Dockerfile under `infra/sandbox-templates/synthetos-sandbox/`. No e2b registry interaction for local dev. The image tag locally is `synthetos-sandbox:local-dev`; `localDockerSandbox` constructs from this tag and pins `template_version = 'local-dev-{commitShort}'`, `template_digest` = the local-build digest.

---

## 16. Provider availability + fallback

### 16.1 V1 must fail closed for untrusted code execution

**No silent fallback to worker execution.** **No fallback to `inlineSandbox`.** Brief §2.14 + §6 invariants.

### 16.2 Provider-call wrapper (`withSandboxProvider`)

A new wrapper module `server/lib/withSandboxProvider.ts` mirrors `withBackoff`'s shape but adds sandbox-specific failure classification. It wraps provider calls (start, terminal-poll, file-read, terminate) with:

- **`withBackoff` for transient failures.** Network blip, rate-limit, 5xx from provider → backoff + retry. Capped at 3 attempts; backoff grows exponentially with jitter. After cap, the call surfaces `FailureReason.sandbox_provider_unavailable`.
- **Ambiguous-terminal reconciliation.** If a provider call returns "I don't know if the sandbox is still alive," the wrapper schedules a `sandbox-harvest-reconciliation` job and surfaces `FailureReason.sandbox_provider_unavailable` to the caller. The reconciliation job re-queries provider state until it gets a definitive answer or hits the wall-clock-ceiling-plus-buffer (then declares the sandbox terminated as `provider_unavailable`).
- **No silent fallback.** The wrapper has no code path that says "if provider failed N times, run the task in the worker." Such a path is what the brief explicitly forbids. The wrapper either retries within bounds or surfaces a typed failure — never a silent degraded execution.

### 16.3 Acceptable responses to provider unavailability

- **Caller queues + retries.** The calling adapter (e.g., `iee_dev`) catches `sandbox_provider_unavailable`, marks the calling run step as awaiting retry, and re-enqueues. Backoff governed by the calling adapter's existing retry posture.
- **Caller surfaces typed failure to the agent run.** The agent run records the failure on the run trace and either chooses to retry (LLM-driven) or hard-fails the run with the typed failure surface.
- **Caller hard-fails.** For one-shot tasks where retry is not appropriate, the calling adapter immediately hard-fails the calling run with a `sandbox_provider_unavailable` failure event written to `agent_runs.failure_reason`.

### 16.4 Slow-start posture

If provider start exceeds a soft threshold (default 30 s — pinned in `policy.providerThresholds.startTimeoutMs`), the wrapper does NOT terminate. It emits a `provider_diagnostic` event with `phase: 'start'` and `subKind: 'slow_start'` (DB-side per §14.2 + log-side `sandbox.provider_diagnostic`) and continues to wait until the hard wall-clock-ceiling + buffer. After the hard limit, `provider_unavailable` (terminal) fires.

This avoids the failure mode where transient provider warm-up cycles cancel sandboxes that would have started successfully a few seconds later.

### 16.5 Rate-limit posture

`withSandboxProvider`'s `withBackoff` invocation respects provider-returned `Retry-After` headers (or the e2b SDK's equivalent). The wrapper does NOT independently maintain a per-org rate budget — that's Phase 3.5+ if needed.

### 16.6 Observability

Every provider-call retry, slow-start, rate-limit, and ambiguous-terminal emits a structured log event AND a `sandbox_telemetry_events` row of `provider_diagnostic` (pre-terminal; may repeat) with `phase` distinguishing start / mid-execution / terminal / harvest and `subKind` distinguishing retry / slow-start / rate-limit / ambiguous-terminal. When the execution finally reaches a `provider_unavailable` terminal status, the harvest pipeline emits one terminal `provider_unavailable` event (per §14.5). Operator dashboards filter on `provider_diagnostic` for rate / first-quartile / median visibility, and on `provider_unavailable` for terminal-failure counts.

## 17. Retention + deletion

### 17.1 What gets retained

After harvest, three classes of sandbox-derived data persist:

- **`output.json` content** — retained on the `sandbox_executions` row's `output_json` column (JSONB, redacted, schema-validated). Read by the calling run / agent / customer-visible surfaces.
- **Artefacts** — uploaded to object storage under `sandbox-artefacts/{orgId}/{subaccountId}/{sandboxExecutionId}/{filename}`. Pointer rows in `sandbox_artefacts` table.
- **Logs** — redacted stdout / stderr lines persisted via the sandbox-specific log surface (build-time choice tracked in §27 / `SANDBOX-DEF-LOG-SCHEMA`), tagged by `sandbox_execution_id`.
- **Telemetry events** — `sandbox_telemetry_events` table.
- **Egress audit** — `sandbox_egress_audit` table (only if `network` policy was non-`none`).
- **Cost rows** — `llm_requests` table with `source_type = 'sandbox_compute'` (and any `sandbox_compute_correction` rows).

### 17.2 What doesn't get retained

**Sandbox filesystem state.** Per brief §2.15 + §6 invariant, sandbox filesystems are ephemeral execution surfaces, not persistence layers. Only the four output paths (§8.3) are read at harvest; anything else (working files, temporary state, package caches) is discarded at sandbox close. The provider's own ephemerality contract enforces this — `e2bSandbox` and `localDockerSandbox` both tear down filesystem state on close.

### 17.3 Default retention (V1)

- **Telemetry events** (`sandbox_telemetry_events`) — 90 days. After 90 days, raw event rows are deleted by a `sandbox-telemetry-prune` job. No summary roll-up is computed: the `sandbox_executions` row already carries the durable per-execution fields (terminal `status`, `terminated_at`, `harvested_at`, `metrics_json`, `cost_cents`, `error_reason`) that future audit queries need, and structured log lines (§14.3) provide the per-event archive for ops paging. Treating the `sandbox_executions` row itself as the post-prune summary keeps the data shape simple and avoids a separate summary contract that would need its own retention rules.
- **Egress audit** (`sandbox_egress_audit`) — 180 days. Required retention for security audit purposes; pruned thereafter.
- **Artefacts in object storage** — 90 days. Pointer rows in `sandbox_artefacts` retained as tombstones (rows kept, `object_storage_state = 'expired'` set, content key cleared) until the parent `agent_runs` row is deleted; tombstones are then removed by the run-deletion cascade (§17.4).
- **Logs** — 90 days (matches existing log retention; Spec B does not change the existing log layer's retention policy).
- **`output.json` content + `sandbox_executions` row** — retained indefinitely (until run deletion). Anchors the audit trail.
- **Cost rows in `llm_requests`** — retained indefinitely; financial / audit data is never aged out (matches existing `llm_requests` posture).

These are V1 defaults pinned in code constants under `server/lib/sandboxRetentionConstants.ts`. Tenant overrides are NOT V1.

### 17.4 Deletion behaviour when a run is deleted

When a customer or operator deletes an `agent_runs` row (existing soft-delete pattern from PR #261 / PR #267):

- **`sandbox_executions` rows for the run** — soft-deleted (existing `isActive(table)` pattern). The row stays for audit but is hidden from customer-facing queries.
- **Artefacts** — physically deleted from object storage by a `sandbox-artefact-purge` job triggered by the soft-delete event. Pointer rows soft-deleted with `object_storage_state = 'purged'`.
- **Logs** — soft-deleted (existing log retention layer handles this).
- **Telemetry events + egress audit** — retained per their default retention windows (above). The brief §2.15 invariant — "ledger rows MUST be retained, anonymised, or correction-reversed on run deletion — never physically deleted in a way that breaks finance or audit trails" — extends to telemetry: the events are kept past the run's soft-delete so the audit trail survives.
- **Cost rows in `llm_requests`** — retained, NEVER physically deleted. If a "delete this run's spend" request comes through (e.g., compliance / GDPR-equivalent), the path is correction-reversed: a paired correction row negates the original. Original row stays. Brief §6 invariant.

### 17.5 Sandbox-side file deletion guarantee after sandbox close

`e2bSandbox`'s teardown calls the e2b SDK's close API and asserts the sandbox is no longer enumerable in the project's sandbox list (with `withBackoff` retry against eventual consistency). `localDockerSandbox` calls `docker rm` and asserts the container is gone. Both fire a `sandbox.teardown.verified` log event on success and `sandbox.teardown.unverified` on failure.

**Unverified teardown is an operator-paging event.** If, after 60 s + backoff retries, the sandbox is still visible to the provider, the operator is paged. The execution row stays in `harvesting` or its terminal state; no automated retry of teardown beyond the backoff window. This is a deliberate conservative posture — assuming a sandbox is gone when it isn't is the worst possible outcome.

---

## 18. Migration path — splitting `iee_dev`

### 18.1 Current state

`iee_dev` adapter (`server/services/executionBackends/ieeDevBackend.ts`) collapses two execution classes:
1. **Customer-derived / Tier 4 code execution** — currently runs in the worker process. Spec B moves this to `SandboxExecutionService`.
2. **Trusted Terminal / Repo operations (Tier 5)** — controlled, non-customer dev / repo commands. Stays in the worker.

The adapter currently declares `sandboxRequirement: 'code_execution'` (line 36) as a future-intent marker; the dispatch path doesn't yet check it.

### 18.2 Target state

After Spec B's migration phase:

- `iee_dev` adapter's `dispatch()` consults the execution-classification table (§7.2). When the dispatched task is in any "Sandbox" row, the adapter calls `SandboxExecutionService.runTask()` and surfaces results / failures up to the calling run.
- When the dispatched task is in a "Worker" row, the existing worker path runs (no change).
- A new pure helper `classifyExecutionClass(task) → 'sandbox' | 'worker_orchestration' | 'worker_trusted'` lives in `executionBackends/ieeDevBackendPure.ts` and is the only producer of dispatch-class verdicts. Pure tests cover the classification logic.
- The adapter's `sandboxRequirement: 'code_execution'` declaration becomes enforced — any task classified as "sandbox" that bypasses the sandbox call is a CI-detectable invariant violation (§25 grep gate `verify-sandbox-classification`).

### 18.3 Migration is hard-cut, not gradual

Brief §2.16: "the split is pinned by the classification table — there is no 'small script' exception that lets customer-derived code back into the worker." Spec B does NOT introduce a feature flag for "run sandboxed sometimes, worker other times." The cut is hard:

- Day 0: Spec B's migration chunk lands. From that commit onward, every "Sandbox" task goes through `SandboxExecutionService`. There is no per-task opt-out, no per-tenant rollout gate, no shadow-vs-active mode.
- The `commit_and_revert` rollout model from `docs/spec-context.md` is what backs this — if the migration breaks something, the operator reverts the migration commit, not flips a flag. Behaviour-mode flags don't apply (the migration is not a behaviour mode).

### 18.4 Risk mitigation during the cut

The risk is that something we forgot to classify as "Sandbox" runs in the worker post-cut, OR something we did classify as Sandbox that should have stayed in worker now goes through a sandbox unnecessarily.

Mitigations baked into Spec B:

- **CI grep gate `verify-sandbox-classification`** (§25) — runs against the `iee_dev` adapter and any future adapter declaring `sandboxRequirement: 'code_execution'`. Fails the build if any task-dispatch code path that takes customer input or LLM output reaches an execution call that is not `SandboxExecutionService.runTask`. Grep-based, similar to PR #267 invariant gates.
- **`classifyExecutionClass` pure tests** (§25) — exhaustive case coverage for every task variant the adapter dispatches today. Pure tests are mandatory for the classification helper.
- **Pre-launch dry-run mode (Phase 2 build chunk)** — the migration chunk includes a one-shot script that re-classifies every task type the adapter has historically dispatched (sourced from `tasks/todo.md` / known task list) and asserts the new classification matches the manual expectation. Run once before the migration goes live; output recorded in `tasks/builds/sandbox-isolation/migration-dry-run.md`. This is a build-time check, not runtime.

### 18.5 What does NOT change in `iee_dev`

- The `ExecutionBackend` interface shape it implements (Spec A's contract).
- The way it reports `BackendDispatchResult` to the orchestrator.
- The cost / capabilities / declared metadata.
- The Tier 5 worker-trusted code paths.

Spec B's migration is internal to `iee_dev`'s `dispatch()` body. From the orchestrator's perspective, `iee_dev` continues to look the same — it just no longer puts customer-derived code in the worker.

## 19. File inventory lock

Per `docs/spec-authoring-checklist.md § Section 2`, this table is the single source of truth for what Spec B touches. Every prose reference elsewhere in the spec to a new file / column / migration / table / endpoint MUST appear here.

### 19.1 New files (production code)

| Path | Purpose | Section |
|---|---|---|
| `server/services/sandboxExecutionService.ts` | The `SandboxExecutionService` interface + main entrypoint. Resolves the provider per env, dispatches `runTask`. | §8.1 |
| `server/services/sandboxExecutionServicePure.ts` | Pure helpers: `classifyTerminal`, `resolveSandboxCeilings`, policy → provider-flags mapping, cost-attribution math. (`classifyExecutionClass` is adapter-specific and lives in `ieeDevBackendPure.ts` — see §18.2 for canonical owner.) | §8.1, §10.1 |
| `server/services/sandbox/e2bSandbox.ts` | `e2bSandbox` provider implementation. Wraps the e2b SDK behind the interface. | §8.2.1 |
| `server/services/sandbox/localDockerSandbox.ts` | `localDockerSandbox` provider implementation. Uses `docker run` against the same template Dockerfile. | §8.2.2 |
| `server/services/sandbox/inlineSandbox.ts` | `inlineSandbox` test-only provider. Hard-guards against non-test environments. | §8.2.3 |
| `server/services/sandbox/sandboxProviderResolver.ts` | The `SANDBOX_PROVIDER` env-var resolver + fail-fast guard for `inline` outside test. | §8.2 |
| `server/services/sandboxHarvestService.ts` | The post-terminal harvest pipeline. Orchestrates the 12 ordered steps. | §8.4 |
| `server/services/sandboxHarvestServicePure.ts` | Pure helpers for harvest classification, ordering, redaction wiring. | §8.4, §11.3 |
| `server/services/sandboxMeteringQueryPure.ts` | Pure rollup helpers (`getOrgSandboxMinutes`, `getSubaccountSandboxMinutes`). | §12.6 |
| `server/lib/withSandboxProvider.ts` | Provider-call wrapper. Backoff + ambiguous-terminal reconciliation. | §16.2 |
| `server/lib/sandboxRetentionConstants.ts` | V1 retention defaults (telemetry 90d, egress audit 180d, artefacts 90d). | §17.3 |
| `server/jobs/sandboxHarvestReconciliationJob.ts` | Pg-boss job — finds executions stuck pre-terminal past wall-clock-plus-buffer, re-enqueues harvest. | §8.4 reconciliation, §13.2 |
| `server/jobs/sandboxCeilingMonitorJob.ts` | Pg-boss job — per-execution worker-side fallback for wall-clock + cost ceilings. | §10.2 |
| `server/jobs/sandboxTelemetryPruneJob.ts` | Pg-boss job — prunes telemetry events past 90d. No summary aggregation: the `sandbox_executions` row is the post-prune summary (§17.3). | §17.3 |
| `server/jobs/sandboxEgressAuditPruneJob.ts` | Pg-boss job — prunes egress audit rows past 180d. | §17.3 |
| `server/jobs/sandboxArtefactPurgeJob.ts` | Pg-boss job — physically deletes artefacts from object storage when parent run is soft-deleted. | §17.4 |
| `server/db/schema/sandboxExecutions.ts` | Drizzle schema for `sandbox_executions` table. | §13.1, §20 |
| `server/db/schema/sandboxArtefacts.ts` | Drizzle schema for `sandbox_artefacts` pointer rows. | §17.4, §20 |
| `server/db/schema/sandboxTelemetryEvents.ts` | Drizzle schema for `sandbox_telemetry_events`. | §14.1, §20 |
| `server/db/schema/sandboxEgressAudit.ts` | Drizzle schema for `sandbox_egress_audit`. | §9.1, §20 |
| `shared/types/sandbox.ts` | TypeScript types for the input descriptor, output, terminal-state enum, policy schema, contracts. Consumed by adapters + UI in future phases. | §8.1, §20 |
| `infra/sandbox-templates/synthetos-sandbox/Dockerfile` | Spec B's template image. | §15.1 |
| `infra/sandbox-templates/synthetos-sandbox/entrypoint.sh` | Sandbox entrypoint script. Sets up `/workspace`, runs the task, captures logs. | §15.1 |
| `infra/sandbox-templates/synthetos-sandbox/requirements.txt` | Python dependency pin. | §15.1, §15.4 |
| `infra/sandbox-templates/synthetos-sandbox/package.json` | Node baseline + JS-transform dependency pin. | §15.1 |
| `infra/sandbox-templates/synthetos-sandbox/CURRENT_VERSION` | Single-line file: `version=v1.0.0 digest=sha256:...`. Read by `e2bSandbox` to pin per-execution `template_version`. | §15.2, §15.3 |
| `infra/sandbox-templates/synthetos-sandbox/README.md` | Documents parity gaps between `e2b` and `localDocker`. | §8.2.2 |
| `infra/sandbox-templates/openclaw-session/` | Empty scaffolding: Dockerfile + entrypoint + CURRENT_VERSION (placeholder). Contents owned by the OpenClaw adapter spec. | §15.1 |
| `docker-compose.sandbox.yml` (or extension to existing `docker-compose.yml`) | Service definition for `localDockerSandbox`'s template image build + run target. | §15.5 |
| `scripts/migrations/sandbox-isolation-classification-dry-run.ts` | One-shot build-time script that re-classifies every task type the `iee_dev` adapter has historically dispatched (sourced from `tasks/todo.md` / known task list) and asserts the new classification matches the manual expectation. Output recorded in `tasks/builds/sandbox-isolation/migration-dry-run.md`. Build-time check, not runtime; tied to the C13 + C14 cut. | §18.4, §23 C14 |

### 19.2 New CI gate scripts

| Path | Purpose | Section |
|---|---|---|
| `scripts/gates/verify-sandbox-classification.sh` | Grep gate. Fails the build if any task-dispatch code path that takes customer input reaches a non-sandbox runtime call. | §18.4, §25 |
| `scripts/gates/verify-sandbox-minimum-events.sh` | Grep gate. Fails if any `sandbox_executions` terminal-state insert is not paired with the required minimum telemetry events. | §14.5, §25 |
| `scripts/gates/verify-template-version-coherence.sh` | Verifies `CURRENT_VERSION` file in `infra/sandbox-templates/synthetos-sandbox/` matches a published CI tag (no out-of-band edits). | §15.2 |
| `scripts/gates/verify-no-sandbox-cost-update.sh` | Grep gate. Fails if any code path issues UPDATE against `llm_requests` for `source_type IN ('sandbox_compute', 'sandbox_compute_correction')`. | §12.4 |
| `scripts/gates/verify-no-inline-sandbox-outside-test.sh` | Grep gate. Fails if `inlineSandbox` import / construction appears outside `*.test.ts` / `__tests__/` paths. | §8.2.3 |

### 19.3 Modified existing files

| Path | Change | Section |
|---|---|---|
| `server/services/executionBackends/ieeDevBackend.ts` | `dispatch()` rewired to consult `classifyExecutionClass()` and call `SandboxExecutionService.runTask` for sandbox-class tasks. The Tier 5 worker-trusted path is unchanged. | §18 |
| `server/services/executionBackends/ieeDevBackendPure.ts` | New pure helper alongside the adapter, containing `classifyExecutionClass`. (If the file does not exist today, it's added per the existing `*ServicePure.ts` convention.) | §18.2 |
| `server/db/schema/llmRequests.ts` | (1) Extend `sourceType` enum with `'sandbox_compute'` and `'sandbox_compute_correction'`. (2) Add 5 nullable columns: `sandbox_execution_id`, `sandbox_vcpu_seconds`, `sandbox_wall_clock_ms`, `sandbox_provider`, `sandbox_template_version`. | §12.2, §12.3 |
| `server/config/rlsProtectedTables.ts` | Append rows for `sandbox_executions`, `sandbox_artefacts`, `sandbox_telemetry_events`, `sandbox_egress_audit`. | §14.4, §21 |
| `server/lib/redaction.ts` | Extension of `DEFAULT_REDACTION_PATTERNS` with sandbox-specific patterns + the runtime-extensible per-execution pattern set. Coordinated with Spec C (§26). | §11.3 |
| `server/services/credentialBrokerService.ts` | Extend `issueCredential` return shape to optionally include a per-execution redaction pattern (regex) the harvest pipeline registers for the execution's lifetime (§11.3). Existing callers ignoring the new field are unaffected; no breaking change to the public surface. Coordinated with Spec C if Spec C also extends this file (§26). | §11.3, §26 |
| `shared/iee/failure.ts` | Extend `FailureReason` enum with the 8 new sandbox-specific values. | §6, §13.2 |
| `server/jobs/index.ts` | Register the 5 new pg-boss jobs (sandbox-harvest-reconciliation, sandbox-ceiling-monitor, sandbox-telemetry-prune, sandbox-egress-audit-prune, sandbox-artefact-purge). | §17.3, §17.4 |
| `architecture.md` | New section: "Sandbox Isolation primitive — `SandboxExecutionService`" under the Layer 4 / Execution Backends area. Includes the §7.2 execution classification table reproduced as the dispatch contract. Cross-link from `iee_dev` adapter description to the new section. | §11 (doc-sync) |
| `docs/capabilities.md` | New row under "Agency capabilities": sandbox-backed Tier 4 execution. Vendor-neutral phrasing — does not name e2b in customer-facing copy. (Brief §1 styling: lowercase `e2b` only inside the spec / docs intended for engineers.) | doc-sync |
| `docs/env-manifest.json` | Add `SANDBOX_PROVIDER` (required, enum), `SANDBOX_ALLOW_INLINE` (test-only flag, defaults to absent), `E2B_API_KEY` (required when provider=`e2b`), `E2B_PROJECT_PROD` / `E2B_PROJECT_STAGING`. | §8.2 |
| `tasks/current-focus.md` | Status `PLANNING → BUILDING` at Step 10 of the spec-coordinator playbook. (Not Spec-B-content per se, but part of the Phase 1 closeout.) | Phase 1 handoff |
| `KNOWLEDGE.md` | Append patterns observed during build (post-implementation). | doc-sync |
| `docs/decisions/0009-sandbox-execution-service.md` (proposed ADR) | Records the vendor-adapter pattern + the `SandboxExecutionService` interface choice + the "no silent fallback" decision. Authored during Phase 2 if the build reaffirms the decision warrants an ADR. | optional, doc-sync judgement |

### 19.4 New migrations

Spec B adds **four migrations**, numbered sequentially after the most recent migration in `migrations/`:

| Migration | Purpose |
|---|---|
| `XXXX_create_sandbox_executions.sql` | `CREATE TABLE sandbox_executions` + indexes + RLS policy + manifest entry. |
| `XXXX_create_sandbox_artefacts_and_telemetry.sql` | `CREATE TABLE sandbox_artefacts` + `sandbox_telemetry_events` + indexes + RLS policies + manifest entries. |
| `XXXX_create_sandbox_egress_audit.sql` | `CREATE TABLE sandbox_egress_audit` + indexes + RLS policy + manifest entry. |
| `XXXX_extend_llm_requests_for_sandbox.sql` | Extend `sourceType` enum + add 5 nullable columns + extend CHECK constraint + add partial unique index on `(sandbox_execution_id) WHERE source_type = 'sandbox_compute'`. |

Each migration has a paired `.down.sql` using defensive `IF EXISTS` / `IF NOT EXISTS` (per KNOWLEDGE.md pattern from PR #274). Final migration numbers assigned at build-time based on `migrations/` head.

### 19.5 Files NOT modified

For clarity (to avoid drift during Phase 2):

- `server/services/executionBackends/types.ts` — Spec A's interface unchanged.
- `server/lib/withBackoff.ts`, `server/lib/runCostBreaker.ts`, `server/lib/createWorker.ts` — unchanged.
- `server/db/schema/agentRuns.ts` — unchanged. The sandbox correlation is via `sandbox_executions.run_id` referring to `agent_runs.id`; no new columns on `agent_runs`.

---

## 20. Contracts (consolidated)

Per `docs/spec-authoring-checklist.md § Section 3`, every shape that crosses a boundary or is consumed by a parser must have a Contracts entry with an example.

### 20.1 `SandboxRunTaskInput` (input descriptor)

- **Type:** TypeScript type in `shared/types/sandbox.ts`.
- **Producer:** Calling adapter (`iee_dev` today, future OpenClaw).
- **Consumer:** `SandboxExecutionService.runTask`, the harvest pipeline, telemetry writer.
- **Source-of-truth precedence:** `sandboxExecutionId` is caller-generated; if a row already exists in `sandbox_executions` with the same ID, that row's pinned policy / ceilings / template wins on read (idempotent retry).
- **Nullability:** All fields required except `policy.network.allowlist` (only when `policy.network.mode === 'allowlist'`), `credentialIssuanceContext.aliases` may be empty.
- **Example instance:**

```json
{
  "sandboxExecutionId": "0193e4d5-1234-7abc-8def-1234567890ab",
  "organisationId": "org_01HXYZ...",
  "subaccountId": "sub_01HXYZ...",
  "runId": "run_01HXYZ...",
  "agentId": "agent_01HXYZ...",
  "taskId": "task_01HXYZ...",
  "templateName": "synthetos-sandbox",
  "templateVersion": "v1.0.0",
  "policy": {
    "network": { "mode": "none" },
    "filesystem": { "writableRoot": "/workspace" },
    "ceilings": { "wallClockMs": 60000, "costCents": 1 },
    "artefactLimits": { "perArtefactBytes": 10485760, "totalBytes": 104857600 },
    "allowRuntimeInstall": false,
    "inputLimits": { "maxBytes": 26214400, "allowedMimes": ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
    "providerThresholds": { "startTimeoutMs": 30000 }
  },
  "inputBytes": 4096,
  "inputFiles": [
    { "path": "input/orders.csv", "contentHash": "sha256:abc...", "bytes": 4096, "mime": "text/csv" }
  ],
  "credentialIssuanceContext": {
    "aliases": [
      { "alias": "openai_api", "connectionId": "conn_01HXYZ...", "scope": "chat.completions.read", "expectedDurationMs": 60000 }
    ]
  },
  "outputSchemaRef": "schemas/csv-parse-result.json"
}
```

### 20.2 `SandboxRunTaskOutput` (caller-facing result)

- **Type:** TypeScript type in `shared/types/sandbox.ts`.
- **Producer:** `SandboxExecutionService.runTask` (after harvest completes).
- **Consumer:** Calling adapter, downstream run aggregation.
- **Source-of-truth precedence:** `terminalState` here matches `sandbox_executions.status` exactly; if the row was updated after harvest (correction etc.), the caller re-reads via `getExecution`.
- **Example instance (completed):**

```json
{
  "sandboxExecutionId": "0193e4d5-1234-7abc-8def-1234567890ab",
  "terminalState": "completed",
  "output": { "rows_parsed": 1024, "columns": ["order_id", "amount_cents"], "errors": [] },
  "artefactRefs": [
    { "filename": "summary.json", "objectKey": "sandbox-artefacts/org_X/sub_Y/exec_Z/summary.json", "bytes": 512, "contentHash": "sha256:def..." }
  ],
  "logRefs": { "stdout": "log_ref_stdout_X", "stderr": "log_ref_stderr_X" },
  "metrics": { "wallClockMs": 4321, "vcpuSeconds": 1.2, "peakMemoryMb": 64, "egressBytes": 0 },
  "costCents": 1,
  "templateName": "synthetos-sandbox",
  "templateVersion": "v1.0.0",
  "provider": "e2b"
}
```

- **Example instance (timed_out):**

```json
{
  "sandboxExecutionId": "0193e4d5-1234-7abc-8def-1234567890ab",
  "terminalState": "timed_out",
  "output": null,
  "artefactRefs": [],
  "logRefs": { "stdout": "log_ref_stdout_X", "stderr": "log_ref_stderr_X" },
  "metrics": { "wallClockMs": 60002, "vcpuSeconds": 2.0, "peakMemoryMb": 128, "egressBytes": 0 },
  "costCents": 1,
  "templateName": "synthetos-sandbox",
  "templateVersion": "v1.0.0",
  "provider": "e2b"
}
```

### 20.3 `sandbox_executions` table row

- **Type:** Postgres row (Drizzle schema in `server/db/schema/sandboxExecutions.ts`).
- **Columns:** `id` (UUID PK = `sandbox_execution_id`), `organisation_id`, `subaccount_id`, `run_id`, `agent_id`, `task_id`, `provider`, `template_name`, `template_version`, `template_digest`, `template_build_commit`, `provider_project`, `status` (closed enum from §13), `policy_json` (JSONB snapshot of the policy at run start), `input_summary_json` (size + MIME + file count — no content), `output_json` (JSONB, redacted, schema-validated, nullable until terminal), `metrics_json` (wall-clock, vcpu, memory, egress), `cost_cents` (provider-reported), `started_at`, `terminated_at`, `harvested_at`, `error_reason` (FailureReason, nullable), `error_detail` (text, redacted), `attempt_number` (integer; for crash retries), `is_active` (boolean, soft-delete flag).
- **Indexes:** PK; `(organisation_id, started_at DESC)`; `(subaccount_id, started_at DESC)`; `(run_id)`; `(status) WHERE status IN ('pending', 'running', 'harvesting')` (partial — for reconciliation queries).
- **Constraints:** `UNIQUE (id)` (PK); CHECK `status IN (...closed enum...)`.
- **RLS:** `FORCE ROW LEVEL SECURITY`; policy joins on `organisation_id = current_setting('app.organisation_id')::uuid`.

### 20.4 `sandbox_artefacts` table row

- **Type:** Postgres row (`server/db/schema/sandboxArtefacts.ts`).
- **Columns:** `id` (UUID PK), `sandbox_execution_id` (FK to `sandbox_executions.id`), `organisation_id`, `subaccount_id`, `filename`, `object_key`, `bytes`, `content_hash` (sha256), `mime` (sniffed), `uploaded_at`, `object_storage_state` (`uploaded | expired | purged`), `is_active`.
- **Indexes:** PK; `UNIQUE (sandbox_execution_id, filename)` — DB-level idempotency.
- **RLS:** as above, FORCE RLS, scoped by `organisation_id`.

### 20.5 `sandbox_telemetry_events` table row

- **Type:** Postgres row (`server/db/schema/sandboxTelemetryEvents.ts`).
- **Columns:** `id` (UUID PK), `sandbox_execution_id`, `organisation_id`, `subaccount_id`, `run_id`, `agent_id`, `task_id`, `provider`, `template_name`, `template_version`, `event_type` (closed enum from §14.2), `event_at`, `sequence` (integer; per-execution ordered), `criticality` (`info | warn | error`), `payload_json`.
- **Indexes:** PK; `UNIQUE (sandbox_execution_id, sequence)`; `(organisation_id, event_at DESC)`; `(event_type, event_at DESC)` (partial on warn/error).
- **RLS:** as above.

### 20.6 `sandbox_egress_audit` table row

- **Type:** Postgres row (`server/db/schema/sandboxEgressAudit.ts`).
- **Columns:** `id` (UUID PK), `sandbox_execution_id`, `organisation_id`, `subaccount_id`, `run_id`, `destination_class` (`internal | customer | vendor | unknown`), `destination_host`, `destination_port`, `destination_protocol` (`http | https | tcp | other`), `credential_context_alias`, `outcome` (`allow | deny`), `decision_at`, `policy_rule_id` (which allow-list entry matched, if any).
- **Indexes:** PK; `(organisation_id, decision_at DESC)`; `(sandbox_execution_id)`.
- **RLS:** as above.

### 20.7 `llm_requests` extended row (sandbox_compute)

- **Type:** Postgres row, existing table extended.
- **Producer:** `sandboxHarvestService` step 10.
- **Consumer:** Metering rollup queries, billing reconciliation, `runCostBreaker` aggregate writer.
- **Source-of-truth precedence:** This row is the billable canonical record. `sandbox_executions.cost_cents` is a denormalised cache; on disagreement, the `llm_requests` row + any correction rows win.
- **Example instance (sandbox_compute):**

```json
{
  "id": "lr_01HXYZ...",
  "organisationId": "org_01HXYZ...",
  "subaccountId": "sub_01HXYZ...",
  "agentRunId": "run_01HXYZ...",
  "sourceType": "sandbox_compute",
  "sandboxExecutionId": "0193e4d5-1234-7abc-8def-1234567890ab",
  "sandboxVcpuSeconds": "1.2",
  "sandboxWallClockMs": 4321,
  "sandboxProvider": "e2b",
  "sandboxTemplateVersion": "v1.0.0",
  "costRaw": "0.0080",
  "costWithMargin": "0.0100",
  "costWithMarginCents": 1,
  "fixedFeeCents": 0,
  "createdAt": "2026-05-11T10:00:00.000Z"
}
```

### 20.8 `FailureReason` enum additions

| New value | Surfaces |
|---|---|
| `sandbox_timeout` | Wall-clock ceiling tripped. |
| `sandbox_cost_ceiling` | Cost ceiling tripped. |
| `sandbox_output_invalid` | `output.json` missing / malformed / schema-failed. |
| `sandbox_harvest_failed` | Post-terminal harvest read failed. |
| `sandbox_artefact_upload_failed` | Object-storage upload failed. |
| `sandbox_provider_unavailable` | Provider ambiguous-terminal, unavailability, or both enforcement layers failed. |
| `sandbox_credential_denied` | Broker refused to issue (long-lived token + no proxy). |
| `sandbox_input_rejected` | Preflight validator rejected. |

---

## 21. RLS / permissions checklist

Per `docs/spec-authoring-checklist.md § Section 4`, every new tenant-scoped table needs all four of:

1. RLS policy in the migration that creates the table.
2. Entry in `server/config/rlsProtectedTables.ts`.
3. Route-level / middleware guard (if accessed via HTTP).
4. Principal-scoped context (if read from an agent execution path).

### 21.1 Coverage for Spec B's new tables

| Table | RLS policy | Manifest entry | HTTP guard | Principal-scoped context |
|---|---|---|---|---|
| `sandbox_executions` | Yes — in migration. `FORCE RLS`. Policy on `organisation_id`. | Yes — appended to `RLS_PROTECTED_TABLES`. | N/A in Phase 2. Phase 3.5+ if a customer-visible endpoint is added. | Yes — accessed only via `withOrgTx` / `getOrgScopedDb` from `sandboxExecutionService`, `sandboxHarvestService`, reconciliation job. Job context resolver uses `agent_runs.organisation_id` via the payload. |
| `sandbox_artefacts` | Yes — `FORCE RLS`. | Yes. | N/A in Phase 2. If an "open this artefact" endpoint is needed, it goes through `requirePermission` + signed-URL with `deriveSignedUrlExpiry` (existing pattern from `runArtifacts.ts`). Out of scope for Spec B's V1. | Yes — same orgScoped path. |
| `sandbox_telemetry_events` | Yes — `FORCE RLS`. | Yes. | N/A in Phase 2. | Yes — same. |
| `sandbox_egress_audit` | Yes — `FORCE RLS`. | Yes. | N/A in Phase 2. | Yes — same. |

### 21.2 Coverage for the extended `llm_requests` rows

`llm_requests` is already RLS-protected (existing manifest entry). The new `sandbox_compute` rows inherit the existing policy. No new policy / manifest work needed beyond extending the CHECK constraint (§12.2).

### 21.3 No opt-out

None of Spec B's new tables are intentionally non-tenant-scoped. The four tables above are all `(organisationId, subaccountId)` scoped. Reference data (provider names, terminal states, event types) is in code constants, not in tables.

### 21.4 Read paths

All read paths against the new tables flow through `getOrgScopedDb()` or `withOrgTx`. The `verify-rls-contract-compliance` CI gate (existing, from PR #274 / #275) rejects any direct `db.select().from(sandbox*)` import in service code. Reconciliation jobs use the existing `createWorker` org-context resolver path (extracts `organisationId` from the job payload, opens `withOrgTx`).

### 21.5 Admin / cross-tenant access

Spec B has zero admin / system-wide read endpoints. Operator visibility comes from the structured-log events (§14.3), not from cross-tenant DB queries. If a Phase 3.5+ admin dashboard is built, it uses `withAdminConnection` per the existing P3B principal-scoped pattern (architecture.md §1116).

## 22. Execution model

Per `docs/spec-authoring-checklist.md § Section 5`, every behaviour crossing a transactional or latency boundary picks one of: inline / sync, queued / async, cached / partition. Spec B has several behaviours; each gets its own pick.

| Behaviour | Model | Why |
|---|---|---|
| `SandboxExecutionService.runTask` | **Inline / synchronous** | The calling adapter blocks on the task result. No pg-boss row for this call. Provider-side concurrency in e2b means one Node process holds one sandbox handle for the duration; the task itself runs in the sandbox process. |
| Provider-side ceiling enforcement | **Inline** (in the sandbox provider's own timer) | Enforcement runs inside the sandbox lifecycle — provider terminates on timer expiry. No external scheduler. |
| Worker-side ceiling fallback (`sandboxCeilingMonitorJob`) | **Queued / async (pg-boss)** | A job scheduled at execution start, wakes at `wallClockMs + buffer`, polls + terminates if provider didn't. Decoupled from the calling Node process so a crashed worker still has its sandbox terminated. |
| Post-terminal harvest pipeline | **Inline within `runTask` for the happy path; async reconciliation for crashes** | The default path: provider returns terminal → calling Node process runs harvest inline → `runTask` returns. If the Node process dies between terminal and harvest completion, `sandboxHarvestReconciliationJob` (pg-boss, scheduled every 5 minutes — V1 cadence) picks it up. |
| Harvest reconciliation (`sandboxHarvestReconciliationJob`) | **Queued / async (pg-boss)** | Reads `sandbox_executions` rows in `pending` / `running` / `harvesting` past their wall-clock-plus-buffer. Re-enqueues harvest. |
| Cost row write | **Inline** within harvest step 10 | Single DB INSERT inside the harvest transaction for that step. Idempotent on `(sandbox_execution_id) WHERE source_type = 'sandbox_compute'` via the partial unique index. |
| Telemetry event writes | **Inline** to `sandbox_telemetry_events` | Each event INSERT is its own statement. Sequence allocation atomic via `INSERT ... RETURNING sequence` pattern (mirrors `agentExecutionEventService`). |
| Telemetry pruning (`sandboxTelemetryPruneJob`) | **Queued / async (pg-boss), scheduled daily** | Decoupled from request lifecycle; runs as a maintenance job. |
| Egress audit pruning | **Queued / async (pg-boss), scheduled daily** | Same shape as telemetry pruning. |
| Artefact purge on run delete (`sandboxArtefactPurgeJob`) | **Queued / async (pg-boss), triggered by run soft-delete event** | Decoupled because object-storage delete can be slow and shouldn't block the soft-delete request. |
| Provider call retry (`withSandboxProvider`) | **Inline within the calling Node process** | `withBackoff`-style retry inside `runTask`. No pg-boss for transient retries — only for ambiguous-terminal reconciliation. |
| Caller-driven retry after `timed_out` / `cost_ceiling` / `crashed` | **Caller-managed** (the adapter / agent run decides) | Spec B does not implement a generic retry loop; the calling run decides whether to re-invoke `runTask` with a new `sandboxExecutionId`. |
| Sandbox-minute metering rollups | **Inline read** at query time (no precomputed aggregates in V1) | The pure rollup helpers (`getOrgSandboxMinutes` etc.) compose SQL over `llm_requests` filtered by `source_type = 'sandbox_compute'`. Phase 3.5+ may add a materialised view if query latency demands it. |

### 22.1 Consistency pass

Three checks per `docs/spec-authoring-checklist.md § Section 5`:

1. **Does any async job have an idempotency row?** Yes — all five new jobs are idempotent on `sandbox_execution_id` (reconciliation, ceiling monitor, telemetry prune, egress audit prune, artefact purge). Telemetry / egress prune is idempotent on `(table, cutoff_date)` — re-running with the same cutoff is a no-op since rows are already gone.
2. **Sync vs async prose match?** Yes — Spec B describes `runTask` as a synchronous call from the adapter's perspective; harvest happens inline within `runTask`'s lifetime except for the reconciliation fallback.
3. **Non-functional goals contradict model?** No. Spec B does not claim cache efficiency or sub-millisecond latency for sandbox calls — sandboxes have inherent start-up time (seconds, not ms), so the inline model is appropriate.

---

## 23. Phase plan + dependency graph

Spec B is one feature (no Phase A / B / C internal split). The plan is decomposed into 14 implementation chunks under one Phase 2 build. The plan file (`tasks/builds/sandbox-isolation/plan.md`) is authored in Phase 2 by `feature-coordinator` invoking `architect`.

Spec B's chunking pre-plan (for the architect's reference, not a final plan):

| Chunk | Scope | Depends on |
|---|---|---|
| C1 — Types + schema | `shared/types/sandbox.ts`, four new Drizzle schemas, four migrations, `RLS_PROTECTED_TABLES` updates. | (none) |
| C2 — `FailureReason` extension | `shared/iee/failure.ts` enum additions. | C1 (for type consistency, though weak dep) |
| C3 — `llm_requests` extension | Schema extension migration; CHECK constraint; partial unique index. | C1 |
| C4 — Provider resolver + `inlineSandbox` | `sandboxProviderResolver.ts`, `inlineSandbox.ts`, hard guards. | C1, C2 |
| C5 — `SandboxExecutionService` skeleton + pure helpers | `sandboxExecutionService.ts`, `sandboxExecutionServicePure.ts` (classifyTerminal, resolveSandboxCeilings). Pure tests. (`classifyExecutionClass` is in `ieeDevBackendPure.ts`, built in C13.) | C4 |
| C6 — Output schema validation + redaction wiring | `sandboxHarvestServicePure.ts` (parts of), Zod schema-resolution. | C5 |
| C7 — Harvest pipeline | `sandboxHarvestService.ts` (all 12 steps). Reuses `redactValue`, object-storage client. | C6, C3 |
| C8 — `withSandboxProvider` wrapper | `server/lib/withSandboxProvider.ts`. Backoff + ambiguous-terminal reconciliation. | C5 |
| C9 — `e2bSandbox` provider | `e2bSandbox.ts`. Uses `withSandboxProvider`. | C5, C8 |
| C10 — `localDockerSandbox` provider | `localDockerSandbox.ts`. Reads from local-built image. | C5 |
| C11 — Pg-boss jobs | `sandboxHarvestReconciliationJob` (needs harvest pipeline from C7), `sandboxCeilingMonitorJob` (needs the `withSandboxProvider` terminate path from C8 AND the provider implementations from C9/C10), `sandboxTelemetryPruneJob`, `sandboxEgressAuditPruneJob`, `sandboxArtefactPurgeJob`. `server/jobs/index.ts` registration. | C7, C8, C9 (and C10 for local-dev parity) |
| C12 — Template Dockerfile + CI publish pipeline | `infra/sandbox-templates/synthetos-sandbox/*`, `docker-compose.sandbox.yml`, CI workflow update. | C1 (so e2b/localDocker can be tested e2e once built) |
| C13 — `iee_dev` adapter rewiring + classification helper | Modify `ieeDevBackend.ts`, add `ieeDevBackendPure.ts` with `classifyExecutionClass`, pure tests. | C5, C9 (or C10 for local), C12 (templates must be built and pinned before adapter rewiring goes live in CI — see §23.1) |
| C14 — CI gates + doc-sync | 5 new gate scripts; `architecture.md` update; `docs/capabilities.md` row; `docs/env-manifest.json` updates; migration dry-run script. | All of C1–C13 |

### 23.1 Dependency graph

```
C1 ──┬──> C2 ──> C5 ──> C6 ──> C7 ──> C11 ──┐
     │                  │           ^       │
     │                  └──> C8 ────┤───────┤
     │                       │      │       │
     │                       └──> C9 ───────┤
     │                               │      │
     ├──> C3 ──> C7                  └─> C13 ──> C14
     │                                    ^
     ├──> C4 ──> C5                       │
     │           │                        │
     │           └──> C10 ──┬──> C13      │
     │                      └──> C11      │
     │                                    │
     └──> C12 ─────────────────────────────┘
```

Notes:
- `C12 → C13`: the `iee_dev` adapter rewiring cannot land in CI before the template Dockerfile + CI publish pipeline exists, because the new dispatch path resolves `template_version` against `CURRENT_VERSION` (§15.2) and refuses `latest` (§15.3). C12 itself depends only on C1 (the schema must be in place), so C12 can run in parallel with most of the C2–C11 fanout — but the gating edge into C13 is mandatory.
- `C8/C9/C10 → C11`: the `sandboxCeilingMonitorJob` inside C11 calls the provider's terminate API through the `withSandboxProvider` wrapper (C8) and the provider implementations (C9 + C10). C11's other jobs only need C7's harvest API, but the monitor's provider-terminate call path means C11 as a whole cannot land before C8/C9/C10 are in.

No backward dependencies. C14 (CI gates + doc-sync) closes the build. C12 (templates + CI publish) is parallelisable with most chunks but must complete before C13's adapter rewiring goes live in CI.

### 23.2 Cross-chunk invariants

- `classifyExecutionClass` is owned by `ieeDevBackendPure.ts` (built in C13) — the classification is adapter-specific. C5's pure module does not implement this helper.
- C11's jobs depend on C7's harvest API. C7 must lock the public surface before C11 starts.
- C14's CI gates are written last because they grep against the final code shape — implementing them earlier risks false positives on in-flight chunks.

### 23.3 No orphaned deferrals

The Deferred Items section (§27) lists every prose mention of "later" / "deferred" / "Phase N+1". The phase-sequencing review pass (Section 6 of the checklist) is run as part of §29.

## 24. Execution-safety contracts

Per `docs/spec-authoring-checklist.md § Section 10`, every new write path / state machine / externally-triggered operation must declare idempotency, retry, concurrency, terminal-event, partial-success, and unique-constraint-to-HTTP posture.

### 24.1 Idempotency posture (per externally-triggered write)

| Operation | Posture | Mechanism |
|---|---|---|
| `runTask` (create `sandbox_executions` row) | **key-based** | `UNIQUE (id)` on `sandbox_executions`. Caller-supplied `sandboxExecutionId`. Re-invocation with same ID joins the in-flight or terminal row. |
| `sandbox_executions` status transition | **state-based** | `UPDATE sandbox_executions SET status = $next WHERE id = $id AND status = $expected_pre`. 0 rows updated = lost race. |
| Cost row write | **key-based** | Partial unique index `(sandbox_execution_id) WHERE source_type = 'sandbox_compute'`. Re-write with same ID is a no-op / conflict-409. |
| Cost correction row write | **key-based** | Partial unique index `(sandbox_execution_id, correction_sequence) WHERE source_type = 'sandbox_compute_correction'` — `correction_sequence` increments per correction event. |
| Artefact upload row | **key-based** | `UNIQUE (sandbox_execution_id, filename)` on `sandbox_artefacts`. |
| Telemetry event write | **key-based** | `UNIQUE (sandbox_execution_id, sequence)` on `sandbox_telemetry_events`. |
| Egress audit write | **non-idempotent (intentional)** | Egress decisions are an append-only audit log; same `sandbox_execution_id` + `destination_host` can legitimately repeat. No idempotency key; duplicate writes are allowed and meaningful. |
| Provider start call | **state-based** | Provider call is wrapped: BEFORE call, atomic `INSERT INTO sandbox_executions (..., status='pending')`. If the row exists in `pending` from a prior attempt, the caller joins (does not re-issue). |
| Provider terminate call | **non-idempotent at provider, idempotent at our boundary** | The provider's terminate API may be called multiple times by us (worker-side fallback + reconciliation) — provider handles idempotency. On our side, the `sandbox_executions.status` state guard prevents duplicate terminal writes. |

### 24.2 Retry classification

| Operation | Classification | Boundary |
|---|---|---|
| Provider start | guarded | `withSandboxProvider` (`withBackoff`-wrapped) |
| Provider terminate-poll | safe | `withSandboxProvider` |
| Provider file-read (harvest step 2, 5, 6) | safe | inside `sandboxHarvestService`, wrapped with `withBackoff` |
| Object-storage upload | guarded | `sandboxHarvestService` step 8; idempotent on `(sandbox_execution_id, filename)` |
| Cost row write | guarded | `sandboxHarvestService` step 10; idempotent on the partial unique index |
| Telemetry event write | guarded | telemetry event-write step inside `sandboxHarvestService` (§14.1, §22); idempotent on `(sandbox_execution_id, sequence)` via the unique index. No separate `*Writer` module — the harvest pipeline owns the write |
| `sandbox-harvest-reconciliation` job | safe | the job re-runs the full pipeline; every step is idempotent so safe to invoke |
| `sandbox-ceiling-monitor` job | safe | the job's only action is provider terminate, idempotent at provider |
| Cost-correction row write | guarded | partial unique index on `(sandbox_execution_id, correction_sequence)` |

No `unsafe` operations are exposed by Spec B to callers. Every external surface is wrapped by a guarded or safe boundary.

### 24.3 Concurrency guards for racing writes

Spec B's three principal race conditions:

- **Two harvest invocations** (one inline, one reconciliation): Guarded by `UPDATE sandbox_executions SET status='completed' WHERE status='harvesting'` — 0 rows updated → losing caller reads canonical row and exits.
- **Two cost-row writers** (e.g., two concurrent harvest attempts post-recovery): Guarded by the partial unique index. Losing caller catches `23505` and exits via `getExecution` confirming the row is canonical.
- **Status transition races** (e.g., reconciliation marks `provider_unavailable` while inline harvest is finalising `completed`): Guarded by the `UPDATE ... WHERE status = $expected` state predicate. Losing caller's state was based on stale read; loser exits without writing.

Unique-constraint violations map to HTTP / failure surfaces:

- `23505` on `sandbox_executions` PK (re-`runTask` with same ID): NOT a failure — the call returns the canonical row's output. 200 + idempotent hit.
- `23505` on `sandbox_artefacts(sandbox_execution_id, filename)`: NOT a failure — upload step skips because already uploaded. Emits one `artefact_uploaded` event with `payload_json.wasIdempotent: true` (§14.2); no new event-type added to the closed enum.
- `23505` on `sandbox_telemetry_events(sandbox_execution_id, sequence)`: Logged at warn; means the sequence allocator got out of sync. Internal-only; no caller surface.
- `23505` on `llm_requests(sandbox_execution_id) WHERE source_type='sandbox_compute'`: NOT a failure — row already written by prior attempt. Step 10 reads back and confirms costs match within tolerance.

### 24.4 Terminal event guarantee

Per the harvest pipeline (§8.4), every `sandbox_executions` row in a terminal state has exactly one CANONICAL terminal telemetry event: a `sandbox_terminal` event for post-start executions, or a `sandbox_start_failed` event for the pre-start failure path. The canonical terminal event is the first one written for a given `sandbox_execution_id`. Post-canonical-terminal prohibition: no further events with the same `sandbox_execution_id` after the canonical terminal EXCEPT:

- Cost-correction events from §12.4 (these are explicitly post-terminal corrections; allowed because they're additive to the audit trail, not contradictory).
- Reconciliation events from the harvest_failed / artefact_upload_failed recovery path (§13.1 reconciliation-recoverable exception). When the row re-enters `harvesting`, the recovery attempt emits its own `harvest_started` + `harvest_failed|artefact_uploaded|sandbox_terminal` events with `reconciliationAttempt: N` and `isCanonical: false` in the payload. The first `sandbox_terminal` event with `isCanonical: true` remains the only canonical terminal; subsequent ones are explicitly non-canonical recovery events that the "exactly one canonical terminal" rule does NOT cover.
- Late-arriving provider terminate events (e.g., e2b webhook fires after our wrapper already declared `provider_unavailable`): the late event is recorded with a `late_arriving: true` flag in `payload_json` and the canonical state is not changed.
- `provider_diagnostic` events are pre-terminal by definition (§14.2) and do not violate this rule; they cannot fire after the terminal event for the same `sandbox_execution_id`.

### 24.5 No silent partial success

Every multi-step harvest path emits one terminal event. If steps 2-7 (output / log / artefact extraction) succeed but step 8 (artefact upload) fails for a specific artefact, the terminal state is `artefact_upload_failed`, NOT `completed`. The customer-facing run trace does NOT show a fake-success completion: it surfaces an "execution pending / reconciling" status per §13.4 while the `sandbox-harvest-reconciliation` job re-attempts the upload. If reconciliation eventually succeeds, the customer sees the harvested output retroactively (now showing `completed`). If reconciliation also fails after retries, the run surfaces a typed failure (`sandbox_harvest_failed_permanent`, the derived state from §13.4) and an operator audit event fires. In neither case does the customer see a silently-empty artefacts list paired with a `completed` terminal — the §13.4 visibility posture (internal-while-reconciling, typed-failure-on-permanent) governs.

The pure helper `classifyHarvestOutcome(stepResults)` enforces this — given the step results, it produces exactly one of the 8 terminal states from §13.1, and `completed` requires all steps green.

### 24.6 Unique-constraint-to-HTTP mapping

Spec B introduces three new unique constraints; each has a defined HTTP / failure surface:

| Constraint | Caller surface | HTTP / failure |
|---|---|---|
| `UNIQUE (sandbox_execution_id)` on `sandbox_executions` | `runTask` retry with same ID | 200 + idempotent-hit (returns canonical row's output) |
| `UNIQUE (sandbox_execution_id, filename)` on `sandbox_artefacts` | Internal-only; harvest re-runs | Step is a no-op; no caller-visible HTTP |
| `UNIQUE (sandbox_execution_id, sequence)` on `sandbox_telemetry_events` | Internal-only; sequence allocator out of sync | Warn-logged; no caller-visible HTTP |
| Partial unique on `llm_requests(sandbox_execution_id) WHERE source_type='sandbox_compute'` | Internal-only; harvest re-runs | Step 10 reads back canonical; no caller-visible HTTP |

No `23505` from these constraints bubbles to a 500 — each is mapped above.

### 24.7 State machine closure

`sandbox_executions.status` is a closed status set. The valid transitions are pinned in §13.1. Forbidden transitions (state machine guarantees):

- No transition out of a strictly-absorbing terminal state. Cost corrections (§12.4) are insertions, not updates.
- The two recoverable terminals (`harvest_failed`, `artefact_upload_failed`) have an explicit transition back to `harvesting` via the reconciliation job (§13.1 reconciliation-recoverable exception). Recovery is atomic (`UPDATE ... WHERE status IN ('harvest_failed','artefact_upload_failed')`). After the §13.2 retry cap, the row's status stays absorbing at its last recovery-attempt terminal.
- No `running → completed`. `running` always transitions through `harvesting` first; the harvest pipeline owns the `completed` transition.
- No `harvesting → running`. Once a sandbox terminates, the sandbox process stays terminated even when the row state machine re-enters `harvesting` for reconciliation.

Adding a new status value requires a spec amendment AND a migration extending the CHECK constraint. The closed-set posture is what makes the §25 CI gates implementable.

---

## 25. Testing posture

Per `docs/spec-context.md`: `testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`. Spec B follows this strictly.

### 25.1 Pure function tests (mandatory)

Every pure helper module in §19.1 gets a paired `*.test.ts` covering decision branches:

- `sandboxExecutionServicePure.ts`:
  - `classifyTerminal(providerSignal, harvestResult)` — every input combination producing every output state.
  - `resolveSandboxCeilings(input)` — default vs override paths.
  - `inputPreflightValidator(input)` — accept / reject for every limit dimension (size, MIME, allow-list mismatch).
- `sandboxHarvestServicePure.ts`:
  - `classifyHarvestOutcome(stepResults)` — every step-result combination → one terminal state.
  - `composeRedactionPatternSet(defaultBundle, executionAliases)` — pattern set assembly.
- `sandboxMeteringQueryPure.ts`:
  - Rollup SQL composition for org-scope and subaccount-scope, month-range filters.
- `ieeDevBackendPure.ts`:
  - `classifyExecutionClass` paired with all known task variants the adapter dispatches today.

Tests live alongside the pure modules per the existing `*.test.ts` convention. Runner: Vitest. Authoring pattern: `expect()` API (no `node:assert`, no `node:test` — per `scripts/verify-test-quality.sh`).

### 25.2 Static CI gates (new)

Five new gate scripts (§19.2):

- `verify-sandbox-classification.sh` — grep-based. Fails if any `dispatch()` body in `executionBackends/` reaches an execution call (Node `child_process`, worker enqueue, etc.) without first consulting `classifyExecutionClass`. Pattern-set similar to PR #267 B.4 Pass 4.
- `verify-sandbox-minimum-events.sh` — grep-based. Three-pass check matching the phase-scoped contract in §14.5: (1) pre-start terminal-status writers (`pending → provider_unavailable` without entering `running`) must pair with a `sandbox_start_failed` event write; (2) post-start-without-output-read terminal-status writers (mid-execution `provider_unavailable`; `harvest_failed` at step 2) must pair with `sandbox_start` + `sandbox_terminal` (`harvestStepReached < 3`); (3) post-start-with-output-read terminal-status writers (all other terminals) must pair with `sandbox_start` + `sandbox_terminal` (`harvestStepReached >= 3`) + one of (`output_validated` | `output_validation_failed`). The three paths are distinguished by whether `running` was entered (pass 1 vs 2/3) and by the `harvestStepReached` payload field (pass 2 vs 3).
- `verify-template-version-coherence.sh` — checks `infra/sandbox-templates/synthetos-sandbox/CURRENT_VERSION` matches an existing git tag prefixed `sandbox-template/synthetos-sandbox/v*` (or `local-dev-*` for non-publish branches).
- `verify-no-sandbox-cost-update.sh` — grep-based. Fails if any `.ts` file contains an `update(llmRequests)` / `db.update(llmRequests)` call against the sandbox-source-type rows.
- `verify-no-inline-sandbox-outside-test.sh` — grep-based. Fails if `inlineSandbox` import / construction appears outside `.test.ts`, `__tests__/`, or `e2e/` paths.

All five gates plug into the existing CI workflow alongside the gates from PR #267 / PR #275 / PR #280.

### 25.3 Existing CI gates inherited (no new work)

- `verify-rls-coverage.sh` — automatically picks up the four new tables once their manifest entries exist.
- `verify-rls-contract-compliance.sh` — automatically rejects raw-DB-access regressions in Spec B's services.
- `verify-test-quality.sh` — automatically rejects `node:assert` / `node:test` in new test files.
- `verify-pure-helper-convention.sh` — enforces the `*ServicePure.ts` naming + dual-export pattern (from PR #267).
- `lint`, `typecheck` — standard.

### 25.4 Per-chunk G1 gate

Per the pipeline spec, every chunk's builder runs G1: lint + typecheck + build:server + build:client + targeted pure unit tests for new pure functions in THAT chunk. No full test suite locally — CI handles that.

### 25.5 No new frontend / E2E / API-contract tests

Per `docs/spec-context.md § convention_rejections`:
- `do not add frontend unit tests (until Phase 2 trigger)` — Spec B has no frontend.
- `do not add supertest for API contract tests` — Spec B has no new HTTP routes in V1.
- `do not add E2E tests against the app` — n/a.

Sandbox-provider e2e (against a real e2b project) is NOT part of Spec B's V1 test plan. The pure tests cover decision logic; integration with the real provider is exercised by the first Phase 2 feature that uses the sandbox (e.g., Revenue Ops CSV parsing). This is acceptable because the framing posture is `commit_and_revert` with manual exercise.

### 25.6 Integration-test escape hatch

If during build an integration concern arises that pure tests cannot capture (e.g., RLS context propagation across the new tables), the existing `rls.context-propagation.test.ts` harness pattern (`server/services/__tests__/`) is extended with one or two cases for the new tables. This is an inherited primitive, not a new test category.

---

## 26. Concurrent build coordination (Spec C)

Spec B and Spec C (`operator-session-identity`) run in parallel on separate branches. Cross-coordination points:

### 26.1 No code-area conflicts

- **Spec B's code surface:** `server/services/sandbox*`, `server/services/executionBackends/ieeDev*`, `server/db/schema/sandbox*`, `infra/sandbox-templates/`, `server/lib/withSandboxProvider.ts`, `server/lib/sandboxRetentionConstants.ts`, `server/jobs/sandbox*`, the four new migrations + `llm_requests` extension migration.
- **Spec C's code surface:** `server/services/credentialBroker*`, OAuth callback handlers, new consent-log table, connection UI. Per brief §3.

These do not overlap. Both touch `architecture.md` (different sections) and `llm_requests` schema (different `source_type` values). Doc-sync sweep at finalisation reconciles.

### 26.2 Shared design points

| Point | Coordination |
|---|---|
| `llm_requests.sourceType` enum | B adds `'sandbox_compute'` + `'sandbox_compute_correction'`; C adds `'subscription_mediated'`. Each spec's migration extends the enum independently. The CHECK constraint is amended per source-type pairing — each spec adds its own pairing rule. Coexist on a single agent run (e.g., an OpenClaw run later may have rows of multiple source types). |
| Sub-account scoping | Both enforce. B threads `subaccountId` through `SandboxExecutionInput` and into every new table. C inherits from existing CredentialBroker behaviour (PR #279). No conflict. |
| Credential redaction patterns | B's harvest pipeline (§11.3) and C's CredentialBroker logging behaviour must agree on `DEFAULT_REDACTION_PATTERNS`. The first spec to merge defines the shared bundle; the second consumes it. The second-to-merge spec must rebase its `redaction.ts` edits if needed; the redaction module is small and the rebase is mechanical. |
| `architecture.md` updates | B adds a "Sandbox Isolation primitive" section; C adds a "Credential Broker — operator-session-identity" section. Different sections — no merge conflict. The doc-sync sweep at finalisation reconciles ordering. |

### 26.3 Conflict resolution if both reach merge simultaneously

If both PRs hit the merge queue at the same time:

- Second-to-merge rebases against first-to-merge.
- Rebase conflicts expected in two places:
  - `migrations/` numbering — second renumbers its migrations.
  - `server/db/schema/llmRequests.ts` enum extension — second appends to the enum, doesn't conflict if both added entries to the end (preferred extension style).
- The `RLS_PROTECTED_TABLES` array appends — different tables, both appended, no conflict.

No merge-blocking design conflict. Either spec can land first.

### 26.4 Sibling reference

Spec C's spec, when authored, references Spec B's `SandboxExecutionService` only in the abstract — sandbox-derived telemetry inherits the existing credential-broker audit shape; the two specs do not directly depend on each other's code beyond `redaction.ts` and the `sourceType` enum coordination.

## 27. Deferred items

Per `docs/spec-authoring-checklist.md § Section 7`, every prose mention of "deferred", "later", "Phase N+1", "future", "not in this phase" maps to a row here.

- **Customer-visible sandbox-minute UI.** Phase 3.5+. V1 ships the queryable data via `sandboxMeteringQueryPure`; the dashboard is a separate spec. Reason: V1 unblocks Phase 2 features; UI is not on the critical path.
- **OpenClaw `openclaw-session` template contents.** Owned by the OpenClaw adapter spec. Spec B provides empty scaffolding under `infra/sandbox-templates/openclaw-session/` and the CI publish hook only.
- **Long-lived session semantics** (`Sandbox.connect()`). OpenClaw adapter spec. Spec B's `runTask` is single-task ephemeral.
- **Multi-region / data residency.** Phase 4+. V1 uses one e2b project per environment.
- **Self-hosted Firecracker.** Decision 1 triggers (25% of LLM spend or sovereign customer). Vendor adapter pattern preserves swap-out.
- **Routing policy across sandbox vendors.** Phase 3.5+. V1 has one vendor.
- **Materialised metering aggregates.** Phase 3.5+ if query latency demands. V1 reads `llm_requests` directly.
- **Runtime package install for the Dev Agent partial MVP** (§9.5). Deferred decision. V1 ships with `allowRuntimeInstall: false` everywhere; whether to enable it for the Dev Agent's specific task class is a Phase 2 follow-up decision, not Spec B.
- **Cost passthrough vs bundling in plan tiers.** Pricing decision, not Spec B.
- **Per-org sandbox-call rate budget** (§16.5). Phase 3.5+ if rate-limiting becomes necessary.
- **Out-of-band re-scan of existing published template versions** (§15.4). V1 retroactively identifies vulnerable-version usage via the per-execution `template_version` + `template_build_commit` columns; full re-scanning is a Phase 3.5+ ops task.
- **Cross-tenant admin dashboard** (§21.5). Phase 3.5+. Spec B ships operator visibility via structured logs only.
- **Sandbox provider failover** to a second vendor (e.g., Modal as backup when e2b is down). Decision 1 keeps the option open via vendor-adapter pattern; failover orchestration is a Phase 3.5+ concern.
- **Customer-side artefact retention overrides.** V1 has fixed 90-day retention. Customer- / tenant-level overrides are Phase 3.5+.
- **Sandbox-side egress payload logging.** Explicitly prohibited in V1 (§9.1). Not a "deferred" — a hard non-goal — but listed here so reviewers don't confuse "we don't log payloads" with "we forgot."
- **Atomic-claim sequence allocator for `sandbox_telemetry_events`** (§28 #1). V1 uses simple `INSERT ... RETURNING` with unique-constraint retry. Promote to an atomic-claim helper if a real workload demands it.
- **Cost-poll interval tuning** (§28 #4). V1 ships with 5-second polling for the worker-side cost-ceiling fallback. Re-evaluate after first month of production cost data; the interval is a parameter, not a contract.
- **Object-storage prefix alignment with `fileService` / `fileDeliveryService`** (§28 #6). If build-time inspection finds a path-convention drift, alignment is a follow-up task — Spec B's sandbox prefix is independent of existing file-delivery paths.
- **ADR `docs/decisions/0009-sandbox-execution-service.md`** (§28 #8). Authored during Phase 2 build, not Phase 1.
- **`SANDBOX-DEF-EGRESS-MECH`** (§9.1). Build-time choice of egress interception mechanism (e2b SDK hooks vs application-layer proxy vs CNI/eBPF). Audit-row schema is locked in §20.6 independent of the mechanism. Decision lands during C12 template-build chunk after verifying e2b's exposed hooks.
- **`SANDBOX-DEF-LOG-SCHEMA`** (§8.4 step 9, §17.1). Build-time choice of sandbox log sink (new `sandbox_logs` table vs extension of an existing structured-log layer). Whichever path is chosen MUST honour the `(sandbox_execution_id, log_stream, sequence)` idempotency key and per-tenant RLS. Decision lands during C7 harvest pipeline chunk.

---

## 28. Locked V1 decisions (formerly open questions)

The questions below were carried forward from the brief intake for `spec-reviewer` adjudication. Each has been locked to a V1 mechanism. Items that genuinely belong post-V1 are routed to the Deferred items section (§27) with a `SANDBOX-DEF-*` tag if they require ongoing tracking.

1. **Sequence allocator for `sandbox_telemetry_events`** — locked: `INSERT ... RETURNING sequence` with `coalesce(max(sequence)+1, 1)` subquery within a single statement; the existing `UNIQUE (sandbox_execution_id, sequence)` constraint catches races and the harvest pipeline retries the INSERT (idempotent retry already inherited from `withBackoff`-style boundary in §24.2). Defer: atomic-claim helper. Captured in §27 as a deferred ops improvement if real-world workload demands it.

2. **`local_docker` cost row shape** — locked: always write a zero-cost `sandbox_compute` row for shape parity with `e2b` rows (§12.5). No `RECORD_LOCAL_DOCKER_COSTS` env flag. Local-dev row volume is acceptable.

3. **Egress audit table scope** — locked: ship `sandbox_egress_audit` day-1 (§20.6), even though V1's default `network: 'none'` policy means most executions write zero rows. The migration is cheap; post-hoc enabling would require a second migration plus retroactive design work.

4. **Provider-side cost ceiling enforcement granularity** — locked: V1 ships with the two-layer model in §10.2, with the worker-side `sandbox-ceiling-monitor` job polling provider cost at **5-second intervals** between the start of the sandbox and `wallClockMs + buffer`, AND firing a hard terminate at the cost ceiling regardless of provider real-time-cost-API support. The wall-clock ceiling remains the absolute upper bound (a sandbox without real-time cost data still terminates at its wall-clock limit). This satisfies brief §2.7 / §6 invariants — both ceilings are enforced, never only in app logic, and the worker-side fallback covers the case where the provider's billing API is not real-time. Re-evaluate the polling interval after first month of production cost data; the 5-second value is a §27 deferred parameter, not a load-bearing contract.

5. **`sandbox_input_rejected` audit shape** — locked: recorded on the calling run's `agent_runs.failure_reason` column with structured detail in the existing run-failure trace. No new audit surface, no `sandbox_executions` row, no `sandbox_telemetry_events` row. The build chunk confirms the trace shape matches the existing `failure_reason` convention.

6. **Object-storage prefix structure** — locked: `sandbox-artefacts/{orgId}/{subaccountId}/{sandboxExecutionId}/{filename}`. If a build-time check against `fileService` / `fileDeliveryService` finds a drift in path conventions, that's a §27 deferred alignment task (not a Spec B blocker — the sandbox prefix is independent of existing file-delivery paths).

7. **`tasks/todo.md` deferred items closed by this spec** — locked: greenfield spec, no prior items closed. Any new items surfaced during review are routed to `tasks/todo.md` under the `SANDBOX-DEF-*` namespace.

8. **ADR-worthy decisions** — locked: an ADR `docs/decisions/0009-sandbox-execution-service.md` will be authored during Phase 2 build, capturing the vendor-adapter pattern, the `SandboxExecutionService` boundary, and the "no silent fallback" decision. The ADR is doc-sync work, not a Phase 1 deliverable.

All eight items are now locked. There are no open questions blocking Phase 2 build kickoff.

---

## 29. Self-consistency pass result

Per `docs/spec-authoring-checklist.md § Section 8`, this section is the final pass before sending to `spec-reviewer`. Results:

### 29.1 Goals ↔ implementation match

Each G1–G15 from §2 cross-referenced:

- G1 (interface) → §8.1 ✅
- G2 (three implementations) → §8.2.1–§8.2.3 ✅
- G3 (output contract + harvest) → §8.3, §8.4 ✅
- G4 (idempotency on `sandboxExecutionId`) → §24.1, §24.6 ✅
- G5 (wall-clock + cost ceilings) → §10 ✅
- G6 (credentials task-scoped, sub-account-scoped) → §11 ✅
- G7 (default-deny posture) → §9 ✅
- G8 (closed terminal-state taxonomy) → §13.1, §24.7 ✅
- G9 (structured telemetry) → §14 ✅
- G10 (RLS-enforced rows) → §21, §14.4 ✅
- G11 (single canonical cost-ledger target) → §12 ✅
- G12 (immutable template version) → §15.3, §15.5 ✅
- G13 (provider unavailability fails closed) → §16 ✅
- G14 (retention + deletion) → §17 ✅
- G15 (`iee_dev` split) → §18 ✅

No goal lacks a corresponding implementation section. No implementation section operates outside a declared goal.

### 29.2 Brief §6 invariants ↔ spec coverage

Each invariant from `tasks/builds/sandbox-isolation/brief.md § 6` cross-referenced (paraphrased for brevity):

- Customer-derived code MUST NOT execute in worker → §7.2 + §18 + CI gate `verify-sandbox-classification` (§25.2). ✅
- `SandboxExecutionService` only approved boundary → §8.1 + CI gate. ✅
- Per-task scoping with org/subaccount/run/agent tags → §8.1 input descriptor + §14 tagging. ✅
- Credentials task-scoped, sub-account-scoped, redacted, excluded from artefacts → §11. ✅
- Harvested outputs through redaction layer → §8.4 step 4, step 7; §11.3. ✅
- Harvest / artefact upload / log persistence / cost-ledger idempotent by `sandboxExecutionId` → §24.1. ✅
- Wall-clock + cost ceilings mandatory, fail-closed, two-layer enforcement → §10.2, §10.3. ✅
- Default-deny posture for fs, network, credentials, artefacts, runtime install → §9. ✅
- `inlineSandbox` test-only, fails fast outside test → §8.2.3 + CI gate `verify-no-inline-sandbox-outside-test`. ✅
- Terminal states, retry posture, billing posture, telemetry per execution → §13, §14. ✅
- One canonical cost-ledger target → §12.1. ✅
- Sandbox provider failure fails closed → §16. ✅
- Production executions pin immutable template version / digest → §15.3, §15.5. ✅
- Runtime install governed; pre-baked deps preferred → §9.5. ✅
- Sandbox outputs untrusted until validated, size-limited, redacted, normalised → §8.3, §8.4. ✅
- Retention + deletion defined → §17. ✅
- Sandbox filesystems ephemeral, only harvested outputs retained → §17.2, §8.4 enumeration scope. ✅
- Inputs preflight-validated → §9.6. ✅
- Cost rows append-only / correction-based → §12.4 + CI gate `verify-no-sandbox-cost-update`. ✅
- Template CI defines vulnerability scanning posture → §15.4. ✅
- `localDockerSandbox` template parity contract → §8.2.2. ✅
- No broad `artefact` / `artifact` naming migration → §8.3, §19.5 (existing `run_artifacts` table unchanged). ✅
- Sandbox telemetry / artefacts / cost / egress audit RLS-enforced → §14.4, §21. ✅ (Logs: the per-tenant RLS / scoping requirement is **contractually mandated** — see §8.4 step 9 — but the concrete log-sink schema is a build-time decision tracked in §27 / `SANDBOX-DEF-LOG-SCHEMA`. Whichever sink is chosen MUST honour §14.4 / §21 scoping rules; the build PR updates the inventory and manifest in the same change.)
- Egress audit logging when network is allowed → §9.1, §14.2, §20.6. ✅
- Ledger rows retained / anonymised / correction-reversed on run deletion → §17.4. ✅

All 25 brief §6 invariants encoded. Spec B is conformant to its source brief.

### 29.3 Load-bearing claims with named mechanisms

Spot-check on the heaviest "must" / "guaranteed" claims:

- "Harvest is idempotent by `sandboxExecutionId`" — mechanism: partial unique indexes + state-based UPDATE guards (§24.1).
- "No silent fallback to worker" — mechanism: `withSandboxProvider` has no fallback code path; CI grep gate `verify-sandbox-classification` enforces (§16.2, §25.2).
- "Cost rows append-only" — mechanism: `verify-no-sandbox-cost-update` CI gate rejects UPDATE statements (§12.4).
- "Every sandbox execution emits the minimum events for its lifecycle phase" — mechanism: §14.5 scopes the requirement (pre-start failure emits `sandbox_start_failed`; post-start path emits `sandbox_start` + `sandbox_terminal` + one of `output_validated|output_validation_failed`); §13.1 state machine forces post-start terminals through `harvesting`; `verify-sandbox-minimum-events` CI gate enforces by phase.
- "Credentials never leak into artefacts" — mechanism: per-execution redaction pattern set (§11.3) + harvest pipeline step 7 (artefact metadata redact) + step 8 prefix-scoped storage + defense-in-depth check for `/workspace/secrets/` enumeration (§11.4).
- "Production refuses floating `latest` template" — mechanism: pure helper assertion (§15.3); `verify-template-version-coherence` gate.

No load-bearing claim is unbacked.

### 29.4 Phase sequencing check

- No backward dependencies in §23.1.
- No orphaned deferrals — every "deferred" mention in prose appears in §27. Verified by grep over the spec for "deferred", "later", "Phase 3.5+", "future". All occurrences are either in §27 or are cross-references to it.
- No phase-boundary contradiction — Spec B is a single Phase 2 build; no multi-phase contradictions possible.

### 29.5 Execution-model consistency

- Async ops have idempotency rows / unique keys (§24.1).
- Sync vs async prose matches the model (§22). `runTask` is described as synchronous-from-the-caller everywhere; harvest is described as inline-or-reconciled.
- Non-functional goals don't contradict the model. Spec B doesn't claim sub-second latency; sandbox start is acknowledged as seconds (§16.4).

### 29.6 Testing posture consistency

- Test plan limits itself to pure tests + static CI gates (§25). No vitest / supertest / E2E against the app.
- `verify-test-quality.sh` compatibility: all new test files use Vitest `expect()` (§25.1).

### 29.7 Pre-review checklist (appendix of `docs/spec-authoring-checklist.md`)

| Item | Status |
|---|---|
| Section 0 — verify deferred items | n/a (greenfield) ✅ |
| Section 1 — new primitives have "why not reuse" justifications | ✅ (§6 + §8.1 + §14.1) |
| Section 2 — file inventory has every new file / column / migration | ✅ (§19) — provisional for the log sink (build-time choice tracked in §27 / `SANDBOX-DEF-LOG-SCHEMA`; whichever option lands, the build PR updates §19/§21 in the same commit) |
| Section 3 — every contract has an example | ✅ (§20) |
| Section 3 — source-of-truth precedence declared | ✅ (§7.3, §20.1, §20.2, §20.7) |
| Section 4 — RLS / manifest / guard / principal-scope for each new tenant table | ✅ (§21) — log sink: the RLS / scoping requirement is contractually mandated in §8.4 step 9 / §29.2 but the concrete table or layer is a build-time decision (`SANDBOX-DEF-LOG-SCHEMA`); the build PR adds the entry to §21 in the same commit |
| Section 5 — execution model picked explicitly per behaviour | ✅ (§22) |
| Section 6 — phase dependency graph clean | ✅ (§23.1) |
| Section 7 — Deferred Items section exists | ✅ (§27) |
| Section 8 — self-consistency pass complete | ✅ (this section) |
| Section 9 — testing posture consistent with `docs/spec-context.md` | ✅ (§25.5) |
| Section 10 — idempotency / retry / concurrency / terminal-event / partial-success / unique-constraint declared | ✅ (§24) |
| Section 11 — spec frontmatter present | ✅ (top of file) |

**Spec B is ready for `spec-reviewer`.**
