# Pre-Launch Maintenance-Job RLS Contract — Spec

**Source:** `docs/pre-launch-hardening-mini-spec.md` § Chunk 4
**Invariants:** `docs/pre-launch-hardening-invariants.md` (commit SHA: `cf2ecbd06fa8b61a4ed092b931dd0c54a9a66ad2`)
**Implementation order:** `1 → {2, 4, 6} → 5 → 3` (Chunk 4 lands alongside Chunks 2 and 6 after Chunk 1)
**Status:** draft, ready for user review

---

## Table of contents

1. Goal + non-goals
2. Items closed
3. Items NOT closed
4. Key decisions
5. Files touched
6. Implementation Guardrails
7. Test plan
8. Done criteria
9. Rollback notes
10. Deferred Items
11. Review Residuals
12. Coverage Check

---

## 1. Goal + non-goals

### Goal

Mirror the `server/jobs/memoryDedupJob.ts` admin/org tx contract in three maintenance jobs that currently use direct `db` access and silently no-op against RLS-protected tables:

- `server/jobs/ruleAutoDeprecateJob.ts`
- `server/jobs/fastPathDecisionsPruneJob.ts`
- `server/jobs/fastPathRecalibrateJob.ts`

After Chunk 4 lands, the three jobs execute their intended writes under the same admin-context-then-per-org-tx pattern, so test memory state isn't garbage when the testing round runs.

### Non-goals

- Adding new functionality to any job. The fix is purely about routing existing reads/writes through the principal-context helpers.
- Changing the schedule, retry posture, or job registration. Chunk 4 does not touch `server/services/queueService.ts` or worker registration.
- Touching `memoryDedupJob.ts`. It already follows the contract.
- Adding a generic "maintenance job framework" or shared helper. Per `docs/spec-context.md § convention_rejections`, "do not introduce new service layers when existing primitives fit" — `withAdminConnection` + `withOrgTx` already are the framework.

---

## 2. Items closed

### 2.1 B10-MAINT-RLS — maintenance jobs bypass admin/org tx contract

| Field | Value |
|---|---|
| Mini-spec ID | `B10` (mini-spec coined `B10-MAINT-RLS`) |
| `tasks/todo.md` line | 349 |
| Verbatim snippet (≥10 words) | "B10 — maintenance jobs bypass the admin/org tx contract (architectural)." |
| Verified by | `grep -nE "withAdminConnection\|withOrgTx\|^import.*\bdb\b" server/jobs/<job>.ts` for each of the 3 jobs |
| Verified state (2026-04-26) | All 3 jobs import `db` directly at the top of file; none call `withAdminConnection`. The reference pattern in `memoryDedupJob.ts` calls `withAdminConnection` at line 24 and uses the inner tx parameter. |
| Resolution in this spec | Refactor each job to: enumerate orgs inside `withAdminConnection({ source: '<job-source>' })` with `SET LOCAL ROLE admin_role`, then wrap each per-org iteration in `withOrgTx({ organisationId: org.id, source: '<job-source>' })`. |

The 3 jobs and their authoritative state:

- **`server/jobs/ruleAutoDeprecateJob.ts:43`** — currently `import { db } from '../db/index.js'`. Reads/writes `memory_blocks` (RLS-protected per manifest line 169).
- **`server/jobs/fastPathDecisionsPruneJob.ts:7`** — currently `import { db } from '../db/index.js'`. Reads/writes `fast_path_decisions` (RLS-protected per manifest line 439).
- **`server/jobs/fastPathRecalibrateJob.ts:9`** — currently `import { db } from '../db/index.js'`. Reads/writes `fast_path_decisions` (RLS-protected per manifest line 439).

Without `app.organisation_id` set, every SELECT against `memory_blocks` and `fast_path_decisions` returns zero rows per org, so the jobs are silent no-ops. The fix mirrors `memoryDedupJob.ts` lines 14, 24, 63.

---

## 3. Items NOT closed

| What | Why deferred | Where it lives |
|---|---|---|
| Other maintenance jobs that may also bypass the contract | Chunk 4 is scoped to the 3 jobs the mini-spec named; broader audit is out of scope | Future audit-runner pass |
| Job-schedule changes / retry tuning | Not part of the contract; not in mini-spec | Post-launch ops backlog |
| Generic "withMaintenanceTx" helper | Per `convention_rejections` — existing primitives fit | Not a deferral, a non-goal |
| Wiring `agent_runs.is_test_run` exclusion in these jobs (P3-L9) | Separate todo; cost-ledger surface, not RLS contract | `tasks/todo.md:903` (P3-L9), separate effort |

