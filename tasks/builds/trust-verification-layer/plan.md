# Implementation plan: Trust & Verification Layer

**Build slug:** `trust-verification-layer`
**Spec:** [`tasks/builds/trust-verification-layer/spec.md`](./spec.md) (LOCKED, 1087 lines, chatgpt-spec-review Rounds 1+2 complete on 2026-05-08)
**Brief:** [`tasks/builds/trust-verification-layer/brief.md`](./brief.md) (mockup rounds 1-6 + external review)
**Branch:** `claude/synthetos-work-primitive-improvements-P17SD`
**Plan author:** architect (Claude Opus 4.7, 1M)
**Plan date:** 2026-05-08
**Scope class:** Major
**Phase 1 status:** PHASE_1_COMPLETE — `spec-reviewer` (Codex) skipped per environment constraint; Phase 2 review pipeline absorbs residual risk.

---

## Table of contents

1. Executor notes
2. Architecture notes
   - Model-collapse check
   - Data model summary
   - Service-layer additions
   - Permission keys
   - Three-stage build sequence
   - Existing primitives reused
   - Risks and mitigations
   - Reduced review coverage carry-over
   - Mid-build Opus-escalation candidates
3. Chunk dependency graph
4. Per-chunk detail
   - Chunk 1 — Stage 1 schema, migrations, RLS manifest
   - Chunk 2 — Stage 1 shared types, pure runtime-check service, actionRegistry contract extension
   - Chunk 3 — runtimeCheckService impure + agentExecutionService integration + approval-gate hook
   - Chunk 4 — Skill runtime-check suggestion service + routes + CI gate
   - Chunk 5 — Stage 1 UI: Run-trace badges, summary strip, skill-create page
   - Chunk 6 — Stage 2 schema, permissions, RLS manifest, CI gate
   - Chunk 7 — scorecardServicePure
   - Chunk 8 — scorecardService impure + scorecard routes + agent attach/detach routes
   - Chunk 9 — Sampled judge runner + scorecardJudgeJob + judge prompt design (Opus-escalation)
   - Chunk 10 — Forced judge job + Stage 1 hook wiring + Stage 3 hook stub
   - Chunk 11 — Bench: pure + service + routes + execute job + regression-replay extension
   - Chunk 12 — Stage 2 UI
   - Chunk 13 — Stage 3 schema + correction types + capture service + route + Run-trace Correct dialog
   - Chunk 14 — Correction-pattern detector pure + job + Stage 2 forced-grade wiring (Opus-escalation)
   - Chunk 15 — Knowledge page filter chip + Source column + recommendations strip
   - Chunk 16 — Doc-sync (capabilities.md, architecture.md, KNOWLEDGE.md, retention pin handoff)
5. Risks recap (operator must decide)
6. Appendix: spec coverage map

---

## 1. Executor notes

- **Phase 2 sequencing.** Stage 1 → Stage 2 → Stage 3 is forward-only at the schema + migration layer (0288 → 0295). Stage 3 has a soft dependency on Stage 2: the forced-grade hook on correction is a no-op when no scorecard is attached, so Stage 3 ships independently if Stage 2 slips.
- **Chunk-level review cadence.** Per-chunk `pr-reviewer` after each chunk merge. Branch-level `dual-reviewer` (if Codex available) and `chatgpt-pr-review` after the last chunk. `adversarial-reviewer` auto-triggers per CLAUDE.md §5.1.2 (new permissions + 5 new RLS tables + multi-tenant scopes + new write paths).
- **Mode-switching.** Three chunks are flagged as **mid-build Opus-escalation candidates**. Sonnet handles the rest. Per chunk, the executor decides whether to switch based on the local difficulty of the named decision, not the chunk as a whole.
- **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**
- **Migration numbering.** 0288–0295. Latest on `main` at plan time is 0287 (`0287_govern_auto_update_disabled.sql`). Per the migration discipline in DEVELOPMENT_GUIDELINES.md §6, numbers are claimed at merge time — use placeholder names if a parallel PR steals a number.
- **Defaults applied (from handoff §Open questions).** Q1 confirmed during chunk that backfills the registry; Q2 yes (Stage 3 stands alone); Q3 server-side cost cap via `BENCH_MAX_COST_CENTS` env var per spec §12.4 + UI confirmation; Q4 `N=3` corrections / `30-day` window via env; Q5 enabled, behind feature flag `scorecard_tightening_suggestions`; Q6 naming matches existing convention (`org.scorecards.view` shape).

---

## 2. Architecture notes

### Model-collapse check

**Q1.** Does this feature decompose into ingest → extract → transform → render? **Partially.** The runtime-check evaluation (Layer 1) and the scorecard judge runner (Layer 2 sampled grading) are extract-then-classify pipelines. The bench runner (Layer 2) is replay × score. The pattern detector (Layer 3) is cluster → promote. None of them is single-document multi-stage.

**Q2.** Could a frontier multimodal model do each step in one call? **No.** Runtime checks are deterministic post-action verifiers (`api_status_2xx`, `row_exists`, `field_match`, `external_returns`); they are intentionally NOT LLM calls — adding LLM latency and cost to every action is a non-starter. The scorecard judge IS one LLM call per (run, scorecard, quality-check), which is already a single-call collapse. The pattern detector clusters embeddings + light heuristics; collapsing N=30 days of corrections into a single LLM "find the patterns" call is plausible but loses determinism, audit trail, and per-cluster idempotency that the spec's `correction_pattern.promoted` event requires.

**Q3.** Reject collapse, why? Three reasons: **(a) determinism / audit trail** — runtime checks and scorecard verdicts are decision-input data shown on Run-trace and Govern surfaces; LLM-collapsed verdicts cannot be re-derived deterministically and complicate trust analytics; **(b) cost asymmetry** — runtime checks must run on every action with sub-50ms latency budget; LLM calls violate the budget by an order of magnitude; **(c) idempotency contracts** — the spec pins unique constraints on `(run_id, sequence_number, skill_slug, attempt_number)` and `(run_id, scorecard_id, quality_check_slug, trigger_source)`. A single collapsed LLM call cannot produce those keys without a second projection step, which puts us back at the original pipeline. The judge LLM call IS the maximally-collapsed shape for the grading step; further collapse would be net-worse.

**Decision: reject pipeline-wide collapse. Keep the deterministic runtime-check path; keep the single-LLM-call judge step (already collapsed); keep the deterministic + embedding-similarity cluster path. No further collapse pursued.**

### Data model summary

**Five new RLS-protected tables** (all fail-closed, `app.organisation_id` keyed; system-scope rows on `scorecards` are the one cross-tenant readable case and are filtered at service-layer):

| Table | Migration | Stage | Purpose |
|---|---|---|---|
| `runtime_check_results` | 0289 | 1 | Per-step deterministic verification result; canonical source for runtime-check trend analytics. Denormalised projection of the `runtime_check.completed` event. |
| `scorecards` | 0290 | 2 | Three-scope (system/org/subaccount) evaluation rubric with `quality_checks` JSONB and `share_with_subaccounts` boolean. |
| `agent_scorecard_attachments` | 0291 | 2 | Many-to-many join of agents and scorecards; carries `attach_authority` and `grading_frequency`. |
| `scorecard_judgements` | 0292 | 2 | Per-(run, scorecard, quality-check, trigger-source) judgement with snapshot provenance fields (F1 invariant). |
| `bench_runs` + `bench_results` | 0293 | 2 | Operator-triggered model comparison with cost estimate + state machine. Single migration, two tables. |

**One enum extension** (no new table): migration 0295 extends `memory_blocks.captured_via` to allow `'operator_correction'`. Layer 3 storage uses the existing memory subsystem.

**Five existing-table modifications:** `org_skills` and `subaccount_skills` get `verify` jsonb / `reversible` boolean / `blast_radius` text (0288); `system_agents` gets `default_system_scorecard_slugs` and `default_org_scorecard_slugs` jsonb; `agent_templates` gets `default_scorecard_slugs` jsonb; `organisations` gets `org_mandatory_scorecard_slugs` jsonb (0294).

### Service-layer additions

| Layer | New services (impure) | New services (pure) | Existing services extended |
|---|---|---|---|
| Layer 1 | `runtimeCheckService.ts`, `skillRuntimeCheckSuggestionService.ts` | `runtimeCheckServicePure.ts` | `agentExecutionService.ts` (emit + persist + approval-gate hook), `actionRegistry.ts` (extend `ActionDefinition`), `agentInboxService.ts` (route runtime-check fail) |
| Layer 2 | `scorecardService.ts`, `scorecardJudgeRunner.ts`, `benchRunService.ts` | `scorecardServicePure.ts`, `benchRunServicePure.ts` | `regressionReplayService.ts` (extend for bench regression replay); existing pg-boss `createWorker` registration |
| Layer 3 | `correctionCaptureService.ts` | `correctionPatternDetectorPure.ts` | `agentRecommendationsService` (new `category: 'scorecard_tightening_suggestion'` payload); existing S11 auto-synthesis pipeline |

**New pg-boss queues (4):** `scorecard:judge`, `scorecard:judge:forced`, `bench:execute`, `correction:pattern-detect`. The existing `regression:replay` queue is extended (no new queue) for bench regression replay.

### Permission keys (six new keys)

Per spec §5 + handoff Q6 default; named per existing convention (`org.review.view` shape):

| Key | Scope | Action |
|---|---|---|
| `org.scorecards.view` | org | List org + system + own subaccount-visible scorecards |
| `org.scorecards.manage` | org | CRUD org-scope scorecards; toggle `share_with_subaccounts`; set `org_mandatory_scorecard_slugs` |
| `org.scorecards.bench_run` | org | Trigger a model bench |
| `subaccount.scorecards.view` | subaccount | List sub-account-visible scorecards |
| `subaccount.scorecards.manage` | subaccount | CRUD subaccount-scope scorecards; attach/detach Suggested |
| `subaccount.corrections.create` | subaccount | Use Correct action on Run-trace |

System admin and org admin bypass per existing semantics.

### Three-stage build sequence (LOCKED in Phase 1)

```
Stage 1: Skill verification          Stage 2: Scorecards + bench         Stage 3: Correction memory
[runtime checks foundational]   ──>  [scorecards library + judge        ──>  [Correct dialog +
                                       runner + bench tooling]                pattern detector]
                                              │                                       │
                                              │  hook on runtime-check               │  optional hook
                                              │  fail → forced grade                 │  on Stage 2
                                              │                                       │
                                              └───────  hooks fire only when         ─┘
                                                        consumer exists
```

