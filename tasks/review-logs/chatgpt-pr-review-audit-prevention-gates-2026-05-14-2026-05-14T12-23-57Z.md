# ChatGPT PR Review Session — audit-prevention-gates-2026-05-14 — 2026-05-14T12-23-57Z

## Session Info
- Branch: audit-prevention-gates-2026-05-14
- PR: #307 — https://github.com/michaelhazza/automation-v1/pull/307
- Mode: manual
- Started: 2026-05-14T12:23:57Z

### Context carried in from Phase 2 (pre-review)
- 14 new CI prevention-gates (P1-P24 minus P6 dropped per §B1)
- 4 doc rules landed (P17/P18/P19/P20)
- 3 KNOWLEDGE.md entries (P21/P22/P23)
- ADR-0024 (service-layer extraction)
- doc-sync.md row + references/test-gate-policy.md sub-section
- run-all-gates.sh wired with all 14 new gates
- S2 merge with main (37 commits drift) — KNOWLEDGE.md and tasks/current-focus.md resolved via auto-resolve table

### Pre-existing review verdicts (Phase 2)
- spec-conformance: CONFORMANT (0 deferred)
- pr-reviewer Round 1: APPROVED (0 Blocking / 8 Should-fix / 5 Consider)
- reality-checker: READY (9/9 spec §9 criteria verified)
- dual-reviewer: APPROVED (3 critical functional fixes applied — see `fc2fb394`)
- pr-reviewer Round 2 (post-dual-reviewer): APPROVED (0 Blocking / 5 Should-fix carried + 1 new / 1 Consider)
- adversarial-reviewer: skipped (policy-not-applicable, no §5.1.2 security surface crossed)

### Carried Should-fix items from pr-reviewer Round 2 (not yet addressed — surface in this loop if ChatGPT raises them)
1. `check_expiring_baseline` exit-2 semantics: returns warning whenever baseline has any entries, instead of only on current ∩ baseline > 0. Affects every gate with a non-empty baseline during the 90-day grace window.
2. `passing.ts` fixture uses `tx.select()` not `db.select()` — analyser short-circuits so the caller-walk positive case is not actually tested.
3. P9/P10 (`any-budget`, `marker-budget`) advertise `# expires:` directives in scripts but don't enforce them — contradicts the policy doc this build just landed in references/test-gate-policy.md.
4. P7 hardcoded entry-files list (will silently degrade as repo evolves).
5. `.ts` orphans flagged as React components (P15 mis-categorisation).
6. `wc -l` parity in P3 (line-counting discrepancy on CRLF vs LF).
7. Missing `cygpath` translation in 2 gates (Windows-only path issue).
8. Misleading `FILES_SCANNED` metric (counts pre-filter, not post-filter).

---

## Round 1 — 2026-05-14T12-50-00Z

**Verdict:** CHANGES_REQUESTED (3 Blocking / 3 Should-fix)
**Top themes:** error_handling, scope (analyser correctness), policy (gate expiry enforcement)

### ChatGPT Feedback (raw)

