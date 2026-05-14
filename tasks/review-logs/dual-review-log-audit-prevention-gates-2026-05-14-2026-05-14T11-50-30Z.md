# Dual Review Log — audit-prevention-gates-2026-05-14

**Files reviewed:** scripts/run-all-gates.sh; scripts/lib/guard-utils.sh; scripts/lib/gate-baseline-helpers.mjs; scripts/verify-universal-skill-sync.sh; scripts/verify-framework-context-block.sh; scripts/verify-types-used.sh; scripts/verify-any-budget.sh; scripts/verify-marker-budget.sh; scripts/verify-no-orphan-react-component.sh; scripts/verify-with-org-tx-or-scoped-db.sh; scripts/verify-canonical-retry.sh; scripts/verify-loc-cap.sh; scripts/verify-no-missing-deps.sh; scripts/verify-frontend-design-budget.sh; scripts/.gate-baselines/_TEMPLATE.txt; scripts/.gate-baselines/no-db-in-routes.txt

**Iterations run:** 3/3
**Timestamp:** 2026-05-14T11:50:30Z
**Build slug:** audit-prevention-gates-2026-05-14
**Branch:** audit-prevention-gates-2026-05-14 (was @ 410c26ba pre-review)
**Codex model:** gpt-5.5 via Codex CLI v0.130.0
**Commit at finish:** fc2fb394

---

## Iteration 1

### Codex findings

1. **[P1] Static `import ... from 'file://' + process.env.X` in 7 gate scripts.**
   Static ES module specifiers must be string literals; the concatenation is a `SyntaxError` that fires before any gate logic. Verified by reproduction:
   ```
   SyntaxError: Unexpected token '+'
   ```
   Affects: `verify-any-budget.sh`, `verify-framework-context-block.sh`, `verify-marker-budget.sh`, `verify-no-orphan-react-component.sh`, `verify-types-used.sh`, `verify-universal-skill-sync.sh`, `verify-with-org-tx-or-scoped-db.sh`.

2. **[P2] `echo "$RESULT_JSON" | node --input-type=module <<'PARSEEOF'` collision in 2 gates.**
   The heredoc is itself the node process's stdin, so the upstream pipe is discarded. `readFileSync('/dev/stdin')` reads from the heredoc, not the JSON payload. `2>/dev/null || true` masks any error. Effect: ts-morph analyser results are silently dropped. Affects `verify-with-org-tx-or-scoped-db.sh` and `verify-no-orphan-react-component.sh`.

3. **[P2] `scripts/run-all-gates.sh` doesn't handle exit code 3.**
   `check_expiring_baseline` returns code 3 for expired baselines but `run_gate` only counts 0/1/2. Code 3 falls into `[INFO]`, so expired baselines never block CI even though `references/test-gate-policy.md` says past-grace entries should be exit-1 contributions.

### Decisions

[ACCEPT] scripts/verify-*.sh × 7 — static `import` with concatenated specifier
  Reason: confirmed syntax error; gates non-functional before fix. Replaced with `const { x, y } = await import('file://' + process.env.X)`.

[ACCEPT] scripts/verify-with-org-tx-or-scoped-db.sh:113-120; scripts/verify-no-orphan-react-component.sh:98-105 — pipe-into-heredoc stdin collision
  Reason: confirmed by reading code; pipe payload was being silently dropped. Replaced with temp-file staging matching the helper-utils pattern.

[ACCEPT] scripts/run-all-gates.sh:32-37 — code 3 not handled
  Reason: violates documented policy. Fix applied (later refined in iter-2).

### Changes applied

- 7 scripts: replaced `import ... from 'file://' + process.env.X` with `const { ... } = await import(...)` form
- 2 scripts: replaced `<(echo "$RESULT_JSON" | node <<'PARSEEOF' ...)` with temp-file staging + explicit parse-exit check
- 1 script (`run-all-gates.sh`): added an `elif [ $code -eq 3 ]` branch that fails CI on expired baseline

Validation: `bash scripts/verify-universal-skill-sync.sh` now executes the helper and emits 2 real violations (read_codebase / search_codebase out-of-sync), exit code 2. Same pattern across the other 6 scripts. `npm run lint` and `npm run typecheck` clean.

---

## Iteration 2

### Codex finding

1. **[P2] `run-all-gates.sh` blocks CI for within-grace baseline warnings.**
   `check_expiring_baseline` returns code 3 for BOTH within-grace (warning by policy) and past-grace (error by policy). My iter-1 fix in `run_gate` treats every code-3 as `[BLOCKING FAIL]` — which would fail CI on within-grace entries that the policy explicitly says should be warnings.

### Decision

[ACCEPT] scripts/run-all-gates.sh + scripts/lib/guard-utils.sh — codes 3 conflates within-grace and past-grace
  Reason: Codex correctly identified that the helper itself collapses two distinct policy states into one exit code. The cleanest fix is at the source: change the helper to map past-grace → 1 (error contribution) and within-grace → 2 (warning contribution), matching the policy literally. Then `run-all-gates.sh` doesn't need a special code-3 branch.

