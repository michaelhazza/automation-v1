# Spec Review Final Report — sandbox-isolation

**Spec:** `tasks/builds/sandbox-isolation/spec.md`
**Spec commit at start:** `45122837`
**Spec commit at finish:** `733fc650`
**Spec-context commit:** `a49d73d0` (docs/spec-context.md, last reviewed 2026-05-10 — fresh)
**Iterations run:** 4 of 5 (MAX_ITERATIONS)
**Exit condition:** two-consecutive-mechanical-only (preferred early exit per playbook)
**Verdict:** READY_FOR_BUILD (4 iterations, 36 mechanical fixes applied, 2 build-time decisions routed)

The spec is mechanically tight against the brief's §6 invariants, the spec-authoring checklist, and the rubric. All findings surfaced by Codex (4 iterations, 38 numbered findings) were classified mechanical and applied except two that were AUTO-DECIDED as build-time choices (egress interception mechanism, log persistence schema) and routed to `tasks/todo.md` under the `SANDBOX-DEF-*` namespace. No directional findings forced a HITL pause. No findings were rejected with no action.

---

## Iteration summary table

| # | Codex findings | Mechanical accepted | Mechanical rejected | Directional / Ambiguous | AUTO-DECIDED |
|---|---|---|---|---|---|
| 1 | 13 | 13 | 0 | 0 | 0 |
| 2 | 12 | 10 | 0 | 2 | 2 (SANDBOX-DEF-EGRESS-MECH, SANDBOX-DEF-LOG-SCHEMA) |
| 3 | 9 | 9 | 0 | 0 | 0 |
| 4 | 4 | 4 | 0 | 0 | 0 |

Total: 38 Codex findings, 36 mechanically applied, 2 routed to `tasks/todo.md` as build-time decisions, 0 rejected.

---

## Mechanical changes applied (by theme)

See per-iteration scratch logs for full detail:
- `tasks/review-logs/spec-review-log-sandbox-isolation-1-20260511T000426Z.md` — 13 fixes
- `tasks/review-logs/spec-review-log-sandbox-isolation-2-20260511T000426Z.md` — 10 fixes + 2 deferrals
- `tasks/review-logs/spec-review-log-sandbox-isolation-3-20260511T000426Z.md` — 9 fixes
- `tasks/review-logs/spec-review-log-sandbox-isolation-4-20260511T000426Z.md` — 4 fixes

Headline themes:

- **Header / pipeline order** corrected (validate → redact → persist → ledger).
- **Provider resolver** rewritten with environment-specific hard guards (e2b everywhere; local_docker non-prod; inline test-only); stale `SANDBOX_ALLOW_NON_E2B_PROVIDER` symbol removed.
- **Closed terminal-state taxonomy** preserved: `log_overflow` folded into `output_validation_failed` sub-reason, `artefact_oversized` folded into `artefact_upload_failed` sub-reason. Reconciliation-recovery exception introduced for the two internal-only states.
- **State machine consistency**: all post-start terminals route through `harvesting`; single writer for terminal states.
- **Phase-scoped minimum events** mechanism: pre-start, post-start-no-output-read, post-start-with-output-read — gated by `harvestStepReached` payload field on `sandbox_terminal`; CI gate `verify-sandbox-minimum-events` updated to three-pass check.
- **Customer visibility** aligned between §13.4 and §24.5 for `harvest_failed` / `artefact_upload_failed`; `sandbox_harvest_failed_permanent` declared a display/log label, not a FailureReason enum value.
- **File inventory drift** closed: stale `sandbox-harvest queue` removed; `sandboxTelemetryWriter` rebound to harvest pipeline; telemetry-summary aggregation struck; `sandbox_artefacts` added to §6 manifest row; migration dry-run script added to §19.1; `credentialBrokerService.ts` moved from NOT-modified to modified-with-extension.
- **Credential audit sinks** bound: broker audit trail for `credential_issued|revoked`; `sandbox_telemetry_events` for `credential_leak_attempted`.
- **Telemetry event enum closure** preserved: `artefact_already_uploaded` collapsed into `artefact_uploaded` with `wasIdempotent` flag; `provider_unavailable` split into transient `provider_diagnostic` + terminal `provider_unavailable` (pre-canonical-terminal, paired with canonical event); `sandbox_terminal` events split into canonical + recovery.
- **Chunk dependency graph** corrected: C12 → C13; C8/C9/C10 → C11; ASCII graph rewritten.
- **Cost ledger**: enum extended to include `sandbox_compute_correction`; `correction_sequence` column added to inventory with CHECK constraint and partial unique index.
- **Reconciliation cadence** pinned at 5 minutes.
- **Casing**: `harvestStepReached` standardised camelCase.
- **§28 open questions** all locked to V1 decisions; section renamed.

---

## Rejected findings

None. Every finding was either mechanically applied or AUTO-DECIDED with the decision routed to `tasks/todo.md`.

---

## AUTO-DECIDED items (build-time decisions routed to tasks/todo.md)

| Iter | Finding | Decision | Routed to |
|---|---|---|---|
| 2 | F2.8 Egress audit lacks named interception mechanism | AUTO-DECIDED (best judgment) — schema locked in §20.6; mechanism deferred to C12 build-time after verifying e2b's exposed hooks | tasks/todo.md `SANDBOX-DEF-EGRESS-MECH` |
| 2 | F2.9 Log persistence lacks named sink/schema | AUTO-DECIDED (best judgment) — idempotency key + RLS requirement locked; concrete sink (new table vs existing-layer extension) deferred. Iter 4 elevated to chunk-zero gating decision | tasks/todo.md `SANDBOX-DEF-LOG-SCHEMA` |

Neither blocks Phase 2 build kickoff. The build's first task is to pick the SANDBOX-DEF-LOG-SCHEMA option (gating decision before C1); the build's C12 chunk picks the SANDBOX-DEF-EGRESS-MECH option after inspecting e2b SDK capabilities.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review (4 iterations, 38 numbered findings, 36 applied + 2 routed). The closed terminal-state taxonomy is internally consistent. The phase-scoped minimum-events contract has a CI gate. The cost-ledger extension is complete including correction-row idempotency. The file inventory matches every prose reference. The chunk dependency graph has the right edges.

However:

- The review did not re-verify the framing assumptions at the top of the playbook. `docs/spec-context.md` is fresh (2026-05-10) and the spec's framing (§1, §4) matches it — this was checked in the pre-loop step — but if the product context shifts again before the build starts, the framing should be re-confirmed.
- The review did not catch directional findings that Codex and the rubric did not see. The two AUTO-DECIDED items are deliberate build-time deferrals (not "we forgot to spec this"), but the human should confirm that deferring egress mechanism and log schema to build-time is acceptable before kicking off Phase 2.
- The review did not prescribe what to build first. The phase plan (§23) is in place but the order of execution within the dependency graph is the architect / feature-coordinator's call.

**Recommended next step:** read §1, §2, §4, §27, §28 of the spec (framing + locked decisions + deferred items) one more time. Confirm SANDBOX-DEF-LOG-SCHEMA is acceptable as a chunk-zero gating decision (option (b), folding into C7, is the simpler default if no real log-shape reason to add a new table surfaces during build). Then kick off Phase 2 via `feature-coordinator`.
