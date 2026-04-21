# Spec Review HITL Checkpoint — Iteration 2

**Spec:** `tasks/hermes-audit-tier-1-spec.md`
**Spec commit:** `947111d0ddb919023ddb7bdfd58af8579197499a` + iteration 1 HITL (Option B for framing-deviation) + iteration 2 mechanical fixes (6 findings auto-applied, uncommitted)
**Spec-context commit:** `00a67e9bec29554f6ca9cb10d1387e7f5eeca73f`
**Iteration:** 2 of 5
**Timestamp:** 2026-04-21T01:57:28Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 3 until every finding below is resolved. Resolve by editing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 2.1 | `trajectoryPassed` read path is under-specified | Where does `trajectoryPassed` come from for the minority of runs that have a reference trajectory? | Option A — commit to always-`null` for Phase B; defer the read path to a follow-up spec alongside the Tier 2 trajectory work. | Simplest; matches the cohort that matters operationally (organic runs always null). Keeps the §6.5 matrix rows with `trajectoryPassed=true` as forward-compatible stubs that activate automatically when a future spec wires a verdict. |
| 2.2 | `qualityScoreUpdater='outcome_bump'` is blocked by a CHECK constraint and a BEFORE UPDATE trigger | Widen the schema to permit the new value, or drop the distinction and reuse `'initial_score'`? | Option A — drop the `'outcome_bump'` value and reuse `'initial_score'` for Phase B writes; signal outcome-boost-ness through `provenanceConfidence` (already in the spec) and the new §8.5 `memory.insights.outcome_applied` log. | Pre-production framing + "no schema change" explicit non-goal weigh heavier than audit granularity. The distinction is recoverable from `provenanceConfidence` + log events without widening the CHECK. |
| 2.3 | "One-call-cost overshoot max" invariant is asserted without a serialization mechanism | Relax the invariant to "bounded by N concurrent inflight", or introduce a per-run advisory lock? | Option A — relax the invariant claim and weaken the §9.3 concurrency test to match; add a one-paragraph note in §7.4 naming the residual overshoot window and the Tier 2 / Tier 3 follow-up as the place to strengthen it. | Pre-production framing; no live cost at stake today. Introducing a per-run advisory lock is a new architectural primitive for a spec that was scoped as "wire existing primitives". Relaxing the claim is the smaller spec delta and faithful to what the implementation will actually enforce. |

---

## Finding 2.1 — `trajectoryPassed` read path is under-specified

**Classification:** ambiguous → directional
**Signal matched:** Architecture signals — "Introduce a new abstraction / service / pattern" (option B would introduce a persisted-verdict path). Also under-specified load-bearing input.
**Source:** Codex P1 #5
**Spec sections:** §4.5 (`trajectoryService.ts` not modified), §6.4 (`trajectoryPassed` is read from "the nearest trajectoryService evaluation"), §8.3 (`RunOutcome.trajectoryPassed: boolean | null`)

### Finding (verbatim)

> `P1` — `§6.4` / `§8.3` treat `trajectoryPassed` as an already-available read-only signal, while `§4.5` says `trajectoryService.ts` stays untouched. In the repo, `trajectoryService` only exposes `loadTrajectory()` and `compare()`; there is no persisted verdict or named read contract for "nearest trajectory evaluation". This is a load-bearing input with no source.

Verified by reading `server/services/trajectoryService.ts` — only `loadTrajectory(runId)` + `compare(actual, expected)` + `formatDiff(diff)` are exported. No persisted verdict per run. The §6.5 matrix has three rows keyed on `trajectoryPassed === true` (success × true) and three rows keyed on `trajectoryPassed === false` (success × false demotion paths), making the field load-bearing for promotion/demotion semantics.

### Recommendation

**Option A — commit to always-`null` for Phase B and defer the read path.**

Concrete edits:

1. **§6.4** — change "`trajectoryPassed` is sourced from the nearest `trajectoryService` evaluation for the run if one exists, else `null`" to "`trajectoryPassed` is always `null` in Phase B. No trajectory-verdict persistence exists today (`trajectoryService` exposes only `loadTrajectory` and `compare`); Phase B passes `null` unconditionally. The §6.5 matrix rows keyed on `trajectoryPassed === true/false` remain in the spec as forward-compatible stubs that activate once a future spec lands a persisted verdict (see §11.4 deferred item #6)."
2. **§6.5 matrix header** — add a note: "Until the trajectory-verdict persistence lands (§11.4 #6), `trajectoryPassed` is always `null`, so only the `trajectoryPassed: null` rows apply in Phase B. The `true`/`false` rows are forward-compatible."
3. **§8.3** — keep `trajectoryPassed: boolean | null` in the `RunOutcome` type (forward-compatible) but add a JSDoc comment: "Always `null` in Phase B — see §6.4."
4. **§9.2 tests** — the `workspaceMemoryServicePure.test.ts` suite still covers all rows of the matrix (the pure helper accepts any value, including `true`/`false`), so the full decision matrix stays pinned. The integration sanity check only exercises the `null` paths.
5. **§10 sanity walk** — step 3 should NOT mention `trajectoryPassed=true` — just assert the success-case memory entries.
6. **§11.4 #6** — expand the deferred-item note: "Phase B defines the contract (`RunOutcome.trajectoryPassed: boolean | null`) but passes `null` unconditionally because no per-run verdict is persisted today. A future spec persists the `compare()` verdict for runs with a reference trajectory, at which point Phase B's promotion/demotion rows for `trajectoryPassed=true/false` become live."

