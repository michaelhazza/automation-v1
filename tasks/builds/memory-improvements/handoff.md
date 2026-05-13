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

---

## Phase 2 (BUILD) — plan locked 2026-05-13, awaiting Sonnet execution session

**Plan path:** [`tasks/builds/memory-improvements/plan.md`](./plan.md) (LOCKED, 11 chunks)
**Plan-review:** chatgpt-plan-review 2 rounds — R1 closed 2 BLOCKERs + 6 TIGHTENINGs, R2 closed 3 BLOCKERs + 4 TIGHTENINGs + 1 polish. All 15 findings TECHNICAL, auto-applied. R2 verdict APPROVED. Session log: [`tasks/review-logs/chatgpt-plan-review-memory-improvements-2026-05-13T02-35-47Z.md`](../../review-logs/chatgpt-plan-review-memory-improvements-2026-05-13T02-35-47Z.md)
**S1 sync:** absorbed PR #287 sandbox-isolation, PR #286 operator-session-identity, PR #288 operator-backend (commit `4a7da3d4`); absorbed PR #292 tracking-files cleanup (commit `7d64cc9e`).
**Environment fixes applied (durable, will inherit in Sonnet session):**
- `git config --global http.sslBackend schannel` (Windows native cert store for git)
- `npm config set cafile "C:\Users\Michael\.npmrc-ca-bundle.pem"` (270 Windows root certs extracted via PowerShell — file at `C:\Users\Michael\.npmrc-ca-bundle.pem`)
- `npm install` now works; `npm run typecheck` PASSES clean on the integrated branch state.

### Resume contract for Sonnet session

Per CLAUDE.md model-guidance: execution is token-intensive and Sonnet handles a clear plan equally well at lower cost. The Opus session locked the plan; Sonnet runs the per-chunk loop.

**Recommended entry pattern (one of the two):**

1. **Direct execution skill (cleanest):** Open a new Claude Code session on Sonnet, run:
   ```
   /superpowers:subagent-driven-development tasks/builds/memory-improvements/plan.md
   ```
   The skill reads the plan, dispatches one builder sub-agent per chunk, enforces G1 per chunk. After all 11 chunks land, manually invoke the branch-level review pass:
   - `spec-conformance: verify the current branch against its spec`
   - `pr-reviewer: review the full branch diff`
   - `dual-reviewer: ...` (will REVIEW_GAP — Codex CLI unavailable on this host)
   - `adversarial-reviewer: ...` (auto-trigger on RLS/migration/route diff per §5.1.2)
   - Doc-sync sweep + handoff write + current-focus → REVIEWING

2. **Resume feature-coordinator (full automation, but watch for re-architect risk):** `launch feature coordinator` on Sonnet. The playbook detects status: BUILDING, reads the handoff. **Pre-empt this hazard:** the playbook Step 3 unconditionally re-invokes architect to write `plan.md` — if you take this path, manually instruct the coordinator to SKIP Steps 2-5 (S1 sync, architect, chatgpt-plan-review, plan-gate) because they're complete. Start at Step 6 (per-chunk loop).