Stage 1 is a hard prerequisite of Stage 2 (the forced-grade-on-runtime-fail hook in §12.3 reads `runtime_check_results`). Stage 3 has a **soft** dependency on Stage 2: when a correction lands and no scorecard is attached, the forced-grade enqueue is a no-op. Both Stage 2 and Stage 3 also stand independently — each delivers operator-visible value at its own ship line.

### Existing primitives reused (per handoff)

| Need | Reused primitive | Why not invent |
|---|---|---|
| Layer 3 storage | `memory_blocks` with extended `captured_via` enum | Provenance fields (`source_run_id`, `confidence`, `quality_score`, `created_at`) all already exist; Knowledge page already reads them. New table = duplicated retrieval pipeline. |
| Scorecard-tightening suggestions | `agent_recommendations` row with new `category: 'scorecard_tightening_suggestion'` | Existing dedupe on (scope, category, dedupe_key) + acknowledge/dismiss lifecycle is exactly the right shape. |
| Runtime-check event emission | `agent_execution_events` event log | New event type (`runtime_check.completed`) reuses the existing per-step-event pipeline; Run-trace UI already renders the log. |
| Bench regression replay | `regressionReplayService.ts` | Already replays runs against new model versions; bench is a pre-approved variant of the same shape. |
| Failed-external-blast-radius pause | Existing approval gate via `policyEngineService` + Inbox | New gate would duplicate review-item lifecycle; just feed the existing one. |
| Correction → memory promotion | Existing S11 auto-synthesis pipeline (memory_blocks at `pending_review`, confidence-tiered HITL) | Pattern detector wraps the existing pipeline rather than parallel-shipping. If S11 is later refactored, the detector adapts. |
| Cost estimation pre-bench | `llmRequestEstimateService` | Already does prompt-side cost estimation; bench cost = candidate × sample × judge × estimate. |

### Risks and mitigations (top of plan)

| Risk | Impact | Mitigation | Where addressed |
|---|---|---|---|
| **R1. Judge cost runaway.** Sampled judge fires on every completed run × every attached scorecard × every quality check; a 50%-sampling agent with 3 scorecards × 4 checks could 6× a run's LLM cost. | Operator-perceived cost surge; potential breach of org budget. | Default sampling `q1` (25%); per-job idempotency dedupe; existing `runCostBreaker` and `assertWithinRunBudget` envelope the judge job's LLM call; cost surfaced on Govern / Quality drift list. | Chunk 9 (`scorecardJudgeJob`); risk re-raised at branch review for `pr-reviewer` and `adversarial-reviewer`. |
| **R2. Bench cost runaway.** Operator runs a 50-sample bench across 5 candidates with judge LLM costing $X per call → $50+ runs are easy. | Surprise spend; pre-production tolerance is high but not unbounded. | Server-side cost cap (`BENCH_MAX_COST_CENTS`, default 5000 cents) per spec §12.4 / M3 — enforced server-side independent of UI confirmation. UI shows estimate before triggering. Judge ≠ candidate invariant prevents inflated scores. | Chunk 11. |
| **R3. RLS misconfiguration on five new tables.** A missed FORCE RLS or wrong policy template would leak cross-tenant data. | Multi-tenant safety violation; load-bearing. | All five tables ship with the canonical policy template in the same migration that creates the table; manifest entries land in the same PR; new CI gate `verify-scorecard-rls.sh` asserts policy + manifest entry per table. `adversarial-reviewer` auto-triggers per §5.1.2. | Chunks 1, 6 (migrations); Chunk 6 (gate); branch-level review. |
| **R4. Forced-grade hook silently skipped.** Stage 1 → Stage 2 hook (runtime-check fail → forced grade) fires only when a scorecard is attached AND the agent's blast_radius != 'self'. A wiring bug would silently drop the signal. | Trust analytics drift detection becomes incomplete. | Forced-grade enqueue is logged at `info` per call; idempotency key on (run_id, scorecard_id, quality_check_slug, trigger_source) makes re-enqueue safe. Pure unit test in Chunk 10 exercises hook path. | Chunk 10. |
| **R5. Source-pill compression bug at sub-account scope.** Compression rule in §6.8 is the only thing preventing org-name leakage to subaccount viewers. A wrong branch leaks org names. | Cross-tenant copy leak (low impact, high embarrassment). | Pure function in `scorecardServicePure.compressSourcePill()`; pure-function permutation test (per §8.21) covers all four `(scope, viewerScope)` combinations. | Chunk 7. |
| **R6. Authority resolution at attach time produces wrong `attachAuthority`.** Authority is computed (not operator-selected) per §6.4; a bug here lets a sub-account operator detach a system_mandatory row. | Privilege escalation against the lock-icon contract. | Pure function `resolveAttachAuthority` in `scorecardServicePure`; DB-level CHECK constraint enforces `system_mandatory` deletable only by system admin (route-layer), `org_mandatory` only by org admin. | Chunks 7, 8. |
| **R7. Migration ordering at merge time.** 0288–0295 are reserved at plan time; a parallel PR can claim numbers in this range. | Merge conflict; off-by-one renumber risk. | Per DEVELOPMENT_GUIDELINES.md §6.2, claim numbers immediately before merge; rename files in same commit. The eight migrations in this build are append-only, so a renumber is mechanical. | All migration chunks; finalisation. |
| **R8. Operator UI three-state collapse hides analytics signal.** The five internal runtime-check states collapse to three for operators; aggregating on the collapsed value would obscure timeout vs verify-null vs inconclusive. | Drift analytics / bench validity broken. | F6 invariant in §6.2: aggregations MUST use the internal `state` value. Pure function `runtimeCheckServicePure.collapseToOperatorBadge` is the ONLY render-time projection. Code-comment + `@analytics-internal-state` annotation on the column. | Chunks 2, 5. |
| **R9. Retention growth.** `runtime_check_results`, `scorecard_judgements`, and `bench_results` grow unbounded; per §17 M1, retention windows MUST be pinned before Stage 2 GA — Stage-2 ship-blocker, not deferred-forever. | Disk + index bloat post-launch. | Default working assumption (subject to revision once telemetry shows real growth curves): 90-day hot retention for `runtime_check_results` and `scorecard_judgements`, 365-day for `bench_results`. Pin before Stage 2 GA. Logged as a doc-sync follow-up in Chunk 16. | Chunk 16 (doc-sync) + handoff to operator. |
| **R10. Embedding model drift in Layer 3 clusterer.** The pattern detector reuses the existing memory-embedding model; a model swap upstream silently changes cluster boundaries. | Cluster size / threshold drift. | Single-source-of-truth comment on `correctionPatternDetectorPure` pointing at the embedding service. Default similarity 0.82 + min cluster size 3 are env-tunable so ops can re-tune without redeploy. | Chunk 14. |

### Reduced review coverage carry-over

`spec-reviewer` (Codex) was SKIPPED in Phase 1 (Codex CLI not available). Phase 2 review pipeline absorbs the residual risk:

- Per-chunk `pr-reviewer` after each chunk.
- Branch-level `dual-reviewer` (if Codex available) and `chatgpt-pr-review`.
- `adversarial-reviewer` auto-triggers per §5.1.2 — new permissions + 5 new RLS tables + multi-tenant scopes + new write paths.

### Mid-build Opus-escalation candidates

These three sub-questions are flagged for chunk-time mode-switch (Sonnet → Opus for the local decision, then Sonnet resumes). The operator may flag any of these to be pre-decided:

1. **Stage 1, Chunk 2** — Custom-handler runtime-check kind design. The `custom_handler` discriminated-union variant in `RuntimeCheckKind` needs a clean handler-registration shape that covers (a) per-org custom handlers, (b) sandboxing (no DB writes from the handler), (c) discoverability via the registry. Sonnet can draft the type; Opus is preferred for the handler-registration pattern.
2. **Stage 2, Chunk 9** — Judge prompt schema for `scorecard:judge` job. The judge LLM prompt must produce a strictly-parseable `{ qualityCheckSlug, observedScore, judgeReasoning }` per quality check. Schema design + few-shot examples + cost-vs-accuracy tradeoff is an Opus-grade decision.
3. **Stage 3, Chunk 14** — Pattern-clustering algorithm choice. Spec §13.3 pins V1 to "exact-match (agent_id, skill_slug) + cosine ≥ 0.82 over editedOutput embedding". Whether the centroid recomputation, the de-duplication of overlapping clusters, and the choice between hierarchical vs greedy single-link clustering matters for false-positive rate. Opus preferred.

Other chunks stay on Sonnet.

---

## 3. Chunk dependency graph

```
Chunk 1 (Stage 1 schema)
   │
   ▼
Chunk 2 (Stage 1 types + actionRegistry contract + pure runtime checks)
   │
   ▼
Chunk 3 (runtimeCheckService impure + agentExecutionService hook + approval gate)
   │
   ▼
Chunk 4 (skill suggestion LLM service + routes + CI gate)
   │
   ▼
Chunk 5 (Stage 1 UI: Run-trace badges, summary strip, skill-create page)
   │
   ▼─────────────────► (Stage 1 complete; ship line reached)
   │
Chunk 6 (Stage 2 schema + permissions + RLS manifest + CI gate)
   │
   ▼
Chunk 7 (scorecardServicePure: visibility, source-pill, regression risk, composite winner, attach-authority resolver)
   │
   ▼
Chunk 8 (scorecardService impure + scorecard routes + agent attach/detach routes)
   │
   ▼
Chunk 9 (sampled judge runner + scorecardJudgeJob + judge prompt) ◄── Opus-escalation
   │
   ▼
Chunk 10 (forced judge job + Stage 1 hook wiring + Stage 3 hook stub)
   │
   ▼
Chunk 11 (benchRunServicePure + benchRunService + benchExecuteJob + benchRegressionReplayJob + bench routes)
   │
   ▼
Chunk 12 (Stage 2 UI: Govern/Quality, scorecard library/create, agent edit/create scorecard tabs, model bench)
   │
   ▼─────────────────► (Stage 2 complete; ship line reached)
   │
Chunk 13 (Stage 3 schema + correction types + correctionCaptureService + route + Run-trace Correct dialog)
   │
   ▼
Chunk 14 (correctionPatternDetectorPure + correctionPatternDetectorJob + Stage 2 forced-grade wiring) ◄── Opus-escalation
   │
   ▼
Chunk 15 (Knowledge page filter chip + Source column + recommendations strip)
   │
   ▼─────────────────► (Stage 3 complete; ship line reached)
   │
Chunk 16 (doc-sync: capabilities.md, architecture.md key files per domain, KNOWLEDGE.md patterns; retention pin handoff)
```

