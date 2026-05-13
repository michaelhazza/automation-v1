**Status:** DRAFT v1 (2026-05-13) — awaiting operator ratification before spec authoring
**Date:** 2026-05-13
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `iee-browser-on-e2b`
**Locked predecessors:** Spec A `tasks/builds/execution-backend-adapter-contract/spec.md` (#281), Spec B `tasks/builds/sandbox-isolation/spec.md` (#287), Spec D `tasks/builds/operator-backend/brief.md` (#288 — locked profile-snapshot pattern §3.13)
**Decision source:** operator post-merge audit (2026-05-13) §4 — recommendation locked: YES, migrate IEE browser worker to e2b; retire DigitalOcean.

# IEE Browser on e2b — Build Brief

## Table of contents

1. Purpose
2. What's locked from upstream
3. What this spec must define
   - 3.1 The runner harness migration
   - 3.2 Browser-shape integration with `SandboxExecutionService`
   - 3.3 Browser profile persistence — direct reuse of operator-backend §3.13
   - 3.4 Warm-pool configuration
   - 3.5 Parallel-run validation
   - 3.6 DigitalOcean retirement sequence
   - 3.7 Cost forecast
   - 3.8 Test plan
4. Locked architectural decisions
5. Out of scope (explicit non-goals)
6. What unblocks when this ships
7. Sequencing

## 1. Purpose

The IEE browser worker (Playwright code under `worker/src/browser/`) currently runs as a long-lived Node.js Docker container on a DigitalOcean VPS. The repo has since standardised on e2b as the sandbox substrate for Spec B (`SandboxExecutionService` provider abstraction, merged #287) and Spec D (Operator Backend, merged #288). The IEE browser path is now the only remaining workload pinned to DigitalOcean.

This brief locks scope for a **substrate swap, not a re-architecture**:

- Playwright code stays. The browser action vocabulary (`navigate / click / type / extract / download`), the contract-enforced page, the artefact validator, the streaming-video capture path, the login flow, and the executor stay byte-identical where possible.
- The runner harness changes: the worker's persistent VPS process is replaced by a per-task e2b sandbox session managed through the `SandboxExecutionService` provider contract.
- Persistent browser profile is preserved via the Spec D §3.13 profile-snapshot primitive, scoped to the IEE browser's multi-tenant key shape.
- DigitalOcean is decommissioned after a measured parallel-run window.

This brief locks scope. The spec is authored next.

## 2. What's locked from upstream

| Capability | Source | Status |
|---|---|---|
| `SandboxExecutionService` provider contract + start-claim lease + harvest pipeline | Spec B | merged #287 |
| Sandbox provider resolver (`e2b` / `local_docker` / `inline`) + side-effect registration | Spec B | merged #287 |
| Sandbox template build pipeline (`infra/sandbox-templates/<template>/`, deterministic-build rules) | Spec B | merged #287 |
| Cost ledger `source_type: 'sandbox_compute'` (vCPU-seconds, wall-clock, peak memory) | Spec B | merged #287 |
| Persistent browser profile primitive (volume-mounted `user-data-dir`, retention window, GC, corruption recovery, fresh-profile restart semantics) | Spec D §3.13 | merged #288 |
| Adapter contract surface (`dispatch / loadTerminalState / finalise / reconcile / cancel`) | Spec A | merged #281 |
| `iee_browser` adapter + pg-boss `iee-run-completed` event + `iee_runs` row shape (`type: 'browser'`) | existing | pre-A |
| Playwright action vocabulary, contract-enforced page, artefact validator, streaming-video capture | existing IEE | pre-this-brief |

Nothing on the foundation is in flux. This brief is a consumer of these primitives.

## 3. What this spec must define

### 3.1 The runner harness migration

- **Today:** the worker is a persistent VPS-resident Docker container that pulls pg-boss `browserTask` jobs and runs `worker/src/browser/executor.ts` against a Playwright `BrowserContext` opened from a host-disk `userDataDir`.
- **Target:** each browser task runs inside a per-task e2b sandbox session. The dispatch path goes through `SandboxExecutionService.runTask` (or a thin browser-shaped wrapper — see §3.2), and the Playwright code inside the sandbox is unchanged except for where it reads `userDataDir`.
- **Files migrating** (harness only — content stays):
  - `worker/Dockerfile` — replaced by an e2b sandbox template at `infra/sandbox-templates/iee-browser/` (deterministic-build rules per Spec B §15.2, same as `synthetos-sandbox`). Playwright base image (`mcr.microsoft.com/playwright:v1.59.1-jammy`) plus ffmpeg, pinned by digest.
  - `worker/src/handlers/browserTask.ts` and `runHandler.ts` — replaced by the sandbox entrypoint pattern used by `synthetos-sandbox` (the harness wakes inside the sandbox, runs the executor against the supplied task payload, writes the harvest output to `/workspace/artefacts`, exits).
  - `worker/src/handlers/cleanupOrphans.ts` and the VPS-resident pg-boss orphan-sweep — replaced by the start-claim-lease state machine + the sandbox reconcile path (already in `SandboxExecutionService`; spec author confirms no IEE-specific gaps remain).
  - `worker/src/runtime/queueMetrics.ts` and `cost.ts` — sandbox compute attribution moves to the existing `source_type: 'sandbox_compute'` ledger row. The IEE-specific cost rollup at `worker/src/handlers/costRollup.ts` continues to roll up LLM cost; sandbox compute is attributed by the harvest pipeline.
- **Files staying** (zero edit unless required by sandbox FS semantics):
  - `worker/src/browser/executor.ts`, `contractEnforcedPage.ts`, `observe.ts`, `login.ts`, `artifactValidator.ts`, `captureStreamingVideo.ts` — the Playwright action layer is substrate-agnostic.
  - `worker/src/browser/playwrightContext.ts` — minor edit only: `buildUserDataDir(...)` resolves to the mounted profile volume path inside the sandbox (per §3.3) instead of a host-disk path. Path-traversal regex, corruption-recovery rename, and launch-failure backoff stay intact.
  - `worker/src/loop/executionLoop.ts`, `failureClassification.ts`, `heartbeat.ts`, `stepHistory.ts`, `systemPrompt.ts` — pure execution-loop logic, sandbox-agnostic.
- **Files retiring entirely:**
  - The DigitalOcean VPS provisioning + deployment artefacts (env-secrets templates, deploy scripts, monitoring agents — whatever lives outside the repo today). Inventory and decommission steps in §3.6.

### 3.2 Browser-shape integration with `SandboxExecutionService`

Spec author chooses between two implementation surfaces; the locked decisions §4 do not prescribe one. The trade-off is:

- **Option A — extend `SandboxExecutionService` to handle `sandboxRequirement: 'browser'`.** Adds `'browser'` as a recognised sandbox class alongside `'code_execution'`. The `iee_browser` adapter's existing `sandboxRequirement: 'browser'` declaration starts being enforced by the existing `verify-sandbox-classification` CI gate. Minimum new code surface; reuses the entire start-claim / lease / harvest / reconcile / cost-attribution pipeline.
- **Option B — new `BrowserExecutionService` mirroring the operator-backend dispatcher pattern.** Separate service with a parallel provider contract. Better isolation if browser-specific concerns (profile mount semantics, capture artefact paths, MFA recovery hooks) start dominating; more code to maintain.

Spec author MUST justify the choice. Default recommendation: **Option A**. Browser-specific concerns are confined to the template image (Playwright base + ffmpeg) and the profile mount path; nothing in the lease / harvest / reconcile / cost layers needs to differ. Option B is reserved for the case where browser sessions develop a materially different lifecycle (e.g. live human-takeover, multi-hour interactive sessions) — neither applies to V1.

The adapter contract (`ieeBrowserBackend.ts`) is otherwise untouched: it continues to call `ieeDispatch(...)` with `type: 'browser'`. The dispatch path's internal call into `SandboxExecutionService.runTask` (today routed for `ieeDev`) extends to `ieeBrowser`.

### 3.3 Browser profile persistence — direct reuse of operator-backend §3.13

The Spec D persistent-browser-profile primitive is reused as-is for the IEE browser path. The only delta is the **profile scoping key**.

| Spec D (operator-backend) | This brief (IEE browser) |
|---|---|
| Key: `task_id` (one logical operator task per profile) | Key: `(organisation_id, subaccount_id, session_key)` — preserves the existing multi-tenant scoping at `worker/src/browser/playwrightContext.ts:buildUserDataDir`. `session_key` defaults to `'default'` and is validated against the existing `SESSION_KEY_RE` regex. |
| Single-tenant operator chain link | Multi-tenant deterministic browser tasks. Many tasks across many agent runs may share a profile if they share `(org, subaccount, session_key)`. |
| Lifecycle: created on first chain link, persists across chain links, GC 48hr after task terminal (admin can extend to 14d) | Lifecycle: created lazily on first task that uses `session_key`, persists indefinitely while in use, GC after a per-subaccount inactivity window (default 14 days; range left to spec author). No notion of "task terminal" because many tasks share the profile. |
| Profile corruption recovery: `OPERATOR_PROFILE_UNRECOVERABLE` + fresh-profile restart with new `attempt_number` | Profile corruption recovery: existing `playwrightContext.ts` rename-to-`.corrupt.<ts>` + fresh-dir backoff. Lifted into the sandbox profile primitive — the rename happens against the mounted volume, not host disk. Fresh-profile-restart concept does NOT apply (no chain-link attempts model). |
| Profile size cap: 500 MB per task | Profile size cap: 500 MB per `(org, subaccount, session_key)`. Same enforcement primitive (volume quota or pre-mount disk check). |
| Subaccount isolation enforced by Spec B sandbox isolation | Same. Adapter MUST assert the task's subaccount matches the profile's subaccount before mount. |

Profile snapshot / restore semantics from §3.13 carry over unchanged. The only new state is a lightweight table or column tracking `(organisation_id, subaccount_id, session_key) → volume_id, last_used_at, size_bytes` for GC scheduling — spec author's call on whether to extend `operator_task_profiles` or introduce a sibling table.

### 3.4 Warm-pool configuration

Cold-start latency on e2b sandboxes is ~10-30s. Existing IEE browser workflows for human-triggered tasks (user clicks "run this browser task now") cannot absorb that without surfacing as visible delay. Solution per the audit §4 recommendation: keep N hot sandboxes pre-warmed per subaccount.

Spec MUST define:

1. **Warm-pool sizing.** Per-subaccount setting on the same surface as the operator-backend per-subaccount settings (Spec D §3.14). Default 1; range 0-5; spec author confirms upper bound against e2b cost model. Setting of 0 disables the warm pool for that subaccount (cold-start every time, accepted trade-off for low-volume subaccounts).
2. **Warm-pool lifecycle.** A separate service (likely `server/services/sandbox/browserWarmPool.ts`) maintains a per-subaccount queue of pre-started sandbox sessions with no profile mounted. Sessions are checked out at task dispatch (profile mount happens at check-out, not at warm-up), checked back in if the task completes quickly enough that the session is still healthy, or torn down otherwise. Default check-in policy: tear down after first use (simpler; spec author may upgrade to reuse-with-reset if profile-mount-at-dispatch makes reuse safe).
3. **Warm-pool eviction.** Sessions older than M minutes are torn down and replaced — protects against drift between the warm session and the latest template version (per Spec B's `assertNotLatestTemplateVersion` guard). Default M = 30 min; range left to spec author.
4. **Warm-pool starvation behaviour.** When a task arrives and no warm session is available, fall through to a cold start. NOT an error; emits a warm-pool-miss metric for capacity planning.
5. **Cost attribution.** Warm sessions waiting on a task DO consume sandbox compute. The cost ledger records this as `source_type: 'sandbox_compute'` with a `subtype` discriminator (`warm_pool` vs `task`) so finance can see the cost separately. Spec author confirms the existing `source_type` schema supports this without a migration, or designs the minimum migration.
6. **Per-subaccount on/off in the settings UI.** New "Warm pool size" field on the existing operator-settings tab from Spec D §3.14, OR a sibling "IEE Browser" tab if the field set grows past 1-2 items. Spec author's call.

### 3.5 Parallel-run validation

Both paths run simultaneously for a defined window so the e2b path can be measured before DO is decommissioned.

Spec MUST define:

1. **Routing primitive.** A feature flag (per Spec B's existing flag infrastructure) selects which path executes for a given task. Granularity: per subaccount (default). Override: per agent run (operator-tooled, for targeted testing).
2. **Flag values.**
   - `do_only` — task dispatches to the existing DigitalOcean worker.
   - `e2b_shadow` — task dispatches to DO (canonical); a shadow copy runs on e2b. Both write to `iee_runs` with discriminator `harness_kind: 'do' | 'e2b'`. Shadow result is compared against canonical via the metrics pipeline (item 4), but does NOT affect the customer-visible terminal status.
   - `e2b_canonical` — task dispatches to e2b. DO does not run for this task.
   - `e2b_only` — same as `e2b_canonical` but with the DO path disabled for this subaccount (no fallback). Set after cutover threshold met.
3. **Default schedule.** Spec author proposes a rollout plan; default starting point: 100% `do_only` at week 0, ramp to 100% `e2b_shadow` by week 2 (all production traffic shadowed; no customer impact), `e2b_canonical` rollout per-subaccount starting week 3 based on shadow-metric health, `e2b_only` per-subaccount after the cutover threshold is met.
4. **Cutover threshold metric.** A subaccount moves from `e2b_canonical` to `e2b_only` only after **e2b success rate ≥ DO success rate – 1pp** over a rolling 7-day window with a minimum sample of 100 tasks. "Success" = `iee_runs.status = 'completed'` and artefact-harvest validation passed. Spec author confirms metric definitions are achievable from existing observability.
5. **Shadow-run comparison.** For each task that ran on both paths, the metrics pipeline compares: terminal status agreement, artefact bytes agreement (or byte-similarity for video artefacts), action-step count delta, wall-clock duration delta, cost delta. Disagreements emit incidents via `incidentIngestor` with `failure_class: 'shadow_disagreement'` so the system monitor can investigate. Shadow runs that fail while canonical succeeds (or vice versa) are first-class incidents.
6. **Rollback path.** Setting the flag back to `do_only` (or `e2b_shadow`) for a subaccount is a one-config-change rollback. Spec MUST confirm the rollback is bidirectional during the parallel-run window — once a subaccount has moved to `e2b_only`, rollback requires re-provisioning DO capacity, which is NOT in scope after decommission (§3.6).

### 3.6 DigitalOcean retirement sequence

Decommission happens AFTER all subaccounts have reached `e2b_only` AND a defined soak period has elapsed with no rollbacks.

Spec MUST define:

1. **Decommission preconditions.** (a) 100% of subaccounts at `e2b_only`, (b) ≥ 14 days at `e2b_only` for all subaccounts, (c) no rollback-to-DO events in the last 14 days, (d) the system monitor confirms no `shadow_disagreement` incidents are open.
2. **Decommission steps.** (i) Remove the `do_only` and `e2b_shadow` flag values from the routing primitive (the values become reserved-but-rejected). (ii) Retire `worker/Dockerfile`, the worker-as-container build pipeline, the DO deployment scripts, and the DO-only handlers (`browserTask.ts`, `cleanupOrphans.ts`, `runHandler.ts`) — keep the directories `worker/src/browser/`, `worker/src/loop/`, `worker/src/llm/` (these are reused inside the sandbox harness). (iii) Tear down the DO VPS, revoke DO API tokens, archive DO monitoring dashboards. (iv) Delete the DO secrets from the production secret store. (v) Update `docs/iee-development-spec.md` Part 10 and `architecture.md` to remove DO-runtime references — the doc-sync gate enforces this.
3. **Rollback window.** A 30-day window AFTER decommission step (i) AND BEFORE step (iii) where the VPS still exists but routes nothing. If a regression surfaces in this window, the routing primitive is re-enabled and DO is re-engaged. After (iii), rollback requires re-provisioning DO from scratch — explicitly out of scope.
4. **Audit trail.** A `tasks/builds/iee-browser-on-e2b/decommission-log.md` artefact records: per-subaccount cutover date, per-subaccount last-DO-task timestamp, decommission date, final DO bill, rollback events (none expected). Updated through the rollout.

### 3.7 Cost forecast

**Status: needs operator-supplied numbers before spec finalisation.** This brief flags what the spec MUST resolve; it does NOT lock the numbers.

Spec MUST define:

1. **Per-task e2b cost model.** Inputs: per-second sandbox compute rate (e2b billing), expected task wall-clock (current DO-measured p50 / p90), template-image cold-start surcharge if any, warm-pool overhead (warm sessions consume compute even while idle).
2. **Current DO cost baseline.** The current monthly DO bill (operator supplies). Allocation: how much is the VPS itself vs egress vs storage. Profile-disk storage on the VPS today is effectively free; on e2b it is volume-cost-attributed (per Spec B).
3. **Per-task volume forecast.** Expected EA + IEE task volume at 6 months and 12 months (operator supplies). Distinguish: human-triggered (warm-pool-sensitive) vs scheduled (cold-start-tolerant).
4. **Crossover point.** Compute the per-task-volume threshold at which e2b becomes more expensive than the DO baseline, and the per-task-volume threshold at which the warm-pool overhead changes that calculus. Spec defines actions if the forecast crosses an unfavourable boundary (e.g. "if scheduled-task volume exceeds X/day, revisit batch-mode dispatch to amortise warm-pool overhead").
5. **Per-subaccount cost visibility.** Existing `source_type: 'sandbox_compute'` rows already provide per-subaccount attribution. Spec confirms no additional cost-visibility work is needed for V1.

Spec author MUST surface the forecast in the spec doc with concrete numbers before the build session begins. If the forecast shows e2b is meaningfully more expensive at expected volume and there is no mitigation, the audit §4 decision is re-opened. (Operator has acknowledged this is locked direction; the forecast is for sizing, not relitigation.)

### 3.8 Test plan

Spec MUST define:

1. **Existing test coverage inventory.** Which integration tests exercise the IEE browser path today (search under `worker/tests/`, `server/services/executionBackends/__tests__/ieeBrowserBackend.test.ts`, the gates under `scripts/gates/`). Spec records the catalogue.
2. **Sandbox-substrate parity tests.** Add to the existing sandbox provider resolver test suite (`server/services/sandbox/__tests__/sandboxProviderResolverPure.test.ts` and siblings) the `browser` sandbox class — same matrix as `code_execution`.
3. **Profile-volume tests.** Volume creation, mount, multi-task reuse for the same key, isolation between different keys, corruption recovery, GC of inactive profiles, size-cap enforcement.
4. **Warm-pool tests.** Warm session check-out under contention, fall-through to cold start on starvation, eviction at age, cost attribution discriminator.
5. **Parallel-run / shadow tests.** Routing primitive selects the correct path per flag value, shadow-disagreement detection emits the right incident shape, rollback path is bidirectional during the window.
6. **End-to-end browser-task regression.** A small suite of real browser flows (navigate, login, extract, download) runs against e2b in CI. Reuses the existing IEE browser fixtures where possible; spec confirms what's portable.
7. **Test posture.** Per the local test-gate policy (`references/test-gate-policy.md`): targeted Vitest runs for new pure-function helpers locally; full integration suites run in CI only.

## 4. Locked architectural decisions

Resolved 2026-05-13 by operator post-merge audit §4. The spec author MUST honour these values; deviations require returning to the operator.

1. **Single-vendor execution substrate.** e2b is the chosen substrate for all sandbox-class workloads, including IEE browser. Do not introduce a parallel substrate; do not relitigate.
2. **Substrate swap, not re-architecture.** Playwright code in `worker/src/browser/` stays; the runner harness changes. New code surface is constrained to the template image, the harness entrypoint, the warm-pool service, the routing primitive, and the profile-key extension. The action vocabulary, contract-enforced page, login flow, artefact validator, streaming-video capture, execution loop, failure classification, and step history are NOT touched in this build.
3. **Persistent browser profile reuses Spec D §3.13.** No parallel profile-persistence scheme. The only delta is the profile-scoping key shape (per §3.3). If a delta beyond key shape becomes necessary mid-spec, return to the operator before introducing it.
4. **Default integration surface: extend `SandboxExecutionService` (Option A in §3.2).** Spec author may justify Option B but the bar is high; reuse beats parallel infrastructure.
5. **Warm pool is mandatory; default size is 1 per subaccount.** Cold-start latency is unacceptable for human-triggered tasks; the warm pool exists to mask it. Range 0-5; per-subaccount configurable.
6. **Parallel-run is mandatory; minimum shadow window is 1 week per subaccount before `e2b_canonical`.** No subaccount jumps straight from `do_only` to `e2b_canonical`. Shadow must run for at least 7 days with metrics agreement before canonical cutover.
7. **Cutover threshold: e2b success rate ≥ DO success rate – 1pp over 7-day rolling window, min 100 tasks.** Not negotiable downward (don't move a low-volume subaccount on too small a sample).
8. **DO decommission requires 14-day soak at `e2b_only` AND zero open shadow-disagreement incidents.** The decommission preconditions (§3.6 item 1) are gates, not guidance.
9. **One-vendor risk is acknowledged and accepted.** The `SandboxExecutionService` provider abstraction is the mitigation. If e2b becomes unavailable, the provider contract supports a future second provider; that work is out of scope here.
10. **No customer-facing UI changes in V1.** The substrate swap is invisible to customers. Internal admin surfaces (per-subaccount settings tab from Spec D §3.14, the routing-flag override, the warm-pool size field) are the only UI additions, all admin-scoped.

## 5. Out of scope (explicit non-goals)

| Out of scope | Belongs in |
|---|---|
| AWS Bedrock LLM provider, AWS KMS, AWS-anything | not this build |
| Replacing pg-boss with a different job system | not this build |
| New browser capabilities (PDF rendering, mobile-emulation profiles, anti-bot evasion, captcha solvers) | follow-up specs as customer demand surfaces |
| Customer-facing "compare DO vs e2b" cost dashboard | not needed; per-subaccount cost via existing `sandbox_compute` ledger is sufficient |
| Multi-region e2b deployment | Phase 4+; V1 uses e2b's default region |
| Browser-session live takeover (operator joins a running session) | future capability; not implied by substrate swap |
| Cross-subaccount profile sharing | explicit non-goal; isolation invariant per §3.3 |
| Headless-only vs headed-mode toggle exposed to customers | not needed; current behaviour (headless) is preserved |
| LLM-substrate changes (router, model selection, prompt-caching strategy) | not this build |
| Migrating `iee_dev` to a different sandbox class | `iee_dev` already routes through `SandboxExecutionService`; nothing to migrate |
| BYO compute / customer-hosted browser workers | Phase 5 if customer demand surfaces |
| A second sandbox provider registered alongside e2b | Phase 4+; the abstraction exists, no second provider in V1 |

## 6. What unblocks when this ships

- **DigitalOcean is retired.** One fewer infrastructure substrate to maintain, monitor, secure, and bill.
- **The execution substrate is single-vendor.** Every sandbox-class workload (`iee_dev`, `iee_browser`, `operator_managed`) runs on the same provider with the same isolation primitive, lease state machine, harvest pipeline, and cost ledger.
- **The warm-pool primitive becomes reusable.** Future low-latency-sensitive sandbox workloads (e.g. interactive operator UI, on-demand code execution from chat) can use the same warm-pool service.
- **Profile-persistence-by-key becomes a reusable primitive.** Future browser-using features that need persistent state across tasks (Personal Assistant browser workflows, ClientPulse browser polling) inherit the multi-tenant profile primitive instead of inventing one.
- **The Spec B provider abstraction is stress-tested under three different workloads** (`iee_dev` code execution, `operator_managed` agentic sessions, `iee_browser` browser automation). Any contract gaps that survived the first two are caught here.

## 7. Sequencing

Recommended order:

1. **Operator reviews this brief, locks scope.** Open questions: cost-forecast inputs (current DO bill, expected EA + IEE task volume at 6 and 12 months), warm-pool size default upper bound, profile-inactivity GC default window.
2. Spawn a new Claude Code session for the build slug; the session adopts `spec-coordinator`.
3. Session runs: brief intake (this doc) → spec authoring → `spec-reviewer` (Codex loop) → `chatgpt-spec-review` (manual rounds) → handoff to `feature-coordinator`.
4. Build session ships: the `infra/sandbox-templates/iee-browser/` template, the sandbox-harness entrypoint, the `SandboxExecutionService` browser-class extension (or Option B `BrowserExecutionService`), the warm-pool service, the routing-flag primitive + per-subaccount settings field, the profile-key extension on the Spec D primitive, the parallel-run metrics + shadow-disagreement incident shape, the decommission-log artefact scaffolding, and the doc-sync updates to `docs/iee-development-spec.md` Part 10 + `architecture.md`.
5. Cutover proceeds per the §3.5 schedule. Decommission per §3.6 once all subaccounts are at `e2b_only` and the soak window has elapsed.

**Estimated sizing (per operator brief):** spec ~1 day; build 1-2 weeks (most effort: profile-lifecycle wiring + parallel-run validation + warm-pool service; raw e2b integration is already done for Specs B / D). Cutover + decommission are calendar-time-bound (parallel-run window + soak), not engineering-time-bound.

**Branch:** `claude/migrate-browser-e2b-{nonce}` off post-#287/#288 `main`. (Current branch: `claude/migrate-browser-e2b-snI99`.)

## End of brief
