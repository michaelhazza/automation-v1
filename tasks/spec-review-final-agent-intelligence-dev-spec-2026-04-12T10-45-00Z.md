# Spec Review Final Report

**Spec:** `docs/agent-intelligence-dev-spec.md`
**Spec commit at start:** `a0e6ad118b537a3585b6a852d528646c9926fe2b`
**Spec commit at finish:** uncommitted (7 mechanical edits applied to working tree)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iterations run:** 1 of 5
**Exit condition:** codex-found-nothing (both Codex attempts failed — sandbox policy block on attempt 1; unsupported model on attempt 2)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional | Ambiguous | HITL status |
|---|----|----|----|----|----|----|-----|
| 1 | 0 (Codex failed) | 12 | 7 | 1 | 3 | 1 | pending |

---

## Mechanical changes applied

### Section 3.1 Migration SQL (Phase 2A)
- Added DROP of old partial unique index and CREATE of new partial unique index `workspace_entities_current_unique` on `(subaccount_id, name, entity_type) WHERE deleted_at IS NULL AND valid_to IS NULL` — required to allow superseded entities to coexist with current entities.

### Section 3.5 New jobs
- Renamed queue name `memory-dedup` to `maintenance:memory-dedup` to match the `maintenance:` prefix convention used by all other maintenance jobs in the codebase.

### Section 5.1D / 6.2B (algorithm steps 3 and 5)
- Changed step 3 from "mark for soft-deletion" to "mark for deletion (hard delete)" to remove the contradiction with step 5's explicit hard-delete decision.
- Changed step 5 from the ambiguous "Soft-delete marked entries (deletedAt = NOW())... options: (a) hard delete..." to a clean statement of the chosen approach: hard-delete via `DELETE FROM workspace_memory_entries WHERE id = ANY($ids_to_delete)`.

### Section 6.2B — Job registration
- Changed job registration file from `server/jobs/index.ts` (does not exist) to `server/services/queueService.ts`.
- Changed scheduling reference from `server/services/agentScheduleService.ts` (handles agent heartbeat scheduling only) to `server/services/queueService.ts` with the correct scheduling call pattern matching `maintenance:memory-decay`.

### Section 8.2 New/modified files — Phase 2
- Replaced `server/jobs/index.ts` and `server/services/agentScheduleService.ts` with `server/services/queueService.ts` (register job workers + schedule `maintenance:memory-dedup` at 3am UTC).
- Added `server/config/jobConfig.ts` (Modify — add idempotencyStrategy entries for new Phase 2 jobs) to ensure `verify-job-idempotency-keys.sh` gate passes.

### Section 8.2 New/modified files — Phase 3
- Replaced `server/jobs/index.ts` with `server/services/queueService.ts` (register job workers + schedule `subaccount-state-summary` every 4 hours).
- Added `server/config/jobConfig.ts` (Modify — add idempotencyStrategy entry for subaccount-state-summary job).

### Section 9.1 Pure function tests
- Changed `server/services/__tests__/runContextLoaderPure.test.ts` (listed as New — file does not exist) to `server/services/__tests__/runContextLoader.test.ts` (Modify — add test cases; this file already exists and tests `runContextLoaderPure.ts`).

---

## Rejected findings

| Section | Finding | Reason |
|---------|---------|--------|
| 7.3A | `contextSourcesSnapshot` reference is a load-bearing claim without contract | Already handled: `contextSourcesSnapshot` is a JSONB column on `agent_runs` (agentRuns.ts:64), populated in agentExecutionService.ts:739. The claim is backed by an existing mechanism. |

---

## Directional and ambiguous findings (pending HITL)

These findings are in `tasks/spec-review-checkpoint-agent-intelligence-dev-spec-1-2026-04-12T10-30-00Z.md` with `Decision: PENDING`. The human must resolve them before the spec is implementation-ready.

| Finding | Classification | Section | Summary |
|---------|--------------|---------|---------|
| 1.1 | ambiguous | 5.1D | `agent_data_sources.embedding` column: new schema column (requires migration, changes Phase 1 dependency) vs on-the-fly computation (unnamed mechanism, latency concern). |
| 1.2 | directional | 6.2D vs 4.0C | Agent briefing placed in dynamicSuffix (step 10) busts prompt cache on every run, defeating 0C's caching goal. Should briefings be in stablePrefix? |
| 1.3 | directional | 4.0C | Team roster (section 9) classified as stable/stablePrefix but sits between dynamic sections in the assembly order. Prompt assembly must be reordered — spec doesn't describe this. |
| 1.4 | directional | 8.4 | 1C (graph expansion) in Week 4 with Phase 2 items despite only requiring Phase 0. Deliberate or oversight? |

---

## Open questions deferred by `stop-loop`

None — loop exited due to Codex failure, not a human stop-loop decision.

---

## Note on Codex failure

The `codex exec` command is a code-execution agent, not a document reviewer. Both attempts failed:
- Attempt 1: Sandbox policy blocked the Python script Codex tried to run to number the spec.
- Attempt 2: `o4-mini` model not supported with ChatGPT account.

For future runs of this spec review, consider either: (a) using the default Codex model without `-m`, or (b) using a different review mechanism for document-level analysis. The rubric pass (Step 4) produced all 12 findings independently.

---

## Mechanically tight, but verify directionally

The 7 mechanical fixes bring the spec to a mechanically consistent state. However:

- **Four findings require human decisions** before implementation starts (checkpoint file pending). Most important: Finding 1.1 (data source embeddings) affects Phase 1 implementation scope; Finding 1.2 (briefing placement) affects how prompt caching behaves in Phase 2D.
- The review did not re-verify the framing assumptions. The spec is dated 2026-04-12, 4 days after spec-context.md (2026-04-08). No framing mismatches detected.
- The review did not catch directional findings that Codex would have surfaced. Given Codex's failure, a second human read of the framing sections is recommended.

**Recommended next step:** Resolve the 4 HITL findings in the checkpoint file, then proceed to implementation.
