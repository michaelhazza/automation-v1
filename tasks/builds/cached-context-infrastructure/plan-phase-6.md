# Phase 6 — Pilot validation

**Spec anchors:** §10 Phase 6 · §16 success criteria · §13.12 documentation updates
**Migrations:** none
**Pre-condition:** Phases 1–5 merged. Orchestrator + ledger attribution working end-to-end. `bundleUtilizationJob` registered but schedule not enabled yet.

## Purpose

Configure the daily-macro-report scheduled task to use `cachedContextOrchestrator`. Upload the five reference documents. Attach to the schedule. Run for 7 days. Monitor via admin observability queries. Sync `architecture.md` + `docs/capabilities.md`. Enable the `bundleUtilizationJob` schedule so utilization rollups start populating.

Exit state: seven consecutive days of clean daily-macro-report runs. `llm_requests` rows show expected cache behaviour. `actions` row created on deliberate breach test. `architecture.md` + `docs/capabilities.md` updated in the phase's PR commit.

## Chunked deliverables

- Chunk 6.1 — Pilot task configuration
- Chunk 6.2 — Upload pilot bundle + attach
- Chunk 6.3 — Enable `bundleUtilizationJob` schedule
- Chunk 6.4 — Admin observability queries
- Chunk 6.5 — 7-day pilot run
- Chunk 6.6 — Documentation sync
- Chunk 6.7 — Deliberate budget-breach smoke

### Chunk 6.1 — Pilot task configuration

- Identify the production daily-macro-report scheduled task row. Record its current configuration for rollback.
- Switch its executor from the legacy path to `cachedContextOrchestrator.execute`. Per §9.5 no feature flag — this is a direct config edit with rollback-via-revert.
- Verify the task's model family matches a seeded row in `model_tier_budget_policies` (Sonnet 4.6 by default per the brief).

### Chunk 6.2 — Upload pilot bundle + attach

- Upload five reference documents via `POST /api/reference-documents/bulk-upload`:
  - Either one by one, or as a single multi-file upload with `bundleName` set + `attachTo: { subjectType: 'scheduled_task', subjectId: ... }`.
  - If the pilot operator prefers, upload individually, then attach via `POST /api/document-bundles/attach-documents` using the 5-doc set → creates an unnamed bundle → then promote via `POST /api/document-bundles/:id/promote`.
- Confirm: `document_bundle_attachments` row exists with `subject_type='scheduled_task'`, `subject_id=<pilot_task_id>`, `bundle_id=<pilot_bundle_id>`.
- Confirm: `reference_document_versions` rows have `tokenCounts` for Sonnet 4.6, Opus 4.7, Haiku 4.5.

### Chunk 6.3 — Enable `bundleUtilizationJob` schedule

- Modify `server/jobs/index.ts` to enable the cron schedule for `bundleUtilizationJob` (Phase 2 Chunk 2.7 registered it but left it disabled).
- First run writes `document_bundles.utilization_by_model_family` for the pilot bundle.
- Confirm values land for all three model families.

### Chunk 6.4 — Admin observability queries

Document the admin-only SQL queries backing §16 success criterion #4 in `docs/admin-queries/cached-context-observability.md` (or wherever admin queries live — follow the existing convention). Queries:

- **Cache hit rate per bundle per tenant per day.** `SELECT organisation_id, prefix_hash, date_trunc('day', created_at), count(*) FILTER (WHERE cached_prompt_tokens > 0)::float / count(*) FROM llm_requests WHERE prefix_hash IS NOT NULL GROUP BY ...`
- **Cache-creation cost per tenant per day.** Sum of `cache_creation_tokens` × per-token-rate from the existing pricing table.
- **First-run-vs-cached-run cost delta per bundle.** Compare `input_tokens` on the first snapshot-creating call vs subsequent cache-read calls for the same `prefix_hash`.
- **Bundle utilization per bundle per model family.** Straight read of `document_bundles.utilization_by_model_family`.
- **Run-outcome distribution.** `SELECT run_outcome, degraded_reason, count(*) FROM agent_runs WHERE run_outcome IS NOT NULL GROUP BY ...`

