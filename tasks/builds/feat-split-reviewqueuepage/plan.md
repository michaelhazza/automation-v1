# Plan — feat-split-reviewqueuepage

Spec: `tasks/builds/feat-split-reviewqueuepage/spec.md`. Source: `client/src/pages/ReviewQueuePage.tsx` (826 LOC).

Single chunk:
1. Extract inline `NewBriefModal` (lines 100-216) to `client/src/components/review-queue/NewBriefModal.tsx`. Update host imports.

No `.js` suffixes on relative imports.
