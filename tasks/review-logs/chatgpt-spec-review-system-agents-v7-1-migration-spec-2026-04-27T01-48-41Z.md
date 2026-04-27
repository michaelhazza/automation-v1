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

---

## Round 2 — 2026-04-27T02-22-29Z

### ChatGPT Feedback (raw)

> Round 2 feedback: mostly done, but I'd tighten 5 items before final.
>
> 1. **Stale-claim takeover can double-fire external side effects.** The 10-minute reclaim assumes the original worker died, but it may still be running slowly. Add a rule: only skills whose worst-case runtime is safely below `IDEMPOTENCY_CLAIM_TIMEOUT_MS` may use takeover, otherwise require heartbeat or disable reclaim per skill.
> 2. **`send_invoice` manual test uses wrong key tuple.** Registry says `send_invoice` keyShape is `[invoice_id]`, but acceptance criteria still says replay with `(engagement_id, billing_period_start, billing_period_end)`. Fix AC #15 to use `invoice_id`.
> 3. **Manager guard docs contradict return reason.** §9.4 says the guard may return `manager_direct_external_side_effect` or `manager_indirect_side_effect_class`, but the old sentence still says it returns `{ action: 'block', reason: 'manager_role_violation' }`. Remove/update that stale sentence.
> 4. **Cleanup job RLS posture conflicts with raw SQL.** §16.5 says cleanup uses typed `.delete()` and no explicit RLS guard, but §16.3 shows raw `db.execute(sql DELETE...)`. Either change implementation to typed delete or require `assertRlsAwareWrite('skill_idempotency_keys')` before the raw delete.
> 5. **Hierarchy assertion labels admin-ops-agent as manager/T2 despite role staff.** That may be intentional as a direct report of Orchestrator, but the spec text says "Managers in v7.1" and includes admin-ops. Rename the set to `ALLOWED_T1_T2_PARENTS` and avoid calling all entries managers.
>
> After those, I'd call it final.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| 1 | Stale-claim takeover can double-fire side effects when handler is slow but still running | technical | apply | auto (apply) | high | Real correctness gap. The current `IDEMPOTENCY_CLAIM_TIMEOUT_MS = 10 min` rule reclaims on `created_at < NOW() - 10 min` regardless of whether the original worker is still running — a legitimately slow handler running close to the timeout could be reclaimed mid-execution and re-fire its external side effect when the original eventually completes. User explicitly relaxed high-severity escalation for this round. **Fix:** add `IdempotencyContract.reclaimEligibility: 'eligible' \| 'disabled'` per-skill flag with a 50% budget rule (eligible only if worst-case runtime < 5 min). All 8 current write skills are stub-first / non-heavy → safe to declare `'eligible'`. Add a deferred item for the heartbeat-extending takeover variant. |
| 2 | AC #15 + §9.6 manual test use wrong `send_invoice` key tuple | technical | apply | auto (apply) | high | Real correctness gap that would mislead the implementer / cause a manual-test failure. §8.2 registry says `send_invoice.keyShape = [invoice_id]` but AC #15 implies the legacy `(engagement_id, billing_period_start, billing_period_end)` tuple (which belongs to `generate_invoice`). The §9.6 manual test on line 1126 explicitly uses the wrong tuple. **Fix:** rewrite both to use `invoice_id` and call out the `generate_invoice` separation explicitly so the conflation cannot recur. |
| 3 | Manager guard return-reason contradiction (stale "returns manager_role_violation" sentence) | technical | apply | auto (apply) | medium | Doc consistency gap. After Round 1's three-condition deny tightening, §9.4 introduced two new reasons (`manager_direct_external_side_effect`, `manager_indirect_side_effect_class`) but several legacy sentences still claimed the guard returns only `manager_role_violation`. Affected sites: line 110 (re-use table), line 176 (file inventory), line 1112 (§9.4 trailing sentence), §15.2 contract block (only listed 2 of 3 reasons). AC #16 + §9.6 manual test for `draft_post` correctly remain `manager_role_violation` (non-allowlisted skills hit that branch first per §9.4 deny ordering). |
| 4 | Cleanup job RLS posture contradiction (§16.5 says typed `.delete()`, §16.3 shows raw SQL) | technical | apply | auto (apply) | high | Real correctness gap that would fail `verify-rls-protected-tables.sh` at runtime. The §16.3 raw-SQL pattern (`IN (SELECT ... LIMIT N)` for index-aware batching) is the right implementation choice — typed `.delete()` would lose the `(expires_at)` index efficiency. **Fix:** add `assertRlsAwareWrite('skill_idempotency_keys')` to §16.3 (per-batch, inside the loop), update §16.5 to acknowledge cleanup uses raw SQL too, update §16.4 checklist row, update §9.6 verification list, update AC #22. Side benefit: corrects the stale `(§9.5)` forward reference in §16.5 (§9.5 is "Worker-adapter case removal", not cleanup). |
| 5 | Hierarchy assertion `T1_OR_T2` set name + comment incorrectly call admin-ops-agent a "manager" | technical | apply | auto (apply) | low | Naming clarity. `admin-ops-agent` is `role: staff` (per §10.1.5 line 1189), not `manager` — labelling all entries "Managers in v7.1" in the §13.4 comment is technically incorrect and would confuse a reader cross-checking against the agent definitions. **Fix:** rename const → `ALLOWED_T1_T2_PARENTS`, update inline comment to clarify the set is "T2 agents that legitimately own workers" (with a note that admin-ops is included as future-proofing for the case where it grows worker subordinates), update the trailing log line, update the error message. |

