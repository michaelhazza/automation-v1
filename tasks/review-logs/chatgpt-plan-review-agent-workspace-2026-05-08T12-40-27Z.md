# chatgpt-plan-review — agent-workspace

**Date:** 2026-05-08
**Plan:** tasks/builds/agent-workspace/plan.md (Rev 2 at review time; Rev 3 after tightenings applied)
**Mode:** manual
**Branch:** claude/add-agent-cloud-compute-Kb4ii
**Coordinator:** feature-coordinator (Phase 2, Step 4)

---

## Round 1

**Status:** APPROVED with tightenings — auto-applied as Rev 3 (no directional / operator-judgement decisions required).

### Verbatim ChatGPT-web review

> This is a strong implementation plan overall. The sequencing, invariant layering, and Rev 2 reconciliation work are all well thought through. The plan reads implementation-ready and aligns well with the repo's existing architectural discipline.
>
> A few additional tightenings stood out that are worth addressing before handoff.
>
> **High-value tightenings**
>
> **1. Chunk 3: presence projection UPSERT race semantics should explicitly pin "latest wins"**
>
> You reference the §11.1 watermark predicate, but the exact predicate shape is not restated in the plan. Given how critical replay/order correctness is, pin it directly in the Chunk 3 contract.
>
> Right now:
> > "uses INSERT ... ON CONFLICT ... with the §11.1 watermark predicate"
>
> Add an explicit invariant like:
> ```sql
> WHERE
>   excluded.event_timestamp > current.event_timestamp
>   OR (
>     excluded.event_timestamp = current.event_timestamp
>     AND excluded.event_id > current.event_id
>   )
> ```
>
> Why:
> - Prevents future "optimisation rewrites" from weakening ordering semantics.
> - Makes the replay/reconnect contract self-contained at the chunk level.
> - Avoids hidden dependency on readers remembering §11.1 wording.
>
> **2. Chunk 5: compressed payload budget should define compression algorithm + measurement point**
>
> You enforce:
> > "≤150KB compressed budget"
>
> But not:
> - gzip vs brotli
> - pre-transfer vs on-wire
> - JSON.stringify bytes vs HTTP response bytes
>
> This becomes ambiguous in profiling.
>
> Recommend pinning:
> > Budget measured as gzip-compressed UTF-8 HTTP response body using production Express compression settings.
>
> Otherwise one builder may measure raw JSON and another gzip payload.
>
> **3. Chunk 9: SSE replay ring buffer needs deterministic eviction order**
>
> You specify:
> > "ring buffer for 60s reconnect-replay window"
>
> But not:
> - time-based eviction ordering
> - tie-break behavior under burst pressure
>
> Add:
> > Eviction order MUST follow `(event_timestamp ASC, event_id ASC)`.
> > When buffer cap exceeded, oldest canonical replay event is evicted first.
>
> Why:
> - Protects replay determinism under burst traffic.
> - Prevents accidental FIFO-by-insert-order divergence.
>
> **4. Chunk 9: Last-Event-ID conflict precedence should define equality semantics**
>
> You correctly define:
> - query param wins on initial open
> - header wins on reconnect
>
> But you do not define:
> - what counts as "auto reconnect"
> - behavior if both are supplied and differ
>
> Recommend:
> > If Last-Event-ID header exists, it always supersedes query param.
> > Query param is consulted only when header absent.
>
> Cleaner and easier to implement deterministically.
>
> **5. Chunk 10: teardown ordering should explicitly forbid external side effects inside transaction**
>
> You mention:
> > "state-claim first, THEN external side-effect"
>
> But not whether the container release happens:
> - inside tx
> - after commit
> - asynchronously
>
> Given previous repo patterns, explicitly pin:
> > Container release MUST execute after successful transaction commit.
> > External teardown MUST NOT occur inside `withOrgTx` transaction scope.
>
> This prevents future transaction/network entanglement regressions.
>
> **Medium-value tightenings**
>
> **6. Chunk 11 prune job: batching invariant**
>
> Current prune wording:
> > "prunes non-pinned observations older than 90 days"
>
> No batching semantics.
>
> Recommend:
> - deterministic batch size
> - repeat-until-empty loop
> - ordered deletion
>
> Example:
> > DELETE batches capped at 1000 rows ordered by `created_at ASC, id ASC`.
> > Loop until no qualifying rows remain.
>
> Why:
> - avoids giant transaction spikes
> - protects VACUUM pressure
> - keeps retention deterministic
>
> **7. Chunk 6/9: elapsed timer drift semantics**
>
> Presence hero includes:
> > `elapsedSinceRunStartMs`
>
> But no rule for client ticking.
>
> Potential ambiguity:
> - client locally increments?
> - server pushes authoritative elapsed every event?
>
> Recommend pinning:
> - client-side ticking allowed for display smoothness
> - authoritative reset only from server snapshot/SSE
> - no persistence of locally-derived elapsed
>
> This avoids accidental "optimistic duration" divergence.
>
> **8. Chunk 5: cache invalidation subscriber inactivity log should rate-limit across clustered reloads**
>
> Current wording:
> > "logs once per boot per event-name"
>
> Good for single node, but noisy if deploy loops happen.
>
> Recommend:
> - also include a 24h suppression window or WARN→INFO downgrade rationale.
>
> Not critical, but operationally useful.
>
> **One thing I would NOT change**
>
> The hard-block handling for Chunk 12 is exactly right.
>
> You:
> - repeated the block at chunk-level
> - repeated it in risks
> - tied it to concrete missing mainline behavior
> - explicitly prohibited placeholder synthesis
>
> That is the correct discipline for cross-phase dependency contracts.
>
> **Overall verdict**
>
> Status: APPROVED with tightenings
>
> The plan is:
> - internally consistent
> - forward-only
> - invariant-driven
> - appropriately decomposed
> - well reconciled against PR #274 realities
> - aligned with existing repo patterns
>
> The main remaining improvements are:
> - pinning a few implicit deterministic contracts explicitly
> - tightening replay/buffering semantics
> - clarifying transaction vs external-side-effect boundaries
> - defining operational batching behavior
>
> No structural redesign needed.

