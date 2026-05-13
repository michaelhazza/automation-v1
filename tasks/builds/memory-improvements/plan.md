# Plan — memory-improvements

**Status:** plan-gate (ready for operator review before execution)
**Spec:** [`docs/superpowers/specs/2026-05-13-memory-improvements-spec.md`](../../../docs/superpowers/specs/2026-05-13-memory-improvements-spec.md) (Status: accepted, locked 2026-05-13)
**Handoff:** [`tasks/builds/memory-improvements/handoff.md`](./handoff.md)
**Build slug:** `memory-improvements`
**Branch:** `claude/add-memvid-integration-ehAOr`
**Authored by:** architect (Opus, inline)
**Date:** 2026-05-13

---

## Table of contents

1. Executor notes
2. Model-collapse check
3. Architecture notes
4. Risks and mitigations
5. Chunk breakdown
6. Per-chunk detail
   - Chunk 1 — A: Migration 0333 + RLS manifest entry
   - Chunk 2 — A: Lineage write at synthesis (+ memory_block_versions write)
   - Chunk 3 — A: Sources route + UI tab
   - Chunk 4 — B1: Migration 0334 column + agentExecutionService write
   - Chunk 5 — B1: Materialised view (migration 0343) + nightly refresh job at 16:00 UTC
   - Chunk 6 — B2: Memory Utility API route
   - Chunk 7 — B2: Daily-series pure helper + tests
   - Chunk 8 — B2: Dashboard UI tab
   - Chunk 9 — D: Semantic ranker behind env flag
   - Chunk 10 — D: Telemetry + observability wiring
   - Chunk 11 — Doc-sync
7. UX considerations
8. Test inventory
9. Build-phase acceptance checklist
10. Open questions / assumptions for operator review
11. Self-consistency pass
12. Plan footer

---

## 1. Executor notes

Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

Per-chunk verification commands are limited to `npm run lint`, `npm run typecheck`, `npm run build:client` / `npm run build:server` where relevant, and `npx vitest run <new-test-path>` for tests authored within that chunk. CI (a pre-merge gate) runs the full RLS, contract, gate, and unit suites.

## 2. Model-collapse check

Three-question pre-check from `architect.md`:

1. **Decomposes into ingest → extract → transform → render?** Partially. Phase A persists provenance rows from synthesis (ingest-storage); Phase B writes per-run counts and aggregates via SQL (extract-transform); Phase D extracts a query embedding and cosine-scores candidates. None of these is an ingest→render pipeline per se — they are storage, measurement, and ranking primitives.
2. **Could a frontier multimodal model do each step in a single call?** No.
   - **A — lineage rows.** Deterministic, audit-grade FK + snapshot persistence. An LLM call would degrade fidelity and break the audit trail.
   - **B — utility math.** SQL aggregation over `agent_runs`. An LLM cannot replace `COUNT(*) FILTER` + `sum/sum` and remain deterministic at minute-level refresh cadence.
   - **D — semantic ranking.** D **is** the model call (one embedding per run + cosine over existing 1536-dim chunk vectors). Wrapping the ranking layer in a second LLM call would re-introduce the rejected re-rank layer (brief §1.2, spec §1.2 non-goal), inflate the per-run latency budget (§8.3 caps it at ~50–150 ms RTT), and break determinism for B1's utility comparison post-enablement.
3. **Can the pipeline collapse into one call?** **Rejected.** The requirement is deterministic, audit-grade, SQL-aggregable storage. The value of A is that operators can trust each row; the value of B is that B1 numbers are reproducible between refreshes; the value of D is that the ranker is observable and reverts cleanly on env flip. An LLM at any of these seams defeats the requirement. The single LLM call we do make — D's task-description embedding — is already collapsed to one model call per run.

Decision recorded: collapse rejected on determinism + audit-trail + non-goal grounds.

## 3. Architecture notes

### Four logical phases and ordering constraints

Per spec §4 and §9, four buildable phases, each landable independently. Sequencing constraint: **B1 (Phase 2 — measurement substrate) must land before D (Phase 3 — semantic ranker) is enabled in any environment**, because B1 is the post-enablement quality signal that gates whether D's filtering is helping or hurting recall. Phase 4 (B2 dashboard) depends mechanically on Phase 2's materialised view existing. Phase 1 (A — lineage) is independent of all other phases.

Chunk ordering inside this plan:

```
Chunk 1 (A migration + RLS manifest)
    → Chunk 2 (A lineage write at synthesis, also writes the missing memory_block_versions row)
        → Chunk 3 (A Sources route + UI tab)

Chunk 4 (B1 migration 0334 + agentExecutionService write)
    → Chunk 5 (B1 MV + nightly refresh job at 16:00 UTC)
        → Chunk 7 (B2 daily-series pure helper + tests)
            → Chunk 6 (B2 route) depends on Chunk 7 (route imports pure helper)
                → Chunk 8 (B2 UI tab) depends on Chunk 6

Chunk 9 (D semantic ranker behind env flag) — depends operationally on Chunks 4-5 (B1 substrate must exist for post-enablement signal even though D code does not import B1)
    → Chunk 10 (D telemetry + observability wiring)

Chunk 11 (doc-sync — architecture.md per spec §5.3, KNOWLEDGE.md note)
```

A and B are independent of each other; the integration branch may interleave Chunks 1-3 with Chunks 4-8. D (9-10) depends *operationally* on B1 (chunks 4-5) — there is no code import dependency, but the flag must remain off until B1 numbers are observable. Doc-sync (Chunk 11) runs last as it summarises all four phases.

### Migrations 0333, 0334, 0343 — collision verification

Per `Glob migrations/033*.sql` at plan time, taken slots are `0330_external_source_triggers`, `0331_system_agents_home_widget`, `0332_executive_assistant_seed`. Main's recent PR #288 (operator-backend) landed migrations `0335`-`0342`. Free slots between 0332 and 0335 are `0333` and `0334`; first free slot after `0342` is `0343`.

Three new migrations from this build:

