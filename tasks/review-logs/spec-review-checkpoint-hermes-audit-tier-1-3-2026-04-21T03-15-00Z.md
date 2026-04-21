# Spec Review HITL Checkpoint — Iteration 3

**Spec:** `tasks/hermes-audit-tier-1-spec.md`
**Spec commit:** `947111d0ddb919023ddb7bdfd58af8579197499a` + iteration 1/2/3 edits (uncommitted)
**Spec-context commit:** `00a67e9bec29554f6ca9cb10d1387e7f5eeca73f`
**Iteration:** 3 of 5
**Timestamp:** 2026-04-21T03:15:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 4 until every finding below is resolved. Resolve by editing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 3.1 | `PlaybookRunDetailPage` wiring passes a `playbook_runs` ID into an `agent_runs`-only cost endpoint | Drop PlaybookRunDetailPage from Phase A, aggregate across child agent-run IDs, or add a new playbook-run-cost endpoint? | Option A — drop `PlaybookRunDetailPage.tsx` from Phase A and defer playbook-run cost visibility to a dedicated follow-up spec. | Smallest Phase A delta; removes one file, one status-enum mismatch, and one 404-guaranteed code path. The three remaining surfaces (AgentRunHistoryPage via SessionLogCardList, RunTraceViewerPage via RunTraceView, AdminAgentEditPage) all operate on `agent_runs` IDs and are already on solid ground. |
| 3.2 | `outcomeLearningService` passing `runResultStatus='partial'` regresses human-curated lessons from `isUnverified=false` to `isUnverified=true` | Treat human-reviewed lessons as `'success'`, keep as `'partial'` but override `isUnverified=false`, accept the regression, or introduce a new outcome variant? | Option B — keep `runResultStatus='partial'` in the `outcome` object but special-case the `outcomeLearningService` call site to override `isUnverified=false` and `provenanceConfidence=0.7`. | Human-reviewed lessons carry genuine signal; Option A overclaims (triggers promotions); Option C loses a retrieval signal we explicitly built; Option D ripples through the whole `RunOutcome` type. B is the minimum deviation that preserves today's behaviour. |

---

## Finding 3.1 — `PlaybookRunDetailPage` wiring on wrong identity/status contract

**Classification:** directional
**Signal matched:** Scope signals — "Remove this item from the roadmap" (Option A) / "Split this item into two" (Option C — separate endpoint). Architecture signals — Option B changes what `/api/runs/:runId/cost` means at the endpoint boundary.
**Source:** Codex P1 #1
**Spec sections:** §4.1 (PlaybookRunDetailPage.tsx row — now gated), §5.2.1 (`isTerminalRunStatus` helper), §5.5 (placement table — now marked gated), §5.7 (permissions), §8.2 (API shape), §10 step 2 (verification walk)

### Finding (verbatim)

> `P1 — §4.1 / §5.2.1 / §5.5:` Phase A's `PlaybookRunDetailPage` wiring is on the wrong identity/status contract. `PlaybookRunDetailPage.tsx` loads a `playbook_runs` record and uses playbook statuses like `awaiting_input`, `completed_with_errors`, and `cancelled`, while `/api/runs/:runId/cost` validates `runId` against `agent_runs`, and `isTerminalRunStatus()` is the agent-run helper. As written, `runId={runId}` and `runIsTerminal={isTerminalRunStatus(run.status)}` will be wrong for this page.

Verified by reading:
- `client/src/pages/PlaybookRunDetailPage.tsx:14` — loads via `/api/playbook-runs/...`, typed against the `playbook_runs` schema.
- `client/src/pages/PlaybookRunDetailPage.tsx:22-32` — status enum includes `awaiting_input`, `awaiting_approval`, `completed_with_errors`, `cancelling`, `cancelled`, `invalidated`, `skipped` — none of which appear in `shared/runStatus.ts`'s agent-run terminal set.
- `server/routes/llmUsage.ts:354-357` — the cost endpoint joins only on `agent_runs.id` and 404s if the id isn't a row in `agent_runs`.
- `shared/runStatus.ts` — `isTerminalRunStatus()` is the agent-run helper; playbook statuses would evaluate to `false` for everything.

### Recommendation

**Option A — drop `PlaybookRunDetailPage.tsx` from Phase A entirely.**

Concrete edits:

