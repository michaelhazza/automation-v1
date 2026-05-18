# Handoff — deterministic-validators

**Phase complete:** BUILD
**Next phase:** FINALISATION (run `finalisation-coordinator` in a new session)
**Phase 2 finished:** 2026-05-19
**Branch HEAD at handoff:** `04a4e277`

## Phase 2 summary

6 chunks built, 5 mandatory reviewers run, all critical findings fixed. Pipeline state: ready for Phase 3 (S2 sync, G4 guard, chatgpt-pr-review, doc-sync sweep, MERGE_READY).

### Build artefacts

- Plan: `tasks/builds/deterministic-validators/plan.md` (6 chunks, locked after 2 chatgpt-plan-review rounds)
- Progress: `tasks/builds/deterministic-validators/progress.md` (full Phase 2 status table)
- G2 evidence: `tasks/builds/deterministic-validators/g2-evidence.md`
- 12 commits since branch from main; HEAD `04a4e277`

### Review pass results

| Reviewer | Verdict | Outcome |
|---|---|---|
| spec-conformance | NON_CONFORMANT → fixes applied | 4 blocking fixes (Zod schema extension, getAllValidatorSummaries field source-of-truth, evidence truncation per §6.6, safety_class event payload cleanup). 23 directional gaps + 2 ambiguous routed to `tasks/todo.md`. Log: `tasks/review-logs/spec-conformance-log-deterministic-validators-2026-05-18T21-34-58Z.md` |
| adversarial-reviewer | HOLES_FOUND → all 4 fixed | Per-tenant rate-limit/circuit-breaker keying (slug:orgId), evidence redaction (output_non_empty, date_in_format, numeric_within_tolerance), ReDoS length-cap (no_forbidden_phrase, cited_entity_exists). |
| pr-reviewer | CHANGES_REQUESTED → 6/7 fixed | ValidatorParameterForm parse-on-change, dispatcher inconclusive DTO on retry exhaustion, registry dead code (29 lines) removed, useEffect cancellation guard, console.warn on listValidators failure, phone regex separator. 1 deferred (sentinel UUID documentation). |
| reality-checker | NEEDS_WORK → resolved | Criterion 9 (static checks) flagged as unverified textual claim; resolved by committing `g2-evidence.md` to disk. |
| dual-reviewer | APPROVED after 3 iterations | 3 Codex fixes accepted: registry-meta path resolution for compiled deployments, staff-only field guard on POST/PATCH/POST-subaccount scorecards routes, off-by-one in source-tree fallback path. Log: `tasks/review-logs/dual-review-log-deterministic-validators-2026-05-18T23-42-46Z.md` |

### G2 evidence

- Lint: 0 errors, 879 warnings (pre-existing — no new warnings)
- Typecheck: clean (dual tsconfig client + server)
- Build:client: 670 modules, 5.01s
- Targeted tests: 121 / 121 passing (15 test files)

### Doc-sync (Phase 2 gate)

| Doc | Verdict |
|---|---|
| `architecture.md` | yes — Modify the deterministic-validator dispatcher, Add a new validator, Modify the verdict drill-in UI rows added (Stage 2 scorecards section) |
| `docs/capabilities.md` | deferred to Phase 3 — Capability Registration verdict pending (will be `yes: update existing capability record` extending `trust-verification-layer` quality framework) |
| `KNOWLEDGE.md` | yes — 6 patterns appended (per-(slug × org) keying, system-tier audit redaction, JSON parse-on-change, ReDoS guard, compiled-deployment assets, staff-only field guard) |
| `docs/integration-reference.md` | n/a — no integration changes |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | n/a — no build-discipline / convention changes |
| `docs/frontend-design-principles.md` | n/a — no new UI pattern; VerdictDrillIn uses existing component idioms |
| `docs/decisions/` | n/a — no durable architectural choice locked (the dispatcher pattern is documented in the spec and architecture.md) |
| `docs/spec-context.md` | n/a — Phase 2 (not a spec-review session) |
| `docs/incident-response.md` | n/a |
| `docs/testing-transition-plan.md` | n/a |
| `references/test-gate-policy.md` | n/a |
| `references/spec-review-directional-signals.md` | n/a |
| `.claude/FRAMEWORK_VERSION` | n/a |
| `scripts/verify-*` | n/a — no gate changes |

### Deferred to operator (NON-BLOCKING for merge — tracked in tasks/todo.md)

Each item is a design decision the spec-conformance / pr-reviewer agents could not fix mechanically. Operator may close or defer indefinitely:

