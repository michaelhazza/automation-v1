# Progress — memory-block-edges

**Build slug:** `memory-block-edges`
**Branch:** `claude/build-memory-block-edges-7jIyt`
**Task class:** Significant (v1) → Standard (v2 post-grill scope cuts)
**Phase:** PLANNING (v2 re-spec, 2026-05-19)
**Started:** 2026-05-19

---

## v1 abandonment (2026-05-19)

The v1 spec authored earlier on 2026-05-19 in a remote autonomous session is **ABANDONED**. A local `grill-me` pass on 2026-05-19 narrowed scope from a generalised typed-edge graph (six edge types, retrieval traversal, feature flag, four-weekly staging gate, contradiction detector) to two narrow provenance surfaces:

1. `replaced_by_block_id` column on `memory_blocks` (single nullable FK with self-supersession CHECK).
2. `skill_amendment_memory_citations` join table with `kind ∈ {'validates','invalidates'}`.

Per grill-me 2026-05-19 (13 questions, Q1–Q13 logged in `brief.md § Provenance`), the following v1 elements were DROPPED: `contradicts` edge type (no non-LLM triple-extraction mechanism), `derived_from` edge type (redundant with existing `memory_block_version_sources`), `relates_to` edge type (no writer mechanism), retrieval-side traversal in `graphExpansion.ts` (no retrieval effect; pure provenance ledger), `MEMORY_BLOCK_EDGES_ENABLED` feature flag (no behaviour to gate), four-weekly staging gate (no behaviour change to validate).

v1 artefacts removed from working tree (preserved in git history at commit `544c5142`):
- `docs/superpowers/specs/2026-05-19-memory-block-edges-spec.md` — deleted via `git rm`.

v1 artefacts overwritten in-place by v2 Phase 1:
- `intent.md` — to be re-authored at Step 3 against v2 brief.
- `handoff.md` — to be re-authored at Step 9 against v2 spec.

The brief itself was rewritten in-place (v1 → v2) and is in the working tree as `M tasks/builds/memory-block-edges/brief.md` (uncommitted at the start of v2 Phase 1).

**Operator decision recorded 2026-05-19:** abandon v1; re-spec from v2 brief; remove v1 spec file.

---

## v2 Phase 1 status (2026-05-19, complete)

