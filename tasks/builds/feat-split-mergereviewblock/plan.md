# Plan — feat-split-mergereviewblock

**Spec:** `tasks/builds/feat-split-mergereviewblock/spec.md` (§5/§9 are source of truth).
**Source:** `client/src/components/skill-analyzer/MergeReviewBlock.tsx` (992 LOC).
**Target orchestrator LOC:** ≤ 300.

Chunks:
1. `mergeReview/format.ts` + tests + atoms (InlineDiff, FieldRow, WarningItem, CriticalPhraseInput).
2. `WarningResolutionBlock.tsx`.
3. Verify + cleanup.

Notes:
- Sub-folder `mergeReview/` keeps the new files grouped vs flat skill-analyzer/.
- All prop contracts lifted verbatim from current inline declarations.
- Three pure helpers: `definitionToString`, `tryParseJson`, `parseNameMismatchDetail`.
- No `.js` suffixes on relative imports.
