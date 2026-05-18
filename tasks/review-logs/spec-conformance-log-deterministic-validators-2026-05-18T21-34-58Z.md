# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-18-deterministic-validators-spec.md`
**Spec commit at check:** branch HEAD (no separate spec SHA)
**Branch:** `claude/deterministic-validators-3Xjcb`
**Base:** `28021e929fc6ce0d654fe3a235fc55911143ccb2`
**HEAD:** `59e8f502e670c358a2d5470c1d5059c7daf5dccf`
**Scope:** all of spec — Phase 2 chunks 1–6 all marked complete
**Changed-code set (deterministic-validators only):** ~50 files
**Run at:** 2026-05-18T21:34:58Z
**Commit at finish:** `39219993`

---

## Summary

- Requirements extracted:     54
- PASS:                       27
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 25
- AMBIGUOUS → deferred:       2
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT

---

## Table of Contents

1. Schema requirements (§5)
2. Validator framework requirements (§6)
3. Dispatcher requirements (§7)
4. Catalogue requirements (§8)
5. Audit / observability / cost requirements (§9)
6. UI surface requirements (§10)
7. Permissions / RLS requirements (§13)
8. Mechanical fixes applied
9. Directional / ambiguous gap routing
10. Files modified by this run
11. Next step

---

## 1. Schema requirements (§5)

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| 1 | §5.1 | Migration adds `evaluation_method TEXT NOT NULL DEFAULT 'semantic' CHECK (…6 values)` to `scorecard_judgements` | PASS |
| 2 | §5.1 | Adds `validator_slug TEXT`, `validator_version TEXT` to `scorecard_judgements` | PASS |
| 3 | §5.2 | Creates `validator_versions` with `parameter_schema_json JSONB NOT NULL` | DIRECTIONAL_GAP — column is **nullable** in migration 0379 (line 45) and Drizzle schema (`validatorVersions.ts:17`). Spec says NOT NULL |
| 4 | §5.2 | Add `validator_versions` to `rlsProtectedTables.ts` as opt-out | DIRECTIONAL_GAP — table is **not** registered. Plan Finding 3 redirected this (system-tier tables auto-exempt); spec §5.2 still asks for an entry. Plan-vs-spec contradiction |
| 5 | §5.3 | Creates `validator_invocations` with CHECK (six provenance values + `hybrid_precondition_pass`) | PASS |
| 6 | §5.3 | `result_score NUMERIC(4,3) NOT NULL` | DIRECTIONAL_GAP — column is **nullable** in migration 0379 (line 75) and Drizzle schema (`validatorInvocations.ts:25`). Dispatcher writes `null` for inconclusive cases; making it NOT NULL would require behaviour changes |
| 7 | §5.3 | Indexes on `(validator_slug, created_at)` and `(verdict_id)` | PASS |
| 8 | §5.3 | Add `validator_invocations` to `rlsProtectedTables.ts` as opt-out | DIRECTIONAL_GAP — same root cause as REQ #4 |
| 9 | §5.4 | `inconclusive_alert_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.20` on `scorecards` | PASS |
| 10 | §5.4 | `QualityCheck` TS interface adds 6 optional fields with `preconditionParameters: Record<string, Record<string, unknown>>` | DIRECTIONAL_GAP — implemented as `Array<Record<string, unknown>>` (parallel array indexed by slug position). Plan adopted this silently; spec wording disagrees. Affects `scorecards.ts:49`, `client/src/lib/api/scorecards.ts:29`, the dispatcher hybrid loop, and the editor UI |

