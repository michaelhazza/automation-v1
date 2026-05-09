# ChatGPT-web spec review — Round 1

**Date:** 2026-05-08
**Spec under review:** `tasks/builds/agent-workspace/spec.md`
**Reviewer:** ChatGPT-web (operator-pasted)

## Verbatim review

This is a strong spec overall. The architecture is internally coherent, the invariants are explicit, and the cross-phase coordination is unusually disciplined. The biggest strength is that you've avoided the common trap of "UI state pretending to be runtime truth." The canonical-clock + projection model is solid and consistently enforced throughout.

A few high-impact tightenings still stand out though.

## High-impact tightenings

### 1. Projection writer race semantics are still slightly underspecified

Your `agent_presence_projections` watermark logic is good, but there is still a subtle ambiguity when two concurrent runs emit events with equal `event_timestamp` values. Right now you rely on:

```
excluded.last_event_timestamp > projections.last_event_timestamp
```

But same-timestamp events are possible if timestamps are truncated or sourced from the same transaction boundary. You need a deterministic final tiebreaker.

**Recommendation:**
- Add `last_event_id UUID`
- Extend ordering invariant to: `(event_timestamp ASC, event_id ASC)`
- Use that same tuple everywhere:
  - replay sorting
  - projection acceptance predicate
  - SSE replay
  - degraded recovery ordering

Right now replay ordering says `(event_timestamp, event_id)` in prose, but the DB predicate does not fully encode that invariant.

### 2. agent_observations supersession graph needs a cycle guard

You allow multiple corrections to supersede the same root, which is fine, but nothing currently prevents:
- A supersedes B
- B supersedes A

or deeper cycles.

**Recommendation:**
- DB CHECK cannot solve this
- Add service-level DFS guard in `agentObservationService`
- Reject any write where traversing `supersedes_observation_id` reaches the inserting row

Without this, your "latest leaf wins" logic becomes non-deterministic.

### 3. SSE fanout scaling assumption is implicit

You currently model:
- one SSE per Overview tab
- one SSE per Home widget

That is fine for pre-production, but the publisher topology is underspecified.

**Recommendation:**
Explicitly lock:
- one in-process publisher per node
- process-local subscriber registry
- no cross-node consistency guarantees in v1
- reconnect snapshot is canonical recovery path

Otherwise future builders may incorrectly assume horizontal consistency exists already. Right now the spec reads like distributed fanout exists, but the implementation assumptions are single-node. Make that explicit.

### 4. Working-time interval splitting across UTC boundaries needs a formal invariant

You mention intervals spanning bucket dates, but the exact accounting invariant is not fully pinned.

**Recommendation:**
Add explicit invariant:
> The sum of all bucket contributions for an interval MUST equal the exact interval duration to the millisecond, regardless of UTC boundary crossings.

And:
- split by half-open intervals `[start, end)`
- prohibit rounding during split
- round only once at final persisted bucket accumulation

Otherwise subtle drift appears over long billing windows.

### 5. degraded oscillation logic needs monotonic-clock wording

You correctly added hysteresis + oscillation windows, but timing semantics are still wall-clock implied.

**Recommendation:**
Pin:
> All degraded-state timers use a monotonic process clock, never `Date.now()`/`NOW()` deltas.

Otherwise NTP adjustments or VM clock jumps can incorrectly clear degraded state. This matters because degraded recovery is now operationally important, not cosmetic.

## Medium-value improvements

### 6. Add a hard cap on observation body size

You have truncation semantics but not a strict storage ceiling.

**Recommendation:**
- hard DB-level max, e.g. 8KB
- larger payloads must be summarised before insert
- prohibit raw tool dumps entering observations

Otherwise the Overview payload-budget guarantee will eventually erode.

### 7. Presence projection rebuild contract should define chunking

You say projections are reconstructible from canonical events, but not how rebuild behaves operationally.

**Recommendation:**
Add:
- replay chunk size
- ordering invariant
- checkpoint cadence
- max in-memory batch size

Otherwise a future rebuild implementation could accidentally load the full event history into memory.

### 8. filesSnapshot cache invalidation should include promotion events

You refresh:
- on run-end
- via TTL

But not when:
- a file is promoted to Knowledge
- a newer version supersedes current

That will create stale lineage affordances.

**Recommendation:**
Invalidate on:
- artifact promotion
- version supersession
- manual deletion/archive

## Very good decisions worth preserving

A few things here are especially strong and should not get watered down during implementation:

- The anti-optimistic UI rule is excellent. Most systems fail here.
- `failed` outranking `degraded` is correct and operationally important.
- The split between canonical presence and client transport health is extremely well designed.
- The Working Time accounting model is materially better than most agent platforms because you explicitly subtract dependency wait windows.
- The additive composition contract with Trust avoids future ownership collisions.
- The payload-budget discipline paired with freshness budgets is unusually mature.

## Overall verdict

This is already at "implementation-ready with hardening" quality. The remaining issues are mostly around:
- deterministic replay ordering
- cycle prevention
- operational scaling assumptions
- precision invariants around billing math

None are architectural rewrites.
