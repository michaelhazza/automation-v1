# Progress — deterministic-validators

**Branch:** claude/deterministic-validators-3Xjcb
**Build class:** Major
**Phase 1 start:** 2026-05-18

## Phase 1 status

| Step | Status | Notes |
|---|---|---|
| S0 branch sync | complete | 5 commits behind, merged cleanly. Conflict in current-focus.md (known-shape: main had browser-vision-grounding BUILDING, HEAD had PLANNING) — resolved by keeping HEAD. Typecheck clean post-merge. |
| Intent intake | complete | Major class, UI-touch detected (§3.7 Surface 1 + Surface 2). intent.md written. |
| Duplication / Strategy Check | complete | clear / clear / proceed. No Asset Register row covers typed deterministic validator layer. |
| Grill-me Q&A | complete | 13 questions resolved. All brief §6 open questions confirmed as recommended + 3 additional branches (entity resolver registry, validator_versions snapshot trigger, inconclusive threshold inline check). |
| Build slug derivation | complete | Slug: deterministic-validators. Directory: tasks/builds/deterministic-validators/. current-focus.md updated. |
| Mockup loop | pending | ui_touch=true, operator confirmed mockups. Surface 1 (rubric editor) + Surface 2 (verdict drill-in). |
| Spec authoring | complete | docs/superpowers/specs/2026-05-18-deterministic-validators-spec.md (14 chunks, chunked workflow) |
| spec-reviewer | skipped | operator instruction — "skip spec reviewer" |
| chatgpt-spec-review | complete | APPROVED after 2 rounds. Round 1: 14 findings (13 applied, 1 rejected on framing). Round 2: 3 minor wording cleanups applied. |
| Handoff write | complete | tasks/builds/deterministic-validators/handoff.md |

## Phase 2 status

| Step | Status | Notes |
|---|---|---|
| S1 branch sync | complete | Merged 1 commit from main (_ieeShared.ts). Typecheck clean. current-focus.md drift fixed. |
| Pre-Phase 2 decision | complete | VerdictDrillIn surface location: "Needs Review" lane (spec §10.2, §19 Q1 resolved) |
| architect invocation | complete | 6-chunk plan written to tasks/builds/deterministic-validators/plan.md |
| chatgpt-plan-review | complete | 2 rounds, 14 findings, plan locked |
| plan-gate | complete | operator locked |
| Chunk 1 — Schema migrations | complete | Migration 0379, Drizzle schemas, scorecards inconclusive_alert_threshold |
| Chunk 2 — Validator framework | complete | types.ts, registry.ts, entityResolverRegistry.ts, scaffold-validator CLI, isolation lint |
| Chunk 3 — Dispatcher | complete | scorecardDispatcherPure + scorecardDispatcher; benchExecuteJob and scorecardJudgeJob wired |
| Chunk 4 — Phase 1 catalogue | complete | 8 validators added (output_non_empty was Chunk 2 example); 67 unit tests |
| Chunk 5 — Audit + observability | complete | validatorAuditService.writeInvocations, OTel spans, snapshotAllValidatorsToDb boot wiring |
| Chunk 6 — UI surfaces | complete | GET /api/validators, VerdictDrillIn, ValidatorParameterForm, QualityCheckValidatorSection |
| G2 integrated-state gate | complete | lint 0 errors, typecheck clean, build:client clean (670 modules), 121/121 targeted tests pass. Evidence: tasks/builds/deterministic-validators/g2-evidence.md |
| spec-conformance | complete | NON_CONFORMANT → 4 blocking fixes applied (Zod schema, getAllValidatorSummaries fields, evidence truncation, safety_class event payload). 23 directional gaps + 2 ambiguous routed to tasks/todo.md. Log: spec-conformance-log-deterministic-validators-2026-05-18T21-34-58Z.md |
| adversarial-reviewer | complete | HOLES_FOUND (1 confirmed + 3 likely) → all 4 fixed (per-tenant rate-limit/circuit-breaker keying, evidence redaction in output_non_empty/date_in_format/numeric_within_tolerance, ReDoS length-cap in no_forbidden_phrase/cited_entity_exists) |
| pr-reviewer | complete | CHANGES_REQUESTED (1 blocking + 6 should-fix) → 6/7 fixed (ValidatorParameterForm parse-on-change, dispatcher inconclusive DTO, registry dead code removed, useEffect cancellation guard, console.warn on listValidators failure, phone regex separator). 1 deferred (sentinel UUID documentation) |
| reality-checker | complete | NEEDS_WORK → resolved by committing g2-evidence.md to disk |
| dual-reviewer | complete | APPROVED after 3 iterations. 3 Codex fixes accepted: registry-meta path resolution for compiled deployments, staff-only field guard on POST/PATCH/POST-subaccount scorecards routes, off-by-one in source-tree fallback path. 2 commits: 39e42872, f8bf9518. Log: dual-review-log-deterministic-validators-2026-05-18T23-42-46Z.md |
| Doc-sync gate | pending | run after resume — check docs/doc-sync.md registered docs |
| Handoff write | pending | append Phase 2 section to handoff.md |
| current-focus.md → REVIEWING | pending | |
| End-of-phase prompt | pending | |