### Triage and resolution

All 8 findings classified as **technical / mechanical** — they pin currently-implicit deterministic contracts at chunk level. Zero require operator judgement (no architectural trade-off; no scope change). Auto-applied as Rev 3 of `plan.md` in the same session.

| # | ChatGPT finding | Classification | Plan change |
|---|---|---|---|
| 1 | Chunk 3: pin §11.1 watermark predicate inline | mechanical | Chunk 3 contract block now restates the SQL `ON CONFLICT ... WHERE excluded.event_timestamp > current.event_timestamp OR (excluded.event_timestamp = current.event_timestamp AND excluded.event_id > current.event_id)` literally. |
| 2 | Chunk 5: define 150KB budget compression algorithm + measurement point | mechanical | Chunk 5 scope: budget = gzip-compressed UTF-8 HTTP response body under production Express `compression()` middleware (level 6). Profiling task reports gzipped on-wire bytes; raw JSON informational only. |
| 3 | Chunk 9: ring-buffer eviction order | mechanical | Chunk 9 publisher spec: eviction follows `(event_timestamp ASC, event_id ASC)`; canonical-order indexed structure (not FIFO insert-order); replay always returns same subset for same `Last-Event-ID`. |
| 4 | Chunk 9: Last-Event-ID precedence | mechanical | Chunk 9 routes: header always supersedes query param when both present; query param consulted only when header absent; conflict logged at DEBUG. Drops prior open-vs-reconnect distinction. |
| 5 | Chunk 10: container release after commit | mechanical | Chunk 10 error-handling block: 5-step sequence (open `withOrgTx` → row-claim → commit → external release after commit → log post-commit failure if external call fails); `pr-reviewer` enforces no `release()` inside `withOrgTx` callback. |
| 6 | Chunk 11: prune batching invariant | mechanical | Chunk 11 prune-job: 1000-row deterministic batches ordered `(created_at ASC, id ASC)`, `FOR UPDATE SKIP LOCKED`, loop-until-empty exit condition, per-batch transaction. |
| 7 | Chunks 6/9: elapsed-timer drift semantics | mechanical | Chunk 6 PresenceHero: server-authoritative; client ticking allowed for smoothness; reset only from server snapshot or SSE; never persisted, never sent back. Chunk 9 stream-contract block adds the SSE side: events carry absolute, freshly-computed elapsed values; server never interpolates. |
| 8 | Chunk 5: cache-invalidation log suppression | mechanical | Chunk 5: 24h suppression window keyed `(event_name, host_or_pod_identity)`; in-process `Map<event_name, lastEmittedAtMs>`; first INFO per UTC day per host; subsequent boots within window downgrade to DEBUG. |

### Round 1 verdict

ChatGPT verdict: **APPROVED with tightenings — no structural redesign**. All 8 tightenings auto-applied. Plan promoted from Rev 2 to Rev 3 in place. Spec text remains LOCKED.

Operator option: stop here (Rev 3 captures all surfaced gaps) OR run a Round 2 verification pass against the Rev 3 changes.

---