## 2. Validator framework requirements (§6)

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| 11 | §6.1 | Types file exports `Validator`, `ValidatorContext`, `ValidatorResult`, `ValidatorEvidence`, `ValidatorParameterField`, `RunMetadata` | PASS |
| 12 | §6.1 | Evidence size ≤ 4 KB authoring target; ≥ 8 KB hard stop | PASS (8 KB enforced in `validatorAuditService.ts`; 4 KB is honour-system via per-validator truncation) |
| 13 | §6.1 | Static lint rule (`scripts/check-validator-isolation.ts`) rejects forbidden imports in deterministic-kind files | PASS |
| 14 | §6.2 | Registry enforces **at startup** that `preconditionSlugs` references only deterministic / deterministic_external validators | DIRECTIONAL_GAP — `registry.ts:102-130` is dead code containing only a comment "validation happens in the dispatcher". Enforcement lives in dispatcher (`scorecardDispatcherPure.ts:109`), not at boot. Spec says "at startup" |
| 15 | §6.2 | Reads `.registry-meta.json`; excludes validators with `testsGreen: false` | PASS |
| 16 | §6.2 | Returns `undefined` for unknown slugs | PASS |
| 17 | §6.3 | CLI `npm run scorecard:new-validator <slug>` generates 3 files + appends to registry | PASS |
| 18 | §6.4 | `entityResolverRegistry.ts` typed map; service-layer wrapping enforced by isolation lint | PASS (empty in Phase 1 per plan; spec §6.4 closing sentence permits) |
| 19 | §6.5 | Each validator ships passing / failing / edge tests run via Vitest | PASS — `__tests__/` directory has 9 validator tests + `registry.test.ts` |
| 20 | §6.6 | Each validator's `.md` covers what / what-not / false positives / gaming defence / **evidence redaction policy** | PASS for 8 validators. `output_non_empty.md:31-35` documents a deliberate gap ("evidence stores raw runOutput when failing") — this is itself a §6.6 violation but is acknowledged in writing |
| 21 | §6.6 | PII-detecting validators: store pattern category + count only, never matched text | PASS — `pii_pattern_absent.ts` evidence is just `detections: [{category, count}]` |
| 22 | §6.6 | All other validators: never raw output excerpts longer than 100 chars; truncate if included | DIRECTIONAL_GAP — `output_non_empty.ts:18` writes `evidence: { actual: ctx.runOutput }` with no truncation. Failing outputs could be tenant content of any length. Fix is one line but it changes the validator's testable surface (tests assert this shape) |

## 3. Dispatcher requirements (§7)

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| 23 | §7.1 | Dispatcher reads `QualityCheck.kind` and routes from `scorecardJudgeJob.ts` | PASS (extracted to dispatcher pair per plan Finding 6) |
| 24 | §7.2 | Catalogue miss → `inconclusive`, **no fallback to semantic** | PASS |
| 25 | §7.2 | `deterministic_external`: 5s timeout, one retry; both fail → `inconclusive` | PASS |
| 26 | §7.2 | Hybrid: preconditions in declared order, short-circuit on first failure; gate fail writes `hybrid_deterministic_fail`; gate pass falls through to semantic | PASS |
| 27 | §7.2 | Precondition pass events written to `validator_invocations` with `evaluation_method = 'hybrid_precondition_pass'`, not as separate `scorecard_judgements` rows | AMBIGUOUS — `scorecardDispatcher.ts:534` always writes `hybrid_precondition_pass`, **even when `precResult.passed === false`**. Spec wording covers the pass case explicitly but is silent on the fail case. A failing precondition's audit row currently has `evaluationMethod: 'hybrid_precondition_pass'` paired with `resultPassed: false` — internally inconsistent |
| 28 | §7.2 | Parameter schema mismatch reasoning text matches spec wording `'parameter schema mismatch: validator <slug> at version <v> requires field <field> which is absent'` | DIRECTIONAL_GAP — `scorecardDispatcherPure.ts:30` reasoning is `'missing required parameter "<field>" for validator "<slug>"'` (different wording, no version). Spec pins exact wording for morning-review-queue grouping |
| 29 | §7.2 | Idempotency: `ON CONFLICT (judgement_run_id, check_slug) DO NOTHING`, index `scorecard_judgements_judgement_run_id_check_slug_key` | DIRECTIONAL_GAP — spec is wrong here; plan Finding 1 documents the real 4-tuple index `scorecard_judgements_run_scorecard_check_trigger_uniq`. Code uses 4-tuple (correct vs reality). Spec divergence acknowledged in plan but never reconciled in spec |
| 30 | §7.3 | Inconclusive threshold alert fires when ratio exceeds `inconclusive_alert_threshold` | PASS |
| 31 | §7.3 | Inconclusive verdicts excluded from pass / fail / aggregate scorecard percentage | DIRECTIONAL_GAP — no code in this branch modifies the aggregate-rollup query. Aggregate scoring lives in `scorecardService` (out of changed-code set). Pre-build rollup behaviour with `verdict='inconclusive'` rows is unverified |
| 32 | §7.4 | Reliability primitives: 5s timeout, 1 retry, semaphore 3 concurrent / judgement run, rate limit 100/min/slug, circuit breaker on >20% error rate over 5-min window, 2 consecutive successes to close | PASS |
| 33 | §7.4 | p95 latency > 1s → monitoring alert via Synthetos channel | DIRECTIONAL_GAP — no p95 calculation or alert emission in dispatcher or audit service. Requires a rolling-24h aggregate against `validator_invocations.latency_ms` + Synthetos-channel alert. Not in any chunk |
| 34 | §7.5 | Dispatcher populates `RunMetadata.invokedSkillSlugs: string[]` before any validator runs | PASS — `scorecardJudgeJob.ts:99` reads `resolvedSkillSlugs` off the run row. Note: silent-empty fallback if that column is unset upstream |
| 35 | §7.6 effect 1 | Safety-class fail sets aggregate verdict to `failed` **immediately** (regardless of remaining checks) | DIRECTIONAL_GAP — `scorecardJudgeJob.ts:119-127` emits a log line but does NOT short-circuit the aggregate. The aggregate computation lives in scorecard rollup queries (untouched by this build) |
| 36 | §7.6 effect 2 | Safety-class fail blocks closed-loop promotion | DIRECTIONAL_GAP — emission is `logger.info('safety_class_check_failed', ...)`. Spec §7.6 cross-brief integration says "the dispatcher publishes a `safety_class_check_failed` event". A structured log is not a subscribable event bus / queue. Subscriber surface needs a real channel (pg-boss queue name? event bus topic?) for spec contract to hold |
| 37 | §7.6 effect 3 | Safety-class fail freezes staged rollout | DIRECTIONAL_GAP — same emission channel as Effect 2; same concern |
| 38 | §7.6 effect 4 | Safety-class fail alerts Synthetos monitoring channel | DIRECTIONAL_GAP — `logger.info` is not the Synthetos incident channel. Spec §9.6 says "all operational alerts route through the existing Synthetos incident infrastructure" (i.e. `recordIncident` / `system_incidents`). Current implementation only logs |
| 39 | §7.6 cross-brief | Event payload shape **exactly** `{ scorecardId, checkSlug, runId, agentId }` | DIRECTIONAL_GAP — `scorecardJudgeJob.ts:120-126` emits 5 fields (adds `subaccountId`). Spec rationale says consumers must resolve tenant via runId; adding tenant data widens the surface contrary to the stated invariant |

