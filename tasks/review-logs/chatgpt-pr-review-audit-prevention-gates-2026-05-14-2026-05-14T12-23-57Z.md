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

---

## Round 2 — 2026-05-14T13-00-00Z

**Verdict:** CHANGES_REQUESTED (1 Blocking / 2 Should-fix)
**Top themes:** scope (analyser substring-match false-positive), policy (doc/code mismatch on budget gate expiry), prior-finding duplicate

### ChatGPT Feedback (raw)

> Round 2 verdict: close, but not ready to merge yet. The previous high-risk issues are mostly resolved, but I still see 1 blocking issue and 2 should-fix items.
>
> 🔴 Blocking
> **F4**: Expiring-baseline policy is still false for per-file budget gates. references/test-gate-policy.md says every per-gate baseline entry expires, but parsePerFileBudgetBaseline() ignores expiry comments. The any-budget.txt and marker-budget.txt baselines have `# expires:` lines that are effectively permanent. Fix: either extend per-file-counter-pure.mjs to parse expiry metadata, or explicitly carve out per-file count baselines from the policy and remove the misleading `# expires:` comments.
>
> 🟡 Should-fix
> **T4**: verify-org-id-source.sh is still claimed in docs but not wired into run-all-gates.sh. architecture.md states the invariant is enforced by `scripts/verify-org-id-source.sh`, but the run-all-gates.sh additions in this PR don't add it. Fix: add the gate, or soften the doc.
>
> **T5**: with-org-tx analyser still uses substring matching inside org-scope args. `argText.includes(funcName)` in isCalledViaOrgScope can false-positive on substring collisions or identifier mentions in comments/string literals. Fix: remove the broad includes() branch and rely on AST call/reference matching only.
>
> Resolved from prior round: F2, F3, T1 appear resolved. F1's main issue (cross-file same-name masking) appears resolved by fixture and test coverage.

### Pre-triage verification (per playbook step 1b)

- **F4** — VERIFIED as a substantive duplicate of Round 1 T2 (same files, same finding_type, same global concern) WITH new evidence (a lighter alternative remediation: soften the policy doc instead of implementing full expiry). The duplicate-detection rule preserves the Round 1 operator decision (defer); the new remediation option is genuinely different evidence so it deserves a re-decision. Operator chose "soften the doc now" — implemented in this round.
- **T4** — REJECTED — diff-misread (substantive duplicate of Round 1 T3, same finding, no new evidence). `git blame -L 65,66 scripts/run-all-gates.sh` confirms `verify-org-id-source.sh` was wired on 2026-04-04 in commit `89a818cc` ("Implement architecture guard system with security fixes") — six weeks before this branch began. The script is present at line 65 of `scripts/run-all-gates.sh` and architecture.md's claim is accurate. Per playbook step 1a, no escalation despite ChatGPT's stronger Round-2 phrasing.
- **T5** — VERIFIED. `scripts/lib/with-org-tx-analyser.mjs:136` originally had `if (argText.includes(funcName)) return true;` — a textual substring match that matches identifier text in comments, string literals, and longer identifiers (e.g. `load` inside `loadAll`). Real false-positive path on warning-first gate.

### Recommendations and Decisions

| ID | Triage | Severity | Scope | Recommendation | Final Decision | Rationale |
|----|--------|----------|-------|----------------|----------------|-----------|
| F4 | technical-escalated (new-remediation evidence on duplicate) | high (per ChatGPT) | standard | implement doc-softening + baseline-file annotations | user-approved (doc-soften) | Operator chose option B: clarify policy doc that per-file count baselines are out of scope for expiry framework; annotate baseline-file headers so `# expires:` lines are informational only. Closes blocking claim without expanding PR scope; updates BUDGET-EXPIRY-ENFORCEMENT-1 in tasks/todo.md to reflect the new framing. |
| T4 | technical (auto-reject, duplicate of R1/T3) | low | standard | reject (diff-misread, duplicate of Round 1 T3) | auto (reject — duplicate of Round 1 / T3) | Script wired since 2026-04-04. Same ChatGPT misread as Round 1; per duplicate-detection rule, no escalation. |
| T5 | technical (auto-apply) | medium | standard | implement (replace `.includes` with AST identifier walk + add regression test) | auto (implement) | Real false-positive (substring + comments + string-literal matches). Fix preserves correct method-call detection that ChatGPT's literal "remove .includes" remediation would have broken — see Insight in main session for the divergence. Single fixture + test added; 7/7 analyser tests pass. |

### Implementation summary