**Dependency rules.** All chunks are forward-only — no chunk references a column or service that does not yet exist on the branch at chunk start. Stage boundaries are review checkpoints, not hard merge gates: Chunks 6+ MAY merge into the integration branch before Chunk 5 reaches main per the §8.9 one-PR-per-feature-branch rule.

---

## 4. Per-chunk detail

### Chunk 1 — Stage 1 schema, migrations, RLS manifest

**spec_sections:** §3 Stage 1 migrations, §5 file inventory (new schema files + modified schema files), §7 RLS posture (runtime_check_results), §10.1 idempotency posture.

**Files (new — 4):**
- `migrations/0288_skills_runtime_check_columns.sql` (+ `.down.sql`)
- `migrations/0289_runtime_check_results.sql` (+ `.down.sql`)
- `server/db/schema/runtimeCheckResults.ts`

**Files (modified — 4):**
- `server/db/schema/orgSkills.ts` — add `verify` jsonb (nullable), `verify_null_justification` text (nullable), `reversible` boolean (default `false`), `blastRadius` text enum check (`'self' | 'tenant' | 'external'`, default `'self'`).
- `server/db/schema/subaccountSkills.ts` — same four columns.
- `server/db/schema/index.ts` — re-export `runtimeCheckResults`.
- `server/config/rlsProtectedTables.ts` — append `runtime_check_results` entry pointing at `0289_runtime_check_results.sql`.

**Contracts.**

`runtime_check_results` columns (spec §6.2 + §10.1):
- `id` (uuid pk)
- `organisation_id` (uuid not null FK)
- `subaccount_id` (uuid nullable FK)
- `run_id` (uuid not null FK to `agent_runs`)
- `event_id` (uuid not null FK to `agent_execution_events` — the corrected step)
- `sequence_number` (integer not null) — step index in run
- `skill_slug` (text not null)
- `attempt_number` (integer not null DEFAULT 1) — F3, reserved for future retry
- `state` (text not null check: `'pass' | 'fail' | 'inconclusive' | 'pending' | 'not_applicable'`)
- `reason_code` (text not null) — machine-readable
- `reason_text` (text not null) — operator-readable
- `impact` (text not null check: `'blocking' | 'informational'`)
- `suggested_fix` (text nullable)
- `evaluated_at` (timestamptz not null default `now()`)
- `blast_radius` (text not null check: `'self' | 'tenant' | 'external'`)
- `reversible` (boolean not null)
- `created_at`, `updated_at` (timestamptz, default now)
- **Unique constraint:** `(run_id, sequence_number, skill_slug, attempt_number)` (per §10.1)
- **RLS:** FORCE RLS, canonical policy `app.organisation_id = organisation_id`. Policy template per `architecture.md` § Row-Level Security.

`org_skills` / `subaccount_skills` additions (spec §6.1):
- `verify` jsonb nullable — `RuntimeCheckKind | null`
- `verify_null_justification` text nullable — required (CI-enforced) when `verify IS NULL`
- `reversible` boolean not null DEFAULT false
- `blast_radius` text not null DEFAULT `'self'` check enum.

**Error handling.** Migration is append-only. Down migration drops the table and the four columns. Backfill: `verify = NULL`, `reversible = false`, `blast_radius = 'self'` for safety on existing rows. Schema-file constraint: `server/db/schema/runtimeCheckResults.ts` may import only from `drizzle-orm`, `shared/types/**`, and other schema files (DEVELOPMENT_GUIDELINES.md §3).

**Test considerations.** Pure tests deferred to Chunk 2 (the schema is just data shape). PR reviewer to verify: (a) RLS policy template exact match vs canonical, (b) manifest entry policyMigration matches the migration filename, (c) unique constraint on `(run_id, sequence_number, skill_slug, attempt_number)`.

**Dependencies.** None (first chunk).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run db:generate` (verify Drizzle schema produces expected migration shape).

**Acceptance criteria.** Migrations apply cleanly; schema files type-check; manifest entry present; unique constraint visible in `\d runtime_check_results`; RLS policy active per architecture.md template.

---

### Chunk 2 — Stage 1 shared types, pure runtime-check service, actionRegistry contract extension

**spec_sections:** §6.1 RuntimeCheckDefinition, §6.2 RuntimeCheckResult (+ F6 invariant), §10.7 state-machine closure, §11 Layer 1 (skill verification).

**Files (new — 3):**
- `shared/types/runtimeCheck.ts`
- `server/services/runtimeCheckServicePure.ts`
- `server/services/__tests__/runtimeCheckServicePure.test.ts`

**Files (modified — 1):**
- `server/config/actionRegistry.ts` — extend `ActionDefinition` with `verify: RuntimeCheckKind | null`, `verifyNullJustification?: string`, `reversible: boolean`, `blastRadius: 'self' | 'tenant' | 'external'`. Add the four built-in check kinds to the `RuntimeCheckKind` discriminated union. **Backfill the seed top-20 system skills with concrete `verify` declarations** per spec §5; the canonical list lives at `tasks/builds/trust-verification-layer/runtime-check-coverage-list.md` and is confirmed against last-30-days usage telemetry during this chunk (handoff Q1).

**Contracts.**

`shared/types/runtimeCheck.ts`:
```ts
export type RuntimeCheckKind =
  | { kind: 'api_status_2xx'; expectedStatusRange?: [number, number] }
  | { kind: 'row_exists'; table: string; matchKey: string }
  | { kind: 'field_match'; outputPath: string; expectedShape: 'string' | 'number' | 'boolean' | 'date' }
  | { kind: 'external_returns'; provider: string; expectedField: string }
  | { kind: 'custom_handler'; handlerName: string };

export type RuntimeCheckState = 'pass' | 'fail' | 'inconclusive' | 'pending' | 'not_applicable';
export type RuntimeCheckOperatorBadge = 'pass' | 'fail' | 'pending';
export type RuntimeCheckBlastRadius = 'self' | 'tenant' | 'external';
```

`runtimeCheckServicePure.ts` exports:
- `evaluateApiStatus2xx(result, expectedRange)` — pure.
- `evaluateFieldMatch(result, outputPath, expectedShape)` — pure.
- `evaluateExternalReturns(result, provider, expectedField)` — pure.
- `evaluateRowExists(result, table, matchKey)` — pure (declarative — actual DB read happens in impure service per §11.1).
- `collapseToOperatorBadge(state: RuntimeCheckState): RuntimeCheckOperatorBadge` — `pass→pass`, `fail→fail`, all others→`pending`.
- `classifyTimeoutAsInconclusive(error): RuntimeCheckResult` — per spec §11.5; timeout → `state: 'inconclusive'`, `reasonCode: 'check_timed_out'`. Never `'fail'`.

**Opus-escalation note.** The `custom_handler` discriminated-union variant needs a registration pattern: handlers register via a typed map keyed on `handlerName`; the pure module asserts `handlerName` exists in the registered set (compile-time + runtime). Switch to Opus to design this; pin the choice in a code comment referencing this chunk.

**Error handling.** Pure functions return `RuntimeCheckResult` directly — no throws. Unknown `RuntimeCheckKind.kind` is a TypeScript exhaustiveness violation (compile-time error via `assertNever`). Schema-validated input via Zod; invalid input returns `state: 'inconclusive'` with `reasonCode: 'invalid_check_definition'`.

**Test considerations (vitest, single file).** Permutation test per §8.21 covers all five `RuntimeCheckState` values mapping to the three operator badges; `evaluateApiStatus2xx` covers status ranges (200–299 default, 401, 500); `evaluateFieldMatch` covers each `expectedShape`; `classifyTimeoutAsInconclusive` covers `state !== 'fail'` invariant.

**Dependencies.** Chunk 1 (schema columns must exist before TS types are wired).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/__tests__/runtimeCheckServicePure.test.ts`.

**Acceptance criteria.** All five check kinds + operator-badge collapse + timeout classifier are pure-tested; ActionDefinition contract extension type-checks; the top-20 backfill list is confirmed and committed at `runtime-check-coverage-list.md`.

---

### Chunk 3 — runtimeCheckService impure + agentExecutionService integration + approval-gate hook

**spec_sections:** §11.1 trigger and dispatch, §11.2 failure handling matrix, §11.5 timeout and cancellation semantics, §10.4 terminal event guarantee.

**Files (new — 1):**
- `server/services/runtimeCheckService.ts`

**Files (modified — 2):**
- `server/services/agentExecutionService.ts` — after `dispatchAction`, call `runtimeCheckService.evaluate(...)`, persist via `withOrgTx`, emit `runtime_check.completed` event into `agent_execution_events`, route `(blastRadius === 'external') && (state === 'fail' || state === 'inconclusive')` to existing approval gate.
- `server/services/agentInboxService.ts` (or `agentInbox.ts` per spec — reviewer to confirm filename in this codebase) — accept a runtime-check fail event; create a review_item.

**Contracts.**

`runtimeCheckService.evaluate(input)`:
- Wrapped inline at `agentExecutionService.dispatchAction`.
- Hard timeout `RUNTIME_CHECK_TIMEOUT_MS = 250` (env-overridable). Timeout → `state: 'inconclusive'`, `reasonCode: 'check_timed_out'`.
- For `kind: 'row_exists'`, reads via `withOrgTx` (impure). For other kinds, delegates to `runtimeCheckServicePure`.
- Returns `RuntimeCheckResult`. Caller persists row + emits event.

Service throw shape: `{ statusCode: 500, message: string, errorCode: 'RUNTIME_CHECK_INTERNAL' }` for unrecoverable internal errors. Timeouts are NOT throws — they resolve to inconclusive.

**Error handling.** Per spec §11.5: timeout → inconclusive (NOT fail); cancellation → no row written (in-flight check abandoned); transient provider failure on `external_returns` → inconclusive (NOT fail). Concurrency guard: idempotent INSERT with `ON CONFLICT (run_id, sequence_number, skill_slug, attempt_number) DO NOTHING`.

