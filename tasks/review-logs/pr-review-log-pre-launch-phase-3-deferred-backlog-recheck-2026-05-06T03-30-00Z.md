# PR Re-Review Log — pre-launch-phase-3-deferred-backlog (B-1..B-4 fix pass)
**Date:** 2026-05-06T03:30:00Z
**Branch:** claude/pre-launch-phase-3
**Reviewer:** pr-reviewer (read-only)
**Scope:** Confirm B-1 through B-4 blocking fixes only
**Verdict:** APPROVED

---

## All 4 blocking fixes verified correct

**B-1 — `setOrgGUC` inside per-row tx (`ghlAutoEnrolLocationsPageJob.ts`)**
- `db.transaction(async (tx) => { ... })` wraps each per-location INSERT.
- `setOrgGUC(tx, organisationId)` runs as the FIRST statement before `tx.execute()`. Order correct.
- `true` (is_local) scopes GUC to tx — cannot leak to pool.
- Per-location error boundary preserved: try/catch wraps the entire `db.transaction(...)` call; failed tx rolls back only that location and logs; loop continues.
- ON CONFLICT clause matches the partial unique index in `subaccounts.ts` exactly.

**B-2 — `external_id_namespace` + ON CONFLICT in agency service and webhook**
- `ghlAgencyOauthService.ts`: VALUES includes `'ghl_location'`; ON CONFLICT target `(organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL`; DO UPDATE preserves `name` + `updated_at`.
- `ghlWebhookMutationsService.ts`: identical fix shape.

**B-3 — Migration safety check scoped to GHL rows**
- DO block predicate adds `AND connector_config_id IN (SELECT id FROM connector_configs WHERE connector_type = 'ghl')`. Checks exactly the set the backfill UPDATE touched. No false positives; non-GHL `external_id` rows are intentionally unchecked (they fall outside the partial index).

**B-4 — OAuth state context arg**
- `setGhlOAuthState(nonce, orgId, pendingRunId || undefined, { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null })` — type matches.
- `consumeGhlOAuthState(state, { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null })` — type matches.
- `req.ip ?? null` correctly handles `string | undefined` Express type.

---

## Non-blocking note

Inline `SELECT set_config(...)` calls in `ghlAgencyOauthService.ts` and `ghlWebhookMutationsService.ts` are functionally equivalent to `setOrgGUC` but inconsistent in style. Flagged for follow-up cleanup only.

---

**Review complete. Branch is clear of blocking issues.**
