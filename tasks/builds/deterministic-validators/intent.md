# Intent — deterministic-validators

**Build slug (provisional):** deterministic-validators
**Date:** 2026-05-18
**Brief source:** tasks/research-briefs/deterministic-validators-dev-brief.md

---

## Problem Statement

Every quality check in a scorecard rubric is currently evaluated by an LLM judge (Claude Haiku). LLM judges share the same blind spots as the models whose output they evaluate, creating a gaming surface: the model being judged can implicitly optimise for the judge's weaknesses. Three independent research passes on the closed-loop self-improvement build converged on this warning. Additionally, every Haiku judge call costs tokens and takes 1-2 seconds; the closed-loop work substantially increases total judging volume by triggering post-failure root-cause jobs and regression replays. A deterministic validator that applies a mathematical or logical rule (schema validity, length bounds, entity existence, forbidden phrases) costs zero and runs sub-millisecond. Converting 60-80% of quality checks to deterministic form eliminates the gaming surface for those checks and reduces scorecard subsystem cost by roughly the same factor.

## Desired Outcome

A typed deterministic validator layer alongside the existing LLM-as-judge path. Each scorecard quality check is classified as `deterministic`, `semantic`, or `hybrid`. Deterministic and hybrid-precondition validators run before (or instead of) the judge, persist verdicts to the same ledger with provenance columns, and are audited in a new `validator_invocations` table. Phase 1 ships: the validator framework (TypeScript contract, registry, CLI scaffolding, CI isolation gate), 10 named validators with tests and docs, a dispatcher in `scorecardJudgeJob.ts` that routes by kind, audit tables, cost attribution (deterministic cost = 0), OpenTelemetry attributes, and UI surfaces for rubric authoring and verdict drill-in.

## Non-Goals

- Auto-conversion of existing semantic checks to deterministic form (manual opt-in only).
- LLM-generates-validator pipeline.
- Validator marketplace or community sharing.
- Per-org or per-subaccount custom validators (system-tier catalogue only in Phase 1).
- Static analysis of skill outputs at authoring time (that belongs to the staged-rollout brief).
- Replacing the LLM judge for any case requiring genuine reasoning (helpfulness, tone, factual grounding remain semantic).
- Validator catalogue browser UI (Surface 3 — deferred to Phase 2).

## Affected Capability Area

Audit & Governance, Agent Runtime

## User / Operator Impact

Rubric authors gain the ability to classify quality checks as deterministic or hybrid in the rubric editor UI — no direct DB or JSON edits required. Operators reviewing verdicts in the morning review queue see a new `evaluation_method` badge and structured evidence panel revealing which validator produced each verdict. Cost dashboards show cost-saved trend as more rubrics adopt deterministic checks. No behavioural change for existing semantic rubrics — all existing checks default to `kind: 'semantic'` and continue working unchanged.

## Risk Surface

server/db/schema, server/routes, agent runtime

## Assumptions

- The scorecard subsystem (`scorecards`, `scorecard_judgements`, `scorecardJudgeJob.ts`, `scorecardService.ts`) is operational on main as described in brief §2.2.
- The closed-loop morning review queue exists or will land at approximately the same time; the verdict drill-in component (Surface 2) may need to be retrofitted into it depending on landing order.
- Node.js major version is stable for the duration of Phase 1; version pins for deterministic-validator dependencies (`~`-notation) are the pinning mechanism.
- The bench subsystem (`benchExecuteJob.ts`) reuses the new validator layer transparently — no separate bench adaptation is required.
- 60-80% of existing quality checks are deterministic-eligible (based on the Phase 1 catalogue; Phase 1 does not verify this empirically — the two-week pilot in Step 7 measures actual reduction).

## Open Questions

- **Dispatcher catalogue miss:** brief recommends `inconclusive` (no silent fallback to semantic). Confirm via grill-me.
- **Hybrid precondition failure score:** recommend `score: 0.0`, `reasoning: "deterministic gate <slug> failed: <reason>"`, `evidence: full gate result`. Confirm.
- **`deterministic_external` cost surfacing in dashboards:** brief recommends tracking external call count and median latency separately; flag any validator whose p95 exceeds 1 second. Confirm the dashboard column shape.
- **Versioning granularity:** per-file validator versions (confirmed in brief; confirm for spec).
- **Verdict-drill-in surface ownership:** if the morning review queue (closed-loop brief) lands first, this brief retrofits; if this brief lands first, it ships the component. Phase 2 coordinator decides. Spec must declare the component's public API regardless.
- **Hybrid editor UX for parameter forms:** brief recommends JSON Schema → form generator (option a) for Phase 1 with a path to per-validator overrides later. Confirm.
- **Historical replay when validator logic changes materially:** accept as known limitation, documented in audit schema. Confirm.

## Grill-me Q&A

**Q1 — Dispatcher catalogue miss behaviour**
Recommendation: `inconclusive`, no fallback to semantic judge. Silent fallback hides rubric drift.
**Operator decision:** confirmed as recommended.

**Q2 — Hybrid precondition failure score and verdict shape**
Recommendation: `score: 0.0`, `evaluation_method: 'hybrid_deterministic_fail'`, `evidence: full gate ValidatorEvidence`, `reasoning: "deterministic gate <slug> failed: <reason>"`. Binary 0.0 — judge never ran, no partial semantic evaluation occurred.
**Operator decision:** confirmed as recommended.

