# Progress: Sub-Account Baseline Artefact Set

**Spec:** `docs/sub-account-baseline-artefacts-spec.md`
**Branch:** `claude/stream-1-onboarding-scope`
**Worktree:** `../automation-v1.stream-1-onboarding-scope`
**Migration claimed:** `0277`
**Status:** IN PROGRESS — backend complete; frontend chunks 4A/4B and verification (5) remain

> **Branch scope note.** Backend chunks 1A–3C are DONE on the F1 implementation branch `claude/stream-1-onboarding-scope` (commit `e15e2c58 feat(f1): sub-account baseline artefact set (migration 0277)`). The implementation files (`migrations/0277_*.sql`, `server/workflows/baseline-artefacts-capture.workflow.ts`, `shared/constants/baselineArtefacts.ts`, etc.) ship from THAT branch — they are NOT present on the current branch you may be reading this on. The DONE rows below describe state on the F1 branch; do not re-implement.

## Concurrent peers

- F2 `subaccount-optimiser` (migration 0267, shipped) — independent
- F3 `baseline-capture` (migrations 0278-0280) — depends on F1 landing first

## Chunks (per tasks/builds/subaccount-artefacts/plan.md)

| Chunk | Status | Notes |
|-------|--------|-------|
| 0 — Riley doc-sync | DONE | Doc-only commit. Fixed `workflow_runs.safety_mode` naming error across 4 sites. |
| 1A — Migration 0277 + Drizzle schema | DONE | migrations/0277_*.sql + memoryBlocks.ts + subaccounts.ts |
| 1B — Slugs + zod schema + F1->F2 types | DONE | shared/constants/baselineArtefacts.ts, shared/schemas/subaccount.ts, shared/types/baselineArtefacts.ts + tests |
| 2A — Tier-1 loader + agentExecutionService | DONE | getTier1Blocks + composedBlocks prepend |
| 2B — Tier-2 domain filter + telemetry | DONE | getBlocksForInjection extended, baseline_artefact.tier_loaded event |
| 3A — Telemetry events + workflow scaffold | DONE | 4 artefact.capture.* events + baseline-artefacts-capture.workflow.ts |
| 3B — markArtefactCaptured + Tier-3 write | DONE | atomic JSONB update, workspace memory insert, slug-conflict guard, upsertFromWorkflow tier-field persistence |
| 3C — F1->F2 reader + completion hook | DONE | getBaselineVoiceTone, finaliseBaselineArtefactCapture hook, recordArtefactStarted |
| 4A — OnboardingWizardPage new step | PENDING | Frontend — requires human review after implementation |
| 4B — EditArtefactDrawer + badge + routes | PENDING | Must pair with 4A in same PR |
| 5 — Verification + doc sync | PENDING | Manual E2E + capabilities.md + architecture.md + KNOWLEDGE.md |

## Decisions log

(empty — populate as build progresses)

## Blockers

(none)

## Out of scope (filed for later)

- Tier-3 progressive capture beyond first upload (deferred to v2)
- Multi-language tone variants (single primary language for v1)
- Brand asset library (logos, colour palette) — separate spec