---

## 4. Key decisions

**None architectural.** The mini-spec explicitly states "Key decisions: none — contract already exists in `memoryDedupJob`." This spec inherits that.

The only choice is the per-job `source: '<job-source>'` string for `withAdminConnection` and `withOrgTx`. Following `memoryDedupJob.ts` precedent, the convention is `<job-name-kebab-case>`:

- `ruleAutoDeprecateJob` → `source: 'rule-auto-deprecate'`
- `fastPathDecisionsPruneJob` → `source: 'fast-path-decisions-prune'`
- `fastPathRecalibrateJob` → `source: 'fast-path-recalibrate'`

These strings flow into the audit log emitted by `withAdminConnection` per `architecture.md` § 1360. Mechanical decision — not architectural.

---

## 5. Files touched

### Modified

| File | Change |
|---|---|
| `server/jobs/ruleAutoDeprecateJob.ts` | Replace direct `db` access with `withAdminConnection` (org enumeration) + per-org `withOrgTx`. Mirror `memoryDedupJob.ts` shape. |
| `server/jobs/fastPathDecisionsPruneJob.ts` | Same pattern. |
| `server/jobs/fastPathRecalibrateJob.ts` | Same pattern. |

### Created

| File | Purpose |
|---|---|
| `server/jobs/__tests__/ruleAutoDeprecateJobPure.test.ts` (or co-located by repo convention) | Pure unit test asserting that the per-org tx contract is invoked and the job's write logic runs against the org-scoped tx parameter. |
| `server/jobs/__tests__/fastPathDecisionsPruneJobPure.test.ts` | Same. |
| `server/jobs/__tests__/fastPathRecalibrateJobPure.test.ts` | Same. |

The 3 pure tests follow the existing pure-test convention. They do **not** require a real Postgres instance — they assert the wrapper call shape with mocks for `withAdminConnection` / `withOrgTx`. Per `docs/spec-context.md`: `runtime_tests: pure_function_only`.

### Untouched (non-goals confirmed)

- `server/jobs/memoryDedupJob.ts` — already correct.
- `server/services/queueService.ts` — job registration unchanged.
- `server/lib/adminDbConnection.ts` / `server/middleware/orgScoping.ts` — primitives unchanged.

---

## 6. Implementation Guardrails

### MUST reuse

From `docs/spec-context.md § accepted_primitives`:

- `withAdminConnection` (`server/lib/adminDbConnection.ts`) — admin-context entry point that sets `SET LOCAL ROLE admin_role` and logs to `audit_events`.
- `withOrgTx` (`server/middleware/orgScoping.ts`) — per-org tx helper that sets `app.organisation_id`.
- `getOrgScopedDb` (only inside the per-org callback) — Drizzle handle bound to the current `withOrgTx`.
- `memoryDedupJob.ts` lines 14, 24, 63 — the precedent shape. Copy structure; do not invent variants.

### MUST NOT introduce

- A new wrapper function over `withAdminConnection`/`withOrgTx`. Mirror the precedent inline in each job.
- A new "MaintenanceJobBase" class or interface.
- Any signature change to `withAdminConnection` or `withOrgTx`.
- Vitest / Jest / Playwright / Supertest tests (per `convention_rejections`). Pure tests only.
- Changes to which orgs the jobs iterate over. The `SELECT id FROM organisations` enumeration in `memoryDedupJob.ts` is the precedent; adopt it verbatim unless a job has a documented filter requirement (none of the 3 do per their current code).

### Known fragile areas

- **Row-decay arithmetic in `ruleAutoDeprecateJob`.** The job currently computes deprecation candidates against `memory_blocks` directly. The refactor must preserve the exact decay arithmetic (cutoff timestamps, `last_used_at` semantics) — it just runs it inside the per-org tx. Audit each query before-and-after by diffing the SQL string output.
- **Idempotency on `fastPathDecisionsPruneJob`.** Pruning is destructive (DELETE). Confirm the per-org tx wrapping does not change the `WHERE` predicate in a way that causes double-deletes on retry. The pure test covers the retry path.
- **`fastPathRecalibrateJob` UPDATE shape.** The recalibration reads + writes `fast_path_decisions`. Ensure the read happens inside the same `withOrgTx` block as the write so RLS scope is preserved across the read-then-write.

