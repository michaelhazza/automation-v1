# ADR-0017: Retrieval / ranker architecture — v1-simplified

**Status:** accepted
**Date:** 2026-05-13
**Domain:** retrieval / agents
**Supersedes:** _n/a_
**Superseded by:** _n/a_

## Context

Five-plus deferred items in the previous `tasks/todo.md` (AKR-EXT-1, AKR-CONF-1/2/5/6/9, PR-REV-B2/B3/S2/S4/S6) all converge on a single open question: should auto-knowledge-retrieval ship a multi-signal learned ranker (per the original AKR spec) or stay with the v1-simplified scoring path that landed in PR #274? Until that contract is locked, every follow-up touching retrieval surfaces (hybrid executor, candidate dedupe, re-rank cadence, telemetry shape) re-litigates the choice. The current implementation lives across `server/services/autoKnowledgeRetrieval/`, the spec at `docs/auto-knowledge-retrieval-dev-spec.md`, and the post-merge backlog item in `tasks/builds/auto-knowledge-retrieval-v2-ranker/spec.md`.

## Decision

We will lock the ranker architecture to the **v1-simplified path** for the foreseeable future: a deterministic, hand-tuned scoring function over keyword overlap, recency, and explicit relevance tags. The multi-signal learned ranker is **out of scope until a measured production-quality regression is observed.** Specifically: no signal-weight learning, no model-in-the-loop re-ranking, no per-org tuning surface. Follow-up retrieval work targets the v1-simplified contract; new signals require an ADR amendment, not an inline addition.

## Consequences

- **Positive:**
  - Removes the largest single source of "should we wait for the ranker?" deferrals.
  - Keeps the retrieval contract small enough to be unit-testable without bench harness investment.
  - Aligns with the broader pre-launch "ship correctness, defer optimisation" posture.
- **Negative:**
  - Retrieval quality stays at the v1 ceiling. Specific failure modes (long-tail keyword misses, polysemy, domain-specific stop-words) will not be addressed by ranker tuning.
  - Adds a future migration cost when the v2 ranker eventually lands — but only after real data exists to tune it against.
- **Neutral:**
  - `tasks/builds/auto-knowledge-retrieval-v2-ranker/spec.md` continues to track the v2 stub as a placeholder; the trigger to expand it is named below.

## Alternatives considered

- **Ship the full multi-signal learned ranker now** — rejected. No production retrieval data exists yet, so weights would be guessed; the engineering cost (~3 weeks) is unaffordable for an unverified improvement.
- **Ship a "ranker-ready" abstraction layer now without the ranker** — rejected. Premature abstraction; the right shape only becomes visible once we have real failure-mode data.

## When to revisit

Re-open when **any one** of these triggers fires:
- A specific customer-reported retrieval failure that the v1 path provably cannot fix (e.g. "agent missed the obvious document").
- 30+ days of production retrieval telemetry showing a measurable quality gap (e.g. precision@5 below an agreed threshold).
- Spec for a feature that depends on per-document scoring (e.g. cross-document de-duplication beyond the v1 dedupe key).

## References

- Spec: `docs/auto-knowledge-retrieval-dev-spec.md`
- Stub spec: `tasks/builds/auto-knowledge-retrieval-v2-ranker/spec.md`
- Related ADR: none
