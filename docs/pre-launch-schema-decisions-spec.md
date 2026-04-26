# Pre-Launch Schema Decisions + Renames — Spec

**Source:** `docs/pre-launch-hardening-mini-spec.md` § Chunk 2
**Invariants:** `docs/pre-launch-hardening-invariants.md` (commit SHA: `1cc81656138663496a09915db28587ffd83fbddc`)
**Architect input:** `tasks/builds/pre-launch-hardening-specs/architect-output/schema-decisions.md` (commit SHA: `65494c88eb12bbaf22b2ed05ec1f29f14601f566` — final 630-line version; supersedes the 314-line partial at `d5dc0b78`)
**Implementation order:** `1 → {2, 4, 6} → 5 → 3` (Chunk 2 lands alongside Chunks 4 + 6 after Chunk 1; blocks Chunks 5 + 3)
**Status:** draft, ready for user review

---

## Table of contents

1. Goal + non-goals
2. Items closed
3. Items NOT closed
4. Key decisions (12 — pinned via architect output)
5. Files touched
6. Implementation Guardrails
7. Test plan
8. Done criteria
9. Rollback notes
10. Deferred Items
11. Review Residuals
12. Coverage Check

---

## 1. Goal + non-goals

### Goal

Lock in the schema column shapes and table-name decisions that block Riley Wave 1 today, plus close the BUNDLE-DISMISS-RLS unique-key drift and document the cached-context Option B-lite RLS posture (CACHED-CTX-DOC). After Chunk 2 lands:

- `safety_mode` exists on `workflow_runs` as a separate column from `run_mode`.
- `subaccount_agents.portal_default_safety_mode` exists for the portal-default resolution path.
- `system_skills.side_effects` exists as a top-level boolean column.
- `automations.input_schema` / `output_schema` validation is wired with `ajv` + JSON Schema draft-07.
- `agent_runs.handoff_source_run_id` write-path is implemented (both columns set on handoff runs).
- `bundle_suggestion_dismissals` unique key includes `organisation_id`.
- `docs/cached-context-infrastructure-spec.md` documents Option B-lite RLS posture as a first-class architectural decision.
- Heartbeat gate Rule 3 ("Check now") is dropped from v1.
- "Meaningful output" definition is pinned.
- DELEG-CANONICAL — `delegation_outcomes` is canonical for analytics.
- W1-6 + W1-29 already closed by surrounding work; spec re-asserts and annotates.

### Non-goals

- Implementing the heartbeat gate itself (Riley Wave 1 deliverable).
- Implementing the portal UI surface for `portal_default_safety_mode` (Wave 2/3).
- Backfilling existing `system_skills` rows with `side_effects` per-skill (separate seed-script pass).
- Migrating `agentActivityService.getRunChain` and trace-session ID logic to read `handoffSourceRunId` instead of `parentRunId` (post-launch refactor).
- Anything in mini-spec § "Out of scope".

---

## 2. Items closed

### 2.1 Already-closed items — verified state on 2026-04-26

These 2 items were closed by surrounding work between mini-spec authoring and Chunk 2 spec authoring. The Chunk 2 PR re-asserts them as invariants (already covered by invariants 2.1 and 2.2) and annotates `tasks/todo.md` with `→ verified closed; owned by pre-launch-schema-decisions-spec`.

| Mini-spec ID | todo.md line | Verified state (2026-04-26) |
|---|---|---|
| `W1-6` | 646 | Migration `0222_rename_automations_columns.sql` exists with all three `RENAME COLUMN` statements. `server/db/schema/automations.ts` declares `automationEngineId`, `parentAutomationId`, `systemAutomationId`. No legacy column-name references in `server/services/automationService.ts`. **CLOSED.** |
| `W1-29` | 647 | `server/workflows/` directory exists with `event-creation.workflow.ts`, `intelligence-briefing.workflow.ts`, `weekly-digest.workflow.ts`. No `*.playbook.ts` files remain in `server/`. **CLOSED.** |

### 2.2 Truly-open items — closed by this spec