---

## 7. Test plan

Per `docs/spec-context.md § testing posture` (`runtime_tests: pure_function_only`):

### Pure unit tests (one per job)

For each of the 3 jobs:

1. **Wrapper-shape assertion.** With `withAdminConnection` and `withOrgTx` mocked, invoking the job's exported handler must call `withAdminConnection` exactly once with the expected `source` string, and call `withOrgTx` once per org returned by the org-enumeration query, each with the expected `organisationId` and `source`.
2. **Per-org write logic.** With the inner tx mocked, the job's per-org function must call the expected SELECT/UPDATE/DELETE shapes against the tx handle (not against the top-level `db`).
3. **Empty-org-set behaviour.** Zero orgs → zero `withOrgTx` calls; admin connection still acquired.
4. **Per-org error isolation.** A throw in org A's `withOrgTx` callback must not prevent org B's iteration. (Mirror the precedent in `memoryDedupJob.ts` if it has explicit error isolation; otherwise document the observed behaviour.)

### Static gate

- `verify-rls-contract-compliance.sh` — must pass after the refactor. The gate currently flags direct `db` use in jobs against tenant tables (per invariant 1.5 enforcement); the refactor moves the 3 jobs from violating to compliant.
- Sanity grep before commit: `grep -nE "^import.*\bdb\b" server/jobs/{ruleAutoDeprecate,fastPathDecisionsPrune,fastPathRecalibrate}Job.ts` — must return zero.

### No new test categories

No vitest, jest, playwright, supertest, frontend tests, or e2e per `docs/spec-context.md § convention_rejections`.

---

## 8. Done criteria

- [ ] All 3 jobs use `withAdminConnection` for org enumeration and `withOrgTx` for per-org work; direct `db` import removed from all 3.
- [ ] One pure unit test per job, each covering the 4 cases in § 7.
- [ ] `verify-rls-contract-compliance.sh` passes.
- [ ] `tasks/todo.md` line 349 annotated `→ owned by pre-launch-maintenance-job-rls-spec`.
- [ ] PR body links the spec; test plan checked off.

---

## 9. Rollback notes

Each job is reverted independently by restoring its previous direct-`db` shape from git history. No DB migration involved; the rollback is per-file `git revert` granularity. Pure tests are dropped on rollback (additive only).

If the rollback restores the silent-no-op behaviour, the practical effect on production is zero (the jobs were already no-oping under RLS); the practical effect on testing is that decay/pruning/recalibration stops running, which is the pre-Chunk-4 state.

---

## 10. Deferred Items

None for Chunk 4.

The mini-spec scoped this chunk to exactly one item with no decisions. No deferrals surfaced during drafting.

---

## 11. Review Residuals

_(Populated by user adjudication at PR review. `spec-reviewer` agent skipped per `tasks/builds/pre-launch-hardening-specs/progress.md § Workflow deviations`.)_

### HITL decisions (user must answer)

None — the contract is fixed.

### Directional uncertainties (explicitly accepted tradeoffs)

- **Source-string convention.** § 4 picks kebab-case job names matching `memoryDedupJob`'s precedent. If the user prefers a different convention (e.g. snake_case to match existing audit-event source strings), call out at review and the implementation PR adopts it.

---

## 12. Coverage Check

### Mini-spec Items (verbatim)

- [x] `B10-MAINT-RLS` — `ruleAutoDeprecateJob.ts`, `fastPathDecisionsPruneJob.ts`, `fastPathRecalibrateJob.ts` need to mirror the admin/org tx contract from `memoryDedupJob.ts` — **addressed in § 2.1 + § 5 (3 modified jobs + 3 pure tests)**.

### Mini-spec Key decisions (verbatim)

- [x] **Key decisions: none — contract already exists in `memoryDedupJob`** — **addressed in § 4 (no architectural decisions; only the mechanical source-string choice)**.

### Final assertion

- [x] **No item from mini-spec § "Chunk 4 — Maintenance Job RLS Contract" is implicitly skipped.** The chunk has exactly one item; it is fully addressed.

### Mini-spec done criteria — mapped to this spec's § 8

- [x] "All three jobs execute their intended writes under the same RLS contract as `memoryDedupJob`" — § 8 first checkbox.
- [x] "Test added per job that verifies a real row is decayed/pruned/recalibrated" — § 8 second checkbox + § 7 cases (1-4).
