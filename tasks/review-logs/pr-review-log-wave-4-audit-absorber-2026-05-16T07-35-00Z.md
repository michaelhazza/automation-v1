# PR Review Log — wave-4-audit-absorber (Round 1)

**Branch:** `claude/wave-4-audit-absorber`
**Reviewed at:** 2026-05-16T07:35:00Z
**Spec:** `tasks/builds/wave-4-audit-absorber/spec.md` (commit 570e4364)
**Plan:** `tasks/builds/wave-4-audit-absorber/plan.md` (commit a0b61b5e)
**HEAD at review:** `14abc9fc`

Blocking: 1 / Should-fix: 5 / Consider: 3
**Verdict:** CHANGES_REQUESTED (1 blocking — cooperative-cancel status mismatch)

---

## 🔴 Blocking

[🔴] `server/services/agentExecutionLoop.ts:488` — Cooperative-cancel observer checks `parentRow?.status === 'cancelled'` but the cancel API at `server/services/agentRunCancelService.ts:86` writes `status: 'cancelling'`, never `'cancelled'` directly. The implementation of AE2 spec §5.2 step 8 (operator-initiated parent cancellation propagates cooperatively) is broken: when an operator cancels a parent that has spawned children, the parent transitions through `cancelling → cancelled` via its own loop observation, but children reading the parent status during that window see `cancelling` which fails the equality check. Children therefore continue running. Worse, the flow deadlocks-by-default: the parent's own agent loop cannot progress to write `cancelled` while it is blocked inside the `executeSpawnSubAgents` poll-loop waiting for children, and children won't exit cooperatively until the parent reaches `cancelled`.

Why: The spec's load-bearing lifecycle invariant relies on this status check working. Fix: widen the observer's check to `parentRow?.status === 'cancelled' || parentRow?.status === 'cancelling'`. Pair with the should-fix below so the parent's poll-loop also breaks out promptly. Update architecture.md:428 in the same commit.

---

## 🟡 Should-fix

[🟡] `handoff.ts:260-499` — Spawn poll-loop has no observer for its own cancellation status. Combined with the blocking finding, a cancelled parent can wait up to `context.timeoutMs` (default 300s). Add a status read inside the poll-loop before each `setTimeout` that breaks out with the `pending: [...]` shape if `agent_runs.status` becomes `cancelling`/`cancelled`.

[🟡] `handlerIdempotency.meta.test.ts:113-131` — Meta-test asserts `notYetWired.length > 0`, pinning v1 state where every handler is `null`. Spec §6.1 acceptance demands "every `handler_tested` queue passes the double-fire assertion." This matches the spec §6.1 step 6 explicit deferral declaration — operator-acknowledged deferral.

[🟡] `payloadRetention.tierBoundary.test.ts` and `costLedger.idempotency.test.ts` — Four integration tests call pure functions but are wrapped in `describe.skipIf(NODE_ENV !== 'integration')` so they never execute in default CI. Split each test file: pure assertions into sibling `describe(...)` blocks without skipIf.

[🟡] `pipeline.ts:178-187` — `makePgBossDb(tx: any)` reaches into Drizzle internal API (`tx._.session.client`). Add a first-call shape assertion that fails fast at boot if Drizzle's internal field shape shifts.

[🟡] `architecture.md:428` — Documentation claims "Operator-initiated parent cancellation (`agent_runs.status = 'cancelled'` via the cancel API)". Cancel API actually writes `cancelling`. Align doc with chosen pattern.

---

## 💭 Consider

[💭] `pipeline.ts:294` — `createEvent('agent.handoff.enqueued', ...)` happens after `db.transaction(...)` resolves. Add comment explaining post-commit ordering.

[💭] `agentRunCancelService.ts:121-139` — Cancel service emits `run.cancellation_requested` events, but no code consumes them. Either wire an event-aware fast path or document as audit-trail-only.

[💭] `handoffDurability.integration.test.ts:30-219` — Test file validates DB-schema presence rather than AE2 contract behavior. Matches spec §4 static_gates_primary deviation — operator-acknowledged deferral.
