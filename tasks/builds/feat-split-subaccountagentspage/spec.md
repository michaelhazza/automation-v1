**Status:** draft
**Spec date:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-subaccountagentspage

# Split SubaccountAgentsPage along atom seams

## Goals
- Decompose `client/src/pages/SubaccountAgentsPage.tsx` (723 LOC) by extracting the tree-row + badge atoms into `client/src/components/subaccount-agents/`.

## Non-goals
- Visual change. API change. New non-helper tests.

## Current structure
- 3 atoms: `StatusBadge` (78-85), `RoleBadge` (86-94), `SubaccountTreeRow` (95-136).
- Main `SubaccountAgentsPage` (137-723, ~587 LOC).

## Target structure
```
client/src/pages/SubaccountAgentsPage.tsx         ← host (~610 LOC target)
client/src/components/subaccount-agents/
  ├─ StatusBadge.tsx
  ├─ RoleBadge.tsx
  └─ SubaccountTreeRow.tsx
```

## Migration plan
1. Extract the 3 atoms.
2. Update host imports + sweep.

## Acceptance
- Host ≤ 640 LOC.
- All G1 gates green.