- **T5 (auto-applied):** `scripts/lib/with-org-tx-analyser.mjs::isCalledViaOrgScope` — replaced the `argText.trim() === funcName || argText.includes(funcName)` substring path AND the redundant second AST loop with a single AST identifier walk via `getDescendantsOfKind(SyntaxKind.Identifier)`. This matches identifier nodes in code (covering direct calls like `funcName(tx)`, method calls like `someService.funcName(tx)`, and bare references like `withOrgTx(funcName)`) but NOT identifier text in comments or string literals (the AST does not tokenize those as Identifier nodes). New fixture `scripts/__fixtures__/with-org-tx/substring-collision.ts` plus one test case in `scripts/__tests__/with-org-tx-analyser.test.ts`; 7/7 tests pass.
- **F4 (operator chose doc-soften):**
  - `references/test-gate-policy.md § Baseline expiry policy` reworded to scope the expiry framework to **violation-list baselines** (`<path>:<line>:<msg>` format) only.
  - New explicit sub-section `Per-file count baselines are out of scope for the expiry framework` carves out `any-budget.txt` and `marker-budget.txt` with a pointer to `BUDGET-EXPIRY-ENFORCEMENT-1`.
  - `scripts/.gate-baselines/any-budget.txt` and `scripts/.gate-baselines/marker-budget.txt` headers carry a `NOTE:` callout explaining that the per-entry `# expires:` lines are informational soft-deadlines, not enforced.
  - `tasks/todo.md § BUDGET-EXPIRY-ENFORCEMENT-1` status updated: doc/code mismatch CLOSED; feature gap remains and is now correctly framed as "future opt-in" rather than "current bug."
- **T4 (auto-rejected):** no code change. Logged duplicate-of-Round-1/T3 verdict above.

### Files changed this round

- `scripts/lib/with-org-tx-analyser.mjs` (T5)
- `scripts/__fixtures__/with-org-tx/substring-collision.ts` (T5 regression fixture, new)
- `scripts/__tests__/with-org-tx-analyser.test.ts` (T5 regression test case)
- `references/test-gate-policy.md` (F4 doc-soften)
- `scripts/.gate-baselines/any-budget.txt` (F4 header annotation)
- `scripts/.gate-baselines/marker-budget.txt` (F4 header annotation)
- `tasks/todo.md` (F4 BUDGET-EXPIRY-ENFORCEMENT-1 status update)
- `tasks/review-logs/chatgpt-pr-review-audit-prevention-gates-2026-05-14-2026-05-14T12-23-57Z.md` (this log)

### Round 2 done

- Auto-accepted (technical): 1 implemented (T5), 1 auto-rejected (T4 — duplicate of Round 1 T3, diff-misread).
- User-decided (technical-escalated): 1 implemented via doc-soften remediation (F4).
- Targeted Vitest runs: 7/7 with-org-tx-analyser tests pass (new substring-collision regression added).
- G3 lint/typecheck: skipped per operator decision (changes are 1 AST analyser tweak + doc/comment edits; targeted Vitest passes are the operative signal).

---

## Round 3 — 2026-05-14T13-15-00Z

**Verdict:** APPROVED (0 Blocking / 1 Should-fix — auto-rejected as triple-duplicate diff-misread)
**Top themes:** prior-finding duplicate (third occurrence)

### ChatGPT Feedback (raw)

> Yes. No new blocker from this pass.
>
> The prior F4 is resolved by explicitly carving per-file count baselines out of the expiry framework and documenting that any-budget.txt / marker-budget.txt expiry comments are informational only, with real enforcement deferred to BUDGET-EXPIRY-ENFORCEMENT-1. The actual baseline files now say the same thing, so the doc/implementation contradiction is gone.
>
> The prior T5 is resolved. isCalledViaOrgScope() now walks identifier nodes instead of using textual argText.includes(funcName), which closes the substring/comment/string-literal false-positive.
>
> One remaining should-fix:
>
> **T6**: verify-org-id-source.sh is still documented but not wired into run-all-gates.sh. architecture.md says the single org-id source invariant is enforced by `scripts/verify-org-id-source.sh`, but the new audit gate block in run-all-gates.sh still does not include it. Recommendation: add `run_gate "$SCRIPT_DIR/verify-org-id-source.sh"` or soften the architecture claim until it is wired.
>
> Verdict: mergeable after T6 if they want docs-to-CI consistency locked. Otherwise, acceptable as a small follow-up, but I'd fix it now because it is a one-line wiring/doc consistency issue.

### Pre-triage verification (per playbook step 1b)

- **T6** — REJECTED — diff-misread (substantive duplicate of Round 1 T3 AND Round 2 T4, same finding, no new evidence — third occurrence). Triple-verified: `git blame -L 65,66 scripts/run-all-gates.sh` returns commit `89a818cc` ("Implement architecture guard system with security fixes", Claude, 2026-04-04 09:14:28 +0000). The line `run_gate "$SCRIPT_DIR/verify-org-id-source.sh"` has been at line 65 of `scripts/run-all-gates.sh` continuously since 2026-04-04 — 40 days before this branch began. ChatGPT's persistent misread is consistent with the diff-only-reviewer false-positive pattern documented in KNOWLEDGE.md `[2026-05-14] diff-only reviewer blind spots on deletion-heavy + manifest-only PRs` from PR #305. ChatGPT only sees the unified diff; the script's pre-existing wiring lives in `main` and is invisible to the review surface.