**Test considerations.** This chunk is impure — defer correctness coverage to the pure tests in Chunk 2. PR-reviewer to verify: (a) timeout wrapping uses `AbortController` and resolves correctly; (b) approval-gate hook fires only when `(blastRadius === 'external') && (state === 'fail' || state === 'inconclusive')` — the exact predicate from the Files (modified) entry above — never on `state === 'pending'` or `state === 'not_applicable'`; (c) `runtime_check.completed` event payload matches the canonical shape (so Run-trace UI can render it without a separate query).

**Dependencies.** Chunks 1, 2.

**Verification commands:** `npm run lint`, `npm run typecheck`. (No new pure tests in this chunk.)

**Acceptance criteria.** End-to-end: a deliberate 500-status email-send action emits a `runtime_check.completed` event with `state: 'fail'`, persists a `runtime_check_results` row, and pauses the run via the existing approval gate.

---

### Chunk 4 — Skill runtime-check suggestion service + routes + CI gate

**spec_sections:** §11.3 custom skill creation flow, §11.4 CI gate.

**Files (new — 3):**
- `server/services/skillRuntimeCheckSuggestionService.ts`
- `server/services/skillRuntimeCheckSuggestionServicePure.ts` (cache-key derivation + response-shape validation)
- `scripts/gates/verify-runtime-check-coverage.sh` — CI gate (CI-only execution per repo convention).

**Files (modified — 2):**
- `server/routes/orgSkills.ts` — add `POST /api/org-skills/:id/suggest-runtime-check`.
- `server/routes/skills.ts` — add `verify` round-trip on create/update + suggestion endpoint.

**Contracts.**

`skillRuntimeCheckSuggestionService.suggestRuntimeCheck({ description, apiSpec? })`:
- Calls `llmRouter.routeCall` (NEVER direct adapter, per DEVELOPMENT_GUIDELINES.md §4).
- Cache key: `sha256(description + apiSpec ?? '')`. TTL 30 days. Cache table: extend existing `cache_kv` or store on a dedicated table (PR reviewer to confirm existing primitive).
- Returns `{ name, blastRadius, reversible, suggestedCheck: { kind, parameters }, plainEnglish, cacheHit: boolean }`.
- Hard timeout 8s.

Route shape:
- `POST /api/org-skills/:id/suggest-runtime-check` — `requireOrgPermission('org.agents.edit')` (existing key — skills are managed under agent permissions in this codebase per route conventions).
- Request body: `{ description: string, apiSpec?: string }`.
- Response: 200 with suggestion payload.
- 422 if description < 20 chars.

CI gate `verify-runtime-check-coverage.sh`:
- Iterates `ACTION_REGISTRY` entries.
- For each entry, asserts `verify` is set OR `verifyNullJustification` is non-empty.
- Fails build with list of missing skills.

**Error handling.** LLM call wrapped in `withBackoff` per existing pattern. Cache failure logs and falls through to LLM. Operator-facing error: 503 with `errorCode: 'SUGGESTION_UNAVAILABLE'` if LLM call fails after retry.

**Test considerations.** Pure helper functions tested in `__tests__/skillRuntimeCheckSuggestionServicePure.test.ts`. PR-reviewer to verify CI gate fails the build when a synthetic skill is added without `verify` (manual test by reviewer).

**Dependencies.** Chunks 1, 2, 3.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/__tests__/skillRuntimeCheckSuggestionServicePure.test.ts`.

**Acceptance criteria.** Calling `POST /api/org-skills/:id/suggest-runtime-check` with "Sends a customer SMS via Twilio" returns a populated `suggestedCheck` payload with `kind: 'api_status_2xx'`, `blastRadius: 'external'`, `reversible: false`. CI gate (CI-only) detects synthetic skill missing `verify`.

---

### Chunk 5 — Stage 1 UI: Run-trace badges, summary strip, skill-create page

**spec_sections:** §11.3 custom skill creation flow, §14 mockup mapping (Run-trace + skill-create), spec §6.2 operator-facing UI mapping.

**Files (new — 4):**
- `client/src/components/runtimeCheck/RuntimeCheckBadge.tsx` — three-state badge (Pass / Fail / Pending).
- `client/src/components/runtimeCheck/RuntimeCheckSummaryStrip.tsx` — aggregate per-run counts.
- `client/src/lib/api/runtimeChecks.ts` — API client.
- `client/src/lib/runtimeCheckBadgePure.ts` — pure helper for state→badge collapse (mirror of server-side `collapseToOperatorBadge`).

**Files (modified — 2):**
- `client/src/pages/runs/RunTracePage.tsx` — render badge per step; render summary strip at top; add Inbox link on fail.
- `client/src/pages/skills/SkillCreatePage.tsx` (or extend existing) — two-stage Describe → Suggest details flow per Round 6 mockup. Three radio options: Use suggested / Edit (Advanced disclosure) / No deterministic check possible (requires `verifyNullJustification` ≥ 20 chars).

**Contracts.**

`RuntimeCheckBadge` props: `{ state: RuntimeCheckState, reasonText: string, suggestedFix: string | null, onClick?: () => void }`.

`RuntimeCheckSummaryStrip` props: `{ passCount, failCount, pendingCount, runId }`.

`runtimeCheckBadgePure.ts`: `collapseToOperatorBadge`, `formatBadgeTooltip(result: RuntimeCheckResult): string`.

**Error handling.** Loading state shown as "Pending" badge until fetch resolves. Empty state: no badge for skills with `verify: null` AND `verifyNullJustification` is shown in the step drawer instead.

**Test considerations.** Pure helper file `runtimeCheckBadgePure.ts` is unit-tested in `__tests__/runtimeCheckBadgePure.test.ts` — covers all five → three mappings + tooltip formatting. No React Testing Library tests (per testing posture).

**UX considerations.**
- Badge legend on first render (existing pattern from `client/src/components/Pulse`).
- The five internal states must be inspectable in the step drawer (per F6 invariant — "preserved at schema and event level for retries, analytics, trust reporting, benchmark validity, and operator drill-down").
- Permission visibility: badge always visible to anyone with `subaccount.runs.view` or `org.observability.view`; the Inbox link surfaces only to viewers with `subaccount.review.view` / `org.review.view`.
- WebSocket update: runtime-check completion fires the existing `runtime_check.completed` event already routed through the pulse WebSocket pipeline; UI subscribes by run-id room.
- Empty state: a run with all skills `verify: null` shows a subtle "Runtime checks not configured for these skills" footer rather than a strip of pending badges.
- Loading state: badges render as ghost shapes until the API fetch resolves.
- Error state: badge fetch failure renders as a single inline retry chip per step rather than blanking the run.

**Dependencies.** Chunks 1, 3, 4.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:client`, `npx vitest run client/src/lib/__tests__/runtimeCheckBadgePure.test.ts`.

**Acceptance criteria.** Run-trace shows the three-state badge inline per step; summary strip aggregates correctly; skill-create flow with "Sends a customer SMS via Twilio" produces the suggestion payload and lets the operator save with one of three radio choices.

**Stage 1 ship line reached at end of Chunk 5.**

---

### Chunk 6 — Stage 2 schema, permissions, RLS manifest, CI gate

**spec_sections:** §3 Stage 2 migrations, §5 file inventory, §6.3-§6.6 contracts (`Scorecard`, `AgentScorecardAttachment`, `ScorecardJudgement`, `BenchRun`/`BenchResult`), §7 RLS posture, §10.6 unique-constraint→HTTP mapping.

**Files (new — 8):**
- `migrations/0290_scorecards.sql` (+ down)
- `migrations/0291_agent_scorecard_attachments.sql` (+ down)
- `migrations/0292_scorecard_judgements.sql` (+ down)
- `migrations/0293_bench_runs.sql` (+ down)
- `migrations/0294_system_agents_scorecard_defaults.sql` (+ down)
- `server/db/schema/scorecards.ts`
- `server/db/schema/agentScorecardAttachments.ts`
- `server/db/schema/scorecardJudgements.ts`
- `server/db/schema/benchRuns.ts` (defines both `bench_runs` and `bench_results`)
- `scripts/gates/verify-scorecard-rls.sh` — CI gate (CI-only).

**Files (modified — 4):**
- `server/db/schema/systemAgents.ts` — add `default_system_scorecard_slugs` jsonb, `default_org_scorecard_slugs` jsonb.
- `server/db/schema/agentTemplates.ts` — add `default_scorecard_slugs` jsonb.
- `server/db/schema/organisations.ts` — add `org_mandatory_scorecard_slugs` jsonb (nullable, default `'[]'::jsonb`).
- `server/db/schema/index.ts` — re-export the four new schema files.
- `server/config/rlsProtectedTables.ts` — append five new entries (one each for `scorecards`, `agent_scorecard_attachments`, `scorecard_judgements`, `bench_runs`, `bench_results`).
- `server/lib/permissions.ts` — append the six new permission keys to `ORG_PERMISSIONS` / `SUBACCOUNT_PERMISSIONS` and `ALL_PERMISSIONS`.

**Contracts.**

`scorecards` columns: `id`, `organisation_id` (nullable for system scope), `scope_type` (`'system' | 'org' | 'subaccount'`), `scope_id` (uuid nullable), `name`, `description`, `quality_checks` jsonb (array of `QualityCheck`), `share_with_subaccounts` boolean, `judge_model_id` text, `created_at`, `updated_at`, `deleted_at`. Unique: `(scope_type, scope_id, name) WHERE deleted_at IS NULL`.

`agent_scorecard_attachments`: `id`, `organisation_id`, `agent_id` FK, `scorecard_id` FK, `attach_authority` (`'system_mandatory' | 'org_mandatory' | 'suggested'`), `grading_frequency` (`'off' | 'q1' | 'q2' | 'q3'`), `attached_at`. Unique: `(agent_id, scorecard_id)`.

`scorecard_judgements`: per spec §6.5 with all five F1 snapshot fields. Unique: `(run_id, scorecard_id, quality_check_slug, trigger_source)`.

`bench_runs` + `bench_results`: per spec §6.6. Unique on `bench_runs`: `(triggered_by_user_id, target_agent_id_or_skill_combined, started_at_minute_truncated)`. Unique on `bench_results`: `(bench_run_id, candidate_model_id, sample_index)`.

`organisations.org_mandatory_scorecard_slugs`: jsonb default `'[]'`. Always-array invariant via DB CHECK.

