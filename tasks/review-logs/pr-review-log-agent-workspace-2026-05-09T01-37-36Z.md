# PR Review (round 3 — §8.5 post-dual-reviewer re-review) — agent-workspace

**Reviewed:** 2026-05-09T01:37:36Z
**Branch:** `claude/add-agent-cloud-compute-Kb4ii` vs `origin/main` (HEAD `57334bec`)
**Spec:** `tasks/builds/agent-workspace/spec.md` (LOCKED)
**Plan:** `tasks/builds/agent-workspace/plan.md` (Rev 4)

**Re-review trigger:** dual-reviewer (`b7335b75`) applied 3 substantive fixes after pr-reviewer round 2 APPROVED. Per feature-coordinator §8.5, the post-dual-reviewer state must be re-reviewed.

**Verdict:** APPROVED (zero Blockers; 1 Strong carry-over — pre-existing spec semantic question, not a regression)

---

## Disposition of the 3 dual-reviewer fixes

| Fix | Status | Evidence |
|----|--------|----------|
| **1. Schema `.js` suffix** on agent-workspace re-exports | **CONFIRMED-CLOSED** | All 5 added re-exports use `.js` suffix matching surrounding ESM convention; production ESM build resolves correctly under Node's strict resolver. |
| **2. Stream-token scope-kind enforcement** on both SSE routes | **CONFIRMED-CLOSED** | All 4 scope-confusion vectors rejected (workspace token on agent route, agent token on workspace route, mismatched agent IDs, mismatched subaccount IDs). Symmetric, complete, uses canonical `throw { statusCode, message }` shape. |
| **3. Canonical event names + finalStatus discriminator** | **CONFIRMED-CLOSED** | `agentPresenceServicePure.ts` matches dotted `run.started` / `run.completed`; failure detection via `finalStatus !== 'completed'` payload discriminator on `run.completed`; 11 pure tests updated. Cross-checked against `AgentExecutionEventType` union, the production producer in `agentExecutionService.ts:1652`, and `agentWorkingTimeService.ts` (already dotted). Internally consistent. |

**Net:** 3/3 dual-reviewer fixes verified clean; no regressions.

---

## Regression scan (anything dual-reviewer's changes broke or weakened)

Searched all `server/` for residual underscored `run_*` event-name string literals on production paths. Two intentional retentions, no regressions:

1. `agentWorkingTimeServicePure.ts:92,94` — `accumulateWorkingTime` helper still matches `'run_completed'` / `'run_failed'`. **Intentional.** Pure helper called only by its own pure test. Production write path is `agentWorkingTimeService.ts` which uses dotted form. Spec §7.5 / §11.4 lists the underscored form for this helper's deferred Chunk 12 contract.

2. `agentOverviewAggregator.ts:124` — `subscribeFilesSnapshotInvalidators` includes `'run_completed'` in the `FILE_EVENT_TYPES` array. **Stub** — function emits only `cache_invalidation_subscriber_inactive` log lines today. Spec §9.1 line 1064 also uses underscored form. Implementation is **spec-conformant**; future wire-up will need to reconcile.

`step_started` / `step_completed` references (4 in pure helpers + 5 in consumer at `agentWorkingTimeService.ts:121-134`) are all consumer-side stubs awaiting Chunk 12 producer wiring. No producer emits these strings today; consumer code is dead-by-design. Spec uses underscored form throughout §7.5. Dual-reviewer P2.4 preserved this; correct call.

---

## Strong Recommendation (carry-over, surfaced not introduced)

### S-NEW — `finalStatus !== 'completed'` is a coarse failure discriminator
The pure resolver maps **any** `finalStatus` other than `'completed'` to presence state `failed`. The producer can emit `'completed' | 'completed_with_uncertainty' | 'failed' | 'timeout' | 'loop_detected' | 'budget_exceeded' | 'cancelled' | 'partial'`. The production incident-recording path at `agentExecutionService.ts:1759` only treats `'failed' | 'timeout' | 'loop_detected'` as terminal failure; others (`'partial'`, `'completed_with_uncertainty'`, `'cancelled'`, `'budget_exceeded'`) might more naturally land on presence `idle`.

Spec §11.4 acknowledges three categories (`success | partial | failed`) but the §12 closed presence enum has no `partial`. So `partial` MUST map to `idle` or `failed`. Current code maps to `failed` — deliberate-but-undocumented spec resolution.

This is **not a regression** — pre-fix, the resolver detected zero failures; post-fix, it detects all non-`completed` as failures. The new behaviour is strictly better than the old one. Suggested action: pin the spec resolution explicitly via a Vitest test, then narrow the discriminator if needed.

---

## Non-Blocking Improvements

- Reconcile `agentOverviewAggregator.ts:124` and spec §9.1 line 1064 against the canonical event-type union before the cache-invalidation subscriber is actually wired up (currently stub).
- Stricter discriminated-union type at `agentPresenceStreamToken.ts:14-18` (e.g. `{ kind: 'agent', agentId: string } | { kind: 'workspace', subaccountId: string }`) would let the compiler enforce the kind-vs-id-field invariant at the route-handler level. Cosmetic; defer.

---

## Verdict

**APPROVED** — all 3 dual-reviewer fixes CONFIRMED-CLOSED. No regressions. One Strong carry-over (pre-existing spec semantic question, surfaced not introduced). Parent may proceed to doc-sync gate and Phase 2 handoff.
