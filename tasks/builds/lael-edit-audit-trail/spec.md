# Stub: LAEL edit audit trail (Phase 2)

**Trigger to activate:** When an operator next needs to see "this memory / rule / skill / data-source was edited after the run" on a past Live Log surface.

**Scope (one paragraph).** Ship live-agent-execution-log-spec §8 Phase 2 in one chunk: migration `0194_agent_execution_log_edits.sql` with RLS + manifest entry; new table `agent_execution_log_edits` per spec §5.8; optional `triggeringRunId` query param threaded into the existing memory / rule / skill / data-source edit surfaces (each writes an audit row on save); client surface `EditedAfterBanner` on `AgentRunLivePage` (shown for past runs only, queries by `(entity_type, entity_id)`); Edit-CTA links pass `?triggeringRunId=`. Ship criterion: edits made via a log-link are auditable; past runs show a banner on events whose linked entity has been edited since.

**Origin:** LAEL-P2 in legacy `tasks/todo.md`.
