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

| Step | Status | Notes |
|---|---|---|
| Context load (CLAUDE.md, architecture.md, DEVELOPMENT_GUIDELINES.md, handoff, spec, lessons.md) | done | feature-coordinator entry guard satisfied; status was BUILDING |
| Branch-sync S1 | done | branch is 27 commits ahead of main, 0 behind; latest main migration = 0287; spec's 0288/0289 are free |
| Migration-collision detection | done | no collisions |
| architect invocation (Rev 1) | done | plan written to tasks/builds/agent-workspace/plan.md; 14 chunks across 6 spec phases plus doc-sync |
| **Branch-sync S1 (post-PR #274 merge)** | **done** | **2026-05-08: branch synced with origin/main (merge commit `3b52cab8`); PR #274 absorbed 0288–0294; agent-workspace migrations shift to 0295/0296** |
| **architect revision (Rev 2)** | **done** | **plan revised in place; revision history block added; chunk titles + chunk 1/3/4/5/7/9/12/14 reframed for post-PR #274 baseline; risks expanded with two new programme-level rows (deep-link resolver missing, knowledge.files.* events missing); spec text remains LOCKED — only plan revised** |
| chatgpt-plan-review (manual) — Round 1 | done | Verdict: **APPROVED with tightenings — no structural redesign**. 8 mechanical tightenings auto-applied as Rev 3 (all chunk-level invariant pinning; zero operator-judgement findings). Verbatim review at `tasks/review-logs/chatgpt-plan-review-agent-workspace-2026-05-08T12-40-27Z.md`. |
| **architect revision (Rev 3)** | **done** | **plan revised in place; Rev 3 block added to Revision history; 8 tightenings applied to Chunks 3, 5, 6, 9, 10, 11; self-consistency pass updated to enumerate the new pinned invariants; spec text remains LOCKED** |
| **Plan gate** | **done** | **Operator approved Rev 3 on 2026-05-08. No Round 2 review — verdict "diminishing returns, not missing structural rigor." Proceed to per-chunk builder loop on Sonnet.** |
| Per-chunk loop | pending | starts after plan gate |
| G2 integrated-state static-check gate | pending | |
| Branch-level review pass | pending | |
| Doc-sync gate | pending | |
| Handoff write (Phase 2 section) | pending | |
| current-focus.md → REVIEWING | pending | |
| End-of-phase prompt | pending | |

## ChatGPT-web plan review — Round 1 (2026-05-08)

Verbatim review at `tasks/review-logs/chatgpt-plan-review-agent-workspace-2026-05-08T12-40-27Z.md`. Verdict: **APPROVED with tightenings — no structural redesign needed**. 8 findings, all classified as mechanical / technical (zero operator-judgement). Auto-applied as plan **Rev 3**.

| # | Chunk | Tightening | Plan change |
|---|---|---|---|
| 1 | 3 | Pin §11.1 watermark predicate inline as SQL | Chunk 3 contract restates `ON CONFLICT ... WHERE excluded.event_timestamp > current.event_timestamp OR (... AND excluded.event_id > current.event_id)` literally. |
| 2 | 5 | Define 150KB budget unit (gzip vs brotli, on-wire vs raw) | Chunk 5 scope: gzip-compressed UTF-8 HTTP response body under prod Express `compression()` middleware. |
| 3 | 5 | Cache-invalidation log suppression across clustered restarts | 24h suppression keyed `(event_name, host)`; in-process Map; first INFO per UTC day per host; subsequent boots within window → DEBUG. |
| 4 | 9 | Ring-buffer eviction order under burst pressure | Eviction follows `(event_timestamp ASC, event_id ASC)`; canonical-order indexed structure; replay deterministic regardless of arrival order. |
| 5 | 9 | Last-Event-ID precedence (open vs reconnect) | Header always supersedes query param; query param consulted only when header absent. Conflicts logged at DEBUG. |
| 6 | 6+9 | Elapsed-timer drift semantics | Server-authoritative; client ticking allowed for visual smoothness; reset only from server snapshot or SSE; never persisted, never sent back. |
| 7 | 10 | Container release boundary | Release MUST execute after `withOrgTx` commit; forbidden inside transaction scope. 5-step sequence pinned; `pr-reviewer` enforces. |
| 8 | 11 | Prune-job batching invariant | 1000-row batches ordered `(created_at ASC, id ASC)`, `FOR UPDATE SKIP LOCKED`, loop-until-empty, per-batch transaction. |

**Plan line count:** 915 → ~1010 (+~95 lines from Rev 3 tightenings + Rev 3 history block + review log entries; all surgical).

**No findings required directional / operator-judgement decisions.** All 8 were chunk-level invariant pinning (existing intent made self-evident at the contract surface). Spec text remains LOCKED. ChatGPT explicitly called out the Chunk 12 hard-block handling as the correct discipline — left untouched.

Operator option: proceed to plan gate on Rev 3, OR run Round 2 verification pass against the Rev 3 changes (similar pattern to spec review).

## Phase 3 (FINALISE)

To be filled in by finalisation-coordinator after Phase 2 completes.

---

## Chunk 14 doc-sync verdicts

Investigation procedure per `docs/doc-sync.md` ran for all 13 registered docs. Grep terms checked: `agent_workspace`, `agentPresenceStreamPublisher`, `agentOverviewAggregator`, `ieeSessionService`, `agentWorkingTimeService`, `agentPresenceStream`, `agentOverview`, `AgentOverviewTab`, `useAgentPresence`, `agent_presence_states`, `agent_observations`, `agent_working_time_buckets`, `iee_sessions`, `iee_artifacts`, `agentObservationsPruneJob`, `workingTimeRollupCompactJob`, `replaySinceLastEventId`, `allow_observation_mutation`.

| Doc | Update required? | Updated in build? | Verdict |
|-----|-----------------|-------------------|---------|
| `architecture.md` | YES — new Agent Workspace section; new Key files per domain rows for 13 agent-workspace files | YES — Chunk 14 | `yes (Agent Workspace, Agent Workspace key files per domain)` |
| `KNOWLEDGE.md` | YES — 5 new patterns from agent-workspace build: single-node SSE topology, monotonic-clock working time, bounded SSE payload, immutability GUC bypass, withOrgTx side-effect boundary | YES — Chunk 14 | `yes (5 entries appended)` |
| `docs/capabilities.md` | YES — new Persistent Agent Workspace product capability | YES — Chunk 13 | `yes (Persistent Agent Workspace section added in Chunk 13)` |
| `docs/integration-reference.md` | NO — no new integration slug, OAuth provider, MCP preset, or capability slug added in this build | N/A | `no — checked agentPresenceStreamPublisher, ieeSessionService, agentWorkingTimeService; zero integration-reference candidates` |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | NO — no build-discipline, convention, agent-fleet, or review-pipeline changes in this build | N/A | `no — no build discipline or convention changes` |
| `CONTRIBUTING.md` | NO — no lint-suppression policy, comment-format, or contributor-convention changes | N/A | `no — no contributor convention changes` |
| `docs/frontend-design-principles.md` | NO — no new UI hard rule or worked example introduced; agent-workspace UI follows existing principles (one primary action, minimal information surface) | N/A | `no — no new UI hard rule or worked example` |
| `docs/spec-context.md` | N/A — spec-review sessions only; this is a build chunk | N/A | `n/a` |
| `docs/decisions/` | NO — single-node SSE topology was locked in spec (spec §18 + plan Rev 3); no new architectural X-over-Y choice made in implementation that requires an ADR | N/A | `no — topology was spec-locked; no new durable architectural choice made during implementation` |
| `docs/context-packs/` | NO — no architecture.md section anchors renamed or removed (new `agent-workspace` anchor added, but context packs reference existing anchors; new sections don't break existing packs) | N/A | `no — only additive section added; no existing anchor changed` |
| `references/test-gate-policy.md` | NO — no test-gate posture change; no new umbrella command became forbidden or allowed | N/A | `no — no test-gate posture change` |
| `references/spec-review-directional-signals.md` | NO — no spec-reviewer signal pattern repeated >2 times in this build | N/A | `no — no recurring spec-reviewer signal in this build` |
| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | NO — agent-workspace is a repo-specific feature build; framework layer (agent fleet/conventions) not changed | N/A | `no — repo-specific feature build; framework version not affected` |
