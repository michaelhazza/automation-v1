# Spec-review log — lint-typecheck-post-merge — Iter 1

- Spec: `docs/superpowers/specs/2026-05-01-lint-typecheck-post-merge-spec.md`
- Spec commit at start: `dda669c4a53c2d5520546e8b3ed497287244b273`
- Codex output: `tasks/review-logs/.codex-output-iter1-2026-05-01T01-50-10Z.txt`

## Codex findings — adjudication

| # | Section | Verdict | Reason |
|---|---|---|---|
| 1 | Tasks 1/2.1/6.1 — "Unix commands in PowerShell repo" | REJECT | Env is Bash per CLAUDE.md `<env>`; Bash tool is the documented runtime for `superpowers` execution. Issue not real. |
| 2 | Task 7 — F14/F28 integration tests | DIRECTIONAL → AUTO-REJECT (framing) | Violates `runtime_tests: pure_function_only`. Re-frame as deferred items routed to `tasks/todo.md`. |
| 3 | Task 5.1 — IdempotencyContract field set | REJECT (Codex misread §588) + small mechanical fix | v7.1 spec §588 has 4 fields (`keyShape`, `scope`, `ttlClass`, `reclaimEligibility`); current stub already has `ttlClass`; the spec correctly names the missing 3. Mechanical: cite the canonical spec path. |
| 4 | Task 5 source-log path | ACCEPT (mechanical) | "Source log:" points at chatgpt-pr-review log (F1-F29), but S/N findings live in `tasks/builds/lint-typecheck-baseline/remaining-work.md §6`. Fix the path. |
| 5 | Task 7.2 — wrong return shape | SUBORDINATE to #2 | Verified vs `writeDiagnosis.ts:62-63,124-127`: idempotent path returns `suppressed: false`, NOT `suppressed: true`. Moot under #2 deferral. |
| 6 | Task 5.2 — system-principal policy under-specified | ACCEPT (mechanical) | Pin policy explicitly: SystemPrincipal bypasses tenant scoping by design (per `principal/types.ts:30` + `withSystemPrincipal`). |
| 7 | Tasks 5.3/7.1/7.2 — unnamed primitives | ACCEPT (mechanical, 5.3 only) | `buildSystemPrincipal()` doesn't exist; `getSystemPrincipal()` returns Promise. Fix 5.3 to construct a `SystemPrincipal` literal directly. 7.1/7.2 subordinate to #2. |
| 8 | Task 6.1 — CI trigger | ACCEPT (mechanical) | Workflow currently triggers `[labeled, synchronize]` only; "mandatory on every PR" requires extending types to include `opened, reopened`. |
| 9 | Task 5.1 — comment fallback doesn't close strong finding | ACCEPT (mechanical) | Drop the "comment-only" verdict path; commit to implementing the 3 fields. |
| 10 | Task 4.2 — stale framing of `no-undef` config | ACCEPT (mechanical) | `no-undef: off` already set in `server/**` + `client/**` blocks; gap is files outside both globs (e.g. `scripts/**`). Tighten the "Root cause" prose. |

## Rubric findings (added by reviewer)

| # | Section | Verdict | Reason |
|---|---|---|---|
| R1 | Self-review table — F14/F28 marked ✓ | Subordinate to #2 | Update rows to reflect deferral. |
| R2 | Verification table — F14/F28 success conditions | Subordinate to #2 | Remove rows. |
| R3 | "8 tasks sequential" framing | Apply with #2 | Keep 8-task structure; collapse Task 7 body to deferral note. |
| R4 | Test gates rule (CLAUDE.md) | No finding | Spec uses `npm run typecheck`/`lint`/`tsx`, not forbidden runners. Compliant. |

## Mechanical edits to apply

1. Task 5 header — fix source-log path to `tasks/builds/lint-typecheck-baseline/remaining-work.md §6`.
2. Task 5.1 — cite canonical spec path; drop the comment-only fallback; commit to implementing the 3 fields.
3. Task 5.2 — pin system-principal policy with rationale (bypasses tenant scoping by design).
4. Task 5.3 — replace `buildSystemPrincipal()` with `SystemPrincipal` literal construction per `principal/types.ts:30`.
5. Task 6.1 — extend workflow `pull_request.types` to include `opened, reopened`.
6. Task 4.2 — tighten "Root cause" line; gap is files outside `server/**` + `client/**` globs.
7. Task 7 — re-frame F14/F28 as deferred items, route to `tasks/todo.md`, drop integration-test bodies. Keep 8-task structure.
8. Verification table — drop F14/F28 rows.
9. Self-review table — update F14/F28 rows to deferral.

## Step 7 — Autonomous decisions for directional findings

- `[AUTO-REJECT - framing]` Task 7 (F14 + F28) — DB-backed integration tests violate `runtime_tests: pure_function_only`. Resolution: re-frame as deferred items, route to `tasks/todo.md` for human triage. **Counts as: directional resolved.**

## Iteration 1 Summary

- Mechanical findings accepted:  7 (Codex #4, #6, #7-partial, #8, #9, #10 + auxiliary path-citation from #3)
- Mechanical findings rejected:  2 (Codex #1 — env mismatch; Codex #3 main fix — Codex misread §588)
- Directional findings:          1 (Codex #2 — Task 7 testing-posture violation)
- Ambiguous findings:            0
- Reclassified → directional:    0
- Subordinate findings:          3 (#5, #7-partial-Tasks-7, R1, R2, R3 — all collapsed under #2 resolution)
- Autonomous decisions (directional/ambiguous): 1
  - AUTO-REJECT (framing):    1 (Task 7 → re-frame as deferred items routed to tasks/todo.md)
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0 (the framing-rejection has a clear resolution path; no judgment-call routing to todo.md needed beyond the deferred-test entries which are the resolution itself, not undecided escalations)
- Spec commit after iteration:   `c2c6ff00`
