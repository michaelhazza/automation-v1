# Dual Review Log — consolidation-govern

**Files reviewed:** all uncommitted + branch diff vs main on `ui-consolidation-govern`
**Iterations run:** 3/3
**Timestamp:** 2026-05-07T21:13:47Z

---

## Iteration 1

Codex flagged 4 functional issues in the new Govern surface.

[ACCEPT] server/services/connectionsService.ts:184-193 — backend mapper returns `{kind, label, displayName, ...}` but the page consumes the shared `Connection` shape `{name, lastSyncAt, owner, ...}`. Page would crash on `r.owner.kind`.
  Reason: Real runtime crash, contract violation against spec §4.6 (line 266-275). Type alias `ConnectionRow` declared the contract shape but the actual mapper returned a different shape — TypeScript was satisfied by a coincidental name match.

[ACCEPT] client/src/pages/govern/components/DisconnectConfirmDialog.tsx:39 — POST to `/api/connections/:id/disconnect` but no such endpoint exists.
  Reason: Real 404. Spec §4.10 (line 279) calls for delegating to existing per-kind routes; the unified surface needs a thin dispatcher.

[ACCEPT] server/services/knowledgeService.ts:691 — `source.runId` hardcoded to `''`. Schema has `source_run_id` available; the SQL just doesn't select it.
  Reason: Spec §4.12 / §4.13 require provenance run-id link to open a run-trace iframe. Empty string breaks the link silently.

[ACCEPT] client/src/config/sidebar.ts:470 — sidebar gates Connections nav on `org.mcp_servers.view`, but `/api/connections` requires `org.connections.view`.
  Reason: Permission mismatch produces "see link, get 403" or "have access, see no link". Both are real defects.

## Iteration 2

Codex flagged 3 follow-on issues after the iteration-1 fixes.

[ACCEPT] server/services/connectionsService.ts (auth_method/status enum remapping) — SQL CASE already produces contract values, then the JS mapper re-maps them and throws `UnknownEnumValueError` because raw values like `oauth2`/`active` are no longer in the input.
  Reason: Real `throw` in iteration-1 fix path. Resolved by selecting both raw and contract-derived columns and using contract-derived values directly with NULL-checks (preserves I2 fail-closed semantics from `connectionsListPure`).

[ACCEPT] client/src/pages/govern/components/DisconnectConfirmDialog.tsx — uses raw `fetch` instead of the shared axios `api` client; misses the JWT `Authorization` header and `X-Organisation-Id` system-admin override.
  Reason: Real 401 on the disconnect call in token-authenticated sessions. Trivial fix: route through the shared client.

[ACCEPT] client/src/pages/govern/KnowledgePage.tsx:43 — sends `scope=workspace` without `subaccountId`. Server gates the workspace filter on `scope==='workspace' && subaccountId`, so without subaccountId it silently returns ALL org rows.
  Reason: Real cross-workspace data leak in workspace mode. Same pattern existed in `SpendingPage` (ledger). Fix applied to both pages plus matching server-side fail-closed `refine` so future callers can't silently fall through.

## Iteration 3

Codex flagged 4 more issues; 3 accepted, 1 rejected.

[REJECT] client/src/App.tsx:429 — bookmarked `/admin/subaccounts/:id/spend-ledger` redirect drops the subaccountId.
  Reason: Setting `activeClientId` as a side effect of opening a bookmark is surprising UX (mutates global state from a passive read). The C12-C13 redirect was added for "bookmarks survive" — landing on `/spending` in the user's current view is a graceful fallback. With the iteration-2 server-side fail-closed validation, the worst case is a 400 error rather than wrong-data. Keeping the redirect simple is preferable to a side-effect-y route component.

[ACCEPT] client/src/pages/govern/SpendingPage.tsx:227 — caps tab `getCaps('workspace')` without `subaccountId`. Server falls back to org totals.
  Reason: Same shape as iteration-2 finding for ledger. Fix-closed both client and server (z `refine`).

[ACCEPT] client/src/pages/govern/ConnectionsPage.tsx:58 — workspace-scope request lacks `subaccountId`, and `/api/connections` ignored the scope param entirely; workspace view returned every org connection.
  Reason: Spec §4.6 / §4.13 intend scope filtering. Added `scope`/`subaccountId` to the route schema with `refine` fail-closed and threaded through `connectionsService.listConnections` SQL (`AND c.subaccount_id = :id` for workspace, `IS NULL` for org).

[ACCEPT] client/src/config/sidebar.ts:202 — Knowledge nav gates on `subaccount.workspace.view`, but `/api/knowledge` requires `org.agents.view`.
  Reason: Real "see link, hit 403" path for workspace-only users. Aligned sidebar to `org.agents.view || isSystemAdmin`.

---

## Changes Made

- `server/services/connectionsService.ts` — re-projected query rows to shared `Connection` shape (`name`/`lastSyncAt`/`owner`); added `last_successful_sync_at`, `subaccount_id`, `subaccounts.name` join; switched WHERE filters to derived contract columns; selected both raw + contract values; mapper enforces I2 fail-closed via NULL→`UnknownEnumValueError`; added `disconnectConnection()` that delegates to integration revoke or MCP delete; added `scope`/`subaccountId` filter (workspace=eq, org=IS NULL).
- `server/routes/integrationConnections.ts` — added `POST /api/connections/:id/disconnect` (gated by `CONNECTIONS_MANAGE`); extended `GET /api/connections` to accept `scope`/`subaccountId` with `refine` fail-closed.
- `server/routes/knowledge.ts` — added `refine` so `scope=workspace` requires `subaccountId`.
- `server/routes/agentCharges.ts` — same `refine` on ledger and caps queries.
- `server/services/knowledgeService.ts` — added `source_run_id` to base SQL projection and propagated to mapper.
- `shared/types/govern.ts` — added `subaccountId` field to `KnowledgeListQuery`, `LedgerQuery`, `ConnectionsQuery`.
- `client/src/config/sidebar.ts` — Connections gated on `org.connections.view`; Knowledge gated on `org.agents.view || isSystemAdmin`.
- `client/src/api/governApi.ts` — added `disconnectConnection` wrapper.
- `client/src/pages/govern/components/DisconnectConfirmDialog.tsx` — replaced raw fetch with `disconnectConnection` axios wrapper.
- `client/src/pages/govern/components/KnowledgeRow.tsx` — gated provenance run-id link and modal iframe on non-empty `runId`.
- `client/src/pages/govern/KnowledgePage.tsx` — passes `subaccountId` from `getActiveClientId()` in workspace mode; fail-closed locally if no active workspace.
- `client/src/pages/govern/SpendingPage.tsx` — same fix on ledger and caps fetches.
- `client/src/pages/govern/ConnectionsPage.tsx` — same fix on connections fetch.

## Rejected Recommendations

- App.tsx legacy spend-ledger redirect preservation — rejected because the existing redirect is a graceful fallback. Mutating `activeClientId` from a redirect adds surprising side effects, and the iteration-2 server-side fail-closed validation now produces a 400 (visible error) instead of wrong-workspace data when the user has no active workspace.

---

**Verdict:** APPROVED (3 iterations, 11 of 12 findings accepted, 1 rejected with rationale)
