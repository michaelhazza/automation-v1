# ChatGPT PR Review Session — claude-audit-dev-agents-Op4XW — 2026-05-01T05-34-06Z

## Session Info
- Branch: claude/audit-dev-agents-Op4XW
- PR: #248 — https://github.com/michaelhazza/automation-v1/pull/248
- Mode: manual
- Started: 2026-05-01T05:34:06Z

---

## Round 1 — 2026-05-01T05:34:06Z

### ChatGPT Feedback (raw)

> Verdict: APPROVE with a few high-leverage tweaks.
> No structural blockers. This is clean, consistent, and aligns tightly with the pipeline spec.
>
> What's solid (don't touch): clear 3-phase pipeline separation; strong state machine via current-focus.md; good failure-path discipline + caps; builder agent is tight and enforceable; review pipeline ordering is correct; doc-sync gate is properly hard-invariant; commit-integrity rule excellent.
>
> Real issues / gaps:
> 1. Critical: missing global "time consistency" invariant (UTC ISO 8601, system time, never mixed). Add to feature-coordinator + finalisation-coordinator.
> 2. Subtle bug: chatgpt-plan-review log directory assumption — `.chatgpt-diffs/` not defined elsewhere. Either remove or define.
> 3. Weakness: Builder "targeted unit tests" execution — `npx tsx <path-to-new-test-file>` assumes test exists and runs in isolation. Tighten to "Run ONLY if self-contained, no DB/env. Otherwise skip silently".
> 4. Inconsistency: skip vs warn vs block logic across phases not formally categorized. Add a small invariant: HARD BLOCK / SOFT BLOCK / WARNING.
> 5. Missing: explicit definition of "chunk file list source" — feature-coordinator relies on builder's "Files changed" without guaranteeing match-with-plan. Clarify: source of truth is plan's declared files; builder output must match or be a subset.
> 6. Edge case: resume logic + deleted files — `git log --oneline origin/main...HEAD -- <files>` may fail if file was deleted/renamed.
> 7. Minor: dual-reviewer skip visibility — REVIEW_GAP only shown in handoff + final prompt. Also log in tasks/builds/{slug}/progress.md.
> 8. Minor: migration collision detection robustness — `grep -oP '^\d+'` assumes prefix is strictly numeric. Tighten to `^\d{3,}`.
> 9. Minor: missing explicit "no parallel chunk execution" rule — implied but not stated.
>
> Final recommendation: before merging, apply time-source invariant, builder test guard, gate classification, and remove or define `.chatgpt-diffs/`. Everything else is polish.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1: Time-source invariant (UTC ISO 8601) | technical | implement | auto (implement) | low | Formalises existing piecemeal practice (`captured_at: {ISO 8601 UTC}`, `LABEL_TIMESTAMP=$(date -u …)`). Cheap docs invariant. |
| F2: Remove dead `.chatgpt-diffs/` directive in chatgpt-plan-review | technical | implement | auto (implement) | low | Copy-paste residue from chatgpt-pr-review template; chatgpt-plan-review never writes to the directory. |
| F3: Builder targeted-unit-tests "skip silently" guard | technical | reject | auto (reject) | low | Existing rule (builder.md L84) already gates on "ONLY for new pure functions with no DB/network/filesystem side effects". Silent-skip-on-failure would mask real bugs — wrong cure. |
| F4: Gate type taxonomy (HARD/SOFT BLOCK / WARNING) | technical-escalated (defer-carveout) | defer | defer | low | Real pattern but right implementation audits every existing gate (G1/G2/G3/G4, doc-sync, snapshot drift, overlap, freshness thresholds, etc.) and labels each. Better as a scoped follow-up. **User-decided as recommended.** |
| F5: Tighten commit-integrity check (plan-declared = canonical source) | technical | implement | auto (implement) | medium | Closes a real gap. Current check compares builder-reported vs git-diff; tightening to (plan-declared ⊇ builder-reported ⊇ working-tree) catches builder scope-drift. |
| F6: Resume logic + deleted files | technical | reject | auto (reject) | low | `git log --oneline origin/main...HEAD -- <deleted-file>` correctly returns the deletion commit. ChatGPT's failure-mode hypothesis is incorrect. |
| F7: Dual-reviewer skip visibility in `progress.md` | technical | reject | auto (reject) | low | Already implemented at feature-coordinator.md L278: `record REVIEW_GAP: Codex CLI unavailable in progress.md`. |
| F8: Migration regex `^\d+` → `^\d{4,}` | technical | implement | auto (implement) | low | Repo standard is 4-digit prefixes per DEVELOPMENT_GUIDELINES.md §6.2. Tightening prevents accidental matches on non-migration filenames. |
| F9: Explicit "no parallel chunk execution" | technical | reject | auto (reject) | low | Already stated at feature-coordinator.md L116: "Process chunks one at a time in plan order. Do not start chunk N+1…". |

