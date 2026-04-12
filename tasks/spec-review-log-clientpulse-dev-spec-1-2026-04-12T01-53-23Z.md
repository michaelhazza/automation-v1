# Spec Review Log — clientpulse-dev-spec — Iteration 1

**Codex status:** Not available (rubric-only review)

## Finding classifications

FINDING #1
  Source: Rubric-contradictions
  Section: §3.4.2 (line ~246)
  Description: Spec references `result_status` enum and ALTER TYPE, but actual column is `run_result_status` (plain text, not a Postgres enum).
  Classification: mechanical
  Reasoning: Factual mismatch between spec and codebase schema.
  Disposition: auto-apply

FINDING #2
  Source: Rubric-load-bearing-claims-without-contracts
  Section: §3.3, §6.2, §9.2
  Description: `system_hierarchy_templates` has no `slug` column; `loadToOrg()` takes UUID not slug. Spec calls `loadToOrg('ghl-agency-intelligence', ...)`.
  Classification: mechanical
  Reasoning: Spec-vs-code API mismatch. Fix documents that slug column must be added.
  Disposition: auto-apply

FINDING #3
  Source: Rubric-contradictions
  Section: §6.1, §3.2 seed data
  Description: Spec uses slug `reporting_agent` but migration 0068 seeds the system agent as `portfolio-health-agent`.
  Classification: mechanical
  Reasoning: Factual mismatch — all slug references corrected.
  Disposition: auto-apply

FINDING #4
  Source: Rubric-file-inventory-drift
  Section: §2 (Current state audit)
  Description: Six files have stale line counts in the audit.
  Classification: mechanical
  Reasoning: Documentation inaccuracies. Updated to match actual codebase.
  Disposition: auto-apply

FINDING #5
  Source: Rubric-contradictions
  Section: §11 (line ~1357)
  Description: Says "3 tables" then lists 4. Arithmetic error.
  Classification: mechanical
  Reasoning: Self-contradictory count.
  Disposition: auto-apply

FINDING #6
  Source: Rubric-load-bearing-claims-without-contracts
  Section: §11 (Migration inventory)
  Description: No RLS policies specified for new org-scoped tables (`reports`, `org_subscriptions`).
  Classification: ambiguous
  Reasoning: Security-posture decision that could be deferred. Matches existing pattern but timing is a scope call.
  Disposition: HITL-checkpoint

FINDING #7
  Source: Rubric-stale-retired-language
  Section: §6.3
  Description: SQL references `slug` column that doesn't exist on `system_hierarchy_templates`. Combined with Finding #2.
  Classification: mechanical (subsumed by #2)
  Disposition: auto-apply (combined)

FINDING #9
  Source: Rubric-invariants-stated-not-enforced
  Section: §8.2.1 (Dashboard)
  Description: No empty state specified for dashboard when org has subscription but no data yet.
  Classification: mechanical
  Reasoning: Edge-case documentation gap. Added empty state note.
  Disposition: auto-apply

FINDING #10
  Source: Rubric-unnamed-new-primitives
  Section: §7.2
  Description: `server/templates/` directory doesn't exist in project structure.
  Classification: mechanical
  Reasoning: File path convention mismatch. Moved to `server/lib/reportTemplates/`.
  Disposition: auto-apply

FINDING #11
  Source: Rubric-contradictions
  Section: §10.2
  Description: Claims `stripe` npm package is "already in `package.json`" but it is not installed.
  Classification: mechanical
  Reasoning: Factual inaccuracy.
  Disposition: auto-apply

FINDING #13
  Source: Rubric-load-bearing-claims-without-contracts
  Section: §8.2.1 vs §6 and §5
  Description: Dashboard subscribes to `dashboard:update` WebSocket events but no module specifies emitting them.
  Classification: mechanical
  Reasoning: Cross-module contract gap — consumer stated but producer not assigned.
  Disposition: auto-apply

FINDING #14
  Source: Rubric-contradictions
  Section: §3.6 vs §6.3
  Description: Duplicate template fix described in two places.
  Classification: mechanical
  Reasoning: Consolidated §3.6 to reference §6.3.
  Disposition: auto-apply

## Adjudication log

[ACCEPT] §3.4.2 — run_result_status column name and type mismatch
  Fix applied: Corrected column name from `result_status` to `run_result_status` and noted it is a text column, not an enum.

[ACCEPT] §3.3, §6.2, §6.3, §9.2 — system_hierarchy_templates missing slug column and loadToOrg API mismatch
  Fix applied: Documented that slug column must be added to system_hierarchy_templates in migration 0104, updated §6.3 with full SQL, consolidated §3.6.

[ACCEPT] §6.1, §3.2 — system agent slug mismatch (reporting_agent vs portfolio-health-agent)
  Fix applied: Replaced all occurrences of `reporting_agent` with `portfolio-health-agent`.

[ACCEPT] §2 — Stale line counts for 6 files
  Fix applied: Updated line counts to match actual codebase (ghlAdapter 410, systemTemplateService 903, canonicalDataService 478, connectorPollingService 216, integrationConnectionService 518, connectorConfigService 165, intelligenceSkillExecutor 658).

[ACCEPT] §11 — Table count arithmetic error
  Fix applied: Changed "3" to "4" and noted slug column addition to existing table.

[ACCEPT] §7.2 — server/templates/ directory doesn't exist
  Fix applied: Changed path to `server/lib/reportTemplates/portfolioReport.ts`.

[ACCEPT] §10.2 — Stripe package not in package.json
  Fix applied: Changed "(already in package.json)" to "(must be added to package.json — not currently installed)".

[ACCEPT] §8.2.1 vs §6/§5 — WebSocket emission contract gap
  Fix applied: Added §6.9 documenting where dashboard:update events must be emitted.

[ACCEPT] §3.6 vs §6.3 — Duplicate template fix descriptions
  Fix applied: Consolidated §3.6 to reference §6.3.

[ACCEPT] §8.2.1 — Missing empty state specification for dashboard
  Fix applied: Added empty state handling note before the UI layout section.

[ACCEPT] §11 — Migration inventory missing slug column addition
  Fix applied: Updated 0104 description to include slug column addition.

## Iteration counts

- mechanical_accepted: 10
- mechanical_rejected: 0
- directional_or_ambiguous: 1

## Iteration 1 Summary

- Mechanical findings accepted:  10
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            1
- Reclassified to directional:   0
- HITL checkpoint path:          tasks/spec-review-checkpoint-clientpulse-dev-spec-1-2026-04-12T01-53-23Z.md
- HITL status:                   pending
- Spec commit after iteration:   (pending — changes not yet committed)
