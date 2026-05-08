# Spec: Trust & Verification Layer

**Status:** draft
**Spec date:** 2026-05-08
**Last updated:** 2026-05-08
**Author:** spec-coordinator (Claude Opus 4.7, 1M)
**Build slug:** trust-verification-layer
**Source brief:** [`tasks/builds/trust-verification-layer/brief.md`](./brief.md) (mockup rounds 1-6 complete; external review pass complete)
**Source mockups:** [`prototypes/trust-verification-layer/`](../../../prototypes/trust-verification-layer/) — index.html plus 8 screen prototypes; canonical design source for this build.
**Scope class:** Major
**Branch:** `claude/synthetos-work-primitive-improvements-P17SD`

---

## Table of contents

1. Goals, non-goals, framing assumptions
2. Glossary and terminology lock
3. Phase plan (three stages)
4. Existing-primitive search and reuse decisions
5. File inventory lock
6. Contracts
7. Permissions / RLS checklist
8. Execution model (sync/async, inline/queued, cached/dynamic)
9. Phase sequencing (dependency graph)
10. Execution-safety contracts
11. Layer 1 — Skill verification (runtime checks)
12. Layer 2 — Agent scorecards + library + model bench
13. Layer 3 — Correction-sourced auto-memory
14. UI surfaces (mockup mapping)
15. Self-consistency pass result
16. Testing posture statement
17. Deferred items
18. Open questions for operator

---

## 1. Goals, non-goals, framing assumptions

### Goals

- Ship a three-layer trust system (runtime checks → scorecards → correction memory) that compounds with model upgrades.
- Make autonomous output quality measurable, attributable, and surfaceable on existing surfaces (Operate / Run-trace, Govern, the existing Knowledge page).
- Deliver each stage as independent value: Stage 1 alone gives the operator runtime check badges on Run-trace; Stage 2 adds scorecards + bench; Stage 3 closes the correction loop into auto-memory.

### Non-goals (locked)

- **No auto-routing.** Bench output sets a default with operator approval; the platform never picks a model autonomously at runtime.
- **No first-class Policy primitive.** Allowed/forbidden action lists, approval thresholds, escalation rules, budget policies, compliance-rule objects are out of scope. Action-level invariants are captured implicitly via `blast_radius` + runtime checks.
- **No new memory primitive for Layer 3.** Layer 3 is a capture trigger plus filter on the existing `memory_blocks` table and the existing Knowledge surface.
- **No replacement for human review on high-stakes work.** Scorecards reduce routine review on Self/Tenant blast-radius actions; External blast-radius actions still respect the existing approval gate.
- **No changes to existing skill behaviour in Stage 1.** Stage 1 adds metadata only; runtime checks read after the fact.
- **No 100% sampling for the judge.** Quartile control is `Off | 25% | 50% | 75%`; if every run needs grading the right answer is a stricter scorecard, not 100%.
- **No new top-level page.** Layer 2 lands as a fourth Govern primitive (Govern / Quality) sibling to Knowledge / Spending / Connections; Layer 3 surfaces are existing Run-trace + Knowledge.

### Framing assumptions

- `pre_production: yes`, `live_users: no`. We can ship breaking changes without rollout flags. (Per `docs/spec-context.md`.)
- Testing posture: `static_gates_primary` + `runtime_tests: pure_function_only`. No vitest/jest/playwright additions for own app, no API contract tests, no frontend unit tests.
- Existing primitives override invention. Memory uses `memory_blocks`. Recommendations use `agent_recommendations`. Dispatch uses `pg-boss` via `createWorker`. Tenant isolation uses `withOrgTx` + RLS manifest entries.
- Mockups in `prototypes/trust-verification-layer/` are the design source of truth. Where mockup detail and brief disagree the brief wins; where mockup detail and spec disagree the spec wins.

---

## 2. Glossary and terminology lock

These names are canonical and apply consistently to operator UI copy, event names, metric labels, API routes, component names, and analytics. The schema field `verify` is the only developer-facing literal that retains the older name (because renaming a column adds risk for no operator gain).

| Concept | Operator name | Developer literal | Notes |
|---|---|---|---|
| Layer 1 check | **Runtime check** | `verify` (column), `runtimeCheck` (TS / API / events) | Schema column stays `verify`. All operator-facing copy and event/metric labels say "runtime check". |
| Three states the operator sees on a step | **Pass / Fail / Pending** | `pass` / `fail` / `pending` | Pending covers async-still-running, inconclusive, and verify-null skills. The five internal states (below) collapse to three for the operator. |
| Internal runtime-check states | n/a | `pass` / `fail` / `inconclusive` / `pending` / `not_applicable` | Five distinct values. Operator UI collapses `inconclusive` / `pending` / `not_applicable` into the operator-facing "Pending" badge. |
| Layer 2 evaluative object | **Scorecard** | `scorecards` table; `Scorecard` TS type | Replaces "rubric". |
| Items inside a scorecard | **Quality check** | `quality_checks` JSONB key, `QualityCheck` TS type | Replaces "dimensions" in operator copy. |
| Pass threshold per quality check | **Pass mark** | `passMark` (numeric 0..1) | Operator UI shows as `%`. Stored as 0..1. |
| Sampling rate | **How often to grade** | `gradingFrequency` enum: `off | q1 | q2 | q3` | Quartile control. Default `q1` (25%). 100% intentionally excluded. |
| Cross-scope visibility toggle | **Share with sub-accounts** | `shareWithSubaccounts` (boolean) | Single visibility primitive on system + org scorecards. Subaccount scorecards omit it entirely. |
| Authority levels at attach time | **Required / Suggested** | `attachAuthority`: `system_mandatory | org_mandatory | suggested` | At sub-account scope, system-mandatory and org-mandatory render identically as **Required** with a lock icon. The full distinction surfaces only at org-admin scope. |
| Per-action effect zone | **Blast radius** | `blastRadius`: `self | tenant | external` | The internal label `tenant` is rendered as **this account** in operator UI. The word "tenant" must not appear in operator-facing copy. |
| Layer 3 verb | **Correct** | `corrections` flow, `capturedVia: 'operator_correction'` | The only new operator-facing word for Layer 3. Reuses the existing `Edit and override` lifecycle on Knowledge for downstream review. |
| Layer 3 storage | n/a | `memory_blocks` (existing table) with new enum value | No new memory primitive. |
| Umbrella concept | **Trust & Verification Layer** | n/a | For docs and capabilities.md. |

The spec must apply this vocabulary consistently from day one. No use of "verify check" or "verify hook" in operator-facing copy, event names, or metric labels.

---

## 3. Phase plan (three stages)

### Stage 1 — Skill verification (foundational)

**Migrations**
- `0288_skills_runtime_check_columns.sql` — add `verify` (jsonb), `reversible` (boolean), `blast_radius` (text enum check) to `org_skills` and `subaccount_skills`. Backfill: `verify = NULL`, `reversible = false`, `blast_radius = 'self'` for safety.
- `0289_runtime_check_results.sql` — create `runtime_check_results` table (per-step results) with FORCE RLS + manifest entry.

**Code surface**
- `shared/types/runtimeCheck.ts` — discriminated-union check kinds (`api_status_2xx`, `row_exists`, `field_match`, `external_returns`, `custom_handler`) plus `RuntimeCheckResult` shape.
- `server/services/runtimeCheckService.ts` — orchestrator: takes a check definition + an action result + an org context, returns a `RuntimeCheckResult`. Wrapped by `withOrgTx` at the caller.
- `server/services/runtimeCheckServicePure.ts` — pure functions for each check kind.
- `server/services/skillRuntimeCheckSuggestionService.ts` — LLM-backed suggestion service for custom-skill creation flow.
- `server/services/agentExecutionService.ts` extension — emit a `runtime_check.completed` event per step, write a `runtime_check_results` row, and feed Inbox on `fail` for `external` blast-radius actions.
- `server/config/actionRegistry.ts` — extend `ActionDefinition` with `verify`, `reversible`, `blastRadius` fields. Backfill 20 most-used skills with concrete checks. Skills shipping without a check declare `verify: null` with a `verifyNullJustification` string. `verify-runtime-check-coverage.sh` CI gate enforces.
- `server/routes/skills.ts` + `server/routes/orgSkills.ts` — add `POST /api/org-skills/:id/suggest-runtime-check`, return suggestion payload to UI.
- Client: `client/src/pages/skills/SkillCreatePage.tsx` (or extend existing) — two-stage Describe → Suggest details flow.
- Client: `client/src/pages/runs/RunTracePage.tsx` — runtime-check badge per step + summary strip.

**Exit criteria**
- Every new skill PR (system, org, subaccount) carries a runtime check or `verify: null` with justification (CI gate enforces).
- Operator sees runtime-check badges on Run-trace inline.
- Failed runtime checks for external blast-radius actions pause the agent loop pending operator approval (extension of existing approval gate; not a new gate).

### Stage 2 — Agent scorecards + library + model bench

**Migrations**
- `0290_scorecards.sql` — create `scorecards` table with three-scope ownership (`scope_type`, `scope_id`), `quality_checks` jsonb, `share_with_subaccounts` boolean, FORCE RLS + manifest entry.
- `0291_agent_scorecard_attachments.sql` — create `agent_scorecard_attachments` (agent_id, scorecard_id, `attach_authority` enum, `grading_frequency` enum). FORCE RLS + manifest entry.
- `0292_scorecard_judgements.sql` — create `scorecard_judgements` (run_id, scorecard_id, quality_check_slug, pass_mark, observed_score, verdict). FORCE RLS + manifest entry.
- `0293_bench_runs.sql` — create `bench_runs` and `bench_results` tables (operator-triggered model comparison). FORCE RLS + manifest entries on both.
- `0294_system_agents_scorecard_defaults.sql` — extend `system_agents` with `default_system_scorecard_slugs` jsonb, `default_org_scorecard_slugs` jsonb. Extend `agent_templates` with `default_scorecard_slugs` jsonb. Extend `organisations` with `org_mandatory_scorecard_slugs` jsonb. (No new tables.)