### Post-edit integrity check

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

Validation pass:
- All new symbols (`reclaimEligibility`, `in_flight_reclaim_disabled`, `ALLOWED_T1_T2_PARENTS`) defined where introduced (§8.1 / §16A.8 / §13.4).
- All cross-references resolve: §8.1 → §8.2 table → §9.3.1 wrapper → §16A.8 protocol → AC #15, #35, #36 ✓; new `in_flight_reclaim_disabled` reason → §18 logging table + §18.1 thresholds ✓; `ALLOWED_T1_T2_PARENTS` only used in §13.4 ✓.
- Manager-guard reason consistency: lines 110, 176, 1112, §15.2 all updated to mention all three reasons. Line 1189 + AC #16 (`draft_post`) deliberately retain `manager_role_violation` because non-allowlisted skills hit that branch first per §9.4 deny ordering — this is the correct test surface for that path.
- Cleanup-job RLS posture: §16.3, §16.4 row, §16.5, §9.6 verification, AC #22 all aligned to "raw-SQL DELETE guarded per-batch by `assertRlsAwareWrite`".
- §16A.1 (idempotency posture) and §16A.3 (race-scenarios table) updated to reflect skill-gated takeover.
- Stale `(§9.5)` reference in §16.5 → corrected to `(per §16.3)`.

### Applied (auto-applied technical, 5 findings + ripple updates)

- [auto] 1: Added `reclaimEligibility: 'eligible' \| 'disabled'` to `IdempotencyContract` (§8.1) + populated column in §8.2 registry table (all 8 write skills marked `eligible` with rationale block); §16A.8 takeover protocol gated on `reclaimEligibility === 'eligible'` with 50% budget rule + step 5 for `'disabled'` skills; new `skill.warn` reason `in_flight_reclaim_disabled` added to §18 + §18.1; §16A.1 + §16A.3 updated to reflect skill-gated takeover; new ACs 35 + 36 for declared-eligibility + disabled-surfacing manual test; new deferred item for heartbeat-extending takeover variant in §21; jsdoc on `IDEMPOTENCY_CLAIM_TIMEOUT_MS` rewritten to explain budget rule + the `'disabled'` opt-out; §16A.8 operational note reframed.
- [auto] 2: Rewrote AC #15 to specify `invoice_id` for `send_invoice` + call out `generate_invoice` separation; rewrote §9.6 manual test (line 1126) the same way.
- [auto] 3: Updated four legacy sites (lines 110 re-use table, 176 file inventory, 1112 §9.4 trailing sentence, §15.2 contract block) to enumerate all three deny reasons; AC #16 + line 1189 deliberately preserved as `manager_role_violation` (non-allowlisted-skill test path).
- [auto] 4: Added `assertRlsAwareWrite('skill_idempotency_keys')` to the §16.3 cleanup-job loop (per-batch); updated §16.5 to acknowledge cleanup uses raw SQL too; updated §16.4 checklist row; updated §9.6 verification list; updated AC #22 to mention both raw-SQL write paths; corrected stale `(§9.5)` forward reference to `(per §16.3)`.
- [auto] 5: Renamed `T1_OR_T2` → `ALLOWED_T1_T2_PARENTS` in §13.4; rewrote the inline comment to drop the "Managers in v7.1" claim and explain that the set is T1 + T2-agents-that-own-workers (with explicit note that admin-ops-agent is `role: staff` and is included as future-proofing); updated trailing log line + error message.

