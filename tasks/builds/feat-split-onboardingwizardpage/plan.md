# Plan — feat-split-onboardingwizardpage

**Spec:** `tasks/builds/feat-split-onboardingwizardpage/spec.md`.
**Source:** `client/src/pages/OnboardingWizardPage.tsx` (836 LOC).
**Target host LOC:** ≤ 200.

Chunks:
1. `types.ts` + `StepBar.tsx` + `atoms/ArtefactStatusDot.tsx`.
2. Step1Connect + Step2Locations.
3. Step3Sync + Step4Baseline.
4. Verify + cleanup.

Notes:
- Each step is already a self-contained inline function; the move is mechanical.
- All prop contracts lifted verbatim from current inline declarations.
- No `.js` suffixes on relative imports.
