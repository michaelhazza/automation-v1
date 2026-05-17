**Status:** draft
**Spec date:** 2026-05-15
**Last updated:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-subaccountagenteditpage

# Split SubaccountAgentEditPage along tab seams

## 1. Goals

- Decompose `client/src/pages/SubaccountAgentEditPage.tsx` (871 LOC) into a thin host plus per-tab files under `client/src/components/subaccount-agent-edit/`, matching the convention established by batches 1+2.
- Preserve every user-visible behaviour: tab labels and order (skills, instructions, budget, scheduling, execution, governance, identity, beliefs), URL `?tab=` parameter, newly-onboarded banner, per-section save state (saving/saved/error), the identity tab's suspend/revoke confirms, and the BeliefsTab integration.

## 2. Non-goals

- Visual change of any kind.
- API change — every endpoint call, payload, save semantics preserved.
- New tests — no new pure helpers introduced.

## 3. Existing primitives reused

| Primitive | Why reuse |
|---|---|
| `client/src/components/<feature>/` convention | Same as batches 1+2 |
| `client/src/components/ConfirmDialog.tsx` | Already extracted |
| `client/src/lib/api.ts` + helpers (`getAgentIdentity`) | Stay |
| Identity card components (if separately imported today) | Stay unchanged |

No new primitives invented.

## 4. Current structure

`SubaccountAgentEditPage.tsx` (871 LOC):
- Type aliases / interfaces at the top (LinkDetail, AgentIdentity, etc.).
- Inline `Section` presentational helper (85-97).
- Main page (98-730, ~630 LOC) — load logic, identity loading, 8 tab states + handlers, render dispatch.
- Inline `BeliefsTab` (743-871, ~130 LOC).

## 5. Target structure

```
client/src/pages/SubaccountAgentEditPage.tsx                ← host (~250 LOC target)
client/src/components/subaccount-agent-edit/
  ├─ types.ts                                              ← LinkDetail, AgentIdentity, AvailableSkill, AllowedEnvironment, Tab union, IdentityCardAction
  ├─ Section.tsx                                            ← extracted Section helper
  ├─ SkillsTab.tsx                                          ← skill checklist editor
  ├─ InstructionsTab.tsx                                    ← custom-instructions textarea + save
  ├─ BudgetTab.tsx                                          ← token/tool-calls/timeout/max-cost fields
  ├─ SchedulingTab.tsx                                      ← cron + enable + tz + concurrency
  ├─ ExecutionTab.tsx                                       ← controller-style + allowed envs
  ├─ GovernanceTab.tsx                                      ← maxRiskTier + requireApprovalAtTier
  ├─ IdentityTab.tsx                                        ← identity fetch + suspend/revoke + error display
  └─ BeliefsTab.tsx                                          ← moved verbatim
```

`App.tsx` import unchanged.

## 6. Component tree

```
SubaccountAgentEditPage (host, ~250 LOC)
│
├── header (h1 + agent metadata + onboarded banner)         ← inline
├── tab bar                                                  ← inline
└── tab body — dispatch by activeTab
    ├── skills        → <SkillsTab link, availableSkills, onSaved />
    ├── instructions  → <InstructionsTab link, onSaved />
    ├── budget        → <BudgetTab link, onSaved />
    ├── scheduling    → <SchedulingTab link, onSaved />
    ├── execution     → <ExecutionTab link, onSaved />
    ├── governance    → <GovernanceTab link, onSaved />
    ├── identity      → <IdentityTab agentId, onActionCompleted />
    └── beliefs       → <BeliefsTab subaccountId, linkId />
```

## 7. Data-fetching ownership

- Host owns the master `LinkDetail` fetch (`GET /api/subaccounts/:id/agents/:linkId/detail`) and the `availableSkills` fetch — both used to seed initial form state across multiple tabs.
- Each per-section tab owns its own form state (seeded from the `link` prop on mount, reseeds on `link` change via `useEffect([link])`).
- Each tab owns its own save handler that PATCHes the specific fields. On success, calls `onSaved()` so host refetches `LinkDetail`.
- `<IdentityTab>` self-fetches `getAgentIdentity(agentId)` on mount.
- `<BeliefsTab>` self-fetches as today.

## 8. Prop contracts

### 8.1-8.6 Section tabs
```
{ link: LinkDetail; onSaved(): Promise<void> }
```
For SkillsTab: also receives `availableSkills: AvailableSkill[]`.

Each tab seeds its local form state from `link` on mount and on `link` change. Save handler PATCHes the relevant payload, on success calls `await onSaved()` (host's `load()`).

### 8.7 `<IdentityTab>`
```
{ agentId: string; onActionCompleted(): void }
```
Owns identity fetch state, suspend/revoke confirms, `identityPending` action state, and `identityError`.

### 8.8 `<BeliefsTab>`
```
{ subaccountId: string; linkId: string }
```
Already self-contained today — moves wholesale.

## 9. Migration plan

### Chunk 1 — `types.ts` + `Section.tsx` + `BeliefsTab.tsx`
- Move shared types to `types.ts`.
- Move `Section` to its own file.
- Move `BeliefsTab` to its own file (already self-contained).

### Chunk 2 — `IdentityTab`
- Extract identity-tab state + handlers + render into `IdentityTab.tsx`.

### Chunk 3 — Section tabs (Skills, Instructions, Budget, Scheduling, Execution, Governance)
- Extract each per-section form into its own file.
- Each owns its own form state seeded from `link`.
- Save handlers move with the tabs.

### Chunk 4 — Verify + cleanup
- Run lint, typecheck, build:client.
- Confirm host ≤ 250 LOC.
- Sweep unused imports.

## 10. Deferred Items

- Shared `<SectionFormShell>` primitive — defer until 3+ section tabs share more than the `Section` wrapper.
- `useAgentLink` hook — could own the LinkDetail fetch but only one consumer; defer.

## 11. Self-consistency

- 8 tab order preserved.
- `?tab=` URL param preserved.
- Newly-onboarded banner preserved.
- Per-section save semantics (saving / saved / saveError) preserved per tab.
- Identity tab suspend/revoke confirm dialogs preserved.

## 12. Acceptance criteria

- Host shrinks to ≤ 250 LOC.
- 9 new files under `client/src/components/subaccount-agent-edit/`.
- All G1 gates green.

## 13. Open questions

- None. Pattern established.