- **0333** — `memory_block_version_sources` table + RLS + indexes (Chunk 1).
- **0334** — `agent_runs.injected_entry_ids` column (Chunk 4). Single-purpose, no MV.
- **0343** — `mv_memory_utility_30d` materialised view + null-stable unique index + initial refresh (Chunk 5). Numbered 0343 (after main's 0335-0342) instead of appended to 0334 so each migration file applies independently and re-running is safe (once a migration file has been applied in any environment, appending more SQL to it is silently skipped — ChatGPT plan-review R1 F1 fix).

Main's three `agent_runs`-touching migrations don't collide with `injected_entry_ids`:

- **0338** — adds `agent_runs.operator_chain_failure_count integer NOT NULL DEFAULT 0` and extends the status CHECK constraint.
- **0341** — adds `agent_runs.per_task_budget_extension_minutes integer NOT NULL DEFAULT 0`.
- **0342** — adds `agent_runs.assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL`.

Our 0334 (`injected_entry_ids`) lands before main's 0335-0342 because the migration runner orders by numeric prefix. The schema layer (`server/db/schema/agentRuns.ts`) gains one new field; the build phase confirms no field-name collision on the Drizzle side before commit.

If S2 sync at finalisation discovers a number collision (someone lands 0333, 0334, or 0343 on main before our PR), use the existing renumber playbook (recent precedent: pre-test-hardening 0313-0315 → 0318-0320; trust-verification-layer 0288-0297 → 0295-0304). The handoff calls this out explicitly.

### Three RLS-protected additions

| Surface | Type | RLS posture | Manifest entry |
|---|---|---|---|
| `memory_block_version_sources` | new tenant table | full RLS policy + FORCE in migration 0333 | **must land in `server/config/rlsProtectedTables.ts` in the same commit as 0333** |
| `agent_runs.injected_entry_ids` | new nullable JSONB column | inherits `agent_runs` RLS | no manifest action — column, not table |
| `mv_memory_utility_30d` | new materialised view | **MVs bypass RLS by design**; protected at the read service AND the route layer (path-org 403 check) | add to `server/db/rlsExclusions.ts` with rationale citing route-layer protection (precedent: `optimiser_skill_peer_medians`) |

### Pinned write sites

- **A — lineage row + `memory_block_versions` row.** `server/services/memoryBlockSynthesisService.ts:195-206` (verified at plan time). Today this code only inserts a `memory_blocks` row. **Plan-time finding:** the synthesis path does not currently write a `memory_block_versions` row, but spec §4 Phase 1's FK is `block_version_id → memory_block_versions(id)`. The lineage write therefore must also create a `memory_block_versions` row (using `writeVersionRow()` from `memoryBlockVersionService.ts` with `changeSource: 'auto_synthesis'`) in the same transaction as the block insert, then write one `memory_block_version_sources` row per cluster entry. This is a real code-shape change above and beyond the lineage table itself — captured in Chunk 2.
- **B1 — `injected_entry_ids` persistence.** `server/services/agentExecutionService.ts:1349-1356` (anchor verified). The `injectedMemoryEntries` array is bound at line 1360 inside the prompt-composition block. The persistence mirrors the existing `appliedMemoryBlockIds` write at lines 1234-1241 (fire-and-forget `void db.update(agentRuns).set({ injectedEntryIds: <ids> }).where(eq(agentRuns.id, run.id)).catch(() => {})`). Build phase reconfirms anchor immediately before committing per handoff checklist.

### Route guards and 403-before-query rule

- **`GET /api/orgs/:orgId/memory-blocks/:blockId/sources`** — `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)`. Pattern matches `server/routes/memoryBlocks.ts:46-49`.
- **`GET /api/orgs/:orgId/usage/memory-utility`** — `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW)`. Pattern matches `server/routes/llmUsage.ts:27-30`.

**`requireOrgPermission` does NOT automatically reject path-org / session-org mismatch.** Both routes must perform the explicit 403-before-query check inside the handler:

```typescript
if (req.params.orgId !== req.orgId) {
  return res.status(403).json({ error: 'Forbidden' });
}
```

This guard runs **before** the service layer is called, so a malicious `:orgId` value never reaches the query. The Sources route reads RLS-protected `memory_block_version_sources` (RLS is defence-in-depth); the Memory Utility route reads the unprotected materialised view, so the 403 is the **canonical** cross-tenant defence on that surface.

### Banner copy (operator-approved verbatim)

Per handoff Phase 1 decisions, the B2 dashboard banner copy ships verbatim:

> *"Runs predating the entry-manifest migration are excluded from entry utility calculations. Agent table refreshes nightly; charts reflect live run data. Citation detection is heuristic, so figures are directional."*

UI must render this exact string (no em-dashes, no smart-quotes drift, no rewording — see CLAUDE.md user preferences on em-dashes). Banner is dismissable per spec §14.2.

### D env flags

- `AKR_RETRIEVAL_THRESHOLD` — numeric, **default `0.30`**. Any pre-enablement adjustment to `0.25` (per handoff Phase 3 spot-check protocol) is recorded in the implementation log + this plan; the default at merge time remains `0.30`.
- `AKR_SEMANTIC_RANKER_ENABLED` — boolean, **default `false`**. Never default to true at merge. The flag is the sole branching primitive (no per-org, per-subaccount, per-run override in v1).

Pre-enablement spot-check (10 dev-environment runs at threshold 0.30, adjust to 0.25 if >50% of recall-relevant chunks rejected) is **enablement procedure**, not a spec contract — captured in the handoff. The build does not ship the spot-check; it ships the flag plumbing.

### Reverse-lineage default-off

Per spec §6.1 + §15 Q6: `GET /api/orgs/:orgId/memory-blocks/:blockId/sources` does NOT include `reverseLineageByEntry` by default. The UI sends `?include_reverse=true` only on the per-row "Expand" affordance. Migration 0333 includes `idx_mbvs_source_entry_hash` to make the reverse query (`COUNT(*) GROUP BY source_entry_id_hash`) index-covered when requested. Default-on may be promoted in a follow-up PR after EXPLAIN confirms cost.

### D query embedding source

`text-embedding-3-small` over **the run's task description only** (per spec §6.4 and handoff Q1). Master prompt and conversation history rejected as inputs. The embed call uses the same model and path as `workspaceMemoryService` (reused primitive per spec §5.4).

## 4. Risks and mitigations

### R1 — Pre-existing typecheck errors on @react-pdf/renderer (RESOLVED)

The handoff notes that `server/services/reportRenderingService.ts` and `MacroReport.tsx` had typecheck errors caused by stale `node_modules`. The handoff's "Notes for the next session" §3 says these resolve once `npm install` completes. **Plan posture:** the executor runs `npm install` once at the start of Chunk 1 (S1 prerequisite). If typecheck still fails on those files after the install, escalate to operator — this plan does not include any work on the PDF renderer.

### R2 — `originatingRunId` field on `WorkspaceMemoryEntry` (verified at plan time, resolved positively)

The handoff acceptance checklist demands verifying that `WorkspaceMemoryEntry` exposes a stable `originatingRunId`. **Plan-time verification (grep of `server/db/schema/workspaceMemories.ts:87`):** the column is `workspace_memory_entries.agent_run_id` (`uuid REFERENCES agent_runs(id)`, **nullable** — manually-authored References can have a null agent_run_id, per the migration 0118 comment). The Drizzle field is `agentRunId`.

**Plan resolution:** Phase 1 (Chunk 2) lineage writer reads `entry.agentRunId` and populates `source_run_id` from it when non-null. When `entry.agentRunId === null` (manually-authored entries, References), the lineage row writes `source_run_id = NULL`, `source_run_id_hash = NULL`, `source_run_label_at_capture = NULL` — never inferred. The captured label (when run is available) follows the spec's "Agent name · YYYY-MM-DD HH:MM" format, sourced from a `JOIN agent_runs JOIN agents` at synthesis time.

### R3 — 16:00 UTC cron slot collision (verified clear)

**Plan-time grep of `pgboss.schedule(` across `server/`:** scheduled jobs at fixed crons today are `'0 0 * * *'` (peer medians, midnight UTC), `'*/5 * * * *'` (stale cleanup), `'* * * * *'` (workflow watchdog), plus the `paymentReconciliationJob` (`SCHEDULE_CRON` constant). **No `'0 16 * * *'` collisions found.** The build phase reconfirms by grepping `agentScheduleService.ts` for `'16'` cron values immediately before commit (handoff Phase 2 checklist item).

If a future job claims 16:00 UTC between plan and merge, shift our refresh to 17:00 UTC (still AU overnight, 03:00 AEST / 04:00 AEDT) and update the spec §4 Phase 2 + handoff Q5 in the same commit.

### R4 — Plan-time gap: synthesis service does not currently write memory_block_versions

**Plan-time finding:** `memoryBlockSynthesisService.ts:195-206` inserts only into `memoryBlocks`. It does NOT call `writeVersionRow()` from `memoryBlockVersionService.ts`. The spec's lineage table has `block_version_id uuid NOT NULL REFERENCES memory_block_versions(id) ON DELETE CASCADE` — there is no `memory_block_versions` row to FK against at synthesis today.

**Impact:** Chunk 2 is *not* a one-line lineage-write addition. It must also wire `writeVersionRow()` into the synthesis path (using `changeSource: 'auto_synthesis'` — already in the enum at `memoryBlockVersions.ts:27`) inside the same transaction as the block insert, and capture the returned `id` to use as `block_version_id` on each lineage row.

**Mitigation:** Chunk 2 includes the `writeVersionRow()` call as part of its scope. Chunk 2 size estimate revises upward by ~30 LOC. No spec contract change required — the spec already says "alongside the `memory_block_versions` insert in `memoryBlockSynthesisService.ts:195-206`" (§13.1 / §4 Phase 1), but the build phase must add that insert because it does not yet exist.

### R5 — Phase 3 (D) ships disabled — risk of incomplete shipping

The plan ships D with `AKR_SEMANTIC_RANKER_ENABLED = false`. The spec is explicit that enablement is a separate operator decision after the 10-run spot-check. **Risk:** the codebase carries the embedding-call code path and the cosine wiring without ever exercising it in production, making the latent code rot-prone.

**Mitigation:** Chunk 9's pure-function tests (vitest) exercise the cosine math, threshold filter, recall-fallback predicate, and embedding-null path end-to-end. The flag-off legacy path is preserved as the **today** behaviour (no functional change at merge). Operator-approved enablement post-merge is OUT OF SCOPE for this build but called out here so finalisation knows the build is functionally complete without flag-flip.

### R6 — agent_runs schema conflict with main's 0338/0341/0342 (verified clear)

`migrations/0338_extend_agent_runs.sql` adds `operator_chain_failure_count`. `0341_agent_runs_budget_extension.sql` adds `per_task_budget_extension_minutes`. `0342_agent_runs_assigned_user_id.sql` adds `assigned_user_id`. None of these introduce `injected_entry_ids`. Our migration 0334 (`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS injected_entry_ids jsonb`) is non-overlapping.

**Mitigation:** the build phase uses `ADD COLUMN IF NOT EXISTS` (idempotent) and the Drizzle schema change adds the field in a deterministic position (alphabetical or end-of-block per existing convention). Build phase confirms `server/db/schema/agentRuns.ts` has no `injectedEntryIds` field before adding it.

### R7 — Materialised view RLS exclusion needs registry entry

`mv_memory_utility_30d` is multi-tenant by design (the view contains rows from every org) and bypasses RLS. The spec §7.3 says either a `RLS_EXCLUDED_VIEWS` registry exists or the convention is to add to `rlsExclusions`. Grep confirms `server/db/rlsExclusions.ts` exists today and contains `optimiser_skill_peer_medians` with similar rationale. **Plan decision:** add `mv_memory_utility_30d` to `RLS_EXCLUSIONS` with rationale "*Multi-tenant aggregate; protected at route layer via path-org / session-org 403 check before any query executes (see memoryUtility.ts).*"

### R8 — Codex CLI unavailable, dual-reviewer will skip

Per handoff, Codex CLI is unavailable on this Windows host. `dual-reviewer` will auto-skip with `REVIEW_GAP` in Phase 2's branch-level review. **Mitigation:** `chatgpt-pr-review` becomes the primary second-opinion pass after `pr-reviewer`. The plan does not depend on Codex; no chunk-level change required.

### R9 — `npm install` SSL chain blockage (resolved per handoff S1)

Handoff says `npm install` was blocked on a prior session but **was resolved during S1 sync**. The plan assumes a working `npm install` at execution start. If the executor hits SSL failures, escalate before proceeding — do not retry the install loop more than twice (CLAUDE.md stuck-detection rule).

### R10 — Materialised view first refresh has no rows

After migration 0334 lands but before any `agent_runs` rows accumulate with non-null `injected_entry_ids` (i.e. the first day), the view is essentially empty. The dashboard's per-agent table renders empty; the daily-series chart renders 30 NULL buckets. **This is correct and expected.** The banner copy already discloses "runs predating the entry-manifest migration are excluded." No mitigation needed — the build phase simply spot-checks the first refresh produces aggregates consistent with raw `agent_runs` (handoff Phase 2 checklist item).

### R11 — Phase 3 fail-open behaviour must not block agent execution

D-Embedding-failure invariant (spec §3.8) requires OpenAI failures to **fail open to legacy retrieval** and emit `retrieval.embedding_failed`. The risk is wrapping the embed call in a try/catch that accidentally rethrows on a non-OpenAI error class (e.g. a logger crash inside the catch). **Mitigation:** Chunk 9 uses the existing `buildDegradedResult` pattern from `retrievalObservabilityServicePure.ts` with the **fully qualified** reason name — `buildDegradedResult('retrieval.embedding_failed')` (precedent: line 16 of `retrievalService.ts` imports `buildDegradedResult`). The reason string is canonical — same value in the `RetrievalDegradedReason` union, in the `buildDegradedResult` call, and in the emitted event/log line. The catch block emits + falls back; it never rethrows.

## 5. Chunk breakdown

11 chunks total. Forward-only dependencies. Each chunk is independently testable and reviewable.

| # | Name | Spec sections |
|---|---|---|
| 1 | A — Migration 0333 + RLS manifest entry | 3.1, 3.2, 3.3, 4 Phase 1, 5.1, 5.2, 7.1 |
| 2 | A — Lineage write at synthesis (+ memory_block_versions write) | 3.1, 3.2, 3.3, 4 Phase 1, 5.2, 13.1 |
| 3 | A — Sources route + UI tab | 4 Phase 1, 5.1, 5.2, 6.1, 7.1, 7.4, 14.1, 15 Q6 |
| 4 | B1 — Migration 0334 column + agentExecutionService write | 3.5, 3.6, 4 Phase 2, 5.1, 5.2, 6.2, 13.3 |
| 5 | B1 — Materialised view (migration 0343) + nightly refresh job at 16:00 UTC | 4 Phase 2, 5.1, 5.2, 6.3, 7.3, 8.1, 13.4 |
| 6 | B2 — Memory Utility API route | 4 Phase 4, 5.1, 5.2, 6.6, 7.3, 7.4 |
| 7 | B2 — Daily-series pure helper + tests | 4 Phase 4, 5.1, 6.6, 12.1 |
| 8 | B2 — Dashboard UI tab | 4 Phase 4, 5.1, 5.2, 14.2 |
| 9 | D — Semantic ranker behind env flag | 3.7, 3.8, 3.9, 4 Phase 3, 5.1, 5.2, 6.4, 13.5, 13.6 |
| 10 | D — Telemetry + observability wiring | 4 Phase 3, 5.2, 6.5, 13.5 |
| 11 | Doc-sync (architecture.md, KNOWLEDGE.md note) | 5.3 |

## 6. Per-chunk detail

### Chunk 1 — A: Migration 0333 + RLS manifest entry

**spec_sections:** 3.1, 3.2, 3.3, 4 Phase 1, 5.1, 5.2, 7.1

**Module shape:**
- *Public interface this chunk exposes:* one new SQL migration file (creates `memory_block_version_sources` with full RLS) + one Drizzle schema file (`memoryBlockVersionSources.ts`) re-exported from `server/db/schema/index.ts` + one new entry in `RLS_PROTECTED_TABLES`. Callers consume `memoryBlockVersionSources` as a typed Drizzle table.
- *What stays hidden:* the SQL DDL details (indexes, constraints, FORCE RLS application), the manifest array structure, and the down-migration's policy/index drop ordering. No service-layer surface yet.

**Files created:**
- `migrations/0333_memory_block_version_sources.sql`
- `migrations/0333_memory_block_version_sources.down.sql`
- `server/db/schema/memoryBlockVersionSources.ts`

**Files modified:**
- `server/db/schema/index.ts` — export the new schema file (alphabetical insertion).
- `server/config/rlsProtectedTables.ts` — append entry with `tableName: 'memory_block_version_sources'`, `schemaFile: 'memoryBlockVersionSources.ts'`, `policyMigration: '0333_memory_block_version_sources.sql'`, and a rationale describing the cross-tenant audit-leak risk being mitigated.

**Contracts (DB-level):**
- Columns exactly as spec §4 Phase 1: `id uuid PK`, `organisation_id uuid NOT NULL`, `block_version_id uuid NOT NULL REFERENCES memory_block_versions(id) ON DELETE CASCADE`, `source_entry_id uuid REFERENCES workspace_memory_entries(id) ON DELETE SET NULL`, `source_entry_id_hash text NOT NULL`, `content_hash text NOT NULL`, `source_type text NOT NULL`, `captured_at timestamptz NOT NULL DEFAULT now()`, `quality_score_at_capture numeric`, `contribution_rank integer NOT NULL`, `source_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL`, `source_run_id_hash text`, `source_run_label_at_capture text`.
- Unique constraint `(block_version_id, source_entry_id_hash)`.
- RLS: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation USING (organisation_id = current_setting('app.organisation_id', true)::uuid)`.
- Indexes: `idx_mbvs_block_version`, `idx_mbvs_source_entry`, `idx_mbvs_source_entry_hash` (the reverse-lineage index, per spec §15 Q6), `idx_mbvs_source_run`.
- Drizzle schema in `memoryBlockVersionSources.ts` mirrors the columns with `sourceType` typed as `$type<'workspace_memory'>()` (v1 only — narrows the future expansion per ChatGPT spec-review T3). Indexes are declared in the migration only (same circular-import pattern as `memoryBlocks.ts:98-100`).

**Error handling:**
- Migration failures surface in the CI deploy step; no runtime error path in this chunk.
- Down migration is the exact reverse: DROP POLICY, DROP TABLE CASCADE, no manifest-only revert needed.

**Test considerations:**
- No new unit test file in this chunk (schema files are static declarations).
- Reviewer must check: `RLS_PROTECTED_TABLES` entry, migration adds policy on the named table, FORCE RLS present, all four indexes declared, FK ON DELETE clauses correct.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` — confirms Drizzle accepts the new schema (does NOT alter the migration file; 0333 is hand-authored).

**Dependencies:** none (root chunk).

---

### Chunk 2 — A: Lineage write at synthesis + `memory_block_versions` write

**spec_sections:** 3.1, 3.2, 3.3, 4 Phase 1, 5.2, 13.1

**Module shape:**
- *Public interface this chunk exposes:* one new internal service module `memoryBlockLineageService.ts` exporting `writeLineageRowsForVersion({ tx, blockVersionId, organisationId, cluster, avgQuality })`. Plus the modified `memoryBlockSynthesisService.ts` that, at the synthesis insert site, (1) inserts the `memory_blocks` row, (2) calls `writeVersionRow()` from `memoryBlockVersionService.ts` to create the matching `memory_block_versions` row with `changeSource: 'auto_synthesis'`, (3) calls `writeLineageRowsForVersion()` to write N lineage rows.
- *What stays hidden:* hash derivation logic (SHA-256 over UUID for `source_entry_id_hash`, SHA-256 over content for `content_hash`), the deletion-safe label-capture format ("Agent name · YYYY-MM-DD HH:MM"), the JOIN to fetch agent name + run timestamp at synthesis time, `onConflictDoNothing` mechanics, and the per-entry `contribution_rank` derivation from cluster ordering.

**Files created:**
- `server/services/memoryBlockLineageService.ts` — internal writer (not exposed via route in this chunk).

**Files modified:**
- `server/services/memoryBlockSynthesisService.ts` — at lines 195-206:
  1. Wrap the existing `db.insert(memoryBlocks)` + `memoryReviewQueue` insert in a `db.transaction(...)`.
  2. After the block insert returns `created.id`, call `writeVersionRow({ blockId: created.id, content, changeSource: 'auto_synthesis', tx })`. Capture the returned `MemoryBlockVersion.id` as `blockVersionId`.
  3. Call `writeLineageRowsForVersion({ tx, blockVersionId, organisationId, cluster, avgQuality })`.

**Pre-flight verification (build phase, before Chunk 2 commit):**
- Run-provenance verification per handoff acceptance checklist: confirm `workspace_memory_entries.agent_run_id` is the stable run-provenance field on `WorkspaceMemoryEntry` (verified at plan time, line 87 of `workspaceMemories.ts`). If schema changes between plan and build, escalate.
- Confirm `memoryBlockSynthesisService.ts:195-206` has not drifted from spec anchor before committing.

**Contracts:**
- `writeLineageRowsForVersion(params)` signature: `{ tx, blockVersionId, organisationId, cluster: WorkspaceMemoryEntry[], avgQuality }` → `{ rowsWritten: number }`.
- For each `cluster[i]`:
  - `source_entry_id_hash = sha256(entry.id)` (hex digest, `crypto.createHash('sha256')...digest('hex')`).
  - `content_hash = sha256(entry.content)` (hex digest).
  - `source_type = 'workspace_memory'`.
  - `quality_score_at_capture = entry.qualityScore ?? avgQuality`.
  - `contribution_rank = i + 1` (1-indexed within cluster order).
  - When `entry.agentRunId !== null`: fetch `agent_runs.created_at` + `agents.name` via a single JOIN inside the same `tx`, format label as `"<agentName> · YYYY-MM-DD HH:MM"`, set `source_run_id`, `source_run_id_hash = sha256(agentRunId)`, `source_run_label_at_capture`. When `entry.agentRunId === null`: write `source_run_id = NULL`, `source_run_id_hash = NULL`, `source_run_label_at_capture = NULL` (do NOT infer per spec §4 Phase 1 T2 + R2).
- Insert uses `onConflictDoNothing()` keyed on the unique constraint `(block_version_id, source_entry_id_hash)`.
- Entire chunk runs inside a single transaction with the block insert — atomicity per §13.1.

**Error handling:**
- Hash derivation: pure synchronous SHA-256, no error path.
- `writeVersionRow` may return `null` for consecutive identical content (existing behaviour). If null, log warn and skip lineage write — lineage rows without a block version row are invalid.
- Database insert failures propagate (transaction rolls back, no orphan rows).
- **Agent-name JOIN — separate the two failure modes** (a query error inside an open Postgres transaction leaves the transaction aborted, so swallowing it and continuing would silently fail every subsequent insert in the same `tx`):
  - **No row found** (JOIN returns 0 rows because the run was hard-deleted or the agent row is missing): treat as expected. Write the lineage row with `source_run_id = entry.agentRunId`, `source_run_id_hash = sha256(entry.agentRunId)`, `source_run_label_at_capture = null`. Log `synthesis.run_label_unresolved` at INFO. The FK + hash carry forward; the label can be re-derived later. NO try/catch — the SELECT just returned no rows, that's not an error.
  - **Query error** (DB connection broken, syntax error, permission failure): do NOT catch. Let it propagate so the surrounding `tx` rolls back cleanly. The whole synthesis attempt fails atomically; pg-boss retries the synthesis job per its existing policy.

**Test considerations:**
- No new vitest test file in this chunk — lineage writes are DB-side and tested by the gate suite (RLS, manifest, schema) in CI.
- Reviewer must check: `onConflictDoNothing` clause present, `writeVersionRow` called with `changeSource: 'auto_synthesis'`, hashes use SHA-256 hex, `source_run_id` null when `entry.agentRunId` null, transaction wraps all three writes.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Dependencies:** Chunk 1 (schema + migration must exist).

---

### Chunk 3 — A: Sources route + UI tab

**spec_sections:** 4 Phase 1, 5.1, 5.2, 6.1, 7.1, 7.4, 14.1, 15 Q6

**Module shape:**
- *Public interface this chunk exposes:* one HTTP route `GET /api/orgs/:orgId/memory-blocks/:blockId/sources?version=<n>&include_reverse=true` returning `MemoryBlockSourcesPayload` (spec §6.1). Plus the `MemoryBlockSourcesTab` React component conditionally rendered on `MemoryBlockDetailPage` when `block.source === 'auto_synthesised'`. Plus a small read service `memoryBlockSourcesService.getSourcesForBlock(blockId, orgId, opts?)`.
- *What stays hidden:* the LEFT JOIN-based query against the lineage table + workspace memory + agent_runs, the deletion-safe fallback logic (strikethrough indicator derivation), the reverse-lineage aggregation query (only run when `include_reverse=true`), the version-selector default-to-latest logic, the payload assembler's pure helper.

**Files created:**
- `server/services/memoryBlockSourcesService.ts` — read service. Imports `getOrgScopedDb()`.
- `server/services/memoryBlockSourcesServicePure.ts` — pure payload assembler (zero DB imports).
- `server/services/__tests__/memoryBlockSourcesServicePure.test.ts` — vitest pure-function tests.
- `server/routes/memoryBlockSources.ts` — Express router.
- `client/src/pages/MemoryBlockSourcesTab.tsx` — new tab component.

**Files modified:**
- `server/routes/index.ts` — wire `memoryBlockSourcesRouter`.
- `client/src/pages/MemoryBlockDetailPage.tsx` — add `'sources'` to the local tab state union; render the Sources tab button + panel; visibility gated on `block?.source === 'auto_synthesised'`. The two existing tabs (Version History, Diff vs Canonical, at lines 123-138) remain untouched.

**Contracts:**
- Route signature: `GET /api/orgs/:orgId/memory-blocks/:blockId/sources?version=<number>&include_reverse=true`.
- Middleware: `authenticate`, `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)`, then **inline 403-before-query**: `if (req.params.orgId !== req.orgId) return res.status(403).json({ error: 'Forbidden' })`.
- Service signature: `memoryBlockSourcesService.getSourcesForBlock(blockId, organisationId, opts?: { version?: number; includeReverse?: boolean }) → Promise<MemoryBlockSourcesPayload>`.
- Pure helper signature: `assembleSourcesPayload(rows, reverseCounts?) → MemoryBlockSourcesPayload`. Zero DB imports.
- Response shape: exactly per spec §6.1. `reverseLineageByEntry` is present only when `?include_reverse=true`.
- HTTP errors:
  - `403` for path-org mismatch (before query).
  - `404` when block not found in org OR no `memory_block_versions` row for the requested version.
  - `200` with empty `sources: []` when block exists but has no lineage rows (e.g. pre-migration auto-synthesised block).

**UI specifics (matches `prototypes/memory-improvements/memory-block-detail.html`):**
- Tab is **hidden** (not greyed) when `block.source !== 'auto_synthesised'` per spec §14.1.
- Tab label "Sources" with a count badge after fetch.
- Version selector above the source list, defaulting to latest.
- Each source row renders: excerpt (truncated 120 chars), agent run link (label from payload), captured-at timestamp, quality dot.
- Soft-deleted rows: strikethrough + reduced opacity (CSS already exists per consolidation `_shared.css` precedent).
- Per-row "Used in N other blocks" expander: collapsed by default; on expand, the page re-fetches with `include_reverse=true` and renders the count from `reverseLineageByEntry`.

**Error handling:**
- Service throws `{ statusCode: 404, message: 'Block or version not found', errorCode: 'BLOCK_NOT_FOUND' }` when the version lookup fails.
- Route wraps service call in `asyncHandler`; service throws propagate as 4xx via the global error handler.
- Pure helper never throws (returns empty `sources: []` on empty input).

**Test considerations (vitest pure-function test file):**
Cases from spec §12.1:
- Source entry present (FK resolves, `isDeleted: false`).
- Source entry soft-deleted (`isDeleted: true`).
- Source entry hard-deleted (`sourceEntry: null` with captured metadata still present).
- Source run present, source run absent, both absent.
- Reverse-lineage map population (when input includes a Map of counts).
- Empty input → empty `sources: []`.

Test file uses `import { describe, test, expect } from 'vitest'`. NO `node:test`, NO supertest, NO frontend test.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client`
- `npx vitest run server/services/__tests__/memoryBlockSourcesServicePure.test.ts`

**Dependencies:** Chunks 1 + 2 (table and lineage writer must exist).

---

### Chunk 4 — B1: Migration 0334 column + `agentExecutionService` write

**spec_sections:** 3.5, 3.6, 4 Phase 2, 5.1, 5.2, 6.2, 13.3

**Module shape:**
- *Public interface this chunk exposes:* one new nullable JSONB column on `agent_runs` (`injected_entry_ids`). The Drizzle field is added as `injectedEntryIds: jsonb('injected_entry_ids').$type<string[] | null>()`. After this chunk lands, every new `agent_runs` row inserted by the agent execution path persists the injected-entry IDs via a fire-and-forget update at composition time.
- *What stays hidden:* fire-and-forget retry semantics (best-effort, mirrors `appliedMemoryBlockIds` at line 1238), the field's null-discriminator semantics (NULL = pre-migration / unwired; `[]` = measured empty; `[uuid...]` = measured with entries).

**Files created:**
- `migrations/0334_injected_entry_manifest.sql` — ALTER TABLE only. Materialised view + index + initial refresh land in a SEPARATE migration (`0343_memory_utility_30d.sql`) per Chunk 5, so this column migration can be applied independently without stranding the MV (fixes split-migration foot-gun: once a migration is applied in any environment, appending more SQL to the same file is silently skipped).
- `migrations/0334_injected_entry_manifest.down.sql`.

**Migration shape — full file:**

```sql
-- Migration 0334: agent_runs.injected_entry_ids column.
-- Materialised view + index land in 0343 (after main's 0335-0342) to keep
-- migration files single-purpose and re-runnable independently.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS injected_entry_ids jsonb;

-- NULL = pre-migration / unwired (not measured)
-- []   = measured: run had empty injection set
-- [...] = measured: run had N entries injected
-- No DEFAULT — the NULL discriminator is load-bearing per spec §3.5 / §3.6.
```

**Files modified:**
- `server/db/schema/agentRuns.ts` — add `injectedEntryIds: jsonb('injected_entry_ids').$type<string[] | null>()` (no `.notNull()` and no `.default(...)`).
- `server/services/agentExecutionService.ts` — at lines 1349-1356 (immediately after `memoryWithTracking.injectedEntries` is bound at line 1360), add the persistence call. Pattern mirrors the existing `appliedMemoryBlockIds` write at lines 1234-1241 (fire-and-forget `void db.update(agentRuns).set({ injectedEntryIds: <ids> }).where(eq(agentRuns.id, run.id)).catch(() => {})`). Inline comment cites spec §3.6 / §8.31 documenting the residual risk (transient failure → row stays NULL → MV counts as unmeasured, which is the spec-correct graceful degradation).

**Pre-flight verification (build phase, before Chunk 4 commit):**
- Confirm `agentExecutionService.ts:1349-1356` has not drifted from spec anchor.
- Confirm `server/db/schema/agentRuns.ts` has no `injectedEntryIds` field.

**Contracts:**
- Column type: JSONB, nullable, no DEFAULT.
- Allowed values: `NULL` (pre-migration / never written), `[]` (measured empty), `[string, string, ...]` (UUIDs of injected workspace_memory_entries).
- Idempotency: state-based per spec §13.3 — repeat writes for the same run produce the same value.

**Error handling:**
- Fire-and-forget `.catch(() => {})` swallows errors. **Documented residual risk per §8.31** in an inline comment at the call site — if the update silently fails, the row stays NULL and the materialised view counts it as unmeasured.
- Migration failures surface in CI deploy.

**Test considerations:**
- No new unit test in this chunk — the column write is a one-liner mirroring an existing pattern. Reviewer checks: `IF NOT EXISTS`, no DEFAULT, no `.notNull()` on Drizzle, fire-and-forget mirrors line 1238, `.catch(() => {})` present, inline comment cites §3.6 / §8.31.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Dependencies:** none structurally. Chunk 5 (the MV migration 0343) depends on this chunk's column landing first.

---

### Chunk 5 — B1: Materialised view (migration 0343) + nightly refresh job at 16:00 UTC

**spec_sections:** 4 Phase 2, 5.1, 5.2, 6.3, 7.3, 8.1, 13.4

**Module shape:**
- *Public interface this chunk exposes:* the `mv_memory_utility_30d` materialised view (Postgres surface), plus one new pg-boss job (`refresh_memory_utility_30d` queue) on a nightly cron `'0 16 * * *'` UTC. The view is queryable from any read service via `withAdminConnection()` or via the route's `getOrgScopedDb()` + WHERE filter.
- *What stays hidden:* the `WITH per_run` CTE shape, the `CASE WHEN ... measured_entries` discriminator logic, the `REFRESH MATERIALIZED VIEW CONCURRENTLY` plumbing, advisory-lock semantics inside the refresh path, pg-boss schedule registration in `agentScheduleService.ts`.

**Files created:**
- `migrations/0343_memory_utility_30d.sql` — materialised view definition + null-stable unique index + initial refresh.
- `migrations/0343_memory_utility_30d.down.sql` — `DROP MATERIALIZED VIEW IF EXISTS mv_memory_utility_30d CASCADE;`
- `server/jobs/refreshMemoryUtility30dJob.ts` — pg-boss job entry (mirrors `refreshOptimiserPeerMedians.ts`). If the refresh logic is more than `REFRESH MATERIALIZED VIEW CONCURRENTLY` inside a `withAdminConnection`, factor a service module `server/services/memoryUtilityRefreshService.ts`; otherwise inline in the job file matching the optimiser precedent.

**Files modified:**
- `server/services/agentScheduleService.ts` — register the schedule (mirrors lines 197-204 for peer-medians): worker `pgboss.work(MEMORY_UTILITY_QUEUE, { teamSize: 1, teamConcurrency: 1 }, ...)` + `pgboss.schedule(MEMORY_UTILITY_QUEUE, '0 16 * * *', null, { tz: 'UTC' })`.
- `server/db/rlsExclusions.ts` — append entry for `mv_memory_utility_30d` with rationale citing route-layer protection.

**Migration shape — `migrations/0343_memory_utility_30d.sql` (full file):**

```sql
-- Migration 0343: 30-day memory-utility materialised view + null-stable unique
-- index + initial refresh. Numbered 0343 (after main's 0335-0342 from PR #288)
-- so the file is single-purpose and applies independently from migration 0334.
-- Spec §4 Phase 2. MV is multi-tenant by design; defended at the route layer
-- in server/routes/memoryUtility.ts (path-org / session-org 403 check).

CREATE MATERIALIZED VIEW mv_memory_utility_30d AS
  WITH per_run AS (
    SELECT
      r.id AS run_id,
      r.organisation_id,
      r.subaccount_id,
      r.agent_id,
      r.created_at,
      CASE WHEN r.injected_entry_ids IS NULL THEN NULL
           ELSE jsonb_array_length(r.injected_entry_ids) END AS injected_entry_count,
      jsonb_array_length(r.cited_entry_ids) AS cited_entry_count,
      jsonb_array_length(r.applied_memory_block_ids) AS injected_block_count,
      jsonb_array_length(r.applied_memory_block_citations) AS cited_block_count,
      (r.injected_entry_ids IS NOT NULL) AS measured_entries
    FROM agent_runs r
    WHERE r.created_at > now() - interval '30 days'
  )
  SELECT
    organisation_id, subaccount_id, agent_id,
    COUNT(*) FILTER (WHERE measured_entries) AS runs_measured_entries,
    COUNT(*) FILTER (WHERE NOT measured_entries) AS runs_unmeasured_entries,
    SUM(injected_entry_count) FILTER (WHERE measured_entries) AS total_injected_entries,
    SUM(cited_entry_count) FILTER (WHERE measured_entries) AS total_cited_entries,
    SUM(injected_block_count) AS total_injected_blocks,
    SUM(cited_block_count) AS total_cited_blocks,
    CASE WHEN SUM(injected_entry_count) FILTER (WHERE measured_entries) > 0
         THEN SUM(cited_entry_count) FILTER (WHERE measured_entries)::numeric
              / SUM(injected_entry_count) FILTER (WHERE measured_entries)
         ELSE NULL END AS entry_utility_30d,
    CASE WHEN SUM(injected_block_count) > 0
         THEN SUM(cited_block_count)::numeric / SUM(injected_block_count)
         ELSE NULL END AS block_utility_30d
  FROM per_run
  GROUP BY organisation_id, subaccount_id, agent_id;

-- Null-stable unique index for REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- PostgreSQL treats NULL ≠ NULL in plain unique indexes, so two rows with
-- the same (org, agent) but NULL subaccount_id would collide on uniqueness
-- at refresh-time. COALESCE collapses NULL to a deterministic sentinel
-- (UUID nil) so every row in the MV has a unique key. The CASE expressions
-- in the SELECT mean every aggregate group is independent of NULL-handling
-- in the index.
CREATE UNIQUE INDEX idx_mv_memory_utility_30d
  ON mv_memory_utility_30d (
    organisation_id,
    COALESCE(subaccount_id, '00000000-0000-0000-0000-000000000000'::uuid),
    agent_id
  );

-- Initial population (likely 0 rows on a fresh DB; expected per spec R10).
-- Plain REFRESH (not CONCURRENTLY) on first run is required — CONCURRENTLY
-- needs at least one prior population.
REFRESH MATERIALIZED VIEW mv_memory_utility_30d;
```

**Pre-flight verification (build phase, before Chunk 5 commit):**
- Grep `agentScheduleService.ts` for `'16'` in cron strings to confirm no collision. **Plan-time verification confirms clear.**
- Confirm `mv_memory_utility_30d` does NOT collide with any existing view or table name.
- Confirm 0343 does not collide with any migration that may have landed on main between plan and build.
- **Post-migration acceptance check:** run `SELECT organisation_id, subaccount_id, agent_id, COUNT(*) FROM mv_memory_utility_30d GROUP BY 1,2,3 HAVING COUNT(*) > 1;` against the dev DB. Empty result confirms the null-stable unique index correctly enforces uniqueness even when `subaccount_id IS NULL` for some rows.
- **Post-migration acceptance check:** run `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_memory_utility_30d;` against the dev DB. Successful execution (after the initial non-CONCURRENTLY population in the migration) confirms the unique index is valid for concurrent refresh.

**Contracts:**
- Materialised view shape: exactly per spec §4 Phase 2 / §6.3.
- Refresh job: pg-boss queue `refresh_memory_utility_30d`, cron `0 16 * * *` UTC, idempotent (per §13.4), `REFRESH MATERIALIZED VIEW CONCURRENTLY` inside `withAdminConnection()`.
- Event contract (split per-attempt vs terminal, per ChatGPT plan-review R1 T5):
  - `memory_utility.refresh.completed` — emitted exactly once per successful refresh.
  - `memory_utility.refresh.attempt_failed` — emitted on each failed retry attempt (one per attempt; pg-boss may retry multiple times before exhaustion).
  - `memory_utility.refresh.failed` — emitted only on terminal exhaustion if the pg-boss API surfaces it cleanly. If pg-boss does not expose final-exhaustion state, this event is omitted and the DLQ landing acts as the exhaustion signal (the existing `dlq-not-drained` synthetic check fires on DLQ growth — precedent: peer-medians).
- Log lines emit at INFO (`completed`), WARN (`attempt_failed`), ERROR (`failed`) levels via `logger`.

**Error handling:**
- Refresh failure: caught inside the job, logged as `memory_utility.refresh.attempt_failed` with error string, rethrown so pg-boss retries per its default policy. On terminal exhaustion (if observable), emit `memory_utility.refresh.failed`; otherwise the DLQ landing is the exhaustion signal (existing `dlq-not-drained` check covers it).
- `REFRESH CONCURRENTLY` requires the unique index — present in migration 0343.

**Test considerations:**
- No new unit test in this chunk — `REFRESH MATERIALIZED VIEW` is a Postgres-side operation. Reviewer checks: migration has the null-stable unique index (COALESCE on subaccount_id), refresh job uses `withAdminConnection`, schedule registered with `tz: 'UTC'`, queue name matches between worker and `pgboss.schedule`, three-event contract present (`completed` / `attempt_failed` / `failed` or DLQ exhaustion), RLS exclusion entry appended.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Dependencies:** Chunk 4 (column must exist before view references it).

---

### Chunk 6 — B2: Memory Utility API route

**spec_sections:** 4 Phase 4, 5.1, 5.2, 6.6, 7.3, 7.4

**Module shape:**
- *Public interface this chunk exposes:* one HTTP route `GET /api/orgs/:orgId/usage/memory-utility` returning `MemoryUtilityPayload` (spec §6.6) — both `agents[]` (per-agent aggregate from MV) and `dailySeries[]` (30 daily UTC buckets, computed on-demand from raw `agent_runs`) in a single response. Plus the org-scoped query service `memoryUtilityQueryService.getMemoryUtilityForOrg(orgId)`.
- *What stays hidden:* the SQL against `mv_memory_utility_30d` (filtered by org), the on-demand daily-series query against raw `agent_runs` (delegates SQL row-fetch to the service but calls the pure helper from Chunk 7 to bucket/aggregate), the path-org/session-org defence-in-depth check.

**Files created:**
- `server/routes/memoryUtility.ts` — Express router with one handler.
- `server/services/memoryUtilityQueryService.ts` — read service.
- `server/db/schema/mvMemoryUtility30d.ts` — Drizzle materialised-view declaration (using `pgMaterializedView(...).existing()`).

**Files modified:**
- `server/routes/index.ts` — wire `memoryUtilityRouter`.
- `server/db/schema/index.ts` — re-export the MV declaration.

**Contracts:**
- Route signature: `GET /api/orgs/:orgId/usage/memory-utility`.
- Middleware: `authenticate`, `requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW)`, then **inline 403-before-query** path-org / session-org check.
- Service signature: `memoryUtilityQueryService.getMemoryUtilityForOrg(organisationId: string) → Promise<MemoryUtilityPayload>`.
- Internal split:
  - `agents[]` is fetched via `db.select().from(mvMemoryUtility30d).where(eq(mvMemoryUtility30d.organisationId, orgId))`.
  - `dailySeries[]` is computed by (a) fetching raw `agent_runs` rows for the last 30 days filtered by `eq(agentRuns.organisationId, orgId)` AND `gt(agentRuns.createdAt, sql\`now() - interval '30 days'\`)`, (b) passing them to the pure helper `bucketDailySeries()` from Chunk 7.
- Response: exactly per spec §6.6 `MemoryUtilityPayload`.
- HTTP errors:
  - `403` for path-org mismatch (before query).
  - `200` with empty `agents: []` and `dailySeries: [<30 NULL buckets>]` when the org has no rows — never `404`.

**Drizzle view declaration (new file `server/db/schema/mvMemoryUtility30d.ts`):**

```typescript
import { pgMaterializedView, uuid, integer, numeric } from 'drizzle-orm/pg-core';

export const mvMemoryUtility30d = pgMaterializedView('mv_memory_utility_30d', {
  organisationId: uuid('organisation_id').notNull(),
  subaccountId: uuid('subaccount_id'),
  agentId: uuid('agent_id').notNull(),
  runsMeasuredEntries: integer('runs_measured_entries').notNull(),
  runsUnmeasuredEntries: integer('runs_unmeasured_entries').notNull(),
  totalInjectedEntries: integer('total_injected_entries'),
  totalCitedEntries: integer('total_cited_entries'),
  totalInjectedBlocks: integer('total_injected_blocks'),
  totalCitedBlocks: integer('total_cited_blocks'),
  entryUtility30d: numeric('entry_utility_30d'),
  blockUtility30d: numeric('block_utility_30d'),
}).existing();
```

**Error handling:**
- Service throws `{ statusCode: 500, message: 'Memory utility read failed', errorCode: 'MEM_UTILITY_READ_FAILED' }` on DB error; route propagates via `asyncHandler`.
- Path-org 403 returns immediately (no service call, no DB query).

**Test considerations:**
- No unit test in this chunk for the route itself (testing posture forbids supertest / API contract tests). Chunk 7's pure helper carries the test coverage for the daily-series math.
- Reviewer checks: 403 mismatch path executes before the service call, response shape matches `MemoryUtilityPayload` (both `agents` and `dailySeries` keys present), `dailySeries` is exactly 30 entries (gap-filled by the pure helper).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Dependencies:** Chunks 4 + 5 (column + view), Chunk 7 (pure helper).

---

### Chunk 7 — B2: Daily-series pure helper + tests

**spec_sections:** 4 Phase 4, 5.1, 6.6, 12.1

**Module shape:**
- *Public interface this chunk exposes:* one pure function `bucketDailySeries(rows, now)` that takes raw run rows (id, createdAt, injectedEntryIds, citedEntryIds, appliedMemoryBlockIds, appliedMemoryBlockCitations) and a "now" timestamp, returns exactly 30 daily bucket objects matching the `dailySeries[]` shape of `MemoryUtilityPayload`. Pure function — no DB, no network, no `Date.now()`.
- *What stays hidden:* the UTC midnight bucket boundary derivation (`date_trunc('day', createdAt AT TIME ZONE 'UTC')` reimplemented in JS), gap-filling for buckets with no rows, NULL-vs-zero ratio handling at the bucket level, entry-side measured/unmeasured partition logic.

**Files created:**
- `server/services/memoryUtilityDailySeriesPure.ts`.
- `server/services/__tests__/memoryUtilityDailySeriesPure.test.ts` — vitest pure-function tests.

**Contracts:**

```typescript
export type RunForBucketing = {
  id: string;
  createdAt: Date;                          // UTC
  injectedEntryIds: string[] | null;        // null = unmeasured
  citedEntryIds: string[];                  // NOT NULL DEFAULT [] per spec §3.5
  appliedMemoryBlockIds: string[];          // NOT NULL DEFAULT []
  appliedMemoryBlockCitations: unknown[];   // NOT NULL DEFAULT [] — length is the cited-block count
};

export type DailyBucket = {
  bucketDate: string;          // 'YYYY-MM-DD' UTC
  runsMeasuredEntries: number;
  entryUtility: number | null;
  blockUtility: number | null;
};

export function bucketDailySeries(
  rows: RunForBucketing[],
  now: Date                    // injected for testability — caller passes new Date()
): DailyBucket[];               // always exactly 30 entries, ordered oldest → newest
```

**Behaviour:**
- Bucket key: `createdAt` floored to UTC midnight, formatted `YYYY-MM-DD`.
- 30-bucket gap-fill: produce exactly 30 buckets, one per UTC day from `floor(now) - 29 days` through `floor(now)`, inclusive (29 day-offsets + today = 30 buckets total). Missing days appear with `runsMeasuredEntries: 0`, `entryUtility: null`, `blockUtility: null`.
- Per bucket:
  - `runsMeasuredEntries` = count of rows in bucket where `injectedEntryIds !== null`.
  - `entryUtility` = if `runsMeasuredEntries === 0` → `null`. Else `sum(citedEntryIds.length over measured rows) / sum(injectedEntryIds.length over measured rows)` (also null if sum-of-injected is 0).
  - `blockUtility` = if `sum(appliedMemoryBlockIds.length over ALL rows in bucket) === 0` → `null`. Else `sum(appliedMemoryBlockCitations.length) / sum(appliedMemoryBlockIds.length)` over all rows (no measured-discriminator on blocks per spec §3.5).
- Determinism: sorting by bucket date ascending — same input always yields same output.

**Test cases (per spec §12.1 + R2-T2):**
1. **UTC bucket boundary at midnight.** Run at `23:59:59.999Z` on day N falls in day N's bucket; run at `00:00:00.000Z` on day N+1 falls in day N+1's bucket.
2. **Zero-measured-run bucket** returns `runsMeasuredEntries: 0`, `entryUtility: null` (gap rendering in chart).
3. **Mixed measured/unmeasured bucket.** Bucket has 3 rows: one with `injectedEntryIds: null`, one with `[]`, one with `["a"]` and `citedEntryIds: ["a"]`. `runsMeasuredEntries: 2`, `entryUtility: 1/1 = 1.0`.
4. **Block-side denominator-zero.** Bucket where every row has `appliedMemoryBlockIds: []` returns `blockUtility: null`.
5. **30-bucket gap-fill shape.** Input rows touch only 2 of the last 30 days; output has exactly 30 entries; the 28 untouched days each carry `runsMeasuredEntries: 0`, `entryUtility: null`, `blockUtility: null`.
6. **Denominator-zero protection within measured runs.** Bucket with measured runs all having empty `injectedEntryIds: []` → `runsMeasuredEntries > 0` but `sum(injected) === 0` → `entryUtility: null`.
7. **Determinism under input reordering** (per §8.21): three random shuffles of the same input row set yield identical output.

Test file uses `import { describe, test, expect } from 'vitest'`. Filename ends `Pure.test.ts` per DEVELOPMENT_GUIDELINES §7 — zero DB imports allowed.

**Error handling:**
- Pure function: throws only on invalid arguments (e.g. `now` not a Date). Caller is the route service which guarantees shape.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/__tests__/memoryUtilityDailySeriesPure.test.ts`

**Dependencies:** none (pure helper).

---

### Chunk 8 — B2: Dashboard UI tab

**spec_sections:** 4 Phase 4, 5.1, 5.2, 14.2

**Module shape:**
- *Public interface this chunk exposes:* a new tab `Memory Utility` on `UsagePage.tsx`, rendered as a React component `MemoryUtilityTab.tsx`. Fetches `/api/orgs/:orgId/usage/memory-utility` on mount and renders two canvas-drawn line charts + a per-agent breakdown table + a dismissable banner.
- *What stays hidden:* the canvas-drawing helpers (reused from `prototypes/auto-knowledge-retrieval/agent-data-sources.html` pattern per spec §4 Phase 4), per-row utility bar rendering, the `<10 runs` suppression filter on the agent table, the banner dismissal local-storage key.

**Files created:**
- `client/src/pages/MemoryUtilityTab.tsx`.

**Files modified:**
- `client/src/pages/UsagePage.tsx` — add `'memory_utility'` (or matching slug) to the `Tab` union (line ~218) and the `TabBar` tabs array (lines 219-225); render the tab panel below the existing tabs.

**Contracts (UI-side):**
- React component reads `useParams<{ orgId: string }>()` (or however the page already accesses the org context) and fetches `/api/orgs/${orgId}/usage/memory-utility`.
- Renders three sub-components, top to bottom:
  1. **Banner** — dismissable, operator-approved copy:
     > *"Runs predating the entry-manifest migration are excluded from entry utility calculations. Agent table refreshes nightly; charts reflect live run data. Citation detection is heuristic, so figures are directional."*
     - Dismissal state stored in `localStorage` under a stable key (e.g. `mem_utility_banner_v1`).
     - Banner must use plain commas / colons; no em-dashes (per CLAUDE.md User Preferences).
  2. **Two canvas line charts** — entry utility (30-day, `dailySeries[].entryUtility`) and block utility (30-day, `dailySeries[].blockUtility`). NULL values render as gaps (chart breaks the line), not as zero. Canvas pattern reused from `prototypes/auto-knowledge-retrieval/agent-data-sources.html`.
  3. **Per-agent breakdown table** — from `agents[]`. One row per agent, sorted by `entryUtility30d` desc (NULL last). Columns: agent name, runs measured, runs unmeasured, entry utility %, block utility %, inline utility bar. Rows where `runsMeasuredEntries + runsUnmeasuredEntries < 10` show "Insufficient data" instead of the percentages (the `<10 runs` suppression per spec §4 Phase 4).

**Loading / empty / error states:**
- Loading: skeleton block for chart area + table.
- Empty (agents.length === 0 AND dailySeries are all NULL): "No memory-utility data yet. Once agents run with memory injected, metrics will appear here."
- Fetch error: inline error card with retry button.

**Error handling:**
- Fetch failure surfaces as the error state; no toast (matches existing UsagePage pattern).

**Test considerations:**
- No frontend unit tests per testing posture. Reviewer checks: banner copy exact, charts render with the canvas pattern, table sort, `<10 runs` suppression, dismissal persists.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Dependencies:** Chunk 6 (route must exist).

---

### Chunk 9 — D: Semantic ranker behind env flag

**spec_sections:** 3.7, 3.8, 3.9, 4 Phase 3, 5.1, 5.2, 6.4, 13.5, 13.6

**Module shape:**
- *Public interface this chunk exposes:* `assembleKnowledgeForRun(runId)` signature unchanged. New env vars `AKR_SEMANTIC_RANKER_ENABLED` (boolean, default false) and `AKR_RETRIEVAL_THRESHOLD` (numeric, default 0.30) read at module-init. The new pure helper `retrievalQueryEmbedderPure.ts` exports `cosineSimilarity(a, b)`, `scoreCandidates({ candidates, queryEmbedding, threshold })`, and `recallFallbackPredicate({ filteredCount, originalCount })`.
- *What stays hidden:* the OpenAI embedding call (reuses the existing workspaceMemoryService embedding path — see spec §5.4 "Query embedding | Reused"), the try/catch wrapper that emits `retrieval.embedding_failed` on terminal failure, the per-category fallback path that emits `retrieval.empty_after_semantic` only when the filter empties a non-empty category, the flag-aware env resolver.

**Files created:**
- `server/services/retrievalQueryEmbedderPure.ts` — pure helper.
- `server/services/__tests__/retrievalQueryEmbedderPure.test.ts` — vitest pure-function tests.

**Files modified:**
- `server/services/retrievalService.ts`:
  - Replace the `V1_RETRIEVAL_THRESHOLD = 0` constant (line 21) with an env-aware resolver pattern.
  - In `assembleKnowledgeForRun`, after `run` is loaded (after line 60), branch on `AKR_SEMANTIC_RANKER_ENABLED`:
    - If true: load run's task description (need to add a `taskDescription` field to the run query at line 36-45 if not present — verify in build), embed via `workspaceMemoryService`'s embed primitive (or its underlying `embeddingService`), wrap in try/catch.
    - If false OR embedding fails: legacy path (threshold 0, no query embedding, finalScore 0 — current behaviour).
  - Replace `finalScore: 0` at line 197 (document chunks) with `scoreCandidates(...)`-derived score when query embedding is available, otherwise leave as 0.
  - Replace `finalScore: 0` at line 276 (memory blocks) with the same pattern.
  - Per-category recall fallback (chunks, blocks): when `recallFallbackPredicate({filteredCount, originalCount})` returns true, emit `retrieval.empty_after_semantic` with `category: 'chunks'` or `'blocks'`, fall back to that category's legacy ordering, continue.

**Pre-flight verification (build phase, before Chunk 9 commit):**
- Confirm `agent_runs.task_description` (or similarly-named field) exists today; if not, source the task description from the task associated with the run (existing pattern elsewhere — see `taskContextForMemory` build at `agentExecutionService.ts:1346-1348`).
- Confirm `workspaceMemoryService` exposes a reusable embed primitive, or that `embeddingService` is callable from `retrievalService` directly. If not, factor a minimal `embedQuery(text)` helper.
- Decide whether to refactor the existing 1-pass loop into a 2-pass loop (build candidate set → score → filter → fallback) or to score inline. Inline is simpler; 2-pass mirrors the fallback predicate semantics more cleanly. Build phase picks one and documents the choice in the PR.

**Contracts:**

```typescript
function getRetrievalConfig(): { semanticEnabled: boolean; threshold: number } {
  const rawThreshold = process.env.AKR_RETRIEVAL_THRESHOLD ?? '0.30';
  const parsed = Number(rawThreshold);
  // NaN / out-of-range protection: fall back to 0.30 and log a warning.
  // Cosine similarity is in [-1, 1], but our threshold semantics require
  // [0, 1] (negative correlations should always be rejected). An out-of-range
  // env value silently filtering everything (NaN comparison) or filtering
  // nothing (>1) would be undetectable in production — fail loud at boot.
  const threshold = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : 0.30;
  if (threshold !== parsed) {
    logger.warn({
      event: 'retrieval.threshold.env_invalid',
      rawThreshold,
      parsed,
      fallback: 0.30,
    }, 'AKR_RETRIEVAL_THRESHOLD invalid; falling back to 0.30');
  }
  return {
    semanticEnabled: process.env.AKR_SEMANTIC_RANKER_ENABLED === 'true',
    threshold,
  };
}

// Pure helpers (zero DB imports):

// Cosine over two equal-length vectors. Throws on length mismatch.
export function cosineSimilarity(a: number[], b: number[]): number;

// Returns candidates with finalScore set, filtered to threshold.
export function scoreCandidates<T extends { embedding: number[] }>(opts: {
  candidates: T[];
  queryEmbedding: number[];
  threshold: number;
}): Array<T & { finalScore: number }>;

// Returns true when filtering reduced a non-empty pool to zero.
export function recallFallbackPredicate(opts: {
  filteredCount: number;
  originalCount: number;
}): boolean;
```

**Behaviour:**
- When `semanticEnabled` is false OR `queryEmbedding === null`: legacy path — `finalScore = 0`, threshold = 0, scope-tier + recency ordering. No new emissions.
- When `semanticEnabled` is true and embedding fails: emit `retrieval.embedding_failed` once per run, fall back to legacy.
- When `semanticEnabled` is true and embedding succeeds: score each candidate, filter by threshold. Per category (chunks, blocks): if filter emptied a non-empty pool, emit `retrieval.empty_after_semantic` with the category and fall back to legacy ordering FOR THAT CATEGORY ONLY (the other category may keep its filtered set per §13.5 no-silent-partial-success rule).

**Error handling:**
- Embedding call wrapped in try/catch. Caught error → emit + fall back. Never rethrow.
- Catch is scoped to the embedding fetch only — not the whole `assembleKnowledgeForRun` (the existing `buildDegradedResult('pool_query_failed')` paths cover other failures).
- Length mismatch in `cosineSimilarity` (e.g. dim 1536 vs dim 0 because a chunk had no embedding): treat as a candidate-level skip (don't score it; default `finalScore = 0`; do not emit a degraded reason since other candidates may still score).

**Test cases (per spec §12.1):**
- Cosine math against fixed test vectors (orthogonal → 0, identical → 1.0, anti-parallel → -1.0).
- Threshold filter at boundary values (exact match at threshold passes, just below fails, just above passes).
- Empty-after-semantic predicate: `{filteredCount: 0, originalCount: 5}` → true; `{filteredCount: 0, originalCount: 0}` → false; `{filteredCount: 2, originalCount: 5}` → false.
- Embedding-null fallback: confirmed by the recall-fallback predicate handling category-level zero state.
- Mixed-category fallback: chunks filtered to zero AND blocks keep non-empty → only chunks emit `retrieval.empty_after_semantic`. (Observability-side assertion exercised in Chunk 10's wiring; the pure helper here only owns the predicate.)
- Determinism: shuffled input candidate order produces identical (per-key) scored output (§8.21).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/retrievalQueryEmbedderPure.test.ts`

**Dependencies:** Chunks 4 + 5 (B1 substrate, operationally — D's flag should not flip without B1, but no code import dependency).

---

### Chunk 10 — D: Telemetry + observability wiring

**spec_sections:** 4 Phase 3, 5.2, 6.5, 13.5

**Module shape:**
- *Public interface this chunk exposes:* two new values added to the `RetrievalDegradedReason` string-literal union exported from `retrievalObservabilityServicePure.ts` (`'retrieval.embedding_failed'`, `'retrieval.empty_after_semantic'`), plus the matching emission helpers in `retrievalObservabilityService.ts` (existing module — extends the dispatch).
- *What stays hidden:* the exact emit-once-per-run-per-category bookkeeping, the run-trace surfacing logic (already exists in the observability service), the log-line schema.

**Files modified:**
- `server/services/retrievalObservabilityServicePure.ts` — extend `RetrievalDegradedReason` union to include `'retrieval.embedding_failed'` and `'retrieval.empty_after_semantic'`. Final list confirmed against current values during build.
- `server/services/retrievalObservabilityService.ts` — add the two new emission sites if the existing dispatch needs a switch case for new reasons. If the service is reason-agnostic (just stamps the run trace), this file may need no change beyond a type re-export.
- `server/services/retrievalService.ts` — the actual emission calls live here (Chunk 9 plumbs the call sites; this chunk verifies the events thread through observability correctly).

**Contracts:**
- `retrieval.embedding_failed` — emitted at most once per run when the OpenAI embed call throws or times out. No `category` field.
- `retrieval.empty_after_semantic` — emitted at most once per affected category per run. Carries `category: 'chunks' | 'blocks'`.
- Embedding failure precludes any `retrieval.empty_after_semantic` event for the same run (no scoring happens) — enforced at the call site in `retrievalService` per spec §13.5.

**Error handling:**
- Emission failures are swallowed (logger emits, caller continues).

**Test considerations:**
- Covered by Chunk 9's pure tests (the predicate test). No separate test file in this chunk — the wiring is type-level + dispatch.
- Reviewer checks: union literally extended; existing degraded-reason consumers (e.g. UI run-trace surfaces) tolerate the new values without crashing.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Dependencies:** Chunk 9.

---

### Chunk 11 — Doc-sync

**spec_sections:** 5.3

**Module shape:**
- *Public interface this chunk exposes:* documentation deltas only. No runtime code change.

**Files modified:**
- `architecture.md`:
  - § *Source provenance / Document Retrieval Pipeline*: note the lineage join table (`memory_block_version_sources`), the deletion-safe pattern (hash + label fallbacks), and the producer-level idempotency contract (per committed block version).
  - § *Key files per domain*: add the memory-block-sources route + service + tab; add the memory-utility route + tab + query service.
  - § *Document Retrieval Pipeline → Always-available telemetry*: note the utility metric substrate (`injected_entry_ids` column + `mv_memory_utility_30d`) and the measured-vs-unmeasured discriminator.
  - § *Document Retrieval Pipeline → Modes*: note D's env flag (`AKR_SEMANTIC_RANKER_ENABLED` / `AKR_RETRIEVAL_THRESHOLD`), the task-description query source, and the recall + embedding-failure fallback paths.
- `KNOWLEDGE.md` — append a new entry summarising:
  - The recall-fallback + embedding-failure pattern (algorithm safety properties decoupled from the env flag).
  - The lineage-row idempotency contract (per committed block version, NOT per synthesis run).
  - The path-org / session-org 403-before-query rule for routes that read MV-backed surfaces.
  - Note that synthesis must always write a `memory_block_versions` row when inserting a `memoryBlocks` row from auto-synthesis — previously this was implicit.
- `docs/capabilities.md` (when applicable per spec §5.3): add operator-facing utility-metric capability under Observability — vendor-neutral, marketing-ready, model-agnostic per editorial rules. Build phase audits whether the capability is currently catalogued; if not, defer with a clear note.

**Contracts:**
- All edits are append-only to existing sections — no deletions or restructuring.
- Banner copy in `docs/capabilities.md` (if a customer-facing description is added) must not include em-dashes per CLAUDE.md.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

**Dependencies:** All previous chunks (doc edits land last so they describe what shipped, not what's planned).

## 7. UX considerations

### Sources tab (Phase A / Chunk 3)

Per `prototypes/memory-improvements/memory-block-detail.html` and spec §14.1:

- **What the operator sees:** clicking the "Sources" tab on a memory block that was auto-synthesised reveals the workspace memory entries that produced it. Each row shows an excerpt (~120 chars), the agent + date label of the run that captured it, a captured-at timestamp, and a quality-score indicator.
- **What they do:** scan the lineage to verify the synthesis is grounded; click the agent-run label to navigate to the run's live page (existing navigation, no new route). Optionally expand the "Used in N other blocks" per-row affordance for bidirectional lineage.
- **Hidden states:**
  - Tab is hidden (not greyed) when `block.source !== 'auto_synthesised'`.
  - Soft-deleted source entries render with strikethrough + reduced opacity (CSS already exists per consolidation `_shared.css`).
  - Hard-deleted source entries render with "(source removed)" placeholder text + captured timestamp.
- **Loading / empty / error:**
  - Loading: skeleton list (3 placeholder rows).
  - Empty (no lineage rows — e.g. pre-migration auto block): "No lineage data available. This block was synthesised before lineage tracking was enabled."
  - Error: inline retry banner.
- **Permission gating:** `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` — the same gate that already controls memory-block visibility.
- **No real-time updates required** — lineage is append-only at synthesis time; no WebSocket subscription.

### Memory Utility tab (Phase B2 / Chunk 8)

Per `prototypes/memory-improvements/citation-utility-dashboard.html` and spec §14.2:

- **What the operator sees:** at the top, the operator-approved banner (dismissable). Below, two line charts (entry utility 30-day, block utility 30-day) — both with gaps where data is unavailable. Below that, the per-agent breakdown table sorted by entry utility descending.
- **What they do:** read the trend line for memory-injection effectiveness over the last 30 days. Drill into the per-agent table to identify which agents have low utility. After D enablement (post-merge operator action), watch the trend lines for shifts.
- **Hidden states:**
  - `<10 runs` agents show "Insufficient data" instead of percentages.
  - NULL utility values (no measured runs in a bucket, or denominator zero) render as line-chart gaps, never as zeros.
  - The MV-vs-live drift between table (nightly refresh) and charts (live) is disclosed in the banner.
- **Loading / empty / error:**
  - Loading: skeleton block.
  - Empty (no data): "No memory-utility data yet. Once agents run with memory injected, metrics will appear here."
  - Error: inline retry banner.
- **Permission gating:** `requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW)` — same gate as the existing usage routes.
- **No real-time updates required** — daily series is live but refreshes on tab focus is sufficient.

### No UI for Phase 3 (D)

Per spec §14.3. D is a backend-only algorithm change. No subaccount-admin settings page, no shadow-comparison panel. Operators see D's effect only via Phase B2's dashboard once enabled.

## 8. Test inventory

Three new vitest pure-function test files. Filenames end `*Pure.test.ts` per DEVELOPMENT_GUIDELINES §7; zero transitive DB imports allowed.

| File | Chunk | Test cases (high level) |
|---|---|---|
| `server/services/__tests__/memoryBlockSourcesServicePure.test.ts` | 3 | Source-entry present / soft-deleted / hard-deleted; source-run present / absent / both absent; reverse-lineage map population; empty input. |
| `server/services/__tests__/memoryUtilityDailySeriesPure.test.ts` | 7 | UTC bucket boundaries at midnight; zero-measured-run bucket returns null; mixed measured/unmeasured partition; block-side denominator-zero; 30-bucket gap-fill shape; denominator-zero protection within measured runs; determinism under input reordering. |
| `server/services/__tests__/retrievalQueryEmbedderPure.test.ts` | 9 | Cosine math (orthogonal, identical, anti-parallel); threshold filter boundary values; empty-after-semantic predicate (non-empty pool → empty filtered set); embedding-null path; mixed-category fallback; determinism. |

Confirmed posture (per `references/test-gate-policy.md` and `docs/testing-conventions.md`):
- All tests use `import { describe, test, expect } from 'vitest'`. No `node:test`, no `node:assert`, no `tsx`-runnable harnesses.
- No supertest, no API contract tests, no playwright, no frontend unit tests.
- No migration safety tests (`migration_safety_tests: defer_until_live_data_exists`).

## 9. Build-phase acceptance checklist

Copied verbatim from [`handoff.md` § Build-phase acceptance checklist](./handoff.md). These are spec-derived acceptance criteria the build phase satisfies alongside the per-chunk gates.

### Phase 1 (A — Synthesis lineage)

- [ ] Verify `WorkspaceMemoryEntry` exposes a stable `originatingRunId` field (or equivalent). If yes, populate `source_run_id` + `source_run_id_hash` + `source_run_label_at_capture`. If no, write NULL provenance — do NOT infer from synthesis-job context. *(Resolved at plan time: `workspace_memory_entries.agent_run_id` is the stable field. See R2.)*
- [ ] Confirm `memoryBlockSynthesisService.ts:195-206` has not drifted from spec anchor before committing the write-site change.
- [ ] Migration 0333 includes `idx_mbvs_source_entry_hash` for reverse-lineage index coverage.
- [ ] `memory_block_version_sources` is added to `server/config/rlsProtectedTables.ts` in the same commit as migration 0333.
- [ ] Verify `verify-rls-coverage.sh` passes after the migration lands. *(CI-gate; observed in CI, not run locally.)*

### Phase 2 (B1 — Measurement substrate)

- [ ] Confirm `agentExecutionService.ts:1349-1356` has not drifted from spec anchor before committing the write-site change.
- [ ] Migration 0334 adds `injected_entry_ids jsonb` (nullable, no DEFAULT) to `agent_runs`. Single-purpose file — no MV appended.
- [ ] Migration 0343 creates `mv_memory_utility_30d` + null-stable unique index + initial (non-CONCURRENTLY) refresh. Numbered after main's 0335-0342 from PR #288.
- [ ] **MV uniqueness acceptance check** (per ChatGPT plan-review R1 F2): `SELECT organisation_id, subaccount_id, agent_id, COUNT(*) FROM mv_memory_utility_30d GROUP BY 1,2,3 HAVING COUNT(*) > 1;` returns 0 rows.
- [ ] **REFRESH CONCURRENTLY check** (per ChatGPT plan-review R1 F2): run `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_memory_utility_30d;` against dev DB after migration 0343. Must succeed (the null-stable unique index satisfies CONCURRENTLY's uniqueness requirement).
- [ ] Confirm no other job at 16:00 UTC collides with the materialised-view refresh — grep `server/jobs/index.ts` for `0 16 * * *` and equivalent cron strings. *(Plan-time grep confirms clear; build phase reconfirms before commit.)*
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
- [ ] If S2 sync at finalisation surfaces a migration-number collision on 0333, 0334, or 0343, follow the existing renumber playbook (recent precedent: pre-test-hardening 0313-0315 → 0318-0320; trust-verification-layer 0288-0297 → 0295-0304).

## 10. Open questions / assumptions for operator review

### Resolved before plan-gate

- **Q1 — `writeVersionRow` at auto-synthesis: APPROVED** (operator, 2026-05-13). Chunk 2 wires `writeVersionRow({ changeSource: 'auto_synthesis' })` inside the same transaction as the `memoryBlocks` insert so the lineage FK has a target. Spec §13.1 already implies this ("alongside the `memory_block_versions` insert"); the build phase makes it real.
- **Q2 — Sources route path: APPROVED as `/api/orgs/:orgId/memory-blocks/:blockId/sources`** (operator, 2026-05-13). Plan intentionally uses the org-scoped path instead of the spec-literal `/api/memory-blocks/:id/sources` so the path-org / session-org 403-before-query rule has an explicit param to compare against, identical pattern to `/api/orgs/:orgId/usage/memory-utility`. Spec deviation documented here.

### Assumptions (build-phase confirms)

- **`buildDegradedResult` reuse.** Spec §3.8 / §13.5 says the D-Embedding-failure path emits `retrieval.embedding_failed` (canonical fully-qualified form per ChatGPT plan-review R1 T2 — see §4 R11 and Chunk 9 contracts). The existing `buildDegradedResult` helper in `retrievalObservabilityServicePure.ts` takes a `RetrievalDegradedReason` argument. Chunk 10 extends the union with the two new values. **Assumption:** `buildDegradedResult` (or its existing equivalent) is the right vehicle to emit these reasons — no new helper required. Build phase confirms by reading the helper signature before Chunk 9 commits.
- **Capability registry update in Chunk 11.** `docs/capabilities.md` editorial rules require vendor-neutral, model-agnostic phrasing. The operator-facing utility-metric description must avoid "OpenAI", "embedding", and "cosine" in customer-visible copy. **Plan provisionally defers** the capability entry to a follow-up if the build phase can't draft compliant copy in scope. The spec §5.3 lists it as conditional ("if it's currently catalogued").

No spec open questions remain — Q1-Q7 were all resolved in Phase 1 per handoff. No plan open questions remain post-ChatGPT R1.

## 11. Self-consistency pass

- **Goals match implementation.** Each of the three goals in spec §1.1 (A lineage, B utility, D ranker) maps to chunks 1-3, 4-8, and 9-10 respectively.
- **Single-source-of-truth claims hold.** `memory_block_version_sources` rows are canonical for lineage (Chunk 1 schema + Chunk 2 writes); `agent_runs.injected_entry_ids` is canonical for injection (Chunk 4 writes); `mv_memory_utility_30d` is canonical for the dashboard table (Chunk 5 creates, Chunk 6 reads). Daily series reads raw `agent_runs` live (Chunk 7 helper) per spec §6.6.
- **No phase contradicts another.** A and B are independent; B1 substrate (Chunks 4-5) lands before D (Chunk 9) per the operational dependency in spec §9. B2 (Chunks 6-8) depends mechanically on B1's MV.
- **Load-bearing "must" claims have named mechanisms.** D-Recall → `recallFallbackPredicate` in Chunk 9; D-Embedding-failure → try/catch wrap in Chunk 9; A-Deletion + A-Run-provenance → captured columns in Chunk 1 schema; B1 NULL discriminator → no DEFAULT on Chunk 4's ALTER + CASE WHEN in Chunk 5's MV.
- **Banner copy is exact.** Chunk 8 stores the operator-approved string verbatim, no em-dashes.
- **Test scope matches posture.** Three pure-function tests, vitest only, no supertest / playwright / frontend tests. Matches `references/test-gate-policy.md`.
- **Migration discipline.** 0333 (lineage table), 0334 (`injected_entry_ids` column), and 0343 (MV + null-stable unique index) are the three free numbers used. Each has a `.down.sql` sibling. 0333 ships full RLS policy; 0343's MV ships an RLS-exclusion registry entry with route-layer protection rationale. All three migrations are single-purpose and re-runnable independently (per ChatGPT plan-review R1 F1, the MV is in its own file rather than appended to 0334).
- **Surgical changes.** No drive-by cleanup. The plan-time finding (R4 — missing `memory_block_versions` write) is in scope because it's load-bearing for the lineage FK; it is not a drive-by.

No internal contradictions identified.

## 12. Plan footer

When execution starts: switch to Sonnet, invoke `superpowers:executing-plans` or `subagent-driven-development` against this plan. Mark each chunk's TodoWrite item `in_progress` immediately before starting it and `completed` immediately after the chunk's verification commands pass.
