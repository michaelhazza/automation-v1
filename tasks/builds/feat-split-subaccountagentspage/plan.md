# Plan — feat-split-subaccountagentspage

Spec: `tasks/builds/feat-split-subaccountagentspage/spec.md`. Source: `client/src/pages/SubaccountAgentsPage.tsx` (723 LOC).

Single chunk:
1. Extract `StatusBadge` + `RoleBadge` + `SubaccountTreeRow` into `client/src/components/subaccount-agents/`. Update host imports.

No `.js` suffixes on relative imports.
