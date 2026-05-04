# Sub-Account Baseline Artefact Set — Dev Spec

**Status:** DRAFT — pending `spec-reviewer`
**Last reviewed against main:** 2026-05-04 (post-merge of Workflows v1 Phase 2 / PR #258)
**Build slug:** `subaccount-artefacts`
**Branch:** `claude/subaccount-artefacts`
**Migrations claimed:** `0277` (was `0266`; reallocated after main consumed 0266-0276)
**Concurrent peers:** F2 `subaccount-optimiser` (Phase 0 / migration 0267 SHIPPED on main; Phases 1-4 pending), F3 `baseline-capture` (migrations to be reallocated to `0278-0280`)
**Related code:** `server/services/agentExecutionService.ts`, `server/services/llmService.ts`, `server/services/memoryBlockService.ts`, `server/services/workspaceMemoryService.ts`, `server/db/schema/memoryBlocks.ts`, `server/db/schema/workspaceMemories.ts`, `server/db/schema/subaccounts.ts`, `server/workflows/intelligence-briefing.workflow.ts`, `server/routes/subaccounts.ts`, `client/src/pages/OnboardingWizardPage.tsx`
**Related specs:** `docs/onboarding-playbooks-spec.md`, `docs/cached-context-infrastructure-spec.md`, `docs/memory-and-briefings-spec.md`

---

## Goal

Every sub-account produces six bounded foundational artefacts at onboarding. Any client-touching agent inherits them automatically. Tiered by load-cost so context inflation stays bounded.

## Non-goals

- Not a new memory primitive — re-uses `memory_blocks`, `workspace_memories`, `reference_documents` as-is.
- Not a replacement for the Configuration Assistant — extends its capture surface only.
- Not a content moderation system. Brand voice is a guideline, not enforced.

## Sections

- §1 Tier model
- §2 Storage model — convention over schema
- §3 Migration 0277
- §4 Tier loading wiring
- §5 Onboarding capture flow
- §6 Build chunks
  - Phase 0: Riley documentation sync
  - Phase 1: Schema + naming convention
  - Phase 2: Tier loaders
  - Phase 3: Capture workflow
  - Phase 4: Wizard extension + Knowledge UI
  - Phase 5: Verification
- §7 Files touched
- §8 Done definition
- §9 Dependencies
- §10 Risks
- §11 Concurrent-build hygiene

---

## §6 Phase 0 — Riley documentation sync

Mechanical doc updates so future sessions read Riley accurately. Folded in here because F1 also touches `agentExecutionService.ts` where Riley W2 schema (migration 0230) landed without service code. Estimated effort: 30-45 minutes. Single commit, message: `docs: sync Riley wave status — W1 shipped, W2 schema-only, W3+W4 not started`.

### Ground truth (from code audit on 2026-05-01)

| Wave | State | Evidence |
|------|-------|----------|
| W1 — naming + `invoke_automation` | SHIPPED | PR #186, migrations 0219-0222 |
| W2 — Explore/Execute mode | SCHEMA-ONLY | migration 0230 added `flow_runs.safety_mode`, `subaccount_agents.portal_default_safety_mode`, `system_skills.side_effects`. No services / routes / UI / tests. |
| W3 — context-assembly telemetry | NOT STARTED | No `context.assembly.complete` event in `server/lib/tracing.ts`; no emit in `agentExecutionService.ts`; no helper module. |
| W4 — heartbeat gate | NOT STARTED | Prep columns landed in migration 0230 (`subaccount_agents.last_meaningful_tick_at`, `ticks_since_last_meaningful_run`). Service / dispatcher / event registry / UI all pending. |

Important: the assertion that Wave 2 includes "skill-execution timing capture" is not in `docs/riley-observations-dev-spec.md`. The doc-sync must NOT propagate that error.

### Tasks

- [ ] Add a "Shipping status" header section to `docs/riley-observations-dev-spec.md` near the top (before §1) carrying the table above. Wave-by-wave callouts: §4 (naming) → mark SHIPPED; §5 (`invoke_automation`) → mark SHIPPED; sections covering Explore/Execute mode → mark SCHEMA-ONLY with the four columns from migration 0230 listed; sections covering context-assembly telemetry and heartbeat gate → mark NOT STARTED with a pointer to the per-wave plan files.
- [ ] Append a "Wave status as of 2026-05-01" section to `tasks/builds/riley-observations/progress.md`. Today the file ends at W1 closeout and says "W2-W4 deferred to subsequent waves" — update it to reflect that W2 schema landed in 0230 (list the four columns), W3 and W4 are still un-started in code. Note 0230 explicitly because it's a hybrid migration whose origin is `pre-launch-hardening` rather than the Riley build, which is why it's easy to miss.
- [ ] Header note in `tasks/builds/riley-observations/plan-w2-explore-execute-mode.md`: "Schema portion of this plan landed via migration 0230 (out-of-band, in `pre-launch-hardening` build). Service / route / UI work below has not started." List the columns that already exist so a future builder doesn't re-add them.
- [ ] Header note in `plan-w3-context-assembly-telemetry.md`: "Not started. No `context.assembly.complete` event registered in `server/lib/tracing.ts`, no emit in `agentExecutionService.ts`, no helper module."
- [ ] Header note in `plan-w4-heartbeat-gate.md`: "Not started. Two prep columns landed in migration 0230 (`subaccount_agents.last_meaningful_tick_at`, `ticks_since_last_meaningful_run`). Gate service / dispatcher / UI / event registry all pending."
- [ ] Verify `docs/capabilities.md`: search for Riley-related capability lines (Workflows / Automations vocabulary, `invoke_automation` step). Confirm shipped capabilities are stated in present tense; ensure Explore/Execute mode and heartbeat gate are NOT listed as shipped. Editorial rules apply (vendor-neutral, present-tense for shipped).
- [ ] Verify `architecture.md`: confirm naming uses `flow_runs` (not `workflow_runs`/`playbook_runs`), `automations` (not `processes`), `workflows` (not `playbooks`). Migrations 0219-0221 made these renames; any doc using old names is now wrong.
- [ ] Verify `tasks/current-focus.md` doesn't still point at Riley as the active sprint. If it does, update it.
- [ ] Append `KNOWLEDGE.md` Correction-style entry: "Riley waves ship independently. W1 shipped via PR #186 + migrations 0219-0222. W2 schema landed in migration 0230 (out-of-band from `pre-launch-hardening`); W2 services / UI did not. W3 and W4 unstarted in code. Don't conflate the four waves when reading Riley docs — check migrations and `server/lib/tracing.ts` for actual state."

### Out of scope

Do not write any new Riley code. Do not rewrite the wave plans. Do not promote/demote any wave in priority. Doc-sync only.

---

## §1 Tier model

| Tier | Artefacts | Loaded when | Token budget |
|------|-----------|-------------|--------------|
| 1 | Brand identity card; voice/tone profile | Every client-touching agent run | ~400 tokens |
| 2 | Offer/positioning summary; audience/ICP profile | Domain match (sales, content, outreach, CRM, reporting) | ~550 tokens |
| 3 | Operating constraints; proof/reference library | Semantic retrieval on demand | n/a (existing workspace memory budget) |

## §2 Storage model — convention over schema

No new tables. Naming convention on existing primitives.

**Tier 1 — `memory_blocks` rows** with reserved `name` slugs:
- `baseline.brand_identity`
- `baseline.voice_tone`

Rules: `autoAttach=true`, `status='active'`, `source='baseline_artefact'`, `confidence='high'`, `tier=1` (new column, see §3).

**Tier 2 — `memory_blocks` rows** with reserved slugs:
- `baseline.offer_positioning` — domains: `sales`, `content`, `outreach`, `crm`
- `baseline.audience_icp` — domains: `content`, `outreach`, `ads`, `reporting`

Rules: `autoAttach=false`, loaded by tier-2 loader keyed off `tier=2` + `applies_to_domains` (new TEXT[] column).

**Tier 3 — `workspace_memories` entries** under reserved `domain`/`topic`:
- `domain='baseline'`, `topic='operating_constraints'`
- `domain='baseline'`, `topic='proof_library'` — heavy items go to `reference_documents` and are linked from the memory entry.

## §3 Migration 0277

```sql
-- migrations/0277_subaccount_baseline_artefacts.sql
ALTER TABLE memory_blocks
  ADD COLUMN tier SMALLINT,
  ADD COLUMN applies_to_domains TEXT[];

CREATE INDEX memory_blocks_tier_idx
  ON memory_blocks(organisation_id, subaccount_id, tier)
  WHERE tier IS NOT NULL;

ALTER TABLE subaccounts
  ADD COLUMN baseline_artefacts_status JSONB
  DEFAULT '{"tier1":{},"tier2":{},"tier3":{}}'::jsonb;
```

`baseline_artefacts_status` shape:
```json
{
  "tier1": { "brand_identity": "pending|captured|reviewed", "voice_tone": "..." },
  "tier2": { "offer_positioning": "...", "audience_icp": "..." },
  "tier3": { "operating_constraints": "...", "proof_library": "..." }
}
```

Down-migration drops both columns + index. Both columns nullable; existing rows untouched.

---

## §4 Tier loading wiring

### Tier 1 — pin to stable prefix

`server/services/agentExecutionService.ts` line ~834. After existing `getBlocksForInjection` call, **prepend** any block where `tier=1` and `subaccount_id` matches, in deterministic order (sorted by `name`). Hash-stable so cached-context prefix-hash works.

New helper: `memoryBlockService.getTier1Blocks(orgId, subaccountId)`. Called once per run. ~30 LOC.

### Tier 2 — domain-match filter

Modify `getBlocksForInjection` to additionally fetch blocks where `tier=2` AND `applies_to_domains @> ARRAY[agentDomain]`. `agentDomain` is already derived at line 943 via `agentRoleToDomain(agent.agentRole)` — pass it down to the loader.

Existing relevance ranking stays. Tier-2 blocks join the candidate set with a small priority boost (configurable via `MEMORY_BLOCK_TIER2_BOOST`, default 0.15).

### Tier 3 — workspace memory channel

No code change. `workspace_memories` already supports domain filter (schema line 122; index line 191). Documentation update in `architecture.md` § Key files per domain to register `domain='baseline'` as a reserved keyword.

## §5 Onboarding capture flow

### New workflow file: `server/workflows/baseline-artefacts-capture.workflow.ts`

Six `user_input` steps, each with `knowledgeBindings[]` writing to the named memory block / workspace memory entry. `autoStartOnOnboarding: true`. Reuses `intelligence-briefing.workflow.ts` as template.

Step order, copy, validation:

1. **Brand identity** — 5 structured fields: `name`, `oneLiner` (160 char), `industry`, `targetCustomer`, `geography`, `stage`. Bound to `baseline.brand_identity` memory block.
2. **Voice/tone** — 3-5 descriptors (text array), 2-3 example sentences (textarea), prohibited phrases (text array), formality level (enum: casual / neutral / formal). Bound to `baseline.voice_tone`.
3. **Offer/positioning** — services list, value prop, differentiators, pricing tiers. JSON form. Bound to `baseline.offer_positioning`.
4. **Audience/ICP** — primary buyer, pain points, objections, success criteria. JSON form. Bound to `baseline.audience_icp`.
5. **Operating constraints** — hours, response-time commitments, escalation paths, compliance, languages. JSON form. Bound to workspace memory `domain='baseline'`, `topic='operating_constraints'`.
6. **Proof/reference library** — file upload + brief tags. Multi-file. Files become `reference_documents`; index entry written to workspace memory `domain='baseline'`, `topic='proof_library'`.

On terminal completion, workflow updates `subaccounts.baseline_artefacts_status` JSON via `subaccountOnboardingService.markArtefactCaptured(subaccountId, tier, slug)`.

Tier-3 capture is **optional during onboarding** — wizard offers a "skip & complete later" path. Tier-1 and Tier-2 are mandatory before wizard exits.

### Wizard UI extension

`client/src/pages/OnboardingWizardPage.tsx` currently has 4 steps (GHL connect → select clients → sync → done). Insert a new step **after sync, before done**: "Tell us about your client" — launches the baseline-artefacts-capture workflow inline.

Per-block `<EditArtefactDrawer>` accessible later from `/subaccounts/:id/knowledge` (existing surface from onboarding-playbooks-spec §6).

---

## §6 Build chunks

### Phase 1 — Schema + naming convention (~3h)

- [ ] Author migration `migrations/0277_subaccount_baseline_artefacts.sql` (+ paired `.down.sql`).
- [ ] Update `server/db/schema/memoryBlocks.ts` to add `tier: smallint('tier')`, `appliesToDomains: text('applies_to_domains').array()`.
- [ ] Update `server/db/schema/subaccounts.ts` to add `baselineArtefactsStatus: jsonb('baseline_artefacts_status').default(...)`.
- [ ] Add reserved-slug constants in `shared/constants/baselineArtefacts.ts`: slug list, tier mapping, domain mapping.
- [ ] Add `baselineArtefactsStatusSchema` (zod) in `shared/schemas/subaccount.ts`.
- [ ] Pure validator unit tests for slug/tier/domain consistency (1 file, ~10 cases).

### Phase 2 — Tier loaders (~4h)

- [ ] `memoryBlockService.getTier1Blocks(orgId, subaccountId)` — new function. Test pure ranking (deterministic order).
- [ ] Modify `memoryBlockService.getBlocksForInjection` to accept `agentDomain?: string`; fetch tier-2 candidates filtered by domain match.
- [ ] Modify `agentExecutionService.ts` line 834 region: call `getTier1Blocks` first, prepend; pass `agentDomain` to `getBlocksForInjection`.
- [ ] Telemetry event `baseline_artefact.tier_loaded` (org/subaccount/agentRole/tier/blockSlug/tokenCount) emitted from loader for cost attribution.
- [ ] Pure tests: tier-1 always loaded; tier-2 filtered by domain; tier-3 not loaded by these paths.

### Phase 3 — Capture workflow (~5h)

- [ ] Author `server/workflows/baseline-artefacts-capture.workflow.ts` with six `user_input` steps + `knowledgeBindings` writing to reserved slugs.
- [ ] `subaccountOnboardingService.markArtefactCaptured(subaccountId, tier, slug)` — updates JSONB status.
- [ ] Validator: workflow rejects completion if any tier-1 or tier-2 step skipped.
- [ ] On terminal completion, emit `baseline_artefact.captured` event per artefact.
- [ ] Integration test: full workflow run end-to-end against test sub-account (fixture data).

### Phase 4 — Wizard extension + Knowledge UI (~5h)

- [ ] Insert "Tell us about your client" step in `OnboardingWizardPage.tsx` (after sync, before done). Launches workflow inline.
- [ ] `<EditArtefactDrawer>` component accessible from `/subaccounts/:id/knowledge` for post-onboarding edits. Re-uses workflow `user_input` schema.
- [ ] `BaselineArtefactsStatusBadge` on subaccount detail page surfacing missing/captured/reviewed state per artefact.
- [ ] Skip-and-complete-later path for tier-3 (heavy content, may need time).

### Phase 5 — Verification (~2h)

- [ ] `npm run lint`, `npm run typecheck` clean.
- [ ] Unit tests pass (Phases 1-3 each ship their own test file).
- [ ] Manual: create test sub-account, run wizard end-to-end, confirm tier-1 blocks pinned to system prompt of next agent run, verify telemetry emit.
- [ ] Update `docs/capabilities.md` § Sub-account context — describe the six artefacts and tier loading.
- [ ] Update `architecture.md` § Memory and context — describe tier loader.
- [ ] Update `tasks/builds/subaccount-artefacts/progress.md` with chunk-by-chunk closeout.

---

## §7 Files touched

### Server
- `server/services/agentExecutionService.ts` (loader integration, ~30 LOC change)
- `server/services/memoryBlockService.ts` (new function + domain-filter extension, ~80 LOC)
- `server/services/subaccountOnboardingService.ts` (markArtefactCaptured, ~20 LOC)
- `server/db/schema/memoryBlocks.ts` (2 columns)
- `server/db/schema/subaccounts.ts` (1 column)
- `server/workflows/baseline-artefacts-capture.workflow.ts` (new file, ~250 LOC)
- `server/lib/tracing.ts` (2 new event names)

### Shared
- `shared/constants/baselineArtefacts.ts` (new)
- `shared/schemas/subaccount.ts` (extend)

### Client
- `client/src/pages/OnboardingWizardPage.tsx` (new step, ~100 LOC)
- `client/src/components/baseline/EditArtefactDrawer.tsx` (new, ~200 LOC)
- `client/src/components/baseline/BaselineArtefactsStatusBadge.tsx` (new, ~80 LOC)
- `client/src/pages/SubaccountKnowledgePage.tsx` (drawer wiring)

### Tests
- `server/services/__tests__/memoryBlockService.tier.test.ts`
- `server/services/__tests__/baselineArtefactsLoader.test.ts`
- `server/workflows/__tests__/baselineArtefactsCapture.test.ts`
- `shared/constants/__tests__/baselineArtefacts.test.ts`

### Docs (Phase 5 closeout)
- `docs/capabilities.md`, `architecture.md`, `KNOWLEDGE.md` (single closing entry)

## §8 Done definition

- All six artefacts capturable via wizard.
- Tier-1 blocks present in system prompt of any client-touching agent run for a sub-account that has captured them.
- Tier-2 blocks present only when agent domain matches.
- Tier-3 retrievable via existing workspace memory paths.
- Token-budget telemetry shows < 1k token impact per run for tier 1+2 combined.
- `subaccounts.baseline_artefacts_status` accurately reflects capture state.
- Riley docs (Phase 0) accurately reflect shipped/unshipped state.

## §9 Dependencies

None blocking. All upstream primitives ship today (memory blocks, workspace memories, knowledgeBindings, user_input step type, autoStartOwedOnboardingWorkflows hook, OnboardingWizardPage).

## §10 Risks

- **Token-budget regression** — tier-1 always loaded means every run pays ~400 tokens. Mitigate by hash-stable ordering (cached-context infrastructure handles prefix caching).
- **Workflow validator strictness** — making tier-1/2 mandatory blocks wizard completion. Mitigate by sensible defaults pre-filled from sub-account name + GHL data; user can edit before submit.
- **Memory-block soft conflict** — if an org already has a manual block named `baseline.brand_identity`, capture will fail. Mitigate: add unique constraint check + clear error; offer "use existing block" option in wizard.
- **Schema drift on parallel branches** — F2 and F3 each claim their own migration numbers (0267, 0268-0270). F1 must land first because the column adds are referenced by F3's baseline-status JSON shape. See §11.

## §11 Concurrent-build hygiene

- Migration number `0277` reserved here (was `0266`; reallocated after main consumed through `0276`). Do not use elsewhere.
- Branch `claude/subaccount-artefacts`. Worktree at `../automation-v1.subaccount-artefacts`.
- Progress lives in `tasks/builds/subaccount-artefacts/progress.md`.
- Touches `agentExecutionService.ts` lines ~834-870 — F3 may also touch this file but only at lines ~875-957 (briefing/beliefs region) — coordinate via merge order, F1 lands first.
- F1 must land before F3 begins (both extend `subaccountOnboardingService.ts` and `subaccounts` table area; F1 lands first because of smaller scope).
- F2 Phase 0 (the generic `agent_recommendations` primitive + `output.recommend` skill + `<AgentRecommendationsList>`) ALREADY SHIPPED on main via migration 0267 / PR #251. Phases 1-4 of F2 (telemetry rollups, optimiser agent itself, dashboard wiring, verification) remain. F2 Phases 1-4 are fully independent of F1 and can land any time in parallel.
- GHL Module C agency OAuth (was a hard upstream blocker for F3 only) shipped on main via PR #254. Does not affect F1.