No dashboard UI. These are operator SQL queries per §3.2 explicit UI cut.

### Chunk 6.5 — 7-day pilot run

- Monitor daily via the observability queries.
- Acceptance per §10 Phase 6:
  - Two runs within 1 hour produce a cache hit on the second (non-zero `cache_read_input_tokens`).
  - Admin queries surface cache hit rate, cache-write cost, first-run-vs-cached-run delta per run.
  - `bundle_utilization_job` runs hourly and updates `utilization_by_model_family`.
  - Seven consecutive days of clean runs with correct cache attribution.

### Chunk 6.6 — Documentation sync

- **`architecture.md` — Key files per domain.** Add a "Cached context" entry listing the service files under `server/services/cachedContextOrchestrator.ts`, `contextAssemblyEngine.ts`, `bundleResolutionService.ts`, `documentBundleService.ts`, `referenceDocumentService.ts`, `executionBudgetResolver.ts`, plus the 7 schema files under `server/db/schema/`. Describe the `Documents → (implicit bundle) → Snapshot → Assembly → Router → Ledger` pipeline in one paragraph.
- **`docs/capabilities.md`.** Add "File-attached recurring tasks" as a Product Capability under the existing category structure. Use vendor-neutral / marketing-ready language per the CLAUDE.md editorial rules — no named LLM provider references in customer-facing sections.
- Both updates land in the same PR as Phase 6 completion per CLAUDE.md rule 11 ("docs stay in sync with code").

### Chunk 6.7 — Deliberate budget-breach smoke

- One-off manual test: upload an oversized document (e.g. 150k tokens for Sonnet's 100k `perDocumentMaxTokens`). Attach to a throwaway test task. Run the orchestrator.
- Expected: `actions` row created with `gateLevel='block'` and the structured payload rendering per `mockup-budget-breach-block.html`; zero API credits consumed (stub / canary flag on the provider). Operator approves → re-assembly still breaches → `run_outcome='failed'`, `failureReason='hitl_second_breach'`.
- Clean up: soft-delete the test document + task.

## Acceptance (Phase 6 complete — equals spec §16 success criteria)

Per §16, the pilot is validated when:

1. [ ] End-to-end pilot run through `cachedContextOrchestrator` with the 5-doc bundle on Sonnet 4.6.
2. [ ] Cache hit verifiable: second call within TTL window shows `cache_read_input_tokens > 0`; first call shows `cache_creation_input_tokens > 0`.
3. [ ] Deliberate budget-breach test produces `gateLevel='block'` action with structured payload; zero API credits on the blocked call; approval → re-run → clean.
4. [ ] Attribution queries answer cache-hit rate / cache-write cost / first-vs-cached delta / bundle utilization per the §16 query shape.
5. [ ] Run-outcome classification works: `agent_runs.run_outcome` distinguishes completed / degraded / failed; degraded surfaces `soft_warn | token_drift | cache_miss`.
6. [ ] Prefix-hash diagnosis works: deliberate bundle edit produces a different `prefix_hash` on the next run; the §4.4 diagnosis path identifies which document version changed.
7. [ ] Seven consecutive clean daily runs.
8. [ ] All static gates green on main.
9. [ ] `architecture.md` + `docs/capabilities.md` updated.

When all 9 are green: cached-context is promoted from pilot to GA. Future file-attached task patterns can adopt the orchestrator.

## Out of scope for Phase 6

- Any Usage Explorer / Bundle lens UI (§3.2 deferred; §12.12).
- Snapshot retention tiering (§12.2).
- Unnamed bundle lifecycle management (§12.16 — required future work, but not a Phase 6 gate).
- External document connectors (§12.1).
