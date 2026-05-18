# Progress — memory-block-edges

**Build slug:** `memory-block-edges`
**Branch:** `claude/build-memory-block-edges-7jIyt`
**Task class:** Significant
**Phase:** PLANNING → SPEC AUTHORING
**Started:** 2026-05-19

## Phase 1 status

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
