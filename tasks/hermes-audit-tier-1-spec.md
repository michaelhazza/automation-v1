# Hermes Audit — Tier 1 Spec

**Status:** Draft, ready for implementation
**Task classification:** Significant (multiple domains: UI, memory, cost enforcement)
**Target branch:** `claude/hermes-agent-patterns-2s4eH`
**Last main integration:** `028f665` (2026-04-21) — includes `SystemPnlPage.tsx`, which retires Tier 1 item #4 from the original Hermes audit recommendation.

## Contents

1. Summary
2. Motivation — what Hermes surfaced
3. In scope / Out of scope
4. File inventory
5. Phase A — Per-run cost panel
6. Phase B — Success-gated memory promotion
7. Phase C — LLM router cost-breaker wire-up
8. Contracts (types, schemas, API shapes)
9. Testing posture
10. Verification plan
11. Rollout, risks, deferred items
12. Appendix — audit references

---

## 1. Summary

Three surgical changes that unlock value already paid for by earlier investment. Each one closes a ghosted capability surfaced by the Hermes-audit reports. None of them introduce new schema, new tables, or new product surfaces — they wire existing data through to users, gate existing code paths on existing status signals, or call an existing primitive from one more caller.

- **Phase A — Per-run cost panel.** Expose `/api/runs/:runId/cost` (already built) on the three agent-run detail pages that currently don't read it: `AgentRunHistoryPage.tsx`, `PlaybookRunDetailPage.tsx`, `RunTraceViewerPage.tsx`. Ships a shared `RunCostPanel` component that renders total spend + LLM call count + `callSite` split.
- **Phase B — Success-gated memory promotion.** Thread `runResultStatus` and the `TrajectoryDiff.pass` signal into `workspaceMemoryService.extractRunInsights()` so that successful runs produce higher-quality semantic entries (`pattern` / `decision`) and failed runs produce `issue` entries with different decay cadence. Pin the behaviour with pure tests.
- **Phase C — LLM router cost-breaker wire-up.** Call `assertWithinRunBudget()` from `llmRouter.routeCall()` immediately after each LLM cost is recorded. The breaker already exists (`server/lib/runCostBreaker.ts`, T23) and is called by Slack and Whisper services; adding the LLM path closes the dominant cost surface for runaway agent loops.

All three items share the same work-scope boundary (one backend service, one router helper, one shared React component, three page wire-ups) and the same testing substrate (`server/services/__tests__/`). They can be implemented and reviewed in a single session.

## 2. Motivation — what Hermes surfaced

The Hermes audit (Claude and ChatGPT reports, 2026-04-21) pointed at four patterns Hermes Agent gets right. Three of them turn out to be ghosted in our codebase — the infrastructure is built, the data is captured, but the value is not reaching the user:

1. **Transparent per-task cost.** Hermes's headline win is the user knowing what each task cost. The audit confirmed we capture every cost dimension in `llm_requests` and expose `/api/runs/:runId/cost`; the failure is UI-only. See `server/routes/llmUsage.ts:347`.
2. **On-success memory promotion.** Hermes claims to promote successful task outcomes to durable memory. The audit confirmed we call `extractRunInsights()` unconditionally on every completion regardless of outcome — with a generic `observation` entry, no `runResultStatus` branch, no distillation quality bump. See `server/services/agentExecutionService.ts:1305` and `workspaceMemoryService.ts:696`.
3. **Cost caps that actually cap.** Hermes exposes token/cost ceilings as first-class configuration. The audit confirmed we store `subaccountAgents.maxCostPerRunCents` and built the `runCostBreaker` primitive; but the primary cost-incurring surface (LLM calls) does not call the breaker — only Slack and Whisper services do. A runaway agentic loop today can blow past the configured cap.

The fourth audit item — a System-level P&L page — landed on main in commit `30fce22` ahead of this spec.

Tier 1 as defined here is the minimum work that makes the existing investment visible and enforceable. None of it requires new product surface, new schema, or new review cycles from reviewers outside engineering.

## 3. In scope / Out of scope

### In scope

- Read `/api/runs/:runId/cost` from `AgentRunHistoryPage.tsx`, `PlaybookRunDetailPage.tsx`, `RunTraceViewerPage.tsx`.
- Factor the existing `AdminAgentEditPage.tsx` cost rendering into a shared `client/src/components/run-cost/RunCostPanel.tsx`. Page-level consumers call the shared component.
- Extend the per-run cost API response to include `callSite` split (`app` vs `worker`) and LLM call count — this data already exists in `cost_aggregates` and `llm_requests`; we just surface it.
- Thread `runResultStatus` ('success' | 'partial' | 'failed') and an optional `trajectoryPassed` boolean into `extractRunInsights()`.
- Branch extraction behaviour on those signals (detailed in Phase B below).
- Call `assertWithinRunBudget` from inside `llmRouter.routeCall` after the cost row is written, once per call.
- Handle the no-`runId` case gracefully (system / analyzer callers don't have a run context and must not be blocked by the breaker).
- Unit tests for pure extraction logic, integration tests for breaker enforcement, component tests for the cost panel.

### Out of scope — do not creep

- New product surfaces (no new pages, no new routes except read-only expansion of the existing cost endpoint).
- New database tables or columns.
- Changes to the ledger shape, the router contract, or the budget reservation mechanism.
- End-client-facing cost visibility (stays agency-internal — see audit non-goal).
- "Cheaper model was available" post-call hinting (Tier 3 item #9, explicitly deferred).
- Per-task / per-run cost visible on the **end client** portal (`PortalPage.tsx` stays untouched).
- Any change to `extractEntities()` or the briefing-update pg-boss job at `agentExecutionService.ts:1329`.
- Any change to `assertWithinRunBudget`'s own signature or threshold logic — we only add a caller.
- Any change to `SystemPnlPage.tsx` — that page is already live and not in scope here.

### Non-goals — durable

- This spec does not move us toward a personal-agent framing. No changes to UI copy or marketing surfaces. Every new surface is an operator-facing affordance for an agency managing multiple sub-accounts.
- This spec does not touch the Playbooks system, recurring-task detection, or reflection loops. Those are Tier 2 and require a separate spec.