## 4. Catalogue requirements (§8)

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| 40 | §8 | 10-row catalogue: 9 registered validators + 1 rubric pattern (`output_helpful`) | PASS — 9 registered: `output_non_empty`, `output_schema_valid`, `output_length_within_bounds`, `no_forbidden_phrase`, `pii_pattern_absent`, `cited_entity_exists`, `action_set_within_allowlist`, `numeric_within_tolerance`, `date_in_format`. Each with .ts + .test.ts + .md |
| 41 | §8 | `pii_pattern_absent` and `action_set_within_allowlist` are safety class | AMBIGUOUS — both validators' markdown docs say "safetyClass: true". But no code mechanism distinguishes safety-class validators. `getAllValidatorSummaries()` (`registry.ts:151`) hard-codes `safetyClass: false` for every entry. The `safetyClass` flag lives on `QualityCheck` (rubric-side), so rubric authors must mark each check manually. Catalogue intent is the registry surfaces this — UI cannot warn / pre-tick |
| 42 | §8 | `output_helpful` is a rubric JSONB pattern, NOT a registered Validator | PASS — no `output_helpful.ts`; not imported by `registry.ts` |

## 5. Audit / observability / cost requirements (§9)

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| 43 | §9.1 | `validator_versions` rows immutable; snapshot writes at server startup with `ON CONFLICT (slug,version) DO NOTHING` | PASS |
| 44 | §9.2 | Every deterministic / deterministic_external / hybrid_precondition invocation writes one row to `validator_invocations` | PASS |
| 45 | §9.4 | Deterministic verdicts record `cost = 0` in `scorecard_judgements` | DIRECTIONAL_GAP — plan Chunk 5 reconciles to "absence of row in `llm_requests` is the cost signal"; spec §9.4 literally says `cost = 0` is recorded in `scorecard_judgements`. There is no `cost` column on `scorecard_judgements`. Plan-vs-spec contradiction; spec wording should be updated |
| 46 | §9.5 | OTel attributes `synthetos.validator.{slug,version,latency_ms,evaluation_method}` set on validator span | PASS (`addValidatorSpanAttributes` writes them via Langfuse `trace.update`) |