**Code surface**
- `shared/types/scorecard.ts` — `Scorecard`, `QualityCheck`, `AttachAuthority`, `GradingFrequency`, `ScorecardJudgement`, `BenchRun`, `BenchResult`, `RegressionRisk` shapes.
- `server/services/scorecardService.ts` — CRUD + visibility resolution (scope-aware list with Source-pill compression at sub-account scope).
- `server/services/scorecardServicePure.ts` — pure functions: `resolveAttachedScorecards()`, `compressSourcePill()`, `computeRegressionRisk()`, `computeBenchComposite()`.
- `server/services/scorecardJudgeRunner.ts` — sampled judge runner. Subscribes to existing `agent_run.completed` execution events; sampled per-agent gradingFrequency; enqueues `scorecard:judge` job.
- `server/jobs/scorecardJudgeJob.ts` — pg-boss handler. Loads run + attached scorecard, calls judge LLM, writes `scorecard_judgements` row. Idempotent on `(run_id, scorecard_id, quality_check_slug)`.
- `server/jobs/scorecardJudgeForcedJob.ts` — forced-grade dispatcher fired when a runtime check fails (Layer 1 → Layer 2 hook) or when an operator correction lands (Layer 3 → Layer 2 hook).
- `server/services/benchRunService.ts` — operator-triggered bench orchestrator. Validates inputs, computes cost estimate, returns to client for confirmation, enqueues `bench:execute` on confirmation.
- `server/jobs/benchExecuteJob.ts` — pg-boss handler. For each candidate model × sample input pair, replays the agent run with the candidate model, scores against attached scorecards, writes `bench_results` rows. Aggregates and writes a `bench_runs.summary` row when complete.
- `server/jobs/benchRegressionReplayJob.ts` — re-runs an approved bench against a new provider model version (existing pattern — extends `regressionReplayService.ts`).
- `server/routes/scorecards.ts`, `server/routes/agentScorecards.ts`, `server/routes/benchRuns.ts`, `server/routes/governQuality.ts` — REST endpoints.
- Client: `client/src/pages/govern/QualityPage.tsx` — three tabs (Agents drift list, Scorecards library, Bench history).
- Client: `client/src/pages/govern/ScorecardLibraryTab.tsx`, `ScorecardCreatePage.tsx`, `AgentEditScorecardTab.tsx`, `ModelBenchPage.tsx`, `AgentCreateScorecardSection.tsx` (lives inside agent-create flow tabs).

**Exit criteria**
- Admin at any scope can browse the scorecard library, attach scorecards to an agent, see scoring trends per scorecard on Govern / Quality.
- Operator can run a bench on a chosen agent or skill, see the cost estimate before triggering, approve a recommended model.
- Org admin can hide system scorecards from their subaccounts via the Share-with-subaccounts toggle.
- Regression replay re-runs against approved configurations on provider model updates.

### Stage 3 — Correction-sourced auto-memory

**Migrations**
- `0295_memory_blocks_operator_correction.sql` — extend `memory_blocks.captured_via` text enum check to allow `'operator_correction'`. No structural change.

**Code surface**
- `shared/types/correction.ts` — `Correction`, `CorrectionDialogPayload`, `CorrectionPersistencePosture` shapes.
- `server/services/correctionCaptureService.ts` — writes a `memory_blocks` row with `captured_via: 'operator_correction'` and `confidence: 'low'` (per existing memory contract); links to source run + step via existing provenance fields.
- `server/services/correctionPatternDetectorPure.ts` — pure clusterer: given a window of correction memory entries, returns clusters by (skill, agent, dimension) with N >= 3.
- `server/jobs/correctionPatternDetectorJob.ts` — daily pg-boss handler; loads recent correction-sourced entries; passes through the pure clusterer; for each detected cluster, promotes a synthesised `memory_blocks` row to `status: pending_review`, `confidence: low` (existing S11 pipeline). Optionally enqueues a scorecard-tightening suggestion as an `agent_recommendations` row.
- `server/routes/corrections.ts` — `POST /api/runs/:runId/steps/:eventId/correct` — wraps `correctionCaptureService`, returns the created memory block id. Forces `withOrgTx` + permission check.
- Client: extend `RunTracePage.tsx` — inline Correct action on hover, opens Correct dialog with scope/persistence/confidence preamble (per Round 5 mockup).
- Client: extend the existing Knowledge page (consolidation Govern surface) — add `?source=corrections` filter chip, add `Source` column.

**Exit criteria**
- An operator who corrects the same mistake twice on Run-trace sees the correction reflected in the third run automatically (via memory injection through existing pipeline).
- Pattern detector promotes a `memory_blocks` row at `pending_review` when N corrections cluster.
- Knowledge page filter exposes correction-sourced entries; existing Edit/Approve/Reject controls work unchanged.

**Upstream dependencies.** Memory spec S7 (confidence-tiered HITL) and S11 (auto-synthesis from recurring entries) are already shipped. If S11 is later refactored, the pattern-detector job must adapt.

---

## 4. Existing-primitive search and reuse decisions

| Proposed primitive | Existing primitive | Decision |
|---|---|---|
| Layer 1 check storage | `agent_execution_events` already records per-step events | **Extend, not replace.** Emit `runtime_check.completed` events on the existing log; persist a normalised `runtime_check_results` row keyed on `(run_id, sequence_number, skill_slug, attempt_number)` (per §10.1; `attempt_number` reserved at v1 with DEFAULT 1) so trend queries don't re-parse the event log. |
| Layer 1 check kinds | `actionRegistry.ts` already has `IdempotencyStrategy`, `McpAnnotations` | **Extend.** Add `verify`, `reversible`, `blastRadius` to `ActionDefinition`. CI gate `verify-runtime-check-coverage.sh` enforces presence per skill. |
| Failed-check escalation | Existing `agentInbox` + approval gate via `policyEngineService` | **Reuse.** Failed external-blast-radius runtime check feeds the existing Inbox; the existing approval gate pauses the agent loop. No new gate. |
| Scorecards library | None — genuinely new | **Invent new.** Reuse failed: `agent_recommendations` is a recommendation row (action hint), not a configurable evaluation rubric. `memory_blocks` is content-shaped, not numeric-graded. New table justified. |
| Multi-attach scorecards | `subaccount_agents.skill_slugs` is an attached-list pattern | **Borrow the pattern, new table.** A scorecard is per-org-agent (not per-subaccount-link) and shared across multiple agents, so a separate `agent_scorecard_attachments` join table is correct (vs JSONB column on `agents`). |
| Sampled judge runner | `regressionReplayService.ts` already does sampled re-runs against models | **Reuse the pattern.** New service `scorecardJudgeRunner.ts` mirrors the same sampled-decision shape. New job `scorecardJudgeJob.ts` because the work item differs from regression replay. |
| Model bench | Same as above; `regressionReplayService` is the closest neighbour | **Reuse the pattern, new service.** `benchRunService` orchestrates an explicit operator-triggered comparison (not a regression replay over time). `benchRegressionReplayJob` extends the existing replay infrastructure. |
| Cost estimate before bench | `llmRequestEstimateService` exists for prompt-side cost estimation | **Reuse.** `benchRunService.estimateCost()` calls existing primitives. |
| Correction storage | `memory_blocks` with `captured_via` enum | **Extend the enum.** Add `'operator_correction'`. No new table, no new memory subsystem. |
| Correction provenance fields | `memory_blocks.source_run_id`, `lastEditedByAgentId`, `confidence`, `quality_score`, `created_at`, `updated_at` | **Reuse.** All required provenance fields already exist. Knowledge page reads existing fields. |
| Pattern-detector → memory-block promotion | Existing S11 auto-synthesis pipeline | **Reuse.** New `correctionPatternDetectorJob` wraps the existing pipeline, does not bypass it. |
| Pattern-detector → scorecard-tightening suggestion | `agent_recommendations` table with `category` + `severity` | **Reuse.** New `category: 'scorecard_tightening_suggestion'` row. Existing dedupe + acknowledge/dismiss lifecycle applies. |
| Scorecard tightening review queue | Existing Knowledge HITL queue (`status: pending_review` on `memory_blocks`) and `agent_recommendations` review | **Reuse both.** Memory pattern → memory_blocks at pending_review. Scorecard suggestion → agent_recommendations row. |

Why not reuse `agent_recommendations` for runtime-check storage: `agent_recommendations` is dedupe-on-(scope, category, dedupe_key), one-row-per-finding, dismissible. Runtime check results are per-step, append-only, retain forever for trend analysis. Different cardinality and lifecycle.

Why not reuse `memory_blocks` directly for scorecards: scorecards have numeric pass marks, version history per quality check, attach lifecycle, and a judge model. `memory_blocks` is content-shaped. Wrong primitive.

---

## 5. File inventory lock

### New migrations (8 total, numbered 0288..0295)

| # | File | Stage |
|---|---|---|
| 0288 | `migrations/0288_skills_runtime_check_columns.sql` (+ down) | 1 |
| 0289 | `migrations/0289_runtime_check_results.sql` (+ down) | 1 |
| 0290 | `migrations/0290_scorecards.sql` (+ down) | 2 |
| 0291 | `migrations/0291_agent_scorecard_attachments.sql` (+ down) | 2 |
| 0292 | `migrations/0292_scorecard_judgements.sql` (+ down) | 2 |
| 0293 | `migrations/0293_bench_runs.sql` (+ down) | 2 |
| 0294 | `migrations/0294_system_agents_scorecard_defaults.sql` (+ down) | 2 |
| 0295 | `migrations/0295_memory_blocks_operator_correction.sql` (+ down) | 3 |