### Implemented (auto-applied technical + user-approved user-facing)

- [auto] F1: time-source invariant section added to `.claude/agents/feature-coordinator.md` (post-entry-guard) and `.claude/agents/finalisation-coordinator.md` (post-entry-guard)
- [auto] F2: removed `, create '.chatgpt-diffs/' if needed` from `.claude/agents/chatgpt-plan-review.md` step 5
- [auto] F5: tightened commit-integrity invariant in `.claude/agents/feature-coordinator.md` § Commit-integrity invariant — added explicit plan-declared subset check (step 1), preserving the existing 4-step working-tree validation as steps 2–5
- [auto] F8: migration collision regex `^\d+` → `^\d{4,}` in `.claude/agents/feature-coordinator.md` § Migration-number collision detection (both `MAIN_PREFIXES` and `BRANCH_PREFIXES`)

### Deferred (routed to tasks/todo.md)

- [user] F4: gate-type taxonomy + audit existing gates → tasks/todo.md § PR Review deferred items / PR #248

### Top themes

scope, error_handling, naming

### Verification

Lint: `npx eslint .` — failed in local environment (`@eslint/js` missing from local `node_modules`). Pre-existing env issue; round-1 changes are markdown-only and cannot be linted by ESLint.
Typecheck: `npm run typecheck` — failed in local environment (`vitest` missing from local `node_modules`, errors all in pre-existing test files in `client/src/**/*.test.ts`). Pre-existing env issue; round-1 changes are markdown-only and cannot be typechecked.

CI is the authoritative gate runner per `DEVELOPMENT_GUIDELINES.md §5` — full lint/typecheck/test-gate suite runs on the PR as a pre-merge gate.

---

## Round 2 — 2026-05-01T05:55:00Z

### ChatGPT Feedback (raw)

> Verdict: APPROVE. Ready to ship.
> No blockers. Remaining items are minor robustness and future-proofing.
>
> What improved (confirmed): time consistency invariant present and applied; gate classification clear; builder test execution guarded; chunk sequencing explicitly enforced; commit integrity + resume logic aligned; REVIEW_GAP visibility no longer lossy. All previously "real risks" resolved.
>
> Remaining minor tweaks:
> 1. Resume logic still slightly brittle on renames (low risk) — use `git log --follow -- <file>`.
> 2. Builder file list vs plan contract (clarity gap) — add explicit "builder must not introduce new files outside plan unless dependency-required or declared in implementation notes". Otherwise flag as deviation.
> 3. `.chatgpt-diffs/` (if still present) — still not part of any pipeline, not consumed downstream. Remove entirely or move to `tasks/builds/{slug}/artifacts/`.
> 4. Migration prefix regex (micro-hardening) — if not updated, change `^\d+` to `^\d{3,}`.
> 5. Finalisation phase: missing "no-op commit guard" — if no files changed, skip commit and log NO_OP_BUILD.
> 6. Very minor: terminology consistency — standardise "Plan = items, Execution = chunks". Optional cleanup.
>
> What you've achieved: deterministic execution; explicit state machine; strong recovery semantics; multi-agent coordination without hidden coupling; proper separation of planning / execution / validation / finalisation. That combination is rare.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| R2-1: Resume logic + renames (`git log --follow`) | technical | reject | auto (reject) | low | `--follow` only works with a single pathspec; current resume check uses multi-file pathspecs. Adopting verbatim would break the check. Existing logic handles renames correctly because rename commits surface in `git log` under both old and new paths within `origin/main...HEAD`. |
| R2-2: Builder file list vs plan contract | technical | reject | auto (reject) | low | Round-1 F5 already locked plan-declared ⊇ builder-reported as strict invariant. The escape hatches ChatGPT now wants ("dependency resolution", "implementation notes") would re-introduce the ambiguity F5 closed. PLAN_GAP is the existing escape hatch. |
| R2-3: `.chatgpt-diffs/` removal | technical | reject | auto (reject) | low | `.chatgpt-diffs/` is gitignored and actively used by chatgpt-pr-review (this session). Lifecycle is documented (mkdir at round 1, cleanup at finalisation step 14). Round-1 F2 removed the dead reference in chatgpt-plan-review only — chatgpt-pr-review's use is canonical. |
| R2-4: Migration regex `^\d+` → `^\d{3,}` | technical | reject | auto (reject) | low | Already done in round 1 F8 (changed to `^\d{4,}`, stricter than ChatGPT's `^\d{3,}`, matching repo's 4-digit convention). |
| R2-5: Finalisation no-op commit guard | technical | reject | auto (reject) | low | Empty-commit failure is preferable to silent NO_OP log. Per-chunk commits require non-empty changed-files; chatgpt-pr-review per-round commits already have explicit no-op skip. A builder SUCCESS with zero files is a bug to surface visibly, not silently skip. |
| R2-6: Terminology consistency (chunk/item/task) | technical | reject | auto (reject) | low | Self-described as "very minor", "optional", "polish", "Not required". No specific instances cited. Vague polish items in the backlog are noise. |

