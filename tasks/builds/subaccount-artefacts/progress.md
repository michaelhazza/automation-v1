# Progress: Sub-Account Baseline Artefact Set

**Spec:** `docs/sub-account-baseline-artefacts-spec.md`
**Branch:** `claude/subaccount-artefacts`
**Worktree:** `../automation-v1.subaccount-artefacts`
**Migration claimed:** `0266`
**Status:** PLANNING — spec drafted, not started

## Concurrent peers

- F2 `agency-readiness-audit` (migration 0267) — independent, can land any time
- F3 `baseline-capture` (migrations 0268-0270) — depends on F1 landing first because its baseline-status JSON shape references `subaccounts` table modified here

## Phases

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Riley doc-sync | pending | ~30-45 min mechanical doc updates. Single commit. |
| Phase 1 — Schema + naming convention | pending | Migration 0266 + zod + constants. ~3h. |
| Phase 2 — Tier loaders | pending | `agentExecutionService.ts` ~834 region. ~4h. |
| Phase 3 — Capture workflow | pending | New `baseline-artefacts-capture.workflow.ts`. ~5h. |
| Phase 4 — Wizard + Knowledge UI | pending | `OnboardingWizardPage.tsx` + drawer + badge. ~5h. |
| Phase 5 — Verification + doc sync | pending | Lint, typecheck, manual run, doc updates. ~2h. |

## Decisions log

(empty — populate as build progresses)

## Blockers

(none)

## Out of scope (filed for later)

- Tier-3 progressive capture beyond first upload (deferred to v2)
- Multi-language tone variants (single primary language for v1)
- Brand asset library (logos, colour palette) — separate spec
