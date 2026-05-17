# chatgpt-pr-review — framework-standalone-repo — PR #342

**Slug:** `framework-standalone-repo`
**Branch:** `claude/review-dev-agent-setup-6SC3d`
**PR:** https://github.com/michaelhazza/automation-v1/pull/342
**Mode:** MANUAL (operator drives ChatGPT-web rounds)
**Session start:** 2026-05-17T07:26:00Z

---

## Phase 2 review-coverage context (advisory)

Phase B + Phase C ran internal validation only (`lint` / `typecheck` / `sync.js --check` / `validate-setup` agent — all clean) but did NOT run the canonical Phase 2 GRADED review pass for the new work. The handoff documents Phase A reviewer verdicts only (PR #257, already merged). This makes chatgpt-pr-review the primary branch-level reviewer for Phase B + Phase C.

---

## Round 1

**Diff:** `.chatgpt-diffs/pr342-round1-code-diff.diff` (741K, 82 files, code-only)
**Verdict:** CHANGES_REQUESTED (per ChatGPT)
**Findings:** 5 (2 Blocking, 2 Should-fix, 1 Consider)

### Findings + triage

| ID | Severity | Category | Verdict | Rationale |
|---|---|---|---|---|
| F1 | Blocking | technical | **REJECT (false positive)** | ChatGPT misread the deletion path. The deleted file is `setup/portable/tasks/todo.md` — a bundled distribution template that ships with the portable framework to NEW adopting repos. The active `tasks/todo.md` at repo root is unchanged (verified — file exists). All workflow references resolve to the active path, not the bundled template. The bundle (including its `tasks/todo.md` template) is now distributed via the submodule at `.claude-framework/`. |
| F2 | Blocking | technical | **REJECT (false positive)** | ChatGPT misread the deletion path. The deleted file is `setup/portable/.claude/agents/dual-reviewer.md` (bundled copy). The active agent at `.claude/agents/dual-reviewer.md` is unchanged (verified — file exists). Coordinator references resolve to the active path; the bundle is now in `.claude-framework/.claude/agents/dual-reviewer.md`. |
| F3 | Should-fix | technical | **REJECT (false positive)** | ChatGPT misread the deletion path. The deleted file is `setup/portable/tasks/review-logs/README.md` (bundled template). The active `tasks/review-logs/README.md` is unchanged (verified — file exists). Filename/verdict contracts are read from the active path. |
| F4 | Should-fix | technical | **REJECT (false positive)** | ChatGPT misread the deletion path. The deleted file is `setup/portable/docs/decisions/0002-interactive-vs-walkaway-review-agents.md` (bundled copy). The active ADR at `docs/decisions/0002-interactive-vs-walkaway-review-agents.md` is unchanged (verified — file exists). Institutional memory preserved at the active path. |
| T1 | Consider | technical | **REJECT (already addressed)** | A migration note already exists at `.claude-framework/MIGRATION-FROM-COPY-PASTE.md` (in the framework repo, accessed via the submodule). The Phase B + Phase C migration is documented in `tasks/builds/framework-standalone-repo/handoff.md § Phase B + Phase C — complete (2026-05-17)` (operational history), `CLAUDE.md § Framework version` (adopter-facing), and `.claude/CHANGELOG.md § Version authority` (version semantics). No additional top-level note needed. |

### Root cause of all 5 findings

ChatGPT treated `setup/portable/<path>` deletions as deletions of the corresponding active files (without the `setup/portable/` prefix). The bundle is the distribution template that ships to adopting repos — deleting it here is correct because the bundle has been lifted to the standalone framework repo `claude-code-framework` v2.4.0 and is now consumed back into Automation OS via the `.claude-framework/` submodule.

### Active-path verification (executed prior to triage)

```
$ ls .claude/agents/dual-reviewer.md tasks/todo.md tasks/review-logs/README.md docs/decisions/0002-interactive-vs-walkaway-review-agents.md
.claude/agents/dual-reviewer.md
docs/decisions/0002-interactive-vs-walkaway-review-agents.md
tasks/review-logs/README.md
tasks/todo.md
```

All four cited files exist at their active paths. Findings are false positives.

### Code changes this round

None. All five findings rejected as false positives.

### G3 (lint + typecheck) — not required this round (no code changes)

### Round 2 diff

Regenerated at `.chatgpt-diffs/pr342-round2-code-diff.diff` (byte-identical to round 1 — no code changes this round).

---

## Round 2

**Diff:** `.chatgpt-diffs/pr342-round2-code-diff.diff` (byte-identical to round 1, no code changes between rounds)
**Verdict:** CHANGES_REQUESTED (per ChatGPT — one additional finding F5)

### Findings + triage

| ID | Severity | Category | Verdict | Rationale |
|---|---|---|---|---|
| F5 | Blocking | technical | **ACCEPT — fix applied** | CORRECT finding. The S2 merge resolution `git checkout --ours -- .github/workflows/ci.yml` replaced the entire file with our branch's pre-merge HEAD, rolling back not just our intended portable_framework_tests removal but also main's improvements over 68 commits: `DATABASE_URL_TEST` + `synthetos_app` non-superuser RLS test path on `integration_tests`, Session K consolidation of `grep_invariants` and `portable_framework_tests` into `lint_and_typecheck`, and all related CI improvements. ChatGPT spotted the integration-tests regression specifically. |

### Root cause

Misuse of `git checkout --ours` on a fully-merged-with-conflict file. The auto-resolve table in `finalisation-coordinator` Step 2 reserves `--ours` for feature-branch-canonical artefact files (e.g. `tasks/builds/{slug}/*.md`). `.github/workflows/ci.yml` is a code-area file where `--ours` rolls back the WHOLE file, not just the conflicted hunk. The correct path for code-area conflicts is manual surgical edit of the conflict markers in place, preserving auto-merged improvements.

### Fix applied

Re-checked out `origin/main:.github/workflows/ci.yml` (full main version with Session K consolidation + non-superuser integration_tests path), then made the surgical edit our branch actually needed: removed lines 221-226 (the "Portable framework tests" step) and replaced with an explanatory comment. All other improvements from main retained:

- `integration_tests` job retains `DATABASE_URL_TEST: postgres://synthetos_app:synthetos_app@localhost:5432/automation_os_test`
- "Set synthetos_app password (CI only)" step retained
- TI-008 commentary retained
- `lint_and_typecheck` Session K consolidation retained (folded grep_invariants gates inline)
- All Spec B sandbox gates, Operator Backend gates, B.1-B.6 + E.6 grep invariants retained

### Code changes this round

- `.github/workflows/ci.yml` — surgical fix per F5 (removed `Portable framework tests` step from lint_and_typecheck; kept explanatory comment; all other main improvements restored)

### G3 (lint + typecheck) — PASS

- `npm run lint` → 0 errors / 882 pre-existing warnings
- `npm run typecheck` → clean

### Round 3 diff

Regenerated at `.chatgpt-diffs/pr342-round3-code-diff.diff` after the fix commit.

---

## Session close

**Operator instruction received (mid-Round-2):** "after this, close this review and progress to finalisation". Verdict for the session: **APPROVED_AFTER_FIXES** (R1 rejected 5 false-positive findings with verified rationale; R2 accepted + fixed F5 — a real regression caused by the S2 merge-resolution mistake).

## Doc-sync sweep verdicts (per docs/doc-sync.md)

Candidate stale-reference set greped: `setup/portable`, `portable_framework_tests`, `test:portable-framework`, `build-portable-framework`, `lift-framework-to-standalone-repo`, `claude-code-framework`, `.claude-framework`, `framework-state.json`.

| Doc | Verdict |
|-----|---------|
| `architecture.md` | `n/a` — grepped clean. Build is internal-framework scope (Phase C self-adoption); does not change service boundaries, routes, agent fleet, RLS, or schema invariants. |
| `docs/capabilities.md` | `n/a: internal refactor with no capability surface change` — Phase C is an internal framework-distribution refactor (in-repo bundle → submodule). No capability ID, name, owner, cluster, lifecycle state, launch source, risk surface, or related-docs field changed. |
| `docs/integration-reference.md` | `n/a` — no integration behaviour change (no new scope, skill, OAuth provider, MCP preset, capability slug, or alias). |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | `yes (CLAUDE.md § Framework version)` — updated in Phase C to point at `.claude-framework/` + `.claude/.framework-state.json` and document deployment-marker semantics. DEVELOPMENT_GUIDELINES.md grepped clean. |
| `CONTRIBUTING.md` | `n/a` — no lint-suppression policy, comment-format, or contributor-convention change. |
| `docs/frontend-design-principles.md` | `n/a` — no UI patterns introduced. |
| `KNOWLEDGE.md` | `yes` — patterns appended in Step 7 (see Step 7 list below). Line 2174 historical citation of `portable_framework_tests` is correct usage (meta-pattern about CI consolidation doc-sync) — left untouched. |
| `docs/spec-context.md` | `n/a` — not a spec-review session. |
| `docs/decisions/` | `no — submodule distribution model was decided in Phase A spec (already merged via PR #257); Phase B + C execute the model rather than re-deciding it. Version-authority pattern documented in KNOWLEDGE.md per decisions/README.md "KNOWLEDGE first, ADR if cited later" rule. Promote later if recurring.` |
| `docs/context-packs/` | `n/a` — architecture.md section anchors unchanged. |
| `references/test-gate-policy.md` | `n/a` — checked: no umbrella command added, no local check added, no test-gate posture change. The `test:portable-framework` script removal does not affect the policy (script was already permitted as targeted; it's now simply gone). |
| `references/spec-review-directional-signals.md` | `n/a` — not a spec-reviewer session. |
| `docs/incident-response.md` | `n/a` — no SEV / on-call / post-mortem changes. |
| `docs/testing-transition-plan.md` | `n/a` — no migration-trigger, test-inventory, or phasing change. |
| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | `yes (CHANGELOG § Version authority)` — updated to name the submodule as canonical and clarify deployment-marker semantics. FRAMEWORK_VERSION file reads `2.4.0` (matches submodule pin). |
| `scripts/verify-*` (15 gates) | `n/a` — no gate added/removed/renamed; no suppression-grammar change; no baseline-expiry change. `scripts/verify-test-quality.sh` was modified to swap an exclusion path (`setup/portable/` → `.claude-framework/`), which preserves the gate's posture exactly. |

16 verdicts / 16 registered docs. 2 yes, 1 no (substantiated), 13 n/a (substantiated). Sweep complete.

## Final Summary

- KNOWLEDGE.md updated: yes (3 entries — see Step 7)
- architecture.md updated: n/a
- capabilities.md updated: n/a: internal refactor with no capability surface change
- integration-reference.md updated: n/a
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: yes (CLAUDE.md § Framework version)
- frontend-design-principles.md updated: n/a