The 10 remaining items are addressed via the architect resolutions in § 4. Each cites the architect output's section and the verbatim ≥10-word snippet from `tasks/todo.md`.

| Mini-spec ID | todo.md line | Resolution (architect output § n) |
|---|---|---|
| `F6` | 503 | § 1 — keep split (`safety_mode` separate from `run_mode`) |
| `F10` | 504 | § 2 — `subaccount_agents.portal_default_safety_mode` adopted |
| `F11` | 505 | § 3 — top-level `system_skills.side_effects boolean DEFAULT true` |
| `F15` | 506 | § 4 — ajv + JSON Schema draft-07 + permissive `additionalProperties` |
| `F21` | 507 | § 5 — drop Rule 3 from v1; ship 3-rule heartbeat gate |
| `F22` | 508 | § 6 — `status='completed' AND (action OR memory write)` |
| `WB-1` | 637 | § 7 — populate both `handoffSourceRunId` AND `parentRunId` |
| `DELEG-CANONICAL` | 332 | § 8 — `delegation_outcomes` is canonical |
| `BUNDLE-DISMISS-RLS` | 480 | § 11 — extend unique index to `(org, user, hash)` + service onConflict update |
| `CACHED-CTX-DOC` | 491 | § 12 — `docs/cached-context-infrastructure-spec.md` § RLS amendment |

---

## 3. Items NOT closed

| What | Why deferred | Where it lives |
|---|---|---|
| Heartbeat gate implementation | Riley Wave 1 deliverable; Chunk 2 only authors the column decisions | Riley Wave 1 spec |
| Portal UI for `portal_default_safety_mode` | Wave 2/3 deliverable | Riley Wave 2/3 spec |
| `system_skills.side_effects` backfill from markdown | Separate seed-script pass | Riley §6.4 audit follow-up |
| `agentActivityService.getRunChain` migration to `handoffSourceRunId` | Cross-cutting consumer migration; ships dead-code in trace-session derivation if rushed | Post-launch refactor |
| `agent_runs` Drizzle self-reference FK restoration | TS-inference wall is documented at `agent_runs.ts:219-225`; FK lives in migration only | Linked to AGENT-RUNS-SPLIT in mini-spec § Out of scope |
| Empty-schema validation behaviour for `automations.input_schema` (treat empty/null as "no schema") | Architect Open Decision; spec body confirms | § Open Decisions / Review Residuals |

---

## 4. Key decisions (per architect output)

The architect resolution document at `tasks/builds/pre-launch-hardening-specs/architect-output/schema-decisions.md` (commit SHA `d5dc0b78`) is the authoritative source for each decision below. This section gives a one-paragraph summary plus a pointer to the architect output's section. Spec implementation MUST follow the architect's resolution; deviation requires a re-pin per invariant 5.5.

### 4.1 F6 — `safety_mode` vs `run_mode` (architect § 1)

**Decision:** keep the split. New `workflow_runs.safety_mode text NOT NULL DEFAULT 'explore'` column. Existing `run_mode` (`auto|supervised|background|bulk`) stays. The two dimensions are orthogonal.

### 4.2 F10 — Portal run-mode column name (architect § 2)

**Decision:** add `subaccount_agents.portal_default_safety_mode text NOT NULL DEFAULT 'explore'` in the same migration as F6. Resolution order in `resolveSafetyMode`: parentRun → request → portal default → agent default → `'explore'` literal (5-step ladder).

### 4.3 F11 — `side_effects` storage (architect § 3)

**Decision:** top-level `system_skills.side_effects boolean NOT NULL DEFAULT true` with backfill from markdown frontmatter at seed time. Default `true` (safe) per Riley §6.4.

### 4.4 F15 — `input_schema` validator (architect § 4)

