# Spec Review — Iteration 1 — sandbox-isolation

- Spec: `tasks/builds/sandbox-isolation/spec.md`
- Spec commit at start: `45122837`
- Codex tokens: 215,401, verdict NEEDS_REVISION, 13 findings
- Rubric pass: F7 confirmed (file-inventory drift), no additional novel findings

## Findings

All 13 Codex findings classified MECHANICAL (contradiction / stale language / inventory drift / unnamed primitive / missing verdict / sequencing-bug). Applied inline.

| # | Topic | Section | Severity | Disposition | Status |
|---|---|---|---|---|---|
| F1 | Header summary pipeline order is stale | line 17 | minor | rewrite header | applied |
| F2 | Provider resolver hard guard blocks local_docker | §8.2 | important | rewrite resolver text | applied |
| F3 | log_overflow / artefact_oversized not in closed 8-state taxonomy | §8.3, §8.4, §13.1 | critical | fold as sub-codes into output_validation_failed / artefact_upload_failed | applied |
| F4 | running → terminal direct transitions contradict §8.4 step 12 | §13.1, §8.4 | important | route via harvesting | applied |
| F5 | Minimum-events guarantee impossible for pre-start failures | §14.5 | important | scope by phase | applied |
| F6 | Visibility for artefact_upload_failed contradictory | §13.4 vs §24.5 | important | align on §13.4 (internal-during-reconcile) | applied |
| F7 | sandbox-harvest queue referenced but not in inventory; §22 says harvest is inline | §6, §8.4 | important | strike "queue" language | applied |
| F8 | sandboxTelemetryWriter named but not in §19 inventory | §24.2 | minor | rewrite to point at inventoried writer | applied |
| F9 | Telemetry summary rows on sandbox_executions not contracted | §17.3 | important | strike summary aggregation; row is already the summary | applied |
| F10 | Credential audit events lack named sink | §11.2, §11.4 | important | bind to credentialBrokerService + sandbox_telemetry_events | applied |
| F11 | C13 missing C12 dependency | §23 | important | add edge | applied |
| F12 | Cost-ceiling open question weakens brief invariant | §10.2, §28#4 | critical | lock §28#4 to match §10.2 two-layer model | applied |
| F13 | §28 open questions unresolved while §29.7 marks ready | §28, §29.7 | important | lock each open question to its recommended V1 path | applied |

## Counts

- Mechanical accepted: 13
- Mechanical rejected: 0
- Directional / Ambiguous: 0
- Reclassified: 0

## Iteration 1 Summary

- Mechanical findings accepted: 13
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions: 0
  - AUTO-REJECT (framing): 0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED: 0

All findings were mechanical (contradictions, stale language, inventory drift, missing-mechanism, missing-verdict). All applied inline; spec is now self-consistent against the brief's §6 invariants and the rubric.

Files modified: `tasks/builds/sandbox-isolation/spec.md` only.

Spec commit after iteration: (will be filled in after auto-commit Step 8b).

