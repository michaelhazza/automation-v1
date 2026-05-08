# Build Progress — agent-workspace

**Slug:** agent-workspace
**Branch:** claude/add-agent-cloud-compute-Kb4ii
**Spec:** tasks/builds/agent-workspace/spec.md (authoring in Phase 1)
**Brief:** docs/agent-workspace-implementation-brief.md (Rev 10, LOCKED)
**Mockups:** prototypes/agent-workspace/ (5 hi-fi mockups + index)

---

## Phase 1 (SPEC)

| Step | Status | Notes |
|---|---|---|
| Context load + PLANNING lock | done | tasks/current-focus.md set to PLANNING |
| S0 branch-sync | done | 0 commits behind main; clean |
| Brief intake + UI-detect | done | Major scope; UI-touching; mockups already attached (skip mockup loop) |
| Build slug derivation | done | Slug = agent-workspace |
| Mockup loop | skipped | Mockups already attached at prototypes/agent-workspace/ per brief Rev 10 |
| Spec authoring | done | tasks/builds/agent-workspace/spec.md |
| spec-reviewer | done | Codex hit 5-iteration cap; 41 mechanical fixes applied; directional review = operator-owned |
| chatgpt-spec-review | done | Round 1 + Round 2 artifacts; 8 + 7 = 15 mechanical fixes applied (see below). Operator closed at Round 2 — diminishing returns. |
| Handoff write | done | tasks/builds/agent-workspace/handoff.md |
| current-focus.md → BUILDING | done | Block + prose synced 2026-05-08 |
| End-of-phase commit + push | done | See git history on `claude/add-agent-cloud-compute-Kb4ii` |

**Phase 1 closed 2026-05-08.** Next: open new Claude Code session on Opus and run `launch feature coordinator`.

## ChatGPT-web spec review — Round 1 (2026-05-08)

Verbatim review at `tasks/builds/agent-workspace/chatgpt-spec-review-round-1.md`. Verdict: *implementation-ready with hardening*. 8 findings — all triaged as mechanical/technical and applied directly to `spec.md`. No directional / operator-judgement calls required.

| # | Finding | Spec changes |
|---|---|---|
| 1 | Projection-writer race tiebreaker | §11.1 acceptance predicate now uses cross-run tuple `(last_event_timestamp, last_event_id)`; §6.3 schema comment expanded; §9 idempotency-check note rewritten; §12.4 reinforces canonical `(event_timestamp ASC, event_id ASC)` invariant. |
| 2 | Observation supersession cycle guard | §7.3 adds DFS guard contract (depth bound 32, runs inside `withOrgTx`); §11.3 race row added; §11.5 HTTP `409 supersession_cycle_detected` mapping; §16.1 test entry expanded (self-loop, 2-cycle, 3-cycle, depth-bound). |
| 3 | SSE fanout single-node topology lock | New §13.1.1 explicitly locks single-node publisher; in-process registry; reconnect snapshot is canonical recovery path; cross-node consistency only via shared projection table. §18 deferred item added for multi-node fan-out broker. |
| 4 | Working-time interval bucket-split invariant | §7.5 adds 5-rule invariant block (half-open intervals, millisecond-exact bucket sum, no rounding during split, single rounding at persistence, drift bound ≤ 365 ms / year); new pure helper `splitIntervalAcrossBuckets`; §16.1 test entry expanded. |
| 5 | Monotonic clock for degraded timers | §12.3 adds monotonic-clock requirement (`process.hrtime.bigint()`); `degraded_entered_at` is wall-clock for audit/UI ONLY. §11.7 adds clock-domain split for the freshness-thresholds constants. §16.1 test entry expanded (wall-clock-jump simulation does not regress hysteresis). |
| 6 | Observation body 8KB hard cap | §6.1 schema adds `CHECK (octet_length(body) <= 8192)` + comment; §7.3 adds writer responsibilities (no raw tool dumps; truncation is fallback only); §11.5 HTTP `400 observation_body_too_large` mapping. **Magnitude (8KB) accepted as ChatGPT recommended; flagged for operator confirmation.** |
| 7 | Projection rebuild chunking contract | §6.3 adds rebuild contract (chunk size 1000, ordering invariant, checkpoint cadence per 10k events, max in-memory per-agent partition with concurrency cap 4, projection-quiesce window). §18 deferred item added for the rebuild job itself; contract locked even though job is deferred. |
| 8 | filesSnapshot cache invalidation triggers | New §9.1 adds 4 triggers (run terminal, artifact promotion, version supersession, manual delete/archive). §13.7 freshness matrix updated. §15.1 Phase 1 contract extended for lifecycle events. §17 open question 11 added for Phase 1 event-name confirmation. |

**No findings required directional / operator-judgement decisions.** All 8 were mechanical with clear, unambiguous correct implementations. Round 1 verdict on the spec was already "implementation-ready with hardening", and the remaining issues were precision invariants rather than architectural rewrites.

