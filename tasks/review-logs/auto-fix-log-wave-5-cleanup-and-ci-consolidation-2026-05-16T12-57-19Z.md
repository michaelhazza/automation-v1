# Auto-Fix Loop — wave-5-cleanup-and-ci-consolidation — 2026-05-16T12:57:19Z

PR: #336
Branch: claude/wave-5-cleanup-and-ci-consolidation
Started: 2026-05-16T12:57:19Z
Iteration cap: 5
Guardrails active: G1 (test files off-limits — operator override for new-file convention fix), G2 (50-line diff cap), G3 (category allowlist), G4 (this log)

## Iteration 1 — 2026-05-16T12:57:19Z

- **Failed check:** unit tests (3 blocking gates)
- **Root cause (one sentence):** Adding the `clampMigrationConcurrency` import to `pgBossRegistrations.ts` shifted line numbers by +4, invalidating canonical-retry baseline entries (558→562, 593→597) and no-silent-failures baseline entry (663→667); separately, the new test file `persistAndAnnounce.updateClaim.test.ts` violates the pure-helper-convention gate (test file in `__tests__/` directory must import from a sibling module).
- **Category (G3 allowlist match):** gate-script baseline drift + missing test-file import (mechanical convention fix)
- **Guardrail status:** G1=OVERRIDE (operator authorised "loop CI and continue until all tests fixed and you have merged"; the test-file fix is adding a missing import to comply with convention, not chasing green); G2=pending; G3=PASS; G4=logged
- **Fix:** (a) bump pgBossRegistrations.ts line numbers in canonical-retry.txt (558→562, 593→597); (b) bump pgBossRegistrations.ts line number in no-silent-failures.txt (663→667); (c) add sibling import to persistAndAnnounce.updateClaim.test.ts.
- **Diff:** pending commit
- **CI re-fire result:** pending at next poll