### New schema files (Drizzle)

| File | Stage | Tables |
|---|---|---|
| `server/db/schema/runtimeCheckResults.ts` | 1 | `runtime_check_results` |
| `server/db/schema/scorecards.ts` | 2 | `scorecards` |
| `server/db/schema/agentScorecardAttachments.ts` | 2 | `agent_scorecard_attachments` |
| `server/db/schema/scorecardJudgements.ts` | 2 | `scorecard_judgements` |
| `server/db/schema/benchRuns.ts` | 2 | `bench_runs`, `bench_results` |

### Modified schema files

| File | Modification | Stage |
|---|---|---|
| `server/db/schema/orgSkills.ts` | Add `verify` jsonb, `reversible` boolean, `blast_radius` text | 1 |
| `server/db/schema/subaccountSkills.ts` | Same three columns | 1 |
| `server/db/schema/systemAgents.ts` | Add `default_system_scorecard_slugs` jsonb, `default_org_scorecard_slugs` jsonb | 2 |
| `server/db/schema/agentTemplates.ts` | Add `default_scorecard_slugs` jsonb | 2 |
| `server/db/schema/organisations.ts` | Add `org_mandatory_scorecard_slugs` jsonb (nullable, default `[]`) | 2 |
| `server/db/schema/memoryBlocks.ts` | Update `MemoryBlockCapturedVia` type to include `'operator_correction'` | 3 |

### New shared types

| File | Stage |
|---|---|
| `shared/types/runtimeCheck.ts` | 1 |
| `shared/types/scorecard.ts` | 2 |
| `shared/types/correction.ts` | 3 |

### New services

| File | Stage |
|---|---|
| `server/services/runtimeCheckService.ts` | 1 |
| `server/services/runtimeCheckServicePure.ts` | 1 |
| `server/services/skillRuntimeCheckSuggestionService.ts` | 1 |
| `server/services/scorecardService.ts` | 2 |
| `server/services/scorecardServicePure.ts` | 2 |
| `server/services/scorecardJudgeRunner.ts` | 2 |
| `server/services/benchRunService.ts` | 2 |
| `server/services/benchRunServicePure.ts` | 2 |
| `server/services/correctionCaptureService.ts` | 3 |
| `server/services/correctionPatternDetectorPure.ts` | 3 |

### Modified services

| File | Modification | Stage |
|---|---|---|
| `server/services/agentExecutionService.ts` | Emit runtime-check events; write runtime-check results row; route fail-on-external to existing approval gate | 1 |
| `server/config/actionRegistry.ts` | Extend `ActionDefinition`; backfill 20 most-used skills with checks; CI-enforced | 1 |
| `server/services/agentInboxService.ts` (or `agentInbox.ts`) | Route runtime-check fail (external) into Inbox | 1 |
| `server/services/regressionReplayService.ts` | Hook into `benchRegressionReplayJob` for approved bench configurations | 2 |

### New jobs

| File | Stage |
|---|---|
| `server/jobs/scorecardJudgeJob.ts` | 2 |
| `server/jobs/scorecardJudgeForcedJob.ts` | 2 |
| `server/jobs/benchExecuteJob.ts` | 2 |
| `server/jobs/benchRegressionReplayJob.ts` | 2 |
| `server/jobs/correctionPatternDetectorJob.ts` | 3 |

### New routes

| File | Stage | Endpoints |
|---|---|---|
| `server/routes/scorecards.ts` | 2 | `GET / POST / GET /:id / PATCH /:id / DELETE /:id` (+ duplicate, share-toggle) |
| `server/routes/agentScorecards.ts` | 2 | `GET /agents/:agentId/scorecards`, `POST /agents/:agentId/scorecards/attach`, `DELETE /agents/:agentId/scorecards/:scorecardId` |
| `server/routes/benchRuns.ts` | 2 | `POST / (estimate)`, `POST /:id/run`, `GET /:id`, `GET /:id/results`, `POST /:id/approve` |
| `server/routes/governQuality.ts` | 2 | `GET /quality/agents` (drift list), `GET /quality/bench-history` |
| `server/routes/corrections.ts` | 3 | `POST /runs/:runId/steps/:eventId/correct` |
| `server/routes/orgSkills.ts` (modified) | 1 | `POST /:id/suggest-runtime-check` (LLM suggestion) |
| `server/routes/skills.ts` (modified) | 1 | Add `verify` round-trip on create/update |

### New CI gates

| File | Stage | Purpose |
|---|---|---|
| `scripts/gates/verify-runtime-check-coverage.sh` | 1 | Every entry in `ACTION_REGISTRY` either has `verify` set or `verify: null` with `verifyNullJustification`. |
| `scripts/gates/verify-scorecard-rls.sh` | 2 | All five new RLS-protected tables have policy + manifest entry. |

### New permission keys (in `server/lib/permissions.ts`)

| Key | Scope | Purpose |
|---|---|---|
| `org.scorecards.view` | org | List scorecards (org + system + own subaccount-visible) |
| `org.scorecards.manage` | org | Create / edit / delete org-scope scorecards; toggle Share-with-subaccounts; set `org_mandatory_scorecard_slugs` |
| `org.scorecards.bench_run` | org | Trigger a model bench |
| `subaccount.scorecards.view` | subaccount | List scorecards visible at sub-account scope |
| `subaccount.scorecards.manage` | subaccount | Create / edit / delete subaccount-scope scorecards; attach/detach Suggested scorecards on agents |
| `subaccount.corrections.create` | subaccount | Use the Correct action on Run-trace |

System admin and org admin bypass existing check semantics.

### Modified `server/lib/permissions.ts`

Append the six new keys above to `ORG_PERMISSIONS` / `SUBACCOUNT_PERMISSIONS`.

### Modified `server/config/rlsProtectedTables.ts`

Append five new entries:
- `runtime_check_results` (migration 0289)
- `scorecards` (migration 0290)
- `agent_scorecard_attachments` (migration 0291)
- `scorecard_judgements` (migration 0292)
- `bench_runs`, `bench_results` (migration 0293)

### Modified `server/db/schema/index.ts`

Re-export the five new schema files.

### Client surfaces

| File | Stage | Notes |
|---|---|---|
| `client/src/pages/skills/SkillCreatePage.tsx` | 1 | New (or extend existing) — Two-stage Describe → Suggest details flow per Round 6 mockup. |
| `client/src/pages/runs/RunTracePage.tsx` | 1, 3 | Modified — add runtime-check badge per step, summary strip, Correct hover action (Stage 3). |
| `client/src/pages/govern/QualityPage.tsx` | 2 | New — three tabs: Agents, Scorecards, Bench history. |
| `client/src/pages/govern/ScorecardLibraryTab.tsx` | 2 | New — embedded in Quality page Scorecards tab. |
| `client/src/pages/govern/ScorecardCreatePage.tsx` | 2 | New — full-page form (or large drawer) per mockup. |
| `client/src/pages/govern/ModelBenchPage.tsx` | 2 | New — three-state page (Setup / Running / Results). |
| `client/src/pages/agents/AgentEditScorecardTab.tsx` | 2 | New — multi-attach with quartile control. |
| `client/src/pages/agents/AgentCreateScorecardSection.tsx` | 2 | New — embedded in agent create flow (Install System Agent + Create from Template tabs). |
| `client/src/pages/govern/KnowledgePage.tsx` | 3 | Modified — add "Source: from corrections" filter chip. |
| `client/src/components/runtimeCheck/RuntimeCheckBadge.tsx` | 1 | New — three-state badge (Pass / Fail / Pending). |
| `client/src/components/runtimeCheck/RuntimeCheckSummaryStrip.tsx` | 1 | New — aggregate per-run counts. |
| `client/src/components/scorecard/ScorecardSourcePill.tsx` | 2 | New — compresses at sub-account scope per Round 4. |
| `client/src/components/correction/CorrectDialog.tsx` | 3 | New — edited output + reason + scope/persistence/confidence preamble (Round 5 metadata block). |
| `client/src/lib/api/scorecards.ts`, `runtimeChecks.ts`, `benchRuns.ts`, `corrections.ts` | 1, 2, 3 | API clients. |

### Skills (Stage 1 backfill — top 20 most-used)

The 20 system skills receiving runtime checks during Stage 1 are listed in `tasks/builds/trust-verification-layer/runtime-check-coverage-list.md` (operator-confirmed during build phase). Initial seed names: `web_search`, `read_workspace`, `write_workspace`, `send_email`, `book_meeting`, `add_deliverable`, `analyse_financials`, `analyse_performance`, `audit_seo`, `audit_geo`, `capture_screenshot`, `chase_overdue`, `classify_email`, `compute_churn_risk`, `compute_health_score`, `config_create_agent`, `config_attach_data_source`, `list_connections`, `list_platform_capabilities`, `request_feature`. Final list confirmed in build phase.

---

## 6. Contracts

All boundary-crossing data shapes pinned with worked examples.

### 6.1 RuntimeCheckDefinition (skill registry)

```ts
type RuntimeCheckKind =
  | { kind: 'api_status_2xx'; expectedStatusRange?: [number, number] }
  | { kind: 'row_exists'; table: string; matchKey: string }
  | { kind: 'field_match'; outputPath: string; expectedShape: 'string' | 'number' | 'boolean' | 'date' }
  | { kind: 'external_returns'; provider: string; expectedField: string }
  | { kind: 'custom_handler'; handlerName: string };

type RuntimeCheckDefinition =
  | { verify: RuntimeCheckKind }
  | { verify: null; verifyNullJustification: string };  // mandatory if null

type SkillRegistryDelta = {
  verify: RuntimeCheckDefinition['verify'];
  verifyNullJustification?: string;
  reversible: boolean;
  blastRadius: 'self' | 'tenant' | 'external';
};
```

