# Dual Review Log — live-agent-execution-log

**Files reviewed:** Phase 1 implementation on `claude/build-agent-execution-spec-6p1nC` — 30 files including migration schemas, services, routes, client components, and pure tests.
**Iterations run:** 3/3
**Timestamp:** 2026-04-21T21:25:00Z

---

## Iteration 1

[ACCEPT] server/services/agentExecutionService.ts:394-408 — `run.started` emitted fire-and-forget; later events could claim a lower sequence number
  Reason: `tryEmitAgentEvent` is non-blocking. Since sequence allocation is atomic against `agent_runs.next_event_seq`, a slow DB on the `run.started` append could let `prompt.assembled` or `context.source_loaded` claim sequence 1. Fixed by awaiting `emitAgentEvent(...)` for `run.started` only.

[ACCEPT] server/lib/agentRunEditPermissionMaskPure.ts:126-133 — `agent` entity `editHref` points to `/agents/:id/edit` which has no matching route
  Reason: The router defines `/admin/agents/:id` (AdminAgentEditPage), not `/agents/:id/edit`. `/agents/:id` goes to AgentChatPage. Fixed both `viewHref` and `editHref` to use `/admin/agents/${entityId}`.

[ACCEPT] client/src/pages/AgentRunLivePage.tsx:52-72 — state not reset on `runId` param change
  Reason: When navigating between runs in the same SPA session, `events`, `selected`, `lastSeenSeqRef`, `initialBufferRef`, and `initialGateRef` were not cleared. Old run's events would persist and could interleave with the new run's timeline. Fixed by resetting all per-run state at the start of the runId-change effect.

---

## Iteration 2

[REJECT] server/lib/agentRunVisibility.ts:90-95 — subaccount membership not checked for subaccount-tier runs
  Reason: The existing `GET /api/agent-runs/:id` route in `agentRuns.ts` has the identical access model (org-scoped, no subaccount membership check). This is the established codebase pattern for org-level `agents.view` permission. The code comment explicitly documents this design decision ("Membership is enforced by the existing `resolveSubaccount(subaccountId, organisationId)` call in the HTTP route chain"). Changing this would require a broader architectural change affecting multiple existing routes — beyond the scope of this PR.

[ACCEPT] server/routes/agentExecutionLog.ts:208-212 — LLM payload fetch not bound to the requested run
  Reason: The `GET …/llm-payloads/:llmRequestId` endpoint only checked `organisationId` after fetching by `llmRequestId`. An org user with `agents.edit` on run A could fetch run B's raw LLM payload (prompt + response) by guessing or knowing run B's `llmRequestId`. Fixed by adding a pre-fetch `llm_requests.run_id = ctx.run.id` check before calling `getLlmPayload`.

[ACCEPT] server/services/agentExecutionService.ts:1349 — `run.completed` event count off-by-one
  Reason: `nextEventSeq` is read from the terminal DB update before `run.completed` is appended. The payload's `eventCount` was therefore one less than the actual row count visible at `GET /api/agent-runs/:runId/events`. Fixed by `(terminalUpdate[0]?.nextEventSeq ?? 0) + 1`.

---

## Iteration 3

[REJECT] server/jobs/orchestratorFromTaskJob.ts:212-212 — `routing_decided` emitted after lifecycle events; duplicate on retry
  Reason: This is intentional scaffolding per spec §9 ("structured-reasoning extraction is deferred"). The event is non-critical and fire-and-forget. On idempotent replay, the duplicate would be appended with a higher sequence number (or silently dropped at cap). Fixing it properly requires `executeRun` to return an `isNew` flag — a significant API change. The sequencing issue is an inherent limitation of calling `executeRun` synchronously then emitting afterward, deferred by design per the spec.

[REJECT] server/services/llmRouter.ts:832-833 — `llm.requested`/`llm.completed` not wired
  Reason: Explicitly documented as deferred P1 work in CLAUDE.md Current focus: "Non-shipping in P1: `llm.requested`/`llm.completed` emission + `agent_run_llm_payloads` writer integration inside `llmRouter` (scaffolded with TODO)". This is intentional per spec §8. Not a bug — a known deferral.

[ACCEPT] server/lib/agentRunEditPermissionMaskPure.ts:114-119 — `data_source` entity hrefs point to non-existent client routes
  Reason: The `data_source` case generated `/data-sources/:id` or `/subaccounts/:id/data-sources/:id`, neither of which matches any route in App.tsx. `context.source_loaded` events are actively emitted with `data_source` linked entities, so these dead links were live. Fixed by pointing `viewHref` to `/admin/subaccounts/${runSubaccountId}/knowledge` (the closest valid page), setting `canEdit: false` and `editHref: null` (no per-item edit route). Updated the pure test to reflect the new semantics and added a dedicated `data_source: canEdit is always false` test case.

---

## Changes Made

- `server/services/agentExecutionService.ts` — Import `emitAgentEvent` alongside `tryEmitAgentEvent`; await `run.started` emission to guarantee sequence ordering; fix `eventCount` in `run.completed` payload to include the terminal event itself (`+ 1`).
- `server/lib/agentRunEditPermissionMaskPure.ts` — Fix `agent` entity `editHref`/`viewHref` to use `/admin/agents/:id`. Fix `data_source` entity to return `canEdit: false`, `editHref: null`, and a valid `viewHref` pointing to the knowledge page.
- `server/routes/agentExecutionLog.ts` — Add `llmRequests` import; add pre-fetch `llm_requests.run_id = ctx.run.id` check to bind LLM payload fetches to the requested run.
- `client/src/pages/AgentRunLivePage.tsx` — Reset all per-run state (`events`, `selected`, `lastSeenSeqRef`, `initialBufferRef`, `initialGateRef`) at the start of the `runId`-change effect.
- `server/lib/__tests__/agentRunEditPermissionMaskPure.test.ts` — Update `system_admin` test to exclude `data_source` from `canEdit: true` assertion; add dedicated `data_source` test case.

## Rejected Recommendations

1. **Subaccount membership not checked for subaccount runs** — Pre-existing pattern consistent with `GET /api/agent-runs/:id`. The existing run-detail route has the identical access model. Changing this is a broader architectural decision.
2. **`llm.requested`/`llm.completed` not wired into `llmRouter`** — Explicitly deferred per spec §8 and documented in CLAUDE.md Current focus as a TODO.
3. **`orchestrator.routing_decided` duplicate/ordering on retry** — Non-critical scaffolding per spec §9. Fixing properly requires an `isNew` flag in `AgentRunResult`, which is a significant API change beyond this PR's scope.

---

**Verdict:** `PR ready. All critical and important issues resolved.` — Five fixes applied across three iterations: (1) `run.started` sequence race, (2) broken agent hrefs, (3) SPA state leak on navigation, (4) LLM payload run-binding security gap, (5) `data_source` dead links + `run.completed` eventCount off-by-one. Three findings rejected: one pre-existing pattern, one intentional deferral, one requires broader API change.
