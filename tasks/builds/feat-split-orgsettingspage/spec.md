**Status:** draft
**Spec date:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-orgsettingspage

# Split OrgSettingsPage along tab seams

## Goals
- Decompose `client/src/pages/OrgSettingsPage.tsx` (737 LOC) by extracting GeneralTab + PermissionsTab into dedicated files under `client/src/components/org-settings/`.

## Non-goals
- Visual change. API change. New non-helper tests.

## Current structure
- Main `OrgSettingsPage` (39-95, ~57 LOC) — tab dispatch.
- `GeneralTab` (96-464, ~369 LOC).
- `PermissionsTab` (465-622, ~158 LOC).
- `getGroupMeta` helper (623-628).
- `PermissionSetEditor` (629-737, ~109 LOC).

## Target structure
```
client/src/pages/OrgSettingsPage.tsx              ← host (~80 LOC target)
client/src/components/org-settings/
  ├─ GeneralTab.tsx
  ├─ PermissionsTab.tsx                            ← composes PermissionSetEditor
  ├─ PermissionSetEditor.tsx
  └─ permissionGroups.ts                           ← getGroupMeta helper
```

## Migration plan
1. `permissionGroups.ts` + `PermissionSetEditor.tsx` + `PermissionsTab.tsx`.
2. `GeneralTab.tsx`.
3. Update host imports + sweep.

## Acceptance
- Host ≤ 100 LOC.
- All G1 gates green.
