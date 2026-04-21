# Spec Review HITL Checkpoint — Iteration 2

**Spec:** `docs/canonical-data-platform-roadmap.md`
**Spec commit:** uncommitted (iteration 1 HITL changes applied)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 2 of 5
**Timestamp:** 2026-04-17T00:00:00Z

This checkpoint blocks the review loop. Resolve by editing the `Decision:` line below, then re-invoking the spec-reviewer agent.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 2.1 | `integration_ingestion_stats` missing ingestion compute metric | Should the table track sync duration (`sync_duration_ms`) to satisfy D8's "ingestion compute" requirement, or is `rows_ingested` sufficient as-is? | Add `sync_duration_ms int NOT NULL DEFAULT 0` to the schema and update the D8 text to clarify `rows_ingested` is the storage proxy | D8 explicitly names three observability dimensions; the approved schema only covers two; a single duration column closes the gap at minimal cost |

---

## Mechanical fixes applied this iteration (no human input needed)

- **Finding #1** — `shared_team_ids` GIN index added to `canonical_emails` and `canonical_calendar_events` DDL blocks (cascade miss from iteration 1 Finding 1.2).
- **Finding #3** — P3A "additive columns" enumeration updated to include `shared_team_ids`.

---

## Finding 2.1 — `integration_ingestion_stats` missing ingestion compute metric

**Classification:** ambiguous
**Source:** Codex
**Spec section:** D8 (line 253) vs. `integration_ingestion_stats` schema (lines 553–565)

### Finding (verbatim)

> D8 now says P1 must make per-connection cost observable for API calls, ingestion compute, and storage, but the new `integration_ingestion_stats` table only captures `api_calls_approx` and `rows_ingested`. That leaves no field for runtime/compute or storage footprint, so the P1 deliverable cannot actually support the internal cost-tuning requirement the new text introduces.

### Recommendation

Add `sync_duration_ms int NOT NULL DEFAULT 0` to the `integration_ingestion_stats` schema (after `rows_ingested`). Also add a clarifying note below the schema that `rows_ingested` serves as the storage proxy (more rows ≈ more storage; exact bytes are derivable from per-table row-size estimates).

The D8 text does not need changing — "API calls, ingestion compute, storage" remains accurate once the duration column is present.

### Why

D8's requirement has three dimensions: API calls (`api_calls_approx`), ingestion compute (missing), and storage (`rows_ingested` proxy). Without a duration field there is no way to distinguish a fast 100-API-call sync from a slow one — which matters for compute cost estimation in a multi-provider tier model where some providers are slow. Adding `sync_duration_ms` is a single int column with a sensible default; it does not change the table's purpose or the retention policy. The iteration 1 "minimal schema" recommendation covered the essential tier-economics case but left D8's compute dimension unaddressed. The gap is real and inexpensive to close.

### Classification reasoning

The iteration 1 recommendation was explicitly "minimal schema" and was approved. Adding a column extends a schema that was already agreed — scope-addition signal that warrants human confirmation rather than auto-apply.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resume

Edit the `Decision:` line above (options: `apply`, `apply-with-modification`, `reject`, `stop-loop`), save, then re-invoke:

```
spec-reviewer: review docs/canonical-data-platform-roadmap.md
```

The agent reads this file first, honours the decision, then continues to iteration 3.
