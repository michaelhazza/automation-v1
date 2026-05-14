# Auto-Fix Loop — personal-assistant-v2-operator — 2026-05-14T00:18:59Z

PR: #299
Branch: claude/personal-assistant-post-merge-audit
Started: 2026-05-14T00:18:59Z
Iteration cap: 5
Guardrails active: G1 (test files off-limits), G2 (50-line diff cap), G3 (category allowlist), G4 (this log)

## Iteration 1 — 2026-05-14T00:18:59Z

- **Failed check 1:** `verify-rls-coverage.sh` (BLOCKING)
- **Root cause 1:** `migrations/0353_operator_run_files.sql` has the `CREATE POLICY` clause split across two lines (`CREATE POLICY <name>\n  ON <table>`). The gate's grep is line-based (`grep -qE "CREATE POLICY[[:space:]]+[a-zA-Z_]+[[:space:]]+ON[[:space:]]+${table}\\b"`) and cannot match across lines. Main's IEE browser migration has `CREATE POLICY <name> ON <table>` on a single line.
- **Category (G3 allowlist match):** SQL/migration syntax — auto-fix allowed.
- **Guardrail status:** G1=PASS (no test files), G2=2/50 lines, G3=PASS (SQL syntax), G4=logged.

- **Failed check 2:** `verify-action-registry-snapshot.sh` (BLOCKING)
- **Root cause 2:** `cross_owner.ask_initiator_decision` slug was added to `server/config/actionRegistry/core.ts:818-819` during Phase 2 (Chunk 4) but the `scripts/snapshots/action-registry.snapshot.json` baseline was never refreshed to include it. The gate is a regression oracle — pure diff check between registry and snapshot.
- **Category (G3 allowlist match):** RLS-contract-compliance / gate-script artefact — auto-fix allowed (snapshot regeneration is the canonical fix per the script's own header).
- **Guardrail status:** G1=PASS, G2=expected small JSON delta, G3=PASS, G4=logged.

- **Fix:**
  1. Reformat `0353_operator_run_files.sql`: collapsed `CREATE POLICY operator_run_files_org_isolation` + `ON operator_run_files` onto one line. Diff: 2 lines removed, 1 line added.
  2. Regenerated `scripts/snapshots/action-registry.snapshot.json` via `npx tsx scripts/snapshot-action-registry.ts`. Diff: +37 lines / -1 line (single new entry for `cross_owner.ask_initiator_decision`). 162 registry entries total.
- **Diff:** pending commit
- **G3-local verify:** `npm run lint` 0 errors. `npm run typecheck` clean for touched files (only the 2 pre-existing `@react-pdf/renderer` errors persist).
- **CI re-fire result:** **partial green** — both blocking gates from iter 1 now pass (53 passed, 0 blocking). However, a different vitest assertion failed in `server/services/__tests__/reportRenderingServicePure.test.ts > renders the same input to identical bytes (determinism contract)`.

## Iteration 2 — 2026-05-14T00:35:00Z

- **Failed check:** `unit tests` (vitest assertion failure in `reportRenderingServicePure.test.ts > renders the same input to identical bytes (determinism contract)`)
- **Root cause (one sentence):** `@react-pdf/renderer` emits `CreationDate` as a STANDALONE indirect PDF date literal `(D:YYYYMMDDhhmmssZ)\nendobj` (not as inline `/CreationDate (D:...)`), so the existing inline-form regex in `normalizePdfBytes` never matched — second-by-second wall-clock drift between two sequential renders survived normalisation.
- **Diagnostic evidence:** ran a quick diff harness (`scripts/diagnose-pdf-determinism.mjs`, since deleted) locally; flake reproduced after ~25 pairs. First divergence: `(D:20260514003513Z)` vs `(D:20260514003514Z)` — exactly 1-second clock drift.
- **Initial out-of-scope classification:** REVERSED. Operator chose to fix in this PR. Although the file was last touched by PR #283, the determinism contract is part of `reportRenderingService` itself and we're patching the normaliser to be more robust without touching test code.
- **Category (G3 allowlist match):** "Out-of-scope CI failures" → reclassified as a "missing import / wrong regex pattern" follow-on category once the root cause was understood (the existing normaliser had an incomplete pattern set for `@react-pdf/renderer`'s actual byte output). Operator approval for the fix.
- **Guardrail status:** G1=PASS (no test files modified — only the production service), G2=8/50 lines, G3=PASS (regex normalisation fix), G4=logged.
- **Fix:** added one regex to `normalizePdfBytes` in `server/services/reportRenderingService.ts`:
  ```js
  str = str.replace(/\(D:\d{14}(?:Z|[+-]\d{2}'\d{2})?\)/g, '(D:20000101000000Z)');
  ```
  Captures both UTC (`Z`) and offset (`±HH'mm`) PDF date forms. Placed after the inline-form `/CreationDate` and `/ModDate` regexes so any date that already got inline-normalised won't double-replace (the inline replacement uses the literal `(D:20000101000000Z)` value, which is fixed-point under the standalone regex).
- **Verified locally:** ran the diagnostic harness for 10 outer × 5 inner = 50 paired renders post-patch; all 50 pairs byte-equal. Ran the formal vitest test 5 times post-patch: 10/10 passes (2 tests × 5 runs).
- **Lint:** initial commit had a `no-useless-escape` error on the escape `\-` inside the bracket class; fixed to `[+-]`. Lint now reports 0 errors, 899 warnings (unchanged from post-merge baseline).
- **Diff:** pending commit (8 lines added including comment block; 1 line removed for the lint fix).
- **CI re-fire result:** pending push.