**Q3 — `deterministic_external` cost surfacing**
Recommendation: (a) `validator_invocations.external_call_count` + `validator_invocations.latency_ms` columns as specced; admin-only per-validator stats panel (not mixed into operator cost trend). (b) p95 latency > 1 second → monitoring alert via existing Synthetos channel; no UI badge in Phase 1.
**Operator decision:** confirmed as recommended.

**Q4 — Verdict drill-in surface ownership and component public API**
Recommendation: spec pins `VerdictDrillIn` component at `client/src/components/verdicts/VerdictDrillIn.tsx` with a declared prop interface (evaluationMethod, validatorSlug, validatorVersion, evidence, reasoning, gateEvidence). Whichever brief ships first owns the implementation; the second imports it. No runtime renegotiation.
**Operator decision:** confirmed as recommended.

**Q5 — Hybrid editor UX: parameter form generation**
Recommendation: generic `ValidatorParameterField[]`-driven form renderer for Phase 1; `uiHint` field provides control-type hints (textarea / code-editor / json-schema / slug-picker / number-range); no per-validator React fragments in Phase 1. Per-validator override path preserved for Phase 2 via optional `formComponent` field.
**Operator decision:** confirmed as recommended.

**Q6 — Bench subsystem compatibility**
Recommendation: fully transparent — bench uses the same dispatcher as live judging; deterministic validators run identically in bench with no bypass flag. Bench verdicts and live verdicts share the same shape for the same rubric.
**Operator decision:** confirmed as recommended.

**Q7 — Historical replay limitation**
Recommendation: accept as known limitation. Documented in: (1) `validator_versions` schema comment, (2) named "Replay fidelity" subsection in spec audit section. No Phase 2 sandboxed-execution commitment unless regulatory requirements emerge. Version-pinning (`~`-notation) reduces divergence surface.
**Operator decision:** confirmed as recommended.

**Q8 — `cited_entity_exists` entity-resolver registry**
Recommendation: formal `server/lib/scorecardValidators/entityResolverRegistry.ts` with typed map from string key → `(id: string, subaccountId: string) => Promise<boolean>`. No free-form string evaluation. Phase 1 registers only lookups needed by the Phase 1 catalogue. New entity type = one registry entry + service wrapper.
**Operator decision:** confirmed as recommended.

**Q9 — `.registry-meta.json` format and `skipEnforcement` shape**
Recommendation: `{ "validators": { "<slug>": { "testsGreen": bool, "skipEnforcement"?: bool, "skipEnforcementExpiry"?: "YYYY-MM-DD", "reason"?: string } }, "generatedAt": ISO, "ciRunId": string }`. CI validation step fails build on: testsGreen=false without skipEnforcement, expired skipEnforcementExpiry, skipEnforcement without expiry date.
**Operator decision:** confirmed as recommended.

**Q10 — `trace_id` column in `validator_invocations`**
Recommendation: `trace_id TEXT NULL` ships in Phase 1 `validator_invocations` migration. Nullable, zero cost when trace context unavailable. OTel instrumentation writes it when available. Avoids retroactive migration on a high-volume audit table.
**Operator decision:** confirmed as recommended.

**Q11 — `action_set_within_allowlist` step lineage access**
Recommendation: extend `RunMetadata` to carry `invokedSkillSlugs: string[]`, populated by the dispatcher from the run record before calling the validator. Validator stays `kind: 'deterministic'` (pure). No external call, no circuit-breaker overhead.
**Operator decision:** confirmed as recommended.

**Q12 — `validator_versions` snapshot write trigger**
Recommendation: server startup — registry boot sequence computes source hash per validator and upserts rows via `INSERT ... ON CONFLICT (slug, version) DO NOTHING`. Idempotent. 10 validators, ~10ms overhead. No separate CI step, no lazy-dispatch race.
**Operator decision:** confirmed as recommended.

**Q13 — Inconclusive threshold alert: inline vs post-run**
Recommendation: inline check at end of judge job run after all verdicts written; `inconclusiveAlertThreshold: number` stored on the rubric (default 0.20). Fire-and-forget alert emit, no blocking.
**Operator decision:** confirmed as recommended.

## Duplication / Strategy Check

| Output | Value |
|---|---|
| Duplication assessment | clear |
| Strategic fit | clear |
| Recommendation | proceed |

**Step 3a rationale.** Asset Register scan: no row covers "typed deterministic validator layer alongside LLM-as-judge." Closest rows: `trust-verification-layer` (Audit & Governance / Agent Runtime, Growth — the substrate this build extends, not a duplicate) and `closed-loop-skill-improvement` (same clusters, companion build explicitly referenced in the brief as the motivator). In-flight spec scan: `quality-signals-taxonomy` stub covers quality-signal taxonomy + correction shape — different desired outcome (doc + data shape vs executable validator framework). No in-flight spec targets the dispatcher, validator framework, or catalogue. Clusters `Audit & Governance` and `Agent Runtime` are both active (Growth / Mature) — strategic fit clear. Recommendation: proceed.
