**Status:** DRAFT v3 (2026-05-13) — awaiting operator ratification before spec authoring
**Date:** 2026-05-13
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `iee-browser-on-e2b`
**Locked predecessors:** Spec A `tasks/builds/execution-backend-adapter-contract/spec.md` (#281), Spec B `tasks/builds/sandbox-isolation/spec.md` (#287), Spec D `tasks/builds/operator-backend/brief.md` (#288 — locked profile-snapshot pattern §3.13)
**Decision source:** operator post-merge audit `tasks/builds/personal-assistant-v1/post-merge-audit-2026-05-13.md` §4 — recommendation locked: YES, redirect IEE browser to e2b before launch.

## v2 reframe (post-operator-clarification)

v1 of this brief was written on the assumption that the IEE browser worker was running in production on DigitalOcean. Operator clarification: **DO was never launched.** The worker exists in the repo as deploy-ready code (`worker/Dockerfile`, `worker/src/browser/`) but no production VPS was ever provisioned. This is not a "migration with parallel run + retirement"; it is "redirect the unlaunched path to e2b before first launch + remove the DO-bound code from the repo."

v2 changes:
- §1 Purpose reframed: no DO production traffic exists; the substrate change happens before first launch.
- §3.5 Renamed "Launch validation" (was "Parallel-run validation"). No shadow window, no DO traffic to compare against. Validation is local-dev + staging-e2b only.
- §3.6 Renamed "DO code-path retirement" (was "DigitalOcean retirement sequence"). No infrastructure to tear down; only the DO-bound code paths come out of the repo.
- §3.7 Renamed "Cost-tracking plan" (was "Cost forecast"). No DO baseline exists. Cost is observed from day one of production e2b traffic; alarms fire on per-task or per-subaccount cost drift.
- §4 locked decisions: items 6, 7, 8 (parallel-run mandate, cutover threshold, decommission soak) are removed. Items 5 (warm pool), 9 (one-vendor risk), 10 (no customer UI changes) stand.
- §3.3 GC inactivity window default raised from 14 days to **30 days** pending operator confirmation (see §3.3 explainer).

## v3 reframe (post-mockup-round-1 simplification)

Round 1 mockup landed (`prototypes/iee-browser-on-e2b.html`, commit `f00e285`). Operator review surfaced a simplification mandate: the Operator settings tab was carrying too many knobs, and several of the proposed IEE-browser fields would either confuse a non-technical org admin or duplicate concerns better handled by a single sensible default.

v3 changes:
- **Warm-pool size: no longer user-configurable.** Hardcoded to 1 globally in V1. The warm-pool service still exists (mandatory per §3.4) but the per-subaccount UI knob is dropped. If real production usage shows starvation patterns, a future spec adds the knob back.
- **Per-task cost ceiling: cents only, no minutes ceiling.** The earlier dual-threshold ("alert if either minutes-cap OR cents-cap exceeded") is replaced by a single cents ceiling. Money is the operator's mental model; the dual knob added confusion without product value.
- **Incident event names hidden from the admin UI.** Event names like `iee_browser.task_cost_anomaly` continue to exist in the incident schema and run logs, but the settings tab uses plain-English help text ("Alerts you when a single task costs more than this") and no event-name chips.
- **Launch flag re-framed as a kill switch (Status: On / Off).** Same control as in round 1, but the language and placement signal "support escalation off-switch", not "per-subaccount opt-in." Default On.
- **No spend widget on the settings tab.** Month-to-date sandbox-compute spend belongs on Usage & Costs, not duplicated on a config screen.
- **Out of scope, routed to triage:** the existing operator-backend settings tab (Spec D §3.14) carries three fields (`auto-extend grace`, `max chain length`, `max wall-clock per task`) that are admin-confusing edge-case safety rails. Operator decision: cut them from the UI and hardcode (grace=30 min, chain=100, wall-clock=30 days). This work is a follow-up to the operator-backend build, NOT part of this build. See `tasks/todo.md` for the triage entry.

Net effect on this build's UI surface: 3 new controls on the existing Operator settings tab — Status (On/Off), Browser profile retention (days), Per-task cost ceiling ($), Per-subaccount daily cost ceiling ($). Four total fields counting the cost-ceiling pair.

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

The IEE browser worker (Playwright code under `worker/src/browser/`) was designed for a DigitalOcean VPS deployment that was never launched. The product is pre-launch. The repo has since standardised on e2b as the sandbox substrate for Spec B (`SandboxExecutionService` provider abstraction, merged #287) and Spec D (Operator Backend, merged #288). The IEE browser is the last code path still bound to DigitalOcean as its intended runtime.

This brief locks scope for a **substrate redirect before first launch**, not a migration of running traffic:

- Playwright code stays. The browser action vocabulary (`navigate / click / type / extract / download`), the contract-enforced page, the artefact validator, the streaming-video capture path, the login flow, and the executor stay byte-identical where possible.
- The runner harness changes: the worker's persistent VPS process design is replaced by a per-task e2b sandbox session managed through the `SandboxExecutionService` provider contract.
- Persistent browser profile is preserved via the Spec D §3.13 profile-snapshot primitive, scoped to the IEE browser's multi-tenant key shape.
- The DO-bound code paths (`worker/Dockerfile`, the VPS-resident pg-boss handlers, deploy scripts) are removed from the repo. No DO infrastructure exists to decommission.
- First production traffic lands on e2b. No parallel-run / shadow window.

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

- **As-designed (in repo, never launched):** the worker is a persistent VPS-resident Docker container that pulls pg-boss `browserTask` jobs and runs `worker/src/browser/executor.ts` against a Playwright `BrowserContext` opened from a host-disk `userDataDir`.
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
  - The DigitalOcean VPS provisioning + deployment artefacts (env-secrets templates, deploy scripts, monitoring agents — whatever exists in the repo for the never-launched DO target). Inventory and removal steps in §3.6.

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
| Lifecycle: created on first chain link, persists across chain links, GC 48hr after task terminal (admin can extend to 14d) | Lifecycle: created lazily on first task that uses `session_key`, persists indefinitely while in use, GC after a per-subaccount inactivity window (default **30 days**; range 7-90 days; see GC explainer below). No notion of "task terminal" because many tasks share the profile. |
| Profile corruption recovery: `OPERATOR_PROFILE_UNRECOVERABLE` + fresh-profile restart with new `attempt_number` | Profile corruption recovery: existing `playwrightContext.ts` rename-to-`.corrupt.<ts>` + fresh-dir backoff. Lifted into the sandbox profile primitive — the rename happens against the mounted volume, not host disk. Fresh-profile-restart concept does NOT apply (no chain-link attempts model). |
| Profile size cap: 500 MB per task | Profile size cap: 500 MB per `(org, subaccount, session_key)`. Same enforcement primitive (volume quota or pre-mount disk check). |
| Subaccount isolation enforced by Spec B sandbox isolation | Same. Adapter MUST assert the task's subaccount matches the profile's subaccount before mount. |

Profile snapshot / restore semantics from §3.13 carry over unchanged. The only new state is a lightweight table or column tracking `(organisation_id, subaccount_id, session_key) → volume_id, last_used_at, size_bytes` for GC scheduling — spec author's call on whether to extend `operator_task_profiles` or introduce a sibling table.

**GC retention explainer (plain English).** A "browser profile" is the saved state of a Chromium browser — cookies, login session, saved passwords, downloaded files. When a task uses a profile, then no task touches it for a while, we have to decide when to delete it to save storage.

Trade-offs:

- **Short window (7-14 days):** less storage cost. But if a task only runs every two or three weeks, the profile gets deleted between runs and the agent has to log in again — which can mean MFA prompts, captchas, or breakage on sites with aggressive anti-bot checks. High operational friction.
- **Medium window (30 days, recommended):** covers monthly tasks getting back to weekly cadence with margin. Storage cost is bounded (500 MB max per profile, low number of profiles per subaccount in early product). Most stale cookies expire on their own inside this window anyway.
- **Long window (60-90 days):** maximum convenience; minimum re-login friction. Storage cost still small. Larger blast radius if a profile is compromised (an attacker with the profile cookies would have a longer-lived foothold), but this is mitigated by Spec B isolation + the 500MB cap.
- **Indefinite:** not recommended. Profiles for one-off "I ran this once six months ago" tasks accumulate forever.

Default recommendation: **30 days inactivity → GC.** Range 7-90 days. Per-subaccount configurable. If a profile is in active use (any task touched it inside the window), `last_used_at` resets and the timer starts again — only truly unused profiles get GC'd.

### 3.4 Warm-pool configuration

Cold-start latency on e2b sandboxes is ~10-30s. Existing IEE browser workflows for human-triggered tasks (user clicks "run this browser task now") cannot absorb that without surfacing as visible delay. Solution per the audit §4 recommendation: keep N hot sandboxes pre-warmed per subaccount.

Spec MUST define:

1. **Warm-pool sizing.** Hardcoded to **1 per subaccount** in V1. Not user-configurable. If real production usage shows starvation, a future spec adds the per-subaccount knob back. The reasoning: a single sensible default removes a confusing knob from the admin UI; size=1 covers the human-triggered single-task case (which is what creates the cold-start UX problem) without overspending on idle compute.
2. **Warm-pool lifecycle.** A separate service (likely `server/services/sandbox/browserWarmPool.ts`) maintains a per-subaccount queue of pre-started sandbox sessions with no profile mounted. Sessions are checked out at task dispatch (profile mount happens at check-out, not at warm-up), checked back in if the task completes quickly enough that the session is still healthy, or torn down otherwise. Default check-in policy: tear down after first use (simpler; spec author may upgrade to reuse-with-reset if profile-mount-at-dispatch makes reuse safe).
3. **Warm-pool eviction.** Sessions older than M minutes are torn down and replaced — protects against drift between the warm session and the latest template version (per Spec B's `assertNotLatestTemplateVersion` guard). Default M = 30 min; range left to spec author.
4. **Warm-pool starvation behaviour.** When a task arrives and no warm session is available, fall through to a cold start. NOT an error; emits a warm-pool-miss metric for capacity planning.
5. **Cost attribution.** Warm sessions waiting on a task DO consume sandbox compute. The cost ledger records this as `source_type: 'sandbox_compute'` with a `subtype` discriminator (`warm_pool` vs `task`) so finance can see the cost separately. Spec author confirms the existing `source_type` schema supports this without a migration, or designs the minimum migration.
6. **No UI knob.** The warm-pool size is NOT exposed on the operator settings tab. Status (kill switch) controls whether the IEE browser path is enabled at all for the subaccount; that is the only warm-pool-adjacent control admins see.

### 3.5 Launch validation

No DO production traffic exists; this section is NOT about shadow / cutover. It is about proving the e2b harness is production-ready before it carries first traffic.

Spec MUST define:

1. **Local-dev validation.** The `synthetos-sandbox` template + local docker-compose path (per Spec B) is extended so a developer can exercise the full browser stack end-to-end on their laptop. Same code path that will run in e2b production. Validates: harness entrypoint, profile volume mount, executor wiring, artefact harvest, cost-row write, lifecycle event emission, cancellation, corruption recovery.
2. **Staging-e2b validation.** A staging environment runs against the real e2b SDK and the published template image. A fixed set of browser-task fixtures (navigate, login, extract, download, streaming-video capture, multi-task profile reuse, corruption recovery, cancellation mid-step) runs against staging on every PR that touches the harness or the template. Pass/fail gates the merge.
3. **Production rollout primitive.** A feature flag controls whether the IEE browser path is enabled at all for a given subaccount. Default at first launch: enabled only for the operator's own dogfood subaccount(s); rollout to other subaccounts gated on operator-approved per-subaccount toggle. NOT a shadow-vs-canonical mechanism — the flag is "on" or "off." Spec author chooses the flag mechanism (reuses existing flag infrastructure from Spec B or `personal-assistant-v1`).
4. **First-launch criteria.** Before flipping the flag on for a non-dogfood subaccount: (a) staging-e2b fixture suite passes, (b) dogfood subaccount has run ≥ N real browser tasks (spec author proposes N; reasonable starting point: 50 across at least 5 distinct skills) over ≥ 7 days with no harness-related incidents, (c) per-task cost is within the alarm thresholds set in §3.7.
5. **Rollback path.** Setting the flag off for a subaccount halts new IEE browser dispatches for that subaccount; in-flight tasks finish on e2b. No fallback substrate (DO does not exist as a fallback). If a regression appears that affects all subaccounts, the flag goes off globally and the harness is fixed before re-enable. Spec defines the operator-tooling surface for the flip (existing admin UI or new minimal control — spec author's call).

### 3.6 DO code-path retirement

No DO infrastructure exists to tear down. This section is purely **repo cleanup**: removing the DO-bound code paths that would otherwise mislead future contributors into thinking DO is a target runtime.

Spec MUST define:

1. **Files to retire entirely** (delete from repo, not move to `_retired/`):
   - `worker/Dockerfile` (worker-as-VPS-container build).
   - `worker/src/handlers/browserTask.ts`, `runHandler.ts`, `cleanupOrphans.ts` — replaced by the sandbox-harness entrypoint pattern from `synthetos-sandbox` / `operator-session`.
   - Any DO-specific deploy scripts, GitHub Actions workflows that target DO, env-template files referencing DO secrets. Spec author inventories during spec authoring.
   - `docs/iee-development-spec.md` Part 10 (Verification, MVP Acceptance & DigitalOcean Rollout) — rewritten to describe e2b rollout instead, or split into a new `docs/iee-on-e2b-rollout.md` and the legacy Part 10 deleted.
   - `tasks/windows-iee-setup-guide.md` — DO references in `_install` paths are corrected; the doc keeps its purpose (Windows dev setup) but the production-target paragraph becomes "production runs on e2b."
2. **Files to retain unchanged or near-unchanged:**
   - Everything under `worker/src/browser/`, `worker/src/loop/`, `worker/src/llm/`, `worker/src/persistence/`, `worker/src/runtime/sampler.ts` — reused inside the sandbox harness.
   - `worker/package.json` — retained as the install manifest for the harness image.
3. **Reference updates:**
   - `architecture.md` — every mention of "DigitalOcean" in the deployment-context tables is rewritten to "e2b sandbox" or deleted if redundant.
   - `docs/synthetos-governed-agentic-os-brief-v1.2.md` — substrate references checked, updated.
   - `tasks/strategic-recommendations.md` — DO cost lines deleted or marked superseded.
   - `replit.md` — no change expected; replit boot path is unaffected.
   - The doc-sync gate enforces these updates land in the same PR as the harness build.
4. **No infrastructure actions.** No DO account to wind down, no DNS to repoint, no secrets to revoke, no monitoring dashboards to archive. If any DO API tokens exist in 1Password / the operator's secret store, they are deleted as a one-line cleanup task surfaced in the brief but not gated.

### 3.7 Cost-tracking plan

**No DO baseline exists** (DO was never launched; no prior bill to compare against). e2b is the first-launch substrate. The spec's job here is to make sure cost is observable from day one and alarms fire if something is off-script — NOT to forecast against a baseline that doesn't exist.

Spec MUST define:

1. **Per-task cost row.** Every IEE browser task writes a `source_type: 'sandbox_compute'` row (already shipped in Spec B). The row carries `subaccount_id`, `agent_run_id`, vCPU-seconds, wall-clock seconds, peak memory. Spec confirms this is wired for the IEE browser harness identically to how `iee_dev` already writes it.
2. **Warm-pool cost discriminator.** Warm sessions consume sandbox compute while idle. Spec confirms the `sandbox_compute` row carries a `subtype` field (`task` vs `warm_pool`) so finance can see warm-pool overhead separately from task compute. If the schema doesn't already support `subtype`, spec author designs the minimum migration.
3. **Per-subaccount cost summary view.** Existing usage views already aggregate `sandbox_compute` rows by subaccount. Spec confirms IEE browser rows roll up correctly alongside `iee_dev` and `operator_managed` rows. No new dashboard required for V1.
4. **Alarm thresholds.** Spec defines two simple alarms wired into the existing `incidentIngestor`:
   - **Per-task alarm:** any single task that exceeds Y cents of sandbox compute. Default Y = 100 cents ($1.00). Fires `iee_browser.task_cost_anomaly` incident. Per-subaccount configurable on the operator settings tab as "Per-task cost ceiling"; help text reads "Alerts you when a single task costs more than this." (Earlier v2 dual-threshold design with a minutes ceiling is dropped per v3 reframe — money is the only mental model the admin needs.)
   - **Per-subaccount per-day alarm:** subaccount sandbox compute spend exceeds Z cents/day across all IEE browser tasks. Default Z = 500 cents ($5.00) per subaccount during dogfood; tightened or relaxed once real usage data lands. Fires `iee_browser.subaccount_cost_anomaly` incident. Per-subaccount configurable on the operator settings tab as "Per-subaccount daily cost ceiling"; help text reads "Alerts you when this subaccount's total daily browser-task cost goes over this." Event names are hidden from the admin UI; they live in the incident schema and the run log only.
5. **First-month cost-report artefact.** 30 days after first production traffic, the spec deliverable includes a one-pager at `tasks/builds/iee-browser-on-e2b/cost-report-month-1.md` summarising: total sandbox compute spend, per-subaccount breakdown, per-skill breakdown, warm-pool overhead as % of total, alarm events fired, recommendations for tuning the warm-pool defaults and the alarm thresholds. This is a build deliverable, not a follow-up.

Spec author does NOT attempt a forecast against an imaginary DO baseline. The cost data lands when real traffic lands; thresholds are tuned from observation, not estimation.

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

Resolved 2026-05-13 by operator post-merge audit §4 + operator clarification (pre-launch reframe). The spec author MUST honour these values; deviations require returning to the operator.

1. **Single-vendor execution substrate.** e2b is the chosen substrate for all sandbox-class workloads, including IEE browser. Do not introduce a parallel substrate; do not relitigate.
2. **Substrate redirect before first launch, not migration.** No DO production traffic exists. Playwright code in `worker/src/browser/` stays; the runner harness changes. New code surface is constrained to the template image, the harness entrypoint, the warm-pool service, the launch-flag primitive, the profile-key extension, and the cost-alarm wiring. The action vocabulary, contract-enforced page, login flow, artefact validator, streaming-video capture, execution loop, failure classification, and step history are NOT touched in this build.
3. **Persistent browser profile reuses Spec D §3.13.** No parallel profile-persistence scheme. The only delta is the profile-scoping key shape (per §3.3). If a delta beyond key shape becomes necessary mid-spec, return to the operator before introducing it.
4. **Default integration surface: extend `SandboxExecutionService` (Option A in §3.2).** Spec author may justify Option B but the bar is high; reuse beats parallel infrastructure.
5. **Warm pool is mandatory; size is fixed at 1 per subaccount in V1.** Cold-start latency is unacceptable for human-triggered tasks; the warm pool exists to mask it. Not user-configurable in V1 (simpler admin UI, sensible default avoids the knob). If real usage shows starvation, a future spec adds the per-subaccount knob.
6. **First-launch criteria are operator-gated, not metric-gated.** Dogfood subaccount runs first; non-dogfood subaccounts opt in on operator approval after the §3.5 first-launch criteria are met (staging fixtures pass + dogfood soak + cost alarms within thresholds). No shadow window or success-rate cutover threshold (no DO baseline to compare to).
7. **DO code paths come out of the repo in the same PR as the e2b harness lands.** Not a follow-up. The doc-sync gate enforces it.
8. **Cost is observation-driven, not forecast-driven.** Per-task and per-subaccount cost rows + two alarm thresholds (§3.7) provide the visibility. A 30-day cost-report artefact is a build deliverable, not a follow-up. Thresholds are tuned from real usage data, not estimated upfront.
9. **One-vendor risk is acknowledged and accepted.** The `SandboxExecutionService` provider abstraction is the mitigation. If e2b becomes unavailable, the provider contract supports a future second provider; that work is out of scope here.
10. **No customer-facing UI changes in V1.** The substrate is invisible to customers. Internal admin surfaces (additions to the existing Spec D §3.14 operator settings tab) are the only UI changes, all admin-scoped: **Status** (kill switch, On/Off, default On), **Browser profile retention** (days, default 30, range 7-90), **Per-task cost ceiling** ($, default $1.00), **Per-subaccount daily cost ceiling** ($, default $5.00). No warm-pool knob. No minutes ceiling. No event-name chips. No spend widget. Plain-English help text on every field.

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

- **DigitalOcean is removed from the codebase as a target runtime.** No fork in the road for future contributors: the only deployment path is e2b. No risk of accidentally launching a DO instance.
- **The execution substrate is single-vendor.** Every sandbox-class workload (`iee_dev`, `iee_browser`, `operator_managed`) runs on the same provider with the same isolation primitive, lease state machine, harvest pipeline, and cost ledger.
- **The warm-pool primitive becomes reusable.** Future low-latency-sensitive sandbox workloads (e.g. interactive operator UI, on-demand code execution from chat) can use the same warm-pool service.
- **Profile-persistence-by-key becomes a reusable primitive.** Future browser-using features that need persistent state across tasks (Personal Assistant browser workflows, ClientPulse browser polling) inherit the multi-tenant profile primitive instead of inventing one.
- **The Spec B provider abstraction is stress-tested under three different workloads** (`iee_dev` code execution, `operator_managed` agentic sessions, `iee_browser` browser automation). Any contract gaps that survived the first two are caught here.

## 7. Sequencing

Recommended order:

1. **Operator reviews this brief, locks scope.** GC retention default confirmed at 30 days (range 7-90, per-subaccount configurable). Warm-pool size fixed at 1 in V1 (not user-configurable). All other open items from v1/v2 resolved.
2. Spawn a new Claude Code session for the build slug; the session adopts `spec-coordinator`.
3. Session runs: brief intake (this doc) → spec authoring → `spec-reviewer` (Codex loop) → `chatgpt-spec-review` (manual rounds) → handoff to `feature-coordinator`.
4. Build session ships: the `infra/sandbox-templates/iee-browser/` template, the sandbox-harness entrypoint, the `SandboxExecutionService` browser-class extension (or Option B `BrowserExecutionService`), the warm-pool service, the launch-flag primitive + per-subaccount settings additions (warm-pool size, GC retention window), the profile-key extension on the Spec D primitive, the cost-alarm wiring (per-task + per-subaccount), the 30-day cost-report artefact, the DO code-path deletions, and the doc-sync updates.
5. First launch lands on the dogfood subaccount per §3.5. Other subaccounts opt in on operator approval after the first-launch criteria are met.

**Estimated sizing:** spec ~1 day; build 1-2 weeks (most effort: profile-lifecycle wiring + warm-pool service + cost-alarm wiring; raw e2b integration is already done for Specs B / D; no parallel-run / cutover engineering needed). The 30-day cost-report artefact is calendar-time-bound (real production traffic must accrue), not engineering-time-bound.

**Branch:** `claude/migrate-browser-e2b-{nonce}` off post-#287/#288 `main`. (Current branch: `claude/migrate-browser-e2b-snI99`.)

## End of brief