**RLS templates.** All four primary tables (scorecards, attachments, judgements, bench) get FORCE RLS with `app.organisation_id = organisation_id`. `scorecards` adds `OR app.organisation_id IS NULL` for system-scope readability — service-layer filters before returning. Per architecture.md canonical template.

**System-scope write guard.** The `OR app.organisation_id IS NULL` clause widens the SELECT policy only. The corresponding INSERT / UPDATE / DELETE policies on `scorecards` MUST NOT include this clause — system-scope rows (`scope_type = 'system'`) are readable cross-tenant but MUST NEVER be writable from an org-context execution (where `app.organisation_id` is set). Implementer MUST write separate write policies (INSERT/UPDATE/DELETE use `app.organisation_id = organisation_id` only) and add a PR-reviewer check item: confirm no org-context request can mutate `scope_type = 'system'` rows.

**CI gate `verify-scorecard-rls.sh`:** asserts each of the five new tables has a `CREATE POLICY` statement in its migration AND a manifest entry pointing at the migration file.

**Error handling.** Migration is append-only; down migrations drop tables and columns.

**Test considerations.** PR reviewer verifies (a) RLS policies exact-match canonical template, (b) manifest entries point at correct migration files, (c) unique constraints visible in `\d` output, (d) CI gate (CI-only) passes.

**Dependencies.** Chunk 1 (so RLS manifest extension pattern is established).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run db:generate`.

**Acceptance criteria.** All five new tables exist with FORCE RLS active; manifest contains five new entries; six new permission keys appear in `ALL_PERMISSIONS`.

---

### Chunk 7 — scorecardServicePure (visibility, source-pill, regression risk, composite winner, attach-authority resolver)

**spec_sections:** §6.4 authority resolution rule, §6.6 regression risk thresholds + composite winner, §6.8 source-pill compression, §12.1 scorecard library scoping.

**Files (new — 2):**
- `server/services/scorecardServicePure.ts`
- `server/services/__tests__/scorecardServicePure.test.ts`

**Contracts.**

```ts
// All pure — no DB, no network, no filesystem.
export function compressSourcePill(
  scope: 'system' | 'org' | 'subaccount',
  viewerScope: 'org_admin' | 'subaccount'
): 'system' | 'organisation' | 'this_subaccount' | 'platform' | 'custom'

export function resolveAttachAuthority(args: {
  scorecardSlug: string;
  systemAgentDefaults: { default_system_scorecard_slugs: string[]; default_org_scorecard_slugs: string[] } | null;
  orgMandatorySlugs: string[];
  agentTemplateDefaults: string[] | null;
  operatorChecked: boolean;
}): 'system_mandatory' | 'org_mandatory' | 'suggested'

export function computeRegressionRisk(
  variance: number,
  sampleCount: number
): 'low' | 'medium' | 'high'
// Per §6.6: low if variance < 0.05 AND sampleCount >= 5;
// medium if 0.05 <= variance < 0.15 OR (variance < 0.05 AND sampleCount < 5);
// high if variance >= 0.15.

export function computeBenchComposite(
  results: Array<{
    candidateModelId: string;
    passesAllPassMarks: boolean;
    regressionRisk: 'low' | 'medium' | 'high';
    totalCostCents: number;
  }>
): { recommendedModelId: string | null; reason: string }
// Cheapest where passesAllPassMarks AND regressionRisk != 'high'; else null.

export function applyVisibilityRules(args: {
  scorecards: Scorecard[];
  viewerScope: 'system_admin' | 'org_admin' | 'subaccount';
  viewerOrgId: string | null;
  viewerSubaccountId: string | null;
}): Scorecard[]
// Implements the §12.1 pseudocode atomically.
```

**Error handling.** Pure functions. Invalid input (e.g. negative variance) returns the `'high'` risk class fail-closed; `applyVisibilityRules` with mismatched (scope, scope_id) drops the row.

**Test considerations (vitest, single file).** Permutation tests for all four `(scope, viewerScope)` combinations of `compressSourcePill`. Authority resolution covers all four branches in §6.4. Regression-risk thresholds covered with boundary values (variance=0.049, 0.05, 0.149, 0.15). Composite winner with no qualifying candidate returns `null` with operator-readable reason.

**Dependencies.** Chunk 6.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/__tests__/scorecardServicePure.test.ts`.

**Acceptance criteria.** All five pure functions exported; permutation tests pass; no DB imports (will be enforced by CI gate `verify-pure-helper-convention.sh`).

---

### Chunk 8 — scorecardService (impure) + scorecard routes + agent attach/detach routes

**spec_sections:** §6.4 authority resolution + delete forbidden rules, §12.1 visibility resolution, §12.2 multi-attach lifecycle.

**Files (new — 4):**
- `server/services/scorecardService.ts`
- `server/routes/scorecards.ts`
- `server/routes/agentScorecards.ts`
- `server/schemas/scorecards.ts` (Zod schemas for request bodies)

**Files (modified — 1):**
- `server/index.ts` — mount the two new route files.

**Contracts.**

Service methods (all wrapped in `withOrgTx` at caller):
- `scorecardService.list(viewerCtx)`
- `scorecardService.create(input)` — returns created scorecard.
- `scorecardService.update(id, patch, scope)`
- `scorecardService.delete(id, scope)` — soft delete (`deleted_at`).
- `scorecardService.duplicate(id, targetScope)` — copies into new scope.
- `scorecardService.toggleShareWithSubaccounts(id, value)`
- `scorecardService.attachToAgent(agentId, scorecardId, opts)` — calls `resolveAttachAuthority`.
- `scorecardService.detachFromAgent(agentId, scorecardId, callerScope)` — enforces deletion-by-authority rule.
- `scorecardService.listForAgent(agentId)` — used by judge runner.

Routes (all `asyncHandler`-wrapped per architecture.md):
- `GET /api/scorecards` — `requireOrgPermission('org.scorecards.view')`. Returns `{ scorecards: Scorecard[], sourcePillCompressed: true }` per viewer scope.
- `POST /api/scorecards` — `requireOrgPermission('org.scorecards.manage')`.
- `GET /api/scorecards/:id` — view permission.
- `PATCH /api/scorecards/:id` — manage permission.
- `DELETE /api/scorecards/:id` — manage permission. 422 if `attach_authority` constraints violated.
- `POST /api/scorecards/:id/duplicate` — manage permission.
- `POST /api/scorecards/:id/share-toggle` — manage permission, org-scope only.
- `GET /api/subaccounts/:subaccountId/scorecards` — subaccount scope (`resolveSubaccount` first).
- `POST /api/subaccounts/:subaccountId/scorecards` — `subaccount.scorecards.manage`.
- `GET /api/agents/:agentId/scorecards` — view permission.
- `POST /api/agents/:agentId/scorecards/attach` — manage permission. Body: `{ scorecardId, gradingFrequency? }`.
- `DELETE /api/agents/:agentId/scorecards/:scorecardId` — manage permission. 403 if authority violation.

**Error handling.** Standard error throw shape `{ statusCode, message, errorCode }`. Unique constraint violations mapped per spec §10.6: scorecard name taken → 422 `SCORECARD_NAME_TAKEN`; double-attach → 409 `SCORECARD_ALREADY_ATTACHED`. Detach-without-authority → 403 `ATTACH_AUTHORITY_VIOLATION`.

**Test considerations.** Service-layer tests deferred (impure). PR-reviewer verifies (a) `withOrgTx` wraps every DB call, (b) `resolveSubaccount` called on every subaccount route, (c) authority enforcement at delete time, (d) no `db` import in route files.

**Dependencies.** Chunks 6, 7.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

**Acceptance criteria.** Full CRUD on scorecards across three scopes; attach/detach with authority enforcement; sub-account viewer cannot see system scorecard with `share_with_subaccounts: false`.

---

### Chunk 9 — Sampled judge runner + scorecardJudgeJob + judge prompt design (Opus-escalation)

**spec_sections:** §12.3 sampled judge runner, §10.1 idempotency, §10.4 terminal event guarantee, §6.5 ScorecardJudgement contract + F1 snapshot invariant.

**Files (new — 4):**
- `server/services/scorecardJudgeRunner.ts`
- `server/services/scorecardJudgeRunnerPure.ts` — pure: `shouldSample(gradingFrequency, runId, scorecardId)` deterministic per (run, scorecard) tuple via hashing.
- `server/jobs/scorecardJudgeJob.ts`
- `server/jobs/__tests__/scorecardJudgeJobPure.test.ts` (pure helpers extracted: prompt-shape derivation, sample decision)

**Files (modified — 1):**
- `server/services/queueService.ts` — register `scorecard:judge` queue worker.

**Contracts.**

`scorecardJudgeRunner.subscribe()`:
- Subscribes to existing `agent_run.completed` events on `agent_execution_events`.
- For each event, loads `scorecardService.listForAgent(agentId)`.
- Per scorecard: `shouldSample(gradingFrequency, runId, scorecardId)` decides; if true, enqueues one `scorecard:judge` job per quality-check slug.
- Pure decision via deterministic hash so the same run is sampled / not-sampled identically across replays.
- **Bounded-fanout invariant.** Before enqueuing, compute `proposedJobCount = sampledScorecards.length × qualityChecksPerScorecard`. If `proposedJobCount > JUDGE_MAX_JOBS_PER_RUN` (env, default 20), truncate to the first N jobs in attachment-createdAt order and emit a `scorecard_judge.fanout_capped` structured log event. This is R1 mitigation at the queue-pressure level (cost cap is the financial guardrail; this is the queue-depth guardrail).

`scorecardJudgeJob` payload:
```ts
{
  runId: string;
  scorecardId: string;
  qualityCheckSlug: string;
  triggerSource: 'sampled' | 'forced_runtime_check_fail' | 'forced_correction';
  organisationId: string;
}
```

Job behaviour:
1. Load run + agent context inside `withOrgTx(organisationId)`.
2. Load scorecard. Snapshot `name`, `description`, `passMark`, `judgeModelId`, `updatedAt` per F1 invariant.
3. Build judge prompt — **OPUS-ESCALATION HERE**. Prompt must produce strictly-parseable JSON `{ observedScore: number (0..1), judgeReasoning: string }` for the single quality check in the payload. Few-shot examples + system prompt drafted in Opus mode.
4. Call `llmRouter.routeCall` with `LLMCallContext` carrying `idempotencyKey = sha256(runId + scorecardId + qualityCheckSlug + triggerSource)`.
5. Compute `verdict = observedScore >= snapshotPassMark`.
6. INSERT `scorecard_judgements` row with `ON CONFLICT (run_id, scorecard_id, quality_check_slug, trigger_source) DO NOTHING`.
7. Emit `scorecard_judgement.recorded` event.

