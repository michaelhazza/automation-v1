# PR Re-Review Log — audit-prevention-gates-2026-05-14 (Round 2 — post-dual-reviewer)

**Branch:** `audit-prevention-gates-2026-05-14`
**Branch HEAD:** `2bcdb52b`
**Range reviewed:** `410c26ba` → `2bcdb52b` (dual-reviewer fixes on top of first pr-reviewer pass)
**Timestamp:** 2026-05-14T11-58-53Z
**Reviewer:** pr-reviewer (Round 2)
**Trigger:** Playbook §8.6 re-review check (mandatory when dual-reviewer applies code edits).

---

Blocking: 0 / Should-fix: 5 / Consider: 1

**Verdict:** APPROVED (0 blocking; prior Should-fix items S1, S2, S3, S5, S6, S7, S8 partially persist with S4 confirmed addressed; one new Should-fix on `check_expiring_baseline` exit-2 semantics)

---

## Dual-reviewer fixes — verification

All three dual-reviewer fixes are correct:

- **7 `await import()` conversions** — grep for `^import .* from 'file://'` returns zero; no static-import pattern survived.
- **2 temp-file staging replacements** in `verify-no-orphan-react-component.sh` and `verify-with-org-tx-or-scoped-db.sh` — both use `mktemp` + `printf > "$TMP_RESULT_JSON"` + `readFileSync(process.env.RESULT_JSON_FILE)`. Pattern consistent.
- **`check_expiring_baseline` exit-code restructure** at `guard-utils.sh:274-356` — past-grace → 1, within-grace → 2, clean → 0. Three caller gates (verify-loc-cap, verify-no-missing-deps, verify-frontend-design-budget) correctly propagate within-grace exit-2 even when violations=0.

---

## Blocking — none

---

## Should-fix

**S1 (re-review-new).** `scripts/lib/guard-utils.sh:344-350` — `check_expiring_baseline` returns exit 2 whenever the baseline has *any* entries, even with zero current violations. Predicate is `baselineKeys.size > 0` instead of `currentKeys ∩ baselineKeys`. Per the policy doc, exit 2 means "baseline-only violations" (current ∩ baseline), not "baseline has entries". After this PR, `verify-types-used` (165 baselined entries) will exit 2 on every CI run for the 90-day grace window.
**Fix:** change `baselineKeys.size > 0` → `[...currentKeys].some(k => baselineKeys.has(k))`. Extend `scripts/__tests__/gate-baseline-helpers.test.ts` with a "no current violations, non-empty baseline → exit 0" case.

**S1-prior (from round 1, still applies).** `scripts/__fixtures__/with-org-tx/passing.ts:17` — `queryRecords` uses `tx.select(...)` not `db.select(...)`. The analyser short-circuits on `objectText !== 'db'`, so the test doesn't actually exercise the caller-walk positive case.
**Fix:** rewrite to `db.select().from(records)`.

**S2-prior (from round 1, still applies).** P9/P10 baselines (`any-budget.txt`, `marker-budget.txt`) carry `# expires:` directives but neither gate calls `check_expiring_baseline`. Headers claim expiry enforcement; reality has none.
**Fix:** either extend `per-file-counter-pure.mjs::parsePerFileBudgetBaseline` to read `expires` per file and route through `check_expiring_baseline`, OR drop the `# expires:` directives and document the exception.

**S3-prior (from round 1, still applies).** `scripts/lib/universal-skill-sync-pure.mjs:71-82` — hardcoded `entryFiles` list misses any future registry file.
**Fix:** replace with directory scan excluding known non-entries.

**S5-prior (from round 1, still applies).** `scripts/lib/orphan-component-analyser.mjs:54-58` — analyser scans `.ts` files and emits "React component file has no ingress" for Pure helpers.
**Fix:** restrict `collectFiles` to `.tsx` only.

**S6-prior (from round 1, still applies).** `scripts/verify-loc-cap.sh:93-94` — `content.split('\n').length` vs `wc -l` drift.
**Fix:** `(content.match(/\n/g) || []).length`.

**S7-prior (from round 1, still applies).** Missing cygpath normalisation in any-budget / marker-budget gates (Windows local smoke-runs).
**Fix:** copy cygpath block from `verify-knip-config.sh:37-42`.

**S8-prior (from round 1, still applies).** Misleading `FILES_SCANNED` metric (counts violations, not files).
**Fix:** capture scanned-file count from Node block.

**Addressed by dual-reviewer round:** S4 (misleading `no-db-in-routes.txt` baseline comment — now clearer per the dual-review commit).

---

## Consider

**C1 (re-review-new).** Same as S8-prior — kept as Should-fix per consistency.

---

## Verdict

APPROVED (0 Blocking / 5 Should-fix carried + 1 new / 1 Consider).

The build is functionally complete and CI-ready. All Should-fix items are quality improvements that can land in a follow-up PR.
