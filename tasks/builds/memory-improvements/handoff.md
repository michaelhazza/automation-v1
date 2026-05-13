# Handoff — memory-improvements

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** [`docs/superpowers/specs/2026-05-13-memory-improvements-spec.md`](../../../docs/superpowers/specs/2026-05-13-memory-improvements-spec.md)
**Branch:** `claude/add-memvid-integration-ehAOr`
**Build slug:** `memory-improvements`
**UI-touching:** yes
**Mockup paths:**
- [`prototypes/memory-improvements/index.html`](../../../prototypes/memory-improvements/index.html) (landing)
- [`prototypes/memory-improvements/memory-block-detail.html`](../../../prototypes/memory-improvements/memory-block-detail.html) (Proposal A — Sources tab)
- [`prototypes/memory-improvements/citation-utility-dashboard.html`](../../../prototypes/memory-improvements/citation-utility-dashboard.html) (Proposal B2 — Memory Utility tab)
- [`prototypes/memory-improvements/rationale.html`](../../../prototypes/memory-improvements/rationale.html) (UI rationale doc — not a screen)
- Retired in Rev 6: `prototypes/memory-improvements/akr-ranker-settings.html` (preserved in git history at `ea1fc78`)

**Spec-reviewer iterations used:** 1 / 5 (REVIEW_GAP — Codex CLI unavailable; rubric pass applied 12 mechanical fixes)
**ChatGPT spec review log:** [`tasks/review-logs/chatgpt-spec-review-memory-improvements-2026-05-13T01-17-21Z.md`](../../review-logs/chatgpt-spec-review-memory-improvements-2026-05-13T01-17-21Z.md)
**Spec-reviewer logs:**
- Plan: [`tasks/review-logs/spec-review-plan-memory-improvements-2026-05-13T00-52-42Z.md`](../../review-logs/spec-review-plan-memory-improvements-2026-05-13T00-52-42Z.md)
- Iteration 1: [`tasks/review-logs/spec-review-log-memory-improvements-1-2026-05-13T00-52-42Z.md`](../../review-logs/spec-review-log-memory-improvements-1-2026-05-13T00-52-42Z.md)
- Final report: [`tasks/review-logs/spec-review-final-memory-improvements-2026-05-13T00-52-42Z.md`](../../review-logs/spec-review-final-memory-improvements-2026-05-13T00-52-42Z.md)

---

## Open questions for Phase 2

**None.**

## Decisions made in Phase 1

### Open-question resolutions (operator-approved 2026-05-13)

- **Q1 — D query definition:** Task description only. Master prompt and conversation history rejected as embedding inputs. Build phase may revisit if B1 utility numbers post-enablement show the ranker missing relevant memory.
- **Q2 — D threshold default:** `AKR_RETRIEVAL_THRESHOLD = 0.30`. Build phase MUST spot-check ~10 representative dev-environment runs before any enablement; adjust to `0.25` if filtering rejects >50% of recall-relevant chunks. Adjustment + evidence recorded in implementation plan. (Spot-check protocol is enablement procedure, NOT spec contract — per ChatGPT review Round 1 T4.)
- **Q5 — Materialised-view refresh window:** Nightly at **16:00 UTC** (AU 02:00 AEST / 03:00 AEDT). Operator-flagged correction from initial 03:00 UTC default, which falls mid-AU-business-day. Avoids the existing 03:00 UTC `mv_optimiser_peer_medians` refresh slot. Build phase confirms no 16:00 UTC job collisions before commit.
- **Q7 — Per-document coverage metric (AKR-spec §11):** Deferred explicitly. Different operator question (which docs are loaded?) vs utility (how much is used?). Belongs as follow-up extension of `retrievalObservabilityService`, not as a second reader of `mv_memory_utility_30d`.

### Banner copy (R2-T1, operator-approved 2026-05-13)

Dashboard heuristic-caveat banner ships as: *"Runs predating the entry-manifest migration are excluded from entry utility calculations. Agent table refreshes nightly; charts reflect live run data. Citation detection is heuristic, so figures are directional."*

### Resolutions made by spec-reviewer iteration 1 (rubric pass, Codex unavailable)