Alternative options:

- **Option B — name a specific persistence mechanism now.** Add a new table or a column on `agent_runs` storing the `TrajectoryDiff.pass` verdict. Phase B reads from it. Requires migration + `trajectoryService.ts` modification (violates §4.5). Scope-expands Phase B from "thread an outcome through one function" to "add trajectory persistence + threading". Kick to Tier 2.
- **Option C — drop `trajectoryPassed` from `RunOutcome` entirely.** Delete the parameter and all §6.5 rows keyed on it. Removes ~6 matrix rows and ~3 tests. Simplifies the spec but loses the forward-compatibility shape Option A preserves at near-zero cost.

### Why

- **Pre-production framing.** There is no production cohort that has a reference trajectory today — IEE integration tests use it, organic agent runs don't. Phase B is shipping to a codebase with zero live trajectory verdicts; deferring the read path costs nothing in the near term.
- **Smallest spec delta.** Option A adds ~4 sentences across 4 sections and removes no existing logic. Option B requires a new table + service mod + migration. Option C deletes matrix rows and tests.
- **Forward-compatibility preserved.** `RunOutcome.trajectoryPassed: boolean | null` stays in the shape. When Tier 2 lands trajectory persistence, the caller switches from `null` to the real value without changing the Phase B contract. Pure tests still exercise `true`/`false` rows (they accept arbitrary values).

### Classification reasoning

