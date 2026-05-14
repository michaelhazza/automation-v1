# ADR-0011: Operator Backend — chain-resume and persistent profile required in V1

**Status:** accepted
**Date:** 2026-05-12
**Domain:** operator backend, execution infrastructure
**Supersedes:** _(none)_
**Superseded by:** none

## Context

The Operator Backend spec (`docs/superpowers/specs/2026-05-12-operator-backend-spec.md`) introduced a new `operator_managed` execution adapter. Two design decisions — D8 (chain-resume) and D11 (persistent browser profile) — were flagged in the brief as potentially deferrable.

D8 (chain-resume): because a single operator session runs for at most 120 minutes before the provider's session hard cap is reached, multi-hour tasks must span multiple sequential chain links. Without a chain-resume mechanism, a task that exceeds 120 minutes cannot complete — it either silently stops or requires manual re-dispatch by the user.

D11 (persistent profile): the operator runtime uses a browser profile that accumulates authentication state and site-specific cookies over the course of a long task. Without profile persistence across chain links, each chain link starts a cold browser with no prior authentication, requiring full re-login sequences on every continuation — which the automated operator cannot reliably navigate for protected sites.

Both decisions affect the V1 scope boundary. The alternative was to defer them to Phase 3.5 and ship the adapter with a 120-minute hard cap.

The decision was made in the Operator Backend spec at authoring time (`docs/superpowers/specs/2026-05-12-operator-backend-spec.md` § 1.4 Framing Assumptions, and the Phase 1 scope lock referenced in the plan at `tasks/builds/operator-backend/plan.md` Rev 2 invariants).

## Decision

We will ship chain-resume (D8) and persistent browser profile (D11) as required components of V1 — not deferred. The Operator Backend adapter will not be marked production-ready without both.

Concretely:

- **Chain-resume (D8):** One agent run spans 1..N chain links. The `operator_runs` table (`server/db/schema/operatorRuns.ts`) stores one row per chain link. The `operator-session-dispatch-next-chain-link` pg-boss queue (`server/services/operatorChainSchedulerService.ts`) drives continuation. The resume payload is composed by `server/services/operatorChainResumeService.ts` and includes the checkpoint, conversation-history pointers (K=5), and the original task brief. The dispatcher's optimistic UPDATE predicate (`status IN ('pending','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded')` — no `cancelled`) is the guard against race conditions.

- **Persistent profile (D11):** The `operator_task_profiles` table (`server/db/schema/operatorTaskProfiles.ts`) stores one profile per task attempt. Profile lifecycle (retention window, GC scheduling, debug-extend) is managed by `server/services/operatorTaskProfileService.ts`. The `operator-task-profile-gc` pg-boss queue handles deferred cleanup.

## Consequences

- **Positive:**
  - Tasks can run for hours to days without user intervention, which is the core value of the operator adapter.
  - Persistent profile means operators can reliably access authenticated sites across chain links without re-login.
  - The chain-resume model generalises: future adapters that require multi-session orchestration can reuse the same dispatch-continuation pattern.

- **Negative:**
  - V1 scope is larger than the minimal 120-minute-capped adapter would have been. This is accepted.
  - Profile storage adds operational overhead: GC scheduling, retention windows, and the `operator_task_profiles` table must be monitored.
  - Profile persistence introduces a new sensitive-data surface: the profile is a named browser state with authentication cookies. The 500 MB system-wide size cap is a V1 constant (`server/services/operatorTaskProfileServicePure.ts`).

- **Neutral:**
  - The `paused_wall_clock_exceeded` state is still non-resumable in V1 (user-cancel only). The chain-resume mechanism covers the normal case (soft cap approaching); wall-clock exceeded is an abnormal terminal state.
  - Per-subaccount profile-size-cap configuration is deferred to Phase 3.5. V1 uses the system-wide 500 MB constant.

## Alternatives considered

- **Defer D8 + D11 to Phase 3.5, ship with 120-minute hard cap.** Rejected. The adapter would be unusable for the real-world tasks it was designed for (multi-hour browser sessions). The first Plus-tier customer pilot would hit the 120-minute wall on their first real task, and the runbook cost of explaining "your task was cancelled because our platform doesn't support long tasks yet" was judged unacceptable for a launch. Without chain-resume, the "autonomous long-form task" pitch is not real.

- **Chain-resume without persistent profile.** Rejected. The operator runtime relies on accumulated browser state across chain links. Each cold-start causes authentication failures that the automated operator cannot recover from on protected enterprise sites. Profile persistence is the prerequisite for chain-resume to be useful in practice.

## When to revisit

- When the 500 MB system-wide profile-size cap becomes a production constraint (first signal: GC job latency rising, or customer requests larger cap). At that point, promote the cap to a per-subaccount configurable column in `subaccount_operator_settings`.
- When the K=5 conversation-history window proves too narrow or too wide based on production task data. The constant lives in `server/services/operatorConversationHistoryPure.ts`.
- When `paused_wall_clock_exceeded` resumes are requested by customers at scale. This is explicitly deferred to Phase 3.5 (`tasks/builds/operator-backend/plan.md` § B Out-of-scope, and spec § 11).

## References

- Spec: `docs/superpowers/specs/2026-05-12-operator-backend-spec.md` (§ 1.2, § 3.14, § 3.15, § 11)
- Plan: `tasks/builds/operator-backend/plan.md` (Rev 2 invariants, § A Architecture notes, § B Out-of-scope)
- Chain-resume service: `server/services/operatorChainResumeService.ts`
- Profile service: `server/services/operatorTaskProfileService.ts`
- Scheduler service: `server/services/operatorChainSchedulerService.ts`
- Schema — chain links: `server/db/schema/operatorRuns.ts`
- Schema — profiles: `server/db/schema/operatorTaskProfiles.ts`