- **REQ #10:** `preconditionParameters` shape (Array vs Record). Code uses Array indexed by position; spec text says Record keyed by slug. Either fix the code, fix the spec, or accept the divergence.
- **REQ #35–38:** Safety-class effects 1–4 wiring (verdict short-circuit, cross-brief event channel, recordIncident). Currently only `logger.info` emission; spec calls for subscribable event + Synthetos channel alert.
- **REQ #53:** Verdict drill-in route extension. `InboxItemCard` reads `item.meta.evaluationMethod` etc., but no route populates those fields yet. Needs scorecard-judgement fetch route extension.
- **REQ #49:** `AgentEditScorecardTab` editor (currently read-only badge). Edit surface should host the full `QualityCheckValidatorSection` editor like `ScorecardCreatePage` does.
- **REQ #3 / #6:** DDL nullable on `validator_versions.parameter_schema_json` + `validator_invocations.result_score`. Spec says NOT NULL; code has nullable for inconclusive cases. Behaviour-change decision.
- **REQ #45:** Cost attribution mechanism. Spec says `cost=0` on `scorecard_judgements` but no `cost` column exists; plan reconciles to absence-of-`llm_requests`-row. Spec wording should be updated.
- **REQ #33:** p95 latency alert. No monitoring alert wired; needs Synthetos channel hook.
- **REQ #31:** Aggregate-rollup query inclusive/exclusive of inconclusive verdicts. Behaviour unverified in this branch.
- **REQ #27:** Hybrid precondition fail audit row evaluation_method tagging (currently always `hybrid_precondition_pass` even when `resultPassed: false`).
- **pr-reviewer should-fix #6:** Sentinel UUID for `verdictId` in `makeInvocationDto` is undocumented sharp edge; refactor for explicit pending-verdict type.

### Known limitations carried to Phase 3

- **Hybrid template discovery** (Phase 1 open question #2): rubric authors must know hybrid validator slugs to configure them; no template picker exists. Acceptable for Phase 1; would benefit from a hybrid-template gallery in a follow-up.
- **Validator catalogue browser** (Phase 1 open question #3): not built in Phase 2. Synthetos staff currently see the per-rubric editor only.

## Phase 1 (SPEC) decisions — retained for reference

(Original Phase 1 handoff body below — unchanged.)

---

**Original Phase 1 content:**
**Spec path:** docs/superpowers/specs/2026-05-18-deterministic-validators-spec.md
**Branch:** claude/deterministic-validators-3Xjcb
**Build slug:** deterministic-validators
**UI-touching:** yes
**Mockup paths:** prototypes/deterministic-validators.html (2 screens, 3 rounds, CLEAN)
**Spec-reviewer iterations used:** 0 / 5 (skipped — operator instruction)
**ChatGPT spec review log:** tasks/review-logs/chatgpt-spec-review-deterministic-validators-2026-05-18T13-04-50Z.md
**ChatGPT spec review result:** APPROVED after Round 2 (Round 1: 14 findings — 13 applied, 1 rejected on framing; Round 2: 3 minor wording cleanups applied)
**Open questions for Phase 2:**
1. VerdictDrillIn surface location — "Needs Review" lane vs closed-loop `improvements-section` pattern (spec §10.2, §19 Q1). Must be decided before Phase 2 build begins; record in progress.md.
2. Hybrid template discovery — how do rubric authors find and configure hybrid patterns without a "hybrid templates" picker (spec §19 Q2). Phase 2 scopes.
3. Validator catalogue browser (Surface 3) — scope and ship in Phase 2 if a Synthetos staff operator requests it.

**Decisions made in Phase 1:**
- Catalogue miss → `inconclusive`, no fallback to semantic judge
- Hybrid gate fail → `score: 0.0`, `evaluation_method: 'hybrid_deterministic_fail'`, full gate evidence
- `deterministic_external` is a Validator.kind only; QualityCheck.kind stays deterministic/semantic/hybrid
- `VerdictDrillIn` component pinned at `client/src/components/verdicts/VerdictDrillIn.tsx` with spec-locked prop interface
- Hybrid editor: generic `ValidatorParameterField[]`-driven form renderer, `uiHint` field for control types
- Bench: fully transparent, same dispatcher as live judging, no bypass flag
- Historical replay limitation: accepted, documented in §5.2 and §9.3
- `cited_entity_exists`: formal `entityResolverRegistry.ts` typed map
- `.registry-meta.json`: pinned JSON shape with expiry/reason required on bypass
- `trace_id TEXT NULL` in `validator_invocations` Phase 1 migration
- `action_set_within_allowlist`: `RunMetadata.invokedSkillSlugs` from dispatcher (stays deterministic)
- `validator_versions` snapshot: server-startup upsert, idempotent, fail-open on DB unavailability
- Inconclusive threshold: inline at end of judge job; `inconclusive_alert_threshold` on rubric (default 0.20)
- Screen 1 admin-gated: operator view unchanged; validator configuration section visible to Synthetos staff only
- Safety-class cross-brief effects: fulfilled via `safety_class_check_failed` event emission; consuming briefs own subscription
- Evidence redaction: structural metadata only in audit table; PII validators must not store matched text