1. **§4.1** — remove the `PlaybookRunDetailPage.tsx` row from the Files table (currently marked as "gated on Finding 3.1 HITL").
2. **§4.1 totals line** — update to "3 page + 2 delegated-component modifications" (drops the playbook page).
3. **§5.5 layout placement table** — remove the gated row for `PlaybookRunDetailPage.tsx`.
4. **§10 step 2** — change "`AgentRunHistoryPage`, `PlaybookRunDetailPage`, `RunTraceViewerPage`, and `AdminAgentEditPage`" to drop `PlaybookRunDetailPage`; three surfaces remain.
5. **§5.9 done criterion #1** — update to drop `PlaybookRunDetailPage` from the "pages must render cost without extra user action" list.
6. **§11.4 deferred items** — add item #10: "**Playbook-run cost visibility.** A playbook run aggregates cost across its child step runs (those with non-null `agent_run_id` on `playbook_step_runs`). A follow-up spec decides between (a) a new `/api/playbook-runs/:runId/cost` endpoint that sums per-step agent-run costs, or (b) a `RunCostPanel`-like component that iterates per-step and displays a total. Either way it is non-trivial and out of scope for Tier 1."
7. **§2 Summary bullet (Phase A)** — change "three agent-run detail pages that currently don't read it: `AgentRunHistoryPage.tsx`, `PlaybookRunDetailPage.tsx`, `RunTraceViewerPage.tsx`" to "two agent-run detail surfaces that currently don't read it: `AgentRunHistoryPage.tsx` (via `SessionLogCardList`) and `RunTraceViewerPage.tsx` (via `RunTraceView`)".

Alternative options:

- **Option B — keep the page; aggregate across child agent-run IDs.** `RunCostPanel` gains a new mode where it takes a list of agent-run IDs, fetches each, and sums them. The page passes `playbookStepRuns.map(r => r.agentRunId).filter(Boolean)` as the source. Requires a new component mode, a new aggregate endpoint or N fetches, new loading/error choreography. Non-trivial Phase A expansion.
- **Option C — add a new `/api/playbook-runs/:runId/cost` endpoint.** The endpoint joins `playbook_step_runs.agentRunId` against `llm_requests_all` (archive-safe per Finding 3.6) and returns the same `RunCostResponse` shape. New route + tests, but `RunCostPanel` can consume it unchanged. Cleanest product surface but expands Phase A scope with a new endpoint.
- **Option D — keep the page and let it silently 404.** Rejected — a known-broken state in Phase A is not acceptable even in pre-production dev.

### Why

- **Pre-production framing.** No live agency users depend on cost visibility on the playbook-run page today. A follow-up spec is the right shape for the feature.
- **Smallest Phase A delta.** Option A removes one file and one code path. Option B adds a new component mode. Option C adds a new endpoint + tests. Each option grows Phase A's surface area for a benefit (playbook-run cost visibility) that's worth designing separately.
- **The broken state is already acknowledged in the inventory.** §4.1 currently marks the row as "gated on Finding 3.1 HITL". Option A confirms we don't ship that surface in Phase A; Option B / C would un-gate it with extra work.
- **Every other Phase A surface is fine.** The fix only excises the one page that was on the wrong contract. `AgentRunHistoryPage` / `RunTraceViewerPage` / `AdminAgentEditPage` all operate on `agent_runs` IDs and remain in scope unchanged.

### Classification reasoning

