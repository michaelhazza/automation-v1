# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-05-01-lint-typecheck-post-merge-spec.md`
**Spec commit at start:** `dda669c4`
**Spec commit at finish:** `aa4b8763`
**Spec-context commit:** `03cf8188`
**Iterations run:** 3 of 5
**Exit condition:** two-consecutive-mechanical-only (Iter 2 + Iter 3 both produced 0 directional / 0 ambiguous findings)
**Verdict:** READY_FOR_BUILD (3 iterations, 19 mechanical fixes applied, 1 directional finding auto-resolved via framing assumption)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 10 | 4 | 7 | 2 | 1 (Task 7 → defer) | 0 | 0 |
| 2 | 9 | 0 | 6 | 3 | 0 | 0 | 0 |
| 3 | 10 | 0 | 7 | 3 | 0 | 0 | 0 |

Subordinate findings (collapsed under prior decisions, not double-counted): Iter 1 #5, #7-Tasks-7, R1, R2, R3.

---

## Mechanical changes applied

### Goal / framing
- Reworded "close out deferred test items" to "route deferred test items to `tasks/todo.md`" — Iter 2.

### Task 1 — Pre-flight
- Added `git status --short` clean-tree assertion before the pull step — Iter 3.

### Task 4.2 — `no-undef` root cause
- Tightened the "Root cause" prose to reflect that `no-undef: off` is already set in `server/**` + `client/**` blocks; the gap is files outside both globs (scripts/**, tools/**, root TS) — Iter 1.
- Pinned the insertion point of the new global rules object (after the two `recommended` configs, before the `files:`-scoped overrides) and showed the full intended `tseslint.config(...)` shape — Iter 3.

### Task 5 header
- Fixed the source-log path: changed from the chatgpt-pr-review log (which uses F1–F29 numbering) to `tasks/builds/lint-typecheck-baseline/remaining-work.md §6` (where S/N findings actually live) — Iter 1.

### Task 5.1 — S1 IdempotencyContract
- Added the canonical source-spec path citation (`docs/superpowers/specs/2026-04-26-system-agents-v7-1-migration-spec.md` §588) and the explicit four-field shape — Iter 1.
- Dropped the "comment-only fallback" verdict path; committed to implementing the three missing fields — Iter 1.
- Added a postcondition grep + typecheck verification step — Iter 3.

### Task 5.2 — S2 visibilityPredicatePure exhaustive switch
- Pinned the system-principal policy explicitly (`return true` after the org gate) with rationale tied to `SystemPrincipal` definition + `withSystemPrincipal` wrapper — Iter 1.

### Task 5.3 — S3 SystemPrincipal test
- Replaced `buildSystemPrincipal()` (doesn't exist) with literal construction of a `SystemPrincipal` per `principal/types.ts:30` — Iter 1.
- Filled in the missing required fields (`id`, `subaccountId: null`, `teamIds`) per the actual type — Iter 2.
- Corrected the test framework prose from "tsx-style assertions, not vitest" to "vitest assertions runnable via `npx tsx`" — Iter 2.

### Task 5.4 — N1 dead branch comment
- Added a postcondition grep step to verify the misleading "implies reachable" wording is gone — Iter 3.

### Task 5.5 — N3 idempotencyKey
- Pinned the precedence between `fingerprintOverride` (wins), `idempotencyKey` (fallback), derived hash (default) for Option A — Iter 3.
- Added a postcondition grep step to confirm callers are consistent — Iter 3.

### Task 6 — CI gate scope boundary
- Added an explicit Scope-Boundary line: workflow-level blocking job is in scope; GitHub branch-protection / required-status-check configuration is out of scope — Iter 2.

### Task 6.1 — `lint_and_typecheck` job + workflow trigger
- Extended `pull_request.types` from `[labeled, synchronize]` to `[opened, reopened, labeled, synchronize]` — Iter 1.
- Added `ready_for_review` to cover draft-PR transitions without a new push — Iter 3.
- Replaced `npx js-yaml ... > /dev/null && echo valid` with a Node-based check using the installed `yaml` dep — Iter 2.

### Task 7 — F14 + F28 deferral
- Re-framed the entire task from "write integration tests" to "route the two items to `tasks/todo.md`" per `runtime_tests: pure_function_only` — Iter 1, AUTO-REJECT-framing.
- Made the task idempotent against the current todo.md state (verify-only, no double-add) — Iter 2.
- Replaced the "delete the older PR #246 F14/F28 lines" instruction with a verify-only check (the dedup already landed in Iter 2) — Iter 3.

### Task 8.3 — pr-reviewer routing format
- Pinned the literal heading shape used in `tasks/todo.md` (`## PR Review deferred items` then `### PR #<N> — <slug> (<date>)`) instead of the original `## PR Review deferred items / PR #<N>` which doesn't match the file — Iter 2.

### Verification table
- Removed the "F14 test passes" and "F28 test passes" rows; replaced with a deferral-verification row — Iter 1.
- Tightened the deferral-verification row to a deterministic two-grep check — Iter 3.
- Updated the `npx js-yaml` row to the Node + `yaml` dep equivalent — Iter 2.

### Self-review against brief
- Updated F14 + F28 rows to "deferred" status — Iter 1.
- Updated the S1 row to drop the rejected "or stub comment" alternative — Iter 3.

### Contents block
- Updated the Task 7 link text to reflect the deferral framing — Iter 1.

### `tasks/todo.md` collateral changes
- Added a new section `## Deferred — testing posture (lint-typecheck-post-merge spec)` with rich F14 + F28 entries (including the contract correction for F28's expected return shape) — Iter 1.
- Collapsed the older sparse F14/F28 rows in the PR #246 section onto a single pointer line — Iter 2.

---

## Rejected findings

For every rejected finding, listed: section, description, reason. The human can scan this to confirm no legitimate issue was dropped.

### Iteration 1
- **Codex #1 — "Unix commands in PowerShell repo".** Spec runs via `superpowers:subagent-driven-development` which uses the Bash tool per CLAUDE.md `<env>` block. Issue not real for the documented runtime.
- **Codex #3 (main fix) — "IdempotencyContract should be `keyShape`/`ttlClass`/`reclaimEligibility`".** Codex misread the v7.1 spec §588; verified the spec lists four fields (`keyShape`, `scope`, `ttlClass`, `reclaimEligibility`) and the current stub already has `ttlClass`. The three missing fields are exactly what the spec under review says. (Auxiliary "name the canonical source path" insight applied.)

### Iteration 2
- **Codex #5 — "Task 5.1 should also align ActionDefinition.idempotency consumers".** That field is optional in the v7.1 spec (`?:`), there are no current consumers in the registry, and the v7.1 spec is itself a future-state spec not yet implemented. Expanding scope would directionally bloat a lint-cleanup spec into an implementation sprint.
- **Codex #7 — "Unix tooling not declared".** Repeat of Iter 1 #1; same rejection reason.
- **Codex #8 — "Error-count drift across artifacts".** Counts are soft estimates; Tasks 3.8/3.9 explicitly say to re-measure. Hard normalisation across three artifacts is low-value perfectionism.

### Iteration 3
- **Codex #1 — "Baseline count drift".** Same reason as Iter 2 #8 — soft estimates, re-measured at execution time, the "138 vs 134" gap is `npm run typecheck` (full) vs `npm run typecheck:server` (server only), not drift.
- **Codex #3 — "Unix shell mismatch".** Third repeat. CLAUDE.md `<env>` is authoritative.
- **Codex #8 — "Doc-alignment scope narrower than goal".** The two doc surfaces the spec updates (CLAUDE.md and the three lint-gate-relevant agent files) are exactly the docs that gate on `npm run lint && npm run typecheck`. `architect.md` and `audit-runner.md` don't gate on those scripts. Expanding to a full doc-sync sweep would directionally bloat the spec.

---

## Directional and ambiguous findings (autonomously decided)

### Iteration 1
- **Codex #2 — Task 7 (F14 + F28 integration tests) violate `runtime_tests: pure_function_only`.**
  - Classification: directional (testing-posture signal).
  - Decision type: AUTO-REJECT (framing).
  - Rationale: `docs/spec-context.md` `runtime_tests: pure_function_only`, `e2e_tests_of_own_app: none_for_now`, `composition_tests: defer_until_stabilisation`, `migration_safety_tests: defer_until_live_data_exists`. Both tests are DB-backed integration tests touching `db.transaction`, real schema, and event tables — exactly what the framing forbids.
  - Resolution: re-frame Task 7 as a deferral routed to `tasks/todo.md` rather than rewriting the tests as pure-function (the value of these tests is exactly the DB round-trip they assert; pure-function rewrites wouldn't catch what they were raised to catch). The deferral is the canonical pattern in this codebase. F14 + F28 are not lost — they're in `tasks/todo.md` under a dedicated heading with full context for when the testing posture matures.
  - Routed to: `tasks/todo.md` § "Deferred — testing posture (lint-typecheck-post-merge spec)".

### Iterations 2 and 3
- No directional or ambiguous findings. Both iterations were mechanical-only.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across three iterations (29 distinct findings adjudicated). However:

- The review did not re-verify the framing assumptions at the top of `docs/spec-context.md`. If the product context has shifted (testing posture relaxed, branch-protection now in scope, integration-test budget approved), re-read the spec's Goal + Task 6 scope-boundary + Task 7 deferral sections one more time before kicking off implementation.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem — it does not generate insight from product judgment.
- The review did not prescribe what to build next or sequence work across other in-flight specs. Sprint sequencing is still the human's job.

**Recommended next step:** scan `tasks/todo.md` § "Deferred — testing posture (lint-typecheck-post-merge spec)" to confirm the F14 + F28 routing is acceptable as the realisation of "close out deferred test items." Then start implementation under `superpowers:subagent-driven-development` or `superpowers:executing-plans`. The 8-task structure was preserved end-to-end; tasks should execute sequentially in one pass per the spec's framing.
