# Spec review iteration 2 — feat-split-agentexecutionservice

**Spec:** `tasks/builds/feat-split-agentexecutionservice/spec.md`
**Started:** 2026-05-15
**Reviewer:** spec-reviewer agent (Codex CLI v0.125 + Claude adjudication)
**Prior iteration:** iteration 1 (commit `15541bab`) — 19 mechanical fixes + 26 false-positive rejections

## Codex run

`codex exec --skip-git-repo-check` with the updated spec inlined + a "find only remaining defects" prompt. Returned 4 numbered findings.

## Findings classified + adjudicated

### Mechanical — ACCEPTED + APPLIED

[ACCEPT] §2 — Non-goals list omitted `agentExecutionService.startRunAsync` from the locked public surface even though §4 locks it.
  Fix: Added `agentExecutionService.startRunAsync` to the §2 "No public-surface changes" sentence.

[ACCEPT] §14 — Wording "modifies no write paths" was ambiguous; chunks DO move code that performs writes (the writes themselves are preserved, but the location moves).
  Fix: Rewrote §14 opening to "changes no write-path semantics, ordering, column set, or awaited/fire-and-forget behaviour. The code that performs each write moves into phase modules, but the write itself — its SQL, its columns, its sequence position relative to other side effects, and its awaited-vs-fire-and-forget shape — is byte-for-byte preserved." Also tightened the closing "out of scope" sentence to enumerate write-path semantics explicitly.

[ACCEPT] §1.5 — "new test files added only as a side effect of test-collocation moves" contradicted §13 ("No new runtime test files added by this build") and `docs/spec-context.md` (`runtime_tests: pure_function_only`).
  Fix: Replaced the allowance with "No new test files are authored by this build (per §13 and docs/spec-context.md). Existing tests stay; their import paths may shift but their assertions do not."

### Directional — REJECTED

[REJECT] §11 — Codex #4 asked us to resolve Q1/Q2/Q3 inside the spec before builder execution.
  Reason: The spec explicitly defers Q1-Q4 to architect-plan time by design — each carries a "Default: …. Architect plan re-confirms." line. This is consistent with the project's spec-then-architect-plan pipeline: the spec is architecture-level (per CLAUDE.md), the architect plan is the next phase, and the spec correctly hands locked defaults to the architect. Locking concrete file placement / context shape / dispatch.ts existence inside the spec would mean the spec usurps the architect's job. Framing assumption: "Prefer existing primitives over new abstractions" extends here to "preserve the existing two-phase spec → architect-plan workflow". Architect-time questions stay open in §11 by design.

## Iteration 2 summary

- Codex findings:                4
- Rubric findings (independent): 0
- Mechanical findings accepted:  3
- Mechanical findings rejected:  0
- Directional findings:          1 (rejected — Codex contradicts the spec-then-architect-plan workflow)
- Ambiguous findings:            0
- Autonomous decisions:          0 (no items routed to tasks/todo.md)

Spec commit after iteration: pending (Step 8b auto-commit)