### Recommendations and Decisions

| ID | Triage | Severity | Scope | Recommendation | Final Decision | Rationale |
|----|--------|----------|-------|----------------|----------------|-----------|
| T6 | technical (auto-reject, third-time duplicate of R1/T3 + R2/T4) | low (per ChatGPT) | standard | reject (diff-misread, third-time duplicate) | auto (reject — duplicate of Round 1 / T3 and Round 2 / T4) | Triple-verified via git blame: script wired since 2026-04-04 (commit `89a818cc`). No code change. Per playbook step 1a duplicate-detection rule, no escalation despite ChatGPT's continued language. |

### Final Summary

**Overall verdict:** APPROVED across 3 rounds.

**Round-by-round outcomes:**
- Round 1: CHANGES_REQUESTED (3 Blocking / 3 Should-fix) → 4 implemented (T1 + F1 + F2 + F3 with regression tests), 1 deferred (T2 → tasks/todo.md), 1 auto-rejected (T3 diff-misread).
- Round 2: CHANGES_REQUESTED (1 Blocking / 2 Should-fix) → 2 implemented (T5 analyser fix + F4 doc-soften), 1 auto-rejected (T4 — Round 1 T3 duplicate).
- Round 3: APPROVED, no new findings. 1 auto-rejected (T6 — third-time Round 1 T3 duplicate).

