# Spec Conformance Log

**Spec:** `docs/sub-account-baseline-artefacts-spec.md`
**Spec commit at check:** `16cb227b`
**Branch:** `claude/stream-1-onboarding-scope`
**Worktree:** `C:\Files\Projects\automation-v1.stream-1-onboarding-scope\`
**Base (merge-base with main):** `a460af16`
**Scope:** F1 sub-stream A only — Phases 0-5 of the spec (caller-confirmed; F3 is sub-stream B and not yet started)
**Changed-code set:** 23 files (12 modified + 11 untracked, after excluding spec/progress/todo/review-logs)
**Run at:** 2026-05-04T13:04:44Z
**Commit at finish:** `56f8f653` (log only; the `EditArtefactDrawer.tsx` mechanical-fix edit was left unstaged in the worktree because the file was untracked at run start, and committing it alone would split the F1 file out of the developer's pending bulk commit. The fix is in place in the working tree and will land with the next F1 commit.)

---

## Contents

1. Summary
2. Requirements extracted (full checklist)
3. Mechanical fixes applied
4. Directional / ambiguous gaps (routed to tasks/todo.md)
5. Files modified by this run
6. Verification re-pass (Step 5)
7. Notes for pr-reviewer
8. Next step

---

## 1. Summary

- Requirements extracted:     38
- PASS:                       37
- MECHANICAL_GAP, fixed:      1
- DIRECTIONAL_GAP, deferred:  0
- AMBIGUOUS, deferred:        0
- OUT_OF_SCOPE, skipped:      0

**Verdict:** CONFORMANT_AFTER_FIXES (1 mechanical gap closed in-session)

---

## 2. Requirements extracted (full checklist)

### 2.1 §3 Migration 0277 + JSONB schema

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | `ALTER TABLE memory_blocks ADD COLUMN tier SMALLINT` | PASS | `migrations/0277_subaccount_baseline_artefacts.sql:4` + `server/db/schema/memoryBlocks.ts:116` |
| 2 | `ALTER TABLE memory_blocks ADD COLUMN applies_to_domains TEXT[]` | PASS | `migrations/0277_subaccount_baseline_artefacts.sql:5` + `server/db/schema/memoryBlocks.ts:117` |
| 3 | `CREATE INDEX memory_blocks_tier_idx ON (org, sub, tier) WHERE tier IS NOT NULL` | PASS | `migrations/0277_subaccount_baseline_artefacts.sql:7-9` + `server/db/schema/memoryBlocks.ts:140-142` |
| 4 | `ALTER TABLE subaccounts ADD COLUMN baseline_artefacts_status JSONB` with the §3 default | PASS | `migrations/0277_subaccount_baseline_artefacts.sql:11-13` + `server/db/schema/subaccounts.ts:84-86` (default JSON shape matches §3 verbatim) |
| 5 | Down-migration drops both columns + index | PASS | `migrations/0277_subaccount_baseline_artefacts.down.sql:1-6` |
| 6 | `baselineArtefactsStatusSchema` (zod) with version=1, mutual-exclusion refinement, skipped-rejection for tier1+2 | PASS | `shared/schemas/subaccount.ts:1-54` (refine + superRefine) |
| 7 | `assertVersionGate` refuses unknown shape | PASS | `shared/schemas/subaccount.ts:77-90` (parses then re-checks version) |

### 2.2 §4 Tier loading wiring

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 8 | `getTier1Blocks(orgId, subaccountId)` sorted by name ASC, hash-stable | PASS | `server/services/memoryBlockService.ts:359-384` (`orderBy(asc(memoryBlocks.name))`) |
| 9 | `agentExecutionService.ts ~L834` prepends tier-1 blocks | PASS | `server/services/agentExecutionService.ts:899-922` (Tier-1 fetched, prepended, deduped) |
| 10 | `getBlocksForInjection` accepts `agentDomain`, filters tier-2 by `applies_to_domains @> ARRAY[agentDomain]` | PASS | `server/services/memoryBlockService.ts:227-228, 244-346` (line 310 has the `@>` join) |
| 11 | `MEMORY_BLOCK_TIER2_BOOST` constant exists, default 0.15 | PASS | `server/config/limits.ts:168` (named constant; spec said "configurable via, default 0.15", implementation reads as a named constant in the same pattern as `BLOCK_RELEVANCE_THRESHOLD` siblings; an env-var override would be a separate decision and is not explicitly named in the spec) |

### 2.3 §5 Capture workflow

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 12 | `server/workflows/baseline-artefacts-capture.workflow.ts` exists | PASS | File present, exports `defineWorkflow({ slug: 'baseline-artefacts-capture', ... })` |
| 13 | 6 `user_input` steps with knowledgeBindings (tier1+2 only) | PASS | `server/workflows/baseline-artefacts-capture.workflow.ts:33-40, 46-186` (4 knowledgeBindings; 6 steps; tier-3 routes via `markArtefactCaptured`/`markArtefactSkipped`) |
| 14 | `autoStartOnOnboarding: true` | PASS | `server/workflows/baseline-artefacts-capture.workflow.ts:31` |
| 15 | `markArtefactCaptured` updates JSONB status atomically + tier-3 inserts workspace memory | PASS | `server/services/subaccountOnboardingService.ts:423-513` (atomic `jsonb_set`, calls `assertVersionGate` first, tier-3 inserts then records id) |
| 16 | Tier-3 skip-and-complete-later supported | PASS | `markArtefactSkipped` (`server/services/subaccountOnboardingService.ts:542-604`) + `POST /api/subaccounts/:subaccountId/baseline-artefacts/:slug/skip` (`server/routes/subaccounts.ts:842-876`) |
| 17 | Tier-1 + Tier-2 mandatory before wizard exits, validator rejects | PASS | `isWizardCompletable` (`shared/schemas/subaccount.ts:62-70`) requires every Tier-1+2 entry to be `completed`; the wizard's "View dashboard" CTA is gated by `allCompletable` (`client/src/pages/OnboardingWizardPage.tsx:548-552, 658`); `markArtefactSkipped` rejects non-tier-3 with `BASELINE_SKIP_NOT_PERMITTED` (`server/services/subaccountOnboardingService.ts:555-557`) |

### 2.4 §6a Telemetry events (5)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 18 | `artefact.capture.started` registered + emitted from wizard step entry / drawer open | **MECHANICAL_GAP, FIXED** | Registry: `server/lib/tracing.ts:92`. Wizard emit: `client/src/pages/OnboardingWizardPage.tsx:597`. Drawer emit was missing, fixed in `client/src/components/baseline/EditArtefactDrawer.tsx:50-60` to fire `POST /api/subaccounts/:id/baseline-artefacts/started` on drawer open. |
| 19 | `artefact.capture.completed` registered + emitted from `markArtefactCaptured` | PASS | Registry: `server/lib/tracing.ts:93`. Emit: `server/services/subaccountOnboardingService.ts:505-512` (with `subaccount_id`, `tier`, `slug`, `user_id`, `memory_block_id`/`workspace_memory_id`, `version`) |
| 20 | `artefact.capture.skipped` registered + emitted from skip-to-later (Tier 3 only) | PASS | Registry: `server/lib/tracing.ts:94`. Emit: `server/services/subaccountOnboardingService.ts:596-603` (with `subaccount_id`, `tier`, `slug`, `user_id`, `reason`, `version`) |
| 21 | `artefact.capture.edited` registered + emitted from `<EditArtefactDrawer>` save | PASS | Registry: `server/lib/tracing.ts:95`. Emit: `server/services/subaccountOnboardingService.ts:671-678` (called from `PATCH .../baseline-artefacts/:slug` route) |
| 22 | `baseline_artefact.tier_loaded` registered + emitted from tier loaders | PASS | Registry: `server/lib/tracing.ts:90`. Emit: `server/services/agentExecutionService.ts:924-941` (one event per tier-1 and tier-2 block injected, with `organisation_id`, `subaccount_id`, `agent_role`, `tier`, `block_slug`, `token_count`) |

### 2.5 §6b F1 -> F2 contract

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 23 | `memoryBlockService.getBaselineVoiceTone(orgId, subaccountId)` exists | PASS | `server/services/memoryBlockService.ts:391-447` |
| 24 | Returns `null` when status != completed (covers `not_started` / `in_progress` / `skipped`) | PASS | `server/services/memoryBlockService.ts:413` (`if (status.tier1.voice_tone.status !== 'completed') return null`); also returns null on missing sub, missing block, version-gate failure, or invalid block content |
| 25 | Returns parsed shape when status = completed | PASS | `server/services/memoryBlockService.ts:415-446` (parses `memory_blocks.content`, validates 4 fields, returns `BaselineVoiceTone` with `captured_at` from block.updatedAt) |
| 26 | `shared/types/baselineArtefacts.ts` exports `BaselineVoiceTone` | PASS | `shared/types/baselineArtefacts.ts:8-14` (descriptors, example_sentences, prohibited_phrases, formality_level enum, captured_at: Date) |

### 2.6 §7 Files touched (deliverables)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 27 | `tracing.ts` lists 5 new event names | PASS | `server/lib/tracing.ts:90, 92-95` (all five present in `EVENT_NAMES` array) |
| 28 | `client/src/components/baseline/EditArtefactDrawer.tsx` exists | PASS | File present, ~200 LOC, post-onboarding edit flow with PATCH route |
| 29 | `client/src/components/baseline/BaselineArtefactsStatusBadge.tsx` exists | PASS | File present |
| 30 | `OnboardingWizardPage.tsx` has new step inserted after sync, before done | PASS | `client/src/pages/OnboardingWizardPage.tsx:451-680, 740-810` (Step4Baseline at slot 3; "View dashboard" final CTA shown only after `baselineDone`) |
| 31 | `SubaccountKnowledgePage.tsx` wires the drawer | PASS | `client/src/pages/SubaccountKnowledgePage.tsx:9-11, 152-186, 473-507, 836-841` |

### 2.7 §8 Done definition / hard invariants

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 32 | Status enum locked: tier-1+2 wizard cannot complete with `not_started`/`in_progress` | PASS | Enforced by `isWizardCompletable` (4 unit tests in `shared/schemas/__tests__/subaccount.test.ts` and `server/workflows/__tests__/baselineArtefactsCapture.test.ts`) |
| 33 | `skipped` is Tier-3-only (zod refusal + service guard) | PASS | Zod superRefine (`shared/schemas/subaccount.ts:39-54`); service guard (`subaccountOnboardingService.ts:555-557`); test covers both (`subaccount.test.ts:29-49`) |
| 34 | `captured_at` and `skipped_at` mutually exclusive (zod refinement) | PASS | `tier12ArtefactEntry.refine` and `tier3ArtefactEntry.refine` (`shared/schemas/subaccount.ts:9-12, 20-23`); test at `subaccount.test.ts:63-76` |
| 35 | Version gate refuses unknown shape | PASS | `assertVersionGate` (`shared/schemas/subaccount.ts:77-90`); test at `subaccount.test.ts:78-83` (version=2 throws) |
| 36 | F1 -> F2 contract honoured (`getBaselineVoiceTone` null-vs-shape semantics) | PASS | Covered by REQ 24/25; pure parsing tests at `baselineArtefactsCapture.test.ts:155-203` |
| 37 | Riley docs (Phase 0) reflect shipped/unshipped state | PASS | `docs/riley-observations-dev-spec.md:43-50` carries the Shipping-status table; `tasks/builds/riley-observations/progress.md:93-101` carries Wave-status section; W2/W3/W4 plan files all carry the required status header |
| 38 | Tier-3 retrievable via existing `workspace_memories` paths | PASS | `markArtefactCaptured` inserts `workspaceMemoryEntries` with `domain='baseline'`, `topic={'operating_constraints'\|'proof_library'}` (`subaccountOnboardingService.ts:458-477`); `architecture.md:1405` documents `domain='baseline'` as a reserved keyword for F1 tier-3 artefacts |

---

## 3. Mechanical fixes applied

### `client/src/components/baseline/EditArtefactDrawer.tsx`

- **REQ #18**, emit `artefact.capture.started` on drawer open. Spec §6a names "drawer open" as a trigger; the wizard already fired the event from "Start capture" but the post-onboarding edit drawer did not. Added a fire-and-forget `api.post(.../baseline-artefacts/started, { slug })` inside the existing `useEffect([open, artefactSlug])` block. Same pattern as the wizard's emit. Lines 50-60.

---

## 4. Directional / ambiguous gaps (routed to tasks/todo.md)

None. All gaps were classified as PASS or MECHANICAL_GAP.

---

## 5. Files modified by this run

- `client/src/components/baseline/EditArtefactDrawer.tsx`, added telemetry emit on drawer open

(All other 22 files in the changed-code set were verified read-only against the spec.)

---

## 6. Verification re-pass (Step 5)

- `npm run lint`, 0 errors, 734 warnings (same baseline as pre-fix; the new code introduced no new warnings)
- `npm run typecheck`, clean (both `tsconfig.json` and `server/tsconfig.json`)
- Re-read of `EditArtefactDrawer.tsx:45-69` confirms the telemetry emit landed inside the open-effect, fires fire-and-forget with `.catch(() => {})` so a telemetry failure can never block the edit UI, and depends on `[open, artefactSlug, subaccountId]` so it re-fires correctly when the user opens the drawer for a different artefact without unmounting

---

## 7. Notes for `pr-reviewer`

Two observations that are NOT spec-conformance gaps but the next reviewer should look at:

1. The wizard's "Start capture" link emits `artefact.capture.started` only for the first incomplete artefact in the per-sub-account row, not once per artefact. The spec's table row says "wizard step entry" (singular) which is consistent with this behaviour, so it's PASS for spec conformance, but `pr-reviewer` may want to confirm this matches product intent: capturing all six artefacts in one wizard run only emits one `started` event total.
2. The `recordArtefactStarted` route requires `SUBACCOUNTS_EDIT` permission. That's correct for the in-app wizard, but if the same route is ever called from the client portal, the permission scope will need to be revisited. Out of scope for this spec.

---

## 8. Next step

**CONFORMANT_AFTER_FIXES**, one mechanical gap closed in-session. Re-run `pr-reviewer` on the expanded changed-code set so the reviewer sees the final state including the `EditArtefactDrawer.tsx` edit. After `pr-reviewer` clears, optionally `dual-reviewer` and `adversarial-reviewer` per the user's preference, then proceed to PR creation.