**Error handling.** LLM failure → pg-boss retry per existing `withBackoff`. Malformed JSON → log + retry up to N=3, then mark partial. Idempotency: re-run with the same key is a no-op insert.

**Cost guard.** Judge LLM call respects `assertWithinRunBudget` envelope. Per R1 mitigation: `q1` (25%) is the default; org admin can lower per-attachment via existing edit endpoint.

**Test considerations.** Pure tests for `shouldSample` (deterministic across run-id permutations per §8.21), prompt-shape derivation, `verdict` computation. PR-reviewer verifies F1 snapshot fields populated at insert time and that join-back to `scorecards` row is NEVER used in trend queries (per F1 invariant).

**Dependencies.** Chunks 6, 7, 8.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/jobs/__tests__/scorecardJudgeJobPure.test.ts`.

**Acceptance criteria.** A completed run with one attached scorecard at `q2` (50%) gets sampled approximately 50% of the time across 1000 hash-driven decisions (test asserts within tolerance). Successful sampled run produces `scorecard_judgements` row with all five F1 snapshot fields populated and `triggerSource: 'sampled'`.

---

### Chunk 10 — Forced judge job + Stage 1 hook wiring + Stage 3 hook stub

**spec_sections:** §12.3 forced grading, §13.2 capture flow step 2.

**Files (new — 1):**
- `server/jobs/scorecardJudgeForcedJob.ts`

**Files (modified — 3):**
- `server/services/agentExecutionService.ts` — when persistRuntimeCheckResult writes `state === 'fail' && blastRadius !== 'self'`, enqueue `scorecard:judge:forced` for all attached scorecards on the agent.
- `server/services/queueService.ts` — register `scorecard:judge:forced` queue worker.
- `server/services/scorecardJudgeRunner.ts` — expose `scheduleForcedGrade({ runId, agentId, triggerSource })` for Stage 3 hook (no-op when no scorecards attached).

**Contracts.**

`scheduleForcedGrade` payload mirrors `scorecardJudgeJob` payload but with `triggerSource: 'forced_runtime_check_fail'` or `'forced_correction'`. Same idempotency key shape; same `ON CONFLICT DO NOTHING` insert. Separate queue (`scorecard:judge:forced`) so forced grades don't starve sampled grades.

**Error handling.** No-op when agent has zero attached scorecards (Stage 3 soft dependency). Logged at `info` per call.

**Test considerations.** Pure test: `selectForcedGradeTargets(agent, attachedScorecards, runtimeCheckResult)` returns the correct set of (scorecardId, qualityCheckSlug) tuples to enqueue. Permutation across blast_radius values + scorecard count.

**Dependencies.** Chunk 9.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/jobs/__tests__/scorecardJudgeForcedJobPure.test.ts`.

**Acceptance criteria.** A `state: 'fail'` runtime check on a `blastRadius: 'tenant'` action with two attached scorecards (each with three quality checks) enqueues exactly six `scorecard:judge:forced` jobs.

---

### Chunk 11 — Bench: pure + service + routes + execute job + regression-replay extension

**spec_sections:** §6.6 BenchRun + BenchResult, §10.7 state machine closure (bench_runs.status), §12.4 model bench (incl. F5 atomicity, M2 judge≠candidate, M3 server-side cost cap), §17 deferred items relevant to retention.

**Files (new — 6):**
- `server/services/benchRunServicePure.ts`
- `server/services/benchRunService.ts`
- `server/jobs/benchExecuteJob.ts`
- `server/jobs/benchRegressionReplayJob.ts`
- `server/routes/benchRuns.ts`
- `server/routes/governQuality.ts`

**Files (modified — 2):**
- `server/services/regressionReplayService.ts` — extend to dispatch `bench:regression-replay:{benchRunId}` for every approved bench when a provider model version updates.
- `server/services/queueService.ts` — register `bench:execute` and `bench:regression-replay` workers.

**Contracts.**

`benchRunServicePure`:
- `estimateCost({ candidateModels, sampleCount, judgeModelId, ...})` — uses `llmRequestEstimateService` model + judge token estimates. Pure given pricing snapshot.
- `applyJudgeNeqCandidateRule({ candidateModels, judgeModelId, orgDefaultJudge })` — M2: if judgeModelId is in candidateModels, swap to orgDefaultJudge; surface notice flag.
- `validateCostCap(estimatedCents, capCents)` — M3: throws shape `{ statusCode: 422, errorCode: 'BENCH_COST_CAP_EXCEEDED' }` when over cap.
- `computeBenchSummary(results)` — aggregator wrapping `computeRegressionRisk` + `computeBenchComposite` from `scorecardServicePure`.

`benchRunService.estimate(input)`:
- Inline / synchronous. Returns `{ benchRunId, estimatedCostCents, judgeSwapNotice?, status: 'awaiting_confirm' }`.
- Persists `bench_runs` row at `status: 'estimating' → 'awaiting_confirm'`.

`benchRunService.run(benchRunId)`:
- Validates `status === 'awaiting_confirm'`.
- Transitions to `'running'`. Enqueues `bench:execute` job.

`benchRunService.approve(benchRunId, candidateModelId)`:
- F5 invariant — explicit three-phase structure:
  1. **Pre-tx validation.** Assert `benchRun.status === 'awaiting_approval'` and `candidateModelId` is a member of `benchRun.candidateModelIds`. Throws 412 on mismatch — no DB write yet.
  2. **In-tx mutation.** Opens `withOrgTx`; atomically sets `bench_runs.approved_model_id`, updates the agent's `default_model_id`, and inserts `bench_approval_succeeded` event row. On rollback, no state change is observable to the operator.
  3. **afterCommit side effects.** After the transaction commits: invalidate any caches keyed on the agent's model, fanout via the existing pulse WebSocket pipeline (`bench_approval_succeeded` event), enqueue any async notifications. These MUST NOT execute inside the transaction body — a commit failure after emitting a WebSocket event would leave the UI in an inconsistent state.

Routes:
- `POST /api/bench-runs/estimate` — `requireOrgPermission('org.scorecards.bench_run')`.
- `POST /api/bench-runs/:id/run` — same permission. Returns 412 if `status !== 'awaiting_confirm'`.
- `GET /api/bench-runs/:id` — returns full state including summary.
- `GET /api/bench-runs/:id/results` — paginated.
- `POST /api/bench-runs/:id/approve` — same permission. F5 atomic.
- `GET /api/quality/agents` — drift list for Govern / Quality tab.
- `GET /api/quality/bench-history` — bench history list.

`benchExecuteJob` payload: `{ benchRunId, organisationId }`. Single-writer-per-bench-run via `FOR UPDATE SKIP LOCKED`. Per-(model, sample-index) idempotency. Partial completion → `status: 'partial'`.

**Error handling.** State-machine transitions wrapped via `assertValidTransition` from `shared/stateMachineGuards.ts` per §8.18. Cost-cap exceeded → 422 from estimate endpoint, never enters `awaiting_confirm`. Concurrent run attempts → unique constraint on `(triggered_by_user_id, target_..., started_at_minute)` returns 409 with `existingBenchRunId`.

**Test considerations.** Pure tests for `estimateCost` (boundary: zero candidates, zero samples), `applyJudgeNeqCandidateRule` (judge ∉ candidates, judge ∈ candidates), `validateCostCap` (at cap, over cap, under cap), `computeBenchSummary` (partial completion, all-fail). Permutation test on `computeBenchComposite` with same-cost candidates ensures deterministic tiebreak via candidate ID.

**Dependencies.** Chunks 6, 7, 8, 9.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/__tests__/benchRunServicePure.test.ts`.

**Acceptance criteria.** Operator triggers a 3-candidate × 5-sample bench with judge already in candidate list → judge swap notice surfaced; cost estimate returned; cost cap rejection at 6000 cents (cap 5000); approve transitions atomic. Regression replay enqueues for the approved bench when a provider model version updates.

---

### Chunk 12 — Stage 2 UI: Govern/Quality, scorecard library, scorecard create, agent edit/create scorecard tabs, model bench

**spec_sections:** §12.1 library scoping, §12.2 multi-attach UX, §12.4 bench three-state page, §12.5 authority levels rendering, §14 mockup mapping (Govern / Quality, scorecard library, scorecard create, agent create / edit, model bench).

**Files (new — 9):**
- `client/src/pages/govern/QualityPage.tsx` — three tabs (Agents drift / Scorecards / Bench history).
- `client/src/pages/govern/ScorecardLibraryTab.tsx`
- `client/src/pages/govern/ScorecardCreatePage.tsx`
- `client/src/pages/govern/ModelBenchPage.tsx`
- `client/src/pages/agents/AgentEditScorecardTab.tsx`
- `client/src/pages/agents/AgentCreateScorecardSection.tsx`
- `client/src/components/scorecard/ScorecardSourcePill.tsx`
- `client/src/lib/api/scorecards.ts`
- `client/src/lib/api/benchRuns.ts`

**Files (modified — 2):**
- `client/src/App.tsx` (or router file) — add Govern / Quality route.
- `client/src/components/Sidebar.tsx` (or equivalent) — add Govern / Quality nav entry gated by `org.scorecards.view`.

**Contracts.**

`ScorecardSourcePill` props: `{ scope: 'system' | 'org' | 'subaccount', viewerScope, ownerName?: string }`. Internally calls `compressSourcePill` (mirror of server `scorecardServicePure`). Tooltip `"Created by <Organisation name>"` or `"Created in this sub-account"` per §6.8.

`AgentEditScorecardTab` renders attached scorecards with `attach_authority` lock icon for `system_mandatory` / `org_mandatory` (collapsed to "Required" at sub-account viewer scope per §12.5). Quartile control (Off / 25% / 50% / 75%) per attachment.

`ModelBenchPage` three-state page:
- **Setup.** Mode (Agent / Skill), candidate-model picker, sample-count slider (1..50), test-input picker (Recent real runs / Paste-in), cost estimate panel (recomputes inline), Run bench button.
- **Running.** Per-candidate progress bar, ETA, abort.
- **Results.** Comparison table, regression-risk pill, recommended row highlighted, Approve as default button.

**Error handling.** Loading + empty + error states for each tab. Optimistic detach with rollback on 403.

**UX considerations.**
- Govern / Quality entry visible only to viewers with `org.scorecards.view` (org admin) or `subaccount.scorecards.view`.
- Model bench requires `org.scorecards.bench_run`; sub-account viewers see a read-only view of bench history.
- Cost estimate renders before Run bench is enabled — Run button disabled until estimate returns.
- Cost-cap rejection (422) renders an inline banner naming the cap and the env var ops can adjust.
- Lock-icon rows on `AgentEditScorecardTab` are caret-expandable and read-only at sub-account scope per §12.5.
- Real-time updates: scorecard judgement events drive Govern / Quality drift sparklines via the existing pulse WebSocket pipeline; Bench progress updates via the same channel.
- Empty states: zero scorecards in library renders a Create Scorecard CTA tied to `org.scorecards.manage`; zero attached scorecards on agent renders the Suggested rows from `system_agents.default_org_scorecard_slugs` so the operator never lands on a blank tab.
- Empty test-input picker on Model Bench (zero recent runs) auto-switches the picker to "Paste-in" mode.

**Test considerations.** Per testing posture, no React Testing Library tests. Pure helpers (e.g. `formatCostEstimate`) extracted to `client/src/lib/benchUiPure.ts` and unit-tested. Manual G2 visual diff covers the three-state bench page, Govern / Quality drift list, and the lock-icon rendering.

**Dependencies.** Chunks 6–11.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:client`, `npx vitest run client/src/lib/__tests__/benchUiPure.test.ts`.