**Code changes summary:**
- Gate scripts hardened to fail closed on tool errors: `verify-no-new-cycles.sh` (T1), `verify-duplicate-blocks.sh` (F3).
- With-org-tx analyser: caller-walk constrained to declaring file (F1) + AST identifier walk replacing substring `.includes` (T5); 2 regression fixtures + 2 test cases added.
- Types-used analyser: `stripReExports` helper added; barrel re-exports no longer count as usage (F2); 2 regression test cases + 7 unit tests added.
- `passing.ts` fixture corrected to actually exercise `db.select()` (closes pr-reviewer Round 2 Should-fix #2).
- Doc clarifications: `references/test-gate-policy.md` carves per-file count baselines out of the expiry framework (F4); both budget baseline file headers carry a NOTE callout (F4).

**Deferred backlog from this review:**
- `BUDGET-EXPIRY-ENFORCEMENT-1` in `tasks/todo.md` — future opt-in feature gap (no current doc/code mismatch).

**Spec deviations:** none introduced by review fixes. F4's doc-soften is a clarification of the existing spec §13 Q1 intent, not a deviation.

**Files changed across all rounds:**
- `scripts/verify-no-new-cycles.sh`
- `scripts/verify-duplicate-blocks.sh`
- `scripts/lib/with-org-tx-analyser.mjs`
- `scripts/lib/types-used-pure.mjs`
- `scripts/__fixtures__/with-org-tx/passing.ts`
- `scripts/__fixtures__/with-org-tx/name-collision-unsafe.ts` (new)
- `scripts/__fixtures__/with-org-tx/name-collision-safe.ts` (new)
- `scripts/__fixtures__/with-org-tx/substring-collision.ts` (new)
- `scripts/__tests__/with-org-tx-analyser.test.ts`
- `scripts/__tests__/types-used-pure.test.ts`
- `scripts/.gate-baselines/any-budget.txt`
- `scripts/.gate-baselines/marker-budget.txt`
- `references/test-gate-policy.md`
- `tasks/todo.md`
- `tasks/review-logs/chatgpt-pr-review-audit-prevention-gates-2026-05-14-2026-05-14T12-23-57Z.md` (this log)

**Operator close-of-review signal:** "close the review after this and progress to finalisation and merge, don't ask me any more questions" — received 2026-05-14T13:15Z. Closing the review here and proceeding to Step 6 (doc-sync sweep) and beyond.

### Round 3 done

- Auto-accepted: 0 implemented, 1 auto-rejected (T6 — third-time Round 1 T3 duplicate).
- User-decided: none (operator-explicit close-of-review signal).
- No code changes this round. Log-only commit follows.

---

## Phase 3 Doc Sync sweep — 2026-05-14T13-20-00Z

Per `docs/doc-sync.md § Investigation procedure`. 17 registered docs / meta-rows.

**Pre-condition:** `origin/main` HEAD is still `2802ebc0` (the same head observed during Phase 2 doc-sync). No new content from main has landed on this branch beyond what Phase 2 already accounted for. Phase 2 verdicts therefore remain applicable; only `references/test-gate-policy.md` is re-verdicted because Round 2 F4 added a new sub-section.

**Candidate-stale-reference set from Round 1/2/3 diff:**
- New symbols: `stripReExports`, `isCalledViaOrgScope` (semantic change, not rename), `name-collision-unsafe`, `name-collision-safe`, `substring-collision`, `BUDGET-EXPIRY-ENFORCEMENT-1`
- New policy section title: "Per-file count baselines are out of scope for the expiry framework"
- Behavioural changes: `verify-no-new-cycles.sh` / `verify-duplicate-blocks.sh` fail-closed on tool error; with-org-tx analyser caller-walk constrained to declaring file + AST identifier walk replacing substring `.includes`; types-used analyser strips barrel re-exports before counting usage

**Grep verification:** zero stale references found in `architecture.md`, `CLAUDE.md`, `DEVELOPMENT_GUIDELINES.md`, `docs/capabilities.md`, `docs/integration-reference.md`, `docs/frontend-design-principles.md`, `KNOWLEDGE.md`, `docs/incident-response.md`, `docs/testing-transition-plan.md`, `CONTRIBUTING.md`, `docs/context-packs/`, `docs/decisions/`, `references/spec-review-directional-signals.md`, `.claude/CHANGELOG.md`, `.claude/FRAMEWORK_VERSION` for any of the new symbols. Only hit was `references/test-gate-policy.md` itself for "Per-file count baselines" (its own update).

### Phase 3 doc-sync verdict table

| Doc | Verdict |
|---|---|
| `architecture.md` | yes (Phase 2 Tenant Scoping § Single org-id source — no Round-N updates needed) |
| `docs/capabilities.md` | yes (Phase 2 Editorial Rules — no Round-N updates needed) — `n/a: build / tooling change only` for the gate-script and analyser hardening from Round 1/2 |
| `docs/integration-reference.md` | n/a — no integration behaviour changes; CI gates + analyser internal logic only |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | yes for CLAUDE.md (Phase 2 § 6 Surgical Changes refactor-residue comments, § Frontend Design Principles named exports). DEVELOPMENT_GUIDELINES.md: n/a |
| `CONTRIBUTING.md` | n/a — no contributor-facing convention changes; suppression grammar is reference-doc material |
| `docs/frontend-design-principles.md` | n/a — no UI pattern / hard rule introduced |
| `KNOWLEDGE.md` | yes (Phase 2: 3 entries P21–P23). Step 7 cross-check pass will append new round-driven patterns from Round 1/2 if any are durable. |
| `docs/spec-context.md` | n/a — does not apply to feature pipelines |
| `docs/decisions/` | yes (Phase 2 ADR-0024 service-layer extraction). No new ADR from Round 1/2/3 — analyser changes are internal helper logic, not architectural locks. |
| `docs/context-packs/` | no — checked all 5 packs for stale anchor refs; only context-packs reference to this build's surface is `minimal.md#key-files-per-domain` (anchor-name, not line-number), unaffected by Round 1/2/3 changes |
| `references/test-gate-policy.md` | yes (Phase 2 "Audit-prevention-gates policy (2026-05-14)" sub-section; Round 2 F4 reworded "Baseline expiry policy" paragraph + added "Per-file count baselines are out of scope for the expiry framework" sub-section) |
| `references/spec-review-directional-signals.md` | n/a — no spec-reviewer signal patterns introduced |
| `docs/incident-response.md` | n/a — no SEV / on-call / post-mortem changes |
| `docs/testing-transition-plan.md` | n/a — no testing-migration-plan changes |
| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | n/a — repo-specific CI gates + docs, not framework-level agent-fleet changes |
| `scripts/verify-*` (15 gates) row | yes (Phase 2 authored the row; Round 1 hardened 2 of those gates against silent tool failure — doc-sync row stays valid) |
| `docs/doc-sync.md` itself | yes (Phase 2 added the `scripts/verify-*` row) |

**Verdicts: 9 yes / 7 n/a / 1 no (with grep rationale).** All 17 registered rows covered. No blocker.

### Final Summary

- KNOWLEDGE.md updated: yes (3 entries Phase 2 P21-P23 + 1 new Round 3 entry "diff-only reviewer triple-misread pattern" appended in Step 7)
- architecture.md updated: yes (sections § Tenant Scoping → Single org-id source — Phase 2)
- capabilities.md updated: `n/a: build / tooling change only`
- integration-reference.md updated: n/a — no integration behaviour change
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: yes — CLAUDE.md §6 Surgical Changes + §Frontend Design Principles; DEVELOPMENT_GUIDELINES.md n/a
- frontend-design-principles.md updated: n/a — no new UI pattern or hard rule

**Final verdict:** APPROVED across 3 rounds + 1 doc-sync sweep. Mergeable.

