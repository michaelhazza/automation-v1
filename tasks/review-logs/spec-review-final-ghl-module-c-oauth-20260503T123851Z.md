# Spec Review Final Report

**Spec:** `docs/ghl-module-c-oauth-spec.md`
**Spec commit at start:** d62e7539ec2c5001f9a5589ec229dbcc5e0427f6
**Spec commit at finish:** eb6c53c5ef500dc1dcc2e4fc19f59261d0f39e1b
**Spec-context commit:** 1eb4ad72f73deb0bd79ad333b3f8caef23418392
**Branch:** ghl-agency-oauth
**Iterations run:** 3 of 5
**Exit condition:** two-consecutive-mechanical-only (iterations 2 and 3 both had 0 directional, 0 ambiguous, 0 reclassified findings)
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|---|---|---|---|---|---|---|
| 1 | 22 | 5 | 26 | 0 | 1 | 0 | 0 |
| 2 | 12 | 0 | 12 | 0 | 0 | 0 | 0 |
| 3 | 4  | 1 | 4  | 0 | 0 | 0 | 0 |

Total: 38 Codex findings + 6 rubric findings = 44 inputs. 42 mechanical fixes applied (4 of the rubric findings were redundant with Codex findings; 1 was resolved by Codex's H1 fix). 1 directional finding resolved via AUTO-REJECT (framing) with a mechanical reframe applied.

---

## Mechanical changes applied

### §3 State of the foundation
- Sharpened the scope-list note: spec now lists the three `.write`-shaped scopes already in adapter use that needed formal declaration.

### §4 Scope
- Reworded the "Out" clause for per-location token rotation policy — the helper does GHL's standard refresh; "out" means custom rotation policies above GHL's default (F9).

### §5.2 Token model
- Added the full 9-method list of location-token call sites and named the 2 agency-token exceptions explicitly (G1).
- Added "Location-token refresh" subsection: pin `/oauth/token` with `grant_type=refresh_token`; in-place row update; soft-delete reserved for 401 path (G6).

### §5.3 Required scopes
- Added the final 15-scope list (11 existing + 4 new) with explicit `← NEW` annotations (F21).

### §5.4 Install / uninstall webhook → auto-enrol
- Added "Webhook → org mapping" subsection naming the exact `connector_configs` lookup (G5, refined in iteration 3 to use `connector_type` and `status<>'disconnected'`).
- Reworked INSTALL Company semantics: webhook only acts on existing `(orgId, companyId)` connection; if absent, HTTP 200 ack + log `webhook-orphan-companyId`; do NOT mint partial connection (F6).
- INSTALL Location: HTTP 200 ack + ignored log row, never reject at HTTP layer (F7).
- UNINSTALL: explicit ordered 4-step procedure with best-effort revoke first (F8).
- Added LocationCreate side-effect (single-location upsert via shared primitive) and LocationUpdate no-op (G10).
- Webhook idempotency: dedupe row commits AFTER side effects so HTTP 503 retries are safe (H3); missing `webhookId` → HTTP 400 (F18).

### §5.5 Pagination
- Switched to `skip` pagination param (matches GHL API) (F10).
- Added Truncation contract: log + `notify_operator(reason='enumeration_truncated')`, no new persisted column (F11).

### §5.6 Redirect URI
- Clarified that GHL-specific code-exchange logic lands as private helper inside `oauthIntegrations.ts`, while new `ghlAgencyOauthService(.Pure).ts` files own post-callback orchestration — two separate responsibilities (G2).

### §5.7 Contracts (NEW)
- Added Contracts subsection per Section 3 of authoring checklist (R4): `AgencyTokenResponse`, `LocationTokenResponse`, `Location` shapes with example fields and source-of-truth precedence note.

### §6 Phase 2
- Migration 0268: dropped persisted `agency_id` column (F3); added `disconnected_at`; two partial unique indexes — per-org and global (H1, RH1).
- Reworked OAuth flow split: `ghl.ts` owns initiation+nonce; callback is generic `oauthIntegrations.ts` (G3).
- Pinned upsert semantics with `ON CONFLICT` clause + HTTP 200/409 mapping (F4, H1).
- Named the new agency-token refresh path in `connectorConfigService.refreshIfExpired` invoked from `connectorPollingTick.ts` (G8).

### §6 Phase 3
- Named `withBackoff` for 429 handling with explicit retry budget (F16).
- 401-then-refresh-then-401 typed error path pinned (F15).
- Pinned subaccounts upsert with `(connector_config_id, external_id)` key + RETURNING (xmax = 0) for first-commit-wins concurrency guard (F12, F13).
- Webhook-path 429 returns HTTP 503 (not 200) so GHL retries (G4).
- Removed unbacked "next polling tick" enrolment retry claim (H2).
- Truncation cap reference (F11).

### §6 Phase 4
- Migration 0269: added `deleted_at timestamptz` to column list (F5).
- DB-level unique partial index is the authoritative concurrency primitive; in-process lock is perf-only (F14).
- 401 handling on cached location tokens: soft-delete → remint → typed error on second 401 (F15).
- Adapter rewire list trimmed to 9 methods (F1, G1).
- RLS posture explicit: tenant-scoped via `connector_config_id → connector_configs.organisation_id`; manifest entry lands in same commit as migration (R5, G7).

### §6 Phase 5
- UNINSTALL ordered procedure with revoke-first (F8).
- Idempotency: missing `webhookId` → HTTP 400 (F18).

### §7 Migrations
- Updated 0268 description to match the per-org + global unique indexes (H1).
- Updated 0269 description to clarify manifest entry lands in same commit (G7).

### §8 Files touched
- Renamed source files to `*Pure.ts` pairs to match `*Pure.test.ts` convention (R2).
- Added `ghlAgencyOauthServicePure.ts` and `locationTokenServicePure.ts` to New (R2).
- Added 3 in-process `*.test.ts` files for callback round-trip / location-token / webhook side-effect (H4).
- Added migration files explicitly (`0268_*.sql`, `0269_*.sql` + `_down/`) (F17).
- Added `connectorPollingTick.ts` to Modified (G8).
- Added `rlsProtectedTables.ts` to Modified (R5).
- Added `docs/capabilities.md` and `docs/integration-reference.md` to Modified (F22).

### §9 Done definition
- Reframed test bullet: pure-function tests via `npx tsx <path>`; clarified CI runs full suite (G11).

### §10 / §10a (split)
- Moved "Test agency RESOLVED" out of Open Questions into new Resolved Decisions section (F20).
- Moved "agency-token scope on read endpoints" to Resolved Decisions with the Stage 6a verification note (G9).

### §11 Risk register
- Reframed "design-partner unavailable" mitigation: hold at 6a-green, no feature flag (F19, framing-aligned).

### §12 Deferred Items (NEW)
- Added section per Section 7 of authoring checklist (R3): 8 deferred items listed.
- Re-consent enforcement point named: `mapGhlAvailability` in `ghlAdapter.ts` (G12).

---

## Rejected findings

None. Every Codex finding adjudicated as mechanical was applied; the single directional finding (F19) was reframed to the framing-aligned alternative rather than rejected outright.

---

## Directional and ambiguous findings (autonomously decided)

| Iteration | Finding | Classification | Decision | Rationale |
|---|---|---|---|---|
| 1 | F19 — Risk register row "ship behind a feature flag for the partner-only later" | directional | AUTO-REJECT (framing) — but mechanical reframe applied | `docs/spec-context.md` rules out rollout-gating flags in pre-prod (`feature_flags: only_for_behaviour_modes`). The mitigation was rewritten to "hold at 6a-green, surface to user weekly until 6b reachable; build simply waits". No `tasks/todo.md` deferral needed — the framing-correct alternative is now in the spec. |

No items were AUTO-DECIDED via best-judgment. All directional findings matched a framing assumption directly.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across three iterations (Codex declared "everything else looks internally consistent for implementation readiness" in iteration 3 after applying 4 final fixes). The spec was extended with:

- A Contracts section (§5.7) pinning the three GHL response shapes the build consumes.
- A Deferred Items section (§12) naming what is intentionally out-of-scope and why.
- Explicit idempotency posture, retry classification, concurrency guard, terminal-event behaviour, and unique-constraint HTTP mapping for every externally-triggered write — per Section 10 of the authoring checklist.
- A Webhook → org mapping subsection and the global agency-uniqueness index that backs it.
- An honest test plan that fits the static-gates-primary posture (pure tests + a small named set of in-process tests with mocked HTTP).

However:

- The review did not re-verify the framing assumptions in `docs/spec-context.md`. If the product context has shifted since the spec-context file was last updated (2026-04-21), re-read §1 (Goal), §2 (Why), §4 (Scope), §9 (Done definition), and the Risk register before calling this implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. The two-stage verification approach (trial → design partner) is itself a directional choice that no rubric pass will second-guess; confirm that's still the right test posture.
- One item that should be confirmed during implementation, not specified in advance: the spec assumes `ghlWebhookMutationsService.ts` already commits its dedupe row AFTER side effects (the current convention). If the existing implementation commits before, the order must be reversed in this build (the spec says so explicitly under "Webhook idempotency").
- The spec presumes the `connectorConfigs.connectorType` column is the right discriminant for the global unique index (the existing column carries values like `'ghl'`, `'hubspot'`, etc. — verified during review). If a separate `provider` column is added before this build ships, the index needs to track that change.

**Recommended next step:** re-read §5.4 (webhook semantics), §5.7 (contracts), and §6 Phase 6 (verification gate) one more time, confirm the approach matches your current intent, and then start implementation against migration 0268 first.
