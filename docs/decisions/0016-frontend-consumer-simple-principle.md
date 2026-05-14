# ADR-0016: Frontend-first design principle — consumer-simple over capability-mapped dashboards

**Status:** accepted
**Date:** 2026-05-13
**Domain:** frontend, product design, UX
**Supersedes:** _(none)_
**Superseded by:** _(none)_

## Context

The Automation OS backend is enterprise-grade: cached-context infrastructure exposes `bundle_utilization`, `prefix_hash`, `cache_creation_tokens`, per-tenant rollups. The skills system, agent fleet, three-tier permission model, observability stack, and metering pipeline are all comprehensive. The natural mockup-authoring instinct — supported by every "show the data model" reflex in design tooling — is to expose this richness as the UI. The first cached-context mockup pass produced five enterprise monitoring dashboards (radial utilisation rings, 7-day calendars, Usage Explorer with trend charts, cost-split donuts, per-tenant financial breakdowns) before the operator pushed back: "way too complicated for what this app's supposed to be: easy to use. There's just way too much information being surfaced here." The actual user need was simple attachment UX — how a user attaches document bundles to agents / tasks / scheduled tasks. Originating KNOWLEDGE entry: `2026-04-23 Correction — UI mockups surfaced every backend capability as a dashboard instead of designing for the user task`.

## Decision

We will design every UI artifact from the user's primary task, not the capability surface. Before any UI artifact (mockup, component, page, empty state, admin-only view) we answer:

1. Who is the primary user?
2. What single task are they here to complete?
3. What is the minimum information needed for that task?

Defaults: every metric dashboard, diagnostic panel, aggregated-cost view, KPI tile, ID column, prefix-hash detail, utilisation chart starts as HIDDEN or deferred. A surface earns its place only when a specific workflow on the screen requires it. Backend specs stay comprehensive; frontend surfaces stay minimal — these are TWO different decisions.

Five hard rules per UI artifact:
1. Start from the user's primary task, not the data model.
2. Default to hidden — dashboards, KPIs, IDs, cost views deferred unless a workflow requires them.
3. One primary action per screen.
4. Inline state beats dashboards (status dot beats utilisation chart).
5. Re-check — would a non-technical operator complete the task without feeling overwhelmed? If not, cut information.

## Consequences

- **Positive:**
  - The product looks distinctively simpler than enterprise-SaaS competitors with similar backend capabilities — the "consumer-simple product on enterprise-grade backend" positioning is defensible.
  - Non-technical operators (the target buyer) complete tasks without feeling overwhelmed.
  - Mockup-authoring becomes a fast loop: surface the primary task, defer everything else.
  - Reviewer feedback ("what's this dashboard for?") is auto-resolved by the rule before mockup time.
- **Negative:**
  - Operators who want power-user visibility (cost-per-tenant, prefix-hash, ID columns) must enable a hidden surface or use admin tooling. The default surface deliberately does not satisfy them.
  - Engineers who built a backend capability sometimes feel its absence from the UI is a slight; the rule explicitly separates "backend capability" from "frontend surface".
- **Neutral:**
  - The full reasoning, pre-design checklist, and worked examples live in `docs/frontend-design-principles.md`; the ADR locks the durable choice, the doc carries the operational detail.

## Alternatives considered

- **Surface every backend capability as a UI primitive ("UI reflects the data model")** — rejected. Produces enterprise-SaaS visual complexity; the operator pushback on the first cached-context mockup pass directly invalidated this approach. Target buyer is non-technical.
- **Tiered UI: simple for end-users, enterprise dashboards for admins** — rejected as a default. Admins are still humans operating with the same overload threshold; tiered UI adds maintenance cost (two surfaces) without changing the fundamental "primary task first" rule. Admin-only views are allowed as exception, not default.
- **Defer the decision per-screen, let designers judge case-by-case** — rejected. Without a durable rule, every new mockup pass re-litigates the principle and silently drifts toward data-model-first UI.

## When to revisit

When the product's user base shifts materially — e.g. the target buyer becomes a technical-power-user persona who actively wants dashboards. Until then: permanent. Each new screen runs through the five hard rules at design time.

## References

- Originating KNOWLEDGE entry: `KNOWLEDGE.md` `2026-04-23 Correction — UI mockups surfaced every backend capability as a dashboard instead of designing for the user task`
- Operational doc: `docs/frontend-design-principles.md`
- Playbook anchor: `CLAUDE.md § Frontend Design Principles`
- Worked example (cached-context redesign): mockup-designer outputs from 2026-04-23
