# Spec Review Final Report

**Spec:** `docs/canonical-data-platform-roadmap.md`
**Spec commit at start:** `0f2d7d8b1f0109a5d5ae3d82f4aebe6cda34e38a`
**Spec commit at finish:** uncommitted (all changes pending commit)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iterations run:** 5 of 5
**Exit condition:** iteration-cap (also: two-consecutive-mechanical-only at iterations 4–5)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional | Ambiguous | HITL status |
|---|---|---|---|---|---|---|---|
| 1 | 4 | 5 (3 pre-resolved by user commit) | 2 | 0 | 0 | 4 | resolved |
| 2 | 2 | 1 | 3 | 0 | 0 | 1 | resolved |
| 3 | 2 | 0 | 0 | 0 | 0 | 2 | resolved |
| 4 | 1 | 0 | 1 | 0 | 0 | 0 | none |
| 5 | 1 | 1 | 2 | 0 | 0 | 0 | none |

---

## Mechanical changes applied

### D8 — Bundled-tier pricing
- Updated observability language from "API calls, ingestion compute, storage" to "API calls, ingestion compute, and row throughput"
- Added note that `rows_ingested` is the per-tier storage proxy; tier economics use aggregate row counts across rolling windows

### Canonical data model conventions — Required columns
- Added `shared_team_ids uuid[] NOT NULL DEFAULT '{}'` to required columns table with stale-data limitation note
- Updated `external_id` convention to allow provider-specific named equivalents (`provider_message_id`, `provider_event_id`) with note that the uniqueness invariant applies regardless of column name

### Canonical data model conventions — Required indexes
- Added `(shared_team_ids) using gin` to required indexes table
- Added exception note: multi-subaccount-scoped tables skip `(organisation_id, subaccount_id)` index because `subaccount_id` is always null

### P1 — Scheduled polling
- Added `integration_ingestion_stats` schema to P1 Design section: `(id, connection_id, sync_started_at, api_calls_approx, rows_ingested, sync_duration_ms, created_at)` with two indexes: `(connection_id, sync_started_at DESC)` and `(created_at)` for efficient retention queries
- Updated P1 exit criteria to include `integration_ingestion_stats` migrations and rows-being-written requirement

### P3A — Principal model schema
- Updated D8 text in D8 to clarify pricing/billing vs. engineering observability deliverables
- Updated P3A additive-columns enumeration to include `shared_team_ids` alongside the original three columns

### P3B — RLS policies
- Corrected visibility rules table: `shared-subaccount` and `shared-org` now show "No" for delegated principals (with footnote explaining delegation is for private data only)
- Added `app.current_team_ids` to session-variable table with type, derivation, and status
- Updated P3B out-of-scope entry for visibility UI: added note that the follow-on task is not UI-only — it requires a canonical-row backfill job for connection visibility propagation

### P4 — Gmail thin canonical
- Added `shared_team_ids uuid[] NOT NULL DEFAULT '{}'` column to `canonical_emails` schema
- Added `canonical_emails_shared_team_gin ON canonical_emails USING gin (shared_team_ids)` index

### P5 — Google Calendar full canonical
- Added `shared_team_ids uuid[] NOT NULL DEFAULT '{}'` column to `canonical_calendar_events` schema
- Added `canonical_calendar_events_shared_team_gin ON canonical_calendar_events USING gin (shared_team_ids)` index

### Appendix: Phase entry/exit criteria
- Updated P1 row to match body exit criteria (added `integration_ingestion_stats` requirements)
- Updated P6 row to add P2B as an entry dependency

---

## Rejected findings

None. All mechanical findings were accepted.

---

## Directional and ambiguous findings (resolved via HITL)

| Iter | Finding | Classification | Human's decision |
|---|---|---|---|
| 1.1 | `integration_ingestion_stats` unassigned — no phase creates it | ambiguous | apply |
| 1.2 | `shared_team_ids` missing from canonical required columns | ambiguous | apply |
| 1.3 | `external_id` vs provider-specific names in P4/P5 | ambiguous | apply |
| 1.4 | Delegated principal RLS vs. visibility rules table contradiction | ambiguous | apply |
| 2.1 | `integration_ingestion_stats` missing ingestion compute metric (`sync_duration_ms`) | ambiguous | apply |
| 3.1 | `shared_team_ids` snapshot goes stale after connection visibility changes | ambiguous | apply |
| 3.2 | D8 overclaims "storage" observability — `rows_ingested` is per-sync throughput | ambiguous | apply |

---

## Open questions deferred by `stop-loop`

None. No `stop-loop` decisions were made.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's review across 5 iterations. The human adjudicated every ambiguous finding.

Before calling the spec implementation-ready, verify:

- **The `shared_team_ids` stale-data limitation** is documented and deferred, but it means any team-visibility change during this program will produce stale RLS results for existing rows until the follow-on UI task ships. If team visibility is expected to change frequently during development/testing, plan a simple reprocessing script for dev convenience.
- **The visibility-management follow-on task scope** is now expanded: it must deliver both the UI and a canonical-row backfill job. Make sure this is captured in the task backlog.
- **P3A is wide-reaching.** Adding `shared_team_ids` to every canonical table in a single migration is a large transaction. The P3A implementation spec should plan migration strategy carefully (batched backfill, null-safe defaults, index creation CONCURRENTLY).
- **The `app.current_team_ids` session variable** is derived from a `team_members` join per session. In high-concurrency environments this could become a hot-path. The P3B implementation spec should consider caching strategy.

**Recommended next step:** read the spec's framing sections (first ~200 lines), confirm the headline findings match your current intent, and proceed to the P1 implementation spec.