**Example.**
```jsonc
// send_email skill
{
  "verify": { "kind": "api_status_2xx" },
  "reversible": false,
  "blastRadius": "external"
}
```

**Producer:** developer authoring a skill (system) or admin creating a custom skill (org/subaccount). **Consumer:** `runtimeCheckService` after the action returns; CI gate `verify-runtime-check-coverage.sh`.

**Nullability.** `verify` may be `null` only when `verifyNullJustification` is set (CI-enforced).

### 6.2 RuntimeCheckResult (per-step)

```ts
type RuntimeCheckResult = {
  runId: string;
  sequenceNumber: number;             // step index in run
  skillSlug: string;
  state: 'pass' | 'fail' | 'inconclusive' | 'pending' | 'not_applicable';
  reasonCode: string;                  // machine-readable
  reasonText: string;                  // operator-readable plain English
  impact: 'blocking' | 'informational';
  suggestedFix: string | null;
  evaluatedAt: string;                 // ISO-8601 Zulu
  blastRadius: 'self' | 'tenant' | 'external';
  reversible: boolean;
};
```

**Example.**
```jsonc
{
  "runId": "f1c8...",
  "sequenceNumber": 4,
  "skillSlug": "send_email",
  "state": "fail",
  "reasonCode": "api_status_non_2xx",
  "reasonText": "Email API returned 500. The provider is rejecting the request; the email was not sent.",
  "impact": "blocking",
  "suggestedFix": "Retry in 60s; if it fails again check the provider connection on Govern / Connections.",
  "evaluatedAt": "2026-05-08T14:23:11.412Z",
  "blastRadius": "external",
  "reversible": false
}
```

**Operator-facing UI mapping.** Three-state badge: `pass` → Pass, `fail` → Fail, all of `pending | inconclusive | not_applicable` → Pending. The five-internal-states distinction is preserved at schema and event level for retries, analytics, trust reporting, benchmark validity, and operator drill-down (Run-trace step drawer shows the underlying `state` value).

**Analytics invariant (F6).** Aggregations, dashboards, trend charts, drift analytics, and trust-reporting queries MUST use the internal `state` value (`pass | fail | inconclusive | pending | not_applicable`) — never the collapsed three-state operator badge. Collapsing happens at render time only. Aggregating "Pending" obscures the difference between "still running", "verify-null skill", and "judge could not determine outcome", which makes drift detection and bench validity analysis meaningless.

**Producer:** `runtimeCheckService.evaluate()`. **Consumer:** Run-trace UI, Inbox, scorecard runner (forced grade on fail), trend dashboards.

**Source of truth.** The `runtime_check_results` row is the canonical source. The `runtime_check.completed` event in `agent_execution_events` is a debug/observability projection. Where row and event disagree the row wins.

### 6.3 Scorecard

```ts
type QualityCheck = {
  slug: string;            // stable id within scorecard, e.g. 'tone_match'
  name: string;            // operator-facing
  description: string;     // judge prompt fragment
  passMark: number;        // 0..1 (UI shows %)
  enabled: boolean;
};

type Scorecard = {
  id: string;
  scopeType: 'system' | 'org' | 'subaccount';
  scopeId: string | null;  // null for system
  name: string;
  description: string;
  qualityChecks: QualityCheck[];
  shareWithSubaccounts: boolean;  // omitted for subaccount scope
  judgeModelId: string;            // canonical model slug
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
```

**Example.**
```jsonc
{
  "id": "sc-tone-...",
  "scopeType": "org",
  "scopeId": "org-abc",
  "name": "Outreach quality",
  "description": "Quality bar for outbound emails written by Outreach Agent",
  "qualityChecks": [
    { "slug": "tone_match", "name": "Tone match", "description": "Output matches the org's brand voice", "passMark": 0.80, "enabled": true },
    { "slug": "factual_grounding", "name": "Factual grounding", "description": "All numbers and claims appear in the source brief", "passMark": 0.85, "enabled": true }
  ],
  "shareWithSubaccounts": true,
  "judgeModelId": "claude-sonnet-4-6"
}
```

**Producer:** `scorecardService.create/update`. **Consumer:** scorecardJudgeRunner, UI library + agent edit + agent create flows.

### 6.4 AgentScorecardAttachment

```ts
type AgentScorecardAttachment = {
  id: string;
  agentId: string;
  scorecardId: string;
  attachAuthority: 'system_mandatory' | 'org_mandatory' | 'suggested';
  gradingFrequency: 'off' | 'q1' | 'q2' | 'q3';  // 0%, 25%, 50%, 75%
  attachedAt: string;
};
```

**Authority resolution rule (single source of truth).** `attachAuthority` is computed at attach time:
1. If the scorecard's slug appears in `system_agents.default_system_scorecard_slugs` for the parent system agent → `system_mandatory`.
2. Else if the scorecard's slug appears in `organisations.org_mandatory_scorecard_slugs` for the org → `org_mandatory`.
3. Else if the scorecard's slug appears in `system_agents.default_org_scorecard_slugs` or `agent_templates.default_scorecard_slugs` at install time and the operator did not uncheck → `suggested`.
4. Else (operator manually attached) → `suggested`.

`system_mandatory` and `org_mandatory` rows cannot be deleted at the scope below the authority's owner. The DB constraint enforces:
- `system_mandatory` deletable only by system admin.
- `org_mandatory` deletable only by org admin.
- `suggested` deletable by any user with `subaccount.scorecards.manage` (or `org.scorecards.manage` if attached at org scope).

### 6.5 ScorecardJudgement (per-run, per-quality-check)

```ts
type ScorecardJudgement = {
  id: string;
  runId: string;
  agentId: string;
  scorecardId: string;
  qualityCheckSlug: string;
  // Scoring provenance snapshot (F1) — denormalised at judge time so historic
  // judgements remain semantically valid after the scorecard is later edited.
  qualityCheckName: string;          // snapshot of QualityCheck.name at judge time
  qualityCheckDescription: string;    // snapshot of QualityCheck.description at judge time
  passMark: number;                    // snapshot of QualityCheck.passMark at judge time
  judgeModelId: string;                // snapshot of Scorecard.judgeModelId at judge time
  scorecardUpdatedAt: string;          // snapshot of Scorecard.updatedAt at judge time
  observedScore: number;               // 0..1 from judge LLM
  verdict: 'pass' | 'fail';            // observedScore >= passMark
  judgeReasoning: string | null;
  triggerSource: 'sampled' | 'forced_runtime_check_fail' | 'forced_correction';
  judgedAt: string;
};
```

**Scoring provenance invariant (F1).** All five snapshot fields above MUST be written at judgement time and are immutable thereafter. Trend lines, replay comparisons, drift analytics, and regression analysis read these snapshots — they do NOT join back to the live `scorecards` row. This is not full version history (deferred per §17) but it is sufficient to keep historic verdicts semantically comparable when the underlying scorecard is later edited.

**Producer:** `scorecardJudgeJob`. **Consumer:** trend dashboards, drift detector, regression replay.

### 6.6 BenchRun + BenchResult

```ts
type RegressionRisk = 'low' | 'medium' | 'high';

type BenchRun = {
  id: string;
  organisationId: string;
  triggerScopeType: 'org' | 'subaccount';
  triggerScopeId: string;
  mode: 'agent_bench' | 'skill_bench';
  targetAgentId: string | null;     // when mode='agent_bench'
  targetSkillSlug: string | null;   // when mode='skill_bench'
  candidateModels: string[];         // canonical model slugs
  sampleCount: number;               // 1..50
  testInputSource: 'recent_real_runs' | 'paste_in';
  testInputs: string[];              // run IDs OR raw prompt strings
  estimatedCostCents: number;
  status: 'estimating' | 'awaiting_confirm' | 'running' | 'completed' | 'partial' | 'failed';
  summary: BenchSummary | null;
  triggeredByUserId: string;
  startedAt: string | null;
  completedAt: string | null;
  approvedModelId: string | null;
};

type BenchResult = {
  id: string;
  benchRunId: string;
  candidateModelId: string;
  meanScore: number;        // 0..1
  variance: number;         // 0..1
  meanLatencyMs: number;
  totalCostCents: number;
  regressionRisk: RegressionRisk;
  passesAllPassMarks: boolean;
  rawJudgementIds: string[];   // F2: foreign-key list to scorecard_judgements.id; details fetched lazily
};

type BenchSummary = {
  recommendedModelId: string | null;  // composite winner: cheapest that clears all pass marks AND risk != high
  reason: string;                       // operator-readable
};
```

**Regression risk thresholds.**
- `low`: variance < 0.05 AND sampleCount >= 5
- `medium`: 0.05 <= variance < 0.15 OR (variance < 0.05 AND sampleCount < 5)
- `high`: variance >= 0.15

(Resolves [Directive 4 from brief §12](./brief.md). Operator can change thresholds via spec amendment, not via UI.)

**Composite winner.** Cheapest candidate where `passesAllPassMarks: true` AND `regressionRisk != 'high'`. If no candidate qualifies, `recommendedModelId: null` and `reason` explains.

### 6.7 Correction (capture payload)

```ts
type CorrectionDialogPayload = {
  runId: string;
  eventId: string;          // agent_execution_events.id (the corrected step)
  agentId: string;
  skillSlug: string;
  originalOutput: string;
  editedOutput: string;
  reason: string | null;    // optional operator note
};
```

