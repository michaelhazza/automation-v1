# Spec Review Final Report

**Spec:** `tasks/builds/wave-4-audit-absorber/spec.md`
**Spec commit at start:** `77b70f82`
**Spec commit at finish:** `567ffb16`
**Spec-context commit:** `62497257`
**Iterations run:** 5 of 5
**Exit condition:** iteration-cap (also satisfies the implied "no directional findings ever surfaced" criterion)
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 12 | 6 | 18 | 0 | 0 | 0 | none |
| 2 | 6 | 0 | 6 | 0 | 0 | 0 | none |
| 3 | 9 | 0 | 9 | 0 | 0 | 0 | none |
| 4 | 8 | 0 | 8 | 0 | 0 | 0 | none |
| 5 | 6 | 0 | 6 | 0 | 0 | 0 | none |

Total: 47 mechanical findings applied across 5 iterations. No directional findings were raised at any point.

---

## Mechanical changes applied

### Frontmatter and governance blocks
- Updated `status: DRAFT` → `status: reviewing`; added `last_updated`.
- Added Lifecycle Declaration block (5 fields, Growth state).
- Added ABCd Estimate block (S/M/L sizing only).

### §1 Scope
- Reconciled inventory: 37 items across 9 buckets (was "~28").
- Moved MC4 from Standalone-tests bucket to Prevention-gates bucket (it is a static gate, not a test).
- Reconciled "9 small circular cycles" across §1, §2, §8, §13.

### §2 Goals
- Removed the "OR document best-effort" alternative for AE2 (contract is now pinned in §5.2).
- Pointed Goal 3 at `JOB_CONFIG` source-of-truth.
- Pointed Goal 8 at the existing snapshot at `scripts/snapshots/action-registry.snapshot.json`.
- Pointed Goal 10 at the existing `verify-universal-skill-sync.sh` gate.

