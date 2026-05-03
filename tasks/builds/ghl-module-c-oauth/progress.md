# Progress: GHL Module C — Agency-Level OAuth Flow

**Spec:** `docs/ghl-module-c-oauth-spec.md`
**Plan:** (created at build start by `architect`)
**Branch:** `claude/ghl-module-c-oauth`
**Worktree:** `../automation-v1.ghl-module-c-oauth`
**Migrations claimed:** `0268`, `0269`
**Status:** SPEC DRAFT — pending `spec-reviewer`

## Phases

| # | Phase | Status | Estimate |
|---|---|---|---|
| 0 | Spec review + dev-portal config (parallel) | pending | concurrent with build |
| 1 | Scope list + redirect-URI plumbing | pending | ~0.5d |
| 2 | Agency OAuth callback + token persistence | pending | ~2d |
| 3 | Sub-account enumeration + auto-enrol | pending | ~1.5d |
| 4 | Location-token helper + adapter rewire | pending | ~2d |
| 5 | Install / uninstall webhook side effects | pending | ~1d |
| 6 | Verification gate (Stage 6a trial → Stage 6b partner) | pending | ~1-2d each |

Total: ~8-10 dev-days + 1-2d real-agency verification.

## Decisions log

(append-only as decisions are made during the build)

## Blockers

(none yet)

## Out of scope (filed for later)

- Sub-account-level install fallback
- Marketplace public listing
- Re-consent flow for missing scopes (deferred to ClientPulse Phase 5)
- Pricing config UI / whitelabel branding

## Downstream consumers (waiting on this)

- F3 baseline-capture (`docs/baseline-capture-spec.md`)
- ClientPulse Phase 4+ intervention pipeline at scale
- Pulse-at-scale dashboards
