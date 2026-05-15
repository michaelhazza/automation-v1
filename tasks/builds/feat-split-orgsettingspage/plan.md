# Plan — feat-split-orgsettingspage

Spec: `tasks/builds/feat-split-orgsettingspage/spec.md`. Source: `client/src/pages/OrgSettingsPage.tsx` (737 LOC).

Chunks:
1. `org-settings/permissionGroups.ts` + `PermissionSetEditor.tsx` + `PermissionsTab.tsx`.
2. `GeneralTab.tsx`.
3. Update host imports + sweep.

No `.js` suffixes on relative imports.