### Implemented

None — all findings rejected with rationale.

### Deferred

None.

### Top themes

scope, naming, error_handling

### Verification

No code changes this round. No-op for lint and typecheck (markdown-only session log update). No commit per agent step-8 rule (skip when no implementation files changed).

ChatGPT verdict: **APPROVE — ready to ship.**

---

## User-directed finding (between Round 2 and finalisation) — 2026-05-01T06:10:00Z

### Source

Operator-driven, not from ChatGPT review. Operator observed in another finalisation session that the doc-sync sweep declared `no — already accurate` for several reference docs without actually opening them. Stale references in `architecture.md` were missed until the operator explicitly prompted re-investigation; `capabilities.md` and `integration-reference.md` were never investigated despite being in scope. The trust-based verdict pattern was the failure mode.

### Finding

| Finding | Triage | Severity | Decision | Rationale |
|---------|--------|----------|----------|-----------|
| UD-1: Doc-sync sweep is trust-based — agents can declare "no — already accurate" without opening the doc, missing stale references the branch's changes invalidated | user-facing (changes how finalisation behaves; operator-experienced bug) | medium | implement | Real failure mode just observed in production. Fix is to make per-doc investigation mandatory and evidence-bearing (grep terms become the audit trail). |

### Implemented (user-directed)

Added a canonical **Investigation procedure** section to `docs/doc-sync.md` that mandates: (1) read the doc, (2) derive candidate-stale-reference set from the branch diff, (3) grep the doc for each candidate, (4) fix any stale references in the same finalisation pass, (5) record verdict only after steps 1–4. Tightened the **Verdict rule**: a `no` verdict must cite either the grep terms checked or the specific reason the doc's update trigger genuinely does not apply.

Mirrored the procedure reference into all four enforcement sites:

- [user] `docs/doc-sync.md` — added § Investigation procedure; tightened § Verdict rule to require grep-terms or scope-rationale citation in `no` verdicts
- [user] `.claude/agents/finalisation-coordinator.md § Step 6` — replaced inline verdict instructions with reference to the canonical procedure
- [user] `.claude/agents/chatgpt-pr-review.md § Finalization step 6` — same
- [user] `.claude/agents/chatgpt-spec-review.md § Finalization step 5` — same
- [user] `.claude/agents/feature-coordinator.md § Step 9` — same

### Verification

Markdown-only change. No code touched. Local lint/typecheck environment is broken pre-existing (markdown unaffected). CI runs canonical gate suite pre-merge.

### Note on review coverage

This change was made AFTER ChatGPT round-2 verdict (APPROVE) was given, so the merged state is not covered by ChatGPT review. The change is user-directed and additive (tightens an existing gate, does not introduce new behaviour outside the gate) and was approved by the operator from lived experience of the failure mode. Not escalated through a fresh ChatGPT round per operator decision.

---