**Plan-time findings to keep in mind during build:**
- **R4 / Chunk 2 — `writeVersionRow` at auto-synthesis:** the synthesis service does NOT currently write `memory_block_versions` rows. Chunk 2 must wire `writeVersionRow({changeSource: 'auto_synthesis'})` inside the block-insert transaction, then write lineage rows against the returned version id. Operator-approved.
- **F1 / Chunk 5 — migration 0345, not appended to 0334:** MV + null-stable unique index + initial refresh land in new file `migrations/0345_memory_utility_30d.sql` (after main's 0335-0342). 0334 stays single-purpose (column only). Don't append.
- **F2 / Chunk 5 — null-stable unique index:** `COALESCE(subaccount_id, '00000000-0000-0000-0000-000000000000'::uuid)` so REFRESH CONCURRENTLY works. Two acceptance checks listed in §9 Phase 2 of the plan.
- **F1 R2 / Chunk 5 — MV aggregates COALESCEd to 0:** totals are NOT NULL in Drizzle declaration; ratios remain nullable. Two-CTE shape in the migration.
- **F2 R2 / Chunk 5 — `jsonb_typeof` guards on every `jsonb_array_length`:** legacy rows with non-array JSONB do not brick the nightly refresh.
- **F3 R2 / Chunk 9 — `scoreCandidates` is the per-candidate boundary:** catches `cosineSimilarity` throws, skips the malformed candidate, continues scoring the rest. No global fallback. Test case added.
- **T4 R2 / Chunks 6+7 — DB-anchored time:** route reads `transaction_timestamp()` from the same SQL query and passes it to `bucketDailySeries`. Never `new Date()`.
- **T2 R2 / Chunks 3+6 — UUID canonicalisation:** 403-before-query compares `req.params.orgId?.toLowerCase()` to `req.orgId?.toLowerCase()`.

**Pre-flight verifications recorded in the plan that the build must reconfirm:**
- `agentExecutionService.ts:1349-1356` line anchors still valid (Chunk 4).
- `memoryBlockSynthesisService.ts:195-206` line anchors still valid (Chunk 2).
- 16:00 UTC cron slot still free (Chunk 5 — grep `agentScheduleService.ts` for `'16'`).
- No 0345 migration-number collision with main (re-fetch + check before commit).

**Phase 2 review-pass posture:**
- `spec-conformance` MUST run on the full branch diff after all chunks land.
- `pr-reviewer` MUST run after spec-conformance.
- `dual-reviewer` will auto-skip with `REVIEW_GAP: Codex CLI unavailable` per handoff Phase 1 notes — chatgpt-pr-review in Phase 3 covers second-opinion.
- `adversarial-reviewer` will auto-trigger (migration 0333 RLS table; migration 0345 MV with RLS-exclusion; two new orgId-scoped routes; `agentExecutionService` change touches request-path code).

---

## Phase 2 (BUILD) — complete 2026-05-13

**Plan path:** [`tasks/builds/memory-improvements/plan.md`](./plan.md) (LOCKED, 11 chunks)
**Chunks built:** 11 of 11 — squashed in `a1e87d75 feat(memory-improvements): implement all 11 chunks`.
**Branch HEAD at handoff:** see Phase 2 close commit pushed at finalisation handoff time.
**G1 attempts (per chunk):** chunk-by-chunk G1 ran inside the Sonnet execution session — see prior session log; G2 then ran cleanly on the integrated branch state.
**G2 attempts:** 1 (PASS — lint 0 errors, typecheck clean).
**G3 (post-fix-loop + post-dual-reviewer) attempts:** PASS on each attempt (R1 fixes, R2 backfills, R3 regression fix, post-dual-reviewer).

**Final review verdicts (after 3 fix-loop rounds):**

- **spec-conformance:** CONFORMANT_AFTER_FIXES — 68 REQs, 61 PASS, 1 MECHANICAL_GAP fixed (migration 0333 invalid PostgreSQL RLS syntax), 6 DIRECTIONAL_GAPs routed to `tasks/todo.md`. Operator chose backfill — 4 of 6 directional gaps closed in fix-loop R2; 2 (capabilities.md sub-entry + opportunistic cleanup) remain explicit deferrals.
  - Log: [`tasks/review-logs/spec-conformance-log-memory-improvements-2026-05-13T05-41-00Z.md`](../../review-logs/spec-conformance-log-memory-improvements-2026-05-13T05-41-00Z.md)
- **adversarial-reviewer:** HOLES_FOUND — 1 HIGH (synthesis bare-db) resolved by fix-loop R1; 3 advisory deferrals (organisationId filter, LIMIT, concurrent-synthesis lock). Non-blocking advisory per playbook §8.2.
  - Log: [`tasks/review-logs/adversarial-review-log-memory-improvements-2026-05-13T06-00-00Z.md`](../../review-logs/adversarial-review-log-memory-improvements-2026-05-13T06-00-00Z.md)
- **pr-reviewer:** APPROVED (Round 5 — final pass after dual-reviewer). 4 fix-loop rounds in total: R1→R2 (RLS/try-catch/GUC), R3 (4 spec divergences), R4 (Sources tab regression fix), R5 (post-dual-reviewer empty-versions null pass-through).
  - Log: [`tasks/review-logs/pr-review-log-memory-improvements-2026-05-13T05-50-00Z.md`](../../review-logs/pr-review-log-memory-improvements-2026-05-13T05-50-00Z.md)
- **reality-checker:** Initial NEEDS_DISCUSSION (operationally sound; spec-vs-shipped divergences + env-gated operational items). Operator chose backfill for the 4 divergences → effectively READY-for-Phase-3 after R2 backfill.
  - Log: [`tasks/review-logs/reality-check-log-memory-improvements-2026-05-13T06-42-00Z.md`](../../review-logs/reality-check-log-memory-improvements-2026-05-13T06-42-00Z.md)
- **Fix-loop iterations:** 3 rounds (R1: 3 Blocking → APPROVED; R2: 4 spec divergences → 1 new regression; R3: regression → APPROVED).
- **dual-reviewer:** APPROVED — 3 Codex iterations, 1 ACCEPT (empty-versions null pass-through), 3 REJECT with sound rationale. Auto-committed at `cc8e03c7`.
  - Log: [`tasks/review-logs/dual-review-log-memory-improvements-2026-05-13T07-26-56Z.md`](../../review-logs/dual-review-log-memory-improvements-2026-05-13T07-26-56Z.md)

**REVIEW_GAP entries:** none (all required reviewers ran; Codex CLI was available — Phase 1's prediction of dual-reviewer auto-skip did not materialise).

**Doc-sync gate verdicts:**

| Doc | Verdict |
|---|---|
| architecture.md | yes (Key files per domain table; tasks index; Memory-block lineage section). Stale `writeVersionSourceLinks` references corrected to `writeLineageRowsForVersion`; `memoryBlockLineageService` + `memoryUtilityAggregatorPure` added. |
| docs/capabilities.md | yes (new "Memory Injection Utility" section). A and D intentionally not catalogued — operator-facing infrastructure, not customer-visible capabilities. |
| docs/integration-reference.md | n/a — no integration behaviour change. |
| CLAUDE.md / DEVELOPMENT_GUIDELINES.md | n/a — no agent fleet / review pipeline / locked-rules change. |
| CONTRIBUTING.md | n/a — no lint-suppression policy change. |
| docs/frontend-design-principles.md | n/a — UI tabs follow existing default-hidden / one-primary-action conventions. |
| KNOWLEDGE.md | yes (4 new entries: semantic ranker recall fallback, lineage idempotency, 403-before-query for MV routes, synthesis FK ordering). |
| docs/spec-context.md | n/a — feature pipeline, not spec-review session. |
| docs/decisions/ | n/a — no new ADR; spec is the durable artefact. |
| docs/context-packs/ | n/a — no section-anchor changes. |
| references/test-gate-policy.md | n/a — no test-gate posture change. |
| references/spec-review-directional-signals.md | n/a — no spec-reviewer signal additions. |
| docs/incident-response.md | n/a — no incident-response framework change. |
| docs/testing-transition-plan.md | n/a — no testing-transition change. |
| .claude/FRAMEWORK_VERSION | n/a — repo-specific change, not framework-level. |

---

## Open issues for finalisation (chatgpt-pr-review)

The Phase 3 finalisation pass should evaluate these deferrals against the full diff and operator policy. None are blockers for proceeding to Phase 3, but each is a real item the operator may want closed before merge.

**Non-blocking pr-reviewer Should-fix items (deferred from R1/R3):**

1. `server/services/memoryBlockSourcesService.ts` — missing explicit `eq(memoryBlockVersionSources.organisationId, ...)` predicate on the lineage and reverse-lineage queries (defence-in-depth per DEVELOPMENT_GUIDELINES.md §1).
2. `server/services/memoryBlockSourcesService.ts` — no `LIMIT` on lineage fetch or reverse-lineage aggregate (unbounded — DoS surface when `include_reverse=true`).
3. `server/services/agentExecutionService.ts:1364-1368` — fire-and-forget `injectedEntryIds` write bypasses `withOrgTx` + omits explicit `organisationId` filter; §8.31 PLAN_GAP entry required to name the residual risk.
4. `server/services/memoryBlockLineageService.ts:119` — `rowsWritten` counter increments unconditionally after `onConflictDoNothing`; misreports actual inserts.
5. `server/services/memoryUtilityQueryService.ts` — wire type drift: `entryUtility30d / blockUtility30d` declared as `string | null` (drizzle numeric serialisation) while spec §6.6 declares `number | null`. Operator decision: convert in service vs. amend spec.
6. `server/services/memoryBlockSourcesService.ts:77` — `versionNumber: null` on 200 empty-versions response (spec §6.1 declares `number`; dual-reviewer's null pass-through fix may close this — operator confirm).
7. `server/services/memoryBlockSourcesServicePure.ts` — `sourceType: string` too wide; narrow to `'workspace_memory'` literal per spec §6.1.
8. `client/src/pages/MemoryUtilityTab.tsx` — em-dash `—` placeholder in user-facing copy violates CLAUDE.md UI rule.
9. `client/src/pages/MemoryBlockSourcesTab.tsx` — retry handler duplicates fetch logic (extract `load()` closure for maintainability).
10. `client/src/pages/MemoryUtilityTab.tsx` — bare `'x'` dismiss glyph (replace with `×`).
11. `server/services/memoryBlockSourcesService.ts` — inline SQL ORDER BY would read more naturally as `desc()` drizzle helper.
12. Missing render test for `MemoryBlockDetailPage` Sources-tab discovery (the Round 3 regression had no test safety net).
13. `isMeasured()` predicate divergence: aggregator uses `Array.isArray`, daily-series helper uses `!== null` — converge.

**Non-blocking adversarial-reviewer deferrals:**

A. Cross-tenant defence-in-depth on reverse-lineage (same as Should-fix #1).
B. DoS surface on unbounded lineage fetch (same as Should-fix #2).
C. Concurrent-synthesis advisory lock missing (pg-boss `teamSize:1` provides first-line; service-layer dedup absent).

**Operator-decision items (spec-conformance directional gaps, 2 not yet closed):**

- REQ #67 (`docs/capabilities.md` lineage + AKR-ranker entries) — partially closed (B2 entry added; A and D intentionally not catalogued — see capabilities.md verdict in doc-sync gate).
- REQ #68 (opportunistic cleanup `MEMORY_BLOCK_TOP_K`, `MEMORY_BLOCK_POOL_MULTIPLIER` env-overridable) — spec explicitly opts in: "Not required for the spec to land."

**Env-gated pre-enablement gates (run before AKR ranker env flag is flipped on):**

i. `verify-rls-coverage.sh` (CI-gate)
ii. First MV refresh aggregate spot-check vs raw `agent_runs`
iii. Threshold-0.30 spot-check on ~10 dev runs (D enablement)
iv. text-embedding-3-small task-description vs master-prompt A/B
v. EXPLAIN for daily-series query (index coverage on `agent_runs(organisation_id, created_at)`)
vi. EXPLAIN for reverse-lineage `COUNT(*) GROUP BY source_entry_id_hash` query (`idx_mbvs_source_entry_hash`)

---

## Next phase: FINALISATION

Open a new Claude Code session and type:

```
launch finalisation
```

`finalisation-coordinator` will:
- S2 sync against main
- G4 regression guard
- `chatgpt-pr-review` (manual ChatGPT-web rounds) — primary second-opinion pass for the deferred items above
- Full doc-sync sweep (re-verify the verdicts in this handoff)
- KNOWLEDGE.md final extraction
- `tasks/todo.md` cleanup (deferred items resolution)
- `current-focus.md` → MERGE_READY
- Apply `ready-to-merge` label (CI runs)

This session ends at Phase 2 close.
