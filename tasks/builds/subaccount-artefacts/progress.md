# Progress: F1 Sub-Account Baseline Artefacts

**Spec:** `docs/sub-account-baseline-artefacts-spec.md`
**Plan:** `tasks/builds/subaccount-artefacts/plan.md`
**Branch:** `claude/stream-1-onboarding-scope` (merged into `claude/evaluate-new-features-waqfY`)
**Migration claimed:** `0277`
**Status:** COMPLETE

## Concurrent peers

- F2 `agency-readiness-audit` (migration 0267) — independent, can land any time
- F3 `baseline-capture` — depends on F1 landing first; F1 reader contract is `memoryBlockService.getBaselineVoiceTone(orgId, subaccountId)`

## Chunks

| Chunk | Description | Status |
|-------|-------------|--------|
| 0 | Migration 0277: `memory_blocks.tier`, `memory_blocks.applies_to_domains`, `subaccounts.baseline_artefacts_status`, `memory_blocks_tier_idx` | DONE |
| 1 | Shared constants, Zod schemas, shared types | DONE |
| 2A | `memoryBlockService` tier loaders: `getTier1Blocks`, `getBlocksForInjection`, `getBaselineVoiceTone` | DONE |
| 2B | `agentExecutionService` tier-1 prepend; hash-stable ordering for prefix caching | DONE |
| 2C | Tier-2 domain-matched injection via `getBlocksForInjection` with 0.15 priority boost | DONE |
| 3 | `baseline-artefacts-capture` workflow (six steps, `knowledgeBindings` for tier 1+2, direct writes for tier 3) | DONE |
| 3T | Test files: `baselineArtefactsLoader.test.ts`, `memoryBlockService.tier.test.ts`, `subaccountOnboardingArtefacts.test.ts`, `baselineArtefactsCapture.test.ts` | DONE |
| 4A | Routes + `subaccountOnboardingService` status methods; telemetry events | DONE |
| 4B | UI: OnboardingWizardPage step 4, `EditArtefactDrawer`, `BaselineArtefactsStatusBadge`, `SubaccountKnowledgePage` baseline section | DONE |
| 5 | Doc sync: `docs/capabilities.md`, `architecture.md`, `KNOWLEDGE.md`, progress closeout | DONE |

## Decisions log

1. Tier-3 writes via `markArtefactCaptured` (not `knowledgeBindings`) — see plan §Architecture notes §2.
2. JSONB shape locked by `baselineArtefactsStatusSchema` with `version: 1` gate — `assertVersionGate` called before every mutation.
3. Tier-1 blocks sorted by `name ASC` for hash-stable prefix caching across runs.
4. Tier-1 and Tier-2 artefacts cannot be skipped. Tier-3 can be skipped with `markArtefactSkipped`.
5. `domain='baseline'` in `workspace_memory_entries` is reserved for F1 tier-3 artefacts.

## Blockers

(none)

## Completion

**Completed:** 2026-05-04

All 10 chunks (0 through 5) implemented and passing G1 (lint, typecheck, build). Doc sync complete.

**2026-05-05 — Spec-conformance + PR-reviewer passes completed:**
- spec-conformance: CONFORMANT_AFTER_FIXES (1 mechanical fix: drawer open telemetry emit re-applied)
- pr-reviewer: CHANGES_REQUESTED → fixed. 3 blocking + 4 strong issues resolved:
  - B1: `to_jsonb(now()::text)` → `to_jsonb(now())` (ISO-8601 timestamps for zod .datetime())
  - B2: `assertVersionGate` reads version raw before parsing (typed BASELINE_ARTEFACTS_VERSION_MISMATCH errorCode)
  - B3: Removed unconditional wizard skip link that bypassed Tier-1+2 invariant
  - S1: Fixed short slug in telemetry emit (`brand_identity` → `baseline.brand_identity`)
  - S3+S4: `markArtefactEdited` now checks rowCount and adds `isNull(deletedAt)` on Tier-3 update
  - S5: Removed duplicate try/catch blocks in skip + edit routes (asyncHandler handles these)

Final commits: `d7c75fe5` (spec-conformance), `794248fd` (chunk 4B), `0ada2249` (PR reviewer fixes).
