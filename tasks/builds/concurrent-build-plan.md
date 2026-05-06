# Concurrent Build Coordination — Two Streams

**Last revised:** 2026-05-04 (post-merge of Workflows v1 Phase 2 / PR #258 + Module C OAuth ship via PR #254)

This file is now an **index**. The detailed orchestration lives in the per-stream build plans. Don't restate spec content here.

## Stream plans

| Stream | Plan | Goal |
|--------|------|------|
| **Stream 1 — Sub-account onboarding scope** | [`stream-1-onboarding-scope/plan.md`](./stream-1-onboarding-scope/plan.md) | F1 (sub-account artefacts) → F3 (baseline capture) sequentially. ~16-19 dev-days. |
| **Stream 2 — Optimiser finish** | [`stream-2-optimiser-finish/plan.md`](./stream-2-optimiser-finish/plan.md) | F2 Phases 1-4 (the optimiser agent, telemetry rollups, dashboard wiring). Phase 0 already shipped on main. ~3 dev-days. |

The two streams are **fully orthogonal** — different files, different services, different scope. Zero coordination required between them beyond final merge to main.

## Spec status snapshot (2026-05-04)

| Spec | File | Status |
|------|------|--------|
| F1 — Sub-account baseline artefact set | `docs/sub-account-baseline-artefacts-spec.md` | DRAFT — pending `spec-reviewer`. Owns Stream 1 sub-stream A. |
| F2 — Sub-account optimiser meta-agent | `docs/sub-account-optimiser-spec.md` | Phase 0 SHIPPED on main (PR #251); §9 Phases 1-4 PENDING. Owns Stream 2. |
| F3 — Baseline capture | `docs/baseline-capture-spec.md` | DRAFT — pending `spec-reviewer`. Owns Stream 1 sub-stream B. **Module C OAuth blocker resolved via PR #254 (2026-05-03)** — F3 now ships at scale from day 1. |
| F4 — Agency-readiness audit (deferred) | `docs/agency-readiness-audit-deferred.md` | Deferred placeholder. Not in either stream. |

## Migration allocation (revised)

Last shipped migration on main: **0276**. Allocations:

| Migration | Owner | Stream | Status |
|-----------|-------|--------|--------|
| 0277 | F1 schema | Stream 1A | Reserved |
| 0278 | F3 — `subaccount_baselines` | Stream 1B | Reserved |
| 0279 | F3 — `subaccount_baseline_metrics` | Stream 1B | Reserved |
| 0280 | F3 — RLS + canonical dictionary | Stream 1B | Reserved |
| 0281 | F2 Phase 1 — peer-medians materialised view | Stream 2 | Reserved (clean integer in place of the spec's `0267a` placeholder) |

**At each phase that adds a migration, run `ls migrations/`** to confirm the next free number. Main moves; reservations may need a small bump.

## Branches and worktrees

| Stream | Branch | Worktree |
|--------|--------|----------|
| Stream 1 | `claude/stream-1-onboarding-scope` | `../automation-v1.stream-1-onboarding-scope` |
| Stream 2 | `claude/stream-2-optimiser-finish` | `../automation-v1.stream-2-optimiser-finish` |

## Final integration

- Stream 1 produces 2 PRs (F1, F3) on the same branch — F1 merges first, then F3 rebases.
- Stream 2 produces 1 PR (F2 finish) on its own branch.
- Both streams merge to main independently. No interleaving required.

After both streams ship, `tasks/current-focus.md` returns to NONE. KNOWLEDGE.md gets one consolidated entry per stream noting any patterns learned.

## Historical (superseded)

The pre-2026-05-04 version of this file proposed three concurrent worktrees (one per spec) with migrations 0266-0270. That model has been superseded:
- Migrations 0266-0270 were consumed on main (Module C took 0268-0269; Workflows v1 took 0270).
- F2 Phase 0 shipped while we were focused elsewhere — F2 is now Phases 1-4 only.
- Module C OAuth shipping unblocks F3 — but F3 still needs F1's onboarding-service extension to land first.
- The actual coupling (F1→F3 hard sequence; F2 fully orthogonal) maps cleaner to two streams than to three.
