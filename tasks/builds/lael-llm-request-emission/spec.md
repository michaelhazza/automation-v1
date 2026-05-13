# Stub: LAEL `llm.requested` / `llm.completed` emission + payload writer

**Trigger to activate:** When the Live Agent Execution Log timeline next surfaces operator complaint about a "missing doing phase" between `prompt.assembled` and `run.completed`, OR when LAEL Phase 1 follow-up work is next scheduled.

**Scope (one paragraph).** Finish the `llmRouter` integration so every agent-run LLM call emits the paired `llm.requested` (critical) and `llm.completed` (critical) events, and persists the corresponding `agent_run_llm_payloads` row inside the terminal ledger transaction. The scaffold TODOs at `server/services/llmRouter.ts` near `llmInflightRegistry.add()` and the writer at `server/services/agentRunPayloadWriter.ts::buildPayloadRow` already exist; this build threads the provisional ledger-row id from idempotency check up to the emit site, calls `buildPayloadRow` inside the terminal tx, and respects the rule that pre-dispatch terminal states (`budget_blocked`, `rate_limited`, `provider_not_configured`) do NOT emit. Spec refs: live-agent-execution-log-spec §4.5, §5.3, §5.7.

**Origin:** LAEL-P1-1 in legacy `tasks/todo.md` (Live Agent Execution Log deferred items section).
