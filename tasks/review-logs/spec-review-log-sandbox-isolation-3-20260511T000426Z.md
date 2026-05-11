# Spec Review — Iteration 3 — sandbox-isolation

- Spec: `tasks/builds/sandbox-isolation/spec.md`
- Spec commit at iteration start: `b25d80e2`
- Codex verdict: NEEDS_REVISION, 9 findings
- Rubric pass: no additional novel findings

## Findings

| # | Topic | Section | Classification | Severity | Status |
|---|---|---|---|---|---|
| F3.1 | `sandbox.start.slow` overlap with `provider_diagnostic` | §16.4 | mechanical | important | applied |
| F3.2 | `harvest_step_reached` (snake) vs `harvestStepReached` (camel) casing | §14.2, §14.5, §25.2 | mechanical | important | applied (normalize to camelCase) |
| F3.3 | `provider_unavailable` pairing note breaks pre-start path | §14.2 | mechanical | important | applied |
| F3.4 | Reconciliation-recovery exception conflicts with "exactly one terminal event" | §24.4 | mechanical | important | applied (define canonical-vs-recovery split) |
| F3.5 | `sandbox_harvest_failed_permanent` not in FailureReason | §13.4, §20.8 | mechanical | important | applied (state reuse of sandbox_harvest_failed with `permanent: true` detail) |
| F3.6 | Graph missing C10 → C11 edge | §23.1 | mechanical | important | applied |
| F3.7 | §29.2 claims RLS-enforced green but log sink deferred | §29.2 | mechanical | critical | applied (tighten §29.2 claim) |
| F3.8 | §29.7 + §19 inventory-lock claim weakened by log deferral | §19, §29.7 | mechanical | important | applied (tighten §29.7 claims) |
| F3.9 | §12.2 enum extension misses sandbox_compute_correction | §12.2 | mechanical | minor | applied |

## Counts

- Mechanical accepted: 9
- Mechanical rejected: 0
- Directional / Ambiguous: 0
- Reclassified: 0
- Autonomous decisions: 0

## Result

## Iteration 3 Summary

- Mechanical findings accepted: 9
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions: 0

Files modified: `tasks/builds/sandbox-isolation/spec.md` only.

Spec commit after iteration: (will be filled in after Step 8b).
