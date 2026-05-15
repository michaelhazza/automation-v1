# Spec Review Final Report

**Spec:** `tasks/builds/feat-split-agentexecutionservice/spec.md`
**Spec commit at start:** (uncommitted at start; first commit `15541bab` introduced spec.md alongside iteration-1 fixes)
**Spec commit at finish:** `59631b77`
**Spec-context commit:** `62497257`
**Iterations run:** 4 of 5
**Exit condition:** two-consecutive-mechanical-only
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional (rejected) | AUTO-DECIDED |
|---|---|---|---|---|---|---|
| 1 | 40 | 8  | 19 | 26 | 0 | 0 |
| 2 | 4  | 0  | 3  | 0  | 1 | 0 |
| 3 | 1  | 0  | 1  | 0  | 0 | 0 |
| 4 | 2  | 0  | 2  | 0  | 0 | 0 |

Across all iterations: 47 Codex findings + 8 rubric findings = 55 raw findings. 25 mechanical fixes applied, 26 false-positives rejected with verified reasons, 1 architect-deferred directional rejected, 0 AUTO-DECIDED items routed to `tasks/todo.md`.

---

## Mechanical changes applied (grouped by spec section)

### §1 Goals
- §1.5: removed test-collocation new-test-file allowance that contradicted §13 / `docs/spec-context.md` `runtime_tests: pure_function_only`.
- §1.6: tightened "extend siblings" to "import from them — do not duplicate"; siblings remain untouched.

### §2 Non-Goals
- Added `agentExecutionService.startRunAsync` to the locked public-surface list.

### §4 Public-Surface Lock
- Renamed `executeRunAsync` → `startRunAsync` (the actual method name).
- Locked both `executeRun` and `startRunAsync` on the `agentExecutionService` object with full signatures.
- Added `routes/skills.ts`, `routes/subaccountSkills.ts`, `services/skillExecutor.ts` to the consumers cell.

### §5.2 Directory layout
- `validate.ts` description corrected to include phase 0c (org-subaccount detection).
- Added `loadContext.ts` (Phase D1, source phases 3, 3.5, 4, 4.5).
- Renamed `prepare.ts` to Phase D2 (source phases 5, 5a, 5b, 6, 7).
- Added `dispatch.ts` (Phase E, optional per Q3).
- `complete.ts` description corrected to cover phases 9, 10, 11, 12 with the MCP-cleanup invariant called out.
- Every `runLifecycle/*.ts` row now carries explicit "(source phases X, Y, Z)" mapping.
- `types.ts` row now includes `RunExecutionContext (internal)`.

### §5.3 Dependency direction
- DAG diagram updated to show all eight `runLifecycle/*` nodes with phase labels.
- `types.ts` rule rewritten to spell out type-only vs runtime distinction.
- Added permitted exception that `runLifecycle/dispatch.ts` (if Chunk 8 keeps it) MAY import `backendDispatch.ts`.

### §5.4 Pre-existing extractions
- Removed the inconsistent "append new pure helpers" allowance; this build NEVER modifies `agentExecutionServicePure.ts` (or any other pre-existing sibling).

### §5.6 Barrel re-export shape
- Added CRITICAL note: `executeRun` and `startRunAsync` MUST remain on the same object literal regardless of Q1's outcome — `startRunAsync`'s `this.executeRun(...)` line is load-bearing.

### §6 Current State
- Phase summary replaced with full source-order phase list (0a-12).
- Line ranges corrected: `executeRun` is ~457-2302, not 453-2388; `startRunAsync` is 2304-2388 (split into its own item).
- "Five concerns" map preserved.

### §7 Chunked Migration Plan
- Old Chunk 7 split into Chunk 7a (loadContext.ts, phases 3-4.5) and Chunk 7b (prepare.ts, phases 5-7).
- Chunk 8 description updated to reference Q3 and note `runLifecycle/dispatch.ts` may be dropped.
- Chunk 9 expanded to cover phases 9, 10, 11, 12 with the MCP-cleanup try/finally invariant.
- Chunk 11 carries a locked acceptance criterion for `startRunAsync` placement AND a hard boundary that pre-existing siblings are NEVER touched by the caller sweep.
- Per-chunk targeted-test language clarified to "existing tests must still pass without assertion changes" (no new test authoring).
- Anti-chunks list updated to remove the `*Pure.ts` append allowance.

