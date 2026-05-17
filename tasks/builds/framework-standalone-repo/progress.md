# Progress — framework-standalone-repo — Phase 3 (Phase B + Phase C cycle)

**Branch:** `claude/review-dev-agent-setup-6SC3d`
**PR:** #342 — https://github.com/michaelhazza/automation-v1/pull/342

## Phase 3 (FINALISATION) — in progress

**Captured:** 2026-05-17 (Phase B + Phase C cycle; distinct from the prior Phase A finalisation that shipped as PR #257)

### Session log

- **Step 0** — context loaded; entry guard PASS (`status: REVIEWING`); legacy short-form REVIEW_GAP for dual-reviewer surfaced from handoff (Codex CLI unavailable in Phase A; carried forward to chatgpt-pr-review as primary second-opinion pass).
- **Step 2** — branch was 68 commits behind `origin/main` (red threshold). Operator authorised `force`. S2 merge produced 2 conflicts: `tasks/current-focus.md` auto-resolved (ours per known-shape table); `.github/workflows/ci.yml` operator-resolved (took ours per recommendation). Merge committed as `5b0f531f`. **Note:** the `--ours` resolution on ci.yml introduced a regression — see Step 5 below.
- **Step 3** — G4 PASS (lint 0 errors / typecheck clean).
- **Step 4** — no PR existed; created PR #342 from this branch. URL printed in coordinator log.
- **Step 5** — chatgpt-pr-review MANUAL, 2 rounds:
  - R1 verdict: CHANGES_REQUESTED with 5 findings (F1, F2 Blocking + F3, F4 Should-fix + T1 Consider). All 5 rejected as false positives — ChatGPT misread `setup/portable/<path>` deletions as deletions of the active `<path>`. Active files verified via `ls` pre-triage.
  - R2 verdict: CHANGES_REQUESTED with 1 new finding (F5 Blocking — CI integration_tests regression from S2 merge-resolution). **F5 was correct.** Root cause: `git checkout --ours -- .github/workflows/ci.yml` in Step 2 replaced the entire file with the feature branch's pre-merge HEAD, rolling back 68 commits of main's auto-merged improvements (DATABASE_URL_TEST + synthetos_app non-superuser RLS test path on `integration_tests`, Session K consolidation, etc.). Fix applied as commit `5871ffcc`: re-checked out main's ci.yml, then surgically removed only the `Portable framework tests` step from `lint_and_typecheck`. All other main improvements restored. G3 re-verified PASS.
  - Session-close verdict: **APPROVED_AFTER_FIXES**.
  - Review log: [chatgpt-pr-review-framework-standalone-repo-2026-05-17T07-31-15Z.md](../../review-logs/chatgpt-pr-review-framework-standalone-repo-2026-05-17T07-31-15Z.md).
- **Step 6** — Full doc-sync sweep across 16 registered docs. 2 yes (CLAUDE.md § Framework version, .claude/CHANGELOG.md § Version authority), 1 no (docs/decisions/ — submodule distribution model already decided in Phase A spec, version-authority pattern lives in KNOWLEDGE.md per the "KNOWLEDGE first, ADR if cited later" rule), 13 n/a (substantiated). Verdicts persisted in the review log.
- **Step 7** — 3 KNOWLEDGE.md patterns appended:
  1. `git checkout --ours` on a code-area conflict file rolls back ALL auto-merged improvements, not just the conflicted hunk.
  2. ChatGPT diff path-prefix misreading when an in-repo bundle is lifted to an external source.
  3. chatgpt-pr-review R2 with fresh context can surface real findings R1 missed entirely.

## Compound Learning Feedback (LEARNING_FEEDBACK_PROPOSAL)

| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| `git checkout --ours` mistake on code-area conflict files | `agent-instruction` (`finalisation-coordinator`) | Extend Step 2 auto-resolve protocol to explicitly call out the destructive behaviour of `--ours` on partially-auto-merged code files; provide the surgical-edit recipe in the pause-and-prompt message ("open file, remove ONLY the conflict markers, keep auto-merged content from main, then `git add`"). Today the playbook lists code-area paths that pause-and-prompt, but doesn't warn against the `--ours` reflex once the operator answers "take ours" on a specific hunk. | pending |
| ChatGPT diff path-prefix misreading on bundle-lift PRs | `agent-instruction` (`finalisation-coordinator`) | Extend Step 5 dispatch to detect bundle-lift PRs (large deletion blocks under `setup/`, `vendor/`, `third_party/`, `tools/.bundled/`) and inject an active-path verification preamble into the chatgpt-pr-review sub-agent's kickoff context. The 8-line preamble short-circuits the entire false-positive cascade documented in KNOWLEDGE.md 2026-05-17. Routing as `finalisation-coordinator` rather than `chatgpt-pr-review` because the latter is not in the §6.2.1 6-agent shortlist; the dispatch hook is in finalisation-coordinator's Step 5 anyway. | pending |
| chatgpt-pr-review R2 surfaces real findings R1 missed | `agent-instruction` (`finalisation-coordinator`) | Extend Step 5 iterative-loop discipline: require at least 2 rounds before closing the loop if R1's findings were all-rejected AND the diff is >500 LOC. Document the pairing with the existing KNOWLEDGE.md 2026-05-14 same-finding-twice rule (which signals close, not continue). Today's locked rule is "operator drives cadence, no auto-close" — this is compatible, but adds a minimum-rounds floor for large-diff PRs to catch the R1-blind-spot pattern. | pending |

Operator approval converts approved rows to `tasks/todo.md` items under heading `### compound-learning: <pattern-title> (framework-standalone-repo)`. Unapproved rows remain here as deferred.
