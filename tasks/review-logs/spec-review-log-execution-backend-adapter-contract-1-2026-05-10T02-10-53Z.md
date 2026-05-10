# Iteration 1 — execution-backend-adapter-contract

**Date:** 2026-05-10
**Spec commit at start:** a2384ec7f79743df30ccf758844f06af36f2b703
**Codex output:** tasks/review-logs/_codex_spec_review_execution-backend-adapter-contract_iter1_2026-05-10T02-10-53Z.txt

## Findings classification

### Codex findings
| # | Section | Severity | Class | Disposition |
|---|---|---|---|---|
| 1 | §4.1, §8.2, §9 | critical | mechanical | accept — loadTerminalState missing from interface |
| 2 | §4.1, §9.1, §13.5 | critical | mechanical | accept — finalise() pure-vs-DB-writing contradiction |
| 3 | §2/§4.4/§8.1/§10.3/§17 | important | mechanical | accept — preferred_backends contradictory semantics |
| 4 | §8.1, §10.3, §12 | important | mechanical | accept — resolve() sync-vs-DB-read contradiction |
| 5 | §3, §4.3–§4.4, §19 | important | mechanical | accept — executionMode/backend_id precedence missing |
| 6 | §4.3, §13.4 | important | mechanical | accept — IEE event payload alias not documented |
| 7 | §4.1, §13.1–§13.5 | important | mechanical | accept — delegated dispatch orphan-task contract missing |
| 8 | §11 vs §18 | minor | mechanical | accept — file-inventory drift on registration file |

### Rubric findings (my own pass)
| # | Section | Class | Disposition |
|---|---|---|---|
| R1 | §4.1 | mechanical | accept — referenced types not cited |
| R2 | §13.4 | mechanical | accept — queue-ownership rule needed declarative validation field |
| R3 | §11/§18 | mechanical | accept — ieeRuns.ts missing from inventory after F7 added 'parent_orphaned' |

## Mechanical changes applied

**§0 / §2 / §3 / §4.4 / §10.3 / §12 / §17 — preferred_backends consolidation (F3):**
Goal #6 rewritten as schema-only V1; existing-primitives table updated; column-shape table updated; §10.3 explicit "schema-only — registry.resolve does not read"; §12 RLS narrative updated; §17 risk mitigation rewritten.

**§4.1 — interface tightening (F1, F2, R1, R2):**
Added "Type origins" subsection citing every referenced type. Added `loadTerminalState?(tx, backendTaskId)` to delegated lifecycle. Replaced finalise()'s "Pure — must not touch DB" comment with "MUST use input.tx; MUST NOT open its own transaction". Added `tx: Transaction` to BackendFinalisationInput. Added `terminalStateTable: string | null` field. Added Transaction import.

**§4.3 — source-of-truth (F5, F6):**
Pg-boss event payload bullet rewritten to document the IEE alias path (existing queue keeps `{ ieeRunId, ... }` shape; handler derives backendId from task_type) while generic delegated backends use `{ backendId, backendTaskId }`. Added "Adapter selector precedence" subsection (executionMode canonical at dispatch; backend_id derived snapshot at delegation; divergence logged as backend.selector_mismatch).

**§4.5 — worked example (F1, F2, R2):**
IEE adapter sample now declares terminalStateTable: 'iee_runs' and a loadTerminalState body; finalise body comment notes tx is consumed from input.

**§8.1 / §8.2 — registry (F1, F4, R2):**
resolve(mode: ExecutionMode): ExecutionBackend (sync, no organisationId arg). Phase 3.5+ extension point named. Validation now requires loadTerminalState + terminalStateTable for delegated adapters; added BackendQueueOwnershipViolation rule.

**§9.1 — finaliser (F1, F2, F4):**
Body updated: `executionBackendRegistry.resolve(args.backendId)` (no org arg); calls `loadTerminalState(tx, ...)`; passes `tx` into `finalise({...})`. Comment block names the FOR UPDATE behaviour.

**§11 — components affected (F8, R3):**
Boot-registration row pinned to `server/index.ts`. Dispatch row signature updated. Added `server/db/schema/ieeRuns.ts` row for failureReason union extension.

**§13.1 — idempotency (F7):**
Delegated dispatch posture upgraded to "state-based + key-based" with mechanism column pointing at new §13.1.1. Finaliser row names `loadTerminalState(tx)` + `loadParentRun(tx)` mechanisms. Reconcile row notes orphan-task filter requirement.

**§13.1.1 NEW — Delegated dispatch sequence + orphan-task contract (F7):**
Added 3-step sequence (create backend task → guarded parent UPDATE → orphan cleanup on 0-rows) plus reconciliation orphan-skip rule. Adapted Codex's idempotency-key suggestion to the existing IEE `iee_runs.idempotency_key` UNIQUE pattern rather than introducing a new key format. Added `'parent_orphaned'` to IEE failureReason TS union (no SQL migration).

**§13.4 — terminal event guarantee (F6, R2):**
Shared-queue note expanded with handler discrimination via `iee_runs.task_type`. Queue-ownership rule made declarative via `terminalStateTable` field; failure mode named.

**§14 / §15 / §16 — phase plan, tests, acceptance (F1, F4, R2):**
Chunk 5 cutover code sample uses `resolve(effectiveMode)`. registryPure.test.ts description enumerates new validation rules; removed stale "preferredBackends overrides" assertion. Acceptance #7 expanded for new validation rules.

**§18 — file inventory (R3):**
Added `server/db/schema/ieeRuns.ts` to Modified list.

## Rejected / reclassified findings

None.

## Iteration 1 Summary

- Mechanical findings accepted:  11 (Codex: 8, Rubric: 3)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0

Spec is materially tighter: the contract is now self-contained (loadTerminalState + tx ownership named on the interface), preferred_backends posture is consistent across §0/§3/§4/§10/§12/§17, the executionMode-vs-backend_id precedence is explicit, the IEE event-payload alias is documented, and the orphan-task contract closes the dispatch idempotency gap. No findings required HITL.