**Acceptance criteria.** Org admin browses scorecard library across three scopes with correct compression. Org admin attaches a scorecard to an agent with `q2` sampling; sub-account viewer sees the same scorecard listed as Required (lock icon). Operator runs a 3×5 bench, sees the cost estimate, gets a regression-risk-coloured pill on results, approves a candidate.

**Stage 2 ship line reached at end of Chunk 12.**

---

### Chunk 13 — Stage 3 schema + correction types + capture service + route + Run-trace Correct dialog

**spec_sections:** §3 Stage 3 migration, §6.7 Correction capture payload + memory_block shape, §10.1 idempotency posture (memory_blocks correction unique), §13.1 Correct dialog, §13.2 capture flow.

**Files (new — 6):**
- `migrations/0295_memory_blocks_operator_correction.sql` (+ down)
- `shared/types/correction.ts`
- `server/services/correctionCaptureService.ts`
- `server/routes/corrections.ts`
- `client/src/components/correction/CorrectDialog.tsx`
- `client/src/lib/api/corrections.ts`

**Files (modified — 3):**
- `server/db/schema/memoryBlocks.ts` — extend `MemoryBlockCapturedVia` type to include `'operator_correction'`.
- `server/lib/permissions.ts` — already added `subaccount.corrections.create` in Chunk 6 (re-used here — no edit, only consumption).
- `client/src/pages/runs/RunTracePage.tsx` — add hover Correct action per Round 5 mockup.

**Contracts.**

Migration 0295: extend the `captured_via` text enum check on `memory_blocks` to allow `'operator_correction'`. No structural change. Add a partial unique index `(organisation_id, source_run_id) WHERE captured_via = 'operator_correction' AND deleted_at IS NULL` (per spec §10.1 — re-clicking Correct on the same step UPSERT-replaces).

`shared/types/correction.ts`:
```ts
export interface CorrectionDialogPayload {
  runId: string;
  eventId: string;
  agentId: string;
  skillSlug: string;
  originalOutput: string;
  editedOutput: string;
  reason: string | null;
}
export interface CorrectionResult {
  memoryBlockId: string;
  forcedGradeEnqueued: boolean;
}
```

`correctionCaptureService.create(payload)`:
- Inside `withOrgTx(orgId)`:
  - UPSERT into `memory_blocks` per spec §6.7 example shape, `captured_via: 'operator_correction'`, `confidence: 'low'`, `quality_score: 0.85`, `status: 'active'`.
  - Emit `correction.captured` event into `agent_execution_events`.
- After commit:
  - Call `scorecardJudgeRunner.scheduleForcedGrade({ runId, agentId, triggerSource: 'forced_correction' })` — no-op if no scorecards attached (Stage 2 soft dependency).
- Return `{ memoryBlockId, forcedGradeEnqueued: boolean }`.

Route:
- `POST /api/runs/:runId/steps/:eventId/correct` — `requireSubaccountPermission('subaccount.corrections.create')` (subaccount-scoped agent runs) OR `requireOrgPermission('org.observability.view')` for org-scope runs. Wraps service call.

`CorrectDialog` modal:
- Edited output textarea (multi-line, prefilled with original).
- Reason textarea (optional, max 500 chars).
- About this correction metadata block (system-rendered, not editable):
  - Scope: "This agent only"
  - Persistence: "Active on next run"
  - Confidence: "High signal — applied immediately, listed under Knowledge where you can edit, override, or reject"
- Save / Cancel buttons.

**Error handling.** Idempotent UPSERT via partial unique index → re-clicking Correct on same step replaces the row. **Concurrency semantics (two operators correcting the same step simultaneously):** last-write-wins by `updated_at` — the ON CONFLICT DO UPDATE clause must set `updated_at = now()` and update all mutable fields; the latest commit timestamp wins. No optimistic locking required here; concurrent corrections are equivalent human signals and either value is acceptable. 422 if `editedOutput` is empty or > 50KB. 404 if `eventId` does not belong to `runId` (cross-entity ID verification per §9 multi-tenant safety checklist).

**UX considerations.**
- Correct hover affordance visible only for viewers with `subaccount.corrections.create` (or `org.observability.view` for org-scope runs); read-only viewers do not see the affordance.
- After save, run-trace renders an inline "Correction saved — Active on next run" toast and updates the step badge immediately (optimistic with server confirmation).
- Loading state during save shows the dialog footer with a spinner; Cancel remains enabled until the request fires.
- Error state on 422 inlines the validation message under the textarea; on 404 surfaces a non-modal alert "Step not found — refresh the run".
- Empty state: when the operator opens the dialog on a step with no original output, the textarea prefills empty and the metadata block notes "originally empty" so the correction is saved as additive content.
- Real-time: the existing `correction.captured` event is wired through the run-id WebSocket room so the badge update is immediate across panes.

**Test considerations.** Pure helper `correctionPayloadValidator` (size, charset) tested. Service-layer impure — PR-reviewer verifies (a) UPSERT partial-index correctness, (b) cross-entity ID verification (`eventId` belongs to `runId` AND `runId` belongs to `req.orgId`), (c) `forcedGradeEnqueued: false` when zero scorecards.

**Dependencies.** Chunks 1–5 (Run-trace UI exists), Chunk 9 (`scheduleForcedGrade` exists), Chunk 6 (permission key exists).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:client`, `npm run build:server`, `npx vitest run shared/types/__tests__/correctionPayloadValidator.test.ts`.

**Acceptance criteria.** Operator clicks Correct on a step, edits output, saves; row appears in `memory_blocks` with `captured_via: 'operator_correction'`; re-clicking Correct on same step replaces (single row, last write wins); when scorecard attached, forced grade is enqueued.

---

### Chunk 14 — Correction-pattern detector pure + job + Stage 2 forced-grade wiring (Opus-escalation)

**spec_sections:** §13.3 pattern detector (incl. F4 clustering algorithm pin).

**Files (new — 4):**
- `server/services/correctionPatternDetectorPure.ts`
- `server/jobs/correctionPatternDetectorJob.ts`
- `server/services/__tests__/correctionPatternDetectorPure.test.ts`
- `server/jobs/__tests__/correctionPatternDetectorJobPure.test.ts`

**Files (modified — 2):**
- `server/services/queueService.ts` — register `correction:pattern-detect` queue worker (daily schedule).
- `server/services/agentRecommendationsService.ts` — add `category: 'scorecard_tightening_suggestion'` payload shape (no DB change; existing dedupe + lifecycle).

**Contracts.**

```ts
// Pure clusterer
export function cluster(args: {
  corrections: Array<{
    memoryBlockId: string;
    agentId: string;
    skillSlug: string;
    editedOutputEmbedding: number[];
    capturedAt: string;
  }>;
  similarityThreshold: number;     // env: CORRECTION_CLUSTER_SIMILARITY (default 0.82)
  minClusterSize: number;          // env: CORRECTION_CLUSTER_MIN_SIZE (default 3)
  windowDays: number;              // env: CORRECTION_CLUSTER_WINDOW_DAYS (default 30)
}): Array<{
  agentId: string;
  skillSlug: string;
  memberMemoryBlockIds: string[];
  centroidEmbedding: number[];
  representativeEditedOutput: string;
}>;
```

Algorithm (per spec §13.3 V1 pin):
1. Group candidates by exact match on `agent_id` AND `skill_slug`.
2. Within each group, compute pairwise cosine similarity over `editedOutputEmbedding`.
3. Form clusters where pairwise cosine similarity ≥ `similarityThreshold` (default 0.82). **OPUS-ESCALATION HERE** — choice between hierarchical agglomerative vs greedy single-link clustering, plus tie-breaker on representative selection.
4. Drop clusters with size < `minClusterSize` (default 3).
5. Compute centroid embedding (arithmetic mean of member embeddings).

**Determinism invariants (required for §8.21 replay correctness):**
- `memberMemoryBlockIds` in each returned cluster MUST be sorted by `(capturedAt ASC, memoryBlockId ASC)` — stable across any input-order permutation.
- `representativeEditedOutput` MUST be selected as the member with the smallest cosine distance to the cluster centroid; on tie, take the member with the earliest `capturedAt`; on remaining tie, take the lexicographically smallest `memoryBlockId`.
- Cluster iteration order in the returned array MUST be sorted by `(agentId ASC, skillSlug ASC, clusterIndex ASC)` where `clusterIndex` is the 0-based insertion order from the chosen algorithm. The same fixture replayed with shuffled input MUST produce the same cluster array in the same order.

`correctionPatternDetectorJob` (daily pg-boss schedule):
1. For each org (`withAdminConnection` for iteration → `withOrgTx(orgId)` per write per DEVELOPMENT_GUIDELINES.md §2):
2. Load correction-sourced memory_blocks created in last `windowDays`.
3. Pass into `cluster()`.
4. For each detected cluster:
   - Promote a synthesised `memory_blocks` row at `status: 'pending_review'`, `confidence: 'low'`, `source: 'auto_synthesised'`, `captured_via: 'auto_synthesised'`, `quality_score: 0.50` per existing S11 pipeline.
   - If feature flag `scorecard_tightening_suggestions` enabled (default on per Q5) AND a quality_check exists with description cosine-similar (>0.75) to cluster centroid: emit `agent_recommendations` row with `category: 'scorecard_tightening_suggestion'`, `severity: 'info'`.
5. Emit `correction_pattern.cycle_completed` event (or per-cluster `correction_pattern.promoted` events).

**Error handling.** Per-org loop runs idempotently per (org, window-end). Memory promotion via existing S11 pipeline (idempotent). Recommendation enqueue is best-effort with log-and-swallow per spec §10.5 ("memory-block promotion is the load-bearing outcome").

**Test considerations.** Pure tests cover (a) exact-match grouping, (b) similarity threshold boundaries (0.81 dropped, 0.82 kept), (c) min-size threshold (size 2 dropped, size 3 kept), (d) centroid arithmetic-mean correctness, (e) determinism under input permutation per §8.21.

**Dependencies.** Chunks 13 (correction memory exists), Chunk 9/10 (scorecard infrastructure for the optional suggestion).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/__tests__/correctionPatternDetectorPure.test.ts`.

