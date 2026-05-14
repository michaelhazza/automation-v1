# Spec Conformance Log

**Spec:** `tasks/builds/system-monitoring-agent-fixes/spec.md`
**Spec commit at check:** `bc9f7e5e` (latest commit on `system-monitoring-agent-fixes`)
**Branch:** `system-monitoring-agent-fixes`
**Base:** `58cf0316` (merge-base with `main`)
**Scope:** ALL — caller confirmed all four chunks (1 — triage durability, 2 — silentAgentSuccess, 3 — incidentSilence, 4 — failed-triage filter pill) implemented.
**Changed-code set:** 17 files (10 modified + new staged in working tree, 12 untracked new files including 2 migrations + 6 source/test files + plan)
**Run at:** 2026-04-27T11:41:03Z
**Commit at finish:** `31b761e8`

---

## Summary

- Requirements extracted:     29
- PASS:                       28
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 1
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

> Plus one separately-tracked spec defect (Note A) routed to `tasks/todo.md` — the implementation faithfully follows the spec, but the spec's §9.1 SQL references a non-existent column. This is not a NON_CONFORMANT verdict (the implementation conforms) but it is operationally important enough to surface.

**Verdict:** CONFORMANT (1 directional docs cross-reference deferred for post-merge; 1 spec defect surfaced for spec-reviewer attention)

---

## Requirements extracted (full checklist)

| # | Spec ref | Requirement (one line) | Verdict |
|---|---|---|---|
| 1 | §3.1, §5.1 | `migrations/0238_system_incidents_last_triage_job_id.sql` adds `last_triage_job_id text` | PASS |
| 2 | §3.1, §5.1 | Down migration drops the column | PASS |
| 3 | §3.2, §5.2 | `lastTriageJobId: text('last_triage_job_id')` adjacent to `lastTriageAttemptAt` | PASS |
| 4 | §3.1, §7.1 | `triageIdempotencyPure.ts` exports `shouldIncrementAttemptCount(currentJobId, candidateJobId)` | PASS |
| 5 | §3.1, §12.1 | `triageIdempotencyPure.test.ts` covers same/different/null-current cases | PASS |
| 6 | §3.1, §7.2 | `staleTriageSweep.ts` exports `findStaleTriageRowsSql` + `runStaleTriageSweep` + `parseStaleAfterMinutesEnv`; honours kill-switch env; UPDATE+events INSERT atomic; emits `agent_triage_timed_out` per §4.3; counter unchanged | PASS |
| 7 | §3.1, §12.1 | `staleTriageSweepPure.test.ts` covers env edge cases + cutoff boundary | PASS |
| 8 | §3.1, §7.3, §12.1 | `triageDurability.integration.test.ts` exercises 5-step coordination | PASS |
| 9 | §3.2, §7.1 | `systemMonitorTriageJob.ts` job shape `{ id; data: { incidentId } }`; passes `job.id` | PASS |
| 10 | §3.2, §7.1 | `runTriage(incidentId: string, jobId: string): Promise<TriageResult>` | PASS |
| 11 | §4.2, §7.1 | Increment-site UPDATE uses `WHERE id = $incidentId AND last_triage_job_id IS DISTINCT FROM $jobId`; sets all required columns; RETURNING | PASS |
| 12 | §7.1, §11.0 | 0-row branch logs `triage.idempotent_skip` and early-returns `{ status: 'skipped', reason: 'duplicate_job' }` before LLM tool loop | PASS |
| 13 | §11.0, §11.3 | Success-path UPDATE adds `WHERE triage_status='running'`, gates emission on row count == 1 | PASS |
| 14 | §11.0, §11.3 | Failure-path UPDATE adds `WHERE triage_status='running'`, gates `agent_triage_failed` event on row count == 1 | PASS |
| 15 | §3.2, §7.2 | `runStaleTriageSweep(now)` called inside its own try/catch BEFORE the synthetic-checks loop in `syntheticChecksTickHandler.ts` | PASS |
| 16 | §4.3 (plan inventory drift) | `'agent_triage_timed_out'` appended to `shared/types/systemIncidentEvent.ts` | PASS |
| 17 | §4.3 (plan inventory drift) | `'agent_triage_timed_out'` appended to `server/db/schema/systemIncidentEvents.ts` | PASS |
| 18 | §3.1, §8.1, §8.2, §8.3, §4.4 | `silentAgentSuccess.ts` exports `SyntheticCheck` + `isSilentAgentRatioElevated`; SQL §8.1 verbatim; first-fire-wins; result shape §4.4 | PASS |
| 19 | §3.1, §8.2, §12.1 | `silentAgentSuccessPure.test.ts` covers 5 boundary cases | PASS |
| 20 | §3.2 | `silentAgentSuccess` registered in `SYNTHETIC_CHECKS` | PASS |
| 21 | §3.1, §9.1, §9.2, §9.4–9.6, §4.5 | `incidentSilence.ts` exports `SyntheticCheck` + `isMonitoringSilent`; SQL §9.1 with BOTH dual exclusions verbatim; result shape §4.5 | PASS (with spec-defect Note A) |
| 22 | §3.1, §9.2, §12.1 | `incidentSilencePure.test.ts` covers 5 boundary cases | PASS |
| 23 | §3.2 | `incidentSilence` registered in `SYNTHETIC_CHECKS` | PASS |
| 24 | §3.2, §10.1 | Zod enum on `listIncidentsQuery.diagnosis` includes `'failed-triage'` | PASS |
| 25 | §3.2, §10.1 | `IncidentListFilters.diagnosis` union extended | PASS |
| 26 | §3.2, §4.6, §10.1 | `failed-triage` arm with predicate `triageStatus='failed' AND diagnosisStatus IN ('none','partial','invalid')` | PASS |
| 27 | §3.2, §10.1 | `DiagnosisFilter` UI union extended | PASS |
| 28 | §3.2, §4.6, §10.1 | `PILL_OPTIONS` array entry `{ value: 'failed-triage', label: 'Failed triage' }` in correct order | PASS |
| 29 | §14.5 A5.1, §14.6 | `tasks/post-merge-system-monitor.md` Tier-1 items checked off with cross-reference | DIRECTIONAL_GAP → deferred |

