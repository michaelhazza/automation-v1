# Dual Review Log — system-monitoring-coverage

**Files reviewed:** `claude/add-monitoring-logging-3xMKQ` branch vs `main` (system monitoring coverage build — G1, G2, G3, G4-A, G4-B, G5, G7, G11)
**Iterations run:** 2/3
**Timestamp:** 2026-04-28T21:44:59Z

---

## Iteration 1

Codex command: `codex review --base main`. Run produced three findings.

### [ACCEPT] server/jobs/skillAnalyzerJobWithIncidentEmission.ts:24-33 — Wrapper records incident on every throw, not only terminal attempts (P1)

**Codex framing:** "When `processSkillAnalyzerJob` throws on its first attempt, this wrapper records `skill_analyzer:terminal_failure` immediately and then rethrows, even though `skill-analyzer` is configured with `retryLimit: 1` and pg-boss will retry once more. That means transient failures now create a high-severity incident before the final attempt has even run, which is the opposite of the 'terminal failure' contract described in `server/index.ts` and will generate noisy false positives whenever the retry succeeds."

**Reason accepted:** Real false-positive bug. The fingerprint name (`skill_analyzer:terminal_failure`), the variable contract, AND the inline comment in `server/index.ts:491-495` ("FINAL retry attempt") all explicitly specify terminal-only emission. With `retryLimit: 1`, pg-boss runs the job up to twice; the current code emits a high-severity incident on the FIRST failure regardless of whether the retry succeeds. This violates the spec intent (G11 §1.1: "Skill-analyzer terminal failures emit recordIncident", spec title) — the spec body's "on any throw" wording was an oversight contradicting every other terminal-only signal in the codebase. Severity is `'high'` so each false positive pages operators.

**Fix applied:**
- `server/jobs/skillAnalyzerJobWithIncidentEmission.ts` — added `retryCount` parameter; only fire `recordIncident` when `retryCount >= retryLimit` (looked up via `getJobConfig('skill-analyzer').retryLimit`). Added `retryCount` to `errorDetail` for diagnostic context.
- `server/index.ts` — caller now reads `getRetryCount(job)` from `lib/jobErrors.ts` and passes it through.
- `server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts` — updated existing tests to pass `retryCount: 1` (terminal); added a new test asserting `retryCount: 0` (non-terminal) re-throws but does NOT emit a row.

### [ACCEPT] server/services/incidentIngestor.ts:121-126 — `boss.send('system-monitor-ingest', ...)` does not pass JOB_CONFIG (P1)

**Codex framing:** "In async ingest mode, incidents are sent to `system-monitor-ingest` without `getJobConfig('system-monitor-ingest')`, so pg-boss uses its defaults instead of the new `JOB_CONFIG` entry. As a result the queue will not get the intended retry / expiry / `system-monitor-ingest__dlq` behaviour, which means the main fix for G3 is only partially wired and async-mode failures will not be monitored the way this patch expects."

**Reason accepted:** Real bug. Spec §3.3 defines a `system-monitor-ingest` JOB_CONFIG entry with `retryLimit: 3`, `retryDelay: 10`, `retryBackoff: true`, `expireInSeconds: 60`, `deadLetter: 'system-monitor-ingest__dlq'`, but the enqueue site doesn't apply it. Every other production `boss.send` call site that has a JOB_CONFIG entry passes `getJobConfig(name)` as the third argument (verified: `agentScheduleService.ts`, `pageIntegrationWorker.ts`, `queueService.ts`, `routerJobService.ts`, `skillAnalyzerService.ts`, `ieeExecutionService.ts`). Without it, pg-boss uses defaults — async-mode failures never route to `system-monitor-ingest__dlq`, so the G3 wiring is dead config and the loop-hazard scenario the spec §3.4 invariant guards against has no actual DLQ to land in.

**Fix applied:**
- `server/services/incidentIngestor.ts` — added `import { getJobConfig } from '../config/jobConfig.js'`; `enqueueIngest` now passes `getJobConfig('system-monitor-ingest')` as the third arg to `boss.send`.

### [ACCEPT] server/services/dlqMonitorService.ts:43-51 + incidentIngestor.ts:99-108 — `forceSync: true` routes DLQ events through the throttle (P2)

**Codex framing:** "`forceSync: true` fixes the self-referential queue loop, but it also routes DLQ incidents through the sync throttle path. In `SYSTEM_INCIDENT_INGEST_MODE=async`, if several jobs from the same queue hit the DLQ within the 1s throttle window, `checkThrottle` will drop the later calls entirely instead of incrementing the existing incident's `occurrenceCount`. That makes bursty DLQ failures look much smaller than they are and can suppress the very signal this monitor is meant to surface."

**Reason accepted:** Real but secondary issue. The spec §3.4 introduced `forceSync` for loop-hazard avoidance only, with no consideration of throttle interaction. The throttle (1000ms window) was designed for logger-spam protection — pre-rate-limited DLQ events from pg-boss are signal, not spam. The current behaviour means bursty DLQ deliveries (multiple jobs from the same queue terminally failing within 1s) drop occurrenceCount increments, undercounting the very signal the DLQ monitor exists to surface. The only call site with `forceSync: true` is `dlqMonitorService` (verified by grep), so extending the semantics is safe.

**Fix applied:**
- `server/services/incidentIngestor.ts` — `recordIncident` now bypasses `checkThrottle` when `opts?.forceSync === true`. Comment block added explaining why DLQ events should NOT be throttled (pg-boss provides delivery rate-limit; events are signal not spam; throttle dropping increments would flatten burst signal). Default behaviour for `forceSync !== true` callers is unchanged.

### Iteration 1 verification

- `npx tsc --noEmit` — passes (0 errors).
- `bash scripts/run-all-unit-tests.sh` — 275 passed, 0 failed, 0 skipped.

## Iteration 2

Codex command: `codex review --uncommitted`. Run produced no actionable findings.

Codex final statement: "The code changes appear internally consistent: the skill-analyzer worker now only emits incidents on terminal retries, async incident ingest now passes the declared pg-boss config, and the forceSync throttle bypass matches the documented DLQ-monitoring intent. I did not find a discrete, actionable regression in the modified runtime paths."

Loop exits — no new findings.

---

## Changes Made

- `server/jobs/skillAnalyzerJobWithIncidentEmission.ts` — added `retryCount` param; only emit `recordIncident` when `retryCount >= retryLimit`; doc-block expanded; added `getJobConfig` import.
- `server/index.ts` — skill-analyzer worker reads `getRetryCount(job)` from `lib/jobErrors.ts` and threads it into the wrapper; caller comment updated.
- `server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts` — updated existing tests to pass terminal `retryCount: 1`; added new test asserting non-terminal `retryCount: 0` rethrows without emitting; dedup test updated to `retryCount: 1`.
- `server/services/incidentIngestor.ts` — added `getJobConfig` import; `enqueueIngest` now passes `getJobConfig('system-monitor-ingest')` to `boss.send`; `recordIncident` skips `checkThrottle` when `forceSync === true`; comment block added explaining DLQ throttle-bypass rationale.

## Rejected Recommendations

None — all three Codex findings were accepted and fixed.

---

**Verdict:** APPROVED — all 3 Codex findings (2× P1, 1× P2) accepted and fixed; iteration 2 produced no new findings. PR ready, all critical and important issues resolved.

**Commit at finish:** e039a4432940c8a35616f560f21580dcc0f67f94
