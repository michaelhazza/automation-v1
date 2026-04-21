# Spec Review Checkpoint — onboarding-playbooks-spec — Iteration 1

**Spec:** docs/onboarding-playbooks-spec.md
**Date:** 2026-04-15
**Result:** hitl-required

---

## Mechanical findings (auto-applied)

- [M1] **Tab→table mapping inverted in §0 relationship table, §3.4 diagram, and §6.1 goal.** §7.2 (the authoritative detailed section) correctly maps `workspaceMemoryEntries → References` (long-form notes) and `memoryBlocks → Memory Blocks` (short stable facts). §0, §3.4, and §6.1 had the mapping backwards. Fixed: updated relationship table row labels, §3.4 architecture diagram, and §6.1 goal assertion to use "References" and "Memory Blocks" consistently with §7.2.

- [M2] **`executeActionCall()` helper path conflict.** §4.6 says the helper lives at `server/services/playbookActionCallExecutor.ts`; §12.2 Phase A step 4 says `server/services/playbook/executeActionCall.ts`. Standardised on `server/services/playbookActionCallExecutor.ts` (§4.6 detailed spec takes precedence over the build phase summary).

- [M3] **§3.6 file inventory missing `playbookActionCallExecutor.ts` and listing wrong test file names.** The inventory listed two test files (`playbookActionCallPure.test.ts`, `playbookKnowledgeBindingPure.test.ts`) while §13.1 specifies five separate files with different names (`actionCallValidator.pure.test.ts`, `actionCallAllowlist.pure.test.ts`, `executeActionCall.pure.test.ts`, `knowledgeBindingValidator.pure.test.ts`, `knowledgeBindingRuntime.pure.test.ts`). Fixed: replaced both stale entries with the correct five-file list plus the missing helper file.

- [M4] **Knowledge page file name inconsistency.** §3.6 inventory said `client/src/pages/KnowledgePage.tsx`; §7.2 and §13.3 both name it `client/src/pages/subaccount/SubaccountKnowledgePage.tsx` and the route is `/admin/subaccounts/:subaccountId/knowledge`. Fixed: updated §3.6 inventory and the App.tsx row to use the correct path.

- [M5] **Modules admin page name wrong in two places.** §3.6 said `AdminModulesPage.tsx`; §10.4 said `client/src/pages/admin/ModulesAdminPage.tsx`. The actual file confirmed in App.tsx is `client/src/pages/SystemModulesPage.tsx` at route `/system/modules`. Fixed: corrected §3.6 inventory row and §10.4 reference to use the real filename and path.

- [M6] **Migration numbers in §3.6 conflict with the later section numbers.** §3.6 listed a single `0118_action_call_plus_knowledge.sql` combining all schema changes; §7.3, §10.2, §11.6 independently called out `0127`, `0128`, `0129` (which couldn't be right since the last migration is `0117_config_backups.sql`). Fixed: §3.6 now lists three correctly-sequenced migrations (`0118`, `0119`, `0120`) matching the split-migration plan, with notes on what each covers. Updated §7.3, §10.2, §11.6, and §14.3 rollback table to use the same numbers.

- [M7] **§13.4 gate `verify-action-call-allowlist.sh` description was incomplete.** It said "fails if actionCallAllowlist.ts references a slug not in actionRegistry.ts" — but 9 of the 28 allowed slugs (all read-only: `config_list_*`, `config_get_*`, `config_view_history`, `config_preview_plan`, `config_run_health_check`) exist only in `skillExecutor.ts`, not `actionRegistry.ts`. The gate as written would always fail against valid slugs. Fixed: clarified gate description to check mutation slugs against `actionRegistry.ts` and read slugs against `skillExecutor.ts`.

- [M8] **`PortalDashboardPage.tsx` in §3.6 doesn't exist.** The actual file for the subaccount portal is `client/src/pages/PortalPage.tsx` (route `/portal/:subaccountId`). §9.4 also referenced a non-existent `client/src/pages/portal/PortalHome.tsx`. Fixed: updated §3.6 inventory and §9.4 to reference `PortalPage.tsx` with the correct route.

---

## Directional findings (require human decision)

- [D1] **§12.3 introduces 6 Growthbook feature flags for per-phase rollout, contradicting `spec-context.md`.**

  `spec-context.md` states:
  ```yaml
  feature_flags: only_for_behaviour_modes
  staged_rollout: never_for_this_codebase_yet
  ```
  And the convention rejections include `"do not add feature flags for new migrations"`.

  The `future-proofing-research-brief.md` (maintained alongside spec-context.md) explicitly says: "We are deliberately shipping without feature flags — on the bet that speed of iteration matters more than safety rails until we have live users."

  No Growthbook (or any other feature flag) infrastructure exists anywhere in the codebase. §12.3 adds `feature.playbook_action_call`, `feature.schedule_picker_v2`, `feature.unified_knowledge_page`, `feature.playbook_run_modal_v2`, `feature.onboarding_tab`, and `feature.daily_brief_template` — all for rollout gating, not behaviour mode selection.

  **Recommendation:** Remove §12.3 (the Growthbook flags section) and replace with the existing `commit_and_revert` rollout posture: each phase is independently committed, and backout is a code revert + migration is left in place (additive-only). The §14.2 per-phase backout section already describes this correctly without flags. If feature flags are genuinely wanted for this spec, that is a context change that should be applied to `spec-context.md` first.

  **Decision:** <!-- human fills this in -->

- [D2] **§13.3 adds 5 client-side test files, contradicting the project's testing posture.**

  `spec-context.md` states:
  ```yaml
  frontend_tests: none_for_now
  ```
  And convention rejections include:
  ```
  "do not add vitest / jest / playwright for own app (until Phase 2 trigger)"
  ```

  No client test infrastructure exists (`*.test.tsx` files: zero found). §13.3 adds `HelpHint.test.tsx`, `SchedulePicker.test.tsx`, `SubaccountKnowledgePage.test.tsx`, `PlaybookRunPage.test.tsx`, and `OnboardingTab.test.tsx` — none of which can run without first setting up a frontend test harness (vitest/jest + jsdom/happy-dom + React Testing Library).

  **Recommendation:** Remove §13.3 entirely. Move the coverage intent into the pure-function tests and integration tests where it fits. For example, SchedulePicker's cron normalisation logic is already covered by `schedulePickerValueToCron.pure.test.ts`. The HelpHint lint gate (`verify-help-hint-length.mjs`) provides static coverage. Pure unit tests in `server/` cover the logic; the client components ship without unit tests per the current posture.

  Alternatively, if the intent is to introduce frontend tests as part of this spec, that is a Phase 2 trigger event and requires updating `spec-context.md` first.

  **Decision:** <!-- human fills this in -->

---

## Summary

The spec is architecturally coherent and well-structured. Eight mechanical issues were auto-applied: the most significant was a tab→table mapping inversion (§0/§3.4/§6.1 claimed "Reference notes = memory_blocks" but §7.2 correctly inverted this), plus a cascade of file name drift and migration number conflicts in the §3.6 inventory. Two directional findings require human review: (1) §12.3 introduces Growthbook feature flags that contradict `spec-context.md`'s rollout posture, and (2) §13.3 adds client-side test files that contradict the `frontend_tests: none_for_now` posture. Neither can be auto-applied — both would either pull in new infrastructure or signal a deliberate context shift that should be captured in `spec-context.md` first.