## ChatGPT-web spec review — Round 2 (2026-05-08)

Verbatim review at `tasks/builds/agent-workspace/chatgpt-spec-review-round-2.md`. Format: 8 regression-surface verification checks against the changes Round 1 introduced — *not* new findings. Verdict: *if Round 2 comes back mostly clean after those surfaces are checked, move directly to handoff rather than continue review cycling*.

Audit found **7 mechanical gaps** across 6 of the 8 surfaces. All fixed. Surface 3 (SSE topology) and Surface 4 (UTC + half-open) were already clean — Surface 4 received a small leading-clarity tightening but no contradiction was found.

| # | Surface | Gap found | Fix |
|---|---|---|---|
| R2-1 | 1 (replay determinism) | Recent observations consumer query at §7.3 ordered by `created_at DESC` only — same-millisecond ties on a busy agent could produce non-deterministic top-3 across viewers. | §7.3 read query now `ORDER BY created_at DESC, id DESC`; consumer note + §11.3 same-supersession-parent row updated to reference the deterministic tuple. |
| R2-2 | 2 (cycle scope) | Cycle-DFS scope was implicit (per-correction-chain, RLS-bounded). No explicit `SELECT … FOR UPDATE` lock during traversal — two concurrent inserts pointing at the same parent could each pass DFS independently and commit a partial cycle. | §7.3 now states scope explicitly (per-correction-chain, organisation-bounded by RLS — never cross-workspace or global) and adds `SELECT … FOR UPDATE` row-locks on visited rows so concurrent inserts serialise. §11.3 row updated to reflect both. |
| R2-3 | 4 (bucket math) | UTC anchoring + non-overlapping wording lived only in the ledger comment; §7.5 didn't lead with it. Risk: future reader interpreting `bucket_date` as local-timezone. | §7.5 now leads bucket-split block with explicit "**UTC-anchored, non-overlapping**" anchoring rule defining `bucket_start` / `bucket_end` and forbidding DST/local-tz interpretation across the entire pipeline. |
| R2-4 | 5 (monotonic clock) | **Direct contradiction.** §12.3 *Hysteresis window* enforced via `NOW() - degraded_entered_at < INTERVAL '10 seconds'` — the exact wall-clock + SQL-delta pattern the next paragraph forbids. | §12.3 hysteresis rewritten to use `(process.hrtime.bigint() - degradedEnteredHrtime) < DEGRADED_HYSTERESIS_NS` against the in-process `Map<agentId, …>`, with explicit reaffirmation that `degraded_entered_at` is audit/UI only. |
| R2-5 | 6 (cap unit) | Validator said "UTF-8 octets" but didn't pin the JS API. Risk: future implementer using `body.length` (UTF-16 code units) and silently undercounting non-ASCII bodies. | §7.3 cap clause pinned to `Buffer.byteLength(body, 'utf8')` and explicitly contrasted against JS `.length`. Reject-vs-truncate policy made explicit (reject is primary; truncate is fallback for third-party emitters only). |
| R2-6 | 7 (rebuild guarantees) | Rebuild contract specified chunk size, ordering, checkpoint, partition cap, but didn't classify the replay guarantee or call out projection-writer idempotency. Concurrency=4 partition basis was implicit. | §6.3 rebuild contract now leads with "**At-least-once replay; idempotent projection writes**" classifier and names both writers' idempotency mechanisms (presence watermark, working-time ledger PK). Partition basis explicitly stated as **per-agent** (never per-org / per-run / unbounded global) and concurrency=4 framed as inter-agent parallelism, preserving deterministic per-agent output. |
| R2-7 | 8 (files snapshot triggers) | Triggers covered the 4 production-time invalidation events but missed restore/undelete, metadata edits, permission/visibility changes, and explicit merge handling — exactly the categories Round 2 named as "common omission". | §9.1 trigger table extended from 4 → 7 rows: `restored`, `metadata_changed`, `access_changed`, `merged` added. Contract framing updated to be conditional ("if Phase 1 emits, cloud-compute MUST invalidate"). §15.1 Phase 1 coordination row generalised to `knowledge.files.*`. §17 open question 11 expanded to require Phase 1 confirmation of both event names AND coverage. |

**No findings required directional / operator-judgement decisions.** All 7 were precision tightenings and one direct contradiction fix. The §12.3 hysteresis contradiction (R2-4) was the only material consistency bug; the rest were defence-in-depth tightenings that prevent future implementer drift.

**Spec line count:** 1586 → 1599 (+13 lines). All edits surgical.

## Phase 2 (BUILD)

To be filled in by feature-coordinator after Phase 1 hands off.

## Phase 3 (FINALISE)

To be filled in by finalisation-coordinator after Phase 2 completes.
