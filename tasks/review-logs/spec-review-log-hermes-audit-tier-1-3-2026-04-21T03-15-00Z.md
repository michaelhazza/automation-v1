# Spec Review Iteration Log — Iteration 3

**Spec:** `tasks/hermes-audit-tier-1-spec.md`
**Timestamp:** 2026-04-21T03:15:00Z
**Iteration:** 3 of 5

## Counts

- Mechanical findings accepted:  7
- Mechanical findings rejected:  0
- Directional findings:          2
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          `tasks/spec-review-checkpoint-hermes-audit-tier-1-3-2026-04-21T03-15-00Z.md`
- HITL status:                   pending

## Codex output summary

Codex produced 8 discrete findings (3 × P1, 5 × P2) plus 2 open questions. Rubric pass surfaced one additional finding (§7.6 IEE lookup under-specified). All nine findings classified below.

## Findings (full classification)

### FINDING #1 — Codex P1 #1: PlaybookRunDetailPage wiring on wrong identity/status contract

- Section: §4.1, §5.2.1, §5.5
- Description: PlaybookRunDetailPage operates on playbook_runs, not agent_runs; /api/runs/:runId/cost joins on agent_runs.id.
- Classification: directional (Scope signal: "Remove this item" / "Split this item into two")
- Disposition: HITL-checkpoint → Finding 3.1

### FINDING #2 — Codex P1 #2: §6.5 vs §6.9 #3 vs §9.2 vs §10 #4 failure-path contradiction

- Section: §6.5, §6.9, §9.2, §10, §11.5
- Description: Matrix includes `failed + preference → observation` (demoted, not dropped); done criteria and verification say "only issue entries".
- Classification: mechanical (self-consistency — update prose to match the explicit decision matrix)
- Disposition: auto-apply
- Fix applied: §6.9 #3, §10 #4, §9.2 sanity, §11.5 #2 all updated to acknowledge the `preference → observation` demote row.

### FINDING #3 — Codex P1 #3: runResultStatus write sites undercounted

- Section: §4.2, §6.3.1, §6.9 #1
- Description: agentExecutionService.ts:1400 has a third terminal write (outer catch) but §6.3.1 lists only two sites.
- Classification: mechanical (file-inventory / write-site drift — spec intends to populate on every terminal run)
- Disposition: auto-apply
- Fix applied: §4.2 row gains catch-path instruction; §6.3.1 rewritten to list three sites with derivation for each.

### FINDING #4 — Codex P2 #4: outcomeLearningService "neutral partial" regresses human-curated lessons

- Section: §4.2 outcomeLearningService row, §6.7, §6.8.2
- Description: Passing `runResultStatus='partial'` flips `isUnverified` from today's `false` to `true`; `memoryBlockSynthesisService` and `memoryEntryQualityService` filter on `isUnverified=false`, silently dropping human-curated lessons from retrieval.
- Classification: directional (Scope/Architecture signal — semantic call about how human-curated content compares to agent-generated content)
- Disposition: HITL-checkpoint → Finding 3.2

### FINDING #5 — Codex P2 #5: AgentRunHistoryPage / RunTraceViewerPage host-file inventory stale

- Section: §4.1, §5.5
- Description: The pages delegate actual rendering to SessionLogCardList.tsx and RunTraceView.tsx; §4.1 names the wrong files.
- Classification: mechanical (rubric — file-inventory drift)
- Disposition: auto-apply
- Fix applied: §4.1 adds `SessionLogCardList.tsx` + `RunTraceView.tsx` as the actual rendering components; pages listed as wrappers. §5.5 layout table updated. §4.1 totals updated.

### FINDING #6 — Codex P2 #5 (second half): extended cost endpoint archive-blind

- Section: §4.1, §5.4, §8.2
- Description: Extended fields read from `llm_requests`; runs older than 12 months lose their live rows to `llm_requests_archive`.
- Classification: mechanical (use existing primitive — `llm_requests_all` view already exists and is used by System P&L)
- Disposition: auto-apply
- Fix applied: §4.1 llmUsage.ts row, §5.4 query definitions, §8.2 response contract all changed from `llm_requests` to `llm_requests_all`. RLS + index note added.