| Step | Status | Notes |
|---|---|---|
| 0. Context loading + PLANNING lock | done | spec-coordinator inline; v1 closed; current-focus BUILDING → PLANNING; brief.md is uncommitted v2 |
| 1. TodoWrite list | done | 14-item top-level list emitted via TodoWrite |
| 2. S0 sync + freshness | done | 8 commits behind (green); merged origin/main into branch via stash-pop sequence; merge commit `0d508597 chore(sync): merge main into ...`. Post-merge typecheck shows 2 pre-existing errors in `configDocumentGeneratorService.ts` (docx) + `configDocumentParserService.ts` (mammoth) — unrelated to v2 scope; no errors introduced by merge. File overlap with main: none — 8 main commits touch `mcp-vendor-server-onboarding` spec-reviewer logs + `iee-worker-retirement` Chunk 5, no overlap with `memoryBlocks.ts` / `skillAmendmentService.ts` / `audit-memory-consolidation.ts` / `rlsProtectedTables.ts`. |
| 3. Intent intake + UI-touch | done | `ui_touch = false` (backend-only per v2 brief §10); intent.md re-authored against v2 brief; task class re-classified **Significant → Standard** (per v2 brief §3 class hint and the narrowed surface — 1 column + 1 join table + 2 service mods + 4 audit checks) |
| 3a. Duplication / Strategy Check | done | `Duplication=clear`, `Strategic fit=clear`, `Recommendation=proceed`. Single cluster (Memory & Knowledge); no multi-cluster tie-break. Sister `memory-outcome-feedback` shares zero source files per v2 brief §13. |
| 3b. Grill-me Q&A | skipped — brief already carries grill | Operator decision 2026-05-19 (`AskUserQuestion`). v2 brief §14 contains a 13-question grill log dated 2026-05-19 (Q1–Q13). intent.md §8 carries 8 Open Questions with locked-at-spec answers. All six grill topics (scope, dependencies, failure modes, operator surfaces, cluster fit, open questions) addressed in the brief + intent. Skip per spec-coordinator §3b skip rule and CLAUDE.md "skip when brief already addresses grill topics". |
| 4. Build slug + directory | done | `memory-block-edges` ratified (matches v1 directory + v2 brief's nominated slug; no rename) |
| 5. Mockup loop | n/a | Backend feature; `ui_touch = false` per Step 3 |
| 6. Spec authoring | in flight | Standard-class spec; ~docs/spec-authoring-checklist.md rubric; Lifecycle Declaration + ABCd Estimate required per §12 |
| 7. spec-reviewer | SKIP — REVIEW_GAP | Codex CLI not installed locally (`which codex` → not found). Standard-class spec; brief carries fresh grill log; spec-conformance + pr-reviewer + chatgpt-pr-review in Phase 2/3 cover directional review. |
| 8. chatgpt-spec-review | SKIP — REVIEW_GAP | Operator override 2026-05-19 (`AskUserQuestion` selection: route external review to Phase 3 chatgpt-pr-review). |
| 9. Handoff write | done | `tasks/builds/memory-block-edges/handoff.md` written (v2 overwrites v1) |
| 10. current-focus.md → BUILDING | done | mission-control block PLANNING → BUILDING; prose body updated with v2 narrative |
| 11. End-of-phase prompt + commit | in flight | Per CLAUDE.md user pref, commit proposed to operator (no auto-commit from main session beyond the S0 sync commit which was a precondition for the merge to proceed) |

---

## v1 Phase 1 status (CLOSED 2026-05-19 — for historical record)

| Step | Status | Notes |
|---|---|---|
| 0. Context loading | done | CLAUDE.md, spec-context.md, capabilities, architecture surveyed; key files Read (`memoryBlocks.ts`, `graphExpansion.ts`, `memoryBlockSynthesisService.ts`, `correctionPatternDetectorJob.ts`, `skillAmendments.ts`, `memoryConsolidationConfig.ts`, `featureFlags.ts`) |
| 1. TodoWrite list | skipped — TodoWrite tool not available in this remote autonomous session. Progress tracked here. |
| 2. S0 sync + freshness | done | 0 commits behind main (HEAD `fc8cf05`) |
| 3. Intent intake + UI-touch detection | in flight | Backend-only — `ui_touch = false` (brief explicitly defers operator UI) |
| 3a. Duplication / Strategy Check | pending | Runs after intent.md draft |
| 3b. Grill-me Q&A | SKIP — REVIEW_GAP | Remote autonomous session; operator interview not available. Brief already covers scope boundaries / dependencies / failure modes / operator surfaces / cluster fit / open questions; meta-rule "skip when brief already addresses grill topics" applies. |
| 4. Build slug + directory | done | `memory-block-edges` ratified (matches brief) |
| 5. Mockup loop | n/a | Backend feature, no UI |
| 6. Spec authoring | done | 748-line spec at `docs/superpowers/specs/2026-05-19-memory-block-edges-spec.md`; numeric-count reconciliation passed |
| 7. spec-reviewer | SKIP — REVIEW_GAP | Codex CLI not available in this remote autonomous environment (`which codex` → not found). Recorded below. |
| 8. chatgpt-spec-review | SKIP — REVIEW_GAP | Manual ChatGPT-web mode; not viable in remote autonomous session. Recorded below. |
| 9. Handoff write | done | `tasks/builds/memory-block-edges/handoff.md` written |
| 10. current-focus.md → BUILDING | done | mission-control block flipped to BUILDING; prose narrative appended |
| 11. End-of-phase prompt | done | This file + chat response carry the prompt; next step: launch `feature-coordinator` in a new session |

## REVIEW_GAP entries

```
REVIEW_GAP: grill-me | task-class: Significant | reason: remote autonomous session; no operator interview channel | operator-override: no | remediation: brief covers the grill topics (scope, dependencies, failure modes, operator surfaces, cluster fit, open questions) — per spec-coordinator §3b skip rule
REVIEW_GAP: spec-reviewer | task-class: Significant | reason: Codex CLI unavailable in remote execution environment (`which codex` returned not-found, exit 1) | operator-override: no | remediation: run spec-reviewer manually before Phase 2 plan gate when in a local-dev session with Codex installed; spec is structured for the standard reviewer rubric (frontmatter, lifecycle declaration, ABCd estimate, contracts, RLS posture, execution-safety contracts, numeric-count reconciliation) so review iterations should be light
REVIEW_GAP: chatgpt-spec-review | task-class: Significant | reason: manual ChatGPT-web mode requires operator paste loop; not viable in remote autonomous session | operator-override: no | remediation: run chatgpt-spec-review in a dedicated new session before Phase 2 plan gate, OR consume the chatgpt-pr-review pass at Phase 3 finalisation as the primary external-LLM review surface
```

## Open architecture questions surfaced during context load

To be resolved in the spec (Open Questions section + locked decisions):

1. **Edge endpoint scope** — brief schema declares `from_block_id` and `to_block_id` both FK to `memory_blocks`. But the existing `graphExpansion.ts` operates on `workspace_memory_entries`, and `memoryBlockSynthesisService` clusters `workspace_memory_entries` to mint a new `memory_block`. The natural `derived_from` edge has heterogeneous endpoints (block ← entry). Options: (a) constrain to block↔block (record only the "block was synthesised from this cluster" lineage via existing `memory_block_version_sources`, edge becomes block↔block only when synthesis already happened); (b) add a second pair of optional endpoint columns for entry IDs; (c) abstract endpoints to a polymorphic `(target_kind, target_id)`. Lock at spec.
2. **Retrieval surface** — does edge traversal extend `graphExpansion.ts` (workspace memory entries pipeline) or does it run as a separate retriever on the memory-blocks injection path? The brief says "Extend `graphExpansion.ts`" but the table-level mismatch (above) means the extension might need to walk from workspace-entry hits up to memory-blocks via existing FKs/joins before traversing block-edges. Lock at spec.
3. **Skill-amendment ↔ memory_block linkage** — `skill_amendments.rcaJson` is freeform JSONB; the brief assumes the amendment service can identify which memory_blocks an RCA cites. We need a parse contract for `rcaJson` (e.g. `cited_memory_block_ids: string[]`) OR a side-table. Lock at spec.
4. **Contradiction detector folding** — brief says "architect may fold into `correctionPatternDetector`". Decide: separate job vs folded. Recommendation: separate job because triple-extraction (S+P+O) is meaningfully different from the embedding-similarity clustering the existing job already performs.
5. **Edge type literal `derived_from` overlap with `memory_block_versions` lineage** — the existing `memory_block_version_sources` (PR #298) already records "this block version was derived from those workspace entries". `derived_from` between blocks is a distinct, weaker signal (block A is derived from blocks A1..An). Make sure the two coexist without overlapping semantics; document explicitly.
