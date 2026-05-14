# Stub: LAEL retention tiering (Phase 3)

**Trigger to activate:** When LAEL row volume next approaches the hot-tier storage budget OR when an operator first requests a cold-archive restore.

**Scope (one paragraph).** Ship live-agent-execution-log-spec §8 Phase 3 in one chunk: migration `0193_agent_execution_log_retention.sql` (creates `agent_execution_events_warm`, `agent_run_prompts_warm`, `agent_execution_events_archive` (Parquet BYTEA) + RLS + manifest entries; adds `archive_restored_at timestamptz` to `agent_runs`); rotation worker `agentExecutionLogArchiveJob.ts` paired with pure cutoff helper `agentExecutionLogArchiveJobPure.ts` (mirror `llmLedgerArchiveJobPure.ts`); queue registration as `maintenance:agent-execution-log-archive` at 03:30 UTC daily (offset from ledger archive's 03:45). Env vars already exist in `server/lib/env.ts`. Ship criterion: nightly tier rotation works; read endpoints transparently fall through hot → warm → cold. Cold archive restore (Phase 3.1) deferred until a real ask lands.

**Origin:** LAEL-P3 in legacy `tasks/todo.md`.
