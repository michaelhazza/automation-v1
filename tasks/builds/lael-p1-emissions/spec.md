# Stub: LAEL remaining P1 emission sites

**Trigger to activate:** Bundled with `lael-llm-request-emission` (same Phase 1 chunk per live-agent-execution-log-spec §6.2) OR when the timeline next exposes an operator-visible gap in memory / rule / skill / handoff coverage.

**Scope (one paragraph).** Wire the six remaining P1 emission sites named in live-agent-execution-log-spec §5.3 / §6.2: `memory.retrieved` at `workspaceMemoryService::_hybridRetrieve` return boundary; `memory.retrieved` at `memoryBlockService::getBlocksForInjection` return boundary; `rule.evaluated` at `decisionTimeGuidanceMiddleware`; `skill.invoked` at `skillExecutor::execute()` entry; `skill.completed` at the same function's result-return; `handoff.decided` (critical) at the handoff site inside `agentExecutionService`. All non-critical events follow graded-failure semantics (drop + warn on transient DB failure, no retry).

**Origin:** LAEL-P1-2 in legacy `tasks/todo.md`.
