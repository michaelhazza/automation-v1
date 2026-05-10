# ChatGPT Spec Review Session — execution-backend-adapter-contract — 2026-05-10T03-42-11Z

## Session Info
- Spec: `tasks/builds/execution-backend-adapter-contract/spec.md`
- Branch: `claude/sandbox-execution-provider-DLfjn`
- PR: #281 — https://github.com/michaelhazza/automation-v1/pull/281
- Mode: manual
- Started: 2026-05-10T03:42:11Z
- Finalised: 2026-05-10T04:10:00Z
- **Verdict:** APPROVED (2 rounds, spec locked to `accepted`)

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

## Round 2 — 2026-05-10T04-00-00Z

### ChatGPT Feedback (raw)

> Round 2 result: mostly clean. I would apply 3 small tightenings, then lock. No major contract issues remain. The Round 1 fixes landed well, especially the ExecutionBackendId split, legacy in-flight fallback, neutral agentExecutionTypes.ts, and V1-vs-Spec-B sandbox validation distinction.
>
> **Required before lock**
>
> **F1. Fix "four existing modes" wording in Risks.** §17 Risk 1 still says "Refactoring the four existing modes into adapters..." but the spec now correctly frames this as five executionMode values sharing three physical branches elsewhere. Patch: "Refactoring the five existing executionMode values into adapters is a 'no behaviour change' claim..."
>
> **F2. Clarify BackendOptionsMismatch test scope.** The spec says every adapter's dispatch() must throw BackendOptionsMismatch on mismatched backendOptions.backendId, but the acceptance test only asserts this against an in-memory mock adapter. That proves the contract, not the five real adapters. Patch acceptance criterion 13 to: "Asserted once in contractPure.test.ts against an in-memory mock adapter, and asserted for all five concrete V1 adapters in their adapter-specific pure tests or registryPure test using a minimal dispatch fixture." Otherwise a real adapter could forget the first-line check while the mock test still passes.
>
> **F3. Tighten Record<ExecutionBackendId, number> typing.** §9.2 shows `Promise<{ total: number; perBackend: Record<ExecutionBackendId, number> }>` but V1 will only register five of the seven possible ExecutionBackendId values, so a total Record implies keys for openclaw_managed and openclaw_external exist too. Patch to `Partial<Record<ExecutionBackendId, number>>`.
>
> **Optional polish**
>
> **P1. Add a grep acceptance for no lingering old finaliser imports.** Since aliases are removed in Chunk 5, add: `grep -R "finaliseAgentRunFromIeeRun\|reconcileStuckDelegatedRuns" server --exclude-dir=node_modules`. Expected: zero matches after Chunk 5. This prevents the alias-removal claim from becoming partial.
>
> **P2. Make preferred_backends "no non-default writes" enforceable.** Risk 3 says any non-default writes are rejected at the API layer, but there is no V1 endpoint writing this column. Safer wording: "No V1 endpoint writes this column. Any future endpoint that writes it must introduce validation at the same time."
>
> **Lock recommendation:** After F1 to F3, I'd lock it. The spec now has the important contracts in place: no dispatch behaviour change, no in-flight IEE breakage, no circular type imports, no premature sandbox enforcement, and a clean forward seam for OpenClaw/operator-session routing.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---|---|---|---|---|
| F1 (R2) — "four existing modes" wording in §17 | technical | apply | auto (apply) | low | Mechanical wording carryover from pre-Round-1 phrasing — same fix family as R4 in Round 1. |
| F2 (R2) — Extend mismatch invariant test from mock to five adapters | technical | apply | auto (apply) | medium | Real-adapter coverage gap; mock test alone could pass while a real adapter forgets the first-line check. Internal test-coverage clarification. |
| F3 (R2) — `Partial<Record<ExecutionBackendId, number>>` typing | technical | apply | auto (apply) | low | Type narrowness — V1 registers 5 of 7 possible keys; `Partial<Record<…>>` is the precise type. |
| P1 — Grep acceptance for old finaliser imports | technical | apply | auto (apply) | low | Cheap belt-and-braces check that the alias removal is total. Enhances Chunk 5 verifier. |
| P2 — Preferred_backends API-layer wording | technical | apply | auto (apply) | low | Wording overstates the V1 enforcement mechanism (no endpoint exists). Replace with the accurate "future endpoints must add validation at the same time." |

### Applied (auto-applied technical)

