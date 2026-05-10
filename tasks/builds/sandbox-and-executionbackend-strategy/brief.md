# Sandbox Isolation Strategy + ExecutionBackend Adapter Contract — Strategy Brief

**Status:** Draft v1.0  
**Date:** 2026-05-10  
**Type:** Strategy brief (DECISION document, not implementation spec)  
**Build slug:** `sandbox-and-executionbackend-strategy`  
**Authoritative parent:** `docs/synthetos-governed-agentic-os-brief-v1.2.md` Sections 18.2 (Phase 2) and 18.3 (Phase 3)  
**OpenClaw context:** `docs/openclaw-strategic-analysis.md` Phase 1 (ExecutionBackend adapter) and Phase 3 (Operator Session Identity)  
**Reviewer required:** Architect (sign-off on each decision)

This brief covers two related but distinct architectural decisions that must be made before their respective phases can begin. They are bundled in one brief because both involve picking a pluggable abstraction for execution backends, and resolving them together prevents drift between the two answers.

The decisions:

1. **Sandbox Isolation Strategy** — what primitive isolates per-task code execution. Phase 2 prerequisite.
2. **ExecutionBackend Adapter Contract** — what shape of pluggable interface lets OpenClaw, future internal backends, and any other operator runtime plug in. Phase 3 prerequisite.

Each is a decision document, not a build plan. The output of this brief is two locked decisions plus their rationale; implementation specs come later.

---

## Contents

