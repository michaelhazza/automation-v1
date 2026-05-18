# Handoff — deterministic-validators

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** docs/superpowers/specs/2026-05-18-deterministic-validators-spec.md
**Branch:** claude/deterministic-validators-3Xjcb
**Build slug:** deterministic-validators
**UI-touching:** yes
**Mockup paths:** prototypes/deterministic-validators.html (2 screens, 3 rounds, CLEAN)
**Spec-reviewer iterations used:** 0 / 5 (skipped — operator instruction)
**ChatGPT spec review log:** tasks/review-logs/chatgpt-spec-review-deterministic-validators-2026-05-18T13-04-50Z.md
**ChatGPT spec review result:** APPROVED after Round 2 (Round 1: 14 findings — 13 applied, 1 rejected on framing; Round 2: 3 minor wording cleanups applied)
**Open questions for Phase 2:**
1. VerdictDrillIn surface location — "Needs Review" lane vs closed-loop `improvements-section` pattern (spec §10.2, §19 Q1). Must be decided before Phase 2 build begins; record in progress.md.
2. Hybrid template discovery — how do rubric authors find and configure hybrid patterns without a "hybrid templates" picker (spec §19 Q2). Phase 2 scopes.
3. Validator catalogue browser (Surface 3) — scope and ship in Phase 2 if a Synthetos staff operator requests it.

**Decisions made in Phase 1:**
- Catalogue miss → `inconclusive`, no fallback to semantic judge
- Hybrid gate fail → `score: 0.0`, `evaluation_method: 'hybrid_deterministic_fail'`, full gate evidence
- `deterministic_external` is a Validator.kind only; QualityCheck.kind stays deterministic/semantic/hybrid
- `VerdictDrillIn` component pinned at `client/src/components/verdicts/VerdictDrillIn.tsx` with spec-locked prop interface
- Hybrid editor: generic `ValidatorParameterField[]`-driven form renderer, `uiHint` field for control types
- Bench: fully transparent, same dispatcher as live judging, no bypass flag
- Historical replay limitation: accepted, documented in §5.2 and §9.3
- `cited_entity_exists`: formal `entityResolverRegistry.ts` typed map
- `.registry-meta.json`: pinned JSON shape with expiry/reason required on bypass
- `trace_id TEXT NULL` in `validator_invocations` Phase 1 migration
- `action_set_within_allowlist`: `RunMetadata.invokedSkillSlugs` from dispatcher (stays deterministic)
- `validator_versions` snapshot: server-startup upsert, idempotent, fail-open on DB unavailability
- Inconclusive threshold: inline at end of judge job; `inconclusive_alert_threshold` on rubric (default 0.20)
- Screen 1 admin-gated: operator view unchanged; validator configuration section visible to Synthetos staff only
- Safety-class cross-brief effects: fulfilled via `safety_class_check_failed` event emission; consuming briefs own subscription
- Evidence redaction: structural metadata only in audit table; PII validators must not store matched text
