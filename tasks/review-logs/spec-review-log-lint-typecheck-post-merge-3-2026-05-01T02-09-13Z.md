# Spec-review log — lint-typecheck-post-merge — Iter 3

- Spec: `docs/superpowers/specs/2026-05-01-lint-typecheck-post-merge-spec.md`
- Spec commit at start: `d058b859`
- Codex output: `tasks/review-logs/.codex-output-iter3-2026-05-01T02-09-13Z.txt`

## Codex findings — adjudication

| # | Section | Verdict | Reason |
|---|---|---|---|
| 1 | Goal/Task1/Task3 — baseline count drift | REJECT | Iter 2 already adjudicated this (Codex Finding #8). Counts are soft estimates ("~127", "~138"); Task 3.8/3.9 explicitly say to re-measure at execution time. Task 1's baseline is for sanity, not contract. The "138 vs 134" gap is the difference between full `npm run typecheck` (which includes client) and `npm run typecheck:server` — not a drift, a different scope. Pinning hard counts across three artifacts adds maintenance burden without changing implementation outcome. **Same reason as Iter 2.** |
| 2 | Task 1 — clean-tree precondition not asserted | ACCEPT (mechanical) | Real gap: `git pull` on a dirty tree can fail or mix state. Add an explicit `git status --short` check before the pull. Small fix, locks the precondition. |
| 3 | Tasks 1/2.1/2.4/3/4/6.1/7 — Unix shell mismatch | REJECT | **Third repeat of the same finding.** Iter 1 Finding #1 + Iter 2 Finding #7 both rejected. CLAUDE.md `<env>` block says `Shell: bash`; the spec runs via `superpowers:subagent-driven-development` which uses the Bash tool. Same reason as before. |
| 4 | Task 4.2 — eslint config insertion point under-specified | ACCEPT (mechanical) | Verified: `eslint.config.js` line ordering is `js.configs.recommended` (line 10), then `...tseslint.configs.recommended` (line 11), then the `server/**` block (line 13), then the `client/**` block (line 25). A flat-config rules object placed BEFORE `js.configs.recommended` would be overridden by it (since the recommended config sets `no-undef: error` and the later override would re-enable it). The fix needs to specify "after the two `recommended` configs, before the `files:`-scoped overrides". Codex's reasoning is partially incorrect (later blocks don't re-enable a rule unless they explicitly set it; only `js.configs.recommended` does), but the implementation steer is right: the safest insertion point is after the two recommended configs. Pin the location. |
| 5 | Task 5.1 / Self-review — contradiction over comment-only fallback | ACCEPT (mechanical) | Verified: Task 5.1 was tightened in Iter 1 to "no comment-only fallback", but the self-review row at line 489 still says "S1 IdempotencyContract fields or stub comment" — stale. Update the row to drop the "or stub comment" alternative. |
| 6 | Tasks 5.1/5.4/5.5 — missing checkable postconditions | ACCEPT (mechanical) | Real gap. S2 and S3 each have a verify step (`npm run typecheck` for the never guard; running the test file). S1 has no verify step. N1 has no verify (could leave a misleading comment in place). N3 has no caller-sweep step. Add one bullet per item: S1 = grep for the field set + recompile; N1 = grep for the line/comment text; N3 = `grep -rn "idempotencyKey" server/services/` to confirm consistency. |
| 7 | Task 6.1 — "every PR" missing `ready_for_review` | ACCEPT (mechanical) | Real sequencing gap. A draft PR transitioning to ready-for-review without a new push wouldn't trigger if only `[opened, reopened, labeled, synchronize]` are present. Add `ready_for_review` to the trigger list. |
| 8 | Goal / Task 6.2/6.3 — doc-alignment scope narrower than goal | REJECT | The goal says "update documentation to reflect that these scripts are now operational" — the only docs the spec changes are CLAUDE.md (the canonical agent-facing instruction file) and three agent definitions (the only agents that gate on lint/typecheck). `architect.md` and `audit-runner.md` don't gate on lint/typecheck and don't reference them in the lint-was-broken sense. Expanding to "all instruction sources" would directionally bloat the spec into a broader doc-sync sweep. The narrower scope is intentional. |
| 9 | Task 7 — dedupe instructions stale against current todo.md | ACCEPT (mechanical) | Verified: `tasks/todo.md` lines 2155-2157 currently show F5/F7 + a single-line pointer for F14/F28 (the dedup from Iter 2 already landed). Task 7 still tells the implementer to "delete those two `[ ] F14: ...` and `[ ] F28: ...` lines" — they no longer exist as separate rows. Update Task 7 to reflect the current pointer-based state. The Verification table row already says "Two new rows under …" — update to "two deferred rows present exactly once under the heading." |
| 10 | Task 5.5 — N3 fallback semantics not pinned | ACCEPT (mechanical) | Real gap if Option A is chosen. The `IncidentInput` type already declares both `fingerprintOverride` (line 33) and `idempotencyKey` (line 37); precedence between them matters. Pin: `fingerprintOverride` wins (it's the explicit override); `idempotencyKey` is the fallback when no `fingerprintOverride` is set; derived stack/message hash is last. |

## Rubric findings (added by reviewer pass)

None new — the rubric pass would have caught Findings #5 (contradiction) and #9 (file-inventory drift) which Codex did catch.

## Mechanical edits to apply

1. **Task 1** — add `git status --short` clean-tree assertion before the pull step.
2. **Task 4.2** — pin the insertion point of the global rules object: "after `js.configs.recommended` and `...tseslint.configs.recommended`, before the `server/**` and `client/**` `files:`-scoped overrides". Show the full intended file shape (one extra block).
3. **Self-review table row for S1** — change "S1 IdempotencyContract fields or stub comment" → "S1 IdempotencyContract — add the three missing fields per v7.1 spec §588" (drop the "or stub comment" fallback).
4. **Tasks 5.1, 5.4, 5.5** — add explicit grep/readback completion criteria per Codex Finding #6.
5. **Task 6.1** — extend `pull_request.types` to include `ready_for_review` alongside `opened, reopened, labeled, synchronize`.
6. **Task 7** — replace the "delete the two F14/F28 lines" instruction with a verify-only check that the pointer line at todo.md:2157 already exists and the heading + 2 rows below `## Deferred — testing posture (lint-typecheck-post-merge spec)` exist exactly once. Update Verification row from "Two new rows" to "Heading + two deferred rows present exactly once".
7. **Task 5.5 N3 Option A** — pin the precedence: `fingerprintOverride` first, then `idempotencyKey`, then derived hash. Add a one-line precedence comment requirement to the implementation step.

## Step 7 — Autonomous decisions

None this round. All 10 findings classify as mechanical-accept or mechanical-reject (with the reject side being repeats of prior-iter rejections or directional scope expansion).

## Iteration 3 Summary

- Mechanical findings accepted:  6 (Codex #2, #4, #5, #6, #7, #9, #10) — wait that's 7. Recount: #2 (clean-tree), #4 (config insertion), #5 (S1 self-review row), #6 (postconditions), #7 (ready_for_review), #9 (Task 7 dedupe stale), #10 (N3 precedence). 7 accepts.
- Mechanical findings rejected:  3 (Codex #1 baseline drift; #3 shell repeat; #8 doc-alignment scope creep)
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   `aa4b8763`