- **Migration numbers shifted:** `0330 → 0333`, `0331 → 0334` (avoid collision with `external_source_triggers` 0330/0331 and `system_agents_home_widget` 0332).
- **Q3 — Pinned write site:** `server/services/agentExecutionService.ts:1349-1356` (immediately after `memoryWithTracking.injectedEntries` is bound). Verified against current main; build phase reconfirms before commit.
- **Q4 — Pinned route guards:** `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` for Sources route (matches `server/routes/memoryBlocks.ts:46-49`); `requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW)` for Memory Utility route (matches `server/routes/llmUsage.ts:27-30`).
- **Q6 — Reverse-lineage index added:** `idx_mbvs_source_entry_hash` in migration 0333 so reverse-lineage queries are index-covered when requested. **Default-off contract** per ChatGPT Round 1 F2.
- **Usage route aligned to existing convention:** `/api/orgs/:orgId/usage/<surface>`.
- **Stale line anchors corrected** in §8.2 cache-boundary discussion.
- **NULL-discriminator asymmetry made explicit** in §3.5 + §3.6 (entry side nullable, block side NOT NULL DEFAULT `[]`).
- **Frontmatter:** `Status: draft → reviewing` (now `accepted`).

### Resolutions made by ChatGPT spec-review Round 1 (CHANGES_REQUESTED → all auto-applied)

- **F1 — B2 dashboard time-series:** Added §6.6 `MemoryUtilityPayload` contract with `agents[]` (per-agent aggregate from MV) + `dailySeries[]` (daily UTC buckets computed on-demand from raw `agent_runs`). New file `memoryUtilityDailySeriesPure.ts` added to inventory. Aggregate and daily series can drift by up to one refresh cycle — disclosed in dashboard banner.
- **F2 — Reverse-lineage contradiction:** Aligned §6.1, §14.1 UI, and §15 Q6 to a single contract: **default-off; opt-in via `?include_reverse=true` only on UI expand**. Walked back earlier "ship enabled by default" wording.
- **F3 — Path-org / session-org invariant:** Added explicit rule to §7.3 and §7.4: route MUST reject `:orgId` mismatch with HTTP 403 before any query executes. Both MV reads and raw `agent_runs` daily-series reads are guarded at the route layer.
- **T1 — Lineage idempotency:** Tightened to `onConflictDoNothing` on `(block_version_id, source_entry_id_hash)` scoped to a committed block version. Retry creating a new `block_version_id` gets its own lineage rows.
- **T2 — Source-run provenance verification:** Build phase MUST verify whether `WorkspaceMemoryEntry` exposes a stable `originatingRunId` field. If absent, write NULL run provenance; do not infer from synthesis-job context.
- **T3 — `source_type` narrowing:** V1 only emits `'workspace_memory'`. Other values reserved for future expansion.
- **T4 — Threshold spot-check relocation:** Spec contract is now "default 0.30; any pre-enablement change recorded in implementation plan." Spot-check procedure moved to this handoff.
- **W1 — §13.5 wording cleanup:** At most one `retrieval.embedding_failed` per run; `retrieval.empty_after_semantic` may emit once per affected category; embedding failure precludes any empty-after-semantic events.

### Resolutions made by ChatGPT spec-review Round 2 (APPROVED — locks spec)

- **R2-T1 — Banner copy disclosure** (operator-approved): see above.
- **R2-T2 — Daily-series test added:** `memoryUtilityDailySeriesPure.test.ts` added to §12.1 with explicit cases for UTC bucket boundaries, zero-measured-run buckets returning null, entry-side measured/unmeasured partition, block-side denominator-zero handling, and 30-bucket gap-filling shape.

## Build-phase acceptance checklist (for feature-coordinator)

These are spec-derived acceptance criteria the build phase must satisfy. They are NOT spec contract — they're operational steps the implementer runs alongside the per-chunk gates.

### Phase 1 (A — Synthesis lineage)

