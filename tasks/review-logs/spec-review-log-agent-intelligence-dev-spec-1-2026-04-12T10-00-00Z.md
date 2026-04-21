# Spec Review Log — Agent Intelligence Dev Spec — Iteration 1

**Spec:** `docs/agent-intelligence-dev-spec.md`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-12T10:00:00Z

## Codex status

- Attempt 1 (`codex exec`): Sandbox policy blocked Python script execution. Codex tried to run a Python script to number the spec; policy rejected it. Output was spec content echoed back — no findings produced.
- Attempt 2 (`codex exec -m o4-mini`): Model `o4-mini` not supported with ChatGPT account. Error: `The 'o4-mini' model is not supported when using Codex with a ChatGPT account.`
- Per agent spec: two consecutive failures → stop the loop. However the rubric pass (Step 4) is independent of Codex and was executed. Findings below are rubric-only.

## Rubric findings — 1-4

### FINDING #1
  Source: Rubric-contradictions
  Section: 6.2B — algorithm step 3 vs step 5
  Description: Step 3 says "mark for soft-deletion" but step 5 explicitly chooses hard-delete and notes workspace_memory_entries lacks a deletedAt column.
  Classification: mechanical
  Reasoning: Pure internal contradiction within the same section. The decision (hard delete) is already stated in step 5. "soft-deletion" in step 3 is residual draft text.
  Disposition: auto-apply

[ACCEPT] Section 6.2B — "mark for soft-deletion" in step 3 contradicts the hard-delete decision in step 5.
  Fix applied: Changed step 3 language from "mark for soft-deletion" to "mark for deletion (hard delete)"

---

### FINDING #2
  Source: Rubric-file-inventory-drift
  Section: 8.2 Phase 2 + 3 job registration; Section 3.5 New jobs
  Description: Spec says new jobs register in `server/jobs/index.ts` which does not exist in the codebase; jobs are registered and scheduled in `server/services/queueService.ts`.
  Classification: mechanical
  Reasoning: `server/jobs/index.ts` does not exist. The actual pattern is in `server/services/queueService.ts` which registers all job workers via `boss.work(...)` and schedules via `boss.schedule(...)`.
  Disposition: auto-apply

[ACCEPT] Sections 8.2 (Phase 2/3) and Section 3.5 — `server/jobs/index.ts` named but doesn't exist.
  Fix applied: Replaced references to `server/jobs/index.ts` with `server/services/queueService.ts`.

---

### FINDING #3
  Source: Rubric-file-inventory-drift
  Section: 8.2 Phase 2 modified files
  Description: `server/services/agentScheduleService.ts` listed as where the memory-dedup job is scheduled, but agentScheduleService handles agent heartbeat scheduling only; maintenance job scheduling is in queueService.ts.
  Classification: mechanical
  Reasoning: Verified: `maintenance:memory-decay` is scheduled in queueService.ts via `boss.schedule('maintenance:memory-decay', '0 3 * * *', {})`. agentScheduleService manages pg-boss cron-based agent run schedules, not maintenance jobs.
  Disposition: auto-apply

[ACCEPT] Section 8.2 Phase 2 — `server/services/agentScheduleService.ts` incorrectly listed as scheduling location.
  Fix applied: Removed agentScheduleService.ts from Phase 2 modified files; scheduling responsibility moves to queueService.ts.

---

### FINDING #4
  Source: Rubric-load-bearing-claims
  Section: 9.2 Static gates; Sections 3.5 + 8.2 new jobs
  Description: Three new jobs (memory-dedup/maintenance:memory-dedup, agent-briefing-update, subaccount-state-summary) defined but `server/config/jobConfig.ts` never listed as a file to modify, yet verify-job-idempotency-keys.sh (referenced in §9.2) requires every job in JOB_CONFIG to have an idempotencyStrategy declaration.
  Classification: mechanical
  Reasoning: The gate is explicitly called out in §9.2 and the gate enforces that all JOB_CONFIG entries have idempotencyStrategy. New jobs not in jobConfig.ts will fail the gate. Adding jobConfig.ts to files tables is a minimum consistency fix.
  Disposition: auto-apply

[ACCEPT] Sections 8.2 Phase 2 and Phase 3 — `server/config/jobConfig.ts` missing from files tables.
  Fix applied: Added `server/config/jobConfig.ts` (Modify — add idempotencyStrategy entries for new jobs) to Phase 2 and Phase 3 modified files tables.

## Rubric findings — 5-12

### FINDING #5
  Source: Rubric-file-inventory-drift + Rubric-unnamed-primitive
  Section: 5.1D Two-pass context reranking; Section 8.2 Phase 1 files
  Description: Spec references `agent_data_sources.embedding` as "new nullable column if not present, or computed on-the-fly." The column does not exist in the schema, is not added in migration 0105, and `server/db/schema/agentDataSources.ts` is not in the Phase 1 files table.
  Classification: ambiguous
  Reasoning: Two unresolved branches: (a) new column requires a migration — but Phase 1 has no migration and migration 0105 doesn't include it; (b) on-the-fly computation requires a mechanism that is unnamed. The choice between these changes the implementation surface non-trivially.
  Disposition: HITL-checkpoint

---

### FINDING #6
  Source: Rubric-file-inventory-drift
  Section: 9.1 Pure function tests; Section 8.2 Phase 1 files
  Description: Spec lists `server/services/__tests__/runContextLoaderPure.test.ts` as a new file, but a file `server/services/__tests__/runContextLoader.test.ts` already exists and imports from runContextLoaderPure.js.
  Classification: mechanical
  Reasoning: The existing test already covers the pure module. Creating a new file with a similar name would duplicate test infrastructure. The fix (point to the existing file) is unambiguously correct.
  Disposition: auto-apply

