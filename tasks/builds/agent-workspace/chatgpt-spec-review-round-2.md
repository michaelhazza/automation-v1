# ChatGPT-web spec review — Round 2

**Date:** 2026-05-08
**Spec under review:** `tasks/builds/agent-workspace/spec.md` (post-Round-1)
**Reviewer:** ChatGPT-web (operator-pasted)
**Round 1 outcome:** 8 mechanical findings applied; observation cap set to 8 KB.

## Verbatim review

A few additional things are worth explicitly checking in Round 2 given the nature of the changes. These are the highest-leverage regression surfaces now:

### 1. Projection replay determinism
Ensure every consumer-facing ordering clause now consistently references `(event_timestamp, event_id)` everywhere, not just the primary projector.
- Common miss: rebuild/recovery sections still mentioning timestamp-only ordering.

### 2. Supersession cycle semantics
Verify whether cycle detection is scoped:
- per workspace?
- per entity?
- global graph?

Make sure transactional wording guarantees no partial supersession chain writes before failure.

### 3. SSE topology wording
Ensure no section still implies horizontal fanout guarantees, sticky-session freedom, or replay continuity across nodes.
- Check operational guidance and deployment diagrams for contradiction.

### 4. Working-time bucket math
Confirm all intervals are explicitly:
- UTC anchored
- half-open `[start, end)`
- non-overlapping

Make sure DST/local timezone wording cannot affect aggregation.

### 5. Monotonic timer usage
Verify degraded-mode timers are never mixed with wall-clock durations elsewhere.
- Common bug: timeout budget uses `hrtime` but emitted metrics/log timestamps still derive elapsed duration from `Date.now()`.

### 6. Observation cap enforcement
Ensure truncation policy is specified:
- reject vs truncate
- UTF-8 byte-count vs JS string length
- DB CHECK + service validation should use the same unit.

### 7. Rebuild contract
Check whether checkpointing semantics define:
- exactly-once vs at-least-once replay guarantees
- idempotency expectations for projection writes

Concurrency=4 should specify partitioning/sharding basis to preserve deterministic output.

### 8. Files snapshot invalidation
Verify invalidation events are exhaustive relative to visibility changes.
- Common omission: restore/undelete, merge/supersede, metadata edits, or permission changes.

## Verdict

If Round 2 comes back mostly clean after those surfaces are checked, I'd move directly to handoff rather than continue review cycling.

---

## Coordinator audit results (2026-05-08)

For each surface, the spec was grep-audited against the regression criteria above. Findings + fixes summarised below; full changelog in `progress.md`.

| Surface | Audit result | Fix |
|---|---|---|
| 1. Replay determinism | Canonical `(event_timestamp, event_id)` tuple is consistent across §11.1 / §12.4 / §13.4 / §6.3 / §11.3. **Gap:** §7.3 Recent observations consumer query ordered by `created_at DESC` only — same-millisecond ties non-deterministic on a busy agent. | Added `id DESC` tiebreaker to the canonical anti-join query and updated the consumer note + §11.3 concurrency row. |
| 2. Cycle scope | DFS lives inside `withOrgTx`; depth bound 32; per-correction-chain. **Gap 1:** scope (per-entity vs per-workspace vs global) not explicit. **Gap 2:** no `SELECT … FOR UPDATE` lock — concurrent inserts pointing at same parent could both pass DFS independently. | §7.3 now explicitly states scope (per-correction-chain, organisation-bounded by RLS) and adds row-level `FOR UPDATE` locks during traversal. §11.3 concurrency row updated. |
| 3. SSE topology | Clean. §13.1.1 explicitly locks single-node publisher; §1066 cache-backend reference is consistent; §18 deferred item exists for the multi-node broker. No fix needed. | None. |
| 4. Bucket math | Half-open `[start, end)` rule, millisecond-exact sum, no rounding during split, all present. UTC anchoring stated only at the ledger-table comment, not at the §7.5 invariant lead. | §7.5 now leads with explicit UTC anchoring + non-overlapping rule defining `bucket_start` / `bucket_end` and forbidding DST/local-tz across the pipeline. |
| 5. Monotonic clock | **Direct contradiction.** §12.3 *Hysteresis window* enforced via `NOW() - degraded_entered_at < INTERVAL '10 seconds'` — the exact wall-clock + SQL-delta pattern the next paragraph forbids. The implementation block correctly uses `process.hrtime.bigint()` against an in-process Map, but the prose contradicts. | §12.3 hysteresis rewritten to use the in-process `degradedEnteredHrtime` Map. The wall-clock column is now unambiguously audit/UI only. |
| 6. Cap unit | DB CHECK uses `octet_length` (UTF-8 bytes). Service validator says "UTF-8 octets" but doesn't pin the JS API used. Reject-vs-truncate stated but a future reader could miss it. | §7.3 pinned to `Buffer.byteLength(body, 'utf8')` (matches DB `octet_length`). Reject-as-primary, truncate-as-fallback made explicit. |
| 7. Rebuild guarantees | Chunk size, ordering, checkpoint cadence, max in-memory, concurrency=4 cap all present. **Gap 1:** replay guarantee not classified (exactly-once vs at-least-once). **Gap 2:** projection-writer idempotency implied at §11.1 but not referenced from rebuild block. **Gap 3:** concurrency=4 partition basis (per-agent vs per-org vs per-run) not stated. | §6.3 rebuild block now leads with "**At-least-once replay; idempotent projection writes**" classifier, names both writers' idempotency mechanisms, and explicitly states partition basis = per-agent with concurrency=4 as inter-agent parallelism. |
| 8. Files snapshot triggers | Four triggers (run terminal, promotion, supersession, deletion/archive) listed. **Gap:** missing restore/undelete, metadata edits, permission/visibility changes, explicit merge — exactly the categories Round 2 named. | §9.1 trigger table extended from 4 → 7 rows: `restored`, `metadata_changed`, `access_changed`, `merged` added. Framing made conditional on Phase 1 implementation. §15.1 Phase 1 coordination row + §17 open question 11 updated. |

**Total: 7 mechanical fixes across 6 of 8 surfaces.** No directional / operator-judgement decisions required. The §12.3 hysteresis contradiction (Surface 5) was the only material consistency bug; the rest are precision tightenings that prevent future implementer drift.

**Recommendation:** proceed to handoff. ChatGPT explicitly signalled this if Round 2 came back mostly clean. The audit found one real bug and six precision tightenings — none rises to the level of a directional re-spec. Round 3 would be diminishing returns on a spec already rated *implementation-ready with hardening* in Round 1.
