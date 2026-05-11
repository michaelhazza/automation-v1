**Status:** draft (architect output, awaiting plan-gate operator review)
**Plan date:** 2026-05-11
**Last updated:** 2026-05-11
**Author:** architect (Opus, feature-coordinator playbook)
**Build slug:** sandbox-isolation
**Spec:** `tasks/builds/sandbox-isolation/spec.md` (status `accepted`, 1679 lines, locked 2026-05-11)
**Branch:** `claude/evolve-sandbox-isolation-brief-Q51hc`

---

# Spec B — Sandbox Isolation: Implementation Plan

## Table of contents

1. Architecture notes
2. Model-collapse check
3. Open questions for plan-gate operator
4. Chunk overview + dependency graph
5. Per-chunk detail
   - C1a — Shared types + scaffolding
   - C1b — Five Drizzle schemas + three sandbox-table SQL migrations + manifest entries
   - C2 — `FailureReason` enum extension
   - C3 — `llm_requests` extension
   - C4 — Provider resolver + `inlineSandbox`
   - C5 — `SandboxExecutionService` skeleton + pure helpers
   - C6 — Output schema validation + redaction wiring
   - C7 — Harvest pipeline (12 ordered steps)
   - C8 — `withSandboxProvider` wrapper
   - C9 — `e2bSandbox` provider
   - C10 — `localDockerSandbox` provider
   - C11a — Execution-scoped pg-boss jobs
   - C11b — Retention-scoped pg-boss jobs
   - C12 — Template Dockerfile + CI publish pipeline + version parser
   - C13 — `iee_dev` adapter rewiring + classification helper
   - C14 — CI gates + doc-sync (closes the build)
6. Risks and mitigations
7. Executor notes

---

## 1. Architecture notes

### 1.1 How the spec lands in this codebase

Spec B introduces a sandbox-execution primitive (`SandboxExecutionService`) that sits below Spec A's `ExecutionBackend` adapter contract and above the e2b / Docker / inline provider layer. The spec is unusually well-resolved going into Phase 2: it has been through 4 spec-reviewer iterations, 3 ChatGPT review rounds (30 findings, all closed), a SynthetOS v1.2 master-architecture alignment pass, and 20 explicit locked decisions (handoff §"Decisions made in Phase 1"). The architect's job is to translate the locked surface into builder-session-sized chunks, not to re-litigate.

The lift breaks cleanly into five layers, each mapped to existing primitives:

- **Schema layer** — five new RLS-protected tables (`sandbox_executions`, `sandbox_artefacts`, `sandbox_telemetry_events`, `sandbox_egress_audit`, `sandbox_logs`), plus six nullable columns + two new `source_type` enum values + a CHECK-constraint extension + two partial unique indexes on the existing `llm_requests` table. Four SQL migrations (per spec §19.4) cover this. The schema layer is leaf — no service imports, no cross-module coupling — so it lands first.
- **Pure-helper layer** — three pure modules (`sandboxExecutionServicePure.ts`, `sandboxHarvestServicePure.ts`, `sandboxMeteringQueryPure.ts`) plus one adapter-side helper (`ieeDevBackendPure.ts`'s new `classifyExecutionClass` function) plus the template-version parser (`templateVersionParserPure.ts`). All pure tests run against these — no DB, no network, no provider SDK.
- **Provider-implementation layer** — three implementations of the `SandboxExecutionService` interface (`e2bSandbox`, `localDockerSandbox`, `inlineSandbox`) plus the resolver (`sandboxProviderResolver`) and the wrapper (`withSandboxProvider`). The interface itself is a thin TypeScript shape; the implementations carry the SDK / Docker / in-process specifics.
- **Service layer** — the orchestrator (`sandboxExecutionService.ts`), the harvest pipeline (`sandboxHarvestService.ts`), and seven pg-boss jobs that own the async paths (reconciliation, ceiling monitor, wall-clock kill, four prune/purge variants).
- **Infrastructure / CI layer** — the template Dockerfiles, the CI publish workflow, the `CURRENT_VERSION` / `PUBLISHED_VERSION` two-file split, five new CI grep gates, and the `iee_dev` adapter rewiring + dispatch-classification dry-run script.

### 1.2 Architectural decisions inherited from the spec (no re-litigation)

The spec locks 20 architectural decisions (handoff §"Decisions made in Phase 1"). These are non-negotiable inputs to this plan. The architect did not find any decision that needs re-opening. Specifically locked:

1. Vendor-adapter pattern (three implementations behind one interface).
2. Closed terminal-state taxonomy (8 states; spec §13.1).
3. Hard-cut migration for `iee_dev` (no feature flag; spec §18.1).
4. Pure-tests-only + 5 new CI grep gates (spec §25).
5. `sandbox_logs` is a dedicated table (Round 1 F1, spec §20.8).
6. Cost ceiling enforcement via upper-bound estimator (Round 1 F2, spec §10.2).
7. Start-claim lease model on `sandbox_executions` (Round 1 F3, spec §8.1).
8. Organisation-boundary RLS at policy layer + subaccount filtering at service layer (Round 1 F4, spec §21).
9. Two-job ceiling monitor (Round 1 R2, spec §10.2).
10. `CURRENT_VERSION` + `PUBLISHED_VERSION` two-file split (Round 2 F2, spec §15.2).
11. `max_cost_cents_per_second` part of `CURRENT_VERSION` contract (Round 2 F3, spec §15.2).
12. `llm_requests` is the single canonical cost-ledger target (spec §12.1).
13. Append-only / correction-row cost ledger (no UPDATE; spec §12.4 + `verify-no-sandbox-cost-update` gate).
14. Inline `inlineSandbox` is test-only with hard guard (spec §8.2.3 + `verify-no-inline-sandbox-outside-test` gate).
15. Provider unavailability fails closed (no silent fallback; spec §16).
16. Output contract is exactly four `/workspace/` paths (spec §8.3).
17. Harvest pipeline is 12 ordered idempotent steps (spec §8.4).
18. Egress audit table is shipped day-1 even though V1's default policy is `network: 'none'` (spec §28 #3).
19. `correction_sequence` integer for ordered cost-correction rows (spec §12.3 + §24.1).
20. Spec C coordination: B owns `sandbox_compute` + `sandbox_compute_correction` enum values; C owns `subscription_mediated`. First to land defines the shared `redaction.ts` bundle.

### 1.3 Independent architectural reading — confirmations

- **Service / route / lib tier boundaries (DEVELOPMENT_GUIDELINES §2):** Spec B introduces no new HTTP routes in V1. The new services (`sandboxExecutionService`, `sandboxHarvestService`) are called by adapters and jobs only. All DB writes are mediated by services using `withOrgTx` / `getOrgScopedDb`. The `verify-rls-contract-compliance` gate already enforces this for the new code paths automatically.
- **Schema files are leaves (DEVELOPMENT_GUIDELINES §3):** All five new schema files (`sandboxExecutions.ts`, `sandboxArtefacts.ts`, `sandboxTelemetryEvents.ts`, `sandboxEgressAudit.ts`, `sandboxLogs.ts`) only import `drizzle-orm` + sibling schemas + `shared/types/sandbox.ts`. No service / lib / route imports.
- **Soft-delete pattern:** `sandbox_executions`, `sandbox_artefacts`, `sandbox_logs` carry `is_active` (DEVELOPMENT_GUIDELINES §3 references `deletedAt` but spec §20 uses `is_active boolean`). The plan adopts the spec's `is_active` shape — joins use `isActive(table)` from `server/lib/queryHelpers.ts` (existing primitive). No partial unique index over a soft-deletable column needs the `AND deleted_at IS NULL` guard because the only partial unique indexes are scoped on `source_type` (immutable, not soft-deletable).
- **§8.18 terminal-state assertion:** spec §24.7 declares the `sandbox_executions.status` set as closed and pins the valid transitions. The `assertValidTransition` helper from `shared/stateMachineGuards.ts` (existing primitive) wraps every terminal-status UPDATE in `sandboxHarvestService` step 12. This is captured in C7's per-step contract.
- **§8.31 non-durable async comment:** every `void promise.catch(...)` introduced in C7 carries the explicit-durability comment per the rule. There are no expected fire-and-forgets in the planned services — the harvest pipeline is `await`-ed end-to-end inside `runTask`.

### 1.4 Prerequisites the plan consumes that don't yet exist

None blocking. Every primitive cited in spec §6 is verified-extant via filesystem search:

- `server/lib/withBackoff.ts` — exists.
- `server/lib/redaction.ts` — exists; will be extended in C6 with sandbox-specific patterns.
- `server/lib/runCostBreaker.ts` — exists; not modified (spec §12.7 confirms the aggregate writer is source-type-agnostic).
- `server/lib/createWorker.ts` — exists; consumed by all 7 pg-boss jobs.
- `server/services/credentialBrokerService.ts` — exists; extended in C7's redaction-wiring boundary.
- `server/services/executionBackends/ieeDevBackend.ts` — exists; rewired in C13.
- `server/db/schema/llmRequests.ts` — exists (verified column shape: `sourceType: text('source_type').notNull()` at line 43; the spec's enum-extension is a permitted column-value addition rather than a `pgEnum` ALTER).
- `server/config/rlsProtectedTables.ts` — exists; extended in C1b.
- `shared/iee/failure.ts` — exists; extended in C2.
- `server/lib/queryHelpers.ts` — exists; provides `isActive(table)`.
- `shared/stateMachineGuards.ts` — exists per DEVELOPMENT_GUIDELINES §8.18 reference (consumed in C7).

### 1.5 Two minor file-inventory drifts identified

Surfaced as open questions (§3 below). Both are mechanical-fix corrections to the spec's §19 inventory, not architectural re-opens.

---

## 2. Model-collapse check

The model-collapse pre-check asks whether the work decomposes into ingest → extract → transform → render and could be replaced by one frontier-model call with structured output.

**Decision: reject collapse, with cause.**

Spec B is not an ingest/extract/transform/render pipeline. It is **infrastructure for executing untrusted code in an isolated runtime**. The critical path is:

1. The calling adapter produces a typed input descriptor (already structured — no extraction needed).
2. `SandboxExecutionService.runTask` starts an actual VM / container / process via the e2b SDK or Docker, not via an LLM.
3. The sandbox executes user / LLM-emitted code in an isolated runtime (the entire point of the feature is that this is NOT an LLM call — it is a real process boundary that protects the worker from customer-derived code).
4. The harvest pipeline reads exact files at fixed paths, validates against a Zod schema, redacts via deterministic regex patterns, and writes to RLS-protected tables.

No step in this pipeline is doing what a frontier multimodal model could do in one call. The frontier model has no replacement for: (a) the actual VM isolation boundary that prevents a malicious CSV from corrupting the worker process; (b) deterministic Zod validation and redaction; (c) the cost-ceiling enforcement loop; (d) RLS-enforced row writes; (e) the e2b template image that ships with pinned Python / pandas / pdfplumber. The model would be relevant if the work were "classify this CSV's schema" — but it is "run this customer-supplied script that parses the CSV in a runtime that cannot affect tenant B's data."

The only LLM-shaped touchpoint anywhere in Spec B is when sandboxed code itself calls the LLM router from inside the sandbox (§4.1 — egress to `llmRouter.routeCall`, recorded as a normal `agent_run` ledger row, not a `sandbox_compute` row). That is consumer behaviour, not infrastructure behaviour.

Collapse rejected. Implementation proceeds as a multi-chunk infrastructure build.

---

## 3. Plan corrections + remaining open questions

One file-inventory drift was identified during the architect's pass and resolved by plan correction (no operator decision needed). One remaining note is informational only.

### 3.1 Plan correction (no operator decision required): pg-boss job registration site

> Plan-review round 1 R4: previously open question. Resolved by plan correction.

Spec §19.3 says: "`server/jobs/index.ts` — Register the 7 new pg-boss jobs..." Filesystem inspection (`Glob server/jobs/*.ts`) confirms there is no `index.ts` in `server/jobs/`. The actual registration site is `server/services/queueService.ts` (worker handlers register via `boss.work(...)`; cron schedules register at lines 1144-1195 via `boss.schedule(...)`). The pattern is: each job module exports a handler function (e.g., `runMemoryDecay` in `server/jobs/memoryDecayJob.ts`); `queueService.ts` imports and registers it.

**Plan correction:** bind the spec's job-registration intent to the actual codebase registration site, `server/services/queueService.ts`. No new `server/jobs/index.ts` is created. C11a and C11b's "Files to create or modify" sections list `server/services/queueService.ts` (MODIFY) — this is the authoritative registration site. The spec's §19.3 reference to `server/jobs/index.ts` is treated as canonical *intent* (a single place where jobs are registered) bound to the actual file. The operator is informed; no decision is required from the plan-gate. If the spec text is later updated for accuracy, that is a one-line spec amendment that does not affect this plan or its chunks.

### 3.2 Spec uses `is_active` boolean for soft-delete; codebase convention is `deletedAt` timestamp per DEVELOPMENT_GUIDELINES §3

Spec §20.3 declares `sandbox_executions.is_active boolean` as the soft-delete column; spec §20.4 (`sandbox_artefacts`) and §20.8 (`sandbox_logs`) repeat this. DEVELOPMENT_GUIDELINES §3 says "soft delete pattern: use `deletedAt`, always filter with `isNull(table.deletedAt)`" — though the development-discipline rule §8.27 names `isActive(table)` as the canonical soft-delete filter helper, which suggests both column shapes coexist in the codebase.

Verification: `isActive(table)` exists in `server/lib/queryHelpers.ts` (confirmed). The helper accepts any table with either an `is_active` boolean OR a `deleted_at` timestamp. The codebase has both shapes for historical reasons.

**Architect's recommendation:** use the spec's `is_active boolean` shape because the spec is locked and the adjacent run-deletion cascade described in spec §17.4 expects boolean semantics (`is_active = false` on soft-delete event; physical row stays). Wrapping reads in `isActive(table)` keeps the call sites uniform with the rest of the codebase. No drift.

**Operator decision needed:** none — proceed with the spec's `is_active` shape. Surfaced for visibility because it differs from the `deletedAt` style some recent migrations use.

---

## 4. Chunk overview + dependency graph

### 4.1 Architect's read of spec §23's 14-chunk pre-plan

Spec §23 declares 14 chunks (C1-C14). Independent architect's review against the ≤5-files / ≤1-logical-responsibility constraint (CLAUDE.md / writing-plans skill):

- **C1 (types + 5 schemas + 4 SQL migrations + manifest entries) is over the file limit.** The spec's C1 covers `shared/types/sandbox.ts` + 5 Drizzle schemas + 3 sandbox-table SQL migrations + manifest updates ≈ 10 files. **Split into C1a and C1b.**
- **C11 (7 pg-boss jobs) is over the file limit and over the logical-responsibility limit.** Two distinct lifecycles bundled (execution-scoped jobs that act on a sandbox in flight versus retention/cleanup jobs that sweep by date). **Split into C11a and C11b.**
- **All other chunks (C2, C3, C4, C5, C6, C7, C8, C9, C10, C12, C13, C14) honour the limits.** No further splitting needed. Some are large by file count (C7's harvest pipeline) but stay within one logical responsibility bound by transactional / pipeline cohesion.

**Final chunk count: 16** (C1a, C1b, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11a, C11b, C12, C13, C14).

The plan honours the spec §23.1 dependency graph: every original C1 → CN edge becomes (C1a → CN AND/OR C1b → CN) per concrete dependency, every C11 → CN edge becomes (C11a → CN AND/OR C11b → CN). No new backward edges introduced.

### 4.2 Dependency graph (final)

```
                   C1a  ──┬─►  C2  ──►  C5  ──►  C6  ──►  C7  ──┬─►  C11a ─┐
                          │           ▲           ▲     │       │           │
                          │           │           │     ▼       │           │
                          ├─►  C3  ──►C7          │     C8  ──►  C9 ────────┤
                          │                       │     │       ▲           │
                          │                       │     │       │           │
                   C1b  ──┼───────────►C5         │     │     C10 ──────────┤
                          │                       │     │       │           │
                          ├─►  C4  ──►  C5        │     │       │           │
                          │                       │     │       │           │
                          │                       │     │       │       C11b┤
                          │                       │     │       │           │
                          └─►  C12 ───────────────┴─────┴───────┴────►  C13 ─►  C14
```

ASCII rendering of the same graph in linear form (predecessor → successor):

```
C1a → C2, C3, C4, C12
C1b → C2, C5, C7, C11a, C11b       (schemas needed before any service compiles or writes them; C5 imports inferred row types from C1b — F1 fix, plan-review round 1)
C2  → C5, C8                       (FailureReason needed for service surfaces)
C3  → C7                           (llm_requests extension needed for harvest step 10)
C4  → C5                           (provider resolver consumed by service skeleton)
C5  → C6, C8, C9, C10, C13         (service skeleton consumed by everything below)
C6  → C7                           (output schema validation + redaction wiring consumed by harvest)
C7  → C11a                         (harvest API consumed by reconciliation job)
C8  → C9, C10, C11a                (provider wrapper consumed by both providers + monitor jobs; C8 declares the lightweight enqueue seam, C11a wires the concrete job — F2 fix, plan-review round 1)
C9  → C11a, C13                    (e2b provider consumed by ceiling monitor + adapter)
C10 → C11a, C13                    (local docker provider consumed by monitor + adapter local-dev path)
C11a → C14                         (execution-scoped jobs in place before final gates)
C11b → C14                         (retention jobs in place before final gates)
C12 → C9, C10, C11a, C13, C14      (template + parser needed for template_digest resolution in C9, parity-doc surface in C10, cost-rate consumption in C11a, adapter pinning in C13, version-coherence gate in C14 — F3 fix, plan-review round 1)
C13 → C14                          (adapter rewiring complete before classification gate runs over final shape)
C14 → (terminal — closes the build)
```

Notes:

- **C1a → C2 vs C1b → C2:** the FailureReason enum extension in C2 imports `shared/types/sandbox.ts` from C1a (not the schemas from C1b), so the only hard edge is `C1a → C2`. C1b is parallel.
- **C12's role:** C12 (template Dockerfile + CI publish + `CURRENT_VERSION` / `PUBLISHED_VERSION` + `templateVersionParserPure.ts`) is largely parallelisable. It depends only on C1a (for shared-types references) and itself blocks C11a (which reads `max_cost_cents_per_second` from `CURRENT_VERSION` for the cost-fallback estimator) and C13 (which refuses `template_version === 'latest'` per spec §15.3).
- **No backward dependencies.** Every CN's prerequisites are in chunks numbered ≤ N (for the C1-C14 spine; C1a/C1b/C11a/C11b are sub-numbers of their parent).

### 4.3 Cross-chunk invariants (from spec §23.2, preserved)

- `classifyExecutionClass` is owned by `ieeDevBackendPure.ts` (built in C13) — adapter-specific. C5's pure module does not implement this.
- C11a's jobs depend on C7's harvest API. C7 must lock the public surface before C11a starts.
- C14's CI gates are written last (grep against the final code shape).

### 4.4 Chunk overview table

| Chunk | Scope (one line) | Files (count) | Depends on |
|---|---|---|---|
| **C1a** | Shared types — `shared/types/sandbox.ts` (input descriptor, output, terminal-state enum, policy schema) + `tasks/current-focus.md` BUILDING transition. (OpenClaw template scaffolding moved to C12 — F4 fix, plan-review round 1.) | 2 | (none) |
| **C1b** | Five Drizzle schemas + schema-index re-export + three SQL migrations creating sandbox tables + RLS policies + `rlsProtectedTables.ts` manifest entries (TypeScript, same chunk / same commit as the migration). NO `llm_requests` extension (that is C3). Paired `.down.sql` files are excluded from the file count. | 10 | C1a |
| **C2** | `FailureReason` enum extension in `shared/iee/failure.ts` (+ 8 sandbox values). | 1 | C1a |
| **C3** | `llm_requests` schema extension + one SQL migration: 6 nullable columns, 2 new `source_type` values, CHECK extension, 2 partial unique indexes. | 2 | C1a |
| **C4** | Provider resolver (with registration seam — F1 fix, plan-review round 2) + `inlineSandbox` test-only implementation + hard guards. All `docs/env-manifest.json` updates consolidated into C14 (R2 fix, plan-review round 2). | 2 | C1a, C2 |
| **C5** | `SandboxExecutionService` skeleton + pure helpers (`classifyTerminal`, `resolveSandboxCeilings`, policy → provider-flags mapping). Pure tests for the helpers. | 3 | C1b, C2, C4 |
| **C6** | Output schema validation + redaction wiring scaffolds in `sandboxHarvestServicePure.ts` + `redaction.ts` extension (sandbox patterns). Pure tests for `composeRedactionPatternSet`. | 2 | C5 |
| **C7** | Harvest pipeline `sandboxHarvestService.ts` (all 12 steps) + extension to `credentialBrokerService.ts` issuance return shape. Pure-helper tests are added to C6's `sandboxHarvestServicePure.test.ts` (R5 fix, plan-review round 1). | 2 | C3, C6, C1b |
| **C8** | `withSandboxProvider` provider-call wrapper + `server/lib/sandboxJobNames.ts` (canonical sandbox queue-name constants) + ambiguous-terminal reconciliation enqueue-by-job-name (concrete pg-boss handler registration lands in C11a). | 2 | C2, C5 |
| **C9** | `e2bSandbox` provider implementation. Reads `template_digest` from C12's `PUBLISHED_VERSION` via `templateVersionParserPure.ts`. | 1 | C5, C8, C12 |
| **C10** | `localDockerSandbox` provider implementation. Reads template version from C12 (parity-doc surface + local-dev pin format). | 1 | C5, C8, C12 |
| **C11a** | Execution-scoped pg-boss jobs: harvest reconciliation (concrete registration of the enqueue seam declared in C8), ceiling monitor, wall-clock kill, artefact purge. Registered in `server/services/queueService.ts`. | 5 | C7, C8, C9, C10, C12 |
| **C11b** | Retention-scoped pg-boss jobs: telemetry prune, logs prune, egress audit prune. Registered in `queueService.ts`. | 4 | C1b |
| **C12** | Template Dockerfile + entrypoint + dependencies + `CURRENT_VERSION` / `PUBLISHED_VERSION` two-file split + `templateVersionParserPure.ts` + `docker-compose.sandbox.yml` + CI publish workflow + `infra/sandbox-templates/synthetos-sandbox/README.md` + OpenClaw placeholder Dockerfile / entrypoint / CURRENT_VERSION + README (inert scaffolding owned by OpenClaw adapter spec). Intentional ≤1-logical-responsibility chunk (template-build infrastructure); see C12 detail for justification. | ≈14 | C1a |
| **C13** | `iee_dev` adapter rewiring — `ieeDevBackend.ts` `dispatch()` rewrite + new `ieeDevBackendPure.ts` with `classifyExecutionClass` + pure tests + sequencing dry-run script. | 4 | C5, C9, C10, C12 |
| **C14** | Five CI grep gates + doc-sync (`architecture.md`, `docs/capabilities.md`, `docs/env-manifest.json`, optional `docs/decisions/0009-sandbox-execution-service.md`). Intentional ≤1-logical-responsibility chunk (build-closeout sweep); see C14 detail for justification. | 9 | C1a..C13 |

**Total file count across all chunks:** ≈ 56 new or modified files (C8 + 1 new constants module per F4; C4 −1 modify per R2; C12 +2 OpenClaw README + count revision per R1; net delta from Round 2 ≈ +2 vs Round 1's ≈55, within the spec §19 inventory tolerance).

---

## 5. Per-chunk detail

### Chunk C1a — Shared types + scaffolding

**`spec_sections:`** [§4 (framing), §8.1 (interface input/output), §13.1 (terminal states), §15.1 (template directory layout), §19.1, §20.1, §20.2]

**Files to create or modify:**

- `shared/types/sandbox.ts` — NEW. Production code consumed by adapters + harvest + UI in future phases.
- `tasks/current-focus.md` — MODIFY. Status BUILDING in flight (housekeeping; spec §19.3 lists this).

> Plan-review round 1 F4: OpenClaw placeholder scaffolding (`Dockerfile`, `entrypoint.sh`, `CURRENT_VERSION`, `README.md`) was moved out of C1a and into C12 alongside `synthetos-sandbox` — template-build infrastructure is C12's logical responsibility. C1a no longer creates an `infra/sandbox-templates/openclaw-session/` directory; C12 does, when it writes the placeholder files.

**Module shape:**

- *Public interface this chunk exposes:* one TypeScript module exporting the eight types + enums callers consume across the spec — `SandboxRunTaskInput`, `SandboxRunTaskOutput`, `SandboxTerminalState` (closed string union of 8 values), `SandboxPolicy` (network mode + filesystem + ceilings + artefact limits + input limits + provider thresholds + `allowRuntimeInstall: false` literal in V1), `SandboxNonTerminalStatus` (`pending | running | harvesting`), `SandboxProviderName` (`e2b | local_docker | inline`), `CredentialIssuanceContext`, `SandboxArtefactRef`. Each type is documented with a one-paragraph JSDoc citing the spec section that pins its shape.
- *What stays hidden behind it:* nothing — `shared/types/sandbox.ts` is a pure types module by design. Helpers belong in `*Pure.ts` files in the service layer (C5, C6).

**Contracts:**

- `SandboxRunTaskInput` — exact shape from spec §20.1 example, every required field typed, optional fields marked optional. The `policy` sub-shape is its own type; the `credentialIssuanceContext.aliases` array carries `{ alias, connectionId, scope, expectedDurationMs }` per element.
- `SandboxRunTaskOutput` — exact shape from spec §20.2. Required fields: `sandboxExecutionId`, `terminalState`, `output | null`, `artefactRefs[]`, `logRefs`, `metrics`, `costCents`, `templateName`, `templateVersion`, `provider`. `output` is `null` for non-`completed` terminal states.
- `SandboxTerminalState` — exact closed union of the 8 strings in spec §13.1: `'completed' | 'timed_out' | 'cost_ceiling_hit' | 'crashed' | 'output_validation_failed' | 'harvest_failed' | 'artefact_upload_failed' | 'provider_unavailable'`.

**Error handling strategy:** N/A — types module has no runtime surface.

**Testing requirements:** none. Pure types compile-test via `npm run typecheck` only.

**Acceptance criteria:** `npm run lint` + `npm run typecheck` pass; `tasks/current-focus.md` reflects BUILDING status. (`infra/sandbox-templates/openclaw-session/` scaffolding lands in C12, not here.)

---

### Chunk C1b — Five Drizzle schemas + three sandbox-table SQL migrations + RLS-protected-tables manifest update

> **File-count posture:** the plan's chunk-overview table shows 10 files for C1b. Paired `.down.sql` migration files are excluded from the count by convention (one logical migration per up/down pair). The 10 = 5 Drizzle schemas + `schema/index.ts` re-export + 3 `.up` SQL migrations + `server/config/rlsProtectedTables.ts`. The chunk stays inside the ≤1-logical-responsibility OR-clause of the chunk-size rule (one cohesive responsibility: stand up the five RLS-protected sandbox tables together so the manifest, schema, and migration land atomically).


**`spec_sections:`** [§14.1, §17.3, §17.4, §19.1, §19.4, §20.3, §20.4, §20.5, §20.6, §20.8, §21.1, §24.1]

**Files to create or modify:**

- `server/db/schema/sandboxExecutions.ts` — NEW. Drizzle schema for `sandbox_executions` table including the F3 lease columns.
- `server/db/schema/sandboxArtefacts.ts` — NEW. Drizzle schema for pointer rows.
- `server/db/schema/sandboxTelemetryEvents.ts` — NEW. Drizzle schema for the closed-event-type telemetry table.
- `server/db/schema/sandboxEgressAudit.ts` — NEW. Drizzle schema for per-egress-decision rows.
- `server/db/schema/sandboxLogs.ts` — NEW. Drizzle schema for redacted per-line log rows.
- `server/db/schema/index.ts` — MODIFY. Re-export the five new schemas.
- `migrations/XXXX_create_sandbox_executions.sql` — NEW. Build-time-numbered migration. `CREATE TABLE sandbox_executions` + 22 columns (per spec §20.3) + indexes (PK; `(organisation_id, started_at DESC)`; `(subaccount_id, started_at DESC)`; `(run_id)`; partial on `status` for reconciliation; partial on `provider_sandbox_id`) + 4 CHECK constraints (spec §20.3) + RLS policy (org-boundary, three-layer-fail-closed shape from architecture.md §1675). Paired `.down.sql` with defensive `IF EXISTS`. **Same chunk / same commit:** the `server/config/rlsProtectedTables.ts` manifest entry for `sandbox_executions` is appended in this chunk (TypeScript file, not inside the SQL migration).
- `migrations/XXXX_create_sandbox_artefacts_telemetry_logs.sql` — NEW. `CREATE TABLE` for all three tables in one file (per spec §19.4 — atomic landing). Indexes including `UNIQUE (sandbox_execution_id, log_stream, sequence)` on `sandbox_logs`, `UNIQUE (sandbox_execution_id, filename)` on `sandbox_artefacts`, `UNIQUE (sandbox_execution_id, sequence)` on `sandbox_telemetry_events`. RLS policies (all org-boundary). Paired `.down.sql`. **Same chunk / same commit:** three matching `rlsProtectedTables.ts` entries (one per table) are appended in this chunk.
- `migrations/XXXX_create_sandbox_egress_audit.sql` — NEW. `CREATE TABLE sandbox_egress_audit` + indexes + RLS policy. Paired `.down.sql`. **Same chunk / same commit:** matching `rlsProtectedTables.ts` entry appended in this chunk.
- `server/config/rlsProtectedTables.ts` — MODIFY. Append five new entries (one per new table) per spec §19.3 + §21.1. This is the TypeScript application manifest; it lives outside the SQL migration files. The invariant is "same chunk / same commit", not "literally inside the SQL migration".

**Module shape:**

- *Public interface this chunk exposes:* five Drizzle table objects + their inferred row types (`SandboxExecutionRow`, `SandboxArtefactRow`, `SandboxTelemetryEventRow`, `SandboxEgressAuditRow`, `SandboxLogRow`), and the `RLS_PROTECTED_TABLES` extension that allows the existing `verify-rls-coverage.sh` gate to pick them up automatically.
- *What stays hidden behind it:* the three SQL migrations are append-only DDL; nothing imports them at runtime. Indexes, CHECK constraints, RLS policies, and the manifest registry hide schema-shape decisions behind one Drizzle export per table.

**Contracts:**

- All five table shapes per spec §20.3 / §20.4 / §20.5 / §20.6 / §20.8. Column types follow the existing schema convention (text for strings, uuid for UUIDs, jsonb for JSONB, integer for counters, timestamptz for timestamps, decimal for money).
- RLS policies are the canonical org-isolation shape from architecture.md §1675. `FORCE ROW LEVEL SECURITY` enabled; policy enforces `organisation_id = current_setting('app.organisation_id')::uuid`.
- The four CHECK constraints on `sandbox_executions` exactly per spec §20.3:
  1. `CHECK status IN (...closed enum from §13.1...)` — the 8 terminal states + 3 non-terminal states.
  2. `CHECK (provider_sandbox_id IS NULL OR status <> 'pending')`.
  3. `CHECK (status NOT IN ('running', 'harvesting') OR provider_sandbox_id IS NOT NULL)`.
  4. `CHECK (start_attempt_count >= 0)`.

**Error handling strategy:**

- **Idempotency posture:** N/A for migrations themselves (Drizzle migration runner is idempotent on its registry); for the runtime row-shape, the unique constraints in §24.1 are what give idempotency.
- **Retry classification:** N/A.
- **Partial-success handling:** migrations are wrapped in transactions (Drizzle default); a failing CHECK or RLS policy aborts the migration cleanly.
- **Terminal-event guarantee:** N/A.

**Testing requirements:** none authored in this chunk. The existing CI gates (`verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`) automatically validate the new tables once the manifest entries are in place. CI runs these — local execution is forbidden.

**Acceptance criteria:** `npm run lint` + `npm run typecheck` + `npm run db:generate` (verify the three new migration files are picked up cleanly) all pass; the five new schema files type-check against `shared/types/sandbox.ts`; `RLS_PROTECTED_TABLES` lints with five new entries.

---

### Chunk C2 — `FailureReason` enum extension

**`spec_sections:`** [§6 (primitives), §13.2, §20.9]

**Files to create or modify:**

- `shared/iee/failure.ts` — MODIFY. Add 8 new `FailureReason` values exactly per spec §6 / §20.9: `sandbox_timeout`, `sandbox_cost_ceiling`, `sandbox_output_invalid`, `sandbox_harvest_failed`, `sandbox_artefact_upload_failed`, `sandbox_provider_unavailable`, `sandbox_credential_denied`, `sandbox_input_rejected`.

**Module shape:**

- *Public interface this chunk exposes:* the extended `FailureReason` union + any helper / discriminator the file already exports. Per DEVELOPMENT_GUIDELINES §8.13 (discriminated-union validators), any allow-list elsewhere in the file that switches on `FailureReason` is updated in the same commit.
- *What stays hidden behind it:* nothing — the file is one enum + helpers.

**Contracts:** the 8 new values map to states / surfaces per spec §20.9. `sandbox_input_rejected` is the only one that surfaces on `agent_runs.failure_reason` directly (pre-row failure path); the other 7 surface via DB telemetry rows + the calling run's failure trace.

**Error handling strategy:** N/A — additive enum extension.

**Testing requirements:** if `shared/iee/failure.ts` already has a paired `*.test.ts` covering the enum's switch-statement coverage, extend it with the 8 new values. Otherwise no new tests authored.

**Acceptance criteria:** `npm run lint` + `npm run typecheck` pass; any consumer that does an exhaustive switch over `FailureReason` (TypeScript will surface this as a compile error if `--strictNullChecks`-style exhaustive-check is in place) is updated in the same commit.

---

### Chunk C3 — `llm_requests` extension

**`spec_sections:`** [§12.2, §12.3, §12.4, §12.5, §19.4, §20.7, §24.1, §24.6]

**Files to create or modify:**

- `server/db/schema/llmRequests.ts` — MODIFY. Add 6 nullable columns: `sandbox_execution_id` (uuid), `sandbox_vcpu_seconds` (decimal), `sandbox_wall_clock_ms` (integer), `sandbox_provider` (text), `sandbox_template_version` (text), `correction_sequence` (integer). The existing comments documenting `sourceType` enum values are extended to include `'sandbox_compute'` and `'sandbox_compute_correction'`.
- `migrations/XXXX_extend_llm_requests_for_sandbox.sql` — NEW. Build-time-numbered. Three SQL operations:
  1. Add the 6 nullable columns to `llm_requests`.
  2. Extend the existing CHECK constraint (the one from migration `0185_llm_observability.sql`) to require: `WHEN source_type = 'sandbox_compute' THEN sandbox_execution_id IS NOT NULL AND sandbox_vcpu_seconds IS NOT NULL AND sandbox_wall_clock_ms IS NOT NULL AND sandbox_provider IS NOT NULL AND sandbox_template_version IS NOT NULL`; AND `WHEN source_type = 'sandbox_compute_correction' THEN sandbox_execution_id IS NOT NULL AND correction_sequence IS NOT NULL`.
  3. Add two partial unique indexes: `llm_requests_sandbox_execution_id_unique_idx ON llm_requests (sandbox_execution_id) WHERE source_type = 'sandbox_compute'` AND `llm_requests_sandbox_correction_sequence_unique_idx ON llm_requests (sandbox_execution_id, correction_sequence) WHERE source_type = 'sandbox_compute_correction'`.
- Paired `.down.sql` reverses operations in reverse order with defensive `IF EXISTS`.

**Module shape:**

- *Public interface this chunk exposes:* the extended `LlmRequestRow` Drizzle inferred type (now with the 6 nullable sandbox-* columns) + the partial unique indexes (consumed by `sandboxHarvestService` step 10 via DB-level catch on `23505`).
- *What stays hidden behind it:* the CHECK constraint's branch logic. Callers do not see this directly; they observe it as a 400 / 23514 if they try to insert a `sandbox_compute` row missing a required column. The harvest pipeline never violates this because the row shape is a single typed insert from spec §20.7.

**Contracts:**

- Row example exactly per spec §20.7.
- The text column for `source_type` continues as `text('source_type').notNull()` (verified at `server/db/schema/llmRequests.ts:43`); no `pgEnum` conversion. The new values `'sandbox_compute'` and `'sandbox_compute_correction'` are added by the application — not the DB. Spec C concurrently adds `'subscription_mediated'` per §26.2; both extensions append, no merge-blocking conflict.
- `correction_sequence` semantics: monotonically increasing integer per `sandbox_execution_id` for `sandbox_compute_correction` rows. Always NULL for `sandbox_compute` and all non-sandbox rows. Allocation strategy is determined in C7 (the cost-correction writer); the DB just enforces uniqueness.

**Error handling strategy:**

- **Idempotency posture:** key-based via the two partial unique indexes (spec §24.1 row "Cost row write" and "Cost correction row write").
- **Retry classification:** guarded — caller catches `23505` and reads back canonical via `getExecution` (spec §24.2 + §24.6).
- **Partial-success handling:** N/A — single-statement INSERT; either the row lands or it doesn't.
- **Terminal-event guarantee:** N/A at this layer; the row write is one of the harvest pipeline's terminal-event boundaries (C7 owns the sequencing).
- **Unique-constraint-to-HTTP mapping:** spec §24.6 — `23505` on `llm_requests(sandbox_execution_id) WHERE source_type='sandbox_compute'` is internal-only (no HTTP); harvest re-runs read back canonical. Also internal: `23505` on `llm_requests(sandbox_execution_id, correction_sequence) WHERE source_type='sandbox_compute_correction'` — caller (cost-correction job, future) re-allocates `correction_sequence` and retries.

**Testing requirements:** none authored at this chunk's layer (pure SQL / Drizzle schema). The existing `verify-rls-coverage.sh` gate continues to pass (no new RLS-protected table — `llm_requests` was already in the manifest). CI handles validation.

**Acceptance criteria:** `npm run lint` + `npm run typecheck` + `npm run db:generate` pass; the new migration applies cleanly against a fresh DB; the two partial unique indexes appear in the resulting schema.

---

### Chunk C4 — Provider resolver + `inlineSandbox`

**`spec_sections:`** [§8.2, §8.2.3, §19.1, §25.2 (gate enabling)]

> **Compile-order posture (registration-seam pattern):** C4 lands BEFORE C9 (`e2bSandbox`) and C10 (`localDockerSandbox`) exist as importable modules. To avoid the build breaking on missing imports, C4 must NOT statically import `e2bSandbox` or `localDockerSandbox`. C4 ships only: (a) `SANDBOX_PROVIDER` env-var validation, (b) the `SandboxProviderName` → constructor *type* / *registry seam*, (c) the `inlineSandbox` constructor wired inline. Concrete provider registration into the resolver lands in C9 (registers `e2bSandbox`) and C10 (registers `localDockerSandbox`) at module init via a small registration API exposed by C4 (e.g. `registerSandboxProvider('e2b', constructor)`). The resolver's runtime lookup happens at first call to `resolveSandboxProvider(env)`, by which time C9 / C10's modules have been imported by the application bootstrap. (F1 fix, plan-review round 2.)

**Files to create or modify:**

- `server/services/sandbox/sandboxProviderResolver.ts` — NEW. Reads `SANDBOX_PROVIDER` env var; validates the provider-name string; exposes the `registerSandboxProvider(name, constructor)` registration seam consumed by C9 / C10; resolves to the registered constructor at first call (or to `inlineSandbox` directly when `SANDBOX_PROVIDER === 'inline'`); applies environment-specific hard guards. **Hard ban: must NOT import `e2bSandbox` or `localDockerSandbox` (they don't exist yet at this chunk's compile time).**
- `server/services/sandbox/inlineSandbox.ts` — NEW. Test-only in-process implementation; throws at construction if `NODE_ENV !== 'test'` OR `SANDBOX_ALLOW_INLINE !== '1'`. Imported directly by the resolver (it lives in this chunk).

> **`docs/env-manifest.json` deferred to C14 (R2 fix, plan-review round 2):** all `docs/env-manifest.json` updates for Spec B — including this chunk's `SANDBOX_PROVIDER` (required, enum: `e2b | local_docker | inline`) and `SANDBOX_ALLOW_INLINE` (test-only flag) entries — are consolidated into C14's single env-manifest pass. No double-touch; the file is modified once, by C14, with all five Spec B env-vars (`SANDBOX_PROVIDER`, `SANDBOX_ALLOW_INLINE`, `E2B_API_KEY`, `E2B_PROJECT_PROD`, `E2B_PROJECT_STAGING`) added in one commit. C4 retains the env-var validation logic in code; the manifest documentation lands at the build-closeout sweep.

**Module shape:**

- *Public interface this chunk exposes:* `resolveSandboxProvider(env): SandboxExecutionService` factory + `registerSandboxProvider(name: SandboxProviderName, constructor: () => SandboxExecutionService): void` registration seam. The resolver is the only call site; the registration seam is consumed exclusively by C9 and C10 at their respective module-init time.
- *What stays hidden behind it:* the env-var parsing, the three-way validation switch, the in-memory provider registry (a typed `Map<SandboxProviderName, () => SandboxExecutionService>`), the hard-guard logic, the `inlineSandbox` implementation internals.

**Contracts:**

- `inlineSandbox` MUST throw if either guard fails. The throw is a `FailureError` with `FailureReason.sandbox_provider_unavailable` and a message naming the guard that fired (`'inlineSandbox is test-only — set NODE_ENV=test and SANDBOX_ALLOW_INLINE=1 to use'`). Boot-time fail-fast per spec §8.2.
- `local_docker` provider is rejected when `NODE_ENV === 'production'` (same throw shape). The rejection happens in the resolver's `SANDBOX_PROVIDER` validation, before the registry lookup — so no registered constructor for `local_docker` is invoked in production even if C10 has registered one.
- The `e2b` provider constructor is permitted in any environment (production, staging, local dev, test).
- If `resolveSandboxProvider` is called for a provider name that has not been registered (i.e., the application bootstrap forgot to import C9 / C10), the resolver throws a fail-fast `FailureError` with `FailureReason.sandbox_provider_unavailable` and a message `'sandbox provider <name> not registered — application bootstrap must import the provider module before resolveSandboxProvider() runs'`. This converts the "missing-import" failure mode from a silent latent bug to a boot-time crash.

**Error handling strategy:**

- **Idempotency posture:** N/A — pure construction, no DB writes.
- **Retry classification:** N/A — boot-time throws are fatal; caller does not retry.
- **Terminal-event guarantee:** N/A.
- **Boot-time throw vs runtime:** throws happen at module-resolution / construction time so a misconfigured deploy never starts the service. This is the spec §8.2 "fail-fast at construction" pattern.

**Testing requirements:** authored in this chunk:

- Pure test for `sandboxProviderResolver`: every `NODE_ENV` × `SANDBOX_PROVIDER` × `SANDBOX_ALLOW_INLINE` combination → expected resolver behaviour (returns instance vs throws). Vitest `expect()` API. File: `server/services/sandbox/__tests__/sandboxProviderResolverPure.test.ts`. Single-file local run via `npx vitest run server/services/sandbox/__tests__/sandboxProviderResolverPure.test.ts` is allowed.

**Acceptance criteria:** lint + typecheck pass; pure test covers all 18 env-combination cases; `inlineSandbox` correctly throws when constructed outside the test harness; the `verify-no-inline-sandbox-outside-test.sh` gate (authored in C14) will pass against this code.

---

### Chunk C5 — `SandboxExecutionService` skeleton + pure helpers

**`spec_sections:`** [§8.1, §10.1, §13.1, §19.1, §22, §24.1]

**Depends on:** C1b (schema row type for `sandbox_executions` lease columns), C2 (FailureReason), C4 (provider resolver). The plan-review round 1 surfaced that C5's start-claim lease flow imports inferred row types from `server/db/schema/sandboxExecutions.ts` (C1b), so C1b is a hard prerequisite, not a parallel chunk.

**Files to create or modify:**

- `server/services/sandboxExecutionService.ts` — NEW. The thin orchestrator: constructs the resolved provider once at module init, exposes `runTask(input)` and `getExecution(sandboxExecutionId)`. The skeleton implements the start-claim lease state-machine flow described in spec §8.1 + §24.1, but defers actual provider invocation to C9 / C10's implementations (which are wired by C5's interface boundary).
- `server/services/sandboxExecutionServicePure.ts` — NEW. Three pure helpers: `classifyTerminal(providerSignal, harvestResult): SandboxTerminalState`; `resolveSandboxCeilings(input): { wallClockMs, costCents, monitorIntervalMs }` (default vs override paths per spec §10.1); `mapPolicyToProviderFlags(policy): ProviderFlags` (the policy → e2b SDK flag mapping; pure transformation).
- `server/services/__tests__/sandboxExecutionServicePure.test.ts` — NEW. Pure tests covering every input combination of `classifyTerminal`, default-vs-override paths of `resolveSandboxCeilings`, and the policy-mapping transformation.

**Module shape:**

- *Public interface this chunk exposes:* the `SandboxExecutionService` interface (TypeScript shape) + the entrypoint `runTask` / `getExecution` functions + three pure helpers.
- *What stays hidden behind it:* the start-claim lease state machine (the ~7 cases listed in spec §8.1: initial INSERT, provider-start success path, retry-joins-in-flight, retry-returns-canonical-terminal, retry-reclaims-stale-pending-lease, retry-waits-on-fresh-lease, MAX_START_ATTEMPTS cap → `provider_unavailable`); the harvest invocation seam (calls into `sandboxHarvestService.runHarvest` from C7 once C7 lands); the worker-side ceiling-monitor enqueue (calls into `sandboxCeilingMonitorJob` from C11a once C11a lands).

**Contracts:**

- `runTask(input: SandboxRunTaskInput): Promise<SandboxRunTaskOutput>` — synchronous from caller's perspective per spec §22.
- `getExecution(sandboxExecutionId: string): Promise<SandboxExecutionRow>` — read-side helper for reconciliation paths per spec §8.1.
- `classifyTerminal` — pure function from `(providerSignal, harvestResult)` to one of the 8 terminal states. Spec §13.1 + §24.5.
- `resolveSandboxCeilings` — pure function applying defaults from spec §10.1 and merging input overrides. Hard cap: 30 min wall-clock, 200 cents cost.

**Error handling strategy (for `runTask`):**

- **Idempotency posture:** key-based on `sandboxExecutionId` UNIQUE constraint (spec §24.1 row "runTask"). State-based with start-claim lease for the pending-running transition (spec §24.1 row "Provider start call").
- **Retry classification:** internal retries via `withSandboxProvider` (C8) are guarded; external `runTask` retries with the same `sandboxExecutionId` are key-based idempotent.
- **Concurrency guards:** spec §24.3 row 3 — status transition races are guarded by `UPDATE ... WHERE status = $expected`. Two harvest invocations are guarded by `UPDATE sandbox_executions SET status='completed' WHERE status='harvesting'`. Two provider-start calls are guarded by the lease-claim timestamp.
- **Terminal-event guarantee:** spec §24.4 — exactly one canonical terminal event per execution. Recovery events from reconciliation are flagged `isCanonical: false`.
- **Partial-success handling:** spec §24.5 — `classifyHarvestOutcome` (in `sandboxHarvestServicePure.ts` from C6) is the single source of truth for terminal classification; no silent partial-success path.
- **Unique-constraint-to-HTTP mapping:** spec §24.6 — `23505` on `sandbox_executions` PK returns canonical row's output (200 + idempotent hit at the calling run's API surface, when V1 surfaces an HTTP boundary in Phase 3.5+).

**Testing requirements:** authored in this chunk:

- Pure tests for the three helpers in `sandboxExecutionServicePure.test.ts`. Single-file local execution allowed via `npx vitest run`.

**Acceptance criteria:** lint + typecheck + build:server pass; pure tests for the three helpers cover every documented branch; the skeleton compiles against `shared/types/sandbox.ts` from C1a and the schema types from C1b.

---

### Chunk C6 — Output schema validation + redaction wiring

**`spec_sections:`** [§8.4 steps 3-7, §11.3, §11.5, §19.1, §26 (Spec C coordination point)]

**Files to create or modify:**

- `server/services/sandboxHarvestServicePure.ts` — NEW. Two pure helpers: `composeRedactionPatternSet(defaultBundle, executionAliases): RegExp[]` (per-execution pattern set assembly per spec §11.3); `classifyHarvestOutcome(stepResults): SandboxTerminalState` (single source of truth for terminal-state classification per spec §24.5). A third helper for output schema validation (`validateOutputAgainstSchema(parsed, schemaRef): { ok: true, redacted } | { ok: false, subReason }`) lands here too.
- `server/lib/redaction.ts` — MODIFY. Extend `DEFAULT_REDACTION_PATTERNS` with sandbox-specific regex patterns (token aliases, credential injection markers). Coordinated with Spec C per §26.1 / §26.2 — first to land defines the shared bundle; second appends. The current branch is the second-to-merge if Spec C lands first; the rebase is mechanical (append to the array). Plan assumes second-to-merge posture.
- `server/services/sandbox/__tests__/sandboxHarvestServicePure.test.ts` — NEW. Pure tests for `composeRedactionPatternSet` (default-only, default+aliases, deduplication) and `classifyHarvestOutcome` (every step-result combination → expected terminal state).

**Module shape:**

- *Public interface this chunk exposes:* the three pure helpers in `sandboxHarvestServicePure.ts` + the extended pattern bundle in `redaction.ts`.
- *What stays hidden behind it:* the Zod schema-resolution mechanics (loaded from the calling adapter's schema-ref path, not by this chunk); the per-execution pattern lifecycle (registered at sandbox start, discarded at sandbox close — orchestrated by C7 / C5).

**Contracts:**

- `composeRedactionPatternSet(default, aliases)` — pure function returning the union of default patterns + per-alias regex patterns. Order is: default first, then aliases by alias name (deterministic).
- `classifyHarvestOutcome(stepResults)` — pure function returning exactly one of the 8 terminal states from spec §13.1. Inputs: a 12-element step-result array (one per harvest step). Output is determined by the first failed step: if step 1 fails → `provider_unavailable`; step 2-3 fails → `output_validation_failed`; etc. Spec §24.5 names this as the partial-success-prevention helper.
- `redaction.ts` extension: regex patterns for sandbox-specific token formats (e.g., `oauth_<provider>_<sub>_token`, `aws_session_<sub>_token`) added to `DEFAULT_REDACTION_PATTERNS`. Patterns are deduplicated against existing entries.

**Error handling strategy:** all functions are pure; no I/O; no error path other than Zod validation throwing on malformed input (caught by the harvest pipeline in C7).

**Testing requirements:** authored in this chunk:

- Pure tests in `sandboxHarvestServicePure.test.ts`. Coverage: every step-result combination producing every terminal state; pattern-set assembly with empty / single / multiple aliases.

**Acceptance criteria:** lint + typecheck pass; pure tests cover the documented branches; `redaction.ts` extension does not break existing redaction tests (those CI-only).

---

### Chunk C7 — Harvest pipeline (12 ordered steps)

**`spec_sections:`** [§8.4, §11.3, §11.4, §13.1 (recoverable terminals), §14.1 (telemetry writes), §14.5 (minimum-events), §19.1, §20.3, §20.4, §20.5, §20.7, §20.8, §22, §24.1, §24.4, §24.5]

**Files to create or modify:**

- `server/services/sandboxHarvestService.ts` — NEW. Implements the 12-step harvest pipeline orchestrator. Each step is a separate function inside the file; the `runHarvest(sandboxExecutionId)` entrypoint walks them in order and stops on the first failure. Each step is idempotent on its own write (per spec §8.4 "Pipeline is one transaction per write step, not one transaction across all steps").
- `server/services/credentialBrokerService.ts` — MODIFY. Extend `issueCredential` return shape per spec §11.3: optional `redactionPattern: RegExp` field. Existing callers ignoring the field are unaffected. Coordinated with Spec C per §26.
- Pure tests for the pure-helper-extracted decision points (`extractTerminalReasonFromProviderSignal`, `pickHarvestStepFromError`, etc.) are added to / extended in **`server/services/sandbox/__tests__/sandboxHarvestServicePure.test.ts`** — the same Pure test file authored in C6. **Do NOT create `sandboxHarvestService.test.ts`** for these helpers: the `*Pure.test.ts` convention from `verify-pure-helper-convention.sh` requires the test to import zero DB / provider / storage modules, and the helpers themselves live in `sandboxHarvestServicePure.ts` (C6), not in this chunk's non-pure orchestrator. A non-`Pure` test file `sandboxHarvestService.test.ts` would be created only if it tested non-pure exports — and this chunk has no such exports that warrant local tests (the full harvest pipeline integration is exercised by Phase 2 features at the integration layer per spec §25.5). C7 extends the C6-authored Pure test file with any additional pure-helper coverage surfaced when implementing the 12-step pipeline. (R5 fix, plan-review round 1.)

**Module shape:**

- *Public interface this chunk exposes:* `runHarvest(sandboxExecutionId): Promise<SandboxRunTaskOutput>` (called from `runTask` in C5's `sandboxExecutionService` after sandbox terminal); `runHarvestReconciliation(sandboxExecutionId): Promise<void>` (called from the reconciliation job in C11a — re-attempts the pipeline using the same idempotency keys).
- *What stays hidden behind it:* all 12 step implementations, the Zod schema loading, the object-storage upload streaming, the per-execution redaction pattern registration / teardown, the cost-row write with provider-reported value, the telemetry event sequencing, the atomic `harvesting → terminal` UPDATE, the credential-leak defense-in-depth check (spec §11.4).

**Contracts (per step, summarised; full per-step shape per spec §8.4):**

1. **Terminal classification** — calls `sandboxExecutionServicePure.classifyTerminal` from C5.
2. **Output read** — provider file API call wrapped in `withBackoff` (provider abstraction from C8). Absent file → `output_validation_failed` with sub-code `missing`. Over-size → `output_validation_failed` with sub-code `over_size`.
3. **Output validate** — Zod-validate against the task's declared schema. Failure → `output_validation_failed` with sub-code `schema_failed`.
4. **Output redact** — `redactValue(parsed, perExecutionPatterns)`.
5. **Log read** — read both stdout / stderr files. Per-stream over-cap → `output_validation_failed` with sub-code `log_overflow`. Each line is redacted via `redactValue` before persistence.
6. **Artefact enumeration** — list `/workspace/artefacts/`. Per-artefact / total-bytes over cap → `artefact_upload_failed` with sub-code `artefact_oversized`.
7. **Artefact metadata redact** — filename + extracted metadata through `redactValue` per spec §8.4 step 7.
8. **Object storage upload** — S3 prefix `sandbox-artefacts/{orgId}/{subaccountId}/{sandboxExecutionId}/{filename}`. Upload failure → `artefact_upload_failed` with sub-code `upload_io_error`. Idempotent on `UNIQUE (sandbox_execution_id, filename)` from C1b.
9. **Log persistence** — INSERT per redacted line into `sandbox_logs` with `(sandbox_execution_id, log_stream, sequence)` UNIQUE — idempotent.
10. **Cost row write** — single INSERT into `llm_requests` with `source_type = 'sandbox_compute'` + the 5 sandbox-* columns from C3. Idempotent on partial unique index from C3. Catch `23505` → read back canonical row, confirm cost matches within tolerance, exit step.
11. **Telemetry terminal event** — INSERT into `sandbox_telemetry_events` with `event_type` from §14.2 + `payload_json.harvestStepReached` (the integer 0..12 indicating which phase applies for the §14.5 minimum-events check) + `payload_json.isCanonical = true`.
12. **`sandbox_executions` row update** — atomic `UPDATE ... WHERE status = 'harvesting'` to one of the 8 terminal states. Wraps `assertValidTransition` per DEVELOPMENT_GUIDELINES §8.18. 0 rows updated → losing race; reads canonical and exits.

**Error handling strategy:**

- **Idempotency posture:** every step is idempotent (per spec §8.4). Step 8: `UNIQUE (sandbox_execution_id, filename)`. Step 9: `UNIQUE (sandbox_execution_id, log_stream, sequence)`. Step 10: partial unique on `(sandbox_execution_id) WHERE source_type = 'sandbox_compute'`. Step 11: `UNIQUE (sandbox_execution_id, sequence)` via the atomic `INSERT ... RETURNING coalesce(max(sequence)+1, 1)` pattern from spec §28 #1. Step 12: state-based UPDATE.
- **Retry classification:** every step is `safe` — the reconciliation job (C11a) re-runs `runHarvestReconciliation` and walks the pipeline again; existing rows are no-ops.
- **Concurrency guards:** spec §24.3 — two harvest invocations race on step 12's UPDATE; the loser observes 0 rows and exits cleanly. Two cost-row writers race on the partial unique index; the loser catches `23505` and reads back canonical.
- **Terminal-event guarantee:** spec §24.4 — exactly one canonical terminal telemetry event per execution. Step 11 writes the canonical event with `isCanonical: true`. Reconciliation re-attempts write events with `isCanonical: false` + `reconciliationAttempt: N`.
- **Partial-success handling:** spec §24.5 — `classifyHarvestOutcome` (from C6) is the single source of truth for terminal classification. No silent `completed` with empty artefacts.
- **Credential-leak defense-in-depth:** spec §11.4 — if step 6's enumeration sees `/workspace/secrets/` content, the pipeline writes a `credential_leak_attempted` event (filename only, value never logged) and the harvest fails; sandbox is torn down regardless.
- **`assertValidTransition` wrap:** every status UPDATE in step 12 calls `assertValidTransition` from `shared/stateMachineGuards.ts` per DEVELOPMENT_GUIDELINES §8.18. Sites that have not yet adopted it emit `state_transition` log with `guarded: false` — the spec compels adoption here, so the harvest service is fully guarded.
- **Non-durable async comment:** none expected — the pipeline is `await`-ed end-to-end. If a future change adds a fire-and-forget, the DEVELOPMENT_GUIDELINES §8.31 comment + PLAN_GAP entry applies.

**Testing requirements:** authored in this chunk:

- Tests in `sandboxHarvestServicePure.test.ts` (the C6-authored Pure file, extended here) covering: the pure-helper extract-and-classify decisions (e.g., `extractTerminalReasonFromProviderSignal` for ambiguous-terminal inputs); not the full pipeline run. Per spec §25, pure-only. (R5 fix — do not create `sandboxHarvestService.test.ts`; helpers live in the Pure module from C6.)
- The `*ServicePure.ts` naming convention applies to `sandboxHarvestServicePure.ts` from C6. The non-pure `sandboxHarvestService.ts` here does NOT have a `Pure` suffix because it touches the DB through `withOrgTx` — and consequently has NO local test file (full pipeline integration is exercised by Phase 2 features per spec §25.5).

**Acceptance criteria:** lint + typecheck + build:server pass; pure-helper tests pass via single-file `npx vitest run`; the harvest pipeline compiles against the C1b schemas + C3 `llm_requests` extension + C5 / C6 dependencies.

---

### Chunk C8 — `withSandboxProvider` wrapper

**`spec_sections:`** [§16.2, §16.3, §16.4, §16.5, §16.6, §19.1, §22 (provider-call retry), §24.2]

**Files to create or modify:**

- `server/lib/withSandboxProvider.ts` — NEW. The provider-call wrapper. Mirrors `withBackoff`'s shape but adds sandbox-specific failure classification and ambiguous-terminal reconciliation. Imports `SANDBOX_HARVEST_RECONCILIATION_JOB` (and any sibling sandbox queue-name constants it needs) from `server/lib/sandboxJobNames.ts`.
- `server/lib/sandboxJobNames.ts` — NEW. Single canonical source of pg-boss queue-name string constants for sandbox jobs. **Owned by C8 because C8 is the first chunk that needs to enqueue by job name without reaching into C11a's handler module.** Initial export set: `export const SANDBOX_HARVEST_RECONCILIATION_JOB = 'sandbox-harvest-reconciliation' as const;` plus stubs for any other sandbox queue-name constants the wrapper enqueues against (currently only the reconciliation job; add others if subsequent contracts surface during build). Consumers: C8 (enqueue side) and C11a (handler-registration side via `boss.work(SANDBOX_HARVEST_RECONCILIATION_JOB, ...)`). (F4 fix, plan-review round 2.)

**Module shape:**

- *Public interface this chunk exposes:* `withSandboxProvider<T>(opts: { phase: 'start' | 'mid_execution' | 'terminal' | 'harvest'; sandboxExecutionId: string; call: () => Promise<T> }): Promise<T>` — one function. Returns `T` on success, throws `FailureError` with `FailureReason.sandbox_provider_unavailable` on cap, enqueues the `SANDBOX_HARVEST_RECONCILIATION_JOB` queue (by name string from `sandboxJobNames.ts`) on ambiguous-terminal. Plus `sandboxJobNames.ts`'s typed string constants (consumed by C11a at handler-registration time).
- *What stays hidden behind it:* the `withBackoff` configuration (3 attempts, exponential jitter), the `Retry-After` parsing (spec §16.5), the slow-start emission (spec §16.4 — `provider_diagnostic` event with `subKind: 'slow_start'`), the ambiguous-terminal reconciliation enqueue (which calls `boss.send(SANDBOX_HARVEST_RECONCILIATION_JOB, payload)` directly, never imports the handler).

**Contracts:**

- Wraps the provider call with up to 3 attempts of `withBackoff` (per spec §16.2). Backoff grows exponentially with jitter.
- After the cap, surfaces `FailureReason.sandbox_provider_unavailable`.
- On ambiguous-terminal (provider signal "I don't know if alive"), `withSandboxProvider` enqueues the reconciliation job by **string queue name** via `boss.send(SANDBOX_HARVEST_RECONCILIATION_JOB, { sandboxExecutionId })`, importing the constant from `server/lib/sandboxJobNames.ts`. The concrete pg-boss handler registration (`boss.work(SANDBOX_HARVEST_RECONCILIATION_JOB, runHarvestReconciliationHandler)`) lands in C11a, which imports the same constant. **C8 must NOT import `server/jobs/sandboxHarvestReconciliationJob.ts` directly.** The string-constant seam is the only contract between C8 and C11a — it is concrete (one queue name per job), typed (`as const`), and import-cycle-free (constants module imports nothing else from sandbox code). After enqueue, C8 surfaces `sandbox_provider_unavailable` to the caller. The reconciliation job re-queries until definitive answer or wall-clock + buffer. (F2 fix, plan-review round 1; F4 fix, plan-review round 2.)
- Emits `provider_diagnostic` events on retry / slow-start / rate-limit (spec §16.6, §14.2).
- No silent fallback — the wrapper has no code path that returns a "degraded execution" success. Spec §16.2 invariant.

**Error handling strategy:**

- **Idempotency posture:** each provider call is wrapped; the underlying provider terminate API is non-idempotent at provider but the wrapper guarantees our boundary is idempotent (state-guard via `sandbox_executions.status`).
- **Retry classification:** `guarded` on the wrapped call.
- **Concurrency guards:** N/A at this layer — concerned with single-call retry, not racing writes.
- **Terminal-event guarantee:** the wrapper does not write terminal events; that is the harvest pipeline's job (C7). The wrapper writes pre-terminal `provider_diagnostic` events.
- **Rate-limit posture:** spec §16.5 — respects provider-returned `Retry-After`; no per-org rate budget in V1.

**Testing requirements:** authored in this chunk:

- Pure tests for the failure classification logic (e.g., `classifyProviderSignal(signal): { kind: 'transient' | 'ambiguous' | 'fatal' }`) extracted as a pure helper. File: `server/lib/__tests__/withSandboxProviderPure.test.ts`. The async retry loop itself is not pure-tested (it owns timer / promise machinery); the classifier is.

**Acceptance criteria:** lint + typecheck + build:server pass; pure helper tests cover transient / ambiguous / fatal classification.

---

### Chunk C9 — `e2bSandbox` provider

**`spec_sections:`** [§4 (vendor / hosting model), §8.2.1, §11 (credential injection mechanism), §15.3, §19.1, §22]

**Depends on:** C5 (service interface), C8 (provider wrapper), C12 (template Dockerfile + `PUBLISHED_VERSION` + `templateVersionParserPure.ts`). The plan-review round 1 surfaced that `e2bSandbox` resolves `template_digest` from `PUBLISHED_VERSION.image_digest` via C12's parser, so C12 is a hard prerequisite for C9 (not just for C11a / C13). (F3 fix, plan-review round 1.)

**Files to create or modify:**

- `server/services/sandbox/e2bSandbox.ts` — NEW. Wraps the e2b SDK behind the `SandboxExecutionService` interface from C5. **Module-init side effect:** calls `registerSandboxProvider('e2b', () => new E2bSandbox(...))` from C4's resolver registration seam at module load. This is what allows C4's resolver to compile without statically importing this file. (F1 fix, plan-review round 2.)

**Module shape:**

- *Public interface this chunk exposes:* `e2bSandbox` class implementing `SandboxExecutionService` — `runTask(input)` and `getExecution(id)`. Constructor takes the e2b SDK client + the resolved configuration (template registry, project name). Module-init `registerSandboxProvider('e2b', ...)` call.
- *What stays hidden behind it:* the e2b SDK calls (sandbox creation with metadata tags, file API for harvest reads, terminate API), the metadata-tag tagging (`{ org_id, subaccount_id, run_id, agent_id, task_id, sandbox_execution_id, template_name, template_version }`), the credential file mounting under `/workspace/secrets/`, the `template_digest` resolution from C12's `PUBLISHED_VERSION`, the provider-side ceiling parameter mapping (`timeout` parameter for wall-clock), the metadata-tag-driven multi-tenancy boundary (Decision 1 locked this).

**Contracts:**

- One sandbox per task; no pooling, no reuse (spec §8.2.1).
- All provider calls go through `withSandboxProvider` from C8.
- `template_version` is read from `PUBLISHED_VERSION.image_digest` at execution start (resolved via `templateVersionParserPure.ts` from C12).
- Production path refuses `template_version === 'latest'` per spec §15.3 — pure helper assertion before construction.
- Metadata tags written via the e2b SDK's tag API.

**Error handling strategy:**

- **Idempotency posture:** the provider start call is wrapped by C5's start-claim lease (so the e2b sandbox-creation call only fires once per `sandboxExecutionId` per worker attempt). At the e2b layer, sandbox start is non-idempotent at provider — but the lease guarantees we never call it twice for the same execution.
- **Retry classification:** `guarded` via `withSandboxProvider`.
- **Terminal classification:** provider terminal hooks feed C5's `classifyTerminal` via the pure classifier (spec §8.2.1).
- **Provider-side ceiling enforcement:** wall-clock via the e2b SDK `timeout` parameter (best-effort). Cost ceiling provider-side enforcement is best-effort; worker-side fallback is the authoritative layer (C11a's `sandboxCeilingMonitorJob`).
- **Slow-start posture:** spec §16.4 — slow start does not terminate; emits `provider_diagnostic` event and waits up to wall-clock + buffer.
- **`SANDBOX-DEF-EGRESS-MECH` decision:** this chunk verifies which egress interception mechanism e2b actually exposes (per spec §27 deferred row). Decision is recorded in `tasks/builds/sandbox-isolation/progress.md` during this chunk; the audit-row schema (C1b) is unaffected by the choice.

**Testing requirements:** authored in this chunk:

- Pure tests for any extracted classifier helpers (e.g., `e2bTerminalSignalToInternal(signal)` mapping from e2b SDK terminal types to our `SandboxTerminalState`). The actual SDK calls are not pure-tested (would need a mock SDK harness, which is out of scope per spec §25.5). File: `server/services/sandbox/__tests__/e2bSandboxPure.test.ts`.

**Acceptance criteria:** lint + typecheck + build:server pass; pure helper tests cover terminal-signal classification; the provider implementation compiles against the e2b SDK types.

---

### Chunk C10 — `localDockerSandbox` provider

**`spec_sections:`** [§8.2.2, §15.5, §19.1, §22]

**Depends on:** C5 (service interface), C8 (provider wrapper), C12 (template Dockerfile + parity-doc surface in `synthetos-sandbox/README.md` + `templateVersionParserPure.ts` for the `local-dev-{commitShort}` pin format). The plan-review round 1 surfaced that `localDockerSandbox` consumes the same parser as C9, so C12 is a hard prerequisite. (F3 fix, plan-review round 1.)

**Files to create or modify:**

- `server/services/sandbox/localDockerSandbox.ts` — NEW. Wraps `docker run --rm` against the same template Dockerfile published by C12. **Module-init side effect:** calls `registerSandboxProvider('local_docker', () => new LocalDockerSandbox(...))` from C4's resolver registration seam at module load. (F1 fix, plan-review round 2.)

**Module shape:**

- *Public interface this chunk exposes:* `localDockerSandbox` class implementing `SandboxExecutionService`. Module-init `registerSandboxProvider('local_docker', ...)` call.
- *What stays hidden behind it:* the `docker run` invocation, the `--network=none` default, the `--stop-timeout` wall-clock enforcement, the local file-mount for `/workspace/`, the local-built template digest resolution.

**Contracts:**

- Same `runTask` / `getExecution` interface as `e2bSandbox`.
- Refuses `template_version === 'latest'` per spec §15.3 (local dev pins to `local-dev-{commitShort}`).
- Parity gaps documented in `infra/sandbox-templates/synthetos-sandbox/README.md` from C12: `--network=none` by default; no provider cost; synthetic provider-telemetry fields; egress audit gap.

**Error handling strategy:**

- **Idempotency posture:** start-claim lease from C5 prevents double-start for the same execution.
- **Retry classification:** `guarded` via `withSandboxProvider`.
- **Terminal classification:** Docker exit code → C5's `classifyTerminal` via a Docker-specific signal mapper.
- **Cost recording:** zero-cost rows (spec §12.5) — `costRaw=0`, `costWithMargin=0`, `costWithMarginCents=0`, `sandbox_vcpu_seconds` and `sandbox_wall_clock_ms` populated from local observations.
- **Wall-clock enforcement:** `docker run --stop-timeout` for provider-side; worker-side fallback (C11a) is authoritative.

**Testing requirements:** authored in this chunk:

- Pure tests for the Docker exit-code mapper helper. File: `server/services/sandbox/__tests__/localDockerSandboxPure.test.ts`.

**Acceptance criteria:** lint + typecheck + build:server pass; pure helper tests cover the exit-code mapping branches.

---

### Chunk C11a — Execution-scoped pg-boss jobs

**`spec_sections:`** [§8.4 (reconciliation), §10.2, §13.2, §17.4, §19.1, §22]

**Files to create or modify:**

- `server/jobs/sandboxHarvestReconciliationJob.ts` — NEW. Re-enqueues harvest for executions stuck pre-terminal past wall-clock-plus-buffer. Calls `sandboxHarvestService.runHarvestReconciliation` from C7. Imports `SANDBOX_HARVEST_RECONCILIATION_JOB` from `server/lib/sandboxJobNames.ts` (owned by C8 — F4 fix, plan-review round 2) and registers via `boss.work(SANDBOX_HARVEST_RECONCILIATION_JOB, ...)`. Cron schedule: every 5 minutes (V1 cadence per spec §22).
- `server/jobs/sandboxCeilingMonitorJob.ts` — NEW. Per-execution worker-side fallback for wall-clock + cost ceilings. Re-enqueues every `policy.ceilings.monitorIntervalMs` (V1 default 5s) with pg-boss `singletonKey = sandbox_execution_id`. Reads `templateResourceClass.maxCostCentsPerSecond` from C12's `templateVersionParserPure.ts` to drive the cost-fallback estimator from spec §10.2.
- `server/jobs/sandboxWallClockKillJob.ts` — NEW. One-shot belt-and-braces. Scheduled at sandbox start with `startAfter = wallClockMs + buffer`. If sandbox is non-terminal when this fires, calls provider terminate via `withSandboxProvider` (C8) and writes `timed_out`.
- `server/jobs/sandboxArtefactPurgeJob.ts` — NEW. Triggered by run soft-delete event. Physically deletes artefacts from object storage. Pointer rows soft-deleted with `object_storage_state = 'purged'`.
- `server/services/queueService.ts` — MODIFY. Register all 4 new job handlers + their schedules. Per spec §19.3 (corrected via §3.1 of this plan, the registration site is `queueService.ts`, not a non-existent `server/jobs/index.ts`).

**Module shape:**

- *Public interface this chunk exposes:* four exported handler functions (one per job file) + the `queueService.ts` registration that wires them to pg-boss.
- *What stays hidden behind it:* the pg-boss singletonKey configuration, the `startAfter` scheduling, the cost-fallback estimator (`estimateSandboxCostCents = elapsedMs / 1000 × maxCostCentsPerSecond`), the org-context resolver path inside each handler (`createWorker` from `server/lib/createWorker.ts`).

**Contracts:**

- All four jobs are idempotent on `sandbox_execution_id` (per spec §22.1 row 1).
- `sandboxCeilingMonitorJob`: re-enqueues itself with `singletonKey = sandbox_execution_id` (pg-boss singleton guarantees one in-flight monitor per execution; no duplicate ticks). Exits cleanly on observing `status NOT IN ('pending', 'running')`. Cost estimator reads `max_cost_cents_per_second` from `CURRENT_VERSION` via `templateVersionParserPure.ts` (C12).
- `sandboxWallClockKillJob`: one-shot; no-op if monitor already terminated (per spec §10.2).
- `sandboxHarvestReconciliationJob`: calls C7's `runHarvestReconciliation`, which is idempotent at every step.
- `sandboxArtefactPurgeJob`: triggered by the run soft-delete cascade (existing pattern from PR #261 / PR #267).

**Error handling strategy:**

- **Idempotency posture:** all four jobs are idempotent on `sandbox_execution_id` (key-based via spec §22.1).
- **Retry classification:** `safe` (per spec §24.2). pg-boss handles retries; idempotency ensures safety.
- **Concurrency guards:** singleton guarantees one in-flight monitor per execution. Wall-clock kill is one-shot. Reconciliation cron interval (5 min) is wider than expected job duration; concurrent runs unlikely but safe via state guards in C7.
- **Terminal-event guarantee:** the monitor + wall-clock kill jobs trigger terminal events via the harvest pipeline (C7) when they cause termination — they do not write terminal events directly.
- **Partial-success handling:** N/A at this layer; jobs delegate to C7 / C8 which own the rules.
- **Logger spy convention (DEVELOPMENT_GUIDELINES §7):** any test of these jobs spies on the logger object directly via `mock.method(logger, 'warn', () => {})`, not via env-var patching.

**Testing requirements:** authored in this chunk:

- Pure tests for the cost-estimator helper extracted from `sandboxCeilingMonitorJob` (already named `estimateSandboxCostCents` in spec §10.2). File: `server/jobs/__tests__/sandboxCeilingMonitorPure.test.ts`. Coverage: estimator output for various `(elapsedMs, maxCostCentsPerSecond)` combinations.
- Pure tests for the reconciliation-eligibility decision helper. File: `server/jobs/__tests__/sandboxHarvestReconciliationPure.test.ts`.

**Acceptance criteria:** lint + typecheck + build:server pass; pure helper tests pass via single-file `npx vitest run`; `queueService.ts` registers all 4 new jobs with correct singletonKey / schedule semantics.

---

### Chunk C11b — Retention-scoped pg-boss jobs

**`spec_sections:`** [§17.3, §19.1, §22]

**Files to create or modify:**

- `server/jobs/sandboxTelemetryPruneJob.ts` — NEW. Prunes `sandbox_telemetry_events` past 90d. Cron daily.
- `server/jobs/sandboxLogsPruneJob.ts` — NEW. Prunes `sandbox_logs` past 90d. Cron daily.
- `server/jobs/sandboxEgressAuditPruneJob.ts` — NEW. Prunes `sandbox_egress_audit` past 180d. Cron daily.
- `server/services/queueService.ts` — MODIFY (additive on top of C11a). Register all 3 new job handlers + their daily cron schedules.

**Module shape:**

- *Public interface this chunk exposes:* three exported handler functions + the `queueService.ts` registration extension.
- *What stays hidden behind it:* the per-job cutoff-date computation, the per-org admin-tx iteration pattern (mirrors `memoryDedupJob.ts` per DEVELOPMENT_GUIDELINES §2 — admin connection for iteration, `withOrgTx` per tenant write), the prune SQL.

**Contracts:**

- All three jobs are idempotent on `(table, cutoff_date)` (per spec §22.1 row 1 — cutoff-scoped retention jobs).
- Each job iterates via `withAdminConnection` for the per-org listing, then opens `withOrgTx` per tenant for the actual DELETE — matches the maintenance-job pattern from `memoryDedupJob.ts`.
- Logs are physically deleted (no tombstone — spec §17.3); telemetry events physically deleted (no summary roll-up; the `sandbox_executions` row IS the post-prune summary per spec §17.3); egress audit physically deleted at 180d.

**Error handling strategy:**

- **Idempotency posture:** key-based on cutoff date. Re-running with the same cutoff is a no-op.
- **Retry classification:** `safe` (delete-where idempotent; pg-boss handles retries).
- **Concurrency guards:** daily cron ensures one in-flight per day; no other races.
- **Terminal-event guarantee:** N/A — retention jobs do not emit telemetry events.
- **Partial-success handling:** if the per-org iteration fails for one org, the job logs the failure and continues for the others (per spec / DEVELOPMENT_GUIDELINES §2 maintenance-job pattern).

**Testing requirements:** authored in this chunk:

- Pure tests for the cutoff-date helper extracted from each job (`computeSandboxTelemetryCutoff(now, retentionDays): Date`). File: `server/jobs/__tests__/sandboxRetentionPure.test.ts`. Coverage: known retention windows produce the expected cutoff.

**Acceptance criteria:** lint + typecheck + build:server pass; pure helper tests pass; `queueService.ts` schedules the three jobs at distinct cron times to avoid contention.

---

### Chunk C12 — Template Dockerfile + CI publish pipeline + version parser

**`spec_sections:`** [§8.2.2 (parity contract), §10.2 (`max_cost_cents_per_second` consumption), §15, §19.1, §25.2 (gate enabling for template-version coherence)]

> **Chunk-size posture:** C12 lists 12 files, above the ≤5-files heuristic. The chunk is intentionally kept whole because every file represents one cohesive logical responsibility — *stand up the template-build infrastructure that C9 / C10 / C11a / C13 / C14 all depend on*. Splitting (e.g., template files vs parser vs CI workflow vs OpenClaw placeholders) would force the next builder to land partial-only template state across multiple PRs, which is strictly worse for review than one cohesive chunk: the Dockerfile cannot meaningfully exist without the version files; the version files cannot meaningfully exist without the parser; the parser cannot meaningfully exist without the CI workflow that produces `PUBLISHED_VERSION`; OpenClaw placeholders are template-build-shaped scaffolding owned by the same infrastructure layer. Plan-review round 1 R2 was triaged as auto-apply-with-rationale: keep cohesive, justify the exception explicitly. The chunk passes the chunk-size rule on the OR-clause (≤1 logical responsibility) of "≤5 files OR ≤1 logical responsibility".

**Files to create or modify:**

- `infra/sandbox-templates/synthetos-sandbox/Dockerfile` — NEW. Pinned `FROM` digest; deterministic build; `--platform linux/amd64`; no build-arg timestamps.
- `infra/sandbox-templates/synthetos-sandbox/entrypoint.sh` — NEW. Sets up `/workspace`; runs the task; captures stdout/stderr to log files.
- `infra/sandbox-templates/synthetos-sandbox/requirements.txt` — NEW. Hash-locked Python deps (pandas, pdfplumber, openpyxl, etc.).
- `infra/sandbox-templates/synthetos-sandbox/package.json` + `package-lock.json` — NEW. Node baseline + JS-transform deps.
- `infra/sandbox-templates/synthetos-sandbox/CURRENT_VERSION` — NEW. Five fields: `version`, `template_resource_class`, `max_cost_cents_per_second`, `base_image_digest`, `deps_lockfile_hash`.
- `infra/sandbox-templates/synthetos-sandbox/PUBLISHED_VERSION` — NEW (placeholder created in this chunk; first real attestation comes from CI on first publish). Five fields: `version`, `image_digest`, `ci_build_commit`, `registry_published_at`, `scanner_result_hash`.
- `infra/sandbox-templates/synthetos-sandbox/README.md` — NEW. Documents parity gaps between e2b and localDocker (per spec §8.2.2): `--network=none` default for local, no cost, synthetic telemetry fields, egress audit gap.
- `infra/sandbox-templates/openclaw-session/Dockerfile` — NEW. Inert placeholder owned by the OpenClaw adapter spec. Single-line stub (`# Owned by OpenClaw adapter spec — placeholder, not built by V1 CI`). (F4 fix, plan-review round 1: the spec calls for placeholder scaffolding here, not just `.gitkeep`. Attached to C12, not C1a, because template-build infrastructure is C12's responsibility — symmetric with `synthetos-sandbox`.)
- `infra/sandbox-templates/openclaw-session/entrypoint.sh` — NEW. Inert placeholder; single-line stub indicating OpenClaw adapter ownership.
- `infra/sandbox-templates/openclaw-session/CURRENT_VERSION` — NEW. Inert placeholder; single-line stub `version=0.0.0-placeholder`. **NOT scanned by the `verify-template-version-coherence` gate in V1** — the gate is scoped to `infra/sandbox-templates/synthetos-sandbox/` only (see C14). Once the OpenClaw adapter spec activates this directory, that spec will (a) add the four other required fields per spec §15.2 and (b) extend the gate's scan path to include `openclaw-session/`. Until then, the single-line placeholder is intentional and structurally minimal — it exists only so the directory has shape, not so the gate validates it. (F3 fix, plan-review round 2.)
- `infra/sandbox-templates/openclaw-session/README.md` — NEW. One paragraph: "Placeholder scaffolding. Real implementation lands with the OpenClaw adapter spec; V1 CI does not build, scan, or publish this template."
- `server/services/sandbox/templateVersionParserPure.ts` — NEW. Pure parser for both files. Validates the five-field shape. Surface for the `verify-template-version-coherence` CI gate.
- `docker-compose.sandbox.yml` (or extension to existing `docker-compose.yml`) — NEW (or MODIFY). Service definition for `localDockerSandbox`'s template image build + run target.
- `.github/workflows/publish-sandbox-templates.yml` — NEW. Fires on tag `sandbox-template/{name}/v*`. Reads `CURRENT_VERSION`; verifies deterministic-build prerequisites; builds the image; runs `trivy image`; publishes to e2b registry with `version` as alias; opens attestation PR writing `PUBLISHED_VERSION`. Per spec §15.2 — CI is the final-digest source of truth. The workflow's tag-name guard explicitly excludes `sandbox-template/openclaw-session/v*` until the OpenClaw adapter spec activates the template (no accidental publish of placeholder content).

**Module shape:**

- *Public interface this chunk exposes:* `templateVersionParserPure` exports `parseCurrentVersion(text): CurrentVersion` and `parsePublishedVersion(text): PublishedVersion` (typed result objects); the CI workflow exposes nothing at runtime — it's CI infrastructure; the `synthetos-sandbox` template directory exposes nothing at runtime — the image is consumed by `e2bSandbox` (C9) and `localDockerSandbox` (C10) via container/SDK calls.
- *What stays hidden behind it:* the deterministic-build prerequisites verification, the `trivy` invocation, the e2b registry publish API call, the attestation PR workflow.

**Contracts:**

- `CURRENT_VERSION` shape per spec §15.2 (5 lines, `key=value`).
- `PUBLISHED_VERSION` shape per spec §15.2 (5 lines, `key=value`). Written by CI attestation PR, never by direct CI commit.
- Tag format: `sandbox-template/{name}/v{version}` (per spec §15.2 + §25.2).
- Scanner: `trivy image`; Critical / High CVE → publish blocked; outdated base image (>60 days) → publish blocked; unpinned deps → publish blocked.
- 24h grace window after tag publish for the attestation PR to land (per spec §25.2 row 3).

**Error handling strategy:**

- **Idempotency posture:** the CI workflow is idempotent on the tag (re-running the same tag re-publishes the same digest if the build is deterministic; mismatched digest = build broke determinism = publish blocked).
- **Retry classification:** N/A at runtime; CI handles retries.
- **Terminal-event guarantee:** N/A — CI workflow.
- **Partial-success handling:** if the build succeeds but publish fails, the workflow halts before opening the attestation PR; operator re-runs the workflow against the same tag.
- **Build-time decision: `SANDBOX-DEF-EGRESS-MECH`** — verified in this chunk by inspecting which egress hooks the e2b SDK exposes. Decision recorded in `tasks/builds/sandbox-isolation/progress.md` and (if architectural) in a scoped ADR. Audit-row schema (C1b §20.6) is unaffected.

**Testing requirements:** authored in this chunk:

- Pure tests for `templateVersionParserPure`. File: `server/services/sandbox/__tests__/templateVersionParserPure.test.ts`. Coverage: valid 5-field file; missing field; malformed line; empty file; mismatched `version` between `CURRENT_VERSION` and `PUBLISHED_VERSION`.

**Acceptance criteria:** lint + typecheck pass; pure tests pass; the CI workflow file lints cleanly via `actionlint` (CI handles the actual workflow runs); the Dockerfile builds locally to verify deterministic-build prerequisites.

---

### Chunk C13 — `iee_dev` adapter rewiring + classification helper

**`spec_sections:`** [§7.2 (classification table), §18, §19.3, §25.2 (gate enabling for sandbox classification)]

**Files to create or modify:**

- `server/services/executionBackends/ieeDevBackend.ts` — MODIFY. `dispatch()` rewired to consult `classifyExecutionClass()` and call `SandboxExecutionService.runTask` for sandbox-class tasks. Tier 5 worker-trusted path unchanged.
- `server/services/executionBackends/ieeDevBackendPure.ts` — NEW. Adapter-side pure helper containing `classifyExecutionClass(task) → 'sandbox' | 'worker_orchestration' | 'worker_trusted'`. Spec §18.2 names this as the only producer of dispatch-class verdicts.
- `server/services/executionBackends/__tests__/ieeDevBackendPure.test.ts` — NEW. Pure tests covering every known task variant the adapter dispatches today.
- `scripts/migrations/sandbox-isolation-classification-dry-run.ts` — NEW. One-shot pre-cut script: re-classifies every task type the adapter has historically dispatched (sourced from `tasks/todo.md` / known task list). Asserts classifications match the manual expectation. Output → `tasks/builds/sandbox-isolation/migration-dry-run.md`. Build-time check; not runtime. Per spec §18.4.

**Module shape:**

- *Public interface this chunk exposes:* the modified `ieeDevBackend.dispatch()` (no signature change — Spec A's `BackendDispatchResult` shape unchanged); the new `classifyExecutionClass` pure function in `ieeDevBackendPure.ts`.
- *What stays hidden behind it:* the per-task-variant classification rules (every task type maps to one of the three classes); the call into `sandboxExecutionService.runTask` for sandbox-class tasks; the failure-translation from `FailureReason.sandbox_*` to `BackendDispatchResult` failure shape; the finite-cap enforcement on `crashed` / `output_validation_failed` retries (spec §13.2 — caller-driven retry with per-task attempt counter on the calling run).

**Contracts:**

- `classifyExecutionClass(task): 'sandbox' | 'worker_orchestration' | 'worker_trusted'` — pure function. Spec §7.2 dispatch table is the rule. No "small script" exception.
- `dispatch()` unchanged externally (Spec A's `BackendDispatchResult` shape preserved).
- `dispatch()` internally: for `'sandbox'` class, calls `sandboxExecutionService.runTask` (C5); for `'worker_*'` classes, retains the existing worker code path.
- Hard-cut migration (spec §18.3): no feature flag, no per-tenant rollout gate, no shadow-vs-active mode. The `verify-sandbox-classification` CI gate from C14 enforces.

**Error handling strategy:**

- **Idempotency posture:** N/A at this layer — `dispatch` is one call from the orchestrator. The sandbox call's idempotency is C5's responsibility.
- **Retry classification:** the calling run's retry posture is unchanged — this chunk preserves Spec A's failure-surface contract.
- **Concurrency guards:** N/A at this layer.
- **Terminal-event guarantee:** the adapter does not emit terminal events directly; the harvest pipeline (C7) does.
- **Partial-success handling:** the adapter translates `FailureReason.sandbox_*` to `BackendDispatchResult` failure; no silent success-on-partial.

**Testing requirements:** authored in this chunk:

- Pure tests in `ieeDevBackendPure.test.ts` covering every task-variant classification. Coverage: every known task type from `tasks/todo.md` produces the expected class. Single-file local execution allowed.
- The dry-run script is run once during this chunk and its output recorded in `tasks/builds/sandbox-isolation/migration-dry-run.md`.

**Acceptance criteria:** lint + typecheck + build:server pass; pure tests pass; dry-run script execution recorded; the modified `dispatch()` compiles against the unchanged Spec A `ExecutionBackend` interface.

---

### Chunk C14 — CI gates + doc-sync (closes the build)

**`spec_sections:`** [§11 (doc-sync), §15.2 (gate), §18.4 (gate), §19.2, §19.3, §25.2]

> **Chunk-size posture:** C14 lists 9 files, above the ≤5-files heuristic. The chunk is intentionally kept whole because every file represents one cohesive logical responsibility — *the build-closeout sweep that proves the build is locked-in and merge-ready*. Splitting (e.g., gates vs docs vs ADR) would force two PRs that both land at the same time anyway (gates without doc-sync = unmergeable per `chatgpt-pr-review` and `feature-coordinator` enforcement; doc-sync without gates = no enforcement of the contracts being documented). Plan-review round 1 R3 was triaged as auto-apply-with-rationale: keep cohesive, justify the exception explicitly. The chunk passes the chunk-size rule on the OR-clause (≤1 logical responsibility) of "≤5 files OR ≤1 logical responsibility".

**Files to create or modify:**

- `scripts/gates/verify-sandbox-classification.sh` — NEW. Grep gate. Fails if any task-dispatch code path that takes customer input or LLM output reaches an execution call that is not `SandboxExecutionService.runTask`. Pattern-set similar to PR #267 B.4 Pass 4.
- `scripts/gates/verify-sandbox-minimum-events.sh` — NEW. Three-pass grep gate per spec §14.5: pre-start failure paths must emit `sandbox_start_failed`; post-start-without-output-read paths must emit `sandbox_start` + `sandbox_terminal`; post-start-with-output-read paths must emit `sandbox_start` + `sandbox_terminal` + (`output_validated` | `output_validation_failed`).
- `scripts/gates/verify-template-version-coherence.sh` — NEW. **Scope: `infra/sandbox-templates/synthetos-sandbox/` only in V1. The gate explicitly excludes `infra/sandbox-templates/openclaw-session/`** (and any other future template directories) until the owning adapter spec activates them. The exclusion is implemented as a hard-coded scan-path list at the top of the script, not a glob — adding a new template directory is an explicit one-line gate edit. (F3 fix, plan-review round 2.) Verifies the five-field shape on `CURRENT_VERSION` + matching git tag prefix + `PUBLISHED_VERSION` attestation present within 24h grace window + `version` agreement.
- `scripts/gates/verify-no-sandbox-cost-update.sh` — NEW. Grep gate. Fails if any `.ts` file contains `update(llmRequests)` / `db.update(llmRequests)` against the sandbox source-type rows.
- `scripts/gates/verify-no-inline-sandbox-outside-test.sh` — NEW. Grep gate. Fails if `inlineSandbox` import / construction appears outside `.test.ts` / `__tests__/` paths.
- `architecture.md` — MODIFY. New section "Sandbox Isolation primitive — `SandboxExecutionService`" under the Layer 4 / Execution Backends area. Includes the §7.2 execution classification table reproduced. Cross-link from the `iee_dev` adapter description to the new section. Per spec §11 (doc-sync) + spec §19.3.
- `docs/capabilities.md` — MODIFY. New row under "Agency capabilities": sandbox-backed Tier 4 execution. Vendor-neutral phrasing per CLAUDE.md "no e2b in customer-facing copy". Per spec §19.3.
- `docs/env-manifest.json` — MODIFY (single canonical pass, R2 fix plan-review round 2 — was previously split between C4 and C14). Add all five Spec B env-vars in one commit: `SANDBOX_PROVIDER` (required, enum: `e2b | local_docker | inline`), `SANDBOX_ALLOW_INLINE` (test-only flag, gates the `inlineSandbox` constructor — see C4), `E2B_API_KEY` (required when `SANDBOX_PROVIDER='e2b'`), `E2B_PROJECT_PROD`, `E2B_PROJECT_STAGING`. Per spec §19.3.
- `docs/decisions/0009-sandbox-execution-service.md` — NEW (proposed ADR per spec §28 #8). Captures: vendor-adapter pattern, `SandboxExecutionService` boundary, no-silent-fallback decision. Optional per spec §19.3 — authored at architect's judgement here because the build reaffirms the decision is ADR-worthy.
- `KNOWLEDGE.md` — MODIFY (post-implementation, captured patterns).

**Module shape:**

- *Public interface this chunk exposes:* five new bash gate scripts (each callable individually by CI) + four updated docs.
- *What stays hidden behind it:* the grep patterns inside each gate (grep-based gates per PR #267 / PR #275 precedent); the documentation prose; the ADR rationale.

**Contracts:**

- All five gates are CRLF-safe per DEVELOPMENT_GUIDELINES §5 ("Strip CRLF when parsing files on Windows" — the `guard-utils.sh` jq wrapper already does this; new scripts replicate).
- All five gates pipe through `grep -v "import type"` per DEVELOPMENT_GUIDELINES §5 ("Grep-based gates must skip `import type` lines").
- All five gates are blocking gates — added to the CI workflow's gate-suite list.
- The five gates conform to the gate-authoring rules in DEVELOPMENT_GUIDELINES §5 (self-test fixtures, scan-path overrides, calibration constants, `actionType` regex pattern, etc.).

**Error handling strategy:** N/A — gates are bash scripts; CI handles failure surfacing.

**Testing requirements:** none authored at the test-file layer. The gates are themselves the tests for this chunk's invariants. CI runs all five.

**Acceptance criteria:** lint pass on the bash scripts (no `shellcheck` errors); each gate's grep patterns match the spec's intended invariant via inspection; `architecture.md` lints cleanly (the long-doc-guard hook for `.md` is on Write, not Edit; the architecture.md additions are scoped); `docs/capabilities.md` honours the editorial rules (vendor-neutral, marketing-ready, model-agnostic) per CLAUDE.md; the ADR is authored to the template at `docs/decisions/_template.md`; `KNOWLEDGE.md` patterns are appended (never edited).

---

## 6. Risks and mitigations

### 6.1 Top 5 implementation risks

| # | Risk | Likelihood | Impact | One-sentence mitigation |
|---|---|---|---|---|
| 1 | **e2b SDK contract assumptions are unverified — none of the e2b code is in the repo today.** The spec assumes the SDK exposes file API, terminate API, metadata-tag API, network-policy hooks, and a `timeout` parameter. If any of these don't match the actual SDK shape, C9 stalls. | Medium | High | C9's first task is to install the e2b SDK and verify the assumed surface against the SDK reference — any mismatch is surfaced as a spec amendment via the spec-reviewer's reserved 5th iteration before C9 builds further. |
| 2 | **C12 → C13 ordering is mandatory and easy to violate accidentally.** C13 (`iee_dev` rewiring) compiles fine without C12's template, but at runtime refuses `template_version === 'latest'` per spec §15.3. If C13 lands without C12 deployed, every customer execution fails immediately. | Medium | High | C13's pure tests assert `classifyExecutionClass` produces non-`'latest'` templates; the C14 `verify-template-version-coherence` gate enforces the dependency at PR-merge time; C11a's `sandboxCeilingMonitorJob` reads `max_cost_cents_per_second` from C12 — its failure-to-build is a blocking signal that C12 isn't done. |
| 3 | **`iee_dev` hard-cut migration (no feature flag) means a missed task-type classification breaks production for that task on Day 0.** Spec §18.3 explicitly forbids a feature flag; the dry-run script in C13 is the only safety net. | Medium | High | The dry-run script in C13 (`scripts/migrations/sandbox-isolation-classification-dry-run.ts`) re-classifies every historical task type and asserts the new classification matches expectation; the C14 `verify-sandbox-classification` grep gate enforces at PR-merge time; revert-on-failure is the rollback per spec §18.3 (`commit_and_revert` model). |
| 4 | **Cost-ledger partial unique index posture (no UPDATE ever) means an off-by-one in `correction_sequence` allocation produces a `23505` that the harvest pipeline isn't structured to retry.** The spec mandates correction rows be insert-only; allocation strategy isn't pinned in the spec — the C7 builder must implement it correctly first time. | Low | Medium | C7's correction-row writer extracts `allocateCorrectionSequence(executionId): Promise<number>` as a documented helper; first attempt uses `coalesce(max(correction_sequence)+1, 1)` subquery within the INSERT (mirrors spec §28 #1's telemetry-sequence pattern); `23505` on the partial unique catches the rare race; pure tests cover the allocation logic; the C14 `verify-no-sandbox-cost-update` gate enforces the no-UPDATE invariant at the file-level. |
| 5 | **RLS posture across five new tables — organisation-boundary at policy + subaccount filtering at service — relies on the service-layer filter being applied at every read path. A single missed filter leaks subaccount-A's sandbox telemetry to subaccount-B inside the same org.** | Medium | High | All five tables enter `RLS_PROTECTED_TABLES` in C1b, picked up automatically by `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh`; reads go through dedicated service readers (e.g., `sandboxExecutionServiceReader`) per spec §21.4; the existing `verify-rls-contract-compliance` gate rejects raw `db.select().from(sandbox*)` outside approved readers; spec §8.20 deferred-enforcement-log pattern applies to any subaccount-filter site that ships without a runtime assertion (logs `guarded: false` so the gap is audit-discoverable). |

### 6.2 Additional risks (informational)

- **Spec C race condition on `redaction.ts`.** Both specs extend `DEFAULT_REDACTION_PATTERNS`. Spec B's plan assumes second-to-merge posture; if Spec B lands first, the rebase is mechanical (Spec C appends). Mitigation: spec §26.1 + §26.2.
- **`sandbox_logs` row volume could be high under heavy stdout.** A single sandbox emitting 10 MB of stdout at 80 chars/line ≈ 130k rows. The 90d retention via `sandboxLogsPruneJob` (C11b) keeps the table bounded; no warm-side aggregation needed in V1 per spec §17.3.
- **e2b project tagging is the only multi-tenancy boundary in V1.** Decision 1 locked this; if metadata tags are mis-applied (e.g., wrong `org_id` on a tag), the `e2bSandbox` constructor's tagging code is the single point of failure. Mitigation: C9 implements tagging via a pure-helper `composeSandboxTags(input)` that pure tests cover exhaustively.

---

## 7. Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

### 7.1 Per-chunk verification commands

Every chunk's "Verification commands" surface is the same minimal set (per CLAUDE.md / DEVELOPMENT_GUIDELINES):

- `npm run lint`
- `npm run typecheck` (or `npx tsc --noEmit`)
- `npm run build:server` when the chunk touches server code (every chunk except C1a, C12)
- `npm run build:client` only when the chunk touches client code (no chunk in this plan does)
- `npm run db:generate` when the chunk creates / modifies a Drizzle schema (C1b, C3)
- Targeted execution of unit tests authored in THIS chunk: `npx vitest run <path-to-test>` for the file(s) listed in the chunk's "Testing requirements" section. Tests authored under this plan use Vitest (`import { test, expect } from 'vitest'`) — never `node:test`, `node:assert`, or `npx tsx`-runnable harnesses, per `docs/testing-conventions.md`.

### 7.2 Build sequencing

The dependency graph in §4.2 is the build order. The recommended local-development sequence is (**must match §4.2 / §4.4 — F2 fix, plan-review round 2**):

1. C1a (types) — first; everything else can begin in parallel after C1a lands. C1b (schemas + migrations) in parallel with C2 (FailureReason) in parallel with C3 (`llm_requests` extension) in parallel with C4 (provider resolver + inlineSandbox + registration seam) in parallel with C12 (template + CI publish + parser).
2. C5 (service skeleton + pure helpers) — depends on **C1b, C2, C4** (C5 imports inferred row types from C1b's `sandboxExecutions.ts` for the lease state machine — C5 must wait for C1b, not just C2 / C4).
3. C6 (output schema + redaction wiring) — depends on C5.
4. C7 (harvest pipeline) — depends on C3, C6, C1b.
5. C8 (provider wrapper) — depends on C2, C5.
6. C9 (e2bSandbox) and C10 (localDockerSandbox) — depend on **C5, C8, C12** (each provider resolves `template_digest` / `local-dev-{commitShort}` via C12's `templateVersionParserPure.ts`; C9 and C10 also register their concrete provider into C4's resolver seam at module init — F1 / F3 fixes). Parallelisable with each other.
7. C11a (execution-scoped jobs) — depends on **C7, C8, C9, C10, C12** (C11a registers the concrete pg-boss handler for the enqueue seam declared by C8 — see C8 / C11a detail).
8. C11b (retention jobs) — depends on C1b. Parallelisable with C11a.
9. C13 (`iee_dev` adapter rewiring) — depends on C5, C9, C10, C12.
10. C14 (CI gates + doc-sync) — depends on all of C1a..C13.

### 7.3 Pre-existing violation handling

Per CLAUDE.md, the architect does not run gates locally to baseline. Any pre-existing violation suspected to interact with the planned work has been identified by static reasoning above (§3 open questions). None block C1-C13. CI will catch any baseline violation missed in the plan when the PR is opened.

### 7.4 Chunk completion definition

A chunk is "done" when:

1. All listed files exist with the documented module shape.
2. `npm run lint` + `npm run typecheck` pass cleanly.
3. `npm run build:server` (or build:client where applicable) passes cleanly.
4. The chunk's targeted pure unit tests pass via single-file `npx vitest run`.
5. Commits are local; the operator commits explicitly before pushing.

### 7.5 G1 gate per chunk

Per the pipeline spec, every chunk's builder runs G1 = lint + typecheck + build:server (and build:client where touched) + targeted pure unit tests for new pure functions in that chunk. CI handles the full gate suite at PR-merge time.

### 7.6 Chunk-level acceptance ties to the spec acceptance criteria

Each chunk's acceptance criteria matches a slice of the spec's §29 self-consistency pass result. The spec's 25 brief §6 invariants are distributed across chunks via the `spec_sections:` field on each chunk. The C14 doc-sync sweep verifies all 25 invariants are reflected in the implementation.

---

**End of plan. Ready for plan-gate operator review.**