## 6. UI surface requirements (§10)

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| 47 | §10.1 | `GET /api/validators` returns `ValidatorSummary[]` with `name` from validator markdown h1, `kind`, `safetyClass`, `deprecated`, `parameterSchema` | DIRECTIONAL_GAP — `registry.ts:147-154` returns placeholder values: `name: v.slug.replace(/_/g, ' ')` (NOT from markdown h1), `safetyClass: false` (no source of truth tracks per-validator safetyClass), `deprecated: false` (no source of truth). Three of five fields are stubs |
| 48 | §10.1 | Validator API guarded by `requirePermission('synthetos_staff')` | PASS (uses `requireSystemAdmin` — same effective gate) |
| 49 | §10.1 | Admin-gated "Validator configuration" section in **all 4 pages**: ScorecardCreatePage, AgentEditScorecardTab, AgentCreateScorecardSection, ScorecardLibraryTab | DIRECTIONAL_GAP — only `ScorecardCreatePage.tsx` has the full editor (`QualityCheckValidatorSection`). The other three pages only add a **read-only badge** showing kind. No "Edit Scorecard" page exists, so once created, validator config is frozen. Plan Chunk 6 entry-time note allowed read-only display "if the library tab is presentation-only" — that escape applies to ScorecardLibraryTab, but `AgentEditScorecardTab` is an explicit edit surface and should host the editor |
| 50 | §10.1 | Save round-trip: new QualityCheck fields persist through POST/PATCH `/api/scorecards` | DIRECTIONAL_GAP — **critical**: `server/schemas/scorecards.ts` zod schema (`createScorecardBody`, `updateScorecardBody`) does NOT include any new fields. `validateBody(createScorecardBody, 'enforce')` strips them. UI sends them; server discards them. Scorecards created via UI never persist with `kind: 'deterministic'`. End-to-end pipeline broken even though every chunk passes its own tests. Fix requires editing a file in `main` (not in changed-code set) — single most important fix |
| 51 | §10.2 | `VerdictDrillIn` component at `client/src/components/verdicts/VerdictDrillIn.tsx` with the pinned prop interface | PASS |
| 52 | §10.2 | Renders six `evaluationMethod` variants with the specified display rules | PASS |
| 53 | §10.2 | API route returning verdict drill-in data extended to include `evaluation_method`, `validator_slug`, `validator_version`, `evidence_json`, `gateEvidence` | DIRECTIONAL_GAP — no diff in this branch touches the scorecard-judgement fetch route. `InboxItemCard.tsx:316-321` reads these fields off `item.meta` (opaque blob) — but no server route populates `item.meta` with them. Spec §10.2 explicitly defers the route confirmation to "Phase 2 entry"; the wiring is missing |
| 54 | §10.2 | `ValidatorParameterForm` component at `client/src/components/verdicts/ValidatorParameterForm.tsx` | PASS |

## 7. Permissions / RLS requirements (§13)

Covered above:

