# Spec Review HITL Checkpoint — Iteration 3

**Spec:** `docs/canonical-data-platform-roadmap.md`
**Spec commit:** uncommitted
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 3 of 5
**Timestamp:** 2026-04-17T00:10:00Z

This checkpoint blocks the review loop. Resolve by editing the `Decision:` lines below, then re-invoking the spec-reviewer agent.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 3.1 | `shared_team_ids` snapshot goes stale after connection visibility changes | Should the spec document the stale-data limitation and assign resolution to the follow-on visibility-management task? | Add a note to the `shared_team_ids` column description and to the deferred-items section stating the limitation and that the follow-on visibility-management UI task must include a backfill job | The RLS policy silently gives wrong results if team IDs are stale; documenting the limitation now prevents the follow-on task from being treated as UI-only when it also needs a data migration |
| 3.2 | D8 overclaims "storage" observability — `rows_ingested` is per-sync throughput, not retained-row count | Relax D8's "storage" language to "row throughput", or add a dedicated storage metric? | Relax D8: change "API calls, ingestion compute, storage" to "API calls, ingestion compute, and row throughput" and add a one-sentence note that row throughput is the per-tier storage proxy | Adding a retained-row-count column would require a separate query at sync end; "row throughput" is what the table actually measures and is sufficient for tier economics (relative cost comparison); the distinction matters for accuracy but not for the implementation |

---

## Finding 3.1 — `shared_team_ids` snapshot goes stale after connection visibility changes

**Classification:** ambiguous
**Source:** Codex
**Spec section:** Required columns — `shared_team_ids` (line 419); deferred items (lines 889, 1019)

### Finding (verbatim)

> `shared_team_ids` is now snapshotted onto each canonical row at ingest time and then used directly by the P3B RLS policy. That works only while a connection's team visibility never changes; once the follow-on "visibility changes on connections" work lands, existing rows will keep stale team IDs until they are fully reprocessed, so users can retain access they should lose (or fail to gain access they should receive). The spec should either require a rewrite/backfill of affected canonical rows whenever connection visibility changes, or avoid baking team scope into the row in the first place.

### Recommendation

Add the following note to the `shared_team_ids` column description in the Required columns table (line 419):

> **Stale-data limitation:** populated at ingest time from the connection's team visibility. If a connection's `shared_team_ids` is later changed via the admin UI, existing canonical rows retain stale values until they are reprocessed. The visibility-management UI task (deferred, see Deferred items) must include a background job that propagates connection visibility changes to all canonical rows from that connection. Until that job ships, team-visibility changes take effect only for newly ingested rows.

Also add a bullet to the Deferred items section (around line 1019) noting that the admin UI task for connection visibility is not UI-only — it also requires a canonical-row backfill job.

### Why

The RLS policy uses `shared_team_ids` directly for access control. Stale values produce silent over-access (users from a removed team can still read) or under-access (users from a newly added team cannot read). The follow-on visibility UI task is already named in the spec, but it is described as "UI-focused" — without an explicit note about the required backfill, the implementation team is likely to ship the UI without the data migration, leaving a security-relevant gap in the access model. Documenting the limitation now, and assigning the backfill requirement to the right follow-on task, closes the gap without adding a new phase.

### Classification reasoning

Could be mechanical (just add a limitation note) or directional (changes the scope of the deferred UI task). Sent to HITL because the stale-data consequence is security-relevant, and expanding the scope of a deferred task is a product decision.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 3.2 — D8 overclaims "storage" observability

**Classification:** ambiguous
**Source:** Codex
**Spec section:** D8 (line 253) vs. `integration_ingestion_stats` schema (lines 554–566)

### Finding (verbatim)

> The new P1 observability table still does not satisfy D8's "API calls, ingestion compute, storage" requirement, because `rows_ingested` is a per-sync throughput counter rather than a storage measurement. In a reprocess-heavy run, `rows_ingested` can grow while retained storage stays flat, so internal cost tuning still cannot separate storage cost from ingest activity. Add an explicit storage proxy/footprint field (for example retained-row delta or bytes estimate), or relax D8 so it no longer claims storage is observable from this table.

### Recommendation

Relax D8's description. In two places:

1. Line 253 (D8 header): change `"API calls, ingestion compute, storage"` to `"API calls, ingestion compute, and row throughput"`.

2. Line 261 (D8 Implications): after "not per-event history", add: `Row throughput (rows_ingested) is the per-tier storage proxy — tier economics are evaluated from aggregate row counts across rolling windows, not from per-sync byte estimates.`

No schema change needed.

### Why

`rows_ingested` counts rows processed in a sync run, not net-new retained rows. For a full reprocess (e.g. after a schema change), it reports thousands of rows without adding storage. For *tier economics* (the actual D8 use case), the rolling aggregate of `rows_ingested` across 90 days is a reasonable cost signal — a connection that processes 10,000 rows/week consistently costs more than one that processes 100, regardless of reprocessing. The "storage" label is the inaccuracy; "row throughput" is what is actually measured and is sufficient for the stated purpose. Adding a separate retained-row-count field (e.g. `rows_net_new`) would require a write-time row-existence check that complicates the ingestion hot path, which is not the right trade-off for an internal cost-tuning table.

### Classification reasoning

D8 is a decision record. Changing its stated observability scope — even to make it more accurate — touches the promises D8 makes, which is a wording decision that warrants human confirmation.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resume

Edit both `Decision:` lines above (options: `apply`, `apply-with-modification`, `reject`, `stop-loop`), save, then re-invoke:

```
spec-reviewer: review docs/canonical-data-platform-roadmap.md
```

The agent reads this file first, honours each decision, then continues to iteration 4.
