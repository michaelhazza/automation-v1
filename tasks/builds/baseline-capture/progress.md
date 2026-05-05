# Progress: Baseline Capture at Sub-Account Onboarding

**Spec:** `docs/baseline-capture-spec.md`
**Plan:** `tasks/builds/baseline-capture/plan.md`
**Branch:** `claude/baseline-capture`
**Worktree:** `../automation-v1.baseline-capture`
**Migrations claimed:** `0278` (subaccount_baselines), `0279` (subaccount_baseline_metrics), `0280` (RLS + canonical dictionary)
**Status:** READY TO START — plan authored 2026-05-05; F1 dependency merged (PR #263); migration numbers confirmed on main (high-water: 0277)

## Upstream dependencies

| Dependency | Status |
|---|---|
| F1 `subaccount-artefacts` (migration 0277) | **MERGED — PR #263, 2026-05-05** |
| GHL Module C OAuth (`connector_location_tokens`) | **SHIPPED — PR #254, 2026-05-03** |
| F2 `subaccount-optimiser` | Fully independent — no coordination needed |

## Phases

| Phase | Chunks | Status | Notes |
|-------|--------|--------|-------|
| Phase 1 — Schema (3 tables) | 1A, 1B, 1C | pending | Migrations 0278/0279/0280. ~5h. |
| Phase 2 — Readiness + sync-complete event | 2A, 2B | pending | Event emit + subscriber + daily fallback. ~5h. |
| Phase 3 — Capture service + retry/failure | 3A, 3B, 3C | pending | Per-metric readers + state machine + retry job + invariant tests. ~6h. |
| Phase 4 — Manual entry UI + admin reset | 4A, 4B | pending | Form + validation + sysadmin reset flow + page wiring (ship together). ~5h. |
| Phase 5 — Reporting Agent delta | 5 | pending | Helper + portfolio report extension. ~3h. |
| Phase 6 — Verification + doc sync | 6 | pending | Lint, typecheck, manual run, docs. ~2h. |

## Decisions log

(populate as build progresses)

## Blockers

None. All upstream dependencies resolved.

## Out of scope (filed for later)

- Mailgun/Twilio/Google Business Profile metrics (no adapters; record as `unavailable`)
- MRR formula (Stripe adapter reads payments; deferred until proper subscription model)
- Recurring re-baseline (admin reset only for v1)
- Historical backfill (v1 = T0 only; full history lives in canonical_metric_history)

## Deferred items from development

(populate if issues arise during build)
