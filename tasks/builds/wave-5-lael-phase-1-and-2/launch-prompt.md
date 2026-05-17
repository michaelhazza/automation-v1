# Wave 5 — Live Agent Execution Log Phase 1 + 2

Wave 5 session M — runs concurrently with Wave 5 Sessions K (cleanup + CI consolidation), L (capabilities backfill), N (prevention gates + RLS migration). Wave 3+4 PRs #329/#330/#331/#332 are all merged. File-overlap risk is now managed via per-session deconfliction sections (see below), not via wave sequencing.

Scope: LAEL Phase 1 (emission sites + writer integration) + LAEL Phase 2 (edit audit trail) + **Hermes Tier 1** cost-correctness items (H1 successfulCostCents, H3 partial-status coupling, §6.8 errorMessage gap). LAEL Phase 3 (retention tiering + cold archive) and Hermes H2 (rollup-vs-ledger asymmetry) stay v2-backlog.

**Scope addendum 2026-05-16**: Hermes Tier 1 H1/H3/§6.8 folded into this session per operator decision — same run-execution UI surface (`AgentRunLivePage`, `RunCostPanel.tsx`, `agentExecutionService`), natural pairing with LAEL emission work.

**Paste the block below as the opening message of a fresh Claude Code session.**

---

```
Wave 5 Session J — Live Agent Execution Log Phase 1 + 2.
Significant-class build, feature-coordinator pipeline.

PREREQUISITE: Wave 3+4 Sessions E, G, H, I' (PRs #329-#332) merged.
Verify on entry:
  git log --oneline -10
File-overlap with concurrent Wave 5 sessions K and N is real; see
the file-overlap deconfliction section at the bottom of this prompt.

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
   
   HERMES TIER 1 — cost correctness (added 2026-05-16, closes H1, H3, §6.8):
   - H1: add successfulCostCents to /api/runs/:runId/cost response.
     Removes the cost-per-call divide-by-zero / failed-call bias trap.
     Touches shared/types/runCost.ts, server/routes/llmUsage.ts,
     client/src/components/run-cost/RunCostPanel.tsx. RunCostPanelPure.ts
     gets new branch logic + targeted Vitest.
   - H3: runResultStatus='partial' coupling to summary presence —
     decide whether !hasSummary is a downgrade signal or orthogonal
     field. Default after telemetry review: keep orthogonal (don't
     downgrade purely on missing summary). Operator confirms in
     chunk 0.
   - §6.8 errorMessage gap: thread preFinalizeMetadata.errorMessage
     into the extractRunInsights call when finalStatus==='failed' via
     the normal terminal path. Pre-existing limitation per LAEL spec
     §11.4. File location post-Session-H split: confirm in chunk 0.
   - H2 (rollup-vs-ledger asymmetry on Slack/Whisper paths) — STAYS
     v2-backlog due to file overlap with completed Session H DUP9
     extraction. Becomes a real risk only if those paths become hot.

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
DO NOT scope Hermes H2 (Slack/Whisper rollup-vs-ledger) — v2-backlog
per file-overlap with completed DUP9 extraction.
DO NOT modify Session G/H/I changes — defer to a follow-up PR if a
gap is found.

FILE-OVERLAP DECONFLICTION (Wave 5 concurrent):
- Session K (cleanup + CI): touches server/services/llmRouter/routeCall.ts:449
  (T1 metric) + server/services/skillExecutor/handlers/tasks.ts
  (W4AA-DEBT-15 await fix). Session M (this session) adds emission
  sites in llmRouter (different file path likely: llmRouter/* sub-modules)
  and skillExecutor (skill.invoked/completed). Surgical additions vs K's
  targeted line edits should merge naturally. If conflict surfaces,
  defer to K and rebase.
- Session L (capabilities): zero overlap.
- Session N (prevention gates + RLS migration): touches agentExecutionService
  for F4 residue migration. Session M (this session) adds handoff.decided
  emission in agentExecutionService. COORDINATION: N's RLS migration
  changes existing query lines; M adds new emission lines. Order:
  M emission chunks land before N's same-file RLS chunks where
  possible, OR architect surfaces a conflict and operator resolves.

If M finishes before N starts its RLS chunks on a shared file, no
problem. If N is mid-migration when M lands, N rebases M's emission
additions into the post-migration query shape.
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
