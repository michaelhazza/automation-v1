# Wave 2 — Hotspot agent-execution audit (Module K)

**Verdict:** PASS_WITH_DEFERRED
**Scope:** Handoff audit-trail durability — does every handoff event survive a worker restart? Module K (Three-tier agent invariants) from `docs/codebase-audit-framework.md`.
**Branch:** `claude/wave-2-audit-sweep`
**Captured:** 2026-05-15T07-19-34Z

## Reconnaissance Map

Files inspected:
- `server/services/skillExecutor/handlers/handoff.ts` (367 LOC, the handoff dispatch surface).
- `server/services/agentExecutionEventService.ts` + `agentExecutionEventServicePure.ts` (audit-event persistence).
- `server/services/agentExecutionService.ts` (now 248 LOC post PR #314 split) + `agentExecutionService/*.ts` (9 phase modules).
- Existing context: tasks/todo.md `LAEL-P1-2` already declares `handoff.decided` event emission outstanding.

Post PR #314 / PR #319, the file sizes have dropped dramatically (`agentExecutionService.ts` 2,807 → 248 LOC; `skillExecutor.ts` 6,133 → 4 LOC; `workflowEngineService.ts` 4,073 → 64 LOC). Most of the prior audit's F6 god-file finding is closed.

## Pass 1 Findings

| ID | Severity | Confidence | Finding |
|---|---|---|---|
| AE1 | high | high | **Fire-and-forget audit-event writes mean the handoff trail can lose events under restart.** `server/services/skillExecutor/handlers/handoff.ts` calls `insertExecutionEventSafe` 3× and `insertOutcomeSafe` 4× with `void` prefix (lines 107, 128, 140, 227, 249, 340, 449). Comment at line 339 even labels them "fire-and-forget per INV-3". When the JavaScript event loop is interrupted (worker SIGTERM, container kill, process crash) between the `void` call and the underlying DB insert completing, the audit-event row is lost. The downstream `agent_execution_events` table will be missing the corresponding `tool.error` / outcome rows. There is no compensating sweep / reconciliation job to discover the gap on next boot. Recommended action: convert the audit-event writes from fire-and-forget to `await`ed writes on the critical-event subset (errors, outcomes), OR add a finalisation hook that drains pending writes on graceful shutdown via the existing graceful-shutdown machinery in `server/index.ts`. |
| AE2 | high | high | **Sub-agent spawn uses synchronous `Promise.all(executeRun(...))` with no queue persistence.** `handoff.ts:294` — `agentExecutionService.executeRun(...)` is called inline for each child, awaited via `Promise.all`. Worker restart mid-spawn loses all in-flight children — there is no `enqueueHandoff` job written to `pg-boss` first, so on boot the orchestrator has no record that these children were ever scheduled. `handoff.ts:340-352` only writes the "accepted" outcome rows AFTER all `Promise.all` results return — a crash between completion and outcome-insertion never records the outcome at all. Contrast with `executeReassignTask` (per the spec-conformance finding `SKILLEXEC-SPLIT-DEF-CONF-2` in `tasks/todo.md`) which does use `enqueueHandoff` from `pipeline.ts`. Two-path inconsistency: reassign-task is durable, spawn-sub-agents is not. Recommended action: route spawn-sub-agents through the same `enqueueHandoff` queue, OR document the intentional difference (sub-agents are "best-effort, real-time" by design) in the architecture. |
| AE3 | medium | high | **`handoff.decided` event still outstanding (LAEL-P1-2).** `server/services/agentExecutionEventServicePure.ts` knows about the `handoff.decided` event type (lines reference `case 'handoff.decided'` and `handoff.decided_missing_fields`) but no emission site exists in `agentExecutionService.ts` or its phase modules per the existing `LAEL-P1-2` TODO. Recommended action: close LAEL-P1-2 by emitting `handoff.decided` at the routing-decision site in `agentExecutionService/*.ts`. Already tracked; surfaced here to link the audit-trail-durability concern to the existing TODO. |
| AE4 | medium | medium | **Worker restart recovery for in-flight handoffs not documented.** No file references describe what happens to an `agent_run` row whose `status='running'` when the worker dies during a handoff. Is there a sweep that re-queues, marks `terminal_failure`, or stays in `running` indefinitely? `agentExecutionLoop.ts` (1,415 LOC) likely contains the run-loop machinery; recommend a deeper read in Wave 3 to confirm. The audit framework's Module K requires this property; current observation is the framework knows about the requirement but the recovery path is not explicitly named in code. |
| AE5 | low | high | **`handoff.ts:104-148` error-path emissions use the same `void insertExecutionEventSafe` posture for critical-severity errors.** `HIERARCHY_CONTEXT_MISSING`, `CROSS_SUBTREE_NOT_PERMITTED`, `DELEGATION_OUT_OF_SCOPE` are critical for safety / multi-tenant correctness — losing the event row on crash makes post-incident forensics harder. Recommended action: at minimum, `await` the critical-severity event insert before returning the error to the caller. |

## Prevention Proposals

| ID | Target | Proposal | Closes |
|---|---|---|---|
| PP-AE1 | `architecture.md` | Document explicitly: which audit-trail writes are fire-and-forget acceptable (debug/info events) vs which MUST be awaited (errors, outcomes, decisions). Currently the `INV-3` callout is in comments only — promote to architecture-level invariant. Leverage tier 2. | AE1, AE5 |
| PP-AE2 | `gate` | New gate `verify-critical-event-emission-awaited.sh` walking `server/services/skillExecutor/handlers/*.ts` and flagging `void insertExecutionEventSafe` calls inside catch / error-path branches. Suggest the rewrite to `await`. Leverage tier 1. | AE1, AE5 |
| PP-AE3 | `DEVELOPMENT_GUIDELINES.md` | Add convention: "Handoff dispatch paths (spawn-sub-agents, trigger-process, reassign-task) MUST agree on durability posture. If one path is queue-backed (`enqueueHandoff`), the others must either also be queue-backed OR carry an inline comment explaining the intentional difference." Leverage tier 2. | AE2 |
| PP-AE4 | `KNOWLEDGE.md` | Pattern entry: post-split file size can drop dramatically (agentExecutionService 2,807 → 248 LOC) without resolving the underlying durability semantics. Verify post-split that the *behaviour* migrated, not just the code. Leverage tier 3. | AE1, AE2 |

## Post-audit actions required

- `pr-reviewer: confirm AE2's intentional-vs-bug status` — operator decision: is spawn-sub-agents *supposed* to be best-effort?
- Wave 3 deeper read of `agentExecutionLoop.ts` to close AE4 with a documented recovery path.

Findings count: 5 (2 high, 2 medium, 1 low).