Option A removes an item from the Phase A roadmap (scope signal). Option B introduces a new mode / abstraction in `RunCostPanel` (architecture signal). Option C adds a new endpoint (scope + architecture signal). Choosing between scope-contract tightening (A) and scope expansion (B/C) is a product-direction call, not a mechanical tidy-up.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`.

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

## Finding 3.2 — `outcomeLearningService` "neutral partial" regresses human-curated lessons

**Classification:** directional
**Signal matched:** Testing posture / architecture signals — Option A changes promotion/scoring behaviour; Option D is a new `RunOutcome` variant (architecture + shape change). Scope signal — this finding is not a mechanical tidy-up; it's a semantic decision about how human-curated content compares to agent-generated content.
**Source:** Codex P2 #4
**Spec sections:** §4.2 `outcomeLearningService` row, §6.4 (signature + callers list), §6.7 (provenance + `isUnverified` = `runResultStatus !== 'success'`), §6.7.1 (semantics change guidance), §6.8.2 (partial = `+0.00`, `isUnverified=true`, `provenanceConfidence=0.5`)

### Finding (verbatim)

> `P2 — §4.2 outcomeLearningService row vs §6.7 / §6.8.2:` the claimed "neutral partial outcome … matches today's behaviour exactly" is false. Today that path writes run-sourced entries with `isUnverified=false` because `runId` is present; under the new rules, passing `runResultStatus='partial'` makes them `isUnverified=true` and `provenanceConfidence=0.5`. That is a semantic regression for human-curated lessons, not a neutral no-op.

Verified by reading:
- `server/services/outcomeLearningService.ts:42-61` — `collapseOutcome` is called fire-and-forget from the review-approval handler with a real `agentRunId` after a human has approved (possibly edited) an action.
- `server/services/workspaceMemoryService.ts:788` — today's behaviour: `isUnverified: !runId`, which is `false` for this caller because `runId` is present.
- Spec §6.7 (line 414): "`isUnverified = runResultStatus !== 'success'`" — under Phase B, passing `'partial'` makes `isUnverified=true`.
- Spec §6.7 (line 413): "`provenanceConfidence`: ... `0.5` for partial" — human-curated lessons drop from null-today to 0.5.
- `server/services/memoryBlockSynthesisService.ts:126` and `server/services/memoryEntryQualityService.ts:252` — both filter on `isUnverified=false` when assembling retrieval context; flipping the flag silently drops human-curated lessons out of retrieval.
- The §4.2 row's rationale ("matches today's behaviour exactly") is therefore incorrect.

### Recommendation

**Option B — keep `runResultStatus='partial'` in the `outcome` object but special-case the `outcomeLearningService` call site so the write produces `isUnverified=false` and `provenanceConfidence=0.7`.**

Concrete edits:

1. **§4.2 `outcomeLearningService` row** — rewrite rationale: "The call writes a human-authored lesson from a review edit. The human-curation signal is stronger than 'partial' — the lesson was reviewed and approved. Pass `runResultStatus='partial'` so the §6.5 matrix's scoring branches stay `+0.00` (no promotion / no demotion, matching today's neutral-scoring behaviour), but override `isUnverified=false` and `provenanceConfidence=0.7` at the call site to preserve today's 'run-sourced, verified' semantics. The override lives in the `outcomeLearningService` caller, not in `extractRunInsights` — the service remains pure for the cohort it was designed for (agent-run-terminal writes)."
2. **§6.4** — update the second caller bullet to acknowledge the override and its motivation (retrieval-signal preservation).
3. **§8.3 signature** — add an optional `overrides` parameter:
   ```ts
   async extractRunInsights(
     runId, agentId, organisationId, subaccountId, runSummary,
     outcome: RunOutcome,
     options?: {
       taskSlug?: string;
       overrides?: { isUnverified?: boolean; provenanceConfidence?: number };
     },
   ): Promise<void>
   ```
   (Restructure the tail argument shape — `taskSlug` moves inside an options bag alongside `overrides`.)
4. **§6.7.1** — add a clarifying note: "Callers that write human-curated content (e.g. `outcomeLearningService`) override `isUnverified` and `provenanceConfidence` explicitly; the Phase B semantic change only applies to terminal-run writes."
5. **§9.2 tests** — add a test case for the `overrides` path: `outcome='partial'` + `overrides.isUnverified=false` + `overrides.provenanceConfidence=0.7` produces the expected row shape.
6. **§6.8.1 idempotency** — unchanged; overrides feed through the same `deduplicateEntries` pipeline.

Alternative options:

- **Option A — pass `runResultStatus='success'` for the `outcomeLearningService` call.** Triggers §6.5 promotions (`observation → pattern` with `+0.20` modifier) and sets `provenanceConfidence=0.7`. Overclaims: a human-approved lesson is not the same as a successful agent run, and promoting it to `pattern` alters retrieval behaviour. Also inconsistent with the rationale in §4.2 that says the call "has no run-terminal signal".
- **Option C — accept the regression and document it.** The existing `memoryBlockSynthesisService` and `memoryEntryQualityService` both filter on `isUnverified=false`, so human-curated lessons would silently drop out of retrieval after Phase B. Not acceptable — we explicitly built the review-learning path to contribute to memory.
- **Option D — introduce a new `'curated'` value on `runResultStatus`.** Widens the type, ripples through §6.5 matrix rows, §8.3 type, tests, pure helpers, and downstream consumers (`agentRunHandoffServicePure`). Directional scope expansion — larger than Phase B's "thread an outcome through one function" scope.

### Why

- **Preserves today's behaviour for human-curated content.** The current path writes `isUnverified=false` because `runId` is present. Option B keeps that behaviour by explicit override; the rest of the §6.7 semantics change applies only to the terminal-run cohort it was designed for.
- **Smallest API expansion.** Option B adds one optional `overrides` argument to `extractRunInsights` and routes `taskSlug` through an options bag for symmetry. No new `RunOutcome` value, no type widening.
- **Keeps `RunOutcome` semantics pure.** `runResultStatus='success'` continues to mean "the agent run succeeded"; it doesn't get overloaded to mean "or a human curated this content".
- **Option C loses a retrieval signal we built.** `memoryBlockSynthesisService.ts:126` and `memoryEntryQualityService.ts:252` already `eq(workspaceMemoryEntries.isUnverified, false)` — human-curated lessons silently disappear from retrieval after Phase B under Option C. That's a behaviour regression, not a cosmetic one.

### Classification reasoning

Option A changes promotion/scoring behaviour (scope/testing-posture signal). Option D is a new type variant (architecture signal). Option B introduces a new parameter on an internal function — mechanical-looking but driven by a product-direction call about how human-curated content compares to agent-generated content. Because the right answer depends on that product call, the finding is directional rather than mechanical.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`.

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

