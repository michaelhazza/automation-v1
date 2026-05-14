# Plan — feat-split-skillanalyzerresultsstep

**Spec:** `tasks/builds/feat-split-skillanalyzerresultsstep/spec.md` (§10 migration plan is source of truth).

**Source file:** `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` (1,102 LOC).
**Target orchestrator LOC:** ≤ 250.

Chunks (per spec §10):
1. `resultsStep/constants.ts` + `DiffView.tsx` + `AgentChipBlock.tsx`.
2. `ResultRow.tsx` + `ResultSection.tsx`.
3. `ProposedAgentBanner.tsx`.
4. Verify + cleanup.

Notes:
- Sub-folder `resultsStep/` keeps the 6 new files grouped (vs. flat skill-analyzer/).
- All prop contracts in spec §7 — lifted verbatim from source, no shape changes.
- `SECTION_CONFIG` colour map and `Classification` type move into `resultsStep/constants.ts`.
- `AGENT_SCORE_DISPLAY_THRESHOLD = 0.45` stays file-local in `AgentChipBlock.tsx` (no other consumer).
- Continue button is always-enabled with approved-count suffix — preserved.
- No `.js` suffixes on relative imports.
