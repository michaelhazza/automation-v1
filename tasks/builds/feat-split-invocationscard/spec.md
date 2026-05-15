**Status:** draft
**Spec date:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-invocationscard

# Split InvocationsCard along atom seams

## Goals
- Decompose `client/src/components/InvocationsCard.tsx` (661 LOC) by extracting `HeartbeatTimeline` and `AccordionRow` into `client/src/components/invocations-card/`.

## Non-goals
- Visual change. API change.

## Current structure
- 2 sub-components: `HeartbeatTimeline` (6-89, ~83 LOC), `AccordionRow` (90-156, ~66 LOC).
- Main `InvocationsCard` (157-661, ~504 LOC).

## Target structure
```
client/src/components/InvocationsCard.tsx          ← host (~510 LOC target)
client/src/components/invocations-card/
  ├─ HeartbeatTimeline.tsx
  └─ AccordionRow.tsx
```

## Migration plan
Single chunk: extract both. Update host imports.

## Acceptance
- Host ≤ 540 LOC.
- All G1 gates green.