---

## Round 3 — 2026-04-27T02-33-34Z (FINAL)

### ChatGPT Feedback (raw)

> What looks clean: reclaimEligibility split is the right fix. KeyShape consistency is now tight. Manager guard is now internally consistent. RLS + raw SQL alignment is properly justified and enforced. Hierarchy naming fix removes conceptual ambiguity. No structural contradictions left.
>
> Final 3 things to tighten (worth doing):
>
> 1. **Reclaim eligibility needs an explicit default rule.** Right now you've marked the 8 skills as eligible, but the system still relies on discipline for future skills. Add: Default for any new skill = `reclaimEligibility: disabled`; enabling requires explicit justification in the registry (or PR note). Why: prevents a future dev from accidentally inheriting "eligible" and reintroducing the double-fire class of bugs.
> 2. **"No external side-effect before claim" needs a test hook.** You've defined the invariant, but enforcement is currently conceptual. Add: wrapper asserts claim success BEFORE invoking skill handler; in test mode, inject a hook that throws if handler runs without claim. Why: this is one of your highest-impact invariants. Without a test hook, it can regress silently.
> 3. **Failed rows = terminal needs one explicit operator path.** That's correct for system integrity, but operationally incomplete. Add: operators may retry by issuing a new key via re-dispatch with regenerated key, or manual override pathway (if exists). Why: prevents ambiguity during incident handling. Otherwise someone will try to "fix" the row in-place and break invariants.
>
> Optional but high-leverage: Add a single "Idempotency Guarantees Summary" block consolidating key uniqueness scope, claim semantics, reclaim rules, terminal failure behaviour, side-effect ordering guarantee. Why: spread across multiple sections; this makes future audits and onboarding faster and reduces drift risk.
>
> Verdict: production-grade on the spec. No correctness gaps. No conflicting rules. Edge cases covered. Failure modes explicitly handled. If you apply the 3 tightenings above, this becomes reference-quality and resistant to future regression.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| 1 | Default `reclaimEligibility: 'disabled'` for new skills + require explicit justification to enable | technical | apply | auto (apply) | medium | Real future-proofing gap. Current §8.1 JSDoc said `'eligible' (default)` — exactly the inverse of safe-by-default for a double-fire-class invariant. Inverting the default + strengthening pre-flight to refuse the omission AND require a justification annotation when declaring `'eligible'` closes the regression-by-inheritance class. Low risk: the 8 current write skills are already explicitly declared `'eligible'` with the runtime-budget rationale block (§8.2). User explicitly relaxed escalation for this round. |
| 2 | Test hook for "no external side-effect before claim" invariant | technical | apply | auto (apply) | medium | Real enforcement gap. The static `verify-no-direct-adapter-calls.sh` gate covers HTTP-bearing adapters but a handler can still issue a side effect inline through a non-adapter code path the gate doesn't see. A pure-function test-mode predicate (`assertHandlerInvokedWithClaim(claimed)`) gives the highest-impact invariant runtime teeth without violating the `runtime_tests: pure_function_only` posture. Defence-in-depth pair: gate + test hook. |
| 3 | Operator recovery path for failed=terminal | technical | apply | auto (apply) | medium | Real operational gap. Without a sanctioned path, an incident-stressed operator improvises and breaks invariants (in-place UPDATE of `status`, manual flip to `in_flight`, etc.). Two-path explicit clause (re-dispatch with new key = preferred; row DELETE + runbook log = last resort) + explicit list of forbidden actions removes the ambiguity. |
| 4 | Idempotency Guarantees Summary consolidation block | technical | apply | auto (apply) | low | Optional but high-leverage per ChatGPT. Idempotency rules currently span §§8.1, 8.1.1, 8.2, 9.3.1, 9.4, 13.2, 16.3, 18, 18.1, 21 — scattered enough that an auditor or future contributor can miss a guarantee. Single read-once table at the top of §16A consolidates "what is guaranteed / where it is established / where it is enforced". No risk; reduces drift risk. |

