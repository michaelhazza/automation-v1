**Status:** accepted (operator-approved 2026-05-13; chatgpt-spec-review skipped with REVIEW_GAP)
**Spec date:** 2026-05-13
**Last updated:** 2026-05-13
**Author:** Claude Opus 4.7 (spec-coordinator inline session)
**Build slug:** `iee-browser-on-e2b`
**Source branch:** `claude/migrate-browser-e2b-snI99`
**Source brief:** `tasks/builds/iee-browser-on-e2b/brief.md` (LOCKED v7, 2026-05-13)
**Scope class:** Major (new subsystem, cross-cutting, architectural)
**Predecessors:** Spec A (PR #281, adapter contract), Spec B (PR #287, SandboxExecutionService), Spec D (PR #288, operator backend with §3.15 profile primitive)

# IEE Browser on e2b — Build Spec

## Table of contents

1. Goals
2. Non-goals
3. Framing assumptions
4. Locked architectural decisions
5. Existing primitives reused (no new invention)
6. Phase plan (single phase; chunk order)
7. File inventory lock
8. Contracts
   - 8.1 `SandboxRunTaskInput` extension for browser
   - 8.2 `iee_browser_session_profiles` row shape
   - 8.3 `subaccount_iee_browser_settings` row shape
   - 8.4 Launch-flag check at dispatch
   - 8.5 Warm-session check-out contract
   - 8.6 Cost-row discriminator
   - 8.7 Alarm events
9. Permissions / RLS checklist
10. Schema details
    - 10.1 `iee_browser_session_profiles`
    - 10.2 `subaccount_iee_browser_settings`
11. Execution model
12. Phase sequencing (single phase; chunk dependency graph)
13. Execution-safety contracts
    - 13.1 Idempotency
    - 13.2 Retry classification
    - 13.3 Concurrency guards
    - 13.4 Terminal event guarantee
    - 13.5 No silent partial success
    - 13.6 Unique-constraint → HTTP mapping
    - 13.7 State machine
14. `session_key` derivation policy (REQUIRED operator decision)
15. Testing posture
16. Deferred items
17. Open questions for Phase 2
18. Self-consistency pass result
19. References

## 1. Goals

1. The IEE browser worker runs every task inside an e2b sandbox session managed through the existing `SandboxExecutionService` (Spec B). No DigitalOcean target remains in the repo.
2. Playwright code in `worker/src/browser/` is preserved byte-identical except where the sandbox file-system layout requires a single path-resolution change.
3. Persistent browser profile state survives across tasks that share the tenant-scoped key `(organisation_id, subaccount_id, session_key)`, reusing the Spec D §3.15 profile-volume primitive with a new keying shape.
4. First production traffic lands on e2b with a per-subaccount kill switch + admin-tunable cost ceilings + profile retention window. Rollout is operator-gated, dogfood-first.
5. Cost is observable from day one via the existing `llm_requests` ledger row (`source_type: 'sandbox_compute'`), with two alarm thresholds wired through `incidentIngestor`.
6. Cold-start latency for human-triggered browser tasks is masked by a per-subaccount warm pool of size 1, activated only for subaccounts whose IEE browser is BOTH `Status = On` AND rollout-approved.
7. The Operator settings tab gains 4 IEE-browser fields, loses 3 operator-backend fields (replaced by hardcoded constants), and broadens its role gate to include `subaccount_admin`.

## 2. Non-goals

Quoted from brief §5 (LOCKED) — none of the following ship in this build:

- AWS Bedrock / AWS KMS / any AWS work
- Replacing pg-boss with a different job system
- New browser capabilities (PDF render, mobile-emulation profiles, anti-bot evasion, captcha solvers)
- Customer-facing "DO vs e2b" cost dashboard
- Multi-region e2b deployment
- Browser-session live takeover (operator joins a running session)
- Cross-subaccount profile sharing (explicit non-goal; RLS invariant prohibits it)
- Headless-vs-headed toggle exposed to customers
- LLM-substrate changes (router, model selection, prompt-caching)
- Migrating `iee_dev` to a different sandbox class (already routes through `SandboxExecutionService`)
- BYO compute / customer-hosted browser workers
- A second sandbox provider registered alongside e2b

## 3. Framing assumptions

Per `docs/spec-context.md` (current 2026-05-13):

- `pre_production: yes`, `live_users: no`, `breaking_changes_expected: yes`. The substrate redirect happens before any DigitalOcean launch. No shadow / cutover window because there is no parallel substrate to compare against.
- `testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`, `e2e_tests_of_own_app: none_for_now`. Test plan in §15 obeys this.
- `feature_flags: only_for_behaviour_modes`. The IEE browser **Status** field is a per-subaccount kill switch (on/off), not a rollout-percentage ramp. Per-subaccount granularity satisfies the operator-gated rollout in brief §3.5.
- `prefer_existing_primitives_over_new_ones: yes`. This spec reuses `SandboxExecutionService` (Spec B), the adapter contract (Spec A), the `operatorTaskProfiles` lifecycle pattern (Spec D §3.15), the `llm_requests` cost ledger, the `iee-run-completed` pg-boss queue, the `incidentIngestor`, and `_ieeShared`'s dispatch / finalise / reconcile path.

## 4. Locked architectural decisions

Quoted from brief §4 (LOCKED v7 — 10 items). The spec author MUST honour these values. Deviations require returning to the operator.

1. **Single-vendor execution substrate.** e2b for all sandbox-class workloads, including IEE browser.
2. **Substrate redirect before first launch.** Playwright code stays; runner harness changes. New code surface is bounded: template image, harness entrypoint, warm-pool service, launch-flag check, profile-key extension, cost-alarm wiring, settings columns + UI.
3. **Persistent browser profile reuses Spec D §3.15.** Key shape is the only delta. Sibling table (this spec, §10.1) rather than extending `operator_task_profiles`, because the keying is fundamentally different: many tasks share one profile here; one profile per task attempt there.
4. **Default integration: extend `SandboxExecutionService` with sandbox-class `'browser'`** (Option A in brief §3.2). `ieeBrowserBackend.ts` already declares `sandboxRequirement: 'browser'`; the work is wiring the runtime branch + the e2b template lookup.
5. **Warm pool size = 1 per enabled subaccount (V1).** Not user-configurable. Warm pool maintained ONLY for subaccounts that are BOTH Status=On AND rollout-approved. Lazy fill on first task is permitted; eager prewarm acceptable only if idle-compute cost is bounded.
6. **First-launch criteria are operator-gated.** Dogfood first. Non-dogfood subaccounts opt in after staging-fixtures pass + dogfood soak + alarms-within-threshold (brief §3.5).
7. **DO code paths deleted in this PR.** Doc-sync gate enforces.
8. **Cost is observation-driven.** Two alarms (§8.7). Month-1 cost-report PLACEHOLDER file is a merge gate; the completed report is a post-launch deliverable, not a merge gate.
9. **One-vendor risk accepted.** Provider abstraction is the mitigation.
10. **No customer-facing UI in V1.** Only admin-scoped Operator settings tab changes: 4 new fields, 3 removed, 1 predicate broadened to include `subaccount_admin`.

## 5. Existing primitives reused (no new invention)

| Concern | Primitive | Source |
|---|---|---|
| Sandbox provider abstraction | `SandboxExecutionService` interface + provider registry | `server/services/sandbox/sandboxProviderResolver.ts:23` |
| Sandbox classification | `SandboxRequirement` type (already includes `'browser'`) | `server/services/executionBackends/types.ts:110-114` |
| Adapter contract | `ExecutionBackend` interface; delegated lifecycle | `server/services/executionBackends/types.ts:324` |
| IEE adapter pair | `ieeBrowserBackend` (declares `sandboxRequirement: 'browser'`) + `_ieeShared` dispatch / finalise / reconcile | `server/services/executionBackends/ieeBrowserBackend.ts:32`, `_ieeShared.ts` |
| Profile volume lifecycle pattern | Spec D §3.15 (volume creation, mount, size cap, GC, corruption recovery, audit) | `server/db/schema/operatorTaskProfiles.ts` |
| Cost ledger row | `llm_requests` with `source_type: 'sandbox_compute'` | `server/db/schema/llmRequests.ts` |
| Cost-row write path for sandbox compute | `server/services/sandboxHarvestService.ts` (Spec B §8.4 harvest pipeline) | per Spec B inventory |
| Incident ingestor (alarm events) | `incidentIngestor` | per `architecture.md` |
| Operator settings persistence | `subaccount_operator_settings` + ETag (`settings_version`) PATCH pattern | `server/db/schema/subaccountOperatorSettings.ts` |
| Playwright persistent context | `worker/src/browser/playwrightContext.ts:openPersistentContext` (multi-tenant `userDataDir` keying already exists) | source file |
| Failure-error vocabulary | `SafetyError`, `EnvironmentError`, `FailureError`, `FailureReason` enum | `shared/iee/failureReason.ts`, `shared/iee/failure.ts` |
| Three-layer RLS | `withOrgTx`, `getOrgScopedDb`, dual-GUC pattern | `server/middleware/orgScoping.ts`, `server/instrumentation.ts` |
| RLS manifest | `RLS_PROTECTED_TABLES` | `server/config/rlsProtectedTables.ts` |

The only genuinely new pieces in this spec: (a) the IEE-browser sandbox template under `infra/sandbox-templates/iee-browser/`; (b) the warm-pool service; (c) the new sibling table `iee_browser_session_profiles`; (d) the new sibling table `subaccount_iee_browser_settings`; (e) the operator-backend defaults module; (f) the column-level addition `llm_requests.subtype`. Every other change is an extension of an existing primitive.

## 6. Phase plan

**One phase (V1).** No multi-phase ladder. The build is a substrate redirect plus its supporting state. The 30-day cost-report completion (post-launch) is a calendar-driven deliverable, NOT a phase.

Build chunk order (Phase 2 plan will refine these into builder-sized units):

1. Schema migrations + RLS manifest entries (foundations)
2. e2b sandbox template `iee-browser` (template image, deterministic build per Spec B §15.2)
3. `SandboxExecutionService` extension to dispatch `sandboxRequirement: 'browser'` → e2b template `iee-browser`
4. Warm-pool service (lazy-fill, check-out, eviction, cost discriminator)
5. Profile volume lifecycle service for `iee_browser_session_profiles` (mount, size cap, GC scheduler, corruption recovery)
6. Sandbox harness entrypoint (replaces `worker/Dockerfile` + the VPS-resident pg-boss handlers)
7. `playwrightContext.ts` minor edit: resolve `userDataDir` to the mounted volume path inside the sandbox (path-traversal regex preserved)
8. Adapter wiring inside `_ieeShared.ts` to route `type: 'browser'` through `SandboxExecutionService` with the warm-pool check-out + profile mount
9. `llm_requests.subtype` column + the cost-row write path discriminator (`task` vs `warm_pool`)
10. Launch-flag check at the dispatch boundary (returns a typed `LaunchDisabled` error when Status=Off; in-flight tasks unaffected)
11. Alarm wiring: per-task and per-subaccount-per-day cost ceilings; plain-English UI; event names live in incident schema only
12. UI: 4 new fields on Operator settings tab + 3 removed; v5 predicate expansion in `AdminSubaccountDetailPage.tsx`; tab pill relabel "Org admin" → "Admin"
13. Operator-backend defaults module (`operatorSettingsDefaults.ts`) so the operator-backend service substitutes constants for the 3 cut fields; DB columns stay
14. DO code-path retirement (delete `worker/Dockerfile`, VPS-resident handlers, DO deploy scripts)
15. Doc-sync sweep (`architecture.md`, `docs/iee-development-spec.md` Part 10, `tasks/windows-iee-setup-guide.md`, `docs/synthetos-governed-agentic-os-brief-v1.2.md`)
16. Placeholder cost-report file + `tasks/todo.md` calendar-dated todo for the 30-day report

Dependency graph: 1 → 2 → 3 → (4, 5 in parallel) → (6, 7 in parallel) → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16. No backward references. No orphaned deferrals.

## 7. File inventory lock

### 7.1 Schema files (Drizzle)

| File | Action | Notes |
|---|---|---|
| `server/db/schema/ieeBrowserSessionProfiles.ts` | NEW | Sibling to `operator_task_profiles`; keyed by `(organisation_id, subaccount_id, session_key)`. Details §10.1. |
| `server/db/schema/subaccountIeeBrowserSettings.ts` | NEW | Sibling to `subaccount_operator_settings`; PK `subaccount_id`. Details §10.2. |
| `server/db/schema/llmRequests.ts` | EXTEND | New column `subtype text` (nullable; values `'task' \| 'warm_pool'` when `source_type='sandbox_compute'`; null otherwise). |
| `server/db/schema/index.ts` | EXTEND | Export new tables. |
| `server/config/rlsProtectedTables.ts` | EXTEND | Add `iee_browser_session_profiles` + `subaccount_iee_browser_settings`. |

### 7.2 Migration files (next available is 0343)

| File | Purpose |
|---|---|
| `migrations/0343_create_iee_browser_session_profiles.sql` + `.down.sql` | Create table + indexes + RLS policy (dual-GUC). |
| `migrations/0344_create_subaccount_iee_browser_settings.sql` + `.down.sql` | Create table + RLS policy (dual-GUC). MUST default `status` column to `'off'` (§3.5 brief v7 invariant — no mass enable on backfill). |
| `migrations/0345_llm_requests_add_subtype.sql` + `.down.sql` | `ALTER TABLE llm_requests ADD COLUMN subtype text` (nullable) + CHECK constraint `source_type = 'sandbox_compute' OR subtype IS NULL`. |

### 7.3 Sandbox template

| File | Action | Notes |
|---|---|---|
| `infra/sandbox-templates/iee-browser/Dockerfile` | NEW | Playwright base `mcr.microsoft.com/playwright:v1.59.1-jammy` + ffmpeg, pinned by digest. Deterministic-build rules per Spec B §15.2. |
| `infra/sandbox-templates/iee-browser/README.md` | NEW | Template description + harness entrypoint reference. |
| `infra/sandbox-templates/iee-browser/harness/index.ts` (or equivalent) | NEW | Sandbox-side entrypoint: wakes, runs the executor against the supplied task payload, writes harvest output to `/workspace/artefacts`, exits. |

### 7.4 Server services

| File | Action | Notes |
|---|---|---|
| `server/services/sandbox/browserWarmPool.ts` | NEW | Per-subaccount warm-pool queue. Lazy fill, check-out, eviction at age (default 30 min), starvation falls through to cold start. Cost-discriminator tag on warm sessions. |
| `server/services/sandbox/sandboxProviderResolver.ts` | EXTEND | No interface change. Provider implementations consume the `'browser'` `sandboxRequirement` at `runTask` time (the type already permits it). |
| `server/services/sandbox/e2bSandbox.ts` (exact path TBD in Phase 2 — see §17 open question 3) | EXTEND | When `sandboxRequirement === 'browser'`, resolve template `iee-browser`; otherwise existing behaviour. Mount profile volume at task dispatch (NOT at warm-up). |
| `server/services/sandbox/ieeBrowserProfileManager.ts` | NEW | Profile lifecycle for `iee_browser_session_profiles`: lazy-create, mount, size enforcement (500 MB), GC scheduler (per-subaccount retention 30 days default, 7-90 range), corruption-recovery (rename-to-`.corrupt.<ts>` inside the volume), audit log emit, hard delete on retention / operator action / subaccount termination. |
| `server/services/sandbox/sandboxHarvestService.ts` | EXTEND | Write `subtype: 'task' \| 'warm_pool'` discriminator on every `source_type: 'sandbox_compute'` row. |
| `server/services/executionBackends/_ieeShared.ts` | EXTEND | `ieeDispatch({ type: 'browser', ... })` route checks the launch-flag (§8.4), checks out a warm session from `browserWarmPool` for the task's subaccount (falls through to cold start), mounts the profile via `ieeBrowserProfileManager`, dispatches through `SandboxExecutionService.runTask({ sandboxRequirement: 'browser', ... })`. |
| `server/services/operatorBackend/operatorSettingsDefaults.ts` | NEW | Exports the 3 constants the operator-backend service substitutes for the cut per-subaccount fields: `AUTO_EXTEND_GRACE_MINUTES = 30`, `MAX_CHAIN_LENGTH = 100`, `MAX_WALL_CLOCK_PER_TASK_DAYS = 30`. Single discoverable location for revisit. |
| `server/services/operatorBackend/<existing operator-backend service file>` | EXTEND | Stop reading the per-subaccount values for the 3 cut fields; read from `operatorSettingsDefaults.ts` constants. DB columns stay (forward-compat). |
| `server/services/incidents/incidentIngestor.ts` (or wherever event names register) | EXTEND | Register `iee_browser.task_cost_anomaly` and `iee_browser.subaccount_cost_anomaly` events. Event names hidden from UI; in incident schema + run logs only. |

### 7.5 Worker

| File | Action | Notes |
|---|---|---|
| `worker/src/browser/playwrightContext.ts` | MINOR EDIT | `buildUserDataDir(...)` resolves to the mounted volume path inside the sandbox. `SESSION_KEY_RE`, path-traversal regex, corruption-recovery rename, launch-failure backoff: ALL preserved. |
| `worker/src/browser/{executor,contractEnforcedPage,observe,login,artifactValidator,captureStreamingVideo}.ts` | UNCHANGED | Playwright action layer is substrate-agnostic. |
| `worker/src/loop/*`, `worker/src/llm/*`, `worker/src/persistence/*`, `worker/src/runtime/sampler.ts` | UNCHANGED | Sandbox-agnostic. |
| `worker/Dockerfile` | DELETE | Replaced by `infra/sandbox-templates/iee-browser/Dockerfile`. |
| `worker/src/handlers/browserTask.ts` | DELETE | Replaced by sandbox-harness entrypoint. |
| `worker/src/handlers/runHandler.ts` | DELETE | Replaced by sandbox-harness entrypoint. |
| `worker/src/handlers/cleanupOrphans.ts` | DELETE | Replaced by `SandboxExecutionService` start-claim-lease + reconcile (already in Spec B). |
| `worker/src/runtime/queueMetrics.ts` | DELETE | Cost attribution moves to `sandboxHarvestService`. |
| `worker/src/runtime/cost.ts` | DELETE | Cost attribution moves to `sandboxHarvestService`. |
| `worker/src/handlers/costRollup.ts` | UNCHANGED | LLM cost rollup stays; sandbox compute attribution is upstream of this. |
| `worker/package.json` | UNCHANGED | Retained as install manifest for the harness image. |

### 7.6 Client (UI)

| File | Action | Notes |
|---|---|---|
| `client/src/pages/AdminSubaccountDetailPage.tsx` | EDIT | `canSeeOperatorTab` (lines 44-46) + `canEditOperatorSettings` (line 47) gain `subaccount_admin`. v6 tab-button pill text changes `Org admin` → `Admin`. |
| `client/src/pages/govern/operatorSettings/OperatorSettingsTab.tsx` | EDIT | Remove 3 `NumberField`s (`Auto-extend grace`, `Max chain length`, `Max wall-clock per task`). Add a 3rd section "IEE browser" with 4 fields: Status (`ToggleField`), Browser profile retention (`NumberField`), Per-task cost ceiling (`CurrencyField`), Per-subaccount daily cost ceiling (`CurrencyField`). Save footer copy unchanged. |
| `client/src/pages/govern/operatorSettings/_fields.tsx` | EXTEND | Export new components `ToggleField` (on/off with help text) and `CurrencyField` ($-prefixed input matching round 2/3 mockup). Existing `NumberField` unchanged. |
| `client/src/api/ieeBrowserSettingsApi.ts` (or extend existing `operatorBackendApi.ts`) | NEW or EXTEND | `getIeeBrowserSettings(subaccountId)` + `updateIeeBrowserSettings(subaccountId, draft, etag)`. ETag pattern matches existing operator settings PATCH. |

### 7.7 Server routes (HTTP API)

| File | Action | Notes |
|---|---|---|
| `server/routes/subaccountIeeBrowserSettings.ts` (or extend existing operator-settings router) | NEW or EXTEND | `GET /api/subaccounts/:id/iee-browser-settings` + `PATCH /api/subaccounts/:id/iee-browser-settings`. Same ETag-driven PATCH semantics as operator settings (`settings_version` increment, HTTP 409 on conflict). |

### 7.8 Docs (sync — same PR)

| File | Action |
|---|---|
| `architecture.md` | Update sandbox-substrate references; remove DigitalOcean from deployment-context tables; add IEE-browser sandbox class to sandbox-classification table. |
| `docs/iee-development-spec.md` Part 10 | Rewrite to describe e2b rollout (or split into a new `docs/iee-on-e2b-rollout.md` and delete legacy Part 10). Disposition decided by operator — open question §17. |
| `tasks/windows-iee-setup-guide.md` | Production-target paragraph rewritten to "production runs on e2b"; dev-setup steps preserved. |
| `docs/synthetos-governed-agentic-os-brief-v1.2.md` | Substrate references checked, updated. |
| `tasks/strategic-recommendations.md` | DigitalOcean cost lines deleted or marked superseded. |

### 7.9 Placeholders

| File | Action |
|---|---|
| `tasks/builds/iee-browser-on-e2b/cost-report-month-1.md` | NEW (PLACEHOLDER) — merge gate. Template only; the report itself is completed 30 days post-launch. |
| `tasks/todo.md` | ADD a calendar-dated todo: "[2026-06-12] Complete `tasks/builds/iee-browser-on-e2b/cost-report-month-1.md` from observed production traffic." |

### 7.10 Files explicitly NOT touched (boundary marker for reviewers)

- `worker/src/browser/executor.ts`, `contractEnforcedPage.ts`, `observe.ts`, `login.ts`, `artifactValidator.ts`, `captureStreamingVideo.ts`
- `worker/src/loop/executionLoop.ts`, `failureClassification.ts`, `heartbeat.ts`, `stepHistory.ts`, `systemPrompt.ts`
- `server/services/executionBackends/ieeBrowserBackend.ts` (the adapter already declares `sandboxRequirement: 'browser'`; nothing changes)
- `server/services/executionBackends/types.ts` (the `'browser'` sandbox requirement already exists)
- `client/src/pages/govern/operatorSettings/_fields.tsx` `NumberField` (existing component reused; only new components are added)

### 7.11 Inventory totals (numeric-count reconciliation per `docs/spec-authoring-checklist.md` §8)

- **2 new tables** (`iee_browser_session_profiles`, `subaccount_iee_browser_settings`)
- **1 schema column extension** (`llm_requests.subtype`)
- **3 new migration pairs** (0343, 0344, 0345)
- **1 new sandbox template** (`infra/sandbox-templates/iee-browser/`)
- **3 new server services** (`browserWarmPool`, `ieeBrowserProfileManager`, `operatorSettingsDefaults`)
- **6 worker files deleted** (`worker/Dockerfile`, `worker/src/handlers/browserTask.ts`, `worker/src/handlers/runHandler.ts`, `worker/src/handlers/cleanupOrphans.ts`, `worker/src/runtime/queueMetrics.ts`, `worker/src/runtime/cost.ts`)
- **1 worker file edited** (`playwrightContext.ts`)
- **3 client files edited** (`AdminSubaccountDetailPage.tsx`, `OperatorSettingsTab.tsx`, `_fields.tsx`)
- **1 new client API client** (`ieeBrowserSettingsApi.ts` or extension to `operatorBackendApi.ts`)
- **1 new HTTP route file** (`subaccountIeeBrowserSettings.ts` or extension to existing router)
- **5 doc files updated** (`architecture.md`, `iee-development-spec.md`, `windows-iee-setup-guide.md`, `synthetos-governed-agentic-os-brief-v1.2.md`, `strategic-recommendations.md`)
- **1 placeholder file + 1 calendar-dated todo entry**

## 8. Contracts

### 8.1 `SandboxRunTaskInput` extension for browser

`SandboxExecutionService.runTask` already accepts `SandboxRunTaskInput` (per Spec B). For browser tasks the input carries these additional fields (concrete example — non-Playwright fields only; Playwright task envelope is unchanged):

```jsonc
{
  "sandboxRequirement": "browser",
  "templateName": "iee-browser",
  "organisationId": "<uuid>",
  "subaccountId": "<uuid>",
  "agentRunId": "<uuid>",
  "profileMount": {
    "sessionProfileId": "<uuid>",            // FK to iee_browser_session_profiles.id
    "volumeId": "<opaque-volume-id>",
    "userDataDirInSandbox": "/workspace/profile"
  },
  "warmSessionCheckoutId": "<uuid> | null",   // null if cold-started
  "taskPayload": { /* existing IEE browser task envelope, unchanged */ }
}
```

- **Producer:** `_ieeShared.ts::ieeDispatch` (browser branch).
- **Consumer:** the e2b provider's `runTask` implementation (template lookup + volume mount).
- **Nullability:** `warmSessionCheckoutId` may be null (cold start); `profileMount` is non-null for browser tasks (every browser task mounts a profile, even a fresh one).
- **Defaults:** `sessionKey` inside `taskPayload` defaults to `'default'` per existing `playwrightContext.ts:38` behaviour. See §14 for derivation-policy decision.

### 8.2 `iee_browser_session_profiles` row shape

Concrete example:

```jsonc
{
  "id": "<uuid>",
  "organisationId": "<uuid>",
  "subaccountId": "<uuid>",
  "sessionKey": "default",                  // validated against SESSION_KEY_RE
  "volumeId": "<opaque-string>",
  "lastUsedAt": "2026-05-13T12:00:00Z",
  "sizeBytes": 12345,
  "sizeCapBytes": 524288000,                // 500 MB
  "status": "active",                       // 'active' | 'scheduled_gc' | 'gc_in_progress' | 'gc_done'
  "scheduledGcAt": null,
  "gcStartedAt": null,
  "retentionDaysOverride": null,            // null = use subaccount setting
  "createdAt": "2026-05-01T08:00:00Z",
  "updatedAt": "2026-05-13T12:00:00Z"
}
```

- **Unique key:** `(organisation_id, subaccount_id, session_key)`.
- **Producer:** `ieeBrowserProfileManager` (lazy-create on first task that resolves a missing key).
- **Consumer:** same service (mount + lifecycle) + sandbox harvest (size update).
- **Source-of-truth precedence:** `last_used_at` is canonical for GC scheduling. `size_bytes` is canonical for the size record — sandbox harvest writes it after a task completes. If the volume's actual size disagrees with the row, the row is corrected from the volume (volume is the physical truth; row is the index). Disagreements emit an audit log row.

### 8.3 `subaccount_iee_browser_settings` row shape

Concrete example:

```jsonc
{
  "subaccountId": "<uuid>",                  // primary key
  "organisationId": "<uuid>",                // defence-in-depth for RLS
  "status": "off",                           // 'on' | 'off' — DEFAULT 'off' per §3.5 v7 invariant
  "rolloutApproved": false,                  // operator-gated; default false on existing rows
  "browserProfileRetentionDays": 30,         // range 7-90
  "perTaskCostCeilingCents": 100,            // default 100 ($1.00)
  "perSubaccountDailyCostCeilingCents": 500, // default 500 ($5.00)
  "settingsVersion": 1,                      // ETag source (matches operator-settings pattern)
  "updatedAt": "2026-05-13T12:00:00Z",
  "updatedByUserId": "<uuid> | null"
}
```

- **Producer:** PATCH `/api/subaccounts/:id/iee-browser-settings` (admin).
- **Consumer:** dispatch path (Status check), warm-pool service (Status + rollout check), profile manager (`browserProfileRetentionDays`), cost-alarm wiring (ceilings).
- **Source-of-truth precedence:** the row is canonical. If absent, defaults apply (status=off, rollout=false, retention=30, per-task=100c, per-day=500c). Lazy-creation on first PATCH only.

### 8.4 Launch-flag check at dispatch

The dispatch path checks `status === 'on'` AND `rolloutApproved === true` BEFORE calling `SandboxExecutionService.runTask`. If either is false, dispatch returns a typed `LaunchDisabled` failure (extends `FailureError`, new `FailureReason` value `iee_browser_launch_disabled`). The parent run records the failure and does NOT enqueue the task. In-flight tasks already running on e2b are unaffected — the check is at dispatch time, not at every harness step.

### 8.5 Warm-session check-out contract

`browserWarmPool.checkout({ organisationId, subaccountId })`:

- Returns `{ warmSessionId, sandboxId, leaseToken }` if a warm session is available for this subaccount.
- Returns `null` on starvation (no warm session ready) — caller falls through to cold start. Emits `iee_browser.warm_pool_miss` metric (NOT an incident).
- **Idempotency:** a leased warm session is removed from the available queue atomically (single-row `UPDATE ... WHERE status = 'available' RETURNING`). Two concurrent check-outs cannot acquire the same session.

`browserWarmPool.checkin({ warmSessionId, healthy: boolean })`:

- `healthy = true` AND session age < eviction threshold → returned to queue.
- `healthy = false` OR session age ≥ threshold → torn down; pool refill triggered.
- **Default V1 policy: tear down after first use** (simpler; profile-mount-at-dispatch means reuse needs a profile-unmount step which is added later if operator decides reuse is worth it).

### 8.6 Cost-row discriminator

`llm_requests.subtype` column. Values when `source_type = 'sandbox_compute'`:

- `'task'` — a task execution.
- `'warm_pool'` — a warm session's idle-time consumption (kept-running sandbox while waiting for a task).

When `source_type != 'sandbox_compute'`: `subtype` MUST be NULL. Enforced by a column-level `CHECK (source_type = 'sandbox_compute' OR subtype IS NULL)` constraint in migration 0345 (service-layer cannot regress this).

**Producer:** `sandboxHarvestService` (writes the row after every sandbox execution). **Consumer:** per-subaccount cost summary view (rolls up by `subtype` so finance sees warm-pool overhead separately), alarm wiring (§8.7).

### 8.7 Alarm events

Registered in the incident schema (event names hidden from UI per brief v3):

| Event name | Trigger | Payload | Type |
|---|---|---|---|
| `iee_browser.task_cost_anomaly` | Single task exceeds `perTaskCostCeilingCents` | `{ subaccountId, agentRunId, ieeRunId, costCents, ceilingCents }` | Incident (via `incidentIngestor`) |
| `iee_browser.subaccount_cost_anomaly` | Subaccount's `sandbox_compute` spend in a UTC day exceeds `perSubaccountDailyCostCeilingCents` | `{ subaccountId, dayUTC, spendCents, ceilingCents }` | Incident (via `incidentIngestor`) |
| `iee_browser.warm_pool_miss` | Cold start triggered when warm session was expected | `{ subaccountId, reason }` | Metric only — no incident row |

The first two fire as incidents; UI shows plain-English help text only, never the event name. The third is a metric (capacity-planning signal).

## 9. Permissions / RLS checklist

**Canonical RLS-posture sentence** (per `docs/spec-authoring-checklist.md` §4, added 2026-05-13):

> Both new tables use **dual-GUC RLS** (matches the `operator_task_profiles` + `subaccount_operator_settings` pattern): RLS policies check BOTH `app.organisation_id` AND `app.subaccount_id` via the `setOrgAndSubaccountGUC` transaction helper. This is explicit dual-GUC, not the org-only default. Subaccount filtering is enforced by RLS, not by service-layer code.

**Per-table:**

| Table | RLS policy | Manifest entry | Route guard | Principal-scoped context |
|---|---|---|---|---|
| `iee_browser_session_profiles` | dual-GUC (org + subaccount) in migration 0343 | added in same migration to `RLS_PROTECTED_TABLES` | not HTTP-accessed (internal table) | accessed only inside `ieeBrowserProfileManager` running within `withOrgTx` |
| `subaccount_iee_browser_settings` | dual-GUC (org + subaccount) in migration 0344 | added in same migration | `authenticate` + `requirePermission('operator_settings.write')` (extend existing operator-settings permission) + `resolveSubaccount` middleware | n/a (admin route, not agent path) |

**Cross-tenant invariants** (per brief §3.3 R3, v7 profile security invariants):

1. **No cross-tenant mount.** `ieeBrowserProfileManager.mount(profile)` asserts the task's `(org, subaccount)` matches the profile row's `(org, subaccount)` BEFORE the volume mounts. Volume-resolver enforces this regardless of caller. `session_key` is NEVER sufficient alone to authorise a mount.
2. **Audit.** Mount / unmount / GC / corruption-recovery / hard-delete events emit audit log rows in the existing audit schema with actor, tenant, profile-key, action, outcome, timestamp.
3. **Encryption at rest.** Profile volumes inherit Spec D §3.15 encryption (same mechanism as `operator_task_profiles`).
4. **Hard delete only.** No soft-delete of profile artefacts. Deletion is irreversible and emits an audit row.

**v5 predicate expansion** (in `client/src/pages/AdminSubaccountDetailPage.tsx` — code edit, NOT RLS):

```typescript
const canSeeOperatorTab = mode === 'admin' && (
  _user.role === 'org_admin' || _user.role === 'manager' ||
  _user.role === 'subaccount_admin' || _user.role === 'system_admin'
);
const canEditOperatorSettings =
  _user.role === 'org_admin' || _user.role === 'subaccount_admin' || _user.role === 'system_admin';
```

The route-level guard on the PATCH endpoint enforces the same role gate. Subaccount admin edits settings for their own subaccount only — RLS continues to scope data access to the user's accessible subaccounts; this predicate is only the page-level gate.

## 10. Schema details (the two new tables)

### 10.1 `iee_browser_session_profiles`

Sibling to `operator_task_profiles` because keying differs:

- `operator_task_profiles`: PK `(task_id, attempt_number)` — one profile per task attempt.
- `iee_browser_session_profiles`: UNIQUE `(organisation_id, subaccount_id, session_key)` — many tasks share one profile.

Drizzle column declaration:

```typescript
export const ieeBrowserSessionProfiles = pgTable(
  'iee_browser_session_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'restrict' }),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'cascade' }),
    sessionKey: text('session_key').notNull().default('default'),  // matches SESSION_KEY_RE
    volumeId: text('volume_id').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    sizeCapBytes: bigint('size_cap_bytes', { mode: 'number' }).notNull().default(524288000),
    status: text('status').notNull().default('active')
      .$type<'active' | 'scheduled_gc' | 'gc_in_progress' | 'gc_done'>(),
    scheduledGcAt: timestamp('scheduled_gc_at', { withTimezone: true }),
    gcStartedAt: timestamp('gc_started_at', { withTimezone: true }),
    retentionDaysOverride: integer('retention_days_override'),  // null = use subaccount setting
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantKeyUniqueIdx: uniqueIndex('iee_browser_session_profiles_tenant_key_unique_idx')
      .on(table.organisationId, table.subaccountId, table.sessionKey),
    lastUsedAtIdx: index('iee_browser_session_profiles_last_used_at_idx').on(table.lastUsedAt),  // GC scan
  }),
);
```

RLS policy in migration 0343: dual-GUC predicate matching `operator_task_profiles` policy verbatim, scoped to this table.

### 10.2 `subaccount_iee_browser_settings`

Sibling to `subaccount_operator_settings` (same per-subaccount-isolated-concern pattern):

```typescript
export const subaccountIeeBrowserSettings = pgTable(
  'subaccount_iee_browser_settings',
  {
    subaccountId: uuid('subaccount_id').primaryKey().references(() => subaccounts.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('off').$type<'on' | 'off'>(),  // DEFAULT off — §3.5 v7
    rolloutApproved: boolean('rollout_approved').notNull().default(false),  // operator-gated
    browserProfileRetentionDays: integer('browser_profile_retention_days').notNull().default(30),  // range 7-90
    perTaskCostCeilingCents: integer('per_task_cost_ceiling_cents').notNull().default(100),
    perSubaccountDailyCostCeilingCents: integer('per_subaccount_daily_cost_ceiling_cents').notNull().default(500),
    settingsVersion: integer('settings_version').notNull().default(1),  // ETag source
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  },
);
```

PATCH-handler validation (Zod): `browserProfileRetentionDays` ∈ [7, 90], `perTaskCostCeilingCents` ∈ [1, 10000], `perSubaccountDailyCostCeilingCents` ∈ [1, 100000], `status` ∈ {`'on'`, `'off'`}. `rolloutApproved` is operator-only (NOT exposed in the UI; toggled via direct DB / admin tool / future internal admin route — out of scope for this build's UI surface).

RLS policy in migration 0344: dual-GUC predicate matching `subaccount_operator_settings` verbatim.

## 11. Execution model

| Concern | Model | Rationale |
|---|---|---|
| Task dispatch (IEE browser task) | Queued via existing `iee-run-completed` pg-boss queue (delegated adapter) | Adapter pattern from Spec A; unchanged from today's IEE browser path. |
| Sandbox `runTask` | Inline call from `_ieeShared.ts::ieeDispatch` (browser branch) into `SandboxExecutionService.runTask` | Spec B's primitive is sync at the call site; the e2b SDK handles the async work behind it. |
| Warm-pool maintenance | In-process service in the main app process; lazy-fill (no eager prewarm in V1) | Single-instance assumption; if we shard, the pool becomes shard-local (acceptable for dogfood scale). |
| Profile GC | Queued via pg-boss daily cron; the cron handler scans `iee_browser_session_profiles WHERE last_used_at < now() - interval '<N> days'` and transitions `status='scheduled_gc'`. A separate worker drains the GC queue. | Decoupled from request path; survives app restarts. |
| Cost-alarm evaluation (per-task) | Inline at `sandboxHarvestService` row-write time | Already on the per-task code path; no new job. |
| Cost-alarm evaluation (per-subaccount-per-day) | Queued via pg-boss end-of-day cron; rolls up `sandbox_compute` rows where `subtype = 'task'` or `subtype = 'warm_pool'` by subaccount and day | Decoupled from request path. |
| Launch-flag check | Inline at dispatch entry (single DB read of `subaccount_iee_browser_settings`) | Sub-millisecond overhead. |

## 12. Phase sequencing (single phase; chunk dependency graph)

Per §6 above. Chunks 1-2 are foundations (schema + template). Chunks 3-9 are the runtime substrate. Chunks 10-13 are user-visible (kill switch + UI + alarms). Chunk 14 is the irreversible delete (DO retirement); it lands AFTER 1-13 are confirmed working in staging, never before. Chunks 15-16 are doc / placeholder.

No backward references. No orphaned deferrals. Phase-boundary check: every column referenced by code (e.g. `subtype` in chunk 9, `status` in chunk 10) is created in an equal-or-earlier chunk (chunks 1 and 1 respectively, via migrations 0345 and 0344).

## 13. Execution-safety contracts

### 13.1 Idempotency

| Write path | Posture | Mechanism |
|---|---|---|
| Sandbox `runTask` for a browser task | key-based | Existing Spec B start-claim lease (`sandbox_executions` row keyed on `(adapter_id, backend_task_id)`); already in place. |
| Profile lazy-create | key-based | UNIQUE `(organisation_id, subaccount_id, session_key)` on `iee_browser_session_profiles`. On `23505`, the racing creator reads the winner's row and proceeds. |
| Profile mount | state-based | `UPDATE iee_browser_session_profiles SET last_used_at = now() WHERE id = $1 AND status = 'active'` — 0 rows = profile is scheduled for GC or in flight; caller waits or re-resolves. |
| Settings PATCH | state-based | ETag = `settings_version`; PATCH increments via `WHERE settings_version = $expected_version`. 0 rows = conflict (HTTP 409). |
| Launch-flag check | non-idempotent (read-only) | n/a |
| Cost-row write | key-based | Existing Spec B sandbox-execution → cost-row pipeline; the `subtype` column is added but the write path's idempotency is unchanged. |
| Warm-session check-out | state-based | `UPDATE browser_warm_sessions SET status = 'leased' WHERE id = $1 AND status = 'available'` — 0 rows = session was leased by another caller; caller falls through to cold start. |

### 13.2 Retry classification

| Operation | Class | Boundary |
|---|---|---|
| Sandbox `runTask` | guarded | Spec B start-claim lease. |
| Profile lazy-create | safe | UNIQUE constraint absorbs retries. |
| Profile mount | guarded | State-based predicate; retry on 0-rows. |
| Settings PATCH | guarded | ETag predicate; HTTP 409 on conflict. |
| Launch-flag check | safe | Read-only. |
| Alarm event emit | safe | `incidentIngestor` is idempotent on event key per existing contract. |
| Warm-session check-out | guarded | State-based; retry on 0-rows means cold-start fallthrough, not retry of same session. |

### 13.3 Concurrency guards

- **Two concurrent dispatches for the same `(org, subaccount, session_key)` profile:** the second dispatch's mount UPDATE either succeeds (if state remains `'active'`) or returns 0 rows and waits. No double-mount; the volume layer enforces single-mount-at-a-time at the sandbox provider boundary (per Spec B isolation invariants).
- **Two concurrent PATCH on the same `subaccount_iee_browser_settings` row:** ETag check + `settings_version` increment + WHERE clause first-commit-wins. Loser gets HTTP 409.
- **Two concurrent GC sweeps:** the cron handler uses `FOR UPDATE SKIP LOCKED` when claiming profiles to GC; no double-claim.

### 13.4 Terminal event guarantee

The IEE browser task lifecycle already emits exactly one terminal `iee-run-completed` event per `iee_runs` row (Spec A invariant; unchanged here). No new terminal events introduced. Cost-alarm events are not lifecycle events — they are advisory incidents and do not gate run termination.

### 13.5 No silent partial success

A browser task that completes its Playwright actions but fails to harvest the profile (e.g. volume corruption mid-task) writes status `'failed'` with `failureReason: 'profile_harvest_failed'` (new `FailureReason` value). The artefact validator continues to enforce that incomplete artefact sets surface as `failed` rather than `success`. No partial-success path introduced.

### 13.6 Unique-constraint → HTTP mapping

| Constraint | HTTP on violation |
|---|---|
| `iee_browser_session_profiles_tenant_key_unique_idx` | n/a (internal table) — caller reads winner row and proceeds |
| `subaccount_iee_browser_settings_pkey` (subaccount_id) | n/a — table is upserted via PATCH which uses ETag |
| `llm_requests` (existing constraints) | unchanged from Spec B |

No new external constraints; no new `23505` → HTTP mappings needed.

### 13.7 State machine

`iee_browser_session_profiles.status` enum: `'active' → 'scheduled_gc' → 'gc_in_progress' → 'gc_done'`. Valid transitions:

- `'active' → 'scheduled_gc'` (cron sweep on `last_used_at < threshold`)
- `'scheduled_gc' → 'active'` (a new task lands and mounts the volume — pre-GC reprieve)
- `'scheduled_gc' → 'gc_in_progress'` (GC worker claims with `FOR UPDATE SKIP LOCKED`)
- `'gc_in_progress' → 'gc_done'` (volume hard-deleted, audit row emitted)

Forbidden transitions: `'gc_done' → *` (terminal). Status set is closed; adding a new value is a spec amendment.

`subaccount_iee_browser_settings.status` enum: `'on' | 'off'`. No state machine — direct PATCH transitions, ETag-guarded.

## 14. `session_key` derivation policy (LOCKED 2026-05-13)

Per brief §3.3 R4 v7, the spec author MUST document the policy.

**LOCKED policy: Path (b) — per-skill derivation with `'default'` fallback.** Operator-approved 2026-05-13.

Derive `session_key = sanitize(skillId)` for tasks that supply a `skillId` in the task payload; fall back to `'default'` for tasks that do not. Rationale: cookie isolation between unrelated browser skills is defensive-by-default; the cost to spec is small (one helper function); rollback to (a) is trivial if (b) breaks existing tasks.

`sanitize(skillId)` strips characters outside `SESSION_KEY_RE` (`/^[a-zA-Z0-9_-]{1,128}$/`) and truncates to 128 chars; if the result is empty, falls back to `'default'`.

**Test coverage required:** an isolation test that proves two tasks in the same subaccount with different `session_key` values get different profile mounts and cannot see each other's cookies. Per the local test-gate policy this runs in CI, not locally.

## 15. Testing posture

Per `docs/spec-context.md`:

- **Local-dev:** lint, typecheck, `build:server` / `build:client` when relevant, and targeted Vitest runs for new pure-function helpers authored in this build (warm-pool selection logic, GC scheduling math, `session_key` derivation, alarm-threshold evaluator, cost-row subtype tagger, profile mount-authorisation predicate). NO local integration / e2e / API contract / frontend tests.
- **CI:** the existing sandbox provider resolver test suite extends to cover the `'browser'` class — same matrix as `'code_execution'`. Profile-volume tests (volume creation, mount, multi-task reuse, isolation between different keys, corruption recovery, GC of inactive profiles, size-cap enforcement). Warm-pool tests (check-out under contention, fall-through to cold start on starvation, eviction at age, cost-attribution discriminator). Launch-flag / rollback tests (routing primitive blocks or allows dispatches per subaccount flag state; in-flight tasks unaffected; no shadow tests).
- **End-to-end browser-task regression:** a small suite of real browser flows (navigate, login, extract, download) runs against e2b in CI. Reuses the existing IEE browser fixtures where possible.
- **NO shadow-disagreement detection.** Quoted from brief §3.8 F2 (v7 fix): "no DO traffic exists to shadow against."

Framing-deviation flag: NONE. The test plan obeys `static_gates_primary` + `pure_function_only` for local; integration suites are CI-only per `references/test-gate-policy.md`.

## 16. Deferred items

- **Month-1 cost report.** PLACEHOLDER file `tasks/builds/iee-browser-on-e2b/cost-report-month-1.md` ships in this build (merge gate). The completed report (filled from 30 days of production traffic) is a post-launch deliverable, tracked by a calendar-dated todo in `tasks/todo.md`. NOT a build merge gate.
- **Warm-pool size knob (per-subaccount).** Backend honours `1` constant globally in V1. The brief explicitly defers the UI knob to V2 if real production usage shows starvation patterns.
- **Per-subaccount warm-pool sizing telemetry.** Beyond the existing `iee_browser.warm_pool_miss` metric, no dashboards or per-subaccount sizing analytics in V1.
- **Second sandbox provider** (Phase 4+ per brief §5). The `SandboxExecutionService` abstraction is the mitigation for the one-vendor risk; no second provider lands here.
- **Customer-facing cost dashboard** (brief §5 non-goal). Existing per-subaccount usage views already aggregate `sandbox_compute` rows; no new dashboard.
- **Headed-mode / live-takeover** (brief §5 non-goal).
- **Cross-subaccount profile sharing** (brief §5 non-goal; explicit RLS invariant prohibits).
- **Naming-inconsistency cleanup** (brief v5 §3.14): `'manager'` vs `'org_manager'` role-literal mismatch in `canSeeOperatorTab`. Out of scope; route to `tasks/todo.md` as a separate small PR after this build merges. Decision pending: operator confirms which spelling is wire-truthful.
- **`docs/iee-development-spec.md` Part 10 disposition** (rewrite vs split). See open question 2.

## 17. Open questions for Phase 2

The two design-level open questions were resolved in Phase 1 (2026-05-13). They are recorded here as DECIDED for traceability:

1. **`session_key` derivation policy (§14): DECIDED — path (b) per-skill derivation with `'default'` fallback.** Operator approval 2026-05-13.
2. **`docs/iee-development-spec.md` Part 10 disposition: DECIDED — split.** Phase 2 creates a new `docs/iee-on-e2b-rollout.md` and deletes legacy Part 10. Operator approval 2026-05-13.

Remaining items are Phase 2 lookups, not design questions:

3. **Sandbox provider implementation file path.** The Explore agent could not confirm the exact path of the e2b provider implementation (`server/services/sandbox/e2bSandbox.ts` is the most likely path per Spec B references). The first chunk of Phase 2 confirms the exact file and updates the inventory if it differs.
4. **Migration of pre-existing host-disk profiles.** If any IEE browser tasks have already populated `BROWSER_SESSION_DIR` on host disk (per `playwrightContext.ts:45`), Phase 2 confirms whether those profiles are migrated into `iee_browser_session_profiles` rows / volumes, or whether the dogfood-only first launch makes this a no-op.

## 18. Self-consistency pass result

- **Goals ↔ Implementation:** matched. All 7 goals in §1 map to inventory items in §7 and chunk plan in §6.
- **Single-source-of-truth claims:** every claim has a backing mechanism. `iee_browser_session_profiles` is canonical for profile metadata (§8.2). `subaccount_iee_browser_settings` is canonical for per-subaccount config (§8.3). `llm_requests` (with new `subtype`) is canonical for cost (§8.6). Volume is canonical for profile contents (§8.2 source-of-truth precedence).
- **Non-functional claims:** cold-start avoidance via warm pool (mechanism: `browserWarmPool.checkout` §8.5). Cost observability (mechanism: existing harvest + new `subtype` column + alarms §8.7). Cross-tenant isolation (mechanism: dual-GUC RLS §9 + adapter mount assertion §9 + Spec B sandbox isolation).
- **Numeric-count reconciliation** (per `docs/spec-authoring-checklist.md` §8): inventory totals in §7.11 reconcile with §7.1 (2 schemas), §7.2 (3 migration pairs), §7.5 (6 worker files deleted), §7.6 (3 client files edited), §7.7 (1 new HTTP route file or extension), §7.8 (5 docs updated). No mismatch.
- **Load-bearing claims with named mechanisms:** "no cross-tenant mount" → mount-authorisation predicate (§9 invariant 1). "Idempotent" → posture table (§13.1). "Source of truth" → precedence statements (§8.2, §8.3, §8.6).

## 19. References

- `tasks/builds/iee-browser-on-e2b/brief.md` (LOCKED v7) — source of truth for all locked decisions
- `prototypes/iee-browser-on-e2b.html` — UI design source of truth (locked at round 3.1)
- `tasks/builds/iee-browser-on-e2b/mockup-log.md` — round-by-round mockup history
- `tasks/builds/execution-backend-adapter-contract/spec.md` (Spec A, merged #281)
- `tasks/builds/sandbox-isolation/spec.md` (Spec B, merged #287)
- `tasks/builds/operator-backend/` (Spec D, merged #288; profile primitive at §3.15)
- `docs/spec-context.md` — framing ground truth (current 2026-05-13)
- `docs/spec-authoring-checklist.md` — pre-authoring rubric (current as of merge 2bdebb83 on 2026-05-13)
- `docs/frontend-design-principles.md` — UI rules
- `references/test-gate-policy.md` — test-gate posture
- `architecture.md` — to be updated for substrate references in this build's doc-sync sweep

## End of spec
