# Spec Review Log — Iteration 3

**Spec:** `docs/canonical-data-platform-roadmap.md`
**Spec commit:** uncommitted
**Iteration:** 3

---

## Findings

### FINDING #1
  Source: Codex
  Section: Required columns — shared_team_ids (line 419); connection visibility deferral (lines 889, 1019)
  Description: `shared_team_ids` is snapshotted onto canonical rows at ingest time; when a connection's team visibility later changes, existing rows carry stale team IDs, making the RLS policy incorrect until rows are reprocessed.
  Codex's suggested fix: Require a rewrite/backfill of affected canonical rows whenever connection visibility changes, or avoid baking team scope into the row.
  Classification: ambiguous
  Reasoning: The spec correctly defers "visibility changes on connections" UI to a follow-on task. The stale-data consequence of that deferred work is a real load-bearing gap — an invariant (rows reflect current connection visibility) that is not enforced and not documented as a known limitation. Fixing it could mean adding a new mechanism (directional) or just documenting the limitation and assigning resolution to the follow-on task (mechanical). Sent to HITL because the right option isn't obvious without product input.
  Disposition: HITL-checkpoint

### FINDING #2
  Source: Codex
  Section: D8 — Bundled-tier pricing, line 253 vs. integration_ingestion_stats schema (lines 558–560)
  Description: D8 requires "storage" to be observable but `rows_ingested` is a per-sync throughput counter — during a reprocessing run it counts re-upserted rows, so it grows while retained storage stays flat. Storage cost cannot be separated from ingest activity.
  Codex's suggested fix: Add an explicit storage proxy/footprint field, or relax D8 so it no longer claims storage is observable from this table.
  Classification: ambiguous
  Reasoning: D8's "storage" language preceded the iteration 1 schema addition. The gap is real but the fix is a wording question: "row throughput" accurately describes what the table measures and is adequate for tier economics (relative cost comparison across connections over time). Changing D8's claimed observability scope is a wording clarification, not a scope reduction; but D8 is a decision record and changing what it promises warrants human confirmation.
  Disposition: HITL-checkpoint

---

## Applied changes

None this iteration (both findings are ambiguous → HITL).

---

## Iteration summary

- Mechanical findings accepted:  0
- Mechanical findings rejected:  0
- Ambiguous findings:            2
- Directional findings:          0
- HITL checkpoint path:          tasks/spec-review-checkpoint-canonical-data-platform-roadmap-3-20260417T001000Z.md
- HITL status:                   pending
- Spec commit after iteration:   uncommitted
