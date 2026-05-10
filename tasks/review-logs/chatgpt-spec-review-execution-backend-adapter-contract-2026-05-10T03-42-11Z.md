# ChatGPT Spec Review Session — execution-backend-adapter-contract — 2026-05-10T03-42-11Z

## Session Info
- Spec: `tasks/builds/execution-backend-adapter-contract/spec.md`
- Branch: `claude/sandbox-execution-provider-DLfjn`
- PR: #281 — https://github.com/michaelhazza/automation-v1/pull/281
- Mode: manual
- Started: 2026-05-10T03:42:11Z

---

## Round 1 — 2026-05-10T03-42-11Z

### ChatGPT Feedback (raw)

> First pass: the spec is strong structurally. I'm seeing a few contract-shape inconsistencies rather than directional problems, mostly around future backend IDs, singular/plural metadata naming, and how much runtime enforcement V1 actually promises.
>
> Reviewed the spec. Overall: strong architecture and close to lockable, but I would not lock it yet. I found 5 required fixes and 5 recommended tightenings before handoff.
>
> **Required fixes before locking**
>
> **F1. ExecutionMode vs future backend_id is type-inconsistent.** The spec says `ExecutionBackend.id` is typed as `ExecutionMode`, and the registry is `Map<ExecutionMode, ExecutionBackend>`. But later it says backend_id may diverge from executionMode (e.g. openclaw_managed vs openclaw_external). That future path cannot work with the current type shape. Fix: introduce a separate type now: `export type ExecutionBackendId = ExecutionMode | 'openclaw_managed' | 'openclaw_external';` Then use `readonly id: ExecutionBackendId; private readonly backends = new Map<ExecutionBackendId, ExecutionBackend>(); resolve(id: ExecutionBackendId): ExecutionBackend;`. For V1, dispatch still resolves only from ExecutionMode, but finalisation and reconciliation can safely resolve from backend_id.
>
> **F2. In-flight delegated runs conflict with the "no backfill" claim.** The spec says no historical agent_runs backfill, and any in-flight delegation at deploy time continues to work. But §4.3 also says finalisation/reconciliation uses agent_runs.backend_id, and that backend_id is always populated for delegated rows. That is false for in-flight IEE rows created before this migration. Fix: add a legacy fallback rule: IEE event handler continues deriving backendId from iee_runs.type. IEE reconciliation must scan iee_runs, not rely on agent_runs.backend_id. backend_id is required only for delegated rows created after Chunk 5 cutover. Add a test case: pre-cutover IEE run with agent_runs.backend_id IS NULL still finalises correctly. This protects the no-backfill promise.
>
> **F3. TokenBudget and LoopResult importing from agentExecutionService.ts creates a likely circular dependency.** The new types.ts references TokenBudget and LoopResult from agentExecutionService.ts, while agentExecutionService.ts will import the registry and adapter types. That is a circular dependency risk. Fix: extract shared execution types into a neutral file (e.g. `server/services/executionBackends/executionTypes.ts` or `server/services/agentExecutionTypes.ts`). Then both agentExecutionService.ts and adapter types import from that file. Acceptance criteria should include: no import from agentExecutionService.ts inside executionBackends/types.ts.
>
> **F4. Sandbox requirement wording contradicts V1 behaviour.** The SandboxRequirement comment says boot validation ensures missing dependencies surface as startup failures. But the spec also says iee_dev declares sandboxRequirement: 'code_execution' in V1, while enforcement only happens when Spec B lands. That would make V1 fail boot unless the sandbox primitive already exists. Fix: split validation into two levels: V1 registry validation: validates only that sandboxRequirement is a known enum value. Spec B validation: validates actual dependency availability and fails boot if a required sandbox primitive is missing. This preserves the "build now, do not act on" posture.
>
> **F5. BackendOptions.backendId can drift from ExecutionBackend.id.** The discriminated union uses backendId, but the contract does not state that input.backendOptions.backendId must equal backend.id. That leaves room for accidental mismatches like resolving iee_dev but passing iee_browser options. Fix: add a hard invariant: `dispatch()` MUST reject input where `input.backendOptions.backendId !== backend.id`. For future variants where backend.id may diverge from executionMode, define whether BackendOptions.backendId means executionMode or ExecutionBackendId. I would make it ExecutionBackendId. Add a registry or adapter pure test for mismatch rejection.
>
> **Recommended tightenings**
>
> **R1. Make (backend_id, backend_task_id) unique unless there is a reason not to.** The spec adds a non-unique partial index. A backend task should map to one parent run. Recommended: `CREATE UNIQUE INDEX agent_runs_backend_task_unique_idx ON agent_runs (backend_id, backend_task_id) WHERE backend_task_id IS NOT NULL;`. If duplicates are allowed, state explicitly. Otherwise uniqueness is safer.
>
> **R2. Clarify adapter registration order relative to pg-boss worker startup.** The spec says adapters register in server/index.ts after the existing IEE handler registration block. The key runtime requirement is stricter: All adapters MUST be registered before any pg-boss worker can consume a terminal event or reconciliation job. Add this as a boot invariant.
>
> **R3. Replace "empty / no-op finalise/reconcile" for non-delegated adapters.** §4.5 says non-delegated adapters have empty / no-op finalise and reconcile. But the interface says those are optional and mandatory only for delegated adapters. Better wording: Non-delegated adapters MUST set completedEventQueue, terminalStateTable, and completedEventPayload to null, and SHOULD omit loadTerminalState, finalise, and reconcile.
>
> **R4. Fix singular/plural naming drift.** Goal says sandboxRequirements, interface says sandboxRequirement. Goal says sandboxRequirements: ['code_execution'], type is a single string. Goal says "four existing dispatch branches" but the listed values are five modes.
>
> **R5. Check migration rollback convention.** §18 says the migration has a down-script in the same file. If this repo expects sibling .down.sql files, that will conflict with existing migration convention.
>
> **Suggested lock-note after fixes:** Once the above is patched, I'd mark this spec as accepted. The shape is otherwise solid: good separation between dispatch, delegated finalisation, reconciliation, future routing, sandbox, and operator session identity. The main thing to fix is the identity model now, because that is the seam future OpenClaw routing will rely on.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---|---|---|---|---|
| F1 — `ExecutionBackendId` distinct from `ExecutionMode` | technical | apply | apply (user approved as recommended) | high | High severity; reshapes the registry seam future OpenClaw and per-org routing will plug into. User approved "apply now" via AskUserQuestion. |
| F2 — Legacy in-flight rows + no-backfill explicit fallback | technical | apply | auto (apply) | medium | Internal contract clarification — handler/reconcile path already routes via `iee_runs.type`, but spec did not state legacy `backend_id IS NULL` is fine. Adds explicit clause + test case. |
| F3 — Circular dep via `TokenBudget`/`LoopResult` import | technical | apply | auto (apply) | medium | Real circular import in proposed file structure; relocate shared types to a neutral file. |
| F4 — `SandboxRequirement` two-level validation | technical | apply | auto (apply) | medium | Spec text contradicted "build, do not act on" posture. Split V1 (enum-only) vs Spec B (dependency check). |
| F5 — `dispatch()` rejects backendOptions mismatch | technical | apply | auto (apply) | medium | Defensive contract invariant; mismatched options should fail loudly. Internal. |
| R1 — UNIQUE partial index on `(backend_id, backend_task_id)` | technical | apply | auto (apply) | medium | One backend task → one parent run; uniqueness is the safer default and there is no documented dual case. |
| R2 — Adapter registration before any pg-boss worker | technical | apply | auto (apply) | medium | Boot-safety invariant; otherwise an early terminal event hits an unregistered adapter. Internal. |
| R3 — Non-delegated adapters: null fields + omit methods | technical | apply | auto (apply) | low | Internal interface wording; aligns §4.5 with §4.1 contract (and corrects mis-grouping of `iee_dev` as non-delegated). |
| R4 — Singular/plural + branch-count naming drift | technical | apply | auto (apply) | low | Naming alignment between Goals (§2) and contract types (§4.1). Polish, low risk. |
| R5 — Sibling `.down.sql` migration convention | technical | apply | auto (apply) | low | Repo convention verified by `ls migrations/ | grep down` — sibling files. Spec wording corrected. |