**Persistence posture (operator-visible).** All corrections are scoped `This agent only`, persistence `Active on next run` (memory entry available immediately to memory retrieval), confidence `High signal` (initially `confidence: 'low'` in the existing schema vocabulary because the row is single-instance until the pattern detector promotes; the dialog calls this "High signal — applied immediately, but listed under Knowledge where you can edit, override, or reject").

**Memory block written.**
```jsonc
{
  "name": "Correction: <skill_slug> output (<short timestamp>)",
  "content": "<editedOutput>\n\n[Reason: <reason>]",
  "captured_via": "operator_correction",
  "owner_agent_id": "<agentId>",
  "source_run_id": "<runId>",
  "confidence": "low",
  "quality_score": 0.85,
  "status": "active",
  "is_read_only": false
}
```

**Producer:** `correctionCaptureService.create()`. **Consumer:** existing memory injection pipeline; existing Knowledge page; pattern detector job.

### 6.8 Source-pill compression rule

```ts
function compressSourcePill(scope: 'system' | 'org' | 'subaccount', viewerScope: 'org_admin' | 'subaccount'): 'system' | 'organisation' | 'this_subaccount' | 'platform' | 'custom' {
  if (viewerScope === 'org_admin') return scope === 'system' ? 'system' : scope === 'org' ? 'organisation' : 'this_subaccount';
  // sub-account viewer
  return scope === 'system' ? 'platform' : 'custom';
}
```

**Tooltip on `custom` at sub-account scope:** `"Created by <Organisation name>"` for org-owned; `"Created in this sub-account"` for subaccount-owned.

---

## 7. Permissions / RLS checklist

### New tables (5) — RLS posture

All five new tables must have:
1. RLS policy in the same migration that creates the table.
2. Entry in `server/config/rlsProtectedTables.ts`.
3. Route-level or middleware guard.
4. Principal-scoped context if read from an agent execution path.

| Table | Migration | RLS policy | Manifest entry | Route guard | Principal-scoped context |
|---|---|---|---|---|---|
| `runtime_check_results` | 0289 | `app.organisation_id` = `organisation_id` (FORCE RLS) | new entry | `requireSubaccountPermission('subaccount.runs.view')` (existing) | yes — read by Run-trace UI; written by `agentExecutionService` inside `withOrgTx` |
| `scorecards` | 0290 | `app.organisation_id` IS NULL OR `app.organisation_id` = `organisation_id` (system rows readable everywhere; org/subaccount filtered) | new entry | `requireOrgPermission('org.scorecards.view')` or `requireSubaccountPermission('subaccount.scorecards.view')` | yes — read by `scorecardJudgeRunner` inside the run path |
| `agent_scorecard_attachments` | 0291 | tenant-isolated via FK to `agents.organisation_id` | new entry | `requireOrgPermission('org.agents.edit')` for write; view permission via existing agent permissions | yes — read by `scorecardJudgeRunner` |
| `scorecard_judgements` | 0292 | `app.organisation_id` = `organisation_id` (FORCE RLS) | new entry | view via `subaccount.runs.view` or `org.observability.view` | yes — written by judge job inside `withOrgTx` |
| `bench_runs`, `bench_results` | 0293 | `app.organisation_id` = `organisation_id` (FORCE RLS) | two new entries | `requireOrgPermission('org.scorecards.bench_run')` for trigger; view via same | yes — read by `benchExecuteJob` |

System-scope `scorecards` rows (with `organisation_id IS NULL`) are world-readable inside the platform but not editable below system admin scope. Editing path uses `requireSystemAdmin` middleware.

### Modified tables — RLS impact

`org_skills`, `subaccount_skills` already have RLS. The three new columns (`verify`, `reversible`, `blast_radius`) inherit the existing policy. No new manifest entry needed (existing entries cover the modified tables).

`memory_blocks` already has RLS. Enum extension on `captured_via` does not change the policy. No new manifest entry.

### Cross-tenant invariants to preserve

- A subaccount admin attempting to fetch an org-scope scorecard the org admin has hidden (`shareWithSubaccounts: false`) must get an empty result (not a 403, not a leak). Enforced at the service layer (`scorecardService.list()` filters before returning).
- Pattern detector job processes corrections per-org via `withOrgTx(orgId)`; cross-tenant clustering is impossible.
- Bench results from one org are never visible to another. RLS on `bench_runs` + `bench_results` handles it.

---

## 8. Execution model (sync/async, inline/queued, cached/dynamic)

| Capability | Model | Notes |
|---|---|---|
| Layer 1 runtime check evaluation | **Inline / synchronous** | Runs immediately after the action returns inside `agentExecutionService`. Latency budget: <50ms for the four built-in kinds; `custom_handler` may be slower. No pg-boss row. |
| Layer 1 runtime check fail → Inbox | **Inline (event emit) → existing Inbox handler async** | Reuses existing async path. |
| Layer 1 LLM-suggested check generation (custom skill creation) | **Inline / synchronous** with timeout 8s | One-shot LLM call. Cached per-skill-description hash for 30 days to avoid re-suggestion churn. |
| Layer 2 sampled judge | **Queued / asynchronous (pg-boss `scorecard:judge` queue)** | Decoupled from agent run completion. Idempotent. Single-writer-per-(run, scorecard, qc-slug). |
| Layer 2 forced judge (on runtime check fail or correction) | **Queued / asynchronous (pg-boss `scorecard:judge:forced` queue)** | Separate queue so forced grades don't starve sampled grades. |
| Layer 2 model bench execute | **Queued / asynchronous (pg-boss `bench:execute` queue, dedicated)** | Long-running. Single-writer-per-bench-run. Survives restarts. |
| Layer 2 cost estimation | **Inline / synchronous** | Returned to the UI before the operator confirms Run bench. |
| Layer 2 regression replay | **Queued / asynchronous (existing `regression:replay` queue extended)** | Already-existing primitive. New job kind. |
| Layer 3 correction capture | **Inline / synchronous** | One memory_blocks row insert + one event emit. Returns immediately. |
| Layer 3 pattern detector | **Queued / asynchronous (pg-boss `correction:pattern-detect` queue, daily)** | Idempotent on (org, window-end). |

**No prompt-partition changes.** None of the new behaviour writes to the LLM prompt assembly. Existing partitions unchanged.

---

## 9. Phase sequencing (dependency graph)

| Stage | Depends on | Migrations | Schema modules | Services introduced |
|---|---|---|---|---|
| Stage 1 | None | 0288, 0289 | `runtimeCheckResults` schema | `runtimeCheckService`, `runtimeCheckServicePure`, `skillRuntimeCheckSuggestionService` |
| Stage 2 | Stage 1 (forced grade hook reads `runtime_check_results`) | 0290, 0291, 0292, 0293, 0294 | `scorecards`, `agentScorecardAttachments`, `scorecardJudgements`, `benchRuns` | `scorecardService(+Pure)`, `scorecardJudgeRunner`, `benchRunService(+Pure)`, jobs |
| Stage 3 | Stage 1 (Correct dialog sits next to runtime-check badge); Stage 2 optional (forced grade on correction is no-op if no scorecard attached) | 0295 | `memoryBlocks` (modified type only) | `correctionCaptureService`, `correctionPatternDetectorPure`, `correctionPatternDetectorJob` |

**No backward references.** Every column referenced by code in Stage N is created in Stage N or earlier.

**No orphaned deferrals.** Items called out as "out of scope" in the brief (auto-routing, Policy primitive, adaptive sampling) are listed in §17 Deferred Items, not silently left in prose.

**No phase-boundary contradictions.** Each migration ships in exactly the stage that introduces the column or table it touches.

---

## 10. Execution-safety contracts

### 10.1 Idempotency posture per write path

| Write | Posture | Mechanism |
|---|---|---|
| `runtime_check_results` insert (per step) | **key-based** | Unique constraint `(run_id, sequence_number, skill_slug, attempt_number)` (F3 — `attempt_number` integer NOT NULL DEFAULT 1, reserved for future retry semantics; v1 always writes 1). Re-emission ignored via `ON CONFLICT DO NOTHING`. |
| `scorecard_judgements` insert (sampled) | **key-based** | Unique constraint `(run_id, scorecard_id, quality_check_slug, trigger_source)`. |
| `scorecard_judgements` insert (forced) | **key-based** | Same unique constraint as above; `trigger_source` discriminates. |
| `bench_runs` insert | **key-based** | Unique constraint `(triggered_by_user_id, target_agent_id_or_skill, started_at_minute)` — guards against double-click. UI also debounces. |
| `bench_results` insert | **key-based** | Unique constraint `(bench_run_id, candidate_model_id, sample_index)`. |
| `memory_blocks` insert (correction) | **key-based** | Unique constraint `(organisation_id, source_run_id, captured_via)` filtered to `captured_via = 'operator_correction'`. Re-clicking Correct on the same step replaces existing row (UPDATE) rather than inserting duplicate. |
| Correction-pattern-promoted memory block | **key-based** | Existing S11 dedupe applies (content-hash). |

### 10.2 Retry classification

| Operation | Class | Boundary |
|---|---|---|
| Runtime check evaluation | **safe** (read-only or idempotent comparison) | n/a |
| LLM check suggestion | **guarded** | Cached on description-hash; LLM call retried via `withBackoff`. |
| Sampled judge job | **guarded** | Idempotency key on row; retry via pg-boss. |
| Forced judge job | **guarded** | Same. |
| Bench execute job | **guarded** | Per-(model, sample-index) retry; partial completion tolerated. |
| Regression replay | **guarded** | Reuses existing primitive's retry contract. |
| Correction capture | **guarded** | UPSERT on `(organisation_id, source_run_id, captured_via)`. |
| Pattern detector job | **safe** | Read-only with idempotent insert into existing pipeline. |

### 10.3 Concurrency guards for racing writes

