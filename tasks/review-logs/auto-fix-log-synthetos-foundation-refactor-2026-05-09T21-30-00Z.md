# Auto-Fix Loop — synthetos-foundation-refactor — 2026-05-09T21:30:00Z

PR: #279
Branch: claude/openclaw-worker-mode-VnjQT
Started: 2026-05-09T21:30:00Z
Iteration cap: 5
Guardrails active: G1 (test files off-limits), G2 (50-line diff cap), G3 (category allowlist), G4 (this log)

## Iteration 1 — 2026-05-09T21:30:00Z

- **Failed checks:** unit tests, integration tests, verify (all 3 fail at the same migration step)
- **Root cause (one sentence):** down migrations 0307/0308/0309 use `DROP COLUMN`/`DROP COLUMN <name>` without `IF EXISTS`, so the CI gate's "run-down-then-up" pair-test rejects them on a clean DB where the column does not exist yet.
- **Category (G3 allowlist match):** SQL / migration syntax (down-migration idempotency)
- **Guardrail status:** G1=PASS (no test files touched), G2=12/50, G3=PASS (matches "Idempotency-index expression issues" / SQL migration syntax categories), G4=logged
- **Fix:** add `IF EXISTS` to every `DROP COLUMN` in `migrations/0307_subaccount_agents_governance.down.sql` (4 columns), `migrations/0308_agent_runs_controller_style.down.sql` (1 column), and `migrations/0309_agent_runs_policy_envelope.down.sql` (1 column). Mirrors the convention already used by 0306 and earlier down migrations.
- **Diff:** to be filled in after commit
- **CI re-fire result:** pending at next poll

### Local gates pre-commit

- `npm run lint`: PASS (0 errors, 886 pre-existing warnings — baseline)
- `npm run typecheck`: PASS (0 errors, both tsconfigs)

### Evidence (CI log)

```
- 0306_agent_default_landing_tab.down.sql ... ok
- 0306_agent_default_landing_tab.sql ... ok
- 0307_subaccount_agents_governance.down.sql ... FAILED
column "controller_style_allowed" of relation "subaccount_agents" does not exist
```

The CI gate runs each migration's `.down.sql` BEFORE its corresponding `.sql` (verifying idempotency on a clean DB). 0306 passes because it uses `IF EXISTS`; 0307 fails because it does not. 0308 and 0309 share the same defect but were not reached because 0307 failed first.