### Changes applied

- `scripts/lib/guard-utils.sh::check_expiring_baseline` — past-grace expiry now contributes to exit code 1; within-grace expiry contributes to exit code 2; code 3 retired from the helper
- `scripts/run-all-gates.sh` — reverted the code-3 special-case branch; the else-branch goes back to `[INFO]` so pre-existing readiness gates that exit 3 (e.g. `verify-authentication-readiness.sh`) keep their informational semantics
- Removed dead `BASELINE_EXIT=3` branches in `verify-loc-cap.sh`, `verify-no-missing-deps.sh`, `verify-frontend-design-budget.sh`
- Updated exit-code docs in `_TEMPLATE.txt`, `no-db-in-routes.txt`, `guard-utils.sh`, `verify-canonical-retry.sh`, `verify-loc-cap.sh`, `verify-framework-context-block.sh`, `verify-types-used.sh`, `verify-universal-skill-sync.sh` to match the new 0/1/2 contract

Validation: all 7 previously-broken gates exit cleanly (universal-skill-sync=2, no-orphan=2, with-org-tx=2, framework-context=0, types-used=2, any-budget=2, marker-budget=2). 22/22 helper unit tests pass.

---

## Iteration 3

### Codex finding

1. **[P2] Within-grace baseline warnings silently lost in three caller scripts.**
   After the iter-2 helper rewrite, `check_expiring_baseline` can return 2 to mean "within-grace expiry, no current violations". But `verify-frontend-design-budget.sh`, `verify-no-missing-deps.sh`, and `verify-loc-cap.sh` only branch on `BASELINE_EXIT==1`; when `BASELINE_EXIT==2` AND `VIOLATIONS==0`, control falls through to `exit 0`. The warning is lost.

### Decision

[ACCEPT] scripts/verify-frontend-design-budget.sh; scripts/verify-no-missing-deps.sh; scripts/verify-loc-cap.sh — within-grace empty-baseline warning silently dropped
  Reason: real consequence of the iter-2 helper API change. Added `BASELINE_EXIT==2` to the `elif` branch in each of the three gates so the warning surfaces.

### Changes applied

- Three gates updated: `elif [ "$VIOLATIONS" -gt 0 ]` → `elif [ "$BASELINE_EXIT" = "2" ] || [ "$VIOLATIONS" -gt 0 ]`

Validation: `bash scripts/verify-frontend-design-budget.sh; verify-no-missing-deps.sh; verify-loc-cap.sh` all exit with their expected codes (0, 2, 2 respectively given current baselines). 22/22 helper unit tests still pass. lint/typecheck clean.

---

## Changes Made

- `scripts/verify-universal-skill-sync.sh` — convert static import to `await import()`; update exit-code docstring
- `scripts/verify-framework-context-block.sh` — convert static import to `await import()`; update exit-code docstring
- `scripts/verify-types-used.sh` — convert static import to `await import()`; update exit-code docstring
- `scripts/verify-any-budget.sh` — convert static import to `await import()`
- `scripts/verify-marker-budget.sh` — convert static import to `await import()`
- `scripts/verify-no-orphan-react-component.sh` — convert static import to `await import()`; replace pipe-into-heredoc with temp-file staging
- `scripts/verify-with-org-tx-or-scoped-db.sh` — convert static import to `await import()`; replace pipe-into-heredoc with temp-file staging
- `scripts/verify-canonical-retry.sh` — exit-code docstring update
- `scripts/verify-loc-cap.sh` — exit-code docstring update; remove dead `BASELINE_EXIT==3` branch; add `BASELINE_EXIT==2` warning propagation
- `scripts/verify-no-missing-deps.sh` — remove dead `BASELINE_EXIT==3` branch; add `BASELINE_EXIT==2` warning propagation
- `scripts/verify-frontend-design-budget.sh` — remove dead `BASELINE_EXIT==3` branch; add `BASELINE_EXIT==2` warning propagation
- `scripts/lib/guard-utils.sh::check_expiring_baseline` — past-grace expiry → exit 1, within-grace expiry → exit 2 (collapse code 3 per policy semantics)
- `scripts/run-all-gates.sh` — revert iter-1 code-3 branch (no longer emitted by helper); legacy gates that exit 3 still hit `[INFO]` as before
- `scripts/.gate-baselines/_TEMPLATE.txt` — exit-code documentation
- `scripts/.gate-baselines/no-db-in-routes.txt` — exit-code documentation

## Rejected Recommendations

None across all three iterations. Every Codex finding was real and reproducible; each was addressed in-branch.

---

**Verdict:** APPROVED (3 iterations; 3 critical gate-execution bugs fixed: invalid static imports across 7 scripts, pipe-into-heredoc stdin collision in 2 scripts, baseline-expiry policy not enforced at runner level; 2 follow-up issues caught in iter-2/iter-3 from the iter-1 fix and addressed cleanly)