- §13 `validator_versions` registry entry → REQ #4 (DIRECTIONAL_GAP)
- §13 `validator_invocations` registry entry → REQ #8 (DIRECTIONAL_GAP)
- §13 `GET /api/validators` guarded by Synthetos-staff permission → REQ #48 (PASS)
- §13 Admin UI section conditional on `synthetos_staff` → REQ #49 (DIRECTIONAL_GAP)
- §13 `scorecard_judgements` / `scorecards` new columns inherit existing RLS unchanged → PASS (no changes to those tables' RLS posture in migration 0379)

## 8. Mechanical fixes applied

None.

Every gap surfaced as DIRECTIONAL_GAP because at least one of the following applied:

1. A design choice the spec did not pin (where does per-validator `safetyClass` metadata live? a sidecar `Set<string>`? a field on `Validator`?).
2. A contract change touching files outside the changed-code set (`server/schemas/scorecards.ts` is untouched on this branch but is the load-bearing fix for REQ #50).
3. A redaction-policy change that would alter validator behaviour and break already-authored unit tests.
4. A plan-vs-spec contradiction documented in `tasks/builds/deterministic-validators/plan.md` but never reconciled back into the spec text.
5. A cross-system event-bus / alerting decision (which channel does `safety_class_check_failed` use? `recordIncident`? a pg-boss queue? a structured log only?).

Mechanical fixes are reserved for cases where the spec names the artefact concretely AND the implementation surface is unambiguous. No finding in this run met that bar.

## 9. Directional / ambiguous gap routing

All 27 deferred items appended to `tasks/todo.md` under section *Deferred from spec-conformance review — deterministic-validators (2026-05-18)*.

Grouped by severity for operator triage:

**Blocking (verdict pipeline broken or contract violated):**
- REQ #50 — Scorecards Zod schema does not accept the new QualityCheck fields → POST/PATCH strips them → staff can configure validators in the UI but they never persist. Single most important fix.
- REQ #47 — `getAllValidatorSummaries()` returns placeholder values for `name`, `safetyClass`, `deprecated`.
- REQ #41 — No source of truth for per-validator safetyClass; UI cannot surface safety-class status.
- REQ #35 / #36 / #37 / #38 — Safety-class effects 1–4: only Effect 4 (log emission) is partial; effects 1–3 absent.
- REQ #53 — Verdict drill-in route extension never landed; `InboxItemCard.tsx` reads fields off `item.meta` that no server route populates.

**Substantive (spec contract not met, but build runs):**
- REQ #49 — Validator configuration editor only on ScorecardCreatePage; missing on `AgentEditScorecardTab` (an edit surface).
- REQ #45 — Cost attribution mechanism diverges from spec wording (plan reconciles; spec untouched).
- REQ #33 — p95 latency alert mechanism absent.
- REQ #31 — Aggregate-rollup query never validated against inconclusive-verdict exclusion.
- REQ #14 — Registry boot-time validation of `preconditionSlugs` is dead-code; enforcement only at dispatch time.

**Schema / contract drift:**
- REQ #3 — `validator_versions.parameter_schema_json` nullable, spec NOT NULL.
- REQ #6 — `validator_invocations.result_score` nullable, spec NOT NULL.
- REQ #4 / #8 — Two new tables not registered in `rlsProtectedTables.ts`; spec asks, plan redirects.
- REQ #10 — `preconditionParameters` shape: Array vs Record-of-Records.
- REQ #29 — Idempotency index name: spec is wrong (2-tuple), code is right (4-tuple).
- REQ #28 — Parameter-mismatch reasoning string doesn't match spec wording.

**Authoring discipline:**
- REQ #22 — `output_non_empty.ts` evidence includes raw `runOutput`; markdown doc admits this; violates spec §6.6.
- REQ #39 — Safety-class event payload includes `subaccountId`, spec pins exactly four fields.

**Ambiguous:**
- REQ #27 — `hybrid_precondition_pass` audit row written even when the precondition fails (internal inconsistency: `evaluationMethod: 'hybrid_precondition_pass'` paired with `resultPassed: false`).
- REQ #41 — Safety-class registry mechanism (no source of truth; see "Blocking" group too).

## 10. Files modified by this run

- `tasks/review-logs/spec-conformance-log-deterministic-validators-2026-05-18T21-34-58Z.md` (this file)
- `tasks/todo.md` (appended deferred-items section)

No application-code edits were applied during this run.

## 11. Next step

**NON_CONFORMANT — 27 directional / ambiguous gaps require operator attention before `pr-reviewer`.**

See `tasks/todo.md` under "Deferred from spec-conformance review — deterministic-validators (2026-05-18)".

Recommended sequencing for the human:

1. Decide `preconditionParameters` shape (REQ #10) — either update the spec or change the code. This decision blocks REQ #50.
2. Extend the Zod schema (REQ #50). After this, the UI actually persists what it shows.
3. Decide safety-class registry mechanism (REQ #41 + #47) — either a sidecar `SAFETY_CLASS_SLUGS: Set<string>` in `registry.ts`, or a `safetyClass: boolean` field on the `Validator` interface. Spec §6.1 doesn't currently pin a field; plan didn't pin one either.
4. Wire the verdict drill-in route extension (REQ #53). Inbox currently expects `item.meta.{evaluationMethod, validatorSlug, validatorVersion, evidence, gateEvidence}` but no server code populates these.
5. Decide the safety-class alert channel (REQ #36 / #37 / #38) — `recordIncident`? pg-boss queue? — and either update spec §9.6 to match the structured-log decision or implement the named channel.
6. Resolve the schema NOT NULL / nullable inconsistencies (REQ #3, #6).
7. Address remaining authoring + contract gaps (REQ #14, #22, #28, #29, #31, #33, #39).

`spec-conformance` does not re-run after fixes. The next gate is `pr-reviewer` on the post-fix branch.

