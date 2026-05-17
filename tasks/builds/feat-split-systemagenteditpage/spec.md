**Status:** draft
**Spec date:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-systemagenteditpage

# Split SystemAgentEditPage along atom / helper seams

## Goals
- Decompose `client/src/pages/SystemAgentEditPage.tsx` (743 LOC) by extracting the small atoms (Card, CardHeader, Field, Toggle, RoleBadge) and pure cron helpers under `client/src/components/system-agent-edit/`.
- Preserve every user-visible behaviour.

## Non-goals
- Visual change. API change. New non-helper tests.

## Current structure
- 2 pure helpers: `parseCron`, `buildCron`.
- 5 atoms: `Card`, `CardHeader`, `Field`, `Toggle`, `RoleBadge`.
- Main `SystemAgentEditPage` (163-end, ~580 LOC).

## Target structure
```
client/src/pages/SystemAgentEditPage.tsx             ← host (~580 LOC target)
client/src/components/system-agent-edit/
  ├─ cron.ts                                          ← parseCron, buildCron
  ├─ __tests__/cron.test.ts                          ← Vitest covering parse/build round-trip
  └─ atoms.tsx                                        ← Card, CardHeader, Field, Toggle, RoleBadge (single file because all are small)
```

## Migration plan
1. `cron.ts` + tests + `atoms.tsx`.
2. Update host imports, sweep unused.

## Acceptance
- Host ≤ 620 LOC.
- All G1 gates green; cron tests pass.
