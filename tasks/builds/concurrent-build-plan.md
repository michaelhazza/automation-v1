# Concurrent Build Coordination — Two Streams

**Last revised:** 2026-05-05 (Stream 2 SHIPPED PR #262; F1 SHIPPED PR #263; F3 migration numbers bumped)

This file is now an **index**. The detailed orchestration lives in the per-stream build plans. Don't restate spec content here.

## Stream plans

| Stream | Plan | Goal |
|--------|------|------|
| **Stream 1 — Sub-account onboarding scope** | [`stream-1-onboarding-scope/plan.md`](./stream-1-onboarding-scope/plan.md) | F1 COMPLETE (PR #263). F3 (baseline capture) is the only remaining sub-stream. ~5-6 dev-days. |
| **Stream 2 — Optimiser finish** | [`stream-2-optimiser-finish/plan.md`](./stream-2-optimiser-finish/plan.md) | **COMPLETE — PR #262 merged to main 2026-05-05.** 8 query modules + evaluators, `runOptimiserScan`, `optimiser-scan` queue, peer-medians view, dashboard wiring. |

The two streams are **fully orthogonal** — different files, different services, different scope. Zero coordination required between them beyond final merge to main.

## Spec status snapshot (2026-05-05)

| Spec | File | Status |
|------|------|--------|
| F1 — Sub-account baseline artefact set | `docs/sub-account-baseline-artefacts-spec.md` | **SHIPPED** — PR #263 merged to main as `c3beac0e` 2026-05-05. |
| F2 — Sub-account optimiser meta-agent | `docs/sub-account-optimiser-spec.md` | **SHIPPED** — PR #262 merged to main 2026-05-05. All phases complete. |
| F3 — Baseline capture | `docs/baseline-capture-spec.md` | DRAFT — spec migration numbers need bump (0278-0280 → 0280-0282) before build start. F1 dependency resolved. Ready to build. |
| F4 — Agency-readiness audit (deferred) | `docs/agency-readiness-audit-deferred.md` | Deferred placeholder. Not in either stream. |

## Migration allocation (as of 2026-05-05)

Last shipped migration on main: **0279** (`task_events`, Phase 1 PR #261). Next free: **0280**.

| Migration | Owner | Stream | Status |
|-----------|-------|--------|--------|
| `0277_oauth_state_nonces` | Phase 1 hardening (PR #261) | — | SHIPPED on main |
| `0277_optimiser_peer_medians` | Stream 2 (PR #262) | Stream 2 | SHIPPED on main |
| `0277_subaccount_baseline_artefacts` | F1 (PR #263) | Stream 1A | SHIPPED on main |
| `0278_oauth_state_pending_run` | Phase 1 hardening (PR #261) | — | SHIPPED on main |
| `0279_task_events` | Phase 1 hardening (PR #261) | — | SHIPPED on main |
| `0280` | F3 — `subaccount_baselines` | Stream 1B | Reserved |
| `0281` | F3 — `subaccount_baseline_metrics` | Stream 1B | Reserved |
| `0282` | F3 — RLS + canonical dictionary | Stream 1B | Reserved |

Note: the original reservation (0278-0280 for F3, 0281 for F2) was invalidated when Phase 1 consumed 0278-0279 and Stream 2 consumed a second 0277 slot. The three-way 0277 collision is on main and resolved — Drizzle handles it by full filename sort.

**At each phase that adds a migration, run `ls migrations/`** to confirm the next free number.

## Branches and worktrees

| Stream | Branch | Worktree |
|--------|--------|----------|
| Stream 1 | `claude/stream-1-onboarding-scope` | `../automation-v1.stream-1-onboarding-scope` |
| Stream 2 | `claude/stream-2-optimiser-finish` | `../automation-v1.stream-2-optimiser-finish` |

## Final integration

- Stream 1 produces 2 PRs (F1, F3) on the same branch — F1 merged (PR #263), F3 is next.
- Stream 2: **COMPLETE** (PR #262 merged to main 2026-05-05).

After F3 ships, `tasks/current-focus.md` returns to NONE. KNOWLEDGE.md gets a consolidated entry for F3 patterns.

## Historical (superseded)

The pre-2026-05-04 version of this file proposed three concurrent worktrees (one per spec) with migrations 0266-0270. That model has been superseded:
- Migrations 0266-0270 were consumed on main (Module C took 0268-0269; Workflows v1 took 0270).
- F2 Phase 0 shipped while we were focused elsewhere — F2 is now Phases 1-4 only.
- Module C OAuth shipping unblocks F3 — but F3 still needs F1's onboarding-service extension to land first.
- The actual coupling (F1→F3 hard sequence; F2 fully orthogonal) maps cleaner to two streams than to three.