- [0. Document Purpose](#0-document-purpose)
- [1. Why these two decisions go together](#1-why-these-two-decisions-go-together)
- [2. Decision 1 — Sandbox Isolation Strategy](#2-decision-1--sandbox-isolation-strategy)
- [3. Decision 2 — ExecutionBackend Adapter Contract](#3-decision-2--executionbackend-adapter-contract)
- [4. Cross-cutting concerns](#4-cross-cutting-concerns)
- [5. What gets unblocked](#5-what-gets-unblocked)
- [6. Suggested next steps](#6-suggested-next-steps)
- [7. Out of scope](#7-out-of-scope)

---

## 0. Document Purpose

This is a **decision brief**, not an implementation spec. The output of working through it is two locked decisions:

1. Which sandbox isolation primitive SynthetOS uses for per-task code execution in Phase 2 onward (Docker-per-task, gVisor, Firecracker microVMs, hosted execution provider, or a hybrid).
2. What shape the `ExecutionBackend` adapter contract takes so OpenClaw, future internal backends, and any other operator runtime become participating implementations behind a single pluggable interface.

Each decision has trade-offs across security, cost, operational complexity, latency, and developer experience. This brief lays out the options, the criteria, and a recommendation per decision, but it does **not** prescribe a build plan. Implementation specs follow each locked decision.

### 0.1 How to use this brief

In a separate session:

1. Read Section 1 to understand why both decisions are bundled.
2. For Decision 1 (Section 2): read the Background, Options, Trade-off matrix, Criteria, and Recommendation. Lock the choice or push back with rationale.
3. For Decision 2 (Section 3): same structure, separate decision.
4. Note any cross-cutting implications (Section 4).
5. Confirm what becomes unblocked (Section 5) so downstream specs can proceed.
6. Assign owners for the next-step deliverables (Section 6).

The brief is intentionally CEO-readable at the top of each section and engineering-grade in the trade-off detail. The recommendation column in each matrix is mine; the lock is yours.

### 0.2 What this brief is not

- Not an implementation plan (no chunked build, no LOC estimates per file, no migrations).
- Not a vendor evaluation document. Where a hosted provider is named (e.g., e2b.dev, Modal, Daytona), it is illustrative; due diligence per vendor is a follow-on.
- Not a sourcing decision (build vs buy) per se, but the "hosted execution provider" option in Decision 1 is functionally a buy choice and the brief flags that.
- Not the Phase 2 spec or the Phase 3 spec. Each phase gets its own implementation spec after these decisions lock.

---

## 1. Why these two decisions go together

The two decisions are about different parts of the stack but share three structural concerns:

1. **Both define a pluggable abstraction.** Sandbox isolation needs an interface that lets the worker request "give me a clean isolated environment for this task" without knowing whether the answer is a Docker container, a gVisor sandbox, a Firecracker microVM, or a remote hosted environment. ExecutionBackend needs an interface that lets the agentic loop request "execute this task on an operator backend" without knowing whether the backend is OpenClaw, a future internal backend, or something else.

2. **Both involve a build-vs-buy choice.** Sandbox isolation can be in-house (Docker, gVisor, Firecracker) or hosted (e2b, Modal, Daytona). ExecutionBackend can be in-house (we adapt OpenClaw ourselves) or buy-only (we only support managed integrations).

3. **Both feed into Phase 3.** Phase 3 (Autonomous Operators) is where Operator Controller backends become real. An autonomous operator running for hours will need both: a sandbox to run code and an ExecutionBackend contract through which the agentic loop dispatches work. If the two abstractions are designed independently, they can collide at the Phase 3 boundary (e.g., the ExecutionBackend signature does not name the sandbox primitive it expects).

Bundling the two decisions in one brief is the cheapest way to make the abstractions consistent. It does not mean both must be implemented at the same time; Decision 1 lands in Phase 2, Decision 2 lands in Phase 3.

### 1.1 What's not bundled

- Operator Session Identity (ChatGPT OAuth) lifecycle and ToS posture: that's a separate decision in `docs/openclaw-strategic-analysis.md` Phase 3. It's adjacent to Decision 2 but not the same.
- Per-task observability granularity (logs, traces, artifact retention per sandbox or backend): inherited from existing observability infrastructure.
- Multi-region / data residency / sovereign workloads: deferred to Phase 4+.
- BYO / customer-owned compute (private clouds, on-prem): deferred to Phase 4+.

---

## 2. Decision 1 — Sandbox Isolation Strategy

### 2.1 Background — what's in place today

The IEE worker today has two execution modes:

- `iee_browser` — Playwright with a contract-enforced page abstraction (domain allowlist, MIME validation, wall-clock limits). Browser sessions are per-org / per-subaccount. No code execution.
- `iee_dev` — runs inside the same Node process as the worker. Has shell, git, file I/O. Today's implementation collapses what the v1.2 brief separates: untrusted "Sandbox Environment" execution and trusted "Terminal/Repo Environment" execution use the same path.

There is **no per-task isolation**. Container-wide limits (`mem_limit: 3g`, `cpus: 2` in docker-compose) apply to the whole worker process; concurrent dev tasks share resources. Defence-in-depth (denylist patterns, path safety checks) is real but is not a sandbox.

### 2.2 Why a sandbox primitive is needed

Phase 2 of the v1.2 brief ships:

- Attachment analysis (customer uploads a CSV → agent transforms it)
- Document processing (customer uploads a PDF → agent extracts and analyses)
- Data transformations (agent generates and runs a script to reformat data)
- Sandbox-assisted scripts and tests for Dev Agent partial MVP

Every one of these involves running code derived from customer-supplied input. Defence-in-depth is insufficient: a determined customer (or a compromised customer credential) can craft input that runs arbitrary code. Today's collapsed `iee_dev` mode would let that code escape into the worker process, affecting every other tenant's task.

The stakes:

- A multi-tenant platform with customer-uploaded code paths and no per-task isolation is a category breach. Even one incident lands as a security disclosure.
- The compliance posture (SOC 2, customer audits) hinges on demonstrable per-task isolation.
- Phase 2 features cannot ship safely without this. Not "should be careful"; **cannot ship**.

### 2.3 Options

#### Option A: Docker-per-task

Each task gets a fresh Docker container, spun up on demand, torn down at task end. The host runs Docker; the worker process orchestrates container lifecycle.

- Build effort: medium (orchestration, image management, lifecycle)
- Cold-start latency: 200ms to 2s per task depending on image and host
- Security: process-level isolation; kernel-shared; not a strict trust boundary
- Operational complexity: medium (image registry, container resource limits, GC for stuck containers)
- Cost: low (uses existing host)
- Familiarity: high (Docker is universal)

#### Option B: gVisor

A user-space kernel from Google. Wraps containers and intercepts syscalls. Stronger isolation than plain Docker without microVM cost.

- Build effort: medium-high (gVisor is a runtime; integration with worker is non-trivial)
- Cold-start latency: 100ms to 500ms (faster than full microVM, slower than container)
- Security: stronger than Docker (syscall interception); weaker than full microVM
- Operational complexity: medium (less mature ecosystem; debugging is harder)
- Cost: low to medium (uses existing host, slight CPU overhead)
- Familiarity: low (most teams have not run gVisor in production)

#### Option C: Firecracker microVMs

True KVM-based microVMs originally built for AWS Lambda. Strict trust boundary; each task in its own VM.

- Build effort: high (Firecracker requires KVM-capable hosts, jailer setup, image management, network bridging)
- Cold-start latency: 100ms to 300ms (Lambda-class)
- Security: hardware virtualization boundary; the strongest isolation short of dedicated hardware
- Operational complexity: high (microVM lifecycle, networking, image building, snapshot management)
- Cost: medium (KVM-capable hosts; bare-metal or specific instance types)
- Familiarity: low (production Firecracker outside AWS is uncommon)

#### Option D: Hosted execution provider

Outsource the sandbox layer to a vendor: e2b.dev, Modal, Daytona, Daydream, Docker Build Cloud, Replit, etc. The worker sends a task to the vendor; the vendor returns the result.

- Build effort: low (integration is API + SDK; no infrastructure)
- Cold-start latency: 100ms to 1s depending on vendor
- Security: vendor-grade (typically Firecracker or equivalent under the hood)
- Operational complexity: low (vendor handles it)
- Cost: medium to high (per-execution-second pricing; can spike with heavy usage)
- Familiarity: low to medium (varies per vendor)
- Vendor risk: real (vendor goes down, prices change, vendor goes out of business)

#### Option E: Hybrid (Docker default + hosted for heavy tasks)

Default Docker-per-task for routine sandbox work; route heavy or sensitive tasks to a hosted provider. Two integrations to maintain.

- Build effort: high (two paths)
- Cold-start latency: optimal per task type
- Security: graduated (Docker for low-stakes, hosted for high-stakes)
- Operational complexity: high (routing logic, two SDKs)
- Cost: optimised per task type
- Familiarity: split

### 2.4 Trade-off matrix

| Criterion | A. Docker | B. gVisor | C. Firecracker | D. Hosted | E. Hybrid |
|---|---|---|---|---|---|
| Build effort | Medium | Medium-high | High | **Low** | High |
| Cold-start latency (typical) | 0.5-2s | 0.2-0.5s | 0.2-0.3s | **0.2-1s** | Optimal per type |
| Security boundary | Weak (kernel-shared) | Medium | **Strong (KVM)** | Strong (vendor-grade) | Mixed |
| Operational complexity | Medium | Medium | High | **Low** | High |
| Cost at low volume | **Low** | Low | Medium | Medium-high | Medium |
| Cost at high volume | **Low** | Low | Medium | High | Optimised |
| Vendor lock-in | None | None | None | **High** | Medium |
| Time to first ship | Medium | Medium | Slow | **Fast** | Slow |
| Compliance story | Adequate | Good | **Excellent** | Excellent (vendor inherits) | Excellent |
| Multi-tenant safety | OK with care | Good | **Excellent** | Excellent | Mixed |
| Eng team familiarity | **High** | Low | Low | Medium | Medium |
| Path to BYO compute (Phase 4+) | Easy | Easy | Easy | Hard (hosted is single-tenant by design) | Mixed |

### 2.5 Decision criteria

The right answer depends on weighting these:

1. **Speed to ship Phase 2**: how fast must Phase 2 features land? If the answer is "as fast as possible", hosted (D) wins on time-to-ship.
2. **Long-term cost trajectory**: at what task volume does hosted-vendor pricing exceed the cost of running our own infrastructure? Typically Docker breakeven is at ~100k tasks/month; Firecracker breakeven is higher.
3. **Compliance posture demand**: do customers ask for hardware-isolation guarantees? If "yes" before Phase 4, Firecracker (C) or hosted (D) is the answer.
4. **Vendor lock-in tolerance**: hosted means a third party is in the critical path of every customer task. Tolerable for V1; risky long-term.
5. **Path to Phase 4+ BYO**: Phase 4 customer-owned compute is much easier on Options A/B/C (we already run our own isolation; customer's environment runs the same primitive) than on D (the hosted vendor is part of our architecture, not the customer's).
6. **Eng team capability**: gVisor and Firecracker have steep learning curves. Docker is universal.

### 2.6 Recommendation

**Option D (Hosted execution provider) for V1, with a vendor adapter that preserves portability.**

Rationale:

- Phase 2 features (attachment analysis, data transformations) are blocked on this decision; hosted is the fastest path to ship.
- Vendor-grade isolation (Firecracker-class under the hood for the leading providers) gives us the security posture we need without building it.
- Operational complexity is low; the engineering team focuses on agent capabilities, not infrastructure.
- The vendor adapter pattern (Section 4) preserves portability: when long-term cost or vendor risk becomes material, we can swap to Option A or C without changing the agent layer.

**Hard constraint:** the integration goes through a `SandboxExecutionService` interface (defined in the Phase 2 implementation spec, not here) so the vendor is replaceable. **Do NOT couple the agent layer to vendor SDK calls directly.**

**Vendor shortlist for V1 evaluation (in the Phase 2 spec):** e2b.dev, Modal, Daytona. Pick one based on pricing, SLA, and SDK quality. All three offer Firecracker-class isolation. None is a clear winner today; the choice is bounded by SDK ergonomics and pricing tier alignment with our task profile.

**When to revisit:** at the end of Phase 2 or when one of these triggers fires:
- Monthly hosted-vendor spend exceeds 25% of monthly LLM spend
- Vendor outage causes a customer-visible incident
- A customer requires sovereign / on-prem compute (this triggers Phase 4 BYO)
- Phase 3 Operator Controller workloads change the cost shape (long-running tasks)

### 2.7 What gets locked at the brief level

- The decision: Option D for V1, with a vendor adapter pattern that preserves swap-out.
- The hard constraint: agent layer never calls vendor SDK directly.
- The revisit triggers above.

### 2.8 What gets deferred to the Phase 2 implementation spec

- Vendor selection (e2b vs Modal vs Daytona vs other).
- The shape of `SandboxExecutionService` interface.
- Per-task resource limits, timeout policy, billing pass-through.
- How `iee_dev` mode is split into Sandbox (Tier 4) and Terminal/Repo (Tier 5).
- Migration path for any existing `iee_dev` callers that will move to the new sandbox.

---

## 3. Decision 2 — ExecutionBackend Adapter Contract

### 3.1 Background — what's in place today

The agentic loop in `server/services/agentExecutionService.ts` dispatches per-run execution based on `executionMode` (`api`, `headless`, `claude-code`, `iee_browser`, `iee_dev`). Each mode is a hardcoded branch in the dispatch logic:

```ts
if (executionMode === 'iee_browser' || executionMode === 'iee_dev') {
  // IEE delegation: enqueue iee task, park parent in 'delegated', return
} else if (executionMode === 'claude-code') {
  // claude-code branch: dispatch to claudeCodeRunner
} else {
  // default: native API loop in-process
}
```

This branching pattern works for the current four backends but does not scale. Phase 3 introduces:

- OpenClaw as an Operator Controller backend
- Future internal backend (TBD; placeholder for an in-house operator runtime)
- Operator Session Identity (ChatGPT OAuth) consumed by these backends

Adding each of these as another `if` branch reproduces the pattern; the file becomes a switchboard, not a service.

### 3.2 Why an adapter contract is needed

Three problems with hardcoded branching:

1. **Lock-in by accident.** If OpenClaw ships as a hardcoded branch, every Phase 3 capability (cost reporting, run-trace integration, error handling) gets OpenClaw-specific code paths. The "future internal backend" path becomes harder to add over time, not easier.
2. **Test surface explodes.** Each new backend adds a branch test plus all the cross-branch interaction tests.
3. **Rollback granularity is coarse.** Today rollback is "disable the whole `executionMode = X` branch"; with an adapter contract it is "register an adapter implementation with `enabled: false`."

An ExecutionBackend adapter contract solves all three: every backend (including the existing four) becomes a participating implementation behind a single named interface. The agentic loop stops branching on `executionMode`; it looks up the adapter and dispatches.

This is **Phase 1 of the OpenClaw Strategic Analysis** (`docs/openclaw-strategic-analysis.md`), where the proposal is named explicitly. v1.2 brief Section 18.3 inherits it as a Phase 3 prerequisite.

### 3.3 Options

The question is: what shape of contract?

#### Option A: Thin protocol (just dispatch)

A minimal interface: the adapter accepts a task and returns a result. Loop coordination, state persistence, observability all stay in `agentExecutionService`.

```ts
interface ExecutionBackend {
  readonly id: string;
  dispatch(input: BackendDispatchInput): Promise<BackendResult>;
}
```

- Build effort: low (existing branches refactor cleanly)
- Capability surface: limited; per-backend specifics leak through input/output types
- Future extensibility: medium (each backend type adds fields to input/output)

#### Option B: Lifecycle-aware contract (dispatch + lifecycle hooks)

The adapter participates in the run lifecycle: it gets hooks for run-start, mid-run progress, run-end, and cancellation.

```ts
interface ExecutionBackend {
  readonly id: string;
  readonly capabilities: ExecutionCapability[]; // 'streaming' | 'cancellation' | 'multi-step' | 'long-running'
  
  dispatch(input: BackendDispatchInput): Promise<BackendDispatchResult>;
  // Returns immediately with a backend-task-id; does not block on completion.
  
  onProgress?(callback: (event: BackendProgressEvent) => void): UnsubscribeFn;
  // Optional: subscribe to mid-run progress (for streaming backends).
  
  cancel(backendTaskId: string): Promise<void>;
  // Idempotent. May be a no-op for backends that don't support cancellation.
  
  fetchResult(backendTaskId: string): Promise<BackendResult>;
  // Polled by a separate reconciliation loop until the task reaches a terminal state.
}
```

- Build effort: medium (lifecycle hooks are real work)
- Capability surface: rich; backend declares what it supports
- Future extensibility: high (new capabilities are additive)

#### Option C: Full plug-in pattern with health checks and routing

The adapter exposes health, capability declarations, cost estimates, and authentication state. The agentic loop's router uses these to pick a backend per task.

```ts
interface ExecutionBackend {
  readonly id: string;
  readonly capabilities: ExecutionCapability[];
  readonly costModel: CostModel; // 'per_token' | 'per_subscription' | 'per_worker_hour'
  
  // Lifecycle (as Option B)
  dispatch(input): Promise<DispatchResult>;
  onProgress?(callback): UnsubscribeFn;
  cancel(backendTaskId): Promise<void>;
  fetchResult(backendTaskId): Promise<BackendResult>;
  
  // Routing inputs
  healthCheck(): Promise<BackendHealth>;
  estimateCost(input): Promise<CostEstimate>;
  
  // Auth state (Phase 3 ChatGPT OAuth)
  authStatus(scope: CredentialScope): Promise<AuthStatus>;
}
```

The router calls `healthCheck` and `estimateCost` per backend per task and picks the best fit per a routing policy.

- Build effort: high (router policy is its own subsystem)
- Capability surface: very rich
- Future extensibility: high
- Risk: over-engineering for V1

#### Option D: Inherit IEE delegation lifecycle pattern

The IEE delegation lifecycle (`docs/iee-delegation-lifecycle-spec.md`, Phase 0 of OpenClaw Strategic Analysis, already shipped) defined the pattern: parent run goes to `delegated`, backend runs separately, terminal transition fires via pg-boss event, reconciliation cron is a backstop.

This pattern is **the existing template**. The ExecutionBackend adapter contract should generalise it rather than design a new pattern.

```ts
interface ExecutionBackend {
  readonly id: string;
  readonly capabilities: ExecutionCapability[];
  
  // dispatch: writes the agent_run to 'delegated', enqueues the backend task
  dispatch(input: BackendDispatchInput): Promise<DispatchResult>;
  
  // The backend itself emits a pg-boss event on completion; this is its declared event name + payload schema
  readonly completedEventName: string;
  readonly completedPayloadSchema: ZodSchema;
  
  // The main app's event handler reads the backend's terminal row and calls finaliseAgentRunFromBackend
  // (generalisation of finaliseAgentRunFromIeeRun)
  finalise(input: BackendFinalisationInput): Promise<FinalisationResult>;
  
  // Reconciliation cron entry point (generalisation of reconcileStuckDelegatedRuns)
  reconcileStuck(): Promise<number>;
  
  // Optional: cancel a delegated run
  cancel?(backendTaskId: string): Promise<void>;
}
```

- Build effort: low to medium (largely a refactor of the IEE pattern into a generic interface)
- Capability surface: matches the existing pattern
- Future extensibility: high (the pattern has already proved out for IEE; adding OpenClaw is a new instance, not a new pattern)
- Familiarity: high (the team has built this pattern once)

### 3.4 Trade-off matrix

| Criterion | A. Thin | B. Lifecycle | C. Full plug-in | D. IEE pattern |
|---|---|---|---|---|
| Build effort | **Low** | Medium | High | Low-medium |
| Capability surface | Thin | Rich | Very rich | Rich (matches IEE) |
| Future extensibility | Medium | High | **Very high** | High |
| Risk of over-engineering | Low | Medium | **High** | Low |
| Familiarity (team has built before) | Low | Low | Low | **High** |
| Path to OpenClaw integration | Forced contortions | Clean | Clean | **Clean (already proven)** |
| Path to future internal backend | Workable | Clean | Clean | **Clean** |
| Path to BYO operator (Phase 5) | Hard | Workable | Clean | Workable |
| Test surface | Small | Medium | Large | Medium |
| Reuses existing patterns | No | No | No | **Yes (pg-boss events, reconciliation)** |
| Operator Session Identity fit | Forced | OK | Native | OK (auth happens at adapter boundary) |

### 3.5 Decision criteria

1. **Does it generalise the IEE delegation lifecycle, or invent something new?** Inventing means relearning a pattern we already proved. Generalising means leverage.
2. **Does it accommodate ChatGPT OAuth (Operator Session Identity)?** Phase 3 needs this; the contract must not force OAuth state into a leaky parameter.
3. **Does the test surface stay manageable as backends are added?** Each new backend implementation is its own integration test; the contract test is shared.
4. **Does the contract have a clear "must implement" vs "may implement" split?** Optional capabilities (cancellation, streaming) should be declared, not silently absent.
5. **Is V1 scope minimal?** OpenClaw is a single backend; we do not need a routing policy in V1. Routing comes in Phase 3.5 or later.

### 3.6 Recommendation

**Option D (IEE pattern generalisation), structured as a minimal contract that the existing IEE backend already satisfies in spirit.**

Rationale:

- The IEE delegation lifecycle is the proven pattern. The team built it once; reusing the pattern is the cheapest path to a working ExecutionBackend contract.
- pg-boss events + reconciliation crons are existing infrastructure; the new contract uses them rather than inventing parallel coordination.
- OpenClaw integration becomes "another backend that emits the standard completion event." No new lifecycle; no new test surface.
- Future internal backend integration becomes the same thing.
- ChatGPT OAuth (Operator Session Identity) lives at the adapter boundary: the OpenClaw adapter knows how to consume an OAuth credential issued by `CredentialBrokerService`; the contract itself doesn't carry OAuth state.
- V1 scope is intentionally minimal: dispatch + completion event + reconciliation. Routing policy, cost estimation, health-based routing are explicitly NOT in V1; they come when a second backend ships and the choice between backends becomes real.

**Hard constraints:**

1. The existing four `executionMode` values (`api`, `headless`, `claude-code`, `iee_browser`, `iee_dev`) become participating implementations of the new contract. Behaviour does not change. This is a refactor, not a behaviour change.
2. The new contract names a generalisation of `finaliseAgentRunFromIeeRun` (call it `finaliseAgentRunFromBackend`) that the existing IEE handler delegates to.
3. Reconciliation: the existing 2-minute cron `maintenance:iee-main-app-reconciliation` becomes a generic `maintenance:backend-reconciliation` cron that iterates over registered backends.
4. The contract is forward-compatible with `auth_type: 'operator_session'` (ChatGPT OAuth) without naming it explicitly.

**Phase 3 ExecutionBackend adapter implementations (in order):**

1. Refactor existing four modes into adapter implementations (no behaviour change). This proves the contract on known-good backends before OpenClaw rides on top.
2. `openclaw_managed` adapter behind `OPENCLAW_MANAGED_ENABLED` feature flag.
3. (Phase 4+ or further) `openclaw_external` for customer-hosted workers; future internal backend.

### 3.7 What gets locked at the brief level

- The decision: Option D, IEE pattern generalisation.
- The hard constraints above.
- V1 scope: dispatch + completion event + reconciliation. No routing policy in V1.
- Forward-compat: contract accommodates `auth_type: 'operator_session'`.

### 3.8 What gets deferred to the Phase 3 implementation spec

- The exact TypeScript interface (field names, payload schemas).
- The migration path for the existing four modes from `if/else` branches to adapter implementations.
- The `BackendRegistry` shape (how adapters register at startup).
- Per-backend feature flags.
- Routing policy (Phase 3.5+).
- Cost estimation per backend (Phase 3.5+).
- Health-based fallback chain (Phase 3.5+).

---

## 4. Cross-cutting concerns

The two decisions interact at three places.

### 4.1 OpenClaw needs a sandbox

When OpenClaw runs in `openclaw_managed` mode (Phase 3), it executes code (shell, file edits, builds, tests). The sandbox primitive from Decision 1 applies: OpenClaw's per-task execution should run inside the chosen sandbox, not in the OpenClaw worker process directly.

If Decision 1 is Option D (hosted execution provider), then the OpenClaw `openclaw_managed` adapter dispatches code execution to the same hosted provider. The adapter is the boundary; the sandbox is shared infrastructure.

If Decision 1 were Option A or C (Docker or Firecracker in-house), the OpenClaw adapter would orchestrate sandbox lifecycle on our infrastructure.

**Implication for the contract**: the ExecutionBackend adapter (Decision 2) names the sandbox primitive in its inputs or relies on a shared sandbox service injected at startup. The Phase 3 implementation spec resolves this; the brief flags it.

### 4.2 Sandbox provisioning cost is a per-backend concern

Different ExecutionBackend implementations have different sandbox needs:

- `api` (native Native runs): no sandbox.
- `iee_browser`: browser sandbox (already in place).
- `iee_dev`: code sandbox (today: collapsed; post Decision 1: hosted vendor or in-house primitive).
- `claude-code`: code sandbox (same as `iee_dev`).
- `openclaw_managed` (future): code sandbox + OAuth credential injection.

The ExecutionBackend contract should declare which sandbox capability each backend requires (e.g., `sandboxRequirements: ['code_execution', 'browser', 'none']`). This lets the registry validate at startup that a backend's sandbox dependency is satisfied.

### 4.3 Cost reporting is end-to-end

Both decisions affect cost reporting:

- Decision 1: hosted vendor billing per execution-second flows into `llm_requests` + `cost_aggregates` as a non-LLM cost row. Schema additions are minor; the existing `sourceType` taxonomy extends.
- Decision 2: each ExecutionBackend may carry its own cost model (LLM-per-token vs subscription-per-month vs worker-hour). The contract declares `costModel`; the cost ledger consumes it.

The Phase 2 and Phase 3 specs each carry their own cost-reporting subsection; the brief flags that the two cost surfaces share infrastructure (`llm_requests`, `cost_aggregates`).

---

## 5. What gets unblocked

### 5.1 Locking Decision 1 unblocks

- **Phase 2 implementation spec drafting** can begin: sandbox isolation is the prerequisite.
- **Sandbox vs Terminal/Repo split** in `iee_dev` mode (today's collapsed implementation) becomes specifiable.
- **Customer-uploaded content processing** (CSVs, attachments, scripts) gets a safe execution path for the first time.
- **Phase 1.5 Revenue Ops** can use the sandbox for CSV/Excel processing (overdue invoice extraction).
- **Phase 1.5 Research Intelligence** can use the sandbox for document parsing pipelines.
- **Phase 2 Dev Agent partial MVP** (sandbox-assisted scripts and tests) can begin.

### 5.2 Locking Decision 2 unblocks

- **Phase 3 implementation spec drafting** can begin: ExecutionBackend adapter contract is the prerequisite.
- **OpenClaw integration** can begin once the adapter contract is locked.
- **Future internal backend** has a clean home and a clear contract to fill.
- **Refactor of existing four modes** into adapter implementations (a structural improvement worth doing as a small standalone PR before Phase 3).
- **Operator Session Identity** (ChatGPT OAuth) integration has a clear adapter boundary.

### 5.3 Locking both unblocks

- **Phase 3 with code execution** (Operator Controller + sandbox + ExecutionBackend) becomes coherent rather than three independent moving parts.
- **BYO compute roadmap** (Phase 4+) becomes describable: customers provide a sandbox provider plus an ExecutionBackend implementation.

---

## 6. Suggested next steps

In priority order:

1. **Operator review of this brief.** Lock or push back on each decision in Sections 2.6 and 3.6. Anything ambiguous becomes a follow-up question.
2. **Vendor due diligence for Decision 1 (Option D).** Pick three (e2b, Modal, Daytona) and run a 1-day evaluation per: SDK ergonomics, pricing for our task profile, SLA, security posture documentation. Output: vendor recommendation in Phase 2 spec.
3. **Phase 2 implementation spec drafting.** Once Decision 1 is locked, draft `tasks/builds/phase-2-extended-capabilities/spec.md` with the chosen vendor and the `SandboxExecutionService` interface. Goes through `spec-reviewer` + `chatgpt-spec-review`.
4. **ExecutionBackend adapter contract spec drafting.** Once Decision 2 is locked, draft `tasks/builds/execution-backend-adapter-contract/spec.md` (this could be a Phase 1.5 or Phase 3 spec; the refactor of existing modes is small enough to land in Phase 1.5 if the team has bandwidth). Goes through `spec-reviewer` + `chatgpt-spec-review`.
5. **OpenClaw integration spec drafting.** Phase 3 child spec; depends on Decision 2 being locked.
6. **Operator Session Identity (ChatGPT OAuth) ToS clarity.** Independent track; product or legal owns it. Block Phase 3 OpenClaw rollout if ToS posture is unfavourable.

Each next step is a follow-on artefact; this brief is the upstream lock.

---

## 7. Out of scope

**Explicitly not in this brief:**

- **Operator Session Identity lifecycle and ToS posture.** Adjacent to Decision 2 but a separate decision; lives in `docs/openclaw-strategic-analysis.md` Phase 3.
- **Multi-region / data residency / sovereign workloads.** Phase 4+; tracked in v1.2 brief Section 18.4.
- **Customer-hosted workers (BYO compute).** Phase 4+ or Phase 5; tracked in OpenClaw Strategic Analysis Phase 5.
- **Marketplace of agents, skills, tools.** Phase 4+; tracked in v1.2 brief Section 18.4.
- **Full autonomy mode definition.** Phase 4+; tracked in v1.2 brief Section 18.4 with placeholder definition.
- **Per-task observability granularity, cost transparency surfaces, "saved vs API" dashboards.** Phase 3+ implementation concerns; flagged in OpenClaw Strategic Analysis Phase 3.
- **Specific vendor choice for Decision 1.** Recommendation is Option D (hosted); the specific vendor (e2b vs Modal vs Daytona vs other) is a Phase 2 spec deliverable.
- **The TypeScript interface for the ExecutionBackend contract.** Recommendation is Option D (IEE pattern generalisation); the exact field names and payload schemas are a Phase 3 spec deliverable.

---

## End of brief

This brief produces two locked decisions plus rationale. Implementation specs follow.

The two decisions:

| # | Decision | Recommendation | Phase | Owner |
|---|---|---|---|---|
| 1 | Sandbox Isolation Strategy | Option D (Hosted execution provider) for V1, with vendor adapter pattern preserving swap-out | Phase 2 prerequisite | Architect (sign-off), Ops (vendor evaluation) |
| 2 | ExecutionBackend Adapter Contract | Option D (IEE pattern generalisation), minimal V1 scope (dispatch + event + reconciliation) | Phase 3 prerequisite | Architect (sign-off) |

Lock both, then proceed to Phase 2 spec drafting (Decision 1 first, since it's the closer phase).
