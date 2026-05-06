# Spec Review Log — Iteration 2 — ghl-module-c-oauth

- Spec: `docs/ghl-module-c-oauth-spec.md`
- Spec commit at start: 24c8e01f3cb3c4bd6f4546bc52ffb59565ae5da7
- Codex output: `tasks/review-logs/_codex_ghl_iter2_20260503T122834Z.txt`

## Codex findings — classification table

| # | Section | Issue | Class | Disposition |
|---|---|---|---|---|
| G1 | §5.2 vs §6 P4 | "4 risky methods" vs "9 methods rewired" | mechanical | auto-apply: list all 9 in §5.2, name the 2 exceptions explicitly |
| G2 | §5.6 vs §8 | new `ghlAgencyOauthService.ts` files conflict with "no new service file" | mechanical | auto-apply: clarify scope — callback flow stays in route module; new service files own enumeration/enrolment workflow |
| G3 | §6 P2 | "thin redirector keeping state-nonce" mixes initiation and callback | mechanical | auto-apply: rework §6 P2 — `ghl.ts` owns initiation+nonce, callback is generic |
| G4 | §6 P3 / §6 P5 | webhook 429 path "ack 200 so GHL retries" — 200 ≠ retry signal | mechanical | auto-apply: HTTP 503 on rate-limit-exhaustion to trigger GHL re-delivery |
| G5 | §5.4 / §6 P5 | webhook→orgId mapping not specified | mechanical | auto-apply: add "Webhook → org mapping" subsection with the exact `connector_configs` lookup |
| G6 | §5.2 / §6 P4 | location-token refresh shape underspecified | mechanical | auto-apply: pin `/oauth/token` with `grant_type=refresh_token`, in-place row update; soft-delete reserved for 401 path |
| G7 | §6 P4 / §7 | "register in `RLS_PROTECTED_TABLES` as part of migration 0269" — manifest is TS, not SQL | mechanical | auto-apply: reword "in the same commit as migration 0269" |
| G8 | §6 P2 / §8 | "extend existing token-refresh job" — no such job for `connector_configs` | mechanical | auto-apply: name the new path (`connectorConfigService.refreshIfExpired` invoked from `connectorPollingTick`); add `connectorPollingTick.ts` to §8 Modified |
| G9 | §10 / §5.2 / §6 P4 | Open question 1 ("which endpoints accept agency token") is now stale — spec already decided | mechanical | auto-apply: move to Resolved Decisions with the verification note |
| G10 | §5.4 / §6 P6 | `LocationCreate` event flow expected by 6a but no spec-defined side effect | mechanical | auto-apply: add LocationCreate side-effect bullet in §5.4 (single-location upsert via shared primitive) |
| G11 | §6 / §9 | mocked integration tests vs static-gates-primary posture | ambiguous → mechanical | auto-apply: reframe Done bullet — these are pure-function-equivalent tests with HTTP mocks (existing convention), name `npx tsx <path>` as the local check |
| G12 | §12 / §4 | re-consent enforcement point not named | mechanical | auto-apply: name `mapGhlAvailability` in `ghlAdapter.ts` as the gating point (verified: line ~504) |

## Iteration 2 Summary

- Mechanical findings accepted:  12 (G1–G12)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0 (G11 reclassified to mechanical)
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Files changed: 1 (`docs/ghl-module-c-oauth-spec.md`)
- Stopping-heuristic note: 0 directional / 0 ambiguous this round. If iteration 3 also returns 0 directional / 0 ambiguous, the stopping heuristic fires (two consecutive mechanical-only rounds = exit).