**Decision:** ajv (existing primitive) + JSON Schema draft-07 + permissive `additionalProperties` default (don't inject `false`). Best-effort skip on parse/compile failure per Riley §5.4.

### 4.5 F21 — Rule 3 "Check now" (architect § 5)

**Decision:** drop Rule 3 from v1. Heartbeat gate ships with 3 rules (renumbered 1/2/3 from former 1/2/4). Riley spec body amendment required.

### 4.6 F22 — "Meaningful" output (architect § 6)

**Decision:** `agent_run.status = 'completed' AND (action_proposed_count >= 1 OR memory_block_written_count >= 1)`. Pure helper `computeMeaningfulOutputPure()` + tx-coherent terminal-state hook in `agentRunFinalizationService.ts`.

### 4.7 WB-1 — `handoff_source_run_id` write-path (architect § 7)

**Decision:** populate BOTH `handoffSourceRunId` AND `parentRunId` for handoff runs. Spawn runs: `parentRunId` only. Both-cause runs: distinct values per invariant 1.3 of the hierarchical-delegation spec. Two file changes: `agentExecutionService.ts:179, 395-412` + `agentScheduleService.ts:115-134`.

### 4.8 DELEG-CANONICAL — Canonical truth (architect § 8)

**Decision:** `delegation_outcomes` is canonical for "what was attempted and what was the outcome." `agent_runs` telemetry columns are per-run snapshots for joins. Future analytics consumers read from `delegation_outcomes`.

### 4.9 W1-6 — Verified closed (architect § 9)

Migration 0222 + Drizzle schema already aligned. Spec annotates `tasks/todo.md` and re-asserts as invariant 2.1.

### 4.10 W1-29 — Verified closed (architect § 10)

`server/workflows/` directory + `*.workflow.ts` files already in place. Spec annotates `tasks/todo.md` and re-asserts as invariant 2.2.

### 4.11 BUNDLE-DISMISS-RLS — Unique-key vs RLS (architect § 11)

**Decision:** extend unique index to `(organisation_id, user_id, doc_set_hash)` (3-column). Service-side change at `documentBundleService.ts:378` updates `onConflictDoUpdate` target to match the new unique key. New corrective migration drops the 2-column index, adds the 3-column index. Drizzle schema at `server/db/schema/bundleSuggestionDismissals.ts:28` updates the `uniqueIndex` declaration. Spec amendment to `docs/cached-context-infrastructure-spec.md` §5.12 documents the multi-org dismissal semantics.

### 4.12 CACHED-CTX-DOC — Option B-lite documentation (architect § 12)

**Decision:** add a § "RLS Posture (Option B-lite)" subsection to `docs/cached-context-infrastructure-spec.md` documenting: (1) why DB-layer subaccount RLS is intentionally not enforced on the cached-context tables; (2) which code paths are the authority (service-layer subaccount filters); (3) what triggers reinstating the policies (real cross-subaccount data leak signal post-launch); (4) how future cached-context tables register (must add a header comment naming Option B-lite OR opt-in to DB-layer subaccount RLS in their migration).

---

## 5. Files touched

### Modified

| File | Change |
|---|---|
| `server/db/schema/workflowRuns.ts` | Add `safetyMode` column (F6) |
| `server/db/schema/subaccountAgents.ts` | Add `portalDefaultSafetyMode` column (F10) |
| `server/db/schema/systemSkills.ts` | Add `sideEffects` column (F11) |
| `server/db/schema/bundleSuggestionDismissals.ts` | Update unique-index declaration to 3-column (BUNDLE-DISMISS-RLS) |
| `server/services/agentExecutionService.ts` | `AgentRunRequest` accepts `handoffSourceRunId`; INSERT path populates it (WB-1); `resolveSafetyMode` extends with portal-default step (F10); thread `safetyMode` into workflow-run INSERT (F6) |
| `server/services/agentScheduleService.ts` | Handoff worker passes `handoffSourceRunId: data.sourceRunId` to `executeRun()` (WB-1) |
| `server/services/agentRunFinalizationService.ts` | Terminal-state hook computes `isMeaningful` and updates `subaccount_agents.last_meaningful_tick_at` (F22) |
| `server/services/systemSkillService.ts` | `createSystemSkill` / `updateSystemSkill` accept `sideEffects` (F11) |
| `server/services/invokeAutomationStepService.ts` | Pre-dispatch validation hook calls `validateInputAgainstSchema` (F15) |
| `server/services/invokeAutomationStepPure.ts` | Add `validateInputAgainstSchema` helper using ajv (F15) |
| `server/services/documentBundleService.ts:378` | Update `onConflictDoUpdate` target to include `organisationId` (BUNDLE-DISMISS-RLS) |
| `docs/cached-context-infrastructure-spec.md` | Add § "RLS Posture (Option B-lite)" subsection (CACHED-CTX-DOC) |
| `docs/cached-context-infrastructure-spec.md` §5.12 | Amend to clarify multi-org dismissal semantics (BUNDLE-DISMISS-RLS) |
| `docs/riley-observations-dev-spec.md` §4.8 column inventory | Add `safety_mode` and `portal_default_safety_mode` to inventory (F6, F10) |
| `docs/riley-observations-dev-spec.md` §6.6 resolveSafetyMode | Update 4-step ladder to 5-step (F10) |
| `docs/riley-observations-dev-spec.md` §7.4 / §7.5 | Drop Rule 3 from heartbeat gate; renumber (F21) |
| `docs/riley-observations-dev-spec.md` §7.6 / §12.17 | Pin "meaningful" definition (F22) |

### Created

| File | Purpose |
|---|---|
| New migration in Riley sequence (next available number — 0223+) | `ALTER TABLE workflow_runs ADD COLUMN safety_mode...`; `ALTER TABLE subaccount_agents ADD COLUMN portal_default_safety_mode...`; `ALTER TABLE system_skills ADD COLUMN side_effects...` plus matching `_down` reversals (F6, F10, F11) |
| New corrective migration | `DROP INDEX ... bundle_suggestion_dismissals_user_doc_set_uq; CREATE UNIQUE INDEX ... ON bundle_suggestion_dismissals (organisation_id, user_id, doc_set_hash);` plus `_down` (BUNDLE-DISMISS-RLS) |
| `server/services/__tests__/agentExecutionServicePure.test.ts` (extension) | Pure tests for handoff-run INSERT mapping (WB-1) |
| `server/services/__tests__/invokeAutomationStepPure.test.ts` (extension) | Pure tests for ajv validation (F15) |
| `server/services/__tests__/computeMeaningfulOutputPure.test.ts` | Pure tests for "meaningful" definition (F22) |

### Untouched (verified-closed scope)

- `migrations/0222_rename_automations_columns.sql` (W1-6 already done)
- `server/db/schema/automations.ts` (W1-6 already declares new column names)
- `server/workflows/*.workflow.ts` (W1-29 already done)

---

## 6. Implementation Guardrails

### MUST reuse

- `ajv` (existing primitive) — F15 validator.
- Existing `Ajv` singleton instance pattern from `agent_execution_events` validator.
- `withOrgTx` / `getOrgScopedDb` for any tenant-scoped writes.
- `actionService.proposeAction` audit trail for action-proposal counting (F22).
- Existing migration `_down.sql` convention.

### MUST NOT introduce

- A new "SchemaValidator" service. The pure helper `validateInputAgainstSchema` lives in `invokeAutomationStepPure.ts` per architect § 4.
- A new "MeaningfulOutputCalculator" service. The pure helper `computeMeaningfulOutputPure` is co-located.
- New `Ajv` configuration variants beyond the singleton with `strict: false`.
- A `safety_mode` value beyond `'explore' | 'execute'`.
- Changes to `agent_runs` Drizzle self-reference FK (per architect § 7 Open sub-question — preserves the TS-inference wall).
- Vitest / Jest / Playwright / Supertest tests (per `convention_rejections`).

### Known fragile areas

- **Migration ordering.** F6/F10/F11 schema additions land in a single migration to keep the schema-decisions PR atomic. BUNDLE-DISMISS-RLS migration is a separate corrective. WB-1 has no migration (column already exists).
- **`handoff_source_run_id` Drizzle FK.** Per architect § 7, Open sub-question — DO NOT add `.references()` to the Drizzle schema. The FK lives in migration 0216 only; the Drizzle inference wall is documented at `agent_runs.ts:219-225`.
- **`onConflictDoUpdate` target update for BUNDLE-DISMISS-RLS.** The change at `documentBundleService.ts:378` must include all three columns in the conflict target. Mismatch with the new unique index causes runtime errors.
- **Riley spec body amendments.** Many §4.6 of "Files touched" entries are Riley spec edits, not Chunk 2 code edits. Coordinate at consistency sweep (Task 6.6) so the Riley author and Chunk 2 implementation don't collide.

---

## 7. Test plan

Per `docs/spec-context.md § testing posture` (`runtime_tests: pure_function_only`, `static_gates_primary`):

### Pure unit tests (per architect output)

1. **`agentExecutionServicePure.test.ts` (extension)** — for `runSource === 'handoff'`, request maps both `parentRunId` and `handoffSourceRunId` to `data.sourceRunId`. For `runSource === 'spawn'`, only `parentRunId` is set. (WB-1 per architect § 7.)
2. **`invokeAutomationStepPure.test.ts` (extension)** — parseable+valid → `{ ok: true }`; parseable+invalid → `{ errors: [...] }`; unparseable → skip (best-effort posture). (F15 per architect § 4.)
3. **`computeMeaningfulOutputPure.test.ts` (new)** — five cases: status≠completed → false; completed+0+0 → false; completed+1+0 → true; completed+0+1 → true; completed+many+many → true. (F22 per architect § 6.)
4. **`bundleSuggestionDismissalsPure.test.ts` (or service-level pure helper)** — the `onConflictDoUpdate` target call signature uses 3 columns; collision on 2-column subset does NOT trigger the upsert path. (BUNDLE-DISMISS-RLS per architect § 11.)

### Static gates

- `verify-rls-coverage.sh` → must pass after the BUNDLE-DISMISS-RLS index update (manifest entry unchanged; index change is a corrective).
- `verify-rls-contract-compliance.sh` → must pass.
- TypeScript build → must pass (`AgentRunRequest` extension, schema column additions surface all callers).
- `npm run db:generate` → migration files validate.
- Sanity grep before commit:
  - `grep -nE "safetyMode|safety_mode" server/db/schema/workflowRuns.ts` → 1+ matches.
  - `grep -nE "portalDefaultSafetyMode|portal_default_safety_mode" server/db/schema/subaccountAgents.ts` → 1+ matches.
  - `grep -nE "sideEffects|side_effects" server/db/schema/systemSkills.ts` → 1+ matches.
  - `grep -nE "handoffSourceRunId" server/services/agentExecutionService.ts` → 2+ matches (interface + INSERT).
  - `grep -nE "organisation_id.*user_id.*doc_set_hash" server/db/schema/bundleSuggestionDismissals.ts` → 1 match.

### No new test categories

No vitest, jest, playwright, supertest, frontend tests, or e2e per `docs/spec-context.md § convention_rejections`. Pure tests only.

---

## 8. Done criteria

- [ ] F6: `safetyMode` column on `workflow_runs`; declared in Drizzle; migration adds column with default `'explore'`.
- [ ] F10: `portalDefaultSafetyMode` column on `subaccount_agents`; same migration as F6.
- [ ] F11: `sideEffects` column on `system_skills`; default `true`; same migration as F6/F10.
- [ ] F15: ajv validator helper in `invokeAutomationStepPure.ts`; called from pre-dispatch path; pure tests pass.
- [ ] F21: Riley spec amended to drop Rule 3; rule renumbered.
- [ ] F22: `computeMeaningfulOutputPure` exists; terminal-state hook updated; pure tests pass.
- [ ] WB-1: `AgentRunRequest` accepts `handoffSourceRunId`; INSERT path populates it; handoff worker passes it through; pure tests pass.
- [ ] DELEG-CANONICAL: spec body amends `docs/canonical-data-platform-roadmap.md` (or wherever DELEG-CANONICAL lives) with the canonical-truth declaration; future analytics consumers cite it.
- [ ] BUNDLE-DISMISS-RLS: corrective migration drops 2-column index, adds 3-column index; service `onConflictDoUpdate.target` updated; pure test passes.
- [ ] CACHED-CTX-DOC: `docs/cached-context-infrastructure-spec.md` § "RLS Posture (Option B-lite)" subsection added with all 6 architect-named points.
- [ ] W1-6: `tasks/todo.md:646` annotated `→ verified closed by migration 0222 + Drizzle schema; owned by pre-launch-schema-decisions-spec`.
- [ ] W1-29: `tasks/todo.md:647` annotated similarly.
- [ ] All sanity-grep checks pass.
- [ ] All static gates pass.
- [ ] PR body links spec + architect output (commit `65494c88`); test plan checked off.

---

## 9. Rollback notes

- F6/F10/F11 migration: revert via the matching `_down.sql` (drops columns). Code revert restores pre-Chunk-2 state. No data loss (columns are new; default values harmlessly disappear).
- BUNDLE-DISMISS-RLS migration: revert via `_down.sql` (re-adds 2-column index, drops 3-column). Service code revert restores pre-Chunk-2 onConflict target.
- WB-1: file revert restores `parentRunId`-only INSERT. Existing handoff runs in-flight retain their `parentRunId` value; new handoff runs lose `handoffSourceRunId` population. No data corruption.
- F15 ajv validator: file revert removes the helper; pre-dispatch validation reverts to no-validation (existing behaviour).
- F22 meaningful-output hook: file revert restores existing terminal-state behaviour. `last_meaningful_tick_at` stops advancing per the new rule; reverts to whatever the pre-existing rule was.
- F21 Riley spec amendment: revert via doc revert. Rule 3 re-appears in the heartbeat gate spec body; implementation status of the rule is independent.
- DELEG-CANONICAL: doc revert. No code impact.
- CACHED-CTX-DOC: doc revert. No code impact.

No DB data loss in any rollback path. No cross-tenant exposure risks (BUNDLE-DISMISS-RLS rollback briefly restores the 2-column unique-key drift, but RLS still scopes reads).

---

## 10. Deferred Items

- **`agentActivityService.getRunChain` migration to read `handoffSourceRunId`.** Cross-cutting consumer migration; ships dead-code in trace-session derivation if rushed. Trigger to revisit: the WB-1 implementation reveals a runtime bug in handoff-chain rendering that the existing `parentRunId` consumer misses. Resolution: post-launch refactor.
- **`agent_runs` Drizzle self-reference FK restoration.** Architect § 7 Open sub-question — TS-inference wall is documented at `agent_runs.ts:219-225`. Trigger to revisit: AGENT-RUNS-SPLIT (mini-spec § Out of scope) or a TypeScript version that handles self-references better.
- **Backfill `system_skills.side_effects` from markdown frontmatter.** Architect § 3 Open sub-question — separate seed-script pass post-migration. Trigger to revisit: any audit shows DB rows out-of-sync with markdown.
- **Empty-string input schema handling.** Architect § 4 Open sub-question — treat `inputSchema === '' || inputSchema === null` as "no schema" → skip validation. Confirmed in spec body but flagged as a directional uncertainty.

---

## 11. Review Residuals

_(Populated by user adjudication at PR review. `spec-reviewer` agent skipped per `tasks/builds/pre-launch-hardening-specs/progress.md § Workflow deviations`.)_

### HITL decisions (user must answer)

- **F6 — default for legacy `workflow_runs` rows.** Architect recommends leaving at the new `'explore'` default for safety; alternative is backfill to `'execute'`. Pre-launch posture says no live data, so the recommendation should be safe. User confirms.
- **F10 — Inheritance precedence.** 5-step ladder (parentRun → request → portal default → agent default → 'explore' literal). Architect recommendation; user confirms or amends.
- **F22 — "Action proposed but rejected" counted as meaningful.** Architect recommends yes (the proposal itself is the meaningful signal). User confirms.

### Directional uncertainties (explicitly accepted tradeoffs)

- **F11 — Default `true` (safe).** Architect picks safe-mode default; Riley §6.4 line 1046 supports it. Accepted.
- **F15 — Permissive `additionalProperties` default.** Architect picks permissive over strict for friction-light pre-launch authoring. Accepted; if production posture later wants strict, that's a Phase-2 spec amendment.
- **F21 — Drop Rule 3 entirely vs preserve as no-op.** Architect picks drop. Accepted; alternative would ship dead code.
- **WB-1 — Both columns set on handoff runs (backward-compat).** Architect picks vs. clearing `parentRunId` for handoff runs. Cross-cutting consumer migration deferred. Accepted.
- **F15 ajv compile cache scope.** Module-scoped Map without LRU. Architect notes pre-launch <100 automations per org makes unbounded fine. Accepted; cap if scale signal emerges.

---

## 12. Coverage Check

### Mini-spec Items (verbatim)

- [x] `F6` / §6.3 / §12.25 — `safety_mode` vs pre-existing `run_mode` collision — **addressed in § 4.1 (architect § 1)**.
- [x] `F10` / §6.8 / §12.13 — Portal run-mode field unnamed — **addressed in § 4.2 (architect § 2)**.
- [x] `F11` / §6.4 / §12.22 — `side_effects` runtime storage — **addressed in § 4.3 (architect § 3)**.
- [x] `F15` / §5.4–§5.5 / §12.23 — `input_schema` / `output_schema` validator + format — **addressed in § 4.4 (architect § 4)**.
- [x] `F21` / §7.4 / §12.16 — Rule 3 "Check now" trigger — **addressed in § 4.5 (architect § 5)**.
- [x] `F22` / §7.6 / §12.17 — Definition of "meaningful" output — **addressed in § 4.6 (architect § 6)**.
- [x] `WB-1` — `agent_runs.handoff_source_run_id` write-path — **addressed in § 4.7 (architect § 7)**.
- [x] `DELEG-CANONICAL` — canonical truth — **addressed in § 4.8 (architect § 8)**.
- [x] `W1-6` — Verified closed — **addressed in § 2.1 + § 4.9 (architect § 9)**.
- [x] `W1-29` — Verified closed — **addressed in § 2.1 + § 4.10 (architect § 10)**.
- [x] `BUNDLE-DISMISS-RLS` — unique-key vs RLS — **addressed in § 4.11 (architect § 11)**.
- [x] `CACHED-CTX-DOC` — Option B-lite documentation — **addressed in § 4.12 (architect § 12)**.

### Mini-spec Key decisions (verbatim)

- [x] **F6 / F10 / F11: 3 architect calls; resolves migration 0205 blockers** — **addressed in § 4.1, 4.2, 4.3**.
- [x] **WB-1: do we reuse `parentRunId` or split into a dedicated handoff edge?** — **addressed in § 4.7** (both columns, backward-compat).
- [x] **DELEG-CANONICAL: pick one truth or document the contract that keeps them aligned** — **addressed in § 4.8**.

### Final assertion

- [x] **No item from mini-spec § "Chunk 2 — Schema Decisions + Renames" is implicitly skipped.** Every cited item appears in either § 2.1 (verified closed) or § 4 (decision pinned via architect output). All 3 Key decisions are addressed in § 4.

### Mini-spec done criteria — mapped to this spec's § 8

- [x] "All ambiguous columns have names + types." — § 8 first 3 checkboxes (F6/F10/F11 columns).
- [x] "Migration 0205 unblocked." — § 8 first 3 checkboxes (the same migration carries all three; renamed to next available number per architect).
- [x] "Drizzle schema, SQL migrations, and code all use the new names." — § 8 W1-6 + W1-29 verified-closed annotations + sanity-grep.
- [x] "W1-6 grep-clean." — § 8 W1-6 annotation; verification pass already confirmed grep-clean state.