- **Two correctors edit the same step concurrently.** UPSERT pattern: `INSERT ... ON CONFLICT (organisation_id, source_run_id, captured_via) WHERE source_run_id IS NOT NULL DO UPDATE SET content = EXCLUDED.content, updated_at = now()`. Last write wins; both writers see their result on read.
- **Two operators trigger a bench on the same agent within the same minute.** Unique constraint above; second request returns 409 with `existingBenchRunId` so the UI can navigate to the running bench. **Loser sees:** banner "A bench is already running for this agent — view it here."
- **Two judge jobs claim the same (run, scorecard, qc-slug).** Unique constraint with `ON CONFLICT DO NOTHING`; second job exits silently (no-op). No partial data.
- **Two bench-execute workers claim the same bench-run.** Use `FOR UPDATE SKIP LOCKED` on `bench_runs` row; only one worker updates `status: 'running'`.
- **Pattern detector races with manual memory_block edit.** Pattern detector inserts at `status: 'pending_review'`; manual edit on a different row is unaffected. Existing memory-blocks `active_version_id` mechanism handles content racing.

### 10.4 Terminal event guarantee

Each cross-flow chain emits exactly one terminal event:

| Chain | Terminal event | Status field values |
|---|---|---|
| Runtime check on a step | `runtime_check.completed` | `pass | fail | inconclusive | not_applicable` |
| Sampled judge on a run × scorecard × qc | `scorecard_judgement.recorded` | `pass | fail` |
| Forced judge | Same as sampled; `trigger_source` distinguishes | Same |
| Bench execute | `bench_run.completed` (success) OR `bench_run.failed` (zero candidates produced any judgements) OR `bench_run.partial` (some candidates succeeded, some failed but quorum met) | `success | partial | failed` |
| Correction capture | `correction.captured` | always `success` (write is small + transactional) |
| Pattern detector | `correction_pattern.promoted` (per cluster) OR `correction_pattern.cycle_completed` (no clusters this cycle) | per-cluster status |

**Post-terminal prohibition.** No further events with the same `(runId, sequenceNumber, skillSlug)` for runtime checks; no further events with the same `(benchRunId)` after the bench-run terminal.

### 10.5 No-silent-partial-success

- Bench execute: if any candidate model fails entirely (zero successful samples), but at least one candidate succeeds, the bench run terminates with `status: 'partial'` and the failed candidate is omitted from `summary.recommendedModelId`. Operator-readable reason: "Model X failed all samples; comparing remaining candidates."
- Pattern detector: if memory-block promotion succeeds but the optional scorecard-tightening suggestion enqueue fails, terminal event is `partial` with a logged reason. Memory-block promotion is the load-bearing outcome.

### 10.6 Unique-constraint to HTTP mapping

| Constraint | Violation maps to |
|---|---|
| `runtime_check_results` `(run_id, sequence_number, skill_slug, attempt_number)` | 200 (idempotent — silently ignored on re-emission) |
| `scorecard_judgements` `(run_id, scorecard_id, quality_check_slug, trigger_source)` | 200 (idempotent) |
| `bench_runs` `(triggered_by_user_id, target_..., started_at_minute)` | 409 with `existingBenchRunId` |
| `bench_results` `(bench_run_id, candidate_model_id, sample_index)` | 200 (idempotent) |
| `memory_blocks` correction unique | 200 (UPSERT — last write wins) |
| `scorecards` name unique within scope | 422 with `errorCode: 'SCORECARD_NAME_TAKEN'` |
| `agent_scorecard_attachments` `(agent_id, scorecard_id)` | 409 with `errorCode: 'SCORECARD_ALREADY_ATTACHED'` |

No `23505 unique_violation` bubbles as a 500. The asyncHandler error mapper translates each code per `server/lib/asyncHandler.ts`.

### 10.7 State machine closure

**`bench_runs.status`** valid transitions:
- `estimating → awaiting_confirm` (cost estimate complete)
- `awaiting_confirm → running` (operator approves)
- `awaiting_confirm → failed` (operator cancels with `cancelled` reason)
- `running → completed` (all candidates succeeded)
- `running → partial` (some candidates failed, quorum met)
- `running → failed` (no candidates produced any judgements)

**Forbidden:** `completed → running`, `failed → completed`, `partial → completed`. State set is closed; new states require spec amendment.

**`runtime_check_results.state`** valid transitions:
- `pending → pass | fail | inconclusive | not_applicable` (one-shot evaluation)
- All terminal states are terminal — no transitions out. Re-evaluation creates a new row keyed by `attempt_number` (column reserved at v1 with DEFAULT 1 and included in the uniqueness constraint per §10.1; retry orchestration deferred per §17).

State set is closed.

**`scorecard_judgements.verdict`** is computed from `observed_score >= pass_mark` at write time and is immutable. No state machine.

---

## 11. Layer 1 — Skill verification (runtime checks)

### 11.1 Trigger and dispatch

After every action call inside `agentExecutionService.dispatchAction()`:

```ts
const result = await invokeAction(action, ctx);
const runtimeCheck = await runtimeCheckService.evaluate({
  skillSlug: action.actionType,
  ctx,
  actionResult: result,
});
await persistRuntimeCheckResult(runtimeCheck);   // inside same withOrgTx
emitEvent('runtime_check.completed', { ...runtimeCheck });
if (runtimeCheck.state === 'fail' && action.blastRadius === 'external') {
  await pauseRunPendingApproval(runId, runtimeCheck);  // existing approval gate
}
```

### 11.2 Failure handling matrix (decision)

| `blastRadius` | `state: 'fail'` outcome |
|---|---|
| `self` | Informational. Surfaced on Run-trace, fed to Inbox, agent loop continues. |
| `tenant` | Informational by default. If the action is irreversible (`reversible: false`), pause for approval. |
| `external` | Always pause. Existing approval gate handles the operator confirmation. |

`state: 'inconclusive'` follows the same matrix as `'fail'` with the addition that the Inbox detail surfaces `"check could not determine outcome"` so operator action is informed.

`state: 'not_applicable'` (skills with `verify: null`) is informational only — no Inbox feed, no pause. Counts toward the Pending bucket on the operator-facing badge.

### 11.3 Custom skill creation flow (Stage 1 spec)

Two-stage Describe → Suggest details flow per Round 6 mockup. The skill creation form has a single description textarea and a **Suggest details** action that calls `POST /api/org-skills/:id/suggest-runtime-check` (or the create variant):

1. Operator types description (e.g., "Sends a customer SMS via Twilio").
2. Click **Suggest details**. Server returns: `{name, blastRadius, reversible, suggestedCheck: { kind, parameters }, plainEnglish}` (response shape pinned in `shared/types/runtimeCheck.ts`).
3. Operator reviews, clicks one of three radio options:
   - **Use suggested check** (default).
   - **Edit** (Advanced disclosure expands to show editable code/JSON).
   - **No deterministic check possible** (requires `verifyNullJustification` text, min 20 chars).
4. **Re-suggest** affordance: if the operator changes the description, a button surfaces to re-trigger the suggestion.
5. Save. Cannot save without one of the three radio options selected.

LLM suggestion call specifics:
- Prompt: "Given this skill description and API contract, suggest a deterministic post-action check. Return JSON: `{kind, parameters, plainEnglish}`."
- Cache: 30-day on `sha256(description + apiSpec)`.
- Cost: counted against the org's token budget; estimate shown before triggering for cold cache.

### 11.4 CI gate

`scripts/gates/verify-runtime-check-coverage.sh`:
- Iterates `ACTION_REGISTRY` entries.
- For each entry, asserts either `verify` is set OR `verifyNullJustification` is a non-empty string.
- Fails the build with a list of skills missing both.

### 11.5 Timeout and cancellation semantics (M4)

Runtime checks run inline inside `agentExecutionService.dispatchAction()` with a `<50ms` target latency. Operational rules:

- **Hard timeout.** Each runtime-check evaluation MUST be wrapped in a timeout (default `RUNTIME_CHECK_TIMEOUT_MS = 250`). On timeout, the check resolves to `state: 'inconclusive'` with `reasonCode: 'check_timed_out'` and `reasonText: "Runtime check did not complete within the time budget."` — never `state: 'fail'`. Distinguishing "check timed out" from "check determined the action failed" is essential for trust analytics: timeouts are operational signal, fails are correctness signal.
- **Cancellation.** If the parent run is cancelled mid-action, in-flight runtime checks are abandoned (no row written) — they are inline to the action, not separately persisted, so cancellation is structural.
- **Provider transient failures.** If a runtime check that calls an external provider (e.g. `external_returns` kind) fails due to a transient network error, the check resolves to `state: 'inconclusive'` (not `'fail'`). Retry orchestration is deferred (§17); v1 surfaces the inconclusive state to the operator with `suggestedFix` describing the underlying error.
- **Inconclusive treatment.** Per §11.2, `inconclusive` follows the same blast-radius matrix as `fail` for approval-gating decisions, but the Inbox detail surfaces the timeout/transient distinction so the operator can act on the correct root cause.

---

## 12. Layer 2 — Agent scorecards + library + model bench

### 12.1 Scorecard library scoping (single source of truth)

`scorecardService.listForViewer({ viewerScope, viewerOrgId, viewerSubaccountId })`:

```pseudo
let rows = []
rows += scorecards where scope_type = 'system' AND deleted_at IS NULL
                            AND (share_with_subaccounts = true OR viewerScope = 'org_admin')
rows += scorecards where scope_type = 'org' AND scope_id = viewerOrgId
                            AND (share_with_subaccounts = true OR viewerScope = 'org_admin')
                            AND deleted_at IS NULL
if viewerScope = 'subaccount':
  rows += scorecards where scope_type = 'subaccount' AND scope_id = viewerSubaccountId
                              AND deleted_at IS NULL
return rows.map(applySourcePillCompression(viewerScope))
```

