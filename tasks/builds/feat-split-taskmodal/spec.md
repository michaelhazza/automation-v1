**Status:** draft
**Spec date:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-taskmodal

# Split TaskModal along atom / helper seams

## Goals
- Decompose `client/src/components/TaskModal.tsx` (830 LOC) into a thin modal + helpers + atoms under `client/src/components/task-modal/`.
- Preserve every user-visible behaviour.

## Non-goals
- Visual change. API change. New non-helper tests.

## Current structure
- 6 pure helpers: `formatBytes`, `attachmentIcon`, `humanFileType`, `relativeTime`, `plainEnglishFailureReason`, plus 2 atoms `AttachmentTypeIcon`, `ThumbButton`.
- Main `TaskModal` (171-end, ~660 LOC).

## Target structure
```
client/src/components/TaskModal.tsx                  ← thin modal (~530 LOC target)
client/src/components/task-modal/
  ├─ format.ts                                       ← 6 helpers
  ├─ __tests__/format.test.ts                        ← Vitest covering helpers
  ├─ AttachmentTypeIcon.tsx
  └─ ThumbButton.tsx
```

## Migration plan
1. `format.ts` + tests + 2 atoms.
2. Update host imports, sweep unused.

## Acceptance
- Host ≤ 600 LOC.
- All G1 gates green; format tests pass.
