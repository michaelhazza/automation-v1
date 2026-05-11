# Spec Review — Iteration 2 — sandbox-isolation

- Spec: `tasks/builds/sandbox-isolation/spec.md`
- Spec commit at iteration start: `dd80dc56`
- Codex verdict: NEEDS_REVISION, 12 findings
- Rubric pass: no additional novel findings

## Findings

| # | Topic | Section | Classification | Severity | Status |
|---|---|---|---|---|---|
| F2.1 | harvest_failed / artefact_upload_failed reconciliation → completed contradicts terminal-absorbing rule | §13.1, §24.5 | mechanical | important | applied |
| F2.2 | Phase-scoped minimum-events still impossible for mid-execution provider_unavailable / harvest_failed | §14.5 | mechanical | important | applied |
| F2.3 | provider_unavailable as transient diagnostic conflicts with "one terminal event" rule | §16.6, §14.2, §24.4 | mechanical | important | applied (split into provider_diagnostic + provider_unavailable terminal) |
| F2.4 | credentialBrokerService "surface unchanged" claim contradicts §11.3 return-shape extension | §11.3, §19.5 | mechanical | important | applied (move to §19.3 modified files with explicit extension scope) |
| F2.5 | artefact_already_uploaded event not in closed enum | §24.3, §14.2 | mechanical | important | applied (collapse to artefact_uploaded with was_idempotent payload flag) |
| F2.6 | sandboxCeilingMonitorJob depends on C8 + C9/C10 not just C7 | §23 chunk table | mechanical | important | applied (added C8 + C9 to C11) |
| F2.7 | classifyExecutionClass owned by both sandboxExecutionServicePure.ts and ieeDevBackendPure.ts | §18.2, §19.1, §23, §25.1 | mechanical | important | applied (canonical owner ieeDevBackendPure.ts; struck from sandboxExecutionServicePure.ts) |
| F2.8 | Egress audit lacks concrete interception mechanism | §9.1, §14.2, §20.6 | ambiguous → directional / AUTO-DECIDED | important | deferred to §27 + tasks/todo.md (SANDBOX-DEF-EGRESS-MECH) |
| F2.9 | Log persistence on (sandbox_execution_id, log_stream, sequence) but no sink/schema named | §8.4 step 9, §17.1, §19 | ambiguous → AUTO-DECIDED | important | tightened claim in spec; schema choice deferred (SANDBOX-DEF-LOG-SCHEMA) |
| F2.10 | Migration dry-run script not in §19 inventory | §23 C14, §19 | mechanical | minor | applied (added scripts/migrations/sandbox-isolation-classification-dry-run.ts) |
| F2.11 | §6 manifest row omits sandbox_artefacts | §6 manifest row | mechanical | minor | applied |
| F2.12 | Reconciliation cadence claimed "pinned in §22" but never pinned | §8.4, §22 | mechanical | minor | applied (pinned to 5 minutes) |

## Counts

- Mechanical accepted: 10
- Mechanical rejected: 0
- Directional / Ambiguous: 2 (F2.8, F2.9)
- Reclassified → directional: 1 (F2.9 — log persistence schema is structural, not mechanical)
- Autonomous decisions: 2
  - AUTO-REJECT (framing): 0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED: 2 (F2.8, F2.9 — both routed to tasks/todo.md as SANDBOX-DEF-* entries; spec tightened to acknowledge build-time decisions)

## Iteration 2 Summary

- Mechanical findings accepted: 10
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 2 (F2.8 egress mechanism, F2.9 log schema)
- Reclassified → directional: 1 (F2.9 reclassified from mechanical)
- Autonomous decisions: 2
  - AUTO-REJECT (framing): 0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED: 2 (both routed to tasks/todo.md as `SANDBOX-DEF-EGRESS-MECH` + `SANDBOX-DEF-LOG-SCHEMA`)

Files modified: `tasks/builds/sandbox-isolation/spec.md`, `tasks/todo.md`.

Spec commit after iteration: (will be filled in after Step 8b).