### 12.2 Multi-attach lifecycle

Attach: `POST /api/agents/:agentId/scorecards/attach { scorecardId, attachAuthority?, gradingFrequency? }`.
- `attachAuthority` optional; computed via §6.4 rule if omitted.
- `gradingFrequency` optional; defaults to `'q1'` (25%).

Detach: `DELETE /api/agents/:agentId/scorecards/:scorecardId`.
- Forbidden when attachment authority is `system_mandatory` (only system admin) or `org_mandatory` (only org admin).

Edit pass marks per-attach: **deferred** (see §17). Pass marks live on the scorecard, not the attachment.

### 12.3 Sampled judge runner

Subscribes to `agent_run.completed` events on existing `agent_execution_events` log:
1. Load attached scorecards for the agent.
2. For each scorecard, sample with probability matching `gradingFrequency`:
   - `off` → 0
   - `q1` → 0.25
   - `q2` → 0.50
   - `q3` → 0.75
3. If sampled, enqueue `scorecard:judge` job.

Forced grading skips sampling and enqueues directly:
- Runtime check `state === 'fail'` AND blast_radius != 'self' → enqueue `scorecard:judge:forced` for all attached scorecards.
- Correction captured → enqueue `scorecard:judge:forced` for all attached scorecards on the corrected agent (validates correction clears the floor).

### 12.4 Model bench (operator-triggered)

Page states per Round 4 mockup:
- **Setup.** Mode (Agent / Skill), candidate models, sample count, test inputs, cost estimate, Run bench.
- **Running.** Per-candidate progress, ETA, abort.
- **Results.** Comparison table, recommended row highlighted, regression-risk pill, Approve as default action.

Test-input picker:
- **Recent real runs (default).** Multi-select list with quick-pick affordances ("Pick newest 15", "Clear all"). Replays the run's inputs against the candidate models.
- **Paste-in.** Defaults to one prompt card. Operator clicks **Add Prompt** to grow the set.

Cost estimate is computed in `benchRunServicePure.estimateCost()` from candidate-count × sample-count × token-estimate × judge-cost-estimate. Labelled with billing scope ("charged to this account's token budget").

Approve flow: operator clicks **Approve as default** on a candidate row. `bench_runs.approved_model_id` is set; the operator's confirmation kicks an event for downstream agent-config update (operator's choice, not autonomous).

**Approval atomicity invariant (F5).** Setting `bench_runs.approved_model_id` AND updating the agent's default model MUST occur in a single transaction boundary (`withOrgTx`). If the agent-config update fails, the transaction rolls back the `approved_model_id` write. If atomic update is impossible (e.g. cross-service write), the service emits a compensating `bench_approval_failed` event AND reverts `approved_model_id` to its prior value — never leaves the system in a "UI says approved, agent unchanged" split-brain state. The operator-facing UI reads `approved_model_id` after the terminal event fires, never optimistically.

**Judge ≠ candidate invariant (M2).** The judge model used to score a bench run MUST NOT default to any model in the bench's `candidateModels` set unless the operator explicitly opts in via the Setup form. Default behaviour: if the scorecard's `judgeModelId` appears in `candidateModels`, `benchRunService.estimateCost()` substitutes the org-default judge model and surfaces a notice on the Setup screen ("Judge model swapped to <X> to avoid self-grading bias"). Prevents inflated scores from a model grading its own outputs.

**Server-side cost cap (M3).** Independent of the operator UX confirmation in §18 Q3, a hard server-side cost cap is enforced via the `BENCH_MAX_COST_CENTS` env var (default: 5000 cents = $50/run). Bench runs whose `estimatedCostCents` exceeds the cap return 422 with `errorCode: 'BENCH_COST_CAP_EXCEEDED'` and never enter the `awaiting_confirm` state. Protects against malformed requests, accidental loops, and any future automation that bypasses the UI confirmation.

Regression replay: when a provider model version updates (existing event in the regression service), enqueue `bench:regression-replay:{benchRunId}` for every approved bench. If new mean score drops > 5% below the original approved bench's mean, an `agent_recommendations` row is emitted (category: `bench_regression_alert`, severity: `warn`).

### 12.5 Authority levels at attach time (UI rendering)

Per Round 4 mockup decision:

| Viewer | system_mandatory render | org_mandatory render | suggested render |
|---|---|---|---|
| sub-account operator | "Required" with lock icon, caret-expandable | "Required" with lock icon, caret-expandable (identical to system_mandatory) | "Suggested" (no source attribution) |
| org admin | "System-mandatory (locked)" | "Org-mandatory (you can edit)" | "Suggested by Platform" or "Suggested by Organisation" (full attribution) |

Lock-icon rows expand to read-only quality-check details (name, description, pass mark).

---

## 13. Layer 3 — Correction-sourced auto-memory

### 13.1 Correct dialog (per Round 5 mockup)

Triggered by hover on a step output in Run-trace. Modal contents:
- **Edited output** textarea (multi-line, prefilled with the original output).
- **Reason** textarea (optional, max 500 chars).
- **About this correction** metadata block (system-rendered, not editable):
  - **Scope:** "This agent only"
  - **Persistence:** "Active on next run"
  - **Confidence:** "High signal — applied immediately, listed under Knowledge where you can edit, override, or reject"
- Save / Cancel buttons.

### 13.2 Capture flow

`correctionCaptureService.create({runId, eventId, agentId, skillSlug, originalOutput, editedOutput, reason})`:
1. Inside `withOrgTx(orgId)`:
   - Insert (or UPSERT on collision) into `memory_blocks` per §6.7 example shape.
   - Emit `correction.captured` event.
2. If any scorecards attached to the agent: enqueue forced `scorecard:judge:forced` (§12.3) so the corrected output is auto-evaluated and confirms it clears the pass-mark floor.
3. Return the new memory_block id to the UI for confirmation toast.

### 13.3 Pattern detector

`correctionPatternDetectorJob` runs daily per-org via `withOrgTx`:
1. Load correction-sourced memory_blocks created in last N days (default 30).
2. Pass into `correctionPatternDetectorPure.cluster()`:
   - **V1 clustering algorithm (pinned per F4).** Group candidates by exact match on `agent_id` AND `skill_slug`. Within each group, compute pairwise cosine similarity over an embedding of `editedOutput` produced by the existing memory-embedding model (single source of truth — no new embedding model introduced). Form clusters where pairwise cosine similarity ≥ `0.82`. Minimum cluster size: `3` entries within the lookback window (default 30 days).
   - The two thresholds (similarity ≥ 0.82, min cluster size 3) and the lookback window (30 days) are tunable via env (`CORRECTION_CLUSTER_SIMILARITY`, `CORRECTION_CLUSTER_MIN_SIZE`, `CORRECTION_CLUSTER_WINDOW_DAYS`) so ops can adjust without a redeploy. Defaults pinned in spec; non-default values logged on every run for reproducibility.
3. For each detected cluster:
   - Promote to a synthesised `memory_blocks` row (existing S11 pattern): `status: 'pending_review'`, `confidence: 'low'`, `source: 'auto_synthesised'`, `captured_via: 'auto_synthesised'`, `quality_score: 0.50`.
   - Existing HITL queue surfaces it for operator approval on Knowledge.
4. Optional scorecard-tightening suggestion: if the agent has an attached scorecard with a quality check whose name matches the detected cluster's dimension (heuristic via cosine similarity > 0.75 on quality_check.description vs cluster centroid), emit an `agent_recommendations` row:
   - `category: 'scorecard_tightening_suggestion'`
   - `severity: 'info'`
   - `body: "Operators keep correcting <dimension> on <agent>. Consider tightening <quality_check_name>'s pass mark."`

### 13.4 Knowledge page integration