## Resume notes (paused 2026-05-19)

Pipeline is **3 steps from complete**: doc-sync gate, handoff write, current-focus update. All 6 chunks built, all 5 mandatory reviewers run, all critical findings fixed.

**Branch HEAD:** `f8bf9518` (dual-reviewer log commit; the substantive code change is `39e42872`)

**Key facts for the next session:**
- 9 commits on the branch: 6 chunks + 4 fix commits (spec-conformance, adversarial, pr-reviewer, dual-reviewer) + 1 G2-evidence + 1 dual-reviewer log = 12 commits since branch from main.
- All review logs persisted under `tasks/review-logs/`.
- G2 evidence file at `tasks/builds/deterministic-validators/g2-evidence.md`.
- 121 targeted tests pass.

**Deferred to operator (NOT blockers for merge, but tracked in tasks/todo.md):**
- preconditionParameters shape (Array vs Record) — REQ #10
- Safety-class effects 1–4 wiring (verdict short-circuit, cross-brief event channel, recordIncident) — REQ #35–38
- Verdict drill-in route extension (InboxItemCard reads item.meta; no route populates the new fields yet) — REQ #53
- AgentEditScorecardTab editor (currently read-only badge) — REQ #49
- DDL nullable on validator_versions.parameter_schema_json + validator_invocations.result_score — REQ #3/6
- Cost attribution mechanism — REQ #45
- p95 latency alert — REQ #33
- Aggregate-rollup query inclusive/exclusive of inconclusive verdicts — REQ #31
- Hybrid precondition fail audit row evaluation_method tagging — REQ #27 (ambiguous)
- Sentinel UUID for verdictId in makeInvocationDto (documentation-level) — pr-reviewer should-fix #6

**Next steps when resuming:**
1. Doc-sync sweep against `docs/doc-sync.md`
2. Append Phase 2 section to `tasks/builds/deterministic-validators/handoff.md`
3. Update `tasks/current-focus.md` → `status: REVIEWING`
4. End-of-phase prompt to operator

## VerdictDrillIn surface location decision (2026-05-18)

**Decision:** "Needs Review" lane inside the existing Inbox tab.
**Rationale:** Matches current mockup; keeps verdict detail close to the review workflow; closed-loop brief imports the component independently.

## Grill-me decisions (13 questions locked 2026-05-18)

1. Catalogue miss → `inconclusive`, no fallback
2. Hybrid gate fail → `score: 0.0`, `evaluation_method: 'hybrid_deterministic_fail'`, full gate evidence
3. `deterministic_external` cost: `validator_invocations` columns; admin stats panel; p95 > 1s → monitoring alert
4. `VerdictDrillIn` component pinned at `client/src/components/verdicts/VerdictDrillIn.tsx`, spec declares prop interface
5. Hybrid editor: generic `ValidatorParameterField[]`-driven form renderer, `uiHint` field
6. Bench: fully transparent, same dispatcher, no bypass
7. Historical replay: accepted limitation, documented in schema comment + spec audit section
8. `cited_entity_exists`: formal `entityResolverRegistry.ts` typed map
9. `.registry-meta.json`: pinned JSON shape with expiry/reason required on bypass
10. `trace_id TEXT NULL` in `validator_invocations` Phase 1 migration
11. `action_set_within_allowlist`: `RunMetadata.invokedSkillSlugs: string[]` from dispatcher
12. `validator_versions`: server-startup upsert, idempotent
13. Inconclusive threshold: inline at end of judge job; `inconclusiveAlertThreshold` on rubric (default 0.20)
