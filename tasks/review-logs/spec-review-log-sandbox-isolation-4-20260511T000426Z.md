# Spec Review — Iteration 4 — sandbox-isolation

- Spec: `tasks/builds/sandbox-isolation/spec.md`
- Spec commit at iteration start: `8a627775`
- Codex verdict: NEEDS_REVISION, 4 findings
- Rubric pass: no additional novel findings

## Findings

| # | Topic | Section | Classification | Severity | Status |
|---|---|---|---|---|---|
| F4.1 | sandbox_compute_correction lacks correction_sequence column in inventory | §12.2, §12.3, §19.3, §24.1 | mechanical | important | applied |
| F4.2 | provider_unavailable terminal event contract conflicts with §24.4 post-terminal prohibition | §14.2, §24.4 | mechanical | important | applied (clarify provider_unavailable is pre-canonical-terminal, paired with the canonical event) |
| F4.3 | §24.5 still references sandbox_harvest_failed_permanent as a typed failure | §24.5 | mechanical | minor | applied |
| F4.4 | SANDBOX-DEF-LOG-SCHEMA deferred to C7 but new-table option requires C1 schema work | §27, §23 | mechanical | important | applied (split deferral by option: existing-layer path → C7; new-table path → C1; conditional dependency) |

## Counts

- Mechanical accepted: 4
- Mechanical rejected: 0
- Directional / Ambiguous: 0
- Reclassified: 0
- Autonomous decisions: 0

## Iteration 4 Summary

- Mechanical findings accepted: 4
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions: 0

Files modified: `tasks/builds/sandbox-isolation/spec.md`, `tasks/todo.md` (SANDBOX-DEF-LOG-SCHEMA wording tightened to mark it as the chunk-zero gating decision).

Spec commit after iteration: `733fc650`.
