# Spec Conformance Log

**Spec:** `tasks/builds/subaccount-artefacts/plan.md` (the implementation plan, used as the spec per caller invocation; also references upstream `docs/sub-account-baseline-artefacts-spec.md`)
**Spec commit at check:** `794248fd`
**Branch:** `claude/stream-1-onboarding-scope`
**Worktree:** `C:\Files\Projects\automation-v1.stream-1-onboarding-scope\`
**Base (merge-base with main):** `a460af16`
**Scope:** chunks 0 through 4B (all backend chunks 0/1A/1B/2A/2B/3A/3B/3C and frontend chunks 4A/4B). Chunk 5 (closeout / docs sync) is in flight per the caller and partly underway; this run does NOT verify chunk 5.
**Changed-code set:** 38 files (this branch's diff since the prior conformance run on 2026-05-04T13-04-44Z, which inspected the same logical implementation in pre-commit form)
**Run at:** 2026-05-04T23:24:55Z
**Commit at finish:** `d7c75fe5`

---

## Contents

1. Summary
2. Relationship to the prior 2026-05-04T13-04-44Z log
3. Requirements extracted (full checklist)
4. Mechanical fixes applied
5. Directional / ambiguous gaps (routed to tasks/todo.md)
6. Files modified by this run
7. Verification re-pass (Step 5)
8. Notes for pr-reviewer
9. Next step

---

## 1. Summary

- Requirements extracted:     38
- PASS:                       36
- MECHANICAL_GAP, fixed:      1  (re-application — see §2)
- DIRECTIONAL_GAP, deferred:  1
- AMBIGUOUS, deferred:        0
- OUT_OF_SCOPE, skipped:      0  (chunk 5 not in scope this run)

**Verdict:** CONFORMANT_AFTER_FIXES (1 mechanical gap re-applied, 1 directional gap routed)

---

## 2. Relationship to the prior 2026-05-04T13-04-44Z log

The prior conformance run was performed against the same logical implementation but in pre-commit form (untracked / unstaged). Its single MECHANICAL_GAP — emit `artefact.capture.started` from `EditArtefactDrawer.tsx` on drawer open — was applied to the working tree at that time but, per the prior log's own caveat, was left unstaged because the file was untracked at run start: *"the EditArtefactDrawer.tsx mechanical-fix edit was left unstaged in the worktree because the file was untracked at run start, and committing it alone would split the F1 file out of the developer's pending bulk commit. The fix is in place in the working tree and will land with the next F1 commit."*

The next F1 commit (`e15e2c58 feat(f1): sub-account baseline artefact set (migration 0277)` and `794248fd feat(artefacts): edit drawer + status badge (chunk 4B)`) created the file from the developer's pending state, but **without** the prior fix. Inspection of the committed `EditArtefactDrawer.tsx` confirms no `api.post('/baseline-artefacts/started')` call exists in the open-effect (lines 410-422). The prior fix was lost in the commit-bulk transition.

This run **re-applies** the same mechanical fix to the now-committed file. All other 36 prior PASS verdicts have been re-verified against the committed file state and remain PASS.

One additional gap surfaces this round that the prior log did not flag: the `markArtefactSkipped` precondition is broader than the spec's §4B idempotency posture. Routed as DIRECTIONAL.

---

## 3. Requirements extracted (full checklist)

### 3.1 Chunk 1A — Migration 0277 + Drizzle schema

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | `migrations/0277_subaccount_baseline_artefacts.sql` adds `tier SMALLINT` to `memory_blocks` | PASS | `migrations/0277_subaccount_baseline_artefacts.sql:3-5` |
| 2 | Same migration adds `applies_to_domains TEXT[]` to `memory_blocks` | PASS | `migrations/0277_subaccount_baseline_artefacts.sql:3-5` |
| 3 | Partial index `memory_blocks_tier_idx ON (org, sub, tier) WHERE tier IS NOT NULL` | PASS | `migrations/0277_subaccount_baseline_artefacts.sql:7-9`; Drizzle equivalent at `server/db/schema/memoryBlocks.ts:140-142` |
| 4 | `subaccounts.baseline_artefacts_status JSONB DEFAULT '{...}'` per spec §3 verbatim | PASS | `migrations/0277_subaccount_baseline_artefacts.sql:11-13` matches spec §3 verbatim; Drizzle at `server/db/schema/subaccounts.ts:84-86`. Note: the migration's column is nullable (no NOT NULL), matching the spec §3 SQL block exactly. The plan §1A "Contracts pinned" line says "NOT NULL with default" but the SQL block in the same plan does not emit NOT NULL — internal plan inconsistency; the implementation followed the SQL block (the upstream-spec authority). |
| 5 | Down-migration drops both columns + index | PASS | `migrations/0277_subaccount_baseline_artefacts.down.sql:1-6` |
| 6 | Drizzle schema declares `tier: smallint().$type<1 \| 2>()` | PASS | `server/db/schema/memoryBlocks.ts:116` |
| 7 | Drizzle schema declares `appliesToDomains: text().array()` | PASS | `server/db/schema/memoryBlocks.ts:117` |

### 3.2 Chunk 1B — Slugs, status zod, F1 to F2 type

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 8 | `BASELINE_SLUGS` exports six slugs in canonical order | PASS | `shared/constants/baselineArtefacts.ts:1-8` |
| 9 | `TIER_BY_SLUG` maps each slug to its tier | PASS | `shared/constants/baselineArtefacts.ts:12-19` |
| 10 | `APPLIES_TO_DOMAINS_BY_SLUG` for tier-2 only with the spec-named domain lists | PASS | `shared/constants/baselineArtefacts.ts:21-24` (offer_positioning: sales/content/outreach/crm; audience_icp: content/outreach/ads/reporting) |
| 11 | `WORKSPACE_MEMORY_TOPIC_BY_SLUG` for tier-3 only | PASS | `shared/constants/baselineArtefacts.ts:28-31` |
| 12 | `WORKSPACE_MEMORY_DOMAIN = 'baseline'` constant | PASS | `shared/constants/baselineArtefacts.ts:26` |
| 13 | Type guards `isBaselineSlug`, `tierFor`, `domainsFor` | PASS | `shared/constants/baselineArtefacts.ts:36-46` |
| 14 | `ARTEFACT_STATUSES = [not_started, in_progress, completed, skipped]` | PASS | `shared/constants/baselineArtefacts.ts:33-34` |
| 15 | `baselineArtefactsStatusSchema` zod with version=1, mutual-exclusion refinement, skipped-rejection for tier 1+2 | PASS | `shared/schemas/subaccount.ts:25-54` (object + superRefine for tier 1+2 skip rejection); `tier12ArtefactEntry` and `tier3ArtefactEntry` carry the captured_at/skipped_at mutual-exclusion refine on lines 9-12, 20-23 |
| 16 | `isWizardCompletable` returns false when any Tier-1+2 is not completed | PASS | `shared/schemas/subaccount.ts:62-70` (every Tier-1+2 entry must be `completed`) |
| 17 | `assertVersionGate` parses + checks version, throws BASELINE_ARTEFACTS_VERSION_MISMATCH on mismatch | PASS | `shared/schemas/subaccount.ts:77-90` |
| 18 | `BaselineVoiceTone` interface in `shared/types/baselineArtefacts.ts` | PASS | `shared/types/baselineArtefacts.ts:8-14` (descriptors, example_sentences, prohibited_phrases, formality_level enum, captured_at: Date) |
| 19 | Constants test asserts slug-tier-domain consistency | PASS | `shared/constants/__tests__/baselineArtefacts.test.ts` exists, runnable via npx tsx |
| 20 | Schema test asserts version gate + mutual exclusion + skip rules | PASS | `shared/schemas/__tests__/subaccount.test.ts` exists, runnable via npx tsx |

### 3.3 Chunk 2A — Tier-1 loader + stable-prefix prepend

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 21 | `getTier1Blocks(orgId, subaccountId)` returns blocks sorted by name ASC | PASS | `server/services/memoryBlockService.ts:359-384` (`orderBy(asc(memoryBlocks.name))`) |
| 22 | Returns empty array when subaccountId is null | PASS | `server/services/memoryBlockService.ts:363` |
| 23 | `agentExecutionService.ts` prepends tier-1 ahead of relevance/explicit | PASS | `server/services/agentExecutionService.ts:903-922` (Tier-1 fetched, prepended, deduped via `tier1BlockIds` Set) |
| 24 | Test file `baselineArtefactsLoader.test.ts` exists, runnable | PASS | `server/services/__tests__/baselineArtefactsLoader.test.ts` (null-guard test, runnable via npx tsx without DB; matches plan §2A step 5 fallback) |

### 3.4 Chunk 2B — Tier-2 domain filter + telemetry

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 25 | `getBlocksForInjection` accepts `agentDomain`, filters tier-2 by `applies_to_domains @> ARRAY[agentDomain]` | PASS | `server/services/memoryBlockService.ts:227-228` (param) and 295-323 (filter query with `@>` operator) |
| 26 | `MEMORY_BLOCK_TIER2_BOOST` constant, default 0.15 | PASS | `server/config/limits.ts:168` |
| 27 | Tier-2 score = threshold + boost | PASS | `server/services/memoryBlockService.ts:317` |
| 28 | `agentDomain` derived once at runtime and passed down | PASS | `server/services/agentExecutionService.ts:899` (single derivation, used at L913 for tier-2 and at L1053 for workspace memory) |
| 29 | Telemetry test file `memoryBlockService.tier.test.ts` exists | PASS | `server/services/__tests__/memoryBlockService.tier.test.ts` |

### 3.5 Chunk 3A — Telemetry events + workflow scaffold

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 30 | `tracing.ts` `EVENT_NAMES` lists all five new events | PASS | `server/lib/tracing.ts:90, 92-95` (baseline_artefact.tier_loaded + 4 artefact.capture.* events) |
| 31 | `baseline-artefacts-capture.workflow.ts` exists with slug `baseline-artefacts-capture`, version 1, `autoStartOnOnboarding: true` | PASS | `server/workflows/baseline-artefacts-capture.workflow.ts:23-31` |
| 32 | Six `user_input` steps with `sideEffectType: 'none'` and linear `dependsOn` chain | PASS | `server/workflows/baseline-artefacts-capture.workflow.ts:46-186` (brand_identity to voice_tone to offer_positioning to audience_icp to operating_constraints to proof_library; each has `sideEffectType: 'none'`) |
| 33 | Four `knowledgeBindings` for Tier 1+2 only (Tier 3 routed via `markArtefactCaptured`) | PASS | `server/workflows/baseline-artefacts-capture.workflow.ts:33-40` (4 entries; Tier 3 explicitly comments out the binding) |
| 34 | Each step's `formSchema` matches plan §3A verbatim per slug | PASS | All six step formSchemas match plan word-for-word (including `descriptors.min(3).max(5)`, `pricing_tiers` array shape, `proof_library.uploads` object shape) |
| 35 | `initialInputSchema` is `{ prefillFromSubaccount: boolean }` | PASS | `server/workflows/baseline-artefacts-capture.workflow.ts:42-44` |

### 3.6 Chunk 3B — `markArtefactCaptured` + Tier-3 write + tier-fields persistence

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 36 | `UpsertFromWorkflowParams` accepts `tier?: 1 \| 2 \| null` and `appliesToDomains?: string[] \| null` | PASS | `server/services/memoryBlockService.ts:803-813` (both params with comments citing F1 §3) |
| 37 | Workflow runtime sets tier + domains + autoAttach=true when slug='baseline-artefacts-capture' | PASS | `server/services/workflowEngineService.ts:367-374` (only fires when `isBaselineSlug(blockLabel)`; resolves tier via `tierFor()` and domains via `domainsFor()`) |
| 38 | Conflict detection for tier-less blocks colliding with baseline slugs (BASELINE_SLUG_CONFLICT) | PASS | `server/services/memoryBlockService.ts:881-888` (throws 409 BASELINE_SLUG_CONFLICT) |
| 39 | `markArtefactCaptured` reads + version-gates JSONB before mutation | PASS | `server/services/subaccountOnboardingService.ts:450-464` (SELECT then `assertVersionGate(_, 1)`) |
| 40 | Tier-3 path inserts into `workspace_memory_entries` with domain='baseline', topic from `WORKSPACE_MEMORY_TOPIC_BY_SLUG` | PASS | `server/services/subaccountOnboardingService.ts:466-486` (insert returns id, captured into `workspaceMemoryId`) |
| 41 | Atomic UPDATE via chained `jsonb_set` (no JS read-modify-write) | PASS | `server/services/subaccountOnboardingService.ts:491-512` (single SQL UPDATE with chained `jsonb_set`) |
| 42 | Emits `artefact.capture.completed` with `subaccount_id`, `tier`, `slug`, `user_id`, `memory_block_id`/`workspace_memory_id`, `version: 1` | PASS | `server/services/subaccountOnboardingService.ts:514-521` |
| 43 | `markArtefactSkipped` rejects Tier-1+2 with `BASELINE_SKIP_NOT_PERMITTED` | PASS | `server/services/subaccountOnboardingService.ts:563-566` |
| 44 | `markArtefactSkipped` writes JSONB atomically + emits `artefact.capture.skipped` | PASS | `server/services/subaccountOnboardingService.ts:592-618` |
| 45 | Test file `subaccountOnboardingArtefacts.test.ts` exists | PASS | `server/services/__tests__/subaccountOnboardingArtefacts.test.ts` |

### 3.7 Chunk 3C — F1 to F2 reader + completion hook

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 46 | `getBaselineVoiceTone(orgId, subaccountId)` exists, returns null when status != completed, parsed shape when completed | PASS | `server/services/memoryBlockService.ts:391-447` (version-gate, status check, content parse with shape validation) |
| 47 | `recordArtefactStarted` helper emits `artefact.capture.started` | PASS | `server/services/subaccountOnboardingService.ts:528-542` |
| 48 | Capture-workflow lifecycle hook calls `markArtefactCaptured` per completed step | PASS | `server/services/workflowEngineService.ts:473-545` (`finaliseBaselineArtefactCapture`); fires from `finaliseRun` at L988 when `workflowSlug === 'baseline-artefacts-capture'` |
| 49 | Tier-3 skip from workflow step calls `markArtefactSkipped` with `reason: 'defer_for_later'` | PASS | `server/services/workflowEngineService.ts:535-543` |
| 50 | Test file `baselineArtefactsCapture.test.ts` exists | PASS | `server/workflows/__tests__/baselineArtefactsCapture.test.ts` |

### 3.8 Chunk 4A — OnboardingWizardPage Step 4

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 51 | `Step4Baseline` component inserted after sync step, before done | PASS | `client/src/pages/OnboardingWizardPage.tsx:482, 788` (rendered when `currentStep === 3 && !baselineDone`) |
| 52 | Forward navigation gated on `isWizardCompletable(status)` | PASS | `client/src/pages/OnboardingWizardPage.tsx:549-552` (`allCompletable` derived per row); button at L657-658 uses `disabled={!allCompletable}` |
| 53 | `GET /api/subaccounts/:id/baseline-artefacts-status` route exists | PASS | `server/routes/subaccounts.ts:802-810` |
| 54 | Telemetry emit on step entry (POST `/baseline-artefacts/started`) | PASS | `client/src/pages/OnboardingWizardPage.tsx:597` (fired on "Start capture" click) |
| 55 | Started telemetry route exists with handler | PASS | `server/routes/subaccounts.ts:817-839` (validates slug, calls `recordArtefactStarted`) |

### 3.9 Chunk 4B — EditArtefactDrawer + StatusBadge + Knowledge wiring + edit/skip routes

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 56 | `EditArtefactDrawer.tsx` component exists with proper props (artefactSlug, subaccountId, open, onClose, onSaved) | PASS | `client/src/components/baseline/EditArtefactDrawer.tsx:1-512` (~500 LOC; portal-rendered drawer with per-slug forms) |
| 57 | Drawer fetches current content (Tier 1+2 from memory blocks; Tier 3 from workspace memory) | PASS | `client/src/components/baseline/EditArtefactDrawer.tsx:125-148` (`fetchCurrentContent`) |
| 58 | Drawer submits via `PATCH /api/subaccounts/:id/baseline-artefacts/:slug` | PASS | `client/src/components/baseline/EditArtefactDrawer.tsx:432` |
| 59 | Drawer emits `artefact.capture.started` on open | **MECHANICAL_GAP, FIXED** | Re-applied at `client/src/components/baseline/EditArtefactDrawer.tsx:417-421`. See §4. |
| 60 | `BaselineArtefactsStatusBadge.tsx` renders inline status dot + label | PASS | `client/src/components/baseline/BaselineArtefactsStatusBadge.tsx:1-33` (no count, no dashboard — inline state per CLAUDE.md frontend rule 4) |
| 61 | `SubaccountKnowledgePage.tsx` Baseline section listing six slugs with drawer trigger | PASS | `client/src/pages/SubaccountKnowledgePage.tsx:473-507` (list of `BASELINE_SLUGS`, each row with `BaselineArtefactsStatusBadge` + Edit button when completed); drawer wired at L835-843 |
| 62 | Server route `POST /api/subaccounts/:id/baseline-artefacts/:slug/skip` (Tier-3 only) | PASS | `server/routes/subaccounts.ts:846-880` (validates reason, returns 400 BASELINE_SKIP_NOT_PERMITTED for Tier 1+2) |
| 63 | Server route `PATCH /api/subaccounts/:id/baseline-artefacts/:slug` (all six) | PASS | `server/routes/subaccounts.ts:887-921` (validates payload object, calls `markArtefactEdited`) |
| 64 | `markArtefactEdited` validates payload via `ARTEFACT_FORM_SCHEMAS`, updates content, emits `artefact.capture.edited` | PASS | `server/services/subaccountOnboardingService.ts:628-717` (zod safeParse, then update memory block (Tier 1+2) or workspace memory entry (Tier 3); emits event at L709-716) |
| 65 | `shared/schemas/baselineArtefactsForms.ts` exports `ARTEFACT_FORM_SCHEMAS` for all six slugs | PASS | `shared/schemas/baselineArtefactsForms.ts:4-44` |

### 3.10 §6a Telemetry event triggers (all 5)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 66 | `artefact.capture.started` fires on wizard step entry AND drawer open | **MECHANICAL_GAP, FIXED** (drawer half) | Wizard emit: `client/src/pages/OnboardingWizardPage.tsx:597`. Drawer emit was missing — fixed at `EditArtefactDrawer.tsx:417-421` |
| 67 | `artefact.capture.completed` fires from `markArtefactCaptured` | PASS | `subaccountOnboardingService.ts:514-521` |
| 68 | `artefact.capture.skipped` fires from `markArtefactSkipped` (Tier 3 only) | PASS | `subaccountOnboardingService.ts:611-618` |
| 69 | `artefact.capture.edited` fires from `markArtefactEdited` | PASS | `subaccountOnboardingService.ts:709-716` |
| 70 | `baseline_artefact.tier_loaded` fires from tier loaders, one per injected tier-1/2 block | PASS | `server/services/agentExecutionService.ts:925-941` (one event per tier-1 and tier-2 block in `composedBlocks`) |

(Numbered 66-70 only for the per-trigger granularity; the underlying registry-vs-emit split is covered above. Each event has both registration and emit.)

---

## 4. Mechanical fixes applied

### `client/src/components/baseline/EditArtefactDrawer.tsx`

- **REQ #59 / #66 — emit `artefact.capture.started` on drawer open.** Spec §6a names "wizard step entry / drawer open" as the dual trigger for `artefact.capture.started`. The wizard already fires the event from "Start capture" but the post-onboarding edit drawer was missing the emit. Same fix the prior 2026-05-04T13-04-44Z log applied; lost in the F1 commit-bulk transition (the prior log noted the working-tree edit was unstaged because the file was untracked at run start, and it did not survive into `e15e2c58` / `794248fd`). Re-applied this run inside the existing `useEffect([open, subaccountId, slug])` block at lines 417-421. Fire-and-forget with `.catch(() => {})` so a telemetry failure cannot block the edit UI.

```ts
// Spec §6a — emit `artefact.capture.started` on drawer open. Same trigger
// semantic as the wizard's "Start capture" button. Fire-and-forget; a
// telemetry failure must never block the edit UI.
api.post(`/api/subaccounts/${subaccountId}/baseline-artefacts/started`, { slug })
  .catch(() => {});
