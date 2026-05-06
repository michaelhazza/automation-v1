# Spec Review Log — Iteration 3 — ghl-module-c-oauth

- Spec: `docs/ghl-module-c-oauth-spec.md`
- Spec commit at start: f22588bfc94b65ee08ef9fa1993aed669afee07a
- Codex output: `tasks/review-logs/_codex_ghl_iter3_20260503T123501Z.txt`

## Codex findings — classification table

| # | Section | Issue | Class | Disposition |
|---|---|---|---|---|
| H1 | §5.4 | webhook→org lookup uses `(orgId, provider, companyId)` index but multiple orgs could in principle install same agency | mechanical | auto-apply: add **global** partial unique `(connector_type, company_id) WHERE token_scope='agency' AND status<>'disconnected'`; map cross-org collision to HTTP 409 |
| H2 | §6 P3 | "next polling tick" claim has no backing — no enrolment-retry job exists | mechanical | auto-apply: drop the polling-tick claim; rely on the redundant INSTALL webhook + operator manual recovery |
| H3 | §6 P3 / §5.4 | webhook 503 only safe if dedupe row commits AFTER side effects | mechanical | auto-apply: state explicitly that dedupe commits after side-effect success; failed paths leave `webhookId` absent so GHL retry runs |
| H4 | §8 / §9 | mocked-HTTP test files referenced by phases not in §8 inventory | mechanical | auto-apply: add 3 in-process test files (oauth, location-token, webhook side-effect) |

## My rubric findings

| # | Section | Issue | Class | Disposition |
|---|---|---|---|---|
| RH1 | Migration 0268 | predicate `WHERE deleted_at IS NULL` referenced a column `connector_configs` doesn't have | mechanical | auto-apply: predicate is now `WHERE token_scope='agency' AND status<>'disconnected'` after H1 fix — RH1 resolved by H1 |

## Iteration 3 Summary

- Mechanical findings accepted:  4 (H1–H4)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Files changed: 1 (`docs/ghl-module-c-oauth-spec.md`)
- Stopping-heuristic note: iteration 2 and iteration 3 were both mechanical-only (0 directional, 0 ambiguous, 0 reclassified). **Two consecutive mechanical-only rounds → stopping heuristic fires after this iteration.** No iteration 4 will run.
