# ADR-0013: Suppression is success under single-writer invariants

**Status:** accepted
**Date:** 2026-05-13
**Domain:** routes, services, single-writer invariants, observability
**Supersedes:** _(none)_
**Superseded by:** _(none)_

## Context

Several emitter paths in this codebase are single-writer by design: one process / one row / one path is authoritative for a given fact at a given time. Examples: system-monitoring `writeDiagnosis`, terminal status-transition writers under last-write-wins ordering, cache populators, idempotent webhook receivers, notification dedup paths. These paths sometimes lose a coordination race — another writer got there first, or a stamped-newer payload made this write redundant. The natural shape `{ success: false, error: 'lost_race' }` produces four downstream regressions: retry storms, false incident signals, broken success-rate metrics, alert fatigue. Originating KNOWLEDGE entry: `[2026-04-28] Pattern — "Suppression is success" under single-writer invariants` (PR #218).

## Decision

We will treat a coordination-loser path in a single-writer emitter as a SUCCESS, not a failure. The loser returns `{ success: true, suppressed: true, reason }` (with `reason` naming the suppression cause). Callers distinguish "wrote new state" from "no-op'd safely" via the `suppressed` flag. Metrics that care about throughput bucket suppressed separately; metrics that care about correctness treat suppressed as success.

This shape applies to:
- Diagnosis writers (system-monitoring `writeDiagnosis`).
- Status-transition writers under last-write-wins ordering (terminal status reached via a different path).
- Cache populators where a fresher value already landed.
- Idempotent webhook receivers where the same event-id was processed by a sibling pod.
- Notification dedup paths where the same digest was sent N seconds ago.

It does NOT apply to paths where `success: false` genuinely means broken: DB connection lost, malformed payload, permission denied, downstream API 5xx. The convention is specifically for the class where "another writer beat me" is a healthy outcome.

## Consequences

- **Positive:**
  - No retry storms on healthy coordination losses; the caller does not re-enter the race.
  - Alerting fires on the actual failure rate, not on healthy suppressions.
  - Operators learn one mental model: `success: false` means "something is broken"; suppression is invisible to oncall.
  - Metric dashboards remain meaningful — write-success-rate is a real signal.
- **Negative:**
  - Every single-writer emitter must distinguish "lost race" (suppression) from "broke" (failure) — adds one branch per emitter site.
  - Reviewers must verify the distinction during PR review; a missed coordination loser silently produces alert noise.
- **Neutral:**
  - The convention is enforced by code review and the detection heuristic below, not by type system.

## Alternatives considered

- **Return `success: false` with a "race-lost" reason code** — rejected. Callers must opt in to ignoring the reason code; default retry / alerting paths treat any falsy success as failure. Produces the four regressions above by default.
- **Throw a specific RaceLostError** — rejected. Throwing inverts the natural control flow for what is, by design, a healthy outcome. Exception handling becomes part of the happy path.
- **Add a separate `wasSuppressed` field but keep `success: false`** — rejected. The combination `{ success: false, wasSuppressed: true }` is internally contradictory and continues to trigger failure-rate metrics until every caller is patched.

## When to revisit

When the codebase introduces a structurally different failure model (e.g. typed error unions returned from every emitter), the convention may need re-expression. Until then: permanent.

Detection heuristic for ongoing enforcement: when reviewing a single-writer emitter, grep the diff for `success: false` returns. Each hit must be either (a) a genuine failure mode (DB / network / permission / malformed input), or (b) a coordination loser that should be flipped to `success: true, suppressed: true`.

## References

- Originating KNOWLEDGE entry: `KNOWLEDGE.md` `[2026-04-28] Pattern — "Suppression is success" under single-writer invariants`
- Architecture anchor: `architecture.md § Home dashboard live reactivity`
- Canonical implementation: `writeDiagnosis` in system-monitoring (PR #218)
- Forward-looking utility + lint guard: `tasks/todo.md § PR Review deferred items / PR #218`
