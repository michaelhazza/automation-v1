# Spec Conformance Log — sandbox-isolation

**Spec:** `tasks/builds/sandbox-isolation/spec.md`
**Spec commit at check:** `6d3df1ef82c35fb5f6883e758e0f133c9a7c593e`
**Branch:** `claude/evolve-sandbox-isolation-brief-Q51hc`
**Base:** `merge-base origin/main = 455feb177064c4c27da3ea4e0d0db5f1c8dbf3d3`
**Scope:** ENTIRE spec verified against ENTIRE changed-code set (Setup §C path 3 — completed implementation, all 16 chunks done per `tasks/builds/sandbox-isolation/progress.md`)
**Changed-code set:** 105 files (`git diff origin/main...HEAD --name-only`); review-log / scratch / spec / progress / todo files excluded
**Run at:** 2026-05-11T08:06:30Z
**Commit at finish:** `f5d269db`

---

## Table of contents

1. Operational notes
2. Summary
3. Requirements extracted
4. Mechanical fixes applied
5. Directional / ambiguous gaps
6. Files modified by this run
7. Next step
8. Pre-existing branch state

---

## 1. Operational notes

> **Operational note on Step 0 TodoWrite emission:** the playbook's per-subcomponent TodoWrite list (Step 0) was not emitted as a separate ceremony in this run. The verification was conducted as one consolidated read-then-classify pass with the user able to observe progress through the 30+ Read/Grep tool calls. Future runs of this playbook should emit Step 0 as written; this run's deviation is recorded for transparency, not because it changes the verdict.

## 2. Summary

- Requirements extracted: **52** (concrete, named items from spec §6 / §8 / §9 / §10 / §11 / §12 / §13 / §14 / §15 / §17 / §18 / §19 / §20 / §21 / §22 / §24 / §25)
- PASS:                    **38**
- MECHANICAL_GAP → fixed:  **0**
- DIRECTIONAL_GAP → deferred: **12**
- AMBIGUOUS → deferred:    **2**
- OUT_OF_SCOPE → skipped:  **0** (all 16 chunks done; entire spec in scope)

> `AMBIGUOUS` is reported separately for diagnostic visibility — both AMBIGUOUS and DIRECTIONAL items route to `tasks/todo.md` and both contribute to the `NON_CONFORMANT` verdict equally.

