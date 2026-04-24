# Spec Review Log — session-1-foundation iteration 1

## Findings classified and dispositioned

```
FINDING #1 (Codex)
  Source: Codex
  Section: §2.4, §2.6, §7.2, §10.1
  Description: applied_system_template_id FK is load-bearing but no migration owned ADD COLUMN
  Codex suggested fix: Amend §2.4 to add the FK, backfill, and rollback explicitly
  Classification: mechanical
  Reasoning: Tightening contradiction between §2.6 ("Migration adds this FK"), §2.4 (SQL didn't), and §10.1 ("audit at kickoff"). User locked "FK will exist post-chunk-2" — so migration ownership is a mechanical cleanup, column name remains flexible.
  Disposition: auto-apply (applied)
  Fix applied: §2.4 migration expanded to explicitly own ADD COLUMN applied_system_template_id uuid REFERENCES system_hierarchy_templates(id), plus supporting index + backfill from hierarchy_templates.system_template_id. §2.6 rewritten to say migration is sole owner. §10.1 row rewritten to hedge only on the column name, not on whether the ADD happens. Rollback text expanded to cover all new objects.

FINDING #2 (Codex)
  Source: Codex
  Section: §5.4, §5.9, §5.10, §9
  Description: Popup lifecycle uses /api/agent-runs?... + /api/agent-runs/start but those endpoints don't exist with the query shape used; existing full-page assistant uses /api/agents/:id/conversations
  Codex suggested fix: Pick one contract explicitly — either conversations or agent-runs
  Classification: directional
  Reasoning: Matches "Change the interface of X" and "Introduce a new abstraction / service / pattern" signals. Picking the primitive is an architecture choice. §5.2 locks "same loop" — picking the right primitive determines whether that's delivered mechanically or requires a new surface.
  Disposition: HITL-checkpoint
  Checkpoint: tasks/spec-review-checkpoint-session-1-foundation-1-20260420T010000Z.md (Finding 1.1)

FINDING #3 (Codex)
  Source: Codex
  Section: §4.5, §6.4, §6.7, §10.5
  Description: GET /api/organisation/config response prose says "parallel mask" but schema has raw overrides; option-a reset semantic means presence-check is the mask
  Codex suggested fix: Add an overrideMask/overriddenPaths member; define semantics explicitly
  Classification: mechanical
  Reasoning: The spec already has both the data (raw overrides row) and the semantic (option a). What's missing is the sentence that bridges them. Adding the clarification is mechanical; introducing a new overrideMask field would be directional, but the cheaper fix is clarifying that the existing overrides IS the mask.
  Disposition: auto-apply (applied, modified)
  Fix applied: Replaced the §4.5 prose to state explicitly: "a leaf path is overridden iff present in overrides; value at the leaf is irrelevant; reset=write-system-default writes the system default as an explicit override." Kept the existing response shape unchanged.

FINDING #4 (Codex)
  Source: Codex
  Section: §1.2 S1-5.1, §6.2, §10.5
  Description: S1-5.1 says "typed editors for every block" but interventionTemplates ships JSON editor in S1
  Codex suggested fix: Rewrite S1-5.1 to say "editor surface for every block" with the JSON editor for interventionTemplates
  Classification: mechanical
  Reasoning: Stale language — §6.2 and §10.5 explicitly lock the JSON editor for S1, §1.2 still reads as if all 10 are typed. Classic retired-approach-surviving-in-prose rubric catch.
  Disposition: auto-apply (applied)
  Fix applied: Rewrote S1-5.1 to enumerate the 9 typed editors by block name + call out InterventionTemplatesJsonEditor for interventionTemplates with cross-ref to §6.2 + §10.5.

FINDING #5 (Codex)
  Source: Codex
  Section: §7.4, §7.5, §9.1, §9.2, §9.3
  Description: Onboarding file inventory drift — server/routes/onboarding.ts listed in both create and modify, organisationService.ts + OnboardingWizardPage.tsx + SystemCompanyTemplatesPage.tsx + AdminAgentTemplatesPage.tsx treated as new, onboardingService.ts not listed at all
  Codex suggested fix: Move existing files to modify tables; add onboardingService.ts to §9.3; reserve create tables for new files only
  Classification: mechanical
  Reasoning: Pure file inventory cleanup. Verified by spec-reviewer: all 4 files Codex flagged as existing DO exist on disk at commit a08433b. Pure mechanical drift.
  Disposition: auto-apply (applied)
  Fix applied: Removed existing-file rows from §9.1 and §9.2 create tables. Added explicit rows in §9.3 and §9.4 for organisationService.ts (new method), onboardingService.ts (extend, with HITL-pending footnote), onboarding.ts (extend endpoints), OnboardingWizardPage.tsx (rebuild). SystemCompanyTemplatesPage.tsx and AdminAgentTemplatesPage.tsx were already correctly in the modify table.

FINDING #6 (Codex)
  Source: Codex
  Section: §3.5, §8.3, §9.3
  Description: clientPulseInterventionIdempotencyPure.ts hard-codes InterventionActionTypeName union including clientpulse.operator_alert — missing from rename touch list
  Codex suggested fix: Add the file to §3.5 + §9.3 with a "rename the union literal" note
  Classification: mechanical
  Reasoning: Pure file-inventory drift. Verified by spec-reviewer: line 17 of the file contains `| 'clientpulse.operator_alert';`. Missing from the spec's §3.5 touch list.
  Disposition: auto-apply (applied)
  Fix applied: Added the file as a new row in the §3.5 code-changes table and the §9.3 modify table.

FINDING #7 (Codex)
  Source: Codex
  Section: §1.3(c), §2.4 SQL comment
  Description: Retired config_update_hierarchy_template slug still appears in locked prose and SQL column comment after §2 renamed to config_update_organisation_config
  Codex suggested fix: Replace old slug with new slug in §1.3(c) and §2.4 comment
  Classification: mechanical
  Reasoning: Classic stale language rubric catch. The rename/alias tables legitimately name the old slug; the prose in §1.3(c) and the SQL comment in §2.4 should reflect the post-rename state.
  Disposition: auto-apply (applied)
  Fix applied: §1.3(c) now reads "config_update_organisation_config skill (renamed this session from config_update_hierarchy_template; legacy slug preserved via ACTION_SLUG_ALIASES)". §2.4 COMMENT rewritten to say "Written by config_update_organisation_config skill".

FINDING #8 (Rubric — stale test filename in §8.3)
  Source: Rubric-stale-language
  Section: §8.3 existing-pure-tests list
  Description: §8.3 still names `configUpdateHierarchyTemplatePure.test.ts` even though §2.5 and §9.1 rename the file to `configUpdateOrganisationConfigPure.test.ts`; also §9.1 missing the S1-A1 integration test file named in §8.2
  Classification: mechanical
  Reasoning: Stale filename + inventory drift. Both caught by rubric pass.
  Disposition: auto-apply (applied)
  Fix applied: Added the rename note inside the existing §8.3 bullet so the 18-case migration is explicit. Added "New integration tests" subsection listing configUpdateOrganisationService.test.ts (S1-A1), organisationConfig.test.ts (S1-A4), organisationServiceCreateFromTemplate.test.ts (§7.2). Added configUpdateOrganisationService.test.ts to §9.1.

FINDING #9 (Rubric — unreconciled overlap with existing primitive)
  Source: Rubric-invariant-unenforced
  Section: §7.3, §7.4, §7.5
  Description: Onboarding wizard introduces onboarding_completed_at + GET /api/onboarding/status with new shape, but existing onboardingService.getOnboardingStatus already exposes { ghlConnected, agentsProvisioned, firstRunComplete }. Spec doesn't say how the two relate.
  Classification: directional
  Reasoning: Architecture signal — "Change the interface of X" / "Deprecate primitive Y and replace with Z". Whether the new column replaces, extends, or shadows the derivation is a design call the human owns. The spec tells you to add the column but not how to integrate it with the existing service.
  Disposition: HITL-checkpoint
  Checkpoint: tasks/spec-review-checkpoint-session-1-foundation-1-20260420T010000Z.md (Finding 1.2)
```

## Iteration 1 Summary

- Mechanical findings accepted:  7 (Codex #1, #3, #4, #5, #6, #7 + rubric #8)
- Mechanical findings rejected:  0
- Directional findings:          2 (Codex #2, rubric #9)
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-session-1-foundation-1-20260420T010000Z.md
- HITL status:                   pending
- Spec state at end of iteration: mechanically tightened; 2 directional items staged for human decision.