### Post-edit integrity check

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

Validation pass:
- All new symbols defined where introduced: `assertHandlerInvokedWithClaim` and `SideEffectBeforeClaimError` defined in §16A.1 runtime test-mode contract block; `registry-default rule` introduced in §8.1 IdempotencyContract JSDoc and re-stated in §8.2 ("Default for new skills") + §13.2 pre-flight (sixth assertion bullet).
- All cross-references resolve: §16A.0 references AC #22, #25, #27, #29, #31, #32, #35, #36, #37 — all exist; §8.1 → §13.2 → §8.2 → §16A.0/§16A.1/§16A.7/§16A.8 chain consistent; §23 testing posture updated to enumerate the 4 pure helpers (`hashKeyShape`, `ttlClassToExpiresAt`, `canonicaliseForHash`, `assertHandlerInvokedWithClaim`).
- Wrapper code-snippet consistency: §9.3.1 closing comment now calls `assertHandlerInvokedWithClaim(isFirstWriter)`; §16A.1 example call site corrected from literal `true` to `isFirstWriter` so the example matches the live call site (avoids a documentation lie that would mask a future regression).
- AC list extended with #37 (test hook) and #38 (operator path) — both phrased as concrete pure-function / manual tests consistent with the §23 testing posture.
- §16A.0 column 3 ("Where it is enforced") audited: every guarantee row points at a code path or static gate. No documentation-only rows.
- TOC entry for §16A unchanged (sub-sections don't appear in the TOC by spec convention) — the new §16A.0 is reachable via §16A.

Post-integrity sanity: §16A.0 is a new section but introduces no new symbols (it consolidates existing guarantees). No empty sections. No broken links. The runtime-budget annotation requirement in §8.1 / §13.2 / §8.2 is consistent across all three sites.

### Applied (auto-applied technical, 4 findings)

- [auto] 1: Inverted the §8.1 IdempotencyContract `reclaimEligibility` JSDoc default from `'eligible'` → `'disabled'`; added the registry-default rule (mandatory pre-flight refusal of omission + explicit justification annotation requirement when declaring `'eligible'`); extended §13.2 verify-agent-skill-contracts.ts assertions with two new bullets (write-class skills must declare the field; `'eligible'` declarations must carry a runtime-budget annotation OR a `reclaimEligibility justification:` comment in the source); added "Default for new skills" subsection to §8.2 rationale block; rewrote AC #35 to include both the missing-field hard-fail manual test and the missing-justification hard-fail manual test.
- [auto] 2: Added §16A.1 "Runtime test-mode contract (mandatory)" subsection with the full `SideEffectBeforeClaimError` class definition, the `assertHandlerInvokedWithClaim` pure helper, three pure-function test cases, and a wrapper call-site code example; added the `assertHandlerInvokedWithClaim(isFirstWriter)` call into the §9.3.1 wrapper code snippet at the closing brace of the side-effect-bearing branch (with a trailing-comment cross-reference back to §16A.1); extended the §4.11c file-inventory description for `skillIdempotencyKeysPure.test.ts`; extended §23 testing-posture line; new AC #37.
- [auto] 3: Added §16A.7 "Operator recovery path (mandatory)" subsection — two sanctioned paths (re-dispatch with new key = preferred; explicit row DELETE + runbook log = last resort) and three explicit forbidden actions (status UPDATE, request_hash/response_payload mutation, bulk date-clearing); new AC #38.
- [auto] 4: New §16A.0 "Idempotency guarantees summary (audit-friendly consolidation)" 9-row table with columns Guarantee / What it says / Where it lives / Where it is enforced; closing "How to extend this table" rule binding future amendments to (a) row here + (b) section reference + (c) gate reference.