## How to resume the loop

After editing both `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (`apply` / `apply-with-modification` / `reject` / `stop-loop`), and continue to iteration 4.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

Lifetime note: after iteration 3 completes, two iterations remain before the 5-iteration lifetime cap. Iteration 4 is likely to reach the "two consecutive mechanical-only rounds" early-exit condition if the directional findings here are resolved cleanly.

## Mechanical findings applied this iteration (FYI, no decision needed)

The following iteration-3 findings were classified as mechanical and auto-applied before this checkpoint was written. They do not block on the human. Full detail in `tasks/spec-review-log-hermes-audit-tier-1-3-2026-04-21T03-15-00Z.md`.

1. **§6.5 vs §6.9 #3 vs §9.2 vs §10 #4 — "only issue" contradiction (Codex P1 #2).** §6.9 #3, §10 #4, §9.2 integration-sanity, and §11.5 #2 all rewritten to acknowledge the `preference → observation` demote row from the §6.5 matrix. The matrix (the explicit decision table) stays authoritative.
2. **§4.2 + §6.3.1 — `runResultStatus` third write site missing (Codex P1 #3).** Added the `agentExecutionService.ts` outer catch-path terminal write (line ~1400) as the third write site in §4.2; §6.3.1 rewritten to list all three sites (`finishLoop` normal, `finishLoop` catch, `finaliseAgentRunFromIeeRun`); catch-path derivation pinned as `computeRunResultStatus('failed', true, false, false)='failed'`.
3. **§4.1 / §5.5 — host-file inventory stale (Codex P2 #5).** `AgentRunHistoryPage.tsx` delegates list rendering to `SessionLogCardList.tsx`; `RunTraceViewerPage.tsx` delegates the header to `RunTraceView.tsx`. Both delegated components added to the inventory as the actual rendering sites; the pages are listed as wrappers that pass `run.status` down. (The `PlaybookRunDetailPage.tsx` row is gated on Finding 3.1.)
4. **§4.1 / §5.4 / §8.2 — cost endpoint archive-blind (Codex P2 #6).** Extended cost endpoint read path changed from `llm_requests` to the `llm_requests_all` view (migration 0189, UNION of live + archive). Preserves archive-safety for runs older than 12 months, matching System P&L's convention.
5. **§4.3 / §7.3 / §7.8 / §8.5 — Phase C internal contradictions (Codex P2 #7).** Stale "one-call-cost overshoot max" language in §4.3 removed in favour of "direct-ledger read eliminates rollup-lag; residual concurrency overshoot bounded by inflight batch"; §4.3 test (e) rewritten to match the §9.3 concurrency test; §4.3 test (d) rephrased to remove the double-negative ambiguity; §7.8 and §8.5 now correctly list the two new `costBreaker.checked` / `costBreaker.infra_failure` diagnostic log lines added in §7.3.
6. **§4.2 / §6.6 / §9.2 — decay changes pointed at wrong file (Codex P2 #8).** The decay math lives in `memoryEntryQualityServicePure.ts::computeDecayFactor`, not in `memoryEntryDecayJob.ts` (which only orchestrates the sweep). §4.2 now modifies `memoryEntryQualityServicePure.ts` + `memoryEntryQualityService.ts`; the pure test moved to `memoryEntryQualityServicePure.test.ts`; §6.6 implementation paragraph updated; §9.4 and §11.2 focused test patterns updated.
7. **§7.6 — IEE run lookup under-specified (Rubric — load-bearing claim without contract).** Added a concrete named helper `resolveRunIdFromIee(ctx)` inside `server/services/llmRouter.ts` (the §7.3 pseudocode already references it) with a pinned `SELECT agent_run_id FROM iee_runs WHERE id = $1 LIMIT 1` query. Explicit note on why the helper lives in the router rather than the breaker.
