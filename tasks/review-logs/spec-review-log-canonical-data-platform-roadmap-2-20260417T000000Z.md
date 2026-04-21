# Spec Review Log — Iteration 2

**Spec:** `docs/canonical-data-platform-roadmap.md`
**Spec commit:** uncommitted (iteration 1 HITL changes applied)
**Iteration:** 2

---

## Findings

### FINDING #1
  Source: Codex
  Section: Required indexes (line 432) vs. canonical_emails DDL (lines 1182–1188) and canonical_calendar_events DDL (lines 1369–1375)
  Description: Required indexes convention now mandates `(shared_team_ids) using gin` but both concrete P4 and P5 table schemas omit this index.
  Codex's suggested fix: Add `USING gin (shared_team_ids)` index to `canonical_emails` and `canonical_calendar_events` DDL blocks.
  Classification: mechanical
  Reasoning: The convention was updated in iteration 1 (Finding 1.2); the concrete DDL cascade was incomplete. No scope change — the column exists, the index is missing. Obvious consistency gap.
  Disposition: auto-apply

### FINDING #2
  Source: Codex
  Section: D8 (line 253) vs. integration_ingestion_stats schema (lines 553–565)
  Description: D8 requires "API calls, ingestion compute, storage" to be observable but the table only captures `api_calls_approx` (API calls) and `rows_ingested` (storage proxy); there is no field for ingestion compute/duration.
  Codex's suggested fix: Add fields for runtime/compute and storage footprint to the schema.
  Classification: ambiguous
  Reasoning: D8's language ("API calls, ingestion compute, storage") preceded the iteration 1 schema addition. The schema was approved as "minimal" in iteration 1. Adding a `sync_duration_ms` field resolves the compute gap but is a schema addition beyond the approved minimal design — scope-addition signal. Whether `rows_ingested` is an adequate proxy for "storage" and whether "ingestion compute" warrants its own column requires human judgement.
  Disposition: HITL-checkpoint

### FINDING #3
  Source: Rubric-stale-language (load-bearing claim drift)
  Section: P3A additive columns prose (line 848)
  Description: P3A's "add required columns to every canonical table" enumeration names `owner_user_id`, `visibility_scope`, `source_connection_id` but not `shared_team_ids` — which was added to required columns in iteration 1.
  Classification: mechanical
  Reasoning: Enumeration drifted when `shared_team_ids` was added to the conventions. Adding it to the enumeration is a consistency fix — no scope change, no new decisions.
  Disposition: auto-apply

---

## Applied changes

[ACCEPT] canonical_emails DDL — shared_team_ids GIN index missing
  Fix applied: Added `canonical_emails_shared_team_gin ON canonical_emails USING gin (shared_team_ids)` after the labels gin index.

[ACCEPT] canonical_calendar_events DDL — shared_team_ids GIN index missing
  Fix applied: Added `canonical_calendar_events_shared_team_gin ON canonical_calendar_events USING gin (shared_team_ids)` after the series index.

[ACCEPT] P3A additive columns enumeration — stale, missing shared_team_ids
  Fix applied: Added `shared_team_ids` to the P3A column enumeration at line 848.

---

## Iteration summary

- Mechanical findings accepted:  2 (Finding #1 — GIN index cascade; Finding #3 — P3A enumeration)
- Mechanical findings rejected:  0
- Ambiguous findings:            1 (Finding #2 — ingestion_stats compute/storage gap)
- Directional findings:          0
- HITL checkpoint path:          tasks/spec-review-checkpoint-canonical-data-platform-roadmap-2-20260417T000000Z.md
- HITL status:                   pending
- Spec commit after iteration:   uncommitted