### §8 Verification Strategy
- §8.1 "Targeted unit tests authored for this build" → "Targeted re-run of any EXISTING test file that touches the chunk's surface".

### §9 Deferred Items
- DEF-1: `executeRunAsync` → `startRunAsync`.
- DEF-2: Chunk 4 → Chunk 1 (correct location where `RunExecutionContext` placeholder is authored).

### §10 Caller Sweep
- Replaced inflated "25 hits" claim with verified 16-import list.
- Removed 7 false positives (webLoginConnections, workflowEngineService, agentExecutionEventService, agentExecutionEventServicePure, runtimeCheckService, registerOptimiserSchedulePure.test, testRunIdempotency).
- Added an "Excluded — filename mentions only" footnote so future reviewers don't re-add them.

### §12 Self-Consistency Pass
- "25 files" → "16 files" caller-count.

### §14 Execution-Safety Contracts
- Rewrote opening to clarify "changes no write-path semantics, ordering, column set, or awaited/fire-and-forget behaviour" (the code MOVES; the writes don't).
- `executeRunAsync` → `startRunAsync` in the fire-and-forget reference.
- Closing "out of scope" sentence tightened to enumerate write-path semantics explicitly.

---

## Rejected findings

26 mechanical rejections + 1 directional rejection:

- §10 `server/routes/skills.ts` (Codex #10): rejected — file DOES import `agentExecutionService` (line 8). Codex was wrong; spec inclusion is correct.
- §10 `server/routes/subaccountSkills.ts` (Codex #11): rejected — file DOES import (line 8). Codex was wrong.
- §10 "23 omitted callers" (Codex #13-#35): all 23 rejected. None of them actually `import` `agentExecutionService` — all are filename-grep matches in code/comments. Verified individually.
- §7 "Targeted: test still passes" lines (Codex #40): rejected — refer to running EXISTING tests, not authoring new ones. Resolved by clarifying language in fix #39.
- §11 Q1-Q3 (Codex iter 2 #4): rejected DIRECTIONAL — the spec deliberately defers these to architect-plan time. Locking them inside the spec would usurp the architect's job. Framing assumption: preserve the spec → architect-plan two-phase workflow.

---

## Directional and ambiguous findings (autonomously decided)

One directional finding surfaced in iteration 2 (§11 Q1-Q3 locking), rejected per the framing rule "preserve the spec → architect-plan two-phase workflow". No AUTO-DECIDED items routed to `tasks/todo.md` — all directional findings were clearly resolvable by the framing assumptions.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and Codex. The four iterations resolved:

- One critical naming bug (`executeRunAsync` → `startRunAsync`).
- A 9-phase gap in the chunk plan (phases 3, 3.5, 4, 4.5, 5, 5a, 5b, 10, 11, 12 were unmapped).
- A wrong-order Chunk 7 (prompt assembly listed before runContextLoader).
- An over-inflated caller sweep (25 → 16 with 7 false positives removed).
- Three internal contradictions (siblings untouched vs "extend them"; phase ordering vs source order; types.ts type-only vs runtime).
- A load-bearing `this`-binding gap (startRunAsync calls `this.executeRun`).
- A wording ambiguity in §14 (the code moves; the writes don't).

However:
- The review did not re-verify the framing assumptions at the top of `docs/spec-context.md`. If pre-production / static-gates / no-feature-flags has shifted since the spec was written, re-read the spec's Framing Assumptions section (§3) yourself before calling the spec implementation-ready.
- The review did not catch directional issues that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- §11 Q1-Q4 remain open by design — the architect plan resolves them with full code context. The spec hands locked defaults to that step.

**Recommended next step:** read the spec's §3 (Framing Assumptions), §4 (Public-Surface Lock), §5.2 (Directory layout), and §7 (Chunked Migration Plan) one more time. Then hand the spec to the architect for the implementation plan.
