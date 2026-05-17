# Plan — feat-split-subaccountagenteditpage

**Spec:** `tasks/builds/feat-split-subaccountagenteditpage/spec.md` (§5/§7/§8 are source of truth).
**Source:** `client/src/pages/SubaccountAgentEditPage.tsx` (871 LOC).
**Target host LOC:** ≤ 250.

Chunks:
1. `types.ts` + `Section.tsx` + `BeliefsTab.tsx`.
2. `IdentityTab.tsx`.
3. 6 section tabs (Skills, Instructions, Budget, Scheduling, Execution, Governance).
4. Verify + cleanup.

Notes:
- Host owns LinkDetail + availableSkills fetch.
- Each section tab seeds form state from `link` prop on mount and reseeds on `link` change.
- Each tab's save handler PATCHes its own fields, then calls `await onSaved()` (host's `load()`).
- IdentityTab self-fetches `getAgentIdentity(agentId)` on mount.
- BeliefsTab moves verbatim.
- No `.js` suffixes on relative imports.
