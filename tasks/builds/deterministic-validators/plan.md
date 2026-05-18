# Implementation Plan: Deterministic Validators alongside LLM-as-Judge

**Build slug:** deterministic-validators
**Spec:** `docs/superpowers/specs/2026-05-18-deterministic-validators-spec.md`
**Plan date:** 2026-05-18
**Plan author:** architect (Opus 4.7, 1M)
**task_class:** Major

---

## Table of Contents

1. Pre-Phase 2 Locked Decision
2. Model-collapse check
3. Codebase reconciliation findings (load-bearing)
4. System Invariants block
5. Architecture Notes
6. Chunk Decomposition
   - Chunk 1 — Schema migrations
   - Chunk 2 — Validator framework, isolation lint, CLI scaffolding
   - Chunk 3 — Dispatcher
   - Chunk 4 — Phase 1 catalogue (8 remaining validators)
   - Chunk 5 — Audit ledger, observability, startup snapshot, cost attribution
   - Chunk 6 — UI surfaces (rubric editor + VerdictDrillIn + validators API)
7. Risks and Mitigations
8. Acceptance Criteria (programme-level)
9. Executor notes

---

## 1. Pre-Phase 2 Locked Decision

**VerdictDrillIn surface location.** Locked: the `VerdictDrillIn` component lives as a panel rendered inside the existing "Needs Review" lane of the Inbox tab (spec §10.2, §19 Q1). The Inbox already groups review-needed verdicts; this build does NOT add a new tab, route, or sidebar entry. Decision recorded here so the executor never re-litigates it.

---

## 2. Model-collapse check

The spec's value proposition is **deterministic, sub-millisecond, model-free verdicts** that LLM judges cannot replace. Decomposing the dispatcher into a single model call would defeat the entire reason for the build, the validators exist precisely to remove the LLM from the inner loop where logic, schema validity, regex matches, and entity lookups can be checked deterministically. The hybrid path retains the model call but only after deterministic gating; the model is not removed from the system, it is removed from the cases where it is the wrong tool.

**Decision: reject collapse.** Deterministic verdicts are the goal, not the obstacle. A "one frontier model call replaces all this" framing would re-introduce the failure mode the spec is designed to defeat (gaming, hallucinated false-pass on schema-invalid output, cost attribution that hides drift).

---

## 3. Codebase reconciliation findings (load-bearing)

Before chunk decomposition, the following spec/codebase mismatches were uncovered and MUST be carried into implementation. They are not optional notes, each one would otherwise become a Chunk-1 blocker:

