# Auto-Fix Loop — memory-improvements — 2026-05-13T10:02:00Z

PR: #298
Branch: claude/add-memvid-integration-ehAOr
Started: 2026-05-13T10:02:00Z
Iteration cap: 5
Guardrails active: G1 (test files off-limits), G2 (50-line diff cap), G3 (category allowlist), G4 (this log)

## Iteration 1 — 2026-05-13T10:02:00Z

- **Failed check:** `verify-org-scoped-writes.sh` (BLOCKING)
- **Root cause (one sentence):** R1 T4 revert simplified the task lookup in `retrievalService.ts:90` to `.where(eq(tasks.id, run.taskId))`, dropping the explicit `organisationId` filter required by DEVELOPMENT_GUIDELINES.md §1 defence-in-depth.
- **Category (G3 allowlist match):** RLS-contract-compliance violations (auto-fix allowed)
- **Guardrail status:** G1=PASS (no test files), G2={pending}/50, G3=PASS, G4=logged
- **Fix:** wrap the `.where()` predicate in `and(eq(tasks.id, ...), eq(tasks.organisationId, organisationId))`. `and` is already imported in the file.
- **Diff:** pending commit
- **CI re-fire result:** pending poll