```

---

## 5. Directional / ambiguous gaps (routed to tasks/todo.md)

### REQ #43-extension — `markArtefactSkipped` precondition is broader than spec §4B idempotency posture (DIRECTIONAL)

**Source:** plan chunk 4B step 6 — *"Skip: state-based; precondition `tier3.{slug}.status IN ('not_started')` — UPDATE WHERE that predicate. 0 rows affected = race; return 409 with the current state."*

**Implementation:** `server/services/subaccountOnboardingService.ts:586-590` only blocks `status === 'completed'` (with errorCode `ARTEFACT_ALREADY_COMPLETED`). Skipping from `in_progress` or re-skipping a `skipped` artefact is allowed.

**Why directional, not mechanical:**
- The fix requires a design choice (use `not_started`-only precondition vs the current `!completed` check; reuse `ARTEFACT_ALREADY_COMPLETED` vs introduce a generic `ARTEFACT_SKIP_PRECONDITION_FAILED`; choose between throwing inside the service vs UPDATE-WHERE returning 0-rows then re-fetch + return 409).
- The 409-with-current-state contract is not yet plumbed in the route handler (`server/routes/subaccounts.ts:867-879`) — only `BASELINE_SKIP_NOT_PERMITTED` and `INVALID_BASELINE_SLUG` are mapped.
- The state-machine §4B step 5 lists `not_started -> skipped` as the only valid skip transition, but the same section does not explicitly forbid `in_progress -> skipped` or `skipped -> skipped` — the "Forbidden" list only names transitions back FROM skipped/completed.
- The prior conformance log (2026-05-04T13-04-44Z) marked REQ #16 (skip-and-complete-later supported) PASS without flagging this — i.e. this is an existing implementation choice, not a regression.

**Suggested approach:** decide whether to tighten to `not_started`-only (matches §4B literal precondition) or relax §4B to match the current implementation (which is operationally permissive and hasn't surfaced bugs). If tightening, also wire the 409 mapping in the route handler and choose a new errorCode (e.g. `BASELINE_SKIP_PRECONDITION_FAILED`) since `ARTEFACT_ALREADY_COMPLETED` no longer captures the broader rejection.

Routed to `tasks/todo.md` under "Deferred from spec-conformance review — subaccount-artefacts (2026-05-04)".

---

## 6. Files modified by this run

- `client/src/components/baseline/EditArtefactDrawer.tsx` — re-added telemetry emit on drawer open (lines 417-421)

(All other 37 files in the changed-code set were verified read-only against the spec.)

---

## 7. Verification re-pass (Step 5)

- `npm run lint` — 0 errors, 734 warnings (same baseline as pre-fix; the new code introduced no new warnings)
- `npm run typecheck` — clean (both `tsconfig.json` and `server/tsconfig.json`)
- Re-read of `EditArtefactDrawer.tsx:408-422` confirms the telemetry emit landed inside the open-effect, fires fire-and-forget with `.catch(() => {})`, and depends on `[open, subaccountId, slug]` so it re-fires correctly when the user opens the drawer for a different artefact without unmounting

No targeted test was authored by this run (the fix is a single-line telemetry emit in non-tested client code; per `docs/spec-context.md` `frontend_tests: none_for_now`).

---

## 8. Notes for `pr-reviewer`

Two observations carried forward from the prior 2026-05-04T13-04-44Z log; still applicable:

1. The wizard's "Start capture" link emits `artefact.capture.started` only for the first incomplete artefact in the per-sub-account row, not once per artefact. The spec's table row says "wizard step entry" (singular) which is consistent with this behaviour, so it's PASS for spec conformance, but `pr-reviewer` may want to confirm this matches product intent: capturing all six artefacts in one wizard run only emits one `started` event total.
2. The `recordArtefactStarted` route requires `SUBACCOUNTS_EDIT` permission. That's correct for the in-app wizard, but if the same route is ever called from the client portal, the permission scope will need to be revisited. Out of scope for this spec.

New observation surfaced this round:

3. `EditArtefactDrawer.tsx`'s open-effect now performs two parallel side effects (content fetch + telemetry POST) without coordination. The telemetry POST does not await the fetch and is fire-and-forget — by design — but the dependency array is shared. If the user rapidly toggles the drawer for the same artefact, the telemetry fires once per toggle. Acceptable; flagged for `pr-reviewer` awareness.

---

## 9. Next step

**CONFORMANT_AFTER_FIXES.** One mechanical gap re-applied (the same drawer-open telemetry the prior conformance run flagged — lost in the F1 commit-bulk transition); one directional gap routed to `tasks/todo.md` (the `markArtefactSkipped` precondition question — design choice needed, not a surgical fix).

- Re-run `pr-reviewer` on the expanded changed-code set so the reviewer sees the final state including the re-applied `EditArtefactDrawer.tsx` edit.
- After `pr-reviewer` clears, optionally `dual-reviewer` and `adversarial-reviewer` per the user's preference, then proceed with chunk 5 (closeout) and PR creation.
- The directional gap (REQ #43-extension) does NOT block PR creation — it can be addressed in a follow-up or accepted as an explicit spec relaxation.
