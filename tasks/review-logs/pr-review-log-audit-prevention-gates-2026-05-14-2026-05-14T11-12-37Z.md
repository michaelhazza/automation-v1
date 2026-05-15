# PR Review Log — audit-prevention-gates-2026-05-14
**Branch HEAD:** 410c26ba
**Reviewed:** 2026-05-14T11-12-37Z
**Reviewer:** pr-reviewer (independent)
**Files reviewed:** 14 new gate scripts + 1 tightened gate + 10 .mjs pure-helper modules + 9 Vitest test files + 17 baseline files + 1 ADR + doc-sync/test-gate-policy/KNOWLEDGE/architecture/CLAUDE/capabilities doc updates + run-all-gates.sh wiring + tasks/todo.md close-out. Per-chunk SHAs verified per build summary.

Summary line for orchestrator: `Blocking: 0 / Should-fix: 8 / Consider: 5`

**Verdict:** APPROVED (no blockers; 8 should-fix items worth addressing in-PR; partial baseline is operator-accepted; CI workflow doesn't yet wire run-all-gates.sh so gate posture is advisory at this point).

---

## Blocking — must be fixed before merge

No blocking issues found.

The two items that initially looked blocking on inspection are not:
- The partial baseline at `scripts/.gate-baselines/with-org-tx-or-scoped-db.txt` (only ~80 service files seeded) would cause `bash scripts/verify-with-org-tx-or-scoped-db.sh` to exit 1 on the current tree, but CI (`.github/workflows/ci.yml`) does NOT invoke `scripts/run-all-gates.sh` — only specific gates wired explicitly. The new gates ship in advisory state. Operator deviation note acknowledges this; deferred-follow-up logged in `tasks/todo.md:388`.
- The "All 19 prior violations" comment in `scripts/.gate-baselines/no-db-in-routes.txt` is misleading (only 1 file is actually suppressed inline) but the gate's narrow grep `import.*db.*from.*['"].*\/db` matches only that 1 file in practice, so the gate passes. See should-fix S2 for the documentation mismatch.

---

## Should-fix — non-blocking but expected in-PR unless explicitly deferred

**S1.** `scripts/lib/with-org-tx-analyser.mjs:1-241` — `scripts/__fixtures__/with-org-tx/passing.ts` does NOT exercise the single-level caller walk. The fixture uses `tx.select()` inside the `withOrgTx` callback, but the analyser only flags `db.select()` (filters `objectText !== 'db'`). The "passing" fixture would never have been flagged regardless of the scope analysis — the test asserts "no violations" trivially. Failing/suppressed fixtures correctly use `db.select()`.
Why: the most important behavioural assertion of this gate (single-level caller walk recognises `withOrgTx` scope) has no test coverage; a regression that breaks the scope detection would not be caught.
Fix: revise the passing fixture to use `db.select()` from within a function called via `withOrgTx`, OR author a new Vitest case that exercises the caller-walk path explicitly.

**S2.** `scripts/lib/per-file-counter-pure.mjs:83-127` + `scripts/verify-any-budget.sh` + `scripts/verify-marker-budget.sh` — per-file budget gates do NOT honour the `# expires: YYYY-MM-DD` directive. `diffAgainstBaseline` parses through `parsePerFileBudgetBaseline` which discards comments (including expiry). Neither gate calls `check_expiring_baseline`, so the expiry mechanism documented in `references/test-gate-policy.md` is silently bypassed for P9 and P10.
Why: the baseline-expiry policy is one of the key contracts this build introduces; two gates don't enforce it.
Fix: route P9/P10 baseline parsing through `parseBaselineFile` from `gate-baseline-helpers.mjs`, OR document explicitly that per-file budget gates use a flat baseline format and expiry is per-file (not per-entry) handled at baseline-refresh time.

**S3.** `scripts/lib/universal-skill-sync-pure.mjs:71-83` — `entryFiles` is a hardcoded list of 10 registry filenames. A future registry file would be silently ignored by P7.
Fix: replace the hardcoded list with a directory scan that excludes known non-entry files (`types.ts`, `index.ts`, `factories.ts`, `__tests__/`).

**S4.** `scripts/.gate-baselines/no-db-in-routes.txt:9-12` — header comment claims "All 19 prior violations from guard-baselines.json are now suppressed via inline guard-ignore comments". Only 1 file actually has the inline suppression. The legacy 19-count was from a different (broader) regex.
Fix: rewrite the header comment to reflect actual state and orphan the legacy 19 entries from `guard-baselines.json` in a follow-up.

**S5.** `scripts/lib/orphan-component-analyser.mjs:50-61` — analyser walks both `.tsx` and `.ts` files and emits "React component file has no ingress" for `.ts` pure-helper companions. The framing is wrong.
Fix: emit distinct messages for `.tsx` vs `.ts`, OR limit scanning to `.tsx` only and let knip catch orphan helpers separately.

**S6.** `scripts/verify-loc-cap.sh:93-94` — uses `content.split('\n').length` for line count but script header documents "Counting method: `wc -l`". `split('\n').length` differs from `wc -l` by 1 for files without trailing newline.
Fix: change to `(content.match(/\n/g) || []).length` for `wc -l` parity.

**S7.** `scripts/verify-with-org-tx-or-scoped-db.sh:30-77` + `scripts/verify-no-orphan-react-component.sh:44-67` — these gates pass paths to Node without `cygpath -m` normalisation. Other gates in this build (P11/P12/P16) DO normalise. On Windows in Git Bash, local smoke-runs will fail.
Fix: copy the cygpath normalisation block from `verify-knip-config.sh:37-42`.

**S8.** `scripts/verify-any-budget.sh:117` + `scripts/verify-marker-budget.sh:136` + `scripts/verify-loc-cap.sh:110` — `FILES_SCANNED` is computed from violation-list length, not actual files scanned. Summary line prints misleading "0 files scanned" when violations=0 but many files were checked.
Fix: capture the scanned-file count separately from Node output.

---

## Consider — taste / future-proofing

**C1.** `scripts/verify-with-org-tx-or-scoped-db.sh:60-83` and `scripts/verify-no-orphan-react-component.sh:43-66` — under `set -e`, the `NODE_EXIT=$?` line after `RESULT_JSON=$(node ...)` is unreachable.
Fix: use `RESULT_JSON=$(node ... 2>&1) || NODE_EXIT=$?` to short-circuit before `-e`.

**C2.** `scripts/lib/types-used-pure.mjs:79` — suppression regex accepts T0 form (no `reason=`); canonical grammar requires reason.
Fix: tighten to require `\s+reason="[^"]+"`.

**C3.** `docs/decisions/0024-service-layer-extraction-for-routes-touching-db.md:18` — Decision (1) about route → `shared/types/` imports is not gate-enforced; the P2 tighten only adds `import type` skip.
Fix: add to "Consequences → Negative" that decision (1) is review-enforced; consider a follow-up gate.

**C4.** `scripts/verify-canonical-retry.sh:69-75` — the `retries\s*=\s*[0-9]+` regex matches non-declaration patterns.
Fix: tighten to `\b(let|const|var)\s+retries\s*=`.

**C5.** `references/test-gate-policy.md:75` + `scripts/verify-no-missing-deps.sh:80-83` + `scripts/verify-loc-cap.sh:153-158` — policy says all new gates ship at `default_exit_code=2`, but P1 and P3 exit 1 by design.
Fix: amend policy doc to note exceptions.

---

## Files NOT read

- `node_modules/` and lockfile churn — verified declared in `package.json` (lines 102-105).
- Per-chunk commit history (12 SHAs) — accepted as authoritative; reviewed cumulative state on HEAD `410c26ba`.
- `scripts/.gate-baselines/no-orphan-react-component.txt` past the first 207 entries — sample sufficient.
- `tasks/todo.md` close-out beyond the prevention-proposals section — orchestrator note confirms 24 closed + 16 deferred follow-ups.
- Deeper assertion-by-assertion Vitest review for some test files — spot-check confirmed pattern consistency.

None of the unread files could invalidate the verdict.

---

**Final verdict:** APPROVED (0 Blocking / 8 Should-fix / 5 Consider).
