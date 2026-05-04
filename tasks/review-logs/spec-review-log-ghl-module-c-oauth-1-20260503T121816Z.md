# Spec Review Log — Iteration 1 — ghl-module-c-oauth

- Spec: `docs/ghl-module-c-oauth-spec.md`
- Spec commit at start: d62e7539ec2c5001f9a5589ec229dbcc5e0427f6
- Codex output: `tasks/review-logs/_codex_ghl_iter1_20260503T121816Z.txt`

## Codex findings — classification table

| # | Section | Issue | Class | Disposition |
|---|---|---|---|---|
| F1 | §5.2 vs §6 P4 | `fetchSubscription` listed in both "stays on agency token" and "rewire to location-token" lists | mechanical | auto-apply: remove from P4 rewire list |
| F2 | §5.6 / §6 P2 | `oauthIntegrationsService.exchangeGhl()` referenced; service file does not exist (only the route file does) | mechanical | auto-apply: extract the helper inside the existing `server/routes/oauthIntegrations.ts` (no new service file) |
| F3 | §5.2 / §6 P2 | `company_id` and `agency_id` both persisted for the same identity | mechanical | auto-apply: drop `agency_id` from migration 0268; expose alias only at API layer |
| F4 | §7 / §6 P2 | 0268 partial unique index has no HTTP-status mapping for `23505` | mechanical (§10.6 checklist) | auto-apply: declare upsert returns `200 idempotent-hit` (refresh tokens, update `installed_at`) |
| F5 | §6 P4 / §6 P5 | 0269 unique index uses `where deleted_at is null` but column list omits `deleted_at` | mechanical | auto-apply: add `deleted_at timestamptz` |
| F6 | §5.4 / §6 P3 | INSTALL webhook → callback race not pinned | mechanical | auto-apply: clarify webhook only acts on existing `(orgId, companyId)` connection; ack if absent |
| F7 | §5.4 / §6 P5 | "reject" vs "ack" semantics for Location-install conflict | mechanical | auto-apply: HTTP `200` ack + internal "ignored" log row |
| F8 | §5.4 / §6 P5 | UNINSTALL revoke step missing from P5 | mechanical | auto-apply: add explicit best-effort revoke step |
| F9 | §4 / §5.2 | "out of scope: per-location rotation policy" vs helper that refreshes | mechanical | auto-apply: reword §4 — out-of-scope clause is for *policy beyond GHL default*, helper does standard refresh |
| F10 | §5.5 / §6 P3 | `offset` vs `skip` pagination param naming | mechanical | auto-apply: use `skip` consistently (matches GHL API) |
| F11 | §5.5 / §6 P3 | 1000-cap truncation has no persisted outcome | ambiguous → narrow mechanical | auto-apply: declare prose contract — log + `notify_operator`; no new column (over-engineering for pre-prod) |
| F12 | §6 P3 | `autoEnrolAgencyLocations` claimed idempotent without naming key | mechanical (§10.1) | auto-apply: name `(connector_config_id, external_id)` upsert key |
| F13 | §6 P3 | callback-vs-webhook race: no concurrency guard for `autoStartOwedOnboardingWorkflows` | mechanical (§10.3) | auto-apply: first-commit-wins via upsert (xmax=0); only fire on actual insert |
| F14 | §6 P4 | per-location async lock insufficient cross-worker | mechanical (§10.3) | auto-apply: DB unique constraint + ON CONFLICT DO NOTHING is the authoritative guard; in-process lock = perf only |
| F15 | §6 P4 | "401 invalidation" listed as test, behaviour not pinned | mechanical | auto-apply: soft-delete cached token, remint exactly once; second 401 → typed error |
| F16 | §6 P3 / §11 | "reuses existing rate limiter" without name or budget | ambiguous → mechanical | auto-apply: name `withBackoff`, declare 3 retries / exponential |
| F17 | §7 / §8 | migration files not in §8 inventory | mechanical | auto-apply: add `migrations/0268_*.sql` and `migrations/0269_*.sql` (+ `_down/`) |
| F18 | §5.4 / §6 P5 | webhook idempotency lacks fallback when `webhookId` missing | mechanical (§10.1) | auto-apply: missing key → `400` reject |
| F19 | §11 / §9 | risk row "ship behind a feature flag for partner-only later" | directional → AUTO-REJECT (framing) | reframe mitigation: hold at 6a-green, surface to user weekly until 6b reachable; no flag |
| F20 | §10 | "Test agency RESOLVED" still under "Open questions" | mechanical | auto-apply: add `## Resolved Decisions` section, move it there |
| F21 | §3 / §5.3 | final scope count never stated | mechanical | auto-apply: state final list = 15 (11 existing + 4 new), enumerate explicitly |
| F22 | §8 / §9 | docs/capabilities.md and docs/integration-reference.md not in §8 Modified | mechanical | auto-apply: add both |

## Rubric findings (my pass)

| # | Section | Issue | Class | Disposition |
|---|---|---|---|---|
| R1 | §11 | Same as F19 | — | covered by F19 |
| R2 | §8 | `*Pure.test.ts` test files paired with non-`Pure` source files | mechanical | auto-apply: add `ghlAgencyOauthServicePure.ts` and `locationTokenServicePure.ts` to §8 New; pure logic lives there |
| R3 | spec-wide | Missing `## Deferred Items` section | mechanical (§7 checklist) | auto-apply: add section listing the items prose currently mentions as deferred |
| R4 | §5 | Missing Contracts subsection for GHL Location shape, agency-token, location-token responses | mechanical (§3 checklist) | auto-apply: add §5.7 Contracts with Location[], OAuth token response, location-token response |
| R5 | §6 P4 / §7 | Missing RLS policy + `RLS_PROTECTED_TABLES` registration for `connector_location_tokens` | mechanical (§4 checklist) | auto-apply: declare RLS via `connector_config_id → organisation_id` lookup; register in manifest; helper-only access |

## Apply order

§3 → §4 → §5.2 → §5.3 → §5.4 → §5.5 → §5.6 → §5.7 NEW → §6 P2 → §6 P3 → §6 P4 → §6 P5 → §7 → §8 → §10 → §11 → §12 NEW (Deferred Items) → §13 NEW (Resolved Decisions, optional split)

---

## Iteration 1 Summary

- Mechanical findings accepted:  26 (F1–F18, F20–F22 from Codex + R2, R3, R4, R5 from rubric — F19 reframed via AUTO-REJECT but mechanical fix applied)
- Mechanical findings rejected:  0
- Directional findings:          1 (F19 — partner-flag mitigation; reframed not removed)
- Ambiguous findings:            0 (F11 + F16 reclassified to mechanical inside Codex review pass)
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 1
  - AUTO-REJECT (framing):    1 (F19 — feature flag for partner-only)
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Files changed:  1 (`docs/ghl-module-c-oauth-spec.md`)