- [auto] **F1 (R2)** — §17 Risk 1 wording: "four existing modes" → "five existing `executionMode` values" (carry-over fix from Round 1's R4 family).
- [auto] **F2 (R2)** — §16 acceptance criterion #13 + §15 `registryPure.test.ts` now require the mismatch invariant to be asserted **once on the mock AND once per concrete V1 adapter** (`apiBackend`, `headlessBackend`, `claudeCodeBackend`, `ieeBrowserBackend`, `ieeDevBackend`). Closes the "real adapter forgets the first-line check while mock test still passes" gap.
- [auto] **F3 (R2)** — `reconcileBackends()` return type tightened to `Partial<Record<ExecutionBackendId, number>>`. V1 only registers 5 of 7 possible keys; total `Record<…>` was over-narrow.
- [auto] **P1** — Added §16 acceptance criterion #15 + §14 Chunk 5 verifier: post-cutover `grep -R "finaliseAgentRunFromIeeRun\|reconcileStuckDelegatedRuns" server` returns zero matches. Cheap belt-and-braces check that the alias removal is total.
- [auto] **P2** — §17 Risk 3 (`preferred_backends`): replaced "any non-default writes are rejected at the API layer" with the accurate "No V1 endpoint writes this column. Any future endpoint that writes it MUST introduce Zod validation against the documented shape at the same time." Avoids implying a non-existent enforcement path.

### Spec lock

Status flipped `draft` → `accepted`. Locked 2026-05-10. End-of-spec footer updated with the full review trail (5 Codex iters + 2 ChatGPT rounds).

### Integrity check

Three targeted greps (Round 2 changes only):
- `four existing|four modes|four dispatch` → 0 matches (F1 propagated cleanly).
- `Record<ExecutionBackendId, number>` (without `Partial<…>` wrapper) → 0 matches outside the F3-fixed line; the only remaining occurrence is wrapped in `Partial<…>` per F3.
- `rejected at the API layer` → 0 matches (P2 propagated cleanly).

No directional contradictions. Pass.

---

## Final Summary

- Rounds: 2
- Auto-accepted (technical): 14 applied | 0 rejected | 0 deferred
- User-decided: 1 applied (F1 ExecutionBackendId type seam — "apply now") | 0 rejected | 0 deferred
- Index write failures: 0 (clean)
- Deferred to tasks/todo.md § Spec Review deferred items: none
- KNOWLEDGE.md updated: yes (2 entries — type-seam-for-future-variants, service-layer circular-import / neutral-types-file pattern)
- architecture.md updated: no — spec is forward-looking; the §IEE delegation lifecycle prose still describes current code accurately. Update is committed in the spec's §11 Components affected for the Chunk 5 cutover. Grep terms checked and found absent in current code: `executionBackendRegistry`, `ExecutionBackendId`, `agentExecutionTypes`, `finaliseAgentRunFromBackend`.
- capabilities.md updated: n/a — internal refactor only; no add / remove / rename of any product capability, agency capability, skill, or integration in this session.
- integration-reference.md updated: n/a — no integration behaviour change in this session.
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: n/a — no change to build discipline, agent fleet, review pipeline, or §8 development discipline.
- CONTRIBUTING.md updated: n/a — no change to lint-suppression policy or contributor conventions.
- spec-context.md updated: yes — `last_reviewed_at: 2026-05-09 → 2026-05-10` (framing verified current; no `accepted_primitives` change because the `executionBackendRegistry` primitive lands during the build, not at spec lock).
- frontend-design-principles.md updated: n/a — no UI surface in this spec.
- references/test-gate-policy.md updated: n/a — testing posture unchanged.
- references/spec-review-directional-signals.md updated: n/a — no new directional signal class surfaced.
- docs/decisions/ updated: n/a — durable choices captured in the spec itself + parent brief `tasks/builds/sandbox-and-executionbackend-strategy/brief.md § 3.6`. ADR not authored because the spec is the authoritative durable record.
- docs/context-packs/ updated: n/a — no architecture.md anchor changes in this session.
- .claude/FRAMEWORK_VERSION + .claude/CHANGELOG.md updated: n/a — repo-specific spec edit, not a framework-level change.
- PR: #281 — https://github.com/michaelhazza/automation-v1/pull/281

### Implementation readiness checklist (5/5 pass)

- ✅ All inputs defined — `BackendDispatchInput`, `BackendFinalisationInput` fully typed (§4.1).
- ✅ All outputs defined — `BackendDispatchResult`, `BackendFinalisationResult`, `BackendTerminalState`, `finaliseAgentRunFromBackend()` and `reconcileBackends()` return types declared.
- ✅ Failure modes covered — typed errors `BackendOptionsMismatch`, `ParentRunNotDispatchable`, `BackendNotRegistered`, `BackendCapabilityViolation`, `BackendQueueOwnershipViolation`, `BackendTaskAlreadyClaimed`. Idempotency posture per operation in §13.1; retry classification in §13.2; concurrency guard in §13.3.
- ✅ Ordering guarantees explicit — §13.1.1 four-step delegated dispatch sequence + reconciliation rule; §8.3 adapter-registration-before-pg-boss-workers boot invariant.
- ✅ No unresolved forward references — Round 1 + Round 2 integrity checks both pass.

Spec is implementation-ready.

### Cross-round consistency check

- Round 2 F1 extends Round 1 R4 (singular/plural drift family — caught a missed instance in §17 Risk 1). Refinement, not contradiction.
- Round 2 F2 strengthens Round 1 F5 acceptance criterion (mock-only → mock + 5 real adapters). Refinement.
- Round 2 F3 refines Round 1 F1's type signature for forward compatibility (`Record<…>` → `Partial<Record<…>>`). Refinement.
- Round 2 P1 + P2 add belt-and-braces to existing claims. No inversion of any prior decision.

No directional contradictions across rounds.