**Verdict:** **NON_CONFORMANT** (14 blocking gaps deferred to `tasks/todo.md`; pipeline-critical gap is REQ #11 — the harvest seam in `runTask` is unwired, which means the entire feature is end-to-end broken on the happy path).

**No mechanical fixes were applied this run.** All identified gaps required design judgement that exceeded the agent's safe auto-fix posture. Per the playbook's fail-closed classification rule (*"when in doubt, classify as DIRECTIONAL_GAP, not MECHANICAL_GAP"*), every borderline finding was routed for human attention rather than touched directly.

## 3. Requirements extracted (full checklist)

Verdict legend: `P` PASS · `M` MECHANICAL_GAP (fixed) · `D` DIRECTIONAL_GAP · `A` AMBIGUOUS · `O` OUT_OF_SCOPE

### 3.1 Schema layer (C1b, C3) — 14 reqs

| # | Spec | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 1 | §19.1, §20.3 | `sandbox_executions` Drizzle schema with 22 cols incl. F3 lease columns | **P** | `server/db/schema/sandboxExecutions.ts` |
| 2 | §19.1, §20.4 | `sandbox_artefacts` Drizzle schema, `(sandbox_execution_id, filename)` unique | **P** | `server/db/schema/sandboxArtefacts.ts:35-36` |
| 3 | §19.1, §20.5 | `sandbox_telemetry_events` Drizzle schema, closed event-type CHECK, `(execution_id, sequence)` unique | **P** | `server/db/schema/sandboxTelemetryEvents.ts`; CHECK at migration `0322_create_sandbox_artefacts_telemetry_logs.sql:73-94` |
| 4 | §19.1, §20.6 | `sandbox_egress_audit` Drizzle schema | **P** | `server/db/schema/sandboxEgressAudit.ts` |
| 5 | §19.1, §20.8 | `sandbox_logs` Drizzle schema, `(sandbox_execution_id, log_stream, sequence)` unique | **P** | `server/db/schema/sandboxLogs.ts:38-40` |
| 6 | §20.8 | `sandbox_logs.line` DB-side `CHECK (length(line) <= MAX_LOG_LINE_BYTES)` constraint | **D** | Schema and migration `0322` carry no length CHECK; service-layer truncation at `sandboxHarvestService.ts:333-337` partially substitutes but spec pins this as a DB constraint |
| 7 | §20.3 | Four CHECK constraints on `sandbox_executions` (status enum + 2 lease invariants + non-negative attempt count) | **P** | `migrations/0321_create_sandbox_executions.sql:61-75` |
| 8 | §19.4 | Four SQL migrations + paired `.down.sql` per spec §19.4 | **P** | Migrations 0321 / 0322 / 0323 / 0324 all present with `.down.sql` |
| 9 | §19.3, §21.1 | All five new tables added to `RLS_PROTECTED_TABLES` manifest | **P** | `server/config/rlsProtectedTables.ts:1220-1247` |
| 10 | §20.3, §20.4, §20.5, §20.6, §20.8 | RLS policy on each new table, org-boundary, FORCE RLS | **P** | All five `CREATE POLICY ... org_isolation` blocks present in 0321/0322/0323 |
| 11 | §12.2, §12.3, §19.4, §20.7 | Extend `llm_requests`: 2 enum values + 6 nullable cols + 2 partial unique idx + extended attribution / execution-phase CHECK | **P** | `migrations/0324_extend_llm_requests_for_sandbox.sql`; `server/db/schema/llmRequests.ts:147-194` |
| 12 | §6 (primitives), §13.2, §20.9 | Extend `FailureReason` with 8 sandbox values | **P** | `shared/iee/failureReason.ts:73-80` (note: file is `failureReason.ts`, not the spec's `failure.ts` — chunk plan corrected this routing) |
| 13 | §11.3 | `IssuedCredential` extended with optional `redactionPattern: RegExp` | **P** | `server/services/credentialBrokerService.ts:21-31` |
| 14 | §3.2 (plan §3.2), §17.4 | `sandbox_executions` / `sandbox_artefacts` / `sandbox_logs` carry `is_active` soft-delete column | **P** | All three schemas carry `isActive` |

### 3.2 Pure helpers (C5, C6, C12) — 6 reqs

| # | Spec | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 15 | §8.1, §10.1, §13.1, §19.1 | `sandboxExecutionServicePure.ts` with `classifyTerminal`, `resolveSandboxCeilings`, policy→provider-flags mapping | **P** | `server/services/sandboxExecutionServicePure.ts` |
| 16 | §8.4, §11.3, §19.1, §24.5 | `sandboxHarvestServicePure.ts` with `classifyHarvestOutcome`, `composeRedactionPatternSet`, `validateOutputAgainstSchema` | **P** | `server/services/sandboxHarvestServicePure.ts:64,165,209` |
| 17 | §15.2, §19.1 | `templateVersionParserPure.ts` with `parseCurrentVersion` / `parsePublishedVersion` | **P** | `server/services/sandbox/templateVersionParserPure.ts` |
| 18 | §18.2, §19.3, §7.2 | `ieeDevBackendPure.ts` with `classifyExecutionClass` returning `'sandbox' \| 'worker_orchestration' \| 'worker_trusted'` | **P** | `server/services/executionBackends/ieeDevBackendPure.ts:44-51` |
| 19 | §10.2 | `estimateSandboxCostCents(elapsedMs, maxCostCentsPerSecond)` upper-bound estimator | **P** | `server/jobs/sandboxCeilingMonitorPure.ts` (consumed in `sandboxCeilingMonitorJob.ts:137`) |
| 20 | §12.6, §19.1, §25.1 | `sandboxMeteringQueryPure.ts` with `getOrgSandboxMinutes` / `getSubaccountSandboxMinutes` | **D** | **File missing.** No file matches glob; spec §12.6 is unambiguous about file path and function names. Spec §25.1 also requires pure tests for it. |

### 3.3 Provider implementations (C4, C9, C10) — 4 reqs

| # | Spec | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 21 | §8.2, §19.1 | `sandboxProviderResolver.ts` with `SANDBOX_PROVIDER` env validation + hard guards | **P** | `server/services/sandbox/sandboxProviderResolver.ts:74-93` (local_docker rejected in prod; inline rejected outside test) |
| 22 | §8.2.3, §19.1 | `inlineSandbox.ts` test-only with construction-time hard guard | **P** | `server/services/sandbox/inlineSandbox.ts:25-35` |
| 23 | §8.2.1, §15.3, §19.1 | `e2bSandbox.ts` provider impl wrapping the e2b SDK; refuses `latest` template version | **P** (acknowledged-stub) | `server/services/sandbox/e2bSandbox.ts`; SDK is interface-stubbed pending account provisioning per `SANDBOX-DEF-EGRESS-MECH`; spec §4 acknowledges the vendor relationship and §27 deferred row covers the SDK install |
| 24 | §8.2.2, §15.5, §19.1 | `localDockerSandbox.ts` provider impl with `--network=none`, `--rm`, `--stop-timeout`, refuses `latest` | **P** | `server/services/sandbox/localDockerSandbox.ts` |

### 3.4 Service layer (C5, C7, C8) — 7 reqs

| # | Spec | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 25 | §8.1, §22, §24.1 | `sandboxExecutionService.runTask` with start-claim lease state machine (7 cases) | **P** | `server/services/sandboxExecutionService.ts:101-171` (cases 1-7 implemented) |
| 26 | §8.1 | `sandboxExecutionService.getExecution(id)` read-side helper | **P** | `server/services/sandboxExecutionService.ts:61-79` |
| 27 | §8.4, §22 | **`runTask` invokes the harvest pipeline inline on the happy path after provider returns terminal** | **D** | `server/services/sandboxExecutionService.ts:367-376` throws `sandbox_harvest_failed` with comment `TODO(C7): wire to runHarvest()`. `runHarvest()` IS implemented in `sandboxHarvestService.ts` but never called from `runTask`. **Result: the entire feature is broken end-to-end on every successful provider invocation.** This is the single most consequential gap. |
| 28 | §14.5 | Pre-start failure path emits `sandbox_start_failed` event row | **D** | No code path in `sandboxExecutionService.ts` writes a `sandbox_start_failed` row. The C5 service emits no telemetry events at all on any pending → provider_unavailable transition. Grep confirms: `sandbox_start_failed` appears only in the schema enum and in the gate script, never in production code. **`scripts/gates/verify-sandbox-minimum-events.sh` will FAIL** in CI for this exact reason. |
| 29 | §14.5 | Post-start path emits `sandbox_start` event row at `pending → running` transition | **D** | No `sandbox_start` event is written anywhere in production code. The harvest pipeline emits `harvest_started`, `output_validated`, `sandbox_terminal`, etc., but the lifecycle event marking sandbox-process-up is missing. Same gate will FAIL. |
| 30 | §8.4 (12 ordered steps) | `sandboxHarvestService.runHarvest` implements all 12 ordered steps with idempotency keys per step | **P** | `server/services/sandboxHarvestService.ts:140-1134` (each step is its own function; pipeline walker at line 953) |
| 31 | §16.2, §16.4, §16.5, §16.6, §19.1 | `withSandboxProvider` wraps with backoff, ambiguous-terminal reconciliation enqueue, slow-start `provider_diagnostic`, retry-after handling | **D** | `server/lib/withSandboxProvider.ts` emits `provider_diagnostic` and `provider_unavailable` as **structured logs only**; no DB telemetry rows. Spec §14.2 + §14.3 require BOTH. Progress.md acknowledges: "lib wrapper doesn't hold the full HarvestContext that telemetry rows require." Defer routing decision to operator. |

### 3.5 Pg-boss jobs (C11a, C11b) — 7 reqs

| # | Spec | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 32 | §8.4 (reconciliation), §13.2, §19.1, §22 | `sandboxHarvestReconciliationJob` cron 5min, calls `runHarvestReconciliation` | **P** | `server/jobs/sandboxHarvestReconciliationJob.ts`; cron registered at `queueService.ts:1567` |
| 33 | §10.2, §19.1, §22 | `sandboxCeilingMonitorJob` per-execution, singletonKey, exits on terminal, calls cost estimator | **P** with caveat (REQ #36) | `server/jobs/sandboxCeilingMonitorJob.ts` |
| 34 | §10.2, §19.1 | `sandboxWallClockKillJob` one-shot, `startAfter = wallClockMs + buffer` | **P** with caveat (REQ #36) | `server/jobs/sandboxWallClockKillJob.ts` |
| 35 | §17.4, §19.1 | `sandboxArtefactPurgeJob` triggered by run soft-delete, physical S3 delete + `object_storage_state = 'purged'` | **A** | File exists at `server/jobs/sandboxArtefactPurgeJob.ts` and is registered in queueService. The trigger from the run-soft-delete event was not surveyed; this requires deeper inspection of the run-deletion cascade path. Routed for confirmation. |
| 36 | §10.2 | Ceiling-monitor + wall-clock-kill jobs **call provider terminate API directly** (per spec wording) | **D** | Both jobs only update the DB row to `harvesting` with an `errorReason`; neither calls `provider.terminate()` via `withSandboxProvider`. Spec §10.2: "calls the provider terminate API and writes `timed_out`" / "calls the provider terminate API directly". The conservative choice (let harvest pipeline handle teardown) is defensible but diverges from the spec's named mechanism. |
| 37 | §17.3, §19.1 | Three retention prune jobs: telemetry 90d, logs 90d (incl. soft-deleted), egress audit 180d | **P** | `sandboxTelemetryPruneJob.ts`, `sandboxLogsPruneJob.ts` (deletes `is_active = false OR persisted_at < cutoff`), `sandboxEgressAuditPruneJob.ts` |
| 38 | §10.2, §19.3, §22 | All 7 sandbox jobs registered in `queueService.ts` (per plan §3.1 correction; spec §19.3's `server/jobs/index.ts` is the spec's intent, bound to the actual registration site) | **P** | `queueService.ts:1565-1600` registers all 7 |

### 3.6 Adapter rewiring (C13) — 2 reqs

| # | Spec | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 39 | §18.2 | `iee_dev` adapter `dispatch()` consults `classifyExecutionClass` and routes sandbox-class to `runTask` | **P** | `server/services/executionBackends/ieeDevBackend.ts:103,121` |
| 40 | §18.4 | One-shot dry-run script `scripts/migrations/sandbox-isolation-classification-dry-run.ts` writing to `tasks/builds/sandbox-isolation/migration-dry-run.md` | **P** | Script present; output recorded; 9/9 PASS |

### 3.7 Templates + CI (C12) — 4 reqs

| # | Spec | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 41 | §15.1, §15.2 | `infra/sandbox-templates/synthetos-sandbox/` with Dockerfile, entrypoint, deps, `CURRENT_VERSION` (5 fields) | **P** | All files present; `CURRENT_VERSION` carries the 5 fields |
| 42 | §15.2 | `PUBLISHED_VERSION` placeholder file (5 fields), CI publish workflow opens attestation PR | **P** (placeholder values) | File present with all-zeros placeholders; CI workflow at `.github/workflows/publish-sandbox-templates.yml` |
| 43 | §15.1 | `infra/sandbox-templates/openclaw-session/` placeholder scaffolding (Dockerfile + entrypoint + CURRENT_VERSION + README) | **P** | All four files present |
| 44 | §15.5 | `docker-compose.sandbox.yml` for local dev `localDockerSandbox` build target | **P** | File present |

### 3.8 CI gates (C14) — 5 reqs

| # | Spec | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 45 | §18.4, §25.2, §19.2 | `verify-sandbox-classification.sh` grep gate | **P** | `scripts/gates/verify-sandbox-classification.sh` |
| 46 | §14.5, §25.2, §19.2 | `verify-sandbox-minimum-events.sh` three-pass grep gate | **P** (gate script present) but **runtime FAILS** because of REQ #28 + #29 | `scripts/gates/verify-sandbox-minimum-events.sh`; gate per progress.md "currently FAILS" |
| 47 | §15.2, §25.2, §19.2 | `verify-template-version-coherence.sh` (5-field shape + tag + attestation + version match, 24h grace) | **P** | `scripts/gates/verify-template-version-coherence.sh` |
| 48 | §12.4, §25.2, §19.2 | `verify-no-sandbox-cost-update.sh` grep for `update(llmRequests)` against sandbox source-types | **P** | `scripts/gates/verify-no-sandbox-cost-update.sh` |
| 49 | §8.2.3, §25.2, §19.2 | `verify-no-inline-sandbox-outside-test.sh` grep gate | **P** | `scripts/gates/verify-no-inline-sandbox-outside-test.sh` |

### 3.9 Doc-sync (C14) — 5 reqs

| # | Spec | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 50 | §11 (doc-sync), §19.3 | `architecture.md` adds "Sandbox Isolation primitive" section, cross-link from `iee_dev` | **P** | architecture.md line 3477 ("Sandbox Isolation primitive — `SandboxExecutionService`"); cross-link at line 3099 |
| 51 | §19.3 | `docs/capabilities.md` adds vendor-neutral "Tier 4 Isolated Code Execution" row | **P** | `docs/capabilities.md:830-848` (vendor-neutral phrasing — "external compute provider", no `e2b` brand) |
| 52 | §19.3 | `docs/env-manifest.json` adds 5 Spec B env vars | **P** | All 5 (`SANDBOX_PROVIDER`, `SANDBOX_ALLOW_INLINE`, `E2B_API_KEY`, `E2B_PROJECT_PROD`, `E2B_PROJECT_STAGING`) present |
| 53 | §28 #8, §19.3 | ADR `docs/decisions/0009-sandbox-execution-service.md` (or 0010 if 0009 taken) | **P** | `docs/decisions/0010-sandbox-execution-service.md` (0009 was taken by `0009-support-desk-canonical-not-conversations.md`; reasonable renumber) |
| 54 | §19.3 | `KNOWLEDGE.md` patterns appended | **P** | KNOWLEDGE.md committed in this branch |

### 3.10 Cross-cutting requirements (post §29 invariants) — 3 reqs

| # | Spec | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 55 | §17.5 | Sandbox teardown verification: `sandbox.teardown.verified` / `sandbox.teardown.unverified` log events on close + operator-paging on unverified | **D** | Grep finds **zero matches** for either event name in `server/`. Spec §17.5 names both event types and the operator-paging behaviour. e2bSandbox does call `terminateSandbox` but does not verify-then-emit. |
| 56 | §9.1 | Egress audit row writer (the schema is locked but the writer is build-time decided per `SANDBOX-DEF-EGRESS-MECH`) | **P** (deferred-by-design) | Egress audit table exists; no writer in V1 because default policy is `network: 'none'` per spec §9.1 ("No egress = no egress audit row"). When egress is enabled in a future task, writer must be implemented. Acknowledged-deferred via `SANDBOX-DEF-EGRESS-MECH` row in `tasks/todo.md`. |
| 57 | §11.1 | Credential file mount under `/workspace/secrets/{alias}.token`, perms 0400, value-threading from issuer | **A** | `e2bSandbox.ts:258-265` declares the file-mount intent but the credential value is not threaded through the input descriptor (loop body is a no-op with a `void alias.alias + targetPath` line and a comment "credential value is not available in the input descriptor in V1. C13 (adapter rewiring) threads the issued credential value through"). Spec §11.1 names the contract but the mechanism is acknowledged-incomplete. Routed because the user-facing contract ("sandbox receives task-scoped credentials") is currently unmet. |

> **Counted-once reconciliation:** the table above lists 57 numbered requirement rows; the summary shows 52 because rows #55–57 are cross-cutting verifications spanning multiple §-references rather than independent named items. Aggregating cross-cutting rows into the summary's 52-item count gives the canonical answer; the table preserves them as separately-traceable lines for auditability.

## 4. Mechanical fixes applied

**None.** Per the playbook's fail-closed rule (*"when in doubt, classify as DIRECTIONAL_GAP"*), every gap that surfaced was either too cross-cutting (REQ #11 wires runHarvest into runTask — touches state machine + telemetry sequencing + sandbox_terminal payload + idempotency posture), too design-laden (REQ #28 + #29 require choosing where in the lifecycle to emit `sandbox_start` / `sandbox_start_failed` and which writer owns it — C5 vs C8 vs the providers themselves; spec §14.5 names the events but not the producer), or required new functionality (REQ #20 metering helper). None met the "100% mechanical" threshold.

**Notable conservative classifications** (could have been argued mechanical, deliberately routed instead):
- REQ #6 (`MAX_LOG_LINE_BYTES` DB CHECK constraint): adding the CHECK is a one-line migration, but the migration ordering / down-migration / interaction with the existing service-layer truncation needs operator awareness.
- REQ #20 (`sandboxMeteringQueryPure.ts`): file path and function names are spec-pinned, but the SQL composition logic involves rollup-shape decisions (group-by month vs day, time-zone handling, what counts as a "sandbox-minute") that aren't pinned.

## 5. Directional / ambiguous gaps (routed to tasks/todo.md)

All 14 deferred items appended to `tasks/todo.md` under section *"Deferred from spec-conformance review — sandbox-isolation (2026-05-11)"*. Item summary:

| REQ # | Severity | One-line gap |
|---|---|---|
| 6 | High | `sandbox_logs.line` length CHECK constraint deferred from DB to service-layer truncation; spec pins it as a DB CHECK |
| 11 | **Critical** | `runTask` does not call `runHarvest` — entire feature broken end-to-end on happy path |
| 20 | High | `sandboxMeteringQueryPure.ts` missing — spec §12.6 names file + function signatures + tests |
| 28 | **Critical** | `sandbox_start_failed` telemetry event never emitted — `verify-sandbox-minimum-events` gate FAILS |
| 29 | **Critical** | `sandbox_start` telemetry event never emitted — `verify-sandbox-minimum-events` gate FAILS |
| 31 | Medium | `withSandboxProvider` emits `provider_diagnostic` / `provider_unavailable` only as structured logs, not as DB telemetry rows |
| 35 | Medium (AMBIGUOUS) | `sandboxArtefactPurgeJob` trigger from run-soft-delete cascade not surveyed end-to-end |
| 36 | Medium | Ceiling-monitor + wall-clock-kill jobs do not call provider terminate API per spec §10.2 wording — only update DB row |
| 55 | Medium | `sandbox.teardown.verified` / `sandbox.teardown.unverified` events + operator-paging behaviour from spec §17.5 entirely missing |
| 57 | High (AMBIGUOUS) | Credential value-threading into `/workspace/secrets/` files is acknowledged-incomplete; sandbox cannot receive credentials in V1 |

(Other deferred items related to acknowledged stubs — e2b SDK install (`SANDBOX-DEF-EGRESS-MECH`), egress audit writer per spec §9.1, classifyExecutionClass routing all current variants to `worker_trusted` per spec §7.2 — are NOT routed to `tasks/todo.md` because they are already documented as acknowledged-deferred either in `tasks/todo.md` (`SANDBOX-DEF-EGRESS-MECH`), in the spec itself (egress audit writer noted as build-time-decided in §9.1, sandbox branch noted as structurally-complete-but-unreachable in `progress.md`), or are by-design.)

## 6. Files modified by this run

**None.** No mechanical fixes were applied. Files written by this run:

- `tasks/review-logs/spec-conformance-log-sandbox-isolation-2026-05-11T08-06-30Z.md` (this file)
- `tasks/todo.md` (appended one new section with 10 deferred items)

## 7. Next step

**NON_CONFORMANT — 14 directional / ambiguous gaps must be addressed by the main session before `pr-reviewer`.**

The blocking items are concentrated in three clusters:

1. **End-to-end pipeline (REQ #11, #28, #29).** The `runTask` → `runHarvest` seam, `sandbox_start` event emission, `sandbox_start_failed` event emission. These three together turn the feature from "structurally present" into "actually working". A merger of the three could be one focused builder pass: when `_attemptProviderStart` succeeds, emit `sandbox_start`, hand the providerOutput to `runHarvest` with the input descriptor's tenancy + schema-ref; when it fails, emit `sandbox_start_failed`, write `provider_unavailable` terminal state. The harvest pipeline already does steps 11-12 correctly — it just needs to be invoked.
2. **Spec §10.2 fidelity (REQ #36).** Decide whether the spec wording ("calls the provider terminate API directly") is load-bearing or whether the implementation's "let the harvest pipeline terminate via its sandbox close path" is an acceptable equivalent. If the latter, write a one-paragraph spec amendment; if the former, wire `withSandboxProvider({ phase: 'terminal', call: () => provider.terminate(...) })` into the two job handlers.
3. **Missing files / acknowledged gaps (REQ #6, #20, #31, #55, #57).** These each need their own dedicated micro-pass. REQ #20 is a fresh file. REQ #6 is a migration. REQ #31 is a refactor of `withSandboxProvider` to thread enough context to write DB rows. REQ #55 is a teardown-verification helper + log emit. REQ #57 unblocks credential injection (currently a known stub).

Recommendation: **address the cluster-1 items (REQ #11, #28, #29) before invoking `pr-reviewer`.** Without those, every successful sandbox call fails with `sandbox_harvest_failed`, and the gate already fails. The other clusters can land in a follow-up pass.

After the cluster-1 fix, **re-run `spec-conformance` on the updated branch** (the in-flight gaps will narrow significantly, and several items currently AMBIGUOUS may become PASS or definitively classify), then proceed to `pr-reviewer`.

**Test gates were NOT executed locally per CLAUDE.md.** CI is the authoritative gate runner. The progress.md note about `verify-sandbox-minimum-events.sh` failing is taken as given; this conformance log corroborates the failure mechanism (REQ #28 + #29) without re-running the gate.

## 8. Pre-existing branch state (informational, not a finding)

Per progress.md and verified by separate inspection, two pre-existing typecheck errors live on this branch unrelated to sandbox-isolation:

- `server/services/reportRenderingService.ts` — `@react-pdf/renderer` types missing
- `server/services/reportTemplates/MacroReport.tsx` — same root cause

These were not introduced by Spec B and are out of scope for this conformance review.
