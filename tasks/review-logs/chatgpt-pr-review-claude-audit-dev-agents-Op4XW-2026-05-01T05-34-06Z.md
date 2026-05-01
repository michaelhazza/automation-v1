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