> PR review verdict: not ready to merge yet. I found 3 blocking issues and 3 should-fix items.
>
> 🔴 Blocking
> **F1**: `with-org-tx-or-scoped-db` can false-negative unsafe DB calls via same-name function collisions. `analyseWithOrgTxScope()` reduces a DB call to only the enclosing function name, then scans every project source file for any `withOrgTx(...funcName...)` reference. (scripts/lib/with-org-tx-analyser.mjs:118-131 + 220-227). Fix: resolve actual symbol/call graph with ts-morph, or constrain to same file + actual identifier references. At minimum add a regression test.
>
> **F2**: `types-used` treats barrel re-exports as real usage. `scanReferences()` scans all of `shared/`, excluding only the declaring file — so any re-export from another `shared/` file (e.g. `shared/types/index.ts`) counts as usage. (scripts/lib/types-used-pure.mjs:134-140 + 146-155). Fix: exclude re-export-only matches.
>
> **F3**: `verify-duplicate-blocks.sh` silently passes if jscpd fails or emits no report. (scripts/verify-duplicate-blocks.sh:27-30 + 38-46). The `|| true` after jscpd plus the `CURRENT_COUNT=0` default means a broken install / bad flag / parser failure / output path change produces a clean pass with zero clones. Fix: fail closed.
>
> 🟡 Should-fix
> **T1**: `verify-no-new-cycles.sh` suppresses madge failure before parsing. Same pattern as F3 (scripts/verify-no-new-cycles.sh:26 + 34-39). Capture status and fail with a clear "madge failed" message.
>
> **T2**: Per-file budget gates do not enforce expiry despite adding `# expires:` baselines. `verify-any-budget.sh` and `verify-marker-budget.sh` parse `path:count` baselines through `parsePerFileBudgetBaseline()`, which ignores expiry comments entirely. (scripts/verify-any-budget.sh:119-125 + scripts/verify-marker-budget.sh:142-149). This creates policy drift.
>
> **T3**: `architecture.md` claims `verify-org-id-source.sh` enforces a new invariant, but this PR does not add or wire that gate.

### Pre-triage verification (per playbook step 1b)

- **F1** — VERIFIED. `isCalledViaOrgScope(projectSf, funcName)` at `scripts/lib/with-org-tx-analyser.mjs:118-149` matches by name string across all project source files. A function named `listRuns()` in file A (unsafe) is wrongly marked safe if any other file B defines or calls `listRuns(...)` inside a `withOrgTx(...)` argument. Real false-negative.
- **F2** — VERIFIED. `scanReferences()` at `scripts/lib/types-used-pure.mjs:130-167` does `rg --glob '*.ts' --glob '*.tsx' --glob '!<declaring>' -e '\\b<name>\\b'` across all of `shared/`. A re-export line like `export type { Foo } from './foo'` matches and returns true.
- **F3** — VERIFIED. `scripts/verify-duplicate-blocks.sh:27-28` runs `npx jscpd ... || true` (suppresses non-zero exit). `:38-46` defaults `CURRENT_COUNT=0` if the report file does not exist.
- **T1** — VERIFIED. `scripts/verify-no-new-cycles.sh:26` runs `npx madge ... > "$TMP_CYCLES" || true` (suppresses non-zero exit). Empty file would cause Node JSON parse error at :34 but exit status of madge itself is hidden.
- **T2** — VERIFIED. `scripts/.gate-baselines/any-budget.txt` has 73 `# expires:` lines and `marker-budget.txt` has 34. `parsePerFileBudgetBaseline()` at `scripts/lib/per-file-counter-pure.mjs:106-127` skips every `#`-comment line. Directives are silently ignored.
- **T3** — REJECTED — diff-misread. `scripts/verify-org-id-source.sh` exists (dated 2026-04-24, pre-this-branch) AND is wired at `scripts/run-all-gates.sh:65` (`run_gate "$SCRIPT_DIR/verify-org-id-source.sh"`). ChatGPT confused "PR doesn't add the script" with "the claim in architecture.md is wrong" — the script already lives on main; this PR's `architecture.md` § Tenant Scoping addition is accurate.

### Recommendations and Decisions

| ID | Triage | Severity | Scope | Recommendation | Final Decision | Rationale |
|----|--------|----------|-------|----------------|----------------|-----------|
| F1 | technical-escalated (high severity carveout) | high | standard | implement (constrain to same-file or symbol-resolved + add regression test) | user-approved implement | Real false-negative on warning-first gate. ~30 LOC fix + 1 fixture. |
| F2 | technical-escalated (high severity carveout) | high | standard | implement (skip barrel re-exports + add regression test) | user-approved implement | Real false-negative on warning-first gate. ~30 LOC fix + 1 fixture. |
| F3 | technical-escalated (high severity carveout) | high | standard | implement (fail closed on jscpd error or missing report) | user-approved implement | Tool silently passes if jscpd breaks. ~10 LOC fix. |
| T1 | technical (auto-apply) | medium | standard | implement (fail closed on madge error) | auto (implement) | Same pattern as F3, low risk, ~10 LOC. |
| T2 | technical-escalated (defer recommendation) | medium | standard | defer to follow-up (route to tasks/todo.md) | user-approved defer | Fix requires parser + 2 shell scripts + tests (~50 LOC). Bug doesn't fire yet (all entries expire 2026-08-14). Routed to `tasks/todo.md` as `BUDGET-EXPIRY-ENFORCEMENT-1`. |
| T3 | technical (auto-reject) | low | standard | reject (diff-misread per step 1b) | auto (reject) | Script exists and is wired; ChatGPT confused PR scope. |

