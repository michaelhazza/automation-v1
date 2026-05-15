**Status:** draft
**Spec date:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-reviewqueuepage

# Split ReviewQueuePage by extracting NewBriefModal

## Goals
- Decompose `client/src/pages/ReviewQueuePage.tsx` (826 LOC) by extracting the inline `NewBriefModal` (~117 LOC) into a dedicated file.
- Preserve every user-visible behaviour.

## Non-goals
- Visual change. API change.

## Current structure
- Inline `NewBriefModal` (100-216, ~117 LOC).
- Main `ReviewQueuePage` (217-826, ~609 LOC).

## Target structure
```
client/src/pages/ReviewQueuePage.tsx                 ← host (~700 LOC target)
client/src/components/review-queue/
  └─ NewBriefModal.tsx                                ← extracted modal
```

## Migration plan
1. Extract NewBriefModal.
2. Update host imports.

## Acceptance
- Host ≤ 720 LOC.
- All G1 gates green.

## Notes
- This is a minimal-blast-radius split. ReviewQueuePage's main body is a single coherent table; further extraction would need a deeper spec. Stop after NewBriefModal extraction.
