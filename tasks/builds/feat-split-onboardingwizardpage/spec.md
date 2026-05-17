**Status:** draft
**Spec date:** 2026-05-15
**Last updated:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-onboardingwizardpage

# Split OnboardingWizardPage along step seams

## 1. Goals

- Decompose `client/src/pages/OnboardingWizardPage.tsx` (836 LOC) into a thin host plus per-step files under `client/src/components/onboarding-wizard/`. The wizard's 4 steps are already conceptually separate (Step1Connect, Step2Locations, Step3Sync, Step4Baseline) — this refactor moves them to their own files.
- Preserve every user-visible behaviour: 4-step progression with the step bar, the connect / locations / sync / baseline flows.

## 2. Non-goals

- Visual change of any kind.
- API change.
- New tests — no new pure helpers introduced.

## 3. Existing primitives reused

| Primitive | Why reuse |
|---|---|
| `client/src/components/<feature>/` convention | Same as prior batches |
| `client/src/lib/api.ts` | Stays |

No new primitives invented.

## 4. Current structure

`OnboardingWizardPage.tsx` (836 LOC):
- Interfaces at top (OnboardingStatus, GhlLocation, SyncAccountStatus, SyncStatus, etc.).
- `StepBar` (50-83) — step progress indicator.
- `Step1Connect` (84-116, ~33 LOC).
- `Step2Locations` (117-292, ~175 LOC).
- `Step3Sync` (293-453, ~160 LOC).
- `ArtefactStatusDot` (467-482) — atom used by Step4Baseline.
- `Step4Baseline` (483-676, ~195 LOC).
- Main page `OnboardingWizardPage` (677-836, ~160 LOC).

## 5. Target structure

```
client/src/pages/OnboardingWizardPage.tsx                  ← host (~180 LOC target — close to today already)
client/src/components/onboarding-wizard/
  ├─ types.ts                                              ← OnboardingStatus, GhlLocation, SyncAccountStatus, SyncStatus, SubaccountRow, SubaccountBaselineState
  ├─ StepBar.tsx                                            ← step progress indicator
  ├─ Step1Connect.tsx                                       ← extracted, was inline
  ├─ Step2Locations.tsx                                     ← extracted, was inline
  ├─ Step3Sync.tsx                                          ← extracted, was inline
  ├─ Step4Baseline.tsx                                      ← extracted, was inline (uses ArtefactStatusDot internally)
  └─ atoms/
      └─ ArtefactStatusDot.tsx                              ← small status-dot atom
```

`App.tsx` import unchanged.

## 6. Prop contracts (lifted verbatim from current inline declarations)

### 6.1 `<StepBar>`
`{ current: number }`

### 6.2 `<Step1Connect>`
`{ onConnected: () => void }`

### 6.3 `<Step2Locations>`
Move verbatim — current inline signature retained.

### 6.4 `<Step3Sync>`
`{ onComplete: () => void; totalAccounts: number }`

### 6.5 `<Step4Baseline>`
`{ onComplete: () => void }`

### 6.6 `<ArtefactStatusDot>`
`{ status: string }`

## 7. Migration plan

### Chunk 1 — `types.ts` + `StepBar` + `ArtefactStatusDot`
- Move shared interfaces to `types.ts`.
- Extract `StepBar` and `ArtefactStatusDot` (the atoms).

### Chunk 2 — Step1Connect + Step2Locations
- Move both to dedicated files.

### Chunk 3 — Step3Sync + Step4Baseline
- Move both to dedicated files.

### Chunk 4 — Verify + cleanup
- Run lint, typecheck, build:client.
- Confirm host ≤ 200 LOC.
- Sweep unused imports.

## 8. Deferred Items

- Shared `<Wizard>` primitive — single consumer today; defer.

## 9. Self-consistency

- Step progression behaviour preserved.
- `?step=` URL param (if present) preserved.

## 10. Acceptance criteria

- Host shrinks to ≤ 200 LOC.
- 7 new files under `client/src/components/onboarding-wizard/`.
- All G1 gates green.

## 11. Open questions

- None. Pattern established.
