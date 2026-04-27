# System Monitor — Tier-1 Hardening Plan

> Source spec: [`spec.md`](./spec.md). The spec is the single source of truth — this plan translates it into chunks for `superpowers:subagent-driven-development`. Where this plan references "see spec §X", read the spec verbatim — code/SQL is NOT paraphrased here.
>
> Branch: `system-monitoring-agent-fixes` (already up-to-date with main HEAD `58cf0316`, the PR #215 merge commit; spec finalised through 3 ChatGPT spec-review rounds).
>
> Slug: `system-monitoring-agent-fixes`. Working dir: `tasks/builds/system-monitoring-agent-fixes/`.

---

## Table of contents

1. Executor notes
2. Phase 0 — Baseline & pre-existing violation triage
3. Inventory drift
4. Chunk 1 — Triage durability (G1 + G2 bundled)
5. Chunk 2 — Synthetic check: silent agent success (G3)
6. Chunk 3 — Synthetic check: incident silence (G4)
7. Chunk 4 — Failed-triage filter pill (G5)
8. Chunk dependency graph
9. Risks & mitigations
10. Programme-end verification
11. Spec-conformance log convention
12. Definition of done

---

## 1. Executor notes (read before starting)

- **Spec is normative.** Inventory in spec §3 is locked — do NOT add files / columns / migrations beyond it without a spec amendment. Two known inventory-drift items are called out in [Inventory drift](#3-inventory-drift) below; add only those, not others.
- **No feature flags. No staged rollout. No backwards-compat shims.** Per spec §6 ("Implementation philosophy"), this is pre-production hardening — direct cut-over.
- **Phase ordering is hard-locked.** Chunk 1 bundles G1+G2 per spec §1 / §7 ("they MUST land together"). Chunks 2/3/4 are independent of each other but all depend on chunk 1 having committed migration 0239 to the branch (so the branch's migration numbering stays monotonic and chunks 2/3/4 never bring up the schema without `last_triage_job_id`).
- **§11.0 single-writer terminal-event invariant is load-bearing.** Chunk 1 must retrofit BOTH the triage-attempt increment site (step 5) AND the tool-loop success/failure terminal sites (step 8) of [`triageHandler.ts`](../../../server/services/systemMonitor/triage/triageHandler.ts) with `WHERE triage_status = 'running'` + row-count gate. The integration test in spec §7.3 exercises the race resolution.
- **Gate scripts run TWICE TOTAL per this plan: once during Phase 0 baseline (and any pre-existing-violation fixes) and once during Programme-end verification after all chunks AND spec-conformance. Running them between chunks, after individual fixes, or as 'regression sanity checks' is forbidden — it adds wall-clock cost without adding signal.**
- After all four chunks land, run `spec-conformance` BEFORE the final gate pass per CLAUDE.md review pipeline.

---

## 2. Phase 0 — Baseline & pre-existing violation triage

Run once at the start. Do NOT re-run between chunks.

### Phase 0 commands

```bash
npx tsc --noEmit                              # capture current type baseline
bash scripts/run-all-unit-tests.sh            # capture current pure-test baseline
bash scripts/verify-event-type-registry.sh    # registry baseline (chunk 1 will add a literal)
bash scripts/verify-job-idempotency-keys.sh   # idempotency baseline (no new queues this spec)
bash scripts/verify-rls-coverage.sh           # RLS baseline (no new RLS tables this spec)
bash scripts/verify-heuristic-purity.sh       # heuristic baseline (no heuristics touched)
npm run db:generate                           # diff baseline (must be clean before chunk 1)
```

### Triage rule

- Any pre-existing violation that **interacts with chunk-1 surface** (`triageHandler.ts`, `systemIncidents` schema, `systemIncidentEvents` schema, `systemIncidentEvent` shared registry, synthetic-checks tick handler) → fix as a Pre-Phase-1 fix in this same baseline phase, then continue. Do NOT defer.
- Any pre-existing violation outside chunk-1/2/3/4 surface → record below as known baseline violation, ignore for the rest of this plan.

### Known baseline violations (record here after Phase 0 run)

> Populate during execution. If empty, write "None at branch HEAD."

---

## 3. Inventory drift

The spec §3.2 file inventory does not list two registry files that MUST be updated for chunk 1's new `agent_triage_timed_out` event-type literal. They are mechanical cascades of spec §4.3 (the new event-type contract) and are gated by `verify-event-type-registry.sh`:

| File | Change | Gated by |
|---|---|---|
| [`shared/types/systemIncidentEvent.ts`](../../../shared/types/systemIncidentEvent.ts) | Append `\| 'agent_triage_timed_out'` to the canonical `SystemIncidentEventType` union | `verify-event-type-registry.sh` |
| [`server/db/schema/systemIncidentEvents.ts`](../../../server/db/schema/systemIncidentEvents.ts) | Append the same literal to the runtime-table union (kept in sync per the file header note) | type compile gate |

Add both in chunk 1 alongside the spec §3.2-listed changes. No spec amendment needed — the literal is named in spec §4.3 and §11.3; only the registry-file row is missing from the §3.2 table.

---

## 4. Chunk 1 — Triage durability (G1 + G2 bundled)

**Slug:** `chunk-1-triage-durability` (use as `<chunk-slug>` in `spec-conformance` log filenames).

**Scope:** Phase 1 of the spec — retry idempotency (G1) + staleness sweep (G2) + integration test that exercises both together (spec §7.3). Bundled per spec §1 and §7 ("Why bundled"): implementing one without the other regresses the rate-limit gate and either double-counts attempts or leaves rows stuck forever.

**Dependencies:** None external. First chunk on this plan.

**Acceptance IDs satisfied:** A1.1 – A1.7 (spec §14.1).

### 4.1 Files to create (spec §3.1)

| File | Purpose | Spec ref |
|---|---|---|
| `migrations/0239_system_incidents_last_triage_job_id.sql` | UP migration | §5.1 |
| `migrations/0239_system_incidents_last_triage_job_id.down.sql` | DOWN migration | §5.1 |
| `server/services/systemMonitor/triage/triageIdempotencyPure.ts` | `shouldIncrementAttemptCount` pure helper | §3.1, §7.1 step 3 |
| `server/services/systemMonitor/triage/__tests__/triageIdempotencyPure.test.ts` | Pure-helper test of `(currentJobId, candidateJobId)` boundary | §12.1, §14 A1.2 |
| `server/services/systemMonitor/triage/staleTriageSweep.ts` | Pure SQL builder (`findStaleTriageRowsSql`) + IO entrypoint (`runStaleTriageSweep`) + env parser (`parseStaleAfterMinutesEnv`) | §3.1, §7.2 step 1 |
| `server/services/systemMonitor/triage/__tests__/staleTriageSweepPure.test.ts` | Pure-helper test: cutoff calc + `parseStaleAfterMinutesEnv` (NaN / `''` / `'abc'` / `'0'` / `'-5'` / valid) | §12.1, §14 A1.3 |
| `server/services/systemMonitor/triage/__tests__/triageDurability.integration.test.ts` | Real-DB G1+G2 coordination test — see spec §7.3 for the 5-step scenario | §12.1, §14 A1.4 |

### 4.2 Files to modify (spec §3.2 + inventory drift)

| File | Change | Spec ref |
|---|---|---|
| [`server/db/schema/systemIncidents.ts`](../../../server/db/schema/systemIncidents.ts) | Add `lastTriageJobId: text('last_triage_job_id')` adjacent to `lastTriageAttemptAt` (currently line 81) per the column-grouping convention | §3.2, §5.2 |
| [`shared/types/systemIncidentEvent.ts`](../../../shared/types/systemIncidentEvent.ts) | Append `\| 'agent_triage_timed_out'` to canonical registry | Inventory drift; §4.3 |
| [`server/db/schema/systemIncidentEvents.ts`](../../../server/db/schema/systemIncidentEvents.ts) | Append `\| 'agent_triage_timed_out'` to the runtime-column union (mirror of canonical) | Inventory drift; §4.3 |
| [`server/jobs/systemMonitorTriageJob.ts`](../../../server/jobs/systemMonitorTriageJob.ts) | (a) Update job-shape param type to `{ id: string; data: { incidentId: string } }`. (b) Pass `job.id` into `runTriage(incidentId, job.id)`. | §3.2, §7.1 step 4 |
| [`server/services/systemMonitor/triage/triageHandler.ts`](../../../server/services/systemMonitor/triage/triageHandler.ts) | (a) Signature: `runTriage(incidentId: string, jobId: string): Promise<TriageResult>`. (b) Replace unconditional UPDATE at lines 269-277 with predicated UPDATE per spec §4.2 (returning row). (c) On 0 rows: structured info-log `triage.idempotent_skip` `{ incidentId, jobId, reason: 'duplicate_job' }` + early-return `{ status: 'skipped', reason: 'duplicate_job' }` BEFORE step 6 (do NOT enter the LLM tool loop). (d) **§11.0 retrofit** — modify step 8 success path (lines 299-303): UPDATE adds `WHERE triageStatus='running'`, captures returning row count, only logs `triage_completed` if 1 row returned. (e) **§11.0 retrofit** — modify step 8 failure path (lines 309-312): UPDATE adds `WHERE triageStatus='running'`, captures returning row count, only emits `agent_triage_failed` event if 1 row returned. | §3.2, §4.2, §7.1 steps 3+5, §11.0, §11.3 |
| [`server/services/systemMonitor/synthetic/syntheticChecksTickHandler.ts`](../../../server/services/systemMonitor/synthetic/syntheticChecksTickHandler.ts) | Call `runStaleTriageSweep(now)` before the `for (const check of SYNTHETIC_CHECKS)` loop, wrapped in its own try/catch so a sweep error never short-circuits synthetic checks. | §3.2, §7.2 step 2 |

### 4.3 Order of edits (translate verbatim from spec §7.1 + §7.2)

1. **Migration + drizzle sync.** Author `0239_*.sql` + `0239_*.down.sql` per spec §5.1 (verbatim — do not paraphrase the SQL). Add `lastTriageJobId` to `server/db/schema/systemIncidents.ts` per spec §5.2. Run `npm run db:generate` and verify the diff matches §5.1 with no other drift.
2. **Event-type registry extensions.** Append `'agent_triage_timed_out'` to BOTH `shared/types/systemIncidentEvent.ts` and `server/db/schema/systemIncidentEvents.ts` (see [Inventory drift](#3-inventory-drift)).
3. **Pure helper.** Create `triageIdempotencyPure.ts` per spec §7.1 step 3 (verbatim function body).
4. **Pure helper test.** Create `__tests__/triageIdempotencyPure.test.ts` covering: same `jobId` → false; different `jobId` → true; null current + non-null candidate → true.
5. **Job-shape change.** Edit `server/jobs/systemMonitorTriageJob.ts` per spec §7.1 step 4 — type to `{ id: string; data: { incidentId: string } }`, pass `job.id` into `runTriage`.
6. **Triage handler — increment site.** Edit `server/services/systemMonitor/triage/triageHandler.ts` per spec §7.1 step 5 — replace lines 269-277 with the predicated UPDATE (spec §4.2 verbatim shape). Branch on row count: 1 → continue to step 6; 0 → log `triage.idempotent_skip` and early-return.
7. **Triage handler — §11.0 retrofit on terminal sites.** In the same file's step 8: success path (lines 299-303) — UPDATE adds `WHERE triageStatus='running'` and captures row count; only log `triage_completed` if 1 row returned. Failure path (lines 309-312) — UPDATE adds `WHERE triageStatus='running'` and captures row count; only INSERT `agent_triage_failed` event if 1 row returned. This is the spec §11.0 single-writer terminal-event rule applied to the two pre-existing terminal sites. Search the file post-edit for `triageStatus: 'completed'` and `triageStatus: 'failed'` — both UPDATEs MUST include `WHERE triageStatus='running'` and gate their event/log emission on the row count.
8. **Stale-sweep module.** Create `staleTriageSweep.ts` per spec §7.2 step 1 (pure SQL builder + IO entrypoint + `parseStaleAfterMinutesEnv`). Verbatim from spec — do not paraphrase. The IO entrypoint MUST run UPDATE...RETURNING and the `agent_triage_timed_out` events INSERT in the same Postgres transaction so the (status flip, event write) pair is atomic per spec §11.2. Event payload shape per spec §4.3 verbatim (`actorAgentRunId: null`).
9. **Stale-sweep pure test.** Create `__tests__/staleTriageSweepPure.test.ts` per spec §12.1: cutoff calculation correctness on boundary timestamps; `parseStaleAfterMinutesEnv` for `undefined`, `''`, `'abc'`, `'0'`, `'-5'`, `'10'`, `'30'`.
10. **Sweep wire-up.** Edit `syntheticChecksTickHandler.ts` per spec §7.2 step 2 — call `runStaleTriageSweep(now)` before the existing `for (const check of SYNTHETIC_CHECKS)` loop, wrapped in its own try/catch.
11. **Integration test.** Create `__tests__/triageDurability.integration.test.ts` exercising the 5-step scenario in spec §7.3 verbatim. Steps 3 + 5 cover the §11.0 single-writer invariant: step 3 verifies the sweep flips `running→failed` exactly once with one event and unchanged counter; step 5 verifies the second `runTriage(id, 'job-B')` returns `{ status: 'skipped', reason: 'duplicate_job' }` with counter unchanged. Convention: `npx tsx`-runnable, `dotenv/config`, no vitest/jest framework, follows the `bundleUtilizationJob.idempotency.test.ts` shape.

### 4.4 Verification commands (per CLAUDE.md gate-cadence rule)

```bash
npx tsc --noEmit                                                                # type ripple from runTriage signature change
bash scripts/run-all-unit-tests.sh                                              # picks up the two new pure tests
npx tsx server/services/systemMonitor/triage/__tests__/triageIdempotencyPure.test.ts
npx tsx server/services/systemMonitor/triage/__tests__/staleTriageSweepPure.test.ts
npx tsx server/services/systemMonitor/triage/__tests__/triageDurability.integration.test.ts   # real DB; needs DATABASE_URL
npm run db:generate                                                             # confirm no drift beyond migration 0239
```

Do NOT run any `scripts/verify-*.sh` here. Gate scripts run only at Phase 0 baseline and at Programme-end verification.

### 4.5 Acceptance checks satisfied (spec §14.1)

- A1.1 — migration applies, column exists, type `text NULL`, no default
- A1.2 — `triageIdempotencyPure.test.ts` passes
- A1.3 — `staleTriageSweepPure.test.ts` passes
- A1.4 — `triageDurability.integration.test.ts` passes (G1+G2 coordination)
- A1.5 — manually-stuck row + `runStaleTriageSweep()` produces `failed` + one event + unchanged counter
- A1.6 — `runTriage(id, 'job-X')` twice — first increments and proceeds, second skips and counter unchanged
- A1.7 — `SYSTEM_MONITOR_TRIAGE_STALE_SWEEP_ENABLED=false` short-circuits the sweep

### 4.6 §11.0 invariant verification (load-bearing)

The integration test §7.3 step 3 + step 5 jointly exercise the single-writer rule. Required behaviour confirmed by the test:

- Step 3 — sweep wins the race: UPDATE returns 1 row for the sweep writer, exactly one `agent_triage_timed_out` event written, counter unchanged.
- Step 5 — pg-boss internal retry of the same `jobId`: idempotent UPDATE at the increment site returns 0 rows, handler early-returns, no second LLM tool loop, no second `agent_runs` row, no second terminal event.

If a future change introduces a fourth writer that can transition `triage_status` to a terminal value, that change is a §11.0 amendment — not in scope of this plan.

---

## 5. Chunk 2 — Synthetic check: silent agent success (G3)

**Slug:** `chunk-2-silent-agent-success`.

**Scope:** Phase 2 of the spec — one new `SyntheticCheck` registered in `SYNTHETIC_CHECKS`, plus its pure-helper test. Independent of chunks 3 and 4.

**Dependencies:** Chunk 1 has committed to the branch (so migration 0239 is the only outstanding migration; no data dep on `last_triage_job_id`).

**Acceptance IDs satisfied:** A2.1 – A2.5 (spec §14.2).

### 5.1 Files to create (spec §3.1)

| File | Purpose | Spec ref |
|---|---|---|
| `server/services/systemMonitor/synthetic/silentAgentSuccess.ts` | New `SyntheticCheck` exporting `silentAgentSuccess` per `types.ts` interface; query body verbatim from spec §8.1; pure helper `isSilentAgentRatioElevated` inlined per spec §8.2 unless test surface demands separate file (test imports the predicate directly). First-fire-wins per spec §8.3. Result fields per spec §4.4. | §3.1, §8.1, §8.2, §8.3, §4.4 |
| `server/services/systemMonitor/synthetic/__tests__/silentAgentSuccessPure.test.ts` | Pure-helper test: `0/5 → false`, `2/5 (40%) → true at threshold 0.30`, `1/5 (20%) → false at threshold 0.30`, `3/4 → false (below minSamples)`, `0/0 → false`. | §8.2, §14 A2.1 |

### 5.2 Files to modify (spec §3.2)

| File | Change | Spec ref |
|---|---|---|
| [`server/services/systemMonitor/synthetic/index.ts`](../../../server/services/systemMonitor/synthetic/index.ts) | Import `silentAgentSuccess` and append it to `SYNTHETIC_CHECKS`. | §3.2 |

### 5.3 Order of edits (translate verbatim from spec §8)

1. **Pure helper + check module.** Create `silentAgentSuccess.ts` with: (a) `isSilentAgentRatioElevated` per spec §8.2 verbatim; (b) `SyntheticCheck` export with `id: 'silent-agent-success'`, `defaultSeverity: 'medium'`, `description` per spec; (c) `run(ctx)` executes the SQL in spec §8.1 verbatim with `$since = ctx.now - 1h`, `$minSamples = SYSTEM_MONITOR_SILENT_SUCCESS_MIN_SAMPLES` (default 5), threshold `SYSTEM_MONITOR_SILENT_SUCCESS_RATIO_THRESHOLD` (default 0.30); (d) result shape per spec §4.4 (severity `medium`, resourceKind `agent`, resourceId is offending agent slug, summary string per §4.4, `bucketKey: bucket15min(ctx.now)`, metadata fields per §4.4); (e) first-fire-wins per spec §8.3 — return on the first row above the threshold, do NOT iterate all.
2. **Pure-helper test.** Create `__tests__/silentAgentSuccessPure.test.ts` covering the boundary cases listed in spec §8.2 final paragraph.
3. **Registry append.** Edit `server/services/systemMonitor/synthetic/index.ts` — import `silentAgentSuccess`, append to `SYNTHETIC_CHECKS` array.

### 5.4 Verification commands

```bash
npx tsc --noEmit
bash scripts/run-all-unit-tests.sh
npx tsx server/services/systemMonitor/synthetic/__tests__/silentAgentSuccessPure.test.ts
```

### 5.5 Acceptance checks satisfied (spec §14.2)

- A2.1 — `silentAgentSuccessPure.test.ts` passes
- A2.2 — `SYNTHETIC_CHECKS` array includes `silentAgentSuccess`
- A2.3 — seeded silent runs produce a `synthetic` incident with severity `medium` and fingerprint per spec §4.4
- A2.4 — below-MIN_SAMPLES seeding produces no incident
- A2.5 — runs with side-effect rows (any of the three probes) produce no incident

---

## 6. Chunk 3 — Synthetic check: incident silence (G4)

**Slug:** `chunk-3-incident-silence`.

**Scope:** Phase 3 of the spec — one new `SyntheticCheck` registered in `SYNTHETIC_CHECKS`, plus its pure-helper test. Independent of chunks 2 and 4.

**Dependencies:** Chunk 1 has committed to the branch (migration ordering only; no data dep).

**Acceptance IDs satisfied:** A3.1 – A3.6 (spec §14.3).

### 6.1 Files to create (spec §3.1)

| File | Purpose | Spec ref |
|---|---|---|
| `server/services/systemMonitor/synthetic/incidentSilence.ts` | New `SyntheticCheck`. SQL per spec §9.1 verbatim — MUST include BOTH exclusions (`incidents_in_window` excludes silence-check rows AND `synthetic_fires_in_proof_window` excludes silence-check rows). Pure helper `isMonitoringSilent` per spec §9.2. Result fields per spec §4.5. Severity `high` per §9.4. Self-dedup via fingerprint per §9.5. | §3.1, §9.1, §9.2, §9.4, §9.5, §9.6, §4.5 |
| `server/services/systemMonitor/synthetic/__tests__/incidentSilencePure.test.ts` | Pure-helper test: `(0,0) → false`, `(0,1) → true`, `(0,5) → true`, `(1,0) → false`, `(1,5) → false`. | §9.2, §14 A3.1 |

### 6.2 Files to modify (spec §3.2)

| File | Change | Spec ref |
|---|---|---|
| [`server/services/systemMonitor/synthetic/index.ts`](../../../server/services/systemMonitor/synthetic/index.ts) | Import `incidentSilence` and append it to `SYNTHETIC_CHECKS`. | §3.2 |

### 6.3 Order of edits (translate verbatim from spec §9)

1. **Pure helper + check module.** Create `incidentSilence.ts` with: (a) `isMonitoringSilent(incidentsInWindow, syntheticFiresInProofWindow)` per spec §9.2 verbatim; (b) `SyntheticCheck` export with `id: 'incident-silence'`, `defaultSeverity: 'high'`, `description` per spec; (c) `run(ctx)` executes the SQL in spec §9.1 verbatim. Both `silenceCutoff` (`SYSTEM_MONITOR_INCIDENT_SILENCE_HOURS`, default 12) and `proofCutoff` (`SYSTEM_MONITOR_INCIDENT_SILENCE_PROOF_OF_LIFE_HOURS`, default 24) MUST be parameterised. The query MUST exclude `metadata.checkId='incident-silence'` rows from BOTH `incidents_in_window` AND `synthetic_fires_in_proof_window` per spec §9.1 / §9.6 — these two exclusions are not optional and A3.6 verifies the second one. (d) Result shape per spec §4.5 (severity `high`, resourceKind `system`, resourceId `monitoring`, summary string per §4.5, `bucketKey: bucket15min(ctx.now)`, metadata per §4.5); (e) self-dedup via fingerprint `synthetic:incident-silence:system:monitoring` per spec §9.5 (already produced by the existing `syntheticChecksTickHandler.ts` fingerprint pattern at line 35).
2. **Pure-helper test.** Create `__tests__/incidentSilencePure.test.ts` covering the five boundary cases listed in spec §9.2.
3. **Registry append.** Edit `server/services/systemMonitor/synthetic/index.ts` — import `incidentSilence`, append to `SYNTHETIC_CHECKS` array.

### 6.4 Verification commands

```bash
npx tsc --noEmit
bash scripts/run-all-unit-tests.sh
npx tsx server/services/systemMonitor/synthetic/__tests__/incidentSilencePure.test.ts
```

### 6.5 Acceptance checks satisfied (spec §14.3)

- A3.1 — `incidentSilencePure.test.ts` passes
- A3.2 — `SYNTHETIC_CHECKS` array includes `incidentSilence`
- A3.3 — silence-window seeded with one independent synthetic fire 18h ago produces a `synthetic` incident with fingerprint per §4.5 and severity `high`
- A3.4 — zero `system_incidents` ever → no incident (cold-start tolerance)
- A3.5 — one non-silence incident in last 12h → no incident
- A3.6 — three silence-check rows (no other synthetic fires) → no incident (proof-of-life exclusion verified)

---

## 7. Chunk 4 — Failed-triage filter pill (G5)

**Slug:** `chunk-4-failed-triage-filter-pill`.

**Scope:** Phase 4 of the spec — extend the existing `diagnosis` filter on `listIncidents` with a `failed-triage` arm; extend the Zod enum, `IncidentListFilters` union, and `DiagnosisFilter` UI union; add the pill option. Independent of chunks 2 and 3.

**Dependencies:** Chunk 1 has committed to the branch (no data dep — chunk 4 is read-only on `triageStatus` and `diagnosisStatus`, both pre-existing columns).

**Acceptance IDs satisfied:** A4.1 – A4.5 (spec §14.4).

### 7.1 Files to modify (spec §3.2)

| File | Change | Spec ref |
|---|---|---|
| [`server/schemas/systemIncidents.ts`](../../../server/schemas/systemIncidents.ts) | Extend `listIncidentsQuery.diagnosis` enum (currently line 32) to include `'failed-triage'`. | §3.2, §10.1 step 1 |
| [`server/services/systemIncidentService.ts`](../../../server/services/systemIncidentService.ts) | (a) Extend `IncidentListFilters.diagnosis` union (line 40) to add `'failed-triage'`. (b) Add `else if (filters.diagnosis === 'failed-triage')` branch after the existing `not-triaged` branch (after line 113) using the type-cast pattern of the surrounding code. Predicate per spec §4.6: `triageStatus='failed' AND diagnosisStatus IN ('none','partial','invalid')`. | §3.2, §10.1 steps 2-3, §4.6 |
| [`client/src/components/system-incidents/DiagnosisFilterPill.tsx`](../../../client/src/components/system-incidents/DiagnosisFilterPill.tsx) | Extend `DiagnosisFilter` union (line 5) to add `'failed-triage'`. Append `{ value: 'failed-triage', label: 'Failed triage' }` to `PILL_OPTIONS` (line 7-12) preserving the order in spec §4.6 (All / Diagnosed / Awaiting / Not auto-triaged / Failed triage). | §3.2, §10.1 step 4, §4.6 |
| [`client/src/pages/SystemIncidentsPage.tsx`](../../../client/src/pages/SystemIncidentsPage.tsx) | No code change. Verify with `npx tsc --noEmit` that the prop pass-through still types. | §3.2, §10.1 step 5 |

### 7.2 Order of edits (translate verbatim from spec §10.1)

1. **Zod enum extension.** Edit `server/schemas/systemIncidents.ts` line 32 per spec §10.1 step 1 (verbatim).
2. **Service-layer filter.** Edit `server/services/systemIncidentService.ts`: extend `IncidentListFilters.diagnosis` union (line 40); add the new `else if` branch after the existing `not-triaged` branch per spec §10.1 step 2 (verbatim — including the `as unknown as ReturnType<typeof eq>` cast pattern that the surrounding code uses).
3. **UI union + pill option.** Edit `client/src/components/system-incidents/DiagnosisFilterPill.tsx` per spec §10.1 step 4 (verbatim union + array entry).
4. **SystemIncidentsPage typecheck.** No edits to `client/src/pages/SystemIncidentsPage.tsx`. Run `npx tsc --noEmit` to confirm the prop pass-through still types.

### 7.3 Verification commands

```bash
npx tsc --noEmit
bash scripts/run-all-unit-tests.sh   # no new tests in this chunk; runs existing suite
```

No new pure test in this chunk. Per spec §12.2: "No frontend unit tests for `DiagnosisFilterPill` extension. Per framing — frontend tests are deferred. The change is one entry in a literal array; type-checking is the gate." Same posture for the API-contract layer — Zod enum extension is the gate.

### 7.4 Acceptance checks satisfied (spec §14.4)

- A4.1 — `npx tsc --noEmit` passes (`DiagnosisFilter` union extension types through to `SystemIncidentsPage`)
- A4.2 — `GET /api/system/incidents?diagnosis=failed-triage` (sysadmin) returns matching incidents
- A4.3 — non-admin caller gets 403 (existing route guard)
- A4.4 — invalid `diagnosis` value gets 400 (Zod enum rejection)
- A4.5 — pill click filters list to matching incidents

---

## 8. Chunk dependency graph

```
Phase 0 (baseline + pre-existing fixes)
    ↓
Chunk 1 (G1+G2 bundled — load-bearing, must commit before chunks 2/3/4)
    ↓
Chunk 2 (G3) ──┐
Chunk 3 (G4) ──┤── any order, parallelisable in principle
Chunk 4 (G5) ──┘
    ↓
spec-conformance (mandatory per CLAUDE.md review pipeline)
    ↓
Programme-end verification (full gate set, ONE pass)
    ↓
pr-reviewer
```

Chunks 2/3/4 are independent of each other in code and data terms. The "chunk-1 must commit first" constraint is purely about migration-numbering ordering on the branch — not a runtime/data dep.

---

## 9. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| §11.0 invariant misimplementation — current `triageHandler.ts` step 8 success/failure paths issue UNCONDITIONAL terminal-state UPDATEs. If chunk 1 only retrofits step 5 (the increment) and forgets step 8 (the terminal flips), the `late tool-loop completion races sweep` corruption from §11.0 ships uncovered. | High | Chunk 1 order-of-edits step 7 makes the retrofit explicit. Integration test §7.3 step 3 verifies the sweep-wins-race. Add a code-review note: search `triageHandler.ts` for `triageStatus: 'completed'` and `triageStatus: 'failed'` after edit; both UPDATEs MUST include `WHERE triageStatus='running'`. |
| `agent_triage_timed_out` event-type registry drift — if added to only one of `shared/types/systemIncidentEvent.ts` and `server/db/schema/systemIncidentEvents.ts`, either the gate or the typecheck fails. | Medium | Inventory drift section above lists both files. Step 2 of chunk-1 order-of-edits handles both in the same edit. |
| `runTriage` signature ripple — adding `jobId` parameter breaks any caller. | Low | `triageHandler.runTriage` is called from one file (`server/jobs/systemMonitorTriageJob.ts`) per spec §3.2. Confirmed in primitives-reuse pass. `npx tsc --noEmit` after chunk 1 will catch any missed call site. |
| Migration 0238 numbering conflict — main lands a new migration before this branch merges. | Resolved | PR #216 landed migration `0238_system_agents_v7_1.sql` on main; this branch's migration was renumbered to `0239_system_incidents_last_triage_job_id.sql` during the merge from main on 2026-04-27. |
| Incident-silence self-validation regression — implementer omits one of the two `metadata.checkId='incident-silence'` exclusions in spec §9.1 SQL, causing the check to validate its own proof-of-life. | High (silent) | Chunk 3 order-of-edits step 1 calls the dual exclusion out as not-optional. A3.6 acceptance check directly verifies the proof-of-life exclusion (three silence rows with no other synthetic fires → no incident). |
| Sweep + `agent_runs` row — sweep flips `system_incidents.triageStatus` to `failed` but does NOT update the dead worker's `agent_runs` row (it stays at `status='running'`). | Low | Intentional per spec §4.3 (`actorAgentRunId: null` because we cannot reliably attribute to a specific run UUID). Surfaced as a known observability gap; not addressed in this spec. The existing `noAgentRunsInWindow` and `agentRunSuccessRateLow` checks will not produce false fires because they read `created_at` / lookback windows on completed runs, not stuck-running runs. |
| First-fire-wins detection latency — `silent-agent-success` takes N ticks to surface N degraded agents. | Accepted | Spec §8.3 explicitly accepts this for the current fleet size. Top-K-offenders promotion is a future spec amendment; not in scope here. |

---

## 10. Programme-end verification (run ONCE, after all four chunks AND spec-conformance)

This is the only gate-script invocation after Phase 0.

```bash
# Type + tests
npx tsc --noEmit
bash scripts/run-all-unit-tests.sh

# Full gate set (only run here, not between chunks)
npm run lint
npm run db:generate                                  # confirm clean diff (only migration 0239)
bash scripts/verify-event-type-registry.sh           # picks up agent_triage_timed_out
bash scripts/verify-job-idempotency-keys.sh
bash scripts/verify-rls-coverage.sh
bash scripts/verify-heuristic-purity.sh
npm run test:gates                                   # umbrella gate suite — pre-merge only

# Build surfaces
npm run build:server
npm run build:client

# Cross-spec consistency check (spec §14.5)
# - Update tasks/post-merge-system-monitor.md per A5.1
# - Verify architecture.md / docs/capabilities.md per A5.2 / A5.3 (no change expected)
```

Then run `pr-reviewer` per CLAUDE.md review pipeline. `dual-reviewer` only if user explicitly asks (local-only, opt-in).

---

## 11. Spec-conformance log convention

Per CLAUDE.md and `tasks/review-logs/README.md`, when `spec-conformance` runs per-chunk it writes its log to:

```
tasks/review-logs/spec-conformance-log-system-monitoring-agent-fixes-<chunk-slug>-<timestamp>.md
```

Use the chunk slugs as authored above:
- `chunk-1-triage-durability`
- `chunk-2-silent-agent-success`
- `chunk-3-incident-silence`
- `chunk-4-failed-triage-filter-pill`

A whole-branch `spec-conformance` invocation (no chunk slug) writes to:

```
tasks/review-logs/spec-conformance-log-system-monitoring-agent-fixes-<timestamp>.md
```

---

## 12. Definition of done (mirrors spec §14.6)

- All migrations run cleanly up + down on a fresh DB
- All four pure unit tests + the integration test pass
- `npx tsc --noEmit`, `npm run lint`, `npm run db:generate` all clean
- All A1.x – A5.x acceptance checks pass
- `tasks/post-merge-system-monitor.md` updated per A5.1
- `spec-conformance` returns `CONFORMANT` (or `CONFORMANT_AFTER_FIXES`)
- `pr-reviewer` returns clean

---

## 13. Completion status (PR #217)

All four chunks landed and the full review pipeline closed. Ready to merge.

| Stage | Outcome | Reference |
|---|---|---|
| Chunks 1–4 implementation | shipped | commit `e0c8000f` (Tier-1 hardening — G1–G5) |
| `spec-conformance` | CONFORMANT (1 directional item routed to `tasks/todo.md`) | `tasks/review-logs/spec-conformance-log-system-monitoring-agent-fixes-2026-04-27T11-41-03Z.md` |
| `pr-reviewer` | blocking findings B1–B4 fixed in-branch | commit `2dcafa88` |
| ChatGPT PR review | 3 rounds — 3 implement / 5 reject / 1 defer | `tasks/review-logs/chatgpt-pr-review-system-monitoring-agent-fixes-2026-04-27T22-12-04Z.md` |
| Final HEAD | `b8ae2c0a` | — |
| PR | https://github.com/michaelhazza/automation-v1/pull/217 | OPEN, ready to merge |

Deferred follow-up: counter metric / aggregation for `triage.terminal_event_suppressed` transitions. See `tasks/todo.md § PR Review deferred items / PR #217`.
