# Progress: Baseline Capture at Sub-Account Onboarding

**Spec:** `docs/baseline-capture-spec.md`
**Branch:** `claude/baseline-capture`
**Worktree:** `../automation-v1.baseline-capture`
**Migrations claimed:** `0268`, `0269`, `0270`
**Status:** PLANNING — spec drafted, not started

## Concurrent peers

- F1 `subaccount-artefacts` (migration 0266) — F1 must land first; both touch `subaccountOnboardingService.ts` (additive methods, no shared mutation)
- F2 `subaccount-optimiser` (migration 0267) — fully independent

## Critical upstream caveat

**GHL Module C OAuth is stubbed.** `server/routes/ghl.ts` callback is TODO. For sub-accounts with per-sub-account OAuth via `server/routes/oauthIntegrations.ts`, baseline capture works today. Agency-level scale is gated until Module C ships. Build proceeds regardless; coverage scales when Module C lands.

## Phases

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 — Schema (3 tables) | pending | Migrations 0268, 0269, 0270. ~3h. |
| Phase 2 — Readiness + sync-complete event | pending | Event emit + subscriber + daily fallback. ~5h. |
| Phase 3 — Capture service + retry/failure | pending | Per-metric readers + state machine + retry job. ~5h. |
| Phase 4 — Manual entry UI + admin reset | pending | Form + validation + sysadmin reset flow. ~4h. |
| Phase 5 — Reporting Agent delta integration | pending | Helper + portfolio report extension. ~3h. |
| Phase 6 — Verification + doc sync | pending | Lint, typecheck, manual run, docs. ~2h. |

## Decisions log

(empty — populate as build progresses)

## Blockers

- **Soft:** GHL Module C OAuth stubbed. Initial scope = per-sub-account-OAuth'd accounts only. File "GHL Module C OAuth completion" as separate Significant task.

## Out of scope (filed for later)

- Mailgun/Twilio/Google Business Profile metrics (no adapters; record as `unavailable`)
- MRR formula (Stripe adapter reads payments; deferred until proper subscription model)
- Recurring re-baseline (admin reset only for v1)
- Historical backfill (v1 = T0 only; full history lives in canonical_metric_history)
