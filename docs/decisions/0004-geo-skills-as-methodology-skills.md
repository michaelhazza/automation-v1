# ADR-0004: GEO skills implemented as methodology skills, not intelligence skills

**Status:** accepted
**Date:** 2026-04-13
**Domain:** skill system
**Supersedes:** —
**Superseded by:** —

## Context

GEO (Generative Engine Optimisation) covers eight related skills: `audit_geo`, `geo_citability`, `geo_crawlers`, `geo_schema`, `geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`, `geo_compare`.

Each one analyses a website / brand / corpus and produces structured findings. Two implementation choices:

1. **Intelligence skill** — deterministic handler computes scores from page content (regex / DOM traversal / heuristics) and the LLM presents results.
2. **Methodology skill** — LLM fills in a structured template using the methodology instructions; no deterministic scoring layer.

## Decision

GEO skills are registered as **methodology skills** in the action registry and use `executeMethodologySkill()` in the skill handler. The LLM produces the analysis directly; there is no deterministic handler that scores the inputs.

`geoAuditService.ts` stores results after the agent produces them. It does NOT compute scores itself.

## Consequences

- **Positive:**
  - LLM reasoning over page content is the actual capability needed — GEO is fundamentally subjective interpretation, not a deterministic checklist.
  - No need to maintain a parallel scoring engine that would inevitably drift from what the LLM thinks "good GEO" looks like.
  - Adding a new GEO dimension is a methodology-doc edit, not a code change.
- **Negative:**
  - LLM costs are higher per audit than a deterministic implementation would be.
  - Outputs are non-deterministic across runs — same input, different scores. Hard to track regressions over time.
  - No structured score-validity gate — the LLM can produce any number it likes within the schema.
- **Neutral:**
  - Operators see "the agent analyzed this" rather than "the system computed this" — different mental model from intelligence skills.

## Alternatives considered

- **Intelligence skill (deterministic scoring).** Rejected — GEO analysis is fundamentally LLM-shaped: "does this page communicate authority?", "is this schema markup correct in the context of the page's intent?" These are not deterministic computations.
- **Hybrid (deterministic preprocessing + LLM final scoring).** Rejected for v1 — adds complexity without clear value when LLM cost is acceptable. Worth reconsidering if costs scale problematic.

## When to revisit

- If GEO becomes high-volume (>100 audits/day per tenant), the LLM cost may justify moving deterministic-extractable dimensions (e.g. `geo_schema` validity) to an intelligence skill.
- If regression tracking ("is GEO score improving over time for tenant X?") becomes a customer-visible feature, the non-determinism becomes a problem.
- If a customer disputes a score and we can't explain it from logs, the methodology approach hits its limit.

## References

- KNOWLEDGE.md entry: `### 2026-04-13 Decision — GEO skills implemented as methodology skills, not intelligence skills`
- Service: `server/services/geoAuditService.ts`
- Skills: `server/skills/audit_geo.md`, `server/skills/geo_*.md`
- Spec: `docs/geo-seo-spec.md`