Existing Knowledge page (Govern surface, shipped via consolidation-govern PR #273):
- Add filter chip group with values: `All | From corrections | Manually authored | Auto-synthesised`.
- The "From corrections" filter sets `WHERE captured_via = 'operator_correction'`.
- Add a `Source` column to the row (small pill: `Correction` | `Manual` | `Auto`).
- Existing `Edit and override`, approve, reject controls work unchanged.
- Pattern-detector suggestion card (per Round 1 mockup decision): the daily detector enqueues an `agent_recommendations` row that appears in the existing Knowledge page recommendations strip when the cluster suggestion fires.

### 13.5 Provenance fields exposed on row drawer

All fields already exist in `memory_blocks` schema. Knowledge row drawer surfaces them directly:

| Field | Source column |
|---|---|
| Source run | `source_run_id` (linkable to Run-trace) |
| Trigger event | derived from `source_run_id` + the corrected step (linked via `agent_execution_events`) |
| Time captured | `created_at` |
| Last used | computed by Knowledge page from existing memory-injection log (already shipped) |
| Usage frequency | computed (count of retrievals in last 30 days, existing telemetry) |
| Attached agents | derived from `agents.memory_block_attachments` (existing) |
| Confidence tier | `confidence` |
| Human-approved vs pattern-inferred | derived: `confidence='normal' AND captured_via='operator_correction'` → human-approved; else inferred |

No schema migration needed for provenance display. (Resolves [Directive 3 from brief §12](./brief.md).)

---

## 14. UI surfaces (mockup mapping)

Mockups in `prototypes/trust-verification-layer/` are the design source of truth.

| Spec section | Mockup file | Key elements |
|---|---|---|
| §11.3 Custom skill creation | `skill-create.html` | Two-stage flow, Advanced disclosure, blast-radius copy, three radio options |
| §11.1 + §11.2 Run-trace badge + summary strip | `run-trace.html` | Three-state badge, summary strip, Inbox link, Correct hover |
| §13.1 Correct dialog | `run-trace.html` (modal) | Edited output, reason, About this correction metadata block |
| §13.4 Knowledge page filter | `knowledge.html` | Source filter chip, Source column, suggestion card |
| §12 Govern / Quality | `govern-quality.html` | Three tabs (Agents drift / Scorecards library / Bench history) |
| §12.1 Scorecard library | `scorecard-library.html` | Source pill compression, Share toggle, attach counts, Duplicate |
| §12.1 Scorecard create | `scorecard-create.html` | Quality checks list, pass marks, reference data note |
| §12.5 Agent create with scorecards | `agent-create.html` | Required (lock icon) vs Suggested rows, two path tabs |
| §12.2 + §12.3 Agent edit scorecard tab | `agent-edit-scorecard.html` | Multi-attach, quartile control, sparklines, drift warnings |
| §12.4 Model bench | `model-bench.html` | Three-state page, test-input picker, cost estimate, regression risk |

Where mockup detail and spec disagree the spec wins (e.g., spec locks regression risk thresholds at §6.6; the mockup is illustrative on threshold colour choice).

---

## 15. Self-consistency pass result

Performed before review.

- Goals (§1) ↔ stage exit criteria (§3): each goal maps to an exit criterion. ✓
- Glossary (§2) ↔ contracts (§6) ↔ UI sections (§11–§13): "runtime check" used everywhere; "verify" only on the schema column literal. ✓
- Layer 2 sampling (§12.3) ↔ quartile control (§2 glossary): both list `off | q1 | q2 | q3` matching `0%, 25%, 50%, 75%`. ✓
- Source-pill compression (§6.8) ↔ UI matrix (§12.5) ↔ mockup `agent-create.html`: agree on sub-account viewer seeing "Suggested" without attribution. ✓
- Source-of-truth precedence: `runtime_check_results` row > `runtime_check.completed` event log entry. ✓ Pinned in §6.2.
- Authority resolution rule single source: §6.4. ✓
- Forced-grade trigger paths: §12.3 lists two (runtime fail + correction); §10.4 reflects them. ✓
- File inventory (§5) ↔ contracts (§6) ↔ services (§3): every named service appears in the inventory. Cross-check pass. ✓
- Phase dependency graph (§9): no Stage N references columns from Stage N+k. ✓
- Execution-safety contracts (§10): every new write path has idempotency posture, retry class, concurrency guard, and unique→HTTP mapping. ✓
- Mockup-spec alignment: all mockup screens mapped to spec sections (§14). ✓
- Brief Directive 6 (Pending vs Inconclusive distinction): `RuntimeCheckResult.state` keeps five internal states (`pass | fail | inconclusive | pending | not_applicable`) and operator UI collapses to three. ✓ §6.2 + §2 glossary.

No contradictions detected.

---

## 16. Testing posture statement

Per `docs/spec-context.md`:
- `testing_posture: static_gates_primary` — the new CI gates `verify-runtime-check-coverage.sh` and `verify-scorecard-rls.sh` are the primary correctness boundary for this build.
- `runtime_tests: pure_function_only` — pure tests for `runtimeCheckServicePure`, `scorecardServicePure` (source-pill compression, regression-risk classifier, composite winner), `correctionPatternDetectorPure` (clusterer), `benchRunServicePure` (cost estimate).
- `frontend_tests: none_for_now` — no React Testing Library tests for the new pages.
- `api_contract_tests: none_for_now` — no supertest harness.
- `e2e_tests_of_own_app: none_for_now` — no Playwright.
- `migration_safety_tests: defer_until_live_data_exists` — RLS coverage is enforced via `verify-rls-coverage.sh` (existing) + the new `verify-scorecard-rls.sh`.

Testing checklist for the build phase:
- [ ] Pure tests for all five `*Pure.ts` services (one test file each).
- [ ] CI gates `verify-runtime-check-coverage.sh` and `verify-scorecard-rls.sh` added under `scripts/gates/`.
- [ ] No vitest/jest/playwright for own app surfaces. (Conformance enforced by `scripts/gates/verify-test-quality.sh`.)
- [ ] Manual G2 visual diff: Run-trace badge layout; Govern / Quality drift list; Model bench three-state page.

No deviation from framing posture. No new test categories introduced.

---

## 17. Deferred items

- **Per-attach pass-mark overrides.** An agent edit pass-mark override (instead of editing the scorecard itself) is deferred. Stage 2 ships scorecard-level pass marks only. Reason: 3-deep nesting (Advanced disclosure inside collapsible body inside collapsible card inside tab) violates complexity budget; the operator path of "Duplicate scorecard, edit, attach" achieves the same outcome.
- **Adaptive sampling.** The brief considers but does not adopt sampling rates that adapt up on drifting agents and down on stable ones. Stage 2 ships static quartile control. Reason: needs trend data the system will not have for several weeks post-Stage-2-ship; revisit once trend data exists.
- **Auto-prompt-adaptation in bench.** Stage 2 ships same-prompt-across-models bench (most honest signal). Auto-adapting prompts per model is a Stage 4 candidate if scores look unfair in practice.
- **Auto-routing.** Operator-approved bench results set the agent's default model. Auto-routing (a meta-model picks per task at runtime) is a Stage 4 candidate.
- **Policy primitive.** Allowed/forbidden action lists, approval thresholds, escalation rules, budget policies, compliance-rule objects. Captured implicitly via `blast_radius` + runtime checks. Separate brief candidate for Stage 4.
- **Re-evaluation of a single runtime check.** `runtime_check_results.state` does not transition out of terminal. The `attempt_number` column is reserved in the v1 schema (DEFAULT 1, included in the uniqueness constraint per §10.1) so retry orchestration can be added later without a destructive migration. Retry logic, UI affordance, retry-policy matrix, and event semantics are deferred — not needed in v1; runtime checks are one-shot. (F3 — schema reservation only; orchestration deferred.)
- **Scorecard versioning history.** Editing a scorecard mutates the row. Full version history (so old judgements remain comparable across all scorecard fields and quality-check definitions) is deferred. Mitigation in Stage 2 (F1): `scorecard_judgements` snapshots `passMark`, `qualityCheckName`, `qualityCheckDescription`, `judgeModelId`, and `scorecardUpdatedAt` at judge time per §6.5 — historic verdicts and trend analytics remain semantically valid even when the scorecard is later edited. Full versioned-history (audit log of every scorecard edit, time-travel views, version pinning UI) is a separate Stage 4 candidate.
- **Retention and archival policy (M1).** `runtime_check_results`, `scorecard_judgements`, and `bench_results` will grow unbounded under default v1 settings. Retention windows, cold-storage strategy, and aggregation/downsampling are deferred until growth-rate data exists. **Posture commitment:** retention windows MUST be pinned before Stage 2 GA — this is a Stage-2 ship-blocker, not a deferred-forever item. Default working assumption (subject to revision once telemetry shows real growth curves): 90-day hot retention for `runtime_check_results` and `scorecard_judgements`, 365-day for `bench_results` (lower volume, higher analytical value), then aggregate-and-archive to cold storage. Re-pin before Stage 2 GA based on observed row-rate × per-row size × cost-per-GB.
- **Scorecard fork tracking, diff view, version pinning UI.** Brief explicitly excludes these. Customisation = Duplicate.
- **Adversarial review pre-check.** This spec is multi-tenant + privilege-relevant + introduces new write paths. `adversarial-reviewer` should be invoked during Phase 2 branch review (per CLAUDE.md §pipeline). Not a spec deferral, but flagged here so the build phase remembers.
- **Top-20 skill backfill list.** The exact 20 skills receiving runtime checks in Stage 1 are listed in `tasks/builds/trust-verification-layer/runtime-check-coverage-list.md` (built during Phase 2). The spec is shape-locked; the per-skill content lands in the build phase.

---

## 18. Open questions for operator

These are the questions the spec author leaves open for the operator to confirm before Phase 2 begins. Each has a recommended default; if the operator does not push back, the default applies.

1. **Top-20 skill backfill list.** Does the seed list in §5 (matching `runtime-check-coverage-list.md` skeleton) cover the most-used skills, or should the platform team reorder before build? **Default: confirm during build phase based on actual usage telemetry from past 30 days.**
2. **Forced grade on Stage 3 correction without Stage 2 attached.** Stage 3 ships independently; if no scorecard is attached when a correction lands, the forced-grade hook is a no-op. Confirm this is acceptable. **Default: yes — Stage 3 must remain useful even without Stage 2.**
3. **Bench cost-estimate ceiling.** ~~Should the Run bench button be disabled above some absolute cost (e.g. $50/run) or always allowed with a confirmation dialog?~~ **RESOLVED (Round 1 review):** server-side hard cap via `BENCH_MAX_COST_CENTS` env var (default 5000 cents = $50/run) per §12.4. Below the cap, operator sees explicit confirmation showing the dollar figure. At or above the cap, request returns 422 `BENCH_COST_CAP_EXCEEDED` and never enters `awaiting_confirm`. Cap value is ops-tunable via env without redeploy.
4. **Pattern-detector cluster threshold.** Default N = 3 corrections within a 30-day window. Confirm or adjust. **Default: 3 corrections, 30-day window, both configurable via env in the build phase if needed.**
5. **Scorecard-tightening suggestion enable.** The optional pattern → scorecard suggestion (§13.3 step 4) can be feature-flagged off if it generates noise. **Default: enabled; behind a feature flag in `feature_flags: only_for_behaviour_modes` posture so it can be toggled without a redeploy.**
6. **Permission-key naming.** Six new keys defined in §5 (file inventory). Confirm naming matches existing convention (`org.scorecards.view`, etc.). **Default: yes — mirrors `org.review.view` shape from existing keys.**

---

**End of spec.**