### FINDING #7 — Codex P2 #7: Phase C internal contradictions after iteration-2 edits

- Section: §4.3, §7.3, §7.4.1, §7.8, §8.5
- Description: Stale "one-call-cost overshoot max" language in §4.3 vs relaxed invariant in §7.4.1; §7.8 and §8.5 say "no new log lines" but §7.3 adds two. Also §4.3 test (d) double-negative rephrase.
- Classification: mechanical (self-consistency fixes; no new scope/architecture)
- Disposition: auto-apply
- Fix applied: §4.3 row and test (d)/(e) updated; §7.8 and §8.5 now correctly list `costBreaker.checked` + `costBreaker.infra_failure` as Phase-C-introduced diagnostic logs.

### FINDING #8 — Codex P2 #8: Phase B decay files pointed at wrong place

- Section: §4.2 memoryEntryDecayJob.ts row, §6.6, §9.2 memoryEntryDecayJobPure.test.ts row, §9.4 focused pattern, §6.9 #6, §11.2
- Description: Decay math lives in `memoryEntryQualityServicePure.ts::computeDecayFactor`; `memoryEntryDecayJob.ts` only orchestrates the sweep.
- Classification: mechanical (file-inventory drift)
- Disposition: auto-apply
- Fix applied: §4.2 now modifies `memoryEntryQualityServicePure.ts` + `memoryEntryQualityService.ts`; test file path updated everywhere; §6.6 implementation paragraph rewritten; §4.2 totals updated; focused test pattern changed to `memoryEntryQuality`.

### FINDING #9 — Rubric: §7.6 IEE run lookup under-specified

- Section: §7.6
- Description: "resolve agent_run_id from iee_runs via a single indexed query" — no file in §4.3 handles the lookup.
- Classification: mechanical (rubric — load-bearing claim without a named mechanism)
- Disposition: auto-apply
- Fix applied: §7.6 names the concrete helper `resolveRunIdFromIee(ctx)` in `server/services/llmRouter.ts` with a pinned SQL query. Note added explaining why the helper stays in the router rather than promoted to the breaker.

## Decisions log

```
[ACCEPT] §6.9/§10/§9.2/§11.5 — reconcile "only issue" language with §6.5 matrix
  Fix applied: prose acknowledges the `preference → observation` demote row; §6.5 stays authoritative.

[ACCEPT] §4.2/§6.3.1 — add catch-path terminal write
  Fix applied: §4.2 row expanded to include line ~1400 write; §6.3.1 lists three write sites with derivations.

[ACCEPT] §4.1/§5.5 — host-file inventory stale
  Fix applied: SessionLogCardList.tsx + RunTraceView.tsx added as actual rendering components; pages listed as wrappers.

[ACCEPT] §4.1/§5.4/§8.2 — cost endpoint archive-blind
  Fix applied: read path changed to llm_requests_all view; archive-safety preserved.

[ACCEPT] §4.3/§7.3/§7.8/§8.5 — Phase C internal contradictions
  Fix applied: stale invariant claim removed; test rephrased; log-event lists reconciled.

[ACCEPT] §4.2/§6.6/§9.2 — decay files pointed at wrong place
  Fix applied: decay math attributed to memoryEntryQualityServicePure.ts; test file path corrected; §6.6 prose rewritten.

[ACCEPT] §7.6 — IEE run lookup under-specified
  Fix applied: concrete helper `resolveRunIdFromIee` named with pinned SQL; location rationale added.

[HITL → 3.1] §4.1/§5.2.1/§5.5 — PlaybookRunDetailPage wrong identity/status contract
  Reason: Options include dropping the page, new component mode, new endpoint — each a product-direction call.

[HITL → 3.2] §4.2/§6.7/§6.8.2 — outcomeLearningService neutral-partial regression
  Reason: Semantic question about how human-curated content compares to agent-generated content — product call.
```

## Iteration 3 Summary

- Mechanical findings accepted:  7
- Mechanical findings rejected:  0
- Directional findings:          2
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          `tasks/spec-review-checkpoint-hermes-audit-tier-1-3-2026-04-21T03-15-00Z.md`
- HITL status:                   pending
- Spec commit after iteration:   uncommitted (mechanical edits applied in working tree)