### Implementation summary

- **T1 (auto-applied):** `scripts/verify-no-new-cycles.sh` — capture madge exit code via `set +e`/`set -e`, fail closed (exit 1) on non-zero with stderr dump; harden Node JSON parser with try/catch + exit 2.
- **F3:** `scripts/verify-duplicate-blocks.sh` — same shape as T1 for jscpd. Also added explicit "report file missing on success" guard.
- **F1:** `scripts/lib/with-org-tx-analyser.mjs` — caller-walk constrained to the declaring file (`isCalledViaOrgScope(sf, enclosingFn)` instead of looping over `project.getSourceFiles()`). HEURISTIC LIMITATION docstring updated. Regression fixtures: `scripts/__fixtures__/with-org-tx/name-collision-unsafe.ts` + `name-collision-safe.ts`. New test case in `scripts/__tests__/with-org-tx-analyser.test.ts` confirms cross-file same-name function does NOT mask the unsafe call (6/6 tests pass).
- **F1 collateral:** `scripts/__fixtures__/with-org-tx/passing.ts` — fixed `tx.select()` → `db.select()` so the analyser actually exercises the success path (closes pr-reviewer Round 2 Should-fix #2).
- **F2:** `scripts/lib/types-used-pure.mjs` — added `stripReExports()` helper. `scanReferences` now uses rg `-l` (files-with-matches) then reads each candidate, strips re-export blocks, and re-tests. `scanReferencesNode` (Node fallback) gets the same treatment. Regression test cases added: barrel-only re-export → returns false; barrel + real consumer → returns true; plus 7 unit tests for `stripReExports` itself (19/19 tests pass).
- **T2:** deferred to `tasks/todo.md` as `BUDGET-EXPIRY-ENFORCEMENT-1` with full fix outline.

### Files changed this round

- `scripts/verify-no-new-cycles.sh` (T1)
- `scripts/verify-duplicate-blocks.sh` (F3)
- `scripts/lib/with-org-tx-analyser.mjs` (F1)
- `scripts/__fixtures__/with-org-tx/passing.ts` (F1 collateral / pr-reviewer Round 2 Should-fix #2)
- `scripts/__fixtures__/with-org-tx/name-collision-unsafe.ts` (F1 regression fixture, new)
- `scripts/__fixtures__/with-org-tx/name-collision-safe.ts` (F1 regression fixture, new)
- `scripts/__tests__/with-org-tx-analyser.test.ts` (F1 regression test case)
- `scripts/lib/types-used-pure.mjs` (F2)
- `scripts/__tests__/types-used-pure.test.ts` (F2 regression test cases)
- `tasks/todo.md` (T2 deferred follow-up)
- `tasks/review-logs/chatgpt-pr-review-audit-prevention-gates-2026-05-14-2026-05-14T12-23-57Z.md` (this log)

### Round 1 done

- Auto-accepted (technical): 1 implemented (T1), 0 rejected, 0 deferred. Plus 1 auto-rejected (T3 diff-misread).
- User-decided (technical-escalated): 3 implemented (F1/F2/F3), 0 rejected, 1 deferred (T2).
- Targeted Vitest runs: 6/6 with-org-tx-analyser tests pass; 19/19 types-used-pure tests pass.
- Lint: 0 errors / 887 warnings (baseline). Typecheck: clean.

