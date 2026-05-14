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
- **CI re-fire result:** pending push.
