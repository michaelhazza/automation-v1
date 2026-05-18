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