[ACCEPT] Section 9.1 — runContextLoaderPure.test.ts listed as new but runContextLoader.test.ts already tests runContextLoaderPure.ts.
  Fix applied: Changed "New | runContextLoaderPure.test.ts" to "Modify (add test cases) | runContextLoader.test.ts" in the test table.

---

### FINDING #7
  Source: Rubric-invariants-not-enforced
  Section: 6.2D briefing placement vs 4.0C prompt partition
  Description: 6.2D places the briefing at "step 10 (workspace memory)" which falls in dynamicSuffix per 4.0C's partition table, meaning briefing content always busts the prompt cache — defeating the caching goal of 0C.
  Classification: directional
  Reasoning: Whether briefings should be classified as stable (infrequently updated, cache-friendly) or dynamic (updated post-run, cache-busting) is a product trade-off between briefing freshness and caching efficiency. Matches "Cross-cutting signals: Change the Execution model section."
  Disposition: HITL-checkpoint

---

### FINDING #8
  Source: Rubric-load-bearing-claims
  Section: 4.0C multi-breakpoint caching (section 9 stable classification)
  Description: Section 9 (team roster) is classified as stable/stablePrefix but sits between sections 7-8 (dynamic) and 10-14 (dynamic) in the current assembly order. Anthropic caches up to the last cache_control breakpoint in the content array — sections cannot be reordered in the array without a code change to agentExecutionService.ts that the spec does not describe.
  Classification: directional
  Reasoning: This is an architecture change to the prompt assembly order in agentExecutionService.ts. Matches "Architecture signals: Change the interface of X" where X is the prompt assembly ordering.
  Disposition: HITL-checkpoint

---

### FINDING #9
  Source: Rubric-contradictions + file-inventory-drift
  Section: 6.2A acceptance criteria vs 3.1 migration SQL
  Description: Section 6.2A acceptance criteria explicitly says a new unique constraint is needed on workspace_entities (subaccount_id, name, entity_type WHERE deleted_at IS NULL AND valid_to IS NULL) and says "add to migration." The migration SQL in Section 3.1 does not include this CREATE UNIQUE INDEX statement.
  Classification: mechanical
  Reasoning: The spec explicitly names where the constraint should go (migration 0105) and why it's needed. Its absence from the SQL block is a clear drift between two sections of the same spec.
  Disposition: auto-apply

[ACCEPT] Section 3.1 migration SQL — missing the new unique constraint on workspace_entities referenced in 6.2A acceptance criteria.
  Fix applied: Added DROP of the old partial unique index and CREATE of new partial unique index for (subaccount_id, name, entity_type) WHERE deleted_at IS NULL AND valid_to IS NULL.

---

### FINDING #10
  Source: Rubric-sequencing
  Section: 8.4 Sprint plan — 1C in Week 4
  Description: Item 1C (graph expansion) is in Week 4 with Phase 2 items (2C, 2D), despite depending only on Phase 0 (0A) and all other Phase 1 items shipping in Week 2.
  Classification: directional
  Reasoning: Week 4 placement of 1C is a deliberate capacity/sequencing choice. Matches "Sequencing signals: Ship this in a different sprint." The human must decide whether to keep 1C in Week 4 or move it to Week 2 alongside 1A/1B.
  Disposition: HITL-checkpoint

---

### FINDING #11
  Source: Rubric-load-bearing-claims
  Section: 7.3A contextSourcesSnapshot reference
  Description: Section 7.3A says source IDs should be added to contextSourcesSnapshot — verified this mechanism exists.
  Classification: REJECT
  Reason: `contextSourcesSnapshot` exists as a JSONB column on `agent_runs` (server/db/schema/agentRuns.ts:64) and is already populated in agentExecutionService.ts:739. Claim is backed by existing mechanism.

---

### FINDING #12
  Source: Rubric-unnamed-primitive (naming convention)
  Section: 3.5 New jobs — queue name `memory-dedup`
  Description: All maintenance jobs in the codebase use `maintenance:` prefix (maintenance:memory-decay, maintenance:security-events-cleanup, maintenance:cleanup-execution-files, etc.). The spec names the new nightly job `memory-dedup` without the prefix.
  Classification: mechanical
  Reasoning: Naming inconsistency. The dedup job is directly analogous to memory-decay (same table, same maintenance category, same schedule pattern). `agent-briefing-update` and `subaccount-state-summary` are event-driven and plausibly don't need the prefix.
  Disposition: auto-apply (memory-dedup only)

[ACCEPT] Section 3.5, 8.2, 8.3, 8.4 — `memory-dedup` queue name missing `maintenance:` prefix used by all other maintenance jobs.
  Fix applied: Renamed to `maintenance:memory-dedup` throughout spec.

## Iteration 1 Summary

- Mechanical findings accepted:  7 (findings 1, 2, 3, 4, 6, 9, 12)
- Mechanical findings rejected:  1 (finding 11 — contextSourcesSnapshot exists)
- Directional findings:          3 (findings 7, 8, 10)
- Ambiguous findings:            1 (finding 5)
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-agent-intelligence-dev-spec-1-2026-04-12T10-30-00Z.md
- HITL status:                   pending
- Note: Codex failed both attempts; loop exits after this iteration per "two consecutive failures" rule.
