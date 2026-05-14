# ADR-0012: Tagged-log-as-metric is the project's metrics convention

**Status:** accepted
**Date:** 2026-05-13
**Domain:** observability, metrics, logging
**Supersedes:** _(none)_
**Superseded by:** _(none)_

## Context

The codebase has no in-process counter library, no `metrics.increment(...)` API, and no Prometheus registry. Operators need rate / count / latency series for every observable event class — write failures, dispatch drops, breaker trips, idempotency conflicts, retry exhaustion. Every quarter a reviewer (human or LLM) suggests adding a counter primitive ("add `foo_failures_total` and a 1-retry on best-effort path"). Without a durable rationale, the codebase risks acquiring a parallel metrics layer that contradicts the existing one. Originating KNOWLEDGE entry: `[2026-04-25] Convention — Tagged-log-as-metric is the project's metrics convention; resist adding new metric infrastructure without a scaling driver`.

## Decision

We will treat `logger.error('event_name', { ...payload })` and `logger.warn('event_name', { ...payload })` as THE metrics surface for this codebase. The log pipeline (downstream sink — PostHog / Datadog / similar) counts occurrences of each `event_name` tag and builds rate / count / latency series from them. Every "add a counter" PR suggestion is rejected with a pointer to the existing tagged log. New observable failure modes ship a `logger.error('<event_name>', { ... })` site, not a counter.

Anchors: `server/services/delegationOutcomeService.ts` (`delegation_outcome_write_failed`), `server/services/incidentNotifyService.ts` (`incident_notify_enqueue_failed`), `architecture.md` notification/delegation section.

## Consequences

- **Positive:**
  - Single source of truth for observable events: every metric has a grep-able tag in the codebase.
  - Zero ops overhead: no Prometheus, no in-process counter library, no metric registration boilerplate.
  - Cardinality, aggregation, retention are all handled by the existing log sink — no parallel infrastructure.
  - New contributors learn one logging convention, not two.
- **Negative:**
  - Sub-log-pipeline latency is unavailable: a tagged log cannot drive a hot-loop circuit breaker decision without crossing the log roundtrip.
  - Operators relying on Prometheus-style scrape semantics must instead build queries in the log-pipeline UI.
- **Neutral:**
  - The metric is whatever the log sink counts — convention is enforced by review, not by type system.

## Alternatives considered

- **Add a counter library (e.g. `prom-client`)** — rejected. Reproduces aggregation in two places (counter + log sink); reconciliation between them is permanent technical debt. No active scaling driver demands sub-log-pipeline latency.
- **Per-service metrics modules** — rejected. Multiplies the surface; each module would re-invent tagging conventions.
- **Hybrid (logs for warn, counters for error)** — rejected. Splits the convention across severity, forcing operators to query two systems for one incident.

## When to revisit

When any of the following becomes true:
1. A specific scaling driver requires sub-log-pipeline latency (e.g. circuit-breaker decisions inside a hot loop where the log roundtrip is too slow).
2. A push-channel or external-alert surface needs a counter primitive that isn't satisfied by tagged logs.
3. Log volume itself becomes a cost driver and downsampling is needed at the source.

Until one of those is on the roadmap, every "add a counter" suggestion gets rejected with a pointer to this ADR.

## References

- Originating KNOWLEDGE entry: `KNOWLEDGE.md` `[2026-04-25] Convention — Tagged-log-as-metric is the project's metrics convention`
- Architecture: `architecture.md` § notification/delegation
- Anchors: `server/services/delegationOutcomeService.ts`, `server/services/incidentNotifyService.ts`
- Review log: `tasks/review-logs/chatgpt-pr-review-claude-system-monitoring-agent-PXNGy-2026-04-24T21-39-06Z.md`
