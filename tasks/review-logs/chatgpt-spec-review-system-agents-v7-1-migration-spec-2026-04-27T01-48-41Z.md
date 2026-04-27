# ChatGPT Spec Review Session — system-agents-v7-1-migration-spec — 2026-04-27T01-48-41Z

## Session Info
- Spec: `docs/superpowers/specs/2026-04-26-system-agents-v7-1-migration-spec.md`
- Note on detection: the user's start command named `docs/automation-os-system-agents-master-brief-v7.1.md` (architecture document), but ChatGPT's feedback is exclusively about implementation-level concerns (idempotency wrapper, manager guard, sideEffectClass semantics, hashing, cleanup job, migration index swap). All of that content lives in the migration spec, which is the sibling implementation contract on the same PR (#212). The master brief contains none of the symbols referenced (`request_hash`, `keyShape`, `hashActionArgs`, `in_flight`, `sideEffectClass`, `directExternalSideEffect`). Treating the migration spec as the spec under review.
- Branch: `claude/audit-system-agents-46kTN`
- PR: #212 — https://github.com/michaelhazza/automation-v1/pull/212
- Started: 2026-04-27T01:48:41Z

---

## Round 1 — 2026-04-27T01-48-41Z

### ChatGPT Feedback (raw)

(See verbatim paste below — 13 distinct findings parsed.)

> Architecture is coherent. Phase ordering, invariants, and contracts are tight. Idempotency + RLS + manager guard is well integrated. What remains: 3 correctness risks (idempotency + concurrency edge cases), 2 spec ambiguities (enforcement vs convention), 3 missing guardrails (observability + failure containment + drift prevention).
>
> 1A. request_hash not canonicalised. 1B. keyShape extraction underspecified. 1C. "in_flight" retry behaviour underdefined (permanent stuck state if worker dies). 2. Concurrency: missing invariant — no external side-effect before idempotency claim. 3. Manager guard subtle bypass — block on sideEffectClass !== 'none', not just directExternalSideEffect. 4. sideEffectClass semantics: 'none' includes DB writes is dangerous. 5A. Idempotency hit-rate alerting threshold missing. 5B. skill.blocked flood protection (WARN rate limiting). 6. Seed pipeline missing invariant: no two managers share subordinate sets / each worker has exactly one manager. 7. Migration: DROP+CREATE INDEX brief constraint-less window — use CONCURRENTLY or note exclusive-context safety. 8A. TTL classes hardcoded — pin in single constant map. 8B. status: 'failed' retry policy unclear — pin "failed is terminal, requires new key". 8C. Cleanup job missing batch limit — DELETE WHERE expires_at < NOW() risks large delete spike.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| 1A | `request_hash` not canonicalised — same input may hash differently | technical | apply | auto (apply) | high | Real internal-contract gap — without canonical JSON the cross-run dedup is broken on its core invariant. User explicitly relaxed high-severity escalation for this round (`auto-execute technical findings`). Add explicit canonicalisation rule to §15.1 + §9.3.1. |
| 1B | `keyShape` field-resolution semantics underspecified | technical | apply | auto (apply) | medium | Internal-contract gap. Add dot-path syntax and missing-field hard-block to `IdempotencyContract` JSDoc in §8.1. |
| 1C | `in_flight` permanent stuck-state if worker dies — no takeover/timeout | technical | apply | auto (apply) | critical | Real correctness gap — single worker death deadlocks an idempotency key indefinitely. Add a `created_at`-based takeover rule (after 10 minutes another caller may reclaim by re-INSERTing with `ON CONFLICT DO UPDATE`). User explicitly relaxed high/critical escalation for this round. |
| 2 | Missing invariant: "no external side-effect before idempotency claim" | technical | apply | auto (apply) | medium | Mechanical spec clarification. The §9.3.1 code already enforces this; pin it as an explicit invariant in §16A.1 so the rule isn't only readable from code. |
| 3 | Manager-guard bypass — `sideEffectClass: 'none'` + `directExternalSideEffect: false` skill can internally invoke a write skill | technical | apply | auto (apply) | high | Real correctness gap — indirect side-effect leakage. Tighten §9.4 to additionally block when `sideEffectClass !== 'none'`. The 14 manager-allowlisted skills (universal+delegation bundle) all carry `sideEffectClass: 'none'` per §8.2 — change is non-breaking. |
| 4 | `sideEffectClass` semantics ambiguity — 'none' includes DB writes | technical | apply | auto (apply) | medium | Spec ambiguity. Add explicit definitional clarification to §8.1's JSDoc: `sideEffectClass` governs external blast-radius only; internal DB writes governed by RLS + transaction boundaries. Don't rename the enum; clarify in place. |
| 5A | Idempotency hit-rate threshold guidance missing in §18 | technical | apply | auto (apply) | medium | Mechanical observability addition. Pin a threshold guidance line in §18 (>5% sustained = investigate as loop/retry storm). Pre-prod, advisory only. |
| 5B | `skill.blocked` flood protection (WARN rate-limiting) | technical | apply | auto (apply) | medium | Mechanical observability addition. Add a WARN rate-limit rule to §18 — per `(skill, subaccount)` per minute. |
| 6 | Seed-hierarchy assertions miss "every worker has exactly one manager" | technical | apply | auto (apply) | medium | Real correctness gap in seed. Add Assertion 4 in §13.4: every active T3 worker has exactly one parent and that parent is T1 or T2. Catches the "two managers claim the same worker" misconfiguration class. |
| 7 | Migration index drop+create — brief constraint-less window | technical | apply | auto (apply) | low | Mechanical doc note. The migration runs inside `BEGIN;...COMMIT;` (already in §6.1); under Postgres MVCC concurrent readers see the pre-COMMIT state until commit, so there is no constraint-less window. Add a one-line note to §6.1; reject the `CONCURRENTLY` suggestion (incompatible with `BEGIN;...COMMIT;`). |
| 8A | TTL durations hardcoded across wrapper + cleanup job | technical | apply | auto (apply) | low | Mechanical spec addition. Pin the TTL constant table in §8.1 (`permanent → NULL`, `long → 30d`, `short → 14d`) and reference it from §15.1 + the cleanup job. The pure helper `ttlClassToExpiresAt` (§4.11c) is the implementation pin. |
| 8B | `previous_failure` retry semantics unclear | technical | apply | auto (apply) | medium | Real spec gap. Add explicit rule to §16A.7: failed rows are terminal; retry requires a new idempotency key (caller's responsibility). Same-key retry of a `failed` row is rejected with `{ status: 'previous_failure' }`. |
| 8C | Cleanup job missing batch limit | technical | apply | auto (apply) | low | Mechanical operational addition. Add a "batch size 1000, loop until drained, log row count per iteration" pattern to §16.3 and §17. Avoids large-delete pressure when expires_at backlog accumulates. |

### Post-edit integrity check

Integrity check: 1 issue found this round (auto: 1, escalated: 0).

- §16A.3 race-scenarios table row for `in_flight` was inconsistent with the new §16A.8 takeover semantics (still said "polls for completion" with no acknowledgment of takeover). **Auto-applied** mechanical fix — extended the row to reference the takeover threshold and added a new row for the crashed-first-writer scenario.

No other forward references or contradictions detected. New symbols (`IDEMPOTENCY_CLAIM_TIMEOUT_MS`, `TTL_DURATIONS_MS`, `canonicaliseForHash`, `IdempotencyKeyShapeError`, `manager_indirect_side_effect_class`) all defined in the introducing section. New section anchors (§8.1.1, §16A.8, §18.1) all created. Old "(handler decision)" wording in the in_flight branch removed and replaced with the explicit takeover protocol.

### Applied (auto-applied technical, 13 + 1 integrity)

- [auto] 1A: Added `canonicaliseForHash` contract + canonicalisation rules to §8.1.1; updated `IdempotencyContract` JSDoc with reference; updated §9.3.1 wrapper code-comment to require canonicalisation in `hashActionArgs`.
- [auto] 1B: Extended `IdempotencyContract.keyShape` JSDoc with dot-path syntax, missing-field hard-block (`IdempotencyKeyShapeError` before INSERT), optional-field rule, canonicalisation reference.
- [auto] 1C: Added §16A.8 stale-claim takeover protocol (10-minute timeout, state-based reclaim UPDATE, `IDEMPOTENCY_CLAIM_TIMEOUT_MS` constant); rewrote §9.3.1 in-flight branch to attempt reclaim past threshold; added two new `skill.warn` reasons (`in_flight_claim_reclaimed`, `in_flight_claim_lost_reclaim`) to §18 logging table; promoted `isFirstWriter` from `const` to `let` so reclaim path can succeed-as-first-writer.
- [auto] 2: Added "no external side effect before claim" mandatory ordering invariant to §16A.1, with cross-reference to `verify-no-direct-adapter-calls.sh` gate.
- [auto] 3: Tightened §9.4 manager-role guard with three-condition deny composition: not-allowlisted OR `directExternalSideEffect: true` OR `sideEffectClass !== 'none'`. Added new deny reason `manager_indirect_side_effect_class`. Updated §4.11c managerGuardPure test description.
- [auto] 4: Added `SideEffectClass` JSDoc clarifying that `sideEffectClass` governs **external blast-radius only** — internal DB writes are governed by RLS + transaction boundaries, not this enum.
- [auto] 5A + 5B: Added §18.1 rate-based observability thresholds table with mandatory `skill.blocked` per-`(skill, subaccount)` rate-limiting (1 emit/min); thresholds for hit-rate (>5% sustained), blocked-rate (>30%), terminal-race-lost (>1/min), in-flight-claim-reclaimed (>1/hour).
- [auto] 6: Added Assertion 4 to §13.4 — every active T3 worker must have exactly one parent and that parent must be in the explicit T1/T2 set.
- [auto] 7: Added Postgres MVCC explainer to §6.1 — single-tx DROP+CREATE INDEX has no constraint-less window for concurrent readers; rejected `CONCURRENTLY` (incompatible with `BEGIN;…COMMIT;`).
- [auto] 8A: Added TTL constant table + `TTL_DURATIONS_MS` map definition to §8.1.1; both wrapper and cleanup job MUST consume via `ttlClassToExpiresAt`. No literal `expires_at` arithmetic at any other call site.
- [auto] 8B: Added "failed rows are terminal" rule to §16A.7 + rewrote §9.3.1 failed-status branch with explicit "submit a new idempotency key to retry" guidance.
- [auto] 8C: Added batched-delete pattern to §16.3 (1k batch size, loop until drained, 10k-batch safety cap, structured per-batch + completion logs); §17 row updated to reference batching.
- [auto] integrity: Updated §16A.3 race-scenarios table to reflect §16A.8 takeover semantics + added new row for crashed-first-writer scenario.

### Applied — new acceptance criteria

Added items 27–34 to §20 Acceptance criteria covering: hash canonicalisation determinism (27), keyShape field-resolution semantics (28), stale-claim takeover (29), manager indirect-side-effect block (30), failed-row terminal rule (31), cleanup batching (32), `skill.blocked` rate-limiting (33), worker-parent assertion (34).
