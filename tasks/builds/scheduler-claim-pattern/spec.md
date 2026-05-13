# Stub: Scheduler claim-pattern refactor (Phase 4)

**Trigger to activate:** Per the original D.6 advisory item — when the locked-tick approach produces a real held-lock-duration incident OR when LLM / HTTP I/O inside `tick()` extends past the lock's acceptable wall-clock budget.

**Scope (one paragraph).** Refactor `automationSchedulerService.tick()` (~1000 lines) from "wrap whole body in `pg_advisory_xact_lock` + `db.transaction`" (Option A, locked in pre-launch-phase-3-deferred-backlog §8.2) to a claim-then-execute pattern: hold the lock just long enough to (1) acquire it, (2) claim the next batch of due work via a durable claim record, (3) enqueue the resulting jobs — then release the lock and run job execution outside the lock. Spec must cover: durable claim state (claim table or claim columns on the existing job table), lease semantics (TTL + heartbeat), crash-recovery (claimed-but-not-executed jobs), idempotency on re-claim, and interaction with existing dedupe/retry logic. ChatGPT-plan-review round 1 Finding 2 framed the trade-off; this stub is the spec home when the trigger fires.

**Origin:** D.6 advisory-lock refactor in legacy `tasks/todo.md`.