### §4 Framing Assumptions
- Added explicit testing-posture deviation block naming the 6 integration tests as a scoped exception with rationale.
- Replaced `server/services/agentExecutionService/.../handoff.ts` with the verified location `server/services/skillExecutor/handlers/handoff.ts` (post-#314 split).
- Pinned `JOB_CONFIG` as the registry source-of-truth and explained why `createWorker.ts` is not a registry.
- Updated AE2 framing to reflect §5.2 pinned contract (chunk 0 verifies feasibility, does not re-decide).

### §5.1 AE1 (handoff durability)
- Added Critical-event invariant (load-bearing) covering `insertExecutionEventSafe`, `insertOutcomeSafe`, `insertCriticalAuditEvent`.
- Corrected callsite count from 7 → 6 (verified line 268 is `getOrgScopedDb`, not an event emission).
- Withdrew the dedicated runtime test; verification moved to PP-AE2 static gate to preserve the §4 6-integration-test cap.

### §5.2 AE2 (spawn sub-agents durability)
- Replaced "1-line wrap" claim with the full multi-line semantic-shift contract (9 numbered fix steps).
- Pinned the chosen contract: queue durably, block internally, preserve the LLM-visible result shape.
- Pinned the required `enqueueHandoff` extension: pre-create child run row, return `{ enqueued, runId, jobId, reason? }`.
- Pinned the actual idempotency mechanism: existing `(agentId, taskId, subaccountId)` running-row check (NOT pg-boss singletonKey).
- Replaced ambiguous "default cap 5s" with explicit `pollIntervalMs = 1000`, no backoff, `context.timeoutMs` as only total bound.
- Replaced collision-prone `${parentRunId}:${title}` idempotency key with `${parentRunId}:${index}:${normalisedTitle}`.
- Added `task_id` field to the result shape (verified emitted at handoff.ts:319, 332).
- Acknowledged `pending` field on timeout path is an additive (not byte-identical) shape extension.

### §5.3 AE5
- Removed redundant text; pointed at §5.1's invariant.

### §6.1 MC7 (handler idempotency meta-test)
- Pinned `JOB_CONFIG` (`server/config/jobConfig.ts`) as the queue catalogue.
- Added the four-verdict scheme (`handler_tested`, `external_consumer`, `send_only`, `exempt`) with required fields.
- Pinned per-verdict required fields (incl. `addedAt` for `send_only`).
- Split chunk-0 inventory into markdown + importable TS map at `server/lib/__tests__/handlerRegistryFixture.ts`.
- Added new gate `scripts/verify-handler-registry-fixture.sh` for bidirectional set equality.
- Broadened registration-inventory scope to cover `server/jobs/*.ts`, `server/services/*.ts`, and `server/lib/*Job.ts`.

### §6.2 MC8 (handoff durability test)
- Expanded MC8's scope to carry the four AE2 scenarios.

### §6.6 MC4 → §11.5
- Moved (it is a static gate, not a test). §6.6 retained as a navigation anchor.

### §7.1 DUP6
- Corrected file path: prefixed with `server/services/`.

### §8 Cycles
- Reframed as a chunk-0-verification process: each CD-N item is `verified open` or `verified closed by <sha>`.
- Removed "drop below baseline" language (baseline is already `cycle-count:0`).
- Split CD9-CD10 from "4 cycles batched" into 2+2.

### §9.1 SK1
- Recast as "reuse existing snapshot infrastructure"; named existing files.
- Added one new comparator script.

### §9.2 SK2
- Expanded inventory from "1 known kebab" → 25 kebab files (16 top-level + 9 in `server/skills/support/`).
- Updated gate to walk recursively.

### §10.1 PA-CLEANUP-DEF-2
- Pinned full query contract + deterministic ordering.
- Removed extra unit test that exceeded the §4 6-test cap.

### §10.2 PA-CLEANUP-DEF-3
- Recast default to log-only acceptance.
- Pinned operator-override path: column extension on `voice_profiles`, no new table.

### §11.1 PP-CD1 / §11.3 PP-SK2
- Replaced "author new gate" with "existing — no new gate authored" for both; named existing gates.

### §11.2 PP-AE2
- Expanded gate spec to cover all three critical event functions per §5.1 invariant.

### §11.4 PP-MC2
- Added full YAML schema for `tasks/critical-paths-manifest.yml`.
- Strengthened gate assertions (version, id-uniqueness, description, surface, last_verified + 3 coverage-key checks).

### §11.5 MC4 (new section)
- Houses the relocated MC4 gate definition.

### §13 Acceptance Criteria
- Replaced open-ended "OR explicitly v2-deferred" with three-path "resolved" definition.
- Removed AE2 from the deferral-permit list.
- Pinned cycle-count acceptance to `0` (the existing baseline).

### §14 Chunks
- Updated chunk 0's deliverables to include three inventory artifacts.
- Removed AE2 from chunk 0's operator-decision list.

### §15 Deferred Items
- Renamed from "Out of Scope" to "Deferred Items" per checklist §7.
- Added per-item reasons.
- Added explicit entries for HandlerContext (Session H scope) and system-maintenance audit stream.

## Rejected findings

None. Every finding raised by Codex or by the rubric pass was accepted as mechanical and applied. No false positives surfaced.

## Directional and ambiguous findings (autonomously decided)

None. Across 5 iterations, Codex never raised a directional finding — every one of its 41 findings was a mechanical defect (file-inventory drift, contradiction, missing contract, unnamed primitive, or load-bearing claim against an actual primitive shape). The spec's §3 (Non-Goals) and §4 (Framing Assumptions) effectively guard the directional surface; Codex's job was to verify mechanical consistency and it did so.

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across 5 iterations. The human has adjudicated every directional finding that surfaced (none did). However:

- The review did not re-verify the framing assumptions at the top of the spec-context file (`docs/spec-context.md`). The spec opens with a `static_gates_primary` posture and explicitly carves out a 6-integration-test deviation; if the operator's testing posture has shifted, re-read §4 before calling this implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. In particular, the AE2 contract (§5.2) is now mechanically tight — it correctly describes what extending `enqueueHandoff` would require — but the call to extend `enqueueHandoff` at all is a directional decision the operator should review. The spec defaults to "yes, extend it; verify feasibility in chunk 0" but does not block on operator reconfirmation.
- The review did not prescribe what to build next.

**Recommended next step:** read §3 (Non-Goals), §4 (Framing Assumptions), and the AE2 contract in §5.2 one more time. Confirm the AE2 enqueueHandoff-extension decision is the right shape (vs the alternative best-effort posture, which the spec no longer offers). Then start implementation.

## Caller-relevant flags

For the spec-coordinator / feature-coordinator picking this up:

1. **Chunk 0 is essential.** Multiple verifications are punted there: handler-registry inventory, cycle-verification log, skill-rename inventory, skill-loader breakage sweep, payload-hash determinism check for AE2 idempotency, and three operator decisions (SK1 methodology location, PA-CLEANUP-DEF-3 event-row, PA-CLEANUP-DEF-7 option). Treat chunk 0's outputs as inputs to chunks 1-13's plans.
2. **AE2 is the largest single change.** §5.2's contract requires extending `enqueueHandoff` (return shape + pre-create child row + worker handshake) and migrating two existing callers in `server/services/skillExecutor/handlers/tasks.ts:93,757`. This is not a 1-line change.
3. **5 of the 9 cycles in §8 may already be closed** (the audit log predates the post-#307 cleanup sprint that brought baseline to 0). Chunk 0's verification log determines actual scope of chunk 8.
4. **2 of the 5 prevention gates are existing.** PP-CD1 and PP-SK2 reuse `verify-no-new-cycles.sh` and `verify-universal-skill-sync.sh` respectively. PP-AE2, PP-MC2, and MC4 are new.