---

## Mechanical fixes applied

None. All 28 implementation REQs PASS as authored. No code modified by this run.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

Section: `## Deferred from spec-conformance review — system-monitoring-agent-fixes (2026-04-27)`

- REQ #29 — Tier-1 items in `tasks/post-merge-system-monitor.md` not yet checked off with cross-reference to this spec. Docs-only; suggested to land in or immediately after the merge commit so the cross-reference can name the actual PR/commit.
- (Separately) Note A — Spec defect: §9.1 SQL references non-existent `system_incidents.metadata` column. Implementation copies the spec verbatim and is therefore spec-conformant; the SQL would fail at runtime once the synthetic-checks tick runs `incidentSilence` against a live DB. Routed for `spec-reviewer` / `chatgpt-spec-review` attention.

---

## Files modified by this run

None. Verification-only — no code or spec changes applied.

---

## Next step

CONFORMANT — implementation matches the spec on all 28 implementation REQs.

- The single deferred docs cross-reference (REQ #29) is post-merge friendly and does not block `pr-reviewer`. Leave it as a `- [ ]` in `tasks/todo.md` until the merge happens.
- The spec-defect note (Note A) does block real-world correctness of the `incidentSilence` synthetic check. It does **not** affect this conformance verdict (the implementation follows the spec) but it should be addressed before the next deploy that runs the synthetic-checks tick. Recommended: open a follow-up `spec-reviewer` round on `tasks/builds/system-monitoring-agent-fixes/spec.md` §9.1 to swap `si.metadata->>'checkId'` → `si.latest_error_detail->>'checkId'` in both exclusions, then mirror the change in `incidentSilence.ts`. The spec is the source of truth; do NOT edit the implementation file alone.
- Proceed to `pr-reviewer` (full code review) — no re-run of `spec-conformance` needed since no code was modified.