- [ ] Verify `WorkspaceMemoryEntry` exposes a stable `originatingRunId` field (or equivalent). If yes, populate `source_run_id` + `source_run_id_hash` + `source_run_label_at_capture`. If no, write NULL provenance — do NOT infer from synthesis-job context.
- [ ] Confirm `memoryBlockSynthesisService.ts:195-206` has not drifted from spec anchor before committing the write-site change.
- [ ] Migration 0333 includes `idx_mbvs_source_entry_hash` for reverse-lineage index coverage.
- [ ] `memory_block_version_sources` is added to `server/config/rlsProtectedTables.ts` in the same commit as migration 0333.
- [ ] Verify `verify-rls-coverage.sh` passes after the migration lands.

### Phase 2 (B1 — Measurement substrate)

- [ ] Confirm `agentExecutionService.ts:1349-1356` has not drifted from spec anchor before committing the write-site change.
- [ ] Migration 0334 adds `injected_entry_ids jsonb` (nullable, no DEFAULT) to `agent_runs`.
- [ ] Confirm no other job at 16:00 UTC collides with the materialised-view refresh — grep `server/jobs/index.ts` for `0 16 * * *` and equivalent cron strings.
- [ ] First refresh of `mv_memory_utility_30d` after migration confirms the aggregates match a spot-check SQL against raw `agent_runs`.

### Phase 3 (D — Semantic ranker)

- [ ] **Pre-enablement spot-check:** sample ~10 representative dev-environment runs. For each: compute the cosine score distribution against the run's chunk candidates at the default `AKR_RETRIEVAL_THRESHOLD = 0.30`. If the threshold rejects >50% of recall-relevant chunks (operator judgment), adjust to `0.25` before flipping the flag and record the adjustment + evidence in the implementation plan.
- [ ] Validate `text-embedding-3-small` over the task description vs the master prompt is in fact the right choice — quick A/B against the same 10 dev runs.
- [ ] Confirm the D-Recall and D-Embedding-failure fallback paths emit the correct degraded reasons in dev testing.
- [ ] `AKR_SEMANTIC_RANKER_ENABLED` defaults to `false` in the merged code; never default to true.

### Phase 4 (B2 — Dashboard)

- [ ] EXPLAIN the daily-series query against a sample dataset. Confirm it's index-covered or fast enough to ship as a live read.
- [ ] EXPLAIN the reverse-lineage query (`COUNT(*) GROUP BY source_entry_id_hash`) — if cost is materially worse than expected, default the UI to per-row "Expand" affordance instead of any always-on default.
- [ ] Verify the dashboard banner text matches the operator-approved copy: *"Runs predating the entry-manifest migration are excluded from entry utility calculations. Agent table refreshes nightly; charts reflect live run data. Citation detection is heuristic, so figures are directional."*
- [ ] Route `GET /api/orgs/:orgId/usage/memory-utility` returns HTTP 403 (not 404, not 500) when `:orgId` does not match the authenticated session organisation.

### Across all phases

- [ ] No new tests in forbidden categories (supertest, playwright, frontend unit tests) per `references/test-gate-policy.md`.
- [ ] All new pure-function tests use vitest's `expect()` API (no `node:test` / `node:assert`).
- [ ] Doc-sync: `architecture.md` updated per §5.3 of the spec.
- [ ] If S2 sync at finalisation surfaces a migration-number collision on 0333 or 0334, follow the existing renumber playbook (recent precedent: pre-test-hardening 0313-0315 → 0318-0320; trust-verification-layer 0288-0297 → 0295-0304).

## Notes for the next session

- **Codex CLI is unavailable on this Windows host** (SSL cert chain issues). `dual-reviewer` will likely auto-skip with REVIEW_GAP in Phase 2's branch-level review pass. `chatgpt-pr-review` becomes the primary second-opinion pass.
- **npm install was also blocked by the SSL chain.** Pre-Phase-2, the operator may need to resolve cert config (e.g. `git config http.sslCAInfo <path>` or corporate proxy) before any build work that requires fresh deps.
- **PR #291 personal-assistant-v1 merged on main during this Phase 1 session** (squash-commit `9002174e`, 2026-05-12T23:41:06Z). S0 merge absorbed it cleanly. PR #291 adds `@react-pdf/renderer` dependency — the typecheck error on `server/services/reportRenderingService.ts` and `server/services/reportTemplates/MacroReport.tsx` is caused by stale `node_modules`, not by anything in this branch.

## Phase 1 status: complete

Spec is locked at `Status: accepted`. Phase 2 may begin.