Option B introduces a new persistence mechanism — architecture signal. Option A is a scope deferral — scope signal. Picking between them is a product-direction call.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`.

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

---

## Finding 2.2 — `qualityScoreUpdater='outcome_bump'` blocked by CHECK constraint + trigger

**Classification:** directional
**Signal matched:** Scope signals — "Add this item to the roadmap" (a migration) OR "Remove this item from the roadmap" (drop the distinction). Also Architecture signals — changes the DB-level contract.
**Source:** Codex P1 #6
**Spec sections:** §3 (Out of scope: "New database tables or columns"), §4.5 (`workspaceMemories.ts` not modified), §6.5 (matrix assigns `'outcome_bump'` updater), §6.7 (provenance fields), §8.4 (DB field usage table)

### Finding (verbatim)

> `P1` — `§6.5`, `§6.7`, and `§8.4` require `qualityScoreUpdater='outcome_bump'`, but `§4.5` says `server/db/schema/workspaceMemories.ts` is not modified and there is no schema change. The current schema type only allows `'initial_score' | 'system_decay_job' | 'system_utility_job'`, and its comments say the DB trigger enforces allowed updater values. As written, Phase B cannot persist the new value.

Verified by reading `server/db/schema/workspaceMemories.ts:164-165` (column type: `'initial_score' | 'system_decay_job' | 'system_utility_job'`) and `migrations/0150_pr_review_hardening.sql:21-24` (CHECK constraint) and `migrations/0150_pr_review_hardening.sql:72-98` (BEFORE UPDATE trigger). Both the CHECK and the trigger hardcode the same three-value set. Insert of `'outcome_bump'` fails the CHECK; UPDATE with quality_score change + `'outcome_bump'` fails the trigger.

### Recommendation

**Option A — drop the `'outcome_bump'` distinction; reuse `'initial_score'` for Phase B writes.**

Concrete edits:

1. **§6.5** — footnote under the matrix: "`qualityScoreUpdater` is set to `'initial_score'` at insert time (same as non-Phase-B writes). Outcome-driven boosts are distinguished post-hoc via `provenanceConfidence` (§6.7) and the new `memory.insights.outcome_applied` log event (§8.5) rather than via a dedicated updater tag. Auditors reconstruct 'was a modifier applied' by joining `workspace_memory_entries.provenanceConfidence` against the pure baseline from `scoreMemoryEntry`."
2. **§6.5** — change the "Quality score modifier" column header to "Quality score modifier (applied on top of baseline)"; values unchanged.
3. **§6.7** — change "`qualityScoreUpdater`: `'outcome_bump'` when a modifier was applied, else `'initial_score'`" to "`qualityScoreUpdater`: always `'initial_score'` at insert (matches pre-Phase-B behaviour and the existing CHECK constraint). Outcome-driven boosts are surfaced through `provenanceConfidence` (0.9 / 0.7 / 0.5 / 0.3 per outcome) and the `memory.insights.outcome_applied` log event (§8.5)."
4. **§8.4 DB field usage table** — `qualityScoreUpdater` row: "`'initial_score'` unconditionally | `'initial_score'` unconditionally (unchanged). Outcome-bump audit trail lives in `provenanceConfidence` + log events, not in the updater tag."
5. **§9.2 Phase B sanity check** — remove the `qualityScoreUpdater='outcome_bump'` assertion; keep `qualityScore ≥ 0.6`, `isUnverified=false`, `provenanceConfidence=0.7 or 0.9`.
6. **§10 verification plan** — same edit in step 3.

Alternative options:

- **Option B — ship a migration that widens CHECK + relaxes the trigger to permit `'outcome_bump'`.** Directly violates §3 ("no new columns or tables") and §4.5 ("migrations/ — no new migration files"). Also violates `docs/spec-context.md` default (`migration_safety_tests: defer_until_live_data_exists`). Re-introduces the audit tag but expands spec scope.
- **Option C — ship Phase B without any score modifier.** Eliminate the `+0.20` / `+0.15` / `+0.10` bumps entirely; only change entryType promotion/demotion and `provenanceConfidence`. Loses the "successful runs write higher-quality entries that survive decay longer" benefit — one of the three headline Phase B deliverables.

### Why

- **Pre-production "no schema change" is explicit in the spec and in the framing.** §3 Out-of-scope lists "new database tables or columns". §4.5 lists `workspaceMemories.ts` as not modified. `docs/spec-context.md` has `migration_safety_tests: defer_until_live_data_exists`. Option B reopens that scope question.
- **The audit distinction is recoverable without the updater tag.** `provenanceConfidence` values are already keyed by outcome. The new `memory.insights.outcome_applied` log event records the modifier per run. Together they answer "was this entry written with an outcome modifier?" at post-hoc audit time.
- **Option C over-corrects.** The score bumps and the updater tag are two separate audit dimensions. Option A keeps the bumps; only the updater-tag distinguisher goes away.

### Classification reasoning

Option B is a new migration = scope expansion (directional). Option A is a spec-level audit-dimension change with ripple through §6.5 / §6.7 / §8.4 / §9.2 / §10 — not a single mechanical tidy-up. Option C removes load-bearing behaviour. All three are directional.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 2.3 — "One-call-cost overshoot max" invariant asserted without serialization mechanism

**Classification:** directional
**Signal matched:** Architecture signals — "Introduce a new abstraction / service / pattern" (option B: advisory lock). Also Scope signals — "Split this item into two" (relax the invariant; defer the stronger form to Tier 2).
**Source:** Codex P1 #7
**Spec sections:** §7.4 (ordering invariant reasoning), §7.4.1 (data-source contract), §9.3 (concurrency test asserts "at most 2 calls succeed, at least 1 throws" for 3×40c on 100c cap)

### Finding (verbatim)

> `P1` — `§7.4.1`, `§7.9`, and `§9.3` claim the direct-`llm_requests` read preserves a "one-call-cost overshoot max" invariant, but the described implementation is still plain post-insert `SUM(...)` with no per-run lock/serialization. Under concurrency, multiple calls can commit before any breaker check runs, so overshoot can exceed one call. The invariant is stated, not enforced.

Analysis: without a per-run serialization mechanism, N concurrent calls can interleave `INSERT INTO llm_requests` + `SELECT SUM(...)` sequences such that some reads occur before all writes commit. A concurrent request that reads-before-write sees only its own cost plus earlier-committed costs, not the total inflight. The breaker can pass several concurrent calls that together exceed the cap by more than one call's cost. §7.4 point 2 ("the Nth request is guaranteed to trip") is only true under serial execution.

### Recommendation

**Option A — relax the invariant and update §9.3 test accordingly.**

Concrete edits:

1. **§7.4 point 2** — replace "Post-write, each concurrent request's own cost row is visible to the check, and the Nth request is guaranteed to trip" with: "Post-write, subsequent serial requests see the accumulated spend and trip reliably. Under **concurrent** load, up to N inflight calls on the same run may each commit before any breaker check runs, so the worst-case overshoot is bounded by the sum of the concurrent batch's cost. The breaker still trips reliably for the next call that starts after the concurrent burst settles. This is acceptable for pre-production and is tracked as §11.4 follow-up."
2. **§7.4.1 (end of section)** — add: "**Residual concurrency window.** Even with the direct-`llm_requests` read, there is no per-run serialization. Concurrent calls may collectively overshoot by up to the inflight batch size × per-call cost. Strengthening this requires a per-run advisory lock (PostgreSQL `pg_advisory_xact_lock(hashtext(runId))`) wrapping the insert-and-check sequence, or moving the breaker check into the same transaction as the ledger write with `SELECT ... FOR UPDATE` on an aggregate row. Both are out of scope for Phase C. Tracked as §11.4 #9."
3. **§9.3 concurrency test row** — rewrite: "Concurrent overshoot | 3 parallel calls on same run, each costs 40 cents, ceiling is 100 | After all three settle, the next call that starts on this run trips the breaker. The three concurrent calls themselves may all succeed (total spend up to ~120 cents) because no per-run serialization exists today. Assertion: subsequent serial call trips; total spend does not unboundedly exceed ceiling; no test asserts a specific overshoot bound across the concurrent batch."
4. **§11.4 Deferred items** — add item #9: "**Per-run cost-breaker serialization.** Phase C's breaker check runs post-ledger-write without a per-run lock. Under concurrent inflight calls on the same run, collective overshoot is bounded by the inflight batch, not by one call's cost. When live traffic makes this material, add `pg_advisory_xact_lock(hashtext(runId))` around the insert-and-check sequence, or move the assertion into the same transaction as the ledger write with `SELECT ... FOR UPDATE`. Same strengthening applies to `sendToSlackService` and `transcribeAudioService` for consistency."
5. **§11.3 risks row** — update to: "Current mechanism bounds overshoot by the inflight batch, not by one call. Acceptable pre-production; mitigation is §11.4 #9."

Alternative options:

- **Option B — introduce a per-run advisory lock now.** Wrap the post-write breaker check in `pg_advisory_xact_lock(hashtext(runId))`. Genuinely enforces the one-call invariant. Adds a new dependency on advisory locks in the router hot path (lock-wait semantics, integration testing against pg-boss workers and `withOrgTx`). Bigger Phase C than scoped.
- **Option C — keep the invariant claim and mark the test as flaky / skip the concurrency test.** Rejected — the spec must not lie about an invariant.

### Why

- **Pre-production framing.** No live traffic; no cost at stake from an overshoot today. Introducing an advisory lock for a problem with no current blast radius is premature.
- **The primary protection still works.** A runaway serial loop trips the breaker on the next call after the ledger write — that is the dominant runaway pattern and Phase C catches it. Concurrent fan-out on the same run is rare (agent execution is largely sequential).
- **Option B is a new primitive in the router hot path.** Advisory locks have distinct failure modes (deadlock sensitivity, lock-wait queuing). Tier 2 concern, not Tier 1 tidy-up.
- **Option C is not honest.** Spec-level invariants must be enforceable by the described implementation.

### Classification reasoning

Option B introduces a new primitive (advisory lock) — architecture signal. Option A relaxes a load-bearing invariant — scope signal ("Defer this until later"). Both are directional.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing all `Decision:` lines below:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision, and continue to iteration 3.

If you want to stop the loop without resolving findings, set any decision to `stop-loop` and the loop exits immediately after honouring the `apply` / `apply-with-modification` decisions.

---

## Mechanical findings applied this iteration (FYI, no decision needed)

The following iteration-2 findings were classified as mechanical and auto-applied before this checkpoint was written. They do not block on the human. Full detail in `tasks/spec-review-log-hermes-audit-tier-1-2-2026-04-21T01-57-28Z.md`.

1. **§4.2 derivation contradiction (Codex P1 #1)** — agentExecutionService.ts row rewritten to match §6.3's canonical truth table (cancelled → failed, non-terminal → null).
2. **`TERMINAL_RUN_STATUSES.has()` won't compile (Codex P1 #2)** — all caller snippets and §5.2.1 helper paragraph now use `isTerminalRunStatus(run.status)`.
3. **Second `extractRunInsights` caller (Codex P1 #3)** — §4.2 gains an `outcomeLearningService.ts` row; §6.4 rewritten to list both callers with the neutral outcome for the review-edit path; §8.6 wording updated.
4. **`agentRunFinalizationService.ts` missing from §4.2 (Codex P1 #4)** — file added to §4.2 with the shared `computeRunResultStatus` wiring instruction; §6.3.1 tightened to point at lines 259/278 and the shared helper; §4.2 totals updated.
5. **§6.7.1 `needsCorroboration` fallback contradicts §3 / §4.5 (Codex P2 #8)** — fallback rewritten to forbid the new-column path and require consumer-side fixes or deferral.
6. **§11 retired production framing (Codex P2 #9)** — §11.1 / §11.2 / §11.3 / §11.5 rewritten for pre-production `commit_and_revert` posture (no production queries, no week-after observation, no staged deploy language).
