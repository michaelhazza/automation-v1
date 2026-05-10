**Status:** ready_for_build
**Plan date:** 2026-05-10
**Reviewed:** 2026-05-10 (ChatGPT plan review — F1–F6 + R1–R4 applied)
**Author:** architect (subagent)
**Build slug:** execution-backend-adapter-contract
**Spec:** `tasks/builds/execution-backend-adapter-contract/spec.md` (locked 2026-05-10)
**Branch:** `claude/sandbox-execution-provider-DLfjn`

# ExecutionBackend Adapter Contract — Implementation Plan

## Contents

- [Executor notes (read first)](#executor-notes-read-first)
- [Model-collapse check](#model-collapse-check)
- [Architecture notes](#architecture-notes)
- [Stepwise implementation plan](#stepwise-implementation-plan)
  - [Chunk 1 — Contract + types + registry (no consumers)](#chunk-1--contract--types--registry-no-consumers)
  - [Chunk 2 — Migration + schema columns](#chunk-2--migration--schema-columns)
  - [Chunk 3 — IEE adapters + finaliser generalisation](#chunk-3--iee-adapters--finaliser-generalisation)
  - [Chunk 4 — Native + claude-code adapters](#chunk-4--native--claude-code-adapters)
  - [Chunk 5 — Cutover + cron rename + alias removal](#chunk-5--cutover--cron-rename--alias-removal)
- [UX considerations](#ux-considerations)
- [Cross-chunk traceability matrix](#cross-chunk-traceability-matrix)
- [Self-consistency pass](#self-consistency-pass)
- [End of plan](#end-of-plan)

---

## Executor notes (read first)

- This is a **structural refactor**. Behaviour change is **none** for V1. Cutover (Chunk 5) is the only commit where behaviour can diverge; every prior chunk lands the new abstraction beside the existing dispatch ladder without removing it.
- **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**
- Each chunk's "Verification commands" section lists only `npm run lint`, `npm run typecheck`, `npm run build:server` (when relevant), `npm run db:generate` (Chunk 2), and targeted `npx vitest run <path-to-test>` for tests this chunk authors.
- Use `tasks/builds/execution-backend-adapter-contract/progress.md` to track session state. Update on context handovers and before `/compact`.

---

## Model-collapse check

The three pre-plan questions from the playbook:

1. *Does this feature decompose into ingest → extract → transform → render?* No. This is an internal refactor of a synchronous dispatch ladder into a registry-resolved adapter call. No content pipeline.
2. *Is each step doing something a frontier multimodal model could do in a single call?* No. Every step is deterministic code paths (DB writes, pg-boss enqueues, type checks). LLMs are out of scope for the refactor itself.
3. *Can the whole pipeline collapse into one model call with a structured-output schema?* No. The work is structural typing, table column additions, and physical reorganisation of code into adapter files. A frontier model cannot dispatch a delegated agent run to pg-boss.

**Decision: reject collapse — not applicable.** This is mechanical refactoring of dispatch wiring. No model call is involved at any decision point in V1.

---

## Architecture notes

### Key design decisions

1. **One interface, optional methods gated by `capabilities`** — not a discriminated union of three lifecycle interfaces. Spec § 4.1 *Why a single ExecutionBackend interface* documents the rationale. Decision is locked at spec time; the plan inherits it. Effect: registry returns a single `ExecutionBackend` shape; capability validation is a runtime check at registration.

2. **Adapter owns ALL writes for its lifecycle** — both the backend-task creation AND the parent `agent_runs` UPDATE happen inside the adapter's `dispatch()` body for delegated lifecycles. The dispatch site never writes `agent_runs` for delegated runs (Chunk 5 cutover). Locked in spec § 4.1 / § 13.1.1. Plan must preserve this — see Chunk 3.

3. **Neutral type file (`agentExecutionTypes.ts`)** — extracts `LoopResult` (and a new `TokenBudget` alias — see "Adjustments to spec" below) so `executionBackends/types.ts` does not depend on `agentExecutionService.ts`. Without the extraction the import graph cycles: `executionBackends/types.ts -> agentExecutionService.ts -> executionBackends/registry.ts -> executionBackends/types.ts`.

4. **`ExecutionBackendId` is a forward-compat superset of `ExecutionMode`** — registry resolves on the wider type so finalisation/reconciliation paths reading `agent_runs.backend_id` (which is `text`) type-check cleanly without a cast. V1 invariant: every registered `id` is a current `ExecutionMode` value; OpenClaw IDs (`'openclaw_managed'` / `'openclaw_external'`) are reserved type slots and rejected at runtime registration in V1.

5. **Two writes, one transaction at finalisation; two writes, two storage systems at dispatch** — finalisation (parent UPDATE + adapter-owned columns) commits atomically inside `input.tx`. Dispatch (backend task creation + parent UPDATE) cannot be atomic across pg-boss + DB; the spec § 13.1.1 sequence (task first, parent second, orphan-cleanup third) is the contract. Adapters MUST follow this order.

6. **Cron rename includes a one-cycle unschedule shim** — `boss.unschedule('maintenance:iee-main-app-reconciliation')` runs at boot for one release after Chunk 5 lands. Operator removes the unschedule call after the next deploy confirms the old schedule entry is gone. Risk § 17 #2.

7. **Schema-only `organisations.preferred_backends` jsonb** — no V1 reader. Lands now to avoid a Phase 3.5+ migration. Any future writer MUST introduce Zod validation against the documented `Map<ExecutionMode, ExecutionBackendId>` shape at the same time it introduces the write.

8. **Patterns selected vs rejected** — single-responsibility adapter modules (one file per `executionMode`), composition over inheritance (no abstract base class — `ExecutionBackend` is a structural interface; adapters export plain const objects), adapter pattern in the strict GoF sense (each `xxxBackend.ts` adapts an existing concrete dispatch path to the `ExecutionBackend` shape). Inheritance hierarchies and visitor pattern were considered for the "two adapters share a body" case (`api`/`headless`) and rejected — an internal helper consumed by both adapter files is simpler and matches the existing codebase convention.

### Adjustments to spec (verified ground-truth)

These are not departures from the spec's intent — they are clarifications discovered during the file-level inspection that the plan must address explicitly so the executor does not guess.

- **`TokenBudget` is currently inline `number`.** Spot-check of `agentExecutionService.ts:580` confirms `tokenBudget: number;` in `LoopParams`; there is no exported `TokenBudget` type in the file today. **Plan action:** in Chunk 1, define `export type TokenBudget = number;` in `server/services/agentExecutionTypes.ts` so the contract has a stable name. The relocation cost is zero (no existing consumer references a named alias today), and the alias matches the spec § 4.1 type-origins table claim.

- **`PromptAssembly` is not an exported type from `agentRunPromptService.ts`.** Spot-check confirms only `PersistAssemblyInput` and `PersistAssemblyOutput` are exported; the prompt shape consumed by `runAgenticLoop` is the inline `string | { stablePrefix: string; dynamicSuffix: string }` declared in `LoopParams`. **Plan action:** in Chunk 1, define `export type PromptAssembly = string | { stablePrefix: string; dynamicSuffix: string };` in `server/services/agentExecutionTypes.ts`. Update `agentRunPromptService.ts` to **re-export** the alias for spec § 4.1 type-origin alignment but **do not** rename the existing `PersistAssemblyInput`/`PersistAssemblyOutput` — those are a different shape (persistence input, not the in-memory prompt).

- **`LoopResult` IS an existing private interface** (`agentExecutionService.ts:2628`). Standard relocation per spec § 4.1 *Neutral type file*. The original site re-exports the alias for backwards-compat with current consumers.

- **`agent_runs.executionMode` TS union** is already declared in `server/db/schema/agentRuns.ts:41` as `'api' | 'headless' | 'claude-code' | 'iee_browser' | 'iee_dev'`. Reuse `ExecutionMode` from `shared/types/executionEnvironment.ts` (canonical per spec § 4.1 type-origins table). **Both declarations exist today** — `shared/types/executionEnvironment.ts:15` and the schema column type. The plan keeps both untouched and asserts in the contract test that they are structurally equal.

### Import graph (high-level)

```
shared/runStatus.ts                                +
shared/types/executionEnvironment.ts               |
server/db/schema/agentRuns.ts                      |
server/db/schema/ieeRuns.ts                        |
server/db/index.ts (Transaction)                   |
                                                   v
server/services/agentExecutionTypes.ts (NEW)
                          |
                          v
server/services/executionBackends/types.ts (NEW)
server/services/executionBackends/options.ts (NEW)
                          |
                          v
server/services/executionBackends/registry.ts (NEW)
                          |
   +------+-------+-------+----------+--------------+
   v      v       v                  v              v
apiBackend headlessBackend claudeCodeBackend ieeBrowserBackend ieeDevBackend
   |       |
   +-------+
       v
server/services/agentExecutionLoop.ts (NEW, Chunk 4)
       ^
       | (also imported by)
server/services/agentExecutionService.ts (Chunk 5 cutover)
                                         |
                                         v
                          server/services/agentRunFinalizationService.ts
                                         |
                                         v
                          server/jobs/ieeRunCompletedHandler.ts
                          server/services/queueService.ts (cron)
                          server/services/agentExecutionService.ts (Chunk 5 cutover)
                          server/index.ts (boot registration)
```

**Cycle prevention** — `executionBackends/types.ts` is downstream of `agentExecutionTypes.ts` only; it MUST NOT import from `agentExecutionService.ts`. After F5's `agentExecutionLoop.ts` extraction, the broader rule is: `executionBackends/*Backend.ts` MUST NOT import from `agentExecutionService.ts` — all loop-runtime imports go through `agentExecutionLoop.ts`. Asserted by acceptance criterion #12 + a module-source check at the top of `contractPure.test.ts`. Verified at PR by: `grep -rn "from.*agentExecutionService" server/services/executionBackends/` → zero matches.

### Risks (summary — full mitigations under each chunk)

| Risk | Source | Severity | Mitigation owner |
|---|---|---|---|
| Cutover regresses one of five modes | Chunk 5 | High | Chunk 1 contract tests + Chunk 3 IEE-behind-existing-dispatch + manual smoke at Chunk 5 |
| Cron rename double-fires | Chunk 5 | Medium | Boot-time `boss.unschedule('maintenance:iee-main-app-reconciliation')` for one release |
| Import cycle reintroduced silently | Chunk 1 | Medium | Module-source assertion in `contractPure.test.ts` (§ 16 acceptance criterion #12) |
| Two IEE adapters double-process shared `iee_runs` | Chunks 3, 5 | Medium | Per-adapter `WHERE iee_runs.type = 'browser'` / `= 'dev'` filter on `reconcile()`; asserted in `registryPure.test.ts` |
| Pre-cutover in-flight delegated runs orphan | Chunk 2 deploy | Low | No-backfill design — IEE handler derives `backendId` from `iee_runs.type`; pure test pins it (§ 16 #14) |
| `agent_runs.backend_id` writes via wrong adapter | Chunk 3, 4, 5 | Low | `BackendOptionsMismatch` thrown as first statement of every `dispatch()`; per-adapter pure test required (§ 16 #13) |
| `preferred_backends` jsonb shape drift | Future | Low | Schema-only in V1; first writer must add Zod validation in same PR |

---

## Stepwise implementation plan

Five chunks. Forward-only dependencies. Chunks 3 and 4 are independently reviewable; both must merge before Chunk 5.

```
Chunk 1 (contract types + registry) -> Chunk 2 (migration + schema) -> Chunk 3 (IEE adapters + finaliser rename) -+
                                                                  +-> Chunk 4 (api/headless/claude-code adapters) -+-> Chunk 5 (cutover + cron rename + alias removal)
```

A Standard plan would compress Chunks 1 and 2 into one chunk; this plan splits them because Chunk 1 lands runtime-untestable type files, while Chunk 2 lands a migration that must `npm run db:generate` cleanly.

---

### Chunk 1 — Contract + types + registry (no consumers)

**spec_sections:** § 3, § 4.1, § 4.2, § 4.3, § 8, § 11 (Types layer), § 14 Chunk 1, § 15 (Pure tests)

**Goal:** Author the contract, registry, options union, neutral type extractions, and pure tests. No production code path uses any of this yet — no production adapter registers in Chunk 1. The pure tests register in-memory mock adapters to validate registry behaviour, including resolving all five `ExecutionMode` values.

**Module shape**
- *Public interface this chunk exposes:* `ExecutionBackend` (interface), `ExecutionBackendId` / `ExecutionMode` types, `BackendOptions` (closed union), `BackendDispatchInput` / `BackendDispatchResult` / `BackendFinalisationInput` / `BackendFinalisationResult` / `BackendTerminalState`, the typed errors (`BackendOptionsMismatch`, `BackendNotRegistered`, `BackendCapabilityViolation`, `BackendQueueOwnershipViolation`, `BackendTaskAlreadyClaimed`, `ParentRunNotDispatchable`), and the `executionBackendRegistry` singleton with `register` / `resolve` / `forEach` / `forDelegated`.
- *What stays hidden behind it:* the internal `Map<ExecutionBackendId, ExecutionBackend>`, the per-adapter capability validation logic, the same-queue-different-storage check, and the in-memory mock adapter used only by tests.

**Files to create**
- `server/services/agentExecutionTypes.ts`
  - **Exports:** `TokenBudget` (alias `= number`), `LoopResult` (relocated interface — keep field names identical to existing `agentExecutionService.ts:2628`), `PromptAssembly` (`string | { stablePrefix: string; dynamicSuffix: string }`).
  - **Imports allowed:** none from `services/`. Schema imports allowed only as `import type` from `server/db/schema/*` if needed (none expected here).
  - **Why:** spec § 4.1 *Neutral type file*. Breaks the cycle.
- `server/services/executionBackends/types.ts`
  - **Exports:** `ExecutionCapability`, `CostModel`, `SandboxRequirement`, `BackendTerminalState`, `BackendDispatchInput`, `BackendDispatchResult`, `BackendFinalisationInput`, `BackendFinalisationResult`, `ExecutionBackend`, `ExecutionBackendId`, plus typed error classes `BackendOptionsMismatch`, `ParentRunNotDispatchable`, `BackendNotRegistered`, `BackendCapabilityViolation`, `BackendQueueOwnershipViolation`, `BackendTaskAlreadyClaimed`. Placeholder type aliases `BackendProgressEvent = unknown` and `UnsubscribeFn = () => void` for the deferred streaming capability (§ 19).
  - **Imports allowed:** `zod` (for `ZodSchema` typing), `import type` from `server/db/schema/ieeRuns`, `agentRuns`, `server/db/index` (`Transaction`), `server/services/agentExecutionTypes`. **MUST NOT** import from `agentExecutionService.ts` — enforced by test.
- `server/services/executionBackends/options.ts`
  - **Exports:** `BackendOptions` (closed discriminated union per spec § 4.2). Each variant carries `backendId: ExecutionMode` (V1 invariant) plus the existing per-mode options (`runSource`, `allowedToolSlugs`, `cwd`, `ieeTask`).
  - **Imports allowed:** `import type` from `server/services/ieeExecutionService` (for `BrowserTaskPayload | DevTaskPayload` types behind `IeeBrowserTaskInput` / `IeeDevTaskInput`), `shared/types/executionEnvironment` (for `ExecutionMode`).
- `server/services/executionBackends/registry.ts`
  - **Exports:** `class ExecutionBackendRegistry` (private map; `register(b)`, `resolve(id)`, `forEach(cb)`, `forDelegated()`), the `executionBackendRegistry` singleton.
  - **Validation logic in `register`:**
    1. `id` is a valid `ExecutionMode` value (V1-only restriction; OpenClaw ids rejected).
    2. If `capabilities` includes `'delegated'`: `completedEventQueue`, `terminalStateTable`, `completedEventPayload`, `loadTerminalState`, `finalise`, `reconcile` are all defined.
    3. If `capabilities` includes `'cancellation'`: `cancel` is defined.
    4. `sandboxRequirement` is one of the four enum members.
    5. **Same-queue-must-share-storage** — if another registered adapter declares the same `completedEventQueue`, both must declare the same `terminalStateTable`. Mismatch -> `BackendQueueOwnershipViolation`.
  - **`resolve(id)`** — `Map.get(id)`; `BackendNotRegistered` on miss.
  - **No I/O**, no DB access; pure registry.
- `server/services/executionBackends/__tests__/contractPure.test.ts`
  - In-memory mock adapter implementing every shape; capability-validation positive + negative cases; mismatch invariant on the mock (`dispatch()` throws `BackendOptionsMismatch` when `input.backendOptions.backendId !== this.id`); module-source assertion that `types.ts` does not import from `agentExecutionService.ts`.
- `server/services/executionBackends/__tests__/registryPure.test.ts`
  - Registration accepts valid adapters; rejects `'delegated'` without required methods (`BackendCapabilityViolation`); rejects same-queue + different-`terminalStateTable` pairs (`BackendQueueOwnershipViolation`); resolves every `ExecutionMode` value to its registered mock; rejects unregistered ids (`BackendNotRegistered`); shared-storage reconcile-scoping disjointness assertion against two mocks sharing a `terminalStateTable`.

**Module shape — types.ts public surface (executor reference)**

The full interface body is in spec § 4.1. The executor must port it verbatim, with these adjustments confirmed by ground-truth inspection:
- `TokenBudget` resolves to `number`; the alias is the contract surface, not the original type.
- `PromptAssembly` is the new alias defined in `agentExecutionTypes.ts`.
- `Transaction` is `Parameters<Parameters<typeof db.transaction>[0]>[0]` (already used inline in `agentRunFinalizationService.ts:54` as `TxLike`); export it from `server/db/index.ts` with a named alias `Transaction` for readability.

**Contracts**
- `BackendDispatchResult.lifecycle` is the closed set `'in_process' | 'delegated' | 'subprocess'` — never widened.
- Every adapter's `dispatch()` first statement: `if (input.backendOptions.backendId !== this.id) throw new BackendOptionsMismatch(this.id, input.backendOptions.backendId);` — asserted in pure tests AND per-adapter (Chunks 3 + 4).
- `loadTerminalState(tx, backendTaskId)` — adapter MUST take `FOR UPDATE` row lock; returns null when row missing.

**Error handling**
- All registration validation errors are typed (`BackendCapabilityViolation`, `BackendQueueOwnershipViolation`). Throwing strings is forbidden.
- `executionBackendRegistry.resolve(id)` throws `BackendNotRegistered`; never returns `undefined`. Callers narrow on the throw, not on a sentinel.
- Module-source check failure (cycle reintroduced) fails the contract pure test loudly with a clear assertion message naming the offending import.

**Test considerations**
- Tests live under `server/services/executionBackends/__tests__/`. Naming: `*Pure.test.ts` (forced by `verify-pure-helper-convention.sh`). Both files have zero transitive DB imports — verified by the gate at CI.
- Mock adapter inputs use minimal fixtures (no real DB rows). `BackendTerminalState` fields can be plain objects.

**Dependencies**
- None. This chunk lands first.

**Acceptance**
- § 16 #6 (new contract pure tests pass); § 16 #12 (no-circular-import rule); § 16 #13 partially (mock-level mismatch invariant — per-adapter coverage adds in Chunks 3 + 4).
- `npm run lint` + `npm run typecheck` pass.

**Verification commands**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/executionBackends/__tests__/contractPure.test.ts`
- `npx vitest run server/services/executionBackends/__tests__/registryPure.test.ts`

---

### Chunk 2 — Migration + schema columns

**spec_sections:** § 4.4, § 11 (Schema layer), § 13.6, § 14 Chunk 2, § 18

**Goal:** Add `agent_runs.backend_id`, `agent_runs.backend_task_id`, `organisations.preferred_backends`. Two partial indexes on `agent_runs`. Reversible. No backfill.

**Module shape**
- *Public interface this chunk exposes:* three new column reads on existing tables (`agentRuns.backendId`, `agentRuns.backendTaskId`, `organisations.preferredBackends`). No new TS types beyond the column types Drizzle infers.
- *What stays hidden behind it:* the migration mechanics (forward and down SQL); index naming conventions; `IF EXISTS` guards on the down file.

**Files to create**
- `migrations/<NNNN>_execution_backend_columns.sql` — **Use the next free migration number at implementation time.** Inspect `migrations/` for the current max before writing the filename. If main advances before merge, renumber the migration pair during final rebase. Never leave `<NNNN>` in committed filenames or SQL references.
  - Statements:
    ```sql
    ALTER TABLE agent_runs ADD COLUMN backend_id text;
    ALTER TABLE agent_runs ADD COLUMN backend_task_id text;
    CREATE INDEX agent_runs_backend_id_idx
      ON agent_runs (backend_id) WHERE backend_id IS NOT NULL;
    CREATE UNIQUE INDEX agent_runs_backend_task_unique_idx
      ON agent_runs (backend_id, backend_task_id) WHERE backend_task_id IS NOT NULL;
    ALTER TABLE organisations
      ADD COLUMN preferred_backends jsonb NOT NULL DEFAULT '{}'::jsonb;
    ```
  - **No RLS change.** `agent_runs` and `organisations` already have policies; new columns inherit them. Verify by reading `server/config/rlsProtectedTables.ts` — both tables are listed; `policyMigration` pointers stay unchanged.
- `migrations/<NNNN>_execution_backend_columns.down.sql` — sibling per repo convention. Every statement guarded:
    ```sql
    DROP INDEX IF EXISTS agent_runs_backend_task_unique_idx;
    DROP INDEX IF EXISTS agent_runs_backend_id_idx;
    ALTER TABLE agent_runs DROP COLUMN IF EXISTS backend_task_id;
    ALTER TABLE agent_runs DROP COLUMN IF EXISTS backend_id;
    ALTER TABLE organisations DROP COLUMN IF EXISTS preferred_backends;
    ```

**Files to modify**
- `server/db/schema/agentRuns.ts` — add column declarations + the two partial indexes:
    ```ts
    backendId: text('backend_id'),
    backendTaskId: text('backend_task_id'),
    // index block:
    backendIdIdx: index('agent_runs_backend_id_idx')
      .on(table.backendId)
      .where(sql`${table.backendId} IS NOT NULL`),
    backendTaskUniqueIdx: uniqueIndex('agent_runs_backend_task_unique_idx')
      .on(table.backendId, table.backendTaskId)
      .where(sql`${table.backendTaskId} IS NOT NULL`),
    ```
  - The TS type for `backendId` is `string | null` (no `$type` narrowing — adapter ids are dynamically resolved; `ExecutionBackendId` is wider than `ExecutionMode`).
- `server/db/schema/organisations.ts` — add:
    ```ts
    preferredBackends: jsonb('preferred_backends')
      .notNull()
      .default({})
      .$type<Record<string, string>>(),
    ```
  - **No Zod validator.** The column is schema-only in V1; first writer adds Zod in the same PR (risk § 17 #3).

**Contracts**
- The two indexes match § 13.6: non-unique on `(backend_id) WHERE backend_id IS NOT NULL`, unique on `(backend_id, backend_task_id) WHERE backend_task_id IS NOT NULL`. The unique index is the DB defence against two parent runs accidentally claiming the same backend task — surfaces as `23505` and is mapped by adapters in Chunks 3/4 to `BackendTaskAlreadyClaimed`.
- The migration is fully additive and nullable / defaulted; reversible. No backfill.

**Error handling**
- `npm run db:generate` is the executor's first verification — Drizzle should produce a clean diff for these three columns and two indexes only. Any other diff means an unrelated drift was introduced; revert the unrelated change.
- The down migration is `IF EXISTS` guarded so a re-run on a partially applied state is safe.
- RLS impact: none. Both tables already have org-isolation policies; new columns inherit. Verified by reading `server/config/rlsProtectedTables.ts` — `policyMigration` for `agent_runs` and `organisations` does not change.

**Test considerations**
- No new Vitest authoring in this chunk. Schema changes verified via `npm run db:generate` + manual diff inspection.
- Add a single existing-test sanity assertion in `agentRunDelegationFlow.test.ts` (if the test fixture inserts `agent_runs` with full column lists): the new columns default to `null`, so existing fixtures need no change. Confirm by reading the fixture before merging.

**Dependencies**
- Chunk 1 (no runtime dependency, but typecheck cleanliness is easier when types.ts is in place — `agentRuns.backendId` is `string | null`, not `ExecutionBackendId | null`, so no contract type is referenced).

**Acceptance**
- § 16 #9 (`backend_id`, `backend_task_id`, `preferred_backends` exist with the two partial indexes).
- `npm run db:generate` produces only the expected diff.

**Verification commands**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` — verify exactly the four schema-side additions show up in the generated SQL diff (three columns + two indexes).

---

### Chunk 3 — IEE adapters + finaliser generalisation

**spec_sections:** § 3, § 4.5, § 7 (IEE rows), § 9 (Finalisation + reconciliation), § 11 (IEE adapter rows), § 13.1.1, § 14 Chunk 3, § 15 (Integration tests + F2 fixture)

**Goal:** Author `ieeBrowserBackend.ts` and `ieeDevBackend.ts`. Move the existing `finaliseAgentRunFromIeeRun` body into the adapters' `finalise()` methods. Add the shared `finaliseAgentRunFromBackend` orchestrator and `reconcileBackends`. Keep legacy export names as aliases. Register IEE adapters at boot. Dispatch ladder in `agentExecutionService.ts` is **not** modified in this chunk.

**Module shape**
- *Public interface this chunk exposes:* `finaliseAgentRunFromBackend({ backendId, backendTaskId })`, `reconcileBackends()`, plus the two IEE adapter exports (`ieeBrowserBackend`, `ieeDevBackend`).
- *What stays hidden behind it:* the per-adapter mapping cells (existing `mapIeeStatusToAgentRunStatus`, `buildSummaryFromIeeRun`, `aggregateTokensForIeeRun`); the parent-row `FOR UPDATE` orchestration; the discriminator (`iee_runs.type`) used to scope reconciliation; the orphan-cleanup write (`failureReason = 'parent_orphaned'`).

**Files to create**
- `server/services/executionBackends/ieeBrowserBackend.ts`
  - **Exports:** `ieeBrowserBackend: ExecutionBackend`.
  - **Identity:** `id: 'iee_browser'`, `capabilities: ['delegated', 'browser_automation', 'cancellation']`, `costModel: 'per_token'`, `sandboxRequirement: 'browser'`.
  - **Delegated lifecycle slots:** `completedEventQueue: 'iee-run-completed'`, `terminalStateTable: 'iee_runs'`, `completedEventPayload: ieeRunCompletedPayloadSchema` (define the Zod schema in this file mirroring the existing `validatePayload` body in `ieeRunCompletedHandler.ts:51–71`).
  - **`dispatch(input)`:**
    1. First statement: `if (input.backendOptions.backendId !== 'iee_browser') throw new BackendOptionsMismatch('iee_browser', input.backendOptions.backendId);`
    2. Lift the body of `agentExecutionService.ts:1413–1473` (browser branch). Specifically: validate `ieeTask.type === 'browser'`, call `enqueueIEETask`, write the parent UPDATE (existing inline UPDATE at lines 1447–1453 — extend it to also write `backend_id = 'iee_browser'` and `backend_task_id = ieeRunId`), emit the `agent:run:delegated` websocket event, return `{ lifecycle: 'delegated', backendTaskId: ieeRunId, loopResult: null, deduplicated }`.
    3. **Orphan-cleanup (§ 13.1.1 step 3):** if the parent UPDATE returns 0 rows (parent already terminal), write `iee_runs.status = 'cancelled', failureReason = 'parent_orphaned'` (extend the `FailureReason` TS union — see schema modify list below) and throw `ParentRunNotDispatchable`.
  - **`loadTerminalState(tx, backendTaskId)`:** `tx.select().from(ieeRuns).where(eq(ieeRuns.id, backendTaskId)).for('update').limit(1)`; map result to `BackendTerminalState` shape (set `agentRunId`, `backendTaskId = id`, `status`, `failureReason`, `completedAt`, `eventEmittedAt`, `resultSummary` from `resultSummary` jsonb, `raw = ieeRun`). Returns null on no row.
  - **`finalise(input)`:** Lift the body of `agentRunFinalizationService.ts:198–389` minus the parent-loading block (which moves into the shared caller). Specifically: scope by `terminalState.raw as IeeRun`, call existing pure helpers, perform the `agent_runs` UPDATE through `input.tx` (not the global `db`), perform the `iee_runs.eventEmittedAt = now()` UPDATE through `input.tx`, return `{ finalised: true, parentTerminalStatus }`. Idempotency: if `input.parentRun.status` is in `TERMINAL_RUN_STATUSES` AND `terminalState.eventEmittedAt !== null`, return `{ finalised: false, parentTerminalStatus: input.parentRun.status }` without writing.
  - **`reconcile()`:** Lift `reconcileStuckDelegatedRuns` body, scope by `WHERE iee_runs.type = 'browser'`, call `finaliseAgentRunFromBackend({ backendId: 'iee_browser', backendTaskId: ieeRun.id })` per row. Returns count transitioned. `LIMIT 100`.
  - **`cancel({ runId, backendTaskId })`:** Lift existing `cancelIeeRun` call — implement as a thin pass-through that the cancellation route can call once it migrates to the registry path.
- `server/services/executionBackends/ieeDevBackend.ts`
  - **Exports:** `ieeDevBackend: ExecutionBackend`. Mirror of `ieeBrowserBackend` with `id: 'iee_dev'`, `capabilities: ['delegated', 'code_execution', 'cancellation']`, `sandboxRequirement: 'code_execution'` (declared, not enforced — Spec B). Body delegates to a shared internal helper for `dispatch`/`finalise`/`loadTerminalState` parameterised by `type: 'browser' | 'dev'`. **Filter on `reconcile()`:** `WHERE iee_runs.type = 'dev'` to avoid double-processing rows that the browser adapter also scans.
- (Optional) `server/services/executionBackends/_ieeShared.ts` — internal helper consumed by both IEE adapter files. Use only if the duplication between the two IEE adapters exceeds ~30 lines; otherwise inline. Executor decides at authoring time.

**Files to modify**
- `server/services/agentRunFinalizationService.ts`
  - **Add** `export async function finaliseAgentRunFromBackend(args: { backendId: ExecutionBackendId; backendTaskId: string }): Promise<boolean>` — body per spec § 9.1: resolve adapter, open `db.transaction(async (tx) => …)`, call `loadTerminalState` (FOR UPDATE), load parent (`FOR UPDATE`), call adapter's `finalise(input)`. Move `loadParentRun(tx, agentRunId)` into a private helper inside this file (lift the `tx.select().from(agentRuns).where(eq(agentRuns.id, ...)).for('update').limit(1)` block).
  - **Add** `export async function reconcileBackends(): Promise<{ total: number; perBackend: Partial<Record<ExecutionBackendId, number>> }>` — body per spec § 9.2.
  - **Keep** existing `finaliseAgentRunFromIeeRun(ieeRun: IeeRun)` exported as a thin alias delegating to `finaliseAgentRunFromBackend({ backendId: ieeRun.type === 'browser' ? 'iee_browser' : 'iee_dev', backendTaskId: ieeRun.id })`. Removed in Chunk 5.
  - **Keep** existing `reconcileStuckDelegatedRuns(): Promise<number>` exported as alias returning `reconcileBackends().total`. Removed in Chunk 5.
- `shared/iee/failureReason.ts` (single source of truth for the `FailureReason` union per `server/db/schema/ieeRuns.ts:7`)
  - Extend the `FailureReason` TS union to include `'parent_orphaned'`. **No SQL migration** — `failure_reason` is a `text` column. Spec § 13.1.1 last paragraph confirms.
- `server/jobs/ieeRunCompletedHandler.ts`
  - Replace the call `await finaliseAgentRunFromIeeRun(ieeRun);` with:
    ```ts
    const backendId = ieeRun.type === 'browser' ? 'iee_browser' : 'iee_dev';
    await finaliseAgentRunFromBackend({ backendId, backendTaskId: ieeRun.id });
    ```
  - Keep the existing `validatePayload` shape but **re-import** the canonical Zod schema from `ieeBrowserBackend.ts` (or its shared file) so the adapter and the handler share one source of truth.
- `server/index.ts`
  - In the existing IEE handler block (lines 648–659), insert immediately AFTER `registerIeeRunCompletedHandler` registration:
    ```ts
    const { executionBackendRegistry } = await import('./services/executionBackends/registry.js');
    const { ieeBrowserBackend } = await import('./services/executionBackends/ieeBrowserBackend.js');
    const { ieeDevBackend } = await import('./services/executionBackends/ieeDevBackend.js');
    executionBackendRegistry.register(ieeBrowserBackend);
    executionBackendRegistry.register(ieeDevBackend);
    ```
  - **Boot ordering invariant** (spec § 8.3): Adapter registration MUST occur before any call that can start pg-boss, register workers, or consume jobs. If the current IEE handler block calls `getPgBoss()` before the proposed insertion point, place adapter registration immediately before that block instead of after it. Read `server/index.ts:648–700` before writing the registration block and insert it in the position that satisfies this invariant — do not leave the decision to build time.
- `server/services/__tests__/agentRunFinalizationServicePure.test.ts` (existing)
  - Update internal calls from `finaliseAgentRunFromIeeRun` to `finaliseAgentRunFromBackend({ backendId, backendTaskId })`.
  - **Add F2 legacy-fallback case** (acceptance § 16 #14): fixture seeds an `iee_runs` row of `type: 'browser'` and an `agent_runs` parent with `backendId IS NULL` (pre-cutover state); calls the IEE handler-equivalent code path; asserts the parent terminal UPDATE writes the expected status. Do NOT seed `agent_runs.backendId` in the fixture.

**Contracts**
- `finaliseAgentRunFromBackend` is the only public entry. The two aliases (`finaliseAgentRunFromIeeRun`, `reconcileStuckDelegatedRuns`) exist for one chunk only and are removed in Chunk 5.
- The IEE adapter's `finalise()` body is the existing `finaliseAgentRunFromIeeRun` body **lifted unchanged minus row-loading** (which moves into the shared caller). Verbatim translation; no logic change.
- Parent terminal UPDATE inside `finalise()` MUST go through `input.tx` — never the global `db`. This is the atomic-commit guarantee (§ 4.1, § 13.5).

**Error handling**
- `finaliseAgentRunFromBackend` resolves the registry; missing adapter -> `BackendNotRegistered` thrown. Caller (handler / cron) logs and returns; the run rolls back. pg-boss retries per `getJobConfig`.
- Adapter `finalise()` throws on data anomalies (e.g. `terminalState.agentRunId` is null but spec says it must be set) using typed error messages; the orchestrator's `db.transaction()` aborts and the caller sees the throw.
- Pre-existing `assertValidTransition` call inside the existing finaliser body MUST move into the adapter's `finalise()` (it gates the parent UPDATE).
- **Pre-existing violation watch:** the existing `finaliseAgentRunFromIeeRun` calls `db.transaction` and writes through `db` directly. When the body moves into the IEE adapter, the adapter's `finalise()` MUST write through `input.tx`, not `db`. A search-and-replace pass on `tx.update(agentRuns)` / `tx.update(ieeRuns)` confirms the migration succeeded.

**Test considerations**
- Existing `agentRunDelegationFlow.test.ts` integration test (Vitest) MUST pass unchanged. The test exercises the dispatch path (still uses the old if/else) -> IEE worker -> handler -> `finaliseAgentRunFromIeeRun` (alias) -> new shared caller -> IEE adapter's `finalise()`. Behaviour is unchanged.
- F2 legacy-fallback fixture is the new pure test case (§ 16 #14).
- Per-adapter `BackendOptionsMismatch` assertion (§ 16 #13): add a minimal dispatch fixture in `registryPure.test.ts` calling `ieeBrowserBackend.dispatch({ ..., backendOptions: { backendId: 'iee_dev', ieeTask: ... } })` and asserting `BackendOptionsMismatch` is thrown. Repeat for `ieeDevBackend`.

**Dependencies**
- Chunks 1 + 2 must be merged. The adapters import from `executionBackends/types.ts` (Chunk 1) and write to `agent_runs.backendId` / `agent_runs.backendTaskId` (Chunk 2 columns).

**Acceptance**
- § 16 #4 (existing IEE integration test passes unchanged); § 16 #5 (existing finalisation pure test passes after rename); § 16 #11 (no regression on existing API/headless/claude-code paths — they still take the if/else); § 16 #14 (F2 legacy-fallback fixture).

**Verification commands**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/agentRunFinalizationServicePure.test.ts`
- `npx vitest run server/services/executionBackends/__tests__/registryPure.test.ts`

---

### Chunk 4 — Native + claude-code adapters

**spec_sections:** § 7 (api/headless/claude-code rows), § 11 (Adapter rows), § 14 Chunk 4

**Goal:** Author `apiBackend.ts`, `headlessBackend.ts`, `claudeCodeBackend.ts`. Each lifts its existing dispatch body. Register at boot. Dispatch ladder in `agentExecutionService.ts` is **still not modified** — adapters are registered but not called from dispatch yet.

**Module shape**
- *Public interface this chunk exposes:* the three adapter exports (`apiBackend`, `headlessBackend`, `claudeCodeBackend`).
- *What stays hidden behind it:* the shared internal helper (`_apiHeadlessShared.ts`) consumed by both `api` and `headless` adapters; the per-mode `LoopParams` construction (spec § 7 *api/headless shared body* note); the claude-code subprocess invocation details (already encapsulated by `claudeCodeRunner.execute`).

**Files to create**
- `server/services/executionBackends/apiBackend.ts`
  - **Exports:** `apiBackend: ExecutionBackend`.
  - **Identity:** `id: 'api'`, `capabilities: ['in_process']`, `costModel: 'per_token'`, `sandboxRequirement: 'none'`. All delegated slots null / undefined.
  - **`dispatch(input)`:**
    1. Mismatch check: `if (input.backendOptions.backendId !== 'api') throw new BackendOptionsMismatch(...)`.
    2. Body lifted from `agentExecutionService.ts:1522–1632` (default branch — `runAgenticLoop` invocation with `executionMode: 'api'` trace metadata).
    3. Returns `{ lifecycle: 'in_process', backendTaskId: null, loopResult, deduplicated: false }`.
- `server/services/executionBackends/headlessBackend.ts`
  - **Exports:** `headlessBackend: ExecutionBackend`.
  - **Identity:** `id: 'headless'`, otherwise identical to `apiBackend` save for the trace-metadata `executionMode` value.
  - Body delegates to a shared helper in `_apiHeadlessShared.ts` parameterised by mode.
- `server/services/executionBackends/_apiHeadlessShared.ts` — internal (underscore-prefixed) helper. Not exported from any index. The two adapter files are each ~20 lines wrapping the shared body.
- `server/services/executionBackends/claudeCodeBackend.ts`
  - **Exports:** `claudeCodeBackend: ExecutionBackend`.
  - **Identity:** `id: 'claude-code'`, `capabilities: ['subprocess', 'terminal_repo']`, `costModel: 'subscription'`, `sandboxRequirement: 'terminal_repo'`. No delegated slots.
  - **`dispatch(input)`:**
    1. Mismatch check.
    2. Body lifted from `agentExecutionService.ts:1474–1521` (claude-code branch — `claudeCodeRunner.execute` invocation, build `LoopResult`).
    3. Returns `{ lifecycle: 'subprocess', backendTaskId: null, loopResult, deduplicated: false }`.

**Files to modify**
- `server/index.ts` — extend the registration block (added in Chunk 3) to also register the three new adapters:
    ```ts
    const { apiBackend } = await import('./services/executionBackends/apiBackend.js');
    const { headlessBackend } = await import('./services/executionBackends/headlessBackend.js');
    const { claudeCodeBackend } = await import('./services/executionBackends/claudeCodeBackend.js');
    executionBackendRegistry.register(apiBackend);
    executionBackendRegistry.register(headlessBackend);
    executionBackendRegistry.register(claudeCodeBackend);
    ```
  - **Boot ordering invariant** applies here too (see Chunk 3): all five adapter registrations must land before any pg-boss start or worker call. Verify the insertion point in `server/index.ts` satisfies the Chunk 3 boot-order invariant.
- `server/services/agentExecutionLoop.ts` (NEW) — Extract `runAgenticLoop` and its direct support types/helpers (`LoopParams` and any helpers called only by the loop body) out of `agentExecutionService.ts` into this neutral sibling module. Both `agentExecutionService.ts` and `executionBackends/apiBackend.ts` / `headlessBackend.ts` import from this module. **Rationale:** exporting `runAgenticLoop` from `agentExecutionService.ts` while the adapters are in turn imported by `agentExecutionService.ts` (via the registry cutover in Chunk 5) creates the runtime cycle `agentExecutionService → registry → apiBackend → agentExecutionService`. The neutral module breaks the cycle without requiring any logic change.
- `server/services/agentExecutionService.ts` — remove the inline `runAgenticLoop` definition (now in `agentExecutionLoop.ts`); replace internal calls with imports from `agentExecutionLoop.ts`. All existing callers outside this file that previously imported `runAgenticLoop` from `agentExecutionService.ts` are updated to import from `agentExecutionLoop.ts` instead.

**Contracts**
- All three adapters return `loopResult: LoopResult` for the dispatch-site post-completion finalisation block to consume (§ 4.1). Caller (Chunk 5) reads `dispatchResult.loopResult` when `lifecycle !== 'delegated'`.
- The mismatch invariant is asserted per-adapter in pure tests (acceptance § 16 #13).
- `executionBackends/*Backend.ts` MUST NOT import from `agentExecutionService.ts`. All loop-runtime imports go through `agentExecutionLoop.ts`. Verified by grep at PR review.

**Error handling**
- Lifted bodies preserve existing error handling verbatim. The `runAgenticLoop` throws are re-thrown unchanged; the dispatch site continues to wrap with the existing `ExecutionModeNotAllowedForAgentError` guard at the boundary above dispatch — Chunk 5 cutover takes care of preserving that wrap.
- No new error codes introduced in this chunk.

**Test considerations**
- Each adapter file gets a per-adapter mismatch fixture (§ 16 #13) — consolidate into `registryPure.test.ts` (one assertion per adapter, using a stub `dispatch()` invocation that throws before any work).
- No integration test for these adapters in Chunk 4 — the dispatch ladder still routes through the if/else, so the existing API / headless / claude-code integration tests exercise the old path. Cutover (Chunk 5) is what flips the surface.

**Dependencies**
- Chunk 1 (registry, types, and contract must exist before the adapter files can be authored). Chunk 2 and Chunk 3 are NOT prerequisites — Chunk 4 does not touch IEE adapters or schema columns. Chunks 3 and 4 are independent and can be reviewed in parallel. Chunk 5 is the only chunk that requires both 3 and 4 to be merged first.

**Acceptance**
- § 16 #11 (no regression on API/headless/claude-code paths — they still take the old path).
- § 16 #13 per-adapter mismatch invariant covered for `apiBackend`, `headlessBackend`, `claudeCodeBackend`.
- All five `executionMode` values now have a registered adapter in the registry — § 16 #3 partially (full satisfaction comes in Chunk 5 when dispatch resolves through the registry).

**Verification commands**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/executionBackends/__tests__/registryPure.test.ts`

---

### Chunk 5 — Cutover + cron rename + alias removal

**spec_sections:** § 4.3 *Adapter selector precedence*, § 9.2, § 14 Chunk 5, § 16 #1 / #2 / #8 / #15

**Goal:** Replace the dispatch ladder with the registry call. Rename the cron. Remove the legacy aliases. This is the only chunk where behaviour can diverge — the test plan (manual smoke + integration tests) exists to catch divergence.

**Module shape**
- *Public interface this chunk exposes:* unchanged from Chunk 1 — the registry contract is final at Chunk 1; Chunk 5 only switches the dispatch site to consume it.
- *What stays hidden behind it:* the lifted `if/else if/else` ladder is gone; the post-completion block continues to consume `LoopResult` from `dispatchResult.loopResult` for `in_process` / `subprocess` lifecycles.

**Files to modify**
- `server/services/agentExecutionService.ts`
  - **Replace lines 1408–1521** (the `if/else if/else` dispatch ladder + the inline parent UPDATE for IEE) with:
    ```ts
    const effectiveMode = request.executionMode ?? 'api';
    const backend = executionBackendRegistry.resolve(effectiveMode);
    const dispatchResult = await backend.dispatch({
      runId: run.id,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? null,
      agentId: request.agentId,
      promptAssembly: typeof fullSystemPrompt === 'string'
        ? fullSystemPrompt
        : { stablePrefix, dynamicSuffix },
      tokenBudget,
      maxToolCalls,
      timeoutMs,
      backendOptions: buildBackendOptionsForMode(effectiveMode, request),
    });
    if (dispatchResult.lifecycle === 'delegated') {
      // Adapter has already updated parent: status='delegated', backend_id, backend_task_id.
      // COPY this return object verbatim from the current IEE branch (pre-cutover lines 1447–1521).
      // Only two fields differ from the existing shape:
      //   ieeRunId              <- dispatchResult.backendTaskId
      //   delegationDeduplicated <- dispatchResult.deduplicated
      // Do NOT invent new fields or default counters — key-set drift is a silent regression.
      return { /* executor: copy exact key set from current IEE branch */ };
    }
    let loopResult: LoopResult = dispatchResult.loopResult!;
    // ... existing post-completion finalisation block continues unchanged.
    ```
  - **Add** a private helper `buildBackendOptionsForMode(mode: ExecutionMode, request: AgentRunRequest): BackendOptions` that returns the typed options (existing fields: `runSource`, `allowedToolSlugs`, `cwd`, `ieeTask`). This function MUST be an exhaustive `switch` over `ExecutionMode` with a `never` check on the default case. It MUST NOT read DB state or organisation preferences — pure function, mode in, options out.
  - **Add** the necessary imports: `executionBackendRegistry`, `BackendOptions`.
  - The `ParentRunNotDispatchable` thrown by IEE adapters (§ 13.1.1 step 3) MUST be caught at this boundary and treated as "log + return early" (no 5xx). Wrap the `await backend.dispatch(...)` in a `try/catch` that maps the typed error to the existing race-loser response shape.
- `server/services/queueService.ts:1160`
  - Rename the cron: `'maintenance:iee-main-app-reconciliation'` -> `'maintenance:backend-reconciliation'`.
  - Update the worker function (the `boss.work` registration that consumes this queue) to call `reconcileBackends()` instead of `reconcileStuckDelegatedRuns()`.
  - **Add at boot** (one release shim): `await boss.unschedule('maintenance:iee-main-app-reconciliation').catch(() => undefined);` — the unschedule call is a no-op on a fresh deploy; on the first boot after Chunk 5 lands it cleans the old schedule entry. `catch` swallows the "schedule not found" case so a second deploy after the operator removes the line is safe.
  - Document inline that the unschedule call is removed in the next release after the cutover.
- `server/services/agentRunFinalizationService.ts`
  - **Remove** the `finaliseAgentRunFromIeeRun` alias export.
  - **Remove** the `reconcileStuckDelegatedRuns` alias export.
- `server/jobs/ieeRunCompletedHandler.ts`
  - Already updated in Chunk 3. No change in Chunk 5.
- `server/index.ts`
  - Already updated in Chunks 3 + 4. No change in Chunk 5.
- `architecture.md`
  - Update `§ Execution modes` section: replace the "branches in agentExecutionService" description with "adapter implementations registered in `executionBackendRegistry`". Keep the five `executionMode` values listed.
- `docs/openclaw-strategic-analysis.md`
  - Mark Phase 1 complete on landing. Single-line update in the Phase 1 marker.
- `tasks/builds/sandbox-and-executionbackend-strategy/brief.md`
  - Mark Decision 2 implemented. Single-line update.

**Contracts**
- After Chunk 5 lands, `grep -n "if (effectiveMode === 'iee_browser'" server/services/agentExecutionService.ts` returns zero matches (§ 16 #1).
- `grep -n "if (effectiveMode === 'claude-code')" server/services/agentExecutionService.ts` returns zero matches (§ 16 #2).
- `grep -R "finaliseAgentRunFromIeeRun\|reconcileStuckDelegatedRuns" server --exclude-dir=node_modules` returns zero matches (§ 16 #15).
- `executionBackendRegistry.resolve(mode)` is the only dispatch path. The dispatch site no longer writes `agent_runs` for delegated runs — the adapter owns that write.

**Error handling**
- `BackendNotRegistered` is unreachable in production after Chunk 5 — every `ExecutionMode` value has a registered adapter (Chunk 4 + Chunk 3). If the registry resolution fails, treat as a 500 (programmer error) per spec § 8.1.
- `ParentRunNotDispatchable` is the orphan-cleanup path. The catch block MUST map to the exact existing race-loser / already-terminal response shape currently returned by the pre-cutover dispatch path, if one exists. If no existing shape exists, rethrow and document the behaviour in the PR — do not invent a silent success response (no 5xx, no panic).
- `BackendOptionsMismatch` is unreachable in production — `buildBackendOptionsForMode` constructs options keyed on the resolved adapter id. The adapter still asserts the invariant per § 4.1; double-check is intentional (adapter contract integrity > caller convention).

**Test considerations**
- All five integration tests must pass: API path, headless path, claude-code path, IEE browser path, IEE dev path.
- Existing `agentRunDelegationFlow.test.ts` exercises the IEE delegation path through the registry. It MUST pass without modification — the assertion surface is identical because the underlying SQL writes are identical.
- Manual smoke (operator, post-deploy):
  - One IEE browser run end-to-end on Replit dev.
  - One `api` run.
  - One `claude-code` run.
- Cron-rename verification: post-deploy, query pg-boss `schedule` table:
    ```sql
    SELECT name FROM pgboss.schedule WHERE name LIKE 'maintenance:%';
    ```
  - `maintenance:backend-reconciliation` is present; `maintenance:iee-main-app-reconciliation` is absent.

**Dependencies**
- Chunks 1–4 must be merged. The cutover commit is the last commit in the build slug.

**Acceptance**
- § 16 #1 (grep returns zero for `iee_browser` if-branch).
- § 16 #2 (grep returns zero for `claude-code` if-branch).
- § 16 #3 (all five values resolve via registry).
- § 16 #8 (cron rename — `maintenance:backend-reconciliation` registered, old absent).
- § 16 #11 (no regression on existing modes — verified by integration tests + manual smoke).
- § 16 #15 (alias removal complete).
- **Return-shape parity:** delegated, api/headless, and claude-code dispatch result shapes are key-for-key copies of the pre-cutover branches. PR review must include a before/after diff of returned object keys for each branch.

**Verification commands**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/executionBackends/__tests__/contractPure.test.ts`
- `npx vitest run server/services/executionBackends/__tests__/registryPure.test.ts`
- `npx vitest run server/services/__tests__/agentRunFinalizationServicePure.test.ts`
- `grep -rn "from.*agentExecutionService" server/services/executionBackends/` → zero matches expected (no backend adapter may import `agentExecutionService.ts`).
- Manual operator commands (post-deploy):
  - `grep -n "if (effectiveMode === 'iee_browser'" server/services/agentExecutionService.ts` -> 0 matches expected.
  - `grep -n "if (effectiveMode === 'claude-code')" server/services/agentExecutionService.ts` -> 0 matches expected.
  - `grep -R "finaliseAgentRunFromIeeRun\|reconcileStuckDelegatedRuns" server --exclude-dir=node_modules` -> 0 matches expected (operator runs at PR review and again after merge — § 16 #15).

---

## UX considerations

None. This is a pure backend refactor with no user-visible surface change. No UI changes, no new endpoints, no permission changes. § 12 of the spec confirms no new tenant-scoped tables and no route surface modification.

---

## Cross-chunk traceability matrix

| Acceptance criterion (spec § 16) | Chunk |
|---|---|
| #1 Grep `iee_browser` if-branch returns zero | 5 |
| #2 Grep `claude-code` if-branch returns zero | 5 |
| #3 Five `executionMode` values resolve via registry | 4 (registration), 5 (dispatch) |
| #4 IEE integration test passes unchanged | 3 (during transition), 5 (after cutover) |
| #5 Finalisation pure test passes after rename | 3 |
| #6 New contract pure tests pass | 1 |
| #7 Boot-time validation rejects invalid adapters | 1 |
| #8 Cron `maintenance:backend-reconciliation` registered, old absent | 5 |
| #9 New columns + indexes exist | 2 |
| #10 architecture.md + openclaw-strategic-analysis.md updated | 5 |
| #11 No regression on API / headless / claude-code paths | 5 (integration + smoke) |
| #12 No-circular-import rule (F3) | 1, 4 |
| #13 Per-adapter mismatch invariant (F5) | 3 (IEE adapters), 4 (api / headless / claude-code) |
| #14 Legacy in-flight fallback (F2) | 3 |
| #15 Alias removal complete (P1) | 5 |

Every acceptance criterion is owned by exactly one chunk for first satisfaction; § 16 #4 and § 16 #11 are re-verified at Chunk 5 to catch cutover-induced regressions.

---

## Self-consistency pass

- **Goals (§ 2) ↔ Implementation.** Goal 1 (replace dispatch ladder) -> Chunk 5. Goal 2 (refactor five modes into adapters) -> Chunks 3 + 4. Goal 3 (generalise finaliser) -> Chunk 3. Goal 4 (generalise cron) -> Chunk 5. Goal 5 (capability/cost/sandbox metadata) -> Chunks 1 + 3 + 4 (declared, not consumed). Goal 6 (per-org `preferred_backends`) -> Chunk 2 (schema only). Goal 7 (forward-compat `auth_type` / `sandboxRequirement`) -> Chunk 1 (slots + enum). All seven map.
- **Non-goals (§ 2).** Routing, health-check, streaming, backfill, OpenClaw adapter, Sandbox interface, Operator Session schema — none appears in any chunk.
- **Single source of truth claims.** Spec § 4.3 declares the precedence; Chunk 3 + 5 both honour it (handler re-loads `iee_runs` before calling finaliser; adapter writes `backend_id` and `backend_task_id` from the same UPDATE that transitions `agent_runs.status`).
- **Forward dependency check.** Every chunk references columns, types, or services introduced in equal-or-earlier chunks. No backward references.
  - Chunk 2's schema columns are referenced by Chunk 3's IEE adapter `dispatch()` and by Chunk 5's cutover.
  - Chunk 1's contract types are imported by Chunks 3 and 4 adapters.
  - Chunk 3's `finaliseAgentRunFromBackend` is consumed by Chunk 5's cron rename.
  - Chunks 3 and 4 are independent (one adapter group does not import from the other).
- **Test-gate compliance.** Each chunk's "Verification commands" lists only `lint`, `typecheck`, `build:server` (where relevant), `db:generate` (Chunk 2), and targeted `npx vitest run <path>`. No `npm run test:gates`, no `scripts/verify-*.sh`, no `scripts/run-all-*.sh`. Per `CLAUDE.md § Test gates are CI-only` and `references/test-gate-policy.md`.
- **Pre-existing violations.** Two flagged in "Adjustments to spec" above (TokenBudget = inline `number`; PromptAssembly does not exist as exported type). Chunk 1 fixes both by introducing the named aliases. No other pre-existing violations expected to interact with this work.

---

## End of plan

Ready for build. Operator switches to Sonnet for execution per `CLAUDE.md § Model guidance per phase`.
