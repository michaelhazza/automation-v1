```adversarial-review-log
# Adversarial Review Log

**Branch:** claude/evaluate-new-features-waqfY vs main
**Reviewer:** adversarial-reviewer (Claude Sonnet 4.6)
**Timestamp:** 2026-05-05T00:00:00Z
**Status:** HOLES_FOUND — 2 confirmed-holes fixed, 3 likely-holes documented

---

## Confirmed Holes (fixed in this session)

### 1. portal.ts — Local resolveSubaccount omits org ownership check (FIXED)

**File:** `server/routes/portal.ts:65` (removed)

The local `resolveSubaccount(subaccountId)` helper filtered only by `subaccountId` and `isNull(deletedAt)` — no `organisationId` guard. The fallback in `requireSubaccountPermission` allows `org_admin` users to pass for any subaccount ID regardless of org ownership (line 332 of `server/middleware/auth.ts`). Combined, an `org_admin` from org A could supply a subaccount ID from org B in portal route URLs, pass the middleware, and have the unguarded helper resolve the foreign org's subaccount. Routes that then used `sa.organisationId` to fire `taskService.createTask` or `WorkflowRunService.startRun` (portal.ts:664, 669–670, 684, 689–690) would execute those mutations against the foreign org.

**Fix applied:** Removed local helper; imported canonical `resolveSubaccount(subaccountId, organisationId)` from `server/lib/resolveSubaccount.ts`. All 9 call sites updated to pass `req.user!.organisationId`.

---

### 2. ghlWebhook.ts — GHL lifecycle events had no pre-dispatch dedupe gate (FIXED)

**File:** `server/routes/webhooks/ghlWebhook.ts:77–130`

The `isDuplicate(webhookId)` call at line 129 was both the check and the mark, but it was only called AFTER successful dispatch — never before. A GHL re-delivery of the same `webhookId` (e.g., after a brief network hiccup that caused the 200 ACK to be lost in transit) would execute `dispatchWebhookSideEffects` a second time with no gate. Side effects include connector config creation and agency location enrolment.

The §5.4 ordering invariant (side effects first, mark on success) was intentionally preserved: the existing `isDuplicate` post-dispatch call remains the authoritative mark. The fix adds a separate read-only `hasBeenProcessed(webhookId)` pre-dispatch check that short-circuits replays without consuming the dedup token — so a 503 retry path remains unmarked and GHL can legitimately re-deliver.

**Fix applied:**
- Added `hasBeenProcessed(eventId): boolean` method to `WebhookDedupeStore` in `server/lib/webhookDedupe.ts` — read-only, does not mark.
- Added pre-dispatch check in `ghlWebhook.ts` using `hasBeenProcessed` before the `dispatchWebhookSideEffects` call.

---

## Likely Holes (not fixed — require confirmation or deployment decision)

### 3. ghlOAuthStateStore.ts — In-process CSRF nonce store fails under multi-instance deployment

**File:** `server/lib/ghlOAuthStateStore.ts:16`

The OAuth state (CSRF nonce) store is an in-process `Map`. In a multi-instance or blue-green deployment without sticky sessions, an OAuth initiation on instance A and callback on instance B fails silently (`invalid_state`). The code's own comment acknowledges this and recommends Redis backing before multi-instance. No ADR or deployment gate captures this as a hard constraint.

**Action required:** Either confirm single-instance deployment and document the constraint in an ADR, or move to Redis/DB-backed nonce storage before scaling horizontally.

---

### 4. locationTokenService.ts — DB writes without org-session GUC under FORCE ROW LEVEL SECURITY

**File:** `server/services/locationTokenService.ts` (throughout)

All DB operations use the raw `db` handle with no `withOrgTx` wrapper. The `connector_location_tokens` table has `FORCE ROW LEVEL SECURITY` with an org check via `connector_configs` JOIN. From the unauthenticated OAuth callback path, no `app.organisation_id` GUC is set — all reads return empty and all writes are rejected. This means location tokens are never persisted from the OAuth callback. Tokens leak unencrypted into memory between calls.

**Action required:** Trace whether `getLocationToken` is ever called from a `withOrgTx` context. If not, this is a confirmed-hole. See `server/services/ghlAgencyOauthService.ts:289` for a known-broken annotation on a related pattern.

---

### 5. proposeActionMiddleware — Spend-enabled tool calls fail open on proposeAction errors

**File:** `server/services/middleware/proposeAction.ts:354–363`

When `actionService.proposeAction()` throws unexpectedly, the middleware returns `{ action: 'continue' }` — the spend gate is bypassed. For spend-enabled tool calls, this means no ledger row and no HITL gate.

**Action required:** Confirm whether `skillExecutor.ts` or the Stripe integration independently verifies a resolved `agent_charges` row before executing a payment. If so, the proposeAction failure is caught downstream and this is not a hole. If not, this is a confirmed-hole.

---

## Additional Observations (non-blocking)

- `server/routes/portal.ts` imported `db` directly — `routes should not import db` (architecture.md rule). Predates this branch; noted for future cleanup.
- `migrations/0276_workflows_v1_additive_schema.sql`: `workflow_drafts` RLS policy was cut off in the review. Confirm `WITH CHECK` is present (table has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` — policy body must exist).
- `cost_aggregates` sentinel-org rows (org `00000000-0000-0000-0000-000000000001`) are globally visible. Confirm no tenant-identifiable data ends up in those rows via the backfill.
- `routes/organisations.ts:53` reads from `req.user?.organisationId` instead of `req.orgId`. Correctness issue for `system_admin` in scoped sessions — not a security hole but deviates from the canonical pattern.

---

## Verdict: HOLES_FOUND → FIXED (confirmed-holes)

Both confirmed holes have been remediated. Three likely-holes remain open and require offline confirmation per the notes above.
```
