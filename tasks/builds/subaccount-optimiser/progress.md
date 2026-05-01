# Progress: Sub-Account Optimiser Meta-Agent

**Spec:** `docs/sub-account-optimiser-spec.md`
**Branch:** `claude/subaccount-optimiser`
**Worktree:** `../automation-v1.subaccount-optimiser`
**Migration claimed:** `0267`
**Status:** PLANNING — spec drafted, not started

## Concurrent peers

- F1 `subaccount-artefacts` (migration 0266) — recommended to land first; `escalation.repeat_phrase` category gracefully degrades action hint without F1
- F3 `baseline-capture` (migrations 0268-0270) — fully independent

## Phases

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 — Schema + recommendation taxonomy | pending | Migration 0267 + RLS + canonical dictionary. ~4h. |
| Phase 2 — Telemetry rollup queries + cross-tenant median view | pending | 5 query modules + materialised view + nightly refresh job. ~6h. |
| Phase 3 — Optimiser agent definition + skills | pending | New AGENTS.md, 6 skills, schedule registration, backfill. ~5h. |
| Phase 4 — Recommendations digest UI | pending | Card, sidebar badge, agency-wide /recommendations page. ~4h. |
| Phase 5 — Brand-voice / phrase classifier | pending | Pure tokeniser, ≥3 occurrences threshold. ~3h. |
| Phase 6 — Verification + doc sync | pending | Lint, typecheck, manual run, cost check, docs. ~2h. |

## Decisions log

(empty — populate as build progresses)

## Blockers

(none)

## Out of scope (filed for later)

- Email / Slack notifications (in-app only for v1)
- ML-based brand-voice classification (keyword/phrase match for v1)
- Riley W3-dependent categories (`context.gap.persistent`, `context.token_pressure`) — wait for W3, then add as v1.1
