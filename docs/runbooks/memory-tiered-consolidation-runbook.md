# Memory Tiered Consolidation Runbook

Spec: `docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md`

---

## Enabling the feature (flag flip)

The tier behaviour ships behind `MEMORY_CONSOLIDATION_TIER_ENABLED`. Default is `false` in every environment.

**To enable:**
1. Set `MEMORY_CONSOLIDATION_TIER_ENABLED=true` in the target environment.
2. Restart the server process so the env var is picked up.
3. The nightly decay job, the hourly promotion job, and the retrieval post-fusion lens all activate automatically on next cycle.

**Gate for production flip:** four consecutive weekly `pass` runs from the audit script against staging are required before flipping in production. "Consecutive" means four passes within a 4-to-6 week window; slipping one week for ops reasons is acceptable, collapsing all four runs into a single weekend is not.

---

## Running the audit script

Basic invocation (local dev):

```sh
npx tsx scripts/audit/audit-memory-consolidation.ts --env local-dev
```

Staging:

```sh
DATABASE_URL=<staging-url> npx tsx scripts/audit/audit-memory-consolidation.ts \
  --env staging \
  --warmup-days 14
```

Full options:

| Flag | Default | Description |
|---|---|---|
| `--env <string>` | `local-dev` | Label for the trend log file and todo entries |
| `--warmup-days <N>` | `14` | Days after launch during which empty-tier findings are `warn`, not `fail` |
| `--out <path>` | `scripts/audit/_logs/memory-consolidation-audit-<env>-<date>.json` | Write JSON result to a file |
| `--trend-log <path>` | `scripts/audit/_logs/memory-consolidation-audit-trend-<env>.jsonl` | Append-only trend log |
| `--no-todo-routing` | (unset) | Skip auto-routing of `fail` findings to `tasks/todo.md` |

**Exit codes:** 0 for `pass` or `warn`; 1 for `fail`.

---

## Interpreting results

Each audit run produces a JSON result with an `overallStatus` (`pass`, `warn`, or `fail`) and a list of `checks`:

| Check | What it verifies |
|---|---|
| `check1_tier_distribution` | All four tiers represented for eligible tenants (>=100 entries) |
| `check2_promotion_reconciliation` | No invalid tier transitions persisted; promotion row counts healthy |
| `check3_flag_state` | Reports current flag value; always `pass` |
| `check4_retrieval_activity` | Retrieval traces exist in last 7 days |
| `check5_reinforcement_health` | Reinforcement batch flusher is advancing `last_accessed_at` (flag ON only) |
| `check6_utility_trend` | `mv_memory_utility_30d` is populated; per-agent utility not dropping sharply |
| `check7_config_version` | `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION` exists in config history |

Each check returns `pass`, `warn`, `fail`, or `n/a` (eligibility precondition not met, not a problem).

**Overall verdict:** `fail` if any check fails; `warn` if any warn and no fail; `pass` otherwise.

---

## Flag-flip gate

Track weekly audit results in the trend log (`scripts/audit/_logs/memory-consolidation-audit-trend-staging.jsonl`). Each line is a full JSON run result.

Gate procedure:
1. Run audit weekly against staging with `--env staging`.
2. Record the `overallStatus` for each run.
3. After 4 consecutive `pass` results within a 4-to-6 week window, proceed to production flip.
4. Any `fail` resets the counter. Triage via `tasks/todo.md` entries auto-created by the script.

---

## Tuning the config

All thresholds and weights live in `server/config/memoryConsolidationConfig.ts`.

To tune:
1. Add a new entry to `MEMORY_CONSOLIDATION_CONFIG_HISTORY` with an incremented `version`.
2. Update `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION` to the new version.
3. Deploy. Check 7 of the audit script verifies version consistency automatically.

Do not edit existing history entries; treat them as immutable snapshots.

---

## Rollback

To disable the feature:
1. Set `MEMORY_CONSOLIDATION_TIER_ENABLED=false` (or unset the env var).
2. Restart the server process.
3. All flag-gated code paths revert to flag-OFF behaviour immediately. No DB changes needed.
4. Existing tier assignments in `workspace_memory_entries` are retained but no longer affect retrieval scoring.
5. The promotion job and decay job both skip when the flag is OFF.