**Acceptance criteria.** A test fixture with five corrections on `(agent_X, skill_Y)` where four are similar (cosine ≥ 0.82) and one is dissimilar produces exactly one cluster of four. Job promotes one memory_block to `pending_review` and emits one `agent_recommendations` row when feature flag is on.

---

### Chunk 15 — Knowledge page filter chip + Source column + recommendations strip integration

**spec_sections:** §13.4 Knowledge page integration, §13.5 provenance fields exposed on row drawer.

**Files (modified — 2):**
- `client/src/pages/govern/KnowledgePage.tsx` — add filter chip group (`All | From corrections | Manually authored | Auto-synthesised`); add `Source` column (small pill: `Correction` | `Manual` | `Auto`); add provenance fields in row drawer.
- `client/src/lib/api/memoryBlocks.ts` — accept `?source=corrections` query param.

**Files (new — 1):**
- `client/src/components/knowledge/SourcePillKnowledge.tsx`

**Contracts.**

Filter chip query params:
- `source=all` (default)
- `source=corrections` → `WHERE captured_via = 'operator_correction'`
- `source=manual` → `WHERE captured_via IN ('manual_edit', 'manual_create')`
- `source=auto` → `WHERE captured_via = 'auto_synthesised'`

Source column: rendered via `SourcePillKnowledge` per row's `captured_via` value. Click navigates to filter applied.

Provenance row drawer fields per §13.5:
- Source run (linkable to Run-trace): `source_run_id`.
- Trigger event: derived from `source_run_id` + corrected step.
- Time captured: `created_at`.
- Last used / Usage frequency: existing memory-injection telemetry.
- Attached agents: `agents.memory_block_attachments`.
- Confidence tier: `confidence`.
- Human-approved vs pattern-inferred: derived `confidence='normal' AND captured_via='operator_correction'` → human-approved.

Existing `Edit and override` / approve / reject controls work unchanged. Pattern-detector recommendation strip surfaces `agent_recommendations` rows with `category: 'scorecard_tightening_suggestion'`.

**Error handling.** Filter UI degrades gracefully if memory-injection telemetry endpoint is absent (e.g. shows `--` for usage frequency).

**Test considerations.** Pure helper for filter→query mapping unit-tested. Per testing posture, no React Testing Library tests.

**UX considerations.**
- Filter chips visible to anyone with the existing Knowledge page permission; no new gate.
- Empty state per filter: "No corrections in the last 30 days" with a one-line link to Run-trace; "No auto-synthesised entries yet" with a link to the pattern-detector docs in capabilities.md.
- Loading state preserves the chip selection while rows refresh.
- Error state on filter API failure renders an inline retry banner without unmounting the chip group.
- Real-time: `correction.captured` events update the From-corrections filter count badge live; pattern-detector promotions surface as a soft toast on the page.
- Permissions: `Edit and override` / approve / reject controls remain gated by existing Knowledge permissions; the new filter is read-only and visible to everyone with view access.

**Dependencies.** Chunks 13, 14.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:client`.

**Acceptance criteria.** Operator filters Knowledge page to "From corrections" — sees the rows from Chunk 13. Source column displays the right pill per row. Operator clicks a row, drawer surfaces provenance fields including link to source run.

**Stage 3 ship line reached at end of Chunk 15.**

---

### Chunk 16 — Doc-sync (capabilities.md, architecture.md, KNOWLEDGE.md, retention pin handoff)

**spec_sections:** §17 deferred items (M1 retention) — Stage-2-GA ship-blocker; CLAUDE.md §11 docs-stay-in-sync.

**Files (modified — 3):**
- `architecture.md` — append a "Trust & Verification Layer" section under Govern services; add the five new tables to "Key files per domain"; document the four new pg-boss queues (`scorecard:judge`, `scorecard:judge:forced`, `bench:execute`, `correction:pattern-detect`); document all six new permission keys **in the canonical permission matrix** (the table/section in architecture.md that lists all permission keys — each new key must include: key string, scope, granted action, and which roles receive it by default).
- `docs/capabilities.md` — add a vendor-neutral "Trust & Verification Layer" entry describing the three layers in benefit language (no provider names, no engineering identifiers, per §3 editorial rules); update the Replaces / Consolidates table if the new surface displaces any existing entry.
- `KNOWLEDGE.md` — append patterns: (a) cross-tenant Source-pill compression, (b) three-tier authority lock model, (c) single-share-toggle visibility primitive, (d) idempotent UPSERT on correction capture, (e) runtime-check three-state UI collapse from five internal states.

**Files (new — 1):**
- `tasks/builds/trust-verification-layer/retention-handoff.md` — Stage-2-GA ship-blocker pin per spec §17 M1: target retention windows (90d / 90d / 365d), measurement plan (row-rate × per-row size × cost-per-GB before Stage 2 GA), env vars to introduce, archival strategy options.

**Contracts.** Documentation only. No code change. `docs/doc-sync.md` triggers asserted: new permissions → architecture.md; new RLS tables → architecture.md + manifest section; new public capability → capabilities.md; new pattern → KNOWLEDGE.md.

**Error handling.** N/A.

**Test considerations.** Reviewer checks (a) capabilities.md uses vendor-neutral marketing language per §3 editorial rules, (b) architecture.md reflects the new key files and queue workers, (c) KNOWLEDGE.md entries are class-level rules (one to two sentences each).

**Dependencies.** All prior chunks.

**Verification commands:** `npm run lint` (catches MD lint issues if MD lint is wired).

**Acceptance criteria.** All four files updated in the same commit; chatgpt-pr-review and finalisation-coordinator can verify doc-sync at branch level. All six new permission keys (`org.scorecards.view`, `org.scorecards.manage`, `org.scorecards.bench_run`, `subaccount.scorecards.view`, `subaccount.scorecards.manage`, `subaccount.corrections.create`) appear in the canonical permission matrix in architecture.md with scope, granted action, and default-role columns populated.

---

---

## 5. Risks recap (operator must decide)

These three items need an operator call before/during build. Recommendation in parens; default applied if operator does not push back.

1. **Top-20 backfill list (handoff Q1).** Confirm seed list in `runtime-check-coverage-list.md` against last 30 days of usage telemetry before Chunk 2 ships. *Recommendation: confirm during Chunk 2; the seed list in spec §5 is plausible but unconfirmed.*
2. **Retention windows for `runtime_check_results`, `scorecard_judgements`, `bench_results` (R9 / spec §17 M1).** Stage-2-GA ship-blocker. Default working assumption: 90d / 90d / 365d. *Recommendation: operator pins before Stage 2 GA; growth telemetry from first weeks of production drives the final number.*
3. **Bench cost cap value (R2 / spec §12.4 M3).** Default 5000 cents = $50/run. *Recommendation: operator confirms; tunable via env without redeploy.*

---

## 6. Appendix: spec coverage map

Every spec section mapped to at least one chunk:

| Spec § | Topic | Chunk(s) |
|---|---|---|
| §1 Goals & non-goals | Three-stage build sequence | All chunks (architectural anchor) |
| §2 Glossary & terminology lock | Vocabulary | All chunks via shared types + UI |
| §3 Phase plan | Stage migrations | 1, 6, 13 |
| §4 Existing-primitive search | Reuse decisions | 3, 8, 10, 13, 14, 15 |
| §5 File inventory | Files to create / modify | 1–16 (covered chunk-by-chunk) |
| §6.1 RuntimeCheckDefinition | Skill registry contract | 2 |
| §6.2 RuntimeCheckResult + F6 invariant | Per-step result | 1, 2, 5 |
| §6.3 Scorecard | Library shape | 6, 7, 8 |
| §6.4 AgentScorecardAttachment + authority resolution | Attach lifecycle | 6, 7, 8 |
| §6.5 ScorecardJudgement + F1 snapshot | Per-judgement provenance | 6, 9 |
| §6.6 BenchRun + BenchResult + thresholds | Bench primitives | 6, 7, 11 |
| §6.7 Correction capture | Memory shape | 13 |
| §6.8 Source-pill compression | Visibility rule | 7, 12 |
| §7 Permissions / RLS checklist | RLS posture | 1, 6 |
| §8 Execution model | Sync vs queued | 3, 9, 10, 11, 14 |
| §9 Phase sequencing | Dependency graph | All chunks (forward-only) |
| §10.1–§10.7 Execution-safety contracts | Idempotency, retries, concurrency, terminal events, state-machine closure, HTTP mapping | 1, 6, 9, 11, 13 |
| §11 Layer 1 | Skill verification | 1, 2, 3, 4, 5 |
| §12 Layer 2 (incl. F1, F5, M2, M3) | Scorecards + bench | 6–12 |
| §13 Layer 3 (incl. F4) | Correction memory | 13, 14, 15 |
| §14 UI surfaces / mockup mapping | Mockup → spec section → chunk | 5, 12, 13, 15 |
| §15 Self-consistency pass | Spec-author verification | All chunks (review at finalisation) |
| §16 Testing posture | Pure-only + CI gates | All chunks (Vitest + CI gate references) |
| §17 Deferred items | What we are NOT building | 16 (docs); R9 retention pin |
| §18 Open questions | Six operator decisions | Defaults applied per handoff; flagged in chunks |

---

**End of plan.**