### Applied (auto-applied technical + user-approved escalation)

- [auto] **F2** — Added §4.3 *Legacy in-flight rows — no-backfill fallback* subsection. Documents that pre-cutover IEE rows with `agent_runs.backend_id IS NULL` continue to finalise via the IEE handler path (which derives `backendId` from `iee_runs.type`) and reconcile via per-adapter `iee_runs.type` filtering. Added §15 + §16 acceptance test for the NULL fixture.
- [auto] **F3** — Added §4.1 *Neutral type file (`agentExecutionTypes.ts`)* subsection. Type-origins table updated: `TokenBudget` and `LoopResult` now originate from the neutral file. Added new file to §11 Components affected and §18 Created. Added §16 acceptance criterion #12 (no import of `agentExecutionService.ts` from `executionBackends/types.ts`) and §15 contract-test assertion.
- [auto] **F4** — Rewrote `SandboxRequirement` JSDoc to split V1 (enum-only) vs Spec B (executor availability). §8.2 boot-time validation rule for `sandboxRequirement` references the Spec B carveout.
- [auto] **F5** — Added `dispatch()` mismatch invariant to the `ExecutionBackend` interface JSDoc. Added §4.2 BackendOptions.backendId semantics paragraph. Added §16 acceptance criterion #13 + §15 contract-test cases (positive + negative).
- [auto] **R1** — Changed `(backend_id, backend_task_id)` partial index to **UNIQUE**. Updated §4.4 column table, §13.6 unique-constraint mapping, §16 acceptance #9. Added typed `BackendTaskAlreadyClaimed` error for the impossible-but-defensive 23505 path.
- [auto] **R2** — Added §8.3 *Boot invariant — adapters registered before any pg-boss worker* subsection. Encodes the required ordering between adapter registration and `boss.start()`/queue worker registration.
- [auto] **R3** — Replaced §4.5 *empty / no-op* line with explicit per-adapter rules; corrected the misclassification of `iee_dev` (it IS delegated, sharing storage and queue with `iee_browser`).
- [auto] **R4** — Aligned §2 Goals wording: `sandboxRequirement` (singular) and `sandboxRequirement: 'code_execution'`. Replaced "four existing dispatch branches" with the accurate "five existing executionMode values share three physical dispatch branches."
- [auto] **R5** — Updated migration to sibling `<NNNN>_execution_backend_columns.down.sql` (verified against `ls migrations/ | grep down` — repo convention is sibling files). Migration filename templated as `<NNNN>` since main is at 0312.
- [user] **F1** — Introduced `ExecutionBackendId = ExecutionMode | 'openclaw_managed' | 'openclaw_external'`. `ExecutionBackend.id`, `Map`, `resolve()`, `finaliseAgentRunFromBackend.backendId`, and `reconcileBackends.perBackend` all rekeyed to `ExecutionBackendId`. V1 invariant: only `ExecutionMode` ids are registered (boot-time runtime guard `BackendCapabilityViolation` if anyone tries to register OpenClaw values). §4.3 selector-precedence updated; §17 risk #3 `preferred_backends` shape updated to `Map<ExecutionMode, ExecutionBackendId>`.

### Integrity check

Two stale references found and auto-fixed (both mechanical, `[auto]`):
- §4.1 type-origins table — typed-error list missing `BackendTaskAlreadyClaimed` introduced by R1's unique-index 23505 mapping. Added.
- §18 *Migrations:* trailing line — still referenced the original `0310_execution_backend_columns.sql` filename despite R5 templating it elsewhere. Updated to the `<NNNN>_…` templated form + sibling down-file mention.

No directional contradictions found. No forward references to renamed/removed sections. Pass.

---
