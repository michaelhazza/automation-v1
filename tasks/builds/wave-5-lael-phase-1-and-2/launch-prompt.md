# Wave 5 — Live Agent Execution Log Phase 1 + 2

Sequential session — runs AFTER Wave 3+4 merges (Sessions E, G, H, I) to avoid file-overlap on `agentExecutionService/handoff*` and `skillExecutor/*`. May run concurrently with Wave 3 Session F (capabilities backfill) since F is doc-only and J is server services.

Scope: LAEL Phase 1 (emission sites + writer integration) + LAEL Phase 2 (edit audit trail). Phase 3 (retention tiering + cold archive) stays v2-backlog.

**Paste the block below as the opening message of a fresh Claude Code session.**

---

```
Wave 5 Session J — Live Agent Execution Log Phase 1 + 2.
Significant-class build, feature-coordinator pipeline.

PREREQUISITE: Wave 3+4 Sessions E, G, H, I must all be merged to main
before launching this session. Verify on entry:
  git log --oneline -10
Should show the four Wave 4 PRs.

1. Sync and branch:
     git fetch origin main
     git checkout -b claude/lael-phase-1-and-2 origin/main

2. Step 0 — vet the spec.
   Read the LAEL emission-sites scope from tasks/todo.md lines 22-32
   (LAEL-P1-1, LAEL-P1-2, LAEL-P2). Author a draft spec at
   tasks/builds/wave-5-lael-phase-1-and-2/spec.md covering:
   
   PHASE 1 — Emission sites (closes LAEL-P1-1, LAEL-P1-2):
   - llmRouter: emit llm.requested before the SDK call, llm.completed
     after. Pair with agent_run_llm_payloads writer integration per
     spec §4.5, §5.3, §5.7.
   - workspaceMemoryService + memoryBlockService: emit memory.retrieved
     when context loads.
   - decisionTimeGuidanceMiddleware: emit rule.evaluated.
   - skillExecutor: emit skill.invoked before dispatch, skill.completed
     after. Most handlers — apply uniformly via the post-Wave-4
     HandlerContext (Session H broke the cycle so the executor knows
     its emitter).
   - agentExecutionService: emit handoff.decided at every handoff
     decision point. Coordinate with Session G's awaited-write fix
     (handoff.decided is CRITICAL severity, must be awaited).
   - agentRunPayloadWriter + agentExecutionEventEmitter: integration
     scaffolding if not landed yet.
   
   PHASE 2 — Edit audit trail (closes LAEL-P2):
   - Migration 0XXX_agent_execution_log_edits.sql — new
     agent_execution_log_edits table per spec §8.
   - Optional triggeringRunId query param on memory/rule/skill/data-source
     edit surfaces.
   - EditedAfterBanner component on AgentRunLivePage — shows when an
     operator edited a memory/rule/skill/data-source during an
     in-flight run.

   PHASE 3 — Retention tiering — explicitly v2-backlog. Do NOT scope.

3. Step 1 — run spec-reviewer (Codex) on the draft spec.
     spec-reviewer: review tasks/builds/wave-5-lael-phase-1-and-2/spec.md
   Apply fixes per the standard iterative loop (max 5 iterations).

4. Step 2 — adopt feature-coordinator INLINE from Step 1 (architect
   plan write). Skip Step 0 Phase-1 handoff restore.

5. Architect's chunk-0 sweep MUST:
   - Verify the EXACT post-Session-H file locations for skillExecutor
     handlers (HandlerContext pattern may have moved them).
   - Verify agentExecutionService/handoff* locations post-Session-G
     (await fixes may have restructured the file).
   - Confirm agent_run_llm_payloads schema matches spec §5.7.
   - Number migration sequentially.
   - Confirm the AgentRunLivePage frontend integration surface.

6. Run feature-coordinator pipeline end-to-end. Spec will have 6-10
   chunks (one per emission domain + Phase 2 migration + Phase 2
   frontend + final review).

7. On completion, write Phase 3 handoff. Operator launches
   finalisation-coordinator separately.

DO NOT scope LAEL Phase 3 retention tiering (v2-backlog).
DO NOT modify Session G/H/I changes — defer to a follow-up PR if a
gap is found.
```

## Coverage scope

LAEL applies to **every agent run** that goes through `agentExecutionService.executeRun`:
- Simple agent runs
- Workflow-spawned runs
- PA-V1 / PA-V2 runs
- Operator-session runs (OSI)

The emission sites are in shared services (llmRouter, skillExecutor, workspaceMemoryService, etc.), so coverage is universal — no special-casing per run type.

## Phase 3 (deferred to v2-backlog)

LAEL Phase 3 covers:
- Per-run payload-retention tier transitions (hot → warm → cold)
- Cold-archive restore path
- Admin-visible drop/gap metrics
- Per-run payload-persistence kill-switch

Defer until production volume justifies retention tiering. Mark in tasks/todo.md as `[status:v2-backlog]` with rationale "ships when payload storage cost > threshold".

## Wave 5 other features

You mentioned 1-2 other features to spec in separate branches. Those run as additional Wave 5 work alongside LAEL. Coordinate with this build by ensuring no file overlap on `agentExecutionService` or `skillExecutor`.