| # | Spec claim | Codebase reality | Plan resolution |
|---|---|---|---|
| 1 | Unique index on `scorecard_judgements` is `scorecard_judgements_judgement_run_id_check_slug_key` on `(judgement_run_id, check_slug)` (§7.2, §15.5) | Actual index is `scorecard_judgements_run_scorecard_check_trigger_uniq` on `(run_id, scorecard_id, quality_check_slug, trigger_source)` (migration 0299) | Plan uses the actual index name and the actual column set. `ON CONFLICT DO NOTHING` clause in the dispatcher MUST target the full 4-column tuple, not the 2-column tuple. |
| 2 | `shared/types/scorecardTypes.ts` is the home for `QualityCheck` (§5.4, §12) | `QualityCheck` lives in `server/db/schema/scorecards.ts` and is re-exported by `client/src/lib/api/scorecards.ts` | Plan extends BOTH the server schema file (canonical) AND the client API type file (mirror) with the new optional fields. No new `shared/types/scorecardTypes.ts` file is created, that path stays absent. |
| 3 | `validator_versions` and `validator_invocations` go in `server/config/rlsProtectedTables.ts` as explicit opt-outs (§5.2, §5.3, §11 Step 1, §13) | `rlsProtectedTables.ts` is the registry of tables WITH RLS, not a list of opt-outs. System-tier tables (no `organisation_id`) are auto-exempt from the RLS gate. The opt-out mechanism for tables that HAVE `organisation_id` is `scripts/rls-not-applicable-allowlist.txt`. Neither file lists `skill_versions` (the spec's stated parallel). | Plan omits both new tables from `RLS_PROTECTED_TABLES` (correct, they have no `organisation_id`) and from the allowlist (correct, they do not carry tenant columns). Per `DEVELOPMENT_GUIDELINES.md` §6.3, the migration MUST include a `-- system-scoped: <reason>` header for each new system-tier table. CI gate `verify-rls-protected-tables.sh` will pass because the gate only flags tables WITH `organisation_id`. |
| 4 | "Self-registration pattern (mirrors `SKILL_HANDLERS`)" (§6.2) | `SKILL_HANDLERS` is not self-registration. It is an **object-spread aggregation** in `server/services/skillExecutor/registry.ts` that composes per-domain handler records exported by sibling files. No side-effect `register*` calls. | Plan uses the same object-spread aggregation pattern for validators. Each validator file `export const validator: Validator = { ... }` and `registry.ts` imports them and composes the lookup map. NO side-effect `registerValidator()` calls, those would create a top-level side-effect import edge and break tree-shaking / lazy boot. The `.registry-meta.json` reader still gates which validators end up in the runtime lookup. |
| 5 | "Latest migration number so the plan can assign a concrete number" | Latest is `0378_vision_inference_calls.sql` | Plan assigns `0379_deterministic_validators_phase_1.sql` to the new migration (subject to last-mile renumber per `DEVELOPMENT_GUIDELINES.md` §6.2). |
| 6 | `benchExecuteJob.ts` "reuses the new dispatcher transparently" (§3 framing) | `benchExecuteJob.ts` duplicates the judge loop (its own `routeCall` + JSON parse + `computeVerdict`). It does NOT import or call `scorecardJudgeJob.ts`. | Plan's dispatcher chunk explicitly touches BOTH files. The dispatcher is extracted into a shared pure helper (`scorecardDispatcherPure.ts` plus an impure orchestrator) so both jobs invoke the same routing logic without copying it again. This is the only way the spec's "bench runs deterministic validators identically to live judging, no bypass flag" promise (§3) actually holds. |

These six points are referenced by chunk number below.

---

## 4. System Invariants block

Every chunk's executor must honour the following invariants regardless of any local pressure to bend them:

1. **Catalogue miss → `inconclusive`, never semantic fallback.** Silent fallback would hide rubric drift. Tested by Chunk 3.
2. **Verdict idempotency uses the full 4-tuple `(run_id, scorecard_id, quality_check_slug, trigger_source)`.** This is the existing unique index; the spec's 2-tuple is wrong (Finding 1).
3. **No filesystem, `process.env`, network, `db`, `drizzle`, or `pg` imports in `deterministic`-kind validator files.** Enforced by `scripts/check-validator-isolation.ts` (Chunk 2). Tenant lookups must flow through `entityResolverRegistry`.
4. **`validator_versions` is append-only with `ON CONFLICT (slug, version) DO NOTHING`.** Snapshot failure logs and continues; never aborts boot.
5. **`validator_invocations` is append-only**, system-tier, no tenant payload beyond `verdict_id` FK. Evidence MUST satisfy the §6.6 redaction contract.
6. **`evaluation_method` is the verdict-provenance enum** with six values (`deterministic`, `deterministic_external`, `hybrid_deterministic_fail`, `hybrid_semantic`, `semantic`, `inconclusive`). The validator-invocation table allows a seventh transient value `hybrid_precondition_pass` (precondition-pass audit row, never a verdict).
7. **`QualityCheck.kind` resolves to `Validator.kind` only via the dispatcher.** Rubric authors choose from three (`deterministic` / `semantic` / `hybrid`); the registered `Validator.kind` (`deterministic` / `deterministic_external` / `hybrid_precondition`) is an implementation detail.
8. **One kind per check.** `qualityCheckSlug` is unique within a scorecard's `quality_checks` array; conflicting kinds for the same slug are rejected at rubric-save time.
9. **Tests are Vitest, not `node:test`.** `npx vitest run server/lib/scorecardValidators/<slug>.test.ts` is the per-validator local-allowed verification. Test gates and full-repo verification are CI-only (per `CLAUDE.md`).
10. **Migrations are append-only.** No editing `0299_scorecard_judgements.sql` to "fix" the unique index name. The dispatcher uses the existing name.

---

## 5. Architecture Notes

### 5.1 Key patterns chosen

**1. Object-spread registry (not side-effect self-registration).**
Validator modules each `export const validator: Validator = { ... }` (or a typed record for multi-export files). `server/lib/scorecardValidators/registry.ts` imports them and composes the runtime lookup. This mirrors how `SKILL_HANDLERS` is composed in `server/services/skillExecutor/registry.ts`. Rejected alternative: side-effect `registerValidator()` calls, creates implicit top-level import edges, defeats tree-shaking, and makes the validator surface invisible to `knip` and the project-map graph builder. The spec's "self-registration" phrasing is a naming inheritance from earlier drafts; the implementation must use the codebase's actual idiom.

**2. Dispatcher extracted to pure helper + impure orchestrator.**
The new dispatcher (Chunk 3) lives in two files: `scorecardDispatcherPure.ts` (routing decision: given `QualityCheck`, registry lookup function, and resolved `Validator.kind`, return a `DispatchPlan`) and `scorecardDispatcher.ts` (impure: executes the plan, writes `validator_invocations`, composes the `scorecard_judgements` insert). Both `scorecardJudgeJob.ts` and `benchExecuteJob.ts` call into the same dispatcher (Finding 6). The pure helper is unit-tested without a DB; the impure side calls validators via the registry.

**3. Two-axis kind translation only in dispatcher.**
`QualityCheck.kind` (3 values) and `Validator.kind` (3 values) translate to `evaluation_method` (6 values + 1 audit-only) only inside the dispatcher. No other module in the codebase performs the translation. Anywhere else, a mismatch is a bug. Rationale: §4 of the spec calls out the three namespaces specifically because previous drafts conflated them.

**4. Generic parameter form (no per-validator React fragments).**
`ValidatorParameterField[]` drives a generic renderer in `client/src/components/verdicts/ValidatorParameterForm.tsx`. `uiHint` (`textarea`, `code-editor`, `json-schema`, `slug-picker`, `number-range`) picks the control. This keeps the Phase 1 catalogue's UI surface zero per-validator, adding the 11th validator in Phase 2 adds zero new React files.

**5. CI-written `.registry-meta.json` as gate.**
The lint-rule / unit-test pass writes per-validator `testsGreen` into `server/lib/scorecardValidators/.registry-meta.json`. The registry boot reads it and excludes failing validators. Skipped validators surface as `inconclusive` at runtime, never a silent fallback. The `skipEnforcement` + expiry gate prevents permanent broken-test bypasses.

**6. Evidence redaction as authoring discipline + runtime size cap.**
The §6.6 redaction contract is enforced by validator-author convention + per-validator markdown doc; no central redaction middleware. A runtime cap (8 KB hard stop, 4 KB authoring target with `_truncated: true` flag) prevents accidental tenant-data exfil through oversized payloads. Phase 2 may add automated lint coverage; Phase 1 trusts the authoring contract and the markdown docs.

### 5.2 Rejected alternatives

- **Generic `pg-boss` queue per validator invocation.** The dispatcher runs inline because the judge job already runs in a pg-boss worker and validator latency targets are sub-millisecond for `deterministic` and under 5 s for `deterministic_external`. Re-queuing per check would inflate end-to-end latency by orders of magnitude and undermine the cost-attribution claim.
- **`scorecardJudgements` enum column for `evaluation_method` instead of CHECK constraint.** Enum columns in Postgres require migration churn to add values; the validator-evolution surface (Phase 2 might add `external_deferred`, etc.) is wide enough that CHECK + TEXT is the right shape. Matches the codebase pattern in `agentRuns.status`, `actions.action_type`, etc.
- **Storing validator source text on disk as the only artefact.** `validator_versions` table is required for the audit replay path; on-disk source is mutable across deploys, the table snapshot is immutable.

### 5.3 Gotchas surfaced from the codebase

- The `scorecard_judgements` unique index is on a 4-tuple (Finding 1). Plan-time correction; any executor who uses the spec's 2-tuple will hit a real DDL mismatch.
- `benchExecuteJob.ts` is a parallel judge loop, not a caller of `scorecardJudgeJob.ts` (Finding 6). The dispatcher chunk must extract the shared path or the bench-side claim in the spec is unmet.
- `withOrgTx` in the existing `scorecardJudgeJob.ts` opens a Drizzle transaction and sets `app.organisation_id`. The dispatcher MUST stay inside that transaction, splitting the validator dispatch out would lose the GUC and silently bypass RLS on `scorecard_judgements`.
- `RLS_PROTECTED_TABLES` is for tenant-scoped tables. System-tier tables omit themselves automatically (Finding 3). The spec's instruction to add entries there is incorrect; the plan corrects this.

---

## 6. Chunk Decomposition

Six chunks, dependency-ordered. Each chunk maps to one spec phase (§11 Steps 1 to 6); per the caller contract, Steps 7 (pilot) and 8 (documentation) are operator tasks and are NOT chunks here.

```
Chunk 1 (Schema) -> Chunk 2 (Framework + lint + CLI) -> Chunk 3 (Dispatcher)
                                                            |
Chunk 4 (Catalogue) -----------------------------------> Chunk 5 (Audit + Observability)
                                                                  |
                                                              Chunk 6 (UI)
```

Strict ordering:
- Chunk 1 -> 5 (registry boot snapshot writes to `validator_versions`; wiring lands in Chunk 5, so the table dependency is enforced there, not in Chunk 2)
- Chunk 2 -> 3 (dispatcher needs the registry)
- Chunk 2 -> 4 (validators need types/registry/CLI)
- Chunks 3 + 4 -> 5 (audit writes need dispatcher and catalogue)
- Chunks 1 to 5 -> 6 (UI needs API route + types from 1+2, plus verdict/evidence fields populated by 3+5; the drill-in reads `evaluation_method`, `validator_slug`, `validator_version` from Chunk 3's writes and `validator_invocations` rows from Chunk 5)

**Chunk 2 has NO hard dependency on Chunk 1.** Chunk 2 defines `snapshotAllValidatorsToDb(getDb)` as an export but does not invoke it; the invocation lives in Chunk 5's boot wiring. Chunk 2 can therefore run independently of Chunk 1 if useful for parallel work, though the diagram above shows the canonical linear order.

### Chunk 1 — Schema migrations

`spec_sections: §5, §11 Step 1, §12 (rows 1-5), §15.1, §15.5`

**Scope.** One migration file adds three provenance columns to `scorecard_judgements`, creates `validator_versions` (system-tier), creates `validator_invocations` (system-tier, append-only), and adds `inconclusive_alert_threshold` to `scorecards`. Drizzle schema files mirror the columns. No behaviour change, runtime treats existing rows as `evaluation_method = 'semantic'` (NULL handled by query layer; default `'semantic'` covers new writes).

**Out of scope.** No dispatcher, no UI, no registry. The new columns are populated by Chunk 3.

**Files (5 total, within the at-most-5 cap):**

| File | Change | Contract |
|---|---|---|
| `migrations/0379_deterministic_validators_phase_1.sql` | new | ALTER `scorecard_judgements` add `evaluation_method TEXT NOT NULL DEFAULT 'semantic' CHECK (...)`, `validator_slug TEXT`, `validator_version TEXT`. ALTER `scorecards` add `inconclusive_alert_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.20`. CREATE `validator_versions` (UUID id, slug, version, source_text, source_hash, parameter_schema_json JSONB, created_at; UNIQUE (slug, version)). CREATE `validator_invocations` (UUID id, verdict_id FK to scorecard_judgements(id), validator_slug, validator_version, evaluation_method CHECK, latency_ms, external_call_count DEFAULT 0, result_passed, result_score NUMERIC(4,3), evidence_json JSONB, trace_id, created_at; indexes on (validator_slug, created_at) and (verdict_id)). Migration header `-- system-scoped: <reason>` for each new table per `DEVELOPMENT_GUIDELINES.md` §6.3. Includes matching `.down.sql`. |
| `server/db/schema/scorecardJudgements.ts` | modify | Add `evaluationMethod: text(...)`, `validatorSlug: text(...)`, `validatorVersion: text(...)` columns. Type-narrow `evaluationMethod` to the six-value union via `$type<>`. |
| `server/db/schema/scorecards.ts` | modify | Add `inconclusiveAlertThreshold: numeric(...)` column with default `'0.20'`. Update `QualityCheck` interface in place with the six new optional fields (`kind`, `validatorSlug`, `validatorParameters`, `preconditionSlugs`, `preconditionParameters`, `safetyClass`), see Finding 2. |
| `server/db/schema/validatorVersions.ts` | new | Drizzle definition for `validator_versions`. Exports `validatorVersions`, `ValidatorVersionRow`, `NewValidatorVersion`. |
| `server/db/schema/validatorInvocations.ts` | new | Drizzle definition for `validator_invocations`. Exports `validatorInvocations`, `ValidatorInvocationRow`, `NewValidatorInvocation`. |

**Public interface this chunk exposes:**
- New Drizzle table exports `validatorVersions` and `validatorInvocations`.
- Extended `QualityCheck` type with six optional fields.
- New columns on `scorecard_judgements` and `scorecards` queryable via existing Drizzle types.

**What stays hidden:** the migration text itself, the CHECK constraint syntax, the index DDL, the down-migration ordering. No service or route consumes these directly in this chunk.

**Error handling.** Migration is idempotent only at the `IF NOT EXISTS` level for the new tables; `ALTER TABLE ADD COLUMN` on already-altered tables is not idempotent and the down-migration must `DROP COLUMN IF EXISTS` to keep rollback safe. CHECK constraint violations at insert time bubble as Postgres `23514` and surface in Chunk 3's error mapping.

**Tests (per CLAUDE.md verification rule).**
- `npm run db:generate`, verify the generated migration matches the hand-authored file shape (Drizzle schema vs. migration diff).
- `npm run typecheck`, ensures new columns flow into both `ScorecardJudgement` and `Scorecard` types.

**Verification commands.** `npm run lint`, `npm run typecheck`, `npm run db:generate`. NO test-gate suites (CI-only per `CLAUDE.md`).

**Dependencies.** None (first chunk).

**Acceptance criteria.**
- The migration file applies cleanly on a fresh DB with no errors.
- `npm run typecheck` passes with `evaluationMethod`, `validatorSlug`, `validatorVersion`, `inconclusiveAlertThreshold` flowing through every Drizzle inferred type.
- The new tables omit `organisation_id`; CI gate `verify-rls-protected-tables.sh` does NOT flag them (because the gate only checks tables WITH `organisation_id`).

### Chunk 2 — Validator framework, isolation lint rule, CLI scaffolding

`spec_sections: §6.1, §6.2, §6.3, §6.4, §6.5, §6.6, §11 Step 2, §12 (rows 6-10, 20), §17`

**Scope.** Author the validator framework: `Validator` type, `ValidatorContext`/`Result`/`Evidence` types, `ValidatorParameterField` type, `RunMetadata` type. Build the registry (object-spread + `.registry-meta.json` reader). Add the entity-resolver registry. Author the isolation lint rule (`scripts/check-validator-isolation.ts`). Add the `npm run scorecard:new-validator` CLI scaffolding. Ship one canonical example validator (`output_non_empty`, the simplest of the Phase 1 set) wired end-to-end as the framework smoke-test. The remaining 8 validators ship in Chunk 4.

**Out of scope.** The other 8 validators (Chunk 4). The dispatcher (Chunk 3). Audit-table writes (Chunk 5). UI (Chunk 6).

**Files (10 total: 5 framework files + 3 example-validator co-located files + 1 CLI + 1 package.json edit; logical responsibility is single, "validator framework primitive", within the at-most-1 logical responsibility lane of the chunk cap):**

| File | Change | Contract |
|---|---|---|
| `server/lib/scorecardValidators/types.ts` | new | Exports `Validator`, `ValidatorContext`, `ValidatorResult`, `ValidatorEvidence`, `ValidatorParameterField`, `RunMetadata` per spec §6.1. Pure type module; no runtime code. |
| `server/lib/scorecardValidators/registry.ts` | new | Exports `getValidator(slug: string): Validator or undefined` and `getAllValidatorSummaries(): ValidatorSummary[]`. Internally composes the lookup map by object-spreading per-validator `export const validator: Validator = { ... }` records. Reads `.registry-meta.json`; excludes validators with `testsGreen: false` and no valid `skipEnforcement`. Enforces at startup that `preconditionSlugs` only references validators with `kind: 'deterministic'` or `'deterministic_external'`. Exposes `snapshotAllValidatorsToDb(getDb): Promise<void>` for Chunk 5 to wire at boot. |
| `server/lib/scorecardValidators/entityResolverRegistry.ts` | new | Exports `ENTITY_RESOLVERS: Record<string, (id: string, subaccountId: string) => Promise<boolean>>`. **At chunk entry, the executor verifies which entity-existence services already exist in the codebase** (grep `server/services/` for `existsById` or equivalent lookup methods) and registers ONLY the resolvers backed by a real service. The `customerService.existsById` example in the spec is illustrative; if no such service exists yet, the map ships empty and `cited_entity_exists` (Chunk 4) is tested against a mocked resolver only. New resolvers are one-line additions as real services land. This avoids premature domain coupling: the registry shape is fixed, the contents track actual service availability. |
| `server/lib/scorecardValidators/.registry-meta.json` | new | CI-written. Schema: `{ validators: Record<slug, { testsGreen: boolean; skipEnforcement?: boolean; skipEnforcementExpiry?: string; reason?: string }>; generatedAt: string; ciRunId: string }`. Hand-committed seed contains the single example validator with `testsGreen: true`. |
| `server/lib/scorecardValidators/output_non_empty.ts` | new | Canonical example: `kind: 'deterministic'`, version `'1.0.0'`, returns `passed: trimmed.length > 0`. Exports `export const validator: Validator = { ... }`. |
| `server/lib/scorecardValidators/output_non_empty.test.ts` | new | Vitest. Passing case: non-empty string. Failing case: whitespace-only. Edge case: empty string after trim. |
| `server/lib/scorecardValidators/output_non_empty.md` | new | Doc per §6.6: what it checks / does not check / known false positives / gaming defence / evidence redaction policy ("none, no failing-output excerpt stored"). |
| `scripts/check-validator-isolation.ts` | new | CI lint rule. Walks `server/lib/scorecardValidators/*.ts` (excluding test/doc files). For files whose exported validator has `kind: 'deterministic'`, parses imports and fails if any of: `fs`, `process.env`, `net`, `http`, `https`, `db`, `drizzle`, `pg`. Exits non-zero on violation. |
| `scripts/scaffold-validator.ts` | new | CLI for `npm run scorecard:new-validator <slug>`. Generates `<slug>.ts` / `<slug>.test.ts` / `<slug>.md` from in-tree templates; appends an import to `registry.ts` at a sentinel-marker line. |
| `package.json` | modify | Add `"scorecard:new-validator": "tsx scripts/scaffold-validator.ts"`. |

**Public interface this chunk exposes:**
- Type `Validator` + supporting types from `server/lib/scorecardValidators/types.ts`.
- `getValidator(slug)`, `getAllValidatorSummaries()`, `snapshotAllValidatorsToDb(...)` from `registry.ts`.
- `ENTITY_RESOLVERS` map.

**What stays hidden:** the `.registry-meta.json` reader, the composition map internals, the isolation-lint AST walker, the CLI's template strings. Callers must not import from individual validator files directly.

**Error handling.**
- Registry boot detects `preconditionSlugs` referencing a `hybrid_precondition` validator, throws at boot (composition cycle prevention).
- Registry boot detects an expired `skipEnforcement`, throws at boot with the slug and expiry date.
- Isolation lint produces a single ranked violation list; CI consumes the exit code.

**Tests (per CLAUDE.md verification rule).**
- `npx vitest run server/lib/scorecardValidators/output_non_empty.test.ts`, passing/failing/edge cases.
- `npx vitest run server/lib/scorecardValidators/registry.test.ts` (new test file authored in this chunk), verifies composition cycle prevention, expired-bypass detection, `testsGreen: false` exclusion.
- `npx vitest run scripts/__tests__/check-validator-isolation.test.ts` (new), verifies the lint rule rejects forbidden imports and accepts allowed imports against fixture inputs.

**Verification commands.** `npm run lint`, `npm run typecheck`, the three `npx vitest run` commands above. NO test-gate suites.

**Dependencies.** None hard. The registry's `snapshotAllValidatorsToDb` export needs `validator_versions` to exist at *invocation* time, but invocation lands in Chunk 5. Chunk 2 only declares the function and its signature; type-checking the export does not touch the DB. Chunks 1 and 2 can therefore be executed in either order or in parallel. Linear order (1 -> 2) is the canonical execution path in this plan, but a reordered run is not a contract violation.

**Acceptance criteria.**
- `import { getValidator } from 'server/lib/scorecardValidators/registry'` returns the `output_non_empty` validator at runtime.
- `npm run scorecard:new-validator probe` generates three files in `server/lib/scorecardValidators/` and one new import in `registry.ts`.
- `tsx scripts/check-validator-isolation.ts` exits 0 against the Phase 1 catalogue (only `output_non_empty` exists at this chunk's exit).
- `npx vitest run server/lib/scorecardValidators/` passes all tests authored in this chunk.

### Chunk 3 — Dispatcher

`spec_sections: §7, §11 Step 3, §12 row 21, §14, §15, §16`

**Scope.** Rewrite the quality-check evaluation loop in `scorecardJudgeJob.ts` to read `QualityCheck.kind` and route via the new dispatcher. The dispatcher is extracted into a pure helper + impure orchestrator pair so `benchExecuteJob.ts` shares the same logic (Finding 6). Catalogue miss / parameter mismatch / disabled validator -> `inconclusive`. Hybrid path runs preconditions in declared order, short-circuits on first fail, falls through to semantic judge on full pass. Safety-class fail effects emit a `safety_class_check_failed` event (§7.6, fire-and-forget; no subscriber required for Phase 1). Inconclusive-threshold alert fires after all checks complete (§7.3). External-validator semaphore (max 3), retry (1), timeout (5 s), rate limit (100/min/slug), in-memory circuit breaker (§7.4). `RunMetadata.invokedSkillSlugs` populated from `agent_runs` before any validator runs.

**Out of scope.** Writing to `validator_invocations` (Chunk 5). The 9-validator catalogue (Chunk 4; only the Chunk 2 example exists here, sufficient for dispatcher unit tests). UI (Chunk 6).

**Audit-table boundary (explicit).** Chunk 3 *constructs* validator-invocation DTOs (the `invocationsToWrite[]` payload on `DispatchOutcome`) but does NOT persist them. Persistence is owned by `validatorAuditService.writeInvocations(...)` in Chunk 5. The contract is: dispatcher output is a pure value describing what should be written, the audit service decides whether/how to write it (including the 8 KB hard-stop redaction). This split keeps the dispatcher transaction-aware without coupling it to the audit ledger's failure modes (audit-write failure must never fail a verdict).

**Files (4 total, within the at-most-5 cap):**

| File | Change | Contract |
|---|---|---|
| `server/services/scorecardDispatcherPure.ts` | new | Pure helper. Exports `planDispatch(qc: QualityCheck, getValidator: (slug: string) => Validator or undefined): DispatchPlan` where `DispatchPlan` is a tagged union: `{ kind: 'deterministic'; validator: Validator }`, `{ kind: 'deterministic_external'; validator: Validator }`, `{ kind: 'hybrid'; preconditions: Validator[]; preconditionParams: Array<Record<string, unknown>> }`, `{ kind: 'semantic' }`, `{ kind: 'inconclusive'; reason: 'catalogue_miss' or 'parameter_mismatch'; detail: string }`. Pure, fully unit-testable, no DB. |
| `server/services/scorecardDispatcher.ts` | new | Impure orchestrator. Exports `dispatchCheck(input: DispatchInput): Promise<DispatchOutcome>` where `DispatchOutcome` carries the verdict shape (`evaluation_method`, `validator_slug`, `validator_version`, `passed`, `score`, `reasoning`, `evidence`, `gateEvidence`, `invocationsToWrite[]`). Owns the semaphore (max 3 concurrent external calls per `judgementRunId`), the retry-once envelope, the 5 s timeout, the per-slug rate limit, and the in-memory circuit breaker. Emits `safety_class_check_failed` event (no-op log if no subscriber). Pure side-effects are LLM calls (when falling through to semantic) and validator invocations; no DB writes here. DB writes happen in the calling site to keep the dispatcher transaction-aware. |
| `server/jobs/scorecardJudgeJob.ts` | modify | Replace the inline LLM-only loop with a call to `dispatchCheck(...)` for each check. Pass through `judgementRunId` (renamed pulse for clarity in dispatcher; does not change DB column name; this is the loop-local identifier the dispatcher uses to scope the semaphore). Compose the `scorecard_judgements` insert from the `DispatchOutcome` (sets `evaluationMethod`, `validatorSlug`, `validatorVersion`). Populate `RunMetadata` before dispatching. After all checks complete, count `inconclusive` and emit the threshold alert if `count / total > scorecard.inconclusiveAlertThreshold`. `ON CONFLICT` clause targets the actual 4-tuple unique index `scorecard_judgements_run_scorecard_check_trigger_uniq` (Finding 1). |
| `server/jobs/benchExecuteJob.ts` | modify | Replace the duplicated LLM judge loop with a call to `dispatchCheck(...)` using a synthesised `QualityCheck` (`kind: 'semantic'`, current behaviour preserved) initially; bench-specific deterministic dispatch is enabled by reading the rubric the bench run references rather than synthesising. The current call site (lines roughly 141 to 191) becomes a single dispatcher call. Removes the local `buildJudgePrompt` import path duplication. |

**Public interface this chunk exposes:**
- `dispatchCheck(input)` from `server/services/scorecardDispatcher.ts`.
- `planDispatch(qc, getValidator)` from `server/services/scorecardDispatcherPure.ts`.

**What stays hidden:** the semaphore implementation, the retry envelope, the circuit-breaker state machine, the rate-limit window, the precondition short-circuit loop, the parameter-validation against `Validator.parameterSchema`, the `evaluation_method` derivation logic.

**Error handling.**
- Validator throws, caught, mapped to `evaluation_method = 'inconclusive'`, `reasoning: 'validator threw: <message>'`, evidence captures the truncated stack. NEVER re-throws into the job's outer transaction (would lose other checks' verdicts).
- External validator timeout, 1 retry; both fail, `inconclusive` with reason `'external_timeout'`.
- Circuit-breaker open, `inconclusive` with reason `'circuit_breaker_open'`. No retry while open.
- Rate limit exceeded, `inconclusive` with reason `'rate_limit_exceeded'`.
- Parameter schema mismatch, `inconclusive` with reason `'parameter_schema_mismatch'`, detail naming the missing required field.
- `safety_class_check_failed` event emit failure, swallowed and logged (fire-and-forget per spec §7.6 cross-brief integration note).

**Tenant context in `safety_class_check_failed` event.** Spec §7.6 pins the event payload as `{ scorecardId, checkSlug, runId, agentId }`. Tenant identifiers (`organisationId`, `subaccountId`) are NOT in the payload by design: any downstream consumer that needs to block promotion or freeze rollout has direct access to `agent_runs` via `runId`, where `organisationId` and `subaccountId` are NOT-NULL columns (`server/db/schema/agentRuns.ts`). Consumers MUST resolve tenant context from `runId` rather than trusting the event payload, this keeps the event shape stable across cross-brief integrations and prevents stale-tenant-id drift if `agent_runs` is later renormalised. The dispatcher emits the payload as specified; it does not pre-resolve tenant fields.

**Tests (per CLAUDE.md verification rule, authored in this chunk).**
- `npx vitest run server/services/scorecardDispatcherPure.test.ts`, comprehensive: all 5 `DispatchPlan` kinds, catalogue miss, parameter mismatch, hybrid precondition resolution, composition-cycle rejection.
- `npx vitest run server/services/scorecardDispatcher.test.ts`, semaphore concurrency cap, retry-once, timeout, circuit-breaker open/close, rate limit, safety-class event emission shape. Mocks the LLM call and the validator implementations.
- `npx vitest run server/jobs/scorecardJudgeJob.test.ts`, end-to-end with mocked dispatcher, asserting the `ON CONFLICT` clause targets the correct columns and the inconclusive-threshold alert fires above 0.20.

**Verification commands.** `npm run lint`, `npm run typecheck`, the three `npx vitest run` commands above. NO test-gate suites.

**Dependencies.** Chunks 1 + 2.

**Acceptance criteria.**
- A scorecard with `kind: 'semantic'` checks behaves identically to pre-build (regression-safe).
- A scorecard with `kind: 'deterministic'` referencing `output_non_empty` writes a verdict with `evaluation_method = 'deterministic'`, `validator_slug = 'output_non_empty'`, `validator_version = '1.0.0'`, `score = 1.0` for non-empty output.
- A scorecard referencing an unknown validator slug writes a verdict with `evaluation_method = 'inconclusive'`. **No semantic fallback.**
- Both `scorecardJudgeJob.ts` and `benchExecuteJob.ts` reach the LLM only via `dispatchCheck`'s semantic branch. Bench runs honour deterministic kinds when the underlying rubric uses them.
- A scorecard with a `safetyClass: true` failing check emits one `safety_class_check_failed` structured log event.

### Chunk 4 — Phase 1 catalogue (8 remaining validators)

`spec_sections: §8, §11 Step 4, §12 (rows 11-19)`

**Catalogue count reconciliation.** Spec §8 lists 10 rows. Of those, 9 carry a `Validator.kind` of `deterministic` or `deterministic_external` and are registered in the `getValidator(slug)` map. The 10th (`output_helpful`) is explicitly NOT a registered Validator (§8 closing note): it is a rubric JSONB *pattern* with `preconditionSlugs: ['output_non_empty', 'output_length_within_bounds']`. The registered catalogue is therefore 9 validators, not 10. Chunk 2 ships `output_non_empty` (1 of 9). Chunk 4 ships the remaining 8.

**Scope.** Author the remaining 8 validators per the catalogue table (§8). The 10th catalogue row (`output_helpful`) is a rubric JSONB pattern, NOT a `Validator` registry entry; it ships as a documentation example in Chunk 6's UI rendering, not as code here. Each validator ships three files: `<slug>.ts`, `<slug>.test.ts`, `<slug>.md`. Markdown docs follow the §6.6 redaction contract format.

**Out of scope.** Audit-table writes (Chunk 5). UI (Chunk 6). The `output_helpful` rubric template (illustrative only).

**Files (24 total, 8 validators times 3 files each).** Logical responsibility is single ("Phase 1 catalogue"). This chunk intentionally exceeds the at-most-5 file cap because the validators are independent and stamped from the Chunk 2 scaffold; the cap's other branch (at-most-1 logical responsibility) holds.

| Validator | Files | `Validator.kind` | Safety | One-line contract |
|---|---|---|---|---|
| `output_schema_valid` | `output_schema_valid.{ts,test.ts,md}` | `deterministic` | no | JSON Schema 2020-12 (ajv 2020-12 with `~`-pinned version) validates against `parameters.schema`; partial-match grading documented in `.md`. |
| `output_length_within_bounds` | `output_length_within_bounds.{ts,test.ts,md}` | `deterministic` | no | Character count (default) or token count (when `parameters.unit === 'tokens'`) between `min` and `max`. Tokeniser version pinned per §6.1. |
| `no_forbidden_phrase` | `no_forbidden_phrase.{ts,test.ts,md}` | `deterministic` | no | None of `parameters.phrases[]` (strings or regex objects) match output; graded `phrases_clean / phrases_total`. |
| `pii_pattern_absent` | `pii_pattern_absent.{ts,test.ts,md}` | `deterministic` | **yes** | None of the curated PII patterns (email, phone, credit-card-shape Luhn, TFN, SSN-shape) match. Evidence redacted per §6.6, pattern category + count only, never raw text. |
| `cited_entity_exists` | `cited_entity_exists.{ts,test.ts,md}` | `deterministic_external` | no | Every entity ID pattern-matched in output exists via `ENTITY_RESOLVERS[parameters.entityTypes[].lookupService]`. Batched per entity type. |
| `action_set_within_allowlist` | `action_set_within_allowlist.{ts,test.ts,md}` | `deterministic` | **yes** | `RunMetadata.invokedSkillSlugs` is a subset of `parameters.allowlist`. Pure, Chunk 3 populates `invokedSkillSlugs` before dispatch. |
| `numeric_within_tolerance` | `numeric_within_tolerance.{ts,test.ts,md}` | `deterministic` | no | Named field (`parameters.fieldName`) extracted from JSON output is `>= parameters.min and <= parameters.max`. |
| `date_in_format` | `date_in_format.{ts,test.ts,md}` | `deterministic` | no | Named field parses to ISO 8601 (RFC 3339 subset). |

Plus `.registry-meta.json` updated by CI with `testsGreen: true` for all 8 new entries.

**Public interface this chunk exposes:** 8 new `export const validator: Validator = { ... }` records, imported by `registry.ts`.

**What stays hidden:** parsing logic, regex tables, JSON Schema instance, batched lookup composition, PII regex catalogue, ISO-8601 parser library choice.

**Error handling.** Per-validator. Most return `{ passed: false, score: 0.0, reasoning, evidence }` on rule violation. Schema parse failures inside `output_schema_valid` return `passed: false` with `evidence.schemaErrors[]`. `cited_entity_exists` distinguishes "entity not found" (`passed: false`) from "resolver threw" (re-throws to let dispatcher map to `inconclusive`).

**Tests (per CLAUDE.md verification rule).**
- One `<slug>.test.ts` per validator, three test cases (passing / failing / edge per §6.5).
- `npx vitest run server/lib/scorecardValidators/` runs all Phase 1 tests locally during authoring.
- Edge cases must include the gaming-attempt scenarios documented in each `.md`:
  - `pii_pattern_absent`: obfuscated emails (`me [at] example.com`), accept the false-negative; doc it.
  - `output_schema_valid`: deeply-nested JSON with circular refs (must not crash).
  - `cited_entity_exists`: mocked resolver returns `false` once, `true` once, verifies batching.

**Verification commands.** `npm run lint`, `npm run typecheck`, `tsx scripts/check-validator-isolation.ts` (must pass on the full catalogue), `npx vitest run server/lib/scorecardValidators/`. NO test-gate suites.

**Dependencies.** Chunk 2 (framework). Chunk 3 (dispatcher must populate `RunMetadata.invokedSkillSlugs` before `action_set_within_allowlist` can be tested in-job; the unit test of the validator itself does not need the dispatcher).

**Acceptance criteria.**
- All 8 validators registered; `getAllValidatorSummaries()` returns 9 entries (8 new + `output_non_empty` from Chunk 2). `output_helpful` is excluded by design (rubric JSONB pattern, not a registered Validator).
- The isolation lint rule passes on every `deterministic`-kind file.
- `cited_entity_exists` is the only file in the catalogue that may import from a service module (via `entityResolverRegistry`); the lint rule must accept that path.
- Two safety-class validators (`pii_pattern_absent`, `action_set_within_allowlist`) carry a `safetyClass: true`-equivalent marker in their markdown docs. (The `safetyClass` flag lives on `QualityCheck`, not `Validator`; this chunk documents which validators are intended for safety-class rubric checks.)

### Chunk 5 — Audit ledger writes, observability, startup snapshot, cost attribution

`spec_sections: §5.2 (snapshot write), §5.3, §9.1-9.6, §11 Step 5, §12 row 21 (audit aspect)`

**Scope.** Wire the dispatcher's `invocationsToWrite[]` output into `INSERT INTO validator_invocations` rows. Add the OTel attributes (`synthetos.validator.slug`, `synthetos.validator.version`, `synthetos.validator.latency_ms`, `synthetos.validator.evaluation_method`) to the existing trace span. Wire `snapshotAllValidatorsToDb(...)` into the server boot sequence (best-effort, logs and continues on DB failure). Set `cost = 0` on deterministic verdicts in the `scorecard_judgements` insert. Enforce the 8 KB hard-stop evidence size limit at the audit-write side.

**Out of scope.** UI (Chunk 6). The pilot-driven cost dashboards (Step 7, operator task).

**Files (4 total, within the at-most-5 cap):**

| File | Change | Contract |
|---|---|---|
| `server/services/validatorAuditService.ts` | new | Service. Exports `writeInvocations(invocations: NewValidatorInvocation[], db): Promise<void>`. Enforces the 8 KB hard-stop on `evidence_json` size (logs and writes a redacted-placeholder row on exceed); honours `_truncated: true` flag. Adds OTel attributes for the active span. Called from `scorecardJudgeJob.ts` after each verdict insert. |
| `server/jobs/scorecardJudgeJob.ts` | modify | After each `scorecardJudgements` insert returns the new row id, call `validatorAuditService.writeInvocations(...)` for that check's invocations. **Cost attribution mechanism (resolved at plan time):** `scorecard_judgements` does NOT have a `cost` column today; cost attribution flows through `llm_requests` (the existing per-LLM-call ledger that `routeCall` writes, see `server/services/llmRouter.ts`). Deterministic and `deterministic_external` verdicts never reach `routeCall`, so they automatically write zero rows to `llm_requests`. Existing cost-rollup queries (e.g. bench dashboard) GROUP BY `run_id` and sum from `llm_requests`; a deterministic verdict contributes nothing. **No new column, no `cost = 0` literal write — the absence of an `llm_requests` row is the cost-attribution signal.** This chunk adds no `llm_requests`-table modification. |
| `server/index.ts` (or the server boot module, `server/index.ts` per `architecture.md` §Project Structure) | modify | After DB connection is established and before the HTTP server starts accepting connections, call `snapshotAllValidatorsToDb(adminDb)` inside a try/catch, log and continue on failure per spec §5.2. |
| `server/services/scorecardDispatcher.ts` | modify | Add OTel span attributes to the dispatcher's active span as it resolves each validator. Populates `trace_id` on each `NewValidatorInvocation` when an OTel context is available, null otherwise. |

**Public interface this chunk exposes:**
- `writeInvocations(invocations, db)` from `validatorAuditService`.
- Boot hook `snapshotAllValidatorsToDb` (already exported in Chunk 2; now wired).

**What stays hidden:** OTel attribute name strings, the 8 KB size check, the redacted-placeholder shape, the boot ordering.

**Error handling.**
- `writeInvocations` failure, log at `error`, swallow (never fail the verdict write). The verdict ledger is the source of truth; the audit ledger is best-effort secondary.
- `snapshotAllValidatorsToDb` failure, log at `warn`, continue boot per §5.2.
- 8 KB-exceeding evidence, write a redacted-placeholder row with `evidence_json: { _hardStop: true, originalSize: <bytes> }`, log at `warn`.
- OTel span unavailable, attributes silently dropped, `trace_id` remains null.

**Tests (per CLAUDE.md verification rule, authored in this chunk).**
- `npx vitest run server/services/validatorAuditService.test.ts`, 8 KB hard-stop produces redacted-placeholder row; happy-path writes preserve evidence shape.
- `npx vitest run server/services/scorecardDispatcher.test.ts` (extended), OTel attributes populated when a span is active.

**Verification commands.** `npm run lint`, `npm run typecheck`, the two `npx vitest run` commands above. NO test-gate suites.

**Dependencies.** Chunks 1 + 2 + 3 + 4. The full catalogue must exist so the boot snapshot writes nine rows (one per registered validator).

**Acceptance criteria.**
- After server boot, `SELECT count(*) FROM validator_versions` returns 9 (one per registered Phase 1 validator: `output_non_empty` from Chunk 2 plus the 8 from Chunk 4). `output_helpful` is excluded by design.
- A run that triggers `output_schema_valid` writes one row to `validator_invocations` with `latency_ms` populated, `result_passed`, and `evidence_json` at most 8 KB.
- A simulated 9 KB evidence payload writes the redacted-placeholder row, not the original.
- The deterministic-verdict path writes zero rows to `llm_requests` (verified by query after a deterministic run); the bench dashboard's existing cost rollup therefore reflects the reduction with no schema or query change.

### Chunk 6 — UI surfaces (rubric editor + VerdictDrillIn + validators API)

`spec_sections: §10.1, §10.2, §11 Step 6, §12 (rows 22-28)`

**Scope.** Build the staff-gated rubric quality-check editor surface across the four existing pages. Build the `VerdictDrillIn` component inside the Inbox's "Needs Review" lane (per the locked decision at the top of this plan). Build the generic `ValidatorParameterForm`. Add the `GET /api/validators` route returning the `ValidatorSummary[]` shape.

**Out of scope.** Surface 3 (catalogue browser, deferred). The closed-loop brief's `improvements-section` integration (separate build).

**Files (9 total, exceeds the at-most-5 cap but is bounded by the spec's §10 file inventory; logical responsibility is single, "Phase 1 UI surfaces"):**

| File | Change | Contract |
|---|---|---|
| `server/routes/validators.ts` | new | `GET /api/validators` route. Guarded by `authenticate` + `requirePermission('synthetos_staff')` (or the equivalent staff-permission check, confirm exact permission slug at chunk entry against `server/middleware/permissions.ts`). Returns `ValidatorSummary[]` from `getAllValidatorSummaries()`. Uses `asyncHandler`. |
| `server/index.ts` | modify | Mount `validatorsRouter` from `server/routes/validators.ts`. One-line addition alongside the existing route mount block. |
| `client/src/lib/api/validators.ts` | new | Client API for `GET /api/validators`. Exports `listValidators(): Promise<ValidatorSummary[]>` and the `ValidatorSummary` / `ValidatorParameterField` types. |
| `client/src/components/verdicts/ValidatorParameterForm.tsx` | new | Generic renderer. Props: `{ schema: ValidatorParameterField[]; value: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }`. Dispatches on `field.uiHint` to render: `textarea`, monaco-equivalent `code-editor`, JSON Schema editor (`json-schema`), `slug-picker` (combobox), `number-range`. Named export; consumed by Surface 1 + Surface 2 displays. |
| `client/src/components/verdicts/VerdictDrillIn.tsx` | new | Component per spec §10.2 prop interface. Renders six display variants by `evaluationMethod` (one per verdict-provenance enum value: `deterministic`, `deterministic_external`, `hybrid_deterministic_fail`, `hybrid_semantic`, `semantic`, `inconclusive`). Named export. Consumed by the Inbox "Needs Review" lane (lane wiring is also part of this chunk's edit to the Inbox page). |
| `client/src/pages/govern/ScorecardCreatePage.tsx` | modify | Add the admin-gated "Validator configuration" section per §10.1. Hidden when `!user.permissions.includes('synthetos_staff')`. Three controls: kind selector, validator-slug dropdown (when `kind === 'deterministic'`), precondition list (when `kind === 'hybrid'`). Uses `ValidatorParameterForm`. |
| `client/src/pages/agents/AgentEditScorecardTab.tsx` | modify | Same admin-gated section as above. |
| `client/src/pages/agents/AgentCreateScorecardSection.tsx` | modify | Same admin-gated section as above. |
| `client/src/pages/govern/ScorecardLibraryTab.tsx` | modify | Same admin-gated section as above (or, confirm at chunk entry, read-only display of the new fields if the library tab is presentation-only). |

Plus the Inbox "Needs Review" lane page (a file in `client/src/pages/` to be located at chunk entry by grepping for the Inbox component) wires `VerdictDrillIn` into existing verdict rows. This is the locked location decision; no new tab is created.

**Public interface this chunk exposes:**
- `GET /api/validators` HTTP endpoint.
- `<VerdictDrillIn />`, `<ValidatorParameterForm />` React components (named exports per the §Frontend Design Principles "prefer named exports" rule in `CLAUDE.md`).

**What stays hidden:** the four-page section component (extracted into a shared `client/src/components/verdicts/QualityCheckValidatorSection.tsx` if duplication crosses the three-similar-lines threshold; otherwise inlined per-page, confirm at chunk entry).

**Error handling.**
- `GET /api/validators` returns 403 to non-staff users via the existing permission middleware (no special handling).
- The client API call returns an empty `ValidatorSummary[]` on 403; the Surface 1 section degrades to "kind: semantic" only and renders no validator-slug dropdown.
- `VerdictDrillIn` receives malformed evidence, renders the warning callout pattern with a generic "evidence unavailable" message; does not crash the Inbox.
- Form-level: required-parameter validation happens client-side before save; the rubric API rejects on server side too.

**Tests (per CLAUDE.md verification rule, authored in this chunk).**
- `npx vitest run server/routes/__tests__/validators.test.ts` (new). **Scope: targeted route unit test, NOT an API contract test.** It covers two narrow surfaces: (a) the permission middleware rejects non-staff with 403, (b) the response body shape matches `ValidatorSummary` when authorised. It does not exercise the full request/response contract, does not hit a real DB, and does not validate every field permutation — that breadth would be an API contract test and is out of scope per spec §17. This local file is the smallest test that proves the route is wired and permission-guarded.
- Per `docs/spec-context.md` quoted in spec §17, no frontend unit tests in Phase 1. The pilot (Step 7, operator-driven) is the validation surface for the UI.

**Verification commands.** `npm run lint`, `npm run typecheck`, `npm run build:client`, `npx vitest run server/routes/__tests__/validators.test.ts`. NO test-gate suites.

**Dependencies.** Chunks 1 to 5. The route reads from the registry (Chunk 2); the drill-in reads `evaluation_method` / `validator_slug` / `validator_version` / evidence from `scorecard_judgements` + `validator_invocations` (Chunks 1 + 3 + 5).

**Acceptance criteria.**
- A Synthetos staff user editing a scorecard sees the "Validator configuration" section under every quality check; a non-staff user sees the unchanged operator view.
- A scorecard saved with `kind: 'deterministic'` and `validatorSlug: 'output_non_empty'` persists those fields through the JSONB column and round-trips on edit.
- An Inbox "Needs Review" row for a verdict with `evaluation_method = 'deterministic'` displays the `VerdictDrillIn` component showing validator slug, version, and key-value evidence table.
- An Inbox row for a verdict with `evaluation_method = 'inconclusive'` displays the warning callout: "This rubric references a validator that no longer exists or whose tests are failing. Edit the rubric to fix or remove this check."

---

## 7. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Spec drift on `scorecard_judgements` unique index** silently produces duplicate verdicts on retry. | High if undetected | High, corrupts the verdict ledger. | Plan Finding 1 + Chunk 3 acceptance criterion explicitly pins the actual index name. Test for `ON CONFLICT` clause shape in Chunk 3 catches a wrong-tuple regression. |
| 2 | **`benchExecuteJob.ts` keeps its old duplicated loop.** Bench runs do not see deterministic verdicts; the spec's "no bypass flag" claim is violated. | Medium without the fix | Medium, silent observability gap. | Chunk 3 modifies BOTH job files in the same chunk. Acceptance criterion: "both jobs reach the LLM only via `dispatchCheck`'s semantic branch." |
| 3 | **Boot snapshot writes are skipped** (DB unavailable during boot per §5.2). Audit trail incomplete for the deployment. | Low per deployment, cumulative over time | Low, audit only. | Chunk 5 logs `warn` and continues per spec. Future Phase 2 work may add a backfill job; in Phase 1 the next successful boot re-snapshots all validators. |
| 4 | **In-memory circuit breaker resets on worker restart**, allowing a downed external dependency to re-trip its breaker on every redeployment. | Medium during incident | Medium, extra retries during a 5-minute window. | Accepted Phase 1 tradeoff per spec §7.4. Phase 2 may persist state to Redis or a DB table. |
| 5 | **Evidence redaction relies on authoring discipline**, not a central middleware. A new validator could accidentally store raw output excerpts. | Medium over time | High, tenant-data leak via system-tier audit table. | §6.6 contract + per-validator markdown doc + 8 KB hard stop + Phase 2 deferred audit (per §18). Chunks 2 + 4 require the redaction-policy line in every `.md` doc. |
| 6 | **`output_helpful` ambiguity.** Rubric authors may try to select it from the validator dropdown. | High initially | Low, user confusion. | Chunk 6 acceptance criterion: validator dropdown excludes the `output_helpful` slug. The validator registry never registers it. Tooltip on the hybrid kind selector references the rubric-JSONB pattern. |
| 7 | **CI write of `.registry-meta.json` races with developer commits.** Stale `testsGreen` values cause inconclusive verdicts in production. | Low | Medium, surprises after a flaky test fix. | Chunk 2 acceptance criterion: registry boot detects stale `skipEnforcementExpiry` and throws. CI must overwrite the file on every test run; developer-committed stale values are the only attack surface and they expire fast. |
| 8 | **`safety_class_check_failed` event has no subscriber.** Effects 2 (closed-loop block) and 3 (rollout freeze) are no-ops. | Certain if neither consuming build lands first | Low, degrades silently to "alert only" per spec §7.6 | Spec §7.6 explicitly accepts this: emission is fire-and-forget log if no subscriber. The Synthetos channel alert (effect 4) still fires. |
| 9 | **The dispatcher's pure helper drifts from the impure orchestrator's behaviour.** Tests pass on the pure side; the runtime side regresses silently. | Medium | Medium | Chunk 3 acceptance criteria require both `scorecardDispatcherPure.test.ts` and `scorecardDispatcher.test.ts` to exist and exercise the same scenarios. The impure side delegates routing to the pure helper; only side-effect orchestration lives impure. |
| 10 | **The Inbox "Needs Review" lane integration is wrong.** Component renders but is invisible because the lane filter excludes the new `evaluation_method` values. | Medium during Chunk 6 | Medium | Chunk 6 must locate the Inbox lane filter at chunk entry (grep for the Inbox component) and extend the filter to surface `inconclusive` and `hybrid_deterministic_fail` verdicts. Acceptance criteria pin the visible-row test. |

---

## 8. Acceptance Criteria (programme-level, mapping spec §1 goals to chunk outputs)

The build ships when ALL of the following hold:

| Spec §1 Goal | Acceptance | Verifying chunk |
|---|---|---|
| 1, Three classifications coexist | `QualityCheck.kind` accepts `deterministic` / `semantic` / `hybrid`; the rubric editor renders all three; the dispatcher routes each correctly. | Chunks 1, 3, 6 |
| 2, 10-row catalogue (9 registered validators + 1 rubric pattern) | `getAllValidatorSummaries()` returns 9 entries (8 from Chunk 4 + `output_non_empty` from Chunk 2). `output_helpful` is the 10th catalogue row (§8), a rubric JSONB pattern not registered as a `Validator`. Each of the 9 registered validators ships .ts + .test.ts + .md. | Chunks 2, 4 |
| 3, Catalogue miss to inconclusive, no silent fallback | Chunk 3 acceptance criterion 3 (unknown slug to `inconclusive`, NOT `semantic`). | Chunk 3 |
| 4, Verdict ledger uniform | `scorecard_judgements.evaluation_method` non-null after every dispatch; `validator_slug` + `validator_version` populated for non-semantic paths. | Chunks 1, 3 |
| 5, Every dispatcher invocation audited | One `validator_invocations` row per validator call (deterministic, external, or precondition); zero rows for pure semantic. | Chunks 1, 5 |
| 6, Validator source snapshots | `validator_versions` has 9 rows after first successful boot (one per registered validator; `output_helpful` is a rubric pattern, not a registered Validator). Rows are immutable via UNIQUE(slug, version). | Chunks 1, 5 |
| 7, Cost attribution | Deterministic verdicts record zero LLM cost; bench cost dashboard reflects the drop after the pilot rubrics convert. | Chunks 3, 5 |
| 8, Admin-gated rubric editor | Surface 1 visible only with `synthetos_staff`; operators see the unchanged UI. | Chunk 6 |
| 9, `VerdictDrillIn` in Inbox | Component renders all six `evaluation_method` variants (`deterministic`, `deterministic_external`, `hybrid_deterministic_fail`, `hybrid_semantic`, `semantic`, `inconclusive`) inside the "Needs Review" lane (locked decision). | Chunk 6 |
| 10, Pilot prep | Out of scope for this build; Step 7 (operator task) consumes the shipped surfaces. | n/a, not a chunk |

**Spec §17 testing-posture cross-check.** The plan respects the spec's posture: static lint rule (isolation) + pure-function tests per validator + pure-function tests for the dispatcher + the Vitest-run-only-targeted-tests local rule from `CLAUDE.md`. No E2E tests, no frontend unit tests are in any chunk. Chunk 6 ships one *targeted route unit test* for `GET /api/validators` (permission + response shape only), which is narrower than an API contract test; see Chunk 6's Tests section for the explicit scope boundary. CI is the sole owner of the full gate suite.

---

## 9. Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Per-chunk verification is limited to `npm run lint`, `npm run typecheck`, `npm run build:server` / `npm run build:client` when the chunk touches those surfaces, and `npx vitest run <path-to-test>` for tests authored in the chunk.

**Migration renumber.** `0379_deterministic_validators_phase_1.sql` is the placeholder. At merge time, the executor MUST rebase onto `main` and rename the migration file to the next available number (per `DEVELOPMENT_GUIDELINES.md` §6.2). Update `RLS_PROTECTED_TABLES`-adjacent references in the same commit if any other migration lands between plan-time and merge-time.

**Branch.** Work continues on `claude/deterministic-validators-3Xjcb` (per the open spec-coordinator PLANNING lock at HEAD).

**Doc-sync at finalisation.** Adding two new tables, three new columns, a new validator framework, a new route, and two new components will trigger updates to `architecture.md` (Three-Tier Agent Model and Scorecards sections), `docs/capabilities.md` (new capability registration), and `KNOWLEDGE.md` (the dispatcher Pure+Impure pair pattern is worth pinning). The finalisation coordinator handles this; the executor's job is to ensure the diff visibility is high.

**Spec Goal 2 wording reconciliation.** Spec §1 Goal 2 phrases the deliverable as "10 named validators". The plan reconciles this to "10-row catalogue = 9 registered validators + 1 rubric JSONB pattern (`output_helpful`)" per spec §8's closing note. The catalogue count throughout this plan (Chunks 2 + 4, programme Goal 2 acceptance, Chunk 5 boot-snapshot acceptance) uses the resolved count of 9 registered validators. The executor MUST NOT register `output_helpful` as a `Validator` in `registry.ts`; it is exclusively a rubric template surfaced as a documentation example in Chunk 6. If the executor encounters the spec's "10 named validators" phrasing during implementation, treat this plan's reconciliation as authoritative; raise the spec wording as a doc-sync candidate at finalisation, not a build-time blocker.

