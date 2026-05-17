# Auto-Fix Loop — wave-6-knip-candidate-triage — 2026-05-17T09:42:21Z

PR: #344
Branch: claude/wave-6-knip-candidate-triage
Started: 2026-05-17T09:42:21Z
Iteration cap: 5
Guardrails active: G1 (test files off-limits), G2 (50-line diff cap), G3 (category allowlist), G4 (this log)

## Iteration 1 — 2026-05-17T09:42:21Z

- **Failed check:** unit tests (verify-types-used.sh — BLOCKING FAIL)
- **Root cause (one sentence):** Wave-6 deletions removed the sole consumers of `ClarifyingQuestion` (briefSkills.ts:5) and `ContextAssemblyResult` (cachedContext.ts:90), adding 2 new types-used violations not in the baseline allowlist.
- **Category (G3 allowlist match):** Gate-script bugs / baseline drift — gate-script baseline update required
- **Guardrail status:** G1=PASS (no test files), G2=8 lines/50, G3=PASS, G4=logged
- **Fix:** Added 2 new entries to `scripts/.gate-baselines/types-used.txt` with `# expires: 2026-08-14` and wave-6 provenance comment.
- **Diff:** pending commit
- **CI re-fire result:** pending

## Iteration 2 — 2026-05-17T09:52:00Z

- **Failed check:** unit tests (test:qa — `AdminPermissionSetsPage.tsx exists` check)
- **Root cause (one sentence):** `scripts/run-all-qa-tests.sh` line 81 checked for `AdminPermissionSetsPage.tsx` which was deleted in wave-6 chunk D1 as an orphan client page.
- **Category (G3 allowlist match):** Gate-script bugs — missing exclusion for legitimately deleted file
- **Guardrail status:** G1=PASS (shell script, not test file), G2=1 line/50, G3=PASS, G4=logged
- **Fix:** Removed line 81 from `scripts/run-all-qa-tests.sh`.
- **Diff:** pending commit
- **CI re-fire result:** pending
